(() => {
'use strict';

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const nfc = s => String(s).normalize('NFC');
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const BUILD = 'sheet-2026-11-27-c';
/* quiet activity log: the last events are kept so we can see what happened before a freeze */
const LOG = { a: [], prev: [], prevClean: true };
try { LOG.prev = JSON.parse(localStorage.getItem('sheet:log') || '[]'); LOG.prevClean = localStorage.getItem('sheet:clean') !== '0'; localStorage.setItem('sheet:clean', '0'); } catch { /* storage blocked */ }
function logEv(t) { LOG.a.push(new Date().toTimeString().slice(0, 8) + ' ' + t); if (LOG.a.length > 50) LOG.a.shift(); try { localStorage.setItem('sheet:log', JSON.stringify(LOG.a)); } catch { /* storage blocked */ } }
logEv('เปิดแอป ' + BUILD);
window.addEventListener('error', e => logEv('ผิดพลาด: ' + String(e.message || '').slice(0, 80)));
window.addEventListener('unhandledrejection', e => logEv('ผิดพลาด(promise): ' + String((e.reason && e.reason.message) || e.reason || '').slice(0, 80)));
document.addEventListener('visibilitychange', () => { const h = document.visibilityState === 'hidden'; try { localStorage.setItem('sheet:clean', h ? '1' : '0'); } catch { /* ok */ } logEv(h ? 'ออกจากแอป/พักจอ' : 'กลับมาที่แอป'); });
window.addEventListener('pagehide', () => { try { localStorage.setItem('sheet:clean', '1'); } catch { /* ok */ } });
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
  async prefix(p) { const d = await this.open(); return new Promise((res, rej) => { const out = [], t = d.transaction('t', 'readonly'), q = t.objectStore('t').openCursor(IDBKeyRange.bound(p, p + '\uffff')); q.onsuccess = () => { const c = q.result; if (c) { out.push([c.key, c.value]); c.continue(); } }; t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error); }); },
};
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('sheet-music', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('songs', { keyPath: 'id' }); d.createObjectStore('pages'); d.createObjectStore('sets', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; this.db.onclose = this.db.onversionchange = () => { this.db = null; }; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(stores, mode, fn) { // iOS may close the database while the app rests: reopen it and try once more
    const once = () => new Promise((res, rej) => {
      let t, out;
      try { t = this.db.transaction(stores, mode); out = fn(...stores.map(s => t.objectStore(s))); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = t.onabort = () => rej(t.error);
    });
    return once().catch(async e => { if (!this.db || e?.name === 'InvalidStateError' || e?.name === 'TypeError') { try { logEv('ต่อฐานข้อมูลใหม่'); this.db = null; await this.open(); return await once(); } catch (e2) { throw e2; } } throw e; });
  },
  allSongs: () => DB.tx(['songs'], 'readonly', s => s.getAll()),
  allSets: () => DB.tx(['sets'], 'readonly', s => s.getAll()),
  page: (id, i) => DB.tx(['pages'], 'readonly', s => s.get(id + ':' + i)),
  putSong: (song, blobs) => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.put(song); blobs.forEach((b, i) => ps.put(b, song.id + ':' + i)); }),
  delSong: song => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.delete(song.id); TH.del(song.id); for (let i = 0; i < song.n; i++) { ps.delete(song.id + ':' + i); TH.del('bb:' + song.id + ':' + i); TH.del('ann:' + song.id + ':' + i); TH.del('crop:' + song.id + ':' + i); } }),
  putSongMeta: song => DB.tx(['songs'], 'readwrite', s => s.put(song)),
  rewritePages: (song, blobs, oldN) => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.put(song); blobs.forEach((b, i) => ps.put(b, song.id + ':' + i)); for (let i = blobs.length; i < oldN; i++) ps.delete(song.id + ':' + i); }),
  addPages: (song, blobs, start) => DB.tx(['songs', 'pages'], 'readwrite', (ss, ps) => { ss.put(song); blobs.forEach((b, i) => ps.put(b, song.id + ':' + (start + i))); }),
  putSet: set => DB.tx(['sets'], 'readwrite', s => s.put(set)),
  delSet: id => DB.tx(['sets'], 'readwrite', s => s.delete(id)),
  clear: () => { TH.clear(); return DB.tx(['songs', 'pages', 'sets'], 'readwrite', (a, b, c) => { a.clear(); b.clear(); c.clear(); }); },
};

/* ───────────── state ───────────── */
const S = { edit: false, songs: new Map(), sets: [], queue: [], cur: 0, page: 0, zoom: 1, searching: false, q: '', letter: '', letterMode: false, shown: 120, setName: '' };
const STATEKEY = 'sheet:state';
const nextOrd = () => Math.max(0, ...S.sets.map(x => x.ord || 0)) + 1;
const activeSet = () => (S.setName ? S.sets.find(x => x.name === S.setName) : null);
function syncSet() { // the open set follows the queue: add, remove or reorder songs and the set is updated
  const x = activeSet(); if (!x || x.songs.join('|') === S.queue.join('|')) return;
  x.songs = [...S.queue]; DB.putSet(x).catch(() => {});
}
const saveState = () => { syncSet(); try { localStorage.setItem(STATEKEY, JSON.stringify({ queue: S.queue, cur: S.cur, page: S.page, setName: S.setName })); } catch { /* storage blocked */ } };
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
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><button class="sx" type="button" aria-label="ปิด">✕</button>${inner}</div>`;
  const close = () => { sc.remove(); onclose?.(); if (typeof chromeArm === 'function') chromeArm(); };
  sc.addEventListener('pointerdown', e => { if (e.target === sc) close(); });
  const sh = sc.firstChild;
  $('.sx', sh).addEventListener('click', close); // always a visible way out, same as tapping outside
  { const gr = $('.grab', sh); let st = null; // drag the handle down to close
    gr.addEventListener('pointerdown', e => { st = { y: e.clientY, id: e.pointerId }; try { gr.setPointerCapture(e.pointerId); } catch { /* ok */ } sh.style.transition = 'none'; });
    gr.addEventListener('pointermove', e => { if (!st || e.pointerId !== st.id) return; const dy = Math.max(0, e.clientY - st.y); sh.style.transform = `translateY(${dy}px)`; });
    const end = e => { if (!st || e.pointerId !== st.id) return; const dy = e.clientY - st.y; st = null; sh.style.transition = 'transform .18s'; if (dy > 90) close(); else sh.style.transform = ''; };
    gr.addEventListener('pointerup', end); gr.addEventListener('pointercancel', end); }
  $('#layer').append(sc);
  return { el: sh, close, scrim: sc };
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
const CROP = { on: (() => { try { return localStorage.getItem('sheet:trim') !== '0'; } catch { return true; } })(), box: null, manual: false, editing: false };
function cropParams() { // the shift + scale that shows only the inked area of the page, in stage coordinates
  const b = !CROP.editing && (CROP.on || CROP.manual) && CROP.box; if (!b) return null;
  const r = $('#stage').getBoundingClientRect(), W = r.width, H = r.height; if (!W || !H) return null;
  const f = Math.min(W / b.ar, H), dw = b.ar * f, dh = f, ox = (W - dw) / 2, oy = (H - dh) / 2;
  const cx = ox + b.x0 * dw, cy = oy + b.y0 * dh, cw = (b.x1 - b.x0) * dw, ch = (b.y1 - b.y0) * dh;
  const s0 = Math.min(W / cw, H / ch);
  return { s: s0, tx: W / 2 - s0 * (cx + cw / 2), ty: H / 2 - s0 * (cy + ch / 2) };
}
function cropBase() { const p = cropParams(); return p ? `translate(${p.tx}px,${p.ty}px) scale(${p.s})` : ''; }
const cropKey = (id, p) => `crop:${id}:${p}`, cropMem = new Map();
async function cropGet(id, page) {
  const k = cropKey(id, page); if (cropMem.has(k)) return cropMem.get(k);
  let v = null; try { const r = await TH.get(k); if (r && r.x1 > r.x0 && r.y1 > r.y0) v = r; } catch { /* no store */ }
  cropMem.set(k, v); return v;
}
async function cropSet(id, page, box) {
  bumpShare(); const k = cropKey(id, page); cropMem.set(k, box);
  try { await (box ? TH.put(k, box) : TH.del(k)); } catch { toast('บันทึกการครอปไม่สำเร็จ'); }
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
  const img = $('#pg'); img.style.transformOrigin = '0 0'; img.style.willChange = 'transform'; clearTimeout(applyZoom.t); applyZoom.t = setTimeout(() => { img.style.willChange = 'auto'; if (Z.s > 1.05) logEv('ซูม x' + Z.s.toFixed(1)); }, 700);
  const base = cropBase(), z = (Z.s === 1 && !Z.tx && !Z.ty) ? '' : `translate(${Z.tx}px,${Z.ty}px) scale(${Z.s})`;
  img.style.transform = (z + ' ' + base).trim();
  for (const sv of [$('#annsvg'), $('#annsvgn')]) if (sv) { sv.style.transformOrigin = '0 0'; sv.style.transform = img.style.transform; }
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
/* a page picture is shown from a plain in-memory copy, not from the database's own file handle (iOS can invalidate those after the database is rewritten) */
const memBlob = async b => new Blob([await b.arrayBuffer()], { type: b.type || 'image/jpeg' });
function rememberUrl(key, blob) {
  if (urlCache.has(key)) return urlCache.get(key);
  const u = URL.createObjectURL(blob); urlCache.set(key, u);
  while (urlCache.size > 4) { const cur = $('#pg')?.src, k = [...urlCache.keys()].find(x => urlCache.get(x) !== cur); if (!k) break; URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); } // never let go of the picture that is on screen
  return u;
}
async function pageUrl(song, i) {
  const key = song.id + ':' + i; if (urlCache.has(key)) { const u0 = urlCache.get(key); urlCache.delete(key); urlCache.set(key, u0); return u0; } // reading it makes it the newest
  let b = null; try { b = await DB.page(song.id, i); } catch (e) { logEv('โหลดหน้าไม่สำเร็จ ลองใหม่: ' + String(e?.name || e).slice(0, 40)); try { await new Promise(r => setTimeout(r, 250)); b = await DB.page(song.id, i); } catch { b = null; } }
  if (!b) return null;
  try { b = await memBlob(b); } catch { /* fall back to the stored blob */ }
  return rememberUrl(key, b);
}
/* if the picture of a page fails to load (iOS can drop a blob it handed out), rebuild it from the saved copy and note why in the log */
{ const pg = $('#pg'); let tried = { key: '', n: 0 };
  pg.addEventListener('load', () => { tried.n = 0; });
  pg.addEventListener('error', async () => {
    const song = curSong(); if (!song || !pg.getAttribute('src')) return;
    const key = song.id + ':' + S.page; if (tried.key !== key) tried = { key, n: 0 };
    if (tried.n++ >= 3) { logEv(`รูปหน้า ${S.page + 1} โหลดไม่ได้ (ลองครบแล้ว)`); return; }
    const old = urlCache.get(key); if (old) { try { URL.revokeObjectURL(old); } catch { /* ok */ } urlCache.delete(key); }
    let b = null; try { b = await DB.page(song.id, S.page); } catch { b = null; }
    logEv(`รูปหน้า ${S.page + 1} โหลดไม่ได้ ในเครื่อง: ${b ? (b.size + ' ไบต์ ' + (b.type || '?')) : 'ไม่พบ'} ลองใหม่ ${tried.n}`);
    if (b && b.size && key === song.id + ':' + S.page) { try { b = await memBlob(b); } catch { /* stored blob */ } pg.src = rememberUrl(key, b); }
  });
}
async function showPage() {
  const song = curSong(), tok = ++pageToken;
  const empty = $('#empty'), img = $('#pg');
  if (!S.songs.size) {
    img.removeAttribute('src'); $('#dots').innerHTML = ''; $('#nextSong').hidden = true; dotPaint();
    empty.className = 'empty show';
    empty.innerHTML = `<h2>ยังไม่มีโน้ต</h2><p>นำเข้าไฟล์โน้ตจากแอปไฟล์ (ZIP หรือรูป) แล้วเพลงจะอยู่ในเครื่องนี้ ใช้ได้โดยไม่ต้องมีอินเทอร์เน็ต</p><button class="btn" data-act="import">นำเข้าโน้ต</button>`; return;
  }
  if (!song) {
    img.removeAttribute('src'); $('#dots').innerHTML = ''; $('#nextSong').hidden = true; dotPaint();
    empty.className = 'empty show';
    empty.innerHTML = `<h2>เลือกเพลงที่จะเล่น</h2><p>กด ＋ ด้านล่างเพื่อค้นหาเพลงแล้วเพิ่มเข้าคิว มีเพลงในเครื่อง ${S.songs.size} เพลง</p><button class="btn" data-act="add">＋ ค้นหาเพลง</button>`; return;
  }
  empty.className = 'empty';
  S.page = Math.min(Math.max(0, S.page), song.n - 1);
  const [url, box, man] = await Promise.all([pageUrl(song, S.page), CROP.on ? inkBox(song.id, S.page) : null, cropGet(song.id, S.page)]); if (tok !== pageToken) return;
  CROP.manual = !!man; CROP.box = man || box; await annSetPage(song, S.page); if (tok !== pageToken) return;
  if (url) img.src = url; else img.removeAttribute('src');
  applyZoom(); annRender(); dotPaint(); schedulePrep(4000); $('#editBtn').hidden = false; logEv(`เปิด “${song.name.slice(0, 24)}” หน้า ${S.page + 1}/${song.n}`);
  $('#tPage').hidden = false; $('#tPage').textContent = `หน้า ${S.page + 1}/${song.n}`; $('#zoomBtn').hidden = false;
  $('#dots').innerHTML = song.n < 2 ? '' : song.n <= 8 ? Array.from({ length: song.n }, (_, i) => `<span class="pn ${i === S.page ? 'on' : ''}">${i + 1}</span>`).join('') : `<span class="pn on wide">${S.page + 1} / ${song.n}</span>`;
  tagPaint(); pageBtnsPaint();
  const next = S.songs.get(S.queue[S.cur + 1]);
  const ns = $('#nextSong'); ns.hidden = !(next && S.page === song.n - 1); if (!ns.hidden) ns.textContent = `เพลงต่อไป: ${withKey(next)} ▶`;
  saveState();
  if (S.page + 1 < song.n) { pageUrl(song, S.page + 1); if (CROP.on) inkBox(song.id, S.page + 1); } else if (next) { pageUrl(next, 0); if (CROP.on) inkBox(next.id, 0); }
}
function renderSetChips() { // every saved set as one small chip in the top bar; tap = open that set
  const box = $('#tsets'); if (!box) return;
  box.innerHTML = (S.sets.length ? S.sets.map(x => `<button class="tc ${x.name === S.setName ? 'on' : ''}" data-act="setchip" data-id="${x.id}">${x.locked ? '🔒 ' : ''}${esc(x.name)}</button>`).join('') : '') + `<button class="tc nw" data-act="setnew">＋ ชุดใหม่</button>`;
  const on = box.querySelector('.tc.on'); if (on) { const l = on.offsetLeft - box.clientWidth / 2 + on.offsetWidth / 2; box.scrollLeft = Math.max(0, l); }
}
function renderTop() {
  const song = curSong(); renderSetChips();
  $('#tSong').textContent = song ? song.name : 'โน้ตเนตร'; tagPaint();
  $('#tSet').textContent = S.setName ? S.setName : (S.queue.length ? `คิว ${S.cur + 1}/${S.queue.length}` : `${S.songs.size} เพลงในเครื่อง`);
  if (!song) { $('#tPage').hidden = true; $('#zoomBtn').hidden = true; $('#editBtn').hidden = true; }
}
function secStart(id, i) { // first song of each part of the show (parts come from the --- lines of a pasted list)
  const a = activeSet(); if (!a || !a.notes) return 0; const n = a.notes[id], p = i ? a.notes[S.queue[i - 1]] : null;
  return n && n.sec && (!p || p.sec !== n.sec) ? n.sec : 0;
}
function renderStrip() {
  $('#qn').textContent = S.queue.length;
  $('#qwrap').innerHTML = S.queue.map((id, i) => `<div class="qc ${i === S.cur ? 'cur' : ''}${secStart(id, i) ? ' secstart' : ''}" data-id="${id}" data-i="${i}"${secStart(id, i) ? ` data-sec="${secStart(id, i)}"` : ''}><i>${i + 1}</i>${i === S.cur ? '▶' : ''}<span>${esc(S.songs.get(id)?.name)}</span></div>`).join('')
    || '<div class="qc" style="opacity:.55">ยังไม่มีเพลงในคิว กด ＋</div>';
}
function scrollToCur() { const el = $('#qwrap .qc.cur'); el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }
function renderAll() { renderTop(); renderStrip(); showPage(); if (S.searching) renderResults(); }

/* ───────────── search panel ───────────── */
function openSearch() {
  logEv('เปิดค้นหา');
  S.searching = true; S.q = ''; S.shown = 120; $('#app').classList.remove('reading');
  $('#app').classList.add('searching');
  $('#panel').innerHTML = `<div class="phead"><div class="sbox"><span aria-hidden="true">⌕</span><input id="qi" type="text" placeholder="พิมพ์ชื่อเพลง…" autocomplete="off" autocapitalize="off" enterkeyhint="search"><button class="clr" data-act="qclear" aria-label="ล้าง">✕</button></div><button class="ib" data-act="closesearch">ปิด</button></div><div class="phint">แตะ = เพิ่มแล้วปิด · กดค้าง = เพิ่มต่อ</div><div class="webrow"><span>ค้นเว็บ</span><button data-act="web" data-k="g">Google</button><button data-act="web" data-k="y">YouTube</button><button data-act="web" data-k="o">Opera</button></div><div class="res" id="res"></div>`;
  renderResults(); $('#qi').focus();
}
function closeSearch() { logEv('ปิดค้นหา'); S.searching = false; $('#app').classList.remove('searching'); setTimeout(() => { if (!S.searching) $('#panel').innerHTML = ''; }, 420); document.activeElement?.blur?.(); showPage(); chromeArm(); }
/* words such as "คอด" / "โน้ต" are typed only to steer the web search; they are not part of a song name */
const HINT_WORDS = /(^|\s)(คอด|คอร์ด|คอร์ท|โน้ต|โน๊ต|โน้ตเพลง|chord|chords|sheet|note|notes)(?=\s|$)/gi;
const stripHints = t => nfc(t).replace(HINT_WORDS, ' ').replace(/\s+/g, ' ').trim();
function results() {
  const terms = stripHints(S.q).toLowerCase().split(/\s+/).filter(Boolean);
  let list = [...S.songs.values()];
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
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0; st.moved = Math.max(st.moved || 0, Math.hypot(dx, dy));
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
      if (st.removing) o.onRemove(st.item.dataset.id); else o.onDrop(items().map(x => x.dataset.id), st.moved || 0);
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
/* top-bar shortcuts: one tap opens the picker, then the import runs without questions */
function quickPick() {
  const f = $('#fileAny'); f.value = '';
  f.onchange = () => { const files = [...f.files]; if (files.length) quickImport(files); };
  f.click();
}
const natCmp = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
/* delete one page of the open song, or move it before / after its neighbour; drawings and crops travel with their page */
function dropPageCaches(song) {
  const id = song.id;
  for (const m of [ANN.cache, cropMem, bbMem]) for (const k of [...m.keys()]) if (k.includes(':' + id + ':')) m.delete(k);
  for (const k of [...urlCache.keys()]) if (k.startsWith(id + ':')) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); }
  if (thumbCache.has(id)) { URL.revokeObjectURL(thumbCache.get(id)); thumbCache.delete(id); }
  TH.del(id);
}
async function reorderPages(song, order) { // new page j = old page order[j]
  const oldN = song.n, newN = order.length, PRE = ['ann', 'crop', 'bb'];
  const blobs = []; for (const o of order) { const b = await DB.page(song.id, o); if (!b) throw new Error('อ่านหน้าไม่ได้'); blobs.push(await memBlob(b)); }
  const meta = []; for (const o of order) { const r = {}; for (const p of PRE) { try { r[p] = await TH.get(`${p}:${song.id}:${o}`); } catch { r[p] = undefined; } } meta.push(r); }
  const grown = { ...song, n: newN, bytes: blobs.reduce((a, b) => a + b.size, 0) };
  await DB.rewritePages(grown, blobs, oldN);
  for (let j = 0; j < oldN; j++) for (const p of PRE) { const k = `${p}:${song.id}:${j}`, v = j < newN ? meta[j][p] : undefined; try { if (v !== undefined) await TH.put(k, v); else TH.del(k); } catch { /* the drawing store is optional */ } }
  song.n = newN; song.bytes = grown.bytes; dropPageCaches(song); bumpShare();
}
async function movePage(dir) {
  const song = curSong(); if (!song) return; const a = S.page, b = a + dir; if (b < 0 || b >= song.n) return;
  const order = [...Array(song.n).keys()]; [order[a], order[b]] = [order[b], order[a]];
  try { await reorderPages(song, order); logEv(`ย้ายหน้า ${a + 1} → ${b + 1}`); S.page = b; showPage(); } catch (err) { toast('ย้ายหน้าไม่สำเร็จ: ' + (err.message || err)); }
}
async function deletePage() {
  const song = curSong(); if (!song) return;
  if (song.n < 2) { toast('เพลงนี้มีหน้าเดียว ลบทั้งเพลงได้ที่เมนู → จัดการเพลง'); return; }
  const pg = S.page;
  if (!(await confirmDel(`ลบหน้า ${pg + 1} ของ “${song.name}”?`, 'ลบเฉพาะหน้านี้ หน้าอื่นยังอยู่ (รอยปากกาและการครอปของหน้านี้หายไปด้วย)', 'ลบหน้านี้'))) return;
  try { await reorderPages(song, [...Array(song.n).keys()].filter(i => i !== pg)); logEv(`ลบหน้า ${pg + 1}`); S.page = Math.min(pg, song.n - 1); showPage(); } catch (err) { toast('ลบหน้าไม่สำเร็จ: ' + (err.message || err)); }
}
function pageBtnsPaint() { const song = curSong(); const l = $('#emvl'), r = $('#emvr'), d = $('#edelp'); if (!l) return; l.disabled = !song || S.page <= 0; r.disabled = !song || S.page >= song.n - 1; d.disabled = !song || song.n < 2; }
/* add pages (pictures / files) to the end of the song that is open, instead of making a new song */
function addPagesTo(song) {
  const f = $('#fileAny'); f.value = '';
  f.onchange = async () => {
    const all = [...f.files], files = all.filter(x => IMG_EXT.test(x.name) || x.type.startsWith('image/')).sort(natCmp);
    if (!files.length) { if (all.length) toast('เพิ่มหน้าได้เฉพาะไฟล์รูปภาพ'); return; }
    const start = song.n; let n = 0;
    toast(`กำลังเพิ่ม ${files.length} หน้า…`);
    try {
      const blobs = []; for (const x of files) { blobs.push(await shrink(new Uint8Array(await x.arrayBuffer()), x.name, QUALITY.normal)); n++; if (files.length > 1) toast(`กำลังเพิ่ม ${n}/${files.length} หน้า…`); }
      const grown = { ...song, n: start + blobs.length, bytes: (song.bytes || 0) + blobs.reduce((a, b) => a + b.size, 0) };
      await DB.addPages(grown, blobs, start);
      song.n = grown.n; song.bytes = grown.bytes; bumpShare(); logEv(`เพิ่ม ${blobs.length} หน้าใน “${song.name.slice(0, 24)}”`);
      if (curSong() === song) { S.page = start; showPage(); }
    } catch (err) { toast('เพิ่มหน้าไม่สำเร็จ: ' + (err.message || err)); }
  };
  f.click();
}
async function quickImport(files) {
  logEv('นำเข้า ' + files.length + ' ไฟล์');
  const isZip = f => /\.zip$/i.test(f.name) || f.type.includes('zip');
  if (files.some(isZip) || !files.every(f => IMG_EXT.test(f.name) || f.type.startsWith('image/'))) { // zip (or mixed): same engine as the menu import, started for you
    openImport(); const s = S.importSheet; await scanFiles(files, s);
    const go = $('#goImp', s.el); if (go && !go.disabled) go.click(); return;
  }
  const list = [...files].sort(natCmp), q = QUALITY.normal; let n = 0;
  toast(`กำลังนำเข้า ${list.length} หน้า…`);
  try {
    const blobs = []; for (const f of list) { blobs.push(await shrink(new Uint8Array(await f.arrayBuffer()), f.name, q)); n++; if (list.length > 1) toast(`กำลังนำเข้า ${n}/${list.length} หน้า…`); }
    let name = nfc(noExt(list[0].name)) || 'ไม่มีชื่อ'; const have = new Set([...S.songs.values()].map(x => nfc(x.name).toLowerCase()));
    if (have.has(name.toLowerCase())) { let k = 2; while (have.has((name + ' (' + k + ')').toLowerCase())) k++; name += ' (' + k + ')'; }
    const song = { id: uid(), name, n: blobs.length, created: Date.now(), bytes: blobs.reduce((a, b) => a + b.size, 0) };
    await DB.putSong(song, blobs); S.songs.set(song.id, song);
    const was = S.queue.length; addToQueue(song.id, 'next'); if (was) play(S.cur + 1);
    toast(`นำเข้า “${name}” ${blobs.length} หน้า แล้ว`); navigator.storage?.persist?.();
  } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + (err.message || err)); }
}
async function scanFiles(files, s) {
  const body = $('#impBody', s.el); body.innerHTML = '<p class="sub"><span class="spin"></span> กำลังอ่านรายการ…</p>';
  const entries = [], skipped = [], zips = []; let setsJson = null, annJson = null;
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type.includes('zip')) {
        const idx = await readZipIndex(f); zips.push(f);
        for (const e of idx) {
          const parts = e.path.split('/'); const last = parts[parts.length - 1];
          if (!last || e.path.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.path) || last.startsWith('.')) continue;
          if (last === '_ชุดเล่น.json') { setsJson = { f, e }; continue; }
          if (last === '_รอยแก้ไข.json') { annJson = { f, e }; continue; }
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
  renderReview(s, { rows, skipped, quality: 'normal', setsJson, annJson });
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
  logEv('นำเข้าชุดใหญ่เริ่ม');
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
      for (const set of data) { if (S.sets.some(x => x.name === set.name)) continue; const ids = (set.songs || []).map(n => byName.get(nfc(n).toLowerCase())).filter(Boolean); const rec = { id: uid(), name: set.name, songs: ids, ord: nextOrd() }; await DB.putSet(rec); S.sets.push(rec); }
    } catch { /* sets are optional */ }
  }
  if (st.annJson && !st.cancel) {
    try {
      const data = JSON.parse(new TextDecoder().decode(await readEntry(st.annJson.f, st.annJson.e)));
      const byName = new Map([...S.songs.values()].map(x => [nfc(x.name).toLowerCase(), x]));
      for (const it of data) {
        const song = byName.get(nfc(it.song || '').toLowerCase()); if (!song || !(it.page >= 0 && it.page < song.n)) continue;
        if (it.crop && it.crop.x1 > it.crop.x0 && it.crop.y1 > it.crop.y0) { const ck = cropKey(song.id, it.page); if (!(await TH.get(ck))) { await TH.put(ck, it.crop); cropMem.delete(ck); } }
        if (it.meta && !song.key && !song.bpm) { if (it.meta.key) song.key = String(it.meta.key).slice(0, 8); if (it.meta.bpm >= 30) song.bpm = Math.min(240, Math.round(it.meta.bpm)); await DB.putSongMeta(song); }
        if (!Array.isArray(it.strokes) || !it.strokes.length) continue;
        const k = annKey(song.id, it.page); if (!(ANN.cache.get(k)?.length) && !(await TH.get(k))?.strokes?.length) { await TH.put(k, { v: 1, strokes: it.strokes }); ANN.cache.delete(k); }
      }
    } catch { /* drawings are optional */ }
  }
  s.close(); renderAll(); if (S.searching) renderResults();
  toast(st.cancel ? `หยุดแล้ว นำเข้าได้ ${songs} เพลง` : failed.length ? `นำเข้า ${songs} เพลง · ผิดพลาด ${failed.length} (ดูในเมนู ข้อมูล)` : `นำเข้าสำเร็จ ${songs} เพลง`);
  if (failed.length) console.warn('import failed', failed);
  navigator.storage?.persist?.();
}

/* ───────────── menu, sets, song manager, backup ───────────── */
function openMenu() {
  const ls = licStatus();
  const warn = (ls.mode === 'trial' || ls.mode === 'paid') && ls.left <= 7;
  const card = ls.mode === 'off' ? '' : (() => {
    const owner = ls.mode === 'owner', trial = ls.mode === 'trial', paid = ls.mode === 'paid', locked = ls.mode === 'locked';
    const top = owner ? 'เครื่องเจ้าของ' : trial ? 'ทดลองใช้ฟรี' : paid ? `ใช้งานได้ถึง ${dayStr(ls.exp)}` : 'สิ้นสุดการใช้งาน';
    const big = owner ? 'ใช้ฟรีตลอด' : (trial || paid) ? `เหลือ ${ls.left} วัน` : 'ต่ออายุเพื่อใช้ต่อ';
    const bar = trial ? `<div class="mbar"><i style="width:${Math.max(4, Math.round(ls.left / LIC.TRIAL_DAYS * 100))}%"></i></div>` : '';
    return `<button data-m="lic" class="mstat ${owner ? 'own' : warn || locked ? 'warn' : paid ? 'paid' : ''}"><span class="ms1">${top}</span><span class="ms2">${big}</span>${bar}${owner ? '' : `<span class="ms3">${warn ? 'ใกล้หมดแล้ว · ต่ออายุได้ที่นี่' : 'ดูแพ็กเกจและต่ออายุ'} ›</span>`}</button>`;
  })();
  const row = (m, ic, t, sub, tog) => `<button data-m="${m}"${tog ? ' class="tg"' : ''}><span class="ic">${ic}</span><span class="mt">${t}<small>${sub}</small></span>${tog ? `<span class="sw${tog === 'on' ? ' on' : ''}"><i></i></span>` : '<span class="chev">›</span>'}</button>`;
  const s = sheet(`<h3>เมนู</h3><div class="menu">${card}
    <div class="mg">เริ่มต้นใช้งาน</div><div class="mcard">
      ${row('help', '？', 'วิธีใช้งาน', 'ติดตั้ง เพิ่มเพลง คิว ชุดเพลง เขียนโน้ต ดูย้อนหลังได้ทุกเมื่อ')}
    </div>
    <div class="mg">โน้ตของฉัน</div><div class="mcard">
      ${row('import', '⤓', 'นำเข้าโน้ต', 'ZIP หรือรูปจากแอปไฟล์ / iCloud')}
      ${row('manage', '✎', 'จัดการเพลง', `${S.songs.size} เพลง · เปลี่ยนชื่อ ดูตัวอย่าง ลบ`)}
      ${WISH.list.length ? row('wish', '♫', 'เพลงที่ยังไม่มีโน้ต', `${WISH.list.length} เพลงที่จดไว้จากการค้นเว็บ`) : ''}
    </div>
    <div class="mg">การแสดงผล</div><div class="mcard">
      ${row('fs', '⛶', 'โหมดอ่านเต็มจอ', 'แถบพับเองหลังไม่แตะ 4–5 วินาที', FS.on ? 'on' : 'off')}
      ${row('trim', '▣', 'ตัดขอบขาวอัตโนมัติ', 'ขยายโน้ตให้ใหญ่ขึ้น', CROP.on ? 'on' : 'off')}
      ${row('ann', '✎', 'แสดงรอยที่เขียนบนโน้ต', 'เปิด/ปิดการแสดง ยังเก็บรอยไว้', ANN.show ? 'on' : 'off')}
      ${row('topbar', '▤', 'ขอบบนของจอ', 'โน้ตเต็มขอบ / แถบดำ / แถบขาว')}
    </div>
    <div class="mg">ข้อมูล</div><div class="mcard">
      ${row('backup', '⤒', 'สำรองข้อมูล', 'เก็บไฟล์ ZIP กันข้อมูลหาย')}
      ${row('info', 'ⓘ', 'ข้อมูลและพื้นที่', `เวอร์ชัน ${BUILD}`)}
    </div>
    <details class="mmore"><summary>เครื่องมือเสริม</summary><div class="mcard">
      ${row('sets', '♪', 'รายการชุดเล่น', 'ดูและจัดการชุด (ปกติใช้แถบชุดด้านบน)')}
      ${row('remote', '⌁', 'ทดสอบรีโมท / ตัวเหยียบ', 'ดูว่าปุ่มเหยียบส่งอะไรมา')}
    </div></details>
  </div>`);
  const TOG = { fs: [toggleFs, () => FS.on], trim: [toggleTrim, () => CROP.on], ann: [toggleAnn, () => ANN.show] };
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m;
    if (TOG[m]) { TOG[m][0](); b.querySelector('.sw').classList.toggle('on', !!TOG[m][1]()); return; } // switches change in place, the menu stays open
    s.close(); ({ import: openImport, sets: openSets, manage: openManage, backup: doBackup, topbar: openTopBar, wish: openWish, remote: openRemoteTest, info: openInfo, lic: openLicence, help: () => openHelp() })[m]();
  });
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
/* search the web for a song that is not in the library, using the text in the search box; results open outside the score area */
/* songs searched on the web because the library does not have them yet, kept so the notes can be added after the gig */
const WISH = { list: [] };
const wishNorm = t => stripHints(t).toLowerCase();
async function wishLoad() { try { const v = await TH.get('wish:list'); if (Array.isArray(v)) WISH.list = v; } catch { /* none yet */ } }
function wishSave() { TH.put('wish:list', WISH.list).catch(() => {}); }
function wishAdd(q, quiet) {
  const clean = stripHints(q) || q.trim(), k = wishNorm(clean), now = Date.now(), old = WISH.list.find(x => wishNorm(x.q) === k);
  if (old) { old.t = now; old.n = (old.n || 1) + 1; } else WISH.list.unshift({ q: clean, t: now, n: 1 });
  wishSave(); if (!quiet) toast('จดไว้ในรายการ “เพลงที่ยังไม่มีโน้ต” แล้ว');
}
const wishInLibrary = q => { const k = wishNorm(q); return k && [...S.songs.values()].some(s => { const n = wishNorm(s.name); return n.includes(k) || k.includes(n); }); };
function openWish() {
  const s = sheet(`<h3>เพลงที่ยังไม่มีโน้ต <small id="wc" style="color:var(--mut);font-weight:400"></small></h3><p class="sub">จดให้เองทุกครั้งที่ค้นเพลงในเว็บ เล่นเสร็จแล้วค่อยหาโน้ตมาเพิ่ม</p><div id="wl" class="bklist" style="max-height:52vh"></div><div class="imp"><button class="btn o" data-w="x">ปิด</button></div>`);
  const paint = () => {
    const L = $('#wl', s.el); $('#wc', s.el).textContent = `${WISH.list.length} เพลง`;
    L.innerHTML = WISH.list.length ? WISH.list.map((x, i) => { const have = wishInLibrary(x.q), d = new Date(x.t);
      return `<div class="bkrow" style="flex-wrap:wrap"><span style="flex:1 1 100%;white-space:normal"><b>${esc(x.q)}</b>${have ? ' <em style="color:var(--ac);font-style:normal">· มีในคลังแล้ว</em>' : ''}<br><small style="color:var(--mut)">ค้นเมื่อ ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${x.n > 1 ? ` · ค้น ${x.n} ครั้ง` : ''}</small></span><button class="btn o sm" data-g="${i}">ค้นอีกครั้ง</button><button class="btn o sm" data-r="${i}">ลบ</button></div>`; }).join('') : '<div class="note">ยังไม่มีเพลงที่จดไว้</div>';
  };
  paint();
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-w=x]')) return s.close();
    const g = e.target.closest('[data-g]'), r = e.target.closest('[data-r]');
    if (g) { const x = WISH.list[+g.dataset.g]; const a = document.createElement('a'); a.href = 'https://www.google.com/search?q=' + encodeURIComponent('คอด ' + x.q); a.target = '_blank'; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); }
    else if (r) { const x = WISH.list[+r.dataset.r]; if (await confirmDel(`ลบ “${x.q}” ออกจากรายการ?`, 'ลบแค่ชื่อที่จดไว้ ไม่กระทบโน้ตในแอป', 'ลบ')) { WISH.list = WISH.list.filter(z => z !== x); wishSave(); paint(); } }
  });
}
function openWeb(k) {
  const q = ($('#qi')?.value || '').trim(); if (!q) { toast('พิมพ์ชื่อเพลงในช่องค้นหาก่อน'); return $('#qi')?.focus(); }
  const hinted = stripHints(q) !== nfc(q).trim(), g = 'https://www.google.com/search?q=' + encodeURIComponent(hinted ? q : q + ' โน้ต'), y = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' sheet music');
  const nav = (url, same) => { const a = document.createElement('a'); a.href = url; if (!same) { a.target = '_blank'; a.rel = 'noopener'; } document.body.append(a); a.click(); a.remove(); };
  wishAdd(q);
  if (k === 'y') return nav(y);
  if (k === 'g') return nav(g);
  // Opera app: try its URL schemes one after another (nothing happens if the app is not installed)
  const schemes = ['opera-', 'touch-']; let i = 0;
  const go = () => { nav(schemes[i] + g, true); i++; if (i < schemes.length) setTimeout(() => { if (!document.hidden) go(); }, 900); else setTimeout(() => { if (!document.hidden) toast('เปิด Opera ไม่ได้ ลองปุ่ม Google แทน'); }, 1200); };
  go();
}
function pickVersion(cur) { // choose another score for the same song (or any song) with a small preview of each
  return new Promise(res => {
    const s = sheet(`<h3>เปลี่ยนโน้ตของเพลงนี้</h3><p class="sub">ตอนนี้: <b>${esc(cur.name)}</b> · ${cur.n} หน้า</p><div class="fx"><input class="field" id="vq" autocomplete="off" placeholder="ค้นหาชื่อเพลง…" value="${esc(stripHints(cur.name))}"><button class="fxb" id="vqx" aria-label="ลบชื่อ">✕</button></div><div id="vres" class="lres" style="max-height:52vh"></div><div class="row2"><button class="btn o" data-r="1">ยกเลิก</button></div>`, { onclose: () => res(null) });
    const all = [...S.songs.values()].map(x => ({ s: x, n: wishNorm(x.name), c: compact(wishNorm(x.name)) })), base = compact(wishNorm(cur.name));
    let alive = true, run = 0;
    const paint = async () => {
      const terms = wishNorm($('#vq', s.el).value).split(/\s+/).filter(Boolean), my = ++run;
      let list = all.filter(it => terms.every(t => it.n.includes(t) || it.c.includes(compact(t))));
      list.sort((a, b) => (+(b.c === base) - +(a.c === base)) || (+(a.c.startsWith(base) ? 0 : 1) - +(b.c.startsWith(base) ? 0 : 1)) || a.n.length - b.n.length); list = list.slice(0, 30);
      const same = list.filter(it => it.c === base || it.c.startsWith(base) && base.length > 2);
      $('#vres', s.el).innerHTML = list.length ? list.map(it => `<div class="lr pk vr" data-id="${it.s.id}"><img class="vth" alt=""><div class="lm"><b>${hl(it.s.name, terms)}</b><small>${it.s.n} หน้า${it.s.id === cur.id ? ' · ใช้อยู่ตอนนี้' : same.includes(it) ? ' · เวอร์ชันของเพลงนี้' : ''}${it.s.key ? ' · คีย์ ' + esc(it.s.key) : ''}</small></div></div>`).join('') : '<p class="sub">ไม่พบเพลงที่ตรงกัน ลองพิมพ์คำสั้น ๆ</p>';
      for (const row of [...$('#vres', s.el).querySelectorAll('.vr')].slice(0, 16)) { if (!alive || my !== run) return; try { const u = await makeThumb(row.dataset.id); if (u && alive && my === run) { const im = row.querySelector('.vth'); im.src = u; im.classList.add('on'); } } catch { /* no preview */ } }
    };
    let tm = 0; $('#vq', s.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(paint, 180); }); $('#vqx', s.el).onclick = () => { const i = $('#vq', s.el); i.value = ''; i.focus(); paint(); }; paint();
    s.el.addEventListener('click', e => {
      if (e.target.closest('[data-r]')) { alive = false; s.close(); return; }
      const p = e.target.closest('.vr'); if (p) { const song = S.songs.get(p.dataset.id); alive = false; res(song); s.close(); }
    });
  });
}
async function swapInQueue(i) { // replace one queued song with another score, same position
  const oldId = S.queue[i], old = S.songs.get(oldId); if (!old) return;
  const nu = await pickVersion(old); if (!nu || nu.id === oldId) return;
  const prev = { q: [...S.queue], c: S.cur, p: S.page }, act = activeSet(), note = act && act.notes && act.notes[oldId], hadNew = act && act.notes && act.notes[nu.id];
  if (act && note && !hadNew) { act.notes[nu.id] = note; if (S.queue.filter(x => x === oldId).length < 2) delete act.notes[oldId]; }
  S.queue[i] = nu.id; if (i === S.cur) { S.page = 0; resetZoom(); }
  logEv(`สลับโน้ต “${old.name.slice(0, 20)}” → “${nu.name.slice(0, 20)}”`); saveState(); renderAll();
  toast(`เปลี่ยนเป็น “${nu.name}” (${nu.n} หน้า) แล้ว`, { label: 'เลิกทำ', fn: () => { S.queue = prev.q; S.cur = prev.c; S.page = prev.p; if (act && note && !hadNew) { act.notes[oldId] = note; delete act.notes[nu.id]; } saveState(); renderAll(); } });
}
function openQueueSheet() {
  const s = sheet(`<h3>คิวเล่น <small style="color:var(--mut);font-weight:400">${S.queue.length} เพลง</small></h3><p class="sub">แตะเพลงเพื่อเล่น · จับ ⠿ แล้วลากเพื่อสลับลำดับ · ✕ เอาออก</p><div id="qlist"></div><div class="row2"><button class="btn o" data-q="save">บันทึกเป็นชุดเล่น</button><button class="btn bad" data-q="clear">ล้างคิว</button></div>`);
  const list = $('#qlist', s.el);
  const paint = () => { list.innerHTML = S.queue.map((id, i) => `<div class="lrow ${i === S.cur ? 'cur' : ''}" data-id="${id}"><span class="gr" aria-label="ลาก">⠿</span><span class="no">${i === S.cur ? '▶' : i + 1}</span><div class="nm" data-play="${i}">${esc(S.songs.get(id)?.name)}<small>${S.songs.get(id)?.n || 0} หน้า</small></div><button class="sw" data-swap="${i}">เปลี่ยน</button><button class="x" data-rm="${i}" aria-label="เอาออก">✕</button></div>`).join('') || '<div class="note">คิวว่าง กด ＋ เพื่อเพิ่มเพลง</div>'; };
  paint();
  sortable(list, { axis: 'y', itemSel: '.lrow', handleSel: '.gr', hold: 0, onDrop: ids => { setQueueOrder(ids); paint(); } });
  s.el.addEventListener('click', async e => {
    const pl = e.target.closest('[data-play]'); if (pl && !justDragged(list)) { s.close(); play(+pl.dataset.play); return; }
    const sw = e.target.closest('[data-swap]'); if (sw) { await swapInQueue(+sw.dataset.swap); paint(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { removeFromQueue(+rm.dataset.rm); paint(); return; }
    const b = e.target.closest('[data-q]'); if (!b) return;
    if (b.dataset.q === 'clear') { if (await confirmDel('ล้างคิวทั้งหมด?', 'โน้ตในเครื่องไม่ถูกลบ แค่เอาออกจากคิว', 'ล้างคิว')) { S.queue = []; S.cur = 0; S.page = 0; S.setName = ''; saveState(); renderAll(); s.close(); } }
    else { s.close(); saveCurrentSet(); }
  });
}
async function saveCurrentSet() {
  if (!S.queue.length) return toast('คิวว่างอยู่ ยังไม่มีอะไรให้บันทึก');
  const name = await askText({ title: 'ตั้งชื่อชุดเล่น', value: S.setName || '', ok: 'บันทึก', placeholder: 'เช่น ชุดคืนวันศุกร์' }); if (!name) return;
  const old = S.sets.find(x => x.name === name); const rec = { id: old?.id || uid(), name, songs: [...S.queue], ord: old?.ord ?? nextOrd() };
  await DB.putSet(rec); if (old) Object.assign(old, rec); else S.sets.push(rec); S.setName = name; saveState(); renderTop(); void 0;
}
function loadSet(x) {
  logEv('เปิดชุด ' + x.name);
  S.queue = x.songs.filter(i => S.songs.has(i)); S.cur = 0; S.page = 0; S.setName = x.name; resetZoom(); saveState(); renderAll();
}
/* quick set picker under the top bar: tap ♪, tap a set, everything closes and that set is loaded */
function closeSetBar() { $('#setbar')?.remove(); $('#qsetBtn')?.classList.remove('on'); document.removeEventListener('pointerdown', setBarOutside, true); }
function setBarOutside(e) { if (!e.target.closest('#setbar,#qsetBtn,.scrim')) closeSetBar(); }
function setBarHtml() {
  const act = activeSet();
  const cards = S.sets.map(x => `<button class="sc ${x.name === S.setName ? 'on' : ''}" data-sid="${x.id}" data-id="${x.id}"><b>${x.locked ? '🔒 ' : ''}${esc(x.name)}</b><small>${x.songs.filter(i => S.songs.has(i)).length} เพลง${x.name === S.setName ? ' · ใช้อยู่' : ''}</small><span class="sx sr" data-ren="${x.id}" aria-label="เปลี่ยนชื่อชุด">✎</span><span class="sx" data-del="${x.id}" aria-label="ลบชุด">✕</span></button>`).join('');
  return '<div class="sbh"><span>แตะ = เปิดชุด · กดค้างแล้วลาก = สลับลำดับ</span><button class="sbm" data-more="1">⋯ เพิ่มเติม</button></div><div class="sbl"><button class="sn" data-new="1"><b>＋ ชุดใหม่</b><small>เริ่มชุดว่าง</small></button>' + cards + '</div>';
}

/* type or paste a list of song names (one per line) and get a set; also share a set as plain text */
const LINE_NUM = /^\s*(?:\d{1,3}\s*[.)\-:：]|[-•*·●▪]+)\s*/, KEY_TAIL = /(?:^|(?<=[\s฀-๿·|]))\s*([A-G](?:#|♯|b|♭)?(?:m|min)?)\s*$/;
const compact = t => String(t || '').replace(/[\s.\-_'’"“”,!?()（）]/g, '');
const ALIAS = { map: {} }; // names you fixed once are remembered: typed name -> song id
async function aliasLoad() { try { const v = await TH.get('alias:list'); if (v && typeof v === 'object') ALIAS.map = v; } catch { /* none yet */ } }
const aliasKey = t => wishNorm(t);
const isBreakLine = t => /^[\s\-–—−_=*~·•.]{3,}$/.test(t) && /[-–—−_=*~]/.test(t);
function parseList(text) {
  const ent = []; let blk = 0, prevBlank = false, sec = 1;
  for (const [ln, r0] of String(text || '').split(/\r?\n/).entries()) {
    const t = nfc(r0).trim();
    if (!t) { if (ent.length) prevBlank = true; continue; }
    if (isBreakLine(t)) { if (ent.length > 1) sec++; continue; } // --- between parts of the show
    if (prevBlank) { blk++; prevBlank = false; }
    ent.push({ t, blk, sec, ln });
  }
  const raws = ent.map(e => e.t);
  const isSection = t => /^\s*(?:\d{1,3}\s*[.)\-:：]?\s*)?[(（\[【].*[)）\]】]\s*$/.test(t);
  let title = '', first = 0;
  const m0 = raws.length && /^(?:ชุดเล่น|ชุด|set)\s*[:：]\s*(.+)$/i.exec(raws[0]);
  if (m0) { title = m0[1].trim(); first = 1; }
  else if (raws.length > 1 && !LINE_NUM.test(raws[0]) && raws.some(isSection)) { title = raws[0]; first = 1; }
  else if (raws.length > 2 && !LINE_NUM.test(raws[0]) && raws.slice(1).filter(t => LINE_NUM.test(t)).length >= Math.max(2, (raws.length - 1) * 0.6)) { title = raws[0]; first = 1; }
  const items = [];
  for (const e of ent.slice(first)) {
    const raw = e.t; if (isSection(raw)) continue;
    let t = raw.replace(LINE_NUM, '').trim(); if (!t) continue;
    const full = t; let who = '', key = '', note = '', shift = '';
    for (let pass = 0; pass < 3; pass++) { // trailing bits can come in any mix: (note) +5 key
      const nm = /\s*[(（]([^()（）]*)[)）]\s*$/.exec(t); if (nm && t.length > nm[0].length) { note = (nm[1].trim() + (note ? ' ' + note : '')).trim(); t = t.slice(0, nm.index).trim(); continue; }
      const sm = /(?:^|(?<=[\s฀-๿]))\s*([+＋−-]\s*\d{1,2})\s*$/.exec(t); if (sm && t.length > sm[0].length) { shift = sm[1].replace(/\s/g, '').replace('＋', '+').replace('−', '-'); t = t.slice(0, sm.index).trim(); continue; }
      const km = KEY_TAIL.exec(t); if (km && t.length > km[1].length + 1 && !key) { key = km[1].replace('♯', '#').replace('♭', 'b').replace(/min$/, 'm'); t = t.slice(0, km.index).trim(); continue; }
      break;
    }
    const wm = /^([A-Za-z])(?=\s|[฀-๿])\s*/.exec(t); if (wm && t.length > wm[0].length) { who = wm[1].toUpperCase(); t = t.slice(wm[0].length).trim(); }
    if (!t || (t.length < 2 && !/[฀-๿0-9]/.test(t))) continue; // a lone "T" or "K" is just a placeholder
    items.push({ line: t, full, key, who, note, shift, blk: e.blk, sec: e.sec, ln: e.ln });
  }
  return { title, items, secs: ent.length ? Math.max(...ent.map(e => e.sec)) : 1 };
}
function matchLine(item, idx) { // best library matches for one list line, most likely first
  const tries = [item.line, item.full].filter((v, i, a) => v && a.indexOf(v) === i), seen = new Set(), out = [];
  const al = ALIAS.map[aliasKey(item.line)]; if (al && S.songs.has(al)) { out.push(S.songs.get(al)); seen.add(al); }
  const kk = (item.key || '').toLowerCase();
  for (const line of tries) {
    const q = compact(wishNorm(line)); if (!q) continue; const part = [];
    for (const it of idx) { if (seen.has(it.s.id)) continue; const n = it.c; let r = -1; if (n === q) r = 0; else if (n.startsWith(q)) r = 1; else if (n.includes(q)) r = 2; else if (q.includes(n) && n.length >= 3) r = 3; if (r >= 0) { const km = kk && ((it.s.key || '').toLowerCase() === kk || it.n.endsWith(' ' + kk)) ? 0 : 1; part.push([r, km, n.length, it.s]); } }
    part.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const p of part) { if (!seen.has(p[3].id)) { seen.add(p[3].id); out.push(p[3]); } }
    if (out.length) break;
  }
  return out.slice(0, 8);
}
function pickSong(line, idx, current) { // search the whole library and choose the right song for one line
  return new Promise(res => {
    const s = sheet(`<h3>เลือกเพลง</h3><p class="sub">สำหรับ “${esc(line)}”</p><div class="fx"><input class="field" id="pq" autocomplete="off" placeholder="ค้นหาชื่อเพลง…" value="${esc(stripHints(line))}"><button class="fxb" id="pqx" aria-label="ลบชื่อ">✕</button></div><div id="pres" class="lres" style="max-height:48vh"></div><div class="row2"><button class="btn o" data-r="skip">ข้ามเพลงนี้</button><button class="btn o" data-r="cancel">ยกเลิก</button></div>`, { onclose: () => res(undefined) });
    const paint = () => {
      const terms = wishNorm($('#pq', s.el).value).split(/\s+/).filter(Boolean);
      const list = idx.filter(it => terms.every(t => it.n.includes(t))).sort((x, y) => (+!x.n.startsWith(terms[0] || '')) - (+!y.n.startsWith(terms[0] || '')) || x.n.length - y.n.length).slice(0, 40);
      $('#pres', s.el).innerHTML = list.length ? list.map(it => `<div class="lr pk" data-id="${it.s.id}"><div class="lm"><b>${hl(it.s.name, terms)}</b><small>${it.s.n} หน้า${current && current.id === it.s.id ? ' · เลือกอยู่' : ''}</small></div></div>`).join('') : '<p class="sub">ไม่พบเพลงที่ตรงกัน ลองพิมพ์คำสั้น ๆ</p>';
    };
    let tm = 0; $('#pq', s.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(paint, 150); }); $('#pqx', s.el).onclick = () => { const i = $('#pq', s.el); i.value = ''; i.focus(); paint(); }; paint();
    s.el.addEventListener('click', e => {
      const r = e.target.closest('[data-r]'); if (r) { const v = r.dataset.r === 'skip' ? null : undefined; res(v); s.close(); return; }
      const p = e.target.closest('.pk'); if (p) { const song = S.songs.get(p.dataset.id); res(song); s.close(); }
    });
  });
}
function openListPaste(initial) {
  const s = sheet(`<h3>พิมพ์รายการเพลง</h3><p class="sub">บรรทัดละเพลง พิมพ์เองหรือวางที่คัดลอกมา (ตัดเลขลำดับให้เอง)</p>
    <textarea class="field" id="lt" rows="6" placeholder="แค่มี&#10;รักนานๆ&#10;หากันจนเจอ" style="width:100%;resize:vertical"></textarea>
    <div class="row2"><button class="btn o sm" id="ltpaste">วางจากที่คัดลอก</button><button class="btn o sm" id="ltclear">ล้างทั้งหมด</button></div>
    <div id="lres" class="lres"></div>
    <label class="lw"><input type="checkbox" id="ltwish" checked> จดเพลงที่หาไม่เจอไว้ใน “เพลงที่ยังไม่มีโน้ต”</label>
    <div class="row2"><button class="btn" id="ltgo" disabled>สร้างชุด</button></div>`);
  const idx = [...S.songs.values()].map(x => { const n = wishNorm(x.name); return { s: x, n, c: compact(n) }; }); let rows = [], title = '', tm = 0, secs = 1;
  const fin = r => (r.skip ? null : r.sel || r.c[0] || null);
  const rowTags = r => (r.key ? ' · คีย์ ' + esc(r.key) : '') + (r.who ? ' · ' + esc(r.who) : '') + (r.shift ? ' · ' + esc(r.shift) : '') + (r.note ? ' · ' + esc(r.note) : '') + (secs > 1 ? ' · ช่วง ' + r.sec : '');
  const paint = () => {
    const ok = rows.filter(r => fin(r)).length;
    $('#lres', s.el).innerHTML = rows.map((r, i) => { const f = fin(r);
      return f ? `<div class="lr"><span class="ln">${i + 1}</span><div class="lm"><b>${esc(f.name)}</b><small>${esc(r.line)}${r.sel ? ' · เลือกเอง' : ''}${rowTags(r)}</small></div><button class="lsw" data-sw="${i}">เปลี่ยน</button><button class="lx" data-rmrow="${i}" aria-label="ลบบรรทัดนี้">✕</button></div>`
        : `<div class="lr bad"><span class="ln">${i + 1}</span><div class="lm"><b>${esc(r.line)}</b><small>${r.header ? 'ข้อมูลงาน (ข้ามให้)' : r.skip ? 'ข้ามเพลงนี้' : 'ไม่เจอในเครื่องนี้'}${rowTags(r)}</small></div><button class="lsw" data-sw="${i}">ค้นหา</button><button class="lx" data-rmrow="${i}" aria-label="ลบบรรทัดนี้">✕</button></div>`; }).join('');
    const go = $('#ltgo', s.el); go.disabled = !ok; go.textContent = ok ? `สร้างชุด (${ok} เพลง${rows.length > ok ? ` · ไม่ใส่ ${rows.length - ok}` : ''})` : 'สร้างชุด';
  };
  const INFO_RE = /\d{1,2}[.:]\d{2}\s*น|พ\.ย\.|พย\.|ม\.ค\.|ธ\.ค\.|ชม\./;
  const parse = () => {
    const keep = new Map(); rows.forEach(r => { const a = keep.get(r.full) || keep.set(r.full, []).get(r.full); a.push({ sel: r.sel, skip: r.skip && !r.header }); }); // manual choices survive edits to the text
    const p = parseList($('#lt', s.el).value); title = p.title; secs = p.secs;
    rows = p.items.map(it => { const c = matchLine(it, idx); const whole = c[0] && (it.key || it.who || it.note || it.shift) && compact(wishNorm(c[0].name)) === compact(wishNorm(it.full)); return { line: whole ? it.full : it.line, full: it.full, key: whole ? '' : it.key, who: whole ? '' : it.who, note: whole ? '' : it.note, shift: whole ? '' : it.shift, blk: it.blk, sec: it.sec, ln: it.ln, c, sel: null, skip: false }; });
    const seen = new Map(); rows.forEach(r => { const a = keep.get(r.full), n = seen.get(r.full) || 0; seen.set(r.full, n + 1); const o = a && a[n]; if (o) { if (o.sel) r.sel = o.sel; if (o.skip) r.skip = true; } });
    const b0 = rows.filter(r => r.blk === 0), rest = rows.filter(r => r.blk > 0); // job details above the first blank line are not songs
    if (!p.title && b0.length && b0.length <= 6 && rest.length >= Math.max(3, b0.length) && (b0.some(r => INFO_RE.test(r.full)) || (b0.every(r => !r.c.length) && rest.some(r => r.c.length)))) { title = b0[0].full; b0.forEach(r => { r.skip = true; r.header = true; }); }
    paint();
  };
  $('#lt', s.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(parse, 200); });
  $('#ltclear', s.el).onclick = () => { const t = $('#lt', s.el); t.value = ''; t.focus(); parse(); };
  $('#ltpaste', s.el).onclick = async () => { try { $('#lt', s.el).value = await navigator.clipboard.readText(); parse(); } catch { toast('วางอัตโนมัติไม่ได้ กดค้างในช่องแล้วเลือก “วาง”'); } };
  $('#lres', s.el).addEventListener('click', async e => {
    const x = e.target.closest('[data-rmrow]'); if (x) { const r = rows[+x.dataset.rmrow]; const t = $('#lt', s.el), ls = t.value.split(/\r?\n/); if (r && r.ln != null) { ls.splice(r.ln, 1); t.value = ls.join('\n'); parse(); } return; }
    const b = e.target.closest('[data-sw]'); if (!b) return; const r = rows[+b.dataset.sw];
    const v = await pickSong(r.line, idx, fin(r)); if (v === undefined) return; if (v === null) { r.skip = true; r.sel = null; } else { r.skip = false; r.sel = v; } paint(); });
  $('#ltgo', s.el).onclick = async () => {
    const ids = rows.map(fin).filter(Boolean).map(x => x.id); if (!ids.length) return;
    if ($('#ltwish', s.el).checked) rows.filter(r => !fin(r) && !r.skip).forEach(r => wishAdd(r.line, true));
    let name = title || nextSetName(); if (S.sets.some(z => z.name === name)) { let k = 2; while (S.sets.some(z => z.name === name + ' (' + k + ')')) k++; name += ' (' + k + ')'; }
    const notes = {}; for (const r of rows) { const f = fin(r); if (f && (r.key || r.who || r.note || r.shift || secs > 1)) notes[f.id] = { ...(r.key ? { key: r.key } : {}), ...(r.who ? { who: r.who } : {}), ...(r.shift ? { shift: r.shift } : {}), ...(r.note ? { note: r.note } : {}), ...(secs > 1 ? { sec: r.sec } : {}) }; if (f && r.sel) ALIAS.map[aliasKey(r.line)] = f.id; }
    try { await TH.put('alias:list', ALIAS.map); } catch { /* optional */ }
    const rec = { id: uid(), name, songs: ids, notes, secs, ord: nextOrd() }; await DB.putSet(rec); S.sets.push(rec); s.close(); loadSet(rec);
  };
  if (initial) { $('#lt', s.el).value = initial; parse(); }
}
function setShareText(rec) {
  const act = rec || activeSet(), ids = act ? act.songs : S.queue; if (!ids.length) return '';
  let last = 0, k = 0; const out = [];
  for (const id of ids) { const x = S.songs.get(id); if (!x) continue; const n = noteFor(x, act) || {}, key = n.key || x.key || ''; if (n.sec && last && n.sec !== last) out.push('---'); if (n.sec) last = n.sec; k++;
    out.push(`${k}. ${n.who ? n.who + ' ' : ''}${x.name}${key ? ' · ' + key : ''}${n.shift ? ' ' + n.shift : ''}${n.note ? ' (' + n.note + ')' : ''}`); }
  return `ชุด: ${act ? act.name : 'คิวเล่น'}\n` + out.join('\n');
}
function setItems() { const act = activeSet(), ids = act ? act.songs : S.queue; return { title: act ? act.name : 'คิวเล่น', songs: ids.map(i => S.songs.get(i)).filter(Boolean) }; }
const shareMarksOn = () => { try { return localStorage.getItem('sheet:sharemarks') !== '0'; } catch { return true; } };
const safeFile = n => nfc(n).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'โน้ต';
async function pageFile(song, i, marks) { // one page as a picture to send; with the drawings and manual crop drawn in when asked
  const blob = await DB.page(song.id, i); if (!blob) return null; const name = `${safeFile(song.name)}-${i + 1}.jpg`;
  const strokes = marks ? await annLoad(song.id, i) : [], crop = marks ? await cropGet(song.id, i) : null;
  if (!strokes.length && !crop) return new File([blob], name, { type: blob.type || 'image/jpeg' });
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }), W = bmp.width, H = bmp.height;
  const gc = document.createElement('canvas'); gc.width = 48; gc.height = 64; const gg = gc.getContext('2d', { willReadFrequently: true }); gg.drawImage(bmp, 0, 0, 48, 64);
  const d = gg.getImageData(0, 0, 48, 64).data, a = new Uint8Array(48 * 64); for (let q = 0; q < 48 * 64; q++) a[q] = (d[q * 4] * 299 + d[q * 4 + 1] * 587 + d[q * 4 + 2] * 114) / 1000; const grid = { W: 48, H: 64, a };
  const sx = crop ? Math.round(crop.x0 * W) : 0, sy = crop ? Math.round(crop.y0 * H) : 0, cw = crop ? Math.round((crop.x1 - crop.x0) * W) : W, ch = crop ? Math.round((crop.y1 - crop.y0) * H) : H;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(bmp, sx, sy, cw, ch, 0, 0, cw, ch); bmp.close?.();
  const LIGHT = { '#ef4444': '#ff7a7a', '#22c55e': '#5dff8f', '#3b82f6': '#6fa9ff', '#facc15': '#ffe34d', '#f97316': '#ffa05a', '#a855f7': '#c99bff', '#ec4899': '#ff7fbd' };
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const k of strokes) {
    const dk = strokeDark(k, grid), pts = k.pts.length < 4 ? [...k.pts, k.pts[0] + 0.0005, k.pts[1]] : k.pts, lw = k.w * W, col = dk ? (LIGHT[k.c] || k.c) : k.c, o = k.o != null ? k.o : (k.t === 'h' ? (dk ? 0.8 : 0.45) : 1);
    const trace = () => { g.beginPath(); for (let q = 0; q < pts.length; q += 2) { const x = pts[q] * W - sx, y = pts[q + 1] * H - sy; q ? g.lineTo(x, y) : g.moveTo(x, y); } };
    if (k.t !== 'h' && dk && o > 0.5) { trace(); g.globalAlpha = 0.85 * o; g.strokeStyle = '#fff'; g.lineWidth = lw + 3; g.globalCompositeOperation = 'source-over'; g.stroke(); }
    trace(); g.globalAlpha = o; g.strokeStyle = col; g.lineWidth = lw; g.globalCompositeOperation = k.t === 'h' && !dk ? 'multiply' : 'source-over'; g.stroke();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); c.width = c.height = 0; gc.width = gc.height = 0; return out ? new File([out], name, { type: 'image/jpeg' }) : null;
}
async function shareScores(wholeSet, rec) { // prepare the pictures, then one button gives the share sheet a fresh tap (iOS needs that)
  const songs = rec ? rec.songs.map(i => S.songs.get(i)).filter(Boolean) : wholeSet ? setItems().songs : [curSong()].filter(Boolean); if (!songs.length) { toast('ยังไม่มีเพลงให้ส่ง'); return; }
  const marks = shareMarksOn(), total = songs.reduce((a, x) => a + x.n, 0), files = []; let n = 0;
  try { for (const x of songs) for (let i = 0; i < x.n; i++) { const f = await pageFile(x, i, marks); if (f) files.push(f); n++; if (total > 3 && n % 2 === 0) toast(`กำลังเตรียมรูป ${n}/${total}…`); } } catch (err) { toast('เตรียมรูปไม่สำเร็จ: ' + (err.message || err)); return; }
  if (!files.length) { toast('ไม่พบรูปโน้ต'); return; }
  const PER = 10, batches = []; for (let i = 0; i < files.length; i += PER) batches.push(files.slice(i, i + PER));
  const s = sheet(`<h3>พร้อมส่งแล้ว</h3><p class="sub">${files.length} รูป · ${songs.length} เพลง · ${marks ? 'รวมรอยที่เขียนไว้' : 'ต้นฉบับสะอาด'}</p><div class="shb">${batches.map((b, i) => `<button class="btn ${i ? 'o' : ''}" data-b="${i}">${batches.length > 1 ? `ส่งรูปที่ ${i * PER + 1}–${i * PER + b.length}` : 'ส่งรูป'}</button>`).join('')}</div>${batches.length > 1 ? '<p class="sub">ส่งทีละกลุ่มเพื่อไม่ให้เครื่องค้าง กดกลุ่มถัดไปหลังส่งเสร็จ</p>' : ''}<div class="row2"><button class="btn o" data-x="1">ปิด</button></div>`);
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) { s.close(); return; }
    const b = e.target.closest('[data-b]'); if (!b) return; const batch = batches[+b.dataset.b];
    try { if (navigator.canShare && navigator.canShare({ files: batch })) { await navigator.share({ files: batch }); logEv(`ส่งรูปโน้ต ${batch.length} รูป`); b.classList.add('o'); b.textContent = '✓ ' + b.textContent; } else toast('เครื่องนี้ส่งรูปจากแอปไม่ได้'); }
    catch (err) { if (!err || err.name !== 'AbortError') toast('ส่งไม่สำเร็จ ลองอีกครั้ง'); }
  });
}
async function shareSet(rec) { // the set as plain text, for people who use the app too (paste it into “พิมพ์รายการ”)
  const text = setShareText(rec); if (!text) { toast('ยังไม่มีเพลงในคิวหรือชุดนี้'); return; }
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('คัดลอกรายการแล้ว ส่งต่อได้เลย'); } catch { toast('ส่งไม่ได้ ลองใหม่อีกครั้ง'); }
}
function openSetMore() { // the less-used things (typing a list, sending) live one tap deeper so the set bar stays only about sets
  const act = activeSet(), hasQ = S.queue.length > 0;
  const s = sheet(`<h3>ชุดเล่น · เพิ่มเติม</h3><div class="menu">
    <button data-sm="list"><span class="ic">✎</span><span>พิมพ์รายการเพลง<small>วางชื่อเพลงทีละบรรทัดแล้วสร้างชุด</small></span></button>
    ${!act && hasQ ? '<button data-sm="savecur"><span class="ic">⤓</span><span>บันทึกคิวนี้เป็นชุด<small>เก็บคิวที่มีอยู่เป็นชุดใหม่</small></span></button>' : ''}
    ${hasQ ? `<button data-sm="song"><span class="ic">⇪</span><span>ส่งโน้ตเพลงนี้<small>รูปทุกหน้า · AirDrop / LINE</small></span></button>
    <button data-sm="set"><span class="ic">⇪</span><span>ส่งโน้ตทั้งชุด<small>รูปของทุกเพลงในชุดหรือคิว</small></span></button>
    <button data-sm="text"><span class="ic">⇪</span><span>ส่งรายชื่อเป็นข้อความ<small>สำหรับคนที่ใช้โน้ตเนตรเหมือนกัน</small></span></button>` : ''}
    <button data-sm="marks"><span class="ic">✎</span><span>แนบรอยที่เขียนตอนส่งรูป<small id="smk">${shareMarksOn() ? 'เปิดอยู่ รูปมีไฮไลต์ ปากกา และการครอป' : 'ปิดอยู่ ส่งต้นฉบับสะอาด'}</small></span></button></div>`);
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-sm]'); if (!b) return; const k = b.dataset.sm;
    if (k === 'marks') { const on = !shareMarksOn(); try { localStorage.setItem('sheet:sharemarks', on ? '1' : '0'); } catch { /* ok */ } $('#smk', s.el).textContent = on ? 'เปิดอยู่ รูปมีไฮไลต์ ปากกา และการครอป' : 'ปิดอยู่ ส่งต้นฉบับสะอาด'; return; }
    s.close(); if (k === 'list') openListPaste(); else if (k === 'savecur') newSet(true); else if (k === 'song') shareScores(false); else if (k === 'set') shareScores(true); else if (k === 'text') shareSet();
  });
}

async function deleteSet(x) {
  if (!(await guardSet(x))) return;
  if (!(await confirmDel(`ลบชุด “${x.name}”?`, 'ลบแค่ชุดเล่น โน้ตในเครื่องไม่ถูกลบ', 'ลบชุด'))) return;
  await DB.delSet(x.id); S.sets = S.sets.filter(z => z !== x); if (S.setName === x.name) S.setName = ''; saveState(); renderTop(); void 0;
}
/* set lock: a 4-digit code (kept on this device as a hash) is asked before a locked set is DELETED; everything else in the set works as usual */
const PINKEY = 'sheet:lockpin';
const pinGet = () => { try { return localStorage.getItem(PINKEY) || ''; } catch { return ''; } };
async function pinHash(p) { try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('notenet:' + p)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { return 'x' + [...p].reverse().join(''); } }
function askPin(title, sub) {
  return new Promise(res => {
    let v = '', done = false;
    const s = sheet(`<h3>${esc(title)}</h3><p class="sub" id="pns">${esc(sub || '')}</p><div class="pdots" id="pds"><i></i><i></i><i></i><i></i></div><div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="c" class="o">ยกเลิก</button><button data-k="0">0</button><button data-k="x" class="o">⌫</button></div>`, { onclose: () => { if (!done) { done = true; res(null); } } });
    const paint = () => s.el.querySelectorAll('#pds i').forEach((d, i) => d.classList.toggle('on', i < v.length));
    s.el.addEventListener('click', e => {
      const k = e.target.closest('[data-k]')?.dataset.k; if (k == null) return;
      if (k === 'c') { s.close(); return; }
      if (k === 'x') v = v.slice(0, -1); else if (v.length < 4) v += k;
      paint(); if (v.length === 4) { setTimeout(() => { if (done) return; done = true; res(v); s.close(); }, 120); }
    });
  });
}
async function verifyPin(why, title) { // true when the right code was typed (the first time ever it asks you to choose one)
  const saved = pinGet();
  if (!saved) {
    const a = await askPin('ตั้งรหัส 4 หลัก', 'ใช้เข้าเมนูเจ้าของและปลดล็อกชุดเพลง (จำไว้ให้ดี)'); if (!a) return false;
    const b = await askPin('ใส่รหัสอีกครั้ง', 'ยืนยันรหัสที่ตั้ง'); if (!b) return false;
    if (a !== b) { toast('รหัสสองครั้งไม่ตรงกัน ลองใหม่'); return false; }
    try { localStorage.setItem(PINKEY, await pinHash(a)); } catch { toast('บันทึกรหัสไม่สำเร็จ'); return false; }
    return true;
  }
  let sub = why || 'ใส่รหัส 4 หลัก';
  for (;;) { const p = await askPin(title || 'ชุดนี้ล็อกอยู่', sub); if (!p) return false; if (await pinHash(p) === saved) return true; sub = 'รหัสไม่ถูก ลองอีกครั้ง'; try { navigator.vibrate?.(60); } catch { /* ok */ } }
}
const guardSet = async x => !x || !x.locked || verifyPin(`ใส่รหัสเพื่อลบชุด “${x.name}”`);
async function toggleLock(x) {
  if (x.locked) { if (!(await verifyPin(`ใส่รหัสเพื่อปลดล็อกชุด “${x.name}”`))) return; x.locked = false; }
  else { if (!pinGet() && !(await verifyPin())) return; x.locked = true; }
  await DB.putSet(x).catch(() => toast('บันทึกไม่สำเร็จ')); renderTop();
}
async function changePin() {
  if (!(await verifyPin('ใส่รหัสเดิมก่อน'))) return;
  const a = await askPin('รหัสใหม่ 4 หลัก'); if (!a) return; const b = await askPin('ใส่รหัสใหม่อีกครั้ง'); if (!b) return;
  if (a !== b) { toast('รหัสสองครั้งไม่ตรงกัน ลองใหม่'); return; }
  try { localStorage.setItem(PINKEY, await pinHash(a)); toast('เปลี่ยนรหัสแล้ว'); } catch { toast('บันทึกรหัสไม่สำเร็จ'); }
}
function closePop() { $('#mkpop')?.remove(); document.removeEventListener('pointerdown', popOutside, true); chromeArm(); }
function popOutside(e) { if (!e.target.closest('#mkpop')) closePop(); }
function openPop(anchor, items) { // a small menu under a chip: [{ic, t, s, bad, fn}]
  closePop(); const r = anchor.getBoundingClientRect(), d = document.createElement('div'); d.id = 'mkpop';
  d.innerHTML = items.map((it, i) => `<button data-pi="${i}" class="${it.bad ? 'bad' : ''}"><span class="pic">${it.ic}</span><span class="pt">${esc(it.t)}${it.s ? `<small>${esc(it.s)}</small>` : ''}</span></button>`).join('');
  document.body.append(d); const w = d.offsetWidth; d.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; d.style.top = (r.bottom + 8) + 'px';
  d.addEventListener('click', e => { const b = e.target.closest('[data-pi]'); if (!b) return; const it = items[+b.dataset.pi]; if (it.keep) { it.fn(b); return; } closePop(); it.fn(); });
  setTimeout(() => document.addEventListener('pointerdown', popOutside, true), 0);
}
function chipMenu(x, anchor) {
  openPop(anchor, [
    { ic: '✎', t: 'เปลี่ยนชื่อ', fn: () => renameSet(x) },
    { ic: '⇪', t: 'ส่งโน้ตชุดนี้เป็นรูป', s: 'AirDrop / LINE', fn: () => shareScores(true, x) },
    { ic: '⇪', t: 'ส่งรายชื่อเป็นข้อความ', s: 'สำหรับคนที่ใช้โน้ตเนตรเหมือนกัน', fn: () => shareSet(x) },
    { ic: '✎', t: 'แนบรอยที่เขียนตอนส่งรูป: ' + (shareMarksOn() ? 'เปิด' : 'ปิด'), keep: true, fn: b => { const on = !shareMarksOn(); try { localStorage.setItem('sheet:sharemarks', on ? '1' : '0'); } catch { /* ok */ } b.querySelector('.pt').firstChild.textContent = 'แนบรอยที่เขียนตอนส่งรูป: ' + (on ? 'เปิด' : 'ปิด'); } },
    ...(x.locked ? [{ ic: '🔑', t: 'เปลี่ยนรหัส', fn: () => changePin() }] : []),
    { ic: x.locked ? '🔓' : '🔒', t: x.locked ? 'ปลดล็อกชุดนี้' : 'ล็อกชุดนี้', s: x.locked ? 'ต้องใส่รหัสก่อน' : 'กันเผลอลบชุด (ต้องใส่รหัสก่อนลบ)', fn: () => toggleLock(x) },
    { ic: '🗑', t: 'ลบชุด', s: x.locked ? '🔒 ต้องใส่รหัส' : 'โน้ตในเครื่องไม่ถูกลบ', bad: true, fn: () => deleteSet(x) },
  ]);
}
function newChipMenu(anchor) {
  openPop(anchor, [
    { ic: '＋', t: 'เริ่มชุดว่าง', s: 'เพิ่มเพลงทีละเพลง', fn: () => newSet(false) },
    { ic: '✎', t: 'พิมพ์รายการเพลง', s: 'วางชื่อเพลงทีละบรรทัดจากไลน์', fn: () => openListPaste() },
    ...(S.queue.length ? [{ ic: '⤓', t: 'บันทึกคิวนี้เป็นชุด', s: 'เก็บคิวที่มีอยู่', fn: () => newSet(true) }] : []),
  ]);
}
function nextSetName() { let n = 1; while (S.sets.some(x => x.name === 'ชุดใหม่ ' + n)) n++; return 'ชุดใหม่ ' + n; }
async function newSet(fromQueue) {
  const prev = { q: [...S.queue], c: S.cur, p: S.page, n: S.setName }, rec = { id: uid(), name: nextSetName(), songs: fromQueue ? [...S.queue] : [], ord: nextOrd() };
  await DB.putSet(rec); S.sets.push(rec);
  if (!fromQueue) { S.queue = []; S.cur = 0; S.page = 0; }
  S.setName = rec.name; saveState(); renderAll();
  toast(fromQueue ? `บันทึกคิวเป็น “${rec.name}” แล้ว` : `เริ่ม “${rec.name}” (ว่าง) เพิ่มเพลงได้เลย`, { label: 'เลิกทำ', fn: async () => { S.sets = S.sets.filter(z => z !== rec); try { await DB.delSet(rec.id); } catch { /* ok */ } S.queue = prev.q; S.cur = prev.c; S.page = prev.p; S.setName = prev.n; saveState(); renderAll(); } });
  if (!fromQueue) openSearch();
}
async function renameSet(x) {
  const n = await askText({ title: 'เปลี่ยนชื่อชุด', value: x.name, ok: 'บันทึก' }); if (!n) return; const name = nfc(n).trim();
  if (!name || name === x.name) return; if (S.sets.some(z => z !== x && z.name === name)) { toast('มีชุดชื่อนี้อยู่แล้ว'); return; }
  const was = S.setName === x.name; x.name = name; await DB.putSet(x); if (was) S.setName = name; saveState(); renderTop(); void 0;
}
function toggleSetBar() {
  if ($('#setbar')) return closeSetBar();
  const bar = document.createElement('div'); bar.id = 'setbar'; const top = $('.top').getBoundingClientRect().bottom; bar.style.top = top + 'px'; bar.innerHTML = setBarHtml();
  const initSort = () => { const list = bar.querySelector('.sbl'); if (!list) return;
    sortable(list, { axis: 'x', itemSel: '.sc[data-id]', hold: 450, onDrop: (ids, moved) => {
      if (moved < 10) { const x = S.sets.find(z => z.id === lastHeld); if (x) { closeSetBar(); renameSet(x); } return; } // held and let go without moving = rename
      const by = new Map(S.sets.map(z => [z.id, z])); const next = ids.map(i => by.get(i)).filter(Boolean); S.sets.forEach(z => { if (!next.includes(z)) next.push(z); });
      next.forEach((z, i) => { if (z.ord !== i + 1) { z.ord = i + 1; DB.putSet(z).catch(() => {}); } }); S.sets = next; renderTop(); void 0;
    } });
    list.addEventListener('pointerdown', e => { const c = e.target.closest('.sc[data-id]'); lastHeld = c ? c.dataset.id : null; }, true);
  };
  let lastHeld = null; initSort();
  bar.addEventListener('click', async e => {
    if (justDragged(bar.querySelector('.sbl'))) return;
    if (e.target.closest('[data-new]')) { closeSetBar(); newSet(false); return; }
    if (e.target.closest('[data-more]')) { closeSetBar(); openSetMore(); return; }
    const rn = e.target.closest('[data-ren]'); if (rn) { const x = S.sets.find(z => z.id === rn.dataset.ren); if (x) { closeSetBar(); renameSet(x); } return; }
    const d = e.target.closest('[data-del]');
    if (d) { const x = S.sets.find(z => z.id === d.dataset.del); if (!x) return;
      if (!(await guardSet(x))) return;
      if (await confirmDel(`ลบชุด “${x.name}”?`, 'ลบแค่ชุดเล่น โน้ตในเครื่องไม่ถูกลบ', 'ลบชุด')) { await DB.delSet(x.id); S.sets = S.sets.filter(z => z !== x); if (S.setName === x.name) S.setName = ''; saveState(); renderTop(); if ($('#setbar')) { bar.innerHTML = setBarHtml(); initSort(); } void 0; }
      return; }
    const b = e.target.closest('[data-sid]'); if (!b) return; const x = S.sets.find(z => z.id === b.dataset.sid); closeSetBar(); if (x) loadSet(x);
  });
  $('#app').append(bar); $('#qsetBtn')?.classList.add('on'); setTimeout(() => document.addEventListener('pointerdown', setBarOutside, true), 0);
}
function openSets() {
  const s = sheet(`<h3>ชุดเล่น</h3><button class="btn" style="width:100%;margin-bottom:10px" data-s="save">บันทึกคิวปัจจุบันเป็นชุดใหม่</button><div id="slist"></div>`);
  const paint = () => { $('#slist', s.el).innerHTML = S.sets.map(x => `<div class="lrow"><div class="nm" data-open="${x.id}">${esc(x.name)}<small>${x.songs.filter(i => S.songs.has(i)).length} เพลง · แตะเพื่อเปิดเป็นคิว</small></div><button class="x" data-del="${x.id}" aria-label="ลบ">🗑</button></div>`).join('') || '<div class="note">ยังไม่มีชุดเล่น</div>'; };
  paint();
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-s]')) { s.close(); saveCurrentSet(); return; }
    const o = e.target.closest('[data-open]'); if (o) { const x = S.sets.find(z => z.id === o.dataset.open); s.close(); loadSet(x); return; }
    const d = e.target.closest('[data-del]'); if (d) { const x = S.sets.find(z => z.id === d.dataset.del); if (!(await guardSet(x))) return; if (await confirmDel(`ลบชุด “${x.name}”?`, 'โน้ตในเครื่องไม่ถูกลบ')) { await DB.delSet(x.id); S.sets = S.sets.filter(z => z !== x); paint(); } }
  });
}
async function delSongAsk(x) {
  if (!x) return false;
  if (await confirmDel(`ลบ “${x.name}”?`, 'ลบเพลงนี้ออกจากเครื่อง รวมถึงคิวและชุดเพลงทุกชุด (ไฟล์ต้นฉบับใน iCloud ไม่ถูกลบ)')) { await DB.delSong(x); S.songs.delete(x.id); S.queue = S.queue.filter(i => i !== x.id); S.cur = Math.min(S.cur, Math.max(0, S.queue.length - 1)); for (const set of S.sets) { const f = set.songs.filter(i => i !== x.id); if (f.length !== set.songs.length) { set.songs = f; DB.putSet(set); } } saveState(); renderAll(); return true; }
  return false;
}
function previewSong(x, after) {
  return new Promise(res => {
    let i = 0, url = null, alive = true;
    const s = sheet(`<div class="pvh"><b id="pvn"></b><span id="pvi"></span></div><div class="pvb" id="pvb"><img id="pvimg" alt=""></div>
      <div class="row2"><button class="btn o" data-a="prev">‹ ก่อนหน้า</button><button class="btn o" data-a="next">ถัดไป ›</button></div>
      <div class="row2"><button class="btn o" data-a="ren">✎ เปลี่ยนชื่อ</button><button class="btn o" data-a="del" style="color:var(--bad)">🗑 ลบ</button></div>
      <button class="btn" data-a="x" style="width:100%;margin-top:6px">ปิด</button>`, { onclose: () => { alive = false; if (url) URL.revokeObjectURL(url); res(); } });
    const show = async () => {
      $('#pvn', s.el).textContent = x.name; $('#pvi', s.el).textContent = `หน้า ${i + 1}/${x.n}`;
      const b = await DB.page(x.id, i); if (!alive) return; const old = url; url = b ? URL.createObjectURL(b) : null; $('#pvimg', s.el).src = url || ''; if (old) URL.revokeObjectURL(old);
    };
    show();
    let sx = null; const box = $('#pvb', s.el);
    box.addEventListener('pointerdown', e => { sx = e.clientX; });
    box.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) { i = Math.max(0, Math.min(x.n - 1, i + (dx < 0 ? 1 : -1))); show(); } });
    s.el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'x') s.close();
      else if (a === 'next') { i = Math.min(x.n - 1, i + 1); show(); }
      else if (a === 'prev') { i = Math.max(0, i - 1); show(); }
      else if (a === 'ren') { const n = await askText({ title: 'เปลี่ยนชื่อเพลง', value: x.name, ok: 'บันทึก' }); if (n) { x.name = nfc(n); await DB.putSongMeta(x); $('#pvn', s.el).textContent = x.name; renderAll(); after?.(); } }
      else if (a === 'del') { if (await delSongAsk(x)) s.close(); }
    });
  });
}
function openManage() {
  const s = sheet(`<h3>จัดการเพลง</h3><input class="field" id="mq" placeholder="ค้นหาชื่อเพลง…" autocomplete="off"><div id="mlist" style="margin-top:10px"></div>`);
  let q = '', shown = 80;
  const paint = () => {
    const terms = nfc(q).toLowerCase().split(/\s+/).filter(Boolean);
    const list = [...S.songs.values()].filter(x => terms.every(t => nfc(x.name).toLowerCase().includes(t))).sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)));
    $('#mlist', s.el).innerHTML = list.slice(0, shown).map(x => `<div class="lrow"><div class="mth" data-pv="${x.id}" data-id="${x.id}"><img alt=""></div><div class="nm" data-pv="${x.id}">${hl(x.name, terms)}<small>${x.n} หน้า · ${(x.bytes / 1048576).toFixed(1)} MB</small></div><button class="x" style="color:var(--ink)" data-ren="${x.id}" aria-label="เปลี่ยนชื่อ">✎</button><button class="x" data-del="${x.id}" aria-label="ลบ">🗑</button></div>`).join('') + (list.length > shown ? `<button class="btn o sm more" data-more="1" style="display:flex;margin:6px auto">แสดงเพิ่ม</button>` : '') || '<div class="note">ไม่พบเพลง</div>';
    mthLoad();
  };
  const mio = new IntersectionObserver(es => { es.forEach(e => { if (!e.isIntersecting) return; mio.unobserve(e.target); const row = e.target; makeThumb(row.dataset.id).then(u => { const im = row.querySelector('img'); if (u && im && row.isConnected) { im.src = u; im.classList.add('on'); } }).catch(() => {}); }); }, { rootMargin: '300px' });
  const mthLoad = () => { mio.disconnect(); s.el.querySelectorAll('.mth').forEach(r => { const u = thumbCache.get(r.dataset.id), im = r.querySelector('img'); if (u) { im.src = u; im.classList.add('on'); } else mio.observe(r); }); };
  paint();
  let mtm = 0; $('#mq', s.el).addEventListener('input', e => { q = e.target.value; shown = 80; clearTimeout(mtm); mtm = setTimeout(paint, 150); });
  s.el.addEventListener('click', async e => {
    if (e.target.closest('[data-more]')) { shown += 120; paint(); return; }
    const r = e.target.closest('[data-ren]'); if (r) { const x = S.songs.get(r.dataset.ren); const n = await askText({ title: 'เปลี่ยนชื่อเพลง', value: x.name, ok: 'บันทึก' }); if (n) { x.name = nfc(n); await DB.putSongMeta(x); paint(); renderAll(); } return; }
    const d = e.target.closest('[data-del]'); if (d) { await delSongAsk(S.songs.get(d.dataset.del)); paint(); return; }
    const pv = e.target.closest('[data-pv]'); if (pv) { const x = S.songs.get(pv.dataset.pv); if (x) { await previewSong(x, paint); paint(); } return; }
  });
}
/* backup: split into parts (so memory stays small), then one share sheet for all parts */
function askBackupName(info, stamp) {
  return new Promise(res => {
    const s = sheet(`<h3>สำรองข้อมูล</h3><p class="sub">${esc(info)}</p>
      <input class="field" id="bkn" value="สำรองโน้ตเนตร-${stamp}" maxlength="80" aria-label="ชื่อไฟล์">
      <p class="sub" style="margin:10px 0 6px">แบ่งไฟล์ส่วนละ (ถ้าเครื่องหน่วยความจำน้อยให้เลือกเล็กลง)</p>
      <div class="pills" id="bkz">${[50, 100, 150, 250].map(v => `<button data-z="${v}" class="${v === 100 ? 'on' : ''}">${v} MB</button>`).join('')}</div>
      <div class="row2"><button class="btn o" data-v="0">ยกเลิก</button><button class="btn" data-v="1">สร้างไฟล์</button></div>`);
    let mb = 100, done = false; const fin = v => { if (done) return; done = true; s.close(); res(v); };
    s.el.addEventListener('click', e => {
      const z = e.target.closest('[data-z]'); if (z) { mb = +z.dataset.z; s.el.querySelectorAll('[data-z]').forEach(b => b.classList.toggle('on', b === z)); return; }
      const b = e.target.closest('[data-v]'); if (b) fin(b.dataset.v === '1' ? { name: ($('#bkn', s.el).value.trim() || `สำรองโน้ตเนตร-${stamp}`), mb } : null);
    });
  });
}
async function doBackup() {
  if (!S.songs.size) return toast('ยังไม่มีเพลงให้สำรอง');
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const pages = [...S.songs.values()].reduce((a, x) => a + x.n, 0), approx = [...S.songs.values()].reduce((a, x) => a + (x.bytes || 0), 0);
  const pick = await askBackupName(`${S.songs.size} เพลง · ${pages} หน้า · ราว ${(approx / 1048576).toFixed(0)} MB`, stamp);
  if (!pick) return;
  const base = pick.name.replace(/[\/\\:*?"<>|]/g, '‐').replace(/\.zip$/i, '').trim(), limit = pick.mb * 1048576;
  const s = sheet(`<h3>กำลังสำรองข้อมูล</h3><p class="sub" id="bt">เตรียมไฟล์…</p><div class="bar"><i id="bb"></i></div>`);
  const parts = [];
  try {
    let chunks = [], zip = null, size = 0, i = 0; const used = new Set();
    const open = () => { chunks = []; zip = new fflate.Zip((err, c) => { if (err) throw err; chunks.push(c); }); size = 0; };
    const close = () => { zip.end(); parts.push(new Blob(chunks, { type: 'application/zip' })); chunks = []; zip = null; };
    const addFile = (name, bytes) => { const f = new fflate.ZipPassThrough(name); zip.add(f); f.push(bytes, true); size += bytes.length; };
    for (const song of [...S.songs.values()].sort((a, b) => collator.compare(a.name, b.name))) {
      if (!zip) open();
      let folder = song.name.replace(/[\/\\:*?"<>|]/g, '‐'); while (used.has(folder.toLowerCase())) folder += '_'; used.add(folder.toLowerCase());
      for (let p = 0; p < song.n; p++) { const blob = await DB.page(song.id, p); addFile(`${folder}/${String(p + 1).padStart(3, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer())); }
      i++; $('#bb', s.el).style.width = (i / S.songs.size * 100) + '%'; $('#bt', s.el).textContent = `ส่วนที่ ${parts.length + 1} · รวมไฟล์ ${i}/${S.songs.size} เพลง`;
      if (size >= limit) close();
      if (i % 10 === 0) await sleep(0);
    }
    if (!zip) open();
    addFile('_ชุดเล่น.json', new TextEncoder().encode(JSON.stringify(S.sets.map(x => ({ name: x.name, songs: x.songs.map(id => S.songs.get(id)?.name).filter(Boolean) })))));
    try { // drawings, matched back to songs by name when restored
      const names = new Map([...S.songs.values()].map(x => [x.id, x.name])), items = [];
      for (const [k, v] of await TH.prefix('ann:')) { const [, id, pg] = k.split(':'); if (names.has(id) && v && v.strokes && v.strokes.length) items.push({ song: names.get(id), page: +pg, strokes: v.strokes }); }
      for (const x of S.songs.values()) if (x.key || x.bpm) items.push({ song: x.name, page: 0, meta: { key: x.key || '', bpm: x.bpm || 0 } });
      for (const [k, v] of await TH.prefix('crop:')) { const [, id, pg] = k.split(':'); if (names.has(id) && v && v.x1 > v.x0) items.push({ song: names.get(id), page: +pg, crop: v }); }
      if (items.length) addFile('_รอยแก้ไข.json', new TextEncoder().encode(JSON.stringify(items)));
    } catch { /* drawings are optional */ }
    close(); s.close();
    const n = parts.length, files = parts.map((b, k) => new File([b], n === 1 ? `${base}.zip` : `${base}-ส่วน${k + 1}จาก${n}.zip`, { type: 'application/zip' }));
    offerBackupFiles(files);
  } catch (err) { s.close(); toast('สำรองไม่สำเร็จ: ' + (err.message || err)); }
}
/* the files are ready: the person taps a button (a fresh tap is needed for the iOS share sheet) */
function offerBackupFiles(files) {
  const total = files.reduce((a, f) => a + f.size, 0), hasShare = typeof navigator.share === 'function', canPick = typeof window.showDirectoryPicker === 'function';
  const asType = (fs, t) => fs.map(f => new File([f], f.name, t ? { type: t } : {}));
  const s = sheet(`<h3>ไฟล์สำรองพร้อมแล้ว</h3><p class="sub"><b>${files.length} ไฟล์</b> · รวม ${(total / 1048576).toFixed(0)} MB<br>${files.length === 1 ? esc(files[0].name) : esc(files[0].name.replace(/-ส่วน.*$/, '')) + '-ส่วน…'}</p>
    <div class="imp">${hasShare ? `<button class="btn" id="bkShare">บันทึกทั้งหมดไปที่ไฟล์ (${files.length} ไฟล์)</button>` : ''}${canPick ? '<button class="btn" id="bkDir">เลือกโฟลเดอร์ที่บันทึก…</button>' : ''}<button class="btn o" id="bkMore">บันทึกทีละกลุ่ม / ทีละไฟล์</button><button class="btn o" id="bkClose">ปิด</button></div>
    <div id="bkList" class="bklist" hidden></div>
    <p class="sub" style="margin-top:10px">${hasShare ? 'ในหน้าต่างที่ขึ้นมา เลือก <b>“บันทึกไปที่ไฟล์”</b> → เลือก iCloud Drive → แตะ <b>ไอคอนโฟลเดอร์ใหม่</b> มุมบนขวา ตั้งชื่อโฟลเดอร์ → กดบันทึก ไฟล์ทุกส่วนจะลงในโฟลเดอร์นั้นพร้อมกัน' : 'เครื่องนี้ไม่มีหน้าต่างแชร์ ใช้ “บันทึกทีละกลุ่ม / ทีละไฟล์” แทน'}<br>เครื่องอื่น: ☰ → นำเข้าโน้ต → เข้าโฟลเดอร์นั้น กด <b>เลือกทั้งหมด</b> (Select All) แล้วนำเข้าครั้งเดียว</p>`);
  const done = msg => { s.close(); toast(msg); };
  const shareFiles = async fs => {
    for (const t of ['application/zip', 'application/octet-stream', '']) {
      try { await navigator.share({ files: asType(fs, t), title: fs[0].name }); return true; }
      catch (err) { if (err && err.name === 'AbortError') return null; /* next file type */ }
    }
    return false;
  };
  $('#bkClose', s.el).onclick = () => s.close();
  const dl = f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 8000); };
  if (hasShare) $('#bkShare', s.el).onclick = async () => {
    const r = await shareFiles(files); if (r) return done('ส่งไฟล์สำรองแล้ว'); if (r === false) { toast('ส่งทั้งหมดพร้อมกันไม่ได้ ลอง “บันทึกทีละกลุ่ม” แทน'); $('#bkMore', s.el).click(); }
  };
  if (canPick) $('#bkDir', s.el).onclick = async () => {
    try { const dir = await window.showDirectoryPicker({ mode: 'readwrite' }); for (const f of files) { const h = await dir.getFileHandle(f.name, { create: true }), w = await h.createWritable(); await w.write(f); await w.close(); } done('บันทึกไฟล์สำรองลงโฟลเดอร์แล้ว'); }
    catch (err) { if (err && err.name === 'AbortError') return; toast('บันทึกไม่สำเร็จ ลอง “บันทึกทีละกลุ่ม” แทน'); }
  };
  $('#bkMore', s.el).onclick = () => {
    const L = $('#bkList', s.el); if (!L.hidden) { L.hidden = true; return; } L.hidden = false;
    const groups = []; for (let i = 0; i < files.length; i += 3) groups.push(files.slice(i, i + 3));
    L.innerHTML = (hasShare && files.length > 3 ? groups.map((g, k) => `<button class="btn o sm" data-g="${k}">กลุ่ม ${k + 1}: ไฟล์ ${files.indexOf(g[0]) + 1}–${files.indexOf(g[g.length - 1]) + 1}</button>`).join('') : '') +
      files.map((f, k) => `<div class="bkrow"><span>${esc(f.name)} · ${(f.size / 1048576).toFixed(0)} MB</span>${hasShare ? `<button class="btn o sm" data-s="${k}">แชร์</button>` : ''}<button class="btn o sm" data-d="${k}">ดาวน์โหลด</button></div>`).join('');
  };
  $('#bkList', s.el).addEventListener('click', async e => {
    const g = e.target.closest('[data-g]'), one = e.target.closest('[data-s]'), d = e.target.closest('[data-d]');
    if (g) { const fs = files.slice(+g.dataset.g * 3, +g.dataset.g * 3 + 3); if (await shareFiles(fs)) void 0; }
    else if (one) { if (await shareFiles([files[+one.dataset.s]])) void 0; }
    else if (d) dl(files[+d.dataset.d]);
  });
}
async function openInfo() {
  let est = ''; try { const e = await navigator.storage.estimate(); est = `ใช้พื้นที่ ${(e.usage / 1048576).toFixed(0)} MB จาก ${(e.quota / 1048576).toFixed(0)} MB`; } catch { est = 'ตรวจพื้นที่ไม่ได้'; }
  let pers = false; try { pers = await navigator.storage.persisted(); } catch { /* unsupported */ }
  const pages = [...S.songs.values()].reduce((a, x) => a + x.n, 0);
  const s = sheet(`<h3 id="infoT">ข้อมูลและพื้นที่</h3><div class="help">เพลง ${S.songs.size} เพลง · ${pages} หน้า · ชุดเล่น ${S.sets.length} ชุด<br>${est}<br>ระบบ${pers ? '' : 'ยังไม่'}รับปากว่าจะไม่ล้างข้อมูลเอง${pers ? '' : ' (แนะนำสำรองไฟล์ไว้ และเปิดแอปจากไอคอนหน้าจอหลัก)'}<br><small>เวอร์ชัน ${BUILD}</small></div><h4 style="margin:12px 0 6px">บันทึกการทำงานล่าสุด</h4><p class="sub">ครั้งก่อนปิดแอป: ${LOG.prevClean ? 'ปกติ' : '<b style="color:var(--warn)">ไม่ปกติ (ค้างหรือถูกระบบปิด)</b>'}</p><pre class="rtlog" id="logbox" style="max-height:200px;overflow:auto;font-size:.72rem;white-space:pre-wrap">${esc([...LOG.prev.slice(-12), '--- เปิดแอปครั้งนี้ ---', ...LOG.a.slice(-12)].join('\n'))}</pre><div class="row2"><button class="btn o sm" id="logcopy">คัดลอกบันทึก</button></div><div class="row2"><button class="btn bad" data-w="1">ลบทุกอย่างในแอปนี้</button></div>`);
  { let taps = 0, tt = 0; $('#infoT', s.el).addEventListener('click', () => { taps++; clearTimeout(tt); tt = setTimeout(() => { taps = 0; }, 2500); if (taps >= 7) { taps = 0; s.close(); verifyPin('ใส่รหัส 4 หลักเพื่อเข้าเมนูเจ้าของ', 'เมนูเจ้าของ').then(ok => { if (ok) openOwner(); }); } }); }
  $('#logcopy', s.el).onclick = async () => { const t = $('#logbox', s.el).textContent; try { await navigator.clipboard.writeText(t); void 0; } catch { toast('คัดลอกไม่ได้ ถ่ายภาพหน้าจอแทนได้'); } };
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
/* press & hold a song name (or its picture) in the search list: delete it from the library, rename, or look at it big */
const RL = { t: 0, x: 0, y: 0, fired: false };
function resultMenu(row) {
  const x = S.songs.get(row.dataset.id); if (!x) return;
  openPop(row.querySelector('.rn') || row, [
    { ic: '🗑', t: 'ลบออกจากคลัง', s: 'ลบเพลงนี้ถาวร (ไม่ใช่แค่เอาออกจากคิว)', bad: true, fn: async () => { if (await delSongAsk(x)) renderResults(); } },
    { ic: '👁', t: 'ดูภาพใหญ่', s: 'เช็กว่าเป็นเวอร์ชันไหน', fn: () => previewSong(x, renderResults) },
    { ic: '✎', t: 'เปลี่ยนชื่อ', fn: async () => { const n = await askText({ title: 'เปลี่ยนชื่อเพลง', value: x.name, ok: 'บันทึก' }); if (n) { x.name = nfc(n); await DB.putSongMeta(x); renderAll(); } } },
  ]);
}
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('#res .rs .rn, #res .rs .th'); if (!h) return;
  clearTimeout(RL.t); RL.fired = false; RL.x = e.clientX; RL.y = e.clientY; const row = h.closest('.rs');
  RL.t = setTimeout(() => { RL.fired = true; try { navigator.vibrate?.(20); } catch { /* ok */ } resultMenu(row); }, 500);
});
document.addEventListener('contextmenu', e => { if (e.target.closest('#res .rs .rn, #res .rs .th')) e.preventDefault(); });
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => clearTimeout(RL.t)));
document.addEventListener('pointermove', e => { if (RL.t && Math.hypot(e.clientX - RL.x, e.clientY - RL.y) > 10) clearTimeout(RL.t); });
document.addEventListener('pointermove', e => { if (LP.t && Math.hypot(e.clientX - LP.x, e.clientY - LP.y) > 10) clearTimeout(LP.t); });
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => clearTimeout(LP.t)));
const ACT = {
  menu: openMenu, import: openImport, queue: openQueueSheet,
  add: () => { if (!S.searching) openSearch(); else $('#qi')?.focus(); },
  closesearch: closeSearch,
  qclear: () => { S.q = ''; if ($('#qi')) $('#qi').value = ''; renderResults(); $('#qi')?.focus(); },
  more: () => { S.shown += 150; renderResults(); },
  addnext: (d, el) => addFromRow(el, 'next', false),
  addend: (d, el) => addFromRow(el, 'end', false),
  nextsong: () => play(S.cur + 1),
  edit: () => enterEdit(),
  qimp: () => quickPick(),
  qset: () => toggleSetBar(),
  setchip: d => { if (justDragged($('#tsets'))) return; const x = S.sets.find(z => z.id === d.id); if (x && x.name !== S.setName) loadSet(x); },
  setnew: (d, el) => newChipMenu(el),
  web: (d) => openWeb(d.k),
  zoom: () => { zanim(); const r = $('#stage').getBoundingClientRect(); if (Z.s > 1) resetZoom(); else zoomAt(2.2, r.width / 2, r.height / 3); },
};
document.addEventListener('click', e => {
  if (LP.fired && e.target.closest('#res .rs button[data-act]')) { LP.fired = false; e.preventDefault(); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a.dataset, a); return; }
  const qc = e.target.closest('#qwrap .qc[data-i]'); if (qc && !justDragged($('#qwrap'))) play(+qc.dataset.i);
});
document.addEventListener('input', e => { if (e.target.id === 'qi') { S.q = e.target.value; S.shown = 120; renderResults(); } });

/* ───────────── annotations: finger drawing (pen / highlighter / eraser), kept per song page ───────────── */
const ANN = { cache: new Map(), page: null, strokes: [], undo: [], redo: [], cur: null, tool: 'h', color: '#facc15', show: (() => { try { return localStorage.getItem('sheet:ann') !== '0'; } catch { return true; } })() };
const ANN_RANGE = { p: [0.002, 0.012], h: [0.015, 0.06] };
ANN.lvl = (() => { try { return Object.assign({ p: 30, h: 55 }, JSON.parse(localStorage.getItem('sheet:annsize') || '{}')); } catch { return { p: 30, h: 55 }; } })(); // 0..100 per tool
ANN.op = (() => { try { return Object.assign({ p: 100, h: 60 }, JSON.parse(localStorage.getItem('sheet:annop') || '{}')); } catch { return { p: 100, h: 60 }; } })(); // 0..100 per tool
const annO = t => Math.max(0.05, ANN.op[t] / 100);
const annW = t => ANN_RANGE[t][0] + (ANN_RANGE[t][1] - ANN_RANGE[t][0]) * (ANN.lvl[t] / 100);
const ANN_COLORS = [['#ef4444', 'แดง'], ['#22c55e', 'เขียว'], ['#3b82f6', 'น้ำเงิน'], ['#facc15', 'เหลือง'], ['#f97316', 'ส้ม'], ['#a855f7', 'ม่วง'], ['#ec4899', 'ชมพู']];
const annKey = (id, p) => `ann:${id}:${p}`;
async function annLoad(id, page) {
  const k = annKey(id, page); if (ANN.cache.has(k)) return ANN.cache.get(k);
  let v = []; try { const r = await TH.get(k); if (r && Array.isArray(r.strokes)) v = r.strokes; } catch { /* none yet */ }
  ANN.cache.set(k, v); return v;
}
function annSave() {
  bumpShare(); const p = ANN.page; if (!p) return; const k = annKey(p.id, p.page); ANN.cache.set(k, ANN.strokes);
  (ANN.strokes.length ? TH.put(k, { v: 1, strokes: ANN.strokes }) : TH.run('readwrite', st => st.delete(k))).catch(() => toast('บันทึกรอยที่วาดไม่สำเร็จ'));
}
function pageGeom() {
  const img = $('#pg'); if (!img.naturalWidth) return null;
  const r = $('#stage').getBoundingClientRect(), W = r.width, H = r.height, ar = img.naturalWidth / img.naturalHeight, f = Math.min(W / ar, H);
  return { W, H, ar, dw: ar * f, dh: f, ox: (W - ar * f) / 2, oy: (H - f) / 2, r };
}
function annToNorm(cx, cy) {
  const g = pageGeom(); if (!g) return null; let x = cx - g.r.left, y = cy - g.r.top;
  x = (x - Z.tx) / Z.s; y = (y - Z.ty) / Z.s; const b = cropParams(); if (b) { x = (x - b.tx) / b.s; y = (y - b.ty) / b.s; }
  return [Math.min(1, Math.max(0, (x - g.ox) / g.dw)), Math.min(1, Math.max(0, (y - g.oy) / g.dh))];
}
function annPathD(pts, g) { let d = ''; for (let i = 0; i < pts.length; i += 2) d += (i ? 'L' : 'M') + (g.ox + pts[i] * g.dw).toFixed(1) + ' ' + (g.oy + pts[i + 1] * g.dh).toFixed(1); return d; }
function measureDark() { // a small brightness grid of the page, so ink can be made brighter where the page is dark
  ANN.grid = null; try { const im = $('#pg'); if (!im.naturalWidth) return; const W = 48, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) a[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; ANN.grid = { W, H, a }; } catch { ANN.grid = null; }
}
function strokeDark(k, G = ANN.grid) {
  if (!G) return false; let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let i = 0; i < k.pts.length; i += 2) { x0 = Math.min(x0, k.pts[i]); x1 = Math.max(x1, k.pts[i]); y0 = Math.min(y0, k.pts[i + 1]); y1 = Math.max(y1, k.pts[i + 1]); }
  const pad = (k.w || 0.01) * 1.5, ax = Math.max(0, Math.floor((x0 - pad) * G.W)), bx = Math.min(G.W - 1, Math.ceil((x1 + pad) * G.W)), ay = Math.max(0, Math.floor((y0 - pad) * G.H)), by = Math.min(G.H - 1, Math.ceil((y1 + pad) * G.H));
  let sum = 0, n = 0; for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { sum += G.a[y * G.W + x]; n++; } return n > 0 && sum / n < 110;
}
function annRender() {
  const sv = $('#annsvg'), sn = $('#annsvgn'); if (!sv || !sn) return; const g = pageGeom(), list = ANN.cur && ANN.cur.t !== 'e' ? [...ANN.strokes, ANN.cur] : ANN.strokes;
  const on = (ANN.show || S.edit) && g && list.length; sv.style.display = sn.style.display = on ? '' : 'none'; if (!on) { sv.innerHTML = sn.innerHTML = ''; return; }
  for (const x of [sv, sn]) { x.setAttribute('width', g.W); x.setAttribute('height', g.H); }
  const LIGHT = { '#ef4444': '#ff7a7a', '#22c55e': '#5dff8f', '#3b82f6': '#6fa9ff', '#facc15': '#ffe34d', '#f97316': '#ffa05a', '#a855f7': '#c99bff', '#ec4899': '#ff7fbd' };
  let multiply = '', normal = '';
  for (const k of list) {
    const dk = strokeDark(k), d = annPathD(k.pts.length < 4 ? [...k.pts, k.pts[0] + 0.0005, k.pts[1]] : k.pts, g), w = k.w * g.dw, c = dk ? (LIGHT[k.c] || k.c) : k.c;
    if (k.t === 'h') { // highlighter: tints the page like a marker (multiply) on light pages, plain translucent colour on dark ones
      const o = k.o != null ? k.o : (dk ? 0.8 : 0.45), p = `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${o}"/>`;
      if (dk) normal += p; else multiply += p;
    } else { // pen: solid ink, never blended; on dark pages a thin light edge keeps it readable
      const o = k.o != null ? k.o : 1, halo = dk && o > 0.5 ? `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${(0.85 * o).toFixed(2)}" stroke-width="${(w + 3).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      normal += halo + `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${o}"/>`;
    }
  }
  sv.innerHTML = multiply; sn.innerHTML = normal;
}
function annStart(e) {
  const zz = $('#esz'); if (zz) zz.hidden = true;
  const p = annToNorm(e.clientX, e.clientY); if (!p) return false; ANN.before = [...ANN.strokes];
  if (ANN.tool === 'e') { ANN.cur = { t: 'e' }; annErase(p); } else ANN.cur = { t: ANN.tool, c: ANN.color, w: annW(ANN.tool), o: +annO(ANN.tool).toFixed(2), pts: [p[0], p[1]] };
  annRender(); return true;
}
function annErase(p) {
  const g = pageGeom(); if (!g) return; const n = ANN.strokes.length;
  ANN.strokes = ANN.strokes.filter(k => { for (let i = 0; i < k.pts.length; i += 2) if (Math.hypot((k.pts[i] - p[0]) * g.ar, k.pts[i + 1] - p[1]) < 0.035) return false; return true; });
  if (ANN.strokes.length !== n) annRender();
}
function annMove(e) {
  if (!ANN.cur) return; const p = annToNorm(e.clientX, e.clientY); if (!p) return;
  if (ANN.cur.t === 'e') return annErase(p);
  const k = ANN.cur, lx = k.pts[k.pts.length - 2], ly = k.pts[k.pts.length - 1]; if (Math.hypot(p[0] - lx, p[1] - ly) < 0.0012) return;
  k.pts.push(p[0], p[1]); annRender();
}
function annEnd() {
  const k = ANN.cur; ANN.cur = null; if (!k) return;
  if (k.t === 'h' && k.pts.length < 4) { annRender(); return; } // a plain tap never leaves a highlight blob
  if (k.t !== 'e') {
    if (k.t === 'h' && k.pts.length >= 6) { // a roughly horizontal swipe becomes a neat straight highlight
      const xs = k.pts.filter((_, i) => i % 2 === 0), ys = k.pts.filter((_, i) => i % 2 === 1), w = Math.max(...xs) - Math.min(...xs), hgt = Math.max(...ys) - Math.min(...ys);
      if (w > 0.04 && hgt * 1.0 < w * 0.45 * 1.0 && hgt < 0.03) { const y = ys.reduce((a, b) => a + b, 0) / ys.length; k.pts = [Math.min(xs[0], xs[xs.length - 1]), y, Math.max(xs[0], xs[xs.length - 1]), y]; }
    }
    ANN.strokes = [...ANN.strokes, k];
  }
  if (ANN.strokes.length !== ANN.before.length || ANN.strokes.some((x, i) => x !== ANN.before[i])) { ANN.undo.push(ANN.before); ANN.redo = []; annSave(); }
  annRender(); etbPaint();
}
function annCancel() { if (!ANN.cur) return; ANN.cur = null; ANN.strokes = ANN.before || ANN.strokes; annRender(); }
function annUndo() { if (!ANN.undo.length) return; ANN.redo.push(ANN.strokes); ANN.strokes = ANN.undo.pop(); annSave(); annRender(); etbPaint(); }
function annRedo() { if (!ANN.redo.length) return; ANN.undo.push(ANN.strokes); ANN.strokes = ANN.redo.pop(); annSave(); annRender(); etbPaint(); }
async function annSetPage(song, page) { ANN.page = { id: song.id, page }; ANN.strokes = await annLoad(song.id, page); ANN.undo = []; ANN.redo = []; ANN.cur = null; }
function buildEtb() {
  const t = document.createElement('div'); t.id = 'etb'; t.hidden = true;
  t.innerHTML = `<div class="eg"><button data-e="tool" data-v="p">ปากกา</button><button data-e="tool" data-v="h">ไฮไลต์</button><button data-e="tool" data-v="e">ยางลบ</button><button data-e="size" aria-label="ขนาดเส้น">ขนาด</button><button data-e="crop">ครอป</button></div>
    <div class="eg ec">${ANN_COLORS.map(([c, n]) => `<button data-e="color" data-v="${c}" aria-label="${n}" style="--c:${c}"></button>`).join('')}</div>
    <div class="eg"><button data-e="undo" aria-label="ย้อนกลับ">↶</button><button data-e="redo" aria-label="ทำซ้ำ">↷</button><button data-e="prev" aria-label="หน้าก่อน">‹</button><button data-e="next" aria-label="หน้าถัดไป">›</button><button data-e="clear">ล้างหน้า</button><button data-e="done" class="done">เสร็จ</button></div>`;
  $('#app').append(t);
  const nb = document.createElement('div'); nb.id = 'enm'; nb.hidden = true;
  nb.innerHTML = '<span id="edrag" aria-label="ลากเพื่อย้ายแผง">⠿</span><input id="enmi" maxlength="120" autocomplete="off" aria-label="ชื่อเพลง"><button id="enmx" aria-label="ลบชื่อทั้งหมด">✕</button><button id="efold" aria-label="ยุบ/ขยายแผง">▴</button><div class="enc"><button id="ekey">คีย์ —</button><button id="ebpm">♩ —</button></div><div class="enc"><button id="eadd">＋ เพิ่มหน้าในเพลงนี้ (รูป/ไฟล์)</button></div><div class="enc enp"><button id="emvl">‹ ย้ายไปก่อน</button><button id="edelp">🗑 ลบหน้านี้</button><button id="emvr">ย้ายไปหลัง ›</button></div>';
  $('#ekey', nb).addEventListener('click', () => openMeta('key')); $('#ebpm', nb).addEventListener('click', () => openMeta('bpm'));
  { /* fold the panel to a small tab, or drag it away from what you are writing; both are remembered */
    const PK = 'sheet:enmpos', FK = 'sheet:enmfold', ed = $('#edrag', nb), fb = $('#efold', nb);
    const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
    const place = () => { const m = lsGet(PK); if (!m) { nb.classList.remove('moved'); nb.style.left = nb.style.top = ''; return; } try { const { x, y } = JSON.parse(m); nb.classList.add('moved'); const w = nb.offsetWidth, h = nb.offsetHeight; nb.style.left = Math.max(0, Math.min(innerWidth - w, x)) + 'px'; nb.style.top = Math.max(0, Math.min(innerHeight - h, y)) + 'px'; } catch { /* bad value */ } };
    const fold = f => { nb.classList.toggle('folded', f); fb.textContent = f ? '▾' : '▴'; lsSet(FK, f ? '1' : '0'); place(); };
    fb.addEventListener('click', () => fold(!nb.classList.contains('folded')));
    let dr = null;
    ed.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const r = nb.getBoundingClientRect(); dr = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }; try { ed.setPointerCapture(e.pointerId); } catch { /* ok */ } });
    ed.addEventListener('pointermove', e => { if (!dr || e.pointerId !== dr.id) return; dr.moved = true; nb.classList.add('moved'); const w = nb.offsetWidth, h = nb.offsetHeight; nb.style.left = Math.max(0, Math.min(innerWidth - w, e.clientX - dr.dx)) + 'px'; nb.style.top = Math.max(0, Math.min(innerHeight - h, e.clientY - dr.dy)) + 'px'; });
    const end = e => { if (!dr || e.pointerId !== dr.id) return; if (dr.moved) { const r = nb.getBoundingClientRect(); lsSet(PK, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } dr = null; };
    ed.addEventListener('pointerup', end); ed.addEventListener('pointercancel', end);
    ed.addEventListener('dblclick', () => { try { localStorage.removeItem(PK); } catch { /* ok */ } place(); }); // double-tap the grip = back to the usual spot
    window.addEventListener('resize', place);
    nb.classList.toggle('folded', lsGet(FK) === '1'); fb.textContent = nb.classList.contains('folded') ? '▾' : '▴'; nb._place = place;
  }
  $('#eadd', nb).addEventListener('click', () => { const sg = curSong(); if (sg) addPagesTo(sg); });
  $('#emvl', nb).addEventListener('click', () => movePage(-1)); $('#emvr', nb).addEventListener('click', () => movePage(1)); $('#edelp', nb).addEventListener('click', () => deletePage());
  $('#app').append(nb);
  $('#enmx').addEventListener('click', () => { const i = $('#enmi'); i.value = ''; i.focus(); });
  $('#enmi').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('#enmi').addEventListener('blur', () => saveEditName());
  const z = document.createElement('div'); z.id = 'esz'; z.hidden = true;
  z.innerHTML = `<div class="ezp"><i id="ezd"></i></div><div class="ezc"><div class="ezrow"><span>ขนาด</span><input id="ezr" type="range" min="0" max="100" step="1" aria-label="ขนาดเส้น"><div class="ezq"><button data-q="20">บาง</button><button data-q="50">กลาง</button><button data-q="85">หนา</button></div></div><div class="ezrow"><span>ความทึบ</span><input id="ezo" type="range" min="0" max="100" step="1" aria-label="ความทึบ"><b id="ezov">100</b></div></div>`;
  $('#app').append(z);
  const setLvl = v => { ANN.lvl[ANN.tool] = Math.min(100, Math.max(0, +v)); try { localStorage.setItem('sheet:annsize', JSON.stringify(ANN.lvl)); } catch { /* private mode */ } etbPaint(); };
  $('#ezr', z).addEventListener('input', e => setLvl(e.target.value));
  $('#ezo', z).addEventListener('input', e => { ANN.op[ANN.tool] = Math.min(100, Math.max(0, +e.target.value)); try { localStorage.setItem('sheet:annop', JSON.stringify(ANN.op)); } catch { /* private mode */ } etbPaint(); });
  z.addEventListener('click', e => { const q = e.target.closest('[data-q]'); if (q) setLvl(q.dataset.q); });
  t.addEventListener('click', async e => {
    const b = e.target.closest('[data-e]'); if (!b) return; const a = b.dataset.e;
    if (a === 'size') { if (ANN.tool !== 'e') $('#esz').hidden = !$('#esz').hidden; return etbPaint(); }
    if (a === 'tool') { ANN.tool = b.dataset.v; $('#esz').hidden = true; } else if (a === 'color') { ANN.color = b.dataset.v; if (ANN.tool === 'e') ANN.tool = 'h'; }
    else if (a === 'undo') annUndo(); else if (a === 'redo') annRedo();
    else if (a === 'prev') turn(-1); else if (a === 'next') turn(1);
    else if (a === 'clear') { if (ANN.strokes.length && await confirmDel('ล้างรอยที่วาดทั้งหน้านี้?', 'รูปโน้ตไม่ถูกลบ ลบแค่รอยที่วาดไว้', 'ล้างรอย')) { ANN.undo.push(ANN.strokes); ANN.redo = []; ANN.strokes = []; annSave(); annRender(); } }
    else if (a === 'crop') return startCrop();
    else if (a === 'done') exitEdit();
    etbPaint();
  });
  etbPaint();
}
function etbPaint() {
  const t = $('#etb'); if (!t) return;
  t.querySelectorAll('[data-e=tool]').forEach(b => b.classList.toggle('on', b.dataset.v === ANN.tool));
  t.querySelectorAll('[data-e=color]').forEach(b => b.classList.toggle('on', b.dataset.v === ANN.color && ANN.tool !== 'e'));
  const z = $('#esz'); if (z) {
    if (ANN.tool === 'e') z.hidden = true;
    t.querySelector('[data-e=size]').disabled = ANN.tool === 'e'; t.querySelector('[data-e=size]').classList.toggle('on', !z.hidden);
    if (ANN.tool !== 'e') { $('#ezr', z).value = ANN.lvl[ANN.tool]; $('#ezo', z).value = ANN.op[ANN.tool]; $('#ezov', z).textContent = ANN.op[ANN.tool]; const d = $('#ezd', z), px = Math.max(3, annW(ANN.tool) * 560);
    d.style.width = d.style.height = px + 'px'; d.style.background = ANN.color; d.style.opacity = annO(ANN.tool); d.style.borderRadius = ANN.tool === 'h' ? '999px' : '50%'; }
  }
  t.querySelector('[data-e=undo]').disabled = !ANN.undo.length; t.querySelector('[data-e=redo]').disabled = !ANN.redo.length;
}

/* manual crop of one page: drag the frame, press เสร็จ and it is saved for that page (the picture itself is never changed) */
const CR = { box: null, drag: null };
function crPaint() {
  const ov = $('#cropov'), g = pageGeom(); if (!ov || !g || !CR.box) return; const b = CR.box;
  const L = g.ox + b.x0 * g.dw, T = g.oy + b.y0 * g.dh, R = g.ox + b.x1 * g.dw, B = g.oy + b.y1 * g.dh;
  const f = $('.crf', ov); f.style.cssText = `left:${L}px;top:${T}px;width:${R - L}px;height:${B - T}px`;
  const d = ov.querySelectorAll('.crd'); d[0].style.cssText = `left:0;top:0;width:100%;height:${T}px`; d[1].style.cssText = `left:0;top:${B}px;width:100%;bottom:0`;
  d[2].style.cssText = `left:0;top:${T}px;width:${L}px;height:${B - T}px`; d[3].style.cssText = `left:${R}px;top:${T}px;right:0;height:${B - T}px`;
}
function crMove(e) {
  const c = CR.drag; if (!c || e.pointerId !== c.id) return; const g = pageGeom(); if (!g) return;
  const dx = (e.clientX - c.x) / g.dw, dy = (e.clientY - c.y) / g.dh, o = c.b, m = 0.08, b = { ...o };
  if (c.h === 'm') { const w = o.x1 - o.x0, h = o.y1 - o.y0; b.x0 = Math.min(1 - w, Math.max(0, o.x0 + dx)); b.y0 = Math.min(1 - h, Math.max(0, o.y0 + dy)); b.x1 = b.x0 + w; b.y1 = b.y0 + h; }
  else { if (c.h.includes('l')) b.x0 = Math.min(o.x1 - m, Math.max(0, o.x0 + dx)); if (c.h.includes('r')) b.x1 = Math.max(o.x0 + m, Math.min(1, o.x1 + dx));
    if (c.h.includes('t')) b.y0 = Math.min(o.y1 - m, Math.max(0, o.y0 + dy)); if (c.h.includes('b')) b.y1 = Math.max(o.y0 + m, Math.min(1, o.y1 + dy)); }
  CR.box = b; crPaint(); e.stopPropagation();
}
function startCrop() {
  const song = curSong(), g = pageGeom(); if (!song || !g) return;
  CROP.editing = true; resetZoom(); annRender(); $('#esz').hidden = true;
  const g2 = pageGeom(); CR.box = { x0: 0.03, y0: 0.03, x1: 0.97, y1: 0.97 };
  const cur = CROP.box; if (cur && CROP.manual) CR.box = { x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: cur.y1 };
  else if (cur) CR.box = { x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: cur.y1 };
  const ov = document.createElement('div'); ov.id = 'cropov';
  ov.innerHTML = '<i class="crd"></i><i class="crd"></i><i class="crd"></i><i class="crd"></i><div class="crf" data-h="m">' + ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'].map(h => `<b class="crh ${h}" data-h="${h}"></b>`).join('') + '</div>';
  $('#stage').append(ov);
  ov.addEventListener('pointerdown', e => { const h = e.target.closest('[data-h]'); e.stopPropagation(); if (!h) return; CR.drag = { id: e.pointerId, h: h.dataset.h, x: e.clientX, y: e.clientY, b: { ...CR.box } }; try { ov.setPointerCapture(e.pointerId); } catch { /* ok */ } });
  ov.addEventListener('pointermove', crMove);
  ['pointerup', 'pointercancel'].forEach(t => ov.addEventListener(t, e => { if (CR.drag && e.pointerId === CR.drag.id) CR.drag = null; e.stopPropagation(); }));
  const bar = document.createElement('div'); bar.id = 'ctb';
  bar.innerHTML = '<span>ลากขอบหรือมุมเพื่อเลือกส่วนที่จะเก็บ</span><button data-c="reset">คืนค่า</button><button data-c="cancel">ยกเลิก</button><button data-c="done" class="done">เสร็จ</button>';
  $('#app').append(bar); $('#etb').hidden = true; $('#enm').hidden = true;
  bar.addEventListener('click', async e => {
    const b = e.target.closest('[data-c]'); if (!b) return; const a = b.dataset.c;
    if (a === 'reset') { await cropSet(song.id, S.page, null); CROP.manual = false; endCrop(true); void 0; }
    else if (a === 'cancel') endCrop(false);
    else { const bx = CR.box, full = bx.x0 <= 0.001 && bx.y0 <= 0.001 && bx.x1 >= 0.999 && bx.y1 >= 0.999;
      await cropSet(song.id, S.page, full ? null : { x0: bx.x0, y0: bx.y0, x1: bx.x1, y1: bx.y1, ar: g2.ar }); endCrop(true); void 0; }
  });
  crPaint(); window.addEventListener('resize', crPaint);
}
function endCrop(reload) {
  CROP.editing = false; CR.drag = null; window.removeEventListener('resize', crPaint); $('#cropov')?.remove(); $('#ctb')?.remove(); $('#etb').hidden = false; $('#enm').hidden = false;
  if (reload) showPage(); else { applyZoom(); annRender(); } etbPaint();
}
/* key + tempo per song: chips in the edit bar, a small panel to set them, and a quiet blinking dot on the score */
const TAPS = [];
const noteFor = (x, rec) => { const a = rec || activeSet(); return (a && a.notes && a.notes[x.id]) || null; };
const withKey = x => { const n = noteFor(x) || {}, k = n.key || x.key || ''; return x.name + (k ? ' · ' + k : '') + (n.key && x.key && n.key !== x.key ? ` (โน้ต ${x.key})` : '') + (n.who ? ' · ' + n.who : '') + (n.shift ? ' · ' + n.shift : '') + (n.note ? ' · ' + n.note : '') + (n.sec ? ' · ช่วง ' + n.sec : ''); };
/* hold the green song name, let go: the share sheet opens with this song's pictures (they are prepared in the background so it is instant) */
const FINGER = { n: 0 }; document.addEventListener('pointerdown', () => { FINGER.n++; }, true); document.addEventListener('pointerup', () => { FINGER.n = Math.max(0, FINGER.n - 1); }, true); document.addEventListener('pointercancel', () => { FINGER.n = 0; }, true);
const SHARE = { ver: 0, id: null, marks: null, files: null, t: 0 };
function bumpShare() { SHARE.ver++; SHARE.files = null; schedulePrep(4000); }
function schedulePrep(ms) {
  clearTimeout(SHARE.t); SHARE.t = setTimeout(async () => {
    const song = curSong(); if (!song || song.n > 10 || S.edit) return; if (document.hidden || FINGER.n > 0) { schedulePrep(2500); return; } const marks = shareMarksOn(), ver = SHARE.ver;
    if (SHARE.files && SHARE.id === song.id && SHARE.marks === marks && SHARE.vr === ver) return;
    try { const files = []; for (let i = 0; i < song.n; i++) { const f = await pageFile(song, i, marks); if (f) files.push(f); }
      if (ver === SHARE.ver && curSong() === song) { SHARE.files = files; SHARE.id = song.id; SHARE.marks = marks; SHARE.vr = ver; } } catch { /* the sheet will prepare on demand */ }
  }, ms);
}
function shareCurrent() { // runs synchronously inside the tap, so iOS still counts it as a user action
  const song = curSong(); if (!song) return;
  if (SHARE.files && SHARE.id === song.id && SHARE.marks === shareMarksOn() && SHARE.vr === SHARE.ver && SHARE.files.length && navigator.canShare && navigator.canShare({ files: SHARE.files })) {
    logEv('ส่งเพลงเดียว (กดค้างที่ชื่อ)'); navigator.share({ files: SHARE.files }).catch(e => { if (!e || e.name !== 'AbortError') shareScores(false); }); return;
  }
  shareScores(false); // not prepared yet: the two-step sheet
}
function initTagShare() {
  const t = $('#songtag'); if (!t) return; let timer = 0, down = false, ready = false;
  const reset = () => { down = false; ready = false; clearTimeout(timer); t.classList.remove('hold'); tagPaint(); };
  t.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); down = true; ready = false; t.classList.add('hold'); try { t.setPointerCapture(e.pointerId); } catch { /* ok */ }
    timer = setTimeout(() => { if (down) { ready = true; t.textContent = '⇪ ปล่อยเพื่อส่งเพลงนี้'; t.classList.add('go'); try { navigator.vibrate?.(25); } catch { /* ok */ } } }, 480); });
  t.addEventListener('pointerup', e => { e.stopPropagation(); if (!down) return; const go = ready; t.classList.remove('go'); reset(); if (go) shareCurrent(); });
  t.addEventListener('pointercancel', () => { t.classList.remove('go'); reset(); });
  t.addEventListener('contextmenu', e => e.preventDefault());
}
function tagPaint() { const song = curSong(), t = $('#songtag'); if (t) { t.textContent = ''; if (song) { const n = document.createElement('span'); n.className = 'tn'; n.textContent = withKey(song); t.append(n); if (song.n > 1) { const p = document.createElement('span'); p.className = 'tp'; p.textContent = `${S.page + 1}/${song.n}`; t.append(p); } } t.hidden = !song; } }
const DOT = { off: new Set() }; // songs whose blinking dot you switched off for now (until the app is reopened)
function dotPaint() {
  tagPaint();
  const song = curSong(), d = $('#bpmdot'); if (!d) return;
  const ok = song && song.bpm >= 30; d.hidden = !ok;
  if (ok) { const off = DOT.off.has(song.id); d.classList.toggle('off', off); d.querySelector('span').textContent = off ? 'ปิด' : song.bpm; const i = d.querySelector('i'); i.style.animation = 'none'; if (!off) { void i.offsetWidth; i.style.animation = `bpmflash ${(60 / song.bpm).toFixed(3)}s linear infinite`; } }
  const k = $('#ekey'), b = $('#ebpm'); if (k && song) { k.textContent = 'คีย์ ' + (song.key || '—'); b.textContent = '♩ ' + (song.bpm || '—'); }
}
async function metaSave(song) { try { await DB.putSongMeta(song); } catch { toast('บันทึกคีย์/ความเร็วไม่สำเร็จ'); } dotPaint(); }
function closeMeta() { $('#kbp')?.remove(); document.removeEventListener('pointerdown', metaOutside, true); }
function metaOutside(e) { if (!e.target.closest('#kbp,#ekey,#ebpm')) closeMeta(); }
function openMeta(which) {
  const song = curSong(); if (!song) return; if ($('#kbp')) closeMeta();
  const p = document.createElement('div'); p.id = 'kbp';
  const parse = t => { const m = /^([A-Ga-g])([#♯b♭]?)\s*(m|min|minor)?/.exec((t || '').trim()); return m ? { r: m[1].toUpperCase(), a: m[2].replace('♯', '#').replace('♭', 'b'), m: !!m[3] } : { r: '', a: '', m: false }; };
  const st = parse(song.key);
  p.innerHTML = `<div class="kr"><b>คีย์</b><input id="kbk" maxlength="8" autocomplete="off" value="${esc(song.key || '')}" aria-label="คีย์"><button data-k="clear">ล้าง</button></div>
    <div class="kr kk">${'CDEFGAB'.split('').map(l => `<button data-r="${l}">${l}</button>`).join('')}<button data-a="#">♯</button><button data-a="b">♭</button><button data-mn="1">m</button></div>
    <div class="kr"><b>ความเร็ว</b><button data-b="-1">−</button><div class="kv"><input id="kbb" type="number" inputmode="numeric" min="30" max="240" value="${song.bpm || ''}" placeholder="BPM" aria-label="BPM"></div><button data-b="1">+</button><button class="tap" data-tap="1">แตะตามจังหวะ</button></div>
    <div class="kr kq">${'1234567890'.split('').map(d => `<button data-dg="${d}">${d}</button>`).join('')}<button data-dg="x" aria-label="ลบ">⌫</button></div>
    <div class="kr kh"><small>แตะ “แตะตามจังหวะ” 4–5 ครั้งตามเพลง แอปคำนวณให้ · จุดไฟกระพริบจะอยู่มุมขวาบนของโน้ต</small></div>`;
  $('#app').append(p); setTimeout(() => document.addEventListener('pointerdown', metaOutside, true), 0);
  let kbuf = '', kfresh = true; const paintBq = () => { kfresh = true; kbuf = song.bpm ? String(song.bpm) : ''; };
  const paintKey = () => { $('#kbk', p).value = st.r ? st.r + st.a + (st.m ? 'm' : '') : $('#kbk', p).value; p.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === st.r)); p.querySelectorAll('[data-a]').forEach(b => b.classList.toggle('on', b.dataset.a === st.a)); p.querySelector('[data-mn]').classList.toggle('on', st.m); };
  const saveKey = () => { song.key = $('#kbk', p).value.trim(); metaSave(song); };
  const setBpm = v => { v = Math.round(+v); if (!(v >= 30)) { if (!v) { delete song.bpm; $('#kbb', p).value = ''; paintBq(); metaSave(song); } return; } v = Math.min(240, v); song.bpm = v; $('#kbb', p).value = v; paintBq(); metaSave(song); };
  paintKey(); paintBq();
  p.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) { st.r = b.dataset.r; paintKey(); saveKey(); }
    else if (b.dataset.a) { st.a = st.a === b.dataset.a ? '' : b.dataset.a; if (!st.r) st.r = 'C'; paintKey(); saveKey(); }
    else if (b.dataset.mn) { st.m = !st.m; if (!st.r) st.r = 'C'; paintKey(); saveKey(); }
    else if (b.dataset.k === 'clear') { st.r = ''; st.a = ''; st.m = false; $('#kbk', p).value = ''; paintKey(); saveKey(); }
    else if (b.dataset.dg) {
      const d = b.dataset.dg; if (d === 'x') kbuf = kbuf.slice(0, -1); else { if (kfresh || kbuf.length >= 3) kbuf = d; else kbuf += d; if (+kbuf > 240) kbuf = d; } kfresh = false;
      $('#kbb', p).value = kbuf; if (+kbuf >= 30) setBpm(kbuf);
    }
    else if (b.dataset.b) setBpm((song.bpm || 90) + (+b.dataset.b));
    else if (b.dataset.tap) {
      const now = performance.now(); if (TAPS.length && now - TAPS[TAPS.length - 1] > 2500) TAPS.length = 0; TAPS.push(now); if (TAPS.length > 8) TAPS.shift();
      if (TAPS.length >= 2) setBpm(60000 / ((TAPS[TAPS.length - 1] - TAPS[0]) / (TAPS.length - 1)));
    }
  });
  $('#kbk', p).addEventListener('input', () => { Object.assign(st, parse($('#kbk', p).value)); p.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === st.r)); saveKey(); });
  $('#kbb', p).addEventListener('change', e => setBpm(e.target.value));
  setTimeout(() => (which === 'bpm' ? $('#kbb', p) : null)?.select?.(), 50);
}
async function saveEditName() {
  const song = curSong(), i = $('#enmi'); if (!song || !i) return;
  let n = nfc(i.value).replace(/\s+/g, ' ').trim();
  if (!n || n === song.name) { i.value = song.name; return; }
  const have = new Set([...S.songs.values()].filter(x => x.id !== song.id).map(x => nfc(x.name).toLowerCase()));
  if (have.has(n.toLowerCase())) { let k = 2; while (have.has((n + ' (' + k + ')').toLowerCase())) k++; n += ' (' + k + ')'; }
  song.name = n; i.value = n;
  try { await DB.putSongMeta(song); } catch { toast('บันทึกชื่อไม่สำเร็จ'); return; }
  renderAll(); toast('เปลี่ยนชื่อเป็น “' + n + '” แล้ว');
}
function enterEdit() {
  logEv('เข้าโหมดแก้ไข');
  if (!curSong()) return; S.edit = true; ANN.undo = []; ANN.redo = []; clearTimeout(FS.t);
  $('#app').classList.add('reading', 'editing'); $('#etb').hidden = false; $('#enmi').value = curSong().name; $('#enm').hidden = false; $('#enm')._place?.(); pageBtnsPaint(); dotPaint(); etbPaint(); annRender(); void 0;
}
async function exitEdit() { logEv('ออกโหมดแก้ไข'); closeMeta(); if (CROP.editing) endCrop(false); try { await saveEditName(); } catch { /* keep going */ } $('#enm').hidden = true; $('#esz').hidden = true; S.edit = false; ANN.cur = null; $('#app').classList.remove('editing', 'reading'); $('#etb').hidden = true; annRender(); chromeArm(); }
function toggleAnn() { ANN.show = !ANN.show; try { localStorage.setItem('sheet:ann', ANN.show ? '1' : '0'); } catch { /* private mode */ } annRender(); void 0; }

/* reading mode: header and queue strip slide away after a few idle seconds so the score gets the whole screen */
const FS = { on: (() => { try { return localStorage.getItem('sheet:fs') !== '0'; } catch { return true; } })(), t: 0 };
const BAR_MS = 4500; // the bars fold away by themselves this long after the last touch
function chromeArm() {
  clearTimeout(FS.t); if (!FS.on) return;
  FS.t = setTimeout(() => {
    if (S.edit) return;
    if (FS.hold || document.querySelector('#strip.dragging') || document.querySelector('.dragclone') || document.querySelector('#mkpop')) return chromeArm(); // finger or a menu is still in use
    if (!S.searching && !document.querySelector('#layer .scrim') && !$('#setbar') && curSong()) $('#app').classList.add('reading');
  }, BAR_MS);
}
let hideT = 0;
function chromeShow() { if (S.edit) return; $('#app').classList.remove('reading'); chromeArm(); }
const topPrefs = () => { try { return { m: localStorage.getItem('sheet:topmode') || 'full', g: Math.min(80, Math.max(0, +(localStorage.getItem('sheet:topgap') || 22))) }; } catch { return { m: 'full', g: 22 }; } };
function applyTop() { const t = topPrefs(), a = $('#app'); if (!a) return; a.dataset.top = t.m; a.style.setProperty('--tgap', t.g + 'px'); }
function openTopBar() { // how the top of the score meets the clock strip: choose what looks best on this iPad
  const t = topPrefs();
  const s = sheet(`<h3>ขอบบนของจอ</h3><p class="sub">ใช้ตอนแถบเมนูพับ ลองเลือกแบบที่โน้ตชัดที่สุด แล้วปิดหน้าต่างนี้ รอแถบพับ (หรือแตะกลางโน้ต) เพื่อดูผล</p>
    <div class="pills" id="tbm">${[['full', 'โน้ตเต็มขอบ'], ['black', 'แถบดำ'], ['white', 'แถบขาว']].map(([k, n]) => `<button data-k="${k}" class="${t.m === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="kr" style="margin:10px 0 4px"><b style="width:96px;flex:none;font-size:.82rem">ความสูงแถบ</b><input id="tbg" type="range" min="0" max="80" step="2" value="${t.g}" style="flex:1"><b id="tbv" style="width:46px;text-align:right">${t.g}</b></div>
    <p class="sub" style="margin-top:6px">แถบดำ/ขาว เว้นที่ใต้นาฬิกาให้ฝ้าของระบบไปทับแถบแทนที่จะทับโน้ต ปรับความสูงเพิ่มถ้าบรรทัดบนยังมัว (ค่ามาตรฐาน 22)</p>
    <div class="row2"><button class="btn" data-x="1">เสร็จ</button></div>`);
  const save = (m, g) => { try { if (m) localStorage.setItem('sheet:topmode', m); if (g != null) localStorage.setItem('sheet:topgap', String(g)); } catch { /* private mode */ } applyTop(); };
  s.el.addEventListener('click', e => { const b = e.target.closest('#tbm [data-k]'); if (b) { save(b.dataset.k); s.el.querySelectorAll('#tbm button').forEach(x => x.classList.toggle('on', x === b)); return; } if (e.target.closest('[data-x]')) s.close(); });
  $('#tbg', s.el).addEventListener('input', e => { $('#tbv', s.el).textContent = e.target.value; save(null, +e.target.value); });
}
function toggleTrim() { CROP.on = !CROP.on; try { localStorage.setItem('sheet:trim', CROP.on ? '1' : '0'); } catch { /* private mode */ } if (!CROP.on) CROP.box = null; showPage(); void 0; }
function toggleFs() { FS.on = !FS.on; try { localStorage.setItem('sheet:fs', FS.on ? '1' : '0'); } catch { /* private mode */ } if (FS.on) { chromeArm(); void 0; } else { clearTimeout(FS.t); chromeShow(); void 0; } }
document.addEventListener('pointerdown', e => { if (e.target.closest('#strip,.top,#layer,#panel')) { FS.hold = true; chromeArm(); } }, true);
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { if (FS.hold) { FS.hold = false; chromeArm(); } }, true));
$('#qwrap').addEventListener('scroll', () => chromeArm(), { passive: true });
$('#tsets').addEventListener('scroll', () => chromeArm(), { passive: true });

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
  if (np >= song.n) { if (cross && S.cur + 1 < S.queue.length) { play(S.cur + 1); void 0; } else if (cross) void 0; return; }
  if (np < 0) { if (cross && S.cur > 0) { play(S.cur - 1); const prev = curSong(); if (prev) { S.page = prev.n - 1; showPage(); void 0; } } return; }
  S.page = np; if (Z.s > 1) zanim(); resetZoom(); showPage(); // a new page always starts fully zoomed out
}
let lastCorner = 0, pendingSearch = 0;
// opened from the click that follows the double tap, so iOS accepts the keyboard
document.addEventListener('click', () => { if (pendingSearch && Date.now() - pendingSearch < 700) { pendingSearch = 0; if (!S.searching) openSearch(); } }, true);
// edge tap = turn the page; a second quick tap on the same edge jumps to the next / previous song instead
let lastEdge = null;
function edgeTap(side) { // left/right edge: a double tap skips to the previous/next song (a single tap only folds the bars; pages turn by swiping)
  const now = Date.now();
  if (lastEdge && lastEdge.side === side && now - lastEdge.t < 330) {
    lastEdge = null; clearTimeout(hideT);
    const to = S.cur + side;
    if (to < 0 || to >= S.queue.length) { void 0; return; }
    play(to); void 0; return;
  }
  lastEdge = { side, t: now };
  if (FS.on && !$('#app').classList.contains('reading') && curSong()) { clearTimeout(hideT); hideT = setTimeout(() => { if (!S.edit && !S.searching && !document.querySelector('#layer .scrim')) $('#app').classList.add('reading'); }, 340); }
}
// gestures on the score: swipe / edge tap = turn page; pinch = zoom; drag when zoomed = pan; double tap in the middle = zoom
(() => {
  const stage = $('#stage'), ptrs = new Map(); let g = null, lastTap = null;
  const rel = () => stage.getBoundingClientRect();
  const mid = () => { const [a, b] = [...ptrs.values()]; const r = rel(); return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
  const dropStale = () => { ptrs.clear(); g = null; };
  document.addEventListener('visibilitychange', dropStale); window.addEventListener('blur', dropStale);
  stage.addEventListener('pointerdown', e => {
    for (const [id, v] of ptrs) if (Date.now() - v.t > 2500) { ptrs.delete(id); logEv('ล้างนิ้วที่ค้าง'); if (!ptrs.size) g = null; } // a finger that never came up must not turn the next swipe into a pinch
    if (e.target.closest('button')) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (S.edit && ptrs.size === 0) { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() }); g = annStart(e) ? { mode: 'draw' } : null; return; }
    if (S.edit && ptrs.size === 1) annCancel();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });
    if (ptrs.size === 2) { const m = mid(); g = { mode: 'pinch', d: m.d, mx: m.x, my: m.y }; }
    else if (ptrs.size === 1) g = { mode: 'one', x0: e.clientX, y0: e.clientY, tx0: Z.tx, ty0: Z.ty, t: Date.now(), moved: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });
    if (g.mode === 'draw') { annMove(e); return; }
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
    if (g.mode === 'draw') { annEnd(); g = null; return; }
    if (g.mode === 'pinch') { if (ptrs.size < 2) { if (Z.s < 1.15) { if (Z.s > 1) zanim(); resetZoom(); } const [rest] = [...ptrs.values()]; g = rest ? { mode: 'one', x0: rest.x, y0: rest.y, tx0: Z.tx, ty0: Z.ty, t: Date.now(), moved: true, ignore: true } : null; } return; }
    if (g.ignore) { g = null; return; } // the finger left over after a pinch is not a tap
    if (S.edit) { g = null; return; }
    const dx = pt.x - g.x0, dy = pt.y - g.y0, moved = Math.hypot(dx, dy), r = rel(), x = (pt.x - r.left) / r.width, cx = pt.x - r.left, cy = pt.y - r.top, quick = Date.now() - g.t < 600; g = null;
    if (Z.s < 1.03 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { turn(dx < 0 ? 1 : -1); return; }
    if (moved >= 12 || !quick) return;
    if (S.searching) { closeSearch(); lastTap = null; lastEdge = null; return; } // tapping the score anywhere closes the search
    const nb = $('#nextSong'), br = nb.hidden ? null : nb.getBoundingClientRect(), onBtn = !!br && pt.x >= br.left && pt.x <= br.right && pt.y >= br.top && pt.y <= br.bottom;
    if (!onBtn && x > 0.8 && cy > r.height * 0.93) { // bottom-right corner: a quick double tap opens the search with the keyboard
      const now = Date.now();
      if (lastCorner && now - lastCorner < 330) { lastCorner = null; lastEdge = null; clearTimeout(hideT); pendingSearch = now; lastTap = null; return; }
      lastCorner = now;
    }
    if ($('#app').classList.contains('reading') && !onBtn && (cy < r.height * 0.1 || cy > r.height * 0.9)) { chromeShow(); return; } // tap the top/bottom edge to bring the bars back
    if (Z.s < 1.03 && (x > 0.68 || x < 0.32)) { edgeTap(x > 0.5 ? 1 : -1); lastTap = null; }
    else { // middle (or any place while zoomed): one tap folds the bars, a double tap zooms in / back out
      if (lastTap && Date.now() - lastTap.t < 330 && Math.hypot(cx - lastTap.x, cy - lastTap.y) < 40) { lastTap = null; clearTimeout(hideT); zanim(); if (Z.s > 1) resetZoom(); else zoomAt(2.2, cx, cy); }
      else { lastTap = { t: Date.now(), x: cx, y: cy }; if (FS.on && !$('#app').classList.contains('reading') && curSong()) { clearTimeout(hideT); hideT = setTimeout(() => { if (!S.edit && !S.searching && !document.querySelector('#layer .scrim')) $('#app').classList.add('reading'); }, 340); } }
    }
  };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (!ptrs.size) g = null; });
  window.addEventListener('resize', () => { clampZ(); applyZoom(); });
  new ResizeObserver(() => { clampZ(); applyZoom(); annRender(); }).observe(stage);
})();
// stop the browser from zooming the whole page when pinching on the iPad
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => e.preventDefault());
sortable($('#qwrap'), { axis: 'x', itemSel: '.qc[data-id]', hold: 450, onstart: () => $('#strip').classList.add('dragging'), onend: () => $('#strip').classList.remove('dragging'),
  onDrop: ids => setQueueOrder(ids), onRemove: id => removeFromQueue(S.queue.indexOf(id)) });
let heldChip = null;
$('#tsets').addEventListener('pointerdown', e => { const c = e.target.closest('.tc[data-id]'); heldChip = c ? c.dataset.id : null; }, true);
sortable($('#tsets'), { axis: 'x', itemSel: '.tc[data-id]', hold: 450, onDrop: (ids, moved) => {
  if (moved < 10) { const x = S.sets.find(z => z.id === heldChip), el = $('#tsets .tc[data-id="' + heldChip + '"]'); if (x && el) chipMenu(x, el); return; } // held and let go without moving = menu
  const by = new Map(S.sets.map(z => [z.id, z])); const next = ids.map(i => by.get(i)).filter(Boolean); S.sets.forEach(z => { if (!next.includes(z)) next.push(z); });
  next.forEach((z, i) => { if (z.ord !== i + 1) { z.ord = i + 1; DB.putSet(z).catch(() => {}); } }); S.sets = next; renderTop(); void 0;
} });
$('#strip').insertAdjacentHTML('afterbegin', '<div class="rmzone">ลากขึ้นมาตรงนี้แล้วปล่อย = เอาออกจากคิว ↑</div>');

// keep the whole app inside the visible area when the on-screen keyboard is open
(() => {
  const vv = window.visualViewport, app = $('#app'); if (!vv) return;
  const root = document.documentElement.style;
  const fit = () => { app.style.height = vv.height + 'px'; app.style.transform = `translateY(${vv.offsetTop}px)`; root.setProperty('--vvh', vv.height + 'px'); root.setProperty('--vvt', vv.offsetTop + 'px'); window.scrollTo(0, 0); };
  // a field inside a sheet that the keyboard would cover is scrolled into view
  document.addEventListener('focusin', e => { if (e.target.closest?.('.sheet')) setTimeout(() => { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browser */ } }, 350); });
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
})();
// keep the screen awake while playing
let wake = null;
async function keepAwake() { try { if (navigator.wakeLock && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ } }
document.addEventListener('visibilitychange', keepAwake); document.addEventListener('pointerdown', keepAwake, { once: true });

/* ───────────── licence: free trial + unlock code (signed, checked offline) + owner tools ─────────────
   The lock is OFF until the owner's public key is put in LIC.PUB. A code is signed with the owner's private key (kept only in the owner's
   browser); the app checks the signature with the public key, so codes cannot be made without that private key. */
const LIC = { PUB: 'BF5oY9GVsSreYWetnnNvmCjx4HvUNbMEKbuyBtC4hrlUcHRBT2Udq0uXGvSUJWqGiaFy0llFuaxbnLVs3y2ZdL0', TRIAL_DAYS: 14, GRACE: 0, AWAY: 30 * 60000, CONTACT: 'ขอรหัสปลดล็อกได้จากผู้พัฒนาแอปทาง LINE', K: 'sheet:lic', OWNER: 'sheet:ownerkey', ISSUED: 'sheet:issued' };
const b64u = {
  enc: u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)),
};
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const b32enc = u => { let acc = 0, bits = 0, out = ''; for (const b of u) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; acc &= (1 << bits) - 1; } } return out; };
const b32dec = t => { t = String(t).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'); if (t.length !== 8) return null; let acc = 0, bits = 0; const out = []; for (const ch of t) { const v = B32.indexOf(ch); if (v < 0) return null; acc = (acc << 5) | v; bits += 5; if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } } return Uint8Array.from(out); };
function devId() { let v = null; try { v = localStorage.getItem('sheet:dev'); } catch { /* blocked */ } if (!v || v.length !== 8) { v = b32enc(crypto.getRandomValues(new Uint8Array(5))); try { localStorage.setItem('sheet:dev', v); } catch { /* blocked */ } } return v; }
const devFmt = v => v.slice(0, 4) + '-' + v.slice(4);
const dayNum = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2020, 0, 1)) / 86400000);
const dayStr = n => new Date(Date.UTC(2020, 0, 1) + n * 86400000).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const licGet = () => { try { return JSON.parse(localStorage.getItem(LIC.K) || '{}'); } catch { return {}; } };
const licPut = o => { try { localStorage.setItem(LIC.K, JSON.stringify(o)); } catch { /* storage blocked */ } };
const licPub = () => LIC.PUB || (location.hostname === 'localhost' ? (window.__licTestPub || '') : '');
let ownerOK = false; const isOwner = () => ownerOK;
async function ownerCheck() { // the owner device must hold the private key that really matches LIC.PUB (a public key alone proves nothing)
  ownerOK = false; const o = ownerGet(), pub = licPub(); if (!o || !pub) return;
  try { if (localStorage.getItem('sheet:ownerOff') === '1') return; } catch { /* blocked */ } // the owner is trying the app as a customer
  try {
    const priv = await crypto.subtle.importKey('jwk', o.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']), pk = await crypto.subtle.importKey('raw', b64u.dec(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ch = crypto.getRandomValues(new Uint8Array(16)), sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, ch);
    ownerOK = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, sig, ch);
  } catch { ownerOK = false; }
}
function licToday() { const st = licGet(), t = dayNum(), m = Math.max(st.seen || 0, t); if (m !== st.seen) { st.seen = m; licPut(st); } return m; } // winding the clock back does not give days back
function licStatus() {
  if (!licPub()) return { mode: 'off' };
  if (isOwner()) return { mode: 'owner' };
  const st = licGet(), today = licToday();
  if (st.exp != null) { if (today <= st.exp) return { mode: 'paid', left: st.exp - today + 1, exp: st.exp }; if (today <= st.exp + LIC.GRACE) return { mode: 'grace', left: st.exp + LIC.GRACE - today + 1, exp: st.exp }; return { mode: 'locked', why: 'expired', exp: st.exp }; }
  if (st.start == null) { st.start = today; licPut(st); }
  const left = st.start + LIC.TRIAL_DAYS - today;
  return left > 0 ? { mode: 'trial', left } : { mode: 'locked', why: 'trial' };
}
const licSubtle = () => crypto.subtle;
async function licRedeem(text) {
  const bad = msg => ({ ok: false, msg: msg || 'รหัสไม่ถูกต้อง ตรวจว่าคัดลอกมาครบทั้งหมด' });
  let bytes; try { bytes = b64u.dec(String(text).replace(/\s+/g, '')); } catch { return bad(); }
  const kind = bytes[0], plen = (kind === 1 || kind === 3) ? 8 : (kind === 2 || kind === 4) ? 13 : 0;
  if (!plen || bytes.length !== plen + 64) return bad();
  const payload = bytes.slice(0, plen), sig = bytes.slice(plen); let good = false;
  try { const key = await licSubtle().importKey('raw', b64u.dec(licPub()), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); good = await licSubtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payload); } catch { good = false; }
  if (!good) return bad();
  if (kind === 2 || kind === 4) { const mine = b32dec(devId()), want = payload.slice(8, 13); if (!mine || want.some((b, i) => b !== mine[i])) return bad('รหัสนี้ออกให้เครื่องอื่น ใช้กับเครื่องนี้ไม่ได้ ส่ง “รหัสเครื่อง” ของเครื่องนี้ให้ผู้พัฒนาเพื่อขอรหัสใหม่'); }
  const w1 = payload[1] | (payload[2] << 8), dur = payload[3] | (payload[4] << 8), id = b64u.enc(payload.slice(5, 8)), st = licGet(), today = licToday();
  st.ids = st.ids || [];
  if (st.ids.includes(id)) return { ok: true, again: true, exp: st.exp };
  if (kind === 3 || kind === 4) { // the days run from the day the code was issued; a renewal while still active is added after the current end
    const issued = w1, base = st.exp != null && st.exp >= issued - 1 ? st.exp : issued - 1, end = base + dur;
    if (end < today) return bad('รหัสนี้หมดอายุแล้ว (นับวันตั้งแต่วันที่ออกรหัส) ขอรหัสใหม่');
    st.exp = end; st.ids.push(id); licPut(st);
    return { ok: true, exp: st.exp, days: dur };
  }
  if (today > w1) return bad('รหัสนี้เลยกำหนดใช้แล้ว ขอรหัสใหม่');
  const base = st.exp != null && st.exp >= today ? st.exp : today - 1;
  st.exp = base + dur; st.ids.push(id); licPut(st);
  return { ok: true, exp: st.exp, days: dur };
}
const licLeftText = st => st.mode === 'owner' ? 'เครื่องเจ้าของ ใช้ฟรีตลอด' : st.mode === 'paid' ? `ใช้ได้ถึง ${dayStr(st.exp)} (อีก ${st.left} วัน)` : st.mode === 'trial' ? `ทดลองใช้ เหลือ ${st.left} วัน` : st.mode === 'grace' ? `รหัสหมดอายุแล้ว ผ่อนผันให้ใช้ต่ออีก ${st.left} วัน ต่ออายุได้ที่นี่` : st.why === 'expired' ? 'รหัสหมดอายุแล้ว' : 'หมดช่วงทดลองใช้แล้ว';
/* the sales page: plans with the saving shown, and a button that opens LINE with the message already written */
LIC.MONTH = 159;
LIC.LINE = { id: '@700fggkk', oa: true };
LIC.CONTACTS = [
  { label: 'LINE Official Account', value: '@700fggkk', open: 'https://line.me/R/ti/p/%40700fggkk', btn: 'เปิด LINE', color: '#06c755' },
  { label: 'Facebook เพจ · เปิดเพจ แล้วกด “ส่งข้อความ”', value: 'โน้ตเนตร', open: 'https://www.facebook.com/share/1BCz1P7CxT/', copy: 'https://www.facebook.com/share/1BCz1P7CxT/', btn: 'เปิดเพจ', color: '#1877f2' },
]; // where a customer can send the slip when the buy button cannot open LINE // LINE id (with @ for an Official Account); empty = just copy the message
LIC.PLANS = [
  { d: 30, m: 1, name: '30 วัน', price: 159, tag: 'เริ่มต้นง่าย ๆ', qr: 'pay-1month.png' },
  { d: 90, m: 3, name: '90 วัน', price: 429, qr: 'pay-3months.png' },
  { d: 180, m: 6, name: '180 วัน', price: 799, badge: 'ยอดนิยม', qr: 'pay-6months.png' },
  { d: 365, m: 12, name: '365 วัน', price: 1449, badge: 'คุ้มที่สุด', qr: 'pay-1year.png' },
];
const planInfo = p => { const full = LIC.MONTH * p.m, save = full - p.price, pct = Math.round(save / full * 100); return { full, save, pct, per: Math.round(p.price / p.m), mo: Math.round(p.price / p.d * 30), day: (p.price / p.d).toFixed(1) }; };
function plansHTML(sel) {
  return `<div class="plans">${LIC.PLANS.map((p, i) => { const f = planInfo(p);
    return `<button class="plan${i === sel ? ' on' : ''}${p.badge ? ' hot' : ''}" data-p="${i}"><span class="rd"></span>${p.badge ? `<span class="bdg">${p.badge}</span>` : ''}
      <div class="pl"><b>${p.name}</b>${f.pct ? `<span class="sv">ประหยัด ${f.pct}%</span>` : `<span class="tg">${p.tag || ''}</span>`}</div>
      <div class="pr">${f.pct ? `<s>${f.full}</s>` : ''}<strong>${p.price}</strong><em>บาท</em></div>
      <div class="pm">${f.pct ? `เฉลี่ยเดือนละ <b>${f.mo} บาท</b> · วันละ ${f.day} บาท` : `เดือนละ <b>${f.mo} บาท</b> · วันละ ${f.day} บาท`}</div></button>`; }).join('')}</div>`;
}
function licPage(pfx, collapsed) {
  const code = `<textarea id="${pfx}c" rows="3" placeholder="วางรหัสปลดล็อกที่นี่" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><div id="${pfx}m" class="licm"></div>
    <div class="licrow"><button class="btn o" id="${pfx}paste">วางรหัส</button><button class="btn" id="${pfx}go">ใส่รหัส</button></div>`;
  const tick = '<i class="tk"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></i>';
  const chat = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.6 1.6 4.9 4 6.3-.1.9-.5 2.3-1.4 3.2 0 0 2.6-.2 4.3-1.5.9.2 1.9.3 3.1.3 5.5 0 10-3.6 10-8.3S17.5 3 12 3z" fill="currentColor"/></svg>';
  return `<div class="licpitch"><div class="licben">
      <div>${tick}<span><b>เปิดเพลงต่อไปได้ทันที</b> โดยไม่ต้องปิดเพลงที่กำลังเล่นอยู่</span></div>
      <div>${tick}<span><b>วางรายชื่อเพลงยาว ๆ</b> แอปเรียงลำดับให้เอง ไม่ต้องเปิดทีละเพลง</span></div>
      <div>${tick}<span><b>ปัดเปลี่ยนหน้าและเพลงลื่นกลางเวที</b> ใช้ได้โดยไม่ต้องต่อเน็ต</span></div></div>
    <div class="licsec">เลือกแพ็กเกจ</div>
    ${plansHTML(2)}
    <button class="btn licline" id="${pfx}line"><span class="lcic">${chat}</span><span class="lctx"></span></button>
    <button class="btn o licpay" id="${pfx}pay">ไม่มี LINE หรือเปิดไม่ได้? ชำระด้วย QR ในแอปนี้</button>
    <button class="lichop" id="${pfx}jump" type="button">มีรหัสแล้ว? <u>ไปที่ช่องใส่รหัส ↓</u></button>
    <p class="lictrust">โน้ตของคุณอยู่ในเครื่องนี้ ไม่อัปโหลดขึ้นเซิร์ฟเวอร์<br>ใช้ได้ถึงวันครบกำหนด ไม่มีการต่ออายุอัตโนมัติ</p>
    <div class="licsec">ขั้นตอนการสมัคร</div>
    <ol class="licsteps"><li><span>1</span>เลือกแพ็กเกจ แล้วกด “แจ้งซื้อทาง LINE” จะได้ QR โอนเงินกลับมา</li><li><span>2</span>โอนเงิน แล้วส่งสลิปมาในแชต</li><li><span>3</span>รับ <b>รหัสปลดล็อก</b> กลับมา</li><li><span>4</span>วางรหัสในช่องด้านล่าง ใช้งานต่อได้ทันที</li></ol>
    <div class="lichave" id="${pfx}have"><div class="lhh"><span class="lhk"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 14a4 4 0 1 1 3.9-4.9H22v3h-2v2.5h-3V12h-2.1A4 4 0 0 1 7 14zm0-5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" fill="currentColor"/></svg></span><div><b>ได้รับรหัสแล้ว? วางรหัสที่นี่</b><small>รหัสเป็นข้อความยาว ๆ ที่ได้ในแชต คัดลอกมา แล้วกด “วางรหัส”</small></div></div>${code}</div>`;
}
function payPlan(p) { // the owner's PromptPay QR with the amount in it, plus where to send the slip when LINE cannot be opened
  const f = planInfo(p);
  const s = sheet(`<h3>ชำระเงิน · แพ็กเกจ ${p.name}</h3>
    <p class="sub">ยอด <b>${p.price} บาท</b> บันทึกรูป QR ด้านล่างลงเครื่อง (กดค้างที่รูป แล้วเลือก “บันทึกรูปภาพ”) จากนั้นเปิดแอปธนาคาร เลือก สแกน QR → เลือกรูปจากคลังภาพ</p>
    <img class="payqr" src="${p.qr}" alt="QR ชำระเงิน ${p.price} บาท">
    <div class="licsec" style="margin-top:14px">โอนแล้ว ส่งสลิปเพื่อรับรหัสปลดล็อก</div>
    ${LIC.CONTACTS.map((c, i) => `<div class="paycon"><div><small>${esc(c.label)}</small><b>${esc(c.value)}</b></div><button class="btn o sm" data-c="${i}">คัดลอก</button>${c.open ? `<a class="btn sm" href="${c.open}" target="_blank" rel="noopener" style="${c.color ? `background:${c.color};color:#fff` : ''}">${esc(c.btn || 'เปิด')}</a>` : ''}</div>`).join('')}
    <p class="sub" style="font-size:.82rem">เลือกช่องทางที่สะดวก ส่งรูปสลิปมาในแชต คุณจะได้รหัสปลดล็อกกลับมา วางในแอปนี้ ช่อง “มีรหัสแล้ว? ใส่ที่นี่” (ถ้า LINE เปิดไม่ได้ ให้เปิดแอป LINE แล้วค้นหา ID ด้านบนเพื่อเพิ่มเพื่อนเอง)</p>`);
  s.el.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { const c = LIC.CONTACTS[+b.dataset.c]; copyText(c.copy || c.value); } });
  if (document.getElementById('lic')) { s.scrim.style.zIndex = 10001; document.body.append(s.scrim); } // keep it above the lock screen
}
async function lineOpen(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* the link below still carries the text */ }
  const L = LIC.LINE; if (!L.id) { toast('ข้อความคัดลอกแล้ว วางส่งให้ผู้พัฒนาทาง LINE'); return; }
  location.href = L.oa ? `https://line.me/R/oaMessage/${L.id}/?${encodeURIComponent(text)}` : `https://line.me/ti/p/~${L.id.replace(/^@/, '')}`;
}
function licWire(root, pfx, onOk) {
  let sel = 2; const btn = $('#' + pfx + 'line', root);
  const paintBtn = () => { const p = LIC.PLANS[sel]; btn.querySelector('.lctx').textContent = `แจ้งซื้อแพ็กเกจ ${p.name} · ${p.price} บาท ทาง LINE`; root.querySelectorAll('.plan').forEach((b, i) => b.classList.toggle('on', i === sel)); };
  root.querySelectorAll('.plan').forEach(b => b.addEventListener('click', () => { sel = +b.dataset.p; paintBtn(); }));
  $('#' + pfx + 'pay', root).addEventListener('click', () => payPlan(LIC.PLANS[sel]));
  btn.addEventListener('click', () => { const p = LIC.PLANS[sel]; lineOpen(`ซื้อโน้ตเนตร ${p.name} ${p.price} บาท`); }); // short and exact: it is also the keyword the LINE OA auto-replies to
  $('#' + pfx + 'jump', root).onclick = () => { const h = $('#' + pfx + 'have', root); h.scrollIntoView({ behavior: 'smooth', block: 'center' }); h.classList.remove('pulse'); void h.offsetWidth; h.classList.add('pulse'); };
  const msg = (t, ok) => { const m = $('#' + pfx + 'm', root); m.textContent = t; m.className = 'licm' + (ok ? ' ok' : ''); };
  $('#' + pfx + 'paste', root).onclick = async () => { try { $('#' + pfx + 'c', root).value = await navigator.clipboard.readText(); } catch { msg('วางอัตโนมัติไม่ได้ กดค้างในช่องแล้วเลือก วาง'); } };
  $('#' + pfx + 'go', root).onclick = async () => { const r = await licRedeem($('#' + pfx + 'c', root).value); if (!r.ok) { msg(r.msg); return; } msg(r.again ? 'รหัสนี้ใส่ไปแล้ว ไม่นับซ้ำ' : `ปลดล็อกแล้ว ใช้ได้ถึง ${dayStr(r.exp)}`, true); onOk?.(); };
  paintBtn();
}

/* ───────────── first-run welcome + how-to (reachable any time from the menu) ───────────── */
const WELCOME = 'sheet:welcome';
function envInfo() {
  const ua = navigator.userAgent || '', mac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return { standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
    inapp: /Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok|musical_ly/i.test(ua),
    ipad: /iPad/.test(ua) || mac, ios: /iPhone|iPad|iPod/.test(ua) || mac, android: /Android/i.test(ua) };
}
const HIC = {
  share: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 3v11M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  add: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  safari: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const hstep = (n, ic, t, sub) => `<li class="hst"><span class="hn">${n}</span><span class="hi">${ic}</span><span class="ht"><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span></li>`;
function installHtml(env = envInfo(), short = false) {
  if (env.standalone) return `<div class="hdone"><span>${HIC.ok}</span><div><b>ติดตั้งแล้ว</b><small>คุณกำลังใช้โน้ตเนตรจากหน้าจอโฮม ไม่ต้องทำอะไรเพิ่ม</small></div></div>`;
  const keep = '<p class="hnote"><b>ติดตั้งก่อน แล้วค่อยเพิ่มเพลง</b> โน้ตที่เพิ่มในหน้าเว็บ Safari จะไม่ย้ายตามไปที่แอปบนหน้าจอโฮม ให้เปิดจากไอคอนบนหน้าจอโฮมแล้วจึงนำเข้าเพลง</p>';
  const safari = (env.ipad
    ? hstep(1, HIC.share, 'แตะปุ่ม “แชร์”', 'ลูกศรชี้ขึ้นออกจากกล่อง อยู่มุมขวาบนของ Safari (ถ้าไม่เห็นให้แตะ ⋯ ก่อน)')
    : hstep(1, HIC.dots, 'แตะปุ่ม “⋯” แล้วเลือก “แชร์”', 'ปุ่ม ⋯ อยู่แถบด้านล่างของ Safari (บางรุ่นมีปุ่มแชร์รูปลูกศรออกจากกล่องให้แตะได้เลย)'))
    + hstep(2, HIC.add, 'เลื่อนลง แล้วแตะ “เพิ่มลงหน้าจอโฮม”', 'ถ้าไม่เจอ ให้แตะ “ดูเพิ่มเติม” ในรายการ')
    + hstep(3, HIC.ok, 'แตะ “เพิ่ม” มุมขวาบน', 'เปิดสวิตช์ “เปิดเป็นแอปหน้าจอเว็บ” ไว้ แล้วจะได้ไอคอนโน้ตเนตรบนหน้าจอโฮม');
  if (env.inapp) return `<div class="hwarn">คุณเปิดอยู่ในแอปอื่น (LINE / Facebook ฯลฯ) ติดตั้งจากตรงนี้ไม่ได้ ต้องเปิดใน Safari ก่อน</div><ol class="hsteps">${hstep(1, HIC.dots, 'แตะปุ่ม “⋯” หรือไอคอนเข็มทิศ', 'อยู่มุมขวาบนหรือล่างของหน้าจอ')}${hstep(2, HIC.safari, 'เลือก “เปิดในเบราว์เซอร์”', 'ใน LINE เขียนว่า “เปิดในเบราว์เซอร์” ใน Facebook อาจเขียนว่า “เปิดใน Safari” หรือแตะปุ่มด้านล่างเพื่อคัดลอกลิงก์ไปวางใน Safari')}</ol><button class="btn o hcopy" type="button">คัดลอกลิงก์ของแอป</button>${short ? '<p class="hnote">พอเปิดใน Safari แล้ว แอปจะแนะนำขั้นตอนเพิ่มลงหน้าจอโฮมให้ต่อทันที</p>' : `<p class="hnote">หลังเปิดใน Safari แล้ว ทำตามขั้นตอนติดตั้งด้านล่างนี้</p><ol class="hsteps">${safari}</ol>${keep}`}`;
  if (env.android) return `<ol class="hsteps">${hstep(1, HIC.dots, 'แตะเมนู “⋮” มุมขวาบนของ Chrome', '')}${hstep(2, HIC.add, 'เลือก “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”', '')}${hstep(3, HIC.ok, 'ยืนยัน แล้วเปิดแอปจากไอคอนบนหน้าจอ', '')}</ol>${keep}`;
  if (env.ios) return `<ol class="hsteps">${safari}</ol>${keep}`;
  return `<p class="hnote">แอปใช้ได้เลยในเบราว์เซอร์นี้ ถ้าใช้บน iPad หรือ iPhone ให้เปิดลิงก์นี้ใน <b>Safari</b> แล้วเพิ่มลงหน้าจอโฮม</p><ol class="hsteps">${safari}</ol>`;
}
function wireCopy(root) { const b = $('.hcopy', root); if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname); toast('คัดลอกลิงก์แล้ว นำไปวางใน Safari'); } catch { toast('คัดลอกไม่ได้ ให้กดค้างที่ลิงก์ในแถบที่อยู่'); } }; }
const ADD_HTML = `<ul class="hlist">
  <li><b>รูปจากคลังภาพ หรือไฟล์</b><small>แตะปุ่ม <span class="hk">⤓</span> มุมขวาบน แล้วเลือกรูปหรือไฟล์โน้ตจากเครื่อง</small></li>
  <li><b>เลือกหลายรูปพร้อมกัน = เพลงเดียวหลายหน้า</b><small>เรียงหน้าตามชื่อไฟล์ ชื่อเพลงใช้ชื่อไฟล์ของรูปแรก ถ้าชื่อซ้ำแอปเติม (2) ให้เอง</small></li>
  <li><b>ไฟล์ ZIP = หลายเพลงในครั้งเดียว</b><small>ใส่โน้ตแต่ละเพลงเป็นโฟลเดอร์ ชื่อโฟลเดอร์คือชื่อเพลง แอปจะแยกให้เอง และให้ดูรายการก่อนนำเข้า</small></li>
  <li><b>มีไฟล์ชื่อเพลงอยู่แล้ว เข้าได้เลย ไม่ต้องตั้งชื่อ</b><small>ถ้าอยากเปลี่ยนชื่อทีหลัง: เมนู → จัดการเพลง หรือกดค้างที่ชื่อเพลงในผลค้นหา</small></li>
  <li><b>โน้ตอยู่ในเครื่องคุณเท่านั้น</b><small>ไม่อัปโหลดขึ้นเซิร์ฟเวอร์ อยากเก็บกันหาย: เมนู → สำรองข้อมูล</small></li></ul>`;
const clip = (f, t) => `<button type="button" class="hplay" data-clip="${f}"><span>▶</span> ดูคลิปสั้น · ${t}</button>`;
const HELP = [
  ['ติดตั้งลงหน้าจอโฮม', null],
  ['เพิ่มเพลงของคุณ', ADD_HTML + clip('help-add-photos', 'เพิ่มจากรูปหรือไฟล์') + clip('help-add-zip', 'เพิ่มหลายเพลงด้วย ZIP')],
  ['เปิดเพลงและคิว', `<ul class="hlist"><li><b>แตะปุ่ม <span class="hk">＋</span> ล่างขวา แล้วค้นหาเพลง</b><small>แตะที่เพลง = เพิ่มแล้วปิด กดค้าง = เพิ่มต่อได้หลายเพลง</small></li><li><b>“ถัดไป” กับ “ท้ายคิว”</b><small>ถัดไป = เล่นต่อจากเพลงที่เปิดอยู่ ท้ายคิว = ต่อท้ายรายการ โดยไม่ต้องปิดเพลงที่เล่นอยู่</small></li><li><b>เปลี่ยนหน้า / เปลี่ยนเพลง</b><small>ปัดหรือแตะขอบจอด้านซ้าย-ขวา หรือแตะป้าย “เพลงต่อไป” ด้านล่าง</small></li></ul>${clip('help-queue', 'เปิดเพลงต่อไป')}`],
  ['ชุดเพลงสำหรับแต่ละงาน', `<ul class="hlist"><li><b>แตะ “＋ ชุดใหม่” ด้านบน</b><small>เริ่มชุดว่าง / พิมพ์รายการเพลง / บันทึกคิวที่มีเป็นชุด</small></li><li><b>วางรายชื่อเพลงจากไลน์ได้ทีเดียว</b><small>เลือก “พิมพ์รายการเพลง” แล้ววางทีละบรรทัด แอปหาโน้ตและเรียงให้เอง</small></li><li><b>กดค้างที่ชื่อชุด</b><small>เปลี่ยนชื่อ ล็อกชุดด้วยรหัส ส่งให้เพื่อน หรือลบ</small></li></ul>${clip('help-sets', 'สร้างชุดเพลง')}`],
  ['เขียนโน้ตกำกับ', `<ul class="hlist"><li><b>แตะปุ่ม <span class="hk">✎</span> ด้านบนตอนเปิดโน้ต</b><small>ปากกา ไฮไลต์ ยางลบ ครอปหน้า ย้อนกลับ/ทำซ้ำ เก็บรอยไว้กับหน้านั้น</small></li></ul>${clip('help-annotate', 'เขียนโน้ต')}`],
  ['ซื้อแพ็กเกจและใส่รหัส', `<ul class="hlist"><li><b>เมนู → แถบสถานะด้านบน</b><small>เลือกแพ็กเกจ แล้วกด “แจ้งซื้อทาง LINE” จะได้ QR โอนเงินกลับมา</small></li><li><b>โอนแล้วส่งสลิปในแชต</b><small>ผู้พัฒนาส่งรหัสปลดล็อกกลับมา คัดลอกแล้ววางในช่อง “ได้รับรหัสแล้ว?” กด “ใส่รหัส”</small></li></ul>`]
];
function openHelp(first) {
  const env = envInfo();
  const body = HELP.map(([t, h], i) => `<details class="hsec"${i === (first || 0) ? ' open' : ''}><summary>${t}</summary>${h === null ? installHtml(env) + (env.standalone ? '' : clip('help-install', 'ติดตั้งลงหน้าจอโฮม')) : h}</details>`).join('');
  const s = sheet(`<h3>วิธีใช้งาน</h3><p class="sub">แตะหัวข้อเพื่อเปิดอ่าน ดูซ้ำได้ทุกเมื่อจากเมนู</p><div class="hbody">${body}</div><button class="btn o hagain" type="button">ดูหน้าต้อนรับอีกครั้ง</button>`);
  s.el.addEventListener('click', e => {
    const b = e.target.closest('.hplay'); if (!b) return;
    const v = document.createElement('video'); v.src = b.dataset.clip + '.mp4'; v.controls = true; v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata'; v.className = 'hvid';
    v.onerror = () => { v.replaceWith(Object.assign(document.createElement('p'), { className: 'hnote', textContent: 'เปิดคลิปไม่ได้ ต้องต่ออินเทอร์เน็ตตอนดูคลิป (ข้อความอธิบายด้านบนใช้ออฟไลน์ได้)' })); };
    b.replaceWith(v);
  });
  wireCopy(s.el); $('.hagain', s.el).onclick = () => { s.close(); openWelcome(); };
}
function maybeWelcome() {
  try { if (localStorage.getItem(WELCOME)) return; } catch { return; }
  if (S.songs.size > 0 || document.getElementById('lic') || document.querySelector('.scrim')) return; // only for a fresh install, never over the lock screen or another sheet
  openWelcome();
}
function openWelcome() {
  const env = envInfo(); let step = 0;
  const pages = [
    () => `<div class="wlogo"><img src="apple-touch-icon.png" alt="" width="72" height="72"></div><h3>ยินดีต้อนรับสู่ โน้ตเนตร</h3><p class="sub">แอปโน้ตเพลงสำหรับนักดนตรี ทดลองใช้ฟรี ${LIC.TRIAL_DAYS} วัน</p><div class="wben"><div><i>${HIC.ok}</i><span><b>เปิดเพลงต่อไปได้ทันที</b> ไม่ต้องปิดเพลงที่เล่นอยู่</span></div><div><i>${HIC.ok}</i><span><b>วางรายชื่อเพลงยาว ๆ</b> แอปเรียงให้เอง</span></div><div><i>${HIC.ok}</i><span><b>ปัดเปลี่ยนหน้าลื่น</b> ใช้ได้โดยไม่ต้องต่อเน็ต</span></div></div>`,
    () => `<h3>ติดตั้งลงหน้าจอโฮม</h3><p class="sub">เปิดได้เร็วเหมือนแอปทั่วไป ใช้เวลาไม่ถึงนาที</p>${installHtml(env, true)}`,
    () => `<h3>เพิ่มเพลงของคุณ</h3><p class="sub">เลือกได้หลายแบบ</p>${ADD_HTML}`
  ];
  const list = env.standalone ? [pages[0], pages[2]] : pages;
  const s = sheet(`<div class="wpage"></div><div class="wdots"></div><div class="wbtns"><button class="btn o" id="wskip" type="button">ข้าม</button><button class="btn" id="wnext" type="button"></button></div>`, { onclose: () => { try { localStorage.setItem(WELCOME, '1'); } catch { /* ok */ } } });
  const paint = () => {
    $('.wpage', s.el).innerHTML = list[step](); wireCopy(s.el);
    $('.wdots', s.el).innerHTML = list.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
    const last = step === list.length - 1; $('#wnext', s.el).textContent = last ? 'เลือกโน้ตจากเครื่อง' : 'ถัดไป'; $('#wskip', s.el).textContent = last ? 'ไว้ทีหลัง' : 'ข้าม';
  };
  $('#wnext', s.el).onclick = () => { if (step < list.length - 1) { step++; paint(); } else { s.close(); quickPick(); } };
  $('#wskip', s.el).onclick = () => s.close();
  paint();
}
function licCheck(allowLock) { // allowLock: only when the app is opened or comes back after a long time away, never in the middle of playing
  const st = licStatus(), old = document.getElementById('lic');
  if (st.mode !== 'locked') { old?.remove(); return; }
  if (old || !allowLock) return;
  const el = document.createElement('div'); el.id = 'lic';
  el.innerHTML = `<div class="licbox"><div class="licbrand"><img src="apple-touch-icon.png" alt="" width="60" height="60"><div><b>โน้ตเนตร</b><span>โน้ตเพลงบนเวที เปิดเร็ว เล่นลื่น</span></div></div>\n    <span class="licchip">${st.why === 'expired' ? 'รหัสหมดอายุแล้ว' : 'สิ้นสุดช่วงทดลองใช้'}</span><h2>เล่นต่อได้ทันที เลือกแพ็กเกจที่เหมาะกับคุณ</h2><p class="licsub">โน้ตทั้งหมดของคุณยังอยู่ครบในเครื่องนี้ ไม่มีอะไรหาย</p>${licPage('lic', false)}</div>`;
  document.body.append(el); licWire(el, 'lic', () => setTimeout(() => licCheck(true), 900));
  { let taps = 0, tt = 0; $('.licbrand', el).addEventListener('click', () => { taps++; clearTimeout(tt); tt = setTimeout(() => { taps = 0; }, 2500); if (taps >= 7) { taps = 0; el.style.display = 'none'; verifyPin('ใส่รหัส 4 หลักเพื่อเข้าเมนูเจ้าของ', 'เมนูเจ้าของ').then(ok => { if (ok) openOwner(() => { el.style.display = ''; licCheck(true); }); else el.style.display = ''; }); } }); } // owner recovery: tap the logo 7 times
}
function openLicence() {
  const st = licStatus();
  const s = sheet(`<h3>สถานะการใช้งาน</h3><p class="licnow">${esc(licLeftText(st))}</p>${st.mode === 'owner' ? '' : licPage('lc', true)}<p class="sub" style="margin-top:16px;font-size:.78rem">รหัสเครื่อง (บอกผู้พัฒนาเมื่อถูกขอเท่านั้น): <b>${devFmt(devId())}</b></p>`);
  if (st.mode !== 'owner') licWire(s.el, 'lc');
}
/* owner tools: reached by tapping the title of "ข้อมูลและพื้นที่" seven times */
function ownerGet() { try { return JSON.parse(localStorage.getItem(LIC.OWNER) || 'null'); } catch { return null; } }
async function ownerCreate() {
  const kp = await licSubtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await licSubtle().exportKey('jwk', kp.privateKey), pub = b64u.enc(new Uint8Array(await licSubtle().exportKey('raw', kp.publicKey)));
  localStorage.setItem(LIC.OWNER, JSON.stringify({ priv, pub })); return pub;
}
const BONUS_DAYS = { 30: 2, 90: 2, 180: 2, 365: 2 }; // a quiet gift on every sold plan: it is inside the code, never mentioned to the customer
async function ownerIssue(days, note, redeemDays = 90, dev = null) { // dev: 5 bytes = the customer's device, or null for a code that works on any device
  const o = ownerGet(); if (!o) throw new Error('ยังไม่ได้ตั้งเครื่องเจ้าของ');
  const key = await licSubtle().importKey('jwk', o.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const real = days + (BONUS_DAYS[days] || 0), by = dayNum(), p = new Uint8Array(dev ? 13 : 8); p[0] = dev ? 4 : 3; if (dev) p.set(dev, 8); p[1] = by & 255; p[2] = (by >> 8) & 255; p[3] = real & 255; p[4] = (real >> 8) & 255; p.set(crypto.getRandomValues(new Uint8Array(3)), 5);
  const sig = new Uint8Array(await licSubtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, p)), out = new Uint8Array(p.length + 64); out.set(p); out.set(sig, p.length);
  const code = b64u.enc(out); let list = []; try { list = JSON.parse(localStorage.getItem(LIC.ISSUED) || '[]'); } catch { /* none */ }
  list.unshift({ code, days, real, note: note || '', day: dayNum(), dev: dev ? devFmt(b32enc(dev)) : '' }); try { localStorage.setItem(LIC.ISSUED, JSON.stringify(list.slice(0, 200))); } catch { /* storage */ }
  return code;
}
const planName = d => ({ 7: 'ทดลอง 7 วัน', 30: '30 วัน', 90: '90 วัน', 180: '180 วัน', 365: '365 วัน', 3650: '10 ปี' })[d] || (d + ' วัน');
const licMessage = (code, days, day) => `ขอบคุณที่สนับสนุนโน้ตเนตรครับ 🙏
นี่คือรหัสปลดล็อก แพ็กเกจ ${planName(days)}
ใช้ได้ถึง ${dayStr((day == null ? dayNum() : day) + days - 1)} (นับวันตั้งแต่วันที่ออกรหัส)

${code}

วิธีใช้
1. เปิดแอปโน้ตเนตร แตะ ☰ (เมนู)
2. แตะการ์ดสีเขียวบนสุด “สถานะการใช้งาน”
3. แตะ “มีรหัสแล้ว? ใส่ที่นี่” แล้ววางรหัสด้านบน กด “ใส่รหัส”

กรุณาใส่รหัสในแอปโดยเร็ว เพราะวันนับตั้งแต่วันที่ออกรหัส ถ้ามีปัญหาทักมาได้เลยครับ`;
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่ได้ กดค้างที่ข้อความแล้วเลือกคัดลอก'); } }
function openOwner(onclose) {
  const paint = () => {
    const o = ownerGet(); let asClient = false; try { asClient = localStorage.getItem('sheet:ownerOff') === '1'; } catch { /* blocked */ } let list = []; try { list = JSON.parse(localStorage.getItem(LIC.ISSUED) || '[]'); } catch { /* none */ }
    box.innerHTML = !o ? `<p class="sub">ตั้งเครื่องนี้เป็น <b>เครื่องเจ้าของ</b> เพื่อออกรหัสปลดล็อกให้ผู้ใช้ เครื่องเจ้าของใช้ฟรีตลอด ไม่ถูกล็อก</p>
      <button class="btn" data-o="make" style="width:100%">ตั้งเครื่องนี้เป็นเครื่องเจ้าของ</button>
      <p class="sub" style="margin-top:14px">เปลี่ยนเครื่องหรือมีกุญแจสำรองอยู่แล้ว วางกุญแจสำรองที่นี่:</p>
      <textarea class="field" id="ownImp" rows="3" placeholder="วางกุญแจสำรอง" spellcheck="false"></textarea><button class="btn o" data-o="imp" style="width:100%;margin-top:8px">ใช้กุญแจสำรองนี้</button>`
    : `<div class="ownmode"><b>${asClient ? 'ตอนนี้ทดลองเป็นลูกค้าอยู่' : 'ทดลองเป็นลูกค้า'}</b><p class="sub" style="margin:2px 0 8px">${asClient ? 'แอปทำตัวเหมือนลูกค้าใหม่บนเครื่องนี้' : 'ปิดสิทธิ์เจ้าของชั่วคราว เพื่อดูสิ่งที่ลูกค้าเห็น'}</p>
      ${asClient ? '<button class="btn" data-o="asowner" style="width:100%">กลับเป็นเจ้าของ</button><div class="row2" style="margin-top:8px"><button class="btn o" data-o="resettrial">ทดลอง 14 วันใหม่</button><button class="btn o" data-o="fakeend">จำลองหมดช่วงทดลอง</button></div>' : '<button class="btn o" data-o="asclient" style="width:100%">ทดลองเป็นลูกค้า</button>'}</div>
      <p class="sub">เครื่องนี้เป็นเครื่องเจ้าของ ใช้ฟรีตลอด</p>
      <p class="sub">กุญแจตรวจรหัส (ส่งให้ผู้พัฒนาฝังในแอป ไม่ใช่ความลับ):</p><textarea class="field" readonly rows="2" id="ownPub">${esc(o.pub)}</textarea><button class="btn o sm" data-o="cpub">คัดลอกกุญแจตรวจรหัส</button>
      <h3 style="margin-top:16px">ออกรหัสให้ผู้ใช้</h3>
      <div class="pills" id="ownDur">${[[7, 'ทดลอง 7 วัน'], [30, '30 วัน'], [90, '90 วัน'], [180, '180 วัน'], [365, '365 วัน'], [3650, '10 ปี']].map(([d, t]) => `<button data-d="${d}" class="${d === 30 ? 'on' : ''}">${t}</button>`).join('')}</div>
      <input class="field" id="ownNote" placeholder="ชื่อผู้ใช้ (จดไว้เอง ไม่ใส่ก็ได้)" maxlength="40" style="margin-top:8px">
      <div class="pills" id="ownBind" style="margin-top:8px"><button data-b="0" class="on">ใช้ได้ทุกเครื่อง (ปกติ)</button><button data-b="1">ผูกกับเครื่องเดียว</button></div>
      <input class="field" id="ownDev" placeholder="รหัสเครื่องของลูกค้า เช่น K7QM-4TDA" maxlength="12" autocapitalize="characters" spellcheck="false" style="margin-top:8px;display:none">
      <button class="btn" data-o="issue" style="width:100%;margin-top:8px">ออกรหัส</button>
      <div id="ownOut"></div>
      ${list.length ? `<h3 style="margin-top:16px">รหัสที่เคยออก (${list.length})</h3><div class="ownlist">${list.slice(0, 30).map((x, i) => `<div class="lrow"><div class="nm">${esc(x.note || '(ไม่ได้ใส่ชื่อ)')}<small>${x.days >= 3650 ? '10 ปี' : ({ 30: '30 วัน', 90: '90 วัน', 180: '180 วัน', 365: '365 วัน' })[x.days] || (x.days + ' วัน')}${x.dev ? ' · เครื่อง ' + x.dev : ' · ไม่ผูกเครื่อง'} · ออกเมื่อ ${dayStr(x.day)} · ถึง ${dayStr(x.day + (x.real || x.days) - 1)}${(x.real || x.days) > x.days ? ' (แถม ' + ((x.real || x.days) - x.days) + ' วัน)' : ''}</small></div><button class="btn o sm" data-o="cp" data-i="${i}">คัดลอกข้อความ</button></div>`).join('')}</div>` : ''}
      <h3 style="margin-top:16px">กุญแจสำรอง (ลับ!)</h3><p class="sub">เก็บไว้ที่ปลอดภัย (เช่นโน้ตส่วนตัว) ถ้ากุญแจหายและไม่มีสำรอง จะออกรหัสใหม่ที่ใช้กับแอปนี้ไม่ได้อีก ห้ามส่งให้ใคร</p>
      <button class="btn o sm" data-o="bak">คัดลอกกุญแจสำรอง</button>
      <h3 style="margin-top:16px">ใช้กุญแจสำรองแทน</h3><p class="sub">ถ้ากุญแจในเครื่องนี้ไม่ใช่ของแอป (เช่นสร้างผิดครั้ง) วางกุญแจสำรองที่เก็บไว้ที่นี่</p><textarea class="field" id="ownImp" rows="3" placeholder="วางกุญแจสำรอง" spellcheck="false"></textarea><button class="btn o sm" data-o="imp" style="margin-top:8px">ใช้กุญแจสำรองนี้</button>`;
  };
  const s = sheet('<h3>เมนูเจ้าของ</h3><div id="ownBox"></div>', { onclose }), box = $('#ownBox', s.el); paint(); let dur = 30, bind = false;
  s.el.addEventListener('click', async e => {
    const bd = e.target.closest('#ownBind [data-b]'); if (bd) { bind = bd.dataset.b === '1'; s.el.querySelectorAll('#ownBind [data-b]').forEach(b => b.classList.toggle('on', b === bd)); $('#ownDev', s.el).style.display = bind ? '' : 'none'; return; }
    const d = e.target.closest('#ownDur [data-d]'); if (d) { dur = +d.dataset.d; s.el.querySelectorAll('#ownDur [data-d]').forEach(b => b.classList.toggle('on', b === d)); return; }
    const a = e.target.closest('[data-o]')?.dataset.o; if (!a) return;
    try {
      if (a === 'make') { if (await confirmDel('ตั้งเป็นเครื่องเจ้าของ?', 'เครื่องนี้จะใช้ฟรีตลอดและออกรหัสได้ อย่าลืมคัดลอกกุญแจสำรองเก็บไว้ (ล้างข้อมูลเว็บแล้วกุญแจจะหาย)', 'ตั้งเลย')) { await ownerCreate(); paint(); await ownerCheck(); licCheck(true); } }
      else if (a === 'imp') { const t = $('#ownImp', s.el).value.trim(); const o = JSON.parse(t); if (!o.priv || !o.pub) throw new Error('x'); localStorage.setItem(LIC.OWNER, JSON.stringify(o)); await ownerCheck(); paint(); licCheck(true); }
      else if (a === 'asclient') { localStorage.setItem('sheet:ownerOff', '1'); await ownerCheck(); paint(); licCheck(false); toast('ตอนนี้ทดลองเป็นลูกค้า'); }
      else if (a === 'asowner') { localStorage.removeItem('sheet:ownerOff'); await ownerCheck(); paint(); licCheck(true); toast('กลับเป็นเจ้าของแล้ว'); }
      else if (a === 'resettrial') { licPut({}); licCheck(true); toast('เริ่มทดลอง 14 วันใหม่'); }
      else if (a === 'fakeend') { licPut({ start: dayNum() - LIC.TRIAL_DAYS - 1 }); s.close(); licCheck(true); } // the lock screen covers everything; tap its logo 7 times to come back to this menu
      else if (a === 'cpub') copyText(ownerGet().pub);
      else if (a === 'bak') copyText(JSON.stringify(ownerGet()));
      else if (a === 'issue') { let dev = null; if (bind) { dev = b32dec($('#ownDev', s.el).value); if (!dev) { toast('รหัสเครื่องไม่ถูกต้อง ต้องมี 8 ตัวอักษร เช่น K7QM-4TDA'); return; } } const code = await ownerIssue(dur, $('#ownNote', s.el).value.trim(), 90, dev); paint(); $('#ownOut', s.el).innerHTML = `<p class="sub" style="margin-top:10px">รหัสที่ได้ (วันนับตั้งแต่วันที่ออกรหัสนี้ ลูกค้าควรใส่ในแอปโดยเร็ว):</p><button class="btn" data-o="cmsg" data-days="${dur}" style="width:100%;margin-bottom:8px">คัดลอกข้อความพร้อมส่ง (รหัส + วิธีใช้)</button><textarea class="field" readonly rows="3" id="ownCode">${esc(code)}</textarea><button class="btn o sm" data-o="ccode">คัดลอกเฉพาะรหัส</button>`; }
      else if (a === 'ccode') copyText($('#ownCode', s.el).value);
      else if (a === 'cmsg') copyText(licMessage($('#ownCode', s.el).value, +e.target.closest('[data-days]').dataset.days, dayNum()));
      else if (a === 'cp') { let list = []; try { list = JSON.parse(localStorage.getItem(LIC.ISSUED) || '[]'); } catch { /* none */ } const it = list[+e.target.closest('[data-i]').dataset.i]; copyText(licMessage(it.code, it.days, it.day)); }
    } catch (err) { toast('ทำไม่สำเร็จ: ' + (err.message || err)); }
  });
}
/* ───────────── boot ───────────── */
// does the page still run under the clock (translucent status bar)? if the system gives it a solid bar instead, the safe-area inset is 0 and the tags can sit at the very top
{ const pr = document.createElement('div'); pr.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none'; document.body.append(pr);
  const chk = () => { $('#app').classList.toggle('sbsolid', pr.getBoundingClientRect().height < 1); }; chk(); window.addEventListener('resize', chk); setTimeout(chk, 600); }
(async function boot() {
  try {
    await DB.open();
    (await DB.allSongs()).forEach(s => S.songs.set(s.id, s)); S.sets = (await DB.allSets()).sort((a, b) => (a.ord || 0) - (b.ord || 0));
  } catch {
    $('#empty').className = 'empty show'; $('#empty').innerHTML = '<h2>เปิดที่เก็บข้อมูลไม่ได้</h2><p>เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล (อาจเป็นโหมดส่วนตัว) ลองเปิดด้วยเบราว์เซอร์ปกติ</p>'; return;
  }
  { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); { const st = document.createElement('div'); st.id = 'songtag'; st.hidden = true; $('#stage').append(st); initTagShare(); }
  { const dd = document.createElement('div'); dd.id = 'bpmdot'; dd.hidden = true; dd.setAttribute('role', 'button'); dd.setAttribute('aria-label', 'เปิด/ปิดไฟกระพริบจังหวะ'); dd.innerHTML = '<span></span><i></i>'; $('#stage').append(dd);
    for (const t of ['pointerdown', 'pointerup']) dd.addEventListener(t, e => e.stopPropagation());
    dd.addEventListener('click', e => { e.stopPropagation(); const song = curSong(); if (!song) return; if (DOT.off.has(song.id)) DOT.off.delete(song.id); else DOT.off.add(song.id); dotPaint(); }); }
  sv.id = 'annsvg'; $('#inner').append(sv); { const sn = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sn.id = 'annsvgn'; $('#inner').append(sn); } $('#pg').addEventListener('load', () => { measureDark(); annRender(); }); buildEtb(); }
  wishLoad(); aliasLoad();
  applyTop(); loadState(); renderAll(); chromeArm(); ownerCheck().then(() => { licCheck(true); setTimeout(maybeWelcome, 700); }); { let away = 0; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away = Date.now(); else if (away && Date.now() - away > LIC.AWAY) { away = 0; licCheck(true); } else licCheck(false); }); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__sheet = { S, DB, CROP, inkBox, ANN, lic: { ownerCreate, ownerIssue, licStatus, licRedeem, dayNum, devId, b32dec, b32enc } };
})();
})();
