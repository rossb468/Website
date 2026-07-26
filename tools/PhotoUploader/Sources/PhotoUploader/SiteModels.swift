import Foundation

// Mirrors the schema previously written by tools/photogen.py's
// photography/data/photos.json, so the existing library decodes unchanged.

struct Swatch: Codable, Equatable {
    var hex: String
    var rgb: [Int]
    var text: String
}

struct Ambient: Codable, Equatable {
    var bg1: String
    var bg2: String
    var accent: String
    var text: String
}

struct Palette: Codable, Equatable {
    var dominant: Swatch?
    var vibrant: Swatch?
    var light_vibrant: Swatch?
    var dark_vibrant: Swatch?
    var muted: Swatch?
    var light_muted: Swatch?
    var dark_muted: Swatch?
    var ambient: Ambient?
}

struct PostExif: Codable, Equatable {
    var make: String?
    var model: String?
    var lens: String?
    var aperture: String?
    var shutter: String?
    var iso: String?
    var focal_length: String?
    var date_taken: String?
    var location: String?
}

struct Post: Codable, Equatable {
    var slug: String
    var date: String
    var created: Int
    var title: String
    var caption: String
    var width: Int
    var height: Int
    var full: String
    var thumb: String
    /// Downsized download tiers and a verbatim copy of the original source
    /// file. Optional because posts published before this feature existed
    /// don't have them — `small`/`medium` get backfilled from `full` on the
    /// next save, but `original` can't be recovered once the source file is
    /// gone, so it's simply omitted from the download menu for those posts.
    var small: String?
    var medium: String?
    var original: String?
    var exif: PostExif
    var palette: Palette
}

struct PhotosData: Codable {
    var posts: [Post]
}

/// Metadata a form can edit, whether the item is new or already published.
/// Blank string fields mean "no value" and clear the corresponding EXIF key
/// on save — there's no separate "leave untouched" state, since the form is
/// always fully populated before the user can submit it.
struct PhotoMetadataInput {
    var title: String
    var caption: String
    var date: String
    var make: String
    var model: String
    var lens: String
    var aperture: String
    var shutter: String
    var iso: String
    var focalLength: String
    var dateTaken: String
    var location: String
}
