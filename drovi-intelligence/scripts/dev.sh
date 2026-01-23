#!/bin/bash
# Development server script

set -e

cd "$(dirname "$0")/.."

echo "Starting Drovi Intelligence development server..."

# Use virtual environment
VENV_DIR=".venv"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Check if uvicorn is available, install dependencies if not
if ! command -v uvicorn &> /dev/null; then
    echo "Installing dependencies..."
    pip install --upgrade pip
    pip install -e .
fi

# Start the server with hot reload
uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000
