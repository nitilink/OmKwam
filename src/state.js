// Shared, mutable application state. Every module that needs to read or write
// the app's state imports `state` (and `refs` for non-serializable runtime
// handles like timers/streams) from here - there is exactly one instance of
// each, so mutations made in one module are visible everywhere else.

import { readStorage, writeStorage } from "./storage.js?v=0.39.12";
import { DICTIONARY_STORAGE_KEY, DEFAULT_DICTIONARY, cleanDictionaryText } from "./dictionary.js?v=0.39.12";
import { readCaseInfoStorage } from "./case-info.js?v=0.39.12";

// App version shown in UI and used for static asset cache-busting (?v=...).
export const APP_VERSION = "0.39";
export const ASSET_VERSION_QUERY = `?v=${APP_VERSION}`;

// Model IDs verified 2026-11-09 against Google's official Gemini API docs.
// Only models whose model page lists Audio as an input type and that are not
// deprecated / auto-routed to another model. All have a 65,536 output limit.
// Sources:
// - https://ai.google.dev/gemini-api/docs/models
// - https://ai.google.dev/gemini-api/docs/deprecations
//   (gemini-3.5-flash -> routed to 3.6-flash; gemini-3-flash-preview -> replace
//   with 3.6-flash; gemini-2.5-flash/pro shut down / re-routed Dec 1, 2026)
// - https://ai.google.dev/gemini-api/docs/models/<model-id> (Inputs: ... Audio)
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
export const MODEL_OPTIONS = [
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  { value: "__custom__", label: "กำหนดเอง (พิมพ์ชื่อโมเดล)" },
];

export const API_KEY_STORAGE_KEY = "omkwam.byok.apiKey";
export const MODEL_STORAGE_KEY = "omkwam.byok.model.2026-11-09-v3";
export const CUSTOM_MODEL_STORAGE_KEY = "omkwam.byok.customModel.2026-11-09-v1";
export const AUTO_SPELLCHECK_STORAGE_KEY = "omkwam.autoSpellcheck.v1";
export const AUTO_SPEAKER_REVIEW_STORAGE_KEY = "omkwam.autoSpeakerReview.v1";

// If the user previously saved a preset that we later removed from the dropdown
// (e.g. gemini-4-argon / gemini-3.1-pro-preview), keep that id via the custom
// field instead of silently falling back to DEFAULT_MODEL.
function loadModelSelection() {
  let model = readStorage(MODEL_STORAGE_KEY, DEFAULT_MODEL);
  let customModel = readStorage(CUSTOM_MODEL_STORAGE_KEY, "");
  const knownPreset = MODEL_OPTIONS.some((option) => option.value === model && option.value !== "__custom__");
  if (model && model !== "__custom__" && !knownPreset) {
    if (!String(customModel || "").trim()) {
      customModel = String(model).trim();
      writeStorage(CUSTOM_MODEL_STORAGE_KEY, customModel);
    }
    model = "__custom__";
    writeStorage(MODEL_STORAGE_KEY, model);
  }
  return { model, customModel };
}

const initialModelSelection = loadModelSelection();

// Files up to this size (bytes) are sent inline as base64; larger files go
// through the Gemini Files API upload+poll flow instead. Audio chunking
// (see audio-processing.js) keeps most chunks comfortably under this so the
// faster inline path is used even for originally-huge recordings.
export const INLINE_AUDIO_SAFE_BYTES = 12 * 1024 * 1024;

export const EXTERNAL_CONVERSION_AUDIO_EXTENSIONS = new Set(["ds", "dss", "ds2"]);

export const state = {
  apiKey: readStorage(API_KEY_STORAGE_KEY, ""),
  persistKey: Boolean(readStorage(API_KEY_STORAGE_KEY, "")),
  // "" = never checked, "checking" | "valid" | "invalid". Drives the header
  // status pill and the inline note under the API key field; deliberately not
  // persisted, so every session re-checks rather than trusting a stale verdict.
  apiKeyStatus: "",
  apiKeyStatusMessage: "",
  model: initialModelSelection.model,
  customModel: initialModelSelection.customModel,
  customModelStatusMessage: "",
  dictionaryText: cleanDictionaryText(readStorage(DICTIONARY_STORAGE_KEY, DEFAULT_DICTIONARY)),
  dictionaryDraft: null,
  caseInfo: readCaseInfoStorage(),
  clearedCaseInfo: null,
  turns: [],
  transcriptDraft: "",
  // Per-chunk transcription segments (progressive UI). null = legacy draft-only.
  transcriptSegments: null,
  clearedTranscript: null,
  summary: "",
  summaryIssues: [],
  dismissedSummaryIssueTexts: [],
  clearedSummary: null,
  issueNotice: null,
  quotaNotice: null,
  activeTab: "work",
  modal: "",
  busy: null,
  message: "",
  recordedAudioUrl: "",
  recordedAudioInfo: "",
  isAudioPlaying: false,
  audioCurrentTime: 0,
  audioDuration: 0,
  recordingSeconds: 0,
  micVolume: 0,
  copyOk: false,
  copyTranscriptOk: false,
  copyDictionaryOk: false,
  copyCaseInfoOk: false,
  fullscreenPanel: "",
  // "audio" | "document" | "" — which source the top-right card shows.
  latestSourceKind: "",
  docInfo: "",
  // Overlay for a single document page preview; not persisted.
  docPreview: null,
  // Typo-check (ตรวจคำผิด) marks and per-chunk retry state. Not persisted.
  spellFixes: [],
  spellChunks: [],
  // Segment/target ids already typo-checked in this session (auto-skip).
  spellCheckedIds: [],
  autoSpellcheck: readStorage(AUTO_SPELLCHECK_STORAGE_KEY, "") === "1",
  autoSpeakerReview: readStorage(AUTO_SPEAKER_REVIEW_STORAGE_KEY, "") === "1",
};



export const refs = {
  mediaRecorder: null,
  audioChunks: [],
  playback: null,
  lastAudioBlob: null,
  stream: null,
  audioContext: null,
  analyser: null,
  volumeTimer: null,
  recordingTimer: null,
  abortController: null,
  progressTimer: null,
  progressStartedAt: 0,
  geminiStartedAt: 0,
  progressAction: "",
  cancelRequested: false,
  stopRequested: false,
  originalTitle: document.title || "OmKwam | NitiLink: Beyond Law, Into Systems",
  titleFlashTimer: null,
  titleFlashOn: false,
  lastTitleAlert: "",
  acknowledgedTitleAlert: "",
  successPulseText: "",
  successPulseUntil: 0,
  successPulseTimer: null,
  // Bumped every time a genuinely new audio source is loaded (new recording,
  // new file picked/dropped). Lets transcribeAudioBlob tell "new import" apart
  // from "retry of the same audio" so it knows whether to append or replace -
  // see mergeNewSourceSegments in transcript-segments.js.
  audioSourceId: 0,
  // audioSourceId -> { blob, plan } so failed chunks can be re-sliced later.
  audioSources: new Map(),
  // Current document batch shown in the filmstrip (page records; blobs stay here).
  docPages: [],
  // Same id space as audioSourceId so segment.audioSourceId never collides.
  // docSources: sourceId -> { pages }
  docSources: new Map(),
  // Incremented per API-key check so a slow earlier response can't overwrite
  // the verdict for a key the user has since replaced.
  apiKeyCheckToken: 0,
  apiKeyCheckTimer: null,
};

export function isPresetModel(modelValue) {
  const value = String(modelValue || "").trim();
  return MODEL_OPTIONS.some((option) => option.value === value && option.value !== "__custom__");
}

export function isCustomModelSelection(modelValue = state.model) {
  return !isPresetModel(modelValue);
}

export function getEffectiveModel() {
  if (isCustomModelSelection(state.model)) {
    const custom = String(state.customModel || "").trim();
    if (custom) return custom;
    // Safety net: orphaned former-preset id still sitting in state.model.
    const orphan = String(state.model || "").trim();
    if (orphan && orphan !== "__custom__") return orphan;
    return DEFAULT_MODEL;
  }
  return String(state.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}
