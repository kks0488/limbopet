/**
 * Minimal "loose JSON" parser for model outputs.
 * - Accepts plain JSON
 * - Accepts JSON wrapped in ```json fences
 * - Attempts to extract the first {...} or [...] block
 */

function stripCodeFences(s) {
  return String(s || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
}

function extractEnclosed(text, openChar, closeChar) {
  const s = String(text || '');
  const start = s.indexOf(openChar);
  const end = s.lastIndexOf(closeChar);
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return null;
}

function parseJsonLoose(text) {
  const cleaned = stripCodeFences(text);
  if (!cleaned) throw new Error('Empty model output');

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  const obj = extractEnclosed(cleaned, '{', '}');
  if (obj) {
    try {
      return JSON.parse(obj);
    } catch {
      // continue
    }
  }

  const arr = extractEnclosed(cleaned, '[', ']');
  if (arr) {
    try {
      return JSON.parse(arr);
    } catch {
      // continue
    }
  }

  throw new Error('Failed to parse JSON from model output');
}

module.exports = { parseJsonLoose };

