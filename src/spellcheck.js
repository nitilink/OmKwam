// Pure helpers for the "ตรวจคำผิด" pass: locate conservative typo fixes,
// apply them, render click-to-revert marks, and split long text into chunks.
// Whitespace-only changes are applied but never highlighted.

export const SPELLCHECK_CHUNK_CHARS = 2800;
export const SPELL_BUSY = "spellchecking";

export function isWhitespaceOnlyFix(original, corrected) {
  const from = String(original ?? "");
  const to = String(corrected ?? "");
  if (from === to) return false;
  return from.replace(/\s+/g, "") === to.replace(/\s+/g, "");
}

export function normalizeCorrections(raw) {
  const list = Array.isArray(raw) ? raw
    : (Array.isArray(raw?.corrections) ? raw.corrections : []);
  return list.map((item) => {
    const original = String(item?.original ?? item?.from ?? "");
    const corrected = String(item?.corrected ?? item?.to ?? "");
    return { original, corrected };
  }).filter((item) => item.original && item.corrected && item.original !== item.corrected);
}

export function parseSpellcheckResponse(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned) return { corrections: [] };
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("ผลตรวจคำผิดไม่ใช่ JSON ที่ใช้ได้");
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }
  return { corrections: normalizeCorrections(parsed) };
}

function rangesOverlap(a, b) {
  return a.start < b.end && a.end > b.start;
}

const SPEAKER_LINE_PREFIX = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]\s*/;

function rangeHitsSpeakerPrefix(source, start) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nl = source.indexOf("\n", lineStart);
  const line = source.slice(lineStart, nl === -1 ? source.length : nl);
  const match = line.match(SPEAKER_LINE_PREFIX);
  return Boolean(match) && start < lineStart + match[0].length;
}

// Find each correction's first unused occurrence in the original text.
export function locateCorrections(text, corrections) {
  const source = String(text || "");
  const used = [];
  const located = [];
  const seenPairs = new Set();
  for (const item of normalizeCorrections(corrections)) {
    const key = `${item.original}\0${item.corrected}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    let from = 0;
    let idx = -1;
    while ((idx = source.indexOf(item.original, from)) !== -1) {
      const range = { start: idx, end: idx + item.original.length };
      if (rangeHitsSpeakerPrefix(source, range.start)) {
        from = idx + Math.max(item.original.length, 1);
        continue;
      }
      if (!used.some((seen) => rangesOverlap(seen, range))) {
        used.push(range);
        located.push({
          original: item.original,
          corrected: item.corrected,
          start: range.start,
          end: range.end,
          whitespaceOnly: isWhitespaceOnlyFix(item.original, item.corrected),
        });
      }
      from = idx + Math.max(item.original.length, 1);
    }
  }
  return located.sort((a, b) => a.start - b.start);
}

export function applyLocatedCorrections(text, located) {
  const source = String(text || "");
  let out = "";
  let cursor = 0;
  const fixes = [];
  for (const item of located) {
    if (item.start < cursor || item.end > source.length) continue;
    out += source.slice(cursor, item.start);
    const start = out.length;
    out += item.corrected;
    fixes.push({
      id: item.id || `fix-${start}-${item.original.length}`,
      original: item.original,
      corrected: item.corrected,
      start,
      end: out.length,
      whitespaceOnly: Boolean(item.whitespaceOnly),
    });
    cursor = item.end;
  }
  out += source.slice(cursor);
  return { text: out, fixes };
}

export function applyCorrectionsToText(text, corrections) {
  return applyLocatedCorrections(text, locateCorrections(text, corrections));
}

export function highlightedFixCount(fixes = []) {
  return (fixes || []).filter((fix) => !fix.whitespaceOnly).length;
}

// Re-anchor stored fixes in the current text (after later edits or a render).
export function locateStoredFixes(text, fixes) {
  const source = String(text || "");
  const used = [];
  const located = [];
  for (const fix of fixes || []) {
    const needle = String(fix.corrected || "");
    if (!needle) continue;
    const original = String(fix.original || "");
    const tryRange = (start) => {
      if (start < 0 || start + needle.length > source.length) return null;
      if (source.slice(start, start + needle.length) !== needle) return null;
      // If the typo itself is still at this index (e.g. "อนุญาต" inside
      // unfixed "อนุญาติ"), this is not a real applied correction.
      if (original && original !== needle && source.slice(start, start + original.length) === original) {
        return null;
      }
      const range = { start, end: start + needle.length };
      if (used.some((seen) => rangesOverlap(seen, range))) return null;
      return range;
    };
    let range = Number.isFinite(Number(fix.start)) ? tryRange(Number(fix.start)) : null;
    if (!range) {
      let from = 0;
      let idx = -1;
      while ((idx = source.indexOf(needle, from)) !== -1) {
        range = tryRange(idx);
        if (range) break;
        from = idx + 1;
      }
    }
    if (!range) continue;
    used.push(range);
    located.push({
      ...fix,
      start: range.start,
      end: range.end,
      whitespaceOnly: Boolean(fix.whitespaceOnly),
    });
  }
  return located.sort((a, b) => a.start - b.start);
}

export function revertFixInText(text, fix) {
  const source = String(text || "");
  const located = locateStoredFixes(source, [fix]);
  if (!located.length) {
    return { text: source, found: false };
  }
  const hit = located[0];
  return {
    text: source.slice(0, hit.start) + fix.original + source.slice(hit.end),
    found: true,
  };
}

export function splitTextIntoSpellChunks(text, maxChars = SPELLCHECK_CHUNK_CHARS) {
  const source = String(text || "");
  if (!source) return [];
  if (source.length <= maxChars) {
    return [{ text: source, start: 0, end: source.length }];
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + maxChars);
    if (end < source.length) {
      const window = source.slice(cursor, end);
      const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      if (breakAt >= Math.floor(maxChars * 0.4)) {
        end = cursor + breakAt + 1;
      }
    }
    const slice = source.slice(cursor, end);
    if (slice) chunks.push({ text: slice, start: cursor, end });
    cursor = end;
  }
  return chunks;
}

// Walk text and wrap highlighted (non-whitespace) fixes. `renderPlain` turns
// a raw substring into HTML (for speaker labels, etc.).
export function renderTextWithSpellFixes(text, fixes, renderPlain) {
  const source = String(text || "");
  const paint = typeof renderPlain === "function" ? renderPlain : (value) => value;
  const marks = locateStoredFixes(source, (fixes || []).filter((fix) => !fix.whitespaceOnly));
  if (!marks.length) return paint(source);
  let cursor = 0;
  const parts = [];
  marks.forEach((mark) => {
    if (mark.start > cursor) parts.push(paint(source.slice(cursor, mark.start)));
    const title = `คลิกเพื่อกลับเป็น “${mark.original}”`;
    parts.push(`<span class="spell-fix" role="button" tabindex="0" data-spell-fix-id="${escapeAttr(mark.id)}" title="${escapeAttr(title)}">${paint(mark.corrected)}</span>`);
    cursor = mark.end;
  });
  if (cursor < source.length) parts.push(paint(source.slice(cursor)));
  return parts.join("");
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSpellResultMessage({ highlighted = 0, whitespace = 0 } = {}) {
  if (highlighted > 0 && whitespace > 0) {
    return `แก้คำผิด ${highlighted} คำ และจัดช่องว่างแล้ว — คลิกคำสีเหลืองเพื่อกลับเป็นคำเดิม`;
  }
  if (highlighted > 0) {
    return `แก้คำผิด ${highlighted} คำ — คลิกคำสีเหลืองเพื่อกลับเป็นคำเดิม`;
  }
  if (whitespace > 0) {
    return "จัดช่องว่างแล้ว ไม่พบคำผิด";
  }
  return "ไม่พบคำผิด";
}


export function selectUncheckedOkIds(segments, checkedIds) {
  const checked = new Set(checkedIds || []);
  return (segments || [])
    .filter((segment) => segment && segment.status === "ok" && String(segment.text || "").trim() && !checked.has(segment.id))
    .map((segment) => segment.id);
}
