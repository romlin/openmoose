#!/bin/bash

# OpenMoose Reset
# Stops containers, removes images, and wipes local data.

set -e

# Always run relative to the project root
cd "$(dirname "$0")"

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │           O P E N M O O S E              │"
echo "  │                 Reset                    │"
echo "  ╰──────────────────────────────────────────╯"
echo ""

# ── 1. Docker Containers ────────────────────────────────────────────────────

echo "  Stopping containers..."

if docker inspect openmoose-browser-daemon &>/dev/null; then
    docker rm -f openmoose-browser-daemon &>/dev/null || true
    echo "    ✓ browser daemon removed"
else
    echo "    · browser daemon not running"
fi

sandbox=$(docker ps -aq --filter name=openmoose-sandbox 2>/dev/null || true)
if [ -n "$sandbox" ]; then
    docker rm -f $sandbox &>/dev/null || true
    echo "    ✓ sandbox containers removed"
else
    echo "    · no sandbox containers"
fi

# ── 2. Docker Images ────────────────────────────────────────────────────────

echo ""
echo "  Removing browser image..."

images=$(docker images --filter reference='openmoose-browser:*' -q 2>/dev/null || true)
if [ -n "$images" ]; then
    docker rmi $images &>/dev/null || true
    echo "    ✓ browser image removed"
else
    echo "    · no browser image found"
fi

# ── 3. Local Data ───────────────────────────────────────────────────────────

echo ""
echo "  Wiping local data..."

if [ -d ".moose" ]; then
    rm -rf .moose
    echo "    ✓ .moose/ removed (memory, previews, scheduler)"
else
    echo "    · no .moose/ directory"
fi

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │            Reset complete!               │"
echo "  │                                          │"
echo "  │  pnpm gateway   to start fresh           │"
echo "  ╰──────────────────────────────────────────╯"
echo ""
