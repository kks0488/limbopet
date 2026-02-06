#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Unity 로컬 연동을 안정적으로 하기 위한 기본값:
# - IPv6/localhost 이슈 회피: 127.0.0.1 바인딩
# - 반복 시뮬레이션 중 외부 LLM 호출/워커로 인한 불안정성 최소화
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3001}"
export BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"

# 워커는 필요할 때만 켜기 (기본 OFF)
export LIMBOPET_WORLD_WORKER="${LIMBOPET_WORLD_WORKER:-0}"
export LIMBOPET_BRAIN_WORKER="${LIMBOPET_BRAIN_WORKER:-0}"
export LIMBOPET_BRAIN_BACKEND="${LIMBOPET_BRAIN_BACKEND:-local}"

echo "[dev-unity] HOST=$HOST PORT=$PORT BASE_URL=$BASE_URL"
echo "[dev-unity] LIMBOPET_WORLD_WORKER=$LIMBOPET_WORLD_WORKER LIMBOPET_BRAIN_WORKER=$LIMBOPET_BRAIN_WORKER LIMBOPET_BRAIN_BACKEND=$LIMBOPET_BRAIN_BACKEND"

node src/index.js

