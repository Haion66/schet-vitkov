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
