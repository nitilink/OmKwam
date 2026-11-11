// Low-level Gemini HTTP client: request/response plumbing, the Files API
// upload+poll flow, error classification (quota/capacity/etc.), and
// cancellation helpers. No prompt text lives here - see prompts.js for that.
// No UI/state mutation happens here either, beyond reading the API key/model
// the user configured.

import { state, DEFAULT_MODEL, getEffectiveModel } from "./state.js?v=0.39.19";
import { buildNoCacheDirective } from "./prompts.js?v=0.39.19";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_FILES_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/files";
export const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 90 * 1000;
export const GEMINI_FILE_POLL_INTERVAL_MS = 2000;

export function isCancelError(error) {
  return error?.isCancelled || error?.name === "AbortError";
}

export function makeCancelError() {
  const error = new Error("หยุดงานแล้ว");
  error.isCancelled = true;
  return error;
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw makeCancelError();
}

export function wait(ms, signal) {
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

export function makeRequestId(prefix = "omkwam") {
  const randomPart = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

export function isQuotaMessage(message) {
  return /quota|rate.?limit|free_tier_requests|429|exceeded/i.test(String(message || ""));
}

export function isCapacityMessage(message) {
  return /high demand|spikes? in demand|currently experiencing high demand|try again later|overloaded|503/i.test(String(message || ""));
}

export function makeGeminiError(message, status = 0, details = {}) {
  const error = new Error(message || `Gemini API error ${status}`);
  error.status = status;
  error.retryAfter = details.retryAfter || "";
  error.isQuota = status === 429 || isQuotaMessage(message);
  error.isCapacity = status === 503 || isCapacityMessage(message);
  return error;
}

export function safeJsonParse(text) {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export function parseGeminiText(payload) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error(payload?.promptFeedback?.blockReason || payload?.error?.message || "Gemini ไม่ส่งผลลัพธ์กลับมา");
  }
  return text;
}

export function buildTranscriptionMediaParts({ audioBase64 = "", mimeType = "", fileUri = "", fileMimeType = "" }) {
  const hasAudio = Boolean(audioBase64 && mimeType);
  const hasFile = Boolean(fileUri && fileMimeType);
  const parts = [];
  if (hasAudio) {
    parts.push({ inlineData: { mimeType, data: audioBase64 } });
  }
  if (hasFile) {
    parts.push({ fileData: { mimeType: fileMimeType, fileUri } });
  }
  return { parts, hasAudio, hasFile };
}

export async function callGemini(parts, responseMimeType, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");

  const model = encodeURIComponent(String(options.model || getEffectiveModel()).trim() || getEffectiveModel());
  const requestId = options.requestId || makeRequestId("gemini");
  const requestParts = [...parts, { text: buildNoCacheDirective(requestId) }];
  throwIfCancelled(options.signal);
  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    signal: options.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: requestParts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType,
        // Raise the ceiling so long court-style summaries are less likely to be
        // truncated silently at the API default output limit.
        maxOutputTokens: 65536,
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

// Cheapest possible "is this key real?" probe: a GET on the models list.
// Deliberately not a generateContent call - listing models consumes no tokens
// and no quota, so the user can paste a key and know within a second whether
// it works, instead of finding out after a long transcription fails.
// Returns true/false rather than throwing for auth failures, since "the key is
// bad" is an expected answer here; only network/unexpected faults throw.
export async function verifyApiKey(apiKeyValue = state.apiKey, options = {}) {
  const apiKey = String(apiKeyValue || "").trim();
  if (!apiKey) return { ok: false, reason: "empty" };
  const response = await fetch(`${GEMINI_ENDPOINT}?pageSize=1`, {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
    headers: { "x-goog-api-key": apiKey },
  });
  if (response.ok) return { ok: true, reason: "" };
  const payload = await response.json().catch(() => ({}));
  const message = payload?.error?.message || `HTTP ${response.status}`;
  // A rate-limited key is still a valid key - don't scare the user off it.
  if (response.status === 429) return { ok: true, reason: "quota", message };
  return { ok: false, reason: response.status === 400 || response.status === 401 || response.status === 403 ? "invalid" : "error", message };
}


// Returns model ids the current API key can see (e.g. "models/gemini-3.8-flash").
// Used to soft-validate a user-typed custom model id after key verification.
export async function listGeminiModelIds(apiKeyValue = state.apiKey, options = {}) {
  const apiKey = String(apiKeyValue || "").trim();
  if (!apiKey) return [];
  const ids = [];
  let pageToken = "";
  // Cap pages so a huge catalog cannot hang the settings UI.
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(GEMINI_ENDPOINT);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: options.signal,
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw makeGeminiError(payload?.error?.message || `Gemini models list error ${response.status}`, response.status);
    }
    const payload = await response.json().catch(() => ({}));
    for (const model of payload.models || []) {
      const name = String(model?.name || "");
      const id = name.includes("/") ? name.split("/").pop() : name;
      if (id) ids.push(id);
    }
    pageToken = String(payload.nextPageToken || "");
    if (!pageToken) break;
  }
  return ids;
}

export async function getGeminiFileStatus(fileName, options = {}) {
  const apiKey = state.apiKey.trim();
  if (!apiKey) throw new Error("กรุณาใส่ Gemini API key ก่อนใช้งาน");
  const cleanName = String(fileName || "").replace(/^\/+/, "");
  if (!cleanName) throw new Error("Gemini Files API ไม่ส่ง file name กลับมา");
  const fileId = cleanName.split("/").pop();
  const response = await fetch(`${GEMINI_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`, {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
    headers: { "x-goog-api-key": apiKey },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeGeminiError(payload?.error?.message || `Gemini file status error ${response.status}`, response.status, {
      retryAfter: response.headers.get("retry-after") || "",
    });
  }
  return payload.file || payload;
}

export async function waitForGeminiFileActive(uploaded, options = {}) {
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

export async function uploadAudioFileToGemini(file, mimeType, options = {}) {
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
