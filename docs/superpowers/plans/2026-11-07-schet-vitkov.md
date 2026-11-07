# «Счёт витков» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Одностраничное веб-приложение для Android: фото обмотки → пользователь проводит линию поперёк витков → автоматическая разметка пересечений → ручная корректировка тапами → сохранение картинки с числом витков.

**Architecture:** Чистый JavaScript без сборки. `algorithm.js` — чистые функции алгоритма (тестируются в Node через `node --test`), `app.js` — интерфейс (Canvas, Pointer Events), `index.html` — разметка и стили. PWA: `sw.js` + `manifest.webmanifest` + иконки. Публикация: GitHub Pages.

**Tech Stack:** Vanilla JS (ES2020), Canvas API, Pointer Events, Web Share API, Service Worker, Node.js 22 (`node:test`) для тестов алгоритма, Python/PIL для генерации иконок, gh CLI для публикации.

**Spec:** `docs/superpowers/specs/2026-11-07-schet-vitkov-design.md` — план реализует Этап 1 спецификации.

## Global Constraints

- Никаких зависимостей и сборки: только чистые файлы, браузерный JS без модулей (`<script src>`), UMD-хвост в `algorithm.js` для Node.
- **Фото не покидают телефон**: ноль сетевых запросов, кроме загрузки самой страницы. Никакой аналитики.
- Алгоритм считает профиль яркости **в исходном разрешении фото** (ограничение рабочей копии: длинная сторона ≤ `MAX_DIM = 6000` px).
- Интерфейс полностью на русском; кнопки `min-height: 52px`; вьюпорт без масштабирования браузером (`user-scalable=no`, жесты обрабатывает приложение).
- Платформа-цель: Chrome на Android; проверка синтаксиса и логики — на десктопе (Node + python http.server), живая проверка — на телефоне пользователя.
- Тесты алгоритма: `node --test test/` из корня репозитория; тесты пишутся ДО реализации (TDD).
- Комментарии в коде не писать; константы с говорящими именами — в объекте `ALGO` (algorithm.js) и вверху `app.js`.
- Каждый таск заканчивается коммитом в репозиторий `/root/Счет_витков` (git уже инициализирован).

---

### Task 1: Каркас репозитория и `sampleProfile` — профиль яркости вдоль линии

**Files:**
- Create: `.gitignore`
- Create: `algorithm.js`
- Test: `test/algorithm.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `pixelGray(data, width, height, x, y) -> number`; `sampleProfile(data, width, height, x1, y1, x2, y2, bandHalfWidth) -> number[]`. `data` — `Uint8ClampedArray` формата RGBA (ImageData.data). Экспорт: в конце файла UMD-хвост `if (typeof module !== 'undefined' && module.exports) module.exports = {...}` — все последующие функции добавляются в этот объект.

- [ ] **Step 1: Создать `.gitignore`** (фото и тяжёлые артефакты не попадают в git)

```
фото обмоток/
фото обмоток_сжатые/
фото обмоток_сжатые HQ/
фото обмоток_кропы/
*.pdf
```

- [ ] **Step 2: Написать падающий тест**

Создать `test/algorithm.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pixelGray, sampleProfile } = require('../algorithm.js');

function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
  }
  return { data, width, height };
}

function drawVerticalStripe(img, x0, stripeWidth, gray) {
  for (let x = x0; x < x0 + stripeWidth; x++) {
    for (let y = 0; y < img.height; y++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = gray; img.data[i + 1] = gray; img.data[i + 2] = gray;
    }
  }
}

test('pixelGray возвращает яркость пикселя', () => {
  const img = makeImage(10, 10, [200, 200, 200]);
  assert.equal(pixelGray(img.data, img.width, img.height, 5, 5), 200);
});

test('pixelGray не выходит за границы изображения', () => {
  const img = makeImage(10, 10, [100, 100, 100]);
  assert.equal(pixelGray(img.data, img.width, img.height, -5, 99), 100);
});

test('sampleProfile на однотонном изображении даёт постоянный профиль', () => {
  const img = makeImage(100, 100, [200, 200, 200]);
  const p = sampleProfile(img.data, img.width, img.height, 10, 25, 90, 25, 3);
  assert.equal(p.length, Math.ceil(80));
  assert.ok(Math.min(...p) > 198, 'минимум профиля ' + Math.min(...p));
});

test('sampleProfile видит тёмные полосы поперёк линии', () => {
  const img = makeImage(200, 50, [200, 200, 200]);
  drawVerticalStripe(img, 40, 4, 50);
  drawVerticalStripe(img, 80, 4, 50);
  drawVerticalStripe(img, 120, 4, 50);
  const p = sampleProfile(img.data, img.width, img.height, 10, 25, 190, 25, 0);
  const dark = p.filter(v => v < 150).length;
  assert.ok(dark >= 9, 'тёмных точек профиля: ' + dark);
});
```

- [ ] **Step 3: Запустить тест, убедиться в падении**

Run: `cd /root/Счет_витков && node --test test/`
Expected: FAIL — `Cannot find module '../algorithm.js'`

- [ ] **Step 4: Реализовать `algorithm.js`**

```js
'use strict';

const ALGO = {
  SMOOTH_SIGMA: 1.5,
  DETREND_DIVISOR: 6,
  MIN_PEAK_DISTANCE: 4,
  PROMINENCE_FRACTION: 0.25,
  PROMINENCE_FLOOR: 2.5,
  BAND_HALF_WIDTH: 6,
};

function pixelGray(data, width, height, x, y) {
  const xi = Math.max(0, Math.min(width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(height - 1, Math.round(y)));
  const i = (yi * width + xi) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

function sampleProfile(data, width, height, x1, y1, x2, y2, bandHalfWidth) {
  const bw = bandHalfWidth === undefined ? ALGO.BAND_HALF_WIDTH : bandHalfWidth;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return [];
  const n = Math.max(2, Math.ceil(len));
  const px = -dy / len;
  const py = dx / len;
  const out = new Array(n);
  for (let s = 0; s < n; s++) {
    const t = s / (n - 1);
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    let sum = 0;
    let cnt = 0;
    for (let b = -bw; b <= bw; b++) {
      sum += pixelGray(data, width, height, cx + px * b, cy + py * b);
      cnt++;
    }
    out[s] = sum / cnt;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ALGO, pixelGray, sampleProfile };
}
```

- [ ] **Step 5: Запустить тесты, убедиться в успехе**

Run: `node --test test/`
Expected: PASS (4 теста)

- [ ] **Step 6: Commit**

```bash
git add .gitignore algorithm.js test/algorithm.test.js
git commit -m "feat: профиль яркости вдоль линии (sampleProfile) + тесты"
```

---

### Task 2: `detrend` и `smooth` — очистка профиля от теней и шума

**Files:**
- Modify: `algorithm.js`
- Test: `test/algorithm.test.js` (добавить тесты)

**Interfaces:**
- Consumes: `sampleProfile` из Task 1.
- Produces: `movingAverage(arr, window) -> number[]`; `detrend(profile) -> number[]` (окно = `max(15, floor(длина/6))`); `smooth(arr, sigma) -> number[]` (гауссово, sigma по умолчанию `ALGO.SMOOTH_SIGMA`). Все добавляются в `module.exports`.

- [ ] **Step 1: Добавить падающие тесты** в `test/algorithm.test.js`

```js
const { detrend, smooth, movingAverage } = require('../algorithm.js');

test('detrend убирает линейный градиент освещения', () => {
  const ramp = Array.from({ length: 300 }, (_, i) => i * 0.5);
  const clean = detrend(ramp);
  const middle = clean.slice(75, 225);
  assert.ok(Math.max(...middle.map(Math.abs)) < 3, 'остаток в середине: ' + Math.max(...middle.map(Math.abs)));
});

test('smooth сохраняет постоянный сигнал', () => {
  const flat = new Array(50).fill(37);
  const out = smooth(flat, 1.5);
  assert.ok(Math.abs(out[0] - 37) < 0.01 && Math.abs(out[25] - 37) < 0.01);
});

test('smooth снижает одиночный выброс', () => {
  const arr = new Array(50).fill(0);
  arr[25] = 100;
  const out = smooth(arr, 1.5);
  assert.ok(out[25] < 100);
  assert.equal(Math.max(...out), out[25]);
});
```

- [ ] **Step 2: Запустить тесты, убедиться в падении**

Run: `node --test test/`
Expected: FAIL — `detrend is not a function` (деструктуризация undefined)

- [ ] **Step 3: Реализовать** — добавить в `algorithm.js` перед UMD-хвостом:

```js
function movingAverage(arr, window) {
  const n = arr.length;
  if (n === 0) return [];
  const half = Math.max(1, Math.floor(window / 2));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      sum += arr[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

function detrend(profile) {
  if (profile.length === 0) return [];
  const window = Math.max(15, Math.floor(profile.length / ALGO.DETREND_DIVISOR));
  const trend = movingAverage(profile, window);
  return profile.map((v, i) => v - trend[i]);
}

function smooth(arr, sigma) {
  const s = sigma === undefined ? ALGO.SMOOTH_SIGMA : sigma;
  const n = arr.length;
  if (n === 0) return [];
  const radius = Math.max(1, Math.ceil(3 * s));
  const kernel = new Array(2 * radius + 1);
  let norm = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * s * s));
    kernel[i + radius] = v;
    norm += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= norm;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.max(0, Math.min(n - 1, i + k));
      acc += arr[j] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}
```

UMD-хвост заменить на:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ALGO, pixelGray, sampleProfile, movingAverage, detrend, smooth };
}
```

- [ ] **Step 4: Запустить тесты, убедиться в успехе**

Run: `node --test test/`
Expected: PASS (7 тестов)

- [ ] **Step 5: Commit**

```bash
git add algorithm.js test/algorithm.test.js
git commit -m "feat: detrend (снятие теней) и гауссово сглаживание профиля"
```

---

### Task 3: `findPeaks` и `autoCount` — поиск витков

**Files:**
- Modify: `algorithm.js`
- Test: `test/algorithm.test.js` (добавить тесты)

**Interfaces:**
- Consumes: `detrend`, `smooth` из Task 2; константы `ALGO.MIN_PEAK_DISTANCE`, `ALGO.PROMINENCE_FRACTION`, `ALGO.PROMINENCE_FLOOR`.
- Produces: `findPeaks(profile, opts) -> {pos: number, prom: number}[]` (opts: `minPeakDistance`, `prominenceFraction`, `prominenceFloor`); `autoCount(data, width, height, x1, y1, x2, y2) -> {marks: number[], raw: number[]}`, где `marks` — **доли 0..1 вдоль линии** (интерфейс для app.js: `markPoint(t)` в Task 4). Добавить оба в `module.exports`.

- [ ] **Step 1: Добавить падающие тесты**

```js
const { findPeaks, autoCount } = require('../algorithm.js');

function bumpProfile(count, spacing, amplitude) {
  const n = count * spacing + 40;
  const p = new Array(n).fill(0);
  for (let k = 0; k < count; k++) {
    const c = 20 + k * spacing + spacing / 2;
    for (let x = -6; x <= 6; x++) {
      p[c + x] += amplitude * Math.exp(-(x * x) / 8);
    }
  }
  return p;
}

test('findPeaks находит все витки на синтетическом профиле', () => {
  const p = bumpProfile(12, 40, 40);
  const peaks = findPeaks(p);
  assert.equal(peaks.length, 12);
  for (let k = 0; k < 12; k++) {
    const expected = 20 + k * 40 + 20;
    const found = peaks.some(pk => Math.abs(pk.pos - expected) <= 3);
    assert.ok(found, 'виток ' + k + ' не найден около ' + expected);
  }
});

test('findPeaks сливает близкие максимумы', () => {
  const p = new Array(100).fill(0);
  for (let x = -8; x <= 8; x++) {
    if (50 + x >= 0 && 50 + x < 100) p[50 + x] = 30 * Math.exp(-(x * x) / 8);
    if (53 + x >= 0 && 53 + x < 100) p[53 + x] += 30 * Math.exp(-(x * x) / 8);
  }
  const peaks = findPeaks(p);
  assert.equal(peaks.length, 1);
});

test('autoCount возвращает доли вдоль линии и считает витки', () => {
  const img = makeImage(400, 60, [200, 200, 200]);
  for (let k = 0; k < 8; k++) drawVerticalStripe(img, 30 + k * 40, 6, 60);
  const res = autoCount(img.data, img.width, img.height, 5, 30, 395, 30);
  assert.equal(res.marks.length, 8);
  for (const m of res.marks) assert.ok(m >= 0 && m <= 1);
});
```

Примечание к тесту `autoCount`: витки здесь — тёмные полосы на светлом фоне, значит в очищенном профиле каждый виток даёт **минимум**, а в тесте из Task 1 — максимум. Поэтому `autoCount` должен определять ориентацию по **детрендированному** профилю: сравнить суммарную амплитуду выше нуля и ниже нуля и при преобладании «тёмного» инвертировать профиль перед поиском максимумов.

- [ ] **Step 2: Запустить тесты, убедиться в падении**

Run: `node --test test/`
Expected: FAIL — `findPeaks is not a function`

- [ ] **Step 3: Реализовать** — добавить в `algorithm.js` перед UMD-хвостом:

```js
function sideBase(profile, i, dir, n) {
  let minSoFar = profile[i];
  let j = i + dir;
  while (j >= 0 && j < n && profile[j] <= profile[i]) {
    if (profile[j] < minSoFar) minSoFar = profile[j];
    j += dir;
  }
  if (j < 0 || j >= n) return -Infinity;
  return minSoFar;
}

function findPeaks(profile, opts) {
  const o = opts || {};
  const minDist = o.minPeakDistance === undefined ? ALGO.MIN_PEAK_DISTANCE : o.minPeakDistance;
  const n = profile.length;
  if (n < 3) return [];
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= n;
  let varSum = 0;
  for (const v of profile) varSum += (v - mean) * (v - mean);
  const std = Math.sqrt(varSum / n);
  let gmin = Infinity;
  for (const v of profile) if (v < gmin) gmin = v;
  const promMin = Math.max(
    o.prominenceFloor === undefined ? ALGO.PROMINENCE_FLOOR : o.prominenceFloor,
    (o.prominenceFraction === undefined ? ALGO.PROMINENCE_FRACTION : o.prominenceFraction) * std
  );
  const candidates = [];
  for (let i = 1; i < n - 1; i++) {
    if (profile[i] >= profile[i - 1] && profile[i] > profile[i + 1]) candidates.push(i);
  }
  const scored = [];
  for (const i of candidates) {
    const l = sideBase(profile, i, -1, n);
    const r = sideBase(profile, i, 1, n);
    let prom;
    if (l === -Infinity && r === -Infinity) prom = profile[i] - gmin;
    else if (l === -Infinity) prom = profile[i] - r;
    else if (r === -Infinity) prom = profile[i] - l;
    else prom = profile[i] - Math.max(l, r);
    if (prom >= promMin) scored.push({ pos: i, prom });
  }
  scored.sort((a, b) => a.pos - b.pos);
  const result = [];
  for (const p of scored) {
    const prev = result[result.length - 1];
    if (prev && p.pos - prev.pos < minDist) {
      if (p.prom > prev.prom) result[result.length - 1] = p;
    } else {
      result.push(p);
    }
  }
  return result;
}

function autoCount(data, width, height, x1, y1, x2, y2) {
  const raw = sampleProfile(data, width, height, x1, y1, x2, y2);
  if (raw.length < 5) return { marks: [], raw };
  const flat = detrend(raw);
  let maxSum = 0;
  let minSum = 0;
  for (const v of flat) {
    if (v > 0) maxSum += v;
    if (v < 0) minSum += -v;
  }
  const oriented = minSum > maxSum ? flat.map(v => -v) : flat;
  const clean = smooth(oriented);
  const peaks = findPeaks(clean);
  const denom = raw.length - 1;
  return { marks: peaks.map(p => p.pos / denom), raw };
}
```

UMD-хвост заменить на:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ALGO, pixelGray, sampleProfile, movingAverage, detrend, smooth, findPeaks, autoCount };
}
```

- [ ] **Step 4: Запустить все тесты**

Run: `node --test test/`
Expected: PASS (10 тестов)

- [ ] **Step 5: Commit**

```bash
git add algorithm.js test/algorithm.test.js
git commit -m "feat: findPeaks с заметностью и слиянием, autoCount с автоориентацией"
```

---

### Task 4: Интерфейс — фото, линия подсчёта, автоподсчёт, корректировка

**Files:**
- Create: `index.html`
- Create: `app.js`

**Interfaces:**
- Consumes: `autoCount(data, width, height, x1, y1, x2, y2) -> {marks: number[] (доли 0..1), raw}` из Task 3 (глобально через `<script src="algorithm.js">`).
- Produces (глобальные функции app.js, используются в Task 5–6): `state` (`{imgCanvas, imgData, line, marks, adjust, view:{scale,ox,oy}, mode, draft}`), `redraw()`, `setMode(m)`, `fitView()`, `screenToImg(x,y)`, `imgToScreen(x,y)`, `markPoint(t)`, `totalWires()`, `updateCounter()`, `showToast(msg)`, `loadPhoto(file)`, `runAutoCount()`, `resizeCanvas()`. Режимы: `'empty' | 'draw' | 'review'`.

- [ ] **Step 1: Создать `index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#1b4d8f">
<title>Счёт витков</title>
<style>
html, body { margin: 0; height: 100%; background: #141414; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; }
#app { display: flex; flex-direction: column; height: 100%; }
header { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #1b4d8f; }
#counter { font-size: 28px; font-weight: 700; min-width: 110px; white-space: nowrap; }
#hint { font-size: 14px; opacity: 0.9; }
main { flex: 1 1 auto; position: relative; }
#cv { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
#emptyState { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
#emptyState button { padding: 18px 26px; font-size: 18px; border-radius: 12px; border: none; background: #1b4d8f; color: #fff; }
footer { flex: 0 0 auto; display: flex; gap: 8px; padding: 10px; background: #202124; overflow-x: auto; }
footer button { flex: 1 0 auto; min-height: 52px; min-width: 90px; font-size: 16px; border-radius: 10px; border: none; background: #3a3a3d; color: #fff; padding: 8px 12px; }
footer button.primary { background: #1b8f4d; font-weight: 700; }
body:not([data-mode="empty"]) .only-empty { display: none; }
body[data-mode="empty"] .not-empty { display: none; }
body:not([data-mode="review"]) .only-review { display: none; }
#toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 15px; max-width: 90vw; }
</style>
</head>
<body data-mode="empty">
<div id="app">
<header><div id="counter">—</div><div id="hint">Загрузите фото обмотки</div></header>
<main>
<canvas id="cv"></canvas>
<div id="emptyState">
<button id="btnCamera">Сделать фото</button>
<button id="btnGallery">Выбрать из галереи</button>
</div>
</main>
<footer id="toolbar">
<button id="btnRedraw" class="only-review">Заново</button>
<button id="btnMinus" class="only-review">−1</button>
<button id="btnPlus" class="only-review">+1</button>
<button id="btnSave" class="only-review primary">Сохранить</button>
<button id="btnOther" class="not-empty">Другое фото</button>
</footer>
</div>
<input type="file" id="camInput" accept="image/*" capture="environment" hidden>
<input type="file" id="galInput" accept="image/*" hidden>
<div id="toast" hidden></div>
<script src="algorithm.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать `app.js`** (версия Task 4: без зума и сохранения — они в Task 5–6)

```js
'use strict';

const MAX_DIM = 6000;
const HIT_RADIUS = 14;
const LINE_TOLERANCE = 20;
const MIN_LINE_SCREEN = 30;
const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 400;
const MARK_SCREEN_RADIUS = 7;

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

function handleReviewTap(x, y) {
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
}

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, t: Date.now() });
});

cv.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const prevX = p.x;
  const prevY = p.y;
  p.x = e.offsetX;
  p.y = e.offsetY;
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
  if (state.mode === 'review' && pointers.size === 0 && moved < TAP_MAX_MOVE && Date.now() - p.t < TAP_MAX_MS) {
    handleReviewTap(e.offsetX, e.offsetY);
  }
});

cv.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  state.draft = null;
  redraw();
});

document.getElementById('btnCamera').addEventListener('click', () => camInput.click());
document.getElementById('btnGallery').addEventListener('click', () => galInput.click());
document.getElementById('btnOther').addEventListener('click', () => {
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

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setMode('empty');
updateCounter();
```

- [ ] **Step 3: Проверить синтаксис**

Run: `node --check app.js && node --check algorithm.js`
Expected: обе команды молча успешны (exit 0)

- [ ] **Step 4: Проверить, что страница отдаётся и все ссылки на файлы валидны**

Run: `cd /root/Счет_витков && (python3 -m http.server 8317 &) && sleep 1 && curl -s -o /dev/null -w "%{http_code} " http://localhost:8317/index.html http://localhost:8317/app.js http://localhost:8317/algorithm.js && kill %1`
Expected: `200 200 200`

- [ ] **Step 5: Commit**

```bash
git add index.html app.js
git commit -m "feat: интерфейс — фото, линия подсчёта, автоподсчёт, корректировка тапами"
```

---

### Task 5: Зум — панорама, щипок, двойной тап

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `state`, `redraw()`, `handleReviewTap()` из Task 4.
- Produces: `zoomAt(x, y, factor)` — глобальная функция (Task 6 не использует, но полезна при отладке); поведение: в режиме `review` перетаскивание = панорама, два пальца = щипок-масштаб, двойной тап = переключение ×1/×2.5 в точке.

- [ ] **Step 1: Добавить константы** — в начало `app.js` после `MARK_SCREEN_RADIUS`:

```js
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;
const ZOOM_STEP = 2.5;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
```

и в объект `state` новые поля не требуются.

- [ ] **Step 2: Заменить обработчик `pointermove` целиком на:**

```js
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
```

- [ ] **Step 3: Заменить обработчик `pointerdown` целиком на:**

```js
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
```

- [ ] **Step 4: Заменить обработчик `pointerup` целиком на:**

```js
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
```

- [ ] **Step 5: Добавить `zoomAt` после функции `imgToScreen`:**

```js
function zoomAt(x, y, factor) {
  const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.view.scale * factor));
  const k = ns / state.view.scale;
  state.view.ox = x - (x - state.view.ox) * k;
  state.view.oy = y - (y - state.view.oy) * k;
  state.view.scale = ns;
  redraw();
}
```

- [ ] **Step 6: Заменить начало `handleReviewTap`** — сразу после строки `function handleReviewTap(x, y) {` добавить блок двойного тапа:

```js
  const now = Date.now();
  if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_DIST) {
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
```

и добавить перед `handleReviewTap` вспомогательные:

```js
let lastTap = { t: 0, x: 0, y: 0 };

function fitScale() {
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.width / dpr;
  const ch = cv.height / dpr;
  return Math.min(cw / state.imgCanvas.width, ch / state.imgCanvas.height) * 0.98;
}
```

(двойной тап: если приближены — вернуть как было; если нет — приблизить ×2.5 в точке тапа).

- [ ] **Step 7: Проверить синтаксис**

Run: `node --check app.js`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat: зум — панорама, щипок, двойной тап"
```

---

### Task 6: Сохранение итоговой картинки (разметка + число + дата)

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `state.imgCanvas`, `state.line`, `state.marks`, `markPoint(t)`, `totalWires()`, `plural(n)`, `showToast(msg)` из Task 4.
- Produces: `buildResultBlob() -> Promise<Blob>` (JPEG в исходном разрешении фото: фото + жёлтая линия + красные метки + плашка «N витков» и дата); `saveResult()` — Web Share API с fallback на скачивание.

- [ ] **Step 1: Добавить в конец `app.js` (до блока инициализации `window.addEventListener('resize', ...)`):**

```js
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
```

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check app.js`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: сохранение итоговой картинки с разметкой, числом и датой"
```

---

### Task 7: PWA — манифест, иконки, офлайн

**Files:**
- Create: `manifest.webmanifest`
- Create: `sw.js`
- Create: `tools/make_icons.py`
- Create: `icons/icon-192.png`, `icons/icon-512.png` (генерируются скриптом)
- Modify: `index.html` (добавить `<link>` в `<head>`)
- Modify: `app.js` (регистрация service worker)

**Interfaces:**
- Consumes: готовые `index.html`, `app.js`.
- Produces: устанавливаемое PWA: иконка на главном экране, работа офлайн. Кэш-стратегия: навигация — network-first (обновления приложения подтягиваются при появлении сети), ресурсы — cache-first.

- [ ] **Step 1: Создать `manifest.webmanifest`**

```json
{
  "name": "Счёт витков",
  "short_name": "Витки",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#141414",
  "theme_color": "#1b4d8f",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Создать `tools/make_icons.py` и сгенерировать иконки**

```python
from PIL import Image, ImageDraw

def make(size, path):
    im = Image.new('RGB', (size, size), (27, 77, 143))
    d = ImageDraw.Draw(im)
    c = size / 2
    for i in range(6):
        r = size * 0.12 + i * size * 0.07
        d.ellipse((c - r, c - r, c + r, c + r), outline=(255, 255, 255), width=max(2, size // 48))
    x0, x1 = size * 0.15, size * 0.85
    y = size * 0.5
    d.line((x0, y - size * 0.28, x1, y + size * 0.28), fill=(255, 212, 0), width=max(3, size // 32))
    im.save(path)

make(192, 'icons/icon-192.png')
make(512, 'icons/icon-512.png')
```

Run: `cd /root/Счет_витков && mkdir -p icons && python3 tools/make_icons.py && ls -la icons/`
Expected: `icon-192.png`, `icon-512.png` существуют, не нулевые.

- [ ] **Step 3: Создать `sw.js`**

```js
const CACHE = 'schet-vitkov-v1';
const ASSETS = ['./', 'index.html', 'algorithm.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(x => x.put('./', copy));
          return r;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
```

- [ ] **Step 4: Правки `index.html`** — в `<head>` после `<meta name="theme-color" ...>` добавить:

```html
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
```

- [ ] **Step 5: Правка `app.js`** — в конец файла добавить:

```js
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}
```

- [ ] **Step 6: Проверки**

Run: `node --check app.js && node --check sw.js && python3 -c "import json; json.load(open('manifest.webmanifest'))"`
Expected: все три — успешно, JSON валиден.

- [ ] **Step 7: Commit**

```bash
git add manifest.webmanifest sw.js tools/make_icons.py icons/ index.html app.js
git commit -m "feat: PWA — манифест, иконки, офлайн-кэш"
```

---

### Task 8: Публикация на GitHub Pages

**Files:**
- Создаётся удалённый репозиторий `Haion66/schet-vitkov` и включается GitHub Pages (main, корень).

**Interfaces:**
- Consumes: все файлы приложения из Task 1–7, `gh` CLI (авторизован как Haion66).
- Produces: URL `https://haion66.github.io/schet-vitkov/` — постоянная ссылка для телефона пользователя.

- [ ] **Step 1: Проверить, что всё закоммичено**

Run: `git status --short`
Expected: пусто (без untracked, кроме игнорируемых папок с фото)

- [ ] **Step 2: Создать репозиторий и запушить**

```bash
cd /root/Счет_витков
gh repo create schet-vitkov --public --source=. --push --description "Подсчёт витков обмотки трансформатора по фото"
```
Expected: репозиторий создан, ветка main запушена. Если имя занято — добавить суффикс `-2` и использовать его во всех последующих шагах и URL.

- [ ] **Step 3: Включить GitHub Pages**

```bash
gh api -X POST repos/Haion66/schet-vitkov/pages -f "source[branch]=main" -f "source[path]=/"
```
Expected: HTTP 201/204 (409 «already exists» — тоже успех, pages уже включён).

- [ ] **Step 4: Дождаться публикации и проверить**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w "%{http_code}" https://haion66.github.io/schet-vitkov/)
  if [ "$code" = "200" ]; then echo "OK"; break; fi
  sleep 30
done
curl -s https://haion66.github.io/schet-vitkov/ | grep -c "Счёт витков"
```
Expected: `OK` и счётчик ≥ 1 (заголовок страницы присутствует). Если после 5 минут 404 — проверить `gh run list --repo Haion66/schet-vitkov` и `gh api repos/Haion66/schet-vitkov/pages`.

- [ ] **Step 5: Commit** (изменений в файлах нет — фиксируем URL в документации)

Создать `docs/instrukciya-ustanovka.md`:

```markdown
# Установка «Счёт витков» на телефон (Android)

1. Откройте в Chrome на телефоне адрес: https://haion66.github.io/schet-vitkov/
2. Меню Chrome (три точки ⋮) → «Добавить на главный экран» → «Установить».
3. На рабочем столе появится иконка «Витки» — дальше открывайте приложение с неё.
4. Первый запуск требует интернета; после него приложение работает офлайн.
5. Фото обрабатываются только на телефоне и никуда не отправляются.

## Как посчитать витки
1. «Сделать фото» или «Выбрать из галереи».
2. Проведите пальцем линию поперёк витков — по чёткому, освещённому участку.
3. Программа поставит красные метки и покажет число.
4. Проверьте с увеличением (двойной тап или щипок): тап по метке — удалить,
   тап рядом с пропущенным витком у линии — добавить. Кнопки +1/−1 — если
   крайний виток не попадает на линию.
5. «Сохранить» → картинка с разметкой и числом уйдёт в галерею/загрузки.
```

```bash
git add docs/instrukciya-ustanovka.md
git commit -m "docs: инструкция установки и использования"
```

---

### Task 9: Контрольный прогон на 28 фото и итоги этапа 1

**Files:**
- Create: `docs/progon-etap1.md`

**Interfaces:**
- Consumes: опубликованное приложение (Task 8), контрольные фото «фото обмоток» (они же на телефоне пользователя).
- Produces: таблица результатов прогона: авто-число vs итоговое число после корректировки; вывод о критерии успеха спецификации (≈80% меток верно, корректировка 10–30 с).

- [ ] **Step 1: Передать пользователю задание прогона** — попросить открыть приложение на телефоне и пройти по фото из папки «фото обмоток» (фото без стрейч-плёнки в первую очередь): загрузить, провести линию, записать «число автомата» и «число после корректировки» и примерное время корректировки. Фото в плёнке — пропустить (снять нечитаемые), отметить в таблице как «нечитаемое».

- [ ] **Step 2: Заполнить `docs/progon-etap1.md`** по ответам пользователя. Шаблон:

```markdown
# Прогон этапа 1 — чек-таблица

Дата: ____ | Телефон: ____

| Фото | Автомат | После корректировки | Время корректировки | Комментарий |
|------|---------|---------------------|---------------------|-------------|
| IMG...150 | | | | |
| ... | | | | |

## Выводы
- Доля фото, где автомат ≥80% меток верно: ____
- Типичные ошибки автомата: ____
- Что вынести в этап 2: ____
```

- [ ] **Step 3: Сравнить с критерием спецификации** (раздел 7: ≈80% меток верно, 10–30 с корректировки). Сформулировать вывод: этап 1 принят / нужны правки констант `ALGO` / переходить к этапу 2.

- [ ] **Step 4: Commit**

```bash
git add docs/progon-etap1.md
git commit -m "docs: результаты контрольного прогона этапа 1"
```
