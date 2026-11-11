import {
  state,
  refs,
  MODEL_OPTIONS,
  DEFAULT_MODEL,
  API_KEY_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  CUSTOM_MODEL_STORAGE_KEY,
  AUTO_SPELLCHECK_STORAGE_KEY,
  AUTO_SPEAKER_REVIEW_STORAGE_KEY,
  AUTO_REFLOW_TRANSCRIPT_STORAGE_KEY,
  INLINE_AUDIO_SAFE_BYTES,
  APP_VERSION,
  getEffectiveModel,
  isCustomModelSelection,
  isPresetModel,
} from "./state.js?v=0.39.19";
import { readStorage, writeStorage, removeStorage } from "./storage.js?v=0.39.19";
import {
  DICTIONARY_STORAGE_KEY,
  DEFAULT_DICTIONARY,
  cleanDictionaryText,
  parseDictionaryRules,
} from "./dictionary.js?v=0.39.19";
import {
  DEFAULT_CASE_INFO,
  normalizeCaseInfo,
  readCaseInfoStorage,
  writeCaseInfoStorage,
  formatCaseInfoForPrompt,
  formatCaseInfoForExport,
  hasCaseInfoContent,
} from "./case-info.js?v=0.39.19";
import {
  isCancelError,
  makeCancelError,
  throwIfCancelled,
  wait,
  makeRequestId,
  isQuotaMessage,
  isCapacityMessage,
  makeGeminiError,
  safeJsonParse,
  parseGeminiText,
  buildTranscriptionMediaParts,
  callGemini,
  getGeminiFileStatus,
  waitForGeminiFileActive,
  uploadAudioFileToGemini,
  verifyApiKey,
  listGeminiModelIds,
} from "./gemini-client.js?v=0.39.19";
import {
  buildRawTranscriptionPrompt,
  buildDocumentTranscriptionPrompt,
  buildSpeakerReviewPrompt,
  buildSummaryPrompt,
  buildSummaryIssueAnalysisPrompt,
  buildSpellcheckPrompt,
  buildReflowPrompt,
} from "./prompts.js?v=0.39.19";
import {
  applyLayoutReflow,
  isLayoutOnlyChange,
  layoutFingerprint,
  reflowTextLocally,
  reflowFailureMessage,
  makeReflowTimeoutError,
  REFLOW_TIMEOUT_MS,
  REFLOW_BUTTON_LABEL,
  REFLOW_SUCCESS_MESSAGE,
} from "./reflow.js?v=0.39.19";
import { planAudioChunks, buildChunkAudioBlob, decodeAudioSource } from "./audio-processing.js?v=0.39.19";
import {
  classifyImportFile,
  filesToDocumentPages,
  filterNewDocumentFiles,
  parseDocumentOcrText,
  revokePagePreview,
  attachPreview,
  cropImageBlob,
  clampCropRect,
} from "./image-processing.js?v=0.39.19";
import {
  createTranscriptSegmentsFromPlan,
  createTranscriptSegmentsFromDocument,
  formatChunkRangeLabel,
  formatDocumentPageLabel,
  isDocumentSegment,
  areDocumentSegments,
  getFailedSegments,
  hasFailedSegments,
  joinOkSegmentTexts,
  findSegmentById,
  mergeNewSourceSegments,
  failUnfinishedSegments,
  unlinkRemovedDocumentPages,
  reorderLinkedDocumentSegments,
  replaceLinkedDocumentSegments,
} from "./transcript-segments.js?v=0.39.19";
import {
  SPELL_BUSY,
  applyCorrectionsToText,
  buildSpellResultMessage,
  highlightedFixCount,
  typographyPreservesFixes,
  locateStoredFixes,
  parseSpellcheckResponse,
  renderTextWithSpellFixes,
  revertFixInText,
  toggleFixInText,
  splitTextIntoSpellChunks,
} from "./spellcheck.js?v=0.39.19";
import {
  applyReviewedTextToRawSegments,
  stripSpeakerPrefixes,
  wrapSegmentsForReview,
} from "./speaker-labels.js?v=0.39.19";
import {
  escapeHtml,
  escapeRegExp,
  cloneStateValue,
  formatDownloadTimestamp,
  withDownloadTimestamp,
  downloadBlob,
  downloadText,
  formatAudioTime,
  formatRecordingTime,
  getFileExtension,
  audioExtensionFromMimeType,
  getAudioMimeType,
  needsExternalAudioConversion,
  formatExternalAudioConversionMessage,
  formatAudioInfo,
  fileToBase64,
} from "./utils.js?v=0.39.19";

function splitWords(text) {
  return String(text).split(/(\s+)/).filter(Boolean).map((word) => ({ word, originalWord: word }));
}

function splitFallbackWords(text) {
  const unclearPattern = /(\[[^\]]*ไม่ชัด[^\]]*\]|[^\s]*ไม่ชัด[^\s]*|[^\s]*\.{2,}[^\s]*)/i;
  return String(text).split(/(\s+|\[[^\]]*ไม่ชัด[^\]]*\]|[^\s]*ไม่ชัด[^\s]*|[^\s]*\.{2,}[^\s]*)/gi)
    .filter(Boolean)
    .map((word) => {
      const isUnclear = unclearPattern.test(word);
      if (!isUnclear) return { word, originalWord: word };
      return {
        word,
        originalWord: word,
        isUnclear: true,
        isOutofContext: false,
        issueDescription: "ถ้อยคำนี้มาจากการถอดเสียงรอบสำรองและระบบระบุว่าฟังไม่ชัด ควรตรวจเทียบกับไฟล์เสียงอีกครั้ง",
        suggestions: [],
        contextSuggestions: [],
      };
    });
}

function normalizeWordEntry(entry) {
  if (typeof entry === "string") {
    return { word: entry, originalWord: entry, isUnclear: false, isOutofContext: false, issueDescription: "", suggestions: [], contextSuggestions: [] };
  }
  const word = String(entry?.word ?? entry?.originalWord ?? "");
  return {
    word,
    originalWord: String(entry?.originalWord || word),
    isUnclear: Boolean(entry?.isUnclear),
    isOutofContext: Boolean(entry?.isOutofContext || entry?.isOutOfContext),
    issueDescription: String(entry?.issueDescription || ""),
    suggestions: Array.isArray(entry?.suggestions) ? entry.suggestions.map(String).filter(Boolean).slice(0, 5) : [],
    contextSuggestions: Array.isArray(entry?.contextSuggestions) ? entry.contextSuggestions.map(String).filter(Boolean).slice(0, 5) : [],
  };
}

function formatTurnTime(turn, index) {
  const raw = String(turn?.time || turn?.timestamp || turn?.startTime || "").trim();
  if (/^\d{1,4}:\d{2}(?::\d{2})?$/.test(raw)) return raw;
  const totalSeconds = Number.isFinite(Number(turn?.startSeconds)) ? Number(turn.startSeconds) : index * 5;
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getWordSuggestions(word) {
  return [...new Set([...(word.suggestions || []), ...(word.contextSuggestions || [])])]
    .filter(Boolean)
    .slice(0, 5);
}

function getIssueDescription(word, fallback = "") {
  const normalizedWord = normalizeWordEntry(word || {});
  const raw = String(normalizedWord.issueDescription || fallback || "").trim();
  const defaultText = normalizedWord.isUnclear
    ? "ถ้อยคำนี้อาจถอดได้ไม่ชัด ควรตรวจเทียบกับเสียงหรือคำต่อคำอีกครั้ง"
    : "พบข้อความที่ต้องตรวจสอบ ควรตรวจทานอีกครั้ง";

  if (!raw) return defaultText;
  if (/[A-Za-z]/.test(raw)) {
    return defaultText;
  }
  return raw;
}

function getTranscriptIssues() {
  const seen = new Set();
  return state.turns.flatMap((turn, turnIndex) => {
    const words = Array.isArray(turn.words) ? turn.words : [];
    return words
      .map((rawWord, wordIndex) => ({ word: normalizeWordEntry(rawWord), turnIndex, wordIndex }))
      .filter(({ word }) => (word.isUnclear || word.isOutofContext) && word.word.trim())
      .filter(({ word }) => {
        const key = word.word.trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
}

function getLocalSummaryIssues() {
  if (!state.summary) return [];
  const issues = [];
  const unclearPattern = /\[[^\]]*ไม่ชัด[^\]]*\]|[^\s]*ไม่ชัด[^\s]*/gi;
  let unclearMatch;
  while ((unclearMatch = unclearPattern.exec(state.summary)) !== null) {
    const text = unclearMatch[0].trim();
    if (!text) continue;
    const suggestionText = text.match(/น่าจะ\s*-?\s*([^\]]+)/i)?.[1] || "";
    const suggestions = extractUnclearSuggestions(suggestionText);
    issues.push({
      source: "local-summary",
      index: `local-${issues.length}`,
      text,
      word: {
        word: text,
        originalWord: text,
        isUnclear: true,
        isOutofContext: false,
        issueDescription: "ถ้อยคำนี้มีคำว่าไม่ชัด ควรตรวจเทียบกับเสียงหรือคำต่อคำอีกครั้ง",
        suggestions,
        contextSuggestions: [],
      },
    });
  }
  const unusualFoodPattern = /(ผัด\s*(?:กะเพรา|กระเพรา)\s*(?:เนื้อ)?\s*(?:นกฮูก|นกเค้าแมว|สุนัข|หมา|แมว|เสือ|ช้าง|แรด|เต่า|ลิง|งู|จระเข้))/g;
  let match;
  while ((match = unusualFoodPattern.exec(state.summary)) !== null) {
    issues.push({
      source: "local-summary",
      index: `local-${issues.length}`,
      text: match[1],
      word: {
        word: match[1],
        originalWord: match[1],
        isUnclear: false,
        isOutofContext: true,
        issueDescription: "พบข้อความที่ต้องตรวจสอบ ควรตรวจทานอีกครั้ง",
        suggestions: ["ผัดกะเพราไก่", "ผัดกะเพราหมู", "ผัดกะเพราเนื้อ"],
        contextSuggestions: [],
      },
    });
  }
  return issues;
}

function normalizeSummaryIssueEntry(entry, index) {
  const rawWord = entry?.word && typeof entry.word === "object" ? normalizeWordEntry(entry.word) : null;
  const text = String(entry?.text || rawWord?.word || entry?.word || entry?.phrase || entry?.quote || "").trim();
  if (!text) return null;
  if (/^(?:ถาม|พยาน|ตอบ)\s*[:：]?$/.test(text)) return null;
  const isUnclear = Boolean(entry?.isUnclear || rawWord?.isUnclear);
  const isOutofContext = Boolean(entry?.isOutofContext || entry?.isOutOfContext || rawWord?.isOutofContext || !isUnclear);
  const source = String(entry?.source || "ai-summary");
  const issueIndex = String(entry?.index || `${source}-${index}`);
  const suggestions = Array.isArray(entry?.suggestions)
    ? entry.suggestions.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5)
    : rawWord ? getWordSuggestions(rawWord) : [];
  return {
    source,
    index: issueIndex,
    text,
    word: {
      word: text,
      originalWord: text,
      isUnclear,
      isOutofContext,
      issueDescription: String(entry?.issueDescription || entry?.reason || rawWord?.issueDescription || (isUnclear ? "ถ้อยคำนี้อาจไม่ชัดเจนในข้อความสรุป" : "พบข้อความที่ต้องตรวจสอบ")),
      suggestions,
      contextSuggestions: Array.isArray(entry?.contextSuggestions) ? entry.contextSuggestions.map(String).filter(Boolean).slice(0, 5) : [],
    },
  };
}

function extractUnclearSuggestions(text) {
  return String(text || "")
    .split(/[\/,，、|]/)
    .map((item) => item.replace(/\.\.\./g, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function getMarkerContext(fullText, index, markerLength, radius = 42) {
  const source = String(fullText || "");
  const before = source.slice(Math.max(0, index - radius), index).replace(/\s+/g, " ").trim();
  const after = source.slice(index + markerLength, index + markerLength + radius).replace(/\s+/g, " ").trim();
  return [before, after].filter(Boolean).join(" ... ");
}

function normalizeSummaryUnclearMarkers(summaryText) {
  const issues = [];
  let issueIndex = 0;
  const sourceSummary = String(summaryText || "");
  const summary = sourceSummary.replace(/\[[^\]]*ไม่ชัด[^\]]*\]/gi, (marker, offset) => {
    const suggestionText = marker.match(/น่าจะ\s*-?\s*([^\]]+)/i)?.[1] || "";
    const suggestions = extractUnclearSuggestions(suggestionText);
    const replacement = suggestions[0] || "ไม่ชัด";
    const context = getMarkerContext(sourceSummary, offset, marker.length);
    issues.push({
      source: "local-summary",
      index: `unclear-marker-${issueIndex++}`,
      text: replacement,
      word: {
        word: replacement,
        originalWord: marker,
        isUnclear: true,
        isOutofContext: false,
        issueDescription: `ถ้อยคำนี้มาจาก marker ${marker}${context ? ` โดยมีบริบทรอบข้างว่า “${context}”` : ""} ควรตรวจเทียบกับเสียงหรือคำต่อคำอีกครั้ง`,
        suggestions,
        contextSuggestions: [],
      },
    });
    return replacement;
  });
  return { summary, issues };
}

function findContainingSummaryToken(summaryText, needle) {
  const cleanNeedle = String(needle || "").trim();
  if (!cleanNeedle) return "";
  const escaped = escapeRegExp(cleanNeedle);
  const pattern = new RegExp(`[ก-๙A-Za-z0-9_]*${escaped}[ก-๙A-Za-z0-9_]*`, "u");
  return String(summaryText || "").match(pattern)?.[0] || "";
}

function resolveSummaryIssueText(issue, summaryText, index = 0) {
  const normalized = normalizeSummaryIssueEntry(issue, index);
  if (!normalized) return null;
  if (String(summaryText || "").includes(normalized.text)) return normalized;
  const candidates = [normalized.text, ...getWordSuggestions(normalized.word)];
  const expanded = candidates.map((item) => findContainingSummaryToken(summaryText, item)).find(Boolean);
  if (!expanded) return normalized;
  return {
    ...normalized,
    index: normalized.index,
    text: expanded,
    word: {
      ...normalized.word,
      word: expanded,
      originalWord: normalized.word.originalWord || normalized.text,
    },
  };
}

function parseSummaryResult(raw) {
  const cleanRaw = String(raw || "").trim();
  if (!cleanRaw) return { summary: "", issues: [] };

  try {
    const parsed = safeJsonParse(cleanRaw);
    if (typeof parsed === "string") {
      const normalized = normalizeSummaryUnclearMarkers(stripOpening(parsed));
      return { summary: normalized.summary, issues: normalized.issues };
    }

    const summary = String(
      parsed?.summaryText ||
      parsed?.summary ||
      parsed?.text ||
      parsed?.result ||
      ""
    ).trim();

    const issueSource = [
      parsed?.reviewItems,
      parsed?.issues,
      parsed?.summaryIssues,
      parsed?.review?.items,
    ].find(Array.isArray) || [];

    const normalizedSummary = normalizeSummaryUnclearMarkers(stripOpening(summary));
    const cleanedSummary = normalizedSummary.summary;
    const issues = issueSource
      .map((issue, index) => resolveSummaryIssueText(issue, cleanedSummary, index))
      .filter(Boolean)
      .filter((issue) => cleanedSummary.includes(issue.text));

    return { summary: cleanedSummary, issues: [...normalizedSummary.issues, ...issues] };
  } catch {
    const normalized = normalizeSummaryUnclearMarkers(stripOpening(cleanRaw));
    return { summary: normalized.summary, issues: normalized.issues };
  }
}

function getSummaryIssues() {
  const dismissed = new Set(state.dismissedSummaryIssueTexts || []);
  const seen = new Set();
  const aiIssues = (Array.isArray(state.summaryIssues) ? state.summaryIssues : [])
    .map((issue, index) => resolveSummaryIssueText(issue, state.summary, index))
    .filter(Boolean)
    .filter((issue) => issue.text && state.summary.includes(issue.text) && !dismissed.has(issue.text));
  return [...aiIssues, ...getLocalSummaryIssues()]
    .filter((issue) => !dismissed.has(issue.text))
    .filter((issue) => {
      if (seen.has(issue.text)) return false;
      seen.add(issue.text);
      return true;
    })
    .sort((a, b) => b.text.length - a.text.length);
}

function renderTurnWords(turn, turnIndex) {
  const words = Array.isArray(turn.words) && turn.words.length ? turn.words : splitWords(turn.text);
  return words.map((rawWord, wordIndex) => {
    const word = normalizeWordEntry(rawWord);
    const hasIssue = word.isUnclear || word.isOutofContext;
    if (!hasIssue) return escapeHtml(word.word);
    const issueType = word.isUnclear ? "unclear" : "context";
    const description = getIssueDescription(word);
    const suggestions = getWordSuggestions(word);
    return `<span class="word-issue ${issueType}" role="button" tabindex="0" data-turn-index="${turnIndex}" data-word-index="${wordIndex}" title="${escapeHtml(description)}">${escapeHtml(word.word)}</span>`;
  }).join("");
}

function renderIssueNotice() {
  if (!state.issueNotice) return "";
  const description = getIssueDescription({
    word: state.issueNotice.word,
    isUnclear: state.issueNotice.kind === "unclear",
    isOutofContext: state.issueNotice.kind !== "unclear",
    issueDescription: state.issueNotice.description,
  });
  const suggestions = state.issueNotice.suggestions.length
    ? state.issueNotice.suggestions.map((item) => `<button class="suggestion-choice" type="button" data-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")
    : "<span class=\"no-suggestion\">ไม่มีข้อเสนอแนะ</span>";
  return `
    <div class="issue-popover-backdrop" data-close-issue-notice="true">
      <section class="issue-popover" role="dialog" aria-modal="true" aria-label="คำที่ถอดไม่ชัด">
        <div class="issue-popover-head">
          <div>
            <span>${escapeHtml(state.issueNotice.word || "")}</span>
            <strong>${escapeHtml(state.issueNotice.title)}</strong>
          </div>
          <button class="icon-close" id="close-issue-notice" type="button" aria-label="ปิด">×</button>
        </div>
        <p>${escapeHtml(description)}</p>
        <div class="suggestion-list">
          <button class="suggestion-choice correct-choice" id="mark-issue-correct" type="button">ข้อความถูกแล้ว</button>
          ${suggestions}
        </div>
        <form class="custom-issue-form" id="custom-issue-form">
          <input id="custom-issue-text" type="text" autocomplete="off" placeholder="พิมพ์คำหรือวลีที่ต้องการใช้แทน" />
          <button type="submit">ใช้ข้อความนี้</button>
        </form>
      </section>
    </div>
  `;
}

function getModelLabel(value = getEffectiveModel()) {
  const modelValue = String(value || DEFAULT_MODEL);
  if (isCustomModelSelection(state.model) && modelValue === String(state.customModel || "").trim()) {
    return modelValue ? `กำหนดเอง (${modelValue})` : "กำหนดเอง";
  }
  return MODEL_OPTIONS.find((option) => option.value === modelValue)?.label || modelValue;
}

// Fires a free models-list request to tell the user right away whether the key
// they just pasted actually works. Debounced so typing a key character by
// character doesn't fire a request per keystroke, and token-guarded so a slow
// response for an old key can't overwrite the verdict for the current one.
// Updates only the header pill and the inline note under the field - no modal,
// no blocking, and it never interferes with a real Gemini job in flight.
const API_KEY_CHECK_DEBOUNCE_MS = 600;

function setApiKeyStatus(status, message = "") {
  if (state.apiKeyStatus === status && state.apiKeyStatusMessage === message) return;
  state.apiKeyStatus = status;
  state.apiKeyStatusMessage = message;
  paintApiKeyStatus();
}

// Patches the two affected nodes directly instead of calling render(), which
// would tear down and rebuild the settings modal and steal focus from the
// field the user is still typing into.
function paintApiKeyStatus() {
  const note = document.querySelector("#api-key-status");
  if (note) {
    note.textContent = getApiKeyStatusText();
    note.className = `api-key-status is-${state.apiKeyStatus || "unknown"}`;
  }
  const pill = document.querySelector(".status-pill");
  if (pill) {
    pill.textContent = getApiKeyPillText();
    pill.className = `status-pill ${getApiKeyPillClass()}`;
  }
}

function getApiKeyStatusText() {
  if (state.apiKeyStatus === "checking") return "กำลังตรวจสอบ API key...";
  if (state.apiKeyStatus === "valid") return "API key ใช้ได้";
  if (state.apiKeyStatus === "invalid") return `API key ใช้ไม่ได้${state.apiKeyStatusMessage ? ` (${state.apiKeyStatusMessage})` : ""}`;
  return "";
}

// "Key ready" means verified, never merely present. An unverified key reports
// "Key unchecked" instead: a key restored from localStorage used to show
// "Key ready" on every reload without anyone having tested it, so a key that
// had been revoked or mistyped looked fine until a transcription failed.
function getApiKeyPillText() {
  if (!state.apiKey.trim()) return "No key";
  if (state.apiKeyStatus === "checking") return "Checking";
  if (state.apiKeyStatus === "valid") return "Key ready";
  if (state.apiKeyStatus === "invalid") return "Key invalid";
  return "Key unchecked";
}

function getApiKeyPillClass() {
  if (!state.apiKey.trim()) return "no-key";
  if (state.apiKeyStatus === "invalid") return "key-invalid";
  if (state.apiKeyStatus === "checking") return "key-checking";
  if (state.apiKeyStatus === "valid") return "key-ready";
  return "key-unchecked";
}


async function validateCustomModelAgainstCatalog(apiKey, token = refs.apiKeyCheckToken) {
  if (!isCustomModelSelection(state.model)) {
    state.customModelStatusMessage = "";
    paintApiKeyStatus();
    return;
  }
  const customId = String(state.customModel || "").trim();
  if (!customId) {
    state.customModelStatusMessage = "กรุณาพิมพ์ชื่อโมเดล Gemini";
    paintApiKeyStatus();
    const status = document.querySelector("#custom-model-status");
    if (status) status.textContent = state.customModelStatusMessage;
    return;
  }
  try {
    const ids = await listGeminiModelIds(apiKey);
    if (token !== refs.apiKeyCheckToken) return;
    const found = ids.includes(customId);
    state.customModelStatusMessage = found
      ? `พบโมเดล ${customId} ในบัญชีนี้`
      : `ไม่พบ ${customId} ในรายการโมเดลของ API key นี้ (อาจพิมพ์ผิด หรือ key ไม่มีสิทธิ์)`;
  } catch {
    if (token !== refs.apiKeyCheckToken) return;
    state.customModelStatusMessage = "ตรวจรายการโมเดลไม่สำเร็จ จะยังลองใช้ชื่อที่พิมพ์ไว้ได้";
  }
  const status = document.querySelector("#custom-model-status");
  if (status) status.textContent = state.customModelStatusMessage;
}

function checkApiKey({ debounce = false } = {}) {
  window.clearTimeout(refs.apiKeyCheckTimer);
  const key = state.apiKey.trim();
  if (!key) {
    setApiKeyStatus("", "");
    return;
  }
  const run = async () => {
    const token = ++refs.apiKeyCheckToken;
    setApiKeyStatus("checking");
    try {
      const result = await verifyApiKey(key);
      if (token !== refs.apiKeyCheckToken) return; // a newer key is being checked
      if (result.ok) {
        setApiKeyStatus("valid");
        await validateCustomModelAgainstCatalog(key, token);
      } else {
        setApiKeyStatus("invalid", result.reason === "invalid" ? "" : result.message || "");
        state.customModelStatusMessage = "";
      }
    } catch {
      if (token !== refs.apiKeyCheckToken) return;
      // Network failure says nothing about the key itself - stay silent rather
      // than falsely accusing a good key.
      setApiKeyStatus("", "");
    }
  };
  if (!debounce) {
    run();
    return;
  }
  refs.apiKeyCheckTimer = window.setTimeout(run, API_KEY_CHECK_DEBOUNCE_MS);
}

function getApiKeyTail(value = state.apiKey) {
  const clean = String(value || "").trim();
  return clean ? clean.slice(-4).padStart(Math.min(4, clean.length), "•") : "";
}

function getApiKeyMask(value = state.apiKey) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const visibleLength = Math.min(4, clean.length);
  return `${"•".repeat(Math.max(0, clean.length - visibleLength))}${clean.slice(-visibleLength)}`;
}

function prepareApiKeyInputForEditing(input) {
  const maskedValue = input?.dataset?.maskedValue || "";
  if (!input || !maskedValue || input.value !== maskedValue) return;
  input.dataset.maskedValue = "";
  input.classList.remove("is-saved-key-mask");
  input.value = "";
}

function maskApiKeyInput(input, value = state.apiKey) {
  if (!input) return;
  const mask = getApiKeyMask(value);
  if (!mask) return;
  input.dataset.maskedValue = mask;
  input.classList.add("is-saved-key-mask");
  input.value = mask;
}

function setApiKeyInputValue(input, value, options = {}) {
  if (!input) return;
  const { focus = true } = options;
  const cleanValue = String(value || "").trim();
  input.dataset.maskedValue = "";
  input.classList.remove("is-saved-key-mask");
  input.value = cleanValue;
  state.apiKey = cleanValue;
  if (state.persistKey) writeStorage(API_KEY_STORAGE_KEY, state.apiKey);
  document.querySelector("#remove-key")?.toggleAttribute("disabled", !state.apiKey.trim() && !readStorage(API_KEY_STORAGE_KEY, ""));
  if (state.apiKey.trim()) maskApiKeyInput(input, state.apiKey);
  checkApiKey();
  if (!focus) return;
  input.focus({ preventScroll: true });
  const cursor = input.value.length;
  input.setSelectionRange?.(cursor, cursor);
}

function focusApiKeyInputForPaste(input) {
  if (!input) return;
  prepareApiKeyInputForEditing(input);
  input.focus({ preventScroll: true });
  input.select?.();
}

async function pasteClipboardIntoApiKeyInput(input) {
  if (!input || !navigator.clipboard?.readText) return false;
  prepareApiKeyInputForEditing(input);
  input.focus({ preventScroll: true });
  input.select?.();
  const pasted = (await navigator.clipboard.readText()).trim();
  if (!pasted) return false;
  setApiKeyInputValue(input, pasted, { focus: false });
  return true;
}

function captureScrollPositions() {
  return {
    windowX: window.scrollX || 0,
    windowY: window.scrollY || 0,
    turnList: document.querySelector(".turn-list")?.scrollTop || 0,
    summary: document.querySelector("#summary-text")?.scrollTop || 0,
    transcriptPanel: document.querySelector(".transcript-panel")?.scrollTop || 0,
    summaryPanel: document.querySelector(".summary-panel")?.scrollTop || 0,
  };
}

function restoreScrollPositions(scrollPositions) {
  if (!scrollPositions) return;
  const turnList = document.querySelector(".turn-list");
  const summary = document.querySelector("#summary-text");
  const transcriptPanel = document.querySelector(".transcript-panel");
  const summaryPanel = document.querySelector(".summary-panel");
  if (turnList) turnList.scrollTop = scrollPositions.turnList;
  if (summary) summary.scrollTop = scrollPositions.summary;
  if (transcriptPanel) transcriptPanel.scrollTop = scrollPositions.transcriptPanel;
  if (summaryPanel) summaryPanel.scrollTop = scrollPositions.summaryPanel;
  window.scrollTo(scrollPositions.windowX, scrollPositions.windowY);
}

function replaceIssueWord(turnIndex, wordIndex, replacement) {
  const turn = state.turns[turnIndex];
  if (!turn || !Array.isArray(turn.words) || !turn.words[wordIndex]) return;
  const words = turn.words.map(normalizeWordEntry);
  words[wordIndex] = {
    ...words[wordIndex],
    word: replacement,
    originalWord: replacement,
    isUnclear: false,
    isOutofContext: false,
    issueDescription: "",
    suggestions: [],
    contextSuggestions: [],
  };
  turn.words = words;
  turn.text = words.map((word) => word.word).join("");
  state.issueNotice = null;
  render();
}

function rememberDismissedSummaryIssueTexts(values = []) {
  const current = new Set(state.dismissedSummaryIssueTexts || []);
  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => current.add(value));
  state.dismissedSummaryIssueTexts = [...current];
}

function clearCurrentSummaryIssue() {
  if (!state.issueNotice || state.issueNotice.source !== "summary") return;
  rememberDismissedSummaryIssueTexts([state.issueNotice.word, ...(state.issueNotice.dismissTexts || [])]);
  const issueIndex = String(state.issueNotice.issueIndex || "");
  if (!issueIndex) return;
  state.summaryIssues = (state.summaryIssues || []).filter((issue, index) => {
    const normalized = normalizeSummaryIssueEntry(issue, index);
    return String(normalized?.index || "") !== issueIndex;
  });
}

function replaceSummaryIssue(word, replacement) {
  const start = Number(state.issueNotice?.summaryStart);
  const end = Number(state.issueNotice?.summaryEnd);
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && state.summary.slice(start, end) === word) {
    state.summary = `${state.summary.slice(0, start)}${replacement}${state.summary.slice(end)}`;
  }
  clearCurrentSummaryIssue();
  state.issueNotice = null;
  render();
}

function markCurrentIssueCorrect() {
  if (!state.issueNotice) return;

  if (state.issueNotice.source === "summary") {
    clearCurrentSummaryIssue();
    state.issueNotice = null;
    render();
    return;
  }

  const turn = state.turns[state.issueNotice.turnIndex];
  if (!turn || !Array.isArray(turn.words) || !turn.words[state.issueNotice.wordIndex]) {
    state.issueNotice = null;
    render();
    return;
  }

  const words = turn.words.map(normalizeWordEntry);
  words[state.issueNotice.wordIndex] = {
    ...words[state.issueNotice.wordIndex],
    isUnclear: false,
    isOutofContext: false,
    issueDescription: "",
    suggestions: [],
    contextSuggestions: [],
  };
  turn.words = words;
  state.issueNotice = null;
  render();
}

function applyIssueSuggestion(replacement) {
  if (!state.issueNotice || !replacement) return;
  if (state.issueNotice.source === "summary") {
    replaceSummaryIssue(state.issueNotice.word, replacement);
    return;
  }
  replaceIssueWord(state.issueNotice.turnIndex, state.issueNotice.wordIndex, replacement);
}

function getSummaryIssueMatches() {
  const summary = String(state.summary || "");
  const candidates = [];
  getSummaryIssues().forEach((issue) => {
    const text = String(issue.text || "");
    if (!text) return;
    let fromIndex = 0;
    while (fromIndex < summary.length) {
      const start = summary.indexOf(text, fromIndex);
      if (start === -1) break;
      candidates.push({ issue, start, end: start + text.length, text });
      fromIndex = start + Math.max(text.length, 1);
    }
  });

  const selected = [];
  candidates
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
    .forEach((candidate) => {
      const overlaps = selected.some((item) => candidate.start < item.end && candidate.end > item.start);
      if (!overlaps) selected.push(candidate);
    });
  return selected.sort((a, b) => a.start - b.start);
}

function renderSummaryText() {
  if (!state.summary) return "";
  const matches = getSummaryIssueMatches();
  if (!matches.length) return escapeHtml(state.summary);

  let cursor = 0;
  const parts = [];
  matches.forEach((match) => {
    if (match.start > cursor) parts.push(escapeHtml(state.summary.slice(cursor, match.start)));
    const issue = match.issue;
    const word = issue.word;
    const issueType = word.isUnclear ? "unclear" : "context";
    const description = getIssueDescription(word);
    parts.push(`<span class="word-issue summary-issue ${issueType}" role="button" tabindex="0" data-issue-index="${escapeHtml(issue.index)}" data-issue-start="${match.start}" data-issue-end="${match.end}" title="${escapeHtml(description)}">${escapeHtml(match.text)}</span>`);
    cursor = match.end;
  });
  if (cursor < state.summary.length) parts.push(escapeHtml(state.summary.slice(cursor)));
  return parts.join("");
}

function highlightRawUnclearText(text) {
  return String(text).split(/(\[[^\]]*ไม่ชัด[^\]]*\])/gi)
    .map((part) => {
      if (/^\[[^\]]*ไม่ชัด[^\]]*\]$/i.test(part)) {
        return `<span class="raw-unclear" title="ดับเบิ้ลคลิกเพื่อเลือกคำนี้ทั้งก้อน">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

// Strips [MM:SS]/[H:MM:SS] markers wherever they occur in the text, not just
// at the start of a line. Gemini's raw transcription can land several turns
// on one physical line (no real newline between them), which pushes a stray
// timestamp into the middle of the string instead of its start - a line-start
// anchored regex misses those.
function stripStrayTimestamps(text) {
  return String(text || "").replace(/\[\d{1,4}:\d{2}(?::\d{2})?\]\s*/g, "");
}

// Renders the transcript with clickable speaker labels. The labels carry no
// line number: which line a label belongs to is worked out at click time by
// resolveSpeakerLabelLineIndex, because the user can edit the text freely
// afterwards without triggering a re-render.
function renderRawTranscriptText(text) {
  return String(text || "").split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line)) return line;
    const cleanLine = stripStrayTimestamps(line);
    const match = cleanLine.match(/^(\s*)(ถาม|พยาน|ตอบ)(\s*[:：])/);
    if (!match) return highlightRawUnclearText(cleanLine);
    const speakerClass = match[2] === "ถาม" ? "speaker-question" : "speaker-witness";
    const toggledTo = match[2] === "ถาม" ? "พยาน" : "ถาม";
    const label = `<span class="raw-speaker ${speakerClass}" role="button" tabindex="0" title="คลิกเพื่อสลับเป็น${toggledTo}">${escapeHtml(`${match[2]}${match[3]}`)}</span>`;
    return `${label}${highlightRawUnclearText(cleanLine.slice(match[0].length))}`;
  }).join("");
}

// Strips timestamp markers from anything the user copies/downloads/reads -
// timestamps are an internal implementation detail (audio-chunk stitching),
// not something the user asked to see.
function stripTimestampsForDisplay(text) {
  return stripStrayTimestamps(text);
}

function updateTranscriptEditorState(element) {
  state.transcriptDraft = element.innerText;
  state.turns = [];
  state.issueNotice = null;
  clearReflowUndo("transcript");
  pruneSpellFixesFromCurrentText();
  const hasText = Boolean(state.transcriptDraft.trim());
  element.classList.toggle("is-empty", !hasText);
  document.querySelector("#copy-transcript")?.toggleAttribute("disabled", !hasText);
  document.querySelector("#download-transcript")?.toggleAttribute("disabled", !hasText);
  const clearTranscript = document.querySelector("#clear-transcript");
  if (clearTranscript) {
    const canUndo = hasClearedTranscript();
    clearTranscript.toggleAttribute("disabled", !hasText && !canUndo);
    clearTranscript.textContent = !hasText && canUndo ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ";
  }
  refreshTranscriptActionButtons();
  refreshReflowControlLabels();
  const reviewSpeakers = document.querySelector("#review-speakers");
  if (reviewSpeakers && !state.busy) {
    // Typing or deleting a "ถาม :" tag flips which action this button offers,
    // so relabel it here too - this path edits the DOM without a re-render.
    const labeled = hasSpeakerLabels(state.transcriptDraft);
    reviewSpeakers.textContent = labeled ? "ลบผู้พูด" : "ตรวจผู้พูด";
    if (labeled) {
      reviewSpeakers.setAttribute("title", "ลบป้ายผู้พูด");
      reviewSpeakers.setAttribute("aria-label", "ลบป้ายผู้พูด");
    } else {
      reviewSpeakers.removeAttribute("title");
      reviewSpeakers.removeAttribute("aria-label");
    }
  }
}

const SPEAKER_LINE_PATTERN = /^(\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?)(ถาม|พยาน|ตอบ)(\s*[:：])(.*)$/;

// Resolves which transcript line a clicked speaker label belongs to, at click
// time, from the label's live position in the DOM.
//
// This used to read a `data-line-index` baked in by renderRawTranscriptText.
// That attribute goes stale the moment the user edits the transcript, because
// updateTranscriptEditorState deliberately does not re-render (a re-render
// would move the caret mid-typing). So after adding or deleting any line, every
// label below the edit pointed at the wrong line: clicking either did nothing
// (stale index landed on a line with no tag) or silently flipped a different
// line than the one the user clicked.
//
// Counts the line breaks that appear before `stop` in `container`, the same way
// element.innerText counts them - so both literal "\n" characters in text nodes
// (what renderRawTranscriptText and the Enter handler produce) and <br>
// elements (what the browser may insert on its own). Range.toString() is not
// usable here: it ignores <br> entirely, while innerText - the thing that
// actually feeds state.transcriptDraft - does not.
function countLineBreaksBefore(container, stop) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let breaks = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === stop || node.contains?.(stop)) break;
    if (node.nodeType === Node.TEXT_NODE) breaks += (node.data.match(/\n/g) || []).length;
    else if (node.tagName === "BR") breaks += 1;
    node = walker.nextNode();
  }
  return breaks;
}

// Two independent strategies, each with its own blind spot:
//
//   offset  - count the line breaks before the label. Exact in normal use.
//   ordinal - the Nth label maps to the Nth tagged line. Holds as long as
//     labels and tagged lines stay 1:1 (render, the Enter handler and the
//     delete handlers all create and remove both together), and covers the
//     case where the DOM contains block-level line breaks the counter above
//     does not model. Diverges if the user types a "ถาม :" tag by hand, which
//     makes a tagged line that has no label until the next render.
//
// A candidate whose line carries the same speaker word the label displays wins.
// Otherwise the offset result is used as long as it points at a tagged line at
// all, and only when neither candidate lands on a tagged line does this give up
// and return -1, so a stray click can never flip some unrelated line.
function resolveSpeakerLabelLineIndex(container, label) {
  if (!container || !label) return -1;
  const lines = getTranscriptEditorText().split(/\r?\n/);
  const speakerOf = (index) => (lines[index] || "").match(SPEAKER_LINE_PATTERN)?.[2] || "";
  const shownSpeaker = String(label.textContent || "").match(/(ถาม|พยาน|ตอบ)/)?.[1] || "";

  const byOffset = countLineBreaksBefore(container, label);

  let byOrdinal = -1;
  const ordinal = [...container.querySelectorAll(".raw-speaker")].indexOf(label);
  if (ordinal >= 0) {
    let seen = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (!speakerOf(i)) continue;
      if (seen === ordinal) { byOrdinal = i; break; }
      seen += 1;
    }
  }

  if (shownSpeaker && speakerOf(byOffset) === shownSpeaker) return byOffset;
  if (shownSpeaker && byOrdinal >= 0 && speakerOf(byOrdinal) === shownSpeaker) return byOrdinal;
  if (speakerOf(byOffset)) return byOffset;
  if (byOrdinal >= 0 && speakerOf(byOrdinal)) return byOrdinal;
  return -1;
}

// Flips a transcript line's speaker tag between "ถาม" and "พยาน" - manual
// correction for whenever the AI (either pass) mislabels who's speaking.
function toggleTranscriptTurnSpeaker(lineIndex) {
  const lines = getTranscriptEditorText().split(/\r?\n/);
  const line = lines[lineIndex];
  if (line === undefined) return;
  const match = line.match(SPEAKER_LINE_PATTERN);
  if (!match) return;
  const toggled = match[2] === "ถาม" ? "พยาน" : "ถาม";
  lines[lineIndex] = `${match[1]}${toggled}${match[3]}${match[4]}`;
  state.transcriptDraft = lines.join("\n");
  state.turns = [];
  state.issueNotice = null;
  render();
}

function refreshCaseInfoClearButton() {
  const button = document.querySelector("#clear-case-info");
  if (!button) return;
  const hasText = hasCaseInfoContent(state.caseInfo);
  const canUndo = !hasText && hasClearedCaseInfo();
  button.toggleAttribute("disabled", !hasText && !canUndo);
  button.textContent = canUndo ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ";
}

function closestRawUnclear(node, container) {
  if (!node || !container) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const rawUnclear = element?.closest?.(".raw-unclear");
  return rawUnclear && container.contains(rawUnclear) ? rawUnclear : null;
}

function getSelectedRawUnclear(container) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const direct = closestRawUnclear(selection.anchorNode, container) || closestRawUnclear(selection.focusNode, container);
  if (direct) return direct;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  return Array.from(container.querySelectorAll(".raw-unclear")).find((element) => range.intersectsNode(element)) || null;
}

function selectElementNode(element) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNode(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function closestRawSpeaker(node, container) {
  if (!node || !container) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const rawSpeaker = element?.closest?.(".raw-speaker");
  return rawSpeaker && container.contains(rawSpeaker) ? rawSpeaker : null;
}

// True only when the (collapsed) caret sits immediately after a "ถาม :"/"พยาน :"
// label span with nothing typed between the label and the caret yet - i.e.
// exactly where a single Backspace should delete the whole label instead of
// eating into it one character at a time.
function getRawSpeakerBeforeCaret(container) {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.rangeCount) return null;
  const { startContainer, startOffset } = selection.getRangeAt(0);
  if (startContainer.nodeType === Node.TEXT_NODE) {
    if (startOffset !== 0) return null;
    return closestRawSpeaker(startContainer.previousSibling, container);
  }
  return closestRawSpeaker(startContainer.childNodes[startOffset - 1], container);
}

// True whenever the (collapsed) caret sits right after the single space that
// follows a "ถาม :"/"พยาน :" label - i.e. exactly where Backspace would
// normally just eat that one space. In that spot Backspace should delete the
// whole label instead, whether the label was just auto-inserted by Enter or
// the caret got there some other way (clicking back in, editing later, etc).
function getRawSpeakerBeforeSpaceCaret(container) {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.rangeCount) return null;
  const { startContainer, startOffset } = selection.getRangeAt(0);
  if (startContainer.nodeType !== Node.TEXT_NODE) return null;
  if (startOffset !== 1 || startContainer.data.charAt(0) !== " ") return null;
  const rawSpeaker = closestRawSpeaker(startContainer.previousSibling, container);
  return rawSpeaker ? { rawSpeaker, spaceNode: startContainer } : null;
}

// Character offset of the (collapsed) caret within `element`'s plain-text
// content, counted the same way `element.innerText` reads it back - used to
// find which line the caret is on and what that line's speaker label is.
function getCaretOffset(element) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}


function handleGeminiError(error, fallbackMessage) {
  if (isCancelError(error)) {
    state.message = state.busy === "summarizing" ? "หยุดการสรุปความแล้ว"
      : state.busy === "reviewing-speakers" ? "หยุดการตรวจสอบผู้พูดแล้ว"
      : state.latestSourceKind === "document" ? "หยุดการถอดข้อความแล้ว"
      : "หยุดการถอดเสียงแล้ว";
    return;
  }
  if (error?.isQuota || error?.isCapacity || isQuotaMessage(error?.message) || isCapacityMessage(error?.message)) {
    const capacity = Boolean(error?.isCapacity || isCapacityMessage(error?.message));
    state.quotaNotice = {
      model: state.model || DEFAULT_MODEL,
      kind: capacity ? "capacity" : "quota",
      action: state.busy || "",
      status: error?.status || 0,
      retryAfter: error?.retryAfter || "",
      message: error?.message || "",
    };
    state.message = capacity
      ? "โมเดล Gemini มีผู้ใช้งานหนาแน่น ลองเปลี่ยน model หรือรอสักครู่แล้วลองใหม่"
      : "โควต้า Gemini หมด พักสักครู่แล้วลองใหม่ เปลี่ยน model หรือใช้ API แบบชำระเงิน";
    return;
  }
  state.message = error?.message || fallbackMessage;
}

function retryQuotaNoticeTask(action) {
  if (action === "transcribing") {
    window.setTimeout(() => {
      transcribeLastAudio();
    }, 0);
    return;
  }
  if (action === "summarizing") {
    window.setTimeout(() => {
      runSummary();
    }, 0);
  }
  if (action === "reviewing-speakers") {
    window.setTimeout(() => {
      runSpeakerReview();
    }, 0);
  }
}

// Court transcripts always write the witness's first-person pronoun as the
// abbreviation "ข้าฯ", but Gemini keeps spelling it out as "ข้าพเจ้า". Doing
// this substitution locally (instead of asking for it in the prompt) keeps it
// deterministic and costs no tokens. Applied only to AI-produced transcript
// text via normalizeRawTranscriptLines - never to what the user typed by hand.
// The trailing space is part of the abbreviation's normal spacing; any spacing
// the model already emitted is absorbed so we never produce a double space.
function normalizeSelfPronoun(text) {
  return String(text || "").replace(/ข้าพเจ้า[ \t]*/g, "ข้าฯ ").trim();
}

function parseRawTranscriptionText(raw) {
  const text = String(raw || "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) {
    const error = new Error("Gemini ถอดเสียงสำเร็จแต่ไม่พบข้อความดิบในผลลัพธ์");
    error.isEmptyTranscription = true;
    throw error;
  }
  return normalizeRawTranscriptLines(text);
}

// Matches a speaker tag ("ถาม :" / "พยาน :" / "ตอบ :"), with an optional
// leftover [MM:SS] prefix, anywhere in the string - not anchored to a line
// start. Used as turn *boundaries*: Gemini doesn't always put a real newline
// between turns, so splitting on \r?\n first (as this used to do) can merge
// several turns - and any stray timestamp inside them - into whichever
// speaker matched first.
// Built fresh per call on purpose: a shared /g regex carries `lastIndex`
// between calls, so a .test() that matched once would resume mid-string on the
// next call and report "no tags" for text that plainly has them.
function speakerTagPattern() {
  return /(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]\s*/g;
}

// Splits raw transcription text into { speaker, text } turns by scanning for
// speaker tags wherever they occur, then merges consecutive turns from the
// same speaker. Any [MM:SS] marker caught inside a turn's text is dropped too.
function splitIntoSpeakerTurns(text, defaultSpeaker = "พยาน") {
  const source = String(text || "");
  const clean = (value) => stripStrayTimestamps(value).replace(/\s+/g, " ").trim();
  const turns = [];
  const matches = [...source.matchAll(speakerTagPattern())];

  if (!matches.length) {
    const cleaned = clean(source);
    if (cleaned) turns.push({ speaker: defaultSpeaker, text: cleaned });
    return turns;
  }

  const leading = clean(source.slice(0, matches[0].index));
  if (leading) turns.push({ speaker: defaultSpeaker, text: leading });

  matches.forEach((match, i) => {
    const speaker = match[1] === "ถาม" ? "ถาม" : "พยาน";
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    const cleaned = clean(source.slice(start, end));
    if (cleaned) turns.push({ speaker, text: cleaned });
  });

  return turns;
}

function mergeAdjacentSpeakerTurns(turns) {
  const merged = [];
  turns.forEach(({ speaker, text }) => {
    const previous = merged[merged.length - 1];
    if (previous?.speaker === speaker) {
      previous.text = `${previous.text} ${text}`.trim();
      return;
    }
    merged.push({ speaker, text });
  });
  return merged;
}

// `mergeAdjacent: false` keeps consecutive same-speaker turns as separate
// lines. The speaker-review pass needs this: it deliberately splits one
// rapid-fire "ถาม :" line into several "ถาม :" lines (one per question), and
// merging here would glue them straight back together. The raw-transcription
// path keeps merging, where consecutive same-speaker lines are fragmentation
// noise rather than intent.
function normalizeRawTranscriptLines(text, { mergeAdjacent = true } = {}) {
  const turns = splitIntoSpeakerTurns(text);
  return (mergeAdjacent ? mergeAdjacentSpeakerTurns(turns) : turns)
    .map((turn) => `${turn.speaker} : ${normalizeSelfPronoun(turn.text)}`)
    .join("\n");
}

async function transcribeRawTextWithGemini(mediaParts, options = {}) {
  const raw = await callGemini([
    ...mediaParts,
    { text: buildRawTranscriptionPrompt(options.chunk || null) },
  ], "text/plain", options);
  return parseRawTranscriptionText(raw);
}

async function transcribeDocumentPageWithGemini(mediaParts, options = {}) {
  const raw = await callGemini([
    { text: buildDocumentTranscriptionPrompt(options.page || null) },
    ...mediaParts,
  ], "text/plain", options);
  return parseDocumentOcrText(raw);
}

// Second pass over the merged (whole-recording) transcript: re-checks ถาม/พยาน
// labels using the full conversation as context (the raw pass only judges each
// utterance mostly on its own), normalizes Thai word spacing, and splits a
// single "ถาม :" line holding several rapid-fire questions into one line per
// question - hence mergeAdjacent: false below, or that split would be undone.
async function reviewTranscriptSpeakers(transcriptText, options = {}) {
  const raw = await callGemini([
    { text: buildSpeakerReviewPrompt(transcriptText) },
  ], "text/plain", options);
  const cleaned = String(raw || "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned) throw new Error("Gemini ตรวจสอบผู้พูดสำเร็จแต่ไม่พบข้อความในผลลัพธ์");
  // Keep the model output as-is. normalizeRawTranscriptLines would prepend a
  // speaker tag onto every turn, rewrite ข้าพเจ้า→ข้าฯ, and destroy
  // <<<OMKWAM_SEG>>> page markers. applySpeakerLabelsPreservingWords copies
  // only labels and line breaks onto the raw transcript.
  return cleaned;
}

// Guards against trusting a malformed speaker-review response: it should only
// ever re-tag turns, fix inter-word spacing, or split a multi-question "ถาม"
// line into several lines - never lose most of the original content. If it
// collapsed or dropped most of the transcript, fall back to the un-reviewed
// text instead of overwriting it with something worse. Compares non-whitespace
// character counts only, since the review pass is expected to legitimately
// strip a lot of whitespace when fixing spacing (e.g. "อ๋อ ผู้ ควบคุม" ->
// "อ๋อผู้ควบคุม") and that alone must never look like content loss. Turn count
// may legitimately grow (question splitting), so only shrinkage is suspect.
// Returns { ok, reason } rather than a bare boolean so the UI can tell the user
// *why* a review was thrown away - "ผลไม่น่าเชื่อถือ" alone left them guessing
// whether the feature was broken or the model had simply mangled that run.
const SPEAKER_REVIEW_MIN_RATIO = 0.6;

function stripSegmentReviewMarkers(text) {
  return String(text || "")
    .replace(/<<<OMKWAM_SEG [^>]+>>>/g, "")
    .replace(/<<<END_OMKWAM_SEG>>>/g, "");
}

function isPlausibleSpeakerReview(originalText, reviewedText) {
  const originalTurns = splitIntoSpeakerTurns(stripSegmentReviewMarkers(originalText));
  const reviewedTurns = splitIntoSpeakerTurns(stripSegmentReviewMarkers(reviewedText));
  if (!reviewedTurns.length) return { ok: false, reason: "Gemini ไม่ส่งบทสนทนากลับมาเลย" };
  if (reviewedTurns.length < originalTurns.length * SPEAKER_REVIEW_MIN_RATIO) {
    return { ok: false, reason: `จำนวนบรรทัดหายไปมาก (${reviewedTurns.length} จาก ${originalTurns.length})` };
  }
  const nonSpaceLength = (turns) => turns.reduce((sum, turn) => sum + turn.text.replace(/\s+/g, "").length, 0);
  const originalLength = nonSpaceLength(originalTurns);
  const reviewedLength = nonSpaceLength(reviewedTurns);
  if (originalLength && reviewedLength < originalLength * SPEAKER_REVIEW_MIN_RATIO) {
    const percent = Math.round((reviewedLength / originalLength) * 100);
    return { ok: false, reason: `ข้อความหายไปมาก (เหลือ ${percent}% ของเดิม)` };
  }
  return { ok: true, reason: "" };
}

function assessAppliedSpeakerReview(originalText, reviewedText, appliedText) {
  const check = isPlausibleSpeakerReview(originalText, reviewedText);
  if (!check.ok) return check;
  if (!hasSpeakerLabels(reviewedText) && !hasSpeakerLabels(originalText)) {
    return { ok: false, reason: "Gemini ไม่ได้ใส่ป้ายถามหรือพยาน" };
  }
  if (hasSpeakerLabels(reviewedText) && !hasSpeakerLabels(appliedText)) {
    return { ok: false, reason: "จับคู่คำเดิมกับป้ายที่ Gemini ส่งมาไม่ได้" };
  }
  return { ok: true, reason: "" };
}

async function rephraseWithGemini(transcriptText = formatTranscript(), options = {}) {
  const dictionary = parseDictionaryRules(state.dictionaryText);
  const raw = await callGemini([
    {
      text: buildSummaryPrompt({
        dictionary,
        caseInfoText: formatCaseInfoForPrompt(state.caseInfo),
        transcriptText,
      }),
    },
  ], "application/json", options);

  const result = parseSummaryResult(raw);
  if (!result.summary) {
    throw new Error("Gemini สรุปความสำเร็จแต่ไม่พบข้อความสรุปในผลลัพธ์");
  }
  return result;
}

async function analyzeSummaryIssuesWithGemini(summaryText, options = {}) {
  const cleanSummary = String(summaryText || "").trim();
  if (!cleanSummary) return [];
  const raw = await callGemini([
    { text: buildSummaryIssueAnalysisPrompt(cleanSummary) },
  ], "application/json", options);
  const parsed = safeJsonParse(raw);
  return (Array.isArray(parsed?.issues) ? parsed.issues : [])
    .map(normalizeSummaryIssueEntry)
    .filter(Boolean)
    .filter((issue) => cleanSummary.includes(issue.text));
}

function stripOpening(text) {
  return String(text)
    .replace(/^\s*ข้าฯ\s*ขอเบิกความต่อศาลว่า[:：]?\s*/i, "")
    .replace(/^\s*ข้าฯ\s*ขอเบิกความให้การสัตย์จริง[^:：]*[:：]?\s*/i, "")
    .replace(/^\s*ข้าพเจ้าขอเบิกความต่อศาลว่า[:：]?\s*/i, "")
    .replace(/^\s*พยานขอเบิกความว่า[:：]?\s*/i, "")
    .trim();
}

function localFallbackTurns(text) {
  return splitIntoSpeakerTurns(text).map((turn, index) => ({
    id: `local-${Date.now()}-${index}`,
    time: formatTurnTime({ startSeconds: index * 5 }, index),
    speaker: turn.speaker,
    text: turn.text,
    words: splitFallbackWords(turn.text),
  }));
}

function cleanTranscriptLineForSummary(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function formatTurnForSummary(turn) {
  const speaker = turn?.speaker === "ถาม" ? "ถาม" : "พยาน";
  const text = cleanTranscriptLineForSummary(turn?.text);
  return text ? `${speaker}: ${text}` : "";
}

function getSummaryTranscriptText() {
  const sourceText = getExportableTranscriptText();
  if (state.turns.length) return state.turns.map(formatTurnForSummary).filter(Boolean).join("\n");
  return localFallbackTurns(sourceText)
    .map(formatTurnForSummary)
    .filter(Boolean)
    .join("\n");
}

function localFallbackSummary(transcriptText = getSummaryTranscriptText()) {
  const replacements = new Map(parseDictionaryRules(state.dictionaryText).map((entry) => [entry.keyword, entry.term]));
  let result = localFallbackTurns(transcriptText).filter((turn) => turn.speaker === "พยาน").map((turn) => turn.text).join(" ");
  replacements.forEach((term, keyword) => {
    result = result.replaceAll(keyword, term);
  });
  return result.trim() || "ไม่พบบทเบิกความพยานที่มีข้อความสาระสำคัญ";
}

function hasTranscriptContent() {
  if (state.turns.length > 0) return true;
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.some((segment) => segment.status === "ok" && String(segment.text || "").trim())) {
    return true;
  }
  return state.transcriptDraft.trim().length > 0;
}

// True when the transcript still carries "ถาม :" / "พยาน :" tags. Drives which
// of the two mutually exclusive actions the single #review-speakers button
// offers: tagged text can only be un-tagged, untagged text can only be sent to
// the AI speaker-review pass to get tagged again. Reads state rather than the
// live DOM so it is safe to call from render(); the contenteditable transcript
// already pushes every keystroke into state.transcriptDraft.
function hasSpeakerLabels(text = getTranscriptEditorText()) {
  return speakerTagPattern().test(String(text || ""));
}

// Drops the speaker tags but keeps every turn on its own line and every
// character of the spoken text - the inverse of the review pass, used when the
// user wants plain prose to paste elsewhere.
function stripSpeakerLabels(text) {
  // Untagged text has nothing to strip, and must be returned untouched:
  // splitIntoSpeakerTurns would fold it into one turn and collapse every
  // newline, silently destroying the user's paragraphs on a second call.
  if (!hasSpeakerLabels(text)) return String(text || "");
  return splitIntoSpeakerTurns(text)
    .map((turn) => turn.text)
    .filter(Boolean)
    .join("\n");
}

function removeSpeakerLabels() {
  syncFormState();
  const transcriptText = getTranscriptEditorText();
  if (!hasSpeakerLabels(transcriptText)) {
    state.message = "ไม่พบป้ายผู้พูดในข้อความถอดเสียง";
    render();
    return;
  }
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    state.transcriptSegments.forEach((segment) => {
      if (segment.status === "ok") segment.text = stripSpeakerPrefixes(segment.text || "");
    });
    rebuildTranscriptDraftFromSegments();
  } else {
    state.transcriptDraft = stripSpeakerPrefixes(transcriptText);
    state.turns = [];
  }
  state.issueNotice = null;
  reanchorSpellFixes();
  state.message = "เอาป้ายผู้พูดออกแล้ว กด \"ตรวจผู้พูด\" เพื่อให้ AI ใส่ป้ายกลับได้";
  render();
}

function hasClearedTranscript() {
  return Boolean(
    state.clearedTranscript?.turns?.length
    || state.clearedTranscript?.transcriptDraft?.trim()
    || (Array.isArray(state.clearedTranscript?.transcriptSegments) && state.clearedTranscript.transcriptSegments.length)
  );
}

function hasClearedSummary() {
  return Boolean(state.clearedSummary?.summary?.trim());
}

function hasClearedCaseInfo() {
  return hasCaseInfoContent(state.clearedCaseInfo);
}

function getTranscriptEditorText() {
  // Do not read segment editors from the DOM here. render() calls this while
  // building the next tree; a DOM sync would copy the *old* editor text back
  // over in-memory corrections (ตรวจคำผิด highlights never appeared on
  // transcribe segments). Live typing already updates segment.text via the
  // input handler; explicit actions call syncFormState() first.
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    return joinOkSegmentTexts(state.transcriptSegments) || state.transcriptDraft || "";
  }
  return state.transcriptDraft || (state.turns.length ? formatTranscript() : "");
}

function formatTranscript() {
  if (state.turns.length === 0) {
    if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
      return joinOkSegmentTexts(state.transcriptSegments);
    }
    return state.transcriptDraft.trim();
  }
  return state.turns.map((turn, index) => `[${formatTurnTime(turn, index)}] ${turn.speaker} : ${turn.text}`).join("\n");
}

function refreshTranscriptActionButtons() {
  const map = {
    "#copy-transcript": "copy-transcript",
    "#reflow-transcript": "reflow-transcript",
    "#download-transcript": "download-transcript",
    "#clear-transcript": "clear-transcript",
    "#summarize": "summarize",
    "#review-speakers": "review-speakers",
    "#spellcheck": "spellcheck",
    "#transcribe-last-audio": "transcribe",
    "#start-recording": "start-recording",
    "#start-camera": "start-camera",
    "#copy-summary": "copy-summary",
    "#download-summary": "download-summary",
    "#clear-summary": "clear-summary",
    "#play-audio": "play-audio",
    "#download-audio": "download-audio",
  };
  Object.entries(map).forEach(([selector, name]) => {
    document.querySelector(selector)?.toggleAttribute("disabled", isControlDisabled(name));
  });
  document.querySelector("#camera-capture")?.toggleAttribute("disabled", isControlDisabled("camera-capture"));
  document.querySelector("#audio-file")?.toggleAttribute("disabled", isControlDisabled("audio-file"));
  document.querySelector("#audio-seek")?.toggleAttribute("disabled", isControlDisabled("audio-seek"));
  syncReflowControlDisabled();
}

function syncReflowControlDisabled() {
  const run = document.querySelector("#reflow-transcript");
  const sw = document.querySelector("#reflow-transcript-auto");
  const wrap = document.querySelector(".transcript-panel .reflow-toggle");
  if (run) run.toggleAttribute("disabled", isControlDisabled("reflow-transcript"));
  if (sw) sw.toggleAttribute("disabled", isControlDisabled("reflow-transcript-auto"));
  wrap?.classList.toggle("is-disabled", Boolean(run?.disabled));
}

function downloadLatestAudio() {
  if (!refs.lastAudioBlob) return;
  const mimeType = getAudioMimeType(refs.lastAudioBlob);
  const extension = audioExtensionFromMimeType(mimeType);
  downloadBlob(`omkwam-audio.${extension}`, refs.lastAudioBlob);
}

function setBusy(value, message = "") {
  state.busy = value;
  state.message = message;
  render();
}

function stopProgressHeartbeat() {
  if (refs.progressTimer) {
    window.clearInterval(refs.progressTimer);
    refs.progressTimer = null;
  }
}

function updateProgressMessage() {
  if (!refs.progressTimer || !state.busy) return;
  const action = refs.progressAction || (state.busy === "summarizing" ? "กำลังสรุปความ" : "กำลังถอดไฟล์เสียง");
  const startedAt = refs.geminiStartedAt || refs.progressStartedAt;
  const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  if (!refs.geminiStartedAt && !/Gemini|ส่ง|อัปโหลด/.test(action)) {
    state.message = `${action} - ใช้เวลา ${elapsed} วินาที`;
    render();
    return;
  }
  let prefix = `ส่งคำขอไปยัง Gemini แล้ว ${elapsed} วินาที`;
  if (elapsed >= 180) prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที อาจค้างหรือโมเดลหนาแน่น`;
  else if (elapsed >= 120) prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที ถ้านานผิดปกติลองเปลี่ยน model`;
  else if (elapsed >= 60) prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที ไฟล์ยาวหรือโมเดลช้าอาจใช้เวลานาน`;
  state.message = `${prefix} - ${action}`;
  render();
}

function formatElapsedSeconds(startedAt = refs.geminiStartedAt || refs.progressStartedAt) {
  if (!startedAt) return "๑";
  return String(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
}

function formatGeminiSuccessMessage(message) {
  return `${message} - ใช้เวลา ${formatElapsedSeconds()} วินาที`;
}

function isGeminiProgressText(message = "", action = "") {
  return /Gemini|ส่ง|อัปโหลด/.test(`${message} ${action}`);
}

function formatGeminiProgressMessage(message, action = message) {
  const isGeminiProgress = isGeminiProgressText(message, action);
  if (isGeminiProgress && !refs.geminiStartedAt) refs.geminiStartedAt = Date.now();
  const startedAt = isGeminiProgress ? refs.geminiStartedAt : refs.progressStartedAt;
  const elapsed = formatElapsedSeconds(startedAt || Date.now());
  return isGeminiProgress
    ? `${message} - รอมาแล้ว ${elapsed} วินาที`
    : `${message} - ใช้เวลา ${elapsed} วินาที`;
}

function startProgressHeartbeat(action) {
  stopProgressHeartbeat();
  refs.progressStartedAt = Date.now();
  refs.progressAction = action;
  refs.progressTimer = window.setInterval(updateProgressMessage, 7000);
}

function beginCancelableTask(kind, message, action) {
  hideChunkRetryPopover();
  refs.abortController?.abort();
  refs.abortController = new AbortController();
  refs.cancelRequested = false;
  refs.geminiStartedAt = 0;
  setBusy(kind, message);
  startProgressHeartbeat(action || message);
  return refs.abortController;
}

function finishCancelableTask(controller) {
  if (refs.abortController === controller) {
    refs.abortController = null;
  }
  refs.cancelRequested = false;
  stopProgressHeartbeat();
}

function setProgressAction(message, action = message) {
  refs.progressAction = action;
  state.message = formatGeminiProgressMessage(message, action);
  render();
}

function cancelActiveTask() {
  if (!refs.abortController || !["transcribing", "summarizing", "reviewing-speakers", SPELL_BUSY, "reflowing"].includes(state.busy)) return;
  refs.cancelRequested = true;
  refs.abortController.abort();
  state.message = "กำลังหยุดงานที่ส่งไป Gemini";
  render();
}

function resetAudioProgress() {
  state.audioCurrentTime = 0;
  state.audioDuration = 0;
}

function setLatestAudioBlob(blob, options = {}) {
  const mimeType = options.mimeType || getAudioMimeType(blob);
  hideVisibleDocumentPlayer();
  refs.lastAudioBlob = blob;
  refs.audioSourceId += 1;
  state.latestSourceKind = "audio";
  state.docPreview = null;
  if (state.recordedAudioUrl) URL.revokeObjectURL(state.recordedAudioUrl);
  refs.playback?.pause();
  refs.playback = null;
  state.isAudioPlaying = false;
  resetAudioProgress();
  state.recordedAudioUrl = URL.createObjectURL(blob);
  state.recordedAudioInfo = options.info || formatAudioInfo(blob, mimeType);
  ensurePlayback()?.load?.();
  return mimeType;
}

function ensurePlayback() {
  if (!state.recordedAudioUrl) return null;
  if (!refs.playback || refs.playback.src !== state.recordedAudioUrl) {
    refs.playback?.pause();
    refs.playback = new Audio(state.recordedAudioUrl);
    refs.playback.preload = "metadata";
  }
  refs.playback.onloadedmetadata = () => {
    state.audioDuration = Number.isFinite(refs.playback.duration) ? refs.playback.duration : 0;
    state.audioCurrentTime = refs.playback.currentTime || 0;
    render();
  };
  refs.playback.ontimeupdate = () => {
    state.audioCurrentTime = refs.playback.currentTime || 0;
    state.audioDuration = Number.isFinite(refs.playback.duration) ? refs.playback.duration : state.audioDuration;
    refreshAudioPlayer();
  };
  refs.playback.onended = () => {
    state.isAudioPlaying = false;
    state.audioCurrentTime = refs.playback?.duration || 0;
    render();
  };
  return refs.playback;
}

function refreshAudioPlayer() {
  const seek = document.querySelector("#audio-seek");
  const current = document.querySelector("#audio-current-time");
  const duration = document.querySelector("#audio-duration");
  if (seek) {
    seek.max = String(Math.max(0, state.audioDuration || 0));
    seek.value = String(Math.min(state.audioCurrentTime || 0, state.audioDuration || state.audioCurrentTime || 0));
  }
  if (current) current.textContent = formatAudioTime(state.audioCurrentTime);
  if (duration) duration.textContent = formatAudioTime(state.audioDuration);
}



function scrollTranscriptToSegment(segmentId) {
  if (!segmentId) return;
  const row = document.querySelector(`[data-segment-id="${CSS.escape(segmentId)}"]`);
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function getDocumentPageForSegment(segment) {
  if (!isDocumentSegment(segment)) return null;
  const source = refs.docSources?.get(segment.audioSourceId);
  if (!source?.pages) return null;
  return source.pages.find((page) => page.id === segment.pageId) || source.pages[segment.chunkIndex] || null;
}

function findSegmentForDocPage(pageId) {
  if (!pageId || !Array.isArray(state.transcriptSegments)) return null;
  return state.transcriptSegments.find((segment) => isDocumentSegment(segment) && segment.pageId === pageId && segment.audioSourceId === refs.audioSourceId) || null;
}

function documentStatusForPage(page) {
  const segment = findSegmentForDocPage(page?.id);
  return segment?.status || "";
}

function formatDocumentBatchStatus() {
  const count = refs.docPages.length;
  if (!count) return "ยังไม่มีรูปภาพ";
  const segs = Array.isArray(state.transcriptSegments)
    ? state.transcriptSegments.filter((segment) => isDocumentSegment(segment) && segment.audioSourceId === refs.audioSourceId)
    : [];
  const failed = segs.filter((segment) => segment.status === "failed").length;
  if (failed) return `ถอดไม่สำเร็จ ${failed} หน้า · ${count} หน้า`;
  if (segs.some((segment) => segment.status === "transcribing" || segment.status === "pending")) {
    return `กำลังถอดข้อความ · ${count} หน้า`;
  }
  if (segs.length && segs.every((segment) => segment.status === "ok")) return `พร้อมสำหรับการถอดข้อความ · ${count} หน้า`;
  return `พร้อมสำหรับการถอดข้อความ · ${count} หน้า`;
}

function persistCurrentDocumentPages() {
  if (!refs.docSources) refs.docSources = new Map();
  if (state.latestSourceKind !== "document") return;
  refs.docSources.set(refs.audioSourceId, { pages: refs.docPages });
}

function explainBusyBlocksNewSource() {
  if (!state.busy) return false;
  state.message = state.busy === "transcribing"
    ? "กำลังถอดอยู่ กดหยุดถอดก่อน แล้วค่อยนำเข้าไฟล์หรือเริ่มบันทึกใหม่"
    : (state.busy === "recording" || state.busy === "stopping")
      ? "กำลังบันทึกเสียง หยุดบันทึกก่อนแล้วค่อยนำเข้าไฟล์ใหม่"
      : state.busy === "summarizing"
        ? "กำลังสรุปความ รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยนำเข้าไฟล์ใหม่"
        : state.busy === "reviewing-speakers"
          ? "กำลังตรวจสอบผู้พูด รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยนำเข้าไฟล์ใหม่"
          : state.busy === SPELL_BUSY
            ? "กำลังตรวจคำผิด รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยนำเข้าไฟล์ใหม่"
            : state.busy === "reflowing"
              ? "กำลังจัดหน้า รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยนำเข้าไฟล์ใหม่"
              : "กำลังทำงานอยู่ รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยนำเข้าไฟล์ใหม่";
  render();
  return true;
}

// Keep previous document pages in docSources so old transcript rows stay retryable,
// but drop them from the visible filmstrip when the current source becomes audio.
function hideVisibleDocumentPlayer() {
  if (state.latestSourceKind === "document") persistCurrentDocumentPages();
  state.docPreview = null;
  refs.docPages = [];
  state.docInfo = "";
}

function hideVisibleAudioPlayer() {
  if (state.recordedAudioUrl) {
    try { URL.revokeObjectURL(state.recordedAudioUrl); } catch { /* ignore */ }
  }
  state.recordedAudioUrl = "";
  refs.playback?.pause();
  refs.playback = null;
  state.isAudioPlaying = false;
  resetAudioProgress();
  state.recordedAudioInfo = "";
}

function startNewDocumentSource() {
  hideVisibleAudioPlayer();
  refs.audioSourceId += 1;
  state.latestSourceKind = "document";
  state.docPreview = null;
  refs.docPages = [];
  persistCurrentDocumentPages();
  return refs.audioSourceId;
}

function ensureDocumentSourceForAppend() {
  if (state.latestSourceKind === "document" && refs.docSources?.has(refs.audioSourceId)) {
    return refs.audioSourceId;
  }
  return startNewDocumentSource();
}

function syncDocumentSegmentMeta() {
  if (!Array.isArray(state.transcriptSegments)) return;
  const sourceId = refs.audioSourceId;
  const pageIds = refs.docPages.map((page) => page.id);
  state.transcriptSegments = unlinkRemovedDocumentPages(state.transcriptSegments, sourceId, pageIds);
  state.transcriptSegments = reorderLinkedDocumentSegments(state.transcriptSegments, sourceId, refs.docPages);
  rebuildTranscriptDraftFromSegments();
}

function removeDocumentPage(pageId) {
  if (state.busy || !pageId) return;
  const index = refs.docPages.findIndex((page) => page.id === pageId);
  if (index < 0) return;
  const [removed] = refs.docPages.splice(index, 1);
  revokePagePreview(removed);
  persistCurrentDocumentPages();
  if (state.docPreview?.pageId === pageId) state.docPreview = null;
  syncDocumentSegmentMeta();
  state.docInfo = formatDocumentBatchStatus();
  render();
}

function reorderDocumentPages(fromIndex, toIndex) {
  if (state.busy) return;
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
  if (from < 0 || to < 0 || from >= refs.docPages.length || to >= refs.docPages.length) return;
  const [moved] = refs.docPages.splice(from, 1);
  refs.docPages.splice(to, 0, moved);
  persistCurrentDocumentPages();
  syncDocumentSegmentMeta();
  render();
}

// Pointer-driven filmstrip reorder (mouse, touch, pen). HTML5 drag events
// were mouse-only, so phones could not rearrange pages at all.
const DOC_THUMB_LONG_PRESS_MS = 300;
const DOC_THUMB_TOUCH_CANCEL_PX = 8;
const DOC_THUMB_MOUSE_DRAG_PX = 5;
const DOC_THUMB_SCROLL_EDGE = 28;
const DOC_THUMB_GHOST_SCALE = 0.86;
const DOC_THUMB_GHOST_LIFT_MOUSE = 18;
const DOC_THUMB_GHOST_LIFT_TOUCH = 56;
const DOC_THUMB_REORDER_MS = 180;
const DOCUMENT_IMPORT_READY_MESSAGE = "กรุณาเรียงลำดับรูป ขยายรูปเพื่อ crop เสร็จแล้วให้กดปุ่มถอดข้อความ";
const DOC_CROP_HANDLE = 14;
const DOC_CROP_HIT = 20;

function docThumbToIndexAt(clientX, placeholder) {
  const thumbs = [...document.querySelectorAll("#doc-filmstrip .doc-thumb")]
    .filter((el) => el !== placeholder);
  for (let i = 0; i < thumbs.length; i += 1) {
    const rect = thumbs[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return thumbs.length;
}

function updateLiveDocThumbNumbers(session) {
  const thumbs = [...document.querySelectorAll("#doc-filmstrip .doc-thumb")];
  thumbs.forEach((el, index) => {
    el.dataset.docIndex = String(index);
    const num = el.querySelector(".doc-thumb-num");
    if (!num) return;
    if (el.classList.contains("is-placeholder")) num.textContent = "";
    else num.textContent = String(index + 1);
  });
  const ghostNum = session?.ghost?.querySelector(".doc-thumb-num");
  if (ghostNum && Number.isInteger(session.toIndex)) {
    ghostNum.textContent = String(session.toIndex + 1);
  }
}

function previewDocThumbReorder(toIndex) {
  const strip = document.querySelector("#doc-filmstrip");
  const session = refs.docThumbDrag;
  const placeholder = session?.thumb;
  if (!strip || !placeholder) return;
  const thumbs = [...strip.querySelectorAll(".doc-thumb")];
  const others = thumbs.filter((el) => el !== placeholder);
  const nextIndex = Math.max(0, Math.min(others.length, Number(toIndex) || 0));
  const currentIndex = thumbs.indexOf(placeholder);
  session.toIndex = nextIndex;
  if (currentIndex !== nextIndex) {
    const first = thumbs.map((el) => ({ el, left: el.getBoundingClientRect().left }));
    if (nextIndex >= others.length) strip.appendChild(placeholder);
    else strip.insertBefore(placeholder, others[nextIndex]);
    for (const { el, left } of first) {
      const dx = left - el.getBoundingClientRect().left;
      el.style.transition = "none";
      el.style.transform = dx ? `translateX(${dx}px)` : "";
    }
    void strip.offsetWidth;
    for (const { el } of first) {
      el.style.transition = `transform ${DOC_THUMB_REORDER_MS}ms ease`;
      el.style.transform = "";
    }
  }
  updateLiveDocThumbNumbers(session);
}

function clearDocThumbDragSession() {
  const session = refs.docThumbDrag;
  if (!session) return;
  window.clearTimeout(session.timer);
  if (session.scrollRaf) window.cancelAnimationFrame(session.scrollRaf);
  document.removeEventListener("pointermove", session.onMove, true);
  document.removeEventListener("pointerup", session.onUp, true);
  document.removeEventListener("pointercancel", session.onCancel, true);
  document.removeEventListener("touchmove", session.onTouchMove, true);
  document.removeEventListener("click", session.onClickCapture, true);
  session.ghost?.remove();
  document.querySelectorAll("#doc-filmstrip .doc-thumb").forEach((el) => {
    el.style.transition = "";
    el.style.transform = "";
    el.classList.remove("is-dragging", "is-placeholder");
  });
  document.body.classList.remove("is-doc-reordering");
  refs.docThumbDrag = null;
}

function endDocThumbDrag(commit) {
  const session = refs.docThumbDrag;
  if (!session) return;
  const from = session.fromIndex;
  const to = Number.isInteger(session.toIndex) ? session.toIndex : from;
  const wasDragging = session.dragging;
  const suppressMs = session.dragging || session.movedPastClick ? 400 : 0;
  clearDocThumbDragSession();
  if (suppressMs) refs.docThumbSuppressClickUntil = Date.now() + suppressMs;
  if (commit && !state.busy && from !== to) reorderDocumentPages(from, to);
  else if (wasDragging) render();
}

function moveDocThumbGhost(session, clientX, clientY) {
  if (!session.ghost) return;
  const scale = DOC_THUMB_GHOST_SCALE;
  const lift = session.pointerType === "touch" ? DOC_THUMB_GHOST_LIFT_TOUCH : DOC_THUMB_GHOST_LIFT_MOUSE;
  const x = clientX - session.offsetX * scale;
  const y = clientY - session.offsetY * scale - lift;
  session.ghost.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function autoScrollDuringDocThumbDrag(session, clientX, clientY) {
  const strip = document.querySelector("#doc-filmstrip");
  if (strip) {
    const rect = strip.getBoundingClientRect();
    const edge = DOC_THUMB_SCROLL_EDGE;
    let dx = 0;
    if (clientX < rect.left + edge) dx = -Math.max(4, Math.ceil((edge - (clientX - rect.left)) * 0.45));
    else if (clientX > rect.right - edge) dx = Math.max(4, Math.ceil((edge - (rect.right - clientX)) * 0.45));
    if (dx) strip.scrollLeft += dx;
  }
  const edgeY = DOC_THUMB_SCROLL_EDGE;
  let dy = 0;
  if (clientY < edgeY) dy = -Math.max(4, Math.ceil((edgeY - clientY) * 0.45));
  else if (clientY > window.innerHeight - edgeY) dy = Math.max(4, Math.ceil((edgeY - (window.innerHeight - clientY)) * 0.45));
  if (dy) window.scrollBy(0, dy);
}

function startDocThumbDrag(session, clientX, clientY) {
  if (!session || session.dragging || state.busy) return;
  session.dragging = true;
  session.movedPastClick = true;
  window.clearTimeout(session.timer);
  session.timer = 0;
  const thumb = session.thumb;
  const rect = thumb.getBoundingClientRect();
  session.offsetX = clientX - rect.left;
  session.offsetY = clientY - rect.top;
  document.body.classList.add("is-doc-reordering");
  const ghost = thumb.cloneNode(true);
  ghost.classList.add("doc-thumb-ghost");
  ghost.classList.remove("is-dragging", "is-placeholder");
  ghost.removeAttribute("data-doc-page-id");
  ghost.removeAttribute("tabindex");
  ghost.setAttribute("aria-hidden", "true");
  ghost.querySelector("[data-remove-doc-page]")?.remove();
  document.body.appendChild(ghost);
  session.ghost = ghost;
  thumb.classList.add("is-placeholder");
  thumb.classList.remove("is-dragging");
  moveDocThumbGhost(session, clientX, clientY);
  previewDocThumbReorder(docThumbToIndexAt(clientX, thumb));
  if (session.pointerType === "touch" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(15); } catch { /* ignore */ }
  }
  const tick = () => {
    if (!refs.docThumbDrag?.dragging) return;
    autoScrollDuringDocThumbDrag(session, session.lastX, session.lastY);
    previewDocThumbReorder(docThumbToIndexAt(session.lastX, session.thumb));
    session.scrollRaf = window.requestAnimationFrame(tick);
  };
  session.scrollRaf = window.requestAnimationFrame(tick);
}

function bindDocThumbPointerReorder(thumb) {
  thumb.addEventListener("pointerdown", (event) => {
    if (state.busy) return;
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest("[data-remove-doc-page]")) return;
    if (refs.docThumbDrag) endDocThumbDrag(false);
    const fromIndex = Number(thumb.dataset.docIndex);
    if (!Number.isInteger(fromIndex)) return;
    const session = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      thumb,
      fromIndex,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      toIndex: fromIndex,
      dragging: false,
      movedPastClick: false,
      timer: 0,
      scrollRaf: 0,
      ghost: null,
      offsetX: 0,
      offsetY: 0,
    };
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;
      if (refs.docThumbDrag !== session) return;
      session.lastX = moveEvent.clientX;
      session.lastY = moveEvent.clientY;
      const dx = moveEvent.clientX - session.startX;
      const dy = moveEvent.clientY - session.startY;
      const dist = Math.hypot(dx, dy);
      if (!session.dragging) {
        if (session.pointerType === "touch") {
          if (dist > DOC_THUMB_TOUCH_CANCEL_PX) {
            session.movedPastClick = true;
            refs.docThumbSuppressClickUntil = Date.now() + 400;
            window.clearTimeout(session.timer);
            session.timer = 0;
            // Abandon pick-up so the browser can scroll.
            clearDocThumbDragSession();
          }
          return;
        }
        if (dist >= DOC_THUMB_MOUSE_DRAG_PX) {
          moveEvent.preventDefault();
          startDocThumbDrag(session, moveEvent.clientX, moveEvent.clientY);
        }
        return;
      }
      moveEvent.preventDefault();
      moveDocThumbGhost(session, moveEvent.clientX, moveEvent.clientY);
      autoScrollDuringDocThumbDrag(session, moveEvent.clientX, moveEvent.clientY);
      previewDocThumbReorder(docThumbToIndexAt(moveEvent.clientX, session.thumb));
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      if (session.dragging) upEvent.preventDefault();
      endDocThumbDrag(session.dragging);
    };
    const onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      endDocThumbDrag(false);
    };
    const onTouchMove = (touchEvent) => {
      if (!session.dragging) return;
      touchEvent.preventDefault();
    };
    const onClickCapture = (clickEvent) => {
      if (Date.now() < (refs.docThumbSuppressClickUntil || 0)) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      }
    };
    session.onMove = onMove;
    session.onUp = onUp;
    session.onCancel = onCancel;
    session.onTouchMove = onTouchMove;
    session.onClickCapture = onClickCapture;
    refs.docThumbDrag = session;
    document.addEventListener("pointermove", onMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("click", onClickCapture, true);
    if (session.pointerType === "touch") {
      session.timer = window.setTimeout(() => {
        if (refs.docThumbDrag !== session || session.dragging) return;
        startDocThumbDrag(session, session.lastX, session.lastY);
      }, DOC_THUMB_LONG_PRESS_MS);
    }
  });
}

function moveDocumentPageWithKeys(pageId, delta) {
  if (state.busy || !pageId) return;
  const from = refs.docPages.findIndex((page) => page.id === pageId);
  if (from < 0) return;
  const to = from + delta;
  if (to < 0 || to >= refs.docPages.length) return;
  reorderDocumentPages(from, to);
  document.querySelector(`.doc-thumb[data-doc-page-id="${CSS.escape(pageId)}"]`)?.focus();
}


function openDocumentPreview(page) {
  if (!page) return;
  const segment = findSegmentForDocPage(page.id);
  state.docPreview = {
    pageId: page.id,
    url: page.previewable ? page.previewUrl : "",
    label: page.filename || "",
    previewable: Boolean(page.previewable && page.previewUrl),
  };
  render();
  if (segment) scrollTranscriptToSegment(segment.id);
}

function closeDocumentPreview() {
  if (!state.docPreview) return;
  state.docPreview = null;
  refs.docCropDrag = null;
  document.body.classList.remove("is-doc-cropping");
  if (refs.docCropOnResize) {
    window.removeEventListener("resize", refs.docCropOnResize);
    refs.docCropOnResize = null;
  }
  render();
}

function renderDocumentFilmstrip() {
  if (!refs.docPages.length) {
    return `<div class="doc-filmstrip" id="doc-filmstrip"><span class="doc-filmstrip-empty">ลากรูปหรือ PDF มาวาง หรือกดเลือกไฟล์ — จัดลำดับได้ก่อนถอดข้อความ</span></div>`;
  }
  return `
    <div class="doc-filmstrip" id="doc-filmstrip">
      ${refs.docPages.map((page, index) => {
        const status = documentStatusForPage(page);
        const statusClass = status === "failed" ? "is-failed" : status ? `is-${status}` : "";
        const preview = page.previewable && page.previewUrl
          ? `<img src="${escapeHtml(page.previewUrl)}" alt="${escapeHtml(page.filename || `หน้า ${index + 1}`)}">`
          : `<span class="doc-thumb-fallback">HEIC</span>`;
        return `
          <div class="doc-thumb ${statusClass}" data-doc-page-id="${escapeHtml(page.id)}" data-doc-index="${index}" data-doc-status="${escapeHtml(status)}" role="button" tabindex="0" title="${escapeHtml(page.filename || `หน้า ${index + 1}`)}">
            ${preview}
            <span class="doc-thumb-num">${index + 1}</span>
            <button class="doc-thumb-remove" type="button" data-remove-doc-page="${escapeHtml(page.id)}" ${disabledAttr("remove-doc-page")} aria-label="ลบหน้านี้">×</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDocumentPreviewOverlay() {
  if (!state.docPreview) return "";
  const page = currentPreviewPage();
  const canCrop = Boolean(state.docPreview.previewable && state.docPreview.url);
  const canRestore = pageHasOriginal(page);
  const mode = refs.docCrop?.pageId === state.docPreview.pageId && refs.docCrop.mode === "free" ? "free" : "rect";
  const body = canCrop
    ? `<div class="doc-crop-stage" id="doc-crop-stage">
        <img id="doc-preview-image" src="${escapeHtml(state.docPreview.url)}" alt="${escapeHtml(state.docPreview.label || "ตัวอย่างรูป")}">
        <svg class="doc-crop-overlay" id="doc-crop-overlay" aria-hidden="true"></svg>
      </div>`
    : `<div class="doc-preview-fallback">เบราว์เซอร์นี้แสดงไฟล์ HEIC ไม่ได้ แต่ยังส่งไปถอดข้อความกับ Gemini ได้ตามปกติ</div>`;
  return `
    <div class="doc-preview-backdrop" id="doc-preview-backdrop" data-close-doc-preview="true">
      <div class="doc-preview-dialog" role="dialog" aria-modal="true" aria-label="ตัวอย่างรูป">
        ${canCrop ? `
        <div class="doc-crop-bar">
          <div class="doc-crop-modes">
            <button type="button" id="doc-crop-mode-rect" class="${mode === "rect" ? "is-active" : ""}" ${disabledAttr("crop")}>สี่เหลี่ยม</button>
            <button type="button" id="doc-crop-mode-free" class="${mode === "free" ? "is-active" : ""}" ${disabledAttr("crop")}>อิสระ</button>
          </div>
          <div class="doc-preview-caption" title="${escapeHtml(state.docPreview.label || "")}">${escapeHtml(state.docPreview.label || "")}</div>
        </div>
        ` : ""}
        ${body}
        ${canCrop ? `
        <div class="doc-preview-footer">
          <div class="doc-crop-actions">
            <button type="button" id="doc-crop-cancel">ยกเลิก</button>
            <button type="button" id="doc-crop-restore" ${canRestore && !state.busy ? "" : "disabled"}>คืนรูปเดิม</button>
            <button type="button" id="doc-crop-apply" ${disabledAttr("crop")}>ใช้รูปนี้</button>
          </div>
        </div>
        ` : `<div class="doc-preview-caption">${escapeHtml(state.docPreview.label || "")}</div>`}
      </div>
    </div>
  `;
}

function currentPreviewPage() {
  const id = state.docPreview?.pageId;
  return id ? (refs.docPages.find((page) => page.id === id) || null) : null;
}

function pageHasOriginal(page) {
  return Boolean(page?.originalBlob && page.blob && page.blob !== page.originalBlob);
}

function defaultCropRect(width, height) {
  const insetX = Math.max(8, Math.round(width * 0.1));
  const insetY = Math.max(8, Math.round(height * 0.1));
  return clampCropRect({ x: insetX, y: insetY, w: width - insetX * 2, h: height - insetY * 2 }, width, height);
}

function ensureDocCropSession(page) {
  if (!page) return null;
  if (!refs.docCrop || refs.docCrop.pageId !== page.id) {
    refs.docCrop = {
      pageId: page.id,
      mode: "rect",
      rect: null,
      path: [],
      naturalWidth: 0,
      naturalHeight: 0,
      scale: 1,
      left: 0,
      top: 0,
    };
  }
  return refs.docCrop;
}

function layoutDocCropOverlay() {
  const session = refs.docCrop;
  const img = document.querySelector("#doc-preview-image");
  const overlay = document.querySelector("#doc-crop-overlay");
  const stage = document.querySelector("#doc-crop-stage");
  if (!session || !img || !overlay || !stage || !img.naturalWidth) return null;
  const stageRect = stage.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const scale = Math.min(imgRect.width / natW, imgRect.height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;
  const left = imgRect.left + (imgRect.width - dispW) / 2;
  const top = imgRect.top + (imgRect.height - dispH) / 2;
  session.naturalWidth = natW;
  session.naturalHeight = natH;
  session.scale = scale;
  session.left = left;
  session.top = top;
  overlay.style.left = `${left - stageRect.left}px`;
  overlay.style.top = `${top - stageRect.top}px`;
  overlay.style.width = `${dispW}px`;
  overlay.style.height = `${dispH}px`;
  overlay.setAttribute("width", String(Math.max(1, Math.round(dispW))));
  overlay.setAttribute("height", String(Math.max(1, Math.round(dispH))));
  overlay.setAttribute("viewBox", `0 0 ${natW} ${natH}`);
  overlay.setAttribute("preserveAspectRatio", "none");
  if (!session.rect) session.rect = defaultCropRect(natW, natH);
  return session;
}

function svgEl(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function drawDocCropOverlay() {
  const session = layoutDocCropOverlay();
  const overlay = document.querySelector("#doc-crop-overlay");
  if (!session || !overlay) return;
  const w = session.naturalWidth;
  const h = session.naturalHeight;
  const hs = Math.max(8, DOC_CROP_HANDLE / (session.scale || 1));
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

  const addVeil = (holeD) => {
    overlay.appendChild(svgEl("path", {
      class: "doc-crop-veil",
      d: `M0 0H${w}V${h}H0Z ${holeD}`,
      "fill-rule": "evenodd",
      fill: "rgba(0,0,0,0.55)",
      "pointer-events": "none",
    }));
  };
  const addOutlinePath = (d) => {
    overlay.appendChild(svgEl("path", {
      class: "doc-crop-outline",
      d,
      fill: "none",
      "fill-opacity": "0",
      stroke: "#7dd3fc",
      "stroke-width": "1.5",
      "vector-effect": "non-scaling-stroke",
      "pointer-events": "none",
    }));
  };

  if (session.mode === "free" && session.path.length) {
    const d = session.path.map((pt, index) => `${index ? "L" : "M"}${pt.x} ${pt.y}`).join(" ");
    const closed = session.path.length >= 3 ? `${d} Z` : d;
    if (session.path.length >= 3) addVeil(closed);
    addOutlinePath(closed);
  } else if (session.mode !== "free" && session.rect) {
    const r = session.rect;
    addVeil(`M${r.x} ${r.y}H${r.x + r.w}V${r.y + r.h}H${r.x}Z`);
    overlay.appendChild(svgEl("rect", {
      class: "doc-crop-outline",
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      fill: "none",
      "fill-opacity": "0",
      stroke: "#7dd3fc",
      "stroke-width": "1.5",
      "vector-effect": "non-scaling-stroke",
      "pointer-events": "none",
    }));
    const pts = [
      ["nw", r.x, r.y], ["n", r.x + r.w / 2, r.y], ["ne", r.x + r.w, r.y],
      ["w", r.x, r.y + r.h / 2], ["e", r.x + r.w, r.y + r.h / 2],
      ["sw", r.x, r.y + r.h], ["s", r.x + r.w / 2, r.y + r.h], ["se", r.x + r.w, r.y + r.h],
    ];
    pts.forEach(([name, x, y]) => {
      overlay.appendChild(svgEl("rect", {
        class: "doc-crop-handle",
        "data-handle": name,
        x: x - hs / 2,
        y: y - hs / 2,
        width: hs,
        height: hs,
        fill: "#e2e8f0",
        stroke: "#0ea5e9",
        "stroke-width": "1",
        "vector-effect": "non-scaling-stroke",
      }));
    });
  }
}

function clientToCropSource(clientX, clientY, session) {
  const scale = session.scale || 1;
  return {
    x: (clientX - (session.left || 0)) / scale,
    y: (clientY - (session.top || 0)) / scale,
  };
}

function hitCropHandle(session, src) {
  if (session.mode !== "rect" || !session.rect) return null;
  const r = session.rect;
  const hit = DOC_CROP_HIT / (session.scale || 1);
  const pts = [
    ["nw", r.x, r.y], ["n", r.x + r.w / 2, r.y], ["ne", r.x + r.w, r.y],
    ["w", r.x, r.y + r.h / 2], ["e", r.x + r.w, r.y + r.h / 2],
    ["sw", r.x, r.y + r.h], ["s", r.x + r.w / 2, r.y + r.h], ["se", r.x + r.w, r.y + r.h],
  ];
  for (const [name, x, y] of pts) {
    if (Math.abs(src.x - x) <= hit && Math.abs(src.y - y) <= hit) return name;
  }
  if (src.x >= r.x && src.x <= r.x + r.w && src.y >= r.y && src.y <= r.y + r.h) return "move";
  return null;
}

function resizeCropRect(handle, src, start, orig, width, height) {
  let x = orig.x;
  let y = orig.y;
  let w = orig.w;
  let h = orig.h;
  const dx = src.x - start.x;
  const dy = src.y - start.y;
  if (handle === "move") {
    x = orig.x + dx;
    y = orig.y + dy;
  } else {
    if (handle.includes("w")) { x = orig.x + dx; w = orig.w - dx; }
    if (handle.includes("e")) w = orig.w + dx;
    if (handle.includes("n")) { y = orig.y + dy; h = orig.h - dy; }
    if (handle.includes("s")) h = orig.h + dy;
    if (w < 0) { x += w; w = Math.abs(w); }
    if (h < 0) { y += h; h = Math.abs(h); }
  }
  return clampCropRect({ x, y, w, h }, width, height);
}

function setDocCropMode(mode) {
  const page = currentPreviewPage();
  const session = ensureDocCropSession(page);
  if (!session || state.busy) return;
  session.mode = mode === "free" ? "free" : "rect";
  if (session.mode === "free") session.path = [];
  document.querySelector("#doc-crop-mode-rect")?.classList.toggle("is-active", session.mode === "rect");
  document.querySelector("#doc-crop-mode-free")?.classList.toggle("is-active", session.mode === "free");
  drawDocCropOverlay();
}

async function applyDocumentCrop() {
  const page = currentPreviewPage();
  const session = refs.docCrop;
  if (!page?.blob || !session || session.pageId !== page.id || state.busy) return;
  try {
    const result = session.mode === "free"
      ? await cropImageBlob(page.blob, { mode: "free", path: session.path })
      : await cropImageBlob(page.blob, { mode: "rect", rect: session.rect });
    revokePagePreview(page);
    page.blob = result.blob;
    page.mimeType = result.mimeType;
    await attachPreview(page);
    persistCurrentDocumentPages();
    closeDocumentPreview();
  } catch (error) {
    state.message = error?.message || "ครอบรูปไม่สำเร็จ";
    render();
  }
}

async function restoreDocumentCrop() {
  const page = currentPreviewPage();
  if (!pageHasOriginal(page) || state.busy) return;
  if (page.previewUrl) {
    try { URL.revokeObjectURL(page.previewUrl); } catch { /* ignore */ }
  }
  page.blob = page.originalBlob;
  page.mimeType = page.originalMimeType || page.mimeType;
  page.previewUrl = "";
  page.previewable = false;
  await attachPreview(page);
  persistCurrentDocumentPages();
  if (refs.docCrop?.pageId === page.id) {
    refs.docCrop.rect = null;
    refs.docCrop.path = [];
  }
  if (state.docPreview) {
    state.docPreview.url = page.previewUrl;
    state.docPreview.previewable = page.previewable;
  }
  render();
}

function bindDocCropUi() {
  const img = document.querySelector("#doc-preview-image");
  const overlay = document.querySelector("#doc-crop-overlay");
  const page = currentPreviewPage();
  if (!img || !overlay || !page || !state.docPreview?.previewable) return;
  const session = ensureDocCropSession(page);
  const paint = () => drawDocCropOverlay();
  if (refs.docCropOnResize) window.removeEventListener("resize", refs.docCropOnResize);
  refs.docCropOnResize = paint;
  window.addEventListener("resize", paint);
  if (img.complete && img.naturalWidth) paint();
  else img.addEventListener("load", paint, { once: true });
  document.querySelector("#doc-crop-mode-rect")?.addEventListener("click", () => setDocCropMode("rect"));
  document.querySelector("#doc-crop-mode-free")?.addEventListener("click", () => setDocCropMode("free"));
  document.querySelector("#doc-crop-cancel")?.addEventListener("click", () => closeDocumentPreview());
  document.querySelector("#doc-crop-restore")?.addEventListener("click", () => { restoreDocumentCrop(); });
  document.querySelector("#doc-crop-apply")?.addEventListener("click", () => { applyDocumentCrop(); });

  const onMove = (event) => {
    if (!refs.docCropDrag || event.pointerId !== refs.docCropDrag.pointerId) return;
    event.preventDefault();
    const drag = refs.docCropDrag;
    const src = clientToCropSource(event.clientX, event.clientY, session);
    if (drag.kind === "lasso") {
      const last = session.path[session.path.length - 1];
      if (!last || Math.hypot(src.x - last.x, src.y - last.y) >= 2) {
        session.path.push({
          x: Math.min(session.naturalWidth, Math.max(0, src.x)),
          y: Math.min(session.naturalHeight, Math.max(0, src.y)),
        });
        drawDocCropOverlay();
      }
      return;
    }
    session.rect = resizeCropRect(drag.handle, src, drag.start, drag.orig, session.naturalWidth, session.naturalHeight);
    drawDocCropOverlay();
  };
  const onUp = (event) => {
    if (!refs.docCropDrag || event.pointerId !== refs.docCropDrag.pointerId) return;
    event.preventDefault();
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onUp, true);
    document.removeEventListener("touchmove", onTouchMove, { capture: true });
    document.body.classList.remove("is-doc-cropping");
    refs.docCropDrag = null;
    drawDocCropOverlay();
  };
  const onTouchMove = (event) => {
    if (!refs.docCropDrag) return;
    event.preventDefault();
  };
  overlay.addEventListener("pointerdown", (event) => {
    if (state.busy) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    layoutDocCropOverlay();
    const src = clientToCropSource(event.clientX, event.clientY, session);
    if (session.mode === "free") {
      session.path = [{
        x: Math.min(session.naturalWidth, Math.max(0, src.x)),
        y: Math.min(session.naturalHeight, Math.max(0, src.y)),
      }];
      refs.docCropDrag = { pointerId: event.pointerId, kind: "lasso" };
    } else {
      const handle = hitCropHandle(session, src);
      if (!handle) return;
      refs.docCropDrag = {
        pointerId: event.pointerId,
        kind: "rect",
        handle,
        start: src,
        orig: { ...session.rect },
      };
    }
    document.body.classList.add("is-doc-cropping");
    document.addEventListener("pointermove", onMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    drawDocCropOverlay();
  });
}


async function transcribeSingleDocumentSegment(segment, page, controller) {
  segment.status = "transcribing";
  segment.errorMessage = "";
  render();
  const total = Math.max(1, Number(segment.chunkCount) || refs.docPages.length || 1);
  const pageContext = total > 1 ? { index: segment.chunkIndex, count: total } : null;
  const pageLabel = total > 1 ? ` หน้าที่ ${segment.chunkIndex + 1}/${total}` : "";

  setProgressAction(`กำลังเตรียมรูปภาพ${pageLabel}`, "กำลังเตรียมรูปภาพ");
  throwIfCancelled(controller.signal);
  let mediaParts;
  if (page.blob.size > INLINE_AUDIO_SAFE_BYTES) {
    setProgressAction(`กำลังอัปโหลดรูปภาพ${pageLabel} ไป Gemini`, `กำลังอัปโหลดรูปภาพ${pageLabel}`);
    const uploaded = await uploadAudioFileToGemini(page.blob, page.mimeType, { signal: controller.signal });
    throwIfCancelled(controller.signal);
    const activeFile = await waitForGeminiFileActive(uploaded, {
      signal: controller.signal,
      onState: () => setProgressAction(`กำลังรอ Gemini เตรียมรูปภาพ${pageLabel}`, "กำลังรอไฟล์พร้อมใช้งาน"),
    });
    throwIfCancelled(controller.signal);
    mediaParts = buildTranscriptionMediaParts({ fileUri: activeFile.uri, fileMimeType: activeFile.mimeType }).parts;
  } else {
    const imageBase64 = await fileToBase64(page.blob);
    throwIfCancelled(controller.signal);
    mediaParts = buildTranscriptionMediaParts({ audioBase64: imageBase64, mimeType: page.mimeType }).parts;
  }
  setProgressAction(`กำลังรอ Gemini ถอดข้อความ${pageLabel}`, `กำลังรอผลถอดข้อความจาก Gemini${pageLabel}`);
  let text = "";
  try {
    text = await transcribeDocumentPageWithGemini(mediaParts, { signal: controller.signal, page: pageContext });
  } catch (error) {
    if (!error?.isEmptyTranscription) throw error;
  }
  segment.status = "ok";
  segment.text = text;
  segment.errorMessage = "";
  rebuildTranscriptDraftFromSegments();
}

async function transcribeCurrentDocument() {
  syncFormState();
  if (!refs.docPages.length) {
    state.message = "ยังไม่มีรูปภาพหรือไฟล์ PDF ให้ถอดข้อความ";
    render();
    return;
  }
  if (!state.apiKey.trim()) {
    state.message = "กรุณาใส่ Gemini API key ก่อนถอดข้อความ";
    render();
    return;
  }
  const sourceId = refs.audioSourceId;
  persistCurrentDocumentPages();
  const existing = Array.isArray(state.transcriptSegments)
    ? state.transcriptSegments.filter((segment) => isDocumentSegment(segment) && segment.audioSourceId === sourceId)
    : [];
  const existingByPage = new Map(existing.map((segment) => [segment.pageId, segment]));
  const allOk = existing.length && refs.docPages.every((page) => existingByPage.get(page.id)?.status === "ok");

  let toRun = [];
  if (!existing.length || allOk) {
    const legacyText = Array.isArray(state.transcriptSegments) ? "" : getTranscriptEditorText();
    const newSegments = createTranscriptSegmentsFromDocument(refs.docPages, sourceId);
    if (existing.some((segment) => segment.unlinked)) {
      state.transcriptSegments = replaceLinkedDocumentSegments(state.transcriptSegments, sourceId, newSegments);
    } else {
      state.transcriptSegments = mergeNewSourceSegments(state.transcriptSegments, legacyText, newSegments, sourceId);
    }
    toRun = newSegments;
  } else {
    const additions = [];
    refs.docPages.forEach((page, index) => {
      let segment = existingByPage.get(page.id);
      if (!segment || segment.unlinked) {
        segment = createTranscriptSegmentsFromDocument([page], sourceId)[0];
        additions.push(segment);
      }
      segment.chunkIndex = index;
      segment.pageNumber = index + 1;
      segment.chunkCount = refs.docPages.length;
      segment.filename = page.filename;
    });
    if (additions.length) {
      state.transcriptSegments = replaceLinkedDocumentSegments(state.transcriptSegments, sourceId, [
        ...existing.filter((segment) => !segment.unlinked && refs.docPages.some((page) => page.id === segment.pageId)),
        ...additions,
      ]);
    }
    syncDocumentSegmentMeta();
    toRun = (state.transcriptSegments || []).filter((segment) => (
      isDocumentSegment(segment)
      && segment.audioSourceId === sourceId
      && segment.status !== "ok"
      && !segment.unlinked
      && refs.docPages.some((page) => page.id === segment.pageId)
    ));
    if (!toRun.length) {
      state.message = "ถอดข้อความครบทุกหน้าแล้ว";
      render();
      return;
    }
    toRun.forEach((segment) => {
      if (segment.status === "failed") {
        segment.status = "pending";
        segment.errorMessage = "";
      }
    });
  }

  rebuildTranscriptDraftFromSegments();
  state.issueNotice = null;
  const controller = beginCancelableTask("transcribing", "กำลังถอดข้อความจากรูปภาพ", "กำลังถอดข้อความจากรูปภาพ");
  try {
    render();
    const result = await runSegmentQueue(toRun, controller);
    const failedHere = toRun.filter((segment) => segment.status === "failed").length;
    if (result.quotaOrCapacityError) {
      handleGeminiError(result.quotaOrCapacityError, "ถอดข้อความไม่สำเร็จ");
    } else if (!failedHere && !joinOkSegmentTexts(toRun) && toRun.every((segment) => segment.status === "ok" && !String(segment.text || "").trim())) {
      state.message = formatGeminiSuccessMessage("ถอดข้อความสำเร็จ (ไม่พบข้อความในหน้าที่ส่งไป)");
    } else {
      const notes = [
        toRun.length > 1 ? `แบ่งเป็น ${toRun.length} หน้า` : "",
        failedHere ? `ถอดไม่สำเร็จ ${failedHere} หน้า กดถอดหน้าที่พลาดใหม่ได้` : "",
      ].filter(Boolean).join(" · ");
      const label = failedHere === toRun.length ? "ถอดข้อความไม่สำเร็จ" : failedHere ? "ถอดข้อความสำเร็จบางส่วน" : "ถอดข้อความสำเร็จ";
      state.message = failedHere === toRun.length
        ? `${label}${notes ? ` (${notes})` : ""}`
        : formatGeminiSuccessMessage(notes ? `${label} (${notes})` : label);
    }
  } catch (error) {
    handleGeminiError(error, "ถอดข้อความไม่สำเร็จ");
  } finally {
    failUnfinishedSegments(toRun, CANCELLED_SEGMENT_MESSAGE);
    finishCancelableTask(controller);
    state.busy = null;
    rebuildTranscriptDraftFromSegments();
    render();
  }
  await maybeAutoAfterTranscription(toRun);
}

async function transcribeLastMedia() {
  if (state.busy === "transcribing") {
    cancelActiveTask();
    return;
  }
  if (state.latestSourceKind === "document") {
    await transcribeCurrentDocument();
    return;
  }
  await transcribeLastAudio();
}

async function handleImportedFiles(fileList, options = {}) {
  syncFormState();
  const incoming = [...(fileList || [])].filter(Boolean);
  if (!incoming.length) return;
  if (explainBusyBlocksNewSource()) return;

  const classified = incoming.map((file) => ({ file, kind: classifyImportFile(file) }));
  const unknown = classified.filter((item) => item.kind === "unknown");
  const docs = classified.filter((item) => item.kind === "image" || item.kind === "pdf");
  const audios = classified.filter((item) => item.kind === "audio");

  let keepKind = "";
  if (options.fromCamera) keepKind = "document";
  else if (docs.length && audios.length) {
    keepKind = classifyImportFile(incoming[0]) === "audio" ? "audio" : "document";
  } else if (docs.length) keepKind = "document";
  else if (audios.length) keepKind = "audio";

  if (!keepKind) {
    state.message = unknown.length
      ? "ไม่รองรับไฟล์นี้ เลือกไฟล์เสียง รูปภาพ (JPEG PNG WEBP HEIC) หรือ PDF"
      : "ยังไม่มีไฟล์ที่นำเข้าได้";
    render();
    return;
  }

  const skippedOther = keepKind === "document" ? audios.length : docs.length;
  const skipUnknown = unknown.length;
  const notes = [];
  if (skippedOther) notes.push("ไม่ผสมเสียงกับรูปในรอบเดียวกัน จึงข้ามไฟล์อีกประเภทไว้ก่อน (นำเข้าแยกครั้งได้)");
  if (skipUnknown) notes.push("ข้ามไฟล์ที่ไม่รองรับ");

  if (keepKind === "audio") {
    const audioFile = audios[0].file;
    if (audios.length > 1) notes.push("ไฟล์เสียงนำเข้าได้ครั้งละหนึ่งไฟล์ จึงใช้ไฟล์แรก");
    if (notes.length) state.message = notes.join(" ");
    await handleAudioFile(audioFile);
    return;
  }

  // Always append to the current filmstrip when images/PDF pages are already
  // listed. Only start a new document source when switching over (e.g. from
  // audio) or when the list is empty. Selection order is kept; new files go
  // after the existing pages. Exact File duplicates (name+size+lastModified)
  // are skipped.
  const append = state.latestSourceKind === "document" && Array.isArray(refs.docPages) && refs.docPages.length > 0;
  const { files: uniqueDocFiles, skippedDuplicates } = filterNewDocumentFiles(
    docs.map((item) => item.file),
    append ? refs.docPages : [],
  );
  if (skippedDuplicates) notes.push(`ข้ามไฟล์ที่ซ้ำ ${skippedDuplicates} ไฟล์`);
  if (!uniqueDocFiles.length) {
    state.message = notes.length ? notes.join(" ") : "ไม่พบรูปภาพใหม่ที่ยังไม่ได้อยู่ในรายการ";
    render();
    return;
  }
  if (!append) startNewDocumentSource();
  else ensureDocumentSourceForAppend();

  state.message = uniqueDocFiles.some((file) => classifyImportFile(file) === "pdf")
    ? "กำลังแยกหน้า PDF และเตรียมรูปภาพ..."
    : "กำลังเตรียมรูปภาพ...";
  render();
  try {
    const pages = await filesToDocumentPages(uniqueDocFiles, { sort: false });
    if (!pages.length) throw new Error("ไม่พบรูปภาพหรือหน้า PDF ที่จะนำเข้าได้");
    refs.docPages = append ? [...refs.docPages, ...pages] : pages;
    persistCurrentDocumentPages();
    state.docInfo = formatDocumentBatchStatus();
    state.message = DOCUMENT_IMPORT_READY_MESSAGE;
  } catch (error) {
    state.message = error?.message || "นำเข้ารูปภาพหรือ PDF ไม่สำเร็จ";
  }
  render();
}

function getCurrentAudioChunkMarks() {
  const source = refs.audioSources?.get(refs.audioSourceId);
  const chunks = source?.plan?.chunks;
  if (!Array.isArray(chunks) || chunks.length < 2) return [];
  const segs = Array.isArray(state.transcriptSegments)
    ? state.transcriptSegments.filter((segment) => segment.audioSourceId === refs.audioSourceId)
    : [];
  const planEnd = Math.max(0, ...chunks.map((chunk) => Number(chunk.endSeconds) || 0));
  const duration = Math.max(Number(state.audioDuration) || 0, planEnd, 1);
  return chunks.map((chunk, index) => {
    const seg = segs.find((segment) => segment.chunkIndex === index) || null;
    const startSeconds = Number(chunk.startSeconds) || 0;
    const endSeconds = Number(chunk.endSeconds) || 0;
    return {
      index,
      startSeconds,
      endSeconds,
      startPct: Math.min(100, Math.max(0, (startSeconds / duration) * 100)),
      endPct: Math.min(100, Math.max(0, (endSeconds / duration) * 100)),
      failed: seg?.status === "failed",
      segmentId: seg?.id || "",
      label: `ท่อนที่ ${index + 1} (${formatChunkRangeLabel(startSeconds, endSeconds)})`,
    };
  });
}

function hideChunkRetryPopover() {
  refs.chunkRetryPop?.remove();
  refs.chunkRetryPop = null;
  if (refs.chunkRetryPopOutside) {
    document.removeEventListener("pointerdown", refs.chunkRetryPopOutside, true);
    refs.chunkRetryPopOutside = null;
  }
  if (refs.chunkRetryPopKey) {
    document.removeEventListener("keydown", refs.chunkRetryPopKey, true);
    refs.chunkRetryPopKey = null;
  }
}

function positionRetryPopover(pop, { clientX = 0, clientY = 0, anchor = null } = {}) {
  const pad = 8;
  const gap = 6;
  const popRect = pop.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect?.() || {
    left: clientX,
    right: clientX,
    top: clientY,
    bottom: clientY,
    width: 0,
    height: 0,
  };
  const card = anchor?.closest?.(".player-card") || document.querySelector(".player-card");
  const titleRect = card?.querySelector?.(".latest-audio")?.getBoundingClientRect?.() || null;

  let left = (anchorRect.left + anchorRect.right) / 2 - popRect.width / 2;
  if (!anchorRect.width) left = clientX - popRect.width / 2;
  left = Math.min(Math.max(pad, left), window.innerWidth - popRect.width - pad);

  // Prefer below the thumb / fail-span so the card title and status badge stay visible.
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - popRect.height - gap;
  const belowFits = below + popRect.height <= window.innerHeight - pad;
  const aboveOverlapsTitle = Boolean(titleRect && above < titleRect.bottom);
  let top = belowFits || aboveOverlapsTitle ? below : Math.max(pad, above);
  top = Math.min(Math.max(pad, top), window.innerHeight - popRect.height - pad);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function showChunkRetryPopover({ segmentId, startSeconds, clientX, clientY, anchor = null }) {
  hideChunkRetryPopover();
  if (!segmentId) return;
  const targetSeg = findSegmentById(state.transcriptSegments, segmentId);
  if (!isDocumentSegment(targetSeg)) seekRecordedAudio(startSeconds);
  scrollTranscriptToSegment(segmentId);
  const retryLabel = isDocumentSegment(targetSeg) ? "ถอดหน้านี้ใหม่" : "ถอดท่อนนี้ใหม่";

  const pop = document.createElement("button");
  pop.type = "button";
  pop.className = "audio-chunk-retry-pop";
  pop.dataset.retryFromSeek = segmentId;
  pop.textContent = retryLabel;
  pop.setAttribute("aria-label", retryLabel);
  document.body.appendChild(pop);
  positionRetryPopover(pop, { clientX, clientY, anchor });
  refs.chunkRetryPop = pop;

  pop.addEventListener("click", () => {
    hideChunkRetryPopover();
    retryTranscriptSegment(segmentId);
  });

  refs.chunkRetryPopOutside = (event) => {
    if (pop.contains(event.target)) return;
    if (event.target?.closest?.("[data-seek-fail-segment]")) return;
    hideChunkRetryPopover();
  };
  refs.chunkRetryPopKey = (event) => {
    if (event.key === "Escape") hideChunkRetryPopover();
  };
  // Defer so the opening click does not instantly close it.
  window.setTimeout(() => {
    document.addEventListener("pointerdown", refs.chunkRetryPopOutside, true);
    document.addEventListener("keydown", refs.chunkRetryPopKey, true);
  }, 0);
}

function renderAudioSeekMarkers() {
  const marks = getCurrentAudioChunkMarks();
  if (!marks.length || !state.recordedAudioUrl) return "";
  const fails = marks.filter((mark) => mark.failed && mark.endPct > mark.startPct);
  const ticks = marks.slice(1); // boundary at each chunk start except 0
  return `
    <div class="audio-seek-markers" aria-hidden="true">
      ${fails.map((mark) => `
        <div
          class="audio-seek-fail-span"
          role="button"
          tabindex="0"
          style="left:${mark.startPct}%;width:${Math.max(0.6, mark.endPct - mark.startPct)}%"
          data-seek-fail-segment="${escapeHtml(mark.segmentId)}"
          data-seek-start="${mark.startSeconds}"
          title="${escapeHtml(mark.label)}"
          aria-label="${escapeHtml(mark.label)} ถอดไม่สำเร็จ"
        ></div>
      `).join("")}
      ${ticks.map((mark) => `
        <span
          class="audio-seek-tick ${mark.failed ? "is-failed" : ""}"
          style="left:${mark.startPct}%"
          title="${escapeHtml(mark.label)}"
        ></span>
      `).join("")}
    </div>
  `;
}

function seekRecordedAudio(value) {
  const playback = ensurePlayback();
  if (!playback) return;
  const duration = Number.isFinite(playback.duration) ? playback.duration : state.audioDuration;
  const requestedTime = Number(value);
  const nextTime = Number.isFinite(requestedTime) ? requestedTime : 0;
  state.audioCurrentTime = duration > 0 ? Math.min(Math.max(nextTime, 0), duration) : Math.max(nextTime, 0);
  playback.currentTime = state.audioCurrentTime;
  refreshAudioPlayer();
}

function clearRecordingMeters() {
  if (refs.volumeTimer) {
    window.clearInterval(refs.volumeTimer);
    refs.volumeTimer = null;
  }
  if (refs.recordingTimer) {
    window.clearInterval(refs.recordingTimer);
    refs.recordingTimer = null;
  }
  state.micVolume = 0;
}

function refreshRecordingMeter() {
  const time = document.querySelector(".recording-time");
  if (time) time.textContent = formatRecordingTime(state.recordingSeconds);
  const volume = document.querySelector(".mic-volume");
  if (volume) volume.textContent = `ระดับเสียง ${state.micVolume}%`;
  document.querySelectorAll(".meter-bars span").forEach((bar, index) => {
    const threshold = Math.round((index / 15) * 100);
    bar.classList.toggle("on", state.micVolume >= threshold);
  });
}

function rebuildTranscriptDraftFromSegments() {
  if (!Array.isArray(state.transcriptSegments)) return;
  state.transcriptDraft = joinOkSegmentTexts(state.transcriptSegments);
  state.turns = [];
}

function syncSegmentEditorsFromDom() {
  if (!Array.isArray(state.transcriptSegments)) return;
  // Only real editors - never the "กำลังถอด..." / failed placeholder boxes,
  // which share data-segment-id but are not user text.
  document.querySelectorAll(".chunk-segment-editor[data-segment-id]").forEach((element) => {
    const segment = findSegmentById(state.transcriptSegments, element.dataset.segmentId);
    if (!segment || segment.status !== "ok") return;
    segment.text = String(element.innerText || "").trim();
  });
  rebuildTranscriptDraftFromSegments();
}

function getExportableTranscriptText() {
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    syncSegmentEditorsFromDom();
    return joinOkSegmentTexts(state.transcriptSegments);
  }
  return getTranscriptEditorText();
}

const QUOTA_SKIP_AUDIO_MESSAGE = "โควตาหรือความหนาแน่นของ Gemini หมดก่อนถึงท่อนนี้ กดถอดท่อนนี้ใหม่ได้เมื่อพร้อม";
const QUOTA_SKIP_DOCUMENT_MESSAGE = "โควตาหรือความหนาแน่นของ Gemini หมดก่อนถึงหน้านี้ กดถอดหน้านี้ใหม่ได้เมื่อพร้อม";
const CANCELLED_SEGMENT_MESSAGE = "หยุดก่อนถอดท่อนนี้เสร็จ กดถอดท่อนนี้ใหม่ได้";

function quotaSkipMessageForSegment(segment) {
  return isDocumentSegment(segment) ? QUOTA_SKIP_DOCUMENT_MESSAGE : QUOTA_SKIP_AUDIO_MESSAGE;
}

function segmentUnit(segments) {
  return areDocumentSegments(segments) ? "หน้า" : "ท่อน";
}

function isCancelledSegment(segment) {
  const msg = String(segment?.errorMessage || "");
  return msg === CANCELLED_SEGMENT_MESSAGE || msg.startsWith("หยุดก่อน");
}

function isQuotaOrCapacityError(error) {
  return Boolean(error?.isQuota || error?.isCapacity || isQuotaMessage(error?.message) || isCapacityMessage(error?.message));
}

// Original audio per source, kept so a failed chunk can be re-sliced and
// re-sent later. Only the (compressed) source file and the cut plan are kept -
// never decoded PCM or encoded WAV chunks.
function getAudioSourceForSegment(segment) {
  if (!segment || segment.audioSourceId == null) return null;
  return refs.audioSources?.get(segment.audioSourceId) || null;
}

function pruneUnusedAudioSources(keepSourceId) {
  if (!refs.audioSources) return;
  const used = new Set((state.transcriptSegments || []).map((segment) => segment.audioSourceId));
  for (const id of [...refs.audioSources.keys()]) {
    if (id !== keepSourceId && !used.has(id)) refs.audioSources.delete(id);
  }
}

async function transcribeSingleSegment(segment, sourceBlob, plan, controller, options = {}) {
  const chunkPlan = plan.chunks[segment.chunkIndex];
  segment.status = "transcribing";
  segment.errorMessage = "";
  render();

  const chunkLabel = plan.chunks.length > 1 ? `ชิ้นที่ ${segment.chunkIndex + 1}/${plan.chunks.length}` : "";
  const chunkContext = plan.chunks.length > 1 ? { index: segment.chunkIndex, count: plan.chunks.length } : null;

  setProgressAction(`กำลังเตรียมไฟล์เสียง${chunkLabel ? " " + chunkLabel : ""}`, "กำลังเตรียมไฟล์เสียง");
  let built = await buildChunkAudioBlob(sourceBlob, chunkPlan, {
    usedChunking: plan.usedChunking,
    fallbackMimeType: getAudioMimeType(sourceBlob),
    decodedBuffer: options.decodedBuffer || null,
  });
  throwIfCancelled(controller.signal);
  const usedGainBoost = built.usedGainBoost;

  let mediaParts;
  if (built.blob.size > INLINE_AUDIO_SAFE_BYTES) {
    setProgressAction(`กำลังอัปโหลดไฟล์เสียง${chunkLabel ? " " + chunkLabel : ""} ไป Gemini`, `กำลังอัปโหลดไฟล์เสียง${chunkLabel ? " " + chunkLabel : ""}`);
    const uploaded = await uploadAudioFileToGemini(built.blob, built.mimeType, { signal: controller.signal });
    built = null; // release the encoded chunk as soon as it has been sent
    throwIfCancelled(controller.signal);
    const activeFile = await waitForGeminiFileActive(uploaded, {
      signal: controller.signal,
      onState: () => setProgressAction(`กำลังรอ Gemini เตรียมไฟล์เสียง${chunkLabel ? " " + chunkLabel : ""}`, "กำลังรอไฟล์พร้อมใช้งาน"),
    });
    throwIfCancelled(controller.signal);
    mediaParts = buildTranscriptionMediaParts({ fileUri: activeFile.uri, fileMimeType: activeFile.mimeType }).parts;
  } else {
    setProgressAction(`กำลังอ่านไฟล์เสียง${chunkLabel ? " " + chunkLabel : ""} ใน browser`, "กำลังเตรียมไฟล์เสียง");
    const audioBase64 = await fileToBase64(built.blob);
    const inlineMimeType = built.mimeType;
    built = null;
    throwIfCancelled(controller.signal);
    mediaParts = buildTranscriptionMediaParts({ audioBase64, mimeType: inlineMimeType }).parts;
  }

  setProgressAction(`กำลังรอ Gemini ถอดเสียง${chunkLabel ? " " + chunkLabel : ""}`, `กำลังรอผลถอดเสียงจาก Gemini${chunkLabel ? " " + chunkLabel : ""}`);
  let text = "";
  try {
    const rawText = await transcribeRawTextWithGemini(mediaParts, { signal: controller.signal, chunk: chunkContext });
    // v0.39: no automatic speaker labelling. The raw pass still returns rough
    // "ถาม :/พยาน :" tags; strip them so the user gets plain text (one utterance
    // per line) and presses "ตรวจสอบผู้พูด" themselves when ready.
    text = stripSpeakerLabels(normalizeRawTranscriptLines(rawText));
  } catch (error) {
    // No speech in this chunk is not a failure - it just contributes no text.
    if (!error?.isEmptyTranscription) throw error;
  }
  mediaParts = null;
  segment.status = "ok";
  segment.text = text;
  segment.errorMessage = "";
  rebuildTranscriptDraftFromSegments();
  return { usedGainBoost };
}

function markSegmentFailed(segment, error, fallbackMessage = "ถอดเสียงท่อนนี้ไม่สำเร็จ") {
  segment.status = "failed";
  segment.text = "";
  segment.errorMessage = error?.message || fallbackMessage;
}

// Runs the given segments one at a time (they may come from different audio
// sources). A quota/capacity error stops the run and turns every remaining
// segment into a failed box that can be retried later. Returns a summary.
async function runSegmentQueue(segments, controller, options = {}) {
  let quotaOrCapacityError = null;
  let usedGainBoost = false;
  let recovered = 0;
  let decodedSourceId = null;
  let decodedBuffer = null;
  try {
    for (const segment of segments) {
      throwIfCancelled(controller.signal);
      if (quotaOrCapacityError) {
        markSegmentFailed(segment, { message: quotaSkipMessageForSegment(segment) });
        continue;
      }
      if (isDocumentSegment(segment)) {
        const page = getDocumentPageForSegment(segment);
        if (!page?.blob) {
          markSegmentFailed(segment, { message: "ไม่มีไฟล์รูปต้นฉบับของหน้านี้แล้ว (อาจรีเฟรชหน้าเว็บไป) ต้องนำเข้ารูปหรือ PDF ใหม่" });
          continue;
        }
        try {
          await transcribeSingleDocumentSegment(segment, page, controller);
          recovered += 1;
        } catch (error) {
          if (isCancelError(error)) throw error;
          markSegmentFailed(segment, error, "ถอดข้อความหน้านี้ไม่สำเร็จ");
          if (isQuotaOrCapacityError(error)) quotaOrCapacityError = error;
        }
        rebuildTranscriptDraftFromSegments();
        render();
        continue;
      }
      const source = getAudioSourceForSegment(segment);
      if (!source) {
        markSegmentFailed(segment, { message: "ไม่มีไฟล์เสียงต้นฉบับของท่อนนี้แล้ว (อาจรีเฟรชหน้าเว็บไป) ต้องนำเข้าไฟล์เสียงใหม่" });
        continue;
      }
      // Decode each source once per run (not once per chunk), and drop the
      // decoded audio as soon as we move on to another source.
      if (decodedSourceId !== segment.audioSourceId) {
        decodedBuffer = null;
        decodedSourceId = segment.audioSourceId;
        if (source.plan.canDecode) {
          setProgressAction("กำลังเตรียมไฟล์เสียง", "กำลังเตรียมไฟล์เสียง");
          decodedBuffer = options.initialDecoded?.sourceId === segment.audioSourceId
            ? options.initialDecoded.buffer
            : await decodeAudioSource(source.blob);
          throwIfCancelled(controller.signal);
        }
      }
      try {
        const result = await transcribeSingleSegment(segment, source.blob, source.plan, controller, { decodedBuffer });
        if (result?.usedGainBoost) usedGainBoost = true;
        recovered += 1;
      } catch (error) {
        if (isCancelError(error)) throw error;
        markSegmentFailed(segment, error);
        if (isQuotaOrCapacityError(error)) quotaOrCapacityError = error;
      }
      rebuildTranscriptDraftFromSegments();
      render();
    }
  } finally {
    decodedBuffer = null;
    if (options.initialDecoded) options.initialDecoded.buffer = null;
    failUnfinishedSegments(segments, CANCELLED_SEGMENT_MESSAGE);
    rebuildTranscriptDraftFromSegments();
  }
  return { quotaOrCapacityError, usedGainBoost, recovered };
}

async function transcribeAudioBlob(blob, mimeType) {
  const controller = beginCancelableTask("transcribing", "กำลังตรวจสอบไฟล์เสียง", "กำลังตรวจสอบไฟล์เสียง");
  const audioSourceId = refs.audioSourceId;
  let newSegments = [];
  try {
    setProgressAction("กำลังตรวจสอบความยาวและระดับเสียง", "กำลังเตรียมไฟล์เสียง");
    const initialDecoded = { sourceId: audioSourceId, buffer: await decodeAudioSource(blob) };
    const plan = await planAudioChunks(blob, { decodedBuffer: initialDecoded.buffer });
    throwIfCancelled(controller.signal);
    if (!refs.audioSources) refs.audioSources = new Map();
    refs.audioSources.set(audioSourceId, { blob, plan });

    // Keep earlier text (typed, other files, speaker-reviewed); replace only
    // this source's own segments if it was transcribed before.
    syncFormState();
    const legacyText = Array.isArray(state.transcriptSegments) ? "" : getTranscriptEditorText();
    newSegments = createTranscriptSegmentsFromPlan(plan, audioSourceId);
    state.transcriptSegments = mergeNewSourceSegments(state.transcriptSegments, legacyText, newSegments, audioSourceId);
    pruneUnusedAudioSources(audioSourceId);
    rebuildTranscriptDraftFromSegments();
    state.issueNotice = null;
    state.summaryIssues = [];
    render();

    const result = await runSegmentQueue(newSegments, controller, { initialDecoded });
    const failedHere = newSegments.filter((segment) => segment.status === "failed").length;

    if (result.quotaOrCapacityError) {
      handleGeminiError(result.quotaOrCapacityError, "ถอดเสียงไม่สำเร็จ");
    } else if (!failedHere && !joinOkSegmentTexts(newSegments)) {
      throw new Error("ถอดเสียงไม่สำเร็จ ไม่พบข้อความในไฟล์เสียงนี้เลย ลองไฟล์เสียงอื่นหรือลองใหม่อีกครั้ง");
    } else {
      const notes = [
        plan.usedChunking ? `แบ่งไฟล์เป็น ${newSegments.length} ช่วงก่อนถอดเพื่อความแม่นยำ` : "",
        result.usedGainBoost ? "ปรับความดังของเสียงที่เบาให้ชัดขึ้นก่อนถอด" : "",
        failedHere ? `ถอดไม่สำเร็จ ${failedHere} ท่อน กดถอดท่อนที่พลาดใหม่ได้` : "",
      ].filter(Boolean).join(" · ");
      const label = failedHere === newSegments.length ? "ถอดเสียงไม่สำเร็จ" : failedHere ? "ถอดเสียงสำเร็จบางส่วน" : "ถอดเสียงสำเร็จ";
      state.message = failedHere === newSegments.length
        ? `${label} (${notes})`
        : formatGeminiSuccessMessage(notes ? `${label} (${notes})` : label);
    }
  } catch (error) {
    if (/failed to fetch|networkerror/i.test(String(error?.message || ""))) {
      state.message = "ส่งไฟล์เสียงไป Gemini ไม่สำเร็จ เบราว์เซอร์หรือโฮสต์อาจบล็อกการอัปโหลดไฟล์ใหญ่ ลองใช้ไฟล์เสียงขนาดเล็กลงหรือแปลงเป็น mp3/m4a/wav แล้วลองใหม่";
    } else {
      handleGeminiError(error, "ถอดเสียงไม่สำเร็จ");
    }
  } finally {
    failUnfinishedSegments(newSegments, CANCELLED_SEGMENT_MESSAGE);
    finishCancelableTask(controller);
    state.busy = null;
    rebuildTranscriptDraftFromSegments();
    render();
  }
  await maybeAutoAfterTranscription(newSegments);
}

async function retryTranscriptSegments(segments, labels) {
  syncFormState();
  if (state.busy || !segments.length) return;
  if (!state.apiKey.trim()) {
    state.message = "กรุณาใส่ Gemini API key ก่อนถอดเสียง";
    render();
    return;
  }
  const unit = segmentUnit(segments);
  const retryingLabel = unit === "หน้า" ? "กำลังถอดหน้าที่พลาดใหม่" : "กำลังถอดท่อนที่พลาดใหม่";
  const controller = beginCancelableTask("transcribing", retryingLabel, retryingLabel);
  try {
    const result = await runSegmentQueue(segments, controller);
    const stillFailed = segments.filter((segment) => segment.status === "failed").length;
    if (result.quotaOrCapacityError) {
      handleGeminiError(result.quotaOrCapacityError, labels.fail);
    } else if (stillFailed) {
      const firstError = segments.find((segment) => segment.status === "failed")?.errorMessage || "";
      state.message = `${labels.fail} (สำเร็จ ${segments.length - stillFailed} ${unit} ยังเหลือ ${stillFailed} ${unit})${firstError ? `: ${firstError}` : ""}`;
    } else {
      state.message = formatGeminiSuccessMessage(labels.ok(segments.length));
    }
  } catch (error) {
    handleGeminiError(error, labels.fail);
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    rebuildTranscriptDraftFromSegments();
    render();
  }
  unmarkSpellTargets(segments.map((segment) => segment.id));
  await maybeAutoAfterTranscription(segments);
}

function retryTranscriptSegment(segmentId) {
  const segment = findSegmentById(state.transcriptSegments, segmentId);
  if (!segment || segment.status !== "failed" || segment.unlinked) return;
  const isDoc = isDocumentSegment(segment);
  return retryTranscriptSegments([segment], {
    fail: isDoc ? "ถอดหน้านี้ไม่สำเร็จ" : "ถอดท่อนนี้ไม่สำเร็จ",
    ok: () => isDoc ? `ถอดหน้าที่ ${segment.chunkIndex + 1} สำเร็จ` : `ถอดท่อนที่ ${segment.chunkIndex + 1} สำเร็จ`,
  });
}

function retryAllFailedTranscriptSegments() {
  const failed = getFailedSegments(state.transcriptSegments).filter((segment) => !segment.unlinked);
  const unit = segmentUnit(failed);
  return retryTranscriptSegments(failed, {
    fail: unit === "หน้า" ? "ถอดหน้าที่พลาดใหม่ไม่สำเร็จ" : "ถอดท่อนที่พลาดใหม่ไม่สำเร็จ",
    ok: (count) => unit === "หน้า"
      ? `ถอดหน้าที่พลาดใหม่ครบแล้ว (${count} หน้า)`
      : `ถอดท่อนที่พลาดใหม่ครบแล้ว (${count} ท่อน)`,
  });
}

async function handleAudioFile(file) {
  syncFormState();
  if (!file) return;
  const mimeType = setLatestAudioBlob(file);

  if (needsExternalAudioConversion(file)) {
    state.message = formatExternalAudioConversionMessage(file);
    render();
    return;
  }

  if (!state.apiKey.trim()) {
    state.message = "โหลดไฟล์เสียงแล้ว ใส่ Gemini API key แล้วกดถอดเสียง";
    render();
    return;
  }

  await transcribeAudioBlob(file, mimeType);
}

async function startRecording() {
  syncFormState();
  if (explainBusyBlocksNewSource()) return;

  // Mark busy (and re-render so the "start" button disables) before awaiting
  // the microphone permission prompt, which can take a while - otherwise a
  // second click during that wait starts a second, overlapping recording.
  setBusy("recording", "กำลังขออนุญาตใช้ไมโครโฟน");

  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      state.busy = null;
      state.message = "เบราว์เซอร์นี้ไม่รองรับการอัดเสียงจากไมโครโฟน";
      render();
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    refs.stream = stream;
    hideVisibleDocumentPlayer();
    state.latestSourceKind = "audio";
    state.recordedAudioInfo = "กำลังบันทึกเสียง";
    render();
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    refs.audioChunks = [];
    refs.mediaRecorder = recorder;
    refs.stopRequested = false;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      refs.audioContext = new AudioContextClass();
      refs.analyser = refs.audioContext.createAnalyser();
      refs.analyser.fftSize = 256;
      const source = refs.audioContext.createMediaStreamSource(stream);
      source.connect(refs.analyser);
      const dataArray = new Uint8Array(refs.analyser.frequencyBinCount);
      refs.volumeTimer = window.setInterval(() => {
        if (!refs.analyser) return;
        refs.analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        state.micVolume = Math.min(100, Math.round((average / 128) * 100));
        refreshRecordingMeter();
      }, 250);
    } catch {
      state.micVolume = 0;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) refs.audioChunks.push(event.data);
    };
    recorder.onstop = async () => {
      refs.stopRequested = false;
      clearRecordingMeters();
      stream.getTracks().forEach((track) => track.stop());
      refs.stream = null;
      if (refs.audioContext) {
        refs.audioContext.close().catch(() => {});
        refs.audioContext = null;
      }
      refs.analyser = null;

      const blob = new Blob(refs.audioChunks, { type: recorder.mimeType || mimeType });
      setLatestAudioBlob(blob, { mimeType: blob.type || mimeType });

      if (!state.apiKey.trim()) {
        state.busy = null;
        state.message = "บันทึกเสียงแล้ว ฟังทวนได้ทันที หรือใส่ API key แล้วกดถอดเสียง";
        render();
        return;
      }

      await transcribeAudioBlob(blob, blob.type || mimeType);
    };
    recorder.start();
    state.recordingSeconds = 0;
    refs.recordingTimer = window.setInterval(() => {
      state.recordingSeconds += 1;
      refreshRecordingMeter();
    }, 1000);
    setBusy("recording", "กำลังบันทึกเสียงจากไมโครโฟน");
  } catch (error) {
    clearRecordingMeters();
    refs.stopRequested = false;
    refs.stream?.getTracks().forEach((track) => track.stop());
    refs.stream = null;
    state.busy = null;
    state.message = error?.message || "เปิดไมโครโฟนไม่สำเร็จ";
    render();
  }
}

function stopRecording() {
  if (refs.stopRequested) return;
  if (refs.mediaRecorder && refs.mediaRecorder.state !== "inactive") {
    refs.stopRequested = true;
    state.busy = "stopping";
    state.message = "กำลังหยุดบันทึกเสียง";
    clearRecordingMeters();
    render();
    refs.mediaRecorder.stop();
  }
}

async function transcribeLastAudio() {
  syncFormState();
  if (!refs.lastAudioBlob) {
    state.message = "ยังไม่มีไฟล์เสียงล่าสุดให้ถอด";
    render();
    return;
  }
  if (needsExternalAudioConversion(refs.lastAudioBlob)) {
    state.message = formatExternalAudioConversionMessage(refs.lastAudioBlob);
    render();
    return;
  }
  if (!state.apiKey.trim()) {
    state.message = "กรุณาใส่ Gemini API key ก่อนถอดเสียง";
    render();
    return;
  }
  const mimeType = getAudioMimeType(refs.lastAudioBlob);
  await transcribeAudioBlob(refs.lastAudioBlob, mimeType);
}

function playRecordedAudio() {
  if (!state.recordedAudioUrl) return;
  const playback = ensurePlayback();
  if (!playback) return;
  if (!playback.paused) {
    playback.pause();
    state.isAudioPlaying = false;
    render();
    return;
  }
  playback.play().then(() => {
    state.isAudioPlaying = true;
    state.audioDuration = Number.isFinite(playback.duration) ? playback.duration : state.audioDuration;
    render();
  }).catch(() => {
    state.isAudioPlaying = false;
    state.message = "เล่นไฟล์เสียงไม่สำเร็จ";
    render();
  });
}

async function runSummary() {
  syncFormState();
  if (!hasTranscriptContent()) {
    state.message = "ยังไม่มีข้อความถอดเสียงให้สรุปความ";
    render();
    return;
  }
  const failedCount = getFailedSegments(state.transcriptSegments).length;
  if (failedCount) {
    const failed = getFailedSegments(state.transcriptSegments);
    const unit = segmentUnit(failed);
    const ok = window.confirm(`ยังมี${unit}ที่ถอดไม่สำเร็จ ${failedCount} ${unit} สรุปจากข้อความที่มีอยู่ตอนนี้หรือไม่`);
    if (!ok) return;
  }
  const summaryTranscriptText = getSummaryTranscriptText();

  const controller = beginCancelableTask("summarizing", "กำลังเตรียมสรุปความ", "กำลังเตรียมสรุปความ");
  try {
    state.summaryIssues = [];
    state.dismissedSummaryIssueTexts = [];
    if (!state.apiKey.trim()) {
      state.summary = localFallbackSummary(summaryTranscriptText);
      state.message = "ไม่มี API key จึงสรุปด้วยโหมด local fallback";
    } else {
      setProgressAction("ส่งข้อความถอดเสียงแล้ว กำลังรอ Gemini สรุปความ", "กำลังรอผลสรุปความจาก Gemini");
      const result = await rephraseWithGemini(summaryTranscriptText, { signal: controller.signal });
      throwIfCancelled(controller.signal);
      state.summary = result.summary;
      state.summaryIssues = result.issues;
      state.message = formatGeminiSuccessMessage("สรุปความสำเร็จ");
    }
  } catch (error) {
    handleGeminiError(error, "สรุปความไม่สำเร็จ");
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    render();
  }
}

async function runSpeakerReview() {
  syncFormState();
  if (!hasTranscriptContent()) {
    state.message = "ยังไม่มีข้อความถอดเสียงให้ตรวจสอบผู้พูด";
    render();
    return;
  }
  if (!state.apiKey.trim()) {
    state.message = "กรุณาใส่ Gemini API key ก่อนตรวจสอบผู้พูด";
    render();
    return;
  }
  const targets = getSpeakerReviewTargets();
  if (!targets.length) {
    state.message = "ยังไม่มีข้อความถอดเสียงให้ตรวจสอบผู้พูด";
    render();
    return;
  }
  const packed = wrapSegmentsForReview(targets);
  const controller = beginCancelableTask("reviewing-speakers", "กำลังตรวจสอบผู้ถามและพยาน", "กำลังตรวจสอบป้ายผู้พูด");
  try {
    const reviewedRaw = await reviewTranscriptSpeakers(packed.text, { signal: controller.signal });
    throwIfCancelled(controller.signal);
    const originalText = targets.map((target) => target.text).join("\n\n");
    const appliedRows = applyReviewedTextToRawSegments(targets, reviewedRaw);
    const appliedText = appliedRows.map((item) => item.text).join("\n\n");
    const check = assessAppliedSpeakerReview(originalText, reviewedRaw, appliedText);
    if (check.ok) {
      writeSpeakerReviewToTargets(targets, reviewedRaw, appliedRows);
      state.message = formatGeminiSuccessMessage("ตรวจสอบผู้พูดสำเร็จ");
    } else {
      state.message = `ผลตรวจสอบผู้พูดไม่น่าเชื่อถือ จึงไม่เปลี่ยนแปลงข้อความเดิม: ${check.reason} กดตรวจผู้พูดใหม่ได้`;
    }
  } catch (error) {
    handleGeminiError(error, "ตรวจสอบผู้พูดไม่สำเร็จ");
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    render();
  }
}


function clearSpellState() {
  state.spellFixes = [];
  state.spellChunks = [];
  state.spellCheckedIds = [];
}

function markSpellTargetsChecked(targetIds) {
  const set = new Set(state.spellCheckedIds || []);
  (targetIds || []).forEach((id) => { if (id) set.add(id); });
  state.spellCheckedIds = [...set];
}

function unmarkSpellTargets(targetIds) {
  const drop = new Set(targetIds || []);
  state.spellCheckedIds = (state.spellCheckedIds || []).filter((id) => !drop.has(id));
}

function setAutoSpellcheck(on) {
  state.autoSpellcheck = Boolean(on);
  writeStorage(AUTO_SPELLCHECK_STORAGE_KEY, state.autoSpellcheck ? "1" : "0");
}

function setAutoSpeakerReview(on) {
  state.autoSpeakerReview = Boolean(on);
  writeStorage(AUTO_SPEAKER_REVIEW_STORAGE_KEY, state.autoSpeakerReview ? "1" : "0");
}

function isAutoReflowOn() {
  return Boolean(state.autoReflow?.transcript);
}

function setAutoReflow(on) {
  if (!state.autoReflow) state.autoReflow = { transcript: false };
  state.autoReflow.transcript = Boolean(on);
  writeStorage(AUTO_REFLOW_TRANSCRIPT_STORAGE_KEY, state.autoReflow.transcript ? "1" : "0");
}

function unlabeledOkSegments(segments) {
  return (segments || []).filter((segment) => (
    segment
    && segment.status === "ok"
    && String(segment.text || "").trim()
    && !hasSpeakerLabels(segment.text)
  ));
}

function getSpeakerReviewTargets({ onlyUnlabeled = false } = {}) {
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.some((segment) => segment.status === "ok" && String(segment.text || "").trim())) {
    return state.transcriptSegments
      .filter((segment) => (
        segment.status === "ok"
        && String(segment.text || "").trim()
        && (!onlyUnlabeled || !hasSpeakerLabels(segment.text))
      ))
      .map((segment) => ({ id: segment.id, text: String(segment.text || ""), type: "segment" }));
  }
  const draft = getTranscriptEditorText();
  if (!draft.trim()) return [];
  if (onlyUnlabeled && hasSpeakerLabels(draft)) return [];
  return [{ id: "draft", text: draft, type: "draft" }];
}

function reanchorSpellFixes() {
  const current = state.spellFixes || [];
  if (!current.length) return;
  const kept = [];
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    state.transcriptSegments.forEach((segment) => {
      const marks = current.filter((fix) => fix.targetId === segment.id);
      if (marks.length) kept.push(...locateStoredFixes(String(segment.text || ""), marks));
    });
  } else {
    const draftMarks = current.map((fix) => ({ ...fix, targetId: "draft" }));
    kept.push(...locateStoredFixes(state.transcriptDraft || "", draftMarks));
  }
  state.spellFixes = kept;
}

// Write labels back onto each original segment/draft. Never merges pages
// or drops raw words: the reviewed text only donates ถาม/พยาน prefixes
// and line breaks.
function writeSpeakerReviewToTargets(targets, reviewedText, appliedRows = null) {
  const applied = appliedRows || applyReviewedTextToRawSegments(targets, reviewedText);
  applied.forEach((item) => {
    if (item.id === "draft") {
      state.transcriptDraft = item.text;
      state.turns = [];
      return;
    }
    const segment = findSegmentById(state.transcriptSegments, item.id);
    if (segment) segment.text = item.text;
  });
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    rebuildTranscriptDraftFromSegments();
  }
  reanchorSpellFixes();
  return applied.map((item) => item.id);
}

async function maybeAutoSpeakerReview(segments) {
  if (!state.autoSpeakerReview) return [];
  if (state.busy) return [];
  const targets = getSpeakerReviewTargets({ onlyUnlabeled: true }).filter((target) => (
    !segments?.length || segments.some((segment) => segment.id === target.id)
  ));
  if (!targets.length) return [];
  if (!state.apiKey.trim()) {
    state.message = "เปิดตรวจผู้พูดอัตโนมัติไว้ แต่ยังไม่มี API key";
    render();
    return [];
  }
  const packed = wrapSegmentsForReview(targets);
  if (!packed.text.trim()) return [];
  const controller = beginCancelableTask("reviewing-speakers", "กำลังตรวจสอบผู้ถามและพยาน", "กำลังตรวจสอบป้ายผู้พูด");
  try {
    setProgressAction("กำลังใส่ป้ายผู้พูดอัตโนมัติ", "กำลังรอผลตรวจสอบผู้พูดจาก Gemini");
    const reviewedRaw = await reviewTranscriptSpeakers(packed.text, { signal: controller.signal });
    throwIfCancelled(controller.signal);
    const originalText = targets.map((target) => target.text).join("\n\n");
    const appliedRows = applyReviewedTextToRawSegments(targets, reviewedRaw);
    const appliedText = appliedRows.map((item) => item.text).join("\n\n");
    const check = assessAppliedSpeakerReview(originalText, reviewedRaw, appliedText);
    if (check.ok) {
      const updated = writeSpeakerReviewToTargets(targets, reviewedRaw, appliedRows);
      state.message = formatGeminiSuccessMessage("ตรวจสอบผู้พูดสำเร็จ");
      return updated;
    }
    state.message = `ผลตรวจสอบผู้พูดไม่น่าเชื่อถือ จึงไม่เปลี่ยนแปลงข้อความเดิม: ${check.reason} กดตรวจผู้พูดใหม่ได้`;
    return [];
  } catch (error) {
    handleGeminiError(error, "ตรวจสอบผู้พูดไม่สำเร็จ");
    return [];
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    render();
  }
}

// Auto passes run only after a transcription (or retry) finishes — never
// after typing, pasting, or other manual edits. Typed text always needs a
// manual button press.
//
// Auto order is speaker labels first, then typo-check. Either manual order
// is also correct: typo marks are re-anchored after labeling, and the
// label pass keeps raw words so it cannot undo typo fixes or drop text.
async function maybeAutoAfterTranscription(segments) {
  const source = (segments || []).filter(Boolean);
  const updatedIds = await maybeAutoSpeakerReview(source);
  let typoRan = false;
  if (state.autoSpellcheck) {
    const byId = new Map((state.transcriptSegments || []).map((segment) => [segment.id, segment]));
    const forSpell = [];
    const seen = new Set();
    updatedIds.forEach((id) => {
      if (byId.has(id) && !seen.has(id)) {
        forSpell.push(byId.get(id));
        seen.add(id);
      }
    });
    source.forEach((segment) => {
      if (byId.has(segment.id) && !seen.has(segment.id)) {
        forSpell.push(byId.get(segment.id));
        seen.add(segment.id);
      }
    });
    typoRan = await maybeAutoSpellcheck(forSpell);
  }
  // typo-check itself calls maybeAutoReflow when it finishes; otherwise tidy now.
  if (!typoRan) await maybeAutoReflow();
}

function newlyOkUncheckedIds(segments) {
  const checked = new Set(state.spellCheckedIds || []);
  return (segments || [])
    .filter((segment) => segment && segment.status === "ok" && String(segment.text || "").trim() && !checked.has(segment.id))
    .map((segment) => segment.id);
}

async function maybeAutoSpellcheck(segments) {
  if (!state.autoSpellcheck) return false;
  if (state.busy) return false;
  const ids = newlyOkUncheckedIds(segments);
  if (!ids.length) return false;
  if (!state.apiKey.trim()) {
    state.message = "เปิดตรวจคำผิดอัตโนมัติไว้ แต่ยังไม่มี API key";
    render();
    return false;
  }
  await runSpellcheck({ onlyTargetIds: ids, preserveExistingFixes: true });
  return true;
}

async function maybeAutoReflow() {
  if (!isAutoReflowOn()) return;
  if (state.busy) return;
  if (!hasTranscriptContent()) return;
  if (!state.apiKey.trim()) {
    state.message = "เปิดจัดหน้าอัตโนมัติไว้ แต่ยังไม่มี API key";
    render();
    return;
  }
  await runReflow("transcript");
}


function getSpellTargets() {
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.some((segment) => segment.status === "ok" && String(segment.text || "").trim())) {
    return state.transcriptSegments
      .filter((segment) => segment.status === "ok" && String(segment.text || "").trim())
      .map((segment) => ({ targetId: segment.id, type: "segment", text: String(segment.text || "") }));
  }
  if (state.turns.length) {
    return state.turns.map((turn, index) => ({
      targetId: `turn-${index}`,
      type: "turn",
      turnIndex: index,
      text: String(turn.text || ""),
    }));
  }
  const draft = getTranscriptEditorText();
  return draft.trim() ? [{ targetId: "draft", type: "draft", text: draft }] : [];
}

function readSpellTargetText(target) {
  if (target.type === "segment") {
    const segment = findSegmentById(state.transcriptSegments, target.targetId);
    return segment ? String(segment.text || "") : "";
  }
  if (target.type === "turn") {
    return String(state.turns[target.turnIndex]?.text || "");
  }
  return getTranscriptEditorText();
}

function writeSpellTargetText(target, nextText) {
  if (target.type === "segment") {
    const segment = findSegmentById(state.transcriptSegments, target.targetId);
    if (segment) {
      segment.text = nextText;
      rebuildTranscriptDraftFromSegments();
    }
    return;
  }
  if (target.type === "turn" && state.turns[target.turnIndex]) {
    state.turns[target.turnIndex].text = nextText;
    return;
  }
  state.transcriptDraft = nextText;
}

function buildSpellJobs() {
  const jobs = [];
  getSpellTargets().forEach((target) => {
    const pieces = splitTextIntoSpellChunks(target.text);
    pieces.forEach((piece, index) => {
      jobs.push({
        id: `${target.targetId}#${index}`,
        targetId: target.targetId,
        targetType: target.type,
        turnIndex: target.turnIndex,
        offset: piece.start,
        text: piece.text,
        status: "pending",
        errorMessage: "",
      });
    });
  });
  return jobs;
}

function renderTranscriptHtmlForTarget(text, targetId) {
  const fixes = (state.spellFixes || []).filter((fix) => fix.targetId === targetId);
  return renderTextWithSpellFixes(text, fixes, (part) => renderRawTranscriptText(part));
}

function renderSpellFailureBanner() {
  const failed = (state.spellChunks || []).filter((job) => job.status === "failed");
  if (!failed.length) return "";
  const cancelled = failed.filter((job) => /หยุด/.test(job.errorMessage || "")).length;
  const label = cancelled === failed.length
    ? `หยุดตรวจคำแล้ว ${failed.length} ท่อน`
    : `ตรวจคำผิดไม่สำเร็จ ${failed.length} ท่อน`;
  return `
    <div class="chunk-failure-banner" role="status">
      <span>${label}</span>
      <button class="ghost-button" id="retry-all-failed-spell-chunks" type="button" ${disabledAttr("retry")}>ตรวจใหม่ทุกท่อนที่พลาด</button>
    </div>
  `;
}

function spellButtonLabel() {
  return "ตรวจคำผิด";
}

function canTranscribeNow() {
  if (state.latestSourceKind === "document") return Boolean(refs.docPages.length);
  return Boolean(state.recordedAudioUrl && !needsExternalAudioConversion(refs.lastAudioBlob));
}

// One place decides whether a control is gray/disabled while a task runs.
// The button for the running task stays enabled so a second click can cancel
// it; copy/download/play/fullscreen stay usable; anything that would start
// or clobber a conflicting task is disabled.

const REFLOW_FALLBACK_MODEL = "gemini-3.5-flash-lite";

function transcriptReflowFingerprint() {
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    return state.transcriptSegments.map((segment) => `${segment.id}:${segment.text || ""}`).join("\n");
  }
  return `draft:${state.transcriptDraft || ""}`;
}

function canUndoReflow(panel) {
  const undo = refs.reflowUndo;
  if (!undo || undo.panel !== panel || panel !== "transcript") return false;
  return transcriptReflowFingerprint() === undo.afterFingerprint;
}

function clearReflowUndo(panel) {
  if (!refs.reflowUndo) return;
  if (!panel || refs.reflowUndo.panel === panel) refs.reflowUndo = null;
}

function snapshotSpellFixes() {
  return (state.spellFixes || []).map((fix) => ({ ...fix }));
}

function restoreSpellFixes(snapshotFixes) {
  if (Array.isArray(snapshotFixes)) {
    state.spellFixes = snapshotFixes.map((fix) => ({ ...fix }));
  }
  reanchorSpellFixes();
}

function snapshotTranscriptForReflow() {
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    return {
      kind: "segments",
      segments: state.transcriptSegments.map((segment) => ({ id: segment.id, text: segment.text })),
      draft: state.transcriptDraft,
      spellFixes: snapshotSpellFixes(),
    };
  }
  return { kind: "draft", draft: state.transcriptDraft, spellFixes: snapshotSpellFixes() };
}

function restoreTranscriptReflow(snapshot) {
  if (snapshot?.kind === "segments" && Array.isArray(state.transcriptSegments)) {
    const byId = new Map((snapshot.segments || []).map((item) => [item.id, item.text]));
    state.transcriptSegments.forEach((segment) => {
      if (byId.has(segment.id)) segment.text = byId.get(segment.id);
    });
    rebuildTranscriptDraftFromSegments();
  } else {
    state.transcriptDraft = snapshot?.draft || "";
    state.turns = [];
  }
  restoreSpellFixes(snapshot?.spellFixes);
}

async function callReflowModel(parts, model, signal) {
  const timeoutController = new AbortController();
  const onUserAbort = () => timeoutController.abort();
  const timer = window.setTimeout(() => timeoutController.abort(), REFLOW_TIMEOUT_MS);
  signal?.addEventListener?.("abort", onUserAbort, { once: true });
  try {
    if (signal?.aborted) throw makeCancelError();
    return await callGemini(parts, "text/plain", { signal: timeoutController.signal, model });
  } catch (error) {
    if (signal?.aborted) throw isCancelError(error) ? error : makeCancelError();
    if (error?.isTimeout || timeoutController.signal.aborted) throw makeReflowTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener?.("abort", onUserAbort);
  }
}

async function requestReflowText(text, signal) {
  const preferred = getEffectiveModel();
  const fallback = REFLOW_FALLBACK_MODEL;
  const parts = [{ text: buildReflowPrompt(text) }];
  try {
    return await callReflowModel(parts, preferred, signal);
  } catch (error) {
    if (isCancelError(error) || error?.isTimeout) throw error;
    if (Number(error?.status) === 503 && preferred !== fallback) {
      return await callReflowModel(parts, fallback, signal);
    }
    throw error;
  }
}

function reflowRunTitle(panel) {
  const running = state.busy === "reflowing" && refs.reflowPanel === panel;
  if (running) return "กดเพื่อยกเลิก";
  if (canUndoReflow(panel)) return "กดอีกครั้งเพื่อคืนค่าวรรคตอนเดิม หรือกด Ctrl+Z";
  return "จัดระเบียบวรรคตอนโดยไม่เปลี่ยนคำ";
}

function refreshReflowControlLabels() {
  const button = document.querySelector("#reflow-transcript");
  if (!button) return;
  const label = button.querySelector(".reflow-run-label") || button;
  label.textContent = REFLOW_BUTTON_LABEL;
  button.title = reflowRunTitle("transcript");
}

function renderReflowControl(panel) {
  const autoOn = isAutoReflowOn();
  const running = state.busy === "reflowing" && refs.reflowPanel === "transcript";
  const runId = "reflow-transcript";
  const autoId = "reflow-transcript-auto";
  const runDisabled = disabledAttr(runId);
  const autoDisabled = disabledAttr(autoId);
  const wrapperDisabled = runDisabled ? " is-disabled" : "";
  const busyClass = running ? " is-reflow-busy" : "";
  const autoClass = autoOn ? " is-reflow-on" : "";
  const busy = running ? ' aria-busy="true"' : "";
  return `<div class="ghost-button reflow-toggle${autoClass}${wrapperDisabled}${busyClass}" role="group" aria-label="จัดหน้า"><button type="button" class="reflow-run" id="${runId}" ${runDisabled} title="${reflowRunTitle(panel)}"${busy}><span class="reflow-run-label">${REFLOW_BUTTON_LABEL}</span></button><button type="button" class="reflow-switch" id="${autoId}" aria-pressed="${autoOn ? "true" : "false"}" aria-label="จัดหน้าอัตโนมัติ" title="จัดหน้าอัตโนมัติ" ${autoDisabled}></button></div>`;
}


function finishReflowAttempt(panel, before, result) {
  const changed = Boolean(result?.changed);
  const rejected = Boolean(result?.rejected || result?.reason === "rejected");
  const error = result?.error || null;
  if (changed) {
    refs.reflowUndo = {
      panel,
      before,
      afterFingerprint: transcriptReflowFingerprint(),
    };
    state.message = REFLOW_SUCCESS_MESSAGE;
    return "changed";
  }
  if (rejected) {
    state.message = reflowFailureMessage(error, { rejected: true });
    return "rejected";
  }
  if (!error || result?.reason === "unchanged" || result?.reason === "ok") {
    state.message = "ข้อความจัดหน้าอยู่แล้ว ไม่ต้องเปลี่ยน";
    return "unchanged";
  }
  state.message = reflowFailureMessage(error);
  return "error";
}

function applyReflowKeepingFixes(source, proposed, fixes) {
  const applied = applyLayoutReflow(source, proposed);
  if (!fixes?.length || typographyPreservesFixes(applied.text, fixes)) {
    return applied;
  }
  const local = applyLayoutReflow(source, reflowTextLocally(source));
  if (typographyPreservesFixes(local.text, fixes)) {
    return { ...local, reason: "local-fallback" };
  }
  return { text: source, accepted: false, reason: "rejected" };
}

async function reflowOneText(original, signal, fixes = []) {
  const source = String(original || "");
  if (!source.trim()) return { text: source, changed: false, reason: "empty" };
  let proposed = "";
  try {
    proposed = await requestReflowText(source, signal);
  } catch (error) {
    if (isCancelError(error)) throw error;
    const applied = applyReflowKeepingFixes(source, reflowTextLocally(source), fixes);
    return { text: applied.text, changed: applied.text !== source, reason: applied.accepted || applied.reason === "local-fallback" ? (applied.reason || "local-fallback") : "rejected", error };
  }
  const applied = applyReflowKeepingFixes(source, proposed, fixes);
  return { text: applied.text, changed: applied.text !== source, reason: applied.reason };
}

function undoReflow(panel) {
  const undo = refs.reflowUndo;
  if (panel !== "transcript" || !canUndoReflow(panel) || !undo) return false;
  restoreTranscriptReflow(undo.before);
  clearReflowUndo(panel);
  state.message = "คืนค่าการจัดหน้าแล้ว";
  render();
  return true;
}

function toggleReflow(panel) {
  if (state.busy === "reflowing" && refs.reflowPanel === panel) {
    cancelActiveTask();
    return;
  }
  if (state.busy) return;
  syncFormState();
  if (canUndoReflow(panel)) {
    undoReflow(panel);
    return;
  }
  runReflow(panel);
}

async function runReflow(panel) {
  if (panel !== "transcript") return;
  if (state.busy === "reflowing" && refs.reflowPanel === panel) {
    cancelActiveTask();
    return;
  }
  if (state.busy) return;
  syncFormState();

  if (!hasTranscriptContent()) {
    state.message = "ยังไม่มีข้อความให้จัดหน้า";
    render();
    return;
  }

  const before = snapshotTranscriptForReflow();
  refs.reflowPanel = panel;
  const controller = beginCancelableTask("reflowing", "กำลังจัดหน้า", "กำลังจัดหน้า");
  try {
    if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.some((segment) => segment.status === "ok" && String(segment.text || "").trim())) {
      const targets = state.transcriptSegments.filter((segment) => segment.status === "ok" && String(segment.text || "").trim());
      let changed = 0;
      let rejected = 0;
      let lastError = null;
      for (const segment of targets) {
        throwIfCancelled(controller.signal);
        const result = await reflowOneText(segment.text, controller.signal, (state.spellFixes || []).filter((fix) => fix.targetId === segment.id));
        if (result.changed) {
          segment.text = result.text;
          changed += 1;
        } else if (result.reason === "rejected") {
          rejected += 1;
        }
        if (result.error) lastError = result.error;
      }
      rebuildTranscriptDraftFromSegments();
      reanchorSpellFixes();
      finishReflowAttempt(panel, before, {
        changed: changed > 0,
        rejected: changed === 0 && rejected > 0,
        error: lastError,
        reason: changed ? "ok" : (rejected ? "rejected" : "unchanged"),
      });
    } else {
      const result = await reflowOneText(getTranscriptEditorText(), controller.signal, state.spellFixes || []);
      throwIfCancelled(controller.signal);
      if (result.changed) {
        state.transcriptDraft = result.text;
        state.turns = [];
        reanchorSpellFixes();
      }
      finishReflowAttempt(panel, before, result);
    }
  } catch (error) {
    if (isCancelError(error)) {
      state.message = reflowFailureMessage(error, { rejected: false });
    } else {
      state.message = reflowFailureMessage(error);
    }
  } finally {
    finishCancelableTask(controller);
    refs.reflowPanel = "";
    state.busy = null;
    render();
  }
}

function isControlDisabled(name) {
  const busy = state.busy;
  const isCancelButton = (
    (busy === "transcribing" && name === "transcribe")
    || (busy === "summarizing" && name === "summarize")
    || (busy === "reviewing-speakers" && name === "review-speakers")
    || (busy === SPELL_BUSY && name === "spellcheck")
    || (busy === "recording" && name === "stop-recording")
    || (busy === "reflowing" && name === "reflow-transcript")
  );
  if (isCancelButton) return false;

  const blocked = Boolean(busy);
  switch (name) {
    case "start-recording":
    case "start-camera":
    case "camera-capture":
    case "audio-file":
    case "crop":
    case "retry":
    case "remove-doc-page":
    case "stop-recording":
      return blocked;
    case "transcribe":
      return blocked || !canTranscribeNow();
    case "summarize":
    case "review-speakers":
    case "spellcheck":
      return blocked || !hasTranscriptContent();
    case "clear-transcript":
      return blocked || (!hasTranscriptContent() && !hasClearedTranscript());
    case "clear-summary":
      return blocked || (!String(state.summary || "").trim() && !hasClearedSummary());
    case "copy-transcript":
    case "download-transcript":
      return !hasTranscriptContent();
    case "reflow-transcript":
      return blocked || !hasTranscriptContent();
    case "reflow-transcript-auto":
      return blocked;
    case "copy-summary":
    case "download-summary":
      return !String(state.summary || "").trim();
    case "play-audio":
    case "download-audio":
    case "audio-seek":
      return !state.recordedAudioUrl;
    default:
      return false;
  }
}

function disabledAttr(name) {
  return isControlDisabled(name) ? "disabled" : "";
}

function isSpellButtonDisabled() {
  return isControlDisabled("spellcheck");
}

async function requestSpellCorrections(chunkText, signal) {
  const parts = [{ text: buildSpellcheckPrompt(chunkText) }];
  const preferred = getEffectiveModel();
  const fallback = "gemini-3.5-flash-lite";
  let raw;
  try {
    raw = await callGemini(parts, "application/json", { signal, model: preferred });
  } catch (error) {
    if (Number(error?.status) === 503 && preferred !== fallback) {
      raw = await callGemini(parts, "application/json", { signal, model: fallback });
    } else {
      throw error;
    }
  }
  return parseSpellcheckResponse(raw).corrections;
}

function applyJobCorrections(job, corrections) {
  const target = {
    targetId: job.targetId,
    type: job.targetType,
    turnIndex: job.turnIndex,
  };
  const current = readSpellTargetText(target);
  let sliceStart = current.indexOf(job.text, job.offset);
  if (sliceStart === -1) sliceStart = current.indexOf(job.text);
  if (sliceStart === -1) {
    // The slice may already have been partly edited; try the whole current target.
    const applied = applyCorrectionsToText(current, corrections);
    writeSpellTargetText(target, applied.text);
    return applied.fixes.map((fix, index) => ({
      ...fix,
      id: `${job.id}-${index}-${fix.start}`,
      targetId: job.targetId,
    }));
  }
  const slice = current.slice(sliceStart, sliceStart + job.text.length);
  const applied = applyCorrectionsToText(slice, corrections);
  const next = current.slice(0, sliceStart) + applied.text + current.slice(sliceStart + slice.length);
  writeSpellTargetText(target, next);
  // Keep original slice so a later retry of a different job still finds itself.
  return applied.fixes.map((fix, index) => ({
    ...fix,
    id: `${job.id}-${index}-${fix.start}`,
    targetId: job.targetId,
    start: fix.start + sliceStart,
    end: fix.end + sliceStart,
  }));
}

async function runSpellJobs(jobs, { replaceFixes = false } = {}) {
  syncFormState();
  if (!jobs.length) {
    state.message = "ยังไม่มีข้อความให้ตรวจคำผิด";
    render();
    return;
  }
  if (!state.apiKey.trim()) {
    state.message = "กรุณาใส่ Gemini API key ก่อนตรวจคำผิด";
    render();
    return;
  }
  if (replaceFixes) {
    state.spellFixes = (state.spellFixes || []).filter((fix) => !jobs.some((job) => job.targetId === fix.targetId && job.status !== "ok"));
    // On a fresh run, drop previous marks entirely.
  }
  const controller = beginCancelableTask(SPELL_BUSY, "กำลังตรวจคำผิด", "กำลังตรวจคำผิด");
  try {
    for (let i = 0; i < jobs.length; i += 1) {
      throwIfCancelled(controller.signal);
      const job = jobs[i];
      job.status = "running";
      setProgressAction(`กำลังตรวจคำผิด ท่อนที่ ${i + 1}/${jobs.length}`, "กำลังรอผลตรวจคำผิดจาก Gemini");
      try {
        const corrections = await requestSpellCorrections(job.text, controller.signal);
        throwIfCancelled(controller.signal);
        const fixes = applyJobCorrections(job, corrections);
        job.status = "ok";
        job.errorMessage = "";
        state.spellFixes = [...(state.spellFixes || []), ...fixes];
        render();
      } catch (error) {
        if (isCancelError(error) || controller.signal.aborted || refs.cancelRequested) {
          job.status = "failed";
          job.errorMessage = "หยุดก่อนตรวจท่อนนี้เสร็จ กดตรวจท่อนนี้ใหม่ได้";
          for (let j = i + 1; j < jobs.length; j += 1) {
            if (jobs[j].status === "pending" || jobs[j].status === "running") {
              jobs[j].status = "failed";
              jobs[j].errorMessage = "หยุดก่อนตรวจท่อนนี้เสร็จ กดตรวจท่อนนี้ใหม่ได้";
            }
          }
          state.message = "หยุดการตรวจคำผิดแล้ว";
          break;
        }
        job.status = "failed";
        job.errorMessage = error?.message || "ตรวจคำผิดไม่สำเร็จ";
        handleGeminiError(error, `ตรวจคำผิดไม่สำเร็จ (ท่อนที่ ${i + 1})`);
        // Continue remaining jobs unless quota/capacity — still try? Safer to
        // mark the rest failed on quota so the user can retry later.
        if (isQuotaOrCapacityError(error)) {
          for (let j = i + 1; j < jobs.length; j += 1) {
            jobs[j].status = "failed";
            jobs[j].errorMessage = "โควตาหรือความหนาแน่นของ Gemini หมดก่อนถึงท่อนนี้ กดตรวจท่อนนี้ใหม่ได้เมื่อพร้อม";
          }
          break;
        }
      }
    }
    const allFailed = jobs.every((job) => job.status === "failed");
    const anyOk = jobs.some((job) => job.status === "ok");
    // Count every remaining mark, not just this run, so an auto pass on a
    // new clean segment does not overwrite "แก้คำผิด N คำ" with "ไม่พบคำผิด".
    const totals = {
      highlighted: highlightedFixCount(state.spellFixes),
      whitespace: (state.spellFixes || []).filter((fix) => fix.whitespaceOnly).length,
    };
    if (!refs.cancelRequested && anyOk && !allFailed) {
      state.message = buildSpellResultMessage(totals);
    } else if (!refs.cancelRequested && jobs.every((job) => job.status === "ok")) {
      state.message = buildSpellResultMessage(totals);
    } else if (!refs.cancelRequested && allFailed && !state.message) {
      state.message = "ตรวจคำผิดไม่สำเร็จ";
    }
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    render();
  }
}

async function runSpellcheck(options = {}) {
  syncFormState();
  if (!hasTranscriptContent()) {
    state.message = "ยังไม่มีข้อความให้ตรวจคำผิด";
    render();
    return;
  }
  const onlyIds = Array.isArray(options.onlyTargetIds) ? new Set(options.onlyTargetIds) : null;
  if (!onlyIds) {
    const failedBefore = getFailedSegments(state.transcriptSegments).length;
    if (failedBefore) {
      const failed = getFailedSegments(state.transcriptSegments);
      const unit = segmentUnit(failed);
      const ok = window.confirm(`ยังมี${unit}ที่ถอดไม่สำเร็จ ${failedBefore} ${unit} จะตรวจคำผิดเฉพาะข้อความที่มีอยู่ตอนนี้หรือไม่`);
      if (!ok) return;
    }
  }
  let jobs = buildSpellJobs();
  if (onlyIds) jobs = jobs.filter((job) => onlyIds.has(job.targetId));
  if (!jobs.length) {
    if (onlyIds) return;
    state.message = "ยังไม่มีข้อความให้ตรวจคำผิด";
    render();
    return;
  }
  if (!options.preserveExistingFixes) state.spellFixes = [];
  else state.spellFixes = (state.spellFixes || []).filter((fix) => !jobs.some((job) => job.targetId === fix.targetId));
  state.spellChunks = onlyIds
    ? [...(state.spellChunks || []).filter((job) => !onlyIds.has(job.targetId)), ...jobs]
    : jobs;
  await runSpellJobs(jobs, { replaceFixes: false });
  markSpellTargetsChecked(jobs.filter((job) => job.status === "ok").map((job) => job.targetId));
  if (!refs.cancelRequested) await maybeAutoReflow();
}

async function retryFailedSpellChunks() {
  const failed = (state.spellChunks || []).filter((job) => job.status === "failed");
  if (!failed.length) {
    await runSpellcheck();
    return;
  }
  failed.forEach((job) => {
    job.status = "pending";
    job.errorMessage = "";
  });
  // Drop marks that belonged to these jobs so a successful retry replaces them.
  state.spellFixes = (state.spellFixes || []).filter((fix) => !failed.some((job) => String(fix.id).startsWith(`${job.id}-`)));
  await runSpellJobs(failed, { replaceFixes: false });
  markSpellTargetsChecked(failed.filter((job) => job.status === "ok").map((job) => job.targetId));
  if (!refs.cancelRequested) await maybeAutoReflow();
}

function resolveSpellFixTarget(fix) {
  if (Array.isArray(state.transcriptSegments) && findSegmentById(state.transcriptSegments, fix.targetId)) {
    return { targetId: fix.targetId, type: "segment" };
  }
  if (String(fix.targetId || "").startsWith("turn-")) {
    return { targetId: fix.targetId, type: "turn", turnIndex: Number(String(fix.targetId).slice(5)) };
  }
  return { targetId: "draft", type: "draft" };
}


function syncReflowUndoAfterSpellToggle(fix, nextReverted) {
  const undo = refs.reflowUndo;
  if (!undo || undo.panel !== "transcript" || !undo.before) return;
  const priorFix = { ...fix, reverted: !nextReverted };
  const applyTo = (text) => {
    const result = toggleFixInText(String(text || ""), priorFix);
    return result.found ? result.text : text;
  };
  if (undo.before.kind === "segments") {
    if (Array.isArray(undo.before.segments)) {
      undo.before.segments = undo.before.segments.map((item) => {
        if (fix.targetId && item.id !== fix.targetId && fix.targetId !== "draft") return item;
        return { ...item, text: applyTo(item.text) };
      });
    }
    if (typeof undo.before.draft === "string") undo.before.draft = applyTo(undo.before.draft);
  } else if (typeof undo.before.draft === "string") {
    undo.before.draft = applyTo(undo.before.draft);
  }
  if (Array.isArray(undo.before.spellFixes)) {
    undo.before.spellFixes = undo.before.spellFixes.map((item) => (
      item.id === fix.id ? { ...item, reverted: nextReverted } : item
    ));
  }
  undo.afterFingerprint = transcriptReflowFingerprint();
}

function revertSpellFix(fixId) {
  const fix = (state.spellFixes || []).find((item) => item.id === fixId);
  if (!fix) return false;
  // Read from state (what the mark was rendered from), not a live DOM sync.
  // Clicking toggles between the corrected word and the original typo, but
  // the yellow mark stays so the user can switch back and forth.
  const attempts = [resolveSpellFixTarget(fix)];
  if (attempts[0].type !== "draft") attempts.push({ targetId: "draft", type: "draft" });
  if (Array.isArray(state.transcriptSegments)) {
    state.transcriptSegments.forEach((segment) => {
      if (segment.status === "ok") attempts.push({ targetId: segment.id, type: "segment" });
    });
  }
  let applied = null;
  const seen = new Set();
  for (const target of attempts) {
    const key = `${target.type}:${target.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const current = readSpellTargetText(target);
    const result = toggleFixInText(current, fix);
    if (!result.found) continue;
    writeSpellTargetText({ ...target, turnIndex: target.turnIndex }, result.text);
    applied = result;
    break;
  }
  if (!applied) return false;
  fix.reverted = applied.reverted;
  if (Number.isFinite(applied.start) && Number.isFinite(applied.end)) {
    fix.start = applied.start;
    fix.end = applied.end;
  }
  reanchorSpellFixes();
  syncReflowUndoAfterSpellToggle(fix, applied.reverted);
  render();
  return true;
}

function findSpellFixFromEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    if (node?.classList?.contains("spell-fix") && node.dataset?.spellFixId) return node;
  }
  const x = event.clientX;
  const y = event.clientY;
  if (typeof x !== "number" || typeof y !== "number") return null;
  const top = document.elementFromPoint(x, y);
  const direct = top?.closest?.(".spell-fix");
  if (direct?.dataset?.spellFixId) return direct;
  const range = document.caretRangeFromPoint?.(x, y);
  const caretNode = range?.startContainer;
  const caretEl = caretNode?.nodeType === Node.TEXT_NODE ? caretNode.parentElement : caretNode;
  return caretEl?.closest?.(".spell-fix") || null;
}

function onSpellFixPointerDown(event) {
  if (event.button != null && event.button !== 0) return;
  const mark = findSpellFixFromEvent(event);
  if (!mark) return;
  event.preventDefault();
  event.stopPropagation();
  revertSpellFix(mark.dataset.spellFixId);
}


function pruneSpellFixesFromCurrentText() {
  const current = state.spellFixes || [];
  if (!current.length) return;
  const kept = [];
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    state.transcriptSegments.forEach((segment) => {
      const marks = current.filter((fix) => fix.targetId === segment.id);
      if (!marks.length) return;
      kept.push(...locateStoredFixes(String(segment.text || ""), marks));
    });
  } else if (state.turns.length) {
    state.turns.forEach((turn, index) => {
      const targetId = `turn-${index}`;
      const marks = current.filter((fix) => fix.targetId === targetId);
      if (!marks.length) return;
      kept.push(...locateStoredFixes(String(turn.text || ""), marks));
    });
  } else {
    kept.push(...locateStoredFixes(state.transcriptDraft || "", current.filter((fix) => fix.targetId === "draft")));
  }
  const before = highlightedFixCount(current);
  const after = highlightedFixCount(kept);
  state.spellFixes = kept;
  if (before !== after && /แก้คำผิด|ไม่พบคำผิด|จัดช่องว่าง/.test(state.message || "")) {
    state.message = buildSpellResultMessage({
      highlighted: after,
      whitespace: kept.filter((fix) => fix.whitespaceOnly).length,
    });
    const status = document.querySelector(".panel-status");
    if (status) status.textContent = state.message;
  }
}

function syncFormState() {
  const apiKey = document.querySelector("#api-key");
  const model = document.querySelector("#model");
  const customModel = document.querySelector("#custom-model");
  const dictionary = document.querySelector("#dictionary-text");
  const caseFacts = document.querySelector("#case-facts");
  const caseDocuments = document.querySelector("#case-documents");
  const caseProperNames = document.querySelector("#case-proper-names");
  const transcript = document.querySelector("#transcript-text");
  const summary = document.querySelector("#summary-text");

  if (apiKey) {
    const maskedValue = apiKey.dataset.maskedValue || "";
    if (!(maskedValue && apiKey.value === maskedValue)) {
      state.apiKey = apiKey.value;
    }
  }
  if (model) {
    state.model = model.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
  }
  if (customModel) {
    state.customModel = customModel.value.trim();
    writeStorage(CUSTOM_MODEL_STORAGE_KEY, state.customModel);
  }
  if (dictionary && state.modal !== "dictionary") {
    state.dictionaryText = cleanDictionaryText(dictionary.value);
    writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
  }
  if (caseFacts || caseDocuments || caseProperNames) {
    state.caseInfo = normalizeCaseInfo({
      facts: caseFacts?.value ?? state.caseInfo.facts,
      documents: caseDocuments?.value ?? state.caseInfo.documents,
      properNames: caseProperNames?.value ?? state.caseInfo.properNames,
    });
    writeCaseInfoStorage(state.caseInfo);
  }
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    syncSegmentEditorsFromDom();
  } else if (transcript && state.turns.length === 0) {
    state.transcriptDraft = transcript.innerText;
  }
  if (summary) {
    const nextSummary = "value" in summary ? summary.value : summary.innerText;
    if (nextSummary !== state.summary) state.summary = nextSummary;
  }
  if (state.persistKey) writeStorage(API_KEY_STORAGE_KEY, state.apiKey);
}

function openDictionaryModal() {
  syncFormState();
  state.dictionaryDraft = state.dictionaryText;
  state.copyDictionaryOk = false;
  state.modal = "dictionary";
  render();
}

function saveDictionaryDraftAndClose() {
  const textareaValue = document.querySelector("#dictionary-text")?.value;
  if (textareaValue != null) state.dictionaryDraft = textareaValue;
  state.dictionaryText = cleanDictionaryText(state.dictionaryDraft);
  writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
  state.dictionaryDraft = null;
  state.copyDictionaryOk = false;
  state.modal = "";
  render();
}

function discardDictionaryDraftAndClose() {
  const changed = state.dictionaryDraft !== state.dictionaryText;
  if (changed) {
    const ok = window.confirm("ปิดโดยไม่บันทึกการแก้ไขพจนานุกรมหรือไม่");
    if (!ok) return;
  }
  state.dictionaryDraft = null;
  state.copyDictionaryOk = false;
  state.modal = "";
  render();
}

function resetDictionaryDraft() {
  if (state.modal === "dictionary") {
    state.dictionaryDraft = DEFAULT_DICTIONARY;
  } else {
    state.dictionaryText = DEFAULT_DICTIONARY;
    writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
  }
  render();
}

function renderSettingsModal() {
  if (state.modal !== "settings") return "";
  const savedApiKey = readStorage(API_KEY_STORAGE_KEY, "");
  const apiKeyForDisplay = state.apiKey.trim() || savedApiKey.trim();
  const showApiKeyMask = Boolean(apiKeyForDisplay);
  const apiKeyMask = showApiKeyMask ? getApiKeyMask(apiKeyForDisplay) : "";
  const apiKeyInputValue = showApiKeyMask ? apiKeyMask : "";
  const apiKeyInputClass = showApiKeyMask ? "api-key-input is-saved-key-mask" : "api-key-input";
  return `
    <div class="modal-backdrop" data-close-modal="true">
      <section class="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="modal-head">
          <div>
            <h2>Settings</h2>
            <p>ตั้งค่า Gemini API key และ Gemini model</p>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="settings-form">
          <label>
            <span>Gemini model</span>
            <select id="model">
              ${MODEL_OPTIONS.map((option) => `
                <option value="${escapeHtml(option.value)}" ${(isCustomModelSelection(state.model) ? option.value === "__custom__" : state.model === option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
          </label>
          <label class="custom-model-field ${isCustomModelSelection(state.model) ? "" : "is-hidden"}">
            <span>ชื่อโมเดลกำหนดเอง (Gemini)</span>
            <input id="custom-model" type="text" value="${escapeHtml(state.customModel || "")}" placeholder="เช่น gemini-3.8-flash" autocomplete="off" spellcheck="false">
            <span id="custom-model-status" class="api-key-status">${escapeHtml(state.customModelStatusMessage || "")}</span>
          </label>
          <label>
            <span>Gemini API key</span>
            <input id="api-key" class="${apiKeyInputClass}" type="text" value="${escapeHtml(apiKeyInputValue)}" data-masked-value="${escapeHtml(apiKeyMask)}" placeholder="ใส่ API key ของผู้ใช้" autocomplete="off" autocapitalize="off" autocorrect="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" spellcheck="false">
            <span id="api-key-status" class="api-key-status is-${state.apiKeyStatus || "unknown"}">${escapeHtml(getApiKeyStatusText())}</span>
          </label>
          <label class="checkline">
            <input id="persist-key" type="checkbox" ${state.persistKey ? "checked" : ""}>
            บันทึก API key ใน browser นี้
          </label>
          <div class="settings-actions">
            <div class="settings-key-actions">
              <button class="ghost-button" id="paste-key" type="button" title="วางข้อความจาก Clipboard ลงช่อง API key">วาง API key</button>
              <button class="ghost-button" id="remove-key" type="button" ${state.apiKey.trim() || readStorage(API_KEY_STORAGE_KEY, "") ? "" : "disabled"}>ลบ API key</button>
            </div>
            <button data-close-modal="true" type="button">บันทึกแล้วปิด</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderCaseInfoModal() {
  if (state.modal !== "case-info") return "";
  const info = normalizeCaseInfo(state.caseInfo);
  const canUndoCaseInfoClear = !hasCaseInfoContent(info) && hasClearedCaseInfo();
  return `
    <div class="modal-backdrop" data-close-modal="true">
      <section class="modal case-info-modal" role="dialog" aria-modal="true" aria-label="Case Info">
        <div class="modal-head">
          <div>
            <h2>ข้อมูลคดี</h2>
          </div>
          <div class="modal-actions">
            <button class="ghost-button" id="clear-case-info" type="button" ${hasCaseInfoContent(info) || canUndoCaseInfoClear ? "" : "disabled"}>${canUndoCaseInfoClear ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ"}</button>
            <button class="ghost-button" id="copy-case-info" type="button">${state.copyCaseInfoOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
            <button class="ghost-button" id="download-case-info" type="button">ดาวน์โหลด .txt</button>
            <button data-close-modal="true" type="button">บันทึกแล้วปิด</button>
            <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
          </div>
        </div>
        <div class="case-info-form">
          <label>
            <span>รายละเอียดคดีเบื้องต้น</span>
            <textarea id="case-facts" data-case-info-field="facts" maxlength="900" rows="6" spellcheck="false" placeholder="เช่น ข้อหาหรือฐานความผิด, ข้อต่อสู้, ข้อเท็จจริงที่คู่ความไม่ได้โต้แย้งกัน, ตัวบทกฎหมายที่เกี่ยวข้อง">${escapeHtml(info.facts)}</textarea>
          </label>
          <label>
            <span>เอกสารในสำนวน</span>
            <textarea id="case-documents" data-case-info-field="documents" maxlength="800" rows="4" spellcheck="false" placeholder="เช่น จ.๑ บันทึกจับกุม, จ.๒ รายงานการตรวจพิสูจน์, ล.๑ ภาพถ่ายที่เกิดเหตุ">${escapeHtml(info.documents)}</textarea>
          </label>
          <label>
            <span>ชื่อเฉพาะของบุคคล สิ่งของ หรือสถานที่</span>
            <textarea id="case-proper-names" data-case-info-field="properNames" maxlength="800" rows="2" spellcheck="false" placeholder="เช่น สมศรี ศรีสด ให้ใช้ ศมสี สีสจจ์, สุนัขพันธุ์บูลเทอร์เรียร์, บ้านโคกอีโด่ย">${escapeHtml(info.properNames)}</textarea>
          </label>
        </div>
      </section>
    </div>
  `;
}

function renderDictionaryModal() {
  if (state.modal !== "dictionary") return "";
  const dictionaryValue = state.dictionaryDraft ?? state.dictionaryText;
  return `
    <div class="modal-backdrop" data-discard-dictionary="true">
      <section class="modal dictionary-modal" role="dialog" aria-modal="true" aria-label="Dictionary">
        <div class="modal-head">
          <div>
            <h2>พจนานุกรม</h2>
          </div>
          <div class="modal-actions">
            <button class="ghost-button" id="reset-dictionary" type="button">คืนค่าเริ่มต้น</button>
            <button class="ghost-button" id="copy-dictionary" type="button">${state.copyDictionaryOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
            <button class="ghost-button" id="download-dictionary" type="button">ดาวน์โหลด .txt</button>
            <button id="save-dictionary-close" type="button">บันทึกแล้วปิด</button>
            <button class="icon-close" data-discard-dictionary="true" type="button" aria-label="ปิดแบบไม่บันทึก">×</button>
          </div>
        </div>
        <div class="dictionary-form">
          <textarea id="dictionary-text" spellcheck="false">${escapeHtml(dictionaryValue)}</textarea>
        </div>
      </section>
    </div>
  `;
}

function renderPrivacyModal() {
  if (state.modal !== "privacy") return "";
  return `
    <div class="modal-backdrop" data-close-modal="true">
      <section class="modal privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy and disclaimer">
        <div class="modal-head">
          <div>
            <h2>Privacy & Disclaimer</h2>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="privacy-list">
          <div>
            <span>OmKwam เป็นโครงการทดลองส่วนตัวของผู้พัฒนาเพื่อศึกษาความเป็นไปได้ในการใช้ AI ช่วยงานถอดเสียงและร่างสรุปคำเบิกความ ไม่ใช่ระบบของหน่วยงานใด และไม่สามารถใช้แทนการตรวจทานของมนุษย์ได้ ผู้ใช้ต้องตรวจสอบ แก้ไข และรับผิดชอบต่อการนำผลลัพธ์ไปใช้เองทุกครั้ง</span>
          </div>
          <div>
            <span>แอปพลิเคชันนี้ไม่มีระบบจัดเก็บข้อมูลบนเซิร์ฟเวอร์ (No Backend) และไม่มีการบันทึกข้อมูลใดๆ ของผู้ใช้ โดยทำหน้าที่เป็นเพียงเครื่องมือสำหรับส่งคำขอจากเบราว์เซอร์ของผู้ใช้ไปยัง Gemini โดยตรงผ่าน API Key ที่ผู้ใช้เป็นผู้จัดหาเอง</span>
          </div>
          <div>
            <span>ผู้ใช้มีหน้าที่รับผิดชอบในการเก็บรักษา API Key ของตนให้ปลอดภัย รวมถึงศึกษา ทำความเข้าใจ และปฏิบัติตามเงื่อนไขการใช้งาน นโยบายความเป็นส่วนตัว และนโยบายอื่นๆ ที่เกี่ยวข้องของ Gemini ด้วยตนเอง</span>
          </div>
          <div>
            <span>ผู้พัฒนาจะไม่รับผิดชอบต่อความเสียหาย ค่าใช้จ่าย การสูญหายของข้อมูล ผลลัพธ์จากการประมวลผล หรือผลกระทบใดๆ ที่เกิดขึ้นจากการใช้งานแอปพลิเคชันนี้ ไม่ว่าทางตรงหรือทางอ้อม</span>
          </div>
          <div>
            <span>เพื่อความโปร่งใส แอปพลิเคชันนี้เปิดเผย source code เพื่อให้ตรวจสอบการทำงาน: <a href="https://github.com/nitilink/OmKwam" target="_blank" rel="noopener noreferrer">github.com/nitilink/OmKwam</a></span>
            <span class="privacy-meta">Version: v0.39 · Last updated: 11 Nov 2026, 13:56 ICT</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderContactModal() {
  if (state.modal !== "contact") return "";
  return `
    <div class="modal-backdrop" data-close-modal="true">
      <section class="modal contact-modal" role="dialog" aria-modal="true" aria-label="Contact developer">
        <div class="modal-head">
          <div>
            <h2>Contact Developer</h2>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="contact-body">
          <div class="contact-email-row">
            <strong>Developer</strong>
            <span>Sayan Sajai</span>
          </div>
          <div class="contact-email-row">
            <strong>Email</strong>
            <span>nitilink.app@gmail.com</span>
          </div>
          <div class="openchat-card">
            <div>
              <strong>LINE OpenChat</strong>
            </div>
            <img class="openchat-qr" src="./src/assets/nitilink-openchat-qr.jpg" alt="NitiLink LINE OpenChat QR code">
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderTutorialModal() {
  if (state.modal !== "tutorial") return "";
  return `
    <div class="modal-backdrop" data-close-modal="true">
      <section class="modal tutorial-modal" role="dialog" aria-modal="true" aria-label="Tutorial">
        <div class="modal-head">
          <div>
            <h2>Tutorial</h2>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="privacy-list">
          <div>
            <span>ดาวน์โหลดคู่มือการใช้งาน (ไฟล์ Word):</span>
            <span>
              <a href="./src/assets/OmKwam%20User%20Manual%20v0.38b.docx" download="OmKwam User Manual v0.38b.docx">
                คู่มือการใช้งานแอปพลิเคชันอมความ v0.38b (.docx)
              </a>
            </span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderQuotaModal() {
  if (!state.quotaNotice) return "";
  const isCapacity = state.quotaNotice.kind === "capacity";
  const title = isCapacity ? "โมเดล Gemini มีผู้ใช้งานหนาแน่น" : "โควต้า Gemini หมด";
  const body = isCapacity
    ? "โมเดลนี้กำลังมี demand สูงชั่วคราว จึงยังประมวลผลคำขอไม่ได้ในตอนนี้"
    : "คำขอถูกปฏิเสธเพราะเกินโควต้าหรือ rate limit ของ API key นี้";
  const detailRows = [
    state.quotaNotice.status ? `HTTP status: ${state.quotaNotice.status}` : "",
    state.quotaNotice.retryAfter ? `Retry-After: ${state.quotaNotice.retryAfter}` : "",
    state.quotaNotice.message ? `Gemini message: ${state.quotaNotice.message}` : "",
  ].filter(Boolean);
  return `
    <div class="modal-backdrop quota-backdrop">
      <section class="modal quota-modal" role="alertdialog" aria-modal="true" aria-label="Gemini quota warning">
        <div class="modal-head">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <p>model ปัจจุบัน: ${escapeHtml(getModelLabel(state.quotaNotice.model || state.model || DEFAULT_MODEL))}</p>
          </div>
          <button class="icon-close" id="close-quota-modal" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="quota-body">
          <p>${escapeHtml(body)}</p>
          ${detailRows.length ? `
            <div class="quota-detail">
              ${detailRows.map((row) => `<code>${escapeHtml(row)}</code>`).join("")}
            </div>
          ` : ""}
          <ul>
            <li>เลือก model ใหม่ด้านล่าง แล้วระบบจะส่งคำขอเดิมใหม่ทันที</li>
            <li>พักสักครู่แล้วลองอีกครั้ง หรือรอจนกว่าโควต้าฟรีจะกลับมาใหม่</li>
            ${isCapacity ? "" : "<li>เปิด billing / ใช้ API แบบชำระเงิน ถ้าต้องใช้งานต่อเนื่อง</li>"}
          </ul>
          <label class="quota-model-row">
            <span>เลือก Gemini model</span>
            <select id="quota-model">
              ${MODEL_OPTIONS.map((option) => `
                <option value="${escapeHtml(option.value)}" ${state.model === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
          </label>
          <div class="quota-actions">
            <button id="quota-retry" type="button">ลองใหม่</button>
            <button class="ghost-button" id="quota-close" type="button">รับทราบ</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function getPanelStatus() {
  if (state.busy === "recording") return { tone: "processing", text: state.message || "กำลังบันทึกเสียงจากไมโครโฟน" };
  if (state.busy === "stopping") return { tone: "processing", text: state.message || "กำลังหยุดบันทึกเสียง" };
  if (state.busy === "transcribing") return { tone: "processing", text: state.message || "กำลังถอดเสียง" };
  if (state.busy === "summarizing") return { tone: "processing", text: state.message || "กำลังสรุปคำเบิกความ" };
  if (state.busy === "reviewing-speakers") return { tone: "processing", text: state.message || "กำลังตรวจสอบผู้พูด" };
  if (state.busy === SPELL_BUSY) return { tone: "processing", text: state.message || "กำลังตรวจคำผิด" };
  if (state.busy === "reflowing") return { tone: "processing", text: state.message || "กำลังจัดหน้า" };
  if (!state.message) return null;
  if (/ไม่สำเร็จ|ไม่น่าเชื่อถือ|ไม่เปลี่ยนแปลง|error|กรุณา|ยังไม่มี|ไม่รองรับ|ไม่ได้|ไม่พบ/.test(state.message)) return { tone: "warning", text: state.message };
  if (/สำเร็จ|พร้อม|โหลด|บันทึก/.test(state.message)) return { tone: "success", text: state.message };
  return { tone: "info", text: state.message };
}

function getStatusPulseClass(status) {
  if (status?.tone === "processing") return "is-pulsing";
  if (status?.tone !== "success") {
    refs.successPulseText = "";
    return "";
  }
  const text = String(status.text || "");
  const now = Date.now();
  if (text && text !== refs.successPulseText) {
    refs.successPulseText = text;
    refs.successPulseUntil = now + 2200;
    if (refs.successPulseTimer) window.clearTimeout(refs.successPulseTimer);
    refs.successPulseTimer = window.setTimeout(() => {
      refs.successPulseTimer = null;
      refs.successPulseUntil = 0;
      render();
    }, 2300);
  }
  return refs.successPulseUntil > now ? "is-pulsing" : "";
}

function renderPanelStatus() {
  const status = getPanelStatus() || { tone: "idle", text: "พร้อมทำงาน" };
  return `<div class="panel-status ${status.tone} ${getStatusPulseClass(status)}"><span>${escapeHtml(status.text)}</span></div>`;
}

function shouldFlashForStatus(status) {
  if (!status) return false;
  if (status.tone === "warning") return true;
  if (status.tone !== "success") return false;
  return /ถอดเสียงสำเร็จ|สรุปความสำเร็จ|บันทึกเสียงแล้ว/.test(status.text);
}

function stopTitleFlash() {
  const hadFlash = Boolean(refs.titleFlashTimer || refs.titleFlashOn);
  if (refs.titleFlashTimer) {
    window.clearInterval(refs.titleFlashTimer);
    refs.titleFlashTimer = null;
  }
  refs.titleFlashOn = false;
  if (hadFlash && refs.lastTitleAlert) refs.acknowledgedTitleAlert = refs.lastTitleAlert;
  document.title = refs.originalTitle;
}

function startTitleFlash(alertText) {
  const cleanText = String(alertText || "").trim();
  if (cleanText && cleanText === refs.acknowledgedTitleAlert) return;
  if (!cleanText || refs.lastTitleAlert === cleanText && refs.titleFlashTimer) return;
  refs.lastTitleAlert = cleanText;
  refs.titleFlashOn = false;
  if (!refs.titleFlashTimer) {
    refs.titleFlashTimer = window.setInterval(() => {
      refs.titleFlashOn = !refs.titleFlashOn;
      document.title = refs.titleFlashOn ? "● NitiLink แจ้งเตือน" : refs.originalTitle;
    }, 850);
  }
  document.title = "● NitiLink แจ้งเตือน";
}

function updateAwayAlert() {
  if (!document.hidden && document.hasFocus()) {
    const visibleStatus = getPanelStatus();
    if (state.quotaNotice) refs.acknowledgedTitleAlert = "Gemini error";
    if (shouldFlashForStatus(visibleStatus)) refs.acknowledgedTitleAlert = visibleStatus.text;
    stopTitleFlash();
    return;
  }

  if (state.quotaNotice) {
    startTitleFlash("Gemini error");
    return;
  }

  const status = getPanelStatus();
  if (shouldFlashForStatus(status)) {
    startTitleFlash(status.text);
  }
}


function renderFailedChunkBanner() {
  const failed = getFailedSegments(state.transcriptSegments);
  if (!failed.length) return "";
  const unit = segmentUnit(failed);
  const cancelledCount = failed.filter(isCancelledSegment).length;
  const label = cancelledCount === failed.length
    ? `หยุดแล้ว ${failed.length} ${unit}`
    : cancelledCount
      ? `ยังมี ${failed.length} ${unit}ที่ยังไม่เสร็จ (หยุด ${cancelledCount})`
      : `ถอดไม่สำเร็จ ${failed.length} ${unit}`;
  const retryAllLabel = unit === "หน้า" ? "ถอดใหม่ทุกหน้าที่พลาด" : "ถอดใหม่ทุกท่อนที่พลาด";
  return `
    <div class="chunk-failure-banner" role="status">
      <span>${label}</span>
      <button class="ghost-button" id="retry-all-failed-chunks" type="button" ${disabledAttr("retry")}>${retryAllLabel}</button>
    </div>
  `;
}

function renderTranscriptSegmentBlock(segment) {
  const range = formatChunkRangeLabel(segment.startSeconds, segment.endSeconds);
  const title = isDocumentSegment(segment)
    ? formatDocumentPageLabel(segment)
    : `ท่อนที่ ${segment.chunkIndex + 1}${segment.endSeconds > 0 ? ` (${range})` : ""}`;
  const retryLabel = isDocumentSegment(segment) ? "ถอดหน้านี้ใหม่" : "ถอดท่อนนี้ใหม่";
  if (segment.status === "failed") {
    const errTip = escapeHtml(segment.errorMessage || (isDocumentSegment(segment) ? "ถอดข้อความหน้านี้ไม่สำเร็จ" : "ถอดเสียงท่อนนี้ไม่สำเร็จ"));
    const statusWord = isCancelledSegment(segment) ? "หยุดแล้ว" : "ถอดไม่สำเร็จ";
    return `
      <div class="chunk-failed-box" data-segment-id="${escapeHtml(segment.id)}" title="${errTip}">
        <div class="chunk-failed-head">
          <strong>${escapeHtml(title)} ${statusWord}</strong>
          <button class="ghost-button retry-chunk-button" type="button" data-retry-segment="${escapeHtml(segment.id)}" ${disabledAttr("retry")}>${retryLabel}</button>
        </div>
      </div>
    `;
  }
  if (segment.status === "transcribing") {
    return `<div class="chunk-status-box is-transcribing" data-segment-id="${escapeHtml(segment.id)}">กำลังถอด${escapeHtml(title)}...</div>`;
  }
  if (segment.status === "pending") {
    return `<div class="chunk-status-box is-pending" data-segment-id="${escapeHtml(segment.id)}">รอถอด${escapeHtml(title)}</div>`;
  }
  const body = renderTranscriptHtmlForTarget(segment.text || "", segment.id);
  // No "ท่อนที่ N (mm:ss–mm:ss)" label on successful chunks - keeps select/copy
  // clean and reads as one continuous transcript. Time info stays on the slim
  // failed / pending / in-progress rows only.
  return `
    <div class="chunk-ok-box" data-segment-id="${escapeHtml(segment.id)}">
      <div class="transcript-editor chunk-segment-editor ${String(segment.text || "").trim() ? "" : "is-empty"}" contenteditable="plaintext-only" spellcheck="false" data-segment-id="${escapeHtml(segment.id)}" data-placeholder="ข้อความท่อนนี้">${body}</div>
    </div>
  `;
}

function renderTranscriptBodyHtml(transcriptText) {
  if (state.turns.length) {
    return state.turns.map((turn, index) => `
      <div class="turn-line ${turn.speaker === "ถาม" ? "is-question" : "is-witness"}" data-index="${index}"><span class="turn-time">[${escapeHtml(formatTurnTime(turn, index))}]</span><span class="turn-speaker-label ${turn.speaker === "ถาม" ? "speaker-question" : "speaker-witness"}">${escapeHtml(turn.speaker)} :</span><span class="turn-line-text" contenteditable="plaintext-only" spellcheck="false" data-index="${index}">${renderTurnWords(turn, index)}</span></div>
    `).join("") + renderSpellFailureBanner();
  }
  if (Array.isArray(state.transcriptSegments) && state.transcriptSegments.length) {
    return `
      ${renderFailedChunkBanner()}
      ${renderSpellFailureBanner()}
      <div id="transcript-segments" class="transcript-segments">
        ${state.transcriptSegments.map(renderTranscriptSegmentBlock).join("")}
      </div>
    `;
  }
  return `${renderSpellFailureBanner()}<div id="transcript-text" class="transcript-editor ${transcriptText.trim() ? "" : "is-empty"}" contenteditable="plaintext-only" spellcheck="false" data-placeholder="ผลลัพธ์การถอดเสียงหรือรูปภาพจะแสดงที่นี่ หรือสามารถพิมพ์ข้อความได้">${renderTranscriptHtmlForTarget(transcriptText, "draft")}</div>`;
}

function renderWorkTab() {
  const transcriptText = getTranscriptEditorText();
  const hasTranscript = hasTranscriptContent();
  const canUndoTranscriptClear = !hasTranscript && hasClearedTranscript();
  const canUndoSummaryClear = !state.summary && hasClearedSummary();
  const latestAudioNeedsConversion = state.recordedAudioUrl && needsExternalAudioConversion(refs.lastAudioBlob);
  const isDocumentSource = state.latestSourceKind === "document";
  const latestAudioStatus = state.recordedAudioUrl
    ? latestAudioNeedsConversion
      ? "ไม่รองรับไฟล์นี้"
      : "พร้อมสำหรับการถอดเสียง"
    : "ยังไม่มีไฟล์";
  const latestDocumentStatus = formatDocumentBatchStatus();
  const canTranscribeLatestAudio = Boolean(state.recordedAudioUrl && !state.busy && !latestAudioNeedsConversion);
  const canTranscribeLatestDocument = Boolean(isDocumentSource && refs.docPages.length && !state.busy);
  const canTranscribeLatest = isDocumentSource ? canTranscribeLatestDocument : canTranscribeLatestAudio;
  const transcribeIdleLabel = isDocumentSource || !state.recordedAudioUrl && !refs.docPages.length ? "ถอดข้อความ" : (isDocumentSource ? "ถอดข้อความ" : "ถอดเสียง");
  const transcribeBusyLabel = isDocumentSource ? "หยุดถอดข้อความ" : "หยุดถอดเสียง";
  const transcribeButtonLabel = state.busy === "transcribing" ? transcribeBusyLabel : (isDocumentSource ? "ถอดข้อความ" : (state.latestSourceKind === "audio" ? "ถอดเสียง" : "ถอดข้อความ"));
  const speakerButtonLabel = hasSpeakerLabels(transcriptText) ? "ลบผู้พูด" : "ตรวจผู้พูด";
  const speakerButtonHint = state.busy === "reviewing-speakers"
    ? 'aria-busy="true" title="กดเพื่อยกเลิก"'
    : (hasSpeakerLabels(transcriptText) ? 'title="ลบป้ายผู้พูด" aria-label="ลบป้ายผู้พูด"' : "");
  const turnHtml = renderTranscriptBodyHtml(transcriptText);

  return `
    <section class="audio-deck">
      <div class="audio-grid">
        <div class="audio-card record-card ${state.busy === "recording" ? "is-recording" : ""}">
          <div class="audio-card-text">
            <h2>บันทึกจากแอป</h2>
            <p>กดบันทึกเสียง แล้วพูดใส่ไมโครโฟนได้ทันที</p>
            ${state.busy === "recording" ? `
              <div class="meter-box">
                <div class="meter-row">
                  <span class="record-dot"></span>
                  <strong>กำลังบันทึก ${formatRecordingTime(state.recordingSeconds)}</strong>
                  <span>ระดับเสียง ${state.micVolume}%</span>
                </div>
                <div class="meter-bars">
                  ${Array.from({ length: 15 }).map((_, index) => {
                    const threshold = Math.round((index / 15) * 100);
                    return `<span class="${state.micVolume >= threshold ? "on" : ""}"></span>`;
                  }).join("")}
                </div>
              </div>
            ` : ""}
          </div>
          <div class="audio-actions">
            ${state.busy === "recording"
              ? `<button class="danger" id="stop-recording">หยุดบันทึก</button>`
              : state.busy === "stopping"
                ? `<button class="danger" disabled>กำลังหยุด...</button>`
              : `<button class="record-button" id="start-recording" ${disabledAttr("start-recording")}>บันทึกเสียง</button>
              <button class="ghost-button" id="start-camera" type="button" ${disabledAttr("start-camera")}>ถ่ายภาพ</button>
              <input id="camera-capture" type="file" accept="image/*" capture="environment" ${disabledAttr("camera-capture")}>`}
          </div>
        </div>

        <div class="audio-card import-card" id="audio-drop-zone">
          <div class="audio-card-text">
            <h2>นำเข้าเสียงหรือรูปภาพ</h2>
            <p>ลากไฟล์เสียง รูปภาพ หรือ PDF มาวางที่นี่ หรือเลือกไฟล์จากเครื่อง</p>
          </div>
          <div class="audio-actions">
            <label class="file-button" for="audio-file">
              เลือกไฟล์
              <input id="audio-file" type="file" multiple ${disabledAttr("audio-file")}>
            </label>
            <button class="ghost-button" id="transcribe-last-audio" type="button" ${disabledAttr("transcribe")}>${transcribeButtonLabel}</button>
          </div>
        </div>

        <div class="audio-card player-card ${isDocumentSource ? "is-document" : (state.recordedAudioUrl ? "" : "is-empty")}">
          ${isDocumentSource ? `
          <div class="audio-card-text">
            <div class="latest-audio">
              <span class="latest-title">ไฟล์รูปภาพ</span>
              <strong title="${escapeHtml(latestDocumentStatus)}">${escapeHtml(latestDocumentStatus)}</strong>
            </div>
            ${renderDocumentFilmstrip()}
          </div>
          ` : state.recordedAudioUrl ? `
          <div class="audio-card-text">
            <div class="latest-audio">
              <span class="latest-title">ไฟล์เสียง</span>
              <strong title="${escapeHtml(state.recordedAudioInfo || "พร้อมสำหรับการถอดเสียง")}">${escapeHtml(latestAudioStatus)}</strong>
            </div>
            <div class="audio-player">
              <span id="audio-current-time">${formatAudioTime(state.audioCurrentTime)}</span>
              <div class="audio-seek-wrap">
                ${renderAudioSeekMarkers()}
                <input id="audio-seek" type="range" min="0" max="${Math.max(0, state.audioDuration || 0)}" value="${Math.min(state.audioCurrentTime || 0, state.audioDuration || state.audioCurrentTime || 0)}" ${disabledAttr("audio-seek")}>
              </div>
              <span id="audio-duration">${formatAudioTime(state.audioDuration)}</span>
            </div>
          </div>
          <div class="audio-actions">
            <button class="ghost-button" id="play-audio" type="button" ${disabledAttr("play-audio")}>${state.isAudioPlaying ? "หยุดเสียง" : "เล่นเสียง"}</button>
            <button class="ghost-button" id="download-audio" type="button" ${disabledAttr("download-audio")}>บันทึกเสียง</button>
          </div>
          ` : `
          <div class="audio-card-text">
            <div class="latest-audio">
              <span class="latest-title">รายละเอียดไฟล์</span>
              <strong title="ยังไม่มีไฟล์">ยังไม่มีไฟล์</strong>
            </div>
            <p class="source-empty-hint">ไฟล์เสียงหรือรูปภาพจะแสดงและจัดการได้ที่นี่</p>
          </div>
          `}
        </div>
      </div>
    </section>

    ${renderPanelStatus()}
    ${renderDocumentPreviewOverlay()}

    <div class="workspace">
      <section class="panel transcript-panel ${state.fullscreenPanel === "transcript" ? "is-fullscreen" : ""}">
        <div class="panel-head">
          <div>
            <h2>ถอดเสียงหรือรูปภาพ</h2>
          </div>
          <div class="panel-head-actions">
            <div class="head-auto-control ${state.autoSpeakerReview ? "is-auto-on" : ""}">
              <button class="ghost-button" id="review-speakers" type="button" ${disabledAttr("review-speakers")} ${speakerButtonHint}>${speakerButtonLabel}</button>
              <button type="button" class="head-auto-toggle" id="review-speakers-auto" aria-pressed="${state.autoSpeakerReview ? "true" : "false"}" aria-label="ตรวจผู้พูดอัตโนมัติหลังถอดข้อความ" title="ตรวจผู้พูดอัตโนมัติหลังถอดข้อความ">
                <span class="head-auto-switch" aria-hidden="true"></span>
              </button>
            </div>
            <div class="head-auto-control ${state.autoSpellcheck ? "is-auto-on" : ""}">
              <button class="summarize-head-button" id="spellcheck" type="button" ${disabledAttr("spellcheck")} ${state.busy === SPELL_BUSY ? 'aria-busy="true" title="กดเพื่อยกเลิก"' : ""}>${spellButtonLabel()}</button>
              <button type="button" class="head-auto-toggle" id="spellcheck-auto" aria-pressed="${state.autoSpellcheck ? "true" : "false"}" aria-label="ตรวจคำผิดอัตโนมัติหลังถอดข้อความ" title="ตรวจคำผิดอัตโนมัติหลังถอดข้อความ">
                <span class="head-auto-switch" aria-hidden="true"></span>
              </button>
            </div>
            <button class="summarize-head-button" id="summarize" type="button" ${disabledAttr("summarize")} ${state.busy === "summarizing" ? 'aria-busy="true" title="กดเพื่อยกเลิก"' : ""}>สรุปความ</button>
            <button class="ghost-button fullscreen-action" type="button" data-fullscreen-panel="transcript" aria-label="ขยายเต็มจอ">⤢</button>
          </div>
        </div>
        <div class="turn-list">${turnHtml}</div>
        <div class="button-row bottom-actions mini-actions">
          <button class="ghost-button" id="copy-transcript" type="button" ${disabledAttr("copy-transcript")}>${state.copyTranscriptOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          ${renderReflowControl("transcript")}
          <button class="ghost-button" id="download-transcript" type="button" ${disabledAttr("download-transcript")}>ดาวน์โหลด .txt</button>
          <button class="ghost-button" id="clear-transcript" type="button" ${disabledAttr("clear-transcript")}>${canUndoTranscriptClear ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ"}</button>
        </div>
      </section>

      <section class="panel summary-panel ${state.fullscreenPanel === "summary" ? "is-fullscreen" : ""}">
        <div class="panel-head">
          <div>
            <h2>สรุปคำเบิกความ</h2>
          </div>
          <div class="panel-head-actions">
            <button class="ghost-button fullscreen-action" type="button" data-fullscreen-panel="summary" aria-label="ขยายเต็มจอ">⤢</button>
          </div>
        </div>
        <div id="summary-text" class="summary-output ${state.summary.trim() ? "" : "is-empty"}" contenteditable="plaintext-only" spellcheck="false" data-placeholder="ผลลัพธ์การสรุปความจะแสดงที่นี่">${renderSummaryText()}</div>
        <div class="button-row bottom-actions mini-actions">
          <button class="ghost-button" id="copy-summary" type="button" ${disabledAttr("copy-summary")}>${state.copyOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          <button class="ghost-button" id="download-summary" type="button" ${disabledAttr("download-summary")}>ดาวน์โหลด .txt</button>
          <button class="ghost-button" id="clear-summary" type="button" ${disabledAttr("clear-summary")}>${canUndoSummaryClear ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ"}</button>
        </div>
      </section>
    </div>
  `;
}

function render() {
  const scrollPositions = captureScrollPositions();
  document.querySelector("#root").innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"><img src="./src/assets/nitilink-logo.png" alt="OmKwam"></div>
          <div>
            <h1>OmKwam</h1>
            <p>A privacy-first workspace for testimony transcription · by NitiLink</p>
          </div>
        </div>
        <nav class="header-actions" aria-label="App actions">
          <span class="status-pill ${getApiKeyPillClass()}">${getApiKeyPillText()}</span>
          <label class="model-pill-label" aria-label="Gemini model">
            <span>Model</span>
            <select id="quick-model" class="model-pill">
              ${MODEL_OPTIONS.map((option) => `
                <option value="${escapeHtml(option.value)}" ${(isCustomModelSelection(state.model) ? option.value === "__custom__" : state.model === option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
          </label>
          <button id="open-settings" type="button">Settings</button>
          <button id="open-case-info" type="button">Case Info</button>
          <button id="open-dictionary" type="button">Dictionary</button>
        </nav>
      </header>
      <main>
        ${renderWorkTab()}
      </main>
      <footer class="app-footer">
        <span>Free for personal and public-interest use. Commercial use is prohibited.</span>
        <span>Developed by <button id="open-contact" class="footer-link" type="button">NitiLink</button> · <button id="open-tutorial" class="footer-link" type="button">Tutorial</button> · <button id="open-privacy" class="footer-link" type="button">Privacy & Disclaimer</button></span>
      </footer>
      ${renderIssueNotice()}
      ${renderSettingsModal()}
      ${renderCaseInfoModal()}
      ${renderDictionaryModal()}
      ${renderPrivacyModal()}
      ${renderContactModal()}
      ${renderTutorialModal()}
      ${renderQuotaModal()}
    </div>
  `;
  bindEvents();
  restoreScrollPositions(scrollPositions);
  updateAwayAlert();
}

function bindEvents() {
  document.querySelector("#open-settings")?.addEventListener("click", () => {
    syncFormState();
    state.modal = "settings";
    render();
  });
  document.querySelector("#open-case-info")?.addEventListener("click", () => {
    syncFormState();
    state.copyCaseInfoOk = false;
    state.modal = "case-info";
    render();
  });
  document.querySelector("#open-dictionary")?.addEventListener("click", () => {
    openDictionaryModal();
  });
  document.querySelector("#open-privacy")?.addEventListener("click", () => {
    syncFormState();
    state.modal = "privacy";
    render();
  });
  document.querySelector("#open-contact")?.addEventListener("click", () => {
    syncFormState();
    state.modal = "contact";
    render();
  });
  document.querySelector("#open-tutorial")?.addEventListener("click", () => {
    syncFormState();
    state.modal = "tutorial";
    render();
  });
  document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.currentTarget !== event.target && event.currentTarget.classList.contains("modal-backdrop")) return;
      syncFormState();
      state.modal = "";
      render();
    });
  });
  document.querySelectorAll("[data-discard-dictionary]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.currentTarget !== event.target && event.currentTarget.classList.contains("modal-backdrop")) return;
      discardDictionaryDraftAndClose();
    });
  });

  document.querySelector("#api-key")?.addEventListener("input", (event) => {
    const maskedValue = event.target.dataset.maskedValue || "";
    if (maskedValue && event.target.value === maskedValue) return;
    event.target.dataset.maskedValue = "";
    event.target.classList.remove("is-saved-key-mask");
    state.apiKey = event.target.value;
    if (state.persistKey) writeStorage(API_KEY_STORAGE_KEY, state.apiKey);
    document.querySelector("#remove-key")?.toggleAttribute("disabled", !state.apiKey.trim() && !readStorage(API_KEY_STORAGE_KEY, ""));
    checkApiKey({ debounce: true });
  });
  document.querySelector("#api-key")?.addEventListener("focus", (event) => {
    if (event.target.dataset.maskedValue && event.target.value === event.target.dataset.maskedValue) {
      event.target.select();
    }
  });
  document.querySelector("#api-key")?.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
      prepareApiKeyInputForEditing(event.currentTarget);
    }
  });
  document.querySelector("#api-key")?.addEventListener("paste", (event) => {
    const input = event.currentTarget;
    prepareApiKeyInputForEditing(input);
    window.setTimeout(() => {
      const pastedValue = input.value.trim();
      if (!pastedValue || pastedValue === input.dataset.maskedValue) return;
      state.apiKey = pastedValue;
      if (state.persistKey) writeStorage(API_KEY_STORAGE_KEY, state.apiKey);
      document.querySelector("#remove-key")?.toggleAttribute("disabled", !state.apiKey.trim() && !readStorage(API_KEY_STORAGE_KEY, ""));
      maskApiKeyInput(input, state.apiKey);
      checkApiKey(); // pasted whole key - no reason to wait out the debounce
    }, 0);
  });
  document.querySelector("#model")?.addEventListener("change", (event) => {
    state.model = event.target.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
    if (!isCustomModelSelection(state.model)) {
      state.customModelStatusMessage = "";
    }
    render();
    if (state.apiKey.trim() && isCustomModelSelection(state.model)) checkApiKey();
  });
  document.querySelector("#custom-model")?.addEventListener("input", (event) => {
    state.customModel = event.target.value.trim();
    writeStorage(CUSTOM_MODEL_STORAGE_KEY, state.customModel);
    if (state.apiKey.trim()) checkApiKey({ debounce: true });
  });
  document.querySelector("#quick-model")?.addEventListener("change", (event) => {
    syncFormState();
    state.model = event.target.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
    if (isCustomModelSelection(state.model) && !String(state.customModel || "").trim()) {
      state.modal = "settings";
      state.message = "เลือกโมเดลกำหนดเองแล้ว กรุณาพิมพ์ชื่อโมเดล Gemini ในช่อง \"ชื่อโมเดลกำหนดเอง\"";
    } else {
      state.message = `เปลี่ยน Gemini model เป็น ${getModelLabel()} แล้ว`;
    }
    render();
  });
  document.querySelector("#persist-key")?.addEventListener("change", (event) => {
    syncFormState();
    state.persistKey = event.target.checked;
    if (state.persistKey) writeStorage(API_KEY_STORAGE_KEY, state.apiKey);
    else removeStorage(API_KEY_STORAGE_KEY);
    render();
  });
  document.querySelector("#paste-key")?.addEventListener("click", async () => {
    const input = document.querySelector("#api-key");
    try {
      const pasted = await pasteClipboardIntoApiKeyInput(input);
      if (pasted) return;
    } catch {
      // Browser clipboard permission can require a native paste confirmation.
    }
    focusApiKeyInputForPaste(input);
  });
  document.querySelector("#remove-key")?.addEventListener("click", () => {
    removeStorage(API_KEY_STORAGE_KEY);
    state.apiKey = "";
    state.persistKey = false;
    window.clearTimeout(refs.apiKeyCheckTimer);
    refs.apiKeyCheckToken += 1; // discard any verdict still in flight
    state.apiKeyStatus = "";
    state.apiKeyStatusMessage = "";
    state.message = "ลบ API key ที่เก็บไว้ในเบราว์เซอร์นี้แล้ว";
    render();
  });
  document.querySelector("#retry-all-failed-chunks")?.addEventListener("click", () => {
    retryAllFailedTranscriptSegments();
  });
  document.querySelectorAll("[data-retry-segment]").forEach((button) => {
    button.addEventListener("click", () => {
      retryTranscriptSegment(button.dataset.retrySegment);
    });
  });
  document.querySelectorAll(".chunk-segment-editor[data-segment-id]").forEach((element) => {
    element.addEventListener("input", () => {
      const segment = findSegmentById(state.transcriptSegments, element.dataset.segmentId);
      if (!segment || segment.status !== "ok") return;
      segment.text = String(element.innerText || "").trim();
      element.classList.toggle("is-empty", !segment.text);
      clearReflowUndo("transcript");
      rebuildTranscriptDraftFromSegments();
      pruneSpellFixesFromCurrentText();
      refreshTranscriptActionButtons();
      refreshReflowControlLabels();
    });
    element.addEventListener("paste", (event) => {
      event.preventDefault();
      const pasted = event.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertText", false, pasted);
    });
  });
  document.querySelectorAll("[data-fullscreen-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      syncFormState();
      const panel = button.dataset.fullscreenPanel || "";
      state.fullscreenPanel = state.fullscreenPanel === panel ? "" : panel;
      render();
    });
  });

  const audioDropZone = document.querySelector("#audio-drop-zone");
  function setAudioDragging(isDragging) {
    audioDropZone?.classList.toggle("is-dragging", isDragging);
  }
  if (audioDropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      audioDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (!state.busy) setAudioDragging(true);
      });
    });
    ["dragleave", "dragend"].forEach((eventName) => {
      audioDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !audioDropZone.contains(relatedTarget)) {
          setAudioDragging(false);
        }
      });
    });
  }
  document.ondragenter = (event) => {
    if (event.dataTransfer?.types?.includes("Files")) setAudioDragging(true);
  };
  document.ondragover = (event) => {
    event.preventDefault();
    if (event.dataTransfer?.types?.includes("Files")) {
      event.dataTransfer.dropEffect = state.busy ? "none" : "copy";
      setAudioDragging(true);
    }
  };
  document.ondragleave = (event) => {
    if (!event.relatedTarget) setAudioDragging(false);
  };
  document.ondrop = (event) => {
    event.preventDefault();
    setAudioDragging(false);
    if (explainBusyBlocksNewSource()) return;
    const files = event.dataTransfer?.files;
    if (files?.length) handleImportedFiles(files);
  };
  document.querySelector("#start-recording")?.addEventListener("click", startRecording);
  document.querySelector("#stop-recording")?.addEventListener("click", stopRecording);
  document.querySelector("#start-camera")?.addEventListener("click", () => {
    if (explainBusyBlocksNewSource()) return;
    document.querySelector("#camera-capture")?.click();
  });
  document.querySelector("#camera-capture")?.addEventListener("change", (event) => {
    const files = event.target.files;
    if (files?.length) handleImportedFiles(files, { fromCamera: true, append: true });
    event.target.value = "";
  });
  document.querySelector("#play-audio")?.addEventListener("click", playRecordedAudio);
  document.querySelector("#download-audio")?.addEventListener("click", downloadLatestAudio);
  document.querySelector("#audio-seek")?.addEventListener("input", (event) => seekRecordedAudio(event.target.value));
  document.querySelector("#audio-seek")?.addEventListener("change", (event) => seekRecordedAudio(event.target.value));
  document.querySelectorAll("[data-seek-fail-segment]").forEach((el) => {
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const point = event.clientX != null
        ? { x: event.clientX, y: event.clientY }
        : (() => {
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })();
      showChunkRetryPopover({
        segmentId: el.dataset.seekFailSegment || "",
        startSeconds: Number(el.dataset.seekStart) || 0,
        clientX: point.x,
        clientY: point.y,
        anchor: el,
      });
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    });
  });
  document.querySelectorAll("[data-remove-doc-page]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeDocumentPage(button.dataset.removeDocPage);
    });
  });
  if (refs.docThumbDrag) endDocThumbDrag(false);
  document.querySelectorAll(".doc-thumb[data-doc-page-id]").forEach((thumb) => {
    const activate = (event) => {
      if (event.target.closest("[data-remove-doc-page]")) return;
      if (Date.now() < (refs.docThumbSuppressClickUntil || 0)) return;
      const page = refs.docPages.find((item) => item.id === thumb.dataset.docPageId);
      if (!page) return;
      const status = thumb.dataset.docStatus;
      const segment = findSegmentForDocPage(page.id);
      if (status === "failed" && segment) {
        const rect = thumb.getBoundingClientRect();
        showChunkRetryPopover({
          segmentId: segment.id,
          startSeconds: 0,
          clientX: event.clientX ?? (rect.left + rect.width / 2),
          clientY: event.clientY ?? (rect.top + rect.height / 2),
          anchor: thumb,
        });
        return;
      }
      openDocumentPreview(page);
    };
    thumb.addEventListener("click", activate);
    thumb.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(event);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        moveDocumentPageWithKeys(thumb.dataset.docPageId, event.key === "ArrowLeft" ? -1 : 1);
      }
    });
    bindDocThumbPointerReorder(thumb);
  });
  const previewBackdrop = document.querySelector("#doc-preview-backdrop");
  if (previewBackdrop) {
    // Bind on the next tick so the click that opened the overlay cannot also close it.
    window.setTimeout(() => {
      if (document.querySelector("#doc-preview-backdrop") !== previewBackdrop) return;
      previewBackdrop.addEventListener("click", (event) => {
        if (refs.docCropDrag) return;
        if (event.target?.dataset?.closeDocPreview) closeDocumentPreview();
      });
    }, 0);
    bindDocCropUi();
  } else if (refs.docCrop && !state.docPreview) {
    refs.docCrop = null;
  }
  document.querySelector("#audio-file")?.addEventListener("change", (event) => {
    const files = event.target.files;
    if (files?.length) handleImportedFiles(files);
    event.target.value = "";
  });
  document.querySelector("#transcribe-last-audio")?.addEventListener("click", () => {
    transcribeLastMedia();
  });
  document.querySelectorAll(".word-issue:not(.summary-issue)").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const turnIndex = Number(button.dataset.turnIndex);
      const wordIndex = Number(button.dataset.wordIndex);
      const word = normalizeWordEntry(state.turns[turnIndex]?.words?.[wordIndex] || {});
      const suggestions = getWordSuggestions(word);
      state.issueNotice = {
        source: "turn",
        kind: word.isUnclear ? "unclear" : "context",
        title: word.isUnclear ? "ถอดข้อความได้ไม่ชัด" : "พบข้อความที่ต้องตรวจสอบ",
        description: getIssueDescription(word),
        suggestions,
        turnIndex,
        wordIndex,
        word: word.word,
      };
      render();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        button.click();
      }
    });
  });
  document.querySelectorAll(".turn-line-text").forEach((element) => {
    element.addEventListener("input", () => {
      const index = Number(element.dataset.index);
      const text = element.innerText;
      if (!state.turns[index]) return;
      state.turns[index].text = text;
      state.turns[index].words = splitWords(text);
      state.issueNotice = null;
    });
  });
  document.querySelector("#transcript-text")?.addEventListener("input", (event) => {
    updateTranscriptEditorState(event.target);
  });
  document.querySelectorAll("#transcript-text .raw-unclear").forEach((element) => {
    element.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      event.preventDefault();
      selectElementNode(element);
    });
  });
  const transcriptEditor = document.querySelector("#transcript-text");
  document.querySelectorAll("#transcript-text .raw-speaker").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTranscriptTurnSpeaker(resolveSpeakerLabelLineIndex(transcriptEditor, element));
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      element.click();
    });
  });
  document.querySelector("#transcript-text")?.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const container = event.currentTarget;
    const rawUnclear = getSelectedRawUnclear(container);
    if (rawUnclear) {
      event.preventDefault();
      rawUnclear.remove();
      updateTranscriptEditorState(container);
      return;
    }
    if (event.key !== "Backspace") return;
    const rawSpeaker = getRawSpeakerBeforeCaret(container);
    if (rawSpeaker) {
      event.preventDefault();
      rawSpeaker.remove();
      updateTranscriptEditorState(container);
      return;
    }
    const beforeSpace = getRawSpeakerBeforeSpaceCaret(container);
    if (!beforeSpace) return;
    event.preventDefault();
    beforeSpace.spaceNode.remove();
    beforeSpace.rawSpeaker.remove();
    updateTranscriptEditorState(container);
  });
  document.querySelector("#transcript-text")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const element = event.currentTarget;
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || !selection.rangeCount) return;
    const text = element.innerText;
    const offset = getCaretOffset(element);
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const currentLine = text.slice(lineStart, offset);
    const speakerMatch = currentLine.match(/^\s*(?:\[\d{1,4}:\d{2}(?::\d{2})?\]\s*)?(ถาม|พยาน|ตอบ)\s*[:：]/);
    if (!speakerMatch) return;
    event.preventDefault();

    // Build the exact same markup renderRawTranscriptText would for this
    // label (span + class), instead of inserting plain text via execCommand,
    // so the new line is colored immediately instead of waiting for the next
    // full render (execCommand("insertText") only inserts plain text, which
    // is why the auto-inserted label previously showed up uncolored).
    const opposite = speakerMatch[1] === "ถาม" ? "พยาน" : "ถาม";
    const speakerClass = opposite === "ถาม" ? "speaker-question" : "speaker-witness";

    const labelSpan = document.createElement("span");
    labelSpan.className = `raw-speaker ${speakerClass}`;
    labelSpan.setAttribute("role", "button");
    labelSpan.setAttribute("tabindex", "0");
    labelSpan.title = `คลิกเพื่อสลับเป็น${opposite === "ถาม" ? "พยาน" : "ถาม"}`;
    labelSpan.textContent = `${opposite} :`;
    labelSpan.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      toggleTranscriptTurnSpeaker(resolveSpeakerLabelLineIndex(element, labelSpan));
    });
    labelSpan.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
      keyEvent.preventDefault();
      labelSpan.click();
    });

    const newlineNode = document.createTextNode("\n");
    const spaceNode = document.createTextNode(" ");
    const fragment = document.createDocumentFragment();
    fragment.appendChild(newlineNode);
    fragment.appendChild(labelSpan);
    fragment.appendChild(spaceNode);

    selection.getRangeAt(0).insertNode(fragment);

    // Position the caret using our own reference to spaceNode rather than
    // trusting the range insertNode() leaves behind - that varies by browser.
    const newRange = document.createRange();
    newRange.setStart(spaceNode, spaceNode.length);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    updateTranscriptEditorState(element);
  });
  document.querySelector("#transcript-text")?.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });
  document.querySelectorAll("[data-close-issue-notice]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.currentTarget !== event.target) return;
      state.issueNotice = null;
      render();
    });
  });
  document.querySelector("#close-issue-notice")?.addEventListener("click", () => {
    state.issueNotice = null;
    render();
  });
  document.querySelectorAll(".suggestion-choice[data-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      applyIssueSuggestion(button.dataset.suggestion || "");
    });
  });
  document.querySelector("#mark-issue-correct")?.addEventListener("click", markCurrentIssueCorrect);
  document.querySelector("#custom-issue-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.querySelector("#custom-issue-text")?.value.trim() || "";
    applyIssueSuggestion(value);
  });
  document.querySelector("#summarize")?.addEventListener("click", () => {
    if (state.busy === "summarizing") cancelActiveTask();
    else runSummary();
  });
  // One button, three meanings, decided by current state: cancel a running
  // review, strip existing speaker tags, or ask the AI to (re-)apply them.
  document.querySelector("#review-speakers")?.addEventListener("click", () => {
    if (state.busy === "reviewing-speakers") cancelActiveTask();
    else if (hasSpeakerLabels()) removeSpeakerLabels();
    else runSpeakerReview();
  });
  document.querySelector("#spellcheck")?.addEventListener("click", () => {
    if (state.busy === SPELL_BUSY) cancelActiveTask();
    else runSpellcheck();
  });
  document.querySelector("#review-speakers-auto")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAutoSpeakerReview(!state.autoSpeakerReview);
    render();
  });
  document.querySelector("#spellcheck-auto")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAutoSpellcheck(!state.autoSpellcheck);
    render();
  });
  document.querySelector("#retry-all-failed-spell-chunks")?.addEventListener("click", () => retryFailedSpellChunks());
  // Capture-phase pointerdown on the transcript panel, not per-span click.
  // contenteditable="plaintext-only" can retarget a real user click onto the
  // editor host so a listener on the <span> never fires (Puppeteer still
  // delivered click to the span, which is why the earlier test looked fine).
  document.querySelector(".transcript-panel")?.addEventListener("pointerdown", onSpellFixPointerDown, true);
  document.querySelectorAll(".spell-fix[data-spell-fix-id]").forEach((element) => {
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        revertSpellFix(element.dataset.spellFixId);
      }
    });
  });
  document.querySelector("#reflow-transcript")?.addEventListener("click", () => {
    toggleReflow("transcript");
  });
  document.querySelector("#reflow-transcript-auto")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAutoReflow(!isAutoReflowOn());
    render();
  });
  document.querySelector("#copy-transcript")?.addEventListener("click", async () => {
    syncFormState();
    try {
      await navigator.clipboard.writeText(stripTimestampsForDisplay(formatTranscript()));
      state.copyTranscriptOk = true;
    } catch {
      state.message = "คัดลอกไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาต ลองเลือกและคัดลอกข้อความด้วยตนเอง";
    }
    render();
    window.setTimeout(() => {
      state.copyTranscriptOk = false;
      render();
    }, 1400);
  });
  document.querySelector("#download-transcript")?.addEventListener("click", () => downloadText("omkwam-verbatim.txt", stripTimestampsForDisplay(formatTranscript())));
  document.querySelector("#clear-transcript")?.addEventListener("click", () => {
    syncFormState();
    if (hasTranscriptContent()) {
      state.clearedTranscript = {
        turns: cloneStateValue(state.turns),
        transcriptDraft: state.transcriptDraft,
        transcriptSegments: cloneStateValue(state.transcriptSegments),
        issueNotice: cloneStateValue(state.issueNotice),
      };
      state.turns = [];
      state.transcriptDraft = "";
      state.transcriptSegments = null;
      clearSpellState();
      state.issueNotice = null;
      state.copyTranscriptOk = false;
      clearReflowUndo("transcript");
    } else if (hasClearedTranscript()) {
      state.turns = cloneStateValue(state.clearedTranscript.turns) || [];
      state.transcriptDraft = state.clearedTranscript.transcriptDraft || "";
      state.transcriptSegments = cloneStateValue(state.clearedTranscript.transcriptSegments);
      state.issueNotice = cloneStateValue(state.clearedTranscript.issueNotice);
      state.clearedTranscript = null;
    }
    render();
  });
  document.querySelector("#summary-text")?.addEventListener("input", (event) => {
    const nextSummary = event.target.innerText;
    state.summary = nextSummary;
    if (state.issueNotice?.source === "summary" && !state.summary.includes(state.issueNotice.word)) state.issueNotice = null;
    const hasText = Boolean(state.summary.trim());
    event.target.classList.toggle("is-empty", !hasText);
    document.querySelector("#copy-summary")?.toggleAttribute("disabled", !hasText);
    document.querySelector("#download-summary")?.toggleAttribute("disabled", !hasText);
    const clearSummary = document.querySelector("#clear-summary");
    if (clearSummary) {
      const canUndo = hasClearedSummary();
      clearSummary.toggleAttribute("disabled", !hasText && !canUndo);
      clearSummary.textContent = !hasText && canUndo ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ";
    }
  });
  document.querySelectorAll(".summary-issue").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const summaryStart = Number(button.dataset.issueStart);
      const summaryEnd = Number(button.dataset.issueEnd);
      const displayWord = String(button.textContent || "").trim();
      const issue = getSummaryIssues().find((item) => String(item.index) === String(button.dataset.issueIndex)) || {
        source: "local-summary",
        index: button.dataset.issueIndex || `local-click-${summaryStart}`,
        text: displayWord,
        word: {
          word: displayWord,
          originalWord: displayWord,
          isUnclear: /ไม่ชัด/i.test(displayWord),
          isOutofContext: !/ไม่ชัด/i.test(displayWord),
          issueDescription: /ไม่ชัด/i.test(displayWord)
            ? "ถ้อยคำนี้มีคำว่าไม่ชัด ควรตรวจเทียบกับเสียงหรือคำต่อคำอีกครั้ง"
            : "พบข้อความที่ต้องตรวจสอบ ควรตรวจทานอีกครั้ง",
          suggestions: extractUnclearSuggestions(displayWord.match(/น่าจะ\s*-?\s*([^\]]+)/i)?.[1] || ""),
          contextSuggestions: [],
        },
      };
      if (!issue.text && !displayWord) return;
      const word = normalizeWordEntry(issue.word);
      const suggestions = getWordSuggestions(word);
      const issueWord = displayWord || issue.text || word.word || "";
      state.issueNotice = {
        source: "summary",
        kind: word.isUnclear ? "unclear" : "context",
        issueIndex: issue.index,
        summaryStart,
        summaryEnd,
        title: word.isUnclear ? "ถอดข้อความได้ไม่ชัด" : "พบข้อความที่ต้องตรวจสอบ",
        description: getIssueDescription(word),
        suggestions,
        word: issueWord,
        dismissTexts: [issueWord, word.word, word.originalWord, ...suggestions],
      };
      render();
    });
  });
  document.querySelector("#close-quota-modal")?.addEventListener("click", () => {
    state.quotaNotice = null;
    render();
  });
  document.querySelector("#quota-close")?.addEventListener("click", () => {
    state.quotaNotice = null;
    render();
  });
  document.querySelector("#quota-retry")?.addEventListener("click", () => {
    const retryAction = state.quotaNotice?.action || "";
    state.quotaNotice = null;
    state.message = retryAction ? "กำลังส่งคำขอเดิมใหม่" : "";
    render();
    retryQuotaNoticeTask(retryAction);
  });
  document.querySelector("#quota-model")?.addEventListener("change", (event) => {
    const retryAction = state.quotaNotice?.action || "";
    state.model = event.target.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
    state.quotaNotice = null;
    state.message = retryAction
      ? `เปลี่ยน Gemini model เป็น ${getModelLabel(state.model)} แล้ว กำลังส่งคำขอเดิมใหม่`
      : `เปลี่ยน Gemini model เป็น ${getModelLabel(state.model)} แล้ว`;
    render();
    retryQuotaNoticeTask(retryAction);
  });
  document.querySelector("#copy-summary")?.addEventListener("click", async () => {
    syncFormState();
    try {
      await navigator.clipboard.writeText(state.summary);
      state.copyOk = true;
    } catch {
      state.message = "คัดลอกไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาต ลองเลือกและคัดลอกข้อความด้วยตนเอง";
    }
    render();
    window.setTimeout(() => {
      state.copyOk = false;
      render();
    }, 1400);
  });
  document.querySelector("#download-summary")?.addEventListener("click", () => {
    syncFormState();
    downloadText("omkwam-summary.txt", state.summary);
  });
  document.querySelector("#clear-summary")?.addEventListener("click", () => {
    syncFormState();
    if (state.summary.trim()) {
      state.clearedSummary = {
        summary: state.summary,
        summaryIssues: cloneStateValue(state.summaryIssues),
        dismissedSummaryIssueTexts: cloneStateValue(state.dismissedSummaryIssueTexts),
        issueNotice: state.issueNotice?.source === "summary" ? cloneStateValue(state.issueNotice) : null,
      };
      state.summary = "";
      state.summaryIssues = [];
      state.dismissedSummaryIssueTexts = [];
      state.copyOk = false;
      if (state.issueNotice?.source === "summary") state.issueNotice = null;
    } else if (hasClearedSummary()) {
      state.summary = state.clearedSummary.summary || "";
      state.summaryIssues = cloneStateValue(state.clearedSummary.summaryIssues) || [];
      state.dismissedSummaryIssueTexts = cloneStateValue(state.clearedSummary.dismissedSummaryIssueTexts) || [];
      if (state.clearedSummary.issueNotice) state.issueNotice = cloneStateValue(state.clearedSummary.issueNotice);
      state.clearedSummary = null;
    }
    render();
  });

  document.querySelector("#dictionary-text")?.addEventListener("input", (event) => {
    if (state.modal === "dictionary") {
      state.dictionaryDraft = event.target.value;
    } else {
      state.dictionaryText = cleanDictionaryText(event.target.value);
      writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
    }
  });
  document.querySelectorAll("[data-case-info-field]").forEach((element) => {
    element.addEventListener("input", () => {
      syncFormState();
      refreshCaseInfoClearButton();
    });
  });
  document.querySelector("#clear-case-info")?.addEventListener("click", () => {
    syncFormState();
    if (hasCaseInfoContent(state.caseInfo)) {
      state.clearedCaseInfo = cloneStateValue(normalizeCaseInfo(state.caseInfo));
      state.caseInfo = { ...DEFAULT_CASE_INFO };
    } else if (hasClearedCaseInfo()) {
      state.caseInfo = normalizeCaseInfo(state.clearedCaseInfo);
      state.clearedCaseInfo = null;
    }
    writeCaseInfoStorage(state.caseInfo);
    render();
  });
  document.querySelector("#copy-case-info")?.addEventListener("click", async () => {
    syncFormState();
    const text = formatCaseInfoForExport(state.caseInfo);
    try {
      await navigator.clipboard.writeText(text);
      state.copyCaseInfoOk = true;
    } catch {
      state.message = "คัดลอกไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาต ลองเลือกและคัดลอกข้อความด้วยตนเอง";
    }
    render();
    window.setTimeout(() => {
      state.copyCaseInfoOk = false;
      render();
    }, 1400);
  });
  document.querySelector("#download-case-info")?.addEventListener("click", () => {
    syncFormState();
    downloadText("omkwam-case-info.txt", formatCaseInfoForExport(state.caseInfo));
  });
  document.querySelector("#copy-dictionary")?.addEventListener("click", async () => {
    const text = cleanDictionaryText(document.querySelector("#dictionary-text")?.value ?? (state.modal === "dictionary" ? state.dictionaryDraft ?? "" : state.dictionaryText));
    if (state.modal === "dictionary") state.dictionaryDraft = text;
    try {
      await navigator.clipboard.writeText(text);
      state.copyDictionaryOk = true;
    } catch {
      state.message = "คัดลอกไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาต ลองเลือกและคัดลอกข้อความด้วยตนเอง";
    }
    render();
    window.setTimeout(() => {
      state.copyDictionaryOk = false;
      render();
    }, 1400);
  });
  document.querySelector("#download-dictionary")?.addEventListener("click", () => {
    const text = cleanDictionaryText(document.querySelector("#dictionary-text")?.value ?? (state.modal === "dictionary" ? state.dictionaryDraft ?? "" : state.dictionaryText));
    if (state.modal === "dictionary") state.dictionaryDraft = text;
    downloadText("omkwam-dictionary.txt", text);
  });
  document.querySelector("#reset-dictionary")?.addEventListener("click", resetDictionaryDraft);
  document.querySelector("#save-dictionary-close")?.addEventListener("click", saveDictionaryDraftAndClose);
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "z" && !event.shiftKey && !event.altKey) {
    if (canUndoReflow("transcript")) {
      event.preventDefault();
      undoReflow("transcript");
      return;
    }
  }
  if (event.key !== "Escape") return;
  if (state.docPreview) {
    closeDocumentPreview();
    return;
  }
  if (state.issueNotice) {
    state.issueNotice = null;
    render();
    return;
  }
  if (state.quotaNotice) {
    state.quotaNotice = null;
    render();
    return;
  }
  if (state.modal === "dictionary") {
    discardDictionaryDraftAndClose();
    return;
  }
  if (state.modal) {
    syncFormState();
    state.modal = "";
    render();
  }
});

window.addEventListener("focus", stopTitleFlash);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) updateAwayAlert();
  else stopTitleFlash();
});

render();

// A key restored from localStorage has never been tested in this session, so
// verify it up front rather than letting the pill imply it works. Costs nothing
// (models-list probe, no tokens, no quota) and runs in the background - the
// render above has already painted the UI, and checkApiKey patches the pill in
// place when the answer arrives.
if (state.apiKey.trim()) checkApiKey();
