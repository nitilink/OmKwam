// All Gemini prompt text lives in this file, and only in this file.
//
// ============================================================================
// PUBLIC-SOURCE REDACTED PACKAGE — OmKwam v0.39
// ----------------------------------------------------------------------------
// The actual Gemini prompt text has been REDACTED from this public package for
// transparency and review only. This file is intentionally NOT functional as-is:
// restore the private prompt text (kept by the maintainer) before deploying.
//
// Preserved for review: every export name and function signature, the inputs
// each prompt consumes, and the JSON output contract expected back from Gemini.
// Removed: the exact Thai instruction wording.
// ============================================================================

const REDACTED =
  "[REDACTED FOR PUBLIC RELEASE - restore the private Gemini prompt text before deployment]";

// Master rules for rewriting witness answers into formal court language.
export const SUMMARY_RULES_PROMPT = REDACTED;

// Rules for flagging words/phrases the user should double-check.
export const SUMMARY_REVIEW_RULES_PROMPT = REDACTED;

// Appended to every request so identical audio/text is never served from cache.
// Uses: requestId
export function buildNoCacheDirective(requestId) {
  void requestId;
  return REDACTED;
}

// Transcribes an audio clip into plain, unedited "raw text".
// Uses: chunk (index/count) when a long recording was split client-side.
export function buildRawTranscriptionPrompt(chunk = null) {
  void chunk;
  return REDACTED;
}

// Transcribes a document image (a photo/scan or one PDF page rendered as an
// image) into unedited raw text. Must not force ถาม/พยาน line labels.
// Uses: page (index/count) when a document was split into pages client-side.
export function buildDocumentTranscriptionPrompt(page = null) {
  void page;
  return REDACTED;
}

// Second pass: inserts or re-checks speaker labels, Thai word spacing,
// multi-question lines, and document headers. Must keep original words.
// Uses: transcriptText
export function buildSpeakerReviewPrompt(transcriptText) {
  void transcriptText;
  return REDACTED;
}

// Builds the full court-style summary prompt.
// Uses: dictionary, caseInfoText, instructions, transcriptText
// Returns (from Gemini) JSON:
//   { "summaryText": string,
//     "reviewItems": [ { "text": string, "isUnclear": boolean,
//       "isOutofContext": boolean, "issueDescription": string,
//       "suggestions": string[] } ] }
export function buildSummaryPrompt({ dictionary, caseInfoText, instructions, transcriptText }) {
  void dictionary; void caseInfoText; void instructions; void transcriptText;
  return REDACTED;
}

// Re-scans an already-written summary for words/phrases to double-check.
// Uses: summaryText
// Returns (from Gemini) JSON:
//   { "issues": [ { "text": string, "isUnclear": boolean,
//     "isOutofContext": boolean, "issueDescription": string,
//     "suggestions": string[] } ] }
export function buildSummaryIssueAnalysisPrompt(summaryText) {
  void summaryText;
  return REDACTED;
}

// Checks a transcript or document text for clear Thai spelling mistakes only.
// Uses: transcriptText
// Returns (from Gemini) JSON:
//   { "corrections": [ { "original": string, "corrected": string } ] }
export function buildSpellcheckPrompt(transcriptText) {
  void transcriptText;
  return REDACTED;
}

// Layout-only tidy: whitespace and line breaks, never wording.
// Uses: text
export function buildReflowPrompt(text) {
  void text;
  return REDACTED;
}
