const test = require('node:test');
const assert = require('node:assert/strict');
const { pixelGray, sampleProfile } = require('../algorithm.js');
const { detrend, smooth, movingAverage } = require('../algorithm.js');

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
