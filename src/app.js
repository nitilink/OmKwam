const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_FILES_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/files";
const DEFAULT_MODEL = "gemini-3.5-flash";
const MODEL_OPTIONS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
];
const API_KEY_STORAGE_KEY = "omkwam.byok.apiKey";
const MODEL_STORAGE_KEY = "omkwam.byok.model.2026-06-21-v2";
const DICTIONARY_STORAGE_KEY = "omkwam.byok.dictionary.current";
const CASE_INFO_STORAGE_KEY = "omkwam.byok.caseInfo.2026-06-24-v1";
const INSTRUCTIONS_STORAGE_KEY = "omkwam.byok.instructions.2026-06-21-v4";
const INLINE_AUDIO_SAFE_BYTES = 12 * 1024 * 1024;
const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 90 * 1000;
const GEMINI_FILE_POLL_INTERVAL_MS = 2000;
const EXTERNAL_CONVERSION_AUDIO_EXTENSIONS = new Set(["ds", "dss", "ds2"]);
const DEFAULT_CASE_INFO = {
  facts: "",
  documents: "",
  properNames: "",
};
const DEFAULT_DICTIONARY = `-มอเตอร์ไซค์, มอไซค์, รถเครื่อง ให้ใช้ รถจักรยานยนต์
-แฟน ให้ใช้ คนรัก
-เซเว่น ให้ใช้ ร้านสะดวกซื้อเซเว่น อีเลฟเว่น
-ปั๊มน้ำมัน ให้ใช้ สถานีบริการน้ำมัน
-[เวลา]โมง ให้ใช้ [เวลา]นาฬิกา
-[เวลา]ทุ่ม ให้ใช้ [เวลา]นาฬิกา
-โรงพัก ให้ใช้ สถานีตำรวจ
-"ยาบ้า" ให้ใช้ "เมทแอมเฟตามีนชนิดเม็ด (ยาบ้า) อันเป็นยาเสพติดให้โทษในประเภท ๑" เป็นชื่อเต็มแค่เพียงครั้งแรกของการสรุป ถัดจากนั้นให้ใช้เพียง "เมทแอมเฟตามีน"
-"ยาไอซ์" ให้ใช้ "เมทแอมเฟตามีนชนิดเกล็ด (ยาไอซ์) อันเป็นยาเสพติดให้โทษในประเภท ๑" เป็นชื่อเต็มแค่เพียงครั้งแรกของการสรุป ถัดจากนั้นให้ใช้เพียง "เมทแอมเฟตามีน"

-ตัวเลข ให้ใช้ ตัวอักษรเลขไทยเสมอ เช่น 12 ให้ใช้ ๑๒
-เอกสารฝ่ายโจทก์ ให้ใช้ เอกสารหมาย จ.[ตัวเลข] เช่น เอกสารหมาย จ.๒
-เอกสารฝ่ายจำเลย ให้ใช้ เอกสารหมาย ล.[ตัวเลข] เช่น เอกสารหมาย ล.๓
-การอ้างส่งเอกสารใหม่ ให้ใช้ "ตามเอกสารที่ผู้ถามให้ดู อ้างส่ง ศาลรับไว้หมาย [จ./ล.]" และไม่ต้องใส่วงเล็บเพื่อประกอบการกระทำในกรณีนี้`;

const SUMMARY_RULES_PROMPT = `[REDACTED: private summary prompt omitted from public source package]`;

const SUMMARY_REVIEW_RULES_PROMPT = `[REDACTED: private review prompt omitted from public source package]`;

const DEFAULT_INSTRUCTIONS = "";

const state = {
  apiKey: readStorage(API_KEY_STORAGE_KEY, ""),
  persistKey: Boolean(readStorage(API_KEY_STORAGE_KEY, "")),
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

const refs = {
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
};

function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore private-mode storage errors.
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore private-mode storage errors.
  }
}

function cleanCaseInfoValue(value, maxLength = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCaseInfo(value = {}) {
  value = value || {};
  const legacyFacts = [
    value.charge ? `ข้อหา: ${value.charge}` : "",
    value.defense ? `ข้อต่อสู้: ${value.defense}` : "",
    value.facts,
    value.notes,
  ].filter(Boolean).join(" ");
  return {
    facts: cleanCaseInfoValue(legacyFacts, 900),
    documents: cleanCaseInfoValue(value.documents, 800),
    properNames: cleanCaseInfoValue(value.properNames || value.namesPlaces, 800),
  };
}

function readCaseInfoStorage() {
  try {
    return normalizeCaseInfo(JSON.parse(readStorage(CASE_INFO_STORAGE_KEY, "{}")));
  } catch {
    return { ...DEFAULT_CASE_INFO };
  }
}

function writeCaseInfoStorage(value) {
  writeStorage(CASE_INFO_STORAGE_KEY, JSON.stringify(normalizeCaseInfo(value)));
}

function formatCaseInfoForPrompt(info = state.caseInfo) {
  const clean = normalizeCaseInfo(info);
  const lines = [
    ["รายละเอียดคดีเบื้องต้น", clean.facts],
    ["เอกสารในสำนวน", clean.documents],
    ["ชื่อเฉพาะของบุคคล สิ่งของ หรือสถานที่", clean.properNames],
  ].filter(([, value]) => value);
  return lines.map(([label, value]) => `- ${label}: ${value}`).join("\n");
}

function formatCaseInfoForExport(info = state.caseInfo) {
  const clean = normalizeCaseInfo(info);
  return [
    ["รายละเอียดคดีเบื้องต้น", clean.facts],
    ["เอกสารในสำนวน", clean.documents],
    ["ชื่อเฉพาะของบุคคล สิ่งของ หรือสถานที่", clean.properNames],
  ].map(([label, value]) => `${label}\n${value || ""}`.trimEnd()).join("\n\n").trim();
}

function getModelLabel(value = state.model) {
  const modelValue = String(value || DEFAULT_MODEL);
  return MODEL_OPTIONS.find((option) => option.value === modelValue)?.label || modelValue;
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

function formatDownloadTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function withDownloadTimestamp(filename) {
  const clean = String(filename || "omkwam.txt");
  const dotIndex = clean.lastIndexOf(".");
  const stamp = formatDownloadTimestamp();
  if (dotIndex <= 0) return `${clean}_${stamp}`;
  return `${clean.slice(0, dotIndex)}_${stamp}${clean.slice(dotIndex)}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) return raw;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function renderRawTranscriptText(text) {
  return String(text || "").split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line)) return line;
    const match = line.match(/^(\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?)(ถาม|พยาน|ตอบ)(\s*[:：])/);
    if (!match) return highlightRawUnclearText(line);
    const speakerClass = match[2] === "ถาม" ? "speaker-question" : "speaker-witness";
    const timeClass = match[2] === "ถาม" ? "raw-time-question" : "raw-time-witness";
    const prefix = match[1]
      ? `<span class="raw-time ${timeClass}">${escapeHtml(match[1])}</span>`
      : "";
    const label = `<span class="raw-speaker ${speakerClass}">${escapeHtml(`${match[2]}${match[3]}`)}</span>`;
    return `${prefix}${label}${highlightRawUnclearText(line.slice(match[0].length))}`;
  }).join("");
}

function updateTranscriptEditorState(element) {
  state.transcriptDraft = element.innerText;
  state.turns = [];
  state.issueNotice = null;
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
  if (!state.busy) document.querySelector("#summarize")?.toggleAttribute("disabled", !hasText);
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

function normalizeConfigLine(line) {
  return String(line).trim().replace(/^[-*•]\s*/, "").trim();
}

function cleanDictionaryText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function dictionaryRuleMatch(line) {
  return normalizeConfigLine(line).match(/^(.+?)\s*(?:ให้ใช้คำว่า|ให้ใช้|=>|->|=|:)\s*(.+)$/);
}

function parseDictionaryRules(text) {
  return String(text)
    .split(/\r?\n/)
    .map(normalizeConfigLine)
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
    .flatMap((line, index) => {
      const match = dictionaryRuleMatch(line);
      if (!match) return [];
      const rawKeyword = match[1].replace(/^["'“”]+|["'“”]+$/g, "").trim();
      const term = match[2].replace(/^["'“”]+|["'“”]+$/g, "").trim();
      if (!rawKeyword || !term) return [];
      return rawKeyword
        .split(/\s*,\s*/)
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .map((keyword, keywordIndex) => ({ id: `dict-${index}-${keywordIndex}-${keyword}`, keyword, term, description: line }));
    })
    .filter(Boolean);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function safeJsonParse(text) {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function parseGeminiText(payload) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error(payload?.promptFeedback?.blockReason || payload?.error?.message || "Gemini ไม่ส่งผลลัพธ์กลับมา");
  }
  return text;
}

function isQuotaMessage(message) {
  return /quota|rate.?limit|free_tier_requests|429|exceeded/i.test(String(message || ""));
}

function isCapacityMessage(message) {
  return /high demand|spikes? in demand|currently experiencing high demand|try again later|overloaded|503/i.test(String(message || ""));
}

function makeGeminiError(message, status = 0, details = {}) {
  const error = new Error(message || `Gemini API error ${status}`);
  error.status = status;
  error.retryAfter = details.retryAfter || "";
  error.isQuota = status === 429 || isQuotaMessage(message);
  error.isCapacity = status === 503 || isCapacityMessage(message);
  return error;
}

function isCancelError(error) {
  return error?.isCancelled || error?.name === "AbortError";
}

function makeCancelError() {
  const error = new Error("หยุดงานแล้ว");
  error.isCancelled = true;
  return error;
}

function throwIfCancelled(signal = refs.abortController?.signal) {
  if (signal?.aborted) throw makeCancelError();
}

function wait(ms, signal = refs.abortController?.signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeCancelError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(makeCancelError());
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function makeRequestId(prefix = "omkwam") {
  const randomPart = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function handleGeminiError(error, fallbackMessage) {
  if (isCancelError(error)) {
    state.message = state.busy === "summarizing" ? "หยุดการสรุปความแล้ว" : "หยุดการถอดเสียงแล้ว";
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
}

async function callGemini(parts, responseMimeType, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");

  const model = encodeURIComponent(state.model.trim() || DEFAULT_MODEL);
  const requestId = options.requestId || makeRequestId("gemini");
  const requestParts = [
    ...parts,
    {
      text: `
รหัสคำขอใหม่ของครั้งนี้: ${requestId}
ให้ถือว่าคำขอนี้เป็นงานใหม่แยกจากคำขอก่อนหน้าทุกครั้ง แม้ไฟล์เสียงหรือข้อความที่ส่งมาจะเหมือนเดิม
ห้ามใช้คำตอบเดิมจาก cache หรือบริบทเดิม ให้ประมวลผลจากข้อมูลที่ส่งมาในคำขอนี้ใหม่เท่านั้น
ห้ามใส่รหัสคำขอนี้ในผลลัพธ์`,
    },
  ];
  throwIfCancelled(options.signal);
  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: requestParts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini API error ${response.status}`, response.status, {
      retryAfter: response.headers.get("retry-after") || "",
    });
  }
  return parseGeminiText(payload);
}

async function getGeminiFileStatus(fileName, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");
  const cleanName = String(fileName || "").replace(/^\/+/, "");
  if (!cleanName) throw new Error("Gemini Files API ไม่ส่ง file name กลับมา");
  const fileId = cleanName.split("/").pop();
  const response = await fetch(`${GEMINI_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?key=${encodeURIComponent(apiKey)}`, {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini file status error ${response.status}`, response.status, {
      retryAfter: response.headers.get("retry-after") || "",
    });
  }
  return payload.file || payload;
}

async function waitForGeminiFileActive(uploaded, options = {}) {
  if (!uploaded?.name) return uploaded;
  let current = uploaded;
  const started = Date.now();
  while (Date.now() - started < GEMINI_FILE_ACTIVE_TIMEOUT_MS) {
    throwIfCancelled(options.signal);
    const fileState = String(current?.state || "").toUpperCase();
    if (fileState === "ACTIVE") {
      return {
        ...uploaded,
        ...current,
        uri: current.uri || uploaded.uri,
        mimeType: current.mimeType || current.mime_type || uploaded.mimeType,
      };
    }
    if (fileState === "FAILED") {
      throw new Error("Gemini เตรียมไฟล์เสียงไม่สำเร็จ ลองแปลงไฟล์เป็น mp3, m4a หรือ wav แล้วส่งใหม่");
    }
    options.onState?.(fileState || "PROCESSING");
    await wait(GEMINI_FILE_POLL_INTERVAL_MS, options.signal);
    current = await getGeminiFileStatus(uploaded.name, options);
  }
  throw new Error("Gemini ยังเตรียมไฟล์เสียงไม่เสร็จภายในเวลาที่กำหนด ลองกดถอดเสียงใหม่ หรือใช้ไฟล์เสียงขนาดเล็กลง");
}

async function uploadAudioFileToGemini(file, mimeType, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");

  const uploadRequestId = makeRequestId("upload");
  throwIfCancelled(options.signal);
  const startResponse = await fetch(GEMINI_UPLOAD_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    signal: options.signal,
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(file.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `${file.name || "AUDIO"}-${uploadRequestId}` } }),
  });

  if (!startResponse.ok) {
    const payload = await startResponse.json().catch(() => ({}));
    throw makeGeminiError(payload?.error?.message || `Gemini upload error ${startResponse.status}`, startResponse.status, {
      retryAfter: startResponse.headers.get("retry-after") || "",
    });
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API ไม่ส่ง upload URL กลับมา");

  throwIfCancelled(options.signal);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    cache: "no-store",
    signal: options.signal,
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: file,
  });

  const payload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini upload error ${uploadResponse.status}`, uploadResponse.status, {
      retryAfter: uploadResponse.headers.get("retry-after") || "",
    });
  }
  const uploaded = payload.file || payload;
  if (!uploaded.uri) throw new Error("Gemini Files API ไม่ส่ง file uri กลับมา");
  return {
    name: uploaded.name || "",
    uri: uploaded.uri,
    state: uploaded.state || "",
    mimeType: uploaded.mimeType || uploaded.mime_type || mimeType,
  };
}

function buildTranscriptionMediaParts({ audioBase64 = "", mimeType = "", fileUri = "", fileMimeType = "" }) {
  const hasAudio = Boolean(audioBase64 && mimeType);
  const hasFile = Boolean(fileUri && fileMimeType);
  const parts = [];
  if (hasAudio) {
    parts.push({
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    });
  }
  if (hasFile) {
    parts.push({
      fileData: {
        mimeType: fileMimeType,
        fileUri,
      },
    });
  }
  return { parts, hasAudio, hasFile };
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

function parseRawSpeakerLine(line) {
  const match = String(line || "").match(/^(\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?)(ถาม|พยาน|ตอบ)(\s*[:：]\s*)(.*)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    speaker: match[2] === "ถาม" ? "ถาม" : "พยาน",
    separator: match[3],
    text: match[4].trim(),
  };
}

function normalizeRawTranscriptLines(text) {
  const normalized = [];
  let lastSpeaker = "";
  let lastTime = "00:00";
  const appendTurn = (time, speaker, turnText) => {
    const cleaned = String(turnText || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const previous = normalized[normalized.length - 1];
    if (previous?.speaker === speaker) {
      previous.text = `${previous.text} ${cleaned}`.trim();
      return;
    }
    normalized.push({ time, speaker, text: cleaned });
  };

  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const parsed = parseRawSpeakerLine(line);
    if (parsed) {
      const timeMatch = parsed.prefix.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      const time = timeMatch ? timeMatch[1] : lastTime;
      lastTime = time;
      lastSpeaker = parsed.speaker;
      appendTurn(time, parsed.speaker, parsed.text);
      return;
    }

    const timeMatch = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
    const time = timeMatch ? timeMatch[1] : lastTime;
    if (timeMatch) lastTime = time;
    const textOnly = timeMatch ? line.slice(timeMatch[0].length).trim() : line;
    const speaker = lastSpeaker || "พยาน";
    appendTurn(time, speaker, textOnly);
  });
  return normalized.map((turn) => `[${turn.time}] ${turn.speaker} : ${turn.text}`).join("\n");
}

async function transcribeRawTextWithGemini(mediaParts, options = {}) {
  const raw = await callGemini([
    ...mediaParts,
    {
      text: `[REDACTED: private transcription prompt omitted from public source package]`,
    },
  ], "text/plain", options);
  return parseRawTranscriptionText(raw);
}

async function rephraseWithGemini(transcriptText = formatTranscript(), options = {}) {
  const dictionary = parseDictionaryRules(state.dictionaryText);
  const raw = await callGemini([
    {
      text: `[REDACTED: private summary request prompt omitted from public source package]`,
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
    {
      text: `[REDACTED: private summary-review request prompt omitted from public source package]`,
    },
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
  const turns = [];
  let lastSpeaker = "";
  String(text)
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const timeMatch = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
      const time = timeMatch ? timeMatch[1] : formatTurnTime({ startSeconds: index * 5 }, index);
      const withoutTime = timeMatch ? line.slice(timeMatch[0].length).trim() : line;
      const speakerMatch = withoutTime.match(/^(ถาม|พยาน|ตอบ)\s*[:：]\s*/);
      const speaker = speakerMatch ? (speakerMatch[1] === "ถาม" ? "ถาม" : "พยาน") : lastSpeaker || "พยาน";
      const cleaned = speakerMatch ? withoutTime.slice(speakerMatch[0].length).trim() : withoutTime;
      if (speakerMatch) lastSpeaker = speaker;
      turns.push({ id: `local-${Date.now()}-${index}`, time, speaker, text: cleaned, words: splitFallbackWords(cleaned) });
    });
  return turns;
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
  if (state.turns.length) return state.turns.map(formatTurnForSummary).filter(Boolean).join("\n");
  return localFallbackTurns(state.transcriptDraft)
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
  return state.turns.length > 0 || state.transcriptDraft.trim().length > 0;
}

function hasCaseInfoContent(value = state.caseInfo) {
  const clean = normalizeCaseInfo(value);
  return Boolean(clean.facts || clean.documents || clean.properNames);
}

function cloneStateValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasClearedTranscript() {
  return Boolean(state.clearedTranscript?.turns?.length || state.clearedTranscript?.transcriptDraft?.trim());
}

function hasClearedSummary() {
  return Boolean(state.clearedSummary?.summary?.trim());
}

function hasClearedCaseInfo() {
  return hasCaseInfoContent(state.clearedCaseInfo);
}

function getTranscriptEditorText() {
  return state.transcriptDraft || (state.turns.length ? formatTranscript() : "");
}

function formatTranscript() {
  if (state.turns.length === 0) return state.transcriptDraft.trim();
  return state.turns.map((turn, index) => `[${formatTurnTime(turn, index)}] ${turn.speaker} : ${turn.text}`).join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = withDownloadTimestamp(filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function audioExtensionFromMimeType(mimeType = "") {
  const clean = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const extensionByType = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/ogg": "ogg",
    "audio/aiff": "aiff",
    "audio/webm": "webm",
  };
  return extensionByType[clean] || "webm";
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
  if (!refs.abortController || !["transcribing", "summarizing"].includes(state.busy)) return;
  refs.cancelRequested = true;
  refs.abortController.abort();
  state.message = "กำลังหยุดงานที่ส่งไป Gemini";
  render();
}

function getAudioMimeType(fileOrBlob) {
  const rawType = String(fileOrBlob?.type || "").trim();
  if (rawType) return rawType;

  const extension = getFileExtension(fileOrBlob);
  const byExtension = {
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    wave: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    webm: "audio/webm",
  };
  return byExtension[extension] || "application/octet-stream";
}

function getFileExtension(fileOrBlob) {
  const name = String(fileOrBlob?.name || "").toLowerCase();
  return name.includes(".") ? name.split(".").pop() : "";
}

function needsExternalAudioConversion(fileOrBlob) {
  return EXTERNAL_CONVERSION_AUDIO_EXTENSIONS.has(getFileExtension(fileOrBlob));
}

function formatExternalAudioConversionMessage(fileOrBlob) {
  const extension = getFileExtension(fileOrBlob) || "ds";
  return `ไม่สามารถถอดไฟล์เสียง .${extension} ได้ กรุณาแปลงเป็นไฟล์เสียง .wav, .mp3 หรือ .m4a แล้วใช้งานใหม่อีกครั้ง`;
}

function formatAudioInfo(blob, mimeType) {
  const sizeKb = Math.max(1, Math.round(blob.size / 1024));
  if (needsExternalAudioConversion(blob)) {
    return `DSS/DS2 · ${sizeKb.toLocaleString()} KB · ไม่รองรับการถอดเสียง`;
  }
  const type = mimeType || getAudioMimeType(blob);
  return `${type} · ${sizeKb.toLocaleString()} KB`;
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60).toString().padStart(2, "0");
  const secs = Math.floor(total % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function resetAudioProgress() {
  state.audioCurrentTime = 0;
  state.audioDuration = 0;
}

function setLatestAudioBlob(blob, options = {}) {
  const mimeType = options.mimeType || getAudioMimeType(blob);
  refs.lastAudioBlob = blob;
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

async function transcribeAudioBlob(blob, mimeType, options = {}) {
  const controller = beginCancelableTask("transcribing", "กำลังเตรียมไฟล์เสียง", "กำลังเตรียมไฟล์เสียง");
  try {
    let mediaParts = [];
    if (options.useFilesApi) {
      setProgressAction("กำลังอัปโหลดไฟล์เสียงไป Gemini Files API", "กำลังอัปโหลดไฟล์เสียง");
      const uploaded = await uploadAudioFileToGemini(blob, mimeType, { signal: controller.signal });
      throwIfCancelled(controller.signal);
      setProgressAction("อัปโหลดแล้ว กำลังรอ Gemini เตรียมไฟล์เสียง", "กำลังรอ Gemini เตรียมไฟล์เสียง");
      const activeFile = await waitForGeminiFileActive(uploaded, {
        signal: controller.signal,
        onState: () => setProgressAction("อัปโหลดแล้ว กำลังรอ Gemini เตรียมไฟล์เสียง", "กำลังรอไฟล์พร้อมใช้งาน"),
      });
      throwIfCancelled(controller.signal);
      mediaParts = buildTranscriptionMediaParts({ fileUri: activeFile.uri, fileMimeType: activeFile.mimeType }).parts;
      setProgressAction("อัปโหลดแล้ว กำลังรอ Gemini ถอดเสียง", "กำลังรอผลถอดเสียงจาก Gemini");
    } else {
      setProgressAction("กำลังอ่านไฟล์เสียงใน browser", "กำลังเตรียมไฟล์เสียง");
      const audioBase64 = await fileToBase64(blob);
      throwIfCancelled(controller.signal);
      mediaParts = buildTranscriptionMediaParts({ audioBase64, mimeType }).parts;
      setProgressAction("ส่งไฟล์เสียงแล้ว กำลังรอ Gemini ถอดเสียง", "กำลังรอผลถอดเสียงจาก Gemini");
    }

    const rawText = await transcribeRawTextWithGemini(mediaParts, { signal: controller.signal });
    throwIfCancelled(controller.signal);
    state.turns = [];
    state.transcriptDraft = rawText;
    state.issueNotice = null;
    state.summaryIssues = [];
    state.message = formatGeminiSuccessMessage("ถอดเสียงสำเร็จ");
  } catch (error) {
    if (options.useFilesApi && /failed to fetch|networkerror/i.test(String(error?.message || ""))) {
      state.message = "อัปโหลดไฟล์เสียงไป Gemini Files API ไม่สำเร็จ เบราว์เซอร์หรือโฮสต์อาจบล็อกการอัปโหลดไฟล์ใหญ่ ลองใช้ไฟล์เสียงขนาดเล็กลงหรือแปลงเป็น mp3/m4a/wav แล้วลองใหม่";
    } else {
      handleGeminiError(error, "ถอดเสียงไม่สำเร็จ");
    }
  } finally {
    finishCancelableTask(controller);
    state.busy = null;
    render();
  }
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

  await transcribeAudioBlob(file, mimeType, { useFilesApi: file.size > INLINE_AUDIO_SAFE_BYTES });
}

async function startRecording() {
  syncFormState();

  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
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
  await transcribeAudioBlob(refs.lastAudioBlob, mimeType, { useFilesApi: refs.lastAudioBlob.size > INLINE_AUDIO_SAFE_BYTES });
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

function syncFormState() {
  const apiKey = document.querySelector("#api-key");
  const model = document.querySelector("#model");
  const dictionary = document.querySelector("#dictionary-text");
  const instructions = document.querySelector("#instructions-text");
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
  if (dictionary && state.modal !== "dictionary") {
    state.dictionaryText = cleanDictionaryText(dictionary.value);
    writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
  }
  if (instructions) {
    state.instructions = instructions.value;
    writeStorage(INSTRUCTIONS_STORAGE_KEY, state.instructions);
  }
  if (caseFacts || caseDocuments || caseProperNames) {
    state.caseInfo = normalizeCaseInfo({
      facts: caseFacts?.value ?? state.caseInfo.facts,
      documents: caseDocuments?.value ?? state.caseInfo.documents,
      properNames: caseProperNames?.value ?? state.caseInfo.properNames,
    });
    writeCaseInfoStorage(state.caseInfo);
  }
  if (transcript && state.turns.length === 0) state.transcriptDraft = transcript.innerText;
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
                <option value="${escapeHtml(option.value)}" ${state.model === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
          </label>
          <label>
            <span>Gemini API key</span>
            <input id="api-key" class="${apiKeyInputClass}" type="text" value="${escapeHtml(apiKeyInputValue)}" data-masked-value="${escapeHtml(apiKeyMask)}" placeholder="ใส่ API key ของผู้ใช้" autocomplete="off" autocapitalize="off" autocorrect="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" spellcheck="false">
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
            <span class="privacy-meta">Version: v0.36 · Last updated: 29 Jun 2026, 22:26 ICT</span>
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
            <strong>Email</strong>
            <span>[redacted in public source package]</span>
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
        <div class="tutorial-body">
          <span>Coming soon.</span>
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

function formatRecordingTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function getPanelStatus() {
  if (state.busy === "recording") return { tone: "processing", text: state.message || "กำลังบันทึกเสียงจากไมโครโฟน" };
  if (state.busy === "stopping") return { tone: "processing", text: state.message || "กำลังหยุดบันทึกเสียง" };
  if (state.busy === "transcribing") return { tone: "processing", text: state.message || "กำลังถอดเสียง" };
  if (state.busy === "summarizing") return { tone: "processing", text: state.message || "กำลังสรุปคำเบิกความ" };
  if (!state.message) return null;
  if (/ไม่สำเร็จ|error|กรุณา|ยังไม่มี|ไม่รองรับ|ไม่ได้|ไม่พบ/.test(state.message)) return { tone: "warning", text: state.message };
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

function renderWorkTab() {
  const transcriptText = getTranscriptEditorText();
  const hasTranscript = hasTranscriptContent();
  const canUndoTranscriptClear = !hasTranscript && hasClearedTranscript();
  const canUndoSummaryClear = !state.summary && hasClearedSummary();
  const latestAudioNeedsConversion = state.recordedAudioUrl && needsExternalAudioConversion(refs.lastAudioBlob);
  const latestAudioStatus = state.recordedAudioUrl
    ? latestAudioNeedsConversion
      ? "ไม่รองรับไฟล์นี้"
      : "พร้อมสำหรับการถอดเสียง"
    : "ยังไม่มีเสียง";
  const canTranscribeLatestAudio = Boolean(state.recordedAudioUrl && !state.busy && !latestAudioNeedsConversion);
  const turnHtml = state.turns.length
    ? state.turns.map((turn, index) => `
      <div class="turn-line ${turn.speaker === "ถาม" ? "is-question" : "is-witness"}" data-index="${index}"><span class="turn-time">[${escapeHtml(formatTurnTime(turn, index))}]</span><span class="turn-speaker-label ${turn.speaker === "ถาม" ? "speaker-question" : "speaker-witness"}">${escapeHtml(turn.speaker)} :</span><span class="turn-line-text" contenteditable="plaintext-only" spellcheck="false" data-index="${index}">${renderTurnWords(turn, index)}</span></div>
    `).join("")
    : `<div id="transcript-text" class="transcript-editor ${transcriptText.trim() ? "" : "is-empty"}" contenteditable="plaintext-only" spellcheck="false" data-placeholder="ผลลัพธ์การถอดเสียงจะแสดงที่นี่ หรือสามารถพิมพ์ข้อความได้">${renderRawTranscriptText(transcriptText)}</div>`;

  return `
    <section class="audio-deck">
      <div class="audio-grid">
        <div class="audio-card record-card ${state.busy === "recording" ? "is-recording" : ""}">
          <div class="audio-card-text">
            <h2>บันทึกจากไมค์</h2>
            <p>กดเริ่มบันทึก แล้วพูดใส่ไมโครโฟนได้ทันที</p>
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
              : `<button class="record-button" id="start-recording" ${state.busy ? "disabled" : ""}>เริ่มบันทึก</button>`}
          </div>
        </div>

        <div class="audio-card import-card" id="audio-drop-zone">
          <div class="audio-card-text">
            <h2>นำเข้าเสียง</h2>
            <p>อัพโหลดไฟล์เสียงโดยตรงจากคอมพิวเตอร์ของผู้ใช้</p>
            <p class="drop-hint">ลากไฟล์เสียงมาวางที่นี่ได้</p>
          </div>
          <div class="audio-actions">
            <label class="file-button">
              เลือกไฟล์
              <input id="audio-file" type="file" accept=".mp3,.mpeg,.mpga,.ds,.dss,.ds2,.aac,.m4a,.wav,.flac,.ogg,.aiff,.aif,audio/*" ${state.busy ? "disabled" : ""}>
            </label>
            ${state.busy === "transcribing"
              ? `<button class="danger" id="transcribe-last-audio">หยุดถอดเสียง</button>`
              : `<button class="ghost-button" id="transcribe-last-audio" ${canTranscribeLatestAudio ? "" : "disabled"}>ถอดเสียง</button>`}
          </div>
        </div>

        <div class="audio-card player-card">
          <div class="audio-card-text">
            <h2 class="latest-audio">
              <span class="latest-title">ไฟล์เสียง</span>
              <strong>${latestAudioStatus}</strong>
              <span>${escapeHtml(state.recordedAudioUrl ? state.recordedAudioInfo || "บันทึกจากไมโครโฟน" : "")}</span>
            </h2>
            <div class="audio-player">
              <span id="audio-current-time">${formatAudioTime(state.audioCurrentTime)}</span>
              <input id="audio-seek" type="range" min="0" max="${Math.max(0, state.audioDuration || 0)}" step="0.01" value="${Math.min(state.audioCurrentTime || 0, state.audioDuration || state.audioCurrentTime || 0)}" aria-label="เลื่อนตำแหน่งเสียง" ${state.recordedAudioUrl ? "" : "disabled"}>
              <span id="audio-duration">${formatAudioTime(state.audioDuration)}</span>
            </div>
          </div>
          <div class="audio-actions">
            <button class="ghost-button" id="play-audio" ${state.recordedAudioUrl ? "" : "disabled"}>${state.isAudioPlaying ? "หยุดเล่น" : "เล่นเสียง"}</button>
            <button class="ghost-button" id="download-audio" ${state.recordedAudioUrl ? "" : "disabled"}>บันทึกเสียง</button>
          </div>
        </div>
      </div>

    </section>
    ${renderPanelStatus()}

    <section class="workspace">
      <div class="panel transcript-panel ${state.fullscreenPanel === "transcript" ? "is-fullscreen" : ""}">
        <div class="panel-head">
          <div>
            <h2>ถอดเสียง</h2>
            <p>กรุณาตรวจสอบความถูกต้องก่อนสรุปความ</p>
          </div>
          <div class="panel-head-actions">
            <button class="${state.busy === "summarizing" ? "danger" : "summarize-head-button"}" id="summarize" ${state.busy && state.busy !== "summarizing" || !hasTranscript ? "disabled" : ""}>${state.busy === "summarizing" ? "หยุดสรุปความ" : "สรุปความ"}</button>
          </div>
        </div>
        ${renderIssueNotice()}
        <div class="turn-list">${turnHtml}</div>
        <div class="button-row bottom-actions">
          <button class="ghost-button" id="copy-transcript" ${hasTranscript ? "" : "disabled"}>${state.copyTranscriptOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          <button class="ghost-button" id="download-transcript" ${hasTranscript ? "" : "disabled"}>ดาวน์โหลด .txt</button>
          <button class="ghost-button" id="clear-transcript" ${hasTranscript || canUndoTranscriptClear ? "" : "disabled"}>${canUndoTranscriptClear ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ"}</button>
          <button class="ghost-button fullscreen-action" type="button" data-fullscreen-panel="transcript" title="${state.fullscreenPanel === "transcript" ? "ย่อหน้าต่าง" : "ขยายหน้าต่าง"}" aria-label="${state.fullscreenPanel === "transcript" ? "ย่อหน้าต่าง" : "ขยายหน้าต่าง"}">${state.fullscreenPanel === "transcript" ? "↙" : "⛶"}</button>
        </div>
      </div>

      <div class="panel summary-panel ${state.fullscreenPanel === "summary" ? "is-fullscreen" : ""}">
        <div class="panel-head">
          <div>
            <h2>สรุปความ</h2>
            <p>กรุณาตรวจแก้ไขก่อนนำไปใช้</p>
          </div>
        </div>
        <div id="summary-text" class="summary-output ${state.summary ? "" : "is-empty"}" contenteditable="plaintext-only" spellcheck="false" data-placeholder="ผลลัพธ์สรุปความจะแสดงที่นี่">${renderSummaryText()}</div>
        <div class="button-row bottom-actions">
          <button class="ghost-button" id="copy-summary" ${state.summary ? "" : "disabled"}>${state.copyOk ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          <button class="ghost-button" id="download-summary" ${state.summary ? "" : "disabled"}>ดาวน์โหลด .txt</button>
          <button class="ghost-button" id="clear-summary" ${state.summary || canUndoSummaryClear ? "" : "disabled"}>${canUndoSummaryClear ? "ยกเลิกล้างข้อความ" : "ล้างข้อความ"}</button>
          <button class="ghost-button fullscreen-action" type="button" data-fullscreen-panel="summary" title="${state.fullscreenPanel === "summary" ? "ย่อหน้าต่าง" : "ขยายหน้าต่าง"}" aria-label="${state.fullscreenPanel === "summary" ? "ย่อหน้าต่าง" : "ขยายหน้าต่าง"}">${state.fullscreenPanel === "summary" ? "↙" : "⛶"}</button>
        </div>
      </div>
    </section>
  `;
}

function render() {
  const root = document.querySelector("#root");
  const scrollPositions = captureScrollPositions();
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"><img src="./src/assets/nitilink-logo.png" alt="NitiLink logo"></div>
          <div>
            <h1>OmKwam</h1>
            <p>A privacy-first workspace for testimony transcription · by NitiLink</p>
          </div>
        </div>
        <nav class="header-actions" aria-label="App actions">
          <span class="status-pill ${state.apiKey.trim() ? "key-ready" : "no-key"}">${state.apiKey.trim() ? "Key ready" : "No key"}</span>
          <label class="model-pill-label" aria-label="Gemini model">
            <span>Model</span>
            <select id="quick-model" class="model-pill">
              ${MODEL_OPTIONS.map((option) => `
                <option value="${escapeHtml(option.value)}" ${state.model === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>
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
    }, 0);
  });
  document.querySelector("#model")?.addEventListener("change", (event) => {
    state.model = event.target.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
  });
  document.querySelector("#quick-model")?.addEventListener("change", (event) => {
    syncFormState();
    state.model = event.target.value;
    writeStorage(MODEL_STORAGE_KEY, state.model);
    state.message = `เปลี่ยน Gemini model เป็น ${getModelLabel(state.model)} แล้ว`;
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
    state.message = "ลบ API key ที่เก็บไว้ในเบราว์เซอร์นี้แล้ว";
    render();
  });
  document.querySelectorAll("[data-fullscreen-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      syncFormState();
      const panel = button.dataset.fullscreenPanel || "";
      state.fullscreenPanel = state.fullscreenPanel === panel ? "" : panel;
      render();
    });
  });

  document.querySelector("#audio-file")?.addEventListener("change", (event) => handleAudioFile(event.target.files?.[0]));
  const audioDropZone = document.querySelector("#audio-drop-zone");
  const setAudioDragging = (active) => {
    audioDropZone?.classList.toggle("is-dragging", Boolean(active && !state.busy));
  };
  if (audioDropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      audioDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        setAudioDragging(true);
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
    if (state.busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) handleAudioFile(file);
  };
  document.querySelector("#start-recording")?.addEventListener("click", startRecording);
  document.querySelector("#stop-recording")?.addEventListener("click", stopRecording);
  document.querySelector("#play-audio")?.addEventListener("click", playRecordedAudio);
  document.querySelector("#download-audio")?.addEventListener("click", downloadLatestAudio);
  document.querySelector("#audio-seek")?.addEventListener("input", (event) => seekRecordedAudio(event.target.value));
  document.querySelector("#audio-seek")?.addEventListener("change", (event) => seekRecordedAudio(event.target.value));
  document.querySelector("#transcribe-last-audio")?.addEventListener("click", () => {
    if (state.busy === "transcribing") cancelActiveTask();
    else transcribeLastAudio();
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
  document.querySelector("#transcript-text")?.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const rawUnclear = getSelectedRawUnclear(event.currentTarget);
    if (!rawUnclear) return;
    event.preventDefault();
    rawUnclear.remove();
    updateTranscriptEditorState(event.currentTarget);
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
  document.querySelector("#copy-transcript")?.addEventListener("click", async () => {
    syncFormState();
    await navigator.clipboard.writeText(formatTranscript());
    state.copyTranscriptOk = true;
    render();
    window.setTimeout(() => {
      state.copyTranscriptOk = false;
      render();
    }, 1400);
  });
  document.querySelector("#download-transcript")?.addEventListener("click", () => downloadText("omkwam-verbatim.txt", formatTranscript()));
  document.querySelector("#clear-transcript")?.addEventListener("click", () => {
    syncFormState();
    if (hasTranscriptContent()) {
      state.clearedTranscript = {
        turns: cloneStateValue(state.turns),
        transcriptDraft: state.transcriptDraft,
        issueNotice: cloneStateValue(state.issueNotice),
      };
      state.turns = [];
      state.transcriptDraft = "";
      state.issueNotice = null;
      state.copyTranscriptOk = false;
    } else if (hasClearedTranscript()) {
      state.turns = cloneStateValue(state.clearedTranscript.turns) || [];
      state.transcriptDraft = state.clearedTranscript.transcriptDraft || "";
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
    await navigator.clipboard.writeText(state.summary);
    state.copyOk = true;
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
  document.querySelector("#instructions-text")?.addEventListener("input", (event) => {
    state.instructions = event.target.value;
    writeStorage(INSTRUCTIONS_STORAGE_KEY, state.instructions);
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
    await navigator.clipboard.writeText(text);
    state.copyCaseInfoOk = true;
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
    await navigator.clipboard.writeText(text);
    state.copyDictionaryOk = true;
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

window.addEventListener("focus", stopTitleFlash);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) updateAwayAlert();
  else stopTitleFlash();
});

render();
