#!/bin/bash
# bundle-gateway.sh -- Compile the gateway and bundle it as Tauri resources.
# Used by both build-linux.sh and CI workflows.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$REPO_ROOT/app/src-tauri/resources/gateway"

echo "==> Compiling Gateway (tsc)..."
cd "$REPO_ROOT"
npx tsc

echo "==> Preparing resource directory..."
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy compiled JS output
cp -r "$REPO_ROOT/dist/"* "$RESOURCES_DIR/"

# Copy package.json (needed for ESM "type": "module" resolution)
cp "$REPO_ROOT/package.json" "$RESOURCES_DIR/package.json"

# Install production-only dependencies into the resource directory
# Optimization: Skip if node_modules already exists unless --force is used
FORCE_INSTALL=false
if [[ "$*" == *"-f"* || "$*" == *"--force"* ]]; then
  FORCE_INSTALL=true
fi

if [ -d "$RESOURCES_DIR/node_modules" ] && [ "$FORCE_INSTALL" = false ]; then
  echo "==> Skipping dependency install (node_modules exists, use --force to override)"
else
  echo "==> Installing production dependencies..."
  cd "$RESOURCES_DIR"
  # Use npm for the production bundle as it's more reliable for standalone installs
  npm install --omit=dev --no-package-lock --no-audit --no-fund --ignore-scripts
fi

# Prune unnecessary files to reduce bundle size (from 1.3GB+)
echo "==> Pruning bundle size..."
find . -type f -name "*.dll" -delete
find . -type f -name "*.exe" -delete
find . -type f -name "*.dylib" -delete
find . -type d -name "docs" -exec rm -rf {} +
find . -type d -name "documentation" -exec rm -rf {} +

# Ultra-Pruning: Remove non-essential code/assets that bloat the bundle
echo "==> Ultra-Pruning non-essential files..."
find . -type f -name "*.map" -delete
find . -type f -name "*.ts" -delete
find . -type f -name "*.md" -delete
find . -type f -name "*.txt" -delete
find . -type f -name "LICENSE*" -delete
find . -type f -name "README*" -delete

# Intelligent Pruning: Keep only binaries for the current platform/arch
echo "==> Pruning platform-specific AI binaries..."
CURRENT_OS="linux"
if [[ "$OSTYPE" == "darwin"* ]]; then
  CURRENT_OS="darwin"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  CURRENT_OS="win32"
fi

# Detect architecture
ARCH="x64"
if [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "aarch64" ]]; then
  ARCH="arm64"
fi

echo "    - Build Target: $CURRENT_OS-$ARCH"

# Remove everything from @node-llama-cpp that DOES NOT match our current OS
# This ensures that Mac builds keep Metal/MPS, Windows keeps CUDA, and Linux keeps Vulkan/CUDA.
find node_modules/@node-llama-cpp -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
    dirname=$(basename "$dir")
    if [[ "$dirname" != "$CURRENT_OS"* ]]; then
        rm -rf "$dir"
    fi
done

# Secondary filter: if we are on linux-x64, we can still remove arm versions
if [ "$CURRENT_OS" == "linux" ] && [ "$ARCH" == "x64" ]; then
    rm -rf node_modules/@node-llama-cpp/linux-arm*
fi

# Specific pruning for heavy packages (be careful with node-llama-cpp)
rm -rf node_modules/typescript
rm -rf node_modules/onnxruntime-node/test
rm -rf node_modules/onnxruntime-web # Slim down as we use node-native version

# Clean up broken symlinks in .bin (crucial for Tauri resource bundling)
echo "    - Cleaning broken symlinks..."
find node_modules/.bin -xtype l -delete

# Copy browser daemon files (required by BrowserManager)
if [ -d "$REPO_ROOT/src/runtime/browser" ]; then
  mkdir -p "$RESOURCES_DIR/runtime/browser"
  cp "$REPO_ROOT/src/runtime/browser/daemon.js" "$RESOURCES_DIR/runtime/browser/" 2>/dev/null || true
  cp "$REPO_ROOT/src/runtime/browser/Dockerfile" "$RESOURCES_DIR/runtime/browser/" 2>/dev/null || true
fi

# Copy portable skills directory (required for production parity)
if [ -d "$REPO_ROOT/skills" ]; then
  echo "==> Copying skills directory..."
  cp -r "$REPO_ROOT/skills" "$RESOURCES_DIR/"
fi

echo "==> Gateway bundled into: $RESOURCES_DIR"
echo "    New Contents Size: $(du -sh "$RESOURCES_DIR" | cut -f1)"
