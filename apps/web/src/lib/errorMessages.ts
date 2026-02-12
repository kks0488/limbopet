/**
 * Maps raw API/network errors to user-friendly Korean messages.
 * Used across all components to avoid exposing technical jargon.
 */

const ERROR_MAP: Array<[RegExp, string]> = [
  [/BRAIN_CONNECT_FAIL|두뇌 연결 실패/i, "두뇌 연결에 실패했어요. API 키와 모델을 확인해 주세요."],
  [/Failed to fetch|NetworkError|net::ERR/i, "인터넷 연결을 확인해 주세요."],
  [/HTTP 401|Unauthorized/i, "로그인이 필요해요. 다시 로그인해 주세요."],
  [/HTTP 403|Forbidden/i, "접근 권한이 없어요."],
  [/HTTP 404|Not found/i, "요청한 정보를 찾지 못했어요."],
  [/HTTP 409|Conflict/i, "이미 처리된 요청이에요."],
  [/HTTP 429|Rate limit|Too many/i, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
  [/HTTP 5\d{2}|Internal server/i, "서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요."],
  [/timeout|ETIMEDOUT|ECONNABORTED/i, "응답이 늦어지고 있어요. 다시 시도해 주세요."],
  [/JSON\.parse|Unexpected token/i, "데이터를 불러오는 중 문제가 생겼어요."],
  [/No available opponent/i, "아직 대전 상대가 없어요. 다른 유저가 참여하면 매칭할 수 있어요."],
  [/constraint|duplicate|unique/i, "이미 존재하는 데이터예요."],
  [/quota|limit exceeded/i, "일일 사용량을 초과했어요. 내일 다시 시도해 주세요."],
  [/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i, "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."],
  [/abort|AbortError|cancelled/i, "요청이 취소되었어요."],
  [/pool|connection.*exhaust|connection.*closed/i, "서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요."],
];

export function friendlyError(e: unknown): string {
  const raw = typeof e === "string" ? e : (e as any)?.message ?? String(e ?? "");
  if (!raw) return "알 수 없는 오류가 발생했어요.";

  // Brain connection: extract hint from "[CODE] msg (hint)" and show it
  const brainHint = raw.match(/BRAIN_CONNECT_FAIL.*?\((.+)\)/);
  if (brainHint?.[1]) {
    const hint = brainHint[1].trim();
    return `두뇌 연결 실패: ${hint}`;
  }

  for (const [pattern, msg] of ERROR_MAP) {
    if (pattern.test(raw)) return msg;
  }

  // If the raw message is already Korean (likely from the backend's user-facing errors), pass through
  if (/[\uAC00-\uD7A3]/.test(raw) && raw.length < 80) {
    // Block messages with technical codes like [DB_ERROR], 3+ uppercase letters, or tech keywords
    if (/\[[A-Z_]+\]|[A-Z]{3,}|error|exception|stack|null|undefined/i.test(raw)) {
      return "문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
    }
    return raw;
  }

  return "문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
}
