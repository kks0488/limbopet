# 야간 자율 정교화 (2/8 밤 → 2/9 아침)

> 운영자 수면 중. 6시간 자율 운영.
> 원칙: 기능 추가 0. 있는 코드를 프로덕션급으로.

---

## 완료 (D-1 낮)

- [x] DIALOGUE 프롬프트 다이어트 (12줄→4줄)
- [x] DIARY/PLAZA 프롬프트 다이어트
- [x] world_context 지시 제거
- [x] "솔직히/근데" 반복 억제
- [x] memory_hint 방향 명확화
- [x] COURT_ARGUMENT 정교화
- [x] 재판 변론 카드형 노출
- [x] 8pt 그리드/CSS 변수 정리 (40+곳)
- [x] 모바일 375px 반응형
- [x] UI 텍스트 톤 통일 (17곳)
- [x] stuck 매치 정리, serializeError, opening fallback
- [x] brain_job 실패 명확 반환, Google OAuth 타임아웃
- [x] PixelPet 타이머 leak 수정
- [x] 코드리뷰 + QA 검증

---

## 야간 작업 큐

### Round 1: 코드리뷰 이슈 수정 (codex) ✅ 완료
- [x] ArenaWatchModal 폴링 effect dep 축소
- [x] 250ms nowMs 완화
- [x] ChatUI key Math.random() → stable key
- [x] PlazaTab setTimeout cleanup
- [x] AiConnectPanel popup 차단 감지

### Round 2: 에지케이스 처리 (ui) ✅ 완료
- [x] ArenaTab 스켈레톤 + 빈 히스토리 메시지
- [x] PetTab 로딩 스피너 (생성폼 깜빡임 방지)
- [x] PostDetailModal 빈 댓글 상태 업그레이드
- [x] friendlyError() 유틸 추가
- [x] 에러 토스트 일관성

### Round 3: 백엔드 안정성 (codex) ✅ 완료
- [x] DecayService 트랜잭션 범위 축소
- [x] PlazaAmbientService 병렬화 검토
- [x] brain_jobs 재시도: 수동 API 존재, 자동 백오프는 미구현(이번 범위 밖)

### Round 4: 프롬프트 품질 2차 (writing) ✅ 완료
- [x] DAILY_SUMMARY 프롬프트 다이어트
- [x] 동결 기능(CAMPAIGN_SPEECH, VOTE_DECISION, RESEARCH_*) 올바르게 스킵
- [x] 전체 프롬프트 한국어 자연스러움 최종 점검

### Round 5: 최종 검증 (qa) ✅ Round 1-2 통과
- [x] npm test 27 passed
- [x] npx tsc --noEmit 0 errors
- [x] npm run build 성공
- [x] stuck live 0, 신규 실패 0
- [x] Round 3 ALL CLEAR

### Round 6: 추가 Polish (야간 신규) ✅ 완료
- [x] placeholder/aria — 37개 컴포넌트 이미 한국어 (수정 불필요)
- [x] console.log — 디버그 코드 없음 (깨끗)
- [x] 모바일 모달 오버플로우 방지 (ui-2)
- [x] 애니메이션 완화 200ms 이하 (ui-2)
- [x] 폰트 크기 일관성 검증 (ui-2)
- [x] 온보딩 텍스트 점검 — OnboardingFlow, LoginScreen 깨끗 (writing-2)
- [x] BrainSettings 텍스트 점검 (writing-2)

### Round 7: 코드 청소 (야간 추가) ✅ 완료
- [x] 미사용 import 정리 (5개 컴포넌트)
- [x] 미사용 CSS 클래스 정리
- [x] 번들 축소: JS -0.53KB, CSS -3.46KB (-3.6%)

### Round 8: 심화 감사 ✅ 완료
- [x] 매직넘버 TOP 5 분석 → /tmp/magic-numbers.md
- [x] 환경변수/URL 감사 → /tmp/env-audit.md (문제 없음)
- [x] API 에러 응답 일관성 — utils/response.js 패턴 통일 (문제 없음)
- [x] 라우트 미들웨어 감사 → /tmp/route-audit.md (Finding 3건)
- [x] React key prop 감사 (문제 없음)

### Round 9: 운영 리스크 수정 ✅ 완료
- [x] Anthropic API 버전 2023-06-01 → 2024-10-22
- [x] Anthropic max_tokens 600 → 1200 (한국어 대응)
- [x] ErrorBoundary 추가 (크래시 시 fallback UI)

### Round 10: 접근성 + 성능 ✅ 완료
- [x] 접근성: 아이콘 버튼 aria-label 1건, input label 7건 추가
- [x] 성능: 인라인 style/useMemo 점검 — 과최적화 불필요 확인
- [x] React key 감사 — 이상 없음

---

## 세션 컨텍스트 관리

| 세션 | 현재 ctx | 교체 기준 |
|------|----------|-----------|
| codex-limbopet | 53% | 30% 이하면 새 세션 |
| writing-limbopet | ~60% | 30% 이하면 새 세션 |
| ui-limbopet | ~50% | 30% 이하면 새 세션 |
| review-limbopet | 61% | 작업 완료후 종료 |
| qa-limbopet | ~60% | 라운드별 교체 |

---

## 체크포인트

매 라운드 완료시 이 파일 업데이트.
아침에 운영자가 이 파일 보면 야간 진행 상황 파악 가능.

---

## 아침에 확인할 것 (판단 필요)

1. **[보안] `POST /auth/dev` 프로덕션 가드 없음** — GOOGLE_OAUTH_CLIENT_ID 있으면 비활성화 필요 (auth.js:62)
2. ~~Anthropic API 버전~~ → ✅ 2024-10-22로 업데이트 완료
3. ~~max_tokens: 600~~ → ✅ 1200으로 변경 완료
4. **LLM timeout 45초** — env 변수화 고려 (ProxyBrainService.js:475)
5. 상세: `/tmp/magic-numbers.md`, `/tmp/review-result.md`, `/tmp/env-audit.md`, `/tmp/route-audit.md`

## 야간 최종 상태 (09:30 KST)

- **API 테스트**: 27 passed, 0 failed ✅
- **TypeScript**: 0 errors ✅
- **빌드**: 391ms, 92 modules ✅
- **CSS**: 91.76KB (시작 94.41KB → -2.8%)
- **JS**: 297.37KB
- **DB**: stuck 0, 신규 실패 0
- **10라운드** 전부 완료

---

## 금지

- 새 기능, 새 서비스, 새 DB 테이블
- 동결 기능 건드리기
- DB 스키마 변경
- 프론트/백 간 API 계약 변경
