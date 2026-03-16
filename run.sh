#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

INPUT_DIR="$SCRIPT_DIR/input"
OUTPUT_DIR="$SCRIPT_DIR/output"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
EXECUTABLE="$SCRIPT_DIR/BlogEngine"

echo "Cleaning output directory..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Generating site..."
"$EXECUTABLE" "$INPUT_DIR" "$OUTPUT_DIR" "$TEMPLATES_DIR"

echo ""
echo "Opening in browser..."
open "$OUTPUT_DIR/index.html"
