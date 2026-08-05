# Campsite Search

A search interface for freecampsites.net data, plus the tooling to get that data
out of freecampsites.net in the first place.

The premise: their database is excellent and their search is not. You can't ask
it "free, above 7000 ft, at least four reviews averaging 4+, Verizon signal, and
reviewed since last summer." This can.

---

## Status — read this first

**The API contract has not been captured yet.** The session that wrote this
tooling ran in a sandbox whose egress policy blocked freecampsites.net (and
almost everything else), so no live traffic from the real site was ever
observed. Nothing in here claims to know their endpoint names.

What *is* verified: the whole pipeline was built and tested end to end against a
mock site that mimics a capped bounding-box API with deliberately unfamiliar
field names (`site_id`, `location.latitude`, `nightly_fee`, …). On that mock:

- `discover.mjs` found the data endpoint unprompted, scored it above the
  geocoder and every other request, extracted the record path (`$.data.sites`),
  and correctly classified all seven query params — including spotting that
  `api_key` and `limit` were fixed while `south`/`west`/`north`/`east` varied.
- `harvest.mjs` pulled **900 of 900** records through a **50-result cap** in 69
  requests, by splitting any over-full box into quarters.
- `build-index.mjs` auto-mapped 15 of 17 unfamiliar field names and reported the
  two it missed, which is the intended feedback loop.
- The UI loaded all 900, and filters, sorting, detail panel, URL state, and
  reset all behaved.

So the machinery is real and tested. Point it at the actual site and it will
tell you what the actual API is. If the answer turns out to be "there is no JSON
API, it's server-rendered HTML," see [If there's no API](#if-theres-no-api).

---

## Three commands

```bash
npm install
npx playwright install chromium   # skip if you already have it

npm run discover                  # watch it work: npm run discover:watch
npm run harvest
npm run build
npm run serve                     # then open http://localhost:8080/
```

`discover` writes to `recon/`. **Read `recon/REPORT.md` before harvesting** —
it's the actual reverse-engineering output, and you want to sanity-check what it
picked before you start sweeping the country with it.

---

## What `discover` does

It's a Playwright session that behaves like a curious user and writes down
everything the site says back.

1. Loads the homepage, dismisses consent overlays.
2. Finds the search input by trying a ladder of selectors, types a place name
   *slowly* — autocomplete endpoints only fire on real keystrokes.
3. Grabs the map element and pans it three times and zooms it three times. This
   is the important part: **each move re-queries the viewport**, and diffing
   those requests is what reveals which parameters are the bounding box and
   which are fixed keys.
4. Clicks through to a detail page.
5. Politely probes `/robots.txt`, `/sitemap.xml`, `/wp-json/`, `/api/` and
   friends from inside the page, so they inherit cookies and origin.

Then it analyzes what it caught:

- **Endpoint scoring.** Every JSON response is walked for arrays of objects.
  Each array is scored on whether its records carry lat/lng (+45), a name (+18),
  an id (+12), how many there are, and whether the URL path looks data-ish. The
  geocoder loses to the real search endpoint because its records are thin.
- **Parameter grammar.** Requests are grouped by path and their params diffed
  across calls. Anything that changed as you panned is an input you control;
  anything constant is a key, a version pin, or config. Roles like `bbox.minLat`
  and `auth/key` are inferred from the names.
- **Schema inference.** Field names, types, examples, and how often each is
  populated across sample records.
- **Static pass.** Every JS bundle is regexed for URL literals, so you also see
  endpoints the app *can* call but the scripted session never triggered. Worth
  reading — this is where the interesting undocumented stuff usually hides.

Outputs: `REPORT.md` (with copy-pasteable `curl` for each candidate),
`endpoints.json` (machine-readable, feeds the harvester), `network.har` (open it
in Chrome DevTools), and raw response bodies under `samples/`.

## What `harvest` does

Map APIs cap results per viewport, so asking for the whole country returns the
first N and silently drops the rest. The harvester sidesteps that without
needing to know the cap: query a box, and if the response comes back at or above
the cap, split it into four and recurse. Empty regions cost one request; dense
ones subdivide until they fit.

- `--rps 1` by default. Please don't raise it much.
- `--resume` picks up from `data/harvest-state.json` after an interruption.
- `--via-browser` replays every request from inside a live page on their origin,
  so cookies and any CSRF token apply. Slower, but it works when direct fetches
  get a 403.
- `--bbox 36,-114,42,-109` to sweep one region instead of the lower 48.
- `--bbox-params minLat=south,...` if the report found the endpoint but couldn't
  name the box params itself.

## What `build` does

Normalizes whatever field names came back onto a stable schema, matching loosely
so `site_name`, `siteName`, and `SITE_NAME` all land on `name`. Parses `"Free"`
and `"$22"` into a number plus a boolean, folds cell signal (bars, words, or
percentages) onto 0–4, and expands state names to codes.

Anything it couldn't place goes in `data/unmapped.json`. If a field you care
about shows up there, add it to `FIELD_MAP` at the top of
`tools/build-index.mjs` and re-run — no re-harvest needed.

---

## The interface

Filters: free-only, max price, min rating, min review count, reviewed-since,
eight amenities, cell signal by carrier with a minimum bars threshold, elevation
range, minimum stay limit, state, type, and distance from a dropped pin.

Sorts: best match, rating, review count, recency, elevation either direction,
price, distance.

- `/` focuses search, `j`/`k` walk results, `Esc` closes the detail panel.
- Shift-click the map to drop a pin, then filter or sort by distance from it.
- "Only in map view" ties results to the current viewport.
- Every filter is in the URL, so a search is a bookmark you can send to someone.
- Hovering a result enlarges its map marker.

Beyond 4,000 matches the map stops adding pins — it's unreadable past that
anyway — and says so. The list is unaffected.

The page reads `data/campsites.json`. Without it you get a loader where you can
point at a harvested file directly, or load `data/sample.json` — six invented
fixtures, clearly labelled, that exist only so the interface can be developed
before any real data exists. **They are not real listings.**

---

## If there's no API

If `REPORT.md` comes back with no candidates, the data is probably rendered
server-side into HTML. That's a different job, and the right shape for it
depends entirely on markup nobody has looked at yet — so it isn't written here
rather than guessed at. The starting points, roughly in order of effort:

1. `recon/samples/` and `network.har` — confirm the detail pages really are HTML
   with no XHR behind them.
2. `/sitemap.xml` — if it enumerates every campsite URL, that's your crawl
   frontier handed to you, and no search endpoint is needed.
3. `/wp-json/wp/v2/…` — the content pages are WordPress. If listings live in a
   custom post type and the REST route is open, that's a real JSON API with
   pagination, and you can point `harvest.mjs` at it with `--bbox-params`
   swapped for page params.
4. Failing all that, parse the detail pages with `cheerio` and feed the same
   normalized shape into `build-index.mjs`. Everything downstream still works —
   the UI only cares about the output schema.

---

## Being a decent guest

The data is contributed by campers, for campers, and freecampsites hosts it for
free. A few things follow from that:

- The default rate limit is one request per second. It's polite, not a
  performance bug — leave it alone.
- Harvest once and work locally. Don't re-sweep the country because you changed
  a filter; that's what `build` is for.
- This is for personal use. Republishing their database wholesale is a different
  thing entirely, and their terms are the place to check before you consider it.
- If you end up leaning on this regularly, the genuinely good move is to
  contribute reviews and corrections back.

Harvested data and `recon/` are gitignored — the repo carries the tooling, not
their database.
