// All Gemini prompt text lives in this file, and only in this file.
//
// ============================================================================
// PUBLIC-SOURCE REDACTED PACKAGE — OmKwam v0.38b
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

// Second pass: re-checks speaker labels, Thai word spacing, multi-question lines.
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
//       "isOutofContext": boolean, "issueDescription": string,
//       "suggestions": string[] } ] }
export function buildSummaryIssueAnalysisPrompt(summaryText) {
  void summaryText;
  return REDACTED;
}
