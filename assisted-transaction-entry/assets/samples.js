/* ------------------------------------------------------------------
   samples.js — built-in pictures to try the flow with
   ------------------------------------------------------------------
   These are drawn to a canvas at runtime rather than shipped as image
   files, for one reason that matters: the analysis pipeline then runs
   over genuine pixel data and genuine JPEG bytes, exactly as it would
   for a photo out of the camera roll. Nothing is stubbed — the sample
   receipt really is OCR'd, and the sample storefront really does carry
   an EXIF timestamp and GPS tag that the parser has to find.
------------------------------------------------------------------- */

(function () {
  'use strict';

  /* ---------------- EXIF writer ----------------
     Small enough to be worth having so the photo-metadata path can be
     demonstrated end to end rather than described. */

  function ascii(str) {
    const bytes = new Uint8Array(str.length + 1);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  function rationalTriple(value) {
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60 * 1000);
    return [[deg, 1], [min, 1], [sec, 1000]];
  }

  function exifDateString(date) {
    const p = n => String(n).padStart(2, '0');
    return date.getFullYear() + ':' + p(date.getMonth() + 1) + ':' + p(date.getDate()) + ' ' +
           p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds());
  }

  /** Builds an APP1/Exif segment with Make, Model, DateTimeOriginal and GPS. */
  function buildExifSegment(opts) {
    const make = ascii(opts.make || 'Apple');
    const model = ascii(opts.model || 'iPhone 15 Pro');
    const dateStr = ascii(exifDateString(opts.capturedAt || new Date()));

    const hasGps = opts.gps != null;
    const ifd0Count = hasGps ? 4 : 3;
    const gpsCount = 4;

    const ifd0Size = 2 + 12 * ifd0Count + 4;
    const exifSize = 2 + 12 * 1 + 4;
    const gpsSize = hasGps ? 2 + 12 * gpsCount + 4 : 0;

    const ifd0At = 8;
    const exifAt = ifd0At + ifd0Size;
    const gpsAt = exifAt + exifSize;
    let dataAt = gpsAt + gpsSize;

    // Lay out the values that are too big to sit inside an entry.
    const blocks = [];
    const place = bytes => {
      const at = dataAt;
      blocks.push({ at, bytes });
      dataAt += bytes.length + (bytes.length % 2); // keep things word-aligned
      return at;
    };

    const makeAt = place(make);
    const modelAt = place(model);
    const dateAt = place(dateStr);

    let latAt = 0, lngAt = 0;
    if (hasGps) {
      const toBytes = triple => {
        const b = new Uint8Array(24);
        const v = new DataView(b.buffer);
        triple.forEach((pair, i) => {
          v.setUint32(i * 8, pair[0], true);
          v.setUint32(i * 8 + 4, pair[1], true);
        });
        return b;
      };
      latAt = place(toBytes(rationalTriple(opts.gps.lat)));
      lngAt = place(toBytes(rationalTriple(opts.gps.lng)));
    }

    const tiff = new Uint8Array(dataAt);
    const view = new DataView(tiff.buffer);

    // TIFF header: little-endian, magic 42, IFD0 at byte 8.
    tiff[0] = 0x49; tiff[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd0At, true);

    function writeIfd(at, entries, nextIfd) {
      view.setUint16(at, entries.length, true);
      entries.forEach((e, i) => {
        const p = at + 2 + i * 12;
        view.setUint16(p, e.tag, true);
        view.setUint16(p + 2, e.type, true);
        view.setUint32(p + 4, e.count, true);
        if (e.inline) tiff.set(e.inline, p + 8);
        else view.setUint32(p + 8, e.value, true);
      });
      view.setUint32(at + 2 + entries.length * 12, nextIfd || 0, true);
    }

    const ifd0Entries = [
      { tag: 0x010F, type: 2, count: make.length, value: makeAt },
      { tag: 0x0110, type: 2, count: model.length, value: modelAt },
      { tag: 0x8769, type: 4, count: 1, value: exifAt }
    ];
    if (hasGps) ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, value: gpsAt });
    writeIfd(ifd0At, ifd0Entries, 0);

    writeIfd(exifAt, [{ tag: 0x9003, type: 2, count: dateStr.length, value: dateAt }], 0);

    if (hasGps) {
      const ref = s => { const b = new Uint8Array(4); b[0] = s.charCodeAt(0); return b; };
      writeIfd(gpsAt, [
        { tag: 0x0001, type: 2, count: 2, inline: ref(opts.gps.lat >= 0 ? 'N' : 'S') },
        { tag: 0x0002, type: 5, count: 3, value: latAt },
        { tag: 0x0003, type: 2, count: 2, inline: ref(opts.gps.lng >= 0 ? 'E' : 'W') },
        { tag: 0x0004, type: 5, count: 3, value: lngAt }
      ], 0);
    }

    blocks.forEach(b => tiff.set(b.bytes, b.at));

    const header = ascii('Exif');            // "Exif\0" — one more NUL follows
    const segmentLength = 2 + 6 + tiff.length;
    const segment = new Uint8Array(2 + segmentLength);
    segment[0] = 0xFF; segment[1] = 0xE1;
    segment[2] = (segmentLength >> 8) & 0xff;
    segment[3] = segmentLength & 0xff;
    segment.set(header.subarray(0, 5), 4);   // E x i f \0
    segment[9] = 0x00;
    segment.set(tiff, 10);
    return segment;
  }

  /** Splices an Exif APP1 segment in immediately after the JPEG SOI marker. */
  function injectExif(jpegBuffer, exifOpts) {
    const jpeg = new Uint8Array(jpegBuffer);
    if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return jpeg.buffer;
    const segment = buildExifSegment(exifOpts);
    const out = new Uint8Array(jpeg.length + segment.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(segment, 2);
    out.set(jpeg.subarray(2), 2 + segment.length);
    return out.buffer;
  }

  /* ---------------- drawing helpers ---------------- */

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function noise(ctx, w, h, strength) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * strength;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
  }

  function vignette(ctx, w, h, strength) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + strength + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- sample 1: a printed receipt ---------------- */

  function drawReceipt(when) {
    const w = 640, h = 1180;
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#c9c4bb';           // the surface it is lying on
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.011);                   // handheld, not scanned
    ctx.translate(-w / 2, -h / 2);

    const px = 62, pw = w - 124;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#f8f6f1';
    ctx.fillRect(px, 26, pw, h - 90);
    ctx.shadowColor = 'transparent';

    const money = n => n.toFixed(2);
    const line = (left, right, y, opts) => {
      const o = opts || {};
      ctx.fillStyle = o.colour || '#25211c';
      ctx.font = (o.bold ? 'bold ' : '') + (o.size || 21) + 'px "Courier New", Courier, monospace';
      ctx.textAlign = 'left';
      if (o.centre) {
        ctx.textAlign = 'center';
        ctx.fillText(left, w / 2, y);
      } else {
        ctx.fillText(left, px + 34, y);
        if (right != null) {
          ctx.textAlign = 'right';
          ctx.fillText(right, px + pw - 34, y);
        }
      }
    };

    const rule = y => {
      ctx.strokeStyle = '#8d867c';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 34, y); ctx.lineTo(px + pw - 34, y); ctx.stroke();
      ctx.setLineDash([]);
    };

    let y = 108;
    line('sweetgreen', null, y, { centre: true, size: 40, bold: true }); y += 44;
    line('1601 CHESTNUT ST', null, y, { centre: true, size: 19 }); y += 27;
    line('PHILADELPHIA, PA 19103', null, y, { centre: true, size: 19 }); y += 27;
    line('(215) 555-0184', null, y, { centre: true, size: 19 }); y += 46;

    const p = n => String(n).padStart(2, '0');
    const hours = when.getHours() % 12 || 12;
    const stamp = p(when.getMonth() + 1) + '/' + p(when.getDate()) + '/' + when.getFullYear() +
                  '  ' + hours + ':' + p(when.getMinutes()) + ' ' + (when.getHours() < 12 ? 'AM' : 'PM');
    line(stamp, null, y, { centre: true, size: 19 }); y += 34;
    line('ORDER #4417', 'DINE IN', y, { size: 19 }); y += 30;

    rule(y); y += 34;
    const items = [
      ['1 HARVEST BOWL', 12.95],
      ['1 EXTRA AVOCADO', 1.95],
      ['1 SPARKLING WATER', 2.75]
    ];
    items.forEach(([label, price]) => { line(label, money(price), y); y += 32; });

    y += 6; rule(y); y += 34;
    line('SUBTOTAL', money(17.65), y); y += 32;
    line('TAX 8.0%', money(1.41), y); y += 32;
    line('TIP', money(3.00), y); y += 38;
    line('TOTAL', money(22.06), y, { bold: true, size: 26 }); y += 46;

    rule(y); y += 36;
    line('VISA ************4021', null, y, { size: 19 }); y += 30;
    line('APPROVED  AUTH 004182', null, y, { size: 19 }); y += 48;
    line('THANK YOU', null, y, { centre: true, size: 21 }); y += 30;
    line('sweetgreen.com', null, y, { centre: true, size: 18 });

    // Torn bottom edge.
    ctx.fillStyle = '#c9c4bb';
    ctx.beginPath();
    ctx.moveTo(px, h - 64);
    for (let x = px; x <= px + pw; x += 16) {
      ctx.lineTo(x, h - 64 + (Math.random() * 14 - 4));
    }
    ctx.lineTo(px + pw, h); ctx.lineTo(px, h);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    noise(ctx, w, h, 14);
    vignette(ctx, w, h, 0.16);
    return c;
  }

  /* ---------------- sample 2: a storefront ---------------- */

  function drawStorefront() {
    const w = 1180, h = 800;
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');

    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.46);
    sky.addColorStop(0, '#5b9fd4');
    sky.addColorStop(1, '#b9d6ea');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.46);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    [[220, 90, 120], [340, 70, 90], [880, 110, 140]].forEach(([x, yy, r]) => {
      ctx.beginPath(); ctx.ellipse(x, yy, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    });

    // Building mass
    ctx.fillStyle = '#cdc4b6';
    ctx.fillRect(80, h * 0.24, w - 160, h * 0.44);
    ctx.fillStyle = '#bdb3a4';
    ctx.fillRect(80, h * 0.24, w - 160, 26);

    // Orange sign band
    ctx.fillStyle = '#f96302';
    ctx.fillRect(150, h * 0.30, w - 300, 118);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 74px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('THE HOME DEPOT', w / 2, h * 0.30 + 62);
    ctx.textBaseline = 'alphabetic';

    // Entrance, windows, bollards
    ctx.fillStyle = '#3f4b55';
    ctx.fillRect(w / 2 - 150, h * 0.47, 300, h * 0.21);
    ctx.fillStyle = '#6f8492';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(150 + i * 150, h * 0.48, 92, h * 0.13);
      if (150 + i * 150 > w / 2 - 200 && 150 + i * 150 < w / 2 + 120) {
        ctx.clearRect(150 + i * 150, h * 0.48, 92, h * 0.13);
        ctx.fillStyle = '#3f4b55';
        ctx.fillRect(150 + i * 150, h * 0.48, 92, h * 0.13);
        ctx.fillStyle = '#6f8492';
      }
    }

    ctx.fillStyle = '#f96302';
    for (let i = 0; i < 5; i++) {
      roundRect(ctx, w / 2 - 190 + i * 95, h * 0.63, 20, 62, 8);
      ctx.fill();
    }

    // Forecourt
    const ground = ctx.createLinearGradient(0, h * 0.68, 0, h);
    ground.addColorStop(0, '#8f8b86');
    ground.addColorStop(1, '#6e6a66');
    ctx.fillStyle = ground;
    ctx.fillRect(0, h * 0.68, w, h * 0.32);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 5;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-60 + i * 210, h);
      ctx.lineTo(120 + i * 168, h * 0.72);
      ctx.stroke();
    }

    noise(ctx, w, h, 12);
    vignette(ctx, w, h, 0.22);
    return c;
  }

  /* ---------------- sample 3: the thing that was bought ---------------- */

  function drawProduct() {
    const w = 1000, h = 1000;
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#efece6');
    bg.addColorStop(1, '#d8d3ca');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.83, 300, 46, 0, 0, Math.PI * 2);
    ctx.fill();

    // The bag
    const bx = w / 2 - 250, by = 150, bw = 500, bh = 660;
    const bagGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    bagGrad.addColorStop(0, '#12508f');
    bagGrad.addColorStop(0.45, '#1e6fc0');
    bagGrad.addColorStop(1, '#0f4a83');
    ctx.fillStyle = bagGrad;
    roundRect(ctx, bx, by, bw, bh, 26);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(bx, by, bw, 46);

    // Label panel
    ctx.fillStyle = '#f7f4ec';
    roundRect(ctx, bx + 46, by + 150, bw - 92, 300, 14);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#12508f';
    ctx.font = 'bold 58px Arial, Helvetica, sans-serif';
    ctx.fillText('PREMIUM', w / 2, by + 232);
    ctx.font = 'bold 68px Arial, Helvetica, sans-serif';
    ctx.fillText('DOG FOOD', w / 2, by + 306);
    ctx.fillStyle = '#8a6a2f';
    ctx.font = '38px Arial, Helvetica, sans-serif';
    ctx.fillText('SALMON & BROWN RICE', w / 2, by + 366);
    ctx.fillStyle = '#3d3a35';
    ctx.font = '32px Arial, Helvetica, sans-serif';
    ctx.fillText('ADULT FORMULA  ·  15 LB', w / 2, by + 418);

    // Paw mark
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.ellipse(w / 2, by + 552, 46, 40, 0, 0, Math.PI * 2); ctx.fill();
    [[-58, -46], [-22, -74], [22, -74], [58, -46]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.ellipse(w / 2 + dx, by + 552 + dy, 19, 24, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
    ctx.fillText('NET WT 15 LB (6.8 kg)', w / 2, by + 636);

    noise(ctx, w, h, 9);
    vignette(ctx, w, h, 0.1);
    return c;
  }

  /* ---------------- sample 4: no usable text at all ---------------- */

  function drawMeal() {
    const w = 1100, h = 820;
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');

    // Table
    const table = ctx.createLinearGradient(0, 0, w, h);
    table.addColorStop(0, '#6b4a30');
    table.addColorStop(1, '#4d3421');
    ctx.fillStyle = table;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 3;
    for (let y = 40; y < h; y += 86) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + 22); ctx.stroke();
    }

    // Plate
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(w / 2 + 12, h / 2 + 26, 320, 300, 0, 0, Math.PI * 2); ctx.fill();
    const plate = ctx.createRadialGradient(w / 2 - 90, h / 2 - 110, 40, w / 2, h / 2, 330);
    plate.addColorStop(0, '#ffffff');
    plate.addColorStop(1, '#dcd8d1');
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 318, 296, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 262, 242, 0, 0, Math.PI * 2); ctx.stroke();

    // Greens
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 200;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92;
      ctx.fillStyle = ['#3f6b28', '#4f8232', '#658f3a', '#2f5720'][i % 4];
      ctx.beginPath();
      ctx.ellipse(x, y, 26 + Math.random() * 20, 14 + Math.random() * 12, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Roasted vegetables and a grain base peeking through
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 170;
      ctx.fillStyle = ['#c8792c', '#a8541f', '#d99a3c'][i % 3];
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9, 22, 16, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 130;
      ctx.fillStyle = 'rgba(232,215,170,0.95)';
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9, 9, 6, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fork
    ctx.save();
    ctx.translate(w - 118, h / 2 + 40);
    ctx.rotate(0.08);
    ctx.fillStyle = '#c3c7cc';
    roundRect(ctx, -14, -190, 28, 300, 12); ctx.fill();
    for (let i = 0; i < 4; i++) { roundRect(ctx, -16 + i * 10, -250, 6, 70, 3); ctx.fill(); }
    ctx.restore();

    noise(ctx, w, h, 11);
    vignette(ctx, w, h, 0.3);
    return c;
  }

  /* ---------------- packaging ---------------- */

  function canvasToBuffer(canvas, quality) {
    return new Promise(resolve => {
      canvas.toBlob(blob => blob.arrayBuffer().then(resolve), 'image/jpeg', quality || 0.9);
    });
  }

  function hoursAgo(n) {
    const d = new Date();
    d.setHours(d.getHours() - n);
    return d;
  }

  function daysAgoAt(days, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  const SAMPLES = [
    {
      id: 'receipt',
      title: 'A receipt',
      blurb: 'Photographed on a table. Everything is in the picture — if the text can be read.',
      expect: 'Merchant, total, tax, tip, items and the printed timestamp',
      build: () => {
        const when = daysAgoAt(1, 12, 41);
        return { canvas: drawReceipt(when), exif: { capturedAt: when } };
      }
    },
    {
      id: 'storefront',
      title: 'A storefront',
      blurb: 'No amount anywhere in the frame. The sign, the brand colour and the photo’s own GPS tag are the evidence.',
      expect: 'Merchant from the sign, time and place from EXIF, amount from you',
      build: () => ({
        canvas: drawStorefront(),
        exif: { capturedAt: hoursAgo(5), gps: { lat: 39.9210, lng: -75.1443 }, model: 'iPhone 15 Pro' }
      })
    },
    {
      id: 'product',
      title: 'What was bought',
      blurb: 'A photo of the item itself. The packaging says what it is, never what it cost.',
      expect: 'Category from the packaging text, merchant from where you are',
      build: () => ({
        canvas: drawProduct(),
        exif: { capturedAt: hoursAgo(2), gps: { lat: 39.9518, lng: -75.1780 } }
      })
    },
    {
      id: 'meal',
      title: 'Something ambiguous',
      blurb: 'A plate of food. No text, no logo, no total — the hard case, and the common one.',
      expect: 'Low confidence, an honest guess, and a request for the amount',
      build: () => ({ canvas: drawMeal(), exif: { capturedAt: hoursAgo(1) } })
    }
  ];

  const cache = {};

  /** Returns { url, buffer, image } for a sample, drawing it once. */
  async function loadSample(id) {
    if (cache[id]) return cache[id];
    const sample = SAMPLES.find(s => s.id === id);
    if (!sample) throw new Error('Unknown sample: ' + id);

    const { canvas, exif } = sample.build();
    let buffer = await canvasToBuffer(canvas, 0.92);
    if (exif) buffer = injectExif(buffer, exif);

    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
    const image = await window.Vision.loadImageFromUrl(url);
    return (cache[id] = { url, buffer, image, sample });
  }

  window.Samples = { SAMPLES, loadSample, injectExif, buildExifSegment };
})();
