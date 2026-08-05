/* Campsite Search — client-side search over a locally harvested freecampsites
   dataset. Everything runs in memory: no server, no network after load. */

(() => {
  'use strict';

  const PAGE = 60;              // results rendered per chunk
  const MAX_MARKERS = 4000;     // beyond this the map stops being readable anyway
  const AMENITIES = ['toilets', 'water', 'trash', 'showers', 'picnicTables', 'fireRings', 'pets', 'rv'];

  const $ = (id) => document.getElementById(id);

  let SITES = [];
  let META = {};
  let results = [];
  let shown = PAGE;
  let activeId = null;
  let map = null, markerLayer = null, pinMarker = null, renderer = null;
  const markersById = new Map();

  const state = {
    q: '', freeOnly: false, maxPrice: null, minRating: 0, minReviews: 0,
    reviewedSince: '', amenities: new Set(), carrier: '', minBars: 0,
    elevMin: null, elevMax: null, minStay: 0, stateCode: '', type: '',
    pin: null, radius: null, sort: 'relevance', bboxOnly: false,
  };

  // ------------------------------------------------------------ data load

  async function boot() {
    initMap();
    wireControls();
    readUrl();

    try {
      const res = await fetch('data/campsites.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      adopt(await res.json(), 'harvested dataset');
      $('loader').hidden = true;
    } catch {
      // file:// or no dataset yet — let the user pick one by hand.
      $('loader').hidden = false;
      $('status').textContent = 'no dataset';
      $('status').classList.add('warn');
    }
  }

  function adopt(payload, label) {
    const sites = Array.isArray(payload) ? payload : payload.sites ?? [];
    META = (Array.isArray(payload) ? {} : payload.meta) ?? {};
    SITES = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    for (const s of SITES) {
      if (!s.search) {
        s.search = [s.name, s.city, s.state, s.type, s.agency, s.description]
          .filter(Boolean).join(' ').toLowerCase();
      }
      s.amenities ??= {};
      s.cell ??= {};
    }
    populateSelect($('state'), Object.keys(META.states ?? tallyOf('state')), 'all states');
    populateSelect($('type'), Object.keys(META.types ?? tallyOf('type')), 'all types');
    $('status').textContent = `${SITES.length.toLocaleString()} sites · ${label}`;
    $('status').classList.toggle('warn', label.startsWith('sample'));
    if (SITES.length && map) fitTo(SITES);
    apply();
  }

  function tallyOf(key) {
    const counts = {};
    for (const s of SITES) if (s[key]) counts[s[key]] = (counts[s[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
  }

  function populateSelect(sel, values, allLabel) {
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }

  // -------------------------------------------------------------- filters

  function apply() {
    const q = state.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const bounds = state.bboxOnly && map ? map.getBounds() : null;
    const sinceTs = state.reviewedSince
      ? Date.now() - Number(state.reviewedSince) * 86400000
      : null;

    const out = [];
    for (const s of SITES) {
      if (terms.length && !terms.every((t) => s.search.includes(t))) continue;
      if (state.freeOnly && s.free !== true) continue;
      if (state.maxPrice != null) {
        // A site with no price but flagged free counts as $0. Unknown-and-not-free
        // can't be shown to satisfy a price cap, so it drops out.
        const effective = s.price != null ? s.price : s.free === true ? 0 : null;
        if (effective == null || effective > state.maxPrice) continue;
      }
      if (state.minRating > 0 && !(s.rating >= state.minRating)) continue;
      if (state.minReviews > 0 && !(s.reviewCount >= state.minReviews)) continue;
      if (sinceTs && !(s.lastReviewed && Date.parse(s.lastReviewed) >= sinceTs)) continue;
      if (state.minStay > 0 && !(s.maxStay >= state.minStay)) continue;
      if (state.stateCode && s.state !== state.stateCode) continue;
      if (state.type && s.type !== state.type) continue;
      if (state.elevMin != null && !(s.elevation >= state.elevMin)) continue;
      if (state.elevMax != null && !(s.elevation <= state.elevMax)) continue;

      let amenityOk = true;
      for (const a of state.amenities) if (s.amenities[a] !== true) { amenityOk = false; break; }
      if (!amenityOk) continue;

      if (state.carrier && state.minBars > 0 && !(s.cell[state.carrier] >= state.minBars)) continue;

      if (state.pin) {
        s._dist = haversine(state.pin.lat, state.pin.lng, s.lat, s.lng);
        if (state.radius != null && s._dist > state.radius) continue;
      } else {
        s._dist = null;
      }

      if (bounds && !bounds.contains([s.lat, s.lng])) continue;

      s._score = terms.length ? relevance(s, terms) : 0;
      out.push(s);
    }

    results = sortResults(out);
    shown = PAGE;
    renderList();
    renderMarkers();
    writeUrl();
    $('count').textContent = `${results.length.toLocaleString()} of ${SITES.length.toLocaleString()}`;
  }

  function relevance(s, terms) {
    let score = 0;
    const name = (s.name ?? '').toLowerCase();
    for (const t of terms) {
      if (name.startsWith(t)) score += 60;
      else if (name.includes(t)) score += 40;
      if ((s.city ?? '').toLowerCase().includes(t)) score += 15;
      if ((s.state ?? '').toLowerCase() === t) score += 10;
    }
    // Well-reviewed sites break ties — a 4.8 with 30 reviews beats a lone 5.0.
    if (s.rating) score += s.rating * 2;
    if (s.reviewCount) score += Math.min(10, Math.log10(s.reviewCount + 1) * 6);
    return score;
  }

  function sortResults(list) {
    // Descending sorts push unknowns down with -Infinity; ascending sorts need
    // +Infinity so "no elevation recorded" doesn't win "lowest".
    const nullsLast = (v) => (v == null || Number.isNaN(v) ? -Infinity : v);
    const nullsHigh = (v) => (v == null || Number.isNaN(v) ? Infinity : v);
    const cmp = {
      relevance: (a, b) => b._score - a._score,
      rating: (a, b) => nullsLast(b.rating) - nullsLast(a.rating) || nullsLast(b.reviewCount) - nullsLast(a.reviewCount),
      reviews: (a, b) => nullsLast(b.reviewCount) - nullsLast(a.reviewCount),
      recent: (a, b) => (Date.parse(b.lastReviewed) || 0) - (Date.parse(a.lastReviewed) || 0),
      'elevation-desc': (a, b) => nullsLast(b.elevation) - nullsLast(a.elevation),
      'elevation-asc': (a, b) => nullsHigh(a.elevation) - nullsHigh(b.elevation),
      price: (a, b) => (a.price ?? (a.free ? 0 : Infinity)) - (b.price ?? (b.free ? 0 : Infinity)),
      distance: (a, b) => (a._dist ?? Infinity) - (b._dist ?? Infinity),
    }[state.sort];
    return list.sort(cmp ?? cmp0);
  }
  const cmp0 = () => 0;

  // ------------------------------------------------------------ rendering

  function renderList() {
    const list = $('result-list');
    const empty = $('empty');

    if (!results.length) {
      list.innerHTML = '';
      empty.hidden = false;
      empty.textContent = SITES.length
        ? 'No sites match these filters. Loosen something on the left.'
        : 'No data loaded.';
      $('show-more').hidden = true;
      return;
    }
    empty.hidden = true;

    const terms = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    list.innerHTML = results.slice(0, shown).map((s) => card(s, terms)).join('');
    $('show-more').hidden = results.length <= shown;
    $('show-more').textContent = `Show ${Math.min(PAGE, results.length - shown)} more of ${(results.length - shown).toLocaleString()}`;
  }

  function card(s, terms) {
    const bits = [];
    if (s.state) bits.push(esc([s.city, s.state].filter(Boolean).join(', ')));
    if (s.rating) bits.push(`<span class="stars">${stars(s.rating)}</span> ${s.rating.toFixed(1)}${s.reviewCount ? ` (${s.reviewCount})` : ''}`);
    if (s.elevation != null) bits.push(`${Math.round(s.elevation).toLocaleString()} ft`);
    if (s._dist != null) bits.push(`${s._dist.toFixed(0)} mi`);
    if (s.maxStay) bits.push(`${s.maxStay}-night limit`);

    const price = s.free === true
      ? '<span class="result-price free">Free</span>'
      : s.price != null
        ? `<span class="result-price paid">$${s.price}</span>`
        : '';

    const snippet = s.description
      ? `<p class="result-snippet">${highlight(clip(s.description, 190), terms)}</p>`
      : '';

    return `<li class="result${s.id === activeId ? ' active' : ''}" data-id="${esc(s.id)}">
      <div class="result-top"><h3>${highlight(s.name, terms)}</h3>${price}</div>
      <div class="result-meta">${bits.map((b) => `<span>${b}</span>`).join('')}</div>
      ${snippet}
    </li>`;
  }

  function renderMarkers() {
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    markersById.clear();

    const subset = results.slice(0, MAX_MARKERS);
    for (const s of subset) {
      const m = L.circleMarker([s.lat, s.lng], {
        renderer,
        radius: 5,
        weight: 1.5,
        color: '#fff',
        fillColor: s.free === true ? '#2e7d4f' : '#2a6496',
        fillOpacity: 0.9,
      });
      m.on('click', () => select(s.id, { pan: false }));
      m.bindTooltip(s.name, { direction: 'top', offset: [0, -6] });
      m.addTo(markerLayer);
      markersById.set(s.id, m);
    }

    const note = $('map-note');
    if (results.length > MAX_MARKERS) {
      note.hidden = false;
      note.textContent = `Showing the first ${MAX_MARKERS.toLocaleString()} of ${results.length.toLocaleString()} matches. Zoom in or filter further.`;
    } else {
      note.hidden = true;
    }
  }

  // --------------------------------------------------------------- detail

  function select(id, { pan = true } = {}) {
    activeId = id;
    const s = SITES.find((x) => x.id === id);
    if (!s) return;

    document.querySelectorAll('.result').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === String(id));
    });
    const el = document.querySelector(`.result[data-id="${cssEsc(String(id))}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });

    if (map && pan) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 11), { animate: true });

    $('detail-body').innerHTML = detailHtml(s);
    $('detail').hidden = false;
  }

  function detailHtml(s) {
    const rows = [];
    const row = (k, v) => { if (v != null && v !== '') rows.push(`<tr><th>${k}</th><td>${v}</td></tr>`); };

    row('Cost', s.free === true ? 'Free' : s.price != null ? `$${s.price}/night` : null);
    row('Rating', s.rating ? `<span class="stars">${stars(s.rating)}</span> ${s.rating.toFixed(1)} from ${s.reviewCount ?? '?'} reviews` : null);
    row('Last reviewed', s.lastReviewed);
    row('Elevation', s.elevation != null ? `${Math.round(s.elevation).toLocaleString()} ft` : null);
    row('Sites', s.siteCount);
    row('Stay limit', s.maxStay ? `${s.maxStay} nights` : null);
    row('Type', s.type);
    row('Managed by', s.agency);
    row('Road', s.roadCondition);
    row('Distance from pin', s._dist != null ? `${s._dist.toFixed(1)} mi` : null);

    const present = AMENITIES.filter((a) => s.amenities[a] === true);
    row('Amenities', present.length ? present.map(label).join(', ') : null);

    for (const [carrier, name] of [['verizon', 'Verizon'], ['att', 'AT&T'], ['tmobile', 'T-Mobile']]) {
      const bars = s.cell[carrier];
      if (bars != null) row(name, `${barsHtml(bars)} ${bars}/4`);
    }
    row('Coordinates', `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`);

    const gmaps = `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
    const links = [
      s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">freecampsites page</a>` : '',
      `<a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a>`,
      `<a href="geo:${s.lat},${s.lng}">Open in maps app</a>`,
    ].filter(Boolean).join('');

    return `
      <h2>${esc(s.name)}</h2>
      <div class="detail-sub">${esc([s.city, s.state].filter(Boolean).join(', ')) || 'Location unknown'}</div>
      ${s.description ? `<p class="detail-desc">${esc(s.description)}</p>` : ''}
      <table class="kv">${rows.join('')}</table>
      <div class="detail-actions">${links}</div>`;
  }

  const barsHtml = (n) =>
    `<span class="bars">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

  const label = (a) => ({
    toilets: 'Toilets', water: 'Water', trash: 'Trash', showers: 'Showers',
    picnicTables: 'Picnic tables', fireRings: 'Fire rings', pets: 'Pets OK', rv: 'RV access',
  }[a] ?? a);

  // ------------------------------------------------------------------ map

  function initMap() {
    if (typeof L === 'undefined') {
      $('map-note').hidden = false;
      $('map-note').textContent = 'Leaflet failed to load — list and filters still work.';
      return;
    }
    map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([39.5, -111], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    renderer = L.canvas({ padding: 0.4 });
    markerLayer = L.layerGroup().addTo(map);

    map.on('click', (e) => {
      if (!e.originalEvent.shiftKey) return;
      setPin(e.latlng.lat, e.latlng.lng);
    });
    map.on('moveend', () => { if (state.bboxOnly) apply(); });
  }

  function setPin(lat, lng) {
    state.pin = { lat, lng };
    if (pinMarker) map.removeLayer(pinMarker);
    pinMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: '<div class="pin-marker"></div>', iconSize: [14, 14] }),
    }).addTo(map);
    $('pin-hint').textContent = `Pin at ${lat.toFixed(3)}, ${lng.toFixed(3)}. Sort by "Nearest to pin" to use it.`;
    $('clear-pin').hidden = false;
    apply();
  }

  function clearPin() {
    state.pin = null;
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    $('pin-hint').textContent = 'Shift-click the map to drop a pin, then filter and sort by distance from it.';
    $('clear-pin').hidden = true;
    apply();
  }

  function fitTo(sites) {
    const lats = sites.map((s) => s.lat), lngs = sites.map((s) => s.lng);
    map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [20, 20] });
  }

  // ------------------------------------------------------------- controls

  function wireControls() {
    const debounced = debounce(apply, 180);

    $('q').addEventListener('input', (e) => {
      state.q = e.target.value;
      $('clear-q').hidden = !state.q;
      debounced();
    });
    $('clear-q').addEventListener('click', () => {
      state.q = ''; $('q').value = ''; $('clear-q').hidden = true; apply(); $('q').focus();
    });

    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
    $('bbox-only').addEventListener('change', (e) => { state.bboxOnly = e.target.checked; apply(); });
    $('free-only').addEventListener('change', (e) => { state.freeOnly = e.target.checked; apply(); });

    bindRange('max-price', (v) => {
      state.maxPrice = v >= 60 ? null : v;
      return state.maxPrice == null ? 'any' : `$${v}`;
    });
    bindRange('min-rating', (v) => { state.minRating = v; return v === 0 ? 'any' : `${v}+`; });
    bindRange('min-reviews', (v) => { state.minReviews = v; return v === 0 ? 'any' : `${v}+`; });
    bindRange('min-bars', (v) => { state.minBars = v; return v === 0 ? 'any' : `${v}+`; });
    bindRange('min-stay', (v) => { state.minStay = v; return v === 0 ? 'any' : `${v}+`; });
    bindRange('radius', (v) => {
      state.radius = v >= 500 ? null : v;
      return state.radius == null ? 'any' : `${v} mi`;
    });

    $('reviewed-since').addEventListener('change', (e) => { state.reviewedSince = e.target.value; apply(); });
    $('carrier').addEventListener('change', (e) => { state.carrier = e.target.value; apply(); });
    $('state').addEventListener('change', (e) => { state.stateCode = e.target.value; apply(); });
    $('type').addEventListener('change', (e) => { state.type = e.target.value; apply(); });

    $('elev-min').addEventListener('input', debounce((e) => {
      state.elevMin = e.target.value === '' ? null : Number(e.target.value); apply();
    }, 250));
    $('elev-max').addEventListener('input', debounce((e) => {
      state.elevMax = e.target.value === '' ? null : Number(e.target.value); apply();
    }, 250));

    $('amenity-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const a = chip.dataset.amenity;
      if (state.amenities.has(a)) state.amenities.delete(a); else state.amenities.add(a);
      chip.classList.toggle('on');
      apply();
    });

    $('result-list').addEventListener('click', (e) => {
      const li = e.target.closest('.result');
      if (li) select(li.dataset.id);
    });
    $('result-list').addEventListener('mouseover', (e) => {
      const li = e.target.closest('.result');
      const m = li && markersById.get(li.dataset.id);
      if (m) m.setStyle({ radius: 8, weight: 2.5 });
    });
    $('result-list').addEventListener('mouseout', (e) => {
      const li = e.target.closest('.result');
      const m = li && markersById.get(li.dataset.id);
      if (m) m.setStyle({ radius: 5, weight: 1.5 });
    });

    $('show-more').addEventListener('click', () => { shown += PAGE; renderList(); });
    $('detail-close').addEventListener('click', () => { $('detail').hidden = true; });
    $('clear-pin').addEventListener('click', clearPin);
    $('reset').addEventListener('click', resetFilters);

    $('file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      adopt(JSON.parse(await file.text()), file.name);
      $('loader').hidden = true;
    });
    $('load-sample').addEventListener('click', async () => {
      try {
        const res = await fetch('data/sample.json');
        adopt(await res.json(), 'sample data — not real listings');
        $('loader').hidden = true;
      } catch {
        alert('Could not load data/sample.json. Serve this folder over http (npx serve) rather than opening the file directly.');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
      if (e.key === 'Escape') { $('detail').hidden = true; }
      if ((e.key === 'j' || e.key === 'k') && document.activeElement.tagName !== 'INPUT') {
        const i = results.findIndex((s) => s.id === activeId);
        const next = e.key === 'j' ? Math.min(i + 1, results.length - 1) : Math.max(i - 1, 0);
        if (results[next]) {
          if (next >= shown) { shown += PAGE; renderList(); }
          select(results[next].id, { pan: false });
        }
      }
    });
  }

  function bindRange(id, onChange) {
    const input = $(id);
    const out = $(`${id}-out`);
    const update = () => { out.textContent = onChange(Number(input.value)); };
    input.addEventListener('input', () => { update(); });
    input.addEventListener('change', apply);
    update();
  }

  function resetFilters() {
    Object.assign(state, {
      q: '', freeOnly: false, maxPrice: null, minRating: 0, minReviews: 0,
      reviewedSince: '', amenities: new Set(), carrier: '', minBars: 0,
      elevMin: null, elevMax: null, minStay: 0, stateCode: '', type: '',
      radius: null, sort: 'relevance', bboxOnly: false,
    });
    $('q').value = ''; $('clear-q').hidden = true;
    $('free-only').checked = false; $('bbox-only').checked = false;
    $('sort').value = 'relevance'; $('reviewed-since').value = '';
    $('carrier').value = ''; $('state').value = ''; $('type').value = '';
    $('elev-min').value = ''; $('elev-max').value = '';
    for (const [id, v] of [['max-price', 60], ['min-rating', 0], ['min-reviews', 0], ['min-bars', 0], ['min-stay', 0], ['radius', 500]]) {
      $(id).value = v;
      $(id).dispatchEvent(new Event('input'));
    }
    document.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on'));
    apply();
  }

  // ---------------------------------------------------------- url syncing

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.freeOnly) p.set('free', '1');
    if (state.maxPrice != null) p.set('price', state.maxPrice);
    if (state.minRating) p.set('rating', state.minRating);
    if (state.minReviews) p.set('reviews', state.minReviews);
    if (state.reviewedSince) p.set('since', state.reviewedSince);
    if (state.amenities.size) p.set('am', [...state.amenities].join(','));
    if (state.carrier) p.set('carrier', state.carrier);
    if (state.minBars) p.set('bars', state.minBars);
    if (state.elevMin != null) p.set('elevmin', state.elevMin);
    if (state.elevMax != null) p.set('elevmax', state.elevMax);
    if (state.minStay) p.set('stay', state.minStay);
    if (state.stateCode) p.set('st', state.stateCode);
    if (state.type) p.set('type', state.type);
    if (state.sort !== 'relevance') p.set('sort', state.sort);
    if (state.pin) p.set('pin', `${state.pin.lat.toFixed(4)},${state.pin.lng.toFixed(4)}`);
    if (state.radius != null) p.set('radius', state.radius);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const setRange = (id, val) => { if (val != null) { $(id).value = val; $(id).dispatchEvent(new Event('input')); } };

    if (p.get('q')) { state.q = p.get('q'); $('q').value = state.q; $('clear-q').hidden = false; }
    if (p.get('free')) { state.freeOnly = true; $('free-only').checked = true; }
    setRange('max-price', p.get('price'));
    setRange('min-rating', p.get('rating'));
    setRange('min-reviews', p.get('reviews'));
    setRange('min-bars', p.get('bars'));
    setRange('min-stay', p.get('stay'));
    setRange('radius', p.get('radius'));
    if (p.get('since')) { state.reviewedSince = p.get('since'); $('reviewed-since').value = state.reviewedSince; }
    if (p.get('carrier')) { state.carrier = p.get('carrier'); $('carrier').value = state.carrier; }
    if (p.get('st')) { state.stateCode = p.get('st'); }
    if (p.get('type')) { state.type = p.get('type'); }
    if (p.get('elevmin')) { state.elevMin = Number(p.get('elevmin')); $('elev-min').value = state.elevMin; }
    if (p.get('elevmax')) { state.elevMax = Number(p.get('elevmax')); $('elev-max').value = state.elevMax; }
    if (p.get('sort')) { state.sort = p.get('sort'); $('sort').value = state.sort; }
    if (p.get('am')) {
      state.amenities = new Set(p.get('am').split(','));
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', state.amenities.has(c.dataset.amenity)));
    }
    if (p.get('pin')) {
      const [lat, lng] = p.get('pin').split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng) && map) setPin(lat, lng);
    }
    // state/type selects are populated after data loads; apply() re-reads them there.
    queueMicrotask(() => {
      if (state.stateCode) $('state').value = state.stateCode;
      if (state.type) $('type').value = state.type;
    });
  }

  // ---------------------------------------------------------------- utils

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 3958.8, toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function stars(r) {
    const full = Math.round(r);
    return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

  const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);

  function highlight(text, terms) {
    let html = esc(text);
    for (const t of terms) {
      if (t.length < 2) continue;
      html = html.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    }
    return html;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  boot();
})();
