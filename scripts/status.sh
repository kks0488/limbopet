#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[limbopet] status"
echo "[limbopet] root: ${ROOT_DIR}"
echo ""

docker_ok=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker_ok=1
fi

if (( docker_ok )); then
  mapping="$(docker compose port db 5432 2>/dev/null || true)"
  if [[ -n "${mapping}" ]]; then
    echo "[db] up: ${mapping}"
  else
    echo "[db] down (run: ./scripts/dev.sh)"
  fi
else
  echo "[db] docker not running (run: open -a Docker)"
fi

api_url="http://localhost:3001/api/v1/health"
if curl -fsS "${api_url}" >/dev/null 2>&1; then
  echo "[api] up: ${api_url}"
else
  echo "[api] down (run: ./scripts/dev.sh)"
fi

web_url=""
for p in 5173 5174 5175 5176 5177 5178 5179 5180; do
  candidate="http://localhost:${p}"
  if curl -fsS "${candidate}" >/dev/null 2>&1; then
    web_url="${candidate}"
    break
  fi
done
if [[ -n "${web_url}" ]]; then
  echo "[web] up: ${web_url}"
else
  web_url="http://localhost:5173"
  echo "[web] down (run: ./scripts/dev.sh)"
fi

echo ""

if (( docker_ok )); then
  if docker compose ps -q db >/dev/null 2>&1; then
    echo "[brain_jobs]"
    docker compose exec -T db psql -U postgres -d limbopet -c \
      "SELECT job_type, status, COUNT(*)::int AS n FROM brain_jobs GROUP BY 1,2 ORDER BY 1,2;"
    echo ""
  fi
fi

echo "[tip] open the UI:"
echo "  open ${web_url}"
