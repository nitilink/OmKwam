// Helpers for the "ตรวจผู้พูด" pass: attach ถาม/พยาน prefixes and line
// breaks to the *raw* transcript without letting the model rewrite words.
// Existing typo corrections must survive this pass so ตรวจคำผิด can run
// before or after speaker labeling with the same final wording.

export const SPEAKER_LINE_PREFIX = /^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)(\s*[:：]\s*)/;

export const SEG_START_PREFIX = "<<<OMKWAM_SEG ";
export const SEG_END_MARKER = "<<<END_OMKWAM_SEG>>>";

export function speakerLinePrefix(label) {
  const name = label === "ถาม" ? "ถาม" : "พยาน";
  return `${name} : `;
}

export function parseLabeledLines(text) {
  return String(text || "").split(/\r?\n/).map((line) => {
    const match = line.match(SPEAKER_LINE_PREFIX);
    if (!match) return { label: null, text: line };
    return {
      label: match[1] === "ถาม" ? "ถาม" : "พยาน",
      text: line.slice(match[0].length),
    };
  });
}

export function stripSpeakerPrefixes(text) {
  return String(text || "").split(/\r?\n/).map((line) => {
    const match = line.match(SPEAKER_LINE_PREFIX);
    return match ? line.slice(match[0].length) : line;
  }).join("\n");
}

function buildCompactIndex(raw, from = 0) {
  const chars = [];
  for (let i = from; i < raw.length; i += 1) {
    if (!/\s/.test(raw[i])) chars.push({ ch: raw[i], i });
  }
  return chars;
}

// Find the first slice of `raw` at or after `from` whose non-whitespace
// characters equal `compact`. Returns { start, end } in the original raw, or
// null if not found.
export function findCompactSlice(raw, compact, from = 0) {
  const source = String(raw || "");
  const needle = String(compact || "");
  if (!needle) {
    let start = from;
    while (start < source.length && /\s/.test(source[start])) start += 1;
    return { start, end: start };
  }
  const chars = buildCompactIndex(source, from);
  const hay = chars.map((item) => item.ch).join("");
  const at = hay.indexOf(needle);
  if (at === -1) return null;
  return { start: chars[at].i, end: chars[at + needle.length - 1].i + 1 };
}

function longestNeedlePrefix(hay, needle, minLen) {
  for (let len = needle.length; len >= minLen; len -= 1) {
    const at = hay.indexOf(needle.slice(0, len));
    if (at !== -1) return { at, len };
  }
  return null;
}

function longestNeedleSuffix(hay, needle, minLen) {
  for (let len = needle.length; len >= minLen; len -= 1) {
    const at = hay.lastIndexOf(needle.slice(-len));
    if (at !== -1) return { at, len };
  }
  return null;
}

// Like findCompactSlice, but tolerates a short typo/rewrite in the reviewed
// line (e.g. เหตูการณ์ vs เหตุการณ์, ข้าพเจ้า vs ข้าฯ). The returned slice
// is always a range in the RAW text so original words are kept.
function levenshtein(a, b) {
  const source = String(a || "");
  const target = String(b || "");
  if (source === target) return 0;
  if (!source.length) return target.length;
  if (!target.length) return source.length;
  let prev = new Array(target.length + 1);
  for (let j = 0; j <= target.length; j += 1) prev[j] = j;
  for (let i = 1; i <= source.length; i += 1) {
    const cur = new Array(target.length + 1);
    cur[0] = i;
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[target.length];
}

function maxEditDistance(needleLen) {
  // Short words may differ by a single typo, but เห็นค่ะ vs เห็นครับ must
  // not count as the same token. Longer lines need more slack so ข้าพเจ้า
  // vs ข้าฯ (4 characters) on a spoken sentence still aligns.
  if (needleLen <= 8) return 1;
  return Math.max(1, Math.floor(needleLen * 0.2));
}

// From an anchor in `hay`, grow a window until it is within the typo budget
// of `needle`. Used so a one-character typo near the end of a short line
// (โอกาศ/โอกาส, suffix only 3 letters) or a pronoun rewrite (ข้าพเจ้า/ข้าฯ)
// still maps onto the RAW slice.
function bestWindowFrom(hay, needle, start, maxDist) {
  if (start < 0 || start >= hay.length) return null;
  const minEnd = start + 1;
  const maxEnd = Math.min(hay.length, start + needle.length + maxDist);
  let best = null;
  for (let end = minEnd; end <= maxEnd; end += 1) {
    const dist = levenshtein(hay.slice(start, end), needle);
    if (dist > maxDist) continue;
    if (!best || dist < best.dist || (dist === best.dist && Math.abs((end - start) - needle.length) < Math.abs((best.end - start) - needle.length))) {
      best = { end, dist };
    }
  }
  return best;
}

export function findFuzzyCompactSlice(raw, compact, from = 0) {
  const exact = findCompactSlice(raw, compact, from);
  if (exact) return exact;
  const needle = String(compact || "");
  if (needle.length < 2) return null;
  const source = String(raw || "");
  const chars = buildCompactIndex(source, from);
  if (!chars.length) return null;
  const hay = chars.map((item) => item.ch).join("");
  const maxDist = maxEditDistance(needle.length);
  const minAnchor = Math.max(2, Math.min(4, Math.floor(needle.length * 0.2)));
  const prefix = longestNeedlePrefix(hay, needle, minAnchor);
  const suffix = longestNeedleSuffix(hay, needle, minAnchor);

  let start = null;
  let end = null;
  if (prefix && suffix && suffix.at + suffix.len > prefix.at) {
    const combined = prefix.len + suffix.len;
    // A short suffix like "พูด" must not lastIndexOf all the way to a later
    // line; only accept the combined span if it stays near the needle length
    // or the typo budget.
    const span = suffix.at + suffix.len - prefix.at;
    if (span > 0 && span <= needle.length + maxDist && (combined >= needle.length * 0.55 || levenshtein(hay.slice(prefix.at, suffix.at + suffix.len), needle) <= maxDist)) {
      start = prefix.at;
      end = suffix.at + suffix.len;
    }
  }
  if (start == null && prefix && prefix.len >= Math.max(minAnchor, needle.length * 0.4)) {
    const window = bestWindowFrom(hay, needle, prefix.at, maxDist);
    if (window) {
      start = prefix.at;
      end = window.end;
    }
  }
  if (start == null && suffix && suffix.len >= Math.max(minAnchor, needle.length * 0.4)) {
    const suffixEnd = suffix.at + suffix.len;
    const minStart = Math.max(0, suffixEnd - needle.length - maxDist);
    let best = null;
    for (let at = minStart; at < suffixEnd; at += 1) {
      const dist = levenshtein(hay.slice(at, suffixEnd), needle);
      if (dist > maxDist) continue;
      if (!best || dist < best.dist || (dist === best.dist && at < best.at)) best = { at, dist };
    }
    if (best) {
      start = best.at;
      end = suffixEnd;
    }
  }
  if (start == null || end == null || end <= start) return null;
  return { start: chars[start].i, end: chars[end - 1].i + 1, fuzzy: true };
}

function compactChars(text) {
  return String(text || "").replace(/\s+/g, "");
}

function formatLabeledLine(label, rawSlice) {
  const body = String(rawSlice || "");
  if (!label) return body;
  return `${speakerLinePrefix(label)}${body}`;
}

// Rebuild text so every character (except whitespace arrangement in the
// reviewed line breaks) comes from `rawText`. Labels and extra line breaks
// come from `reviewedText`. If a reviewed line cannot be found in the
// remaining raw text, it is skipped so the model cannot reintroduce a typo
// or drop/replace a word.
export function applySpeakerLabelsPreservingWords(rawText, reviewedText) {
  const raw = String(rawText || "");
  const lines = parseLabeledLines(reviewedText);
  if (!lines.some((line) => line.label)) return raw;
  const parts = [];
  let cursor = 0;
  let pendingBreak = false;
  lines.forEach((line) => {
    const needle = compactChars(line.text);
    if (!needle) {
      if (parts.length) pendingBreak = true;
      return;
    }
    const hit = findFuzzyCompactSlice(raw, needle, cursor);
    if (!hit) return;
    // Preserve any unlabeled raw gap (do not drop text the model skipped).
    const gap = raw.slice(cursor, hit.start);
    if (compactChars(gap)) {
      if (parts.length) parts.push("\n");
      parts.push(gap.replace(/^\s+|\s+$/g, ""));
    }
    if (parts.length) parts.push("\n");
    else if (pendingBreak) parts.push("");
    parts.push(formatLabeledLine(line.label, raw.slice(hit.start, hit.end)));
    cursor = hit.end;
    pendingBreak = false;
  });
  const leftover = raw.slice(cursor);
  if (compactChars(leftover)) {
    if (parts.length) parts.push("\n");
    parts.push(leftover.replace(/^\s+/, ""));
  }
  return parts.join("") || raw;
}

export function wrapSegmentsForReview(targets) {
  const list = (targets || []).filter((target) => String(target?.text || "").trim());
  if (!list.length) return { text: "", wrapped: false };
  if (list.length === 1) return { text: String(list[0].text), wrapped: false, ids: [list[0].id] };
  return {
    text: list.map((target) => `${SEG_START_PREFIX}${target.id}>>>\n${target.text}\n${SEG_END_MARKER}`).join("\n\n"),
    wrapped: true,
    ids: list.map((target) => target.id),
  };
}

export function splitReviewedByMarkers(reviewed, ids) {
  const source = String(reviewed || "");
  const result = new Map();
  (ids || []).forEach((id) => {
    const startToken = `${SEG_START_PREFIX}${id}>>>`;
    const start = source.indexOf(startToken);
    if (start === -1) return;
    const bodyStart = start + startToken.length;
    const end = source.indexOf(SEG_END_MARKER, bodyStart);
    const body = (end === -1 ? source.slice(bodyStart) : source.slice(bodyStart, end)).replace(/^\s+|\s+$/g, "");
    result.set(id, body);
  });
  return result.size ? result : null;
}

// Apply a (possibly combined) review to many raw segments without merging
// them. Each segment keeps its id and only receives labels/line breaks.
export function applyReviewedTextToRawSegments(targets, reviewedText) {
  const list = (targets || []).filter((target) => target && String(target.text || "").trim());
  if (!list.length) return [];
  const byMarker = splitReviewedByMarkers(reviewedText, list.map((target) => target.id));
  if (byMarker && byMarker.size === list.length) {
    return list.map((target) => ({
      id: target.id,
      text: applySpeakerLabelsPreservingWords(target.text, byMarker.get(target.id) || target.text),
    }));
  }
  // Sequential consume: walk reviewed lines across segments in order.
  const lines = parseLabeledLines(reviewedText);
  let lineIndex = 0;
  return list.map((target) => {
    const raw = String(target.text || "");
    let cursor = 0;
    const used = [];
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      const needle = compactChars(line.text);
      if (!needle) {
        lineIndex += 1;
        continue;
      }
      const remaining = compactChars(raw.slice(cursor));
      if (!remaining) break;
      // Prefer a typo-tolerant match in this segment. An exact-prefix-only
      // check used to attach the first already-corrected line, then give up
      // when the model rewrote ข้าพเจ้า as ข้าฯ on the next line, leaving
      // that line unlabeled (ตรวจคำผิด then ตรวจผู้พูด looked wrong).
      const hit = findFuzzyCompactSlice(raw, needle.length <= remaining.length ? needle : remaining, cursor);
      if (!hit && needle.length > remaining.length && (remaining.startsWith(needle.slice(0, Math.min(4, needle.length))) || needle.startsWith(remaining))) {
        const part = findFuzzyCompactSlice(raw, remaining, cursor);
        if (part) {
          used.push({ label: line.label, start: part.start, end: part.end });
          cursor = part.end;
          // same reviewed line continues into the next segment
          if (cursor >= raw.length || !compactChars(raw.slice(cursor))) break;
          continue;
        }
      }
      if (!hit) break;
      used.push({ label: line.label, start: hit.start, end: hit.end });
      cursor = hit.end;
      if (needle.length <= remaining.length) lineIndex += 1;
      if (cursor >= raw.length || !compactChars(raw.slice(cursor))) break;
    }
    if (!used.length) {
      return { id: target.id, text: applySpeakerLabelsPreservingWords(raw, reviewedText) };
    }
    const parts = used.map((item, index) => {
      const slice = raw.slice(item.start, item.end);
      const prefix = index === 0 && item.start > 0 && compactChars(raw.slice(0, item.start))
        ? `${raw.slice(0, item.start).replace(/^\s+|\s+$/g, "")}\n`
        : "";
      return `${prefix}${formatLabeledLine(item.label, slice)}`;
    });
    const leftover = raw.slice(cursor);
    if (compactChars(leftover)) parts.push(leftover.replace(/^\s+/, ""));
    return { id: target.id, text: parts.join("\n") };
  });
}
