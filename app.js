'use strict';

const MAX_DIM = 6000;
const HIT_RADIUS = 14;
const LINE_TOLERANCE = 20;
const MIN_LINE_SCREEN = 30;
const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 400;
const MARK_SCREEN_RADIUS = 7;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;
const ZOOM_STEP = 2.5;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const counterEl = document.getElementById('counter');
const hintEl = document.getElementById('hint');
const emptyState = document.getElementById('emptyState');
const toastEl = document.getElementById('toast');
const camInput = document.getElementById('camInput');
const galInput = document.getElementById('galInput');

const state = {
  imgCanvas: null,
  imgData: null,
  line: null,
  marks: [],
  adjust: 0,
  view: { scale: 1, ox: 0, oy: 0 },
  mode: 'empty',
  draft: null,
};

const pointers = new Map();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  if (state.imgCanvas) fitView();
  redraw();
}

function screenToImg(x, y) {
  return { x: (x - state.view.ox) / state.view.scale, y: (y - state.view.oy) / state.view.scale };
}

function imgToScreen(x, y) {
  return { x: x * state.view.scale + state.view.ox, y: y * state.view.scale + state.view.oy };
}

function zoomAt(x, y, factor) {
  const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.view.scale * factor));
  const k = ns / state.view.scale;
  state.view.ox = x - (x - state.view.ox) * k;
  state.view.oy = y - (y - state.view.oy) * k;
  state.view.scale = ns;
  redraw();
}

function fitView() {
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.width / dpr;
  const ch = cv.height / dpr;
  const k = Math.min(cw / state.imgCanvas.width, ch / state.imgCanvas.height) * 0.98;
  state.view.scale = k;
  state.view.ox = (cw - state.imgCanvas.width * k) / 2;
  state.view.oy = (ch - state.imgCanvas.height * k) / 2;
}

function markPoint(t) {
  const L = state.line;
  return { x: L.x1 + (L.x2 - L.x1) * t, y: L.y1 + (L.y2 - L.y1) * t };
}

function totalWires() {
  return state.marks.length + state.adjust;
}

function plural(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'виток';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'витка';
  return 'витков';
}

function updateCounter() {
  counterEl.textContent = state.line ? `${totalWires()} ${plural(totalWires())}` : '—';
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

function setMode(m) {
  state.mode = m;
  document.body.dataset.mode = m;
  emptyState.hidden = m !== 'empty';
  if (m === 'empty') hintEl.textContent = 'Загрузите фото обмотки';
  if (m === 'draw') hintEl.textContent = 'Проведите линию поперёк витков — по чёткому, освещённому участку';
  if (m === 'review') hintEl.textContent = 'Проверьте метки: тап у линии — добавить, тап по метке — удалить';
}

function redraw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, cv.width / dpr, cv.height / dpr);
  if (!state.imgCanvas) return;
  ctx.save();
  ctx.translate(state.view.ox, state.view.oy);
  ctx.scale(state.view.scale, state.view.scale);
  ctx.drawImage(state.imgCanvas, 0, 0);
  const inv = 1 / state.view.scale;
  const isDraft = state.mode === 'draw' && state.draft;
  const line = isDraft ? state.draft : state.line;
  if (line) {
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 2.5 * inv;
    if (isDraft) ctx.setLineDash([10 * inv, 8 * inv]);
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!isDraft) {
      for (const t of state.marks) {
        const p = markPoint(t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, MARK_SCREEN_RADIUS * inv, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b30';
        ctx.fill();
        ctx.lineWidth = 2 * inv;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

async function loadPhoto(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cctx = c.getContext('2d');
    cctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    state.imgCanvas = c;
    state.imgData = cctx.getImageData(0, 0, w, h);
    clearTimeout(tapTimer);
    state.line = null;
    state.marks = [];
    state.adjust = 0;
    state.draft = null;
    setMode('draw');
    fitView();
    updateCounter();
    redraw();
  } catch (err) {
    showToast('Не удалось открыть фото: ' + err.message);
  }
}

function runAutoCount() {
  const L = state.line;
  const res = autoCount(state.imgData.data, state.imgData.width, state.imgData.height, L.x1, L.y1, L.x2, L.y2);
  state.marks = res.marks;
  state.adjust = 0;
  if (!res.marks.length) showToast('Витки не найдены — проведите линию по более чёткому участку');
  setMode('review');
  updateCounter();
  redraw();
}

let lastTap = { t: 0, x: 0, y: 0 };
let tapTimer = null;

function fitScale() {
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.width / dpr;
  const ch = cv.height / dpr;
  return Math.min(cw / state.imgCanvas.width, ch / state.imgCanvas.height) * 0.98;
}

function handleReviewTap(x, y) {
  const now = Date.now();
  if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_DIST) {
    clearTimeout(tapTimer);
    tapTimer = null;
    lastTap = { t: 0, x: 0, y: 0 };
    if (state.view.scale > fitScale()) {
      fitView();
    } else {
      zoomAt(x, y, ZOOM_STEP);
    }
    redraw();
    return;
  }
  lastTap = { t: now, x, y };
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    let best = -1;
    let bestD = HIT_RADIUS;
    for (let i = 0; i < state.marks.length; i++) {
      const p = markPoint(state.marks[i]);
      const s = imgToScreen(p.x, p.y);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      state.marks.splice(best, 1);
      updateCounter();
      redraw();
      return;
    }
    const L = state.line;
    const dx = L.x2 - L.x1;
    const dy = L.y2 - L.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return;
    const pt = screenToImg(x, y);
    let t = ((pt.x - L.x1) * dx + (pt.y - L.y1) * dy) / len2;
    const proj = imgToScreen(L.x1 + dx * t, L.y1 + dy * t);
    if (Math.hypot(proj.x - x, proj.y - y) > LINE_TOLERANCE) return;
    t = Math.max(0, Math.min(1, t));
    if (state.marks.some(m => Math.abs(m - t) < 0.002)) return;
    state.marks.push(t);
    state.marks.sort((a, b) => a - b);
    updateCounter();
    redraw();
  }, DOUBLE_TAP_MS);
}

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, t: Date.now() });
  if (pointers.size === 2) {
    pinchHappened = true;
    const arr = [...pointers.values()];
    pinch = {
      d: Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y),
      scale: state.view.scale,
      ox: state.view.ox,
      oy: state.view.oy,
      cx: (arr[0].x + arr[1].x) / 2,
      cy: (arr[0].y + arr[1].y) / 2,
    };
  }
});

let pinch = null;
let pinchHappened = false;

cv.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const prevX = p.x;
  const prevY = p.y;
  p.x = e.offsetX;
  p.y = e.offsetY;
  if (pointers.size === 2 && pinch) {
    const arr = [...pointers.values()];
    const d = Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y);
    const cx = (arr[0].x + arr[1].x) / 2;
    const cy = (arr[0].y + arr[1].y) / 2;
    const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.scale * (d / pinch.d)));
    state.view.scale = ns;
    state.view.ox = cx - (pinch.cx - pinch.ox) * (ns / pinch.scale);
    state.view.oy = cy - (pinch.cy - pinch.oy) * (ns / pinch.scale);
    redraw();
    return;
  }
  if (pointers.size === 1 && state.mode === 'draw' && !state.line) {
    const a = screenToImg(p.sx, p.sy);
    const b = screenToImg(p.x, p.y);
    state.draft = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    redraw();
  } else if (pointers.size === 1 && state.mode === 'review') {
    state.view.ox += p.x - prevX;
    state.view.oy += p.y - prevY;
    redraw();
  }
});

cv.addEventListener('pointerup', e => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!p) return;
  const moved = Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy);
  if (state.mode === 'draw' && !state.line && state.draft && pointers.size === 0) {
    const L = state.draft;
    const screenLen = Math.hypot(L.x2 - L.x1, L.y2 - L.y1) * state.view.scale;
    state.draft = null;
    if (screenLen > MIN_LINE_SCREEN) {
      state.line = L;
      runAutoCount();
    } else {
      redraw();
    }
    return;
  }
  if (state.mode === 'review' && pointers.size === 0 && !pinchHappened && moved < TAP_MAX_MOVE && Date.now() - p.t < TAP_MAX_MS) {
    handleReviewTap(e.offsetX, e.offsetY);
  }
  if (pointers.size === 0) pinchHappened = false;
});

cv.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  state.draft = null;
  redraw();
});

document.getElementById('btnCamera').addEventListener('click', () => camInput.click());
document.getElementById('btnGallery').addEventListener('click', () => galInput.click());
document.getElementById('btnOther').addEventListener('click', () => {
  clearTimeout(tapTimer);
  state.imgCanvas = null;
  state.imgData = null;
  state.line = null;
  state.marks = [];
  state.adjust = 0;
  state.draft = null;
  setMode('empty');
  updateCounter();
  redraw();
});
document.getElementById('btnRedraw').addEventListener('click', () => {
  clearTimeout(tapTimer);
  state.line = null;
  state.marks = [];
  state.adjust = 0;
  state.draft = null;
  setMode('draw');
  updateCounter();
  redraw();
});
document.getElementById('btnPlus').addEventListener('click', () => {
  state.adjust += 1;
  updateCounter();
});
document.getElementById('btnMinus').addEventListener('click', () => {
  state.adjust -= 1;
  updateCounter();
});
camInput.addEventListener('change', () => {
  if (camInput.files[0]) loadPhoto(camInput.files[0]);
  camInput.value = '';
});
galInput.addEventListener('change', () => {
  if (galInput.files[0]) loadPhoto(galInput.files[0]);
  galInput.value = '';
});

function buildResultBlob() {
  const src = state.imgCanvas;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const r = Math.max(8, Math.round(Math.min(c.width, c.height) / 120));
  const L = state.line;
  g.strokeStyle = '#ffd400';
  g.lineWidth = Math.max(3, Math.round(r / 3));
  g.beginPath();
  g.moveTo(L.x1, L.y1);
  g.lineTo(L.x2, L.y2);
  g.stroke();
  for (const t of state.marks) {
    const p = markPoint(t);
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fillStyle = '#ff3b30';
    g.fill();
    g.lineWidth = Math.max(2, Math.round(r / 4));
    g.strokeStyle = '#ffffff';
    g.stroke();
  }
  const n = totalWires();
  const fs = Math.max(40, Math.round(Math.min(c.width, c.height) / 14));
  const now = new Date();
  const pad = v => String(v).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const label = `${n} ${plural(n)}   ${dateStr}`;
  g.font = `bold ${fs}px sans-serif`;
  const tw = g.measureText(label).width;
  const bh = Math.round(fs * 1.6);
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillRect(0, c.height - bh, tw + fs, bh);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(label, fs / 2, c.height - bh / 2);
  return new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.92));
}

async function saveResult() {
  clearTimeout(tapTimer);
  tapTimer = null;
  try {
    const blob = await buildResultBlob();
    const now = new Date();
    const pad = v => String(v).padStart(2, '0');
    const name = `vitki-${totalWires()}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.jpg`;
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Счёт витков' });
      showToast('Отправьте в галерею через меню «Сохранить» или в мессенджер');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      showToast('Файл сохранён в загрузки');
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') showToast('Не удалось сохранить: ' + err.message);
  }
}

document.getElementById('btnSave').addEventListener('click', () => saveResult());

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setMode('empty');
updateCounter();
