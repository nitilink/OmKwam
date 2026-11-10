// Layout-only tidy for image/audio transcripts and summaries.
// Changes whitespace (and hyphen-at-line-break) only — never rewrites words.

const SPEAKER_ONLY_LINE = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]\s*$/;
const SPEAKER_START = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]/;
const LIST_START = /^\s*(?:[\d๐-๙]+[.)]\s+|[-*•]\s+)/;
const SENTENCE_END = /(?:[.!?…๏ฯ]|[”"»]|\))\s*$/;

export function layoutFingerprint(text) {
  return String(text || "")
    .replace(/-\s*\n/g, "")
    .replace(/\s+/g, "");
}

export function isLayoutOnlyChange(original, next) {
  return layoutFingerprint(original) === layoutFingerprint(next);
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
  const needSpace = (
    (isLatinOrDigit(a) || /[,:;%]/.test(a)) && (isLatinOrDigit(b) || isThaiChar(b) || b === "(")
  ) || (
    isThaiChar(a) && (isLatinOrDigit(b) || b === "(")
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

export function reflowTextLocally(text) {
  const source = String(text || "");
  if (!source.trim()) return source;
  const paragraphs = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const tidied = paragraphs.map((block) => tidyParagraph(block.split("\n"))).filter((block) => block.trim());
  return tidied.join("\n\n");
}

export function applyLayoutReflow(original, proposed) {
  const source = String(original || "");
  const next = String(proposed ?? "");
  if (!source.trim()) return { text: source, accepted: false, reason: "empty" };
  if (next === source) return { text: source, accepted: true, reason: "unchanged" };
  if (isLayoutOnlyChange(source, next) && next.trim()) {
    return { text: next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " "), accepted: true, reason: "ok" };
  }
  const local = reflowTextLocally(source);
  if (local !== source && isLayoutOnlyChange(source, local)) {
    return { text: local, accepted: true, reason: "local-fallback" };
  }
  return { text: source, accepted: false, reason: "rejected" };
}
