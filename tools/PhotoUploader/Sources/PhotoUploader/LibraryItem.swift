import Foundation

enum ItemKind: Equatable {
    case existing(slug: String)
    case new
}

enum ItemStatus: Equatable {
    case idle
    case working
    case done(message: String)
    case failed(String)
}

/// One photo shown in the app — either an already-published post loaded from
/// the site's photos.json, or a not-yet-published photo just added locally.
/// The same editable metadata fields apply either way; only which backend
/// action applies (publish vs. save-in-place) differs.
struct LibraryItem: Identifiable, Equatable {
    let id: UUID
    var kind: ItemKind

    /// Local file to publish from. Only set for .new items.
    var sourceURL: URL?
    /// Absolute file URL to the on-site thumbnail. Only set for .existing items.
    var thumbFileURL: URL?
    /// Absolute file URL to the on-site full-size image. Only set for .existing items.
    var fullFileURL: URL?

    var title: String = ""
    var caption: String = ""
    var date: Date = Date()

    var dateTaken: String = ""
    var make: String = ""
    var model: String = ""
    var lens: String = ""
    var aperture: String = ""
    var shutter: String = ""
    var iso: String = ""
    var focalLength: String = ""
    var location: String = ""

    var width: Int?
    var height: Int?

    /// For .new items: whether we've already pulled EXIF from the source file.
    var exifLoaded = false

    var status: ItemStatus = .idle

    init(sourceURL: URL) {
        self.id = UUID()
        self.kind = .new
        self.sourceURL = sourceURL
    }

    init(existing post: Post, repoPath: String) {
        self.id = UUID()
        self.kind = .existing(slug: post.slug)
        self.title = post.title
        self.caption = post.caption
        self.width = post.width
        self.height = post.height
        self.date = LibraryItem.parseDate(post.date) ?? Date()
        self.exifLoaded = true

        let exif = post.exif
        self.make = exif.make ?? ""
        self.model = exif.model ?? ""
        self.lens = exif.lens ?? ""
        self.aperture = exif.aperture ?? ""
        self.shutter = exif.shutter ?? ""
        self.iso = exif.iso ?? ""
        self.focalLength = exif.focal_length ?? ""
        self.dateTaken = exif.date_taken ?? ""
        self.location = exif.location ?? ""

        let siteRoot = URL(fileURLWithPath: repoPath).appendingPathComponent("photography")
        self.thumbFileURL = siteRoot.appendingPathComponent(post.thumb)
        self.fullFileURL = siteRoot.appendingPathComponent(post.full)
    }

    /// Builds the metadata bundle PhotoEngine's add/update calls need,
    /// straight from this item's current (possibly user-edited) fields.
    func metadataInput() -> PhotoMetadataInput {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        return PhotoMetadataInput(
            title: title, caption: caption, date: df.string(from: date),
            make: make, model: model, lens: lens, aperture: aperture,
            shutter: shutter, iso: iso, focalLength: focalLength,
            dateTaken: dateTaken, location: location
        )
    }

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        if case .existing(let slug) = kind { return slug }
        return sourceURL?.lastPathComponent ?? "Untitled"
    }

    var previewURL: URL? {
        switch kind {
        case .new: return sourceURL
        case .existing: return fullFileURL
        }
    }

    var thumbnailURL: URL? {
        switch kind {
        case .new: return sourceURL
        case .existing: return thumbFileURL
        }
    }

    var isExisting: Bool {
        if case .existing = kind { return true }
        return false
    }

    static func parseDate(_ string: String) -> Date? {
        let full = DateFormatter()
        full.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let date = full.date(from: string) { return date }
        let short = DateFormatter()
        short.dateFormat = "yyyy-MM-dd"
        return short.date(from: String(string.prefix(10)))
    }
}
