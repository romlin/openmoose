#!/bin/bash
# setup-linux.sh -- Install OS-level dependencies for building OpenMoose on Linux.
set -e

echo "==> Installing Linux system dependencies..."
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
  libsoup-3.0-dev \
  libfuse2

echo "==> System dependencies installed successfully."
