#!/bin/bash
# build-linux.sh -- Simple entry point for a full end-to-end Linux build.
set -e

# 1. Provision the environment (OS libs) - Only if --provision flag is passed
if [[ "$*" == *"--provision"* ]]; then
  pnpm setup:linux
else
  echo "==> Skipping system provisioning (use --provision to install OS deps)"
fi

# 2. Build and bundle the app
pnpm dist

# 3. Install the .deb
DEB_DIR="app/src-tauri/target/release/bundle/deb"
DEB=$(echo "$DEB_DIR"/*.deb)
if [[ ! -f "$DEB" ]]; then
  echo "Error: No .deb found in $DEB_DIR"
  exit 1
fi
echo ""
echo "==> Installing $DEB"
sudo dpkg -i "$DEB"
sudo apt-get install -f -y 2>/dev/null || true

echo ""
echo "==> Launching openmoose..."
openmoose
