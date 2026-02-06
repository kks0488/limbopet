#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[limbopet] root: ${ROOT_DIR}"

cd "${ROOT_DIR}"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  echo "[limbopet] created .env from .env.example"
fi

if [[ ! -f "${ROOT_DIR}/apps/api/.env" ]]; then
  cp "${ROOT_DIR}/apps/api/.env.example" "${ROOT_DIR}/apps/api/.env"
  echo "[limbopet] created apps/api/.env from apps/api/.env.example"
fi

if [[ ! -f "${ROOT_DIR}/apps/web/.env" ]]; then
  echo "VITE_API_URL=http://127.0.0.1:3001/api/v1" > "${ROOT_DIR}/apps/web/.env"
  echo "[limbopet] created apps/web/.env (Vite env)"
fi

# Keep Vite env in sync (beginner-friendly OAuth).
if [[ -f "${ROOT_DIR}/apps/web/.env" ]]; then
  # Ensure API URL exists (or replace).
  tmpfile="$(mktemp)"
  awk '
    BEGIN { found=0 }
    /^VITE_API_URL=/ { print "VITE_API_URL=http://127.0.0.1:3001/api/v1"; found=1; next }
    { print }
    END { if (!found) print "VITE_API_URL=http://127.0.0.1:3001/api/v1" }
  ' "${ROOT_DIR}/apps/web/.env" > "${tmpfile}"
  mv "${tmpfile}" "${ROOT_DIR}/apps/web/.env"

  # Sync Google Client ID (optional).
  google_client_id="$( (grep -E '^GOOGLE_OAUTH_CLIENT_ID=' "${ROOT_DIR}/.env" 2>/dev/null || true) | tail -n 1 | sed 's/^GOOGLE_OAUTH_CLIENT_ID=//')"
  tmpfile="$(mktemp)"
  awk -v cid="${google_client_id}" '
    BEGIN { found=0 }
    /^VITE_GOOGLE_CLIENT_ID=/ {
      found=1;
      if (cid != "") print "VITE_GOOGLE_CLIENT_ID=" cid;
      next
    }
    { print }
    END {
      if (!found && cid != "") print "VITE_GOOGLE_CLIENT_ID=" cid
    }
  ' "${ROOT_DIR}/apps/web/.env" > "${tmpfile}"
  mv "${tmpfile}" "${ROOT_DIR}/apps/web/.env"
fi

# Sync API env (so Google OAuth works without hunting multiple files).
if [[ -f "${ROOT_DIR}/apps/api/.env" ]]; then
  google_client_id="$( (grep -E '^GOOGLE_OAUTH_CLIENT_ID=' "${ROOT_DIR}/.env" 2>/dev/null || true) | tail -n 1 | sed 's/^GOOGLE_OAUTH_CLIENT_ID=//')"
  if [[ -n "${google_client_id}" ]]; then
    tmpfile="$(mktemp)"
    awk -v cid="${google_client_id}" '
      BEGIN { found=0 }
      /^GOOGLE_OAUTH_CLIENT_ID=/ { print "GOOGLE_OAUTH_CLIENT_ID=" cid; found=1; next }
      { print }
      END { if (!found) print "GOOGLE_OAUTH_CLIENT_ID=" cid }
    ' "${ROOT_DIR}/apps/api/.env" > "${tmpfile}"
    mv "${tmpfile}" "${ROOT_DIR}/apps/api/.env"
  fi

  google_client_secret="$( (grep -E '^GOOGLE_OAUTH_CLIENT_SECRET=' "${ROOT_DIR}/.env" 2>/dev/null || true) | tail -n 1 | sed 's/^GOOGLE_OAUTH_CLIENT_SECRET=//')"
  if [[ -n "${google_client_secret}" ]]; then
    tmpfile="$(mktemp)"
    awk -v sec="${google_client_secret}" '
      BEGIN { found=0 }
      /^GOOGLE_OAUTH_CLIENT_SECRET=/ { print "GOOGLE_OAUTH_CLIENT_SECRET=" sec; found=1; next }
      { print }
      END { if (!found) print "GOOGLE_OAUTH_CLIENT_SECRET=" sec }
    ' "${ROOT_DIR}/apps/api/.env" > "${tmpfile}"
    mv "${tmpfile}" "${ROOT_DIR}/apps/api/.env"
  fi

  web_url="$( (grep -E '^LIMBOPET_WEB_URL=' "${ROOT_DIR}/.env" 2>/dev/null || true) | tail -n 1 | sed 's/^LIMBOPET_WEB_URL=//')"
  if [[ -n "${web_url}" ]]; then
    tmpfile="$(mktemp)"
    awk -v u="${web_url}" '
      BEGIN { found=0 }
      /^LIMBOPET_WEB_URL=/ { print "LIMBOPET_WEB_URL=" u; found=1; next }
      { print }
      END { if (!found) print "LIMBOPET_WEB_URL=" u }
    ' "${ROOT_DIR}/apps/api/.env" > "${tmpfile}"
    mv "${tmpfile}" "${ROOT_DIR}/apps/api/.env"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[limbopet] docker not found. Install Docker Desktop or provide a Postgres at DATABASE_URL."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[limbopet] Docker daemon not running. Start Docker Desktop, then re-run:"
  echo "  open -a Docker"
  echo "  ${ROOT_DIR}/scripts/dev.sh"
  exit 1
fi

is_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -n -P -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi
  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 "${port}" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

choose_db_port() {
  local base_port="${1:-5432}"
  for p in "${base_port}" 5433 5434 5435 5436 5437; do
    if ! is_port_in_use "${p}"; then
      echo "${p}"
      return 0
    fi
  done
  echo "${base_port}"
  return 0
}

choose_web_port() {
  local base_port="${1:-5173}"
  for p in "${base_port}" 5174 5175 5176 5177 5178 5179 5180; do
    if ! is_port_in_use "${p}"; then
      echo "${p}"
      return 0
    fi
  done
  echo "${base_port}"
  return 0
}

existing_mapping="$(docker compose port db 5432 2>/dev/null || true)"
existing_port=""
if [[ -n "${existing_mapping}" ]]; then
  existing_port="$(echo "${existing_mapping}" | tail -n 1 | sed 's/.*://')"
fi

DB_PORT="${existing_port:-$(choose_db_port 5432)}"
export LIMBOPET_DB_PORT="${DB_PORT}"
DATABASE_URL_OVERRIDE="postgresql://postgres:postgres@localhost:${DB_PORT}/limbopet"

if [[ "${DB_PORT}" != "5432" ]]; then
  echo "[limbopet] port 5432 is busy; using ${DB_PORT} for Postgres (set LIMBOPET_DB_PORT=${DB_PORT})"
fi

echo "[limbopet] starting db..."
docker compose up -d db

echo "[limbopet] waiting for db..."
timeout_s=60
start_ts=$(date +%s)
until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do
  now_ts=$(date +%s)
  if (( now_ts - start_ts > timeout_s )); then
    echo "[limbopet] db did not become ready in ${timeout_s}s"
    exit 1
  fi
  sleep 0.5
done

WEB_PORT="$(choose_web_port 5173)"
WEB_URL_OVERRIDE="http://localhost:${WEB_PORT}"
if [[ "${WEB_PORT}" != "5173" ]]; then
  echo "[limbopet] port 5173 is busy; using ${WEB_PORT} for web"
fi

echo "[limbopet] installing api deps..."
(cd "${ROOT_DIR}/apps/api" && npm install >/dev/null)

echo "[limbopet] migrating db..."
(cd "${ROOT_DIR}/apps/api" && DATABASE_URL="${DATABASE_URL_OVERRIDE}" npm run db:migrate) || (
  echo "[limbopet] migration failed; resetting local db volume (dev only)..."
  docker compose down -v
  docker compose up -d db
  echo "[limbopet] waiting for db..."
  timeout_s=60
  start_ts=$(date +%s)
  until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do
    now_ts=$(date +%s)
    if (( now_ts - start_ts > timeout_s )); then
      echo "[limbopet] db did not become ready in ${timeout_s}s"
      exit 1
    fi
    sleep 0.5
  done
  cd "${ROOT_DIR}/apps/api"
  DATABASE_URL="${DATABASE_URL_OVERRIDE}" npm run db:migrate
)

echo "[limbopet] starting api..."
(cd "${ROOT_DIR}/apps/api" && DATABASE_URL="${DATABASE_URL_OVERRIDE}" LIMBOPET_WEB_URL="${WEB_URL_OVERRIDE}" npm run dev) &
API_PID=$!
WEB_PID=""

cleanup() {
  echo ""
  echo "[limbopet] shutting down..."
  kill "${API_PID}" >/dev/null 2>&1 || true
  if [[ -n "${WEB_PID}" ]]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "[limbopet] waiting for api..."
timeout_s=60
start_ts=$(date +%s)
until curl -fsS "http://localhost:3001/api/v1/health" >/dev/null 2>&1; do
  now_ts=$(date +%s)
  if (( now_ts - start_ts > timeout_s )); then
    echo "[limbopet] api did not become ready in ${timeout_s}s"
    exit 1
  fi
  sleep 0.5
done

echo "[limbopet] starting web..."
(cd "${ROOT_DIR}/apps/web" && npm install >/dev/null && npm run dev -- --port "${WEB_PORT}" --strictPort) &
WEB_PID=$!
echo "[limbopet] web: http://localhost:${WEB_PORT}"

echo "[limbopet] ready."
echo "[limbopet] next:"
echo "  open http://localhost:${WEB_PORT}"
echo ""
echo "[limbopet] note:"
echo "  If you configured server-side brain worker (router) and connected a brain in the UI,"
echo "  dialogue/diary/daily summary will be generated automatically using the user's own credentials."
echo "  Otherwise, run the local brain runner in another terminal (advanced):"
echo "    cd ${ROOT_DIR}/apps/brain && source .venv/bin/activate && python -m limbopet_brain run"

wait
