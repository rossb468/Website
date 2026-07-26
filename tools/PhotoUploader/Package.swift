// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PhotoUploader",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "PhotoUploader",
            path: "Sources/PhotoUploader"
        )
    ]
)
