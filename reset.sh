#!/bin/bash

# OpenMoose Reset
# Stops containers, removes images, and wipes local data.

set -e

# Always run relative to the project root
cd "$(dirname "$0")"

# ── UI Helpers ───────────────────────────────────────────────────────────────

IND_H=""        # Header Indentation
IND_I="  "      # Item Indentation

log_header() { echo -e "${IND_H}$1"; }
log_ok()     { echo -e "${IND_I}✓ $1"; }
log_wait()   { echo -e "${IND_I}○ $1"; }
log_err()    { echo -e "${IND_I}✗ $1"; }
log_info()   { echo -e "${IND_I}· $1"; }

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│           O P E N M O O S E              │"
echo "│                 Reset                    │"
echo "╰──────────────────────────────────────────╯"
echo ""

# ── 1. Docker Containers ────────────────────────────────────────────────────

log_header "Stopping containers..."

# Stop and remove compose services if they exist
if [ -f "docker-compose.yml" ]; then
    docker compose down -v &>/dev/null || true
    log_ok "docker compose services and volumes removed"
fi

if docker inspect openmoose-browser-daemon &>/dev/null; then
    docker rm -f openmoose-browser-daemon &>/dev/null || true
    log_ok "browser daemon removed"
else
    log_info "browser daemon not running"
fi

sandbox=$(docker ps -aq --filter name=openmoose-sandbox 2>/dev/null || true)
if [ -n "$sandbox" ]; then
    docker rm -f $sandbox &>/dev/null || true
    log_ok "sandbox containers removed"
else
    log_info "no sandbox containers"
fi

# ── 2. Docker Images ────────────────────────────────────────────────────────

echo ""
log_header "Removing Docker images..."

# OpenMoose specific images
images=$(docker images --filter reference='openmoose-browser:*' -q 2>/dev/null || true)
if [ -n "$images" ]; then
    docker rmi -f $images &>/dev/null || true
    log_ok "browser image removed"
fi

# Base images used in setup.sh
base_images=(
    "debian:bookworm-slim"
    "python:3.12-slim"
    "node:22-slim"
    "mcr.microsoft.com/playwright:v1.58.0-noble"
)

for img in "${base_images[@]}"; do
    if docker image inspect "$img" &>/dev/null; then
        docker rmi -f "$img" &>/dev/null || true
        log_ok "$img removed"
    else
        log_info "$img not present"
    fi
done

# ── 3. Local Data ───────────────────────────────────────────────────────────

echo ""
log_header "Wiping local data..."

if [ -d ".moose" ]; then
    rm -rf .moose
    log_ok ".moose/ removed (memory, previews, scheduler)"
else
    log_info "no .moose/ directory"
fi

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│            Reset complete!               │"
echo "│                                          │"
echo "│  pnpm gateway   to start fresh           │"
echo "╰──────────────────────────────────────────╯"
echo ""
