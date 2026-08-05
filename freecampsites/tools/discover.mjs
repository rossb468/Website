#!/usr/bin/env node
/**
 * discover.mjs — reverse-engineer the data API behind a map-driven site.
 *
 * Drives freecampsites.net in a real browser, records every network exchange,
 * then works out which requests carry the campsite data and what their
 * parameter grammar looks like.
 *
 * Outputs into --out (default ./recon):
 *   network.har        full HAR, openable in Chrome DevTools
 *   endpoints.json     machine-readable contract, consumed by harvest.mjs
 *   REPORT.md          human-readable findings
 *   samples/*.json     raw response bodies for the top candidates
 *
 * Usage:
 *   node tools/discover.mjs
 *   node tools/discover.mjs --headed --place "Moab, Utah"
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchChromium } from './lib/browser.mjs';

const argv = parseArgs(process.argv.slice(2));
const TARGET = argv.url ?? 'https://freecampsites.net/';
const OUT = resolve(argv.out ?? 'recon');
const PLACE = argv.place ?? 'Moab, Utah';
const HEADED = Boolean(argv.headed);
const NAV_TIMEOUT = Number(argv.timeout ?? 45000);
const BODY_CAP = 4 * 1024 * 1024;

// A request has to look like data, not chrome. Tiles and analytics are noise.
const NOISE = /(google-analytics|googletagmanager|doubleclick|facebook\.|hotjar|sentry|cloudflareinsights|adservice|gstatic\.com\/.*\.(png|gif)|tile\.|tiles?\/\d+\/\d+\/\d+)/i;
const TEXTUAL = /(json|javascript|ecmascript|text\/html|text\/plain|xml)/i;

const LAT_KEY = /^(lat|latitude|y|lat_?deg|lattitude)$/i;
const LNG_KEY = /^(lng|lon|lng_?deg|long|longitude|x)$/i;
const NAME_KEY = /^(name|title|site_?name|label|campsite_?name)$/i;
const ID_KEY = /^(id|_id|site_?id|uid|uuid|slug|permalink)$/i;
const DATAISH_PATH = /(api|rest|ajax|graphql|search|find|query|sites?|camp|marker|location|listing|feed|wp-json)/i;

const log = (...a) => console.log('•', ...a);
const warn = (...a) => console.log('!', ...a);

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'samples'), { recursive: true });

  const browser = await launchChromium({ headless: !HEADED });
  const context = await browser.newContext({
    recordHar: { path: join(OUT, 'network.har'), content: 'embed' },
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  /** @type {Array<object>} */
  const captures = [];
  const pending = new Set();

  context.on('response', (response) => {
    const p = capture(response, captures).catch(() => {});
    pending.add(p);
    p.finally(() => pending.delete(p));
  });

  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const steps = [];
  const run = async (label, fn) => {
    try {
      await fn();
      steps.push({ label, ok: true });
      log(`${label} — ok`);
    } catch (err) {
      steps.push({ label, ok: false, error: String(err).split('\n')[0] });
      warn(`${label} — ${String(err).split('\n')[0]}`);
    }
    await page.waitForTimeout(1200);
  };

  await run('load home page', async () => {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await settle(page);
  });

  await run('dismiss consent/overlay', () => dismissOverlays(page));

  await run(`search for "${PLACE}"`, () => runSearch(page, PLACE));

  await run('exercise the map (pan + zoom)', () => exerciseMap(page));

  await run('open a result / marker', () => openFirstResult(page));

  await run('probe well-known paths', () => probePaths(page, TARGET, captures));

  // Let any trailing XHRs land before we tear the context down.
  await page.waitForTimeout(2500);
  await Promise.allSettled([...pending]);

  await page.screenshot({ path: join(OUT, 'final-state.png'), fullPage: false }).catch(() => {});
  await context.close(); // flushes the HAR
  await browser.close();

  log(`captured ${captures.length} responses`);

  const analysis = analyze(captures);
  await writeSamples(analysis.candidates);

  await writeFile(
    join(OUT, 'endpoints.json'),
    JSON.stringify(buildContract(analysis, { target: TARGET, place: PLACE, steps }), null, 2)
  );
  await writeFile(join(OUT, 'REPORT.md'), renderReport(analysis, { target: TARGET, place: PLACE, steps }));

  console.log(`\nWrote ${OUT}/REPORT.md, endpoints.json, network.har`);
  if (analysis.candidates.length) {
    const top = analysis.candidates[0];
    console.log(`Top candidate: ${top.method} ${top.url}`);
    console.log(`  ${top.recordCount} records at "${top.recordPath}" (score ${top.score})`);
  } else {
    console.log('No JSON data endpoints scored above threshold — see REPORT.md ' +
      '"URL literals" and the HAR; the data may be server-rendered into HTML.');
  }
}

// ---------------------------------------------------------------- capture ---

async function capture(response, captures) {
  const request = response.request();
  const url = response.url();
  if (NOISE.test(url)) return;

  const type = request.resourceType();
  if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;

  const headers = await response.allHeaders().catch(() => ({}));
  const contentType = headers['content-type'] ?? '';
  if (contentType && !TEXTUAL.test(contentType)) return;

  let body = null;
  try {
    const buf = await response.body();
    if (buf.length <= BODY_CAP) body = buf.toString('utf8');
  } catch {
    /* body unavailable (redirect, cached, aborted) */
  }

  captures.push({
    method: request.method(),
    url,
    resourceType: type,
    status: response.status(),
    contentType,
    requestHeaders: sanitizeHeaders(await request.allHeaders().catch(() => ({}))),
    responseHeaders: headers,
    postData: request.postData() ?? null,
    body,
  });
}

function sanitizeHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(cookie|authorization|x-csrf|x-xsrf)/i.test(k)) out[k] = '<redacted, present>';
    else if (!/^(sec-|accept-encoding|user-agent|referer|origin)/i.test(k)) out[k] = v;
  }
  return out;
}

// ----------------------------------------------------------- interactions ---

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

async function dismissOverlays(page) {
  const patterns = [
    'button:has-text("Accept")', 'button:has-text("I agree")', 'button:has-text("Got it")',
    'button:has-text("Close")', '[aria-label="Close"]', '.cc-dismiss', '#onetrust-accept-btn-handler',
  ];
  for (const sel of patterns) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
    }
  }
}

async function findSearchInput(page) {
  const selectors = [
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="city" i]',
    'input[placeholder*="place" i]',
    'input[placeholder*="zip" i]',
    'input[name*="search" i]',
    'input[id*="search" i]',
    'form input[type="text"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 }).catch(() => false)) return el;
  }
  throw new Error('no search input found');
}

async function runSearch(page, place) {
  const input = await findSearchInput(page);
  await input.click();
  await input.fill('');
  // Type slowly — autocomplete endpoints only fire on real keystrokes.
  await input.type(place, { delay: 140 });
  await page.waitForTimeout(1500);
  await input.press('Enter');
  await settle(page);
}

async function findMap(page) {
  const selectors = ['.leaflet-container', '.gm-style', '#map', '.map', '[class*="map" i]', 'canvas'];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 300 && box.height > 200) return { el, box };
  }
  throw new Error('no map element found');
}

async function exerciseMap(page) {
  const { box } = await findMap(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Each pan/zoom should trigger a fresh viewport query. Varying the moves
  // lets the param-inference step see which values change and which are fixed.
  const moves = [
    { dx: -220, dy: 0 }, { dx: 0, dy: -180 }, { dx: 260, dy: 140 },
  ];
  for (const { dx, dy } of moves) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(1800);
  }

  for (const delta of [-240, -240, 360]) {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(1800);
  }
}

async function openFirstResult(page) {
  const before = page.url();
  const selectors = [
    '.leaflet-marker-icon', '[class*="marker" i]', '[class*="result" i] a',
    'a[href*="#!"]', 'a[href*="/site"]', 'a[href*="camp"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
      await el.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await settle(page);
      if (page.url() !== before) return;
    }
  }
  if (page.url() === before) throw new Error('no result/marker click changed the route');
}

/**
 * Light, polite probe of paths that commonly expose data. Runs in-page so it
 * inherits cookies and origin, and the responses land in the same recorder.
 */
async function probePaths(page, target, captures) {
  const origin = new URL(target).origin;
  const paths = [
    '/robots.txt', '/sitemap.xml', '/sitemap_index.xml',
    '/wp-json/', '/wp-json/wp/v2/types', '/api/', '/api/v1/', '/rest/',
  ];
  for (const p of paths) {
    const url = origin + p;
    try {
      const info = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        const text = await res.text();
        return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: text.slice(0, 200000) };
      }, url);
      captures.push({
        method: 'GET', url, resourceType: 'probe', status: info.status,
        contentType: info.contentType, requestHeaders: {}, responseHeaders: {},
        postData: null, body: info.body,
      });
    } catch {
      /* blocked by CORS or network — not informative */
    }
    await page.waitForTimeout(400);
  }
}

// ------------------------------------------------------------- analysis ----

function analyze(captures) {
  const candidates = [];
  const jsLiterals = new Set();

  for (const cap of captures) {
    if (!cap.body) continue;

    if (/javascript|ecmascript/i.test(cap.contentType) || /\.js(\?|$)/.test(cap.url)) {
      for (const lit of extractUrlLiterals(cap.body)) jsLiterals.add(lit);
      continue;
    }

    const json = tryParseJson(cap.body);
    if (!json) continue;

    const arrays = findRecordArrays(json);
    if (!arrays.length) {
      // Some APIs return a bare object for detail views — still worth scoring.
      const flat = flattenKeys(json);
      if (hasGeo(flat)) {
        candidates.push(makeCandidate(cap, json, { path: '$', length: 1, sample: [json] }));
      }
      continue;
    }
    for (const arr of arrays) candidates.push(makeCandidate(cap, json, arr));
  }

  const best = new Map();
  for (const c of candidates) {
    if (c.score < 30) continue;
    const key = `${c.method} ${stripQuery(c.url)} ${c.recordPath}`;
    const prev = best.get(key);
    if (!prev || c.score > prev.score) best.set(key, c);
  }

  return {
    candidates: [...best.values()].sort((a, b) => b.score - a.score),
    params: inferParams(captures),
    jsLiterals: [...jsLiterals].sort(),
    captures,
  };
}

function makeCandidate(cap, json, arr) {
  const sample = arr.sample[0] ?? {};
  const flat = flattenKeys(sample);
  const geo = hasGeo(flat);
  const named = Object.keys(flat).some((k) => NAME_KEY.test(leaf(k)));
  const ided = Object.keys(flat).some((k) => ID_KEY.test(leaf(k)));

  let score = 0;
  if (geo) score += 45;
  if (named) score += 18;
  if (ided) score += 12;
  if (arr.length >= 5) score += 12;
  score += Math.min(15, Math.round(Math.log10(Math.max(arr.length, 1)) * 12));
  if (DATAISH_PATH.test(new URL(cap.url).pathname)) score += 10;
  if (Object.keys(flat).length >= 6) score += 8;

  return {
    method: cap.method,
    url: cap.url,
    status: cap.status,
    contentType: cap.contentType,
    postData: cap.postData,
    requestHeaders: cap.requestHeaders,
    recordPath: arr.path,
    recordCount: arr.length,
    score,
    hasGeo: geo,
    fields: describeFields(arr.sample),
    sampleRecord: sample,
    rawBody: cap.body,
  };
}

function findRecordArrays(value, path = '$', out = [], depth = 0) {
  if (depth > 6 || out.length > 40) return out;
  if (Array.isArray(value)) {
    const objects = value.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (objects.length) out.push({ path, length: value.length, sample: objects.slice(0, 5) });
    if (value.length) findRecordArrays(value[0], `${path}[0]`, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findRecordArrays(v, `${path}.${k}`, out, depth + 1);
  }
  return out;
}

function flattenKeys(obj, prefix = '', out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out[key] = v;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, out, depth + 1);
  }
  return out;
}

const leaf = (k) => k.split('.').pop();

function hasGeo(flat) {
  const keys = Object.keys(flat);
  const lat = keys.some((k) => LAT_KEY.test(leaf(k)) && isNumeric(flat[k]));
  const lng = keys.some((k) => LNG_KEY.test(leaf(k)) && isNumeric(flat[k]));
  if (lat && lng) return true;
  // GeoJSON: coordinates: [lng, lat]
  return keys.some(
    (k) => /coordinates$/i.test(k) && Array.isArray(flat[k]) && flat[k].length >= 2 && flat[k].every(isNumeric)
  );
}

const isNumeric = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));

function describeFields(samples) {
  const fields = new Map();
  for (const s of samples) {
    for (const [k, v] of Object.entries(flattenKeys(s))) {
      if (!fields.has(k)) fields.set(k, { key: k, types: new Set(), example: undefined, present: 0 });
      const f = fields.get(k);
      f.types.add(Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
      f.present += 1;
      if (f.example === undefined && v !== null && v !== '') f.example = v;
    }
  }
  return [...fields.values()].map((f) => ({
    key: f.key,
    type: [...f.types].join('|'),
    example: truncate(f.example),
    presentIn: `${f.present}/${samples.length}`,
  }));
}

/**
 * Group requests by endpoint and diff their parameters. A param whose value
 * changes between calls is an input you control (bbox, zoom, page); one that
 * never changes is usually a key, version pin, or fixed config.
 */
function inferParams(captures) {
  const groups = new Map();
  for (const cap of captures) {
    let u;
    try { u = new URL(cap.url); } catch { continue; }
    if (!u.searchParams.size && !cap.postData) continue;

    const key = `${cap.method} ${u.origin}${u.pathname}`;
    if (!groups.has(key)) groups.set(key, { key, calls: 0, params: new Map(), bodies: [] });
    const g = groups.get(key);
    g.calls += 1;

    for (const [k, v] of u.searchParams) {
      if (!g.params.has(k)) g.params.set(k, new Set());
      g.params.get(k).add(v);
    }
    if (cap.postData) {
      g.bodies.push(cap.postData.slice(0, 2000));
      const parsed = tryParseJson(cap.postData);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(flattenKeys(parsed))) {
          if (typeof v === 'object') continue;
          const bk = `body:${k}`;
          if (!g.params.has(bk)) g.params.set(bk, new Set());
          g.params.get(bk).add(String(v));
        }
      }
    }
  }

  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      calls: g.calls,
      bodies: [...new Set(g.bodies)].slice(0, 3),
      params: [...g.params.entries()].map(([name, values]) => ({
        name,
        varies: values.size > 1,
        distinct: values.size,
        examples: [...values].slice(0, 4).map(truncate),
        role: guessParamRole(name, [...values]),
      })),
    }))
    .sort((a, b) => b.calls - a.calls);
}

function guessParamRole(name, values) {
  if (/^(body:)?(min_?lat|south|lat_?min|sw_?lat|bottom)/i.test(name)) return 'bbox.minLat';
  if (/^(body:)?(max_?lat|north|lat_?max|ne_?lat|top)/i.test(name)) return 'bbox.maxLat';
  if (/^(body:)?(min_?lng|min_?lon|west|lng_?min|sw_?lng|left)/i.test(name)) return 'bbox.minLng';
  if (/^(body:)?(max_?lng|max_?lon|east|lng_?max|ne_?lng|right)/i.test(name)) return 'bbox.maxLng';
  if (/bounds|bbox|viewport|envelope/i.test(name)) return 'bbox.combined';
  if (/^(body:)?(lat|latitude)$/i.test(name)) return 'center.lat';
  if (/^(body:)?(lng|lon|long|longitude)$/i.test(name)) return 'center.lng';
  if (/zoom|^z$/i.test(name)) return 'zoom';
  if (/radius|dist/i.test(name)) return 'radius';
  if (/page|offset|start|skip/i.test(name)) return 'paging';
  if (/limit|per_?page|count|size|max/i.test(name)) return 'limit';
  if (/key|token|auth|sig|nonce|_wpnonce/i.test(name)) return 'auth/key';
  if (/^(body:)?(q|query|term|search|keyword)$/i.test(name)) return 'text query';
  if (values.length === 1 && /^\d{10,}$/.test(values[0])) return 'cache-buster';
  return '';
}

function extractUrlLiterals(js) {
  const out = new Set();
  const patterns = [
    /["'`](\/(?:api|rest|ajax|wp-json|graphql|service|data|v\d)[A-Za-z0-9_\-./{}$:]*)["'`]/g,
    /["'`](https?:\/\/[A-Za-z0-9._-]*(?:freecampsites|api)[A-Za-z0-9._-]*\/[A-Za-z0-9_\-./{}$:]*)["'`]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(js)) !== null) {
      if (m[1].length > 4 && m[1].length < 200) out.add(m[1]);
    }
  }
  return out;
}

// -------------------------------------------------------------- outputs ----

function buildContract(analysis, meta) {
  const top = analysis.candidates[0] ?? null;
  const paramsFor = (url) => {
    if (!url) return null;
    const u = new URL(url);
    return analysis.params.find((p) => p.key.endsWith(`${u.origin}${u.pathname}`)) ?? null;
  };
  const group = paramsFor(top?.url);
  const bbox = {};
  for (const p of group?.params ?? []) {
    if (p.role.startsWith('bbox.') && p.role !== 'bbox.combined') bbox[p.role.slice(5)] = p.name;
  }

  return {
    generatedAt: new Date().toISOString(),
    target: meta.target,
    searchedPlace: meta.place,
    steps: meta.steps,
    primary: top && {
      method: top.method,
      url: top.url,
      urlTemplate: stripQuery(top.url),
      postData: top.postData,
      recordPath: top.recordPath,
      recordCount: top.recordCount,
      score: top.score,
      requestHeaders: top.requestHeaders,
      // harvest.mjs reads this to sweep bounding boxes; fill in by hand if empty.
      bboxParams: Object.keys(bbox).length === 4 ? bbox : null,
      params: group?.params ?? [],
      fields: top.fields,
    },
    alternates: analysis.candidates.slice(1, 8).map((c) => ({
      method: c.method, url: c.url, recordPath: c.recordPath,
      recordCount: c.recordCount, score: c.score,
    })),
    jsLiterals: analysis.jsLiterals,
  };
}

async function writeSamples(candidates) {
  for (const [i, c] of candidates.slice(0, 5).entries()) {
    const name = `${String(i).padStart(2, '0')}-${slug(new URL(c.url).pathname)}.json`;
    await writeFile(join(OUT, 'samples', name), c.rawBody).catch(() => {});
  }
}

function renderReport(analysis, meta) {
  const L = [];
  L.push('# freecampsites.net — network recon', '');
  L.push(`Target: \`${meta.target}\`  `);
  L.push(`Search term: \`${meta.place}\`  `);
  L.push(`Generated: ${new Date().toISOString()}`, '');

  L.push('## Interaction steps', '');
  for (const s of meta.steps) L.push(`- ${s.ok ? 'ok' : 'FAILED'} — ${s.label}${s.error ? ` (${s.error})` : ''}`);
  L.push('');
  if (meta.steps.some((s) => !s.ok)) {
    L.push('> Failed steps mean those code paths were never exercised, so their');
    L.push('> endpoints will be missing below. Re-run with `--headed` to watch, and');
    L.push('> adjust the selectors in `findSearchInput` / `findMap` if the markup moved.', '');
  }

  L.push('## Candidate data endpoints', '');
  if (!analysis.candidates.length) {
    L.push('None scored above threshold. Either the data is rendered server-side into');
    L.push('HTML, or the interaction steps did not reach it. Check `network.har` and the');
    L.push('URL literals below.', '');
  }
  for (const [i, c] of analysis.candidates.slice(0, 8).entries()) {
    L.push(`### ${i + 1}. \`${c.method} ${stripQuery(c.url)}\` — score ${c.score}`, '');
    L.push(`- Records: **${c.recordCount}** at \`${c.recordPath}\``);
    L.push(`- Status ${c.status}, \`${c.contentType}\``);
    L.push(`- Geo fields present: ${c.hasGeo ? 'yes' : 'no'}`);
    if (c.postData) L.push(`- POST body: \`${truncate(c.postData, 300)}\``);
    L.push('', '```bash', curlFor(c), '```', '');
    if (i === 0) {
      L.push('#### Response fields', '', '| field | type | example | present |', '|---|---|---|---|');
      for (const f of c.fields.slice(0, 60)) {
        L.push(`| \`${f.key}\` | ${f.type} | ${mdCell(f.example)} | ${f.presentIn} |`);
      }
      L.push('');
    }
  }

  L.push('## Parameter grammar', '');
  L.push('Params that *vary* across calls are inputs you control. Params that stay');
  L.push('constant are usually keys, version pins, or fixed config.', '');
  for (const g of analysis.params.slice(0, 12)) {
    if (!g.params.length) continue;
    L.push(`### \`${g.key}\` — ${g.calls} call(s)`, '');
    L.push('| param | varies | distinct | examples | inferred role |', '|---|---|---|---|---|');
    for (const p of g.params) {
      L.push(`| \`${p.name}\` | ${p.varies ? 'yes' : 'no'} | ${p.distinct} | ${p.examples.map(mdCell).join(', ')} | ${p.role} |`);
    }
    L.push('');
    for (const b of g.bodies) L.push('```json', b, '```', '');
  }

  L.push('## URL literals found in JavaScript bundles', '');
  L.push('Endpoints the app *can* call, including ones the scripted session never');
  L.push('triggered. Worth probing by hand.', '');
  if (analysis.jsLiterals.length) {
    L.push('```');
    for (const s of analysis.jsLiterals.slice(0, 200)) L.push(s);
    L.push('```', '');
  } else {
    L.push('_None found._', '');
  }

  L.push('## All captured responses', '', '| status | method | url | type |', '|---|---|---|---|');
  for (const c of analysis.captures.slice(0, 250)) {
    L.push(`| ${c.status} | ${c.method} | ${mdCell(truncate(c.url, 120))} | ${c.contentType.split(';')[0]} |`);
  }
  L.push('');
  return L.join('\n');
}

function curlFor(c) {
  const parts = [`curl -s '${c.url}'`];
  for (const [k, v] of Object.entries(c.requestHeaders)) {
    if (/^(accept|content-type|x-requested-with|x-)/i.test(k)) parts.push(`  -H '${k}: ${v}'`);
  }
  if (c.postData) parts.push(`  --data-raw '${c.postData.replace(/'/g, `'\\''`).slice(0, 500)}'`);
  parts.push(`  | jq '${c.recordPath === '$' ? '.' : c.recordPath.replace(/^\$\./, '.')}'`);
  return parts.join(' \\\n');
}

// --------------------------------------------------------------- helpers ---

function tryParseJson(text) {
  const t = text.trim();
  if (!t || !/^[[{]/.test(t)) {
    // JSONP: cb({...})
    const m = t.match(/^[\w.$]+\s*\((.*)\)[;\s]*$/s);
    if (m) { try { return JSON.parse(m[1]); } catch { return null; } }
    return null;
  }
  try { return JSON.parse(t); } catch { return null; }
}

const stripQuery = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; } };
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'root';
const mdCell = (v) => '`' + String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ') + '`';

function truncate(v, n = 90) {
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

main().catch((err) => { console.error(err); process.exit(1); });
