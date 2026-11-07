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
