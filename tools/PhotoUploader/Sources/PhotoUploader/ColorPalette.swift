import CoreGraphics
import Foundation

/// A representative color pulled from an image, with its HSL breakdown and
/// how much of the image it covers (0...1).
struct RawSwatch {
    var r: Double
    var g: Double
    var b: Double
    var population: Double
    var h: Double
    var s: Double
    var l: Double
}

struct ColorTarget {
    var targetL: Double
    var targetS: Double
    var minL: Double
    var maxL: Double
    var minS: Double
    var maxS: Double
}

/// Android Palette API-style color extraction: bucket the image's pixels
/// into representative colors, then pick the best match for each of the
/// classic swatch roles (vibrant, muted, light/dark variants) by scoring
/// each candidate against a target lightness/saturation.
enum ColorPalette {
    static let targets: [String: ColorTarget] = [
        "vibrant": ColorTarget(targetL: 0.53, targetS: 1.00, minL: 0.30, maxL: 0.70, minS: 0.35, maxS: 1.00),
        "light_vibrant": ColorTarget(targetL: 0.74, targetS: 1.00, minL: 0.55, maxL: 1.00, minS: 0.35, maxS: 1.00),
        "dark_vibrant": ColorTarget(targetL: 0.26, targetS: 1.00, minL: 0.00, maxL: 0.45, minS: 0.35, maxS: 1.00),
        "muted": ColorTarget(targetL: 0.53, targetS: 0.30, minL: 0.30, maxL: 0.70, minS: 0.00, maxS: 0.40),
        "light_muted": ColorTarget(targetL: 0.74, targetS: 0.30, minL: 0.55, maxL: 1.00, minS: 0.00, maxS: 0.40),
        "dark_muted": ColorTarget(targetL: 0.26, targetS: 0.30, minL: 0.00, maxL: 0.45, minS: 0.00, maxS: 0.40),
    ]
    static let targetOrder = ["vibrant", "light_vibrant", "dark_vibrant", "muted", "light_muted", "dark_muted"]

    // MARK: - Sampling

    /// Downsamples the image and buckets pixels by a coarsened RGB key
    /// (16 levels/channel = 4096 buckets), approximating median-cut
    /// quantization without needing a dedicated quantizer library.
    static func extractSwatches(from image: CGImage, maxColors: Int = 32) -> [RawSwatch] {
        let sampleSize = 120
        guard let small = ImageProcessor.scaled(image, to: sampleSize),
              let data = small.dataProvider?.data,
              let ptr = CFDataGetBytePtr(data) else {
            return []
        }

        let bytesPerRow = small.bytesPerRow
        let bytesPerPixel = max(1, small.bitsPerPixel / 8)
        var buckets: [UInt32: (rSum: Double, gSum: Double, bSum: Double, count: Double)] = [:]

        for y in 0..<small.height {
            let rowStart = y * bytesPerRow
            for x in 0..<small.width {
                let offset = rowStart + x * bytesPerPixel
                guard offset + 2 < CFDataGetLength(data) else { continue }
                let r = Double(ptr[offset])
                let g = Double(ptr[offset + 1])
                let b = Double(ptr[offset + 2])

                let rq = UInt32(r) >> 4
                let gq = UInt32(g) >> 4
                let bq = UInt32(b) >> 4
                let key = (rq << 8) | (gq << 4) | bq

                var bucket = buckets[key] ?? (0, 0, 0, 0)
                bucket.rSum += r
                bucket.gSum += g
                bucket.bSum += b
                bucket.count += 1
                buckets[key] = bucket
            }
        }

        let total = buckets.values.reduce(0.0) { $0 + $1.count }
        guard total > 0 else { return [] }

        var swatches = buckets.values.map { bucket -> RawSwatch in
            let r = bucket.rSum / bucket.count
            let g = bucket.gSum / bucket.count
            let b = bucket.bSum / bucket.count
            let (h, s, l) = rgbToHsl(r / 255, g / 255, b / 255)
            return RawSwatch(r: r, g: g, b: b, population: bucket.count / total, h: h, s: s, l: l)
        }
        swatches.sort { $0.population > $1.population }
        return Array(swatches.prefix(maxColors))
    }

    // MARK: - HSL

    static func rgbToHsl(_ r: Double, _ g: Double, _ b: Double) -> (h: Double, s: Double, l: Double) {
        let maxV = max(r, g, b), minV = min(r, g, b)
        let l = (maxV + minV) / 2
        guard maxV != minV else { return (0, 0, l) }
        let d = maxV - minV
        let s = l > 0.5 ? d / (2 - maxV - minV) : d / (maxV + minV)
        var h: Double
        if maxV == r {
            h = (g - b) / d + (g < b ? 6 : 0)
        } else if maxV == g {
            h = (b - r) / d + 2
        } else {
            h = (r - g) / d + 4
        }
        h /= 6
        return (h, s, l)
    }

    static func hslToRgb(_ h: Double, _ s: Double, _ l: Double) -> (r: Double, g: Double, b: Double) {
        guard s != 0 else { return (l, l, l) }
        func hue2rgb(_ p: Double, _ q: Double, _ t: Double) -> Double {
            var t = t
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1.0 / 6 { return p + (q - p) * 6 * t }
            if t < 1.0 / 2 { return q }
            if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
            return p
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        return (hue2rgb(p, q, h + 1.0 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3))
    }

    // MARK: - Target scoring

    static func score(_ sw: RawSwatch, _ t: ColorTarget) -> Double? {
        guard t.minL <= sw.l, sw.l <= t.maxL else { return nil }
        guard t.minS <= sw.s, sw.s <= t.maxS else { return nil }
        return (1 - abs(sw.s - t.targetS)) * 3 + (1 - abs(sw.l - t.targetL)) * 3 + sw.population * 2
    }

    static func pickTarget(_ swatches: [RawSwatch], key: String) -> RawSwatch? {
        guard let t = targets[key] else { return nil }
        var best: RawSwatch?
        var bestScore = -1.0
        for sw in swatches {
            if let sc = score(sw, t), sc > bestScore {
                best = sw
                bestScore = sc
            }
        }
        return best
    }

    /// Re-derives a swatch's hue at a fixed, safely-dark lightness. Used for
    /// ambient backgrounds so the page stays legible no matter how light or
    /// saturated the source photo's palette is (same idea as Spotify/Apple
    /// Music's now-playing backdrop: always dark, never washed out).
    static func clampLightness(_ sw: RawSwatch, targetL: Double, maxS: Double = 0.60) -> RawSwatch {
        let s2 = min(sw.s, maxS)
        let (r, g, b) = hslToRgb(sw.h, s2, targetL)
        return RawSwatch(r: r * 255, g: g * 255, b: b * 255, population: sw.population, h: sw.h, s: s2, l: targetL)
    }

    // MARK: - Output formatting

    static func hex(_ r: Double, _ g: Double, _ b: Double) -> String {
        func clamp(_ v: Double) -> Int { max(0, min(255, Int(v.rounded()))) }
        return String(format: "#%02x%02x%02x", clamp(r), clamp(g), clamp(b))
    }

    static func relativeLuminance(_ r: Double, _ g: Double, _ b: Double) -> Double {
        func chan(_ c: Double) -> Double {
            let cc = c / 255
            return cc <= 0.03928 ? cc / 12.92 : pow((cc + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
    }

    static func contrastText(_ r: Double, _ g: Double, _ b: Double) -> String {
        relativeLuminance(r, g, b) > 0.5 ? "#1a1a1a" : "#f5f5f5"
    }

    static func swatchOut(_ sw: RawSwatch) -> Swatch {
        Swatch(
            hex: hex(sw.r, sw.g, sw.b),
            rgb: [Int(sw.r.rounded()), Int(sw.g.rounded()), Int(sw.b.rounded())],
            text: contrastText(sw.r, sw.g, sw.b)
        )
    }

    // MARK: - Full palette

    static func buildPalette(from image: CGImage) -> Palette {
        let swatches = extractSwatches(from: image)
        guard let dominant = swatches.first else { return Palette() }

        var picks: [String: RawSwatch] = ["dominant": dominant]
        for key in targetOrder {
            if let sw = pickTarget(swatches, key: key) {
                picks[key] = sw
            }
        }

        var palette = Palette()
        palette.dominant = swatchOut(dominant)
        palette.vibrant = picks["vibrant"].map(swatchOut)
        palette.light_vibrant = picks["light_vibrant"].map(swatchOut)
        palette.dark_vibrant = picks["dark_vibrant"].map(swatchOut)
        palette.muted = picks["muted"].map(swatchOut)
        palette.light_muted = picks["light_muted"].map(swatchOut)
        palette.dark_muted = picks["dark_muted"].map(swatchOut)

        let bg1Src = picks["dark_muted"] ?? picks["dark_vibrant"] ?? dominant
        let bg2Src = picks["dark_vibrant"] ?? picks["muted"] ?? picks["vibrant"] ?? dominant
        let accentSrc = picks["vibrant"] ?? picks["light_vibrant"] ?? dominant

        let bg1 = clampLightness(bg1Src, targetL: 0.14)
        let bg2 = clampLightness(bg2Src, targetL: 0.28)
        let accent = clampLightness(accentSrc, targetL: 0.68, maxS: 0.75)

        palette.ambient = Ambient(
            bg1: hex(bg1.r, bg1.g, bg1.b),
            bg2: hex(bg2.r, bg2.g, bg2.b),
            accent: hex(accent.r, accent.g, accent.b),
            text: "#f5f5f5"
        )

        return palette
    }
}
