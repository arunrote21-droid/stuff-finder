(() => {
'use strict';

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString('th-TH');

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  select: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z"/>',
  v1: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  v2: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  v3: '<path d="M3 5h4v4H3zM10 5h4v4h-4zM17 5h4v4h-4zM3 14h4v4H3zM10 14h4v4h-4zM17 14h4v4h-4z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const starIc = on => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="${on ? 'fill:#f59e0b;stroke:#f59e0b' : ''}">${ICONS.star}</svg>`;
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

/* ───────────── storage (IndexedDB) ───────────── */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('stuff-finder', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
        if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs'); // v2: thumbnails live apart from node data
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, mode);
      const out = fn(...stores.map(s => t.objectStore(s)));
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  all: () => DB.run(['nodes'], 'readonly', s => s.getAll()),
  photo: id => DB.run(['photos'], 'readonly', s => s.get(id)),
  // one atomic write: nodes to put, ids to delete, [id, blob] photos to put
  // Node records are plain data (no blobs), so editing a node never rewrites its pictures.
  write({ put = [], del = [], photos = [], thumbs = [] }) {
    return DB.run(['nodes', 'photos', 'thumbs'], 'readwrite', (ns, ps, ts) => {
      put.forEach(n => { const { thumb, ...plain } = n; ns.put(plain); });
      photos.forEach(([id, b]) => b && ps.put(b, id));
      thumbs.forEach(([id, b]) => b && ts.put(b, id));
      del.forEach(id => { ns.delete(id); ps.delete(id); ts.delete(id); });
    });
  },
  async allThumbs() {
    const keys = await DB.run(['thumbs'], 'readonly', s => s.getAllKeys());
    const vals = await DB.run(['thumbs'], 'readonly', s => s.getAll());
    return new Map(keys.map((k, i) => [k, vals[i]]));
  },
  clear: () => DB.run(['nodes', 'photos', 'thumbs'], 'readwrite', (ns, ps, ts) => { ns.clear(); ps.clear(); ts.clear(); }),
};

/* ───────────── tag list (choices shown as tap-to-pick chips) ───────────── */
const DEFAULT_TAGS = ['อาหารสด', 'อาหารแห้ง', 'เครื่องมือ', 'ดนตรี', 'อุปกรณ์ที่สอน', 'ของใช้ส่วนตัว', 'ของใช้ที่สอน'];
const TAGKEY = 'stuff-finder:tags';
let tagList = [];
const saveTags = () => { try { localStorage.setItem(TAGKEY, JSON.stringify(tagList)); } catch { /* storage blocked */ } };
function initTags() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(TAGKEY)); } catch { /* none yet */ }
  if (Array.isArray(v)) { tagList = v; return; }
  // first run: defaults plus any free-text tags already used on items
  tagList = [...DEFAULT_TAGS];
  for (const n of S.nodes.values()) (n.tags || []).forEach(t => { if (!tagList.includes(t)) tagList.push(t); });
  saveTags();
}

/* ───────────── state & tree ───────────── */
const S = { stags: new Set(), tagFilter: null, nodes: new Map(), kids: new Map(), urls: new Map(), sel: null, route: null, focusQ: false, toastFn: null };

const label = n => n.name || (n.type === 'box' ? 'ไม่มีชื่อ' : 'ไม่มีชื่อ');
const cmp = (a, b) => (a.type !== b.type ? (a.type === 'box' ? -1 : 1) : (a.name || '').localeCompare(b.name || '', 'th') || a.created - b.created);

function reindex() {
  S.kids = new Map();
  for (const n of S.nodes.values()) {
    const k = n.parent || '';
    if (!S.kids.has(k)) S.kids.set(k, []);
    S.kids.get(k).push(n);
  }
  for (const a of S.kids.values()) a.sort(cmp);
}
const children = id => S.kids.get(id || '') || [];
function ancestors(id) {
  const out = [];
  let n = S.nodes.get(id);
  while (n && n.parent && S.nodes.has(n.parent) && out.length < 64) { n = S.nodes.get(n.parent); out.unshift(n); }
  return out;
}
function descendants(id) {
  const out = [], stack = [...children(id)];
  while (stack.length) { const n = stack.pop(); out.push(n); stack.push(...children(n.id)); }
  return out;
}
const itemsUnder = id => descendants(id).filter(n => n.type === 'item');

function thumbUrl(n) {
  const c = S.urls.get(n.id);
  if (c && c.v === n.updated) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  if (!n.thumb) return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 4%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23999%22/%3E%3C/svg%3E';
  const url = URL.createObjectURL(n.thumb);
  S.urls.set(n.id, { v: n.updated, url });
  return url;
}

/* ───────────── expiry ───────────── */
function daysLeft(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
}
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); };
function expInfo(n) {
  const d = daysLeft(n.expiry);
  if (d == null) return null;
  if (d < 0) return { d, cls: 'bad', txt: `หมดอายุแล้ว ${-d} วัน` };
  if (d === 0) return { d, cls: 'bad', txt: 'หมดอายุวันนี้' };
  if (d <= 7) return { d, cls: 'warn', txt: `อีก ${d} วัน` };
  if (d <= 30) return { d, cls: '', txt: `อีก ${d} วัน` };
  return { d, cls: 'ok', txt: d < 365 ? `อีก ${d} วัน` : `อีก ${Math.floor(d / 30)} เดือน` };
}
const isAlert = n => n.type === 'item' && n.qty > 0 && n.expiry && daysLeft(n.expiry) <= 7;
const alertItems = () => [...S.nodes.values()].filter(isAlert);
const alertCount = id => itemsUnder(id).filter(isAlert).length;

/* ───────────── image processing ───────────── */
async function processImage(file, thumbOnly = false) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const mk = (max, q) => {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', q));
  };
  const [full, thumb] = await Promise.all([thumbOnly ? null : mk(1400, 0.85), mk(420, 0.78)]);
  src.close?.();
  return { full, thumb };
}
function choosePhoto(cam) {
  const inp = $(cam ? '#fileCamera' : '#fileGallery');
  inp.value = '';
  return new Promise(res => { inp.onchange = () => res(inp.files[0] || null); inp.click(); });
}
const blobToData = b => new Promise(r => { if (!b) return r(null); const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataToBlob = d => (d ? fetch(d).then(r => r.blob()) : null);

/* ───────────── UI primitives: sheet, ask, toast, picker ───────────── */
function sheet(inner, cls = '') {
  const sc = document.createElement('div');
  sc.className = 'scrim';
  sc.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
  const layer = $('#layer');
  const close = () => { sc.remove(); if (!layer.children.length) document.body.style.overflow = ''; sc.onclose?.(); };
  sc._close = close;
  sc.addEventListener('pointerdown', e => { if (e.target === sc) close(); });
  layer.append(sc);
  document.body.style.overflow = 'hidden';
  return { el: sc.firstChild, scrim: sc, close };
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const lb = $('.lightbox'); if (lb) return lb.click();
  $('#layer').lastElementChild?._close?.();
});

function ask({ title, text, buttons }) {
  return new Promise(res => {
    const s = sheet(`<h3>${esc(title)}</h3>${text ? `<p style="color:var(--muted);margin:0 0 14px">${esc(text)}</p>` : ''}
      ${buttons.map((b, i) => `<button class="btn block ${b.cls || ''}" data-i="${i}" style="margin-bottom:8px">${esc(b.label)}</button>`).join('')}`);
    let done = false;
    const fin = v => { if (done) return; done = true; s.close(); res(v); };
    s.el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) fin(buttons[b.dataset.i].value); });
    s.scrim.onclose = () => fin(null);
  });
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  S.toastFn = action?.fn || null;
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toastact">${esc(action.label)}</button>` : ''}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 7000 : 2600);
}

function locText(id) {
  if (!id || !S.nodes.has(id)) return 'ชั้นนอกสุด (ยังไม่ได้อยู่ในที่ไหน)';
  return [...ancestors(id), S.nodes.get(id)].map(label).join(' › ');
}

// resolves { id } (id may be null = top level) or undefined if cancelled
function pickLocation({ title = 'เลือกที่เก็บ', exclude = new Set(), current = null, confirm = 'เลือกที่นี่' } = {}) {
  return new Promise(res => {
    let pick = current && S.nodes.has(current) ? current : null;
    const open = new Set(pick ? [...ancestors(pick).map(a => a.id), pick] : []);
    const s = sheet(`<h3>${esc(title)}</h3><div class="tree" id="tree"></div>
      <button class="btn block" data-new style="margin-top:10px;border-style:dashed;color:var(--accent)">${ic('plus')}<span id="newLbl"></span></button>
      <div class="actions"><button class="btn primary" data-ok>${esc(confirm)}</button><button class="btn" data-cancel>ยกเลิก</button></div>`);
    const tree = $('#tree', s.el);
    const boxKids = id => children(id).filter(n => n.type === 'box' && !exclude.has(n.id));
    const rows = (pid, depth) => boxKids(pid).map(n => {
      const has = boxKids(n.id).length > 0, isOpen = open.has(n.id);
      return `<div class="tn ${pick === n.id ? 'pick' : ''}" data-id="${n.id}" style="padding-left:${8 + depth * 20}px">
        <span class="tg" data-tg="${n.id}">${has ? ic(isOpen ? 'down' : 'right') : ''}</span>
        <img class="im" src="${thumbUrl(n)}" alt=""><span class="t">${esc(label(n))}</span></div>${isOpen ? rows(n.id, depth + 1).join('') : ''}`;
    });
    const paint = () => {
      const top = tree.scrollTop;
      tree.innerHTML = `<div class="tn root ${pick === null ? 'pick' : ''}" data-id=""><span class="tg"></span><span class="im" style="display:grid;place-items:center">${ic('home')}</span><span class="t">ชั้นนอกสุด</span></div>${rows(null, 0).join('')}`;
      tree.scrollTop = top;
      $('#newLbl', s.el).textContent = `สร้างกล่อง / ถุง / ชั้น / ตู้ใหม่ ไว้ใน “${pick ? label(S.nodes.get(pick)) : 'ชั้นนอกสุด'}”`;
    };
    paint();
    tree.addEventListener('click', e => {
      const tg = e.target.closest('[data-tg]');
      if (tg) { open.has(tg.dataset.tg) ? open.delete(tg.dataset.tg) : open.add(tg.dataset.tg); return paint(); }
      const r = e.target.closest('.tn'); if (!r) return;
      pick = r.dataset.id || null; paint();
    });
    let done = false;
    const fin = v => { if (done) return; done = true; s.close(); res(v); };
    s.el.addEventListener('click', e => {
      if (e.target.closest('[data-new]')) {
        openForm({ type: 'box', lockType: true, noAgain: true, parent: pick, title: 'สร้างที่เก็บใหม่', onSaved: n => {
          pick = n.id; ancestors(n.id).forEach(a => open.add(a.id)); paint();
        } });
      } else if (e.target.closest('[data-ok]')) fin({ id: pick });
      else if (e.target.closest('[data-cancel]')) fin(undefined);
    });
    s.scrim.onclose = () => fin(undefined);
  });
}

async function zoom(id) {
  const n = S.nodes.get(id); if (!n) return;
  const blob = (await DB.photo(id)) || n.thumb;
  const url = URL.createObjectURL(blob);
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.innerHTML = `<img src="${url}" alt="${esc(label(n))}"><button aria-label="ปิด">${ic('x')}</button>`;
  d.onclick = () => { d.remove(); URL.revokeObjectURL(url); };
  document.body.append(d);
}

/* ───────────── data operations ───────────── */
// a fresh in-memory copy of a blob that was read back from IndexedDB, safe to store again
const fresh = async b => (b ? new Blob([await b.arrayBuffer()], { type: b.type }) : null);
async function rebuildThumb(id) {
  const photo = await DB.photo(id);
  if (!photo) return null;
  if ((photo.type || '').includes('svg')) return photo; // drawn pictures are already tiny
  const { thumb } = await processImage(photo, true);
  return thumb;
}
async function commit({ put = [], del = [], photos = [], thumbs = [] }, undoLabel) {
  const prev = put.map(n => S.nodes.get(n.id)).filter(Boolean);
  const gone = del.map(id => S.nodes.get(id)).filter(Boolean);
  const gonePhotos = undoLabel ? await Promise.all(gone.map(async n => [n.id, await fresh(await DB.photo(n.id))])) : [];
  const goneThumbs = undoLabel ? await Promise.all(gone.map(async n => [n.id, await fresh(n.thumb)])) : [];
  await DB.write({ put, del, photos, thumbs });
  del.forEach(id => { const c = S.urls.get(id); if (c) URL.revokeObjectURL(c.url); S.urls.delete(id); S.nodes.delete(id); });
  put.forEach(n => S.nodes.set(n.id, n));
  reindex();
  if (undoLabel) {
    toast(undoLabel, { label: 'เลิกทำ', fn: async () => {
      await DB.write({ put: [...prev, ...gone], photos: gonePhotos, thumbs: goneThumbs });
      [...prev, ...gone].forEach(n => S.nodes.set(n.id, n));
      reindex(); render({ keep: true }); toast('กู้คืนแล้ว');
    } });
  }
  navigator.storage?.persist?.();
}
const moveNodes = (ids, parent) => commit({ put: ids.map(id => ({ ...S.nodes.get(id), parent, updated: Date.now() })) });

async function deleteNode(id) {
  const n = S.nodes.get(id); if (!n) return false;
  const sub = descendants(id);
  const items = sub.filter(x => x.type === 'item').length;
  let mode = 'all';
  if (n.type === 'box' && sub.length) {
    mode = await ask({
      title: `ลบ “${label(n)}”`,
      text: `ข้างในมีของ ${items} ชิ้น${sub.length - items ? ` และกล่องย่อย ${sub.length - items} กล่อง` : ''} จะให้ทำอย่างไร`,
      buttons: [
        { label: 'ลบแค่กล่อง — ย้ายของข้างในออกมาไว้ชั้นนอก', value: 'unwrap' },
        { label: 'ลบทั้งหมด รวมของข้างใน', value: 'all', cls: 'danger' },
        { label: 'ยกเลิก', value: null },
      ],
    });
    if (!mode) return false;
  } else {
    const ok = await ask({ title: `ลบ “${label(n)}”?`, buttons: [{ label: 'ลบ', value: true, cls: 'danger' }, { label: 'ยกเลิก', value: null }] });
    if (!ok) return false;
  }
  if (mode === 'unwrap') {
    const now = Date.now();
    await commit({ put: children(id).map(k => ({ ...k, parent: n.parent || null, updated: now })), del: [id] }, `ลบ “${label(n)}” แล้ว`);
  } else {
    await commit({ del: [id, ...sub.map(x => x.id)] }, `ลบ “${label(n)}” แล้ว`);
  }
  return true;
}

/* ───────────── drawn stand-in pictures (no photo needed) ───────────── */
const BUILD = '2026-11-04-a';
// if a stale page came without the picture library, fetch it now (cache-busted) instead of failing silently
let artLoading = null;
function ensureArt() {
  if (window.ARTCAT) return Promise.resolve(true);
  if (artLoading) return artLoading;
  const load = src => new Promise(ok => { const el = document.createElement('script'); el.src = `${src}?v=${BUILD}`; el.onload = () => ok(true); el.onerror = () => ok(false); document.head.append(el); });
  artLoading = (async () => { if (!window.ART && !(await load('art-icons.js'))) return false; if (!(await load('art-catalog.js'))) return false; return !!window.ARTCAT; })().finally(() => { artLoading = null; });
  return artLoading;
}
const svgBlob = svg => new Blob([svg], { type: 'image/svg+xml' });
function letterSvg(name) {
  const ch = Array.from((name || '?').trim())[0] || '?';
  const h = [...(name || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7), hue = Math.abs(h) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue},55%,42%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#l)"/><text x="50" y="68" font-size="56" font-weight="700" text-anchor="middle" fill="#fff" font-family="Kanit,Sarabun,sans-serif">${esc(ch)}</text></svg>`;
}
// choose an icon by hand: search + category tabs
function pickArt({ query = '', type = 'item' } = {}) {
  return new Promise(res => {
    const C = window.ARTCAT; if (!C) { toast('ยังโหลดชุดภาพวาดไม่ได้ ลองกดปุ่มรีเฟรชมุมซ้ายล่างแล้วลองใหม่'); return res(undefined); }
    const cats = Object.keys(C.CATS), norm = t => String(t || '').toLowerCase().replace(/[\s_\-.,()/]+/g, '');
    let cat = type === 'box' ? 'place' : (C.match(query)?.cat || 'meat');
    const s = sheet(`<h3>เลือกภาพวาด</h3>
      <div class="search" style="margin-bottom:10px">${ic('search')}<input id="aq" type="text" placeholder="ค้นหาชื่อภาพ เช่น ไก่ ซอส ตู้" value="${esc(query)}" autocomplete="off"></div>
      <div class="tagbar" id="acats" style="padding-top:0"></div>
      <div class="artgrid" id="agrid"></div>
      <div class="actions"><button class="btn" data-cancel>ยกเลิก</button></div>`);
    const paint = () => {
      const q = norm($('#aq', s.el).value);
      const list = q ? C.list.filter(e => e.k.some(k => norm(k).includes(q))).slice(0, 120) : C.list.filter(e => e.cat === cat);
      $('#acats', s.el).innerHTML = cats.map(k => `<button type="button" class="chip ${!q && k === cat ? 'on' : ''}" data-c="${k}">${esc(C.CATS[k].name)}</button>`).join('');
      $('#agrid', s.el).innerHTML = list.length ? list.map(e => `<button type="button" class="artitem" data-id="${e.id}">${C.render(e)}<span>${esc(e.n)}</span></button>`).join('')
        : '<p style="grid-column:1/-1;text-align:center;color:var(--muted)">ไม่พบภาพที่ตรงกับคำนี้ ลองคำสั้นลง หรือเลือกจากหมวดด้านบน</p>';
    };
    paint();
    let done = false;
    const fin = v => { if (done) return; done = true; s.close(); res(v); };
    $('#aq', s.el).addEventListener('input', paint);
    s.el.addEventListener('click', e => {
      const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; $('#aq', s.el).value = ''; paint(); return; }
      const it = e.target.closest('[data-id]'); if (it) return fin(C.byId(it.dataset.id));
      if (e.target.closest('[data-cancel]')) fin(undefined);
    });
    s.scrim.onclose = () => fin(undefined);
  });
}

/* ───────────── add / edit form ───────────── */
function openForm(opts = {}) {
  const ex = opts.id ? S.nodes.get(opts.id) : null;
  const d = {
    type: ex ? ex.type : (opts.type || 'item'),
    parent: ex ? ex.parent : (opts.parent || null),
    photo: ex ? { url: thumbUrl(ex), isNew: false, art: !!ex.art } : null,
    kind: ex?.kind || '', autoName: '',
    tags: [...(ex?.tags || [])], manage: false, pendingDel: null,
  };
  const lock = !!ex || opts.lockType;
  const exclude = ex ? new Set([ex.id, ...descendants(ex.id).map(x => x.id)]) : new Set();
  const kinds = ['ตู้', 'ชั้น', 'ลิ้นชัก', 'กล่อง', 'ถุง', 'ซอง', 'ตู้เย็น', 'โฟลเดอร์'];
  const units = ['ชิ้น', 'อัน', 'หัว', 'ถุง', 'กล่อง', 'ขวด', 'แพ็ค', 'กก.', 'กรัม', 'ลิตร', 'ฟอง'];
  const s = sheet(`<form id="f" novalidate>
    <h3>${esc(opts.title || (ex ? 'แก้ไข' : 'เพิ่มใหม่'))}</h3>
    ${lock ? '' : `<div class="tabs"><button type="button" data-t="item">${ic('tag')} ของ</button><button type="button" data-t="box">${ic('box')} กล่อง / ที่เก็บ</button></div>`}
    <div class="field"><div class="drop" id="drop"></div><div class="hint" id="photoHint">ไม่ต้องถ่ายก็ได้ — พิมพ์ชื่อแล้วระบบวาดภาพให้ตามชื่อ ถ่ายรูปจริงทีหลังได้</div></div>
    <div class="field"><label for="fn" id="nl"></label><input id="fn" maxlength="120" autocomplete="off" value="${esc(ex?.name || '')}"></div>
    <div class="field hidden" id="kindRow"><label>เป็นอะไร <span style="color:var(--muted);font-weight:400">(แตะเลือก ระบบจะตั้งชื่อ + เลขให้ เช่น กล่อง 2)</span></label>
      <div class="actions" style="margin-top:0;gap:6px">${kinds.map(k => `<button type="button" class="chip" data-kind="${k}">${k}</button>`).join('')}</div></div>
    <div id="itemOnly">
      <div class="two">
        <div class="field"><label for="fq">จำนวน</label><input id="fq" type="number" inputmode="decimal" min="0" step="any" value="${ex ? ex.qty : 1}"></div>
        <div class="field"><label for="fu">หน่วย</label><input id="fu" list="units" maxlength="12" value="${esc(ex?.unit ?? 'ชิ้น')}"><datalist id="units">${units.map(u => `<option value="${u}">`).join('')}</datalist></div>
      </div>
      <div class="field"><label for="fe">วันหมดอายุ <span style="color:var(--muted);font-weight:400">(ถ้ามี)</span></label>
        <input id="fe" type="date" value="${esc(ex?.expiry || '')}">
        <div class="actions" style="margin-top:8px;gap:6px">${[['+3 วัน', 3], ['+1 สัปดาห์', 7], ['+1 เดือน', 30], ['+6 เดือน', 182], ['+1 ปี', 365]].map(([t, v]) => `<button type="button" class="chip" data-add="${v}">${t}</button>`).join('')}<button type="button" class="chip" data-add="0" style="background:var(--surface2);color:var(--muted)">ล้าง</button></div>
      </div>
    </div>
    <div class="field"><label>แท็ก <button type="button" class="linkbtn" id="tagManage">จัดการแท็ก</button></label>
      <div class="actions" id="tagChips" style="margin-top:0;gap:6px"></div>
      <div style="display:flex;gap:8px;margin-top:8px"><input id="ftNew" placeholder="พิมพ์แท็กใหม่ แล้วกด + เพิ่ม" maxlength="30" style="flex:1;width:auto"><button type="button" class="btn" id="tagAdd" style="height:46px;padding:0 16px">${ic('plus')} เพิ่ม</button></div></div>
    <div class="field"><label for="fo">บันทึกเพิ่มเติม</label><textarea id="fo" placeholder="ยี่ห้อ ขนาด รายละเอียดที่อยากจำ">${esc(ex?.note || '')}</textarea></div>
    <div class="field"><label>เก็บไว้ที่ <span style="color:var(--muted);font-weight:400">(แตะเพื่อเลือก หรือสร้างกล่อง/ชั้นใหม่พร้อมถ่ายรูป)</span></label>
      <button type="button" class="btn block" id="loc" style="height:auto;min-height:46px;padding:8px 16px;justify-content:space-between;text-align:left"><span id="locT"></span>${ic('right')}</button></div>
    <div class="actions" style="margin-top:6px">
      <button class="btn primary" style="flex:1" id="save">${ic('check')} บันทึก</button>
      ${ex || opts.noAgain ? '' : `<button type="button" class="btn" id="again">บันทึกและเพิ่มต่อ</button>`}
      <button type="button" class="btn" data-cancel>ยกเลิก</button>
    </div></form>`);
  const $f = sel => $(sel, s.el);
  const paintDrop = () => {
    const dr = $f('#drop');
    dr.classList.toggle('has', !!d.photo);
    if (d.photo) {
      const art = d.photo.art;
      dr.innerHTML = `<img class="pv" src="${d.photo.url}" alt="">${art ? `<span class="artnote">ภาพวาด${d.photo.label ? ' · ' + esc(d.photo.label) : ''}</span>` : ''}
        <div class="row2"><button type="button" class="btn" data-p="cam">${ic('camera')} ${art ? 'ถ่ายรูปจริงแทน' : 'ถ่ายใหม่'}</button><button type="button" class="btn" data-p="gal">${ic('image')} เลือกรูปอื่น</button><button type="button" class="btn" data-art>${ic('star')} ${art ? 'เลือกไอคอนอื่น' : 'ใช้ภาพวาดแทน'}</button></div>`;
    } else {
      dr.innerHTML = `<div style="color:var(--accent)">${ic(d.type === 'box' ? 'box' : 'camera').replace('class="i ', 'class="i " style="width:48px;height:48px" data-x="')}</div>
         <p>${d.type === 'box' ? 'ถ่ายรูปกล่อง ถุง ตู้ หรือชั้นที่ใช้เก็บของ' : 'ถ่ายรูปของชิ้นนี้ให้เห็นชัดๆ'}<br><span style="font-size:.85rem">หรือพิมพ์ชื่อด้านล่าง ระบบจะวาดภาพให้</span></p>
         <div class="row2"><button type="button" class="btn primary" data-p="cam">${ic('camera')} ถ่ายรูป</button><button type="button" class="btn" data-p="gal">${ic('image')} เลือกจากคลังรูป</button><button type="button" class="btn" data-art>${ic('star')} เลือกภาพวาด</button></div>`;
    }
  };
  // drawn picture chosen by us (from the typed name) or by the user (from the icon list)
  const setArt = (entry, auto) => {
    const svg = entry.id === 'letter' ? letterSvg(entry.name) : window.ARTCAT.render(entry);
    const blob = svgBlob(svg);
    if (d.photo?.isNew) URL.revokeObjectURL(d.photo.url);
    d.photo = { art: true, artId: entry.id, auto, label: entry.id === 'letter' ? '' : entry.n, isNew: true, full: blob, thumb: blob, url: URL.createObjectURL(blob) };
  };
  const suggest = () => {
    if (!window.ARTCAT || (d.photo && !(d.photo.art && d.photo.auto && d.photo.isNew))) return false; // a real photo or a hand-picked icon stays
    const name = $f('#fn').value.trim();
    const entry = (name && window.ARTCAT.match(name)) || (d.type === 'box' && !name && d.kind ? window.ARTCAT.match(d.kind) : null);
    if (entry) setArt(entry, true);
    else if (name) setArt({ id: 'letter', name }, true);
    else if (d.photo) { URL.revokeObjectURL(d.photo.url); d.photo = null; }
    paintDrop();
    return true;
  };
  const paintType = () => {
    $$('.tabs button', s.el).forEach(b => b.classList.toggle('on', b.dataset.t === d.type));
    $f('#itemOnly').classList.toggle('hidden', d.type !== 'item');
    $f('#kindRow').classList.toggle('hidden', d.type !== 'box');
    $$('[data-kind]', s.el).forEach(b => b.classList.toggle('on', b.dataset.kind === d.kind));
    $f('#nl').innerHTML = d.type === 'item' ? 'ชื่อของ <em>*</em>' : 'ชื่อ <span style="color:var(--muted);font-weight:400">(ไม่ใส่ก็ได้)</span>';
    $f('#fn').placeholder = d.type === 'item' ? 'เช่น ไขควงปากแฉก, มันฝรั่ง' : 'เช่น กล่องเครื่องมือ, ตู้เย็น ชั้น 2';
    if (!d.photo) paintDrop();
  };
  const paintLoc = () => { $f('#locT').textContent = locText(d.parent); };
  const paintTags = () => {
    const all = [...new Set([...tagList, ...d.tags])];
    $f('#tagChips').innerHTML = all.length ? all.map(t => {
      if (!d.manage) return `<button type="button" class="chip ${d.tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`;
      return d.pendingDel === t
        ? `<button type="button" class="chip danger" data-deltag="${esc(t)}">แตะอีกครั้งเพื่อลบ “${esc(t)}”</button>`
        : `<button type="button" class="chip" data-deltag="${esc(t)}">${esc(t)} <span class="tx">✕</span></button>`;
    }).join('') : '<span style="color:var(--muted);font-size:.9rem">ยังไม่มีแท็ก พิมพ์เพิ่มด้านล่างได้เลย</span>';
    $f('#tagManage').textContent = d.manage ? 'เสร็จ' : 'จัดการแท็ก';
  };
  const addTag = () => {
    const inp = $f('#ftNew'), t = inp.value.trim().replace(/^#/, '');
    if (!t) return;
    const hit = [...tagList, ...d.tags].find(x => x.toLowerCase() === t.toLowerCase());
    const name = hit || t;
    if (!tagList.includes(name)) { tagList.push(name); saveTags(); }
    if (!d.tags.includes(name)) d.tags.push(name);
    inp.value = ''; paintTags();
  };
  $f('#ftNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  ensureArt().then(ok => { if (ok) suggest(); else toast('ยังโหลดชุดภาพวาดไม่ได้ กดปุ่มรีเฟรชมุมซ้ายล่างแล้วลองใหม่'); });
  let sgT; $f('#fn').addEventListener('input', () => { clearTimeout(sgT); sgT = setTimeout(suggest, 180); });
  paintDrop(); paintType(); paintLoc(); paintTags();

  s.el.addEventListener('click', async e => {
    const t = e.target.closest('[data-t]');
    if (t) { d.type = t.dataset.t; paintType(); suggest(); return; }
    if (e.target.closest('[data-art]')) {
      await ensureArt();
      const en = await pickArt({ query: $f('#fn').value, type: d.type });
      if (en) { setArt(en, false); paintDrop(); }
      return;
    }
    const p = e.target.closest('[data-p]');
    if (p) {
      const f = await choosePhoto(p.dataset.p === 'cam');
      if (!f) return;
      const dr = $f('#drop'); dr.insertAdjacentHTML('beforeend', `<div class="spin" style="position:absolute;top:14px;right:14px;color:var(--accent)"></div>`);
      try {
        const r = await processImage(f);
        if (d.photo?.isNew) URL.revokeObjectURL(d.photo.url);
        d.photo = { ...r, url: URL.createObjectURL(r.thumb), isNew: true };
        dr.classList.remove('err');
      } catch { toast('อ่านรูปนี้ไม่ได้ ลองรูปอื่นนะ'); }
      paintDrop();
      return;
    }
    const tg = e.target.closest('[data-tag]');
    if (tg) { const t = tg.dataset.tag; d.tags = d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t]; paintTags(); return; }
    if (e.target.closest('#tagManage')) { d.manage = !d.manage; d.pendingDel = null; paintTags(); return; }
    if (e.target.closest('#tagAdd')) { addTag(); return; }
    const dt = e.target.closest('[data-deltag]');
    if (dt) {
      const t = dt.dataset.deltag;
      if (d.pendingDel === t) { tagList = tagList.filter(x => x !== t); d.tags = d.tags.filter(x => x !== t); d.pendingDel = null; saveTags(); }
      else { d.pendingDel = t; setTimeout(() => { if (d.pendingDel === t) { d.pendingDel = null; paintTags(); } }, 3000); }
      paintTags();
      return;
    }
    const kb = e.target.closest('[data-kind]');
    if (kb) {
      const k = kb.dataset.kind, nm = $f('#fn');
      const wasAuto = !nm.value.trim() || nm.value === d.autoName;
      d.kind = d.kind === k ? '' : k;
      if (wasAuto) {
        const c = [...S.nodes.values()].filter(x => x.kind === k && x.id !== ex?.id).length;
        d.autoName = d.kind ? `${k} ${c + 1}` : '';
        nm.value = d.autoName;
      }
      paintType(); suggest();
      return;
    }
    const a = e.target.closest('[data-add]');
    if (a) {
      const v = +a.dataset.add;
      if (!v) { $f('#fe').value = ''; return; }
      const dt = new Date(); dt.setDate(dt.getDate() + v);
      $f('#fe').value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      return;
    }
    if (e.target.closest('#loc')) {
      const r = await pickLocation({ title: 'เก็บไว้ที่ไหน', exclude, current: d.parent, confirm: 'เลือกที่นี่' });
      if (r) { d.parent = r.id; paintLoc(); }
      return;
    }
    if (e.target.closest('[data-cancel]')) s.close();
  });

  const save = async again => {
    const name = $f('#fn').value.trim();
    if (d.type === 'item' && !name) { $f('#fn').focus(); toast('ใส่ชื่อของด้วยนะ'); return; }
    if (!d.photo) { // nothing chosen: draw a picture from the name (or the kind / a plain box)
      await ensureArt();
      const C = window.ARTCAT;
      const entry = C && ((name && C.match(name)) || (d.kind && C.match(d.kind)) || (d.type === 'box' ? C.match('กล่อง') : null));
      if (entry) setArt(entry, true); else setArt({ id: 'letter', name: name || '?' }, true);
    }
    const now = Date.now();
    const n = ex ? { ...ex } : { id: uid(), created: now };
    Object.assign(n, {
      type: d.type, parent: d.parent || null, name, updated: now, kind: d.type === 'box' ? d.kind : '',
      note: $f('#fo').value.trim(),
      tags: [...d.tags],
      qty: d.type === 'item' ? Math.max(0, num($f('#fq').value)) : 0,
      unit: d.type === 'item' ? $f('#fu').value.trim() : '',
      expiry: d.type === 'item' ? ($f('#fe').value || '') : '',
    });
    if (d.photo.isNew) { n.thumb = d.photo.thumb; if (d.photo.art) n.art = d.photo.artId; else delete n.art; }
    $f('#save').disabled = true;
    try {
      await commit({ put: [n], photos: d.photo.isNew ? [[n.id, d.photo.full]] : [], thumbs: d.photo.isNew ? [[n.id, d.photo.thumb]] : [] });
    } catch (err) {
      console.error(err);
      $f('#save').disabled = false;
      toast('บันทึกไม่สำเร็จ ลองอีกครั้งนะ');
      return;
    }
    s.close();
    opts.onSaved?.(n);
    if (again) { openForm({ type: n.type, parent: n.parent, lockType: opts.lockType }); toast(`เพิ่ม “${label(n)}” แล้ว`); }
    else toast(ex ? 'บันทึกแล้ว' : `เพิ่ม “${label(n)}” แล้ว`);
    render({ keep: true });
  };
  $f('#f').addEventListener('submit', e => { e.preventDefault(); save(false); });
  $f('#again')?.addEventListener('click', () => save(true));
}

/* ───────────── views ───────────── */
function route() {
  let h = location.hash.slice(1) || '/';
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  if (h.startsWith('/n/')) return { name: 'node', id: h.slice(3) };
  if (h === '/s' || h.startsWith('/s/')) return { name: 'search', q: h.slice(3) };
  if (h === '/l' || h.startsWith('/l/')) return { name: 'list', id: h.slice(3) };
  if (h === '/exp') return { name: 'exp' };
  if (h === '/set') return { name: 'set' };
  return { name: 'home' };
}

function badgesHtml(n) {
  let h = '';
  if (n.type === 'item') {
    h += n.qty > 0 ? `<span class="badge">${ic('layers')} ${fmtNum(n.qty)} ${esc(n.unit)}</span>` : `<span class="badge bad">หมดแล้ว</span>`;
    const e = expInfo(n);
    if (e && n.qty > 0) h += `<span class="badge ${e.cls}">${ic('cal')} ${e.txt}</span>`;
  } else {
    const c = itemsUnder(n.id).length, a = alertCount(n.id);
    h += `<span class="badge">${ic('box')} ข้างใน ${c} ชิ้น</span>`;
    if (a) h += `<span class="badge bad">${ic('alert')} ใกล้หมดอายุ ${a}</span>`;
  }
  return h;
}

function cardHtml(n) {
  const sel = S.sel?.has(n.id);
  let tags = '', sub = '';
  if (n.type === 'box') {
    const k = children(n.id);
    tags += `<span class="tag tl box">${ic('box')} ${n.kind ? esc(n.kind) + ' · ' : ''}${itemsUnder(n.id).length} ชิ้น</span>`;
    const a = alertCount(n.id);
    if (a) tags += `<span class="tag tr bad">${ic('alert')} ${a}</span>`;
    sub = k.length ? k.slice(0, 3).map(label).join(', ') + (k.length > 3 ? ` +${k.length - 3}` : '') : 'ยังว่างอยู่';
  } else {
    const e = expInfo(n);
    if (n.qty <= 0) tags += `<span class="tag tl bad">หมดแล้ว</span>`;
    else if (n.qty !== 1 || (n.unit && n.unit !== 'ชิ้น')) tags += `<span class="tag bl">× ${fmtNum(n.qty)} ${esc(n.unit)}</span>`;
    if (e && n.qty > 0 && (e.cls === 'bad' || e.cls === 'warn')) tags += `<span class="tag tr ${e.cls}">${e.txt}</span>`;
    sub = n.expiry ? `หมดอายุ ${fmtDate(n.expiry)}` : (n.note.split('\n')[0] || '');
  }
  return `<div class="card ${sel ? 'sel' : ''}" data-go="${n.id}" data-card="1" role="button" tabindex="0">
    <div class="ph"><img src="${thumbUrl(n)}" alt="" loading="lazy">${tags}${S.sel ? `<span class="check">${ic('check')}</span>` : ''}</div>
    <div class="body"><div class="nm ${n.name ? '' : 'none'}">${n.fav ? '<span class="star">★</span> ' : ''}${esc(n.name || 'ไม่มีชื่อ')}</div><div class="sub">${esc(sub)}</div></div></div>`;
}

// where something lives: a strip of photo chips, outermost first; the innermost (where it really sits) is outlined
function pathHtml(n) {
  const a = ancestors(n.id);
  if (!a.length) return `<div class="strip"><b>อยู่ใน</b><span class="muted">${ic('home')} ชั้นนอกสุด</span></div>`;
  return `<div class="strip"><b>อยู่ใน</b>${a.map((x, i) => `<span class="p ${i === a.length - 1 ? 'in' : ''}" data-go="${x.id}"><img src="${thumbUrl(x)}" alt=""><span>${esc(label(x))}</span></span>`).join(`<span class="sepi">${ic('right')}</span>`)}</div>`;
}
function rowHtml(n, terms = [], attr = 'data-go') {
  return `<div class="row" ${attr}="${n.id}" role="button" tabindex="0"><img class="thumb" src="${thumbUrl(n)}" alt="" loading="lazy">
    <div class="mid"><div class="nm">${n.fav ? '<span class="star">★</span> ' : ''}${hl(label(n), terms)}</div><div class="meta">${badgesHtml(n)}</div></div>${pathHtml(n)}</div>`;
}
function hl(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}

const searchBox = (v = '') => `<div class="search">${ic('search')}<input id="q" type="text" enterkeyhint="search" placeholder="ค้นหาชื่อของ เช่น ไขควง, มันฝรั่ง…" value="${esc(v)}" autocomplete="off" autocapitalize="off">${v ? `<button class="clear" data-act="clearq" aria-label="ล้างคำค้น">${ic('x')}</button>` : ''}</div>`;

function crumbsHtml(id) {
  const a = ancestors(id), cur = S.nodes.get(id);
  return `<div class="crumbs"><a class="crumb home" href="#/">${ic('home')}<span>ทั้งหมด</span></a>${a.map(x => `${ic('right', 'sep')}<span class="crumb" data-go="${x.id}"><img class="dot" src="${thumbUrl(x)}" alt=""><span>${esc(label(x))}</span></span>`).join('')}${ic('right', 'sep')}<span class="crumb cur"><img class="dot" src="${thumbUrl(cur)}" alt=""><span>${esc(label(cur))}</span></span></div>`;
}

function gridSection(parentId, compact = false) {
  const k = children(parentId);
  const here = parentId ? S.nodes.get(parentId) : null;
  if (!k.length) {
    return `<div class="empty"><div class="big">${ic(parentId ? 'box' : 'camera')}</div>
      <h3>${parentId ? 'กล่องนี้ยังว่างอยู่' : 'เริ่มเก็บของชิ้นแรกกันเลย'}</h3>
      <p>${parentId ? 'กด “เพิ่ม” เพื่อถ่ายรูปของแล้วใส่ไว้ในนี้' : 'ถ่ายรูปของ → ใส่กล่อง → วางบนชั้น แล้วค้นหาชื่อของได้ทันที ว่าอยู่ตรงไหนของบ้าน'}</p>
      <button class="btn primary" data-act="add">${ic('camera')} ${parentId ? 'เพิ่มของชิ้นแรก' : 'ถ่ายรูปชิ้นแรก'}</button></div>`;
  }
  return `<div class="sec"><h2>${here ? 'ข้างใน' : 'ที่เก็บและของทั้งหมด'} <small>${k.length} รายการ</small></h2>
    <button class="badge" data-act="${S.sel ? 'selcancel' : 'selstart'}" style="padding:5px 12px">${S.sel ? 'ยกเลิกเลือก' : `${ic('select')} เลือกหลายอัน`}</button></div>
    ${compact ? `<div class="list">${k.map(smallRow).join('')}</div>` : `<div class="grid ${S.sel ? 'selmode' : ''}">${k.map(cardHtml).join('')}</div>`}`;
}

function pageHome() {
  const all = [...S.nodes.values()];
  const items = all.filter(n => n.type === 'item').length, boxes = all.length - items, al = alertItems().length;
  const favs = all.filter(n => n.fav).sort(cmp);
  const count = new Map();
  all.forEach(n => (n.tags || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
  const order = [...tagList, ...[...count.keys()].filter(t => !tagList.includes(t))].filter(t => count.has(t));
  if (S.tagFilter && !count.has(S.tagFilter)) S.tagFilter = null;
  const tagRow = order.length ? `<div class="tagrow">${order.map(t => `<button class="chip ${S.tagFilter === t ? 'on' : ''}" data-act="tagf" data-tag="${esc(t)}">${esc(t)} <small>${count.get(t)}</small></button>`).join('')}</div>` : '';
  let body;
  if (S.tagFilter) {
    const res = all.filter(n => (n.tags || []).includes(S.tagFilter)).sort(cmp);
    body = `<div class="sec"><h2>แท็ก “${esc(S.tagFilter)}” <small>${res.length} รายการ</small></h2><button class="badge" data-act="tagf" data-tag="${esc(S.tagFilter)}" style="padding:5px 12px">${ic('x')} ล้างตัวกรอง</button></div><div class="list">${res.map(n => rowHtml(n)).join('')}</div>`;
  } else {
    const exp = alertItems().sort((a, b) => a.expiry.localeCompare(b.expiry));
    body = `${exp.length ? `<div class="sec"><h2>${ic('alert')} ของใกล้หมดอายุ <small>${exp.length}</small></h2>${exp.length > 5 ? `<a class="badge" href="#/exp" style="padding:5px 12px">ดูทั้งหมด</a>` : ''}</div><div class="list">${exp.slice(0, 5).map(n => miniItem(n, true)).join('')}</div>` : ''}
      ${favs.length ? `<div class="sec"><h2><span class="star">★</span> รายการโปรด <small>${favs.length}</small></h2></div><div class="favrow ${S.sel ? 'selmode' : ''}">${favs.map(cardHtml).join('')}</div>` : ''}
      ${gridSection(null, true)}`;
  }
  return `<div class="top"><div class="brand"><div class="logo">${ic('box')}</div><h1>ของอยู่ไหน</h1></div>${searchBox()}</div>
    ${all.length ? `<div class="stats"><div class="stat"><b>${items}</b><small>ของทั้งหมด</small></div><div class="stat"><b>${boxes}</b><small>กล่อง / ที่เก็บ</small></div>
      <a class="stat ${al ? 'alert' : ''}" href="#/exp"><b>${al}</b><small>ใกล้หมดอายุ</small></a></div>${tagRow}` : ''}
    ${body}`;
}

function pageNode(id) {
  const n = S.nodes.get(id);
  if (!n) { location.replace('#/'); return ''; }
  document.title = `${label(n)} — ของอยู่ไหน`;
  const acts = `<div class="actions"><button class="btn" data-act="edit" data-id="${id}">${ic('edit')} แก้ไข</button><button class="btn" data-act="move" data-id="${id}">${ic('move')} ย้ายที่เก็บ</button><button class="btn danger" data-act="del" data-id="${id}">${ic('trash')} ลบ</button></div>`;
  const tagsHtml = n.tags?.length ? `<div class="chips" style="margin-top:10px">${n.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : '';
  const hero = small => `<div class="hero ${small ? 'small' : ''}" data-act="zoom" data-id="${id}"><img src="${thumbUrl(n)}" data-full="${id}" alt="${esc(label(n))}"></div>`;
  const title = `<div class="titlebar"><h2 class="${n.name ? '' : 'none'}">${esc(n.name || 'ไม่มีชื่อ')}</h2>
    <button class="iconbtn" data-act="fav" data-id="${id}" aria-label="${n.fav ? 'เอาออกจากรายการโปรด' : 'ติดดาวรายการโปรด'}" aria-pressed="${!!n.fav}">${starIc(n.fav)}</button></div>`;

  if (n.type === 'box') {
    return `<div class="top">${searchBox()}</div>${crumbsHtml(id)}${hero(true)}${title}
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 2px">${badgesHtml(n)}</div>
      ${n.note ? `<p class="note" style="margin:10px 2px 0">${esc(n.note)}</p>` : ''}${tagsHtml}${acts}
      <a class="btn block" href="#/l/${id}" style="margin-top:10px">${ic('list')} ดูของข้างในเป็นรายการ</a>${gridSection(id)}`;
  }

  // item detail: the "where is it" photo trail is the point of the app
  const chain = [...ancestors(id), n];
  const steps = chain.map((x, i) => {
    const me = x.id === id;
    const sub = me ? 'ของชิ้นนี้' : `${x.type === 'box' ? 'ที่เก็บ' : ''} ${i === 0 ? '· ชั้นนอกสุด' : ''}`.trim();
    return `<button class="step ${me ? 'me' : ''}" ${me ? '' : `data-go="${x.id}"`}><img class="im" src="${thumbUrl(x)}" alt=""><span class="t">${esc(label(x))}<small>${esc(sub)}</small></span>${me ? '' : ic('right')}</button>`;
  }).join('');
  const e = expInfo(n);
  const back = n.parent ? `<a class="crumb" href="#/n/${n.parent}" style="display:inline-flex;margin:14px 0 4px;padding:4px 14px 4px 8px">${ic('left')}<span>กลับไป ${esc(label(S.nodes.get(n.parent)))}</span></a>` : `<a class="crumb" href="#/" style="display:inline-flex;margin:14px 0 4px;padding:4px 14px 4px 8px">${ic('left')}<span>ทั้งหมด</span></a>`;
  return `<div class="top">${searchBox()}</div>${back}${hero(false)}${title}
    <div class="where"><h3>${n.parent ? 'อยู่ที่นี่ (แตะเพื่อเปิด)' : 'ยังไม่ได้เก็บไว้ในที่ไหน'}</h3><div class="steps">${steps}</div></div>
    <div class="facts">
      <div class="fact"><label>จำนวนคงเหลือ</label><div class="stepper"><button data-act="qty" data-id="${id}" data-d="-1" aria-label="ลด">${ic('minus')}</button><span class="n">${fmtNum(n.qty)}</span><button data-act="qty" data-id="${id}" data-d="1" aria-label="เพิ่ม">${ic('plus')}</button></div><div style="color:var(--muted);font-size:.85rem;margin-top:2px">${esc(n.unit)} ${n.qty <= 0 ? '· หมดแล้ว' : ''}</div></div>
      <div class="fact"><label>วันหมดอายุ</label>${e ? `<div class="v">${fmtDate(n.expiry)}</div><span class="badge ${e.cls}" style="margin-top:4px">${e.txt}</span>` : `<div class="v" style="color:var(--muted);font-weight:400">ไม่ระบุ</div>`}</div>
      ${n.note ? `<div class="fact wide"><label>บันทึก</label><div class="note">${esc(n.note)}</div></div>` : ''}
      ${n.tags?.length ? `<div class="fact wide"><label>แท็ก</label><div class="chips">${n.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div></div>` : ''}
    </div>
    <p style="color:var(--muted);font-size:.8rem;margin:12px 2px 0">เพิ่มเมื่อ ${new Date(n.created).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</p>${acts}`;
}

const pathStr = n => [...ancestors(n.id), n].map(label).join(' › ');
function miniItem(n, withPath = false, terms = []) {
  const where = withPath ? `<div class="sub" style="color:var(--muted);font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.parent ? 'อยู่ใน ' + esc(ancestors(n.id).map(label).join(' › ')) : 'ชั้นนอกสุด'}</div>` : '';
  return `<div class="lrow" data-go="${n.id}" role="button" tabindex="0"><img class="lt" src="${thumbUrl(n)}" alt="" loading="lazy">
    <div class="mid"><div class="nm">${n.fav ? '<span class="star">★</span> ' : ''}${hl(label(n), terms)}</div>${where}<div class="meta">${badgesHtml(n)}</div></div>${ic('right')}</div>`;
}
function smallRow(n) {
  const sel = S.sel?.has(n.id);
  const sub = n.type === 'box' && n.kind && !(n.name || '').startsWith(n.kind) ? `<div class="sub" style="color:var(--muted);font-size:.8rem">${esc(n.kind)}</div>` : '';
  return `<div class="lrow ${sel ? 'sel' : ''}" data-go="${n.id}" data-card="1" role="button" tabindex="0">${S.sel ? `<span class="check">${ic('check')}</span>` : ''}<img class="lt" src="${thumbUrl(n)}" alt="" loading="lazy">
    <div class="mid"><div class="nm ${n.name ? '' : 'none'}">${n.fav ? '<span class="star">★</span> ' : ''}${esc(n.name || 'ไม่มีชื่อ')}</div>${sub}<div class="meta">${badgesHtml(n)}</div></div>${S.sel ? '' : ic('right')}</div>`;
}
/* how many tiles per row: 1 = long rows, 2 / 3 = compact tiles (3 is the default) */
const VIEWKEY = 'stuff-finder:view';
S.view = (() => { try { const v = +localStorage.getItem(VIEWKEY); return [1, 2, 3].includes(v) ? v : 3; } catch { return 3; } })();
const viewSwitch = () => `<div class="sw" role="group" aria-label="จำนวนคอลัมน์">${[1, 2, 3].map(k => `<button type="button" data-act="view" data-n="${k}" class="${S.view === k ? 'on' : ''}" aria-label="${k} คอลัมน์">${ic('v' + k)}</button>`).join('')}</div>`;
function tileHtml(n, { attr = 'data-go', terms = [], where = false } = {}) {
  const e = n.type === 'item' && n.qty > 0 ? expInfo(n) : null;
  const urgent = e && (e.cls === 'bad' || e.cls === 'warn');
  const tag = urgent ? `<span class="ttag ${e.cls}">${e.d < 0 ? 'หมดอายุ' : e.d === 0 ? 'วันนี้' : e.d + ' วัน'}</span>` : '';
  let meta;
  if (n.type === 'item') meta = (n.qty > 0 ? `<span class="badge">${fmtNum(n.qty)} ${esc(n.unit)}</span>` : '<span class="badge bad">หมดแล้ว</span>') + (e && !urgent ? `<span class="badge">${e.txt}</span>` : '');
  else { const c = itemsUnder(n.id).length, a = alertCount(n.id); meta = `<span class="badge">${c} ชิ้น</span>${a ? `<span class="badge bad">${a} ใกล้หมด</span>` : ''}`; }
  const p = n.parent ? S.nodes.get(n.parent) : null;
  const w = where ? (p ? `<span class="twhere" data-go="${p.id}"><img src="${thumbUrl(p)}" alt="">${esc(label(p))}</span>` : '<span class="twhere">ชั้นนอกสุด</span>') : '';
  return `<div class="tile" ${attr}="${n.id}" role="button" tabindex="0"><div class="ph"><img src="${thumbUrl(n)}" alt="" loading="lazy">${tag}${n.fav ? '<span class="tstar">★</span>' : ''}</div>
    <div class="b"><div class="nm">${hl(label(n), terms)}</div><div class="meta">${meta}</div>${w}</div></div>`;
}
const LISTTAB = 'stuff-finder:listtab';
S.listTab = (() => { try { return localStorage.getItem(LISTTAB) === 'box' ? 'box' : 'item'; } catch { return 'item'; } })();
S.listQ = '';
function listMatches(type) {
  const terms = S.listQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rank = n => terms.reduce((a, t) => a + ((n.name || '').toLowerCase().startsWith(t) ? 2 : 1), 0);
  const res = [...S.nodes.values()].filter(n => n.type === type && hasAllTags(n) && terms.every(t => (n.name || '').toLowerCase().includes(t)))
    .sort((a, b) => rank(b) - rank(a) || (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (a.name || '').localeCompare(b.name || '', 'th'));
  return { terms, res };
}
function listResults() {
  const { terms, res } = listMatches(S.listTab);
  const searching = terms.length > 0 || S.stags.size > 0;
  const isItem = S.listTab === 'item';
  if (!res.length) return `<div class="empty"><div class="big">${ic(searching ? 'search' : isItem ? 'tag' : 'box')}</div>
    <h3>${searching ? `ไม่พบ${isItem ? 'ของ' : 'ที่เก็บ'}ที่ค้นหา` : isItem ? 'ยังไม่มีของ' : 'ยังไม่มีตู้ กล่อง หรือถุง'}</h3>
    <p>${searching ? 'ลองใช้คำสั้นลง ค้นหาด้วยชื่อ หรือเอาแท็กที่เลือกออก ดูแท็บอีกฝั่งด้วย (ตัวเลขบนแท็บคือจำนวนที่ตรง)' : 'ไปหน้าแรกกด “เพิ่ม” เพื่อถ่ายรูปชิ้นแรก'}</p></div>`;
  const attr = isItem ? 'data-go' : 'data-gol';
  const head = `<div class="seg"><span class="cnt">${res.length} รายการ</span>${viewSwitch()}</div>`;
  const hint = isItem || searching ? '' : '<p style="color:var(--muted);margin:0 2px 8px">แตะเพื่อดูของทั้งหมดข้างใน</p>';
  return head + hint + (S.view === 1
    ? `<div class="list">${res.map(n => rowHtml(n, terms, attr)).join('')}</div>`
    : `<div class="tiles v${S.view}">${res.map(n => tileHtml(n, { attr, terms, where: true })).join('')}</div>`);
}
function listTabsHtml() {
  const ni = listMatches('item').res.length, nb = listMatches('box').res.length;
  return `<button data-act="ltab" data-tab="item" class="${S.listTab === 'item' ? 'on' : ''}">ของ <small>${ni}</small></button><button data-act="ltab" data-tab="box" class="${S.listTab === 'box' ? 'on' : ''}">ที่เก็บ <small>${nb}</small></button>`;
}
function pageList() {
  return `<div class="top"><div class="brand"><div class="logo">${ic('list')}</div><h1>รายการ</h1></div>
    <div class="tabs" id="ltabs" style="margin-bottom:10px">${listTabsHtml()}</div>
    <div class="search">${ic('search')}<input id="lq" type="text" enterkeyhint="search" placeholder="${S.listTab === 'item' ? 'ค้นหาชื่อของ เช่น ไขควง, มันฝรั่ง…' : 'ค้นหาชื่อตู้ กล่อง ถุง…'}" value="${esc(S.listQ)}" autocomplete="off" autocapitalize="off"></div></div>
    <div id="lres">${listResults()}</div>`;
}
function pageListOf(id) {
  const n = S.nodes.get(id);
  if (!n || n.type !== 'box') { location.replace('#/l'); return ''; }
  document.title = `${label(n)} — ของอยู่ไหน`;
  const groups = [];
  const direct = children(id).filter(x => x.type === 'item');
  if (direct.length) groups.push([null, direct]);
  descendants(id).filter(x => x.type === 'box').sort((a, b) => pathStr(a).localeCompare(pathStr(b), 'th')).forEach(b => {
    const its = children(b.id).filter(x => x.type === 'item');
    if (its.length) groups.push([b, its]);
  });
  const total = itemsUnder(id).length;
  const rel = b => { const ch = [...ancestors(b.id), b]; return ch.slice(ch.findIndex(x => x.id === id) + 1).map(label).join(' › '); };
  return `<div class="top"><a class="crumb" href="#/l" style="display:inline-flex;padding:4px 14px 4px 8px">${ic('left')}<span>รายการที่เก็บ</span></a></div>
    <div class="row" style="margin-top:6px"><img class="thumb" src="${thumbUrl(n)}" alt="" data-act="zoom" data-id="${id}"><div class="mid"><div class="nm" style="font-size:1.25rem">${esc(label(n))}</div>
      <div class="path" style="margin-top:2px">${esc(ancestors(id).map(label).join(' › ') || 'ชั้นนอกสุด')}</div><div class="meta"><span class="badge">${total} ชิ้นข้างใน</span></div></div>
      <button class="iconbtn" data-act="fav" data-id="${id}" aria-label="ติดดาว">${starIc(n.fav)}</button></div>
    <a class="btn block" href="#/n/${id}" style="margin-top:10px">${ic('image')} เปิดดูแบบรูป / เพิ่มของ</a>
    <div class="seg" style="margin-top:14px"><span class="cnt">ของข้างใน ${total} ชิ้น</span>${viewSwitch()}</div>
    ${groups.length ? groups.map(([b, its]) => `<div class="sec"><h2>${b ? `<img class="dot" src="${thumbUrl(b)}" alt="" style="display:inline-block;vertical-align:middle;margin-right:6px">${esc(rel(b))}` : 'วางอยู่ในนี้โดยตรง'} <small>${its.length}</small></h2></div>${S.view === 1 ? `<div class="list">${its.map(x => miniItem(x)).join('')}</div>` : `<div class="tiles v${S.view}">${its.map(x => tileHtml(x)).join('')}</div>`}`).join('')
      : `<div class="empty"><div class="big">${ic('box')}</div><h3>ยังไม่มีของข้างใน</h3><p>แตะ “เปิดดูแบบรูป” แล้วกดเพิ่มของได้เลย</p></div>`}`;
}

// Typed text matches names only; tags are picked with the tag chips under the search box.
const hasAllTags = n => [...S.stags].every(t => (n.tags || []).includes(t));

function pageExp() {
  const items = [...S.nodes.values()].filter(n => n.type === 'item');
  const out = items.filter(n => n.qty <= 0);
  const dated = items.filter(n => n.qty > 0 && n.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const groups = [
    ['หมดอายุแล้ว / วันนี้', dated.filter(n => daysLeft(n.expiry) <= 0)],
    ['ภายใน 7 วัน', dated.filter(n => { const d = daysLeft(n.expiry); return d > 0 && d <= 7; })],
    ['ภายใน 30 วัน', dated.filter(n => { const d = daysLeft(n.expiry); return d > 7 && d <= 30; })],
    ['หลังจากนั้น', dated.filter(n => daysLeft(n.expiry) > 30)],
    ['หมดแล้ว (จำนวน 0)', out],
  ].filter(g => g[1].length);
  return `<div class="top"><div class="brand"><div class="logo">${ic('clock')}</div><h1>วันหมดอายุ</h1></div></div>
    ${groups.length ? groups.map(([t, a]) => `<div class="sec"><h2>${t} <small>${a.length}</small></h2></div><div class="list">${a.map(n => rowHtml(n)).join('')}</div>`).join('')
      : `<div class="empty"><div class="big">${ic('cal')}</div><h3>ยังไม่มีของที่ระบุวันหมดอายุ</h3><p>ตอนเพิ่มของ ใส่วันหมดอายุไว้ แล้วหน้านี้จะเรียงให้ว่าอะไรต้องรีบใช้ก่อน</p></div>`}`;
}

const THEMES = { light: ['ขาว', '#bfe6cc'], gray: ['เทา', '#a3b5aa'], dark: ['ดำ', '#0f3d2a'] };
const THEMEKEY = 'stuff-finder:theme';
const curTheme = () => document.documentElement.dataset.theme || 'light';
function setTheme(t) {
  if (t === 'light') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEMEKEY, t); } catch { /* storage blocked */ }
  $('meta[name="theme-color"]')?.setAttribute('content', THEMES[t][1]);
}
function pageSettings() {
  return `<div class="top"><div class="brand"><div class="logo">${ic('gear')}</div><h1>ตั้งค่าและสำรองข้อมูล</h1></div></div>
    <div class="settings">
      <div class="card2"><h3>โหมดสี</h3><p>เลือกความสว่างของหน้าจอ</p>
        <div class="tabs" style="margin-bottom:0">${Object.entries(THEMES).map(([k, [n]]) => `<button data-act="theme" data-t="${k}" class="${curTheme() === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="card2"><h3>พื้นที่ที่ใช้</h3><p id="usage">กำลังคำนวณ…</p></div>
      <div class="card2"><h3>สำรองข้อมูล</h3><p>ข้อมูลและรูปทั้งหมดเก็บอยู่ในเครื่องนี้เท่านั้น (ไม่ได้อัปโหลดที่ไหน) ควรสำรองเป็นไฟล์เก็บไว้เป็นระยะ เผลอล้างข้อมูลเบราว์เซอร์จะได้ไม่หาย</p>
        <div class="actions" style="margin-top:0"><button class="btn primary" data-act="export" id="bExp">${ic('download')} ดาวน์โหลดไฟล์สำรอง</button><button class="btn" data-act="import">${ic('upload')} นำเข้าจากไฟล์สำรอง</button></div></div>
      <div class="card2"><h3>เวอร์ชัน</h3><p id="ver">${BUILD} · ภาพวาด: ${window.ARTCAT ? window.ARTCAT.list.length + ' รายการพร้อมใช้' : 'ยังโหลดไม่ได้ (กดรีเฟรชมุมซ้ายล่าง)'}</p></div>
      <div class="card2"><h3>ใช้บนมือถือ</h3><p>เปิดหน้านี้ในเบราว์เซอร์มือถือ แล้วเลือก “เพิ่มไปยังหน้าจอหลัก” จะใช้งานเหมือนแอป และเปิดได้แม้ไม่มีอินเทอร์เน็ต</p></div>
      <div class="card2"><h3>ล้างข้อมูลทั้งหมด</h3><p>ลบของ กล่อง และรูปทั้งหมดในเครื่องนี้ กู้คืนไม่ได้ถ้าไม่มีไฟล์สำรอง</p><button class="btn danger" data-act="wipe">${ic('trash')} ลบทุกอย่าง</button></div>
    </div>`;
}

function navHtml() {
  const r = S.route?.name, al = alertItems().length;
  const a = (href, on, icon, t, extra = '') => `<a href="${href}" class="${on ? 'on' : ''}">${ic(icon)}<span>${t}</span>${extra}</a>`;
  return `<div class="in">${a('#/', r === 'home' || r === 'node', 'home', 'ที่เก็บ')}${a('#/l', r === 'list', 'list', 'รายการ')}${a('#/exp', r === 'exp', 'clock', 'หมดอายุ', al ? `<span class="cnt">${al}</span>` : '')}${a('#/set', r === 'set', 'gear', 'ตั้งค่า')}</div>`;
}

function selbarHtml() {
  const n = S.sel.size, off = n ? '' : 'disabled';
  return `<div class="selbar"><span class="cn">เลือก ${n}</span>
    <button class="btn" data-act="selall">ทั้งหมด</button>
    <button class="btn" data-act="selwrap" ${off}>${ic('box')} ใส่กล่องใหม่</button>
    <button class="btn" data-act="selmove" ${off}>${ic('move')} ย้าย</button>
    <button class="btn" data-act="seldel" ${off}>${ic('trash')} ลบ</button>
    <button class="btn" data-act="selcancel">${ic('x')}</button></div>`;
}

let fullUrls = [];
function render({ keep = false } = {}) {
  let r = route();
  if (r.name === 'search') { S.listTab = 'item'; S.listQ = r.q || ''; history.replaceState(null, '', '#/l'); r = route(); } // old search links
  S.route = r;
  const y = window.scrollY;
  document.title = 'ของอยู่ไหน — สมุดจดที่เก็บของ';
  let html = '';
  if (r.name === 'home') html = pageHome();
  else if (r.name === 'node') html = pageNode(r.id);
  else if (r.name === 'list') html = r.id ? pageListOf(r.id) : pageList();
  else if (r.name === 'exp') html = pageExp();
  else html = pageSettings();
  const node = r.name === 'node' ? S.nodes.get(r.id) : null;
  const canAdd = (r.name === 'home' || node?.type === 'box') && !S.sel && S.nodes.size + (r.name === 'home' ? 0 : 1) > 0;
  fullUrls.forEach(u => URL.revokeObjectURL(u)); fullUrls = [];
  $('#app').innerHTML = html + (canAdd ? `<button class="fab" data-act="add">${ic('plus')} เพิ่ม</button>` : '') + (S.sel ? selbarHtml() : '');
  $('#nav').innerHTML = navHtml();
  window.scrollTo(0, keep ? y : 0);
  $$('img[data-full]').forEach(async img => {
    const b = await DB.photo(img.dataset.full).catch(() => null);
    if (b && img.isConnected) { const u = URL.createObjectURL(b); fullUrls.push(u); img.src = u; }
  });
  if (r.name === 'list' && !r.id && S.focusQ) { const q = $('#lq'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  S.focusQ = false;
  paintTagBar(searchFocused() ? true : undefined);
  if (r.name === 'set') showUsage();
}

async function showUsage() {
  const el = $('#usage'); if (!el) return;
  const items = [...S.nodes.values()].filter(n => n.type === 'item').length;
  let txt = `ของ ${items} ชิ้น · ที่เก็บ ${S.nodes.size - items} แห่ง`;
  try {
    const e = await navigator.storage.estimate();
    txt += ` · ใช้พื้นที่ ${(e.usage / 1048576).toFixed(1)} MB`;
    if (navigator.storage.persisted) txt += (await navigator.storage.persisted()) ? ' · เบราว์เซอร์รับปากจะไม่ลบข้อมูลเอง' : ' · เบราว์เซอร์อาจลบข้อมูลเมื่อพื้นที่เต็ม (แนะนำให้สำรองไฟล์)';
  } catch { /* estimate unsupported */ }
  const el2 = $('#usage'); if (el2) el2.textContent = txt;
}

/* ───────────── backup ───────────── */
async function exportAll() {
  const btn = $('#bExp'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังรวมไฟล์…'; }
  const out = { app: 'stuff-finder', version: 1, exported: new Date().toISOString(), tagList, nodes: [] };
  for (const n of S.nodes.values()) out.nodes.push({ ...n, thumb: await blobToData(n.thumb), photo: await blobToData(await DB.photo(n.id)) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  const t = new Date();
  a.download = `ของอยู่ไหน-สำรอง-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (btn) { btn.disabled = false; btn.innerHTML = `${ic('download')} ดาวน์โหลดไฟล์สำรอง`; }
  toast('สร้างไฟล์สำรองแล้ว');
}
async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'stuff-finder' || !Array.isArray(data.nodes)) throw new Error('bad');
    const put = [], photos = [];
    for (const r of data.nodes) {
      const { photo, thumb, ...n } = r;
      n.thumb = await dataToBlob(thumb || photo);
      if (!n.id || !n.thumb) continue;
      put.push(n); photos.push([n.id, await dataToBlob(photo)]);
    }
    await commit({ put, photos, thumbs: put.map(n => [n.id, n.thumb]) });
    if (Array.isArray(data.tagList)) { data.tagList.forEach(t => { if (!tagList.includes(t)) tagList.push(t); }); }
    put.forEach(n => (n.tags || []).forEach(t => { if (!tagList.includes(t)) tagList.push(t); }));
    saveTags();
    render();
    toast(`นำเข้า ${put.length} รายการแล้ว`);
  } catch { toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอปนี้'); }
}

/* ───────────── actions ───────────── */
const curParent = () => (S.route.name === 'node' && S.nodes.get(S.route.id)?.type === 'box' ? S.route.id : null);
const A = {
  add: () => openForm({ parent: curParent() }),
  zoom: d => zoom(d.id),
  edit: d => openForm({ id: d.id }),
  async move(d) {
    const n = S.nodes.get(d.id);
    const r = await pickLocation({ title: `ย้าย “${label(n)}” ไปไว้ที่`, exclude: new Set([n.id, ...descendants(n.id).map(x => x.id)]), current: n.parent, confirm: 'ย้ายมาที่นี่' });
    if (r) { await moveNodes([n.id], r.id); toast('ย้ายแล้ว'); render({ keep: true }); }
  },
  async del(d) {
    const n = S.nodes.get(d.id), parent = n?.parent;
    if (await deleteNode(d.id)) { if (S.route.name === 'node' && S.route.id === d.id) location.hash = parent && S.nodes.has(parent) ? '#/n/' + parent : '#/'; else render({ keep: true }); }
  },
  async qty(d) {
    const n = S.nodes.get(d.id);
    await commit({ put: [{ ...n, qty: Math.max(0, num(n.qty) + +d.d) }] });
    render({ keep: true });
  },
  async fav(d) {
    const n = S.nodes.get(d.id);
    await commit({ put: [{ ...n, fav: !n.fav }] });
    toast(n.fav ? 'เอาออกจากรายการโปรดแล้ว' : 'ติดดาวแล้ว จะขึ้นที่หน้าแรก');
    render({ keep: true });
  },
  theme: d => { setTheme(d.t); render({ keep: true }); },
  view: d => { S.view = +d.n; try { localStorage.setItem(VIEWKEY, String(S.view)); } catch { /* storage blocked */ } render({ keep: true }); },
  ltab: d => {
        S.listTab = d.tab === 'box' ? 'box' : 'item'; S.listQ = '';
    try { localStorage.setItem(LISTTAB, S.listTab); } catch { /* storage blocked */ }
    render();
  },
  stag: d => {
    S.stags.has(d.tag) ? S.stags.delete(d.tag) : S.stags.add(d.tag);
    const r = S.route.name;
    if (r === 'list' && !S.route.id) { $('#lres').innerHTML = listResults(); $('#ltabs').innerHTML = listTabsHtml(); }
    else { S.focusQ = true; S.keepTags = true; location.hash = '#/s/' + encodeURIComponent($('#q')?.value || ''); return; }
    paintTagBar(searchFocused() ? true : undefined);
  },
  tagf: d => { S.tagFilter = S.tagFilter === d.tag ? null : d.tag; render({ keep: true }); },
  clearq: () => { S.focusQ = true; location.hash = '#/l'; },
  selstart: () => { S.sel = new Set(); render({ keep: true }); },
  selcancel: () => { S.sel = null; render({ keep: true }); },
  selall: () => { const k = children(curParent()); S.sel = S.sel.size === k.length ? new Set() : new Set(k.map(x => x.id)); render({ keep: true }); },
  async selmove() {
    const ids = [...S.sel];
    const ex = new Set(ids.flatMap(id => [id, ...descendants(id).map(x => x.id)]));
    const r = await pickLocation({ title: `ย้าย ${ids.length} รายการไปไว้ที่`, exclude: ex, current: curParent(), confirm: 'ย้ายมาที่นี่' });
    if (r) { await moveNodes(ids, r.id); S.sel = null; toast('ย้ายแล้ว'); render({ keep: true }); }
  },
  selwrap() {
    const ids = [...S.sel], parent = curParent();
    openForm({ type: 'box', lockType: true, parent, onSaved: async box => { await moveNodes(ids, box.id); S.sel = null; toast(`ใส่ ${ids.length} รายการลงในกล่องใหม่แล้ว`); render({ keep: true }); } });
  },
  async seldel() {
    const ids = [...S.sel];
    const ok = await ask({ title: `ลบ ${ids.length} รายการ?`, text: 'ถ้ามีกล่อง ของข้างในจะถูกลบด้วย (กดเลิกทำได้ทันทีหลังลบ)', buttons: [{ label: 'ลบ', value: true, cls: 'danger' }, { label: 'ยกเลิก', value: null }] });
    if (!ok) return;
    const all = new Set(ids.flatMap(id => [id, ...descendants(id).map(x => x.id)]));
    await commit({ del: [...all] }, `ลบ ${ids.length} รายการแล้ว`);
    S.sel = null; render({ keep: true });
  },
  export: exportAll,
  import: () => { const i = $('#fileImport'); i.value = ''; i.onchange = () => i.files[0] && importFile(i.files[0]); i.click(); },
  async wipe() {
    const ok = await ask({ title: 'ลบข้อมูลทั้งหมด?', text: 'ของ กล่อง และรูปทั้งหมดจะหายไป กู้คืนไม่ได้', buttons: [{ label: 'ลบทุกอย่าง', value: true, cls: 'danger' }, { label: 'ยกเลิก', value: null }] });
    if (!ok) return;
    await DB.clear(); S.urls.forEach(u => URL.revokeObjectURL(u.url)); S.urls.clear(); S.nodes.clear(); reindex();
    location.hash = '#/'; render(); toast('ลบทั้งหมดแล้ว');
  },
  async reset(d, el) {
    // reload the screen with the latest version; saved items and photos are untouched
    el.classList.add('spinning');
    try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch { /* no cache API */ }
    try { await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister())); } catch { /* no SW */ }
    location.reload();
  },
  toastact: () => { $('#toast').classList.remove('show'); S.toastFn?.(); },
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && A[a.dataset.act]) {
    e.preventDefault();
    Promise.resolve(A[a.dataset.act](a.dataset, a)).catch(err => { console.error(err); toast('ทำไม่สำเร็จ ลองอีกครั้งนะ'); });
    return;
  }
  const near = e.target.closest('[data-go],[data-gol]'); // the closest one wins, so a "where" chip inside a tile opens its own place
  const gl = near?.dataset.gol !== undefined ? near : null;
  if (gl) { location.hash = '#/l/' + gl.dataset.gol; return; }
  const g = near;
  if (g) {
    if (S.sel && g.dataset.card) {
      S.sel.has(g.dataset.go) ? S.sel.delete(g.dataset.go) : S.sel.add(g.dataset.go);
      render({ keep: true });
    } else if (!S.sel || !g.dataset.card) location.hash = '#/n/' + g.dataset.go;
  }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-go][role=button],[data-gol][role=button]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'lq') { S.listQ = e.target.value; $('#lres').innerHTML = listResults(); $('#ltabs').innerHTML = listTabsHtml(); return; }
  if (e.target.id !== 'q') return;
  S.focusQ = true; location.hash = '#/s/' + encodeURIComponent(e.target.value); // continues on the list page
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'q') e.target.blur(); });

window.addEventListener('hashchange', () => { S.sel = null; if (!S.keepTags && route().name !== S.route?.name) S.stags.clear(); S.keepTags = false; if (route().name !== 'list') S.listQ = ''; if (route().name === 'search' && !S.route?.q && route().q === '') S.focusQ = true; render(); });

/* tag chips shown under the search box while it is focused (or while tags are selected) */
const searchFocused = () => ['q', 'lq'].includes(document.activeElement?.id);
function paintTagBar(show) {
  const host = $('.top'); if (!host) return;
  let bar = $('#tagbar');
  const want = show ?? (S.stags.size > 0 && S.route?.name === 'list');
  const count = new Map();
  S.nodes.forEach(n => (n.tags || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
  const order = [...tagList, ...[...count.keys()].filter(t => !tagList.includes(t))].filter(t => count.has(t));
  if (!want || !order.length) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'tagbar'; bar.className = 'tagbar';
    bar.addEventListener('pointerdown', e => e.preventDefault()); // keep the keyboard open while tapping a tag
    host.append(bar);
  }
  bar.innerHTML = order.map(t => `<button type="button" class="chip ${S.stags.has(t) ? 'on' : ''}" data-act="stag" data-tag="${esc(t)}">${esc(t)} <small>${count.get(t)}</small></button>`).join('');
}
document.addEventListener('focusin', e => { if (['q', 'lq'].includes(e.target.id)) paintTagBar(true); });
document.addEventListener('focusout', () => setTimeout(() => paintTagBar(searchFocused() ? true : undefined), 150));

/* placeholders (letter tiles) made while the picture library was missing: redraw them when the name now matches */
async function upgradePlaceholders() {
  if (!(await ensureArt())) return;
  const C = window.ARTCAT, fix = [], thumbs = [], photos = [];
  for (const n of S.nodes.values()) {
    if (n.art !== 'letter') continue;
    const e = C.match(n.name || '') || (n.type === 'box' && n.kind ? C.match(n.kind) : null);
    if (!e) continue;
    const blob = svgBlob(C.render(e));
    fix.push({ ...n, art: e.id, thumb: blob, updated: n.updated }); thumbs.push([n.id, blob]); photos.push([n.id, blob]);
  }
  if (!fix.length) return;
  await commit({ put: fix, photos, thumbs });
  render({ keep: true });
  toast(`ปรับภาพวาดให้ตรงชื่อแล้ว ${fix.length} รายการ`);
}

/* a thumbnail that fails to decode is rebuilt from the full photo, once per item */
const healed = new Set();
document.addEventListener('error', async e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.src.startsWith('blob:')) return;
  for (const [id, c] of S.urls) {
    if (c.url !== img.src || healed.has(id)) continue;
    healed.add(id);
    try {
      const t = await rebuildThumb(id);
      if (!t) return;
      await DB.write({ thumbs: [[id, t]] });
      S.nodes.get(id).thumb = t;
      URL.revokeObjectURL(c.url); S.urls.delete(id);
      render({ keep: true });
    } catch { /* leave the placeholder */ }
    return;
  }
}, true);

/* ───────────── boot ───────────── */
(async function boot() {
  const nav = document.createElement('nav'); nav.className = 'nav'; nav.id = 'nav'; nav.setAttribute('aria-label', 'เมนูหลัก');
  document.body.append(nav);
  const rb = document.createElement('button');
  rb.className = 'resetbtn'; rb.dataset.act = 'reset'; rb.title = 'รีเฟรชหน้าจอ'; rb.setAttribute('aria-label', 'รีเฟรชหน้าจอ');
  rb.innerHTML = ic('refresh');
  document.body.append(rb);
  try {
    await DB.open();
    const rows = await DB.all(), thumbs = await DB.allThumbs();
    const rebuilt = [];
    for (const n of rows) {
      const legacy = n.thumb; // v1 stored the thumbnail inside the node; those copies may be damaged
      n.thumb = thumbs.get(n.id);
      if (!n.thumb) {
        let t = null;
        try { t = await rebuildThumb(n.id); } catch { /* photo unreadable, fall back below */ }
        if (t) { await DB.write({ thumbs: [[n.id, t]] }); n.thumb = t; rebuilt.push(n); }
        else n.thumb = legacy;
      }
      S.nodes.set(n.id, n);
    }
    if (rebuilt.length) await DB.write({ put: rebuilt }).catch(() => {}); // drop the old embedded copies
    reindex();
    initTags();
  } catch {
    $('#app').innerHTML = `<div class="empty"><div class="big">${ic('alert')}</div><h3>เปิดที่เก็บข้อมูลไม่ได้</h3><p>เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล (อาจเป็นโหมดส่วนตัว) ลองเปิดด้วยเบราว์เซอร์ปกติ</p></div>`;
    return;
  }
  $('meta[name="theme-color"]')?.setAttribute('content', THEMES[curTheme()][1]);
  if (route().name === 'search') S.focusQ = true;
  render();
  upgradePlaceholders().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
