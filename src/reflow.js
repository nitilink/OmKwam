// Layout-only tidy for image/audio transcripts and summaries.
// Changes whitespace (and hyphen-at-line-break) only — never rewrites words.

const SPEAKER_ONLY_LINE = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]\s*$/;
const SPEAKER_START = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]/;
const LIST_START = /^\s*(?:[\d๐-๙]+[.)]\s+|[-*•]\s+)/;
const THAI_WORD_CHAR = "\u0E00-\u0E2E\u0E30-\u0E3E\u0E40-\u0E4E\u0E5C-\u0E7F";
const THAI_TOKEN = new RegExp(`^[${THAI_WORD_CHAR}]+$`);
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;
const SPLIT_WS = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/;

export const REFLOW_TIMEOUT_MS = 60 * 1000;
export const REFLOW_BUTTON_LABEL = "จัดหน้า";
export const REFLOW_SUCCESS_MESSAGE = "จัดหน้าเรียบร้อย หากต้องการยกเลิกให้กดปุ่ม «จัดหน้า» อีกครั้ง หรือกด Ctrl+Z";
export const REFLOW_TRY_AGAIN = "กรุณาลองใหม่อีกครั้ง";

export const REFLOW_FAIL_REASONS = {
  network: "เชื่อมต่อ Gemini ไม่ได้",
  timeout: "Gemini ไม่ตอบกลับภายในเวลาที่กำหนด",
  capacity: "เซิร์ฟเวอร์ Gemini ไม่ว่าง (503)",
  rejected: "ผลที่ได้มีคำเปลี่ยนไป",
  invalidKey: "คีย์ไม่ถูกต้อง",
  cancelled: "ถูกยกเลิก",
  quota: "โควต้า Gemini หมด",
  unknown: "เกิดข้อผิดพลาด",
};

const AFTER_STRONG = new Set([
  "ครับ", "ค่ะ", "คะ", "จ้ะ", "จ๊ะ", "ครับผม", "นะครับ", "นะคะ",
  "เว้ย", "อ่ะ", "อะ", "ไง", "หรอก",
  "เออ", "อ่า", "อ้า", "อ๋อ", "อืม", "เอ้อ",
]);

const AFTER_WEAK = new Set(["นะ", "ล่ะ", "ละ"]);

const SUBJECT_PRONOUNS = new Set([
  "ผม", "เขา", "เรา", "ฉัน", "ดิฉัน", "ข้าพเจ้า", "ข้า", "ข้าฯ",
  "นาย", "แก", "มัน", "ท่าน", "คุณ", "เธอ", "พี่", "น้อง", "หนู",
]);

// Longer phrases first. spaceAfter: also leave a space after the joined phrase.
const CONNECTOR_PHRASES = [
  { parts: ["เสร็จ", "แล้ว"], spaceAfter: false },
  { parts: ["แล้ว", "ก็"], spaceAfter: false },
  { parts: ["ก็", "เลย"], spaceAfter: false },
  { parts: ["ที", "นี้"], spaceAfter: false },
  { parts: ["ที่", "ไหน", "นะ"], spaceAfter: true },
  { parts: ["ที่", "ไหน"], spaceAfter: true },
  { parts: ["หลังจาก", "นั้น"], spaceAfter: false },
  { parts: ["จาก", "นั้น"], spaceAfter: false },
  { parts: ["ต่อ", "มา"], spaceAfter: false },
  { parts: ["เพราะ", "ฉะนั้น"], spaceAfter: false },
  { parts: ["เมื่อวันที่"], spaceAfter: false },
  { parts: ["ดังนั้น"], spaceAfter: false },
  { parts: ["เพราะ"], spaceAfter: false },
  { parts: ["ซึ่ง"], spaceAfter: false },
  { parts: ["แต่"], spaceAfter: false },
  { parts: ["เมื่อ"], spaceAfter: false },
];

const TOPIC_SHIFT = new Set(["เออ", "อ๋อ", "เอาล่ะ", "เอาละ"]);

export function formatReflowFailure(reasonText) {
  return `จัดหน้าไม่สำเร็จ เพราะ${reasonText} กรุณาลองใหม่อีกครั้ง`;
}

export function makeReflowTimeoutError() {
  const error = new Error(REFLOW_FAIL_REASONS.timeout);
  error.name = "TimeoutError";
  error.isTimeout = true;
  return error;
}

export function classifyReflowFailure(error, options = {}) {
  if (options.rejected && !error) return "rejected";
  if (error?.isCancelled || (error?.name === "AbortError" && !error?.isTimeout)) return "cancelled";
  if (error?.isTimeout || error?.name === "TimeoutError") return "timeout";
  const status = Number(error?.status) || 0;
  const message = String(error?.message || "");
  if (status === 503 || error?.isCapacity || /high demand|spikes? in demand|currently experiencing high demand|try again later|overloaded|\b503\b/i.test(message)) {
    return "capacity";
  }
  if (status === 429 || error?.isQuota || /quota|rate.?limit|free_tier_requests|\b429\b|exceeded/i.test(message)) {
    return "quota";
  }
  if (
    status === 400
    || status === 401
    || status === 403
    || /API_KEY_INVALID|invalid api key|API key not valid|กรุณาใส่ Gemini API key|คีย์ไม่ถูกต้อง|api key.*(missing|invalid)/i.test(message)
  ) {
    return "invalidKey";
  }
  if (
    error?.name === "TypeError"
    || /Failed to fetch|NetworkError|net::ERR|ENOTFOUND|ECONNRESET|ECONNREFUSED|network request failed|load failed/i.test(message)
  ) {
    return "network";
  }
  if (/timeout|timed out|deadline|ETIMEDOUT|aborted due to timeout/i.test(message)) {
    return "timeout";
  }
  if (options.rejected || error?.reason === "rejected") return "rejected";
  return "unknown";
}

export function reflowFailureMessage(error, options = {}) {
  const key = classifyReflowFailure(error, options);
  return formatReflowFailure(REFLOW_FAIL_REASONS[key] || REFLOW_FAIL_REASONS.unknown);
}

export function layoutFingerprint(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(/-\s*\n/g, "")
    .replace(/\s+/g, "");
}

export function isLayoutOnlyChange(original, next) {
  return layoutFingerprint(original) === layoutFingerprint(next);
}

export function isTypographyBlob(text, original = "") {
  const next = String(text || "");
  const source = String(original || next);
  const letters = layoutFingerprint(next).length;
  const nextWs = (next.match(/\s/g) || []).length;
  const srcWs = (source.match(/\s/g) || []).length;
  if (letters >= 80 && nextWs === 0 && srcWs >= 5) return true;
  if (letters >= 120 && nextWs < 2 && srcWs >= 8) return true;
  return false;
}

export function isWordSpacedThai(text) {
  const tokens = String(text || "").split(SPLIT_WS).filter(Boolean);
  if (tokens.length < 6) return false;
  const thaiTokens = tokens.filter((tok) => THAI_TOKEN.test(tok));
  if (thaiTokens.length < 5) return false;
  const average = thaiTokens.reduce((sum, tok) => sum + tok.length, 0) / thaiTokens.length;
  return average <= 8;
}

function isLatinOrDigitToken(tok) {
  return /[A-Za-z0-9]/.test(tok);
}

function endsWithPaiyannoi(tok) {
  return /ฯ$/.test(tok);
}

function matchConnector(tokens, index) {
  for (const phrase of CONNECTOR_PHRASES) {
    if (phrase.parts.every((part, offset) => tokens[index + offset] === part)) {
      return { text: phrase.parts.join(""), length: phrase.parts.length, spaceAfter: phrase.spaceAfter };
    }
  }
  return null;
}

function shouldSpaceAfterMarker(token, nextToken) {
  if (AFTER_STRONG.has(token) || endsWithPaiyannoi(token)) return true;
  if (AFTER_WEAK.has(token)) {
    if (!nextToken) return false;
    if ([...SUBJECT_PRONOUNS].some((pronoun) => nextToken === pronoun || nextToken.startsWith(pronoun))) return false;
    return true;
  }
  return false;
}

function shouldParagraphBefore(tokens, index, emitted) {
  if (index <= 0) return false;
  const token = tokens[index];
  if (!TOPIC_SHIFT.has(token)) return false;
  const soFar = emitted.replace(/\s+/g, "");
  if (soFar.length < 60) return false;
  const next = matchConnector(tokens, index + 1);
  return Boolean(next && next.text === "ทีนี้") || soFar.length >= 80;
}

export function tidyWordSpacedThai(text) {
  const tokens = String(text || "").trim().split(SPLIT_WS).filter(Boolean);
  if (!tokens.length) return String(text || "");
  let emitted = "";
  let pendingSpace = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const connector = matchConnector(tokens, i);
    const token = connector ? connector.text : tokens[i];
    const step = connector ? connector.length : 1;
    const prev = emitted.replace(/\s+$/u, "");
    const prevChar = prev ? prev[prev.length - 1] : "";
    const nextChar = token[0] || "";
    const acrossScript = (
      prevChar
      && (
        (isLatinOrDigit(prevChar) && (isThaiChar(nextChar) || nextChar === "("))
        || (isThaiChar(prevChar) && (isLatinOrDigit(nextChar) || nextChar === "("))
        || (isLatinOrDigit(prevChar) && isLatinOrDigit(nextChar))
      )
    );
    const paragraph = shouldParagraphBefore(tokens, i, emitted);
    const spaceBefore = Boolean(emitted) && (pendingSpace || Boolean(connector) || acrossScript || paragraph);
    if (paragraph && emitted) {
      emitted = emitted.replace(/[ \t]+$/u, "") + "\n\n";
    } else if (spaceBefore) {
      emitted = emitted.replace(/[ \t]+$/u, "") + " ";
    }
    emitted += token;
    const nextToken = tokens[i + step];
    pendingSpace = connector
      ? Boolean(connector.spaceAfter)
      : shouldSpaceAfterMarker(token, nextToken) || acrossScript && isLatinOrDigitToken(token);
    if (endsWithPaiyannoi(token)) pendingSpace = true;
    i += step - 1;
  }
  return emitted.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

function lastSignificantChar(text) {
  const trimmed = String(text || "").replace(/\s+$/u, "");
  return trimmed ? trimmed[trimmed.length - 1] : "";
}

function firstSignificantChar(text) {
  const trimmed = String(text || "").replace(/^\s+/u, "");
  return trimmed ? trimmed[0] : "";
}

function isThaiChar(ch) {
  return /[\u0E00-\u0E7F]/.test(ch);
}

function isLatinOrDigit(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

function shouldJoinLines(prev, next) {
  if (!String(prev || "").trim() || !String(next || "").trim()) return false;
  if (SPEAKER_ONLY_LINE.test(prev) || SPEAKER_START.test(next) || LIST_START.test(next)) return false;
  return true;
}

function joinLines(prev, next) {
  const right = String(next || "").replace(/^\s+/u, "");
  if (/-\s*$/.test(prev)) {
    return String(prev).replace(/-\s*$/, "") + right;
  }
  const left = String(prev).replace(/\s+$/u, "");
  const a = lastSignificantChar(left);
  const b = firstSignificantChar(right);
  const wordSpaced = isWordSpacedThai(prev) || isWordSpacedThai(next) || isWordSpacedThai(`${left} ${right}`);
  const needSpace = (
    (isLatinOrDigit(a) || /[,:;%]/.test(a)) && (isLatinOrDigit(b) || isThaiChar(b) || b === "(")
  ) || (
    isThaiChar(a) && (isLatinOrDigit(b) || b === "(")
  ) || (
    wordSpaced && isThaiChar(a) && isThaiChar(b)
  );
  if (needSpace) return `${left} ${right}`;
  if (isThaiChar(a) && isThaiChar(b)) return left + right;
  if (/\s$/.test(prev) || /^\s/.test(next)) return `${left} ${right}`;
  return left + right;
}

function tidyParagraph(lines) {
  const kept = [];
  for (const raw of lines) {
    const line = String(raw || "").replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (!kept.length || !shouldJoinLines(kept[kept.length - 1], line)) {
      kept.push(line);
    } else {
      kept[kept.length - 1] = joinLines(kept[kept.length - 1], line);
    }
  }
  return kept.join("\n");
}

function applyTypography(block) {
  const lines = String(block || "").split("\n");
  if (lines.length === 1) {
    return isWordSpacedThai(block) ? tidyWordSpacedThai(block) : block;
  }
  return lines.map((line) => {
    if (SPEAKER_ONLY_LINE.test(line)) return line;
    const speaker = line.match(/^((?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(?:ถาม|พยาน|ตอบ)\s*[:：]\s*)(.*)$/);
    if (speaker) {
      const prefix = speaker[1].trim();
      const rest = speaker[2].trim();
      if (!rest) return prefix;
      return `${prefix}\n${isWordSpacedThai(rest) ? tidyWordSpacedThai(rest) : rest}`;
    }
    const list = line.match(/^(\s*(?:[\d๐-๙]+[.)]\s+|[-*•]\s+))(.*)$/);
    if (list && isWordSpacedThai(list[2])) return list[1] + tidyWordSpacedThai(list[2]);
    return isWordSpacedThai(line) ? tidyWordSpacedThai(line) : line;
  }).join("\n");
}

export function reflowTextLocally(text) {
  const source = String(text || "");
  if (!source.trim()) return source;
  const paragraphs = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const tidied = paragraphs.map((block) => {
    const joined = tidyParagraph(block.split("\n"));
    const typography = applyTypography(joined);
    return typography;
  }).filter((block) => block.trim());
  const result = tidied.join("\n\n");
  if (isTypographyBlob(result, source) && isWordSpacedThai(source)) {
    const fallback = tidyWordSpacedThai(source.replace(/\n+/g, " "));
    if (!isTypographyBlob(fallback, source) && isLayoutOnlyChange(source, fallback)) return fallback;
    return source;
  }
  return result;
}

function unwrapProposed(text) {
  return String(text ?? "")
    .replace(/^\s*```(?:\w+)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
}

export function lightTidyWhitespace(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ");
}

export function applyLayoutReflow(original, proposed) {
  const source = String(original || "");
  if (!source.trim()) return { text: source, accepted: false, reason: "empty" };

  const next = unwrapProposed(proposed);
  const local = reflowTextLocally(source);
  const localOk = local !== source && isLayoutOnlyChange(source, local) && !isTypographyBlob(local, source);

  if (next && next !== source && isLayoutOnlyChange(source, next) && next.trim() && !isTypographyBlob(next, source)) {
    return { text: lightTidyWhitespace(next), accepted: true, reason: "ok" };
  }

  if (localOk) {
    const usedFallback = Boolean(
      (next && next !== source && !isLayoutOnlyChange(source, next))
      || (next && isTypographyBlob(next, source))
    );
    return { text: local, accepted: true, reason: usedFallback ? "local-fallback" : "ok" };
  }

  if (next && next !== source && !isLayoutOnlyChange(source, next)) {
    return { text: source, accepted: false, reason: "rejected" };
  }
  return { text: source, accepted: true, reason: "unchanged" };
}
