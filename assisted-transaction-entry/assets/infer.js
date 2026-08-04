/* ------------------------------------------------------------------
   infer.js — turning evidence into a filled-in transaction
   ------------------------------------------------------------------
   The rule the whole prototype is built around: every field the app
   fills in carries where it came from and how sure it is. A guess the
   user can see the reasoning for is a guess they can correct in one
   tap. A guess presented as fact is a data-entry bug with extra steps.

   Merchant selection is a small Bayesian ranking:

     score(m) = log P(m)            frequency prior from history
              + log P(amount | m)   log-normal fit to past spend
              + log P(hour | m)     when this user goes there
              + log P(here | m)     distance from current location
              + evidence from the image, if there is an image

   Softmax over the scores gives the confidence figure shown in the UI,
   and the runners-up become the alternate chips.
------------------------------------------------------------------- */

(function () {
  'use strict';

  const D = window.BudgetData;
  const OVERRIDE_KEY = 'ate.categoryOverrides.v1';

  /* ---------------- context helpers ---------------- */

  function haversineMiles(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 3958.8, toRad = x => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function formatDistance(miles) {
    if (miles == null) return null;
    const feet = miles * 5280;
    if (feet < 1000) return Math.round(feet / 10) * 10 + ' ft';
    return miles.toFixed(miles < 10 ? 1 : 0) + ' mi';
  }

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function saveOverride(merchantId, categoryId) {
    if (!merchantId) return;
    const all = loadOverrides();
    all[merchantId] = categoryId;
    try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }

  function clearOverrides() {
    try { localStorage.removeItem(OVERRIDE_KEY); } catch (e) { /* no-op */ }
  }

  /** Per-merchant summary of what the history actually says. */
  function summariseHistory(history) {
    const stats = {};
    const now = Date.now();
    history.forEach(tx => {
      if (!tx.merchantId) return;
      const s = stats[tx.merchantId] || (stats[tx.merchantId] = { visits: 0, amounts: [], lastAt: 0 });
      s.visits++;
      s.amounts.push(tx.amount);
      const at = new Date(tx.at).getTime();
      if (at > s.lastAt) s.lastAt = at;
    });
    Object.values(stats).forEach(s => {
      s.amounts.sort((a, b) => a - b);
      s.low = s.amounts[Math.floor(s.amounts.length * 0.1)];
      s.high = s.amounts[Math.min(s.amounts.length - 1, Math.floor(s.amounts.length * 0.9))];
      s.median = s.amounts[Math.floor(s.amounts.length / 2)];
      s.daysSince = (now - s.lastAt) / 86400000;
    });
    return stats;
  }

  /* ---------------- merchant ranking ---------------- */

  const FLOOR = 1e-4;
  function safeLog(p) { return Math.log(Math.max(FLOOR, p)); }

  /**
   * @param {object} opts
   *   amount        number|null
   *   at            Date
   *   location      {lat,lng}|null   current position, null if location is off
   *   history       array
   *   imageEvidence {merchantScores: {id: 0..1}}  optional boost from vision
   */
  function rankMerchants(opts) {
    const { amount, at, location, history } = opts;
    const imageEvidence = opts.imageEvidence || {};
    const stats = summariseHistory(history);
    const totalVisits = Object.values(stats).reduce((a, s) => a + s.visits, 0) || 1;
    const hour = at.getHours();

    const candidates = D.MERCHANTS.map(m => {
      const s = stats[m.id] || { visits: 0, amounts: [], daysSince: 999 };
      const reasons = [];
      const parts = {};

      // --- prior: how much of this user's activity is this merchant ---
      const prior = (s.visits + 0.4) / (totalVisits + D.MERCHANTS.length * 0.4);
      parts.prior = safeLog(prior);
      if (s.visits >= 3) {
        reasons.push({
          kind: 'history',
          text: s.visits + ' visit' + (s.visits === 1 ? '' : 's') + ' in the last 60 days'
        });
      }

      // --- amount fit against a log-normal of past spend ---
      if (amount != null && amount > 0) {
        const median = s.median || m.amount.median;
        const sigma = Math.max(0.12, m.amount.sigma);
        const z = (Math.log(amount) - Math.log(median)) / sigma;
        parts.amount = safeLog(Math.exp(-0.5 * z * z));
        if (Math.abs(z) < 0.9 && s.visits >= 3) {
          reasons.push({
            kind: 'amount',
            text: '$' + amount.toFixed(2) + ' fits what you normally spend here ($' +
                  s.low.toFixed(0) + '–$' + s.high.toFixed(0) + ')'
          });
        }
        // An exact repeat of a known recurring charge is close to decisive.
        if (m.recurring && Math.abs(amount - m.recurring.amount) < 0.015) {
          parts.recurring = Math.log(9);
          reasons.push({ kind: 'recurring', text: 'Matches your monthly ' + m.name + ' charge exactly' });
        }
      } else {
        parts.amount = 0;
      }

      // --- time of day ---
      const peak = Math.max(...m.hours);
      const pTime = m.hours[hour] / peak;
      parts.time = safeLog(pTime);
      if (pTime > 0.75 && s.visits >= 3) {
        reasons.push({ kind: 'time', text: 'This is when you usually go' });
      }

      // --- location ---
      let distance = null;
      if (m.online) {
        // Online merchants are location-agnostic, but "you are standing
        // somewhere" is mild evidence against them.
        parts.location = safeLog(location ? 0.32 : 0.6);
      } else if (!location) {
        parts.location = 0; // no signal either way
      } else {
        distance = haversineMiles(location, m.geo);
        // Presence has to be able to *support* a merchant, not merely fail to
        // rule it out. As a plain decaying likelihood the best a merchant
        // could score was zero, so somewhere visited fifteen times as often
        // still won while the user was physically standing inside a shop they
        // visit twice a month. This is positive at the door (about +2.2 nats,
        // roughly a ninefold odds boost), crosses over around 600 ft, and
        // falls away steeply after that.
        const d = distance / 0.12;
        parts.location = 2.2 * Math.exp(-d) - d;
        if (distance < 0.2) {
          reasons.unshift({
            kind: 'location',
            text: distance < 0.015
              ? "You're standing in " + m.name
              : "You're " + formatDistance(distance) + ' from ' + m.name
          });
        }
      }

      // --- what the picture said ---
      const fromImage = imageEvidence[m.id];
      if (fromImage) {
        parts.image = Math.log(1 + fromImage.weight * 60);
        if (fromImage.reason) {
          // Strong image evidence leads the explanation; a colour coincidence
          // on a product shot should not be the first thing the user reads.
          const entry = { kind: 'image', text: fromImage.reason };
          fromImage.lead === false ? reasons.push(entry) : reasons.unshift(entry);
        }
      }

      const score = Object.values(parts).reduce((a, b) => a + b, 0);
      return { merchant: m, score, parts, reasons, distance, stats: s };
    });

    // Softmax over log-scores → comparable confidences.
    const max = Math.max(...candidates.map(c => c.score));
    let sum = 0;
    candidates.forEach(c => { c._e = Math.exp(c.score - max); sum += c._e; });

    // Then hold the top end below certainty. Even a name read cleanly off a
    // receipt can be the wrong branch of the chain, and OCR misreads; a UI
    // that says "100% sure" is making a promise the evidence cannot keep.
    const floor = 0.015 / candidates.length;
    candidates.forEach(c => { c.probability = (c._e / sum) * 0.985 + floor; delete c._e; });

    return candidates.sort((a, b) => b.probability - a.probability);
  }

  /* ---------------- category inference ---------------- */

  function scoreCategoriesFromText(text) {
    const hay = ' ' + (text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    const scores = {}, hits = {};
    Object.entries(D.CATEGORY_KEYWORDS).forEach(([categoryId, words]) => {
      words.forEach(word => {
        if (hay.includes(' ' + word) || hay.includes(word + ' ')) {
          // "dog food" is worth more than "food": a multi-word phrase is
          // far less likely to have turned up by accident.
          scores[categoryId] = (scores[categoryId] || 0) + (word.includes(' ') ? 1.9 : 1);
          (hits[categoryId] || (hits[categoryId] = [])).push(word);
        }
      });
    });
    return { scores, hits };
  }

  /** Weak fallback when nothing but the amount and the clock is known. */
  function scoreCategoriesFromContext(amount, at) {
    const hour = at.getHours();
    const weekend = at.getDay() === 0 || at.getDay() === 6;
    const s = {};
    const add = (id, v) => { s[id] = (s[id] || 0) + v; };

    if (amount != null) {
      if (amount < 12 && hour >= 5 && hour <= 11) add('coffee', 1.4);
      if (amount < 12 && hour > 11) add('dining', 0.5);
      if (amount >= 8 && amount <= 30 && ((hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21))) add('dining', 1.3);
      if (amount >= 30 && amount <= 140 && hour >= 9) add('groceries', weekend ? 1.2 : 0.8);
      if (amount >= 35 && amount <= 75) add('fuel', 0.5);
      if (amount < 4) add('transit', 1.1);
      if (amount > 140) add('shopping', 0.7);
    }
    return s;
  }

  function inferCategory(opts) {
    const { merchant, amount, at, text, overrides } = opts;
    const combined = {};
    const why = [];
    const add = (id, weight) => { combined[id] = (combined[id] || 0) + weight; };

    if (merchant) {
      const override = (overrides || {})[merchant.id];
      if (override) {
        add(override, 6);
        why.push({ kind: 'learned', text: 'You filed ' + merchant.name + ' under this last time' });
      } else {
        // The merchant only gets to dominate the category to the extent we
        // are actually confident about the merchant. A 45% guess from brand
        // colours must not outvote "DOG FOOD" printed on the bag.
        const trust = opts.merchantConfidence == null ? 1 : Math.min(1, Math.max(0, opts.merchantConfidence));
        const byRule = D.resolveCategoryRules(merchant, amount == null ? merchant.amount.median : amount);
        add(byRule, 1.1 + 3.7 * trust);
        if (merchant.categoryRules && byRule !== merchant.category) {
          why.push({ kind: 'rule', text: 'A $' + Number(amount).toFixed(2) + ' stop at ' + merchant.name + ' is usually ' + D.CATEGORY_BY_ID[byRule].name.toLowerCase() });
        } else {
          why.push({ kind: 'merchant', text: merchant.name + ' is ' + D.CATEGORY_BY_ID[byRule].name.toLowerCase() });
        }
      }
    }

    const fromText = scoreCategoriesFromText(text);
    Object.entries(fromText.scores).forEach(([id, n]) => {
      add(id, Math.min(3, n * 1.1));
      why.push({ kind: 'text', text: 'Saw ' + fromText.hits[id].slice(0, 3).map(w => '“' + w + '”').join(', ') + ' in the text' });
    });

    const fromContext = scoreCategoriesFromContext(amount, at);
    Object.entries(fromContext).forEach(([id, v]) => add(id, v));
    if (!merchant && !Object.keys(fromText.scores).length && Object.keys(fromContext).length) {
      why.push({ kind: 'context', text: 'Guessed from the amount and time of day' });
    }

    if (!Object.keys(combined).length) {
      return { category: null, confidence: 0, alternates: [], why: [] };
    }

    // A little mass spread over every category, so that a single piece of
    // evidence reads as "94% sure" rather than the absurd "100% sure".
    // Nothing here ever justifies certainty.
    const smoothing = 0.3 / D.CATEGORIES.length;
    D.CATEGORIES.forEach(c => { combined[c.id] = (combined[c.id] || 0) + smoothing; });

    const ranked = Object.entries(combined)
      .map(([id, score]) => ({ category: D.CATEGORY_BY_ID[id], score }))
      .filter(c => c.category)
      .sort((a, b) => b.score - a.score);

    const total = ranked.reduce((a, c) => a + c.score, 0);
    ranked.forEach(c => { c.probability = c.score / total; });

    return {
      category: ranked[0].category,
      confidence: ranked[0].probability,
      // Only the alternates that are actually contenders — the smoothing
      // floor otherwise drags in a tail of categories at half a percent.
      alternates: ranked.slice(1, 4).filter(c => c.probability > 0.04),
      why: why.slice(0, 3)
    };
  }

  /* ---------------- field helper ---------------- */

  function field(value, confidence, source, why) {
    return { value, confidence, source, why: why || null };
  }

  /* ---------------- the two entry paths ---------------- */

  /**
   * Amount-only entry. Everything else is inferred from time, place and
   * two months of habit.
   */
  function fromAmount(opts) {
    const at = opts.at || new Date();
    const overrides = loadOverrides();
    const ranked = rankMerchants({
      amount: opts.amount, at, location: opts.location, history: opts.history
    });

    const top = ranked[0];
    const category = inferCategory({
      merchant: top.merchant, merchantConfidence: top.probability,
      amount: opts.amount, at, text: opts.note || '', overrides
    });

    return {
      input: 'amount',
      amount: field(opts.amount, 1, 'you', 'You typed it'),
      at: field(at, 0.9, 'assumed', 'Assumed now — nothing suggested otherwise'),
      merchant: field(top.merchant, top.probability, top.reasons.length ? top.reasons[0].kind : 'history',
        top.reasons.map(r => r.text).slice(0, 3).join(' · ')),
      category: field(category.category, category.confidence, category.why[0] ? category.why[0].kind : 'context',
        category.why.map(w => w.text).join(' · ')),
      note: field(opts.note || '', opts.note ? 1 : 0, 'you'),
      merchantAlternates: ranked.slice(1, 5),
      categoryAlternates: category.alternates,
      reasons: top.reasons,
      trace: { ranked: ranked.slice(0, 6), category }
    };
  }

  /**
   * Image entry. `analysis` is whatever vision.js managed to extract;
   * this decides what any of it is worth.
   */
  function fromImage(opts) {
    const a = opts.analysis;
    const overrides = loadOverrides();
    const kind = a.classification.kind;
    const notes = [];

    /* --- when --- */
    let at = opts.at || new Date();
    let atField = field(at, 0.85, 'assumed', 'Assumed now');
    if (a.receipt && a.receipt.date) {
      at = a.receipt.date;
      const hasTime = at.getHours() !== 0 || at.getMinutes() !== 0;
      atField = field(at, hasTime ? 0.95 : 0.8, 'receipt',
        'Printed on the receipt' + (hasTime ? '' : ' (time not shown — using midday)'));
      if (!hasTime) at.setHours(12, 0, 0, 0);
    } else if (a.exif && a.exif.capturedAt) {
      at = a.exif.capturedAt;
      atField = field(at, 0.9, 'photo', 'When the photo was taken' +
        (a.exif.model ? ' (' + a.exif.model + ')' : ''));
    }

    /* --- where --- */
    let location = opts.location;
    let locationSource = location ? 'current location' : null;
    if (a.exif && a.exif.gps) {
      location = a.exif.gps;
      locationSource = 'GPS tag on the photo';
      notes.push('Used the photo’s GPS tag instead of your current position.');
    }

    /* --- who: pull merchant evidence out of the image --- */
    const imageEvidence = {};

    a.textMerchants.forEach((m, i) => {
      // Text is the strongest merchant signal available client-side.
      imageEvidence[m.merchant.id] = {
        weight: m.score * (i === 0 ? 1 : 0.6),
        reason: kind === 'receipt' ? 'Name on the receipt' : 'Name read off the image'
      };
    });

    if (kind === 'storefront' || kind === 'product') {
      a.palette.forEach(p => {
        const existing = imageEvidence[p.merchant.id];
        // On a product shot the dominant colours belong to the packaging,
        // not to the shop it was carried out of — weak evidence at best.
        const weight = p.score * (kind === 'storefront' ? 0.55 : 0.15);
        if (!existing || existing.weight < weight) {
          imageEvidence[p.merchant.id] = {
            weight,
            lead: kind === 'storefront',
            reason: 'Colours match the ' + p.merchant.name + ' palette (' + p.match.brand.hex + ')'
          };
        }
      });
    }

    /* --- how much --- */
    let amount = opts.amount != null ? opts.amount : null;
    let amountField;
    if (opts.amount != null) {
      amountField = field(opts.amount, 1, 'you', 'You typed it');
    } else if (a.receipt && a.receipt.total != null) {
      amount = a.receipt.total;
      const label = a.receipt.subtotal != null || a.receipt.items.length ? 'Total line on the receipt' : 'Largest figure on the receipt';
      amountField = field(amount, a.receipt.subtotal != null ? 0.93 : 0.6, 'receipt', label);
    } else {
      amountField = field(null, 0, 'missing', 'Not readable from this image');
    }

    const ranked = rankMerchants({
      amount, at, location, history: opts.history, imageEvidence
    });
    const top = ranked[0];

    /* --- how confident should the merchant field be? ---
       A receipt with the name printed on it is a different level of
       certainty from an orange-ish building, and the UI should not
       present the two identically. This has to be settled before the
       category is inferred, because it governs how much the merchant is
       allowed to say about the category. */
    let merchantConfidence = top.probability;
    let merchantSource = 'context';
    const evidence = imageEvidence[top.merchant.id];
    if (evidence) {
      merchantSource = evidence.reason && /receipt/i.test(evidence.reason) ? 'receipt'
        : /palette/i.test(evidence.reason) ? 'palette' : 'image';
      if (merchantSource === 'palette') merchantConfidence = Math.min(merchantConfidence, 0.68);
    }

    /* --- what kind of spending --- */
    const itemText = a.receipt ? a.receipt.items.map(i => i.label).join(' ') : '';
    const ocrText = a.ocr ? a.ocr.text : '';
    const category = inferCategory({
      merchant: top.merchant, merchantConfidence,
      amount, at, text: itemText + ' ' + ocrText + ' ' + (opts.note || ''), overrides
    });

    if (a.ocrError) {
      notes.push(kind === 'receipt'
        ? 'This is clearly a receipt, but the text couldn’t be read (' + a.ocrError +
          '). Everything below came from the picture, its metadata and your context instead — the total is the one thing you’ll have to supply.'
        : 'Couldn’t run text recognition (' + a.ocrError + '), so this fell back to the picture itself, your location and the time.');
    }
    if (kind === 'product') {
      notes.push('This looks like the things you bought rather than a receipt, so the amount has to come from you.');
    }
    if (kind === 'other') {
      notes.push('This one is hard to read. Best guess below — worth checking every field.');
    }

    return {
      input: 'image',
      kind,
      amount: amountField,
      at: atField,
      merchant: field(top.merchant, merchantConfidence, merchantSource,
        top.reasons.map(r => r.text).slice(0, 3).join(' · ')),
      category: field(category.category, category.confidence, category.why[0] ? category.why[0].kind : 'context',
        category.why.map(w => w.text).join(' · ')),
      note: field(opts.note || '', opts.note ? 1 : 0, 'you'),
      merchantAlternates: ranked.slice(1, 5),
      categoryAlternates: category.alternates,
      reasons: top.reasons,
      receipt: a.receipt,
      locationSource,
      notes,
      trace: { ranked: ranked.slice(0, 6), category, imageEvidence }
    };
  }

  window.Infer = {
    fromAmount, fromImage, rankMerchants, inferCategory,
    haversineMiles, formatDistance, summariseHistory,
    loadOverrides, saveOverride, clearOverrides
  };
})();
