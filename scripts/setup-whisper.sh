#!/usr/bin/env bash
# Creates a Python virtualenv for the WhisperX server and installs its
# requirements. Run automatically by `npm install` via the root postinstall.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="$ROOT/packages/transcriber/whisper"
VENV_DIR="$WHISPER_DIR/.venv"
REQUIREMENTS="$WHISPER_DIR/requirements.txt"

PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ ! -f "$REQUIREMENTS" ]; then
  echo "[setup-whisper] requirements.txt not found at $REQUIREMENTS"
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "[setup-whisper] creating virtualenv at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  echo "[setup-whisper] venv python not found at $VENV_PYTHON"
  exit 1
fi

echo "[setup-whisper] installing requirements into venv"
"$VENV_PYTHON" -m pip install --upgrade pip
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"

echo "[setup-whisper] done"
