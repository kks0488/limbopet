#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

API_URL="${API_URL:-http://localhost:3001/api/v1}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:${LIMBOPET_DB_PORT:-5433}/limbopet}"

USERS="${USERS:-30}"
DAYS="${DAYS:-10}"
EPISODES_PER_DAY="${EPISODES_PER_DAY:-3}"
PLAZA_POSTS_PER_DAY="${PLAZA_POSTS_PER_DAY:-2}"
STEP_DAYS="${STEP_DAYS:-1}"
DAY="${DAY:-auto}"
EXTRAS="${EXTRAS:-0}"

KOREAN_NICKNAMES="${KOREAN_NICKNAMES:-true}"

INTERACTIONS="${INTERACTIONS:-true}"
LIKES_PER_DAY="${LIKES_PER_DAY:-40}"
COMMENTS_PER_DAY="${COMMENTS_PER_DAY:-12}"

WAIT_BRAIN_JOBS="${WAIT_BRAIN_JOBS:-true}"
WAIT_BRAIN_TIMEOUT_S="${WAIT_BRAIN_TIMEOUT_S:-300}"
WAIT_BRAIN_JOB_TYPES="${WAIT_BRAIN_JOB_TYPES:-PLAZA_POST,DIARY_POST}"

TRIGGER_MEMORIES="${TRIGGER_MEMORIES:-true}"
MEMORY_AGENT_LIMIT="${MEMORY_AGENT_LIMIT:-${USERS}}"
SEED_RELATIONSHIP_DRAMA="${SEED_RELATIONSHIP_DRAMA:-true}"

REPORT_JSON_PATH="${REPORT_JSON_PATH:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[society] missing command: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd python3
require_cmd psql

if ! curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
  echo "[society] API not reachable: ${API_URL}"
  echo "[society] start it with: ./scripts/dev.sh"
  exit 1
fi

as_bool() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ "${v}" == "1" || "${v}" == "true" || "${v}" == "yes" || "${v}" == "y" ]]
}

add_days() {
  python3 -c 'import datetime, sys; d=datetime.date.fromisoformat(sys.argv[1]); n=int(sys.argv[2]); print((d+datetime.timedelta(days=n)).isoformat())' "$1" "$2"
}

get_token() {
  local email="$1"
  curl -sS -X POST "${API_URL}/auth/dev" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${email}\"}" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])'
}

get_pet_json() {
  local token="$1"
  curl -sS -X GET "${API_URL}/users/me/pet" \
    -H "Authorization: Bearer ${token}"
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

set_display_name() {
  local token="$1"
  local display_name="$2"
  curl -sS -X PATCH "${API_URL}/users/me/pet/profile" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -d "{\"displayName\":\"${display_name}\"}" \
    >/dev/null
}

ko_name_for() {
  local idx="$1"
  python3 - "$idx" <<'PY'
import random, sys
idx=int(sys.argv[1])
# 실제 한국인이 쓸법한 닉네임 (인스타/트위터/게임 스타일)
nicks=[
  "민지","하윤","서연","지우","수아","예은","채원","소율","다은","유나",
  "지호","도윤","시우","예준","하준","주원","건우","현우","서진","은호",
  "뽀삐맘","치즈냥","감자도리","모찌떡","라떼한잔","새벽감성","귤탱이","콩이아빠",
  "밤톨이","솜사탕","호두과자","떡볶이킹","야옹이","멍뭉이","복실이","꾸덕꾸덕",
  "림보덕후","펫집사","관전러","시뮬중독","아레나광","소식통","광장지기","떡밥수집가",
  "월급루팡","코딩하는곰","디자인요정","기획충","데이터덕","서버지킴이","프론트장인",
  "커피요정","야근전사","재택러","산책러","런닝맨","헬린이","필라테스","요가하는펭귄",
  "먹방러","빵순이","카페투어","맛집헌터","라멘덕후","초밥러버","치킨마니아","피자킹",
  "독서벌레","영화광","넷플중독","웹툰러","음악중독","게임폐인","보드겜러","퍼즐매니아",
  "고양이집사","강아지아빠","햄스터맘","토끼키우는사람","물고기집사","앵무새친구",
]
random.seed(idx * 7919)
name = nicks[(idx - 1) % len(nicks)]
# 20명 이후는 숫자 붙이기
if idx > len(nicks):
    name = f"{random.choice(nicks)}{random.randint(2,99)}"
print(name[:32])
PY
}

ko_comment_for() {
  local seed="$1"
  python3 - "$seed" <<'PY'
import random, sys, time
seed=int(sys.argv[1])
random.seed(seed)
templates=[
  "오늘도 재밌다 ㅋㅋ",
  "이건 좀 충격인데…",
  "다음 편 기대할게!",
  "아레나 결과 미쳤다",
  "이 조합 너무 좋다",
  "ㅇㅈ 인정",
  "댓글 남기고 감",
  "이거 진짜 웃기네",
  "좋아요 누르고 간다",
]
print(random.choice(templates))
PY
}

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

echo "[society] api: ${API_URL}"
echo "[society] db : ${DB_URL}"
echo "[society] users=${USERS} days=${DAYS} episodes/day=${EPISODES_PER_DAY} plaza/day=${PLAZA_POSTS_PER_DAY} step_days=${STEP_DAYS}"
echo ""

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

echo "[society] start_day=${DAY}"
echo ""

failed_before="$(psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM brain_jobs WHERE status='failed';" | tr -d '[:space:]')"
failed_before="${failed_before:-0}"

echo "[society] seeding ${USERS} dev users/pets (and setting Korean display names)..."
token_first=""
declare -a emails=()
declare -a tokens=()
declare -a pet_ids=()
declare -a display_names=()

for n in $(seq 1 "${USERS}"); do
  i="$(printf "%02d" "${n}")"
  email="pet${i}@example.com"
  handle="pet${i}"
  emails+=("${email}")

  token="$(get_token "${email}")"
  tokens+=("${token}")
  if [[ -z "${token_first}" ]]; then
    token_first="${token}"
  fi

  pet_json="$(get_pet_json "${token}")"
  pet_info="$(echo "${pet_json}" | python3 -c 'import sys, json; d=json.load(sys.stdin); pet=d.get("pet") or None; pid="" if not pet else (pet.get("id") or ""); dn="" if not pet else (pet.get("display_name") or pet.get("displayName") or ""); print(f"{pid}|{dn}")')"
  pet_id="${pet_info%%|*}"
  pet_display_name="${pet_info#*|}"
  if [[ -z "${pet_id}" ]]; then
    create_pet "${token}" "${handle}" "dev society user ${i}"
    echo "  - created: ${handle} (${email})"
    pet_json="$(get_pet_json "${token}")"
    pet_info="$(echo "${pet_json}" | python3 -c 'import sys, json; d=json.load(sys.stdin); pet=d.get("pet") or None; pid="" if not pet else (pet.get("id") or ""); dn="" if not pet else (pet.get("display_name") or pet.get("displayName") or ""); print(f"{pid}|{dn}")')"
    pet_id="${pet_info%%|*}"
    pet_display_name="${pet_info#*|}"
  else
    echo "  - ok: ${handle} (${email})"
  fi
  pet_ids+=("${pet_id}")

  if as_bool "${KOREAN_NICKNAMES}"; then
    dn="$(ko_name_for "${n}")"
    display_names+=("${dn}")
    if [[ "${pet_display_name}" != "${dn}" ]]; then
      set_display_name "${token}" "${dn}"
    fi
  else
    display_names+=("${handle}")
  fi
done

if as_bool "${KOREAN_NICKNAMES}"; then
  handles_sql=""
  for n in $(seq 1 "${USERS}"); do
    i="$(printf "%02d" "${n}")"
    handles_sql+="'pet${i}',"
  done
  handles_sql="${handles_sql%,}"
  hangul_count="$(
    psql "${DB_URL}" -Atc "SELECT COUNT(*)::int FROM agents WHERE name IN (${handles_sql}) AND display_name ~ '[가-힣]';" \
      | tr -d '[:space:]'
  )"
  echo ""
  echo "[society] korean display_name set: ${hangul_count}/${USERS}"
fi

if as_bool "${SEED_RELATIONSHIP_DRAMA}"; then
  # Seed a few directional relationships so drama starts early in short simulations.
  pair1_a="${pet_ids[0]:-}"; pair1_b="${pet_ids[1]:-}"
  pair2_a="${pet_ids[2]:-}"; pair2_b="${pet_ids[3]:-}"
  rival_a="${pet_ids[4]:-${pair2_a:-}}"; rival_b="${pet_ids[5]:-${pair2_b:-}}"

  if [[ -n "${pair1_a}" && -n "${pair1_b}" ]]; then
    psql "${DB_URL}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO relationships (from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at)
VALUES
  ('${pair1_a}'::uuid, '${pair1_b}'::uuid, 45, 40, 2, 4, 0, NOW()),
  ('${pair1_b}'::uuid, '${pair1_a}'::uuid, 42, 38, 3, 5, 0, NOW())
ON CONFLICT (from_agent_id, to_agent_id)
DO UPDATE SET
  affinity = EXCLUDED.affinity,
  trust = EXCLUDED.trust,
  jealousy = EXCLUDED.jealousy,
  rivalry = EXCLUDED.rivalry,
  debt = EXCLUDED.debt,
  updated_at = NOW();
SQL
  fi

  if [[ -n "${pair2_a}" && -n "${pair2_b}" ]]; then
    psql "${DB_URL}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO relationships (from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at)
VALUES
  ('${pair2_a}'::uuid, '${pair2_b}'::uuid, -20, 15, 18, 24, 0, NOW()),
  ('${pair2_b}'::uuid, '${pair2_a}'::uuid, -18, 18, 14, 22, 0, NOW())
ON CONFLICT (from_agent_id, to_agent_id)
DO UPDATE SET
  affinity = EXCLUDED.affinity,
  trust = EXCLUDED.trust,
  jealousy = EXCLUDED.jealousy,
  rivalry = EXCLUDED.rivalry,
  debt = EXCLUDED.debt,
  updated_at = NOW();
SQL
  fi

  if [[ -n "${rival_a}" && -n "${rival_b}" && "${rival_a}" != "${rival_b}" ]]; then
    psql "${DB_URL}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO relationships (from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at)
VALUES
  ('${rival_a}'::uuid, '${rival_b}'::uuid, -12, 24, 30, 55, 0, NOW()),
  ('${rival_b}'::uuid, '${rival_a}'::uuid, -10, 26, 28, 52, 0, NOW())
ON CONFLICT (from_agent_id, to_agent_id)
DO UPDATE SET
  affinity = EXCLUDED.affinity,
  trust = EXCLUDED.trust,
  jealousy = EXCLUDED.jealousy,
  rivalry = EXCLUDED.rivalry,
  debt = EXCLUDED.debt,
  updated_at = NOW();
SQL
  fi

  echo ""
  echo "[society] relationship drama seeds applied"
fi

echo ""
echo "[society] simulate + interactions..."
day_from="${DAY}"
day_to="${DAY}"

tmp_dir="$(mktemp -d)"
like_codes_file="${tmp_dir}/like_codes.txt"
comment_codes_file="${tmp_dir}/comment_codes.txt"
like_pairs_file="${tmp_dir}/like_pairs.txt"
touch "${like_codes_file}" "${comment_codes_file}" "${like_pairs_file}"
cleanup_tmp() { rm -rf "${tmp_dir}" >/dev/null 2>&1 || true; }
trap cleanup_tmp EXIT INT TERM

for step in $(seq 1 "${DAYS}"); do
  step_day="$(add_days "${DAY}" $(( (step - 1) * STEP_DAYS )))"
  day_to="${step_day}"

  simulate_body="$(cat <<JSON
{"steps":1,"day":"${step_day}","advance_days":false,"step_days":${STEP_DAYS},"episodes_per_step":${EPISODES_PER_DAY},"plaza_posts_per_step":${PLAZA_POSTS_PER_DAY},"extras":${EXTRAS}}
JSON
)"

  sim_res="$(
    curl -sS -X POST "${API_URL}/users/me/world/dev/simulate" \
      -H "Authorization: Bearer ${token_first}" \
      -H 'Content-Type: application/json' \
      -d "${simulate_body}"
  )"

  generated="$(echo "${sim_res}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(int(d.get("generated") or 0))')"
  echo ""
  echo "[day ${step}/${DAYS}] ${step_day} generated_episodes=${generated}"

  # Arena recap integrity (must hold)
  mcount="$(psql "${DB_URL}" -Atc "SELECT COUNT(*)::int FROM arena_matches WHERE day='${step_day}';" | tr -d '[:space:]')"
  rcount="$(psql "${DB_URL}" -Atc "SELECT COUNT(*)::int FROM arena_matches WHERE day='${step_day}' AND COALESCE(meta->>'recap_post_id','')<>'';" | tr -d '[:space:]')"
  pcount="$(psql "${DB_URL}" -Atc "SELECT COUNT(*)::int FROM posts WHERE post_type='arena' AND meta->>'day'='${step_day}';" | tr -d '[:space:]')"
  echo "  - arena matches=${mcount} recap_linked=${rcount} recap_posts=${pcount}"
  if [[ "${mcount}" != "${rcount}" || "${mcount}" != "${pcount}" ]]; then
    echo "  - ❌ arena recap integrity failed for day=${step_day}"
    exit 1
  fi

  if as_bool "${INTERACTIONS}"; then
    # Fetch a post pool for interaction targets (DB -> includes author_id to avoid self-votes).
    post_ids=()
    post_author_ids=()
    while IFS='|' read -r pid author_id; do
      [[ -n "${pid}" && -n "${author_id}" ]] || continue
      post_ids+=("${pid}")
      post_author_ids+=("${author_id}")
    done < <(
      psql "${DB_URL}" -Atc "SELECT id::text || '|' || author_id::text FROM posts WHERE is_deleted=false AND post_type NOT IN ('broadcast','rumor') ORDER BY created_at DESC LIMIT 120;"
    )

    if (( ${#post_ids[@]} == 0 )); then
      echo "  - interactions: skipped (no posts)"
    else
      like_fail=0
      comment_fail=0
      like_skip=0
      like_fail_codes=""
      comment_fail_codes=""

      likes_n="${LIKES_PER_DAY}"
      comments_n="${COMMENTS_PER_DAY}"
      if ! [[ "${likes_n}" =~ ^[0-9]+$ ]]; then likes_n=0; fi
      if ! [[ "${comments_n}" =~ ^[0-9]+$ ]]; then comments_n=0; fi

      for _ in $(seq 1 "${likes_n}"); do
        uidx=$(( RANDOM % USERS ))
        t="${tokens[$uidx]}"
        voter_agent_id="${pet_ids[$uidx]}"

        pid=""
        for __try in $(seq 1 20); do
          pidx=$(( RANDOM % ${#post_ids[@]} ))
          cand_pid="${post_ids[$pidx]}"
          cand_author="${post_author_ids[$pidx]}"
          if [[ "${cand_author}" == "${voter_agent_id}" ]]; then
            continue
          fi
          if grep -q "^${voter_agent_id}|${cand_pid}$" "${like_pairs_file}" 2>/dev/null; then
            continue
          fi
          pid="${cand_pid}"
          break
        done
        if [[ -z "${pid}" ]]; then
          like_skip=$(( like_skip + 1 ))
          continue
        fi

        code="$(
          curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/users/me/posts/${pid}/upvote" \
            -H "Authorization: Bearer ${t}"
        )" || code="000"
        if [[ "${code}" == "000" || "${code}" == "500" || "${code}" == "502" || "${code}" == "503" || "${code}" == "504" ]]; then
          sleep 0.1
          code="$(
            curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/users/me/posts/${pid}/upvote" \
              -H "Authorization: Bearer ${t}"
          )" || code="000"
        fi
        echo "${code}" >> "${like_codes_file}"
        if [[ "${code}" != "200" && "${code}" != "201" ]]; then
          like_fail=$(( like_fail + 1 ))
          if [[ "${like_fail}" -le 6 ]]; then
            like_fail_codes="${like_fail_codes}${code} "
          fi
        else
          echo "${voter_agent_id}|${pid}" >> "${like_pairs_file}"
        fi
      done

      for cidx in $(seq 1 "${comments_n}"); do
        uidx=$(( RANDOM % USERS ))
        t="${tokens[$uidx]}"
        pid="${post_ids[$(( RANDOM % ${#post_ids[@]} ))]}"
        content="$(ko_comment_for $(( step * 100000 + cidx * 97 + uidx )))"
        body="$(python3 -c 'import json, sys; print(json.dumps({"content": sys.argv[1]}))' "${content}")"
        code="$(
          curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/users/me/plaza/posts/${pid}/comments" \
            -H "Authorization: Bearer ${t}" \
            -H 'Content-Type: application/json' \
            -d "${body}"
        )" || code="000"
        if [[ "${code}" == "000" || "${code}" == "500" || "${code}" == "502" || "${code}" == "503" || "${code}" == "504" ]]; then
          sleep 0.1
          body="$(python3 -c 'import json, sys; print(json.dumps({"content": sys.argv[1]}))' "${content}")"
          code="$(
            curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/users/me/plaza/posts/${pid}/comments" \
              -H "Authorization: Bearer ${t}" \
              -H 'Content-Type: application/json' \
              -d "${body}"
          )" || code="000"
        fi
        echo "${code}" >> "${comment_codes_file}"
        if [[ "${code}" != "200" && "${code}" != "201" ]]; then
          comment_fail=$(( comment_fail + 1 ))
          if [[ "${comment_fail}" -le 6 ]]; then
            comment_fail_codes="${comment_fail_codes}${code} "
          fi
        fi
      done

      if (( like_fail > 0 || comment_fail > 0 )); then
        echo "  - interactions: likes=${likes_n} (skip ${like_skip}, fail ${like_fail}, codes: ${like_fail_codes:-none}), comments=${comments_n} (fail ${comment_fail}, codes: ${comment_fail_codes:-none})"
      else
        echo "  - interactions: likes=${likes_n} (skip ${like_skip}, fail 0), comments=${comments_n} (fail 0)"
      fi
    fi
  fi
done

echo ""
echo "[window] day_from=${day_from} day_to=${day_to}"

if as_bool "${WAIT_BRAIN_JOBS}"; then
  wait_types_sql="$(wait_job_types_sql)"
  echo ""
  echo "[society] waiting brain jobs (types: ${WAIT_BRAIN_JOB_TYPES}, timeout ${WAIT_BRAIN_TIMEOUT_S}s)..."
  start_ts="$(date +%s)"
  while true; do
    pending="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM brain_jobs WHERE job_type IN (${wait_types_sql}) AND status IN ('pending','leased');" \
        | tr -d '[:space:]'
    )"
    pending="${pending:-0}"
    if [[ "${pending}" == "0" ]]; then
      echo "[society] brain jobs: ok (pending=0)"
      break
    fi
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= WAIT_BRAIN_TIMEOUT_S )); then
      echo "[society] brain jobs: timeout (pending=${pending})"
      break
    fi
    sleep 0.5
  done
fi

if as_bool "${TRIGGER_MEMORIES}"; then
  echo ""
  echo "[society] triggering daily memories for day=${day_to} (limit=${MEMORY_AGENT_LIMIT})..."
  limit_n="${MEMORY_AGENT_LIMIT}"
  if ! [[ "${limit_n}" =~ ^[0-9]+$ ]]; then
    limit_n="${USERS}"
  fi
  limit_n=$(( limit_n < 0 ? 0 : limit_n ))
  limit_n=$(( limit_n > ${#emails[@]} ? ${#emails[@]} : limit_n ))

  if (( limit_n <= 0 )); then
    echo "[society] memory trigger: skipped (limit=0)"
  else
    for idx in $(seq 0 $((limit_n - 1))); do
      token="${tokens[$idx]}"
      curl -sS -X GET "${API_URL}/users/me/pet/limbo/today?day=${day_to}" \
        -H "Authorization: Bearer ${token}" \
        >/dev/null || true
    done
  fi

  echo "[society] waiting DAILY_SUMMARY jobs (day=${day_to}, timeout ${WAIT_BRAIN_TIMEOUT_S}s)..."
  start_ts="$(date +%s)"
  while true; do
    pending="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM brain_jobs WHERE job_type='DAILY_SUMMARY' AND status IN ('pending','leased') AND (input->>'day')='${day_to}';" \
        | tr -d '[:space:]'
    )"
    pending="${pending:-0}"
    if [[ "${pending}" == "0" ]]; then
      echo "[society] DAILY_SUMMARY jobs: ok (pending=0)"
      break
    fi
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= WAIT_BRAIN_TIMEOUT_S )); then
      echo "[society] DAILY_SUMMARY jobs: timeout (pending=${pending})"
      break
    fi
    sleep 0.5
  done
fi

echo ""
echo "[checks] recap posts (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) FROM posts WHERE post_type='arena' AND meta->>'day' BETWEEN '${day_from}' AND '${day_to}';"
echo "[checks] recap linked matches (window)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) FROM arena_matches WHERE day BETWEEN '${day_from}' AND '${day_to}' AND COALESCE(meta->>'recap_post_id','')<>'';"
echo "[checks] modes (window)"
psql "${DB_URL}" -Atc "SELECT mode, COUNT(*) FROM arena_matches WHERE day BETWEEN '${day_from}' AND '${day_to}' GROUP BY 1 ORDER BY 2 DESC;"
echo "[checks] memories (daily, day_to)"
psql "${DB_URL}" -Atc "SELECT COUNT(*) FROM memories WHERE scope='daily' AND day='${day_to}';"

failed_after="$(psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM brain_jobs WHERE status='failed';" | tr -d '[:space:]')"
failed_after="${failed_after:-0}"
new_failed=$(( failed_after - failed_before ))
echo ""
echo "[checks] brain job failures: before=${failed_before} after=${failed_after} new=${new_failed}"
if (( new_failed > 0 )); then
  psql "${DB_URL}" -Atc "SELECT job_type, COUNT(*) FROM brain_jobs WHERE status='failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;"
fi

echo ""
echo "[checks] brain job backlog (current)"
psql "${DB_URL}" -Atc "SELECT job_type, COUNT(*) FROM brain_jobs WHERE status IN ('pending','leased') GROUP BY 1 ORDER BY 2 DESC LIMIT 20;"

echo ""
echo "[checks] interaction http codes (all days)"
if [[ -s "${like_codes_file}" ]]; then
  echo "[checks] likes:"
  sort "${like_codes_file}" | uniq -c | sort -nr
fi
if [[ -s "${comment_codes_file}" ]]; then
  echo "[checks] comments:"
  sort "${comment_codes_file}" | uniq -c | sort -nr
fi

echo ""
echo "[society] done"

if [[ -n "${REPORT_JSON_PATH}" ]]; then
  echo ""
  echo "[society] writing report: ${REPORT_JSON_PATH}"

  report_dir="$(dirname "${REPORT_JSON_PATH}")"
  if [[ -n "${report_dir}" && "${report_dir}" != "." ]]; then
    mkdir -p "${report_dir}"
  fi

  election_closed_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM events WHERE event_type='ELECTION_CLOSED' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}';" \
      | tr -d '[:space:]'
  )"
  policy_changed_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM events WHERE event_type='POLICY_CHANGED' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}';" \
      | tr -d '[:space:]'
  )"
  policy_recent_changes_json="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (SELECT created_at, payload FROM events WHERE event_type='POLICY_CHANGED' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}' ORDER BY created_at DESC LIMIT 10) x;" \
      | tr -d '\n'
  )"
  economy_series_json="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(json_agg(json_build_object('day', t.day, 'revenue', t.revenue, 'spending', t.spending) ORDER BY t.day), '[]'::json) FROM (SELECT gs.day::date::text AS day, COALESCE((SELECT SUM(amount)::bigint FROM transactions tr WHERE tr.tx_type='REVENUE' AND tr.memo LIKE ('%day:'||gs.day::date::text||'%')),0)::bigint AS revenue, COALESCE((SELECT SUM(amount)::bigint FROM transactions tr WHERE tr.tx_type='PURCHASE' AND tr.reference_type='spending' AND (tr.memo LIKE ('%day:'||gs.day::date::text||'%') OR tr.created_at::date=gs.day::date)),0)::bigint AS spending FROM generate_series('${day_from}'::date,'${day_to}'::date, interval '1 day') gs(day) ORDER BY gs.day) t;" \
      | tr -d '\n'
  )"
  economy_recent_txs_json="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(json_agg(x ORDER BY x.amount DESC, x.created_at DESC), '[]'::json) FROM (SELECT t.id::text AS id, t.tx_type, t.amount::bigint, t.memo, t.created_at, COALESCE(af.display_name, af.name) AS from_name, COALESCE(at.display_name, at.name) AS to_name FROM transactions t LEFT JOIN agents af ON af.id=t.from_agent_id LEFT JOIN agents at ON at.id=t.to_agent_id WHERE (t.memo LIKE '%day:${day_to}%' OR t.created_at::date='${day_to}'::date) ORDER BY t.amount DESC, t.created_at DESC LIMIT 10) x;" \
      | tr -d '\n'
  )"

  broadcast_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}';" \
      | tr -d '[:space:]'
  )"
  cliffhanger_duplicates="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(SUM(c-1),0)::int FROM (SELECT (summary->>'cliffhanger') AS k, COUNT(*)::int AS c FROM memories WHERE scope='world_daily' AND day BETWEEN '${day_from}' AND '${day_to}' AND COALESCE(summary->>'cliffhanger','')<>'' GROUP BY 1 HAVING COUNT(*)>1) t;" \
      | tr -d '[:space:]'
  )"
  cast_distinct="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(DISTINCT id)::int,0) FROM (SELECT payload->'cast'->>'aId' AS id FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}' UNION ALL SELECT payload->'cast'->>'bId' AS id FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}') u WHERE COALESCE(id,'')<>'';" \
      | tr -d '[:space:]'
  )"

  backlog_json="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(json_agg(json_build_object('job_type', job_type, 'count', n) ORDER BY n DESC), '[]'::json) FROM (SELECT job_type, COUNT(*)::int AS n FROM brain_jobs WHERE status IN ('pending','leased') GROUP BY 1) t;" \
      | tr -d '\n'
  )"

  world_id="$(
    psql "${DB_URL}" -Atc "SELECT id FROM agents WHERE name='world_core' LIMIT 1;" \
      | tr -d '[:space:]'
  )"
  if [[ -n "${world_id}" ]]; then
    world_theme_json="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(value::text,'') FROM facts WHERE agent_id='${world_id}' AND kind='world' AND key='current_theme' LIMIT 1;" \
        | tr -d '\n'
    )"
    world_atmos_json="$(
      psql "${DB_URL}" -Atc "SELECT COALESCE(value::text,'') FROM facts WHERE agent_id='${world_id}' AND kind='world' AND key='current_atmosphere' LIMIT 1;" \
        | tr -d '\n'
    )"
  else
    world_theme_json=""
    world_atmos_json=""
  fi

  nudge_episode_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM events WHERE event_type='SHOWRUNNER_EPISODE' AND (payload ? 'day') AND (payload->>'day') BETWEEN '${day_from}' AND '${day_to}' AND (payload ? 'trigger') AND COALESCE(payload->'trigger'->>'kind','')='nudge';" \
      | tr -d '[:space:]'
  )"
  direction_latest_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM facts f JOIN agents a ON a.id=f.agent_id WHERE f.kind='direction' AND f.key='latest' AND a.owner_user_id IS NOT NULL AND f.updated_at::date BETWEEN '${day_from}'::date AND '${day_to}'::date;" \
      | tr -d '[:space:]'
  )"
  direction_applied_count="$(
    psql "${DB_URL}" -Atc "SELECT COALESCE(COUNT(*)::int,0) FROM facts f JOIN agents a ON a.id=f.agent_id WHERE f.kind='direction' AND f.key='last_applied' AND a.owner_user_id IS NOT NULL AND f.updated_at::date BETWEEN '${day_from}'::date AND '${day_to}'::date;" \
      | tr -d '[:space:]'
  )"

  # Export env vars for the inline report builder.
  export USERS="${USERS}"
  export DAYS="${DAYS}"
  export NEW_FAILED="${new_failed:-0}"
  export DAY_FROM="${day_from}"
  export DAY_TO="${day_to}"
  export ELECTION_CLOSED_COUNT="${election_closed_count:-0}"
  export POLICY_CHANGED_COUNT="${policy_changed_count:-0}"
  export POLICY_RECENT_CHANGES_JSON="${policy_recent_changes_json:-[]}"
  export ECONOMY_SERIES_JSON="${economy_series_json:-[]}"
  export ECONOMY_RECENT_TXS_JSON="${economy_recent_txs_json:-[]}"
  export BROADCAST_COUNT="${broadcast_count:-0}"
  export CLIFFHANGER_DUPLICATES="${cliffhanger_duplicates:-0}"
  export CAST_DISTINCT="${cast_distinct:-0}"
  export BACKLOG_JSON="${backlog_json:-[]}"
  export WORLD_THEME_JSON="${world_theme_json:-}"
  export WORLD_ATMOS_JSON="${world_atmos_json:-}"
  export NUDGE_EPISODE_COUNT="${nudge_episode_count:-0}"
  export DIRECTION_LATEST_COUNT="${direction_latest_count:-0}"
  export DIRECTION_APPLIED_COUNT="${direction_applied_count:-0}"

  if [[ -s "${like_codes_file}" ]]; then
    like_codes_json="$(python3 - "${like_codes_file}" <<'PY'
import json, sys
from collections import Counter
path=sys.argv[1]
codes=[line.strip() for line in open(path,'r',encoding='utf-8',errors='ignore') if line.strip()]
c=Counter(codes)
print(json.dumps(dict(c)))
PY
)"
  else
    like_codes_json="{}"
  fi
  if [[ -s "${comment_codes_file}" ]]; then
    comment_codes_json="$(python3 - "${comment_codes_file}" <<'PY'
import json, sys
from collections import Counter
path=sys.argv[1]
codes=[line.strip() for line in open(path,'r',encoding='utf-8',errors='ignore') if line.strip()]
c=Counter(codes)
print(json.dumps(dict(c)))
PY
)"
  else
    comment_codes_json="{}"
  fi
  export LIKE_CODES_JSON="${like_codes_json}"
  export COMMENT_CODES_JSON="${comment_codes_json}"

  # Write the report (now that env + counters are finalized).
  python3 - "${REPORT_JSON_PATH}" <<'PY'
import json
import os
import sys
from pathlib import Path

out_path = Path(sys.argv[1])

def _int(name, default=0):
  try:
    return int(str(os.environ.get(name, default)).strip() or default)
  except Exception:
    return default

def _json(name, default):
  raw = os.environ.get(name)
  if raw is None:
    return default
  s = str(raw).strip()
  if not s:
    return default
  try:
    return json.loads(s)
  except Exception:
    return default

users = _int("USERS", 0)
cast_distinct = _int("CAST_DISTINCT", 0)
cast_unique_ratio = (cast_distinct / users) if users > 0 else None

report = {
  "window": {
    "day_from": os.environ.get("DAY_FROM", ""),
    "day_to": os.environ.get("DAY_TO", ""),
    "users": users,
    "days": _int("DAYS", 0),
  },
  "policy": {
    "election_closed_count": _int("ELECTION_CLOSED_COUNT", 0),
    "policy_changed_count": _int("POLICY_CHANGED_COUNT", 0),
    "recent_changes": _json("POLICY_RECENT_CHANGES_JSON", []),
  },
  "economy": {
    "series": _json("ECONOMY_SERIES_JSON", []),
    "recent_transactions": _json("ECONOMY_RECENT_TXS_JSON", []),
  },
  "content": {
    "broadcast_count": _int("BROADCAST_COUNT", 0),
    "broadcast_duplicates": _int("CLIFFHANGER_DUPLICATES", 0),
    "cast_distinct": cast_distinct,
    "cast_unique_ratio": cast_unique_ratio,
  },
  "health": {
    "brain_failed_delta": _int("NEW_FAILED", 0),
    "brain_backlog": _json("BACKLOG_JSON", []),
    "http_codes": {
      "likes": _json("LIKE_CODES_JSON", {}),
      "comments": _json("COMMENT_CODES_JSON", {}),
    },
  },
  "ssot": {
    "world_concept": {
      "theme": _json("WORLD_THEME_JSON", None),
      "atmosphere": _json("WORLD_ATMOS_JSON", None),
    },
    "direction": {
      "nudge_episode_count": _int("NUDGE_EPISODE_COUNT", 0),
      "latest_count": _int("DIRECTION_LATEST_COUNT", 0),
      "applied_count": _int("DIRECTION_APPLIED_COUNT", 0),
    },
  },
}

day_to = report["window"]["day_to"]
theme = report["ssot"]["world_concept"]["theme"]
atmos = report["ssot"]["world_concept"]["atmosphere"]
concept_ok = (
  isinstance(theme, dict)
  and theme.get("day") == day_to
  and isinstance(atmos, dict)
  and atmos.get("day") == day_to
  and str(atmos.get("text", "")).strip() != ""
)
report["ssot"]["world_concept"]["ok"] = bool(concept_ok)
if isinstance(atmos, dict):
  report["ssot"]["world_concept"]["atmosphere_text"] = str(atmos.get("text", "")).strip() or None

latest = int(report["ssot"]["direction"]["latest_count"] or 0)
applied = int(report["ssot"]["direction"]["applied_count"] or 0)
report["ssot"]["direction"]["applied_rate"] = (applied / latest) if latest > 0 else None

out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"[society] report saved: {out_path}")
PY
fi
