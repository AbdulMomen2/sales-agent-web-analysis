#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
