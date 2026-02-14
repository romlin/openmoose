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

echo ""
echo "Done! Verified binaries in: app/src-tauri/target/release/bundle/"
