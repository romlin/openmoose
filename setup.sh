#!/bin/bash

# OpenMoose Setup
# Pulls Docker images, AI models, TTS weights, and installs dependencies.

set -e

# Always run relative to the project root
cd "$(dirname "$0")"

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│           O P E N M O O S E              │"
echo "│                 Setup                    │"
echo "╰──────────────────────────────────────────╯"
echo ""

# ── Prerequisites ────────────────────────────────────────────────────────────

missing=()
command -v docker &>/dev/null || missing+=("docker  → https://docs.docker.com/get-docker/")
command -v pnpm   &>/dev/null || missing+=("pnpm    → https://pnpm.io/installation")
command -v curl   &>/dev/null || missing+=("curl    → sudo apt install curl")
command -v bc     &>/dev/null || missing+=("bc      → sudo apt install bc")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing prerequisites:"
  for m in "${missing[@]}"; do
    echo "  ✗ $m"
  done
  echo ""
  echo "Install the required tools above and re-run setup.sh"
  exit 1
fi

# ── UI Helpers ───────────────────────────────────────────────────────────────

IND_H=""        # Header Indentation
IND_I="  "      # Item Indentation

log_header() { echo -e "${IND_H}$1"; }
log_ok()     { echo -e "${IND_I}✓ $1"; }
log_wait()   { echo -e "${IND_I}○ $1"; }
log_err()    { echo -e "${IND_I}✗ $1"; }

# ── Helpers ──────────────────────────────────────────────────────────────────

# download_with_progress <url> <dest_path> <label>
download_with_progress() {
  local url="$1"
  local dest="$2"
  local label="$3"
  local dir=$(dirname "$dest")

  mkdir -p "$dir"

  # Get total size (following redirects); default to 0 if empty/non-numeric
  local total_bytes=$(curl -sLI "$url" | grep -i Content-Length | tail -n1 | awk '{print $2}' | tr -d '\r')
  total_bytes="${total_bytes:-0}"
  if ! [[ $total_bytes =~ ^[0-9]+$ ]]; then total_bytes=0; fi
  local total_gb=$(echo "scale=2; $total_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "??")

  log_header "Downloading $label..."
  
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
      
      printf "\r${IND_I}○ %s / %s GB (%d%%) · %s MB/s · %s rem.   " "$current_gb" "$total_gb" "$percent" "$speed_mbs" "$eta_str"
    fi
    sleep 1
  done
  wait $curl_pid
  
  if [ $? -eq 0 ]; then
    printf "\r${IND_I}✓ %s / %s GB (100%%) · Download complete                     \n" "$total_gb" "$total_gb"
  else
    echo -e "\n${IND_I}✗ $label download failed"
    return 1
  fi
}

# ── 1. Docker Images ─────────────────────────────────────────────────────────

log_header "Pulling Docker base images (parallel)..."

small_images=(
  "debian:bookworm-slim"
  "python:3.12-slim"
  "node:22-slim"
)

pids=()
for img in "${small_images[@]}"; do
  if docker image inspect "$img" &>/dev/null; then
    log_ok "$img"
  else
    log_wait "$img (pulling...)"
    docker pull "$img" &>/dev/null &
    pids+=($!)
  fi
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done

if [[ $failed -eq 1 ]]; then
  log_err "some base images failed to pull"
fi

echo ""
log_header "Pulling Playwright image (large, progress shown)..."
playwright_img="mcr.microsoft.com/playwright:v1.58.0-noble"

if docker image inspect "$playwright_img" &>/dev/null; then
  log_ok "$playwright_img"
else
  if docker pull "$playwright_img"; then
    log_ok "$playwright_img"
  else
    log_err "$playwright_img (failed)"
    failed=1
  fi
fi

if [[ $failed -eq 1 ]]; then
  echo "Warning: some images failed to pull. Browser/sandbox features may not work."
fi

echo ""
log_header "Downloading LLM Model..."
LLM_FILE="models/llama-cpp/ministral-8b-reasoning-q4km.gguf"
LLM_URL="https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512-GGUF/resolve/main/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf"

if [ -f "$LLM_FILE" ] && [ "$(stat -c%s "$LLM_FILE")" -gt 1000000000 ]; then
  log_ok "Local LLM model already present"
else
  download_with_progress "$LLM_URL" "$LLM_FILE" "Ministral-8B Reasoning (integrated)"
fi

# ── 3. TTS Model ────────────────────────────────────────────────────────────

echo ""
log_header "Setting up TTS Model..."
if [ -d "models/supertonic" ]; then
  log_ok "TTS model already present"
else
  log_wait "Cloning Supertonic 2 TTS model..."
  if ! command -v git-lfs &>/dev/null; then
    log_err "git-lfs required: brew install git-lfs (macOS) or apt install git-lfs (Linux)"
    log_wait "Skipping TTS setup."
  else
    git lfs install --skip-smudge &>/dev/null
    if git clone https://huggingface.co/Supertone/supertonic-2 models/supertonic &>/dev/null; then
      log_ok "Supertonic 2"
    else
      log_err "TTS clone failed"
    fi
  fi
fi

# ── 4. Node Dependencies ────────────────────────────────────────────────────

echo ""
log_header "Installing dependencies..."
pnpm install --silent
log_ok "pnpm install"

# ── 5. Embedding Model ──────────────────────────────────────────────────────

echo ""
log_header "Pre-downloading embedding model..."
EMBED_MODEL="Xenova/all-MiniLM-L6-v2"

if npx --yes tsx -e "
  const { pipeline } = await import('@huggingface/transformers');
  await pipeline('feature-extraction', '$EMBED_MODEL', { dtype: 'fp32' });
  console.log('ok');
" 2>/dev/null | grep -q "ok"; then
  log_ok "$EMBED_MODEL"
else
  log_err "Embedding model download failed (gateway will retry on first run)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│            Setup complete!               │"
echo "│                                          │"
echo "│  1. cp .env.example .env                 │"
echo "│  2. pnpm gateway        (terminal 1)     │"
echo "│  3. pnpm dev talk       (terminal 2)     │"
echo "╰──────────────────────────────────────────╯"
echo ""
