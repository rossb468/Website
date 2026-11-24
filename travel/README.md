# Travel blog (`/travel/`)

Static photo blog for friends and family. `trips.json` is the source of truth;
`build.py` generates every `index.html` here. Don't hand-edit generated HTML.

```sh
python3 travel/build.py new "Japan" --location "Tokyo & Kyoto" --intro "Short intro."
python3 travel/build.py add japan /path/to/IMG_1234.jpg ... [--caption "Text"]
python3 travel/build.py build   # after editing trips.json (captions, titles, cover)
```

- Photos are sorted by EXIF date taken and grouped into "Day N" sections.
- Imports are resized (2000px + 900px thumb) and stripped of all metadata, including GPS.
- Re-adding the same file is skipped (content hash).
- `cover` in a trip = the `file` of the photo used on the index card.
- HEIC needs `pip install pillow-heif`; otherwise convert to JPEG first.
