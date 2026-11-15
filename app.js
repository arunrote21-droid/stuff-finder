(() => {
'use strict';

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const nfc = s => String(s).normalize('NFC');
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const BUILD = 'sheet-2026-11-15-k';
const IMG_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const baseName = p => p.split('/').pop();
const noExt = n => n.replace(/\.[^.]+$/, '');

/* ───────────── storage (IndexedDB) ───────────── */
/* thumbnails live in their own small database so the main one never needs an upgrade */
const TH = {
  p: null,
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('sheet-thumbs', 1); r.onupgradeneeded = () => r.result.createObjectStore('t'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async run(mode, fn) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction('t', mode); const out = fn(t.objectStore('t')); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = t.onabort = () => rej(t.error); }); },
  get: id => TH.run('readonly', s => s.get(id)),
  put: (id, b) => TH.run('readwrite', s => s.put(b, id)),
  del: id => { TH.run('readwrite', s => s.delete(id)).catch(() => {}); },
  clear: () => { TH.run('readwrite', s => s.clear()).catch(() => {}); },
};
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('sheet-music', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('songs', { keyPath: 'id' }); d.createObjectStore('pages'); d.createObjectStore('sets', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, mode);
      const out = fn(...stores.map(s => t.objectStore(s)));
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  allSongs: () => DB.tx(['songs'], 'readonly', s => s.getAll()),
  allSets: () => DB.tx(['sets'], 'readonly', s => s.getAll()),
  page: (id, i) => DB.tx(['pages'], 'readonly', s => s.get(id + ':' + i)),
  putSong: (song, blobs) => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.put(song); blobs.forEach((b, i) => ps.put(b, song.id + ':' + i)); }),
  delSong: song => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.delete(song.id); TH.del(song.id); for (let i = 0; i < song.n; i++) { ps.delete(song.id + ':' + i); TH.del('bb:' + song.id + ':' + i); } }),
  putSongMeta: song => DB.tx(['songs'], 'readwrite', s => s.put(song)),
  putSet: set => DB.tx(['sets'], 'readwrite', s => s.put(set)),
  delSet: id => DB.tx(['sets'], 'readwrite', s => s.delete(id)),
  clear: () => { TH.clear(); return DB.tx(['songs', 'pages', 'sets'], 'readwrite', (a, b, c) => { a.clear(); b.clear(); c.clear(); }); },
};

/* ───────────── state ───────────── */
const S = { songs: new Map(), sets: [], queue: [], cur: 0, page: 0, zoom: 1, searching: false, q: '', letter: '', letterMode: false, shown: 120, setName: '' };
const STATEKEY = 'sheet:state';
const saveState = () => { try { localStorage.setItem(STATEKEY, JSON.stringify({ queue: S.queue, cur: S.cur, page: S.page, setName: S.setName })); } catch { /* storage blocked */ } };
function loadState() {
  try {
    const v = JSON.parse(localStorage.getItem(STATEKEY) || 'null'); if (!v) return;
    S.queue = (v.queue || []).filter(id => S.songs.has(id));
    S.cur = Math.min(Math.max(0, v.cur | 0), Math.max(0, S.queue.length - 1));
    S.page = Math.max(0, v.page | 0); S.setName = v.setName || '';
  } catch { /* ignore */ }
}
const curSong = () => S.songs.get(S.queue[S.cur]);

/* ───────────── UI primitives ───────────── */
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button id="toastBtn">${esc(action.label)}</button>` : ''}`;
  t.classList.add('show');
  $('#toastBtn')?.addEventListener('click', () => { t.classList.remove('show'); action.fn(); });
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6500 : 2400);
}
function sheet(inner, { onclose } = {}) {
  const sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
  const close = () => { sc.remove(); onclose?.(); if (typeof chromeArm === 'function') chromeArm(); };
  sc.addEventListener('pointerdown', e => { if (e.target === sc) close(); });
  $('#layer').append(sc);
  return { el: sc.firstChild, close, scrim: sc };
}
function ask({ title, text, buttons }) {
  return new Promise(res => {
    const s = sheet(`<h3>${esc(title)}</h3>${text ? `<p class="sub">${esc(text)}</p>` : ''}<div class="imp">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`, { onclose: () => fin(null) });
    let done = false; const fin = v => { if (done) return; done = true; s.close(); res(v); };
    s.el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) fin(buttons[b.dataset.i].value); });
  });
}
const confirmDel = (title, text, label = 'ลบ') => ask({ title, text, buttons: [{ label, value: true, cls: 'bad' }, { label: 'ยกเลิก', value: null, cls: 'o' }] });
function askText({ title, value = '', ok = 'ตกลง', placeholder = '' }) {
  return new Promise(res => {
    const s = sheet(`<h3>${esc(title)}</h3><input class="field" id="atx" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120"><div class="row2"><button class="btn o" data-v="0">ยกเลิก</button><button class="btn" data-v="1">${esc(ok)}</button></div>`, { onclose: () => fin(null) });
    let done = false; const fin = v => { if (done) return; done = true; s.close(); res(v); };
    const inp = $('#atx', s.el); inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') fin(inp.value.trim() || null); });
    s.el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) fin(b.dataset.v === '1' ? (inp.value.trim() || null) : null); });
  });
}

/* ───────────── queue helpers ───────────── */
const sortKey = n => nfc(n).replace(/^[\s"'“”‘’(\[{เแโใไ]+/, '') || n;
function firstLetter(name) {
  const k = sortKey(name); const ch = Array.from(k)[0] || '#';
  if (/[0-9๐-๙]/.test(ch)) return '0-9';
  if (/[a-z]/i.test(ch)) return ch.toUpperCase();
  return ch;
}
function addToQueue(id, where) {
  const song = S.songs.get(id); if (!song) return;
  if (!S.queue.length) { S.queue = [id]; S.cur = 0; S.page = 0; where = 'first'; }
  else if (where === 'next') S.queue.splice(S.cur + 1, 0, id);
  else S.queue.push(id);
  saveState(); renderAll();
  const pos = S.queue.lastIndexOf(where === 'next' ? id : id);
  toast(where === 'first' ? `เล่น “${song.name}”` : where === 'next' ? `“${song.name}” เป็นเพลงต่อไป` : `ต่อคิว “${song.name}” (ลำดับที่ ${S.queue.length})`);
}
function play(i) {
  if (i < 0 || i >= S.queue.length) return;
  S.cur = i; S.page = 0; resetZoom(); saveState(); renderTop(); renderStrip(); showPage(); scrollToCur(); chromeArm();
}
function setQueueOrder(ids) { const curId = S.queue[S.cur]; S.queue = ids; S.cur = Math.max(0, ids.indexOf(curId)); saveState(); renderTop(); renderStrip(); }
function removeFromQueue(i) {
  const id = S.queue[i], oldCur = S.cur, oldPage = S.page; const removedSong = S.songs.get(id);
  S.queue.splice(i, 1);
  if (i < S.cur) S.cur--;
  else if (i === S.cur) { S.cur = Math.min(S.cur, Math.max(0, S.queue.length - 1)); S.page = 0; }
  saveState(); renderAll();
  toast(`เอา “${removedSong?.name}” ออกจากคิวแล้ว`, { label: 'เลิกทำ', fn: () => { S.queue.splice(i, 0, id); S.cur = oldCur; S.page = oldPage; saveState(); renderAll(); } });
}

/* ───────────── zoom (pinch, drag, double tap) ───────────── */
const Z = { s: 1, tx: 0, ty: 0 };
const CROP = { on: (() => { try { return localStorage.getItem('sheet:trim') !== '0'; } catch { return true; } })(), box: null };
function cropBase() { // transform that shows only the inked area of the page, in stage coordinates
  const b = CROP.on && CROP.box; if (!b) return '';
  const r = $('#stage').getBoundingClientRect(), W = r.width, H = r.height; if (!W || !H) return '';
  const f = Math.min(W / b.ar, H), dw = b.ar * f, dh = f, ox = (W - dw) / 2, oy = (H - dh) / 2;
  const cx = ox + b.x0 * dw, cy = oy + b.y0 * dh, cw = (b.x1 - b.x0) * dw, ch = (b.y1 - b.y0) * dh;
  const s0 = Math.min(W / cw, H / ch), tx = W / 2 - s0 * (cx + cw / 2), ty = H / 2 - s0 * (cy + ch / 2);
  return `translate(${tx}px,${ty}px) scale(${s0})`;
}
const bbMem = new Map();
async function inkBox(id, page) {
  const key = 'bb:' + id + ':' + page; if (bbMem.has(key)) return bbMem.get(key);
  let box = null, got = false;
  try { const saved = await TH.get(key); if (saved !== undefined) { box = saved.none ? null : saved; got = true; } } catch { /* no store */ }
  if (!got) {
    try {
      const blob = await DB.page(id, page); if (!blob) return null;
      let bmp; try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 360, resizeQuality: 'low' }); } catch { bmp = await createImageBitmap(blob); }
      const w = Math.min(360, bmp.width), h = Math.max(1, Math.round(bmp.height * w / bmp.width)), c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
      const d = g.getImageData(0, 0, w, h).data, lum = new Uint8Array(w * h), hist = new Uint32Array(256);
      for (let i = 0; i < w * h; i++) { const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; lum[i] = v; hist[v]++; }
      let acc = 0, bg = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= w * h * 0.9) { bg = v; break; } }
      const thr = Math.min(200, bg - 55), rows = new Uint16Array(h), cols = new Uint16Array(w);
      if (thr > 40) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < thr) { rows[y]++; cols[x]++; }
      const rMin = Math.max(3, w * 0.012), cMin = Math.max(3, h * 0.012);
      let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
      while (y0 < h && rows[y0] < rMin) y0++; while (y1 > y0 && rows[y1] < rMin) y1--;
      while (x0 < w && cols[x0] < cMin) x0++; while (x1 > x0 && cols[x1] < cMin) x1--;
      const px = 0.025 * w, py = 0.025 * h; const nb = { x0: Math.max(0, x0 - px) / w, x1: Math.min(w, x1 + px) / w, y0: Math.max(0, y0 - py) / h, y1: Math.min(h, y1 + py) / h, ar: w / h };
      const area = (nb.x1 - nb.x0) * (nb.y1 - nb.y0);
      box = (thr > 40 && y0 < y1 && x0 < x1 && nb.x1 - nb.x0 > 0.35 && nb.y1 - nb.y0 > 0.35 && area < 0.96) ? nb : null;
      TH.put(key, box || { none: true }).catch(() => {});
    } catch { box = null; }
  }
  bbMem.set(key, box); if (bbMem.size > 300) bbMem.delete(bbMem.keys().next().value);
  return box;
}
function applyZoom() {
  const img = $('#pg'); img.style.transformOrigin = '0 0';
  const base = cropBase(), z = (Z.s === 1 && !Z.tx && !Z.ty) ? '' : `translate(${Z.tx}px,${Z.ty}px) scale(${Z.s})`;
  img.style.transform = (z + ' ' + base).trim();
  $('#zoomBtn').textContent = Z.s > 1 ? '⤢' : '🔍';
}
function clampZ() {
  const r = $('#stage').getBoundingClientRect(); Z.s = Math.min(5, Math.max(1, Z.s));
  Z.tx = Math.min(0, Math.max(r.width - r.width * Z.s, Z.tx)); Z.ty = Math.min(0, Math.max(r.height - r.height * Z.s, Z.ty));
  if (Z.s === 1) { Z.tx = 0; Z.ty = 0; }
}
// zoom to scale s2 keeping the page point under (cx, cy) (stage coordinates) where it is
function zoomAt(s2, cx, cy) { const k = s2 / Z.s; Z.tx = cx - (cx - Z.tx) * k; Z.ty = cy - (cy - Z.ty) * k; Z.s = s2; clampZ(); applyZoom(); }
function zanim() { const i = $('#pg'); i.classList.add('zanim'); clearTimeout(zanim.t); zanim.t = setTimeout(() => i.classList.remove('zanim'), 340); }
function resetZoom() { Z.s = 1; Z.tx = 0; Z.ty = 0; applyZoom(); }

/* ───────────── rendering ───────────── */
let imgUrl = null, pageToken = 0; const urlCache = new Map();
function rememberUrl(key, blob) {
  if (urlCache.has(key)) return urlCache.get(key);
  const u = URL.createObjectURL(blob); urlCache.set(key, u);
  while (urlCache.size > 6) { const k = urlCache.keys().next().value; URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); }
  return u;
}
async function pageUrl(song, i) {
  const key = song.id + ':' + i; if (urlCache.has(key)) return urlCache.get(key);
  const b = await DB.page(song.id, i); return b ? rememberUrl(key, b) : null;
}
async function showPage() {
  const song = curSong(), tok = ++pageToken;
  const empty = $('#empty'), img = $('#pg');
  if (!S.songs.size) {
    img.removeAttribute('src'); $('#dots').innerHTML = ''; $('#nextSong').hidden = true;
    empty.className = 'empty show';
    empty.innerHTML = `<h2>ยังไม่มีโน้ต</h2><p>นำเข้าไฟล์โน้ตจากแอปไฟล์ (ZIP หรือรูป) แล้วเพลงจะอยู่ในเครื่องนี้ ใช้ได้โดยไม่ต้องมีอินเทอร์เน็ต</p><button class="btn" data-act="import">นำเข้าโน้ต</button>`; return;
  }
  if (!song) {
    img.removeAttribute('src'); $('#dots').innerHTML = ''; $('#nextSong').hidden = true;
    empty.className = 'empty show';
    empty.innerHTML = `<h2>เลือกเพลงที่จะเล่น</h2><p>กด ＋ ด้านล่างเพื่อค้นหาเพลงแล้วเพิ่มเข้าคิว มีเพลงในเครื่อง ${S.songs.size} เพลง</p><button class="btn" data-act="add">＋ ค้นหาเพลง</button>`; return;
  }
  empty.className = 'empty';
  S.page = Math.min(Math.max(0, S.page), song.n - 1);
  const [url, box] = await Promise.all([pageUrl(song, S.page), CROP.on ? inkBox(song.id, S.page) : null]); if (tok !== pageToken) return;
  CROP.box = box;
  if (url) img.src = url; else img.removeAttribute('src');
  applyZoom();
  $('#tPage').hidden = false; $('#tPage').textContent = `หน้า ${S.page + 1}/${song.n}`; $('#zoomBtn').hidden = false;
  $('#dots').innerHTML = song.n > 1 && song.n <= 12 ? Array.from({ length: song.n }, (_, i) => `<i class="${i === S.page ? 'on' : ''}"></i>`).join('') : '';
  const next = S.songs.get(S.queue[S.cur + 1]);
  const ns = $('#nextSong'); ns.hidden = !(next && S.page === song.n - 1); if (!ns.hidden) ns.textContent = `เพลงต่อไป: ${next.name} ▶`;
  saveState();
  if (S.page + 1 < song.n) { pageUrl(song, S.page + 1); if (CROP.on) inkBox(song.id, S.page + 1); } else if (next) { pageUrl(next, 0); if (CROP.on) inkBox(next.id, 0); }
}
function renderTop() {
  const song = curSong();
  $('#tSong').textContent = song ? song.name : 'โน้ตเนตร';
  $('#tSet').textContent = S.setName ? `ชุด: ${S.setName}` : (S.queue.length ? `คิว ${S.cur + 1}/${S.queue.length}` : `${S.songs.size} เพลงในเครื่อง`);
  if (!song) { $('#tPage').hidden = true; $('#zoomBtn').hidden = true; }
}
function renderStrip() {
  $('#qn').textContent = S.queue.length;
  $('#qwrap').innerHTML = S.queue.map((id, i) => `<div class="qc ${i === S.cur ? 'cur' : ''}" data-id="${id}" data-i="${i}"><i>${i + 1}</i>${i === S.cur ? '▶' : ''}<span>${esc(S.songs.get(id)?.name)}</span></div>`).join('')
    || '<div class="qc" style="opacity:.55">ยังไม่มีเพลงในคิว กด ＋</div>';
}
function scrollToCur() { const el = $('#qwrap .qc.cur'); el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }
function renderAll() { renderTop(); renderStrip(); showPage(); if (S.searching) renderResults(); }

/* ───────────── search panel ───────────── */
function openSearch() {
  S.searching = true; S.q = ''; S.letter = ''; S.shown = 120; $('#app').classList.remove('reading');
  $('#app').classList.add('searching');
  $('#panel').innerHTML = `<div class="phead"><div class="sbox"><span aria-hidden="true">⌕</span><input id="qi" type="text" placeholder="พิมพ์ชื่อเพลง…" autocomplete="off" autocapitalize="off" enterkeyhint="search"><button class="clr" data-act="qclear" aria-label="ล้าง">✕</button></div><button class="ib" data-act="lettermode" id="lm">ก–ฮ</button><button class="ib" data-act="closesearch">ปิด</button></div><div class="letters hidden" id="letters"></div><div class="phint">แตะ = เพิ่มแล้วปิด · กดค้าง = เพิ่มต่อ</div><div class="res" id="res"></div>`;
  renderResults(); setLetterMode(false); $('#qi').focus();
}
function closeSearch() { S.searching = false; $('#app').classList.remove('searching'); setTimeout(() => { if (!S.searching) $('#panel').innerHTML = ''; }, 420); document.activeElement?.blur?.(); showPage(); chromeArm(); }
function setLetterMode(on) {
  S.letterMode = on; $('#letters').classList.toggle('hidden', !on); $('#lm').textContent = on ? '⌨' : 'ก–ฮ';
  if (on) { S.q = ''; $('#qi').value = ''; S.letter = ''; document.activeElement?.blur?.(); renderLetters(); renderResults(); } else { S.letter = ''; renderResults(); $('#qi').focus(); }
}
function renderLetters() {
  const set = new Map(); for (const s of S.songs.values()) { const l = firstLetter(s.name); set.set(l, (set.get(l) || 0) + 1); }
  const ls = [...set.keys()].sort((a, b) => collator.compare(a, b));
  $('#letters').innerHTML = ls.map(l => `<button class="${S.letter === l ? 'on' : ''}" data-act="letter" data-l="${esc(l)}">${esc(l)}</button>`).join('');
}
function results() {
  const terms = nfc(S.q).toLowerCase().split(/\s+/).filter(Boolean);
  let list = [...S.songs.values()];
  if (S.letter) list = list.filter(s => firstLetter(s.name) === S.letter);
  if (terms.length) list = list.filter(s => { const n = nfc(s.name).toLowerCase(); return terms.every(t => n.includes(t)); });
  const rank = s => { const n = sortKey(s.name).toLowerCase(); return terms.length && terms.every(t => n.startsWith(t)) ? 0 : 1; };
  list.sort((a, b) => rank(a) - rank(b) || collator.compare(sortKey(a.name), sortKey(b.name)));
  return { list, terms };
}
function hl(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}
function renderResults() {
  const res = $('#res'); if (!res) return;
  const { list, terms } = results();
  const slice = list.slice(0, S.shown);
  res.innerHTML = (slice.length ? slice.map(s => {
    const pos = S.queue.indexOf(s.id) + 1;
    return `<div class="rs" data-id="${s.id}"><div class="rn">${hl(s.name, terms)}<small>${s.n} หน้า${pos ? ` · <span class="inq">อยู่ในคิวลำดับ ${pos}</span>` : ''}</small></div><div class="th"><img alt=""></div><div class="rb"><button data-act="addnext">ถัดไป</button><button class="p" data-act="addend">ท้ายคิว</button></div></div>`;
  }).join('') : `<div class="note">${S.songs.size ? 'ไม่พบเพลงที่ค้นหา ลองพิมพ์ให้สั้นลง' : 'ยังไม่มีเพลง กดปิดแล้วเลือก ☰ → นำเข้าโน้ต'}</div>`)
    + (list.length > S.shown ? `<button class="btn o sm more" data-act="more">แสดงเพิ่ม (อีก ${list.length - S.shown} เพลง)</button>` : '')
    + (list.length ? `<div class="note">${list.length} เพลง</div>` : '');
  watchThumbs();
}

/* Result thumbnails: tiny JPEGs saved once in IndexedDB, made one at a time (never decode several big pages at once). */
const thumbCache = new Map(); let thumbIO = null, thumbQ = [], thumbBusy = false;
async function decodeSmall(b) {
  try { return await createImageBitmap(b, { imageOrientation: 'from-image', resizeWidth: 200, resizeQuality: 'low' }); }
  catch { return await createImageBitmap(b); }
}
async function makeThumb(id) {
  if (thumbCache.has(id)) return thumbCache.get(id);
  let blob = null; try { blob = await TH.get(id); } catch { /* no store yet */ }
  if (!blob) {
    const b = await DB.page(id, 0); if (!b) return null;
    const bmp = await decodeSmall(b);
    const w = 200, h = Math.max(1, Math.round(bmp.height * w / bmp.width)), c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6)); c.width = c.height = 0;
    if (blob) TH.put(id, blob).catch(() => {});
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  thumbCache.set(id, u); if (thumbCache.size > 500) { const k = thumbCache.keys().next().value; URL.revokeObjectURL(thumbCache.get(k)); thumbCache.delete(k); }
  return u;
}
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQ.length) {
    const row = thumbQ.shift(); if (!row.isConnected || !row._vis) continue;
    try { const u = await makeThumb(row.dataset.id); const im = row.querySelector('.th img'); if (u && im && row.isConnected) { im.src = u; im.classList.add('on'); } } catch { /* skip this one */ }
    await new Promise(r => setTimeout(r, 16));
  }
  thumbBusy = false;
}
function watchThumbs() {
  const res = $('#res'); if (!res) return; thumbIO?.disconnect(); thumbQ = [];
  thumbIO = new IntersectionObserver(es => { es.forEach(e => { const row = e.target; row._vis = e.isIntersecting; if (e.isIntersecting) thumbQ.push(row); }); pumpThumbs(); }, { root: res, rootMargin: '120px' });
  res.querySelectorAll('.rs').forEach(r => { const u = thumbCache.get(r.dataset.id), im = r.querySelector('.th img'); if (u && im) { im.src = u; im.classList.add('on'); } else thumbIO.observe(r); });
}
/* ───────────── drag to reorder (strip: press & hold, list: grab handle) ───────────── */
function sortable(root, o) {
  let st = null;
  const items = () => [...root.querySelectorAll(o.itemSel)];
  root.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const item = e.target.closest(o.itemSel); if (!item || !root.contains(item)) return;
    if (o.handleSel && !e.target.closest(o.handleSel)) return;
    st = { item, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, removing: false, timer: null };
    const begin = () => {
      if (!st) return; st.active = true;
      try { root.setPointerCapture(st.id); } catch { /* not capturable */ }
      const r = item.getBoundingClientRect(); st.r = r; st.ox = st.x0 - r.left; st.oy = st.y0 - r.top;
      const c = item.cloneNode(true); c.classList.add('dragclone'); c.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      document.body.append(c); st.clone = c; item.classList.add('slot');
      o.onstart?.();
      if (o.axis === 'x') st.scroller = setInterval(() => { const b = root.getBoundingClientRect(); if (st.lastX < b.left + 40) root.scrollLeft -= 14; else if (st.lastX > b.right - 40) root.scrollLeft += 14; }, 16);
    };
    st.begin = begin;
    if (!o.hold) begin(); else st.timer = setTimeout(begin, o.hold);
  });
  root.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.active) { if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 10) { clearTimeout(st.timer); st = null; } return; }
    st.lastX = e.clientX; st.lastY = e.clientY;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (o.axis === 'x') { st.clone.style.left = e.clientX - st.ox + 'px'; st.clone.style.top = st.r.top + Math.max(-90, Math.min(20, dy)) + 'px'; st.removing = !!o.onRemove && dy < -55; }
    else { st.clone.style.top = e.clientY - st.oy + 'px'; st.clone.style.left = st.r.left + 'px'; }
    st.clone.classList.toggle('rm', st.removing);
    const sibs = items().filter(x => x !== st.item); const p = o.axis === 'x' ? e.clientX : e.clientY;
    let target = null;
    for (const s of sibs) { const b = s.getBoundingClientRect(); const mid = o.axis === 'x' ? b.left + b.width / 2 : b.top + b.height / 2; if (p < mid) { target = s; break; } }
    if (!st.removing) { if (target) { if (st.item.nextElementSibling !== target) target.before(st.item); } else { const last = sibs[sibs.length - 1]; if (last && st.item.previousElementSibling !== last) last.after(st.item); } }
  });
  const end = () => {
    if (!st) return; clearTimeout(st.timer);
    if (st.active) {
      clearInterval(st.scroller); st.clone.remove(); st.item.classList.remove('slot'); o.onend?.();
      root._dragged = Date.now();
      if (st.removing) o.onRemove(st.item.dataset.id); else o.onDrop(items().map(x => x.dataset.id));
    }
    st = null;
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', () => { /* the DOM move can release capture; end handles cleanup */ });
  root.addEventListener('touchmove', e => { if (st?.active) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', e => { if (st?.active || o.hold) e.preventDefault(); });
}
const justDragged = el => Date.now() - (el._dragged || 0) < 400;

/* ───────────── zip reading (central directory, one entry at a time) ───────────── */
function decodeName(bytes) {
  try { return nfc(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { try { return nfc(new TextDecoder('windows-1252').decode(bytes)); } catch { return nfc(String.fromCharCode(...bytes)); } }
}
async function readZipIndex(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('อ่านไฟล์ ZIP ไม่ได้ (ไฟล์อาจไม่สมบูรณ์)');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error('ไฟล์ ZIP ใหญ่เกินไป (ZIP64) ลองแบ่งเป็นหลายก้อน');
  const buf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer(); const cd = new DataView(buf), u8 = new Uint8Array(buf);
  const out = []; let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
    out.push({ path: decodeName(u8.subarray(p + 46, p + 46 + nl)), method, csize, usize, off });
    p += 46 + nl + el + cl;
  }
  return out;
}
async function readEntry(file, e) {
  const h = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('ไฟล์ ZIP เสียหาย');
  const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = new Uint8Array(await file.slice(start, start + e.csize).arrayBuffer());
  if (e.method === 0) return data;
  if (e.method === 8) return fflate.inflateSync(data);
  throw new Error('ZIP นี้ใช้วิธีบีบอัดที่ยังไม่รองรับ');
}

/* ───────────── import ───────────── */
const QUALITY = { normal: [2200, 0.8, 'ปกติ (ซูมได้ชัดพอ)'], save: [1600, 0.72, 'ประหยัดที่'], sharp: [3000, 0.85, 'คมชัดมาก (ใช้ที่มาก)'] };
async function shrink(bytes, ext, [max, q]) {
  const type = /png$/i.test(ext) ? 'image/png' : /webp$/i.test(ext) ? 'image/webp' : /hei[cf]$/i.test(ext) ? 'image/heic' : /gif$/i.test(ext) ? 'image/gif' : 'image/jpeg';
  const blob = new Blob([bytes], { type });
  let bmp; try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('อ่านรูปไม่ได้')); i.src = URL.createObjectURL(blob); }); }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); c.width = c.height = 0;
  if (!out) throw new Error('บันทึกรูปไม่ได้');
  return out;
}
const PAGED = /^(img|dsc|image|photo|page|scan|screenshot|หน้า|แผ่น)?[\s_\-.()]*\d+/i;
// folders hold the pages of one song; loose files (or files in a folder that also holds other folders) are one song each
function planSongs(entries) {
  const dirs = new Map();
  for (const e of entries) { const parts = e.path.split('/'); const dir = parts.slice(0, -1).join('/'); (dirs.get(dir) || dirs.set(dir, []).get(dir)).push(e); }
  const dirNames = [...dirs.keys()];
  const rows = [];
  for (const [dir, files] of dirs) {
    files.sort((a, b) => collator.compare(baseName(a.path), baseName(b.path)));
    const wrapper = dirNames.some(d => d !== dir && d.startsWith(dir ? dir + '/' : '') && d !== '');
    const folderName = dir ? baseName(dir) : '';
    const asPages = !!dir && !wrapper && (files.length === 1 || files.every(f => PAGED.test(noExt(baseName(f.path)))));
    if (asPages) rows.push({ name: folderName, files, from: dir, canSplit: files.length > 1 });
    else for (const f of files) rows.push({ name: noExt(baseName(f.path)), files: [f], from: dir, split: files.length > 1 && !!dir && !wrapper });
  }
  return rows;
}
function openImport() {
  const s = sheet(`<h3>นำเข้าโน้ต</h3>
    <div class="help"><b>วิธีเตรียมไฟล์ (แนะนำ)</b><ol><li>ในแอปไฟล์ เลือกโฟลเดอร์เพลง (ครั้งละ 50–100 โฟลเดอร์) แล้วกดค้าง → <b>บีบอัด</b></li><li>กดปุ่มด้านล่าง เลือกไฟล์ ZIP ที่ได้ (ตั้งชื่อก้อนไว้ให้ค้นง่าย)</li><li>โฟลเดอร์ = หนึ่งเพลงหลายหน้า รูปเดี่ยว = หนึ่งเพลง ตรวจชื่อก่อนบันทึกได้</li></ol></div>
    <div class="row2"><button class="btn" id="pick">เลือกไฟล์ ZIP หรือรูป</button></div><div id="impBody"></div>`, {});
  S.importSheet = s;
  $('#pick', s.el).onclick = () => { const f = $('#fileIn'); f.value = ''; f.onchange = () => f.files.length && scanFiles([...f.files], s); f.click(); };
}
async function scanFiles(files, s) {
  const body = $('#impBody', s.el); body.innerHTML = '<p class="sub"><span class="spin"></span> กำลังอ่านรายการ…</p>';
  const entries = [], skipped = [], zips = []; let setsJson = null;
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type.includes('zip')) {
        const idx = await readZipIndex(f); zips.push(f);
        for (const e of idx) {
          const parts = e.path.split('/'); const last = parts[parts.length - 1];
          if (!last || e.path.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.path) || last.startsWith('.')) continue;
          if (last === '_ชุดเล่น.json') { setsJson = { f, e }; continue; }
          if (IMG_EXT.test(last)) entries.push({ path: e.path, file: f, entry: e }); else skipped.push(e.path);
        }
      } else if (IMG_EXT.test(f.name) || f.type.startsWith('image/')) entries.push({ path: nfc(f.name), file: f, entry: null });
      else skipped.push(f.name);
    }
    // a single wrapper folder around everything is not a song
    const roots = new Set(entries.map(e => e.path.split('/')[0])); const allNested = entries.length && entries.every(e => e.path.includes('/'));
    if (allNested && roots.size === 1) { const r = [...roots][0]; if (entries.some(e => e.path.split('/').length > 2)) entries.forEach(e => { e.path = e.path.slice(r.length + 1); }); }
  } catch (err) { body.innerHTML = `<p class="sub" style="color:var(--bad)">${esc(err.message || err)}</p>`; return; }
  if (!entries.length) { body.innerHTML = `<p class="sub" style="color:var(--bad)">ไม่พบรูปโน้ตในไฟล์ที่เลือก${skipped.length ? ` (มี ${skipped.length} ไฟล์ที่ไม่ใช่รูป เช่น ${esc(skipped.slice(0, 2).map(baseName).join(', '))})` : ''}</p>`; return; }
  const rows = planSongs(entries);
  const existing = new Set([...S.songs.values()].map(x => nfc(x.name).toLowerCase()));
  const seen = new Map();
  rows.forEach(r => { const k = nfc(r.name).toLowerCase(); r.dup = existing.has(k); r.checked = !r.dup; const c = seen.get(k) || 0; seen.set(k, c + 1); if (c) { r.name += ` (${c + 1})`; } });
  renderReview(s, { rows, skipped, quality: 'normal', setsJson });
}
function renderReview(s, st) {
  const body = $('#impBody', s.el); const { rows, skipped } = st;
  const pages = () => rows.filter(r => r.checked).reduce((a, r) => a + r.files.length, 0);
  body.innerHTML = `<p class="sub">เจอ ${rows.length} เพลง · ${rows.reduce((a, r) => a + r.files.length, 0)} หน้า${skipped.length ? ` · <span style="color:var(--warn)">ข้าม ${skipped.length} ไฟล์ที่ไม่ใช่รูป (เช่น ${esc(skipped.slice(0, 2).map(baseName).join(', '))})</span>` : ''}</p>
    <div class="opts" id="qopts">${Object.entries(QUALITY).map(([k, v]) => `<button data-q="${k}" class="${st.quality === k ? 'on' : ''}">${v[2]}</button>`).join('')}</div>
    <div class="row2" style="margin:0 0 8px"><button class="btn o sm" id="selAll">เลือกทั้งหมด</button><button class="btn o sm" id="selNone">ไม่เลือกเลย</button></div>
    <div class="imp" id="irows">${rows.slice(0, 600).map((r, i) => `<div class="ir ${r.dup ? 'dup' : ''}" data-i="${i}"><input type="checkbox" ${r.checked ? 'checked' : ''}><input class="nm" value="${esc(r.name)}"><span class="n">${r.files.length} หน้า${r.dup ? ' <span class="dupl">มีแล้ว</span>' : ''}</span>${r.canSplit ? '<button class="tg" data-a="split">แยกทีละรูป</button>' : ''}${r.split ? '<button class="tg" data-a="merge">รวมเป็นเพลงเดียว</button>' : ''}</div>`).join('')}${rows.length > 600 ? `<p class="note">แสดง 600 รายการแรก (ที่เหลือจะนำเข้าตามที่ติ๊กไว้ ถ้าเยอะมาก ให้แบ่ง ZIP เป็นก้อนเล็กลง)</p>` : ''}</div>
    <div class="bar hidden" id="pbar"><i></i></div><p class="sub hidden" id="ptxt"></p>
    <div class="row2"><button class="btn o" id="cancelImp">ยกเลิก</button><button class="btn" id="goImp"></button></div>`;
  const label = () => { const n = rows.filter(r => r.checked).length; $('#goImp', s.el).textContent = n ? `นำเข้า ${n} เพลง (${pages()} หน้า)` : 'เลือกอย่างน้อย 1 เพลง'; $('#goImp', s.el).disabled = !n; };
  label();
  $('#irows', s.el).addEventListener('input', e => { const row = e.target.closest('.ir'); if (!row) return; const r = rows[row.dataset.i]; if (e.target.type === 'checkbox') r.checked = e.target.checked; else if (e.target.classList.contains('nm')) r.name = e.target.value; label(); });
  $('#irows', s.el).addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const row = e.target.closest('.ir'); const r = rows[row.dataset.i];
    if (b.dataset.a === 'split') { const parts = r.files.map(f => ({ name: noExt(baseName(f.path)), files: [f], from: r.from, split: true, checked: r.checked, dup: false })); rows.splice(+row.dataset.i, 1, ...parts); }
    else { const idx = rows.map((x, i) => (x.from === r.from && x.split ? i : -1)).filter(i => i >= 0); const files = idx.map(i => rows[i].files[0]); const merged = { name: baseName(r.from) || r.name, files, from: r.from, canSplit: true, checked: true, dup: false }; rows.splice(idx[0], idx.length, merged); }
    renderReview(s, st);
  });
  $('#qopts', s.el).onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; st.quality = b.dataset.q; $('#qopts', s.el).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#selAll', s.el).onclick = () => { rows.forEach(r => { r.checked = true; }); renderReview(s, st); };
  $('#selNone', s.el).onclick = () => { rows.forEach(r => { r.checked = false; }); renderReview(s, st); };
  $('#cancelImp', s.el).onclick = () => { st.cancel = true; s.close(); };
  $('#goImp', s.el).onclick = () => runImport(s, st);
}
async function runImport(s, st) {
  const rows = st.rows.filter(r => r.checked), total = rows.reduce((a, r) => a + r.files.length, 0), q = QUALITY[st.quality];
  const bar = $('#pbar', s.el), txt = $('#ptxt', s.el);
  bar.classList.remove('hidden'); txt.classList.remove('hidden'); $('#goImp', s.el).disabled = true; $('#irows', s.el).style.pointerEvents = 'none'; $('#cancelImp', s.el).textContent = 'หยุด';
  s.scrim.onpointerdown = null;
  let done = 0, songs = 0, failed = []; const t0 = Date.now(); st.cancel = false;
  const zipIndex = new Map();
  for (const r of rows) {
    if (st.cancel) break;
    try {
      const blobs = [];
      for (const f of r.files) {
        if (st.cancel) throw new Error('หยุดแล้ว');
        const bytes = f.entry ? await readEntry(f.file, f.entry) : new Uint8Array(await f.file.arrayBuffer());
        blobs.push(await shrink(bytes, f.path, q)); done++;
        bar.firstElementChild.style.width = (done / total * 100) + '%';
        const eta = done > 3 ? Math.round(((Date.now() - t0) / done) * (total - done) / 1000) : null;
        txt.textContent = `กำลังนำเข้า ${done}/${total} หน้า · ${songs} เพลงเสร็จ${eta != null ? ` · เหลือราว ${eta >= 60 ? Math.round(eta / 60) + ' นาที' : eta + ' วินาที'}` : ''} (เปิดหน้านี้ค้างไว้)`;
      }
      const name = (r.name || '').trim() || 'ไม่มีชื่อ'; const song = { id: uid(), name: nfc(name), n: blobs.length, created: Date.now(), bytes: blobs.reduce((a, b) => a + b.size, 0) };
      await DB.putSong(song, blobs); S.songs.set(song.id, song); songs++;
    } catch (err) { if (st.cancel) break; failed.push(`${r.name}: ${err.message || err}`); }
  }
  // play sets that came with a backup
  if (st.setsJson && !st.cancel) {
    try {
      const data = JSON.parse(new TextDecoder().decode(await readEntry(st.setsJson.f, st.setsJson.e)));
      const byName = new Map([...S.songs.values()].map(x => [nfc(x.name).toLowerCase(), x.id]));
      for (const set of data) { if (S.sets.some(x => x.name === set.name)) continue; const ids = (set.songs || []).map(n => byName.get(nfc(n).toLowerCase())).filter(Boolean); const rec = { id: uid(), name: set.name, songs: ids }; await DB.putSet(rec); S.sets.push(rec); }
    } catch { /* sets are optional */ }
  }
  s.close(); renderAll(); if (S.searching) renderResults();
  toast(st.cancel ? `หยุดแล้ว นำเข้าได้ ${songs} เพลง` : failed.length ? `นำเข้า ${songs} เพลง · ผิดพลาด ${failed.length} (ดูในเมนู ข้อมูล)` : `นำเข้าสำเร็จ ${songs} เพลง`);
  if (failed.length) console.warn('import failed', failed);
  navigator.storage?.persist?.();
}

/* ───────────── menu, sets, song manager, backup ───────────── */
function openMenu() {
  const s = sheet(`<h3>เมนู</h3><div class="menu">
    <button data-m="import"><span class="ic">⤓</span><span>นำเข้าโน้ต<small>ZIP หรือรูปจากแอปไฟล์ / iCloud</small></span></button>
    <button data-m="sets"><span class="ic">♪</span><span>ชุดเล่น<small>บันทึกคิวไว้ใช้ซ้ำ เช่น ชุดคืนวันศุกร์</small></span></button>
    <button data-m="manage"><span class="ic">✎</span><span>จัดการเพลง<small>เปลี่ยนชื่อ ลบ (${S.songs.size} เพลง)</small></span></button>
    <button data-m="backup"><span class="ic">⤒</span><span>สำรองข้อมูล<small>ดาวน์โหลดเป็นไฟล์ ZIP เก็บไว้เผื่อเครื่องล้างข้อมูล</small></span></button>
    <button data-m="fs"><span class="ic">⛶</span><span>โหมดอ่านเต็มจอ<small>${FS.on ? 'เปิดอยู่ แถบบน/ล่างซ่อนเองเมื่อไม่แตะ แตะขอบบน/ล่างเพื่อเรียกกลับ' : 'ปิดอยู่'}</small></span></button>
    <button data-m="trim"><span class="ic">▣</span><span>ตัดขอบขาวอัตโนมัติ<small>${CROP.on ? 'เปิดอยู่ แสดงเฉพาะส่วนที่มีโน้ต โน้ตจะใหญ่ขึ้น' : 'ปิดอยู่'}</small></span></button>
    <button data-m="remote"><span class="ic">⌁</span><span>ทดสอบรีโมท<small>ดูว่าปุ่มเหยียบ/รีโมทส่งอะไรมา</small></span></button>
    <button data-m="info"><span class="ic">ⓘ</span><span>ข้อมูลและพื้นที่<small>เวอร์ชัน ${BUILD}</small></span></button>
  </div>`);
  s.el.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; s.close(); ({ import: openImport, sets: openSets, manage: openManage, backup: doBackup, fs: toggleFs, trim: toggleTrim, remote: openRemoteTest, info: openInfo })[b.dataset.m](); });
}

function openRemoteTest() {
  const s = sheet(`<h3>ทดสอบรีโมท / ตัวเหยียบ</h3><p class="sub">จับคู่อุปกรณ์ใน การตั้งค่า → Bluetooth แล้วกดปุ่มต่างๆ ด้านล่างจะแสดงสิ่งที่ส่งมา ถ้าเห็น “พลิกหน้าได้” แปลว่าใช้กับแอปนี้ได้</p><div id="rtLog" class="rtlog"><div class="note">ยังไม่มีสัญญาณ กดปุ่มบนอุปกรณ์ได้เลย</div></div><div class="imp"><button class="btn o" data-close>ปิด</button></div>`);
  const log = $('#rtLog', s.el); const rows = [];
  const add = (kind, text, ok) => { rows.unshift(`<div class="rtr ${ok ? 'ok' : ''}"><b>${kind}</b><span>${esc(text)}</span><em>${ok ? 'พลิกหน้าได้' : 'ยังไม่ใช้'}</em></div>`); rows.length = Math.min(rows.length, 12); log.innerHTML = rows.join(''); };
  const live = () => document.body.contains(s.el);
  const onKey = e => { if (!live()) return removeEventListener('keydown', onKey, true); e.preventDefault(); add('คีย์บอร์ด', `${e.key === ' ' ? 'Space' : e.key} (${e.code || '-'})`, NEXT_KEYS.has(e.key) || PREV_KEYS.has(e.key)); };
  const onWheel = e => { if (!live()) return removeEventListener('wheel', onWheel, true); add('ลูกกลิ้ง', `เลื่อน ${e.deltaY > 0 ? 'ลง' : 'ขึ้น'} (${Math.round(e.deltaY)})`, true); };
  let start = null;
  const onDown = e => { if (!live()) return removeEventListener('pointerdown', onDown, true); if (s.el.contains(e.target)) return; start = { x: e.clientX, y: e.clientY, t: e.pointerType }; };
  const onUp = e => { if (!live()) return removeEventListener('pointerup', onUp, true); if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; const sw = Math.hypot(dx, dy) > 40; add(start.t === 'mouse' ? 'เมาส์/ตัวชี้' : 'นิ้ว/สัมผัส', sw ? `ปัด ${Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ขวา' : 'ซ้าย') : (dy > 0 ? 'ลง' : 'ขึ้น')}` : 'แตะ', sw); start = null; };
  s.scrim.addEventListener('pointerdown', e => e.stopImmediatePropagation(), true); // taps outside must not close the tester
  addEventListener('keydown', onKey, true); addEventListener('wheel', onWheel, { capture: true, passive: true }); addEventListener('pointerdown', onDown, true); addEventListener('pointerup', onUp, true);
  s.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) s.close(); });
}
function openQueueSheet() {
  const s = sheet(`<h3>คิวเล่น <small style="color:var(--mut);font-weight:400">${S.queue.length} เพลง</small></h3><p class="sub">แตะเพลงเพื่อเล่น · จับ ⠿ แล้วลากเพื่อสลับลำดับ · ✕ เอาออก</p><div id="qlist"></div><div class="row2"><button class="btn o" data-q="save">บันทึกเป็นชุดเล่น</button><button class="btn bad" data-q="clear">ล้างคิว</button></div>`);
  const list = $('#qlist', s.el);
  const paint = () => { list.innerHTML = S.queue.map((id, i) => `<div class="lrow ${i === S.cur ? 'cur' : ''}" data-id="${id}"><span class="gr" aria-label="ลาก">⠿</span><span class="no">${i === S.cur ? '▶' : i + 1}</span><div class="nm" data-play="${i}">${esc(S.songs.get(id)?.name)}<small>${S.songs.get(id)?.n || 0} หน้า</small></div><button class="x" data-rm="${i}" aria-label="เอาออก">✕</button></div>`).join('') || '<div class="note">คิวว่าง กด ＋ เพื่อเพิ่มเพลง</div>'; };
  paint();
  sortable(list, { axis: 'y', itemSel: '.lrow', handleSel: '.gr', hold: 0, onDrop: ids => { setQueueOrder(ids); paint(); } });
  s.el.addEventListener('click', async e => {
    const pl = e.target.closest('[data-play]'); if (pl && !justDragged(list)) { s.close(); play(+pl.dataset.play); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { removeFromQueue(+rm.dataset.rm); paint(); return; }
    const b = e.target.closest('[data-q]'); if (!b) return;
    if (b.dataset.q === 'clear') { if (await confirmDel('ล้างคิวทั้งหมด?', 'โน้ตในเครื่องไม่ถูกลบ แค่เอาออกจากคิว', 'ล้างคิว')) { S.queue = []; S.cur = 0; S.page = 0; S.setName = ''; saveState(); renderAll(); s.close(); } }
    else { s.close(); saveCurrentSet(); }
  });
}
async function saveCurrentSet() {
  if (!S.queue.length) return toast('คิวว่างอยู่ ยังไม่มีอะไรให้บันทึก');
  const name = await askText({ title: 'ตั้งชื่อชุดเล่น', value: S.setName || '', ok: 'บันทึก', placeholder: 'เช่น ชุดคืนวันศุกร์' }); if (!name) return;
  const old = S.sets.find(x => x.name === name); const rec = { id: old?.id || uid(), name, songs: [...S.queue] };
  await DB.putSet(rec); if (old) Object.assign(old, rec); else S.sets.push(rec); S.setName = name; saveState(); renderTop(); toast(`บันทึกชุด “${name}” แล้ว (${rec.songs.length} เพลง)`);
}
function openSets() {
  const s = sheet(`<h3>ชุดเล่น</h3><button class="btn" style="width:100%;margin-bottom:10px" data-s="save">บันทึกคิวปัจจุบันเป็นชุดใหม่</button><div id="slist"></div>`);
  const paint = () => { $('#slist', s.el).innerHTML = S.sets.map(x => `<div class="lrow"><div class="nm" data-open="${x.id}">${esc(x.name)}<small>${x.songs.filter(i => S.songs.has(i)).length} เพลง · แตะเพื่อเปิดเป็นคิว</small></div><button class="x" data-del="${x.id}" aria-label="ลบ">🗑</button></div>`).join('') || '<div class="note">ยังไม่มีชุดเล่น</div>'; };
  paint();
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-s]')) { s.close(); saveCurrentSet(); return; }
    const o = e.target.closest('[data-open]'); if (o) { const x = S.sets.find(z => z.id === o.dataset.open); const prev = { q: [...S.queue], c: S.cur, p: S.page, n: S.setName }; S.queue = x.songs.filter(i => S.songs.has(i)); S.cur = 0; S.page = 0; S.setName = x.name; saveState(); renderAll(); s.close(); toast(`เปิดชุด “${x.name}” (${S.queue.length} เพลง)`, { label: 'เลิกทำ', fn: () => { S.queue = prev.q; S.cur = prev.c; S.page = prev.p; S.setName = prev.n; saveState(); renderAll(); } }); return; }
    const d = e.target.closest('[data-del]'); if (d) { const x = S.sets.find(z => z.id === d.dataset.del); if (await confirmDel(`ลบชุด “${x.name}”?`, 'โน้ตในเครื่องไม่ถูกลบ')) { await DB.delSet(x.id); S.sets = S.sets.filter(z => z !== x); paint(); } }
  });
}
function openManage() {
  const s = sheet(`<h3>จัดการเพลง</h3><input class="field" id="mq" placeholder="ค้นหาชื่อเพลง…" autocomplete="off"><div id="mlist" style="margin-top:10px"></div>`);
  let q = '', shown = 80;
  const paint = () => {
    const terms = nfc(q).toLowerCase().split(/\s+/).filter(Boolean);
    const list = [...S.songs.values()].filter(x => terms.every(t => nfc(x.name).toLowerCase().includes(t))).sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)));
    $('#mlist', s.el).innerHTML = list.slice(0, shown).map(x => `<div class="lrow"><div class="nm">${hl(x.name, terms)}<small>${x.n} หน้า · ${(x.bytes / 1048576).toFixed(1)} MB</small></div><button class="x" style="color:var(--ink)" data-ren="${x.id}" aria-label="เปลี่ยนชื่อ">✎</button><button class="x" data-del="${x.id}" aria-label="ลบ">🗑</button></div>`).join('') + (list.length > shown ? `<button class="btn o sm more" data-more="1" style="display:flex;margin:6px auto">แสดงเพิ่ม</button>` : '') || '<div class="note">ไม่พบเพลง</div>';
  };
  paint();
  $('#mq', s.el).addEventListener('input', e => { q = e.target.value; shown = 80; paint(); });
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-more]')) { shown += 120; paint(); return; }
    const r = e.target.closest('[data-ren]'); if (r) { const x = S.songs.get(r.dataset.ren); const n = await askText({ title: 'เปลี่ยนชื่อเพลง', value: x.name, ok: 'บันทึก' }); if (n) { x.name = nfc(n); await DB.putSongMeta(x); paint(); renderAll(); } return; }
    const d = e.target.closest('[data-del]'); if (d) { const x = S.songs.get(d.dataset.del); if (await confirmDel(`ลบ “${x.name}”?`, 'ลบรูปโน้ตเพลงนี้ออกจากเครื่อง (ไฟล์ต้นฉบับใน iCloud ไม่ถูกลบ)')) { await DB.delSong(x); S.songs.delete(x.id); S.queue = S.queue.filter(i => i !== x.id); S.cur = Math.min(S.cur, Math.max(0, S.queue.length - 1)); for (const set of S.sets) { const f = set.songs.filter(i => i !== x.id); if (f.length !== set.songs.length) { set.songs = f; DB.putSet(set); } } saveState(); paint(); renderAll(); } }
  });
}
async function doBackup() {
  if (!S.songs.size) return toast('ยังไม่มีเพลงให้สำรอง');
  const s = sheet(`<h3>กำลังสำรองข้อมูล</h3><p class="sub" id="bt">เตรียมไฟล์…</p><div class="bar"><i id="bb"></i></div>`);
  try {
    const chunks = []; const zip = new fflate.Zip((err, d) => { if (err) throw err; chunks.push(d); });
    const used = new Set(); let i = 0;
    for (const song of [...S.songs.values()].sort((a, b) => collator.compare(a.name, b.name))) {
      let folder = song.name.replace(/[\/\\:*?"<>|]/g, '‐'); while (used.has(folder.toLowerCase())) folder += '_'; used.add(folder.toLowerCase());
      for (let p = 0; p < song.n; p++) {
        const blob = await DB.page(song.id, p); const f = new fflate.ZipPassThrough(`${folder}/${String(p + 1).padStart(3, '0')}.jpg`); zip.add(f);
        f.push(new Uint8Array(await blob.arrayBuffer()), true);
      }
      i++; $('#bb', s.el).style.width = (i / S.songs.size * 100) + '%'; $('#bt', s.el).textContent = `รวมไฟล์ ${i}/${S.songs.size} เพลง`;
      if (i % 20 === 0) await sleep(0);
    }
    const sj = new fflate.ZipPassThrough('_ชุดเล่น.json'); zip.add(sj);
    sj.push(new TextEncoder().encode(JSON.stringify(S.sets.map(x => ({ name: x.name, songs: x.songs.map(id => S.songs.get(id)?.name).filter(Boolean) })))), true);
    zip.end();
    const blob = new Blob(chunks, { type: 'application/zip' }); const d = new Date();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `สำรองโน้ตเนตร-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
    document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 8000);
    s.close(); toast(`สร้างไฟล์สำรองแล้ว (${(blob.size / 1048576).toFixed(0)} MB) ดูในแอปไฟล์ → ดาวน์โหลด`);
  } catch (err) { s.close(); toast('สำรองไม่สำเร็จ: ' + (err.message || err)); }
}
async function openInfo() {
  let est = ''; try { const e = await navigator.storage.estimate(); est = `ใช้พื้นที่ ${(e.usage / 1048576).toFixed(0)} MB จาก ${(e.quota / 1048576).toFixed(0)} MB`; } catch { est = 'ตรวจพื้นที่ไม่ได้'; }
  let pers = false; try { pers = await navigator.storage.persisted(); } catch { /* unsupported */ }
  const pages = [...S.songs.values()].reduce((a, x) => a + x.n, 0);
  const s = sheet(`<h3>ข้อมูลและพื้นที่</h3><div class="help">เพลง ${S.songs.size} เพลง · ${pages} หน้า · ชุดเล่น ${S.sets.length} ชุด<br>${est}<br>ระบบ${pers ? '' : 'ยังไม่'}รับปากว่าจะไม่ล้างข้อมูลเอง${pers ? '' : ' (แนะนำสำรองไฟล์ไว้ และเปิดแอปจากไอคอนหน้าจอหลัก)'}<br><small>เวอร์ชัน ${BUILD}</small></div><div class="row2"><button class="btn bad" data-w="1">ลบทุกอย่างในแอปนี้</button></div>`);
  s.el.addEventListener('click', async e => { if (!e.target.closest('[data-w]')) return;
    if (!(await confirmDel('ลบเพลงทั้งหมด?', 'รูปโน้ต ชุดเล่น และคิวในเครื่องนี้จะหายหมด (ไฟล์ต้นฉบับใน iCloud ไม่ถูกลบ)', 'ลบทั้งหมด'))) return;
    if (!(await confirmDel('ยืนยันอีกครั้ง', `ลบ ${S.songs.size} เพลงออกจากเครื่องนี้ กู้คืนไม่ได้ถ้าไม่มีไฟล์สำรอง`, 'ใช่ ลบเลย'))) return;
    await DB.clear(); S.songs.clear(); S.sets = []; S.queue = []; S.cur = 0; S.page = 0; S.setName = ''; saveState(); s.close(); renderAll(); toast('ลบทั้งหมดแล้ว'); });
}

/* ───────────── events ───────────── */
/* tap = add and close the search; press & hold = add and keep searching (for building a list) */
function addFromRow(el, where, keepOpen) {
  const id = el.closest('.rs').dataset.id;
  addToQueue(id, where === 'next' && !S.queue.length ? 'first' : where);
  if (!keepOpen) closeSearch();
}
const LP = { t: 0, fired: false, x: 0, y: 0 };
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('#res .rs button[data-act]'); if (!b || !/^add/.test(b.dataset.act)) return;
  clearTimeout(LP.t); LP.fired = false; LP.x = e.clientX; LP.y = e.clientY;
  LP.t = setTimeout(() => { LP.fired = true; b.classList.add('lp'); setTimeout(() => b.classList.remove('lp'), 500); addFromRow(b, b.dataset.act === 'addnext' ? 'next' : 'end', true); }, 450);
});
document.addEventListener('pointermove', e => { if (LP.t && Math.hypot(e.clientX - LP.x, e.clientY - LP.y) > 10) clearTimeout(LP.t); });
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => clearTimeout(LP.t)));
const ACT = {
  menu: openMenu, import: openImport, queue: openQueueSheet,
  add: () => { if (!S.searching) openSearch(); else $('#qi')?.focus(); },
  closesearch: closeSearch,
  qclear: () => { S.q = ''; S.letter = ''; if ($('#qi')) $('#qi').value = ''; renderResults(); if (!S.letterMode) $('#qi')?.focus(); },
  lettermode: () => setLetterMode(!S.letterMode),
  letter: d => { S.letter = S.letter === d.l ? '' : d.l; S.shown = 120; renderLetters(); renderResults(); },
  more: () => { S.shown += 150; renderResults(); },
  addnext: (d, el) => addFromRow(el, 'next', false),
  addend: (d, el) => addFromRow(el, 'end', false),
  nextsong: () => play(S.cur + 1),
  zoom: () => { zanim(); const r = $('#stage').getBoundingClientRect(); if (Z.s > 1) resetZoom(); else zoomAt(2.2, r.width / 2, r.height / 3); },
};
document.addEventListener('click', e => {
  if (LP.fired && e.target.closest('#res .rs button[data-act]')) { LP.fired = false; e.preventDefault(); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a.dataset, a); return; }
  const qc = e.target.closest('#qwrap .qc[data-i]'); if (qc && !justDragged($('#qwrap'))) play(+qc.dataset.i);
});
document.addEventListener('input', e => { if (e.target.id === 'qi') { S.q = e.target.value; S.shown = 120; renderResults(); } });
/* reading mode: header and queue strip slide away after a few idle seconds so the score gets the whole screen */
const FS = { on: (() => { try { return localStorage.getItem('sheet:fs') !== '0'; } catch { return true; } })(), t: 0 };
function chromeArm() {
  clearTimeout(FS.t); if (!FS.on) return;
  FS.t = setTimeout(() => { if (!S.searching && !document.querySelector('#layer .scrim') && !document.querySelector('#strip.dragging') && curSong()) $('#app').classList.add('reading'); }, 1500);
}
function chromeShow() { $('#app').classList.remove('reading'); chromeArm(); }
function toggleTrim() { CROP.on = !CROP.on; try { localStorage.setItem('sheet:trim', CROP.on ? '1' : '0'); } catch { /* private mode */ } if (!CROP.on) CROP.box = null; showPage(); toast(CROP.on ? 'ตัดขอบขาว: เปิด' : 'ตัดขอบขาว: ปิด'); }
function toggleFs() { FS.on = !FS.on; try { localStorage.setItem('sheet:fs', FS.on ? '1' : '0'); } catch { /* private mode */ } if (FS.on) { chromeArm(); toast('โหมดอ่านเต็มจอ: เปิด'); } else { clearTimeout(FS.t); chromeShow(); toast('โหมดอ่านเต็มจอ: ปิด'); } }
document.addEventListener('pointerdown', e => { if (e.target.closest('#strip,.top,#layer,#panel')) chromeArm(); }, true);

/* remote controls: Bluetooth page-turner pedals / keyboards (keys), rings with a scroll wheel (wheel) */
const sheetOpen = () => !!document.querySelector('#layer .scrim');
const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']), PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
document.addEventListener('keydown', e => {
  if (e.target.id === 'qi' && e.key === 'Enter') { e.target.blur(); return; }
  if (e.altKey || e.ctrlKey || e.metaKey || sheetOpen() || typing(e.target)) return;
  const next = NEXT_KEYS.has(e.key), prev = PREV_KEYS.has(e.key); if (!next && !prev) return;
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button,[data-act]')) return; // let focused buttons work normally
  e.preventDefault(); turn(next ? 1 : -1, true);
});
let wheelAt = 0;
document.addEventListener('wheel', e => {
  if (e.ctrlKey || sheetOpen() || typing(e.target) || e.target.closest?.('#res,.sheet,#qwrap')) return;
  if (!curSong() || !e.deltaY) return; e.preventDefault();
  if (Z.s > 1) { Z.ty -= e.deltaY; clampZ(); applyZoom(); return; }
  const now = Date.now(); if (now - wheelAt < 280) return; wheelAt = now; turn(e.deltaY > 0 ? 1 : -1, true);
}, { passive: false });

function turn(d, cross) {
  const song = curSong(); if (!song || S.searching && document.activeElement?.id === 'qi') return;
  const np = S.page + d;
  if (np >= song.n) { if (cross && S.cur + 1 < S.queue.length) { play(S.cur + 1); toast('▶ ' + (curSong()?.name || '')); } else if (cross) toast('จบคิวแล้ว'); return; }
  if (np < 0) { if (cross && S.cur > 0) { play(S.cur - 1); const prev = curSong(); if (prev) { S.page = prev.n - 1; showPage(); toast('▶ ' + prev.name); } } return; }
  S.page = np; if (Z.s > 1) zanim(); resetZoom(); showPage(); // a new page always starts fully zoomed out
}
// edge tap = turn the page; a second quick tap on the same edge jumps to the next / previous song instead
let lastEdge = null;
function edgeTap(side) {
  const now = Date.now();
  if (lastEdge && lastEdge.side === side && now - lastEdge.t < 330) {
    const back = lastEdge; lastEdge = null;
    const to = S.cur + side;
    if (to < 0 || to >= S.queue.length) { S.page = back.page; Z.s = 1; Z.tx = Z.ty = 0; showPage(); toast(side > 0 ? 'จบคิวแล้ว' : 'เป็นเพลงแรกแล้ว'); return; }
    play(to); toast('▶ ' + (curSong()?.name || '')); return;
  }
  lastEdge = { side, t: now, page: S.page };
  turn(side);
}
// gestures on the score: swipe / edge tap = turn page; pinch = zoom; drag when zoomed = pan; double tap in the middle = zoom
(() => {
  const stage = $('#stage'), ptrs = new Map(); let g = null, lastTap = null;
  const rel = () => stage.getBoundingClientRect();
  const mid = () => { const [a, b] = [...ptrs.values()]; const r = rel(); return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const m = mid(); g = { mode: 'pinch', d: m.d, mx: m.x, my: m.y }; }
    else if (ptrs.size === 1) g = { mode: 'one', x0: e.clientX, y0: e.clientY, tx0: Z.tx, ty0: Z.ty, t: Date.now(), moved: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === 'pinch' && ptrs.size >= 2) {
      const m = mid(); zoomAt(Math.min(5, Math.max(1, Z.s * m.d / g.d)), m.x, m.y);
      Z.tx += m.x - g.mx; Z.ty += m.y - g.my; clampZ(); applyZoom(); g.d = m.d; g.mx = m.x; g.my = m.y; g.moved = true;
    } else if (g.mode === 'one') {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (Z.s > 1 && g.moved) { Z.tx = g.tx0 + dx; Z.ty = g.ty0 + dy; clampZ(); applyZoom(); }
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return; const pt = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.mode === 'pinch') { if (ptrs.size < 2) { const [rest] = [...ptrs.values()]; g = rest ? { mode: 'one', x0: rest.x, y0: rest.y, tx0: Z.tx, ty0: Z.ty, t: Date.now(), moved: true, ignore: true } : null; } return; }
    if (g.ignore) { g = null; return; } // the finger left over after a pinch is not a tap
    const dx = pt.x - g.x0, dy = pt.y - g.y0, moved = Math.hypot(dx, dy), r = rel(), x = (pt.x - r.left) / r.width, cx = pt.x - r.left, cy = pt.y - r.top, quick = Date.now() - g.t < 600; g = null;
    if (Z.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { turn(dx < 0 ? 1 : -1); return; }
    if (moved >= 12 || !quick) return;
    if ($('#app').classList.contains('reading') && !e.target.closest?.('button') && (cy < r.height * 0.1 || cy > r.height * 0.9)) { chromeShow(); return; } // tap the top/bottom edge to bring the bars back
    if (x > 0.68) { edgeTap(1); lastTap = null; } else if (x < 0.32) { edgeTap(-1); lastTap = null; }
    else { // middle: double tap zooms in / back out
      if (lastTap && Date.now() - lastTap.t < 330 && Math.hypot(cx - lastTap.x, cy - lastTap.y) < 40) { lastTap = null; zanim(); if (Z.s > 1) resetZoom(); else zoomAt(2.2, cx, cy); }
      else lastTap = { t: Date.now(), x: cx, y: cy };
    }
  };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (!ptrs.size) g = null; });
  window.addEventListener('resize', () => { clampZ(); applyZoom(); });
  new ResizeObserver(() => { clampZ(); applyZoom(); }).observe(stage);
})();
// stop the browser from zooming the whole page when pinching on the iPad
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => e.preventDefault());
sortable($('#qwrap'), { axis: 'x', itemSel: '.qc[data-id]', hold: 450, onstart: () => $('#strip').classList.add('dragging'), onend: () => $('#strip').classList.remove('dragging'),
  onDrop: ids => setQueueOrder(ids), onRemove: id => removeFromQueue(S.queue.indexOf(id)) });
$('#strip').insertAdjacentHTML('afterbegin', '<div class="rmzone">ลากขึ้นมาตรงนี้แล้วปล่อย = เอาออกจากคิว ↑</div>');

// keep the whole app inside the visible area when the on-screen keyboard is open
(() => {
  const vv = window.visualViewport, app = $('#app'); if (!vv) return;
  const fit = () => { app.style.height = vv.height + 'px'; app.style.transform = `translateY(${vv.offsetTop}px)`; window.scrollTo(0, 0); };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
})();
// keep the screen awake while playing
let wake = null;
async function keepAwake() { try { if (navigator.wakeLock && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ } }
document.addEventListener('visibilitychange', keepAwake); document.addEventListener('pointerdown', keepAwake, { once: true });

/* ───────────── boot ───────────── */
(async function boot() {
  try {
    await DB.open();
    (await DB.allSongs()).forEach(s => S.songs.set(s.id, s)); S.sets = await DB.allSets();
  } catch {
    $('#empty').className = 'empty show'; $('#empty').innerHTML = '<h2>เปิดที่เก็บข้อมูลไม่ได้</h2><p>เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล (อาจเป็นโหมดส่วนตัว) ลองเปิดด้วยเบราว์เซอร์ปกติ</p>'; return;
  }
  loadState(); renderAll(); chromeArm();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__sheet = { S, DB, CROP, inkBox };
})();
})();
