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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ALGO, pixelGray, sampleProfile, movingAverage, detrend, smooth, findPeaks, autoCount };
}
