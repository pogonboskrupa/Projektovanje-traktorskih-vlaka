#!/bin/bash
# Kopira web fajlove u android/app/src/main/assets/
# Pokrenuti iz korijenskog direktorija projekta: bash android/copy-assets.sh

set -e

ASSETS_DIR="android/app/src/main/assets"

rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR/geo"
mkdir -p "$ASSETS_DIR/doznaka"
mkdir -p "$ASSETS_DIR/PUTEVI"
mkdir -p "$ASSETS_DIR/static"
mkdir -p "$ASSETS_DIR/.well-known"

# Glavni fajlovi
cp index.html "$ASSETS_DIR/"
cp manifest.json "$ASSETS_DIR/"
cp sw.js "$ASSETS_DIR/"

# Ikone
cp icon-192.png "$ASSETS_DIR/"
cp icon-512.png "$ASSETS_DIR/"
cp apple-touch-icon.png "$ASSETS_DIR/"
# forwarder.png i "FORVARDER IKONA.png" (~2.3MB svaki) NAMJERNO se ne kopiraju —
# UI koristi isključivo forwarder.svg (grep "forwarder.svg" u index.html), PNG
# varijante nisu referencirane nigdje. Uklonjeno da APK ne nosi ~4.6MB viška.
cp forwarder.svg "$ASSETS_DIR/" 2>/dev/null || true

# GeoJSON / KML podaci
cp GRANICE.kml "$ASSETS_DIR/" 2>/dev/null || true
cp -r geo/* "$ASSETS_DIR/geo/" 2>/dev/null || true
cp -r doznaka/* "$ASSETS_DIR/doznaka/" 2>/dev/null || true
cp -r PUTEVI/* "$ASSETS_DIR/PUTEVI/" 2>/dev/null || true
cp -r static/* "$ASSETS_DIR/static/" 2>/dev/null || true
cp -r .well-known/* "$ASSETS_DIR/.well-known/" 2>/dev/null || true

echo "Assets kopirani u $ASSETS_DIR/"
echo "Ukupna velicina: $(du -sh $ASSETS_DIR | cut -f1)"
