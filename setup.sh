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
command -v docker &>/dev/null  || missing+=("docker  → https://docs.docker.com/get-docker/")
command -v pnpm   &>/dev/null  || missing+=("pnpm    → https://pnpm.io/installation")
command -v ollama &>/dev/null  || missing+=("ollama  → https://ollama.com (optional, needed for local LLM)")

if [[ ${#missing[@]} -gt 0 ]]; then
    echo "  Missing prerequisites:"
    for m in "${missing[@]}"; do
        echo "    ✗ $m"
    done
    # ollama is optional -- only hard-fail on docker/pnpm
    if ! command -v docker &>/dev/null || ! command -v pnpm &>/dev/null; then
        echo ""
        echo "  Install the required tools above and re-run setup.sh"
        exit 1
    fi
    echo ""
fi

# ── 1. Docker Images (parallel) ─────────────────────────────────────────────

echo "  Pulling Docker images (parallel)..."

images=(
    "debian:bookworm-slim"
    "python:3.12-slim"
    "node:22-slim"
    "mcr.microsoft.com/playwright:v1.49.0-noble"
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

# ── 2. Ollama Models (parallel) ─────────────────────────────────────────────

if command -v ollama &>/dev/null; then
    echo ""
    echo "  Pulling Ollama models..."

    ollama pull ministral-3:3b  &>/dev/null &
    pid_llm=$!
    ollama pull nomic-embed-text &>/dev/null &
    pid_embed=$!

    if wait $pid_llm;   then echo "    ✓ ministral-3:3b";   else echo "    ✗ ministral-3:3b (failed)";   fi
    if wait $pid_embed;  then echo "    ✓ nomic-embed-text"; else echo "    ✗ nomic-embed-text (failed)"; fi
else
    echo ""
    echo "  Skipping Ollama models (ollama not installed)"
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
