#!/bin/bash

# OpenMoose Setup
# Pulls Docker images, AI models, TTS weights, and installs dependencies.

set -e

# Always run relative to the project root
cd "$(dirname "$0")"

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │           O P E N M O O S E              │"
echo "  │                 Setup                    │"
echo "  ╰──────────────────────────────────────────╯"
echo ""

# ── Prerequisites ────────────────────────────────────────────────────────────

missing=()
command -v docker &>/dev/null || missing+=("docker  → https://docs.docker.com/get-docker/")
command -v pnpm   &>/dev/null || missing+=("pnpm    → https://pnpm.io/installation")
command -v curl   &>/dev/null || missing+=("curl    → sudo apt install curl")
command -v bc     &>/dev/null || missing+=("bc      → sudo apt install bc")

if [[ ${#missing[@]} -gt 0 ]]; then
    echo "  Missing prerequisites:"
    for m in "${missing[@]}"; do
        echo "    ✗ $m"
    done
    echo ""
    echo "  Install the required tools above and re-run setup.sh"
    exit 1
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

# download_with_progress <url> <dest_path> <label>
download_with_progress() {
    local url="$1"
    local dest="$2"
    local label="$3"
    local dir=$(dirname "$dest")

    mkdir -p "$dir"

    # Get total size (following redirects)
    local total_bytes=$(curl -sLI "$url" | grep -i Content-Length | tail -n1 | awk '{print $2}' | tr -d '\r')
    local total_gb=$(echo "scale=2; $total_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "??")

    echo "  Downloading $label..."
    
    # Start download in background
    curl -fLC - "$url" -o "$dest" -s &
    local curl_pid=$!
    local start_time=$(date +%s)

    # Progress loop
    while kill -0 $curl_pid 2>/dev/null; do
        local current_bytes=$(stat -c%s "$dest" 2>/dev/null || echo 0)
        local now=$(date +%s)
        local elapsed=$((now - start_time))
        
        if [ "$elapsed" -gt 0 ] && [ "$total_bytes" -gt 0 ]; then
            local percent=$((current_bytes * 100 / total_bytes))
            local current_gb=$(echo "scale=2; $current_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "0")
            local speed_bps=$((current_bytes / elapsed))
            local speed_mbs=$(echo "scale=1; $speed_bps / 1024 / 1024" | bc 2>/dev/null || echo "0")
            
            # Estimate remaining time
            local remaining_bytes=$((total_bytes - current_bytes))
            if [ "$speed_bps" -gt 0 ]; then
                local eta_sec=$((remaining_bytes / speed_bps))
                local eta_min=$((eta_sec / 60))
                local eta_sec_rem=$((eta_sec % 60))
                local eta_str="${eta_min}m ${eta_sec_rem}s"
            else
                local eta_str="--"
            fi
            
            printf "\r    ○ %s / %s GB (%d%%) · %s MB/s · %s rem.   " "$current_gb" "$total_gb" "$percent" "$speed_mbs" "$eta_str"
        fi
        sleep 1
    done
    wait $curl_pid
    
    if [ $? -eq 0 ]; then
        printf "\r    ✓ %s / %s GB (100%%) · Download complete                     \n" "$total_gb" "$total_gb"
    else
        echo -e "\n    ✗ $label download failed"
        return 1
    fi
}

# ── 1. Docker Images (parallel) ─────────────────────────────────────────────

echo "  Pulling Docker images (parallel)..."

images=(
    "debian:bookworm-slim"
    "python:3.12-slim"
    "node:22-slim"
    "mcr.microsoft.com/playwright:v1.58.0-noble"
)

pids=()
for img in "${images[@]}"; do
    docker pull "$img" &>/dev/null &
    pids+=($!)
done

failed=0
for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
        echo "    ✓ ${images[$i]}"
    else
        echo "    ✗ ${images[$i]} (failed)"
        failed=1
    fi
done

if [[ $failed -eq 1 ]]; then
    echo "  Warning: some images failed to pull. Browser/sandbox features may not work."
fi

# ── 2. LLM Model (GGUF) ────────────────────────────────────────────────────

echo ""
LLM_FILE="models/llama-cpp/ministral-8b-reasoning-q4km.gguf"
LLM_URL="https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512-GGUF/resolve/main/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf"

if [ -f "$LLM_FILE" ] && [ $(stat -c%s "$LLM_FILE") -gt 1000000000 ]; then
    echo "  ✓ Local LLM model already present"
else
    download_with_progress "$LLM_URL" "$LLM_FILE" "Ministral-8B Reasoning (integrated)"
fi

# ── 3. TTS Model ────────────────────────────────────────────────────────────

echo ""
if [ -d "models/supertonic" ]; then
    echo "  ✓ TTS model already present"
else
    echo "  Cloning Supertonic 2 TTS model..."
    if ! command -v git-lfs &>/dev/null; then
        echo "    ✗ git-lfs required: brew install git-lfs (macOS) or apt install git-lfs (Linux)"
        echo "    Skipping TTS setup."
    else
        git lfs install --skip-smudge &>/dev/null
        if git clone https://huggingface.co/Supertone/supertonic-2 models/supertonic &>/dev/null; then
            echo "    ✓ Supertonic 2"
        else
            echo "    ✗ TTS clone failed"
        fi
    fi
fi

# ── 4. Node Dependencies ────────────────────────────────────────────────────

echo ""
echo "  Installing dependencies..."
pnpm install --silent
echo "    ✓ pnpm install"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │            Setup complete!               │"
echo "  │                                          │"
echo "  │  1. cp .env.example .env                 │"
echo "  │  2. pnpm gateway        (terminal 1)     │"
echo "  │  3. pnpm dev talk       (terminal 2)     │"
echo "  ╰──────────────────────────────────────────╯"
echo ""
