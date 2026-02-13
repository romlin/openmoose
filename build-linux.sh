#!/bin/bash
set -e

echo "Starting OpenMoose Linux Build..."

# 1. Install system dependencies if needed
echo "Checking system dependencies..."
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  librsvg2-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev

# 2. Build the Gateway first
echo "Building AI Gateway..."
pnpm build

# 3. Build the Tauri Desktop App
echo "Building Desktop App (Release mode)..."
cd app
pnpm install
pnpm tauri build

echo "Build Complete!"
echo "Your Linux binaries are located in: app/src-tauri/target/release/bundle/"
echo "   - .AppImage (Portable)"
echo "   - .deb (Debian/Ubuntu Installer)"
