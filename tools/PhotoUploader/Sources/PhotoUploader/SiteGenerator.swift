import Foundation

extension String {
    var htmlEscaped: String {
        replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

/// Renders the static photography/ site (index + one page per photo) from
/// the current post list. Every call fully regenerates all HTML. Detail
/// pages are flat files at photos/<slug>.html (not photos/<slug>/index.html)
/// — rebuild() cleans up any leftover folders from the old scheme.
enum SiteGenerator {
    static let siteTitle = "Photography — Ross Bower"
    static let mainSiteURL = "https://rossbower.com"

    static func siteRoot(repoPath: String) -> URL {
        URL(fileURLWithPath: repoPath).appendingPathComponent("photography")
    }

    static func sortedPosts(_ posts: [Post]) -> [Post] {
        posts.sorted { a, b in
            if a.date != b.date { return a.date > b.date }
            return a.created > b.created
        }
    }

    static func rebuild(_ data: PhotosData, repoPath: String) throws {
        let root = siteRoot(repoPath: repoPath)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("data"), withIntermediateDirectories: true)
        let photosDir = root.appendingPathComponent("photos")
        try FileManager.default.createDirectory(at: photosDir, withIntermediateDirectories: true)
        bootstrapCSSIfNeeded(root: root)

        let posts = sortedPosts(data.posts)
        try renderIndex(posts, root: root)
        for post in posts {
            try renderDetail(post, posts: posts, root: root)
        }

        // Clean up stale output: leftover folders from the old
        // photos/<slug>/index.html scheme, and .html files for posts that
        // no longer exist.
        let validFiles = Set(posts.map { "\($0.slug).html" })
        if let children = try? FileManager.default.contentsOfDirectory(at: photosDir, includingPropertiesForKeys: [.isDirectoryKey]) {
            for child in children {
                let isDir = (try? child.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                if isDir {
                    try? FileManager.default.removeItem(at: child)
                } else if !validFiles.contains(child.lastPathComponent) {
                    try? FileManager.default.removeItem(at: child)
                }
            }
        }
    }

    // MARK: - Index page

    private static func renderIndex(_ posts: [Post], root: URL) throws {
        let tiles: String
        if posts.isEmpty {
            tiles = "            <p class=\"empty\">No photos yet — check back soon.</p>"
        } else {
            tiles = posts.map { post in
                let tint = post.palette.ambient?.bg2 ?? "#222"
                let title = (post.title.isEmpty ? "Untitled" : post.title).htmlEscaped
                return """
                            <a class="tile" href="photos/\(post.slug).html" style="--tint:\(tint)">
                                <img src="\(post.thumb)" alt="\(title)" loading="lazy">
                                <span class="tile-caption">\(title)</span>
                            </a>
                """
            }.joined(separator: "\n")
        }

        let doc = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>\(siteTitle)</title>
        <link rel="stylesheet" href="assets/site.css">
        </head>
        <body class="index-page">
            <header class="site-header">
                <h1>Photography</h1>
                <a class="back-link" href="\(mainSiteURL)">rossbower.com &rarr;</a>
            </header>
            <main class="grid">
        \(tiles)
            </main>
            <footer class="site-footer">&copy; Ross Bower</footer>
        </body>
        </html>

        """
        try doc.write(to: root.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
    }

    // MARK: - Detail page

    private static let swatchOrder = ["dominant", "vibrant", "light_vibrant", "dark_vibrant", "muted", "light_muted", "dark_muted"]
    private static let swatchLabels: [String: String] = [
        "dominant": "Dominant", "vibrant": "Vibrant", "light_vibrant": "Light Vibrant",
        "dark_vibrant": "Dark Vibrant", "muted": "Muted", "light_muted": "Light Muted",
        "dark_muted": "Dark Muted",
    ]

    private static func swatch(_ post: Post, key: String) -> Swatch? {
        switch key {
        case "dominant": return post.palette.dominant
        case "vibrant": return post.palette.vibrant
        case "light_vibrant": return post.palette.light_vibrant
        case "dark_vibrant": return post.palette.dark_vibrant
        case "muted": return post.palette.muted
        case "light_muted": return post.palette.light_muted
        case "dark_muted": return post.palette.dark_muted
        default: return nil
        }
    }

    private static func renderSwatchRow(_ post: Post) -> String {
        var seenHex = Set<String>()
        var chips: [String] = []
        for key in swatchOrder {
            guard let sw = swatch(post, key: key), !seenHex.contains(sw.hex) else { continue }
            seenHex.insert(sw.hex)
            let label = swatchLabels[key] ?? key
            chips.append("""
                            <button class="swatch" style="background:\(sw.hex);color:\(sw.text)"
                                    data-hex="\(sw.hex)" title="\(label) — \(sw.hex) (click to copy)">
                                <span>\(sw.hex)</span>
                            </button>
            """)
        }
        return chips.joined(separator: "\n")
    }

    private static func renderExif(_ exif: PostExif) -> String {
        var fields: [(String, String)] = []
        let camera = [exif.make, exif.model].compactMap { $0 }.joined(separator: " ")
        if !camera.isEmpty { fields.append(("Camera", camera)) }
        if let v = exif.lens { fields.append(("Lens", v)) }
        if let v = exif.aperture { fields.append(("Aperture", v)) }
        if let v = exif.shutter { fields.append(("Shutter", v)) }
        if let v = exif.iso { fields.append(("ISO", v)) }
        if let v = exif.focal_length { fields.append(("Focal length", v)) }
        if let v = exif.date_taken { fields.append(("Taken", v)) }

        var rows = fields.map { key, value in
            "                <div class=\"exif-item\"><span class=\"exif-label\">\(key)</span><span>\(value.htmlEscaped)</span></div>"
        }

        if let location = exif.location {
            let mapsURL = "https://maps.apple.com/?ll=" + location.replacingOccurrences(of: " ", with: "")
            rows.append(
                "                <div class=\"exif-item\"><span class=\"exif-label\">Location</span>"
                + "<span><a href=\"\(mapsURL.htmlEscaped)\" target=\"_blank\" rel=\"noopener\">"
                + "\(location.htmlEscaped)</a></span></div>"
            )
        }

        guard !rows.isEmpty else { return "" }
        return "            <div class=\"exif-grid\">\n" + rows.joined(separator: "\n") + "\n            </div>"
    }

    /// Small/Medium are omitted when the source photo was never big enough
    /// to need them (see ImageProcessor). Large always exists — it's
    /// generated for every photo. Full Size (the untouched upload) only
    /// exists for photos added after that feature shipped.
    private static func renderDownloads(_ post: Post) -> String {
        var links: [(String, String, String)] = [] // label, href, extra title text
        if let small = post.small { links.append(("Small", small, "≤\(ImageProcessor.smallMax)px")) }
        if let medium = post.medium { links.append(("Medium", medium, "≤\(ImageProcessor.mediumMax)px")) }
        links.append(("Large", post.full, "≤\(ImageProcessor.fullMax)px"))
        if let original = post.original { links.append(("Full Size", original, "original uploaded file, full resolution \(post.width)\u{00d7}\(post.height)")) }

        let items = links.map { label, href, hint in
            "                <a class=\"download-link\" href=\"../\(href)\" download title=\"\(hint.htmlEscaped)\">\(label)</a>"
        }.joined(separator: "\n")

        return """
                    <div class="download-row">
                        <span class="download-label">Download</span>
        \(items)
                    </div>
        """
    }

    private static func renderDetail(_ post: Post, posts: [Post], root: URL) throws {
        let ambient = post.palette.ambient ?? Ambient(bg1: "#111", bg2: "#222", accent: "#888", text: "#f5f5f5")
        guard let idx = posts.firstIndex(where: { $0.slug == post.slug }) else { return }
        let prevPost = idx > 0 ? posts[idx - 1] : nil
        let nextPost = idx < posts.count - 1 ? posts[idx + 1] : nil

        let titleHTML = post.title.isEmpty ? "" : "<h1>\(post.title.htmlEscaped)</h1>"
        let captionHTML = post.caption.isEmpty ? "" : "<p class=\"caption\">\(post.caption.htmlEscaped)</p>"
        let dateDisplay = String((post.exif.date_taken ?? post.date).prefix(10))
        let exifHTML = renderExif(post.exif)
        let swatchHTML = renderSwatchRow(post)
        let downloadHTML = renderDownloads(post)

        let prevLink: String
        if let prevPost {
            prevLink = "<a class=\"stage-nav stage-nav-prev\" href=\"\(prevPost.slug).html\" aria-label=\"Newer photo\">&lsaquo;</a>"
        } else {
            prevLink = "<span class=\"stage-nav stage-nav-prev disabled\" aria-label=\"No newer photo\">&lsaquo;</span>"
        }
        let nextLink: String
        if let nextPost {
            nextLink = "<a class=\"stage-nav stage-nav-next\" href=\"\(nextPost.slug).html\" aria-label=\"Older photo\">&rsaquo;</a>"
        } else {
            nextLink = "<span class=\"stage-nav stage-nav-next disabled\" aria-label=\"No older photo\">&rsaquo;</span>"
        }

        let dims = "\(post.width) &times; \(post.height)"
        let pageTitle = (post.title.isEmpty ? post.slug : post.title).htmlEscaped

        var moreItems: [String] = []
        for p in posts where p.slug != post.slug {
            let title = (p.title.isEmpty ? "Untitled" : p.title).htmlEscaped
            moreItems.append("""
                            <a class="more-tile" href="\(p.slug).html">
                                <img src="../\(p.thumb)" alt="\(title)" loading="lazy">
                            </a>
            """)
            if moreItems.count == 6 { break }
        }
        let moreHTML = moreItems.isEmpty ? "" : """
                <section class="more-photos">
                    <h2>More photos</h2>
                    <div class="more-grid">
        \(moreItems.joined(separator: "\n"))
                    </div>
                </section>
        """

        let doc = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>\(pageTitle) — \(siteTitle)</title>
        <link rel="stylesheet" href="../assets/site.css">
        <style>
            body { --bg1: \(ambient.bg1); --bg2: \(ambient.bg2); --accent: \(ambient.accent); --ambient-text: \(ambient.text); }
        </style>
        </head>
        <body class="detail-page">
            <header class="site-header">
                <a class="back-link" href="../index.html">&larr; Photography</a>
                <a class="back-link" href="\(mainSiteURL)">rossbower.com &rarr;</a>
            </header>
            <main class="detail">
                <div class="photo-stage">
                    \(prevLink)
                    <figure class="detail-figure">
                        <img src="../\(post.full)" alt="\(post.title.htmlEscaped)">
                    </figure>
                    \(nextLink)
                </div>
                <div class="detail-body">
                    \(titleHTML)
                    <div class="meta-row">
                        <span class="meta-date">\(dateDisplay.htmlEscaped)</span>
                        <span class="meta-dims">\(dims)</span>
                    </div>
                    \(captionHTML)
        \(exifHTML)
                    <div class="swatch-row">
        \(swatchHTML)
                    </div>
        \(downloadHTML)
                </div>
        \(moreHTML)
            </main>
            <footer class="site-footer">&copy; Ross Bower</footer>
            <script>
                document.querySelectorAll('.swatch').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var hex = btn.getAttribute('data-hex');
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(hex);
                        }
                        var label = btn.querySelector('span');
                        var original = label.textContent;
                        label.textContent = 'Copied!';
                        setTimeout(function() { label.textContent = original; }, 900);
                    });
                });
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'ArrowLeft') {
                        var prev = document.querySelector('.stage-nav-prev:not(.disabled)');
                        if (prev) prev.click();
                    } else if (e.key === 'ArrowRight') {
                        var next = document.querySelector('.stage-nav-next:not(.disabled)');
                        if (next) next.click();
                    }
                });
            </script>
        </body>
        </html>

        """

        try doc.write(to: root.appendingPathComponent("photos/\(post.slug).html"), atomically: true, encoding: .utf8)
    }

    // MARK: - CSS bootstrap

    private static func bootstrapCSSIfNeeded(root: URL) {
        let cssURL = root.appendingPathComponent("assets/site.css")
        guard !FileManager.default.fileExists(atPath: cssURL.path) else { return }
        try? defaultCSS.write(to: cssURL, atomically: true, encoding: .utf8)
    }

    private static let defaultCSS = """
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: Georgia, 'Times New Roman', Times, serif;
        line-height: 1.6;
        background: #0b0d10;
        color: #f2f2f2;
    }

    h1, h2 {
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-stretch: condensed;
        font-weight: 500;
        letter-spacing: 0.02em;
    }

    a { color: inherit; text-decoration: none; }

    .site-header {
        max-width: 1400px;
        margin: 0 auto;
        padding: 28px 24px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .site-header h1 { font-size: 1.4em; letter-spacing: 0.04em; }

    .back-link { font-family: Futura, 'Trebuchet MS', Arial, sans-serif; font-size: 0.85em; color: rgba(242,242,242,0.7); }
    .back-link:hover { color: #ffffff; }

    .site-footer {
        max-width: 1400px;
        margin: 40px auto 0;
        padding: 20px 24px 40px;
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.8em;
        color: rgba(242,242,242,0.4);
    }

    .grid {
        max-width: 1100px;
        margin: 0 auto;
        padding: 4px 24px 40px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 4px;
    }

    .tile {
        position: relative;
        display: block;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        border-radius: 3px;
        box-shadow: 0 0 0 0 var(--tint, transparent);
        transition: box-shadow 0.2s;
    }

    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
    .tile:hover img { transform: scale(1.04); }
    .tile:hover { box-shadow: inset 0 0 0 3px var(--tint, transparent); }

    .tile-caption {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        padding: 22px 12px 10px;
        background: linear-gradient(to top, rgba(0,0,0,0.65), transparent);
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.85em;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .tile:hover .tile-caption { opacity: 1; }

    .empty { grid-column: 1 / -1; text-align: center; color: rgba(242,242,242,0.5); font-style: italic; padding: 60px 0; }

    .detail-page { background: linear-gradient(165deg, var(--bg1, #111), var(--bg2, #222)); min-height: 100vh; }

    .detail { max-width: 1400px; margin: 0 auto; padding: 0 24px 20px; }

    .photo-stage {
        position: relative;
        display: flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        margin: 0 auto 24px;
    }

    .detail-figure { text-align: center; }
    .detail-figure img {
        display: block; width: auto; height: auto;
        max-width: 82vw; max-height: 90vh;
        border-radius: 6px; box-shadow: 0 24px 60px rgba(0,0,0,0.45);
    }

    .stage-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: rgba(0,0,0,0.4);
        color: rgba(255,255,255,0.92);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 40px;
        line-height: 1;
        font-family: Georgia, serif;
        backdrop-filter: blur(6px);
        transition: background 0.15s, transform 0.15s;
        z-index: 2;
    }
    .stage-nav:hover { background: rgba(0,0,0,0.65); transform: translateY(-50%) scale(1.06); }
    .stage-nav.disabled { opacity: 0.2; pointer-events: none; }
    .stage-nav-prev { left: 8px; }
    .stage-nav-next { right: 8px; }

    .detail-body { background: rgba(0,0,0,0.28); backdrop-filter: blur(6px); border-radius: 8px; padding: 24px 28px 28px; }
    .detail-body h1 { font-size: 1.8em; margin-bottom: 8px; }

    .meta-row {
        display: flex; gap: 14px; align-items: baseline;
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.85em; color: rgba(242,242,242,0.6); margin-bottom: 14px;
    }

    .caption { margin-bottom: 18px; color: rgba(242,242,242,0.9); font-size: 1.05em; }

    .exif-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px 20px;
        margin-bottom: 22px;
        padding-top: 14px;
        border-top: 1px solid rgba(242,242,242,0.15);
    }

    .exif-item { display: flex; flex-direction: column; font-size: 0.9em; }
    .exif-label {
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.06em;
        color: rgba(242,242,242,0.5); margin-bottom: 2px;
    }

    .swatch-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }

    .swatch {
        border: none; border-radius: 5px; width: 76px; height: 46px; cursor: pointer;
        display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px;
        font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.7em;
        opacity: 0.95; transition: transform 0.15s, opacity 0.15s;
    }
    .swatch:hover { transform: translateY(-2px); opacity: 1; }

    .download-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        padding-top: 18px;
        border-top: 1px solid rgba(242,242,242,0.15);
        font-family: Futura, 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.85em;
    }

    .download-label {
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.8em;
        color: rgba(242,242,242,0.5);
    }

    .download-link {
        color: rgba(255,255,255,0.85);
        padding: 5px 12px;
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 5px;
        transition: background 0.15s, border-color 0.15s;
    }
    .download-link:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.5); }

    .more-photos { margin-top: 44px; }
    .more-photos h2 {
        font-size: 1em; text-transform: uppercase; letter-spacing: 0.08em;
        color: rgba(242,242,242,0.6); margin-bottom: 14px;
    }

    .more-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
    .more-tile { display: block; aspect-ratio: 1 / 1; border-radius: 4px; overflow: hidden; }
    .more-tile img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; }
    .more-tile:hover img { transform: scale(1.06); }

    @media (max-width: 640px) {
        .site-header { flex-direction: column; align-items: flex-start; gap: 8px; }
        .detail-body { padding: 18px 18px 22px; }
        .exif-grid { grid-template-columns: repeat(2, 1fr); }
        .stage-nav { width: 44px; height: 44px; font-size: 28px; }
    }

    """
}
