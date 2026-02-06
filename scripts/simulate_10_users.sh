#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

API_URL="${API_URL:-http://localhost:3001/api/v1}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:${LIMBOPET_DB_PORT:-5433}/limbopet}"

USERS="${USERS:-10}"
STEPS="${STEPS:-30}"
EPISODES_PER_STEP="${EPISODES_PER_STEP:-6}"
PLAZA_POSTS_PER_STEP="${PLAZA_POSTS_PER_STEP:-1}"
ADVANCE_DAYS="${ADVANCE_DAYS:-true}"
STEP_DAYS="${STEP_DAYS:-1}"
DAY="${DAY:-auto}"
EXTRAS="${EXTRAS:-0}"
SEED_ONLY="${SEED_ONLY:-false}"
WAIT_BRAIN_JOBS="${WAIT_BRAIN_JOBS:-true}"
WAIT_BRAIN_TIMEOUT_S="${WAIT_BRAIN_TIMEOUT_S:-20}"
WAIT_BRAIN_JOB_TYPES="${WAIT_BRAIN_JOB_TYPES:-PLAZA_POST,DIARY_POST}"
TRIGGER_MEMORIES="${TRIGGER_MEMORIES:-false}"
MEMORY_AGENT_LIMIT="${MEMORY_AGENT_LIMIT:-${USERS}}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[sim] missing command: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd python3
require_cmd psql

if ! curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
  echo "[sim] API not reachable: ${API_URL}"
  echo "[sim] start it with: ./scripts/dev.sh"
  exit 1
fi

wait_job_types_sql() {
  local raw="${WAIT_BRAIN_JOB_TYPES}"
  local out=""
  IFS=',' read -r -a arr <<< "${raw}"
  for t in "${arr[@]}"; do
    local s
    s="$(echo "${t}" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
    s="${s//[^A-Z0-9_]/}"
    if [[ -n "${s}" ]]; then
      out+="'${s}',"
    fi
  done
  out="${out%,}"
  if [[ -z "${out}" ]]; then
    out="'PLAZA_POST','DIARY_POST'"
  fi
  echo "${out}"
}

if [[ "${DAY}" == "auto" || -z "${DAY}" ]]; then
  max_day="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(MAX((payload->>'day')::date)::text, '') FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload ? 'day') AND (payload->>'day') ~ '^\\d{4}-\\d{2}-\\d{2}$';" \
      | tr -d '[:space:]'
  )"
  DAY="$(
    python3 -c 'import datetime, sys; s=(sys.argv[1] or "").strip(); d=(datetime.date.fromisoformat(s)+datetime.timedelta(days=1)) if s else datetime.date.today(); print(d.isoformat())' \
      "${max_day:-}"
  )"
fi

echo "[sim] api: ${API_URL}"
echo "[sim] db : ${DB_URL}"
echo ""

get_token() {
  local email="$1"
  curl -sS -X POST "${API_URL}/auth/dev" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${email}\"}" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])'
}

get_pet_id() {
  local token="$1"
  curl -sS -X GET "${API_URL}/users/me/pet" \
    -H "Authorization: Bearer ${token}" \
    | python3 -c 'import sys, json; d=json.load(sys.stdin); pet=d.get("pet"); print("" if not pet else pet.get("id",""))'
}

create_pet() {
  local token="$1"
  local name="$2"
  local desc="$3"
  curl -sS -X POST "${API_URL}/pets/create" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"${name}\",\"description\":\"${desc}\"}" \
    >/dev/null
}

echo "[sim] seeding ${USERS} dev users/pets..."
token_first=""
declare -a emails=()
for n in $(seq 1 "${USERS}"); do
  i="$(printf "%02d" "${n}")"
  email="pet${i}@example.com"
  emails+=("${email}")
  name="pet${i}"
  token="$(get_token "${email}")"
  if [[ -z "${token_first}" ]]; then
    token_first="${token}"
  fi
  pet_id="$(get_pet_id "${token}")"
  if [[ -z "${pet_id}" ]]; then
    create_pet "${token}" "${name}" "dev sim user ${i}"
    echo "  - created: ${name} (${email})"
  else
    echo "  - ok: ${name} (${email})"
  fi
done

echo ""
if [[ "${SEED_ONLY}" == "true" || "${SEED_ONLY}" == "1" ]]; then
  echo "[sim] seed_only=true → skipping world simulation"
  echo "[sim] done"
  exit 0
fi

echo "[sim] simulate: steps=${STEPS} episodes_per_step=${EPISODES_PER_STEP} plaza_posts_per_step=${PLAZA_POSTS_PER_STEP} advance_days=${ADVANCE_DAYS} step_days=${STEP_DAYS} day=${DAY} extras=${EXTRAS}"

simulate_body="$(cat <<JSON
{"steps":${STEPS},"day":"${DAY}","advance_days":${ADVANCE_DAYS},"step_days":${STEP_DAYS},"episodes_per_step":${EPISODES_PER_STEP},"plaza_posts_per_step":${PLAZA_POSTS_PER_STEP},"extras":${EXTRAS}}
JSON
)"

sim_res="$(
  curl -sS -X POST "${API_URL}/users/me/world/dev/simulate" \
    -H "Authorization: Bearer ${token_first}" \
    -H 'Content-Type: application/json' \
    -d "${simulate_body}"
)"

echo "${sim_res}" | python3 -c 'import sys, json; d=json.load(sys.stdin); print("[sim] generated=%s day=%s" % (d.get("generated"), d.get("day")))'

DAY_FROM="${DAY}"
DAY_TO="$(echo "${sim_res}" | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("day") or "")')"
if [[ -z "${DAY_TO}" ]]; then
  DAY_TO="${DAY}"
fi

if [[ "${WAIT_BRAIN_JOBS}" == "true" || "${WAIT_BRAIN_JOBS}" == "1" ]]; then
  echo ""
  wait_types_sql="$(wait_job_types_sql)"
  echo "[sim] waiting brain jobs (types: ${WAIT_BRAIN_JOB_TYPES}, timeout ${WAIT_BRAIN_TIMEOUT_S}s)..."
  start_ts="$(date +%s)"
  while true; do
    pending="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int, 0) FROM brain_jobs WHERE job_type IN (${wait_types_sql}) AND status IN ('pending','leased');" \
        | tr -d '[:space:]'
    )"
    pending="${pending:-0}"
    if [[ "${pending}" == "0" ]]; then
      echo "[sim] brain jobs: ok (pending=0)"
      break
    fi
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= WAIT_BRAIN_TIMEOUT_S )); then
      echo "[sim] brain jobs: timeout (pending=${pending})"
      break
    fi
    sleep 0.5
  done
fi

if [[ "${TRIGGER_MEMORIES}" == "true" || "${TRIGGER_MEMORIES}" == "1" ]]; then
  echo ""
  echo "[sim] triggering daily memories for day=${DAY_TO} (limit=${MEMORY_AGENT_LIMIT})..."
  limit_n="${MEMORY_AGENT_LIMIT}"
  if ! [[ "${limit_n}" =~ ^[0-9]+$ ]]; then
    limit_n="${USERS}"
  fi
  limit_n=$(( limit_n < 0 ? 0 : limit_n ))
  limit_n=$(( limit_n > ${#emails[@]} ? ${#emails[@]} : limit_n ))

  if (( limit_n <= 0 )); then
    echo "[sim] memory trigger: skipped (limit=0)"
  else
    for idx in $(seq 0 $((limit_n - 1))); do
      email="${emails[$idx]}"
      token="$(get_token "${email}")"
      curl -sS -X GET "${API_URL}/users/me/pet/limbo/today?day=${DAY_TO}" \
        -H "Authorization: Bearer ${token}" \
        >/dev/null || true
    done
  fi

  echo "[sim] waiting DAILY_SUMMARY jobs (day=${DAY_TO}, timeout ${WAIT_BRAIN_TIMEOUT_S}s)..."
  start_ts="$(date +%s)"
  while true; do
    pending="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int, 0) FROM brain_jobs WHERE job_type='DAILY_SUMMARY' AND status IN ('pending','leased') AND (input->>'day')='${DAY_TO}';" \
        | tr -d '[:space:]'
    )"
    pending="${pending:-0}"
    if [[ "${pending}" == "0" ]]; then
      echo "[sim] DAILY_SUMMARY jobs: ok (pending=0)"
      break
    fi
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= WAIT_BRAIN_TIMEOUT_S )); then
      echo "[sim] DAILY_SUMMARY jobs: timeout (pending=${pending})"
      break
    fi
    sleep 0.5
  done
fi

echo ""
echo "[window] day_from=${DAY_FROM} day_to=${DAY_TO}"

echo ""
echo "[metrics] episodes + scenarios (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS episodes FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"
psql "${DB_URL}" -Atc "SELECT UPPER(payload->>'scenario') AS scenario, COUNT(*) AS episodes, ROUND(COUNT(*)*100.0/NULLIF((SELECT COUNT(*) FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}'),0), 1) AS pct FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}' GROUP BY 1 ORDER BY episodes DESC;"

echo ""
echo "[metrics] plaza posts (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS plaza_posts FROM events WHERE event_type='PLAZA_POST' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"

echo ""
echo "[metrics] diary posts (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS diary_posts FROM events WHERE event_type='DIARY_POST' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"

echo ""
echo "[metrics] cast diversity (window)"
psql "${DB_URL}" -Atc "WITH eps AS (SELECT payload->'cast'->>'aId' AS a, payload->'cast'->>'bId' AS b FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}'), slots AS (SELECT a AS id FROM eps UNION ALL SELECT b AS id FROM eps), cnts AS (SELECT id, COUNT(*) AS c FROM slots WHERE id IS NOT NULL AND id <> '' GROUP BY 1) SELECT (SELECT COUNT(*) FROM slots) AS cast_slots, (SELECT COUNT(DISTINCT id) FROM cnts) AS unique_agents, (SELECT MAX(c) FROM cnts) AS top_count, ROUND((SELECT MAX(c) FROM cnts)::numeric / NULLIF((SELECT COUNT(*) FROM slots),0) * 100, 2) AS top_pct;"
echo ""
echo "[metrics] pair variety (window)"
psql "${DB_URL}" -Atc "WITH eps AS (SELECT payload->'cast'->>'aId' AS a, payload->'cast'->>'bId' AS b FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}') SELECT COUNT(*) AS episodes, COUNT(DISTINCT LEAST(a,b) || ':' || GREATEST(a,b)) AS unique_pairs, ROUND(COUNT(DISTINCT LEAST(a,b) || ':' || GREATEST(a,b))::numeric / NULLIF(COUNT(*),0) * 100, 1) AS unique_pair_pct FROM eps WHERE a IS NOT NULL AND b IS NOT NULL AND a <> '' AND b <> '';"

echo ""
echo "[metrics] arena matches (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS arena_matches FROM arena_matches WHERE day BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"
psql "${DB_URL}" -Atc "SELECT mode, COUNT(*) AS n FROM arena_matches WHERE day BETWEEN '${DAY_FROM}' AND '${DAY_TO}' GROUP BY 1 ORDER BY n DESC, mode;"
psql "${DB_URL}" -Atc "SELECT ROUND(AVG(COALESCE((meta->'stake'->>'wager')::int, 0))::numeric, 2) AS avg_wager FROM arena_matches WHERE day BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"

echo ""
echo "[metrics] arena events (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS arena_events FROM events WHERE event_type='ARENA_MATCH' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"
psql "${DB_URL}" -Atc "SELECT payload->>'mode_label' AS mode, COUNT(*) AS n FROM events WHERE event_type='ARENA_MATCH' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}' GROUP BY 1 ORDER BY n DESC, mode;"
psql "${DB_URL}" -Atc "SELECT ROUND(AVG(CASE WHEN (payload->>'forfeit')='true' THEN 1 ELSE 0 END)::numeric * 100, 1) AS forfeit_pct FROM events WHERE event_type='ARENA_MATCH' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}';"

echo ""
echo "[metrics] spending vs salary (window, user pets)"
psql "${DB_URL}" -Atc "WITH user_pets AS (SELECT id FROM agents WHERE owner_user_id IS NOT NULL AND name <> 'world_core' AND is_active=true), pet_count AS (SELECT COUNT(*)::int AS n FROM user_pets), days AS (SELECT generate_series(date '${DAY_FROM}', date '${DAY_TO}', interval '1 day')::date AS day), day_count AS (SELECT COUNT(*)::int AS n FROM days), sal_total AS (SELECT COALESCE(SUM(amount),0)::int AS total FROM transactions WHERE tx_type='SALARY' AND to_agent_id IN (SELECT id FROM user_pets) AND substring(memo from 'day:([0-9]{4}-[0-9]{2}-[0-9]{2})') BETWEEN '${DAY_FROM}' AND '${DAY_TO}'), spend_total AS (SELECT COALESCE(SUM(amount),0)::int AS total FROM transactions WHERE tx_type='PURCHASE' AND reference_type='spending' AND from_agent_id IN (SELECT id FROM user_pets) AND substring(memo from 'day:([0-9]{4}-[0-9]{2}-[0-9]{2})') BETWEEN '${DAY_FROM}' AND '${DAY_TO}'), spend_burned AS (SELECT COALESCE(SUM(amount),0)::int AS total FROM transactions WHERE tx_type='PURCHASE' AND reference_type='spending' AND from_agent_id IN (SELECT id FROM user_pets) AND to_agent_id IS NULL AND substring(memo from 'day:([0-9]{4}-[0-9]{2}-[0-9]{2})') BETWEEN '${DAY_FROM}' AND '${DAY_TO}'), spend_gift AS (SELECT COALESCE(SUM(amount),0)::int AS total FROM transactions WHERE tx_type='PURCHASE' AND reference_type='spending' AND from_agent_id IN (SELECT id FROM user_pets) AND to_agent_id IS NOT NULL AND substring(memo from 'day:([0-9]{4}-[0-9]{2}-[0-9]{2})') BETWEEN '${DAY_FROM}' AND '${DAY_TO}') SELECT (SELECT n FROM pet_count) AS user_pets, (SELECT n FROM day_count) AS days, (SELECT total FROM sal_total) AS salary_total, (SELECT total FROM spend_total) AS spend_total, ROUND((SELECT total FROM sal_total)::numeric / NULLIF((SELECT n FROM day_count),0), 1) AS salary_total_per_day, ROUND((SELECT total FROM spend_total)::numeric / NULLIF((SELECT n FROM day_count),0), 1) AS spend_total_per_day, ROUND((SELECT total FROM sal_total)::numeric / NULLIF((SELECT n FROM day_count)*(SELECT n FROM pet_count),0), 2) AS salary_per_pet_per_day, ROUND((SELECT total FROM spend_total)::numeric / NULLIF((SELECT n FROM day_count)*(SELECT n FROM pet_count),0), 2) AS spend_per_pet_per_day, ROUND((SELECT total FROM spend_burned)::numeric / NULLIF((SELECT total FROM spend_total),0) * 100, 1) AS spend_burn_pct, ROUND((SELECT total FROM spend_gift)::numeric / NULLIF((SELECT total FROM spend_total),0) * 100, 1) AS spend_gift_pct;"

echo ""
echo "[metrics] spending types (window)"
psql "${DB_URL}" -Atc "SELECT payload->>'code' AS code, COUNT(*) AS n FROM events WHERE event_type='SPENDING' AND (payload->>'day') BETWEEN '${DAY_FROM}' AND '${DAY_TO}' GROUP BY 1 ORDER BY n DESC, code;"

echo ""
echo "[metrics] relationships (user pets only, current snapshot)"
psql "${DB_URL}" -Atc "WITH user_pets AS (SELECT id FROM agents WHERE owner_user_id IS NOT NULL AND name <> 'world_core' AND is_active=true) SELECT MAX(affinity) AS max_affinity, MIN(affinity) AS min_affinity, MAX(jealousy) AS max_jealousy, MAX(rivalry) AS max_rivalry FROM relationships r WHERE r.from_agent_id IN (SELECT id FROM user_pets) AND r.to_agent_id IN (SELECT id FROM user_pets) AND r.from_agent_id <> r.to_agent_id;"
psql "${DB_URL}" -Atc "WITH user_pets AS (SELECT id FROM agents WHERE owner_user_id IS NOT NULL AND name <> 'world_core' AND is_active=true) SELECT SUM((affinity>=30)::int) AS affinity_ge_30, SUM((affinity>=60)::int) AS affinity_ge_60, SUM((affinity<=-30)::int) AS affinity_le_neg30, SUM((affinity<=-60)::int) AS affinity_le_neg60 FROM relationships r WHERE r.from_agent_id IN (SELECT id FROM user_pets) AND r.to_agent_id IN (SELECT id FROM user_pets) AND r.from_agent_id <> r.to_agent_id;"

echo ""
echo "[metrics] relationship milestones (all-time)"
psql "${DB_URL}" -Atc "SELECT value->>'code' AS code, COUNT(*) AS count FROM facts WHERE kind='relationship' AND key LIKE 'milestone:%' GROUP BY 1 ORDER BY count DESC, code;"

echo ""
echo "[metrics] broadcast title duplicates (all-time)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS duplicated_titles FROM (SELECT title, COUNT(*) c FROM posts WHERE post_type='broadcast' GROUP BY 1 HAVING COUNT(*) > 1) t;"

echo ""
echo "[metrics] brain job backlog (current)"
psql "${DB_URL}" -Atc "SELECT job_type, COUNT(*) AS pending FROM brain_jobs WHERE status IN ('pending','leased') GROUP BY 1 ORDER BY pending DESC;"

echo ""
echo "[metrics] brain job failures (all-time)"
psql "${DB_URL}" -Atc "SELECT job_type, COUNT(*) AS failed FROM brain_jobs WHERE status='failed' GROUP BY 1 ORDER BY failed DESC, job_type;"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS failed_missing_key FROM brain_jobs WHERE status='failed' AND error ILIKE '%Missing key:%';"
psql "${DB_URL}" -Atc "SELECT COUNT(*) AS failed_parse_json FROM brain_jobs WHERE status='failed' AND error ILIKE '%parse JSON%';"
psql "${DB_URL}" -Atc "SELECT ROUND(100.0*SUM((status='failed')::int)::numeric / NULLIF(SUM((status IN ('done','failed'))::int),0), 2) AS failed_pct, SUM((status='failed')::int) AS failed, SUM((status='done')::int) AS done FROM brain_jobs;"
psql "${DB_URL}" -Atc "SELECT job_type, LEFT(COALESCE(error,''), 120) AS error, COUNT(*) AS n FROM brain_jobs WHERE status='failed' GROUP BY 1,2 ORDER BY n DESC LIMIT 12;"

if [[ "${TRIGGER_MEMORIES}" == "true" || "${TRIGGER_MEMORIES}" == "1" ]]; then
  echo ""
  echo "[metrics] memories (daily, day=${DAY_TO}, user pets)"
  psql "${DB_URL}" -Atc "WITH user_pets AS (SELECT id FROM agents WHERE owner_user_id IS NOT NULL AND name <> 'world_core' AND is_active=true) SELECT COUNT(*)::int AS daily_memories, ROUND(AVG(LENGTH(summary::text))::numeric, 1) AS avg_chars FROM memories WHERE scope='daily' AND day='${DAY_TO}' AND agent_id IN (SELECT id FROM user_pets);"
fi

echo ""
echo "[sim] done"
