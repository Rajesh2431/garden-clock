#!/usr/bin/env bash
# Generate the raster app icons from the vector source.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
art="$root/scripts/art"
out="$root/public"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for command in rsvg-convert magick; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install librsvg and ImageMagick." >&2
    exit 1
  fi
done

mkdir -p "$out"

rsvg-convert -w 192 -h 192 "$art/icon.svg" -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 "$art/icon.svg" -o "$out/icon-512.png"
rsvg-convert -w 180 -h 180 "$art/icon.svg" -o "$out/apple-touch-icon.png"

# Maskable icons need their artwork inside the central safe circle. Keep the
# full black canvas and shrink the mark to 82 percent before compositing it.
rsvg-convert -w 420 -h 420 "$art/icon.svg" -o "$tmp/mark.png"
magick "$tmp/mark.png" -background '#000000' -gravity center -extent 512x512 \
  -strip -define png:compression-level=9 "$out/icon-maskable-512.png"

echo "Wrote icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png"
