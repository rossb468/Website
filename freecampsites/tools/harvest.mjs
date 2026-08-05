#!/usr/bin/env node
/**
 * harvest.mjs — pull the full dataset using the contract discover.mjs produced.
 *
 * Most map APIs cap results per viewport. This sweeps a region with a quadtree:
 * query a box, and if the response comes back at or near the cap, split it into
 * four and recurse. That gets you everything without needing to know the cap.
 *
 * Usage:
 *   node tools/harvest.mjs                       # CONUS, direct fetch
 *   node tools/harvest.mjs --via-browser         # replay through a real browser
 *   node tools/harvest.mjs --bbox 36,-114,42,-109 --rps 0.5
 *   node tools/harvest.mjs --resume
 *
 * Be a good citizen: --rps defaults to 1 request/second. Don't raise it much.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const argv = parseArgs(process.argv.slice(2));
const CONTRACT = resolve(argv.contract ?? 'recon/endpoints.json');
const OUT_DIR = resolve(argv.out ?? 'data');
const STATE_FILE = join(OUT_DIR, 'harvest-state.json');
const RPS = Number(argv.rps ?? 1);
const MAX_DEPTH = Number(argv['max-depth'] ?? 7);
const SPLIT_AT = argv['split-at'] ? Number(argv['split-at']) : null;
const VIA_BROWSER = Boolean(argv['via-browser']);
const RESUME = Boolean(argv.resume);

// Continental US. Override with --bbox minLat,minLng,maxLat,maxLng
const DEFAULT_BBOX = { minLat: 24.4, minLng: -125.0, maxLat: 49.4, maxLng: -66.9 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('•', ...a);

async function main() {
  if (!existsSync(CONTRACT)) {
    console.error(`No contract at ${CONTRACT}. Run: node tools/discover.mjs`);
    process.exit(1);
  }
  const contract = JSON.parse(await readFile(CONTRACT, 'utf8'));
  const primary = contract.primary;
  if (!primary) {
    console.error('Contract has no `primary` endpoint. Open recon/REPORT.md, pick the');
    console.error('right endpoint, and fill in `primary` (url, recordPath, bboxParams) by hand.');
    process.exit(1);
  }

  const bboxParams = parseBboxParams(argv['bbox-params']) ?? primary.bboxParams;
  if (!bboxParams) {
    console.error('No bbox parameters known. Inspect recon/REPORT.md and pass them:');
    console.error('  --bbox-params minLat=south,minLng=west,maxLat=north,maxLng=east');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const rootBbox = argv.bbox ? parseBbox(argv.bbox) : DEFAULT_BBOX;
  const state = RESUME && existsSync(STATE_FILE)
    ? JSON.parse(await readFile(STATE_FILE, 'utf8'))
    : { queue: [{ bbox: rootBbox, depth: 0 }], done: [], records: {}, stats: { requests: 0, split: 0 } };

  const request = VIA_BROWSER ? await browserRequester(contract) : directRequester();
  const seen = new Map(Object.entries(state.records));

  log(`sweeping ${JSON.stringify(rootBbox)} at ${RPS} req/s, max depth ${MAX_DEPTH}`);
  log(`bbox params: ${JSON.stringify(bboxParams)}`);

  try {
    while (state.queue.length) {
      const tile = state.queue.shift();
      const url = buildUrl(primary, bboxParams, tile.bbox);

      let payload;
      try {
        payload = await withRetry(() => request(url, primary), 4);
      } catch (err) {
        console.error(`  tile failed permanently, skipping: ${String(err).split('\n')[0]}`);
        state.done.push({ ...tile, error: String(err).slice(0, 200) });
        continue;
      }
      state.stats.requests++;

      const records = resolvePath(payload, primary.recordPath);
      const list = Array.isArray(records) ? records : records ? [records] : [];
      for (const r of list) {
        const id = recordId(r);
        if (id != null) seen.set(String(id), r);
      }

      const cap = SPLIT_AT ?? inferCap(primary.recordCount, list.length);
      const shouldSplit = list.length >= cap && tile.depth < MAX_DEPTH;
      log(
        `depth ${tile.depth} [${fmtBbox(tile.bbox)}] → ${list.length} records ` +
        `(${seen.size} unique)${shouldSplit ? ' — splitting' : ''}`
      );

      if (shouldSplit) {
        state.stats.split++;
        for (const child of quadsplit(tile.bbox)) state.queue.push({ bbox: child, depth: tile.depth + 1 });
      }
      state.done.push(tile);

      state.records = Object.fromEntries(seen);
      await writeFile(STATE_FILE, JSON.stringify(state));
      await sleep(1000 / RPS);
    }
  } finally {
    if (request.close) await request.close();
  }

  const out = join(OUT_DIR, 'campsites.raw.json');
  await writeFile(out, JSON.stringify([...seen.values()], null, 2));
  log(`done — ${seen.size} unique records from ${state.stats.requests} requests`);
  log(`wrote ${out}`);
  log('next: node tools/build-index.mjs');
}

// -------------------------------------------------------------- requests ---

function directRequester() {
  return async (url, primary) => {
    const res = await fetch(url, {
      method: primary.method ?? 'GET',
      headers: { accept: 'application/json, text/plain, */*', ...cleanHeaders(primary.requestHeaders) },
      body: primary.method === 'POST' ? primary.postData ?? null : undefined,
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`retryable HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

/**
 * Runs each request from inside a live page on the target origin, so cookies,
 * referer, and any CSRF/nonce the app sets are applied for free. Slower, but it
 * works when direct fetches get 403'd.
 */
async function browserRequester(contract) {
  const { launchChromium } = await import('./lib/browser.mjs');
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto(contract.target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const fn = async (url, primary) => {
    const result = await page.evaluate(
      async ({ url, method, body, headers }) => {
        const res = await fetch(url, {
          method,
          headers: { accept: 'application/json, text/plain, */*', ...headers },
          body: method === 'POST' ? body : undefined,
          credentials: 'include',
        });
        return { status: res.status, text: await res.text() };
      },
      { url, method: primary.method ?? 'GET', body: primary.postData ?? null, headers: cleanHeaders(primary.requestHeaders) }
    );
    if (result.status === 429 || result.status >= 500) throw new Error(`retryable HTTP ${result.status}`);
    if (result.status >= 400) throw new Error(`HTTP ${result.status}`);
    return JSON.parse(result.text);
  };
  fn.close = async () => { await browser.close(); };
  return fn;
}

function cleanHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string' && !v.startsWith('<redacted')) out[k] = v;
  }
  return out;
}

async function withRetry(fn, attempts) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!/retryable|HTTP 5|429|fetch failed|ECONN|timeout/i.test(String(err))) throw err;
      const wait = 2000 * 2 ** i;
      console.log(`  retry ${i + 1}/${attempts} in ${wait}ms — ${String(err).split('\n')[0]}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------- geometry ----

function quadsplit({ minLat, minLng, maxLat, maxLng }) {
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  return [
    { minLat, minLng, maxLat: midLat, maxLng: midLng },
    { minLat, minLng: midLng, maxLat: midLat, maxLng },
    { minLat: midLat, minLng, maxLat, maxLng: midLng },
    { minLat: midLat, minLng: midLng, maxLat, maxLng },
  ];
}

function buildUrl(primary, bboxParams, bbox) {
  const u = new URL(primary.url);
  // Preserve any constant params the app sent (keys, version pins), then
  // overwrite the four that describe the viewport.
  for (const [corner, paramName] of Object.entries(bboxParams)) {
    u.searchParams.set(paramName, String(round(bbox[corner])));
  }
  return u.toString();
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const fmtBbox = (b) => `${b.minLat.toFixed(2)},${b.minLng.toFixed(2)} → ${b.maxLat.toFixed(2)},${b.maxLng.toFixed(2)}`;

/** Guess the server's per-request cap from the first response we ever saw. */
function inferCap(observedFromRecon, current) {
  const round100 = [25, 50, 100, 200, 250, 500, 1000];
  const candidate = observedFromRecon || current;
  for (const c of round100) if (candidate <= c) return c;
  return candidate;
}

// --------------------------------------------------------------- records ---

function recordId(r) {
  if (!r || typeof r !== 'object') return null;
  for (const k of ['id', 'ID', 'site_id', 'siteId', '_id', 'uid', 'slug', 'permalink', 'url']) {
    if (r[k] != null && r[k] !== '') return r[k];
  }
  // Fall back to position — good enough to dedupe overlapping tiles.
  const lat = pick(r, ['lat', 'latitude', 'y']);
  const lng = pick(r, ['lng', 'lon', 'long', 'longitude', 'x']);
  if (lat != null && lng != null) return `${lat},${lng}`;
  return JSON.stringify(r).slice(0, 120);
}

function pick(obj, keys) {
  for (const k of keys) {
    for (const actual of Object.keys(obj)) {
      if (actual.toLowerCase() === k) return obj[actual];
    }
  }
  return null;
}

/** Resolve paths like `$.data.sites` or `$.results[0].items`. */
function resolvePath(root, path) {
  if (!path || path === '$') return root;
  let cur = root;
  const tokens = path.replace(/^\$\.?/, '').match(/[^.[\]]+/g) ?? [];
  for (const t of tokens) {
    if (cur == null) return null;
    cur = /^\d+$/.test(t) ? cur[Number(t)] : cur[t];
  }
  return cur;
}

function parseBbox(s) {
  const [minLat, minLng, maxLat, maxLng] = s.split(',').map(Number);
  if ([minLat, minLng, maxLat, maxLng].some(Number.isNaN)) throw new Error('--bbox must be minLat,minLng,maxLat,maxLng');
  return { minLat, minLng, maxLat, maxLng };
}

function parseBboxParams(s) {
  if (!s) return null;
  const out = {};
  for (const pair of s.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return ['minLat', 'minLng', 'maxLat', 'maxLng'].every((k) => out[k]) ? out : null;
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
