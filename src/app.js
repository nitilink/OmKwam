const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
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
const DICTIONARY_STORAGE_KEY = "omkwam.byok.dictionary.2026-06-24-v9";
const CASE_INFO_STORAGE_KEY = "omkwam.byok.caseInfo.2026-06-24-v1";
const INSTRUCTIONS_STORAGE_KEY = "omkwam.byok.instructions.2026-06-21-v4";
const INLINE_AUDIO_SAFE_BYTES = 12 * 1024 * 1024;
const DEFAULT_CASE_INFO = {
  facts: "",
  documents: "",
  properNames: "",
};
const DEFAULT_DICTIONARY = `# REDACTED_PUBLIC_SOURCE_PACKAGE
# Maintainer: restore the private default dictionary before functional deployment.`;

const SUMMARY_RULES_PROMPT = `REDACTED_PUBLIC_SOURCE_PACKAGE: restore private summary rules before functional deployment.`;

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
  originalTitle: document.title || "OmKwam 0.34d | NitiLink",
  titleFlashTimer: null,
  titleFlashOn: false,
  lastTitleAlert: "",
  acknowledgedTitleAlert: "",
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
  input.type = "password";
  input.value = "";
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

removeStorage("omkwam.byok.dictionary");
removeStorage("omkwam.byok.instructions");
removeStorage("omkwam.byok.model");
removeStorage("omkwam.byok.dictionary.2026-06-21-v2");
removeStorage("omkwam.byok.instructions.2026-06-21-v2");
removeStorage("omkwam.byok.dictionary.2026-06-21-v3");
removeStorage("omkwam.byok.instructions.2026-06-21-v3");
removeStorage("omkwam.byok.dictionary.2026-06-21-v4");
removeStorage("omkwam.byok.dictionary.2026-06-22-v5");
removeStorage("omkwam.byok.dictionary.2026-06-23-v6");
removeStorage("omkwam.byok.dictionary.2026-06-23-v7");
removeStorage("omkwam.byok.dictionary.2026-06-24-v8");
if (state.dictionaryText !== cleanDictionaryText(readStorage(DICTIONARY_STORAGE_KEY, DEFAULT_DICTIONARY))) {
  writeStorage(DICTIONARY_STORAGE_KEY, state.dictionaryText);
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
    : "ข้อความนี้อาจผิดปกติ น่าสงสัย หรือขัดต่อสามัญสำนึกทั่วไป ควรตรวจทานอีกครั้ง";

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
        issueDescription: "ถ้อยคำนี้ขัดต่อสามัญสำนึกทั่วไปอย่างชัดเจน ควรตรวจทานอีกครั้ง",
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
  const suggestions = Array.isArray(entry?.suggestions)
    ? entry.suggestions.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5)
    : rawWord ? getWordSuggestions(rawWord) : [];
  return {
    source: "ai-summary",
    index: `ai-${index}`,
    text,
    word: {
      word: text,
      originalWord: text,
      isUnclear,
      isOutofContext,
      issueDescription: String(entry?.issueDescription || entry?.reason || rawWord?.issueDescription || (isUnclear ? "ถ้อยคำนี้อาจไม่ชัดเจนในข้อความสรุป" : "ถ้อยคำนี้อาจผิดปกติ น่าสงสัย หรือขัดต่อสามัญสำนึกทั่วไป")),
      suggestions,
      contextSuggestions: Array.isArray(entry?.contextSuggestions) ? entry.contextSuggestions.map(String).filter(Boolean).slice(0, 5) : [],
    },
  };
}

function parseSummaryResult(raw) {
  const cleanRaw = String(raw || "").trim();
  if (!cleanRaw) return { summary: "", issues: [] };

  try {
    const parsed = safeJsonParse(cleanRaw);
    if (typeof parsed === "string") {
      return { summary: stripOpening(parsed), issues: [] };
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

    const cleanedSummary = stripOpening(summary);
    const issues = issueSource
      .map(normalizeSummaryIssueEntry)
      .filter(Boolean)
      .filter((issue) => cleanedSummary.includes(issue.text));

    return { summary: cleanedSummary, issues };
  } catch {
    return { summary: stripOpening(cleanRaw), issues: [] };
  }
}

function getSummaryIssues() {
  const dismissed = new Set(state.dismissedSummaryIssueTexts || []);
  const aiIssues = (Array.isArray(state.summaryIssues) ? state.summaryIssues : [])
    .map(normalizeSummaryIssueEntry)
    .filter(Boolean)
    .filter((issue) => issue.text && state.summary.includes(issue.text) && !dismissed.has(issue.text));
  return [...aiIssues, ...getLocalSummaryIssues()]
    .filter((issue) => !dismissed.has(issue.text))
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

function replaceSummaryIssue(word, replacement) {
  state.summary = state.summary.replace(word, replacement);
  state.issueNotice = null;
  render();
}

function markCurrentIssueCorrect() {
  if (!state.issueNotice) return;

  if (state.issueNotice.source === "summary") {
    const text = String(state.issueNotice.word || "").trim();
    if (text && !state.dismissedSummaryIssueTexts.includes(text)) {
      state.dismissedSummaryIssueTexts.push(text);
    }
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

function renderSummaryText() {
  if (!state.summary) return "";
  const issues = getSummaryIssues();
  if (!issues.length) return escapeHtml(state.summary);

  const pattern = new RegExp(`(${issues.map((issue) => escapeRegExp(issue.text)).join("|")})`, "g");
  return state.summary.split(pattern).map((part) => {
    const issue = issues.find((item) => item.text === part);
    if (!issue) return escapeHtml(part);
    const word = issue.word;
    const issueType = word.isUnclear ? "unclear" : "context";
    const description = getIssueDescription(word);
    return `<span class="word-issue summary-issue ${issueType}" role="button" tabindex="0" data-issue-index="${issue.index}" title="${escapeHtml(description)}">${escapeHtml(part)}</span>`;
  }).join("");
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
  state.summaryIssues = [];
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
  let skippedSection = "";
  const lines = [];
  String(text)
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = String(rawLine).trim();
      if (line.startsWith("#")) {
        const section = line.replace(/^#\s*/, "").trim();
        if (section.includes("กติกาการสรุปความ") || section.includes("ชื่อเฉพาะ")) {
          skippedSection = section;
          return;
        }
        skippedSection = "";
        if (section.includes("พจนานุกรม")) return;
      }
      if (!skippedSection) lines.push(rawLine);
    });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

function makeGeminiError(message, status = 0) {
  const error = new Error(message || `Gemini API error ${status}`);
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
      message: error?.message || "",
    };
    state.message = capacity
      ? "โมเดล Gemini มีผู้ใช้งานหนาแน่น ลองเปลี่ยน model หรือรอสักครู่แล้วลองใหม่"
      : "โควต้า Gemini หมด พักสักครู่แล้วลองใหม่ เปลี่ยน model หรือใช้ API แบบชำระเงิน";
    return;
  }
  state.message = error?.message || fallbackMessage;
}

async function callGemini(parts, responseMimeType, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");

  const model = encodeURIComponent(state.model.trim() || DEFAULT_MODEL);
  throwIfCancelled(options.signal);
  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini API error ${response.status}`, response.status);
  }
  return parseGeminiText(payload);
}

async function uploadAudioFileToGemini(file, mimeType, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");

  throwIfCancelled(options.signal);
  const startResponse = await fetch(GEMINI_UPLOAD_ENDPOINT, {
    method: "POST",
    signal: options.signal,
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(file.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: file.name || "AUDIO" } }),
  });

  if (!startResponse.ok) {
    const payload = await startResponse.json().catch(() => ({}));
    throw makeGeminiError(payload?.error?.message || `Gemini upload error ${startResponse.status}`, startResponse.status);
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API ไม่ส่ง upload URL กลับมา");

  throwIfCancelled(options.signal);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    signal: options.signal,
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: file,
  });

  const payload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini upload error ${uploadResponse.status}`, uploadResponse.status);
  }
  const uploaded = payload.file || payload;
  if (!uploaded.uri) throw new Error("Gemini Files API ไม่ส่ง file uri กลับมา");
  return { uri: uploaded.uri, mimeType: uploaded.mimeType || uploaded.mime_type || mimeType };
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
  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const parsed = parseRawSpeakerLine(line);
    if (parsed) {
      const timeMatch = parsed.prefix.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      const time = timeMatch ? timeMatch[1] : lastTime;
      lastTime = time;
      lastSpeaker = parsed.speaker;
      normalized.push(`[${time}] ${parsed.speaker} : ${parsed.text}`.trim());
      return;
    }

    const timeMatch = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
    const time = timeMatch ? timeMatch[1] : lastTime;
    if (timeMatch) lastTime = time;
    const textOnly = timeMatch ? line.slice(timeMatch[0].length).trim() : line;
    const speaker = lastSpeaker || "พยาน";
    normalized.push(`[${time}] ${speaker} : ${textOnly}`);
  });
  return normalized.join("\n");
}

async function transcribeRawTextWithGemini(mediaParts, options = {}) {
  const raw = await callGemini([
    ...mediaParts,
    {
      text: `REDACTED_PUBLIC_SOURCE_PACKAGE: restore the private transcription prompt before functional deployment.`,
    },
  ], "text/plain", options);
  return parseRawTranscriptionText(raw);
}

async function rephraseWithGemini(transcriptText = formatTranscript(), options = {}) {
  const dictionary = parseDictionaryRules(state.dictionaryText);
  const raw = await callGemini([
    {
      text: `REDACTED_PUBLIC_SOURCE_PACKAGE: restore the private testimony-summary prompt before functional deployment.`,
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
      text: `REDACTED_PUBLIC_SOURCE_PACKAGE: restore the private summary-review prompt before functional deployment.`,
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

function getSummaryTranscriptText() {
  if (state.turns.length) return formatTranscript();
  return localFallbackTurns(state.transcriptDraft)
    .map((turn, index) => `[${formatTurnTime(turn, index)}] ${turn.speaker} : ${turn.text}`)
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
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = withDownloadTimestamp(filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  const elapsed = Math.max(1, Math.round((Date.now() - refs.progressStartedAt) / 1000));
  const action = refs.progressAction || (state.busy === "summarizing" ? "กำลังสรุปความ" : "กำลังถอดไฟล์เสียง");
  let prefix = `ส่งคำขอไปยัง Gemini แล้ว ${elapsed} วินาที`;
  if (elapsed >= 180) {
    prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที อาจค้างหรือโมเดลหนาแน่น`;
  } else if (elapsed >= 120) {
    prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที ถ้านานผิดปกติลองเปลี่ยน model`;
  } else if (elapsed >= 60) {
    prefix = `ยังรอผลตอบกลับจาก Gemini อยู่ ${elapsed} วินาที ไฟล์ยาวหรือโมเดลช้าอาจใช้เวลานาน`;
  }
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
  state.message = `ส่งคำขอไปยัง Gemini แล้ว - ${message}`;
  refs.progressAction = action;
  refs.progressStartedAt = Date.now();
  if (!refs.geminiStartedAt && /Gemini|ส่ง/.test(`${message} ${action}`)) {
    refs.geminiStartedAt = refs.progressStartedAt;
  }
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

  const name = String(fileOrBlob?.name || "").toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";
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

function formatAudioInfo(blob, mimeType) {
  const sizeKb = Math.max(1, Math.round(blob.size / 1024));
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
      mediaParts = buildTranscriptionMediaParts({ fileUri: uploaded.uri, fileMimeType: uploaded.mimeType }).parts;
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
  const mimeType = getAudioMimeType(file);
  refs.lastAudioBlob = file;
  if (state.recordedAudioUrl) URL.revokeObjectURL(state.recordedAudioUrl);
  refs.playback?.pause();
  refs.playback = null;
  state.isAudioPlaying = false;
  resetAudioProgress();
  state.recordedAudioUrl = URL.createObjectURL(file);
  state.recordedAudioInfo = formatAudioInfo(file, mimeType);

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
      refs.lastAudioBlob = blob;
      if (state.recordedAudioUrl) URL.revokeObjectURL(state.recordedAudioUrl);
      refs.playback?.pause();
      refs.playback = null;
      state.isAudioPlaying = false;
      resetAudioProgress();
      state.recordedAudioUrl = URL.createObjectURL(blob);
      state.recordedAudioInfo = formatAudioInfo(blob, blob.type || mimeType);

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
  if (summary) state.summary = "value" in summary ? summary.value : summary.innerText;
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
  const showStoredKeyMask = Boolean(state.persistKey && savedApiKey.trim());
  const apiKeyMask = showStoredKeyMask ? getApiKeyMask(savedApiKey) : "";
  const apiKeyInputValue = showStoredKeyMask ? apiKeyMask : state.apiKey;
  const apiKeyInputType = showStoredKeyMask ? "text" : "password";
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
            <input id="api-key" type="${apiKeyInputType}" value="${escapeHtml(apiKeyInputValue)}" data-masked-value="${escapeHtml(apiKeyMask)}" placeholder="ใส่ API key ของผู้ใช้" autocomplete="off" spellcheck="false">
          </label>
          <label class="checkline">
            <input id="persist-key" type="checkbox" ${state.persistKey ? "checked" : ""}>
            เก็บ key ใน browser นี้
          </label>
          <div class="settings-actions">
            <div class="settings-key-actions">
              <button class="ghost-button" id="load-key" type="button">Load key</button>
              <button class="ghost-button" id="remove-key" type="button" ${state.apiKey.trim() || readStorage(API_KEY_STORAGE_KEY, "") ? "" : "disabled"}>Remove key</button>
            </div>
            <button data-close-modal="true" type="button">เสร็จแล้ว</button>
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
        <textarea id="dictionary-text" spellcheck="false">${escapeHtml(dictionaryValue)}</textarea>
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
            <span class="privacy-meta">Last updated: 24 Jun 2026, 23:09 ICT</span>
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
            <p>ติดต่อผู้พัฒนา</p>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="contact-body">
          <div class="contact-email-row">
            <strong>Email</strong>
            <span>nitilink.app@gmail.com</span>
          </div>
          <div class="openchat-card">
            <div>
              <strong>LINE OpenChat</strong>
              <span>สแกน QR เพื่อเข้าร่วมโอเพ่นแชทของ NitiLink</span>
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
            <p>วิดีโอสอนใช้งานจะถูกเพิ่มภายหลัง</p>
          </div>
          <button class="icon-close" data-close-modal="true" type="button" aria-label="ปิด">×</button>
        </div>
        <div class="tutorial-body">
          <span>YouTube tutorial will be available here after publication.</span>
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
          <ul>
            <li>เปลี่ยน model แล้วลองใหม่</li>
            <li>พักสักครู่แล้วลองอีกครั้ง หรือรอจนกว่าโควต้าฟรีจะกลับมาใหม่</li>
            ${isCapacity ? "" : "<li>เปิด billing / ใช้ API แบบชำระเงิน ถ้าต้องใช้งานต่อเนื่อง</li>"}
          </ul>
          <div class="quota-actions">
            <button id="quota-open-settings" type="button">เปลี่ยน model</button>
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

function renderPanelStatus() {
  const status = getPanelStatus() || { tone: "idle", text: "พร้อมทำงาน" };
  return `<div class="panel-status ${status.tone}"><span>${escapeHtml(status.text)}</span></div>`;
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
      document.title = refs.titleFlashOn ? "● OmKwam แจ้งเตือน" : refs.originalTitle;
    }, 850);
  }
  document.title = "● OmKwam แจ้งเตือน";
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
              <input id="audio-file" type="file" accept=".mp3,.mpeg,.mpga,.aac,.m4a,.wav,.flac,.ogg,.aiff,.aif,audio/*" ${state.busy ? "disabled" : ""}>
            </label>
            ${state.busy === "transcribing"
              ? `<button class="danger" id="transcribe-last-audio">หยุดถอดเสียง</button>`
              : `<button class="ghost-button" id="transcribe-last-audio" ${state.recordedAudioUrl && !state.busy ? "" : "disabled"}>ถอดเสียง</button>`}
          </div>
        </div>

        <div class="audio-card player-card">
          <div class="audio-card-text">
            <h2 class="latest-audio">
              <span class="latest-title">เสียงล่าสุด</span>
              <strong>${state.recordedAudioUrl ? "พร้อมฟัง" : "ยังไม่มีเสียง"}</strong>
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
            <h1>OmKwam 0.34d</h1>
            <p>by NitiLink · A privacy-first workspace for testimony transcription</p>
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
        <span>Developed by <button id="open-contact" class="footer-link" type="button">Kosarit "slowkid" Nasomjai</button> · <button id="open-tutorial" class="footer-link" type="button">Tutorial</button> · <button id="open-privacy" class="footer-link" type="button">Privacy & Disclaimer</button></span>
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
    event.target.type = "password";
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
    prepareApiKeyInputForEditing(event.currentTarget);
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
  document.querySelector("#load-key")?.addEventListener("click", () => {
    const saved = readStorage(API_KEY_STORAGE_KEY, "");
    state.apiKey = saved;
    state.persistKey = Boolean(saved);
    state.message = saved ? "โหลด API key ที่เคยเก็บไว้ในเบราว์เซอร์แล้ว" : "ยังไม่มี API key ที่เก็บไว้ในเบราว์เซอร์นี้";
    render();
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
  document.querySelector("#audio-seek")?.addEventListener("input", (event) => {
    const nextTime = Number(event.target.value);
    state.audioCurrentTime = Number.isFinite(nextTime) ? nextTime : 0;
    const playback = ensurePlayback();
    if (playback) playback.currentTime = state.audioCurrentTime;
    refreshAudioPlayer();
  });
  document.querySelector("#transcribe-last-audio")?.addEventListener("click", () => {
    if (state.busy === "transcribing") cancelActiveTask();
    else transcribeLastAudio();
  });
  document.querySelectorAll(".word-issue").forEach((button) => {
    button.addEventListener("click", () => {
      const turnIndex = Number(button.dataset.turnIndex);
      const wordIndex = Number(button.dataset.wordIndex);
      const word = normalizeWordEntry(state.turns[turnIndex]?.words?.[wordIndex] || {});
      const suggestions = getWordSuggestions(word);
      state.issueNotice = {
        source: "turn",
        kind: word.isUnclear ? "unclear" : "context",
        title: word.isUnclear ? "ถอดข้อความได้ไม่ชัด" : "ข้อความอาจผิดบริบท",
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
    state.summary = event.target.innerText;
    state.summaryIssues = [];
    state.dismissedSummaryIssueTexts = [];
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
    button.addEventListener("click", () => {
      const issue = getSummaryIssues().find((item) => String(item.index) === String(button.dataset.issueIndex));
      if (!issue) return;
      const word = normalizeWordEntry(issue.word);
      state.issueNotice = {
        source: "summary",
        kind: word.isUnclear ? "unclear" : "context",
        issueIndex: issue.index,
        title: word.isUnclear ? "ถอดข้อความได้ไม่ชัด" : "ข้อความอาจผิดบริบท",
        description: getIssueDescription(word),
        suggestions: getWordSuggestions(word),
        word: word.word.trim(),
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
  document.querySelector("#quota-open-settings")?.addEventListener("click", () => {
    state.quotaNotice = null;
    state.modal = "settings";
    render();
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


