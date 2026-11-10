// Small helper functions used across the app: HTML escaping, file downloads,
// audio MIME/extension guessing, and misc formatting. None of these read or
// write `state` - they're pure functions or thin DOM wrappers.

import { EXTERNAL_CONVERSION_AUDIO_EXTENSIONS } from "./state.js?v=0.39.12";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cloneStateValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function formatDownloadTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

export function withDownloadTimestamp(filename) {
  const clean = String(filename || "omkwam.txt");
  const dotIndex = clean.lastIndexOf(".");
  const stamp = formatDownloadTimestamp();
  if (dotIndex <= 0) return `${clean}_${stamp}`;
  return `${clean.slice(0, dotIndex)}_${stamp}${clean.slice(dotIndex)}`;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = withDownloadTimestamp(filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadBlob(filename, blob);
}

export function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60).toString().padStart(2, "0");
  const secs = Math.floor(total % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export function formatRecordingTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export function getFileExtension(fileOrBlob) {
  const name = String(fileOrBlob?.name || "").toLowerCase();
  return name.includes(".") ? name.split(".").pop() : "";
}

const AUDIO_EXTENSION_BY_MIME_TYPE = {
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
  // Video containers Gemini can also transcribe directly (it reads the audio
  // track), so an imported file can legitimately have one of these types too.
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/3gpp": "3gp",
  "video/x-flv": "flv",
};

const AUDIO_MIME_TYPE_BY_EXTENSION = {
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
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
  // .mp4 without a browser-reported type is far more likely to be a video
  // container than an audio-only one (audio-only files are almost always
  // .m4a instead), so this fallback assumes video/mp4.
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
  flv: "video/x-flv",
};

export function audioExtensionFromMimeType(mimeType = "") {
  const clean = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_EXTENSION_BY_MIME_TYPE[clean] || "webm";
}

export function getAudioMimeType(fileOrBlob) {
  const rawType = String(fileOrBlob?.type || "").trim();
  if (rawType) return rawType;
  return AUDIO_MIME_TYPE_BY_EXTENSION[getFileExtension(fileOrBlob)] || "application/octet-stream";
}

export function needsExternalAudioConversion(fileOrBlob) {
  return EXTERNAL_CONVERSION_AUDIO_EXTENSIONS.has(getFileExtension(fileOrBlob));
}

export function formatExternalAudioConversionMessage(fileOrBlob) {
  const extension = getFileExtension(fileOrBlob) || "ds";
  return `ไม่สามารถถอดไฟล์เสียง .${extension} ได้ กรุณาแปลงเป็นไฟล์เสียง .wav, .mp3 หรือ .m4a แล้วใช้งานใหม่อีกครั้ง`;
}

export function formatAudioInfo(blob, mimeType) {
  const sizeKb = Math.max(1, Math.round(blob.size / 1024));
  if (needsExternalAudioConversion(blob)) {
    return `DSS/DS2 · ${sizeKb.toLocaleString()} KB · ไม่รองรับการถอดเสียง`;
  }
  const type = mimeType || getAudioMimeType(blob);
  return `${type} · ${sizeKb.toLocaleString()} KB`;
}

export function fileToBase64(file) {
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
