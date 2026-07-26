#!/bin/bash
# Builds PhotoUploader.app — a real, double-clickable macOS app bundle —
# from this Swift package. Run this after making changes to the app.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building (release)…"
swift build -c release

APP="PhotoUploader.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp ".build/release/PhotoUploader" "$APP/Contents/MacOS/PhotoUploader"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>PhotoUploader</string>
    <key>CFBundleIdentifier</key>
    <string>com.rossbower.photouploader</string>
    <key>CFBundleName</key>
    <string>Photo Uploader</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# Ad-hoc sign so Gatekeeper doesn't complain about an unsigned local build.
codesign --force --deep --sign - "$APP"

echo "Built $APP"
