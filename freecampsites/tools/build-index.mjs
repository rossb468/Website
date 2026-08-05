#!/usr/bin/env node
/**
 * build-index.mjs — normalize harvested records into what the search UI wants.
 *
 * The raw API field names are whatever they are; this maps them onto a stable
 * schema by matching candidate names loosely (case, underscores, and camelCase
 * all collapse). Anything it can't place is listed in data/unmapped.json so you
 * can extend the maps below.
 *
 * Usage: node tools/build-index.mjs [--in data/campsites.raw.json] [--out data/campsites.json]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const argv = parseArgs(process.argv.slice(2));
const IN = resolve(argv.in ?? 'data/campsites.raw.json');
const OUT = resolve(argv.out ?? 'data/campsites.json');
const UNMAPPED = resolve(argv.unmapped ?? 'data/unmapped.json');

/** Candidate source names per output field. First hit wins. */
const FIELD_MAP = {
  id: ['id', 'siteid', 'postid', 'uid', '_id', 'slug'],
  name: ['name', 'title', 'sitename', 'campsitename', 'label'],
  lat: ['lat', 'latitude', 'y', 'geolat'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x', 'geolng'],
  elevation: ['elevation', 'elev', 'altitude', 'elevationft', 'elevationfeet'],
  description: ['description', 'desc', 'summary', 'body', 'content', 'directions', 'excerpt', 'blurb', 'notes', 'overview'],
  city: ['city', 'town', 'nearestcity', 'nearesttown', 'locality'],
  state: ['state', 'stateprovince', 'province', 'region', 'stateabbr', 'statecode'],
  country: ['country', 'countrycode'],
  url: ['url', 'link', 'permalink', 'href', 'weburl'],
  rating: ['rating', 'stars', 'avgrating', 'averagerating', 'score', 'overallrating'],
  reviewCount: ['reviewcount', 'numreviews', 'reviews', 'reviewstotal', 'ratingcount', 'commentcount'],
  lastReviewed: ['lastreviewed', 'lastreview', 'lastreviewdate', 'updated', 'updatedat', 'modified', 'lastupdated', 'date'],
  price: ['price', 'cost', 'fee', 'nightlyrate', 'rate', 'amount', 'nightlyfee', 'campingfee', 'feeamount', 'pricepernight'],
  siteCount: ['sitecount', 'numsites', 'numberofsites', 'sites', 'capacity', 'totalsites', 'numcampsites'],
  maxStay: ['maxstay', 'staylimit', 'maxstaydays', 'daylimit', 'maxnights'],
  type: ['type', 'category', 'sitetype', 'campgroundtype', 'classification', 'kind'],
  agency: ['agency', 'managedby', 'owner', 'jurisdiction', 'landmanager', 'blm', 'forest'],
  roadCondition: ['roadcondition', 'road', 'access', 'roadaccess', 'roadquality', 'surface'],
  toilets: ['toilets', 'toilet', 'restrooms', 'vault', 'vaulttoilet', 'pittoilet', 'hastoilets'],
  water: ['water', 'drinkingwater', 'potablewater', 'haswater'],
  trash: ['trash', 'garbage', 'dumpster', 'hastrash'],
  showers: ['showers', 'shower', 'hasshowers'],
  picnicTables: ['picnictables', 'picnictable', 'tables'],
  fireRings: ['firerings', 'firering', 'firepit', 'firepits', 'fire'],
  pets: ['pets', 'petsallowed', 'dogfriendly', 'dogs'],
  rvAccessible: ['rv', 'rvaccessible', 'rvfriendly', 'rvallowed', 'maxrvlength', 'rvlength'],
  cellVerizon: ['verizon', 'cellverizon', 'verizonsignal', 'signalverizon'],
  cellAtt: ['att', 'atandt', 'cellatt', 'attsignal'],
  cellTmobile: ['tmobile', 'celltmobile', 'tmobilesignal'],
};

/** Words that mean "free" in a cost field. */
const FREE_WORDS = /^(free|no fee|none|0|\$0|no cost|donation)/i;

async function main() {
  const raw = JSON.parse(await readFile(IN, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${IN} is not an array`);

  const mappedSources = new Set();
  const allSources = new Set();
  const sites = [];

  for (const rec of raw) {
    const flat = flatten(rec);
    for (const k of Object.keys(flat)) allSources.add(k);

    const get = (field) => {
      const hit = lookup(flat, FIELD_MAP[field] ?? []);
      if (hit) mappedSources.add(hit.key);
      return hit?.value;
    };

    const lat = num(get('lat'));
    const lng = num(get('lng'));
    if (lat == null || lng == null) continue; // no position, no map pin

    const priceRaw = get('price');
    const site = {
      id: String(get('id') ?? `${lat},${lng}`),
      name: str(get('name')) ?? 'Unnamed site',
      lat, lng,
      elevation: num(get('elevation')),
      description: cleanText(str(get('description'))),
      city: str(get('city')),
      state: normalizeState(str(get('state'))),
      country: str(get('country')),
      url: str(get('url')),
      rating: num(get('rating')),
      reviewCount: int(get('reviewCount')),
      lastReviewed: date(get('lastReviewed')),
      price: priceNumber(priceRaw),
      free: isFree(priceRaw),
      siteCount: int(get('siteCount')),
      maxStay: int(get('maxStay')),
      type: str(get('type')),
      agency: str(get('agency')),
      roadCondition: str(get('roadCondition')),
      amenities: {
        toilets: bool(get('toilets')),
        water: bool(get('water')),
        trash: bool(get('trash')),
        showers: bool(get('showers')),
        picnicTables: bool(get('picnicTables')),
        fireRings: bool(get('fireRings')),
        pets: bool(get('pets')),
        rv: bool(get('rvAccessible')),
      },
      cell: {
        verizon: signal(get('cellVerizon')),
        att: signal(get('cellAtt')),
        tmobile: signal(get('cellTmobile')),
      },
    };

    site.search = [site.name, site.city, site.state, site.type, site.agency, site.description]
      .filter(Boolean).join(' ').toLowerCase();

    sites.push(site);
  }

  const unmapped = [...allSources].filter((k) => !mappedSources.has(k)).sort();

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      count: sites.length,
      source: 'freecampsites.net (harvested locally)',
      states: tally(sites.map((s) => s.state)),
      types: tally(sites.map((s) => s.type)),
      bounds: bounds(sites),
    },
    sites,
  };

  await writeFile(OUT, JSON.stringify(payload));
  await writeFile(UNMAPPED, JSON.stringify({ unmappedSourceFields: unmapped }, null, 2));

  console.log(`• ${sites.length} sites → ${OUT}`);
  console.log(`• ${raw.length - sites.length} records skipped (no coordinates)`);
  if (unmapped.length) {
    console.log(`• ${unmapped.length} source fields unmapped → ${UNMAPPED}`);
    console.log(`  first few: ${unmapped.slice(0, 12).join(', ')}`);
    console.log('  add the useful ones to FIELD_MAP in tools/build-index.mjs and re-run.');
  }
}

// ------------------------------------------------------------- coercion ----

const normKey = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

/** Match on the last path segment so `location.lat` matches candidate `lat`. */
function lookup(flat, candidates) {
  const wanted = candidates.map(normKey);
  for (const want of wanted) {
    for (const [key, value] of Object.entries(flat)) {
      if (normKey(key.split('.').pop()) === want && value != null && value !== '') return { key, value };
    }
  }
  return null;
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v) => (v == null || v === '' ? null : typeof v === 'string' ? v.trim() : String(v));

function cleanText(v) {
  if (!v) return null;
  return v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || null;
}

function bool(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (/^(1|true|yes|y|available|present|has)/.test(s)) return true;
  if (/^(0|false|no|n|none|unavailable|absent)/.test(s)) return false;
  return true; // a non-empty descriptive value ("vault toilet") means present
}

function isFree(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v === 0;
  if (FREE_WORDS.test(String(v).trim())) return true;
  const n = num(v);
  return n == null ? null : n === 0;
}

function priceNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && FREE_WORDS.test(v.trim())) return 0;
  return num(v);
}

function date(v) {
  if (!v) return null;
  const d = new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Cell signal comes through as bars, a word, or a percentage. Normalize to 0–4. */
function signal(v) {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase();
  if (/none|no service|dead/.test(s)) return 0;
  if (/poor|weak|1 bar/.test(s)) return 1;
  if (/fair|ok|2 bar/.test(s)) return 2;
  if (/good|3 bar/.test(s)) return 3;
  if (/excellent|great|strong|4 bar|5 bar/.test(s)) return 4;
  const n = num(v);
  if (n == null) return null;
  if (n > 5) return Math.max(0, Math.min(4, Math.round((n / 100) * 4))); // percentage
  return Math.max(0, Math.min(4, Math.round(n)));
}

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function normalizeState(v) {
  if (!v) return null;
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return US_STATES[s.toLowerCase()] ?? s;
}

function tally(values) {
  const counts = {};
  for (const v of values) if (v) counts[v] = (counts[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function bounds(sites) {
  if (!sites.length) return null;
  const lats = sites.map((s) => s.lat);
  const lngs = sites.map((s) => s.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
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
