#!/bin/bash
# OpenMoose Memory Reset Script

# Get the directory of the script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "🧹 Wiping OpenMoose local memory (LanceDB)..."

if [ -d ".moose/memory" ]; then
    rm -rf .moose/memory
    echo "✅ Memory directory .moose/memory removed."
else
    echo "ℹ️ No .moose/memory directory found."
fi

echo "✨ System reset complete."
