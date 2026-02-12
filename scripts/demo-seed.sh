#!/usr/bin/env bash
# ============================================================
# demo-seed.sh — 데모 시연 전 워밍업 스크립트
#
# 기능:
#   1) dev 로그인으로 demo@limbopet.test 유저 생성
#   2) 펫 생성 (이름: 데모펫)
#   3) 대화 5회 전송 (각 12초 대기 — brain_job 처리)
#   4) 타임라인 조회로 memory_hint 저장 확인
#
# 사용법:
#   ./scripts/demo-seed.sh
#   API_BASE=http://localhost:3001/api/v1 ./scripts/demo-seed.sh
# ============================================================
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001/api/v1}"
TALK_WAIT="${TALK_WAIT:-12}"   # 대화 간 대기 시간(초)

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
fail() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${CYAN}▸ $*${NC}"; }

# ──────────────────────────────────────────────
# 1. dev 로그인
# ──────────────────────────────────────────────
step "1/5  dev 로그인 (demo@limbopet.test)"

LOGIN_RES=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/auth/dev" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@limbopet.test"}')

HTTP_CODE=$(echo "$LOGIN_RES" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RES" | sed '$d')

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  fail "로그인 실패 (HTTP $HTTP_CODE): $LOGIN_BODY"
fi

TOKEN=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token') or d.get('token') or '')" 2>/dev/null) \
  || fail "토큰 파싱 실패: $LOGIN_BODY"

log "로그인 성공 — 토큰 획득 (${TOKEN:0:20}...)"

AUTH="Authorization: Bearer $TOKEN"

# ──────────────────────────────────────────────
# 2. 펫 생성
# ──────────────────────────────────────────────
step "2/5  펫 생성 (이름: 데모펫)"

PET_RES=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_BASE}/pets/create" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"name":"데모펫","description":"데모 시연용 펫"}')

PET_CODE=$(echo "$PET_RES" | tail -1)
PET_BODY=$(echo "$PET_RES" | sed '$d')

if [[ "$PET_CODE" -ge 200 && "$PET_CODE" -lt 300 ]]; then
  log "펫 생성 완료"
elif echo "$PET_BODY" | grep -qi "already\|exist\|duplicate\|limit"; then
  warn "이미 펫이 존재합니다 — 계속 진행"
else
  fail "펫 생성 실패 (HTTP $PET_CODE): $PET_BODY"
fi

# ──────────────────────────────────────────────
# 3. 대화 5회 전송
# ──────────────────────────────────────────────
step "3/5  대화 5회 전송 (각 ${TALK_WAIT}초 대기)"

MESSAGES=(
  "나 축구 좋아해 손흥민 팬이야"
  "이거 기억해줘 다음 재판에서 증거 3개로 반박하고 싶어"
  "오늘 날씨 좋네"
  "코딩하다 막히면 산책가는 편이야"
  "커피는 아메리카노가 좋아"
)

TALK_OK=0
TALK_FAIL=0

for i in "${!MESSAGES[@]}"; do
  MSG="${MESSAGES[$i]}"
  NUM=$((i + 1))

  echo -n "  [$NUM/5] \"${MSG}\" ... "

  TALK_RES=$(curl -s -w "\n%{http_code}" \
    -X POST "${API_BASE}/users/me/pet/actions" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d "{\"action\":\"talk\",\"payload\":{\"message\":\"${MSG}\"}}")

  TALK_CODE=$(echo "$TALK_RES" | tail -1)

  if [[ "$TALK_CODE" -ge 200 && "$TALK_CODE" -lt 300 ]]; then
    echo -e "${GREEN}OK${NC}"
    TALK_OK=$((TALK_OK + 1))
  else
    TALK_BODY=$(echo "$TALK_RES" | sed '$d')
    echo -e "${RED}FAIL (HTTP $TALK_CODE)${NC}"
    TALK_FAIL=$((TALK_FAIL + 1))
  fi

  # 마지막 메시지가 아니면 대기
  if [[ $NUM -lt ${#MESSAGES[@]} ]]; then
    echo -n "  ⏳ brain_job 처리 대기 (${TALK_WAIT}s) ..."
    sleep "$TALK_WAIT"
    echo " done"
  fi
done

log "대화 전송 완료 — 성공: $TALK_OK, 실패: $TALK_FAIL"

# ──────────────────────────────────────────────
# 4. 마지막 brain_job 처리 대기
# ──────────────────────────────────────────────
step "4/5  마지막 brain_job 처리 대기 (${TALK_WAIT}s)"
sleep "$TALK_WAIT"
log "대기 완료"

# ──────────────────────────────────────────────
# 5. 타임라인 조회 — memory_hint 확인
# ──────────────────────────────────────────────
step "5/5  타임라인 조회 (memory_hint 확인)"

TL_RES=$(curl -s -w "\n%{http_code}" \
  -X GET "${API_BASE}/users/me/pet/timeline?limit=20" \
  -H "$AUTH")

TL_CODE=$(echo "$TL_RES" | tail -1)
TL_BODY=$(echo "$TL_RES" | sed '$d')

if [[ "$TL_CODE" -lt 200 || "$TL_CODE" -ge 300 ]]; then
  fail "타임라인 조회 실패 (HTTP $TL_CODE)"
fi

# memory_hint 포함 이벤트 카운트
HINT_COUNT=$(echo "$TL_BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
events = data.get('data', {}).get('events', [])
hints = [e for e in events if 'memory_hint' in json.dumps(e)]
print(len(hints))
" 2>/dev/null || echo "?")

TALK_COUNT=$(echo "$TL_BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
events = data.get('data', {}).get('events', [])
talks = [e for e in events if e.get('event_type') == 'TALK']
print(len(talks))
" 2>/dev/null || echo "?")

log "타임라인에 TALK 이벤트: ${TALK_COUNT}건, memory_hint 포함: ${HINT_COUNT}건"

# ──────────────────────────────────────────────
# 결과 요약
# ──────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN} 데모 시드 완료 요약${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  유저:       demo@limbopet.test"
echo "  펫 이름:    데모펫"
echo "  대화 전송:  ${TALK_OK}/5 성공"
echo "  TALK 이벤트: ${TALK_COUNT}건"
echo "  memory_hint: ${HINT_COUNT}건"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$TALK_FAIL" -gt 0 ]]; then
  warn "일부 대화 전송 실패 — 서버 로그 확인 필요"
fi

if [[ "$HINT_COUNT" == "0" ]]; then
  warn "memory_hint 없음 — brain worker가 동작 중인지 확인하세요"
fi

echo ""
log "데모 시작 준비 완료! 🎬"
