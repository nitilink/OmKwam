// Shared, mutable application state. Every module that needs to read or write
// the app's state imports `state` (and `refs` for non-serializable runtime
// handles like timers/streams) from here - there is exactly one instance of
// each, so mutations made in one module are visible everywhere else.

import { readStorage } from "./storage.js";
import { DICTIONARY_STORAGE_KEY, DEFAULT_DICTIONARY, cleanDictionaryText } from "./dictionary.js";
import { readCaseInfoStorage } from "./case-info.js";

export const DEFAULT_MODEL = "gemini-3.5-flash";
export const MODEL_OPTIONS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
];

export const API_KEY_STORAGE_KEY = "omkwam.byok.apiKey";
export const MODEL_STORAGE_KEY = "omkwam.byok.model.2026-06-21-v2";
export const INSTRUCTIONS_STORAGE_KEY = "omkwam.byok.instructions.2026-06-21-v4";
export const DEFAULT_INSTRUCTIONS = "";

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
  model: readStorage(MODEL_STORAGE_KEY, DEFAULT_MODEL),
  dictionaryText: cleanDictionaryText(readStorage(DICTIONARY_STORAGE_KEY, DEFAULT_DICTIONARY)),
  dictionaryDraft: null,
  caseInfo: readCaseInfoStorage(),
  clearedCaseInfo: null,
  instructions: readStorage(INSTRUCTIONS_STORAGE_KEY, DEFAULT_INSTRUCTIONS),
  turns: [],
  transcriptDraft: "",
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
  // see appendOrReplaceTranscriptSegment in app.js.
  audioSourceId: 0,
  transcribedSegments: new Map(),
  // Incremented per API-key check so a slow earlier response can't overwrite
  // the verdict for a key the user has since replaced.
  apiKeyCheckToken: 0,
  apiKeyCheckTimer: null,
};
