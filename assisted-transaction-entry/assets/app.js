/* ------------------------------------------------------------------
   app.js — the flow itself
   ------------------------------------------------------------------
   Screens: home (quick add) → analysing → review → home.

   The design rule throughout: the app commits to an answer, shows what
   the answer was based on, and keeps every field one tap from being
   changed. Nothing blocks on a question the app could answer itself,
   and the only thing it ever insists on is an amount it genuinely
   cannot see.
------------------------------------------------------------------- */

(function () {
  'use strict';

  const D = window.BudgetData;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const state = {
    history: D.buildHistory(60),
    location: D.LOCATIONS[0],
    clockOffset: null,   // ms offset for the "pretend it's…" control
    entry: '',           // amount keypad buffer, in cents
    draft: null,
    analysis: null,
    savedCount: 0
  };

  function now() {
    return state.clockOffset == null ? new Date() : new Date(Date.now() + state.clockOffset);
  }

  function currentLocation() {
    return state.location.lat == null ? null : { lat: state.location.lat, lng: state.location.lng };
  }

  /* ---------------- formatting ---------------- */

  const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function timeOfDay(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function relativeDay(date) {
    const a = new Date(date); a.setHours(0, 0, 0, 0);
    const b = now(); b.setHours(0, 0, 0, 0);
    const days = Math.round((b - a) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function confidenceClass(p) {
    return p >= 0.72 ? 'pill-good' : p >= 0.42 ? 'pill-warn' : 'pill-poor';
  }

  function confidenceLabel(p) {
    if (p >= 0.72) return Math.round(p * 100) + '% sure';
    if (p >= 0.42) return 'Fairly sure (' + Math.round(p * 100) + '%)';
    return 'Best guess (' + Math.round(p * 100) + '%)';
  }

  const SOURCE_LABEL = {
    receipt: 'from the receipt', photo: 'from the photo', palette: 'from brand colours',
    image: 'from the image', location: 'from where you are', history: 'from your history',
    amount: 'from the amount', time: 'from the time', recurring: 'a recurring charge',
    assumed: 'assumed', you: 'you entered it', context: 'from context',
    learned: 'you taught it this', merchant: 'from the merchant', rule: 'from the amount',
    text: 'from the text', missing: 'not found'
  };

  /* ---------------- screens ---------------- */

  function show(screenId) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screenId));
  }

  /* ---------------- home ---------------- */

  function renderHome() {
    const today = now();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const spend = state.history
      .filter(t => new Date(t.at) >= monthStart)
      .reduce((a, t) => a + t.amount, 0);
    const budget = Object.values(D.MONTHLY_BUDGETS).reduce((a, b) => a + b, 0);

    $('#month-label').textContent = today.toLocaleDateString('en-US', { month: 'long' }) + ' spending';
    $('#month-spend').innerHTML = money(spend) + ' <span>of ' + money(budget) + '</span>';
    $('#budget-fill').style.width = Math.min(100, (spend / budget) * 100) + '%';
    $('#budget-left').textContent = money(Math.max(0, budget - spend)) + ' left';
    $('#budget-day').textContent = 'Day ' + today.getDate() + ' of ' +
      new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

    const list = $('#tx-list');
    list.innerHTML = '';
    state.history.slice(0, 14).forEach(tx => {
      const category = D.CATEGORY_BY_ID[tx.category] || D.CATEGORY_BY_ID.shopping;
      const at = new Date(tx.at);
      const row = document.createElement('div');
      row.className = 'tx' + (tx.isNew ? ' is-new' : '');
      row.innerHTML =
        '<div class="tx-icon" style="background:' + category.color + '1f">' + category.icon + '</div>' +
        '<div class="tx-body">' +
          '<div class="tx-name"></div>' +
          '<div class="tx-meta"></div>' +
        '</div>' +
        '<div class="tx-amount">' + money(tx.amount) + '</div>';
      row.querySelector('.tx-name').textContent = tx.merchant;
      row.querySelector('.tx-meta').textContent =
        category.name + ' · ' + relativeDay(at) + ' ' + timeOfDay(at);
      list.appendChild(row);
      tx.isNew = false;
    });

    $('#clock').textContent = timeOfDay(today).replace(' ', ' ');
  }

  /* ---------------- keypad ---------------- */

  function entryAmount() {
    return state.entry ? parseInt(state.entry, 10) / 100 : null;
  }

  function renderEntry() {
    const el = $('#dock-amount');
    const amount = entryAmount();
    el.classList.toggle('empty', amount == null);
    el.innerHTML = '<span class="cur">$</span>' + (amount == null ? '0.00' : amount.toFixed(2));
    $('#btn-add').disabled = amount == null || amount <= 0;
  }

  function pressKey(key) {
    if (key === 'back') state.entry = state.entry.slice(0, -1);
    else if (key === 'clear') state.entry = '';
    else if (state.entry.length < 8) state.entry = (state.entry + key).replace(/^0+(?=\d)/, '');
    renderEntry();
  }

  /* ---------------- the amount-only path ---------------- */

  async function runAmountFlow() {
    const amount = entryAmount();
    if (amount == null) return;

    state.analysis = null;
    show('analysing');
    $('#analysing-preview').style.display = 'none';
    setSteps([
      { id: 'ctx', label: 'Reading your context' },
      { id: 'rank', label: 'Ranking where you probably are' },
      { id: 'cat', label: 'Choosing a category' }
    ]);

    await step('ctx', 'done', state.location.lat == null
      ? 'Location off · ' + timeOfDay(now())
      : state.location.label + ' · ' + timeOfDay(now()), 380);

    const draft = window.Infer.fromAmount({
      amount, at: now(), location: currentLocation(), history: state.history
    });

    await step('rank', 'done', draft.merchant.value.name + ' — ' +
      Math.round(draft.merchant.confidence * 100) + '% of the probability mass', 420);
    await step('cat', 'done', draft.category.value ? draft.category.value.name : 'Uncategorised', 300);

    state.draft = draft;
    renderReview();
    renderInspector();
    show('review');
  }

  /* ---------------- the image path ---------------- */

  async function runImageFlow(image, buffer, label) {
    show('analysing');
    const preview = $('#analysing-preview');
    preview.style.display = 'block';
    preview.style.backgroundImage = 'url(' + image.src + ')';

    setSteps([
      { id: 'measure', label: 'Looking at the picture' },
      { id: 'classify', label: 'Working out what it is' },
      { id: 'exif', label: 'Checking photo metadata' },
      { id: 'ocr', label: 'Reading any text' },
      { id: 'match', label: 'Matching merchant and category' }
    ]);
    $('#analysing-caption').textContent = label || '';

    const analysis = await window.Vision.analyseImage(image, buffer, (stage, detail) => {
      if (stage === 'measuring') setStep('measure', 'doing', detail);
      if (stage === 'classifying') setStep('classify', 'doing', detail);
      if (stage === 'exif') setStep('exif', 'doing', detail);
      if (stage === 'ocr') setStep('ocr', 'doing', detail);
    });

    state.analysis = analysis;

    const c = analysis.classification;
    await step('measure', 'done', analysis.features.width + '×' + analysis.features.height +
      ' · ' + analysis.features.textLineCount + ' text-like lines', 260);
    await step('classify', 'done', 'Looks like ' + c.label + ' — ' +
      Math.round(c.confidence * 100) + '% (next best: ' + c.runnerUp + ')', 320);

    if (analysis.exif && (analysis.exif.capturedAt || analysis.exif.gps)) {
      const bits = [];
      if (analysis.exif.capturedAt) bits.push('taken ' + relativeDay(analysis.exif.capturedAt).toLowerCase() + ' at ' + timeOfDay(analysis.exif.capturedAt));
      if (analysis.exif.gps) bits.push('GPS tag present');
      await step('exif', 'done', bits.join(' · '), 260);
    } else {
      await step('exif', 'warn', 'No EXIF in this file — falling back to the current time', 240);
    }

    if (analysis.ocrError) {
      await step('ocr', 'warn', analysis.ocrError + ' — continuing without text', 240);
    } else if (analysis.ocr) {
      const lines = analysis.ocr.text.split('\n').filter(l => l.trim()).length;
      await step('ocr', 'done', lines + ' lines read · ' + Math.round(analysis.ocr.confidence) + '% engine confidence', 240);
    } else {
      await step('ocr', 'done', 'No text worth reading in this picture', 220);
    }

    const draft = window.Infer.fromImage({
      analysis, at: now(), location: currentLocation(), history: state.history
    });

    await step('match', 'done', draft.merchant.value.name +
      (draft.category.value ? ' · ' + draft.category.value.name : ''), 320);

    state.draft = draft;
    renderReview();
    renderInspector();
    show('review');
  }

  /* ---------------- analysing steps ---------------- */

  function setSteps(steps) {
    const list = $('#steps');
    list.innerHTML = '';
    steps.forEach(s => {
      const li = document.createElement('li');
      li.className = 'step';
      li.dataset.step = s.id;
      li.innerHTML = '<span class="dot"></span><span><span class="step-label"></span>' +
        '<span class="step-detail"></span></span>';
      li.querySelector('.step-label').textContent = s.label;
      list.appendChild(li);
    });
  }

  function setStep(id, status, detail) {
    const li = $('#steps [data-step="' + id + '"]');
    if (!li) return;
    li.classList.remove('doing', 'done', 'warn');
    li.classList.add(status);
    li.querySelector('.dot').textContent = status === 'done' ? '✓' : status === 'warn' ? '!' : '';
    if (detail != null) li.querySelector('.step-detail').textContent = detail;
  }

  /* A short pause between steps so the sequence is legible. Real work
     (OCR especially) takes far longer than these delays. */
  function step(id, status, detail, delay) {
    setStep(id, status, detail);
    return new Promise(r => setTimeout(r, delay || 0));
  }

  /* ---------------- review ---------------- */

  function renderReview() {
    const d = state.draft;
    const kicker = d.input === 'image'
      ? 'From your ' + ({ receipt: 'receipt', storefront: 'photo of the shop', product: 'photo', other: 'photo' }[d.kind] || 'photo')
      : 'From $' + Number(d.amount.value).toFixed(2);
    $('#review-kicker').textContent = kicker;

    const amountEl = $('#review-amount');
    amountEl.value = d.amount.value == null ? '' : Number(d.amount.value).toFixed(2);
    amountEl.placeholder = 'Tap to enter';
    amountEl.classList.toggle('missing', d.amount.value == null);
    $('#amount-why').innerHTML = d.amount.value == null
      ? '<span class="pill pill-poor">needed</span> This is the one thing the picture can’t tell me'
      : sourcePill(d.amount) + ' ' + escapeHtml(d.amount.why || '');

    // Merchant
    const m = d.merchant.value;
    $('#field-merchant .field-value').textContent = m.name;
    $('#field-merchant .field-why').innerHTML = sourcePill(d.merchant) + ' ' + escapeHtml(d.merchant.why || '');
    $('#field-merchant .field-icon').textContent = '🏬';

    // Category
    const cat = d.category.value;
    const catIcon = $('#field-category .field-icon');
    $('#field-category .field-value').textContent = cat ? cat.name : 'Pick a category';
    $('#field-category .field-value').classList.toggle('empty', !cat);
    $('#field-category .field-why').innerHTML = sourcePill(d.category) + ' ' + escapeHtml(d.category.why || '');
    catIcon.textContent = cat ? cat.icon : '❓';
    catIcon.style.background = cat ? cat.color + '1f' : '#f0f3f6';

    // When
    const at = d.at.value;
    $('#field-when .field-value').textContent = relativeDay(at) + ' at ' + timeOfDay(at);
    $('#field-when .field-why').innerHTML = sourcePill(d.at) + ' ' + escapeHtml(d.at.why || '');

    // Alternates shown up front when the top answer is shaky.
    renderAlternates('#merchant-alternates', d.merchantAlternates.map(c => ({
      label: c.merchant.name, p: c.probability, onPick: () => pickMerchant(c.merchant)
    })), d.merchant.confidence < 0.7);

    renderAlternates('#category-alternates', d.categoryAlternates.map(c => ({
      label: c.category.name, p: c.probability, onPick: () => pickCategory(c.category)
    })), !cat || d.category.confidence < 0.62);

    // Caveats
    const notes = $('#review-notes');
    const list = (d.notes || []).slice();
    if (d.locationSource === 'GPS tag on the photo') { /* already noted */ }
    notes.innerHTML = '';
    if (list.length) {
      notes.style.display = 'block';
      list.forEach(n => {
        const p = document.createElement('p');
        p.textContent = n;
        notes.appendChild(p);
      });
    } else {
      notes.style.display = 'none';
    }

    $('#note-input').value = d.note.value || '';
    $('#btn-save').disabled = d.amount.value == null || !(d.amount.value > 0);
  }

  function sourcePill(f) {
    const label = SOURCE_LABEL[f.source] || f.source;
    if (f.source === 'you' || f.source === 'missing') {
      return '<span class="pill pill-flat">' + label + '</span>';
    }
    return '<span class="pill ' + confidenceClass(f.confidence) + '">' +
      confidenceLabel(f.confidence) + '</span><span class="pill pill-flat">' + label + '</span>';
  }

  function renderAlternates(sel, options, visible) {
    const host = $(sel);
    host.innerHTML = '';
    if (!visible || !options.length) { host.style.display = 'none'; return; }
    host.style.display = 'flex';
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:11.5px;color:#8b9aa8;align-self:center;margin-right:2px;';
    hint.textContent = 'Or:';
    host.appendChild(hint);
    options.slice(0, 4).forEach(o => {
      const b = document.createElement('button');
      b.className = 'alt-chip';
      b.innerHTML = '<span class="alt-label"></span><span class="alt-p">' + Math.round(o.p * 100) + '%</span>';
      b.querySelector('.alt-label').textContent = o.label;
      b.addEventListener('click', o.onPick);
      host.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- corrections ---------------- */

  function pickMerchant(merchant) {
    const d = state.draft;
    d.merchant = { value: merchant, confidence: 1, source: 'you', why: 'You picked it' };

    // A different merchant usually means a different category, unless the
    // user has already made a deliberate choice on this draft.
    if (d.category.source !== 'you') {
      const inferred = window.Infer.inferCategory({
        merchant, amount: d.amount.value, at: d.at.value,
        text: state.analysis && state.analysis.ocr ? state.analysis.ocr.text : (d.note.value || ''),
        overrides: window.Infer.loadOverrides()
      });
      d.category = {
        value: inferred.category, confidence: inferred.confidence,
        source: inferred.why[0] ? inferred.why[0].kind : 'merchant',
        why: inferred.why.map(w => w.text).join(' · ')
      };
      d.categoryAlternates = inferred.alternates;
    }
    closeSheet();
    renderReview();
  }

  function pickCategory(category) {
    const d = state.draft;
    const wasInferred = d.category.value;
    d.category = { value: category, confidence: 1, source: 'you', why: 'You picked it' };

    // Remember the correction against the merchant, so the same mistake
    // is not made twice.
    if (d.merchant.value && wasInferred && wasInferred.id !== category.id) {
      window.Infer.saveOverride(d.merchant.value.id, category.id);
      toast('Noted — ' + d.merchant.value.name + ' will be filed under ' + category.name + ' next time.');
      updateContextFoot();
    }
    closeSheet();
    renderReview();
  }

  function pickTime(date) {
    state.draft.at = { value: date, confidence: 1, source: 'you', why: 'You set it' };
    closeSheet();
    renderReview();
  }

  /* ---------------- sheets ---------------- */

  function openSheet(title, sub, build) {
    $('#sheet-title').textContent = title;
    $('#sheet-sub').textContent = sub || '';
    const body = $('#sheet-body');
    body.innerHTML = '';
    build(body);
    $('#sheet').classList.add('open');
    $('#sheet-backdrop').classList.add('open');
  }

  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
  }

  function optionRow(opts) {
    const b = document.createElement('button');
    b.className = 'option' + (opts.selected ? ' selected' : '');
    b.innerHTML =
      '<span class="option-icon" style="background:' + (opts.tint || '#f0f3f6') + '">' + (opts.icon || '') + '</span>' +
      '<span class="option-body"><span class="option-name"></span><span class="option-why"></span></span>' +
      '<span class="option-score">' + (opts.score || '') + '</span>';
    b.querySelector('.option-name').textContent = opts.name;
    b.querySelector('.option-why').textContent = opts.why || '';
    b.addEventListener('click', opts.onPick);
    return b;
  }

  function openMerchantSheet() {
    const d = state.draft;
    const ranked = d.trace.ranked;
    const shownIds = new Set();

    openSheet('Where was this?', 'Ranked by everything the app knows right now', body => {
      ranked.forEach(c => {
        shownIds.add(c.merchant.id);
        body.appendChild(optionRow({
          name: c.merchant.name,
          why: c.reasons.map(r => r.text).slice(0, 2).join(' · ') || 'No strong signal',
          icon: '🏬',
          score: Math.round(c.probability * 100) + '%',
          selected: d.merchant.value.id === c.merchant.id,
          onPick: () => pickMerchant(c.merchant)
        }));
      });

      const rest = D.MERCHANTS.filter(m => !shownIds.has(m.id));
      if (rest.length) {
        const label = document.createElement('div');
        label.className = 'list-label';
        label.textContent = 'Everywhere else';
        body.appendChild(label);
        rest.forEach(m => body.appendChild(optionRow({
          name: m.name, why: D.CATEGORY_BY_ID[m.category].name, icon: '🏬',
          selected: d.merchant.value.id === m.id,
          onPick: () => pickMerchant(m)
        })));
      }
    });
  }

  function openCategorySheet() {
    const d = state.draft;
    const suggested = [d.category.value].concat(d.categoryAlternates.map(a => a.category)).filter(Boolean);
    const suggestedIds = new Set(suggested.map(c => c.id));

    openSheet('What kind of spending?', 'Suggestions first, then the rest of your categories', body => {
      suggested.forEach((c, i) => body.appendChild(optionRow({
        name: c.name, icon: c.icon, tint: c.color + '1f',
        why: i === 0 ? (d.category.why || '') : 'Also plausible',
        score: i === 0 ? Math.round(d.category.confidence * 100) + '%' : '',
        selected: d.category.value && d.category.value.id === c.id,
        onPick: () => pickCategory(c)
      })));

      const label = document.createElement('div');
      label.className = 'list-label';
      label.textContent = 'All categories';
      body.appendChild(label);
      D.CATEGORIES.filter(c => !suggestedIds.has(c.id)).forEach(c => body.appendChild(optionRow({
        name: c.name, icon: c.icon, tint: c.color + '1f',
        onPick: () => pickCategory(c)
      })));
    });
  }

  function openWhenSheet() {
    const d = state.draft;
    const a = state.analysis;
    const options = [];

    if (a && a.receipt && a.receipt.date) {
      options.push({ name: 'Printed on the receipt', date: a.receipt.date, why: a.receipt.dateRaw || '' });
    }
    if (a && a.exif && a.exif.capturedAt) {
      options.push({ name: 'When the photo was taken', date: a.exif.capturedAt, why: a.exif.model || 'EXIF DateTimeOriginal' });
    }
    options.push({ name: 'Now', date: now(), why: 'The default when nothing says otherwise' });

    openSheet('When was this?', 'Every timestamp the app could find', body => {
      options.forEach(o => body.appendChild(optionRow({
        name: o.name, icon: '🕑',
        why: relativeDay(o.date) + ' at ' + timeOfDay(o.date) + (o.why ? ' · ' + o.why : ''),
        selected: Math.abs(o.date - d.at.value) < 60000,
        onPick: () => pickTime(new Date(o.date))
      })));

      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:14px 20px 22px;';
      wrap.innerHTML = '<div class="field-label" style="margin-bottom:6px;">Or set it exactly</div>';
      const input = document.createElement('input');
      input.type = 'datetime-local';
      input.style.cssText = 'font-family:inherit;font-size:14px;padding:8px;border:1px solid #d9e0e6;border-radius:9px;width:100%;';
      const p = n => String(n).padStart(2, '0');
      const v = d.at.value;
      input.value = v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate()) +
        'T' + p(v.getHours()) + ':' + p(v.getMinutes());
      input.addEventListener('change', () => {
        const parsed = new Date(input.value);
        if (!isNaN(parsed)) pickTime(parsed);
      });
      wrap.appendChild(input);
      body.appendChild(wrap);
    });
  }

  /* ---------------- saving ---------------- */

  function saveTransaction() {
    const d = state.draft;
    if (d.amount.value == null) return;

    state.history.unshift({
      id: 'u' + Date.now(),
      merchantId: d.merchant.value.id,
      merchant: d.merchant.value.name,
      amount: Number(d.amount.value),
      category: d.category.value ? d.category.value.id : 'shopping',
      at: d.at.value.toISOString(),
      note: d.note.value || '',
      source: d.input,
      isNew: true
    });
    state.history.sort((a, b) => new Date(b.at) - new Date(a.at));

    state.savedCount++;
    state.entry = '';
    state.draft = null;
    renderEntry();
    renderHome();
    show('home');

    const taps = d.input === 'image' ? 'one photo' : 'four digits';
    toast('Saved from ' + taps + ' — ' + d.merchant.value.name + ', ' + money(d.amount.value));
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  /* ---------------- inspector ---------------- */

  function renderInspector() {
    renderSignalsTab();
    renderRankingTab();
    renderTextTab();
  }

  function num(v, dp) { return Number(v).toFixed(dp == null ? 3 : dp); }

  function renderSignalsTab() {
    const host = $('#tab-signals');
    const a = state.analysis;

    if (!a) {
      host.innerHTML = '<p class="insp-empty">No image in this entry — the draft came from the amount, ' +
        'the clock and your location. Try one of the sample photos to fill this in.</p>';
      return;
    }

    const f = a.features, c = a.classification;
    const rows = [
      ['aspect (h/w)', num(f.aspect, 2)],
      ['mean saturation', num(f.meanSat)],
      ['bright pixels', (f.brightRatio * 100).toFixed(1) + '%'],
      ['ink coverage', (f.inkRatio * 100).toFixed(1) + '%'],
      ['text-like lines', f.textLineCount],
      ['line regularity', num(f.lineRegularity)],
      ['quiet margins', num(f.marginRatio, 2)],
      ['edge density', num(f.edgeDensity)],
      ['sky score', num(f.skyScore)],
      ['centre − border sat.', num(f.centreSaturation - f.borderSaturation)],
      ['background uniformity', num(f.backgroundUniformity)]
    ];

    let html = '<div class="insp-section"><h5>Verdict</h5>' +
      '<table class="insp"><tbody>' +
      Object.entries(c.probabilities).sort((x, y) => y[1] - x[1]).map(([k, p]) =>
        '<tr' + (k === c.kind ? ' class="lead"' : '') + '><td>' + k + '</td>' +
        '<td style="width:45%"><span class="meter"><i style="width:' + (p * 100).toFixed(1) + '%"></i></span></td>' +
        '<td class="num">' + (p * 100).toFixed(1) + '%</td></tr>').join('') +
      '</tbody></table></div>';

    if (c.evidence.length) {
      html += '<div class="insp-section"><h5>Why</h5><table class="insp"><tbody>' +
        c.evidence.map(e => '<tr><td>' + escapeHtml(e.label) + '</td><td class="num">' +
          (e.value * 100).toFixed(0) + '%</td></tr>').join('') +
        '</tbody></table></div>';
    }

    html += '<div class="insp-section"><h5>Measurements</h5><table class="insp"><tbody>' +
      rows.map(r => '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td></tr>').join('') +
      '</tbody></table></div>';

    html += '<div class="insp-section"><h5>Dominant colours</h5><div class="swatches">' +
      f.dominant.map(d => '<span class="swatch" style="background:' + d.hex + '" title="' + d.hex + '">' +
        (d.share * 100).toFixed(0) + '%</span>').join('') + '</div></div>';

    if (a.palette.length) {
      html += '<div class="insp-section"><h5>Brand palette match</h5><table class="insp"><tbody>' +
        a.palette.map(p => '<tr><td>' + escapeHtml(p.merchant.name) +
          ' <span class="swatch" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;background:' +
          p.match.brand.hex + '"></span></td><td class="num">' + num(p.score, 2) + '</td></tr>').join('') +
        '</tbody></table></div>';
    }

    if (a.exif) {
      const bits = [];
      if (a.exif.capturedAt) bits.push(['DateTimeOriginal', a.exif.capturedAt.toLocaleString('en-US')]);
      if (a.exif.gps) bits.push(['GPS', a.exif.gps.lat.toFixed(5) + ', ' + a.exif.gps.lng.toFixed(5)]);
      if (a.exif.make) bits.push(['Make', a.exif.make]);
      if (a.exif.model) bits.push(['Model', a.exif.model]);
      if (bits.length) {
        html += '<div class="insp-section"><h5>EXIF</h5><table class="insp"><tbody>' +
          bits.map(b => '<tr><td>' + b[0] + '</td><td class="num">' + escapeHtml(b[1]) + '</td></tr>').join('') +
          '</tbody></table></div>';
      }
    }

    host.innerHTML = html;
  }

  function renderRankingTab() {
    const host = $('#tab-ranking');
    const d = state.draft;
    if (!d) { host.innerHTML = '<p class="insp-empty">Nothing ranked yet.</p>'; return; }

    const rows = d.trace.ranked.map(c =>
      '<tr' + (c === d.trace.ranked[0] ? ' class="lead"' : '') + '>' +
      '<td>' + escapeHtml(c.merchant.name) + '</td>' +
      '<td class="num">' + num(c.parts.prior, 2) + '</td>' +
      '<td class="num">' + num(c.parts.amount || 0, 2) + '</td>' +
      '<td class="num">' + num(c.parts.time || 0, 2) + '</td>' +
      '<td class="num">' + num(c.parts.location || 0, 2) + '</td>' +
      '<td class="num">' + (c.parts.image ? num(c.parts.image, 2) : '—') + '</td>' +
      '<td class="num">' + (c.probability * 100).toFixed(1) + '%</td></tr>').join('');

    const catRows = [{ category: d.trace.category.category, score: d.trace.category.confidence }]
      .concat(d.trace.category.alternates.map(a => ({ category: a.category, score: a.probability })))
      .filter(r => r.category)
      .map(r => '<tr><td>' + r.category.icon + ' ' + escapeHtml(r.category.name) + '</td>' +
        '<td style="width:45%"><span class="meter"><i style="width:' + (r.score * 100).toFixed(1) + '%"></i></span></td>' +
        '<td class="num">' + (r.score * 100).toFixed(0) + '%</td></tr>').join('');

    host.innerHTML =
      '<div class="insp-section"><h5>Merchant — log-likelihood contributions</h5>' +
      '<table class="insp"><thead><tr><th>Merchant</th><th style="text-align:right">prior</th>' +
      '<th style="text-align:right">amt</th><th style="text-align:right">time</th>' +
      '<th style="text-align:right">loc</th><th style="text-align:right">img</th>' +
      '<th style="text-align:right">P</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;color:#8b9aa8;margin-top:7px;line-height:1.5;">' +
      'Columns are log-probabilities, so 0 means “no evidence either way” and more negative means ' +
      '“this merchant explains the observation worse”. The final column is the softmax over their sum.</p></div>' +
      '<div class="insp-section"><h5>Category</h5><table class="insp"><tbody>' + catRows + '</tbody></table></div>' +
      (d.reasons.length ? '<div class="insp-section"><h5>Reasons surfaced to the user</h5><table class="insp"><tbody>' +
        d.reasons.map(r => '<tr><td>' + escapeHtml(r.text) + '</td><td class="num">' + r.kind + '</td></tr>').join('') +
        '</tbody></table></div>' : '');
  }

  function renderTextTab() {
    const host = $('#tab-text');
    const a = state.analysis;

    if (!a) { host.innerHTML = '<p class="insp-empty">No image in this entry.</p>'; return; }
    if (a.ocrError) {
      host.innerHTML = '<p class="insp-empty">Text recognition did not run: ' + escapeHtml(a.ocrError) +
        '. The draft was built from the picture, the metadata and your context instead.</p>';
      return;
    }
    if (!a.ocr) { host.innerHTML = '<p class="insp-empty">No text worth reading in this picture.</p>'; return; }

    let html = '';
    const r = a.receipt;
    if (r) {
      const fields = [
        ['total', r.total != null ? money(r.total) : '—'],
        ['subtotal', r.subtotal != null ? money(r.subtotal) : '—'],
        ['tax', r.tax != null ? money(r.tax) : '—'],
        ['tip', r.tip != null ? money(r.tip) : '—'],
        ['date', r.date ? r.date.toLocaleString('en-US') : '—'],
        ['payment', r.payment || '—'],
        ['line items', r.items.length]
      ];
      html += '<div class="insp-section"><h5>Parsed</h5><table class="insp"><tbody>' +
        fields.map(f => '<tr><td>' + f[0] + '</td><td class="num">' + escapeHtml(String(f[1])) + '</td></tr>').join('') +
        '</tbody></table></div>';

      if (r.items.length) {
        html += '<div class="insp-section"><h5>Line items</h5><table class="insp"><tbody>' +
          r.items.map(i => '<tr><td>' + escapeHtml(i.label) + '</td><td class="num">' + money(i.price) + '</td></tr>').join('') +
          '</tbody></table></div>';
      }
    }

    if (a.textMerchants.length) {
      html += '<div class="insp-section"><h5>Merchant names found</h5><table class="insp"><tbody>' +
        a.textMerchants.slice(0, 5).map(m => '<tr><td>' + escapeHtml(m.merchant.name) + '<br>' +
          '<span style="color:#8b9aa8">' + escapeHtml(m.how || '') + '</span></td>' +
          '<td class="num">' + num(m.score, 2) + '</td></tr>').join('') +
        '</tbody></table></div>';
    }

    html += '<div class="insp-section"><h5>Raw OCR output</h5><pre class="ocr">' +
      escapeHtml(a.ocr.text.trim() || '(nothing)') + '</pre></div>';

    host.innerHTML = html;
  }

  /* ---------------- capture screen ---------------- */

  function renderSamples() {
    const grid = $('#sample-grid');
    grid.innerHTML = '';
    window.Samples.SAMPLES.forEach(s => {
      const b = document.createElement('button');
      b.className = 'sample';
      b.innerHTML =
        '<span class="sample-thumb" data-thumb="' + s.id + '">📷</span>' +
        '<span class="sample-body"><span class="sample-title"></span>' +
        '<span class="sample-blurb"></span></span>';
      b.querySelector('.sample-title').textContent = s.title;
      b.querySelector('.sample-blurb').textContent = s.blurb;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const loaded = await window.Samples.loadSample(s.id);
          await runImageFlow(loaded.image, loaded.buffer, s.title);
        } catch (err) {
          toast('Could not build that sample: ' + err.message);
          show('capture');
        } finally {
          b.disabled = false;
        }
      });
      grid.appendChild(b);

      // Draw the thumbnail lazily so the four canvases are not built up front.
      window.Samples.loadSample(s.id).then(loaded => {
        const thumb = grid.querySelector('[data-thumb="' + s.id + '"]');
        if (thumb) { thumb.style.backgroundImage = 'url(' + loaded.url + ')'; thumb.textContent = ''; }
      }).catch(() => {});
    });
  }

  async function handleFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('That is not an image file.'); return; }
    try {
      const buffer = await file.arrayBuffer();
      const url = URL.createObjectURL(file);
      const image = await window.Vision.loadImageFromUrl(url);
      await runImageFlow(image, buffer, file.name);
    } catch (err) {
      toast('Could not read that image: ' + err.message);
      show('capture');
    }
  }

  /* ---------------- context controls ---------------- */

  function renderContextControls() {
    const select = $('#location-select');
    select.innerHTML = '';
    D.LOCATIONS.forEach(l => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.label;
      select.appendChild(o);
    });
    select.value = state.location.id;

    select.addEventListener('change', () => {
      state.location = D.LOCATIONS.find(l => l.id === select.value);
      updateContextFoot();
    });

    const time = $('#time-input');
    time.addEventListener('change', () => {
      if (!time.value) { state.clockOffset = null; }
      else {
        const parsed = new Date(time.value);
        state.clockOffset = isNaN(parsed) ? null : parsed.getTime() - Date.now();
      }
      renderHome();
      updateContextFoot();
    });

    $('#reset-learning').addEventListener('click', () => {
      window.Infer.clearOverrides();
      toast('Forgot every category correction.');
      updateContextFoot();
    });

    updateContextFoot();
  }

  function updateContextFoot() {
    const overrides = window.Infer.loadOverrides();
    const n = Object.keys(overrides).length;
    const nearby = state.location.lat == null ? [] : D.MERCHANTS
      .filter(m => !m.online)
      .map(m => ({ m, d: window.Infer.haversineMiles(currentLocation(), m.geo) }))
      .filter(x => x.d < 0.35)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);

    $('#context-foot').innerHTML = (state.location.lat == null
      ? 'With location off, the merchant guess falls back to your habits and the clock alone — a useful thing to compare against.'
      : 'Within a few minutes’ walk: ' + (nearby.length
        ? nearby.map(x => escapeHtml(x.m.name) + ' (' + window.Infer.formatDistance(x.d) + ')').join(', ')
        : 'nothing the app knows about') + '.') +
      (n ? ' <strong>' + n + '</strong> learned category correction' + (n === 1 ? '' : 's') + ' stored.' : '');
  }

  /* ---------------- wiring ---------------- */

  function init() {
    renderHome();
    renderEntry();
    renderSamples();
    renderContextControls();
    renderInspector();

    $$('.key').forEach(k => k.addEventListener('click', () => pressKey(k.dataset.key)));
    $('#btn-add').addEventListener('click', runAmountFlow);
    $('#btn-camera').addEventListener('click', () => { show('capture'); });
    $('#btn-capture-back').addEventListener('click', () => show('home'));
    $('#btn-cancel').addEventListener('click', () => { state.draft = null; show('home'); });
    $('#btn-save').addEventListener('click', saveTransaction);

    $('#field-merchant').addEventListener('click', openMerchantSheet);
    $('#field-category').addEventListener('click', openCategorySheet);
    $('#field-when').addEventListener('click', openWhenSheet);
    $('#sheet-backdrop').addEventListener('click', closeSheet);
    $('#sheet-close').addEventListener('click', closeSheet);

    $('#review-amount').addEventListener('input', e => {
      const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
      state.draft.amount = {
        value: isNaN(v) ? null : v, confidence: 1, source: 'you', why: 'You typed it'
      };
      $('#btn-save').disabled = isNaN(v) || v <= 0;
      $('#amount-why').innerHTML = '<span class="pill pill-flat">you entered it</span>';
      e.target.classList.toggle('missing', isNaN(v));
    });

    $('#note-input').addEventListener('input', e => {
      state.draft.note = { value: e.target.value, confidence: 1, source: 'you' };
    });

    const upload = $('#upload-zone');
    const fileInput = $('#file-input');
    upload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => upload.addEventListener(ev, e => {
      e.preventDefault(); upload.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach(ev => upload.addEventListener(ev, e => {
      e.preventDefault(); upload.classList.remove('drag');
    }));
    upload.addEventListener('drop', e => {
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
    }));

    setInterval(() => { $('#clock').textContent = timeOfDay(now()); }, 20000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
