import CoreGraphics
import Foundation
import ImageIO

/// What we can pull straight out of a photo's embedded metadata, before any
/// user edits. Mirrors the fields the site actually displays.
struct ExtractedExif {
    var make: String?
    var model: String?
    var lens: String?
    var aperture: String?
    var shutter: String?
    var iso: String?
    var focalLength: String?
    var dateTaken: String?
    var location: String?
    var width: Int?
    var height: Int?
}

enum ExifReader {
    static func read(from url: URL) -> ExtractedExif {
        var info = ExtractedExif()

        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
            return info
        }

        if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
            info.make = cleaned(tiff[kCGImagePropertyTIFFMake])
            info.model = cleaned(tiff[kCGImagePropertyTIFFModel])
        }

        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            info.lens = cleaned(exif[kCGImagePropertyExifLensModel])

            if let f = exif[kCGImagePropertyExifFNumber] as? Double, f > 0 {
                info.aperture = "f/\(formatG(f))"
            }
            if let et = exif[kCGImagePropertyExifExposureTime] as? Double, et > 0 {
                info.shutter = et >= 1 ? "\(formatG(et))s" : "1/\(Int((1 / et).rounded()))s"
            }
            if let isoArray = exif[kCGImagePropertyExifISOSpeedRatings] as? [Int], let first = isoArray.first {
                info.iso = "ISO \(first)"
            } else if let isoValue = exif[kCGImagePropertyExifISOSpeedRatings] as? Int {
                info.iso = "ISO \(isoValue)"
            }
            if let fl = exif[kCGImagePropertyExifFocalLength] as? Double, fl > 0 {
                info.focalLength = "\(formatG(fl))mm"
            }
            if let raw = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
                info.dateTaken = formatExifDate(raw)
            }
        }

        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
           let lat = gps[kCGImagePropertyGPSLatitude] as? Double,
           let latRef = gps[kCGImagePropertyGPSLatitudeRef] as? String,
           let lon = gps[kCGImagePropertyGPSLongitude] as? Double,
           let lonRef = gps[kCGImagePropertyGPSLongitudeRef] as? String {
            let latSigned = latRef.uppercased() == "S" ? -lat : lat
            let lonSigned = lonRef.uppercased() == "W" ? -lon : lon
            info.location = String(format: "%.5f, %.5f", latSigned, lonSigned)
        }

        info.width = props[kCGImagePropertyPixelWidth] as? Int
        info.height = props[kCGImagePropertyPixelHeight] as? Int
        // The orientation tag can swap the visual width/height for 90°/270°
        // rotations — report the dimensions as they'll actually be displayed.
        if let orientation = props[kCGImagePropertyOrientation] as? Int,
           [5, 6, 7, 8].contains(orientation),
           let w = info.width, let h = info.height {
            info.width = h
            info.height = w
        }

        return info
    }

    private static func cleaned(_ value: Any?) -> String? {
        guard let str = value as? String else { return nil }
        let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{0}")))
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Mimics Python's "{:g}" formatting — shows a real, unrounded value but
    /// trims trailing zeros (e.g. 2.0 -> "2", 2.79883 stays as-is).
    private static func formatG(_ value: Double) -> String {
        if value == value.rounded() {
            return String(Int(value))
        }
        var str = String(format: "%.6g", value)
        if str.contains(".") {
            while str.hasSuffix("0") { str.removeLast() }
            if str.hasSuffix(".") { str.removeLast() }
        }
        return str
    }

    /// "2026:07:07 20:57:10" -> "2026-07-07 20:57:10"
    private static func formatExifDate(_ raw: String) -> String {
        let parts = raw.split(separator: " ")
        guard parts.count == 2 else { return raw }
        let datePart = parts[0].replacingOccurrences(of: ":", with: "-")
        return "\(datePart) \(parts[1])"
    }
}
