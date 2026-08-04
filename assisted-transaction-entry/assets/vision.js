/* ------------------------------------------------------------------
   vision.js — "what am I even looking at?"
   ------------------------------------------------------------------
   The image path has three jobs, in order:

     1. Decide what kind of picture this is (receipt / storefront /
        product / other) from measurable pixel statistics.
     2. Pull out whatever the file will give up: EXIF capture time and
        GPS, OCR text, dominant brand colours.
     3. Hand the caller a bag of evidence — never a finished answer.
        Reconciling evidence into a transaction is infer.js's job.

   Everything here runs client-side. The classifier and the palette
   matcher are honest heuristics over real pixel data — cheap, instant,
   and always available. Turning on the local CLIP model in clip.js
   blends a learned second opinion into step 1 and adds a category read
   straight off the picture; see that file for how the two combine.
------------------------------------------------------------------- */

(function () {
  'use strict';

  /* ---------------- small maths helpers ---------------- */

  /** Ramp from 0 at `lo` to 1 at `hi` (or the reverse if lo > hi). */
  function ramp(x, lo, hi) {
    if (lo === hi) return x >= hi ? 1 : 0;
    return clamp((x - lo) / (hi - lo), 0, 1);
  }

  /** Trapezoid: 0 below a, 1 between b and c, 0 above d. */
  function band(x, a, b, c, d) {
    if (x <= a || x >= d) return 0;
    if (x < b) return (x - a) / (b - a);
    if (x > c) return (d - x) / (d - c);
    return 1;
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function softmax(scores, temperature) {
    const t = temperature || 1;
    const keys = Object.keys(scores);
    const max = Math.max(...keys.map(k => scores[k]));
    const exps = keys.map(k => Math.exp((scores[k] - max) / t));
    const sum = exps.reduce((a, b) => a + b, 0);
    const out = {};
    keys.forEach((k, i) => { out[k] = exps[i] / sum; });
    return out;
  }

  /* ---------------- colour ---------------- */

  function rgbToLab(r, g, b) {
    let [rr, gg, bb] = [r, g, b].map(v => {
      v /= 255;
      return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    });
    const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
    const y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722);
    const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
    const f = v => v > 0.008856 ? Math.cbrt(v) : (7.787 * v) + 16 / 116;
    const [fx, fy, fz] = [f(x), f(y), f(z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function saturationOf(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }

  /* ---------------- image loading ---------------- */

  function drawToCanvas(img, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = url;
    });
  }

  /* ---------------- EXIF ----------------
     A photo of a storefront carries the moment it was taken and often
     where it was taken. That is exactly the two fields the flow would
     otherwise have to guess, so it is worth reading the bytes. */

  const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function readIfd(view, tiffStart, dirStart, little) {
    const entries = {};
    let count;
    try { count = view.getUint16(dirStart, little); } catch (e) { return entries; }
    if (count > 512) return entries;

    for (let i = 0; i < count; i++) {
      const entry = dirStart + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const num = view.getUint32(entry + 4, little);
      const size = (EXIF_TYPE_SIZE[type] || 0) * num;
      if (!size || num > 4096) continue;
      const valueAt = size > 4 ? tiffStart + view.getUint32(entry + 8, little) : entry + 8;
      if (valueAt + size > view.byteLength) continue;
      entries[tag] = readValue(view, valueAt, type, num, little);
    }
    return entries;
  }

  function readValue(view, at, type, num, little) {
    switch (type) {
      case 2: { // ASCII
        let s = '';
        for (let i = 0; i < num; i++) {
          const c = view.getUint8(at + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 3: return num === 1 ? view.getUint16(at, little)
        : Array.from({ length: num }, (_, i) => view.getUint16(at + i * 2, little));
      case 4: return num === 1 ? view.getUint32(at, little)
        : Array.from({ length: num }, (_, i) => view.getUint32(at + i * 4, little));
      case 5: case 10: {
        const one = i => {
          const n = type === 5 ? view.getUint32(at + i * 8, little) : view.getInt32(at + i * 8, little);
          const d = type === 5 ? view.getUint32(at + i * 8 + 4, little) : view.getInt32(at + i * 8 + 4, little);
          return d === 0 ? 0 : n / d;
        };
        return num === 1 ? one(0) : Array.from({ length: num }, (_, i) => one(i));
      }
      default: return null;
    }
  }

  function parseExifDate(str) {
    // EXIF stores "YYYY:MM:DD HH:MM:SS" in the camera's local time.
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d) ? null : d;
  }

  function dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    const dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
    return (ref === 'S' || ref === 'W') ? -dec : dec;
  }

  function readExif(buffer) {
    try {
      const view = new DataView(buffer);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null; // JPEG only
      let offset = 2;
      while (offset < view.byteLength - 3) {
        if (view.getUint8(offset) !== 0xFF) { offset++; continue; }
        const marker = view.getUint8(offset + 1);
        if (marker === 0xDA || marker === 0xD9) break;             // image data starts
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { offset += 2; continue; }
        const size = view.getUint16(offset + 2);
        if (marker === 0xE1 && offset + 10 < view.byteLength) {
          let tag = '';
          for (let i = 0; i < 4; i++) tag += String.fromCharCode(view.getUint8(offset + 4 + i));
          if (tag === 'Exif') return parseTiff(view, offset + 10);
        }
        if (size < 2) break;
        offset += 2 + size;
      }
    } catch (e) { /* malformed EXIF is not worth failing the flow over */ }
    return null;
  }

  function parseTiff(view, tiffStart) {
    const order = view.getUint16(tiffStart);
    if (order !== 0x4949 && order !== 0x4D4D) return null;
    const little = order === 0x4949;
    if (view.getUint16(tiffStart + 2, little) !== 42) return null;

    const ifd0 = readIfd(view, tiffStart, tiffStart + view.getUint32(tiffStart + 4, little), little);
    const out = {
      make: ifd0[0x010F] || null,
      model: ifd0[0x0110] || null,
      orientation: ifd0[0x0112] || null,
      capturedAt: parseExifDate(ifd0[0x0132])
    };

    if (ifd0[0x8769]) {
      const exif = readIfd(view, tiffStart, tiffStart + ifd0[0x8769], little);
      out.capturedAt = parseExifDate(exif[0x9003]) || parseExifDate(exif[0x9004]) || out.capturedAt;
      out.lensModel = exif[0xA434] || null;
    }

    if (ifd0[0x8825]) {
      const gps = readIfd(view, tiffStart, tiffStart + ifd0[0x8825], little);
      const lat = dmsToDecimal(gps[0x0002], gps[0x0001]);
      const lng = dmsToDecimal(gps[0x0004], gps[0x0003]);
      if (lat != null && lng != null && !(lat === 0 && lng === 0)) out.gps = { lat, lng };
    }

    return out;
  }

  /* ---------------- feature extraction ---------------- */

  function otsuThreshold(histogram, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  function percentileFromHistogram(histogram, total, q) {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v];
      if (acc >= total * q) return v;
    }
    return 255;
  }

  function dominantColors(data, w, h, count) {
    // 4 bits per channel. Finer grids look more precise and are worse: film
    // grain and JPEG noise scatter one flat expanse of brand orange across
    // dozens of neighbouring buckets, and the share of every colour collapses.
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = { n: 0, r: 0, g: 0, b: 0 });
      bucket.n++; bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2];
    }
    const total = w * h;
    return [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, count)
      .map(b => {
        const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
        return {
          rgb, hex: rgbToHex(rgb[0], rgb[1], rgb[2]),
          share: b.n / total,
          saturation: saturationOf(rgb[0], rgb[1], rgb[2]),
          lab: rgbToLab(rgb[0], rgb[1], rgb[2])
        };
      });
  }

  function extractFeatures(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, w, h);
    const n = w * h;

    const lum = new Float32Array(n);
    const histogram = new Uint32Array(256);
    let sumLum = 0, sumSat = 0, bright = 0, dark = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[p] = l;
      histogram[Math.min(255, l | 0)]++;
      sumLum += l;
      sumSat += saturationOf(r, g, b);
      if (l > 205) bright++;
      if (l < 70) dark++;
    }

    const meanLum = sumLum / n;
    let varLum = 0;
    for (let p = 0; p < n; p++) varLum += (lum[p] - meanLum) ** 2;

    // --- ink map: what is "text" against the page? ---
    // Otsu alone is not enough here. A photographed receipt has three
    // populations — dark text, the mid-grey table it is lying on, and the
    // bright paper — and Otsu happily splits off the table instead of the
    // text, which then reads as 28% "ink" with no margins. Anchoring to the
    // page level and demanding ink be markedly darker than it fixes that.
    const threshold = otsuThreshold(histogram, n);
    const paperLevel = percentileFromHistogram(histogram, n, 0.8);
    const inkCut = Math.max(10, Math.min(threshold, paperLevel * 0.72));
    const rowInk = new Float32Array(h);
    const colInk = new Float32Array(w);
    let inkTotal = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (lum[y * w + x] < inkCut) { rowInk[y]++; colInk[x]++; inkTotal++; }
      }
      rowInk[y] /= w;
    }
    for (let x = 0; x < w; x++) colInk[x] /= h;

    // --- text lines: bands of ink separated by clean paper ---
    // The cut has to sit well below the peak: one bold header line or a run
    // of dashes has several times the ink of a row of body text, and keying
    // off a fraction of the peak that is too high hides every ordinary line.
    const peakInk = Math.max(...rowInk);
    const lineCut = Math.max(0.01, peakInk * 0.2);
    const bands = [];
    let start = -1;
    for (let y = 0; y < h; y++) {
      const on = rowInk[y] > lineCut;
      if (on && start < 0) start = y;
      if ((!on || y === h - 1) && start >= 0) {
        const end = on ? y : y - 1;
        const thickness = end - start + 1;
        if (thickness >= 1 && thickness < h * 0.14) bands.push((start + end) / 2);
        start = -1;
      }
    }
    // Median and MAD rather than mean and standard deviation. A receipt has
    // regular line spacing interrupted by a few big blank gaps between
    // sections, and a couple of those outliers is enough to push the
    // standard deviation past the mean and report perfect text as chaos.
    let lineRegularity = 0;
    if (bands.length >= 3) {
      const gaps = bands.slice(1).map((c, i) => c - bands[i]);
      const median = arr => {
        const s = arr.slice().sort((a, b) => a - b);
        return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      };
      const medianGap = median(gaps);
      const mad = median(gaps.map(g => Math.abs(g - medianGap)));
      lineRegularity = medianGap > 0 ? clamp(1 - (mad / medianGap), 0, 1) : 0;
    }

    // --- quiet vertical margins, the giveaway of a printed slip ---
    const edgeCols = Math.max(1, Math.round(w * 0.08));
    let quietEdge = 0;
    for (let x = 0; x < edgeCols; x++) {
      // Loose enough to survive vignetting and sensor noise in the corners.
      if (colInk[x] < 0.04) quietEdge++;
      if (colInk[w - 1 - x] < 0.04) quietEdge++;
    }
    const marginRatio = quietEdge / (edgeCols * 2);

    // --- Sobel edge density ---
    let edges = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1]
                 + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
        const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1]
                 + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
        if (Math.hypot(gx, gy) > 120) edges++;
      }
    }

    // --- sky: bright, blue-dominant pixels along the top edge ---
    let skyPixels = 0;
    const skyRows = Math.max(1, Math.round(h * 0.25));
    for (let y = 0; y < skyRows; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 2] > data[i] + 12 && lum[y * w + x] > 120) skyPixels++;
      }
    }

    // --- centre subject vs. background: a product shot on a surface ---
    const cx0 = Math.round(w * 0.3), cx1 = Math.round(w * 0.7);
    const cy0 = Math.round(h * 0.3), cy1 = Math.round(h * 0.7);
    let centreSat = 0, centreN = 0, borderSat = 0, borderN = 0;
    let borderLumSum = 0, borderLumSq = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, i = p * 4;
        const s = saturationOf(data[i], data[i + 1], data[i + 2]);
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) { centreSat += s; centreN++; }
        else {
          borderSat += s; borderN++;
          borderLumSum += lum[p]; borderLumSq += lum[p] * lum[p];
        }
      }
    }
    const borderMean = borderLumSum / Math.max(1, borderN);
    const borderSd = Math.sqrt(Math.max(0, borderLumSq / Math.max(1, borderN) - borderMean ** 2));

    return {
      width: w, height: h,
      aspect: h / w,
      meanLum, stdLum: Math.sqrt(varLum / n),
      brightRatio: bright / n,
      darkRatio: dark / n,
      meanSat: sumSat / n,
      inkRatio: inkTotal / n,
      textLineCount: bands.length,
      lineRegularity,
      marginRatio,
      edgeDensity: edges / n,
      skyScore: skyPixels / (skyRows * w),
      centreSaturation: centreSat / Math.max(1, centreN),
      borderSaturation: borderSat / Math.max(1, borderN),
      // Scaled generously: an ordinary tabletop shot carries a gradient, a
      // drop shadow and lens vignetting, and none of that makes it "busy".
      backgroundUniformity: clamp(1 - borderSd / 110, 0, 1),
      dominant: dominantColors(data, w, h, 6)
    };
  }

  /* ---------------- classification ---------------- */

  const KINDS = {
    receipt:    'a receipt or printed slip',
    storefront: 'a storefront, sign or logo',
    product:    'the thing that was bought',
    other:      'something else'
  };

  function classifyImage(f) {
    const signals = {};

    signals.receipt = [
      ['tall, narrow crop',            ramp(f.aspect, 1.0, 1.5),            1.1],
      ['almost no colour',             ramp(f.meanSat, 0.24, 0.06),         1.3],
      ['bright paper background',      ramp(f.brightRatio, 0.18, 0.5),      1.2],
      ['many horizontal text lines',   ramp(f.textLineCount, 5, 20),        1.8],
      ['evenly spaced lines',          ramp(f.lineRegularity, 0.15, 0.6),   1.0],
      ['clean left/right margins',     ramp(f.marginRatio, 0.2, 0.85),      0.9],
      ['light ink coverage',           band(f.inkRatio, 0.005, 0.02, 0.16, 0.4), 0.8],
      ['no sky',                       ramp(f.skyScore, 0.2, 0.02),         0.5]
    ];

    signals.storefront = [
      ['sky along the top',            ramp(f.skyScore, 0.03, 0.35),        1.9],
      ['landscape or square framing',  ramp(f.aspect, 1.25, 0.7),           0.9],
      ['architectural edge detail',    band(f.edgeDensity, 0.005, 0.03, 0.14, 0.3), 1.0],
      ['saturated signage colour',     ramp(f.meanSat, 0.08, 0.4),          1.1],
      ['little body text',             ramp(f.textLineCount, 16, 3),        0.9],
      ['busy background',              ramp(f.backgroundUniformity, 0.8, 0.25), 0.8]
    ];

    signals.product = [
      ['subject stands out from background', ramp(f.centreSaturation - f.borderSaturation, 0.0, 0.22), 1.5],
      ['clean, even background',       ramp(f.backgroundUniformity, 0.3, 0.85), 1.3],
      ['square-ish framing',           band(f.aspect, 0.55, 0.8, 1.35, 1.8), 0.8],
      ['colourful',                    ramp(f.meanSat, 0.1, 0.45),          1.1],
      ['not a wall of text',           ramp(f.textLineCount, 14, 2),        1.0],
      ['no sky',                       ramp(f.skyScore, 0.18, 0.01),        0.6]
    ];

    signals.other = [
      ['nothing distinctive',          0.42,                                 1.0]
    ];

    const scores = {}, evidence = {};
    Object.keys(signals).forEach(kind => {
      let weighted = 0, weight = 0;
      evidence[kind] = [];
      signals[kind].forEach(([label, value, w]) => {
        weighted += value * w;
        weight += w;
        if (value > 0.55) evidence[kind].push({ label, value });
      });
      scores[kind] = weighted / weight;
    });

    // Sky is closer to a necessary condition than to one signal among many:
    // you cannot photograph a building's frontage from the street without
    // catching some. As a weighted term its absence merely got averaged away,
    // and a bag of dog food on a worktop — busy, colourful, textless — came
    // out "storefront". A multiplicative gate says what is actually meant.
    scores.storefront *= 0.35 + 0.65 * ramp(f.skyScore, 0.01, 0.12);

    const probs = softmax(scores, 0.11);
    const ranked = Object.keys(probs).sort((a, b) => probs[b] - probs[a]);
    const kind = ranked[0];

    return {
      kind,
      label: KINDS[kind],
      confidence: probs[kind],
      probabilities: probs,
      rawScores: scores,
      evidence: evidence[kind].sort((a, b) => b.value - a.value).slice(0, 4),
      runnerUp: ranked[1]
    };
  }

  /* ---------------- brand palette matching ----------------
     Standing in for logo recognition. A photo of a storefront that is
     38% Home Depot orange is decent evidence; a photo that is 38% red
     is evidence for Target *and* CVS *and* Trader Joe's, and the flow
     should say so rather than pick one and look confident. */

  /* A brand's black and its white are not evidence. Every photograph
     contains shadow and highlight, so matching against Uber's black or
     Target's white makes every picture look like every brand — which is
     exactly how a photo of an orange shopfront came out as Uber. Only the
     distinctive, saturated colour in a palette carries any signal. */
  function brandColourIsUsable(rgb) {
    const sat = saturationOf(rgb[0], rgb[1], rgb[2]);
    const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return sat >= 0.3 && lum > 28 && lum < 232;
  }

  const BRAND_LABS = window.BudgetData.MERCHANTS.map(m => ({
    merchant: m,
    labs: (m.brand || [])
      .map(hex => ({ hex, rgb: hexToRgb(hex) }))
      .filter(b => brandColourIsUsable(b.rgb))
      .map(b => ({ hex: b.hex, lab: rgbToLab(...b.rgb), sat: saturationOf(...b.rgb) }))
  })).filter(b => b.labs.length);

  function matchBrandPalette(dominant) {
    const results = [];
    BRAND_LABS.forEach(({ merchant, labs }) => {
      let best = 0, bestPair = null;
      dominant.forEach(colour => {
        // Likewise on the image side: paper, pavement and overcast sky are
        // not brand colours no matter how much of the frame they fill.
        if (colour.saturation < 0.18) return;
        labs.forEach(brand => {
          const vividness = Math.min(1, (colour.saturation + brand.sat) / 1.2);
          const closeness = clamp(1 - deltaE(colour.lab, brand.lab) / 42, 0, 1);
          const score = closeness * vividness * Math.min(1, colour.share / 0.06);
          if (score > best) { best = score; bestPair = { colour, brand }; }
        });
      });
      if (best > 0.12) results.push({ merchant, score: best, match: bestPair });
    });
    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /* ---------------- OCR ----------------
     tesseract.js is loaded lazily and only when the picture actually
     looks like it contains text. If the CDN is unreachable the flow
     degrades to the non-text evidence instead of dead-ending. */

  const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractPromise = null;

  function ensureTesseract(timeoutMs) {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;

    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('OCR engine timed out')), timeoutMs || 20000);
      script.src = TESSERACT_CDN;
      script.onload = () => { clearTimeout(timer); window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine unavailable')); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('OCR engine could not be fetched')); };
      document.head.appendChild(script);
    }).catch(err => { tesseractPromise = null; throw err; });

    return tesseractPromise;
  }

  /** Grayscale + local contrast stretch. Tesseract is markedly better on
      a binarised receipt than on a phone photo of one. */
  function preprocessForOcr(img, targetWidth) {
    const scale = clamp((targetWidth || 1100) / img.width, 0.4, 3);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';

    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[d[i]]++;

    // Stretch the 2nd–98th percentile to full range before thresholding.
    const total = w * h;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);

    for (let i = 0; i < d.length; i += 4) {
      const v = clamp(((d[i] - lo) / span) * 255, 0, 255);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  async function runOcr(img, onProgress) {
    const Tesseract = await ensureTesseract(20000);
    const canvas = preprocessForOcr(img, 1100);
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      }
    });
    try {
      const { data } = await worker.recognize(canvas);
      return { text: data.text || '', confidence: data.confidence || 0 };
    } finally {
      worker.terminate();
    }
  }

  /* ---------------- receipt parsing ---------------- */

  const MONEY = /(?:\$|usd\s*)?(\d{1,4}(?:,\d{3})*\.\d{2})\b/gi;
  const TOTAL_WORDS = /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total\s*sale|total)\b/i;
  const NOT_TOTAL = /\b(sub\s*-?\s*total|subtotal|tax|tip|gratuity|change|cash|tender|savings|discount|points|balance\s*remaining)\b/i;

  function moneyIn(line) {
    MONEY.lastIndex = 0;
    const out = [];
    let m;
    while ((m = MONEY.exec(line))) out.push(parseFloat(m[1].replace(/,/g, '')));
    return out;
  }

  function parseDateTime(text) {
    const patterns = [
      /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/,                      // 03/14/2026
      /\b(\d{4})-(\d{2})-(\d{2})\b/,                                        // 2026-03-14
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})?/i
    ];
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let date = null, raw = null;

    for (let i = 0; i < patterns.length && !date; i++) {
      const m = patterns[i].exec(text);
      if (!m) continue;
      raw = m[0];
      if (i === 0) {
        let year = +m[3];
        if (year < 100) year += 2000;
        date = new Date(year, +m[1] - 1, +m[2]);
      } else if (i === 1) {
        date = new Date(+m[1], +m[2] - 1, +m[3]);
      } else {
        const month = months.indexOf(m[1].slice(0, 3).toLowerCase());
        date = new Date(m[3] ? +m[3] : new Date().getFullYear(), month, +m[2]);
      }
      if (isNaN(date) || date.getFullYear() < 2000 || date.getFullYear() > 2100) { date = null; raw = null; }
    }

    const t = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(text);
    let time = null;
    if (t) {
      let hour = +t[1];
      const meridiem = (t[4] || '').toLowerCase().replace(/\./g, '');
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (hour < 24 && +t[2] < 60) time = { hour, minute: +t[2], raw: t[0].trim() };
    }

    if (date && time) {
      date.setHours(time.hour, time.minute, 0, 0);
      raw = raw + ' ' + time.raw;
    }
    return { date, time, raw };
  }

  function parseReceiptText(text) {
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = { lines, items: [], total: null, subtotal: null, tax: null, tip: null, payment: null };

    lines.forEach((line, i) => {
      const amounts = moneyIn(line);
      const last = amounts.length ? amounts[amounts.length - 1] : null;

      if (/\bsub\s*-?\s*total\b|\bsubtotal\b/i.test(line) && last != null) out.subtotal = last;
      else if (/\btax\b/i.test(line) && last != null && out.tax == null) out.tax = last;
      else if (/\b(tip|gratuity)\b/i.test(line) && last != null) out.tip = last;
      else if (TOTAL_WORDS.test(line) && !NOT_TOTAL.test(line)) {
        // "TOTAL" sometimes sits alone with the figure on the next line.
        const value = last != null ? last : moneyIn(lines[i + 1] || '').pop();
        if (value != null) out.total = value;
      }

      const card = /\b(visa|mastercard|master card|amex|american express|discover|debit|credit|cash|apple pay|google pay)\b/i.exec(line);
      if (card && !out.payment) {
        const last4 = /(?:[*x#•]{2,}\s*|ending\s+(?:in\s+)?)(\d{4})\b/i.exec(line);
        // Receipts shout; the UI should not. "VISA" → "Visa", "MASTER CARD" → "Master Card".
        out.payment = card[1].toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) +
          (last4 ? ' ••••' + last4[1] : '');
      }
    });

    // Line items: a description followed by a price, excluding the summary rows.
    lines.forEach(line => {
      const m = /^(.{2,34}?)\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2})$/.exec(line);
      if (!m) return;
      const label = m[1].replace(/[.\s]+$/, '').trim();
      const price = parseFloat(m[2].replace(/,/g, ''));
      if (TOTAL_WORDS.test(label) || NOT_TOTAL.test(label)) return;
      if (!/[a-z]{2}/i.test(label)) return;
      if (out.total != null && price > out.total + 0.005) return;
      out.items.push({ label, price });
    });

    if (out.total == null) {
      // Last resort: the biggest figure on the slip is usually the total.
      const all = lines.flatMap(moneyIn).filter(v => v < 100000);
      if (all.length) out.total = Math.max(...all);
    }

    const when = parseDateTime(text);
    out.date = when.date;
    out.dateRaw = when.raw;
    out.headerLines = lines.slice(0, 6);
    return out;
  }

  /* ---------------- merchant matching from text ---------------- */

  function normalise(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    return max === 0 ? 0 : 1 - levenshtein(a, b) / max;
  }

  /** Look for any known merchant's name in OCR text — allowing for the
      character errors OCR reliably makes on thermal paper. */
  function matchMerchantInText(text, weightHeader) {
    const flat = normalise(text);
    const lines = text.split(/\r?\n/).map(normalise).filter(l => l.length > 2);
    const results = [];

    window.BudgetData.MERCHANTS.forEach(merchant => {
      let best = 0, how = null;
      merchant.aliases.forEach(alias => {
        const a = normalise(alias);
        if (a.length < 3) return;

        if (flat.includes(a)) {
          best = Math.max(best, 1);
          how = how || 'exact name on the receipt';
        }
        lines.forEach((line, idx) => {
          const sim = similarity(a, line);
          if (sim > 0.72) {
            const positional = weightHeader && idx < 4 ? 0.06 : 0;
            if (sim + positional > best) {
              best = Math.min(0.98, sim + positional);
              how = 'fuzzy match on "' + line.slice(0, 28) + '"';
            }
          }
          // A short brand name inside a longer header line ("WAWA #8021").
          if (a.length >= 4 && line.includes(a)) {
            const score = 0.9 + (weightHeader && idx < 4 ? 0.05 : 0);
            if (score > best) { best = score; how = 'name found in "' + line.slice(0, 28) + '"'; }
          }
        });
      });
      if (best > 0.7) results.push({ merchant, score: best, how });
    });

    return results.sort((a, b) => b.score - a.score);
  }

  /* ---------------- orchestration ---------------- */

  /**
   * Full image pass. Returns evidence only — no transaction is built here.
   * @param {HTMLImageElement} img decoded image
   * @param {ArrayBuffer|null} buffer original bytes, for EXIF
   * @param {(stage:string, detail?:string)=>void} report progress callback
   * @param {{useModel?:boolean}} options opt-in to the local vision model
   */
  async function analyseImage(img, buffer, report, options) {
    const say = report || function () {};
    options = options || {};

    say('measuring', 'Reading pixels');
    const canvas = drawToCanvas(img, 640);
    const features = extractFeatures(canvas);

    say('classifying', 'Working out what this is');
    const classification = classifyImage(features);

    // Optional second opinion from CLIP. The heuristic verdict above is
    // never discarded — the two are blended, and both are reported, so the
    // inspector can show where they disagreed.
    let model = null, modelError = null;
    if (options.useModel && window.ClipVision) {
      say('model', 'Asking the vision model');
      try {
        model = await window.ClipVision.classify(canvas, (loaded, backend) => {
          say('model', 'Downloading the model — ' + Math.round(loaded * 100) + '% (' + backend + ')');
        });
        classification.heuristicProbabilities = Object.assign({}, classification.probabilities);
        classification.modelProbabilities = model.kinds;
        classification.probabilities = window.ClipVision.blend(classification.probabilities, model.kinds);
        const ranked = Object.keys(classification.probabilities)
          .sort((a, b) => classification.probabilities[b] - classification.probabilities[a]);
        classification.kind = ranked[0];
        classification.runnerUp = ranked[1];
        classification.label = KINDS[classification.kind];
        classification.confidence = classification.probabilities[classification.kind];
        classification.source = 'heuristics + CLIP';
      } catch (err) {
        modelError = err.message || String(err);
      }
    }

    const exif = buffer ? readExif(buffer) : null;
    if (exif && (exif.capturedAt || exif.gps)) say('exif', 'Found camera metadata');

    const palette = matchBrandPalette(features.dominant);

    // Text is worth chasing on anything that could name a merchant. The
    // line-band detector only sees dark ink on a light page, so it scores
    // zero on white lettering across an orange shop sign — precisely the
    // case where the text is the single most valuable thing in the frame.
    // Gating OCR on that count would throw the sign away, so kind decides.
    const worthOcr = classification.kind !== 'other' || features.textLineCount >= 3;
    let ocr = null, receipt = null, ocrError = null;

    if (worthOcr) {
      say('ocr', 'Reading text');
      try {
        ocr = await runOcr(img, p => say('ocr', 'Reading text — ' + Math.round(p * 100) + '%'));
        if (ocr && ocr.text.trim()) receipt = parseReceiptText(ocr.text);
      } catch (err) {
        ocrError = err.message || String(err);
      }
    }

    const textMerchants = ocr && ocr.text ? matchMerchantInText(ocr.text, classification.kind === 'receipt') : [];

    return {
      features, classification, exif, palette, ocr, ocrError, receipt, textMerchants,
      model, modelError,
      previewUrl: canvas.toDataURL('image/jpeg', 0.8)
    };
  }

  window.Vision = {
    analyseImage, extractFeatures, classifyImage, matchBrandPalette, matchMerchantInText,
    parseReceiptText, parseDateTime, readExif, loadImageFromUrl, drawToCanvas,
    similarity, normalise, KINDS
  };
})();
