#!/usr/bin/env python3
"""Travel blog generator.

  python3 travel/build.py new "Trip Title" [--location "Place"] [--intro "..."] [--slug slug]
  python3 travel/build.py add <trip-slug> photo1.jpg photo2.jpg ... [--caption "..."]
  python3 travel/build.py build

trips.json is the source of truth; edit captions/titles there, then run `build`.
Imported photos are resized and stripped of all metadata (including GPS).
"""
import argparse, datetime as dt, hashlib, html, json, re, sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif  # optional, for iPhone .HEIC files
    pillow_heif.register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "trips.json"
SITE_URL = "https://rossbower.com/travel"
LARGE, THUMB = 2000, 900


def load():
    return json.loads(DATA.read_text()) if DATA.exists() else {"trips": []}


def save(data):
    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "trip"


def find_trip(data, slug):
    for t in data["trips"]:
        if t["slug"] == slug:
            return t
    sys.exit(f"No trip '{slug}'. Trips: {', '.join(t['slug'] for t in data['trips']) or 'none'}")


def taken_at(img):
    exif = img.getexif()
    raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)  # DateTimeOriginal, DateTime
    try:
        return dt.datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S").isoformat()
    except (ValueError, TypeError):
        return None


def cmd_new(a):
    data = load()
    slug = a.slug or slugify(a.title)
    if any(t["slug"] == slug for t in data["trips"]):
        sys.exit(f"Trip '{slug}' already exists")
    data["trips"].append({"slug": slug, "title": a.title, "location": a.location or "",
                          "intro": a.intro or "", "cover": None, "photos": []})
    save(data)
    build(data)
    print(f"Created trip '{slug}'")


def cmd_add(a):
    data = load()
    trip = find_trip(data, a.trip)
    outdir = ROOT / trip["slug"] / "img"
    outdir.mkdir(parents=True, exist_ok=True)
    seen = {p.get("sha") for p in trip["photos"]}
    names = {p["file"] for p in trip["photos"]}
    added = []
    for src in map(Path, a.photos):
        sha = hashlib.sha1(src.read_bytes()).hexdigest()[:12]
        if sha in seen:
            print(f"skip (already posted): {src.name}")
            continue
        img = Image.open(src)
        when = taken_at(img)
        img = ImageOps.exif_transpose(img)
        icc = img.info.get("icc_profile")
        img = img.convert("RGB")
        base = slugify(src.stem)
        name, n = base, 2
        while name in names:
            name, n = f"{base}-{n}", n + 1
        names.add(name)
        for size, suffix, q in ((LARGE, "", 84), (THUMB, "-thumb", 80)):
            im = img.copy()
            im.thumbnail((size, size), Image.LANCZOS)
            im.save(outdir / f"{name}{suffix}.jpg", "JPEG", quality=q, optimize=True,
                    progressive=True, icc_profile=icc)  # no exif => GPS etc. stripped
        w, h = img.size
        scale = min(1, LARGE / max(w, h))
        added.append({"file": name, "sha": sha, "taken": when, "caption": a.caption or "",
                      "w": round(w * scale), "h": round(h * scale)})
        print(f"added: {src.name} -> {trip['slug']}/img/{name}.jpg ({when or 'no date'})")
    trip["photos"].extend(added)
    trip["photos"].sort(key=lambda p: p["taken"] or "9999")
    if not trip.get("cover") and trip["photos"]:
        trip["cover"] = trip["photos"][0]["file"]
    save(data)
    build(data)


# ── HTML ─────────────────────────────────────────────────────

e = lambda s: html.escape(s or "", quote=True)


def paras(text):
    return "".join(f"<p>{e(p).replace(chr(10), '<br>')}</p>" for p in re.split(r"\n\s*\n", text.strip()) if p)


def date_range(trip):
    days = sorted({p["taken"][:10] for p in trip["photos"] if p["taken"]})
    if not days:
        return ""
    a, b = (dt.date.fromisoformat(d) for d in (days[0], days[-1]))
    if a == b:
        return a.strftime("%B %-d, %Y")
    if a.year != b.year:
        return f"{a:%B %-d, %Y} – {b:%B %-d, %Y}"
    if a.month != b.month:
        return f"{a:%B %-d} – {b:%B %-d, %Y}"
    return f"{a:%B %-d}–{b:%-d, %Y}"


def page(title, body, desc="", image=None, css="assets/travel.css", url=SITE_URL + "/"):
    og = f'<meta property="og:image" content="{e(image)}">\n' if image else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
{og}<link rel="stylesheet" href="{css}">
</head>
<body>
{body}
<footer class="site-footer">Photos by Ross Bower &middot; <a href="https://rossbower.com">rossbower.com</a></footer>
</body>
</html>
"""


def trip_sort_key(t):
    return max((p["taken"] or "" for p in t["photos"]), default="")


def build_index(data):
    trips = sorted(data["trips"], key=trip_sort_key, reverse=True)
    cards = []
    for t in trips:
        cover = t.get("cover") or (t["photos"][0]["file"] if t["photos"] else None)
        img = (f'<img src="{e(t["slug"])}/img/{e(cover)}-thumb.jpg" alt="" loading="lazy">'
               if cover else '<div class="card-empty">Photos coming soon</div>')
        n = len(t["photos"])
        meta = " &middot; ".join(x for x in (e(date_range(t)), f"{n} photo{'s' * (n != 1)}") if x)
        cards.append(f"""    <a class="card" href="{e(t['slug'])}/">
        <div class="card-img">{img}</div>
        <div class="card-text">
            <h2>{e(t['title'])}</h2>
            {f'<p class="card-place">{e(t["location"])}</p>' if t["location"] else ""}
            <p class="card-meta">{meta}</p>
        </div>
    </a>""")
    grid = "\n".join(cards) or '    <p class="empty">No trips posted yet — check back soon.</p>'
    body = f"""<header class="site-header">
    <h1>Travels</h1>
    <p class="tagline">Photos from the road, for friends and family.</p>
</header>
<main class="cards">
{grid}
</main>"""
    first = next((t for t in trips if t["photos"]), None)
    image = f"{SITE_URL}/{first['slug']}/img/{first.get('cover') or first['photos'][0]['file']}-thumb.jpg" if first else None
    (ROOT / "index.html").write_text(page("Travels — Ross Bower", body, "Travel photos from Ross Bower.", image))


def build_trip(t):
    days, order = {}, []
    for p in t["photos"]:
        k = (p["taken"] or "")[:10]
        if k not in days:
            days[k] = []
            order.append(k)
        days[k].append(p)
    dated = [k for k in order if k]
    first = dt.date.fromisoformat(dated[0]) if dated else None
    sections = []
    for k in order:
        if k:
            d = dt.date.fromisoformat(k)
            head = f'<span class="day-num">Day {(d - first).days + 1}</span> {d:%A, %B %-d}'
        else:
            head = "More photos"
        figs = "\n".join(
            f"""        <figure class="photo">
            <img src="img/{e(p['file'])}.jpg" width="{p['w']}" height="{p['h']}" alt="{e(p['caption'])}" loading="lazy">
            {f'<figcaption>{paras(p["caption"])}</figcaption>' if p["caption"] else ""}
        </figure>""" for p in days[k])
        sections.append(f"""    <section class="day">
        <h2 class="day-head">{head}</h2>
{figs}
    </section>""")
    sub = " &middot; ".join(x for x in (e(t["location"]), e(date_range(t))) if x)
    body = f"""<header class="trip-header">
    <a class="back-link" href="../">&larr; All trips</a>
    <h1>{e(t['title'])}</h1>
    {f'<p class="trip-sub">{sub}</p>' if sub else ""}
    {f'<div class="intro">{paras(t["intro"])}</div>' if t["intro"] else ""}
</header>
<main class="feed">
{chr(10).join(sections) or '    <p class="empty">Photos coming soon.</p>'}
</main>"""
    cover = t.get("cover") or (t["photos"][0]["file"] if t["photos"] else None)
    image = f"{SITE_URL}/{t['slug']}/img/{cover}-thumb.jpg" if cover else None
    desc = t["intro"].split("\n")[0] if t["intro"] else f"Photos from {t['location'] or t['title']}."
    out = ROOT / t["slug"]
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(page(f"{t['title']} — Travels", body, desc, image,
                                         css="../assets/travel.css", url=f"{SITE_URL}/{t['slug']}/"))


def build(data=None):
    data = data or load()
    for t in data["trips"]:
        build_trip(t)
    build_index(data)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new"); n.add_argument("title"); n.add_argument("--location")
    n.add_argument("--intro"); n.add_argument("--slug")
    ad = sub.add_parser("add"); ad.add_argument("trip"); ad.add_argument("photos", nargs="+")
    ad.add_argument("--caption")
    sub.add_parser("build")
    a = ap.parse_args()
    {"new": cmd_new, "add": cmd_add, "build": lambda _: build()}[a.cmd](a)


if __name__ == "__main__":
    main()
