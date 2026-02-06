/**
 * 한국어 조사 처리 유틸
 *
 * 마지막 글자의 받침(종성) 유무에 따라 올바른 조사를 선택한다.
 * postposition('민지', '가') → '민지가'
 * postposition('민석', '가') → '민석이'
 * postposition('나리', '와') → '나리와'
 * postposition('건우', '와') → '건우와'
 * postposition('시윤', '가') → '시윤이'
 */

// 받침이 있으면 true
function hasFinalConsonant(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  // 한글 완성형 범위: 0xAC00 ~ 0xD7A3
  if (code >= 0xAC00 && code <= 0xD7A3) {
    return (code - 0xAC00) % 28 !== 0;
  }
  // 숫자: 한국어로 읽었을 때 받침 유무
  if (code >= 0x30 && code <= 0x39) {
    // 0(영),1(일),3(삼),6(육),7(칠),8(팔) → 받침 O
    return '013678'.includes(char);
  }
  // 영문: 알파벳 이름으로 읽었을 때 받침 유무
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
    return 'lmnrLMNR'.includes(char);
  }
  return false;
}

// [받침 O, 받침 X]
const PARTICLE_PAIRS = {
  '은': ['은', '는'],
  '는': ['은', '는'],
  '이': ['이', '가'],
  '가': ['이', '가'],
  '을': ['을', '를'],
  '를': ['을', '를'],
  '과': ['과', '와'],
  '와': ['과', '와'],
  '으로': ['으로', '로'],
  '로': ['으로', '로'],
  '아': ['아', '야'],
  '야': ['아', '야'],
};

/**
 * 이름 + 조사 결합 (받침 자동 판별)
 * @param {string} name - 이름
 * @param {string} particle - 조사 (은/는/이/가/을/를/과/와/으로/로/아/야)
 * @returns {string} 이름+올바른조사
 */
function postposition(name, particle) {
  const str = String(name || '').trim();
  if (!str) return particle || '';
  const lastChar = str[str.length - 1];
  const pair = PARTICLE_PAIRS[particle];
  if (!pair) return `${str}${particle}`;
  const idx = hasFinalConsonant(lastChar) ? 0 : 1;
  return `${str}${pair[idx]}`;
}

module.exports = { postposition, hasFinalConsonant };
