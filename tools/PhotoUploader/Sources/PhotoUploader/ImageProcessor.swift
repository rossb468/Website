import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum PhotoEngineError: LocalizedError {
    case cannotReadImage(String)
    case cannotWriteImage(String)
    case postNotFound(String)

    var errorDescription: String? {
        switch self {
        case .cannotReadImage(let msg): return msg
        case .cannotWriteImage(let msg): return msg
        case .postNotFound(let slug): return "No post with slug \"\(slug)\"."
        }
    }
}

enum ImageProcessor {
    // fullMax backs the "Large" download tier (images/large/) — the biggest
    // web-optimized JPEG. It's distinct from the untouched "Full Size"
    // download, which is a verbatim copy of whatever file was uploaded.
    static let fullMax = 2400
    static let mediumMax = 1600
    static let smallMax = 800
    static let thumbSize = 720
    static let fullQuality: CGFloat = 0.88
    static let mediumQuality: CGFloat = 0.86
    static let smallQuality: CGFloat = 0.84
    static let thumbQuality: CGFloat = 0.82

    struct Processed {
        var width: Int
        var height: Int
        var fullRelativePath: String
        var thumbRelativePath: String
        var mediumRelativePath: String?
        var smallRelativePath: String?
        var originalRelativePath: String?
        var fullImage: CGImage
    }

    /// Loads, orientation-corrects, resizes, and saves the full/medium/small/
    /// thumbnail JPEGs for a photo, plus a verbatim copy of the original
    /// source file for true full-resolution downloads. Returns the processed
    /// full-size CGImage too, so the caller can extract its color palette
    /// without re-decoding the file.
    static func process(sourceURL: URL, slug: String, siteRoot: URL) throws -> Processed {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
            throw PhotoEngineError.cannotReadImage("Could not open \(sourceURL.lastPathComponent).")
        }
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let rawW = props[kCGImagePropertyPixelWidth] as? Int,
              let rawH = props[kCGImagePropertyPixelHeight] as? Int else {
            throw PhotoEngineError.cannotReadImage("Could not read dimensions for \(sourceURL.lastPathComponent).")
        }

        let longSide = max(rawW, rawH)

        // kCGImageSourceCreateThumbnailWithTransform bakes in EXIF orientation,
        // so the resulting CGImage is already display-correct — no manual
        // rotation/flip math needed.
        func orientedImage(maxPixelSize: Int) -> CGImage? {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }

        guard let fullImage = orientedImage(maxPixelSize: min(fullMax, longSide)) else {
            throw PhotoEngineError.cannotReadImage("Could not decode \(sourceURL.lastPathComponent).")
        }

        let imagesDir = siteRoot.appendingPathComponent("images", isDirectory: true)
        for sub in ["large", "thumb", "medium", "small", "original"] {
            try FileManager.default.createDirectory(at: imagesDir.appendingPathComponent(sub), withIntermediateDirectories: true)
        }

        let fullURL = imagesDir.appendingPathComponent("large/\(slug).jpg")
        try saveJPEG(fullImage, to: fullURL, quality: fullQuality)

        let squareCropped = centerCropSquare(fullImage)
        let thumbImage = scaled(squareCropped, to: thumbSize) ?? squareCropped
        try saveJPEG(thumbImage, to: imagesDir.appendingPathComponent("thumb/\(slug).jpg"), quality: thumbQuality)

        // Only generate a tier if the source is actually bigger than it —
        // upscaling would just waste disk space on a softer-looking image.
        var mediumPath: String?
        if longSide > mediumMax, let mediumImage = orientedImage(maxPixelSize: mediumMax) {
            let url = imagesDir.appendingPathComponent("medium/\(slug).jpg")
            try saveJPEG(mediumImage, to: url, quality: mediumQuality)
            mediumPath = "images/medium/\(slug).jpg"
        }

        var smallPath: String?
        if longSide > smallMax, let smallImage = orientedImage(maxPixelSize: smallMax) {
            let url = imagesDir.appendingPathComponent("small/\(slug).jpg")
            try saveJPEG(smallImage, to: url, quality: smallQuality)
            smallPath = "images/small/\(slug).jpg"
        }

        let originalExt = sourceURL.pathExtension.isEmpty ? "jpg" : sourceURL.pathExtension.lowercased()
        let originalURL = imagesDir.appendingPathComponent("original/\(slug).\(originalExt)")
        var originalPath: String?
        if (try? FileManager.default.copyItem(at: sourceURL, to: originalURL)) != nil {
            originalPath = "images/original/\(slug).\(originalExt)"
        }

        return Processed(
            width: fullImage.width,
            height: fullImage.height,
            fullRelativePath: "images/large/\(slug).jpg",
            thumbRelativePath: "images/thumb/\(slug).jpg",
            mediumRelativePath: mediumPath,
            smallRelativePath: smallPath,
            originalRelativePath: originalPath,
            fullImage: fullImage
        )
    }

    /// Generates the medium/small download tiers for a post that predates
    /// this feature, using its existing "Large" file as the source (the true
    /// original upload is gone for these older posts, so this is the best
    /// available quality — there's nothing higher-resolution left on disk).
    static func backfillDownloadSizes(fullImageURL: URL, slug: String, siteRoot: URL) -> (medium: String?, small: String?) {
        guard let source = CGImageSourceCreateWithURL(fullImageURL as CFURL, nil),
              let baseImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return (nil, nil)
        }
        let longSide = max(baseImage.width, baseImage.height)
        let imagesDir = siteRoot.appendingPathComponent("images", isDirectory: true)

        var mediumPath: String?
        if longSide > mediumMax {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: mediumMax,
            ]
            if let img = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) {
                let url = imagesDir.appendingPathComponent("medium/\(slug).jpg")
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                if (try? saveJPEG(img, to: url, quality: mediumQuality)) != nil {
                    mediumPath = "images/medium/\(slug).jpg"
                }
            }
        }

        var smallPath: String?
        if longSide > smallMax {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: smallMax,
            ]
            if let img = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) {
                let url = imagesDir.appendingPathComponent("small/\(slug).jpg")
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                if (try? saveJPEG(img, to: url, quality: smallQuality)) != nil {
                    smallPath = "images/small/\(slug).jpg"
                }
            }
        }

        return (mediumPath, smallPath)
    }

    static func centerCropSquare(_ image: CGImage) -> CGImage {
        let side = min(image.width, image.height)
        let x = (image.width - side) / 2
        let y = (image.height - side) / 2
        return image.cropping(to: CGRect(x: x, y: y, width: side, height: side)) ?? image
    }

    /// Draws `image` into a square context of `size`x`size`, ignoring aspect
    /// ratio (callers that need aspect preserved should crop first).
    static func scaled(_ image: CGImage, to size: Int) -> CGImage? {
        guard let ctx = makeContext(width: size, height: size) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        return ctx.makeImage()
    }

    private static func makeContext(width: Int, height: Int) -> CGContext? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        return CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: colorSpace, bitmapInfo: bitmapInfo
        )
    }

    static func saveJPEG(_ image: CGImage, to url: URL, quality: CGFloat) throws {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw PhotoEngineError.cannotWriteImage("Could not create \(url.lastPathComponent).")
        }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else {
            throw PhotoEngineError.cannotWriteImage("Could not write \(url.lastPathComponent).")
        }
    }
}
