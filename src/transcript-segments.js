// Helpers for progressive per-chunk transcript segments.
// Failed segments render as UI placeholders and are excluded from copy/export/summary text.

export function formatChunkClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatChunkRangeLabel(startSeconds, endSeconds) {
  return `${formatChunkClock(startSeconds)}–${formatChunkClock(endSeconds)}`;
}

export function createTranscriptSegmentsFromPlan(plan, audioSourceId) {
  const chunks = Array.isArray(plan?.chunks) ? plan.chunks : [{ index: 0, startSeconds: 0, endSeconds: 0 }];
  return chunks.map((chunk, index) => ({
    id: `src${audioSourceId}-chunk${index}`,
    audioSourceId,
    chunkIndex: index,
    chunkCount: chunks.length,
    startSeconds: Number(chunk.startSeconds) || 0,
    endSeconds: Number(chunk.endSeconds) || 0,
    status: "pending", // pending | transcribing | ok | failed
    text: "",
    errorMessage: "",
  }));
}

export function getFailedSegments(segments) {
  return (Array.isArray(segments) ? segments : []).filter((segment) => segment.status === "failed");
}

export function hasFailedSegments(segments) {
  return getFailedSegments(segments).length > 0;
}

export function joinOkSegmentTexts(segments) {
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => segment.status === "ok" && String(segment.text || "").trim())
    .map((segment) => String(segment.text).trim())
    .join("\n\n");
}

export function findSegmentById(segments, id) {
  return (Array.isArray(segments) ? segments : []).find((segment) => segment.id === id) || null;
}

// Wraps text that existed before segment mode (typed text, an earlier
// transcript, speaker-reviewed text) so a new import appends after it instead
// of erasing it.
export function createStaticTextSegment(text, id = `text-${Date.now()}`) {
  return {
    id,
    audioSourceId: null,
    chunkIndex: 0,
    chunkCount: 1,
    startSeconds: 0,
    endSeconds: 0,
    status: "ok",
    text: String(text || "").trim(),
    errorMessage: "",
    isStatic: true,
  };
}

// Puts the segments of a freshly started transcription into the transcript:
// - segments from OTHER audio sources (and earlier typed text) are kept;
// - if this audio source was transcribed before, its old segments are
//   replaced in place (matched by audioSourceId, never by text search);
// - otherwise the new segments are appended at the end.
export function mergeNewSourceSegments(existingSegments, legacyText, newSegments, audioSourceId) {
  let base = Array.isArray(existingSegments) ? existingSegments.slice() : [];
  if (!Array.isArray(existingSegments) && String(legacyText || "").trim()) {
    base = [createStaticTextSegment(legacyText)];
  }
  const firstOld = base.findIndex((segment) => segment.audioSourceId === audioSourceId);
  const kept = base.filter((segment) => segment.audioSourceId !== audioSourceId);
  const insertAt = firstOld === -1 ? kept.length : base.slice(0, firstOld).filter((segment) => segment.audioSourceId !== audioSourceId).length;
  return [...kept.slice(0, insertAt), ...newSegments, ...kept.slice(insertAt)];
}

// Any segment left pending/transcribing (e.g. the user pressed stop) becomes a
// failed box so it can be retried later. Returns how many were marked.
export function isDocumentSegment(segment) {
  return segment?.sourceKind === "document";
}

export function areDocumentSegments(segments) {
  const list = Array.isArray(segments) ? segments.filter(Boolean) : [];
  return list.length > 0 && list.every(isDocumentSegment);
}

export const CANCELLED_AUDIO_SEGMENT_MESSAGE = "หยุดก่อนถอดท่อนนี้เสร็จ กดถอดท่อนนี้ใหม่ได้";
export const CANCELLED_DOCUMENT_SEGMENT_MESSAGE = "หยุดก่อนถอดหน้านี้เสร็จ กดถอดหน้านี้ใหม่ได้";

export function cancelledMessageForSegment(segment) {
  return isDocumentSegment(segment) ? CANCELLED_DOCUMENT_SEGMENT_MESSAGE : CANCELLED_AUDIO_SEGMENT_MESSAGE;
}

export function failUnfinishedSegments(segments, message) {
  let count = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (segment.status === "pending" || segment.status === "transcribing") {
      segment.status = "failed";
      segment.text = "";
      const fallback = cancelledMessageForSegment(segment);
      segment.errorMessage = isDocumentSegment(segment) && (!message || message === CANCELLED_AUDIO_SEGMENT_MESSAGE)
        ? fallback
        : (message || fallback);
      count += 1;
    }
  }
  return count;
}

export function formatDocumentPageLabel(segment) {
  const number = Number(segment?.pageNumber) || (Number(segment?.chunkIndex) + 1) || 1;
  const name = String(segment?.filename || "").trim();
  return name ? `หน้าที่ ${number} · ${name}` : `หน้าที่ ${number}`;
}

// One image or one PDF page becomes one retryable segment. Reuses
// audioSourceId as the generic source id so mergeNewSourceSegments works
// unchanged (document and audio source ids share one counter).
export function createTranscriptSegmentsFromDocument(pages, sourceId) {
  const list = Array.isArray(pages) ? pages : [];
  return list.map((page, index) => ({
    id: `src${sourceId}-${page.id || `page${index}`}`,
    audioSourceId: sourceId,
    sourceKind: "document",
    chunkIndex: index,
    chunkCount: list.length,
    startSeconds: 0,
    endSeconds: 0,
    pageNumber: index + 1,
    pageId: page.id || "",
    filename: page.filename || page.originName || "",
    status: "pending",
    text: "",
    errorMessage: "",
  }));
}
