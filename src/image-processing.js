// Client-side helpers for document (image / PDF) import: classify files,
// natural-sort names, split PDFs into page images, and shrink photos before
// they are sent to Gemini. HEIC is left as-is (the API accepts it; many
// browsers cannot preview it).

import { getFileExtension } from "./utils.js?v=0.39.11";

export const IMAGE_MAX_EDGE = 2400;
export const IMAGE_JPEG_QUALITY = 0.85;
export const IMAGE_CROP_JPEG_QUALITY = 0.92;
export const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
export const AUDIO_VIDEO_EXTENSIONS = new Set([
  "mp3", "mpeg", "mpga", "ds", "dss", "ds2", "aac", "m4a", "wav", "wave",
  "flac", "ogg", "oga", "opus", "aiff", "aif", "mp4", "mov", "avi", "webm",
  "mpg", "mpeg", "wmv", "flv", "3gp",
]);

// These lists are kept for reference. The "เลือกไฟล์" input itself omits
// accept so Android Chrome and iOS Safari are more likely to open a
// multi-select picker (a mixed audio+image+PDF accept often forces
// single-file mode or skips the Photos library). Unsupported types are
// still rejected in handleImportedFiles. Audio still uses only the first file.
const DOCUMENT_IMPORT_ACCEPT_LIST = [
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "image/*", "application/pdf",
];
const AUDIO_IMPORT_ACCEPT_LIST = [
  ".mp3", ".mpeg", ".mpga", ".ds", ".dss", ".ds2", ".aac", ".m4a", ".wav",
  ".flac", ".ogg", ".aiff", ".aif", ".mp4", ".mov", ".avi", ".webm", ".mpg",
  ".wmv", ".flv", ".3gp",
  "audio/*", "video/*",
];

export const DOCUMENT_IMPORT_ACCEPT = DOCUMENT_IMPORT_ACCEPT_LIST.join(",");
export const AUDIO_IMPORT_ACCEPT = AUDIO_IMPORT_ACCEPT_LIST.join(",");
export const MEDIA_IMPORT_ACCEPT = [...AUDIO_IMPORT_ACCEPT_LIST, ...DOCUMENT_IMPORT_ACCEPT_LIST].join(",");

let pdfjsModulePromise = null;

export function naturalCompareNames(a, b) {
  return String(a || "").localeCompare(String(b || ""), "th", { numeric: true, sensitivity: "base" });
}

export function sortFilesByName(files) {
  return [...(files || [])].sort((left, right) => naturalCompareNames(left?.name, right?.name));
}

function cleanMime(fileOrBlob) {
  return String(fileOrBlob?.type || "").split(";")[0].trim().toLowerCase();
}

export function isPdfFile(fileOrBlob) {
  const mime = cleanMime(fileOrBlob);
  return mime === "application/pdf" || getFileExtension(fileOrBlob) === "pdf";
}

export function isHeicFile(fileOrBlob) {
  const mime = cleanMime(fileOrBlob);
  const ext = getFileExtension(fileOrBlob);
  return ext === "heic" || ext === "heif" || mime === "image/heic" || mime === "image/heif";
}

export function isImageFile(fileOrBlob) {
  if (isPdfFile(fileOrBlob)) return false;
  const mime = cleanMime(fileOrBlob);
  const ext = getFileExtension(fileOrBlob);
  if (IMAGE_MIME_TYPES.has(mime) || IMAGE_EXTENSIONS.has(ext)) return true;
  return mime.startsWith("image/") && !mime.includes("svg");
}

export function isAudioOrVideoFile(fileOrBlob) {
  if (isPdfFile(fileOrBlob) || isImageFile(fileOrBlob)) return false;
  const mime = cleanMime(fileOrBlob);
  const ext = getFileExtension(fileOrBlob);
  return mime.startsWith("audio/") || mime.startsWith("video/") || AUDIO_VIDEO_EXTENSIONS.has(ext);
}

export function classifyImportFile(fileOrBlob) {
  if (!fileOrBlob) return "unknown";
  if (isPdfFile(fileOrBlob)) return "pdf";
  if (isImageFile(fileOrBlob)) return "image";
  if (isAudioOrVideoFile(fileOrBlob)) return "audio";
  return "unknown";
}

// Identity for skipping exact re-imports of the same File (name + size + lastModified).
export function importFileKey(file) {
  if (!file) return "";
  return `${String(file.name || "")}\0${Number(file.size) || 0}\0${Number(file.lastModified) || 0}`;
}

export function filterNewDocumentFiles(files, existingPages = []) {
  const seen = new Set((existingPages || []).map((page) => page.sourceKey).filter(Boolean));
  const kept = [];
  let skippedDuplicates = 0;
  for (const file of files || []) {
    const key = importFileKey(file);
    if (key && seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    if (key) seen.add(key);
    kept.push(file);
  }
  return { files: kept, skippedDuplicates };
}

export function getImageMimeType(fileOrBlob) {
  const mime = cleanMime(fileOrBlob);
  if (mime === "image/jpg") return "image/jpeg";
  if (IMAGE_MIME_TYPES.has(mime)) return mime;
  const ext = getFileExtension(fileOrBlob);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return mime || "image/jpeg";
}

export function makePageId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `page-${crypto.randomUUID()}`;
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function revokePagePreview(page) {
  if (page?.previewUrl && String(page.previewUrl).startsWith("blob:")) {
    try { URL.revokeObjectURL(page.previewUrl); } catch { /* ignore */ }
  }
  if (page) {
    page.previewUrl = "";
    page.previewable = false;
  }
}

async function canPreviewImage(url) {
  if (!url) return false;
  if (typeof Image === "undefined") return true;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

export async function attachPreview(page) {
  if (page.previewUrl) {
    page.previewable = await canPreviewImage(page.previewUrl);
    if (!page.previewable) {
      revokePagePreview(page);
      page.previewUrl = "";
    }
    return page;
  }
  if (!page.blob) {
    page.previewable = false;
    page.previewUrl = "";
    return page;
  }
  const url = URL.createObjectURL(page.blob);
  const ok = !isHeicFile(page) && await canPreviewImage(url);
  if (ok) {
    page.previewUrl = url;
    page.previewable = true;
  } else {
    URL.revokeObjectURL(url);
    page.previewUrl = "";
    page.previewable = false;
  }
  return page;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    image.src = url;
  });
}

// Shrink a raster image so its long edge is at most IMAGE_MAX_EDGE, JPEG 0.85.
// Never upscales. HEIC is returned unchanged.
export async function compressImageBlob(blob, mimeType = "") {
  if (!blob) return { blob, mimeType: mimeType || "image/jpeg" };
  const type = mimeType || getImageMimeType(blob);
  if (isHeicFile({ type, name: blob.name || "" })) {
    return { blob, mimeType: type };
  }

  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
    }
  } catch {
    bitmap = null;
  }

  let width = bitmap?.width || 0;
  let height = bitmap?.height || 0;
  let source = bitmap;

  if (!width || !height) {
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImageElement(url);
      width = image.naturalWidth || image.width;
      height = image.naturalHeight || image.height;
      source = image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (!width || !height) {
    if (bitmap) bitmap.close?.();
    return { blob, mimeType: type };
  }

  const longEdge = Math.max(width, height);
  const scale = longEdge > IMAGE_MAX_EDGE ? IMAGE_MAX_EDGE / longEdge : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const alreadySmallJpeg = scale === 1 && type === "image/jpeg" && blob.size <= 3 * 1024 * 1024;
  if (alreadySmallJpeg) {
    if (bitmap) bitmap.close?.();
    return { blob, mimeType: type };
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(source, 0, 0, targetW, targetH);
  if (bitmap) bitmap.close?.();

  const compressed = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("ย่อไฟล์รูปไม่สำเร็จ"))),
      "image/jpeg",
      IMAGE_JPEG_QUALITY,
    );
  });
  // Keep the original if compression somehow made it larger and we did not resize.
  if (scale === 1 && compressed.size >= blob.size && type === "image/jpeg") {
    return { blob, mimeType: type };
  }
  return { blob: compressed, mimeType: "image/jpeg" };
}

export async function loadOrientedImage(blob) {
  if (!blob) throw new Error("ไม่มีไฟล์รูปให้ครอบ");
  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
    }
  } catch {
    bitmap = null;
  }
  if (bitmap?.width && bitmap?.height) {
    return { source: bitmap, width: bitmap.width, height: bitmap.height, bitmap };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("อ่านไฟล์รูปไม่สำเร็จ");
    return { source: image, width, height, bitmap: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function boundsOfPath(path) {
  const pts = (path || []).filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
  if (!pts.length) return null;
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (const pt of pts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return { x, y, w: Math.max(1, Math.ceil(maxX) - x), h: Math.max(1, Math.ceil(maxY) - y) };
}

export function clampCropRect(rect, width, height) {
  const maxW = Math.max(1, width);
  const maxH = Math.max(1, height);
  let w = Math.max(1, Math.round(Number(rect?.w) || 0));
  let h = Math.max(1, Math.round(Number(rect?.h) || 0));
  let x = Math.round(Number(rect?.x) || 0);
  let y = Math.round(Number(rect?.y) || 0);
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);
  x = Math.min(Math.max(0, x), maxW - w);
  y = Math.min(Math.max(0, y), maxH - h);
  return { x, y, w, h };
}

function canvasToJpegBlob(canvas, quality = IMAGE_CROP_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("ครอบรูปไม่สำเร็จ"))),
      "image/jpeg",
      quality,
    );
  });
}

// Crop at the source blob's native resolution (already EXIF-baked the same
// way as compressImageBlob). Rectangle keeps only the box. Freestyle cuts to
// the path's bounding box and fills pixels outside the path with black.
export async function cropImageBlob(blob, options = {}) {
  const loaded = await loadOrientedImage(blob);
  const { source, width, height, bitmap } = loaded;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (options.mode === "free") {
      const pts = (options.path || [])
        .map((pt) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
        .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
      if (pts.length < 3) throw new Error("ลากเส้นรอบบริเวณที่ต้องการเก็บ");
      const bbox = boundsOfPath(pts);
      if (!bbox) throw new Error("ลากเส้นรอบบริเวณที่ต้องการเก็บ");
      const rect = clampCropRect(bbox, width, height);
      canvas.width = rect.w;
      canvas.height = rect.h;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, rect.w, rect.h);
      ctx.save();
      ctx.beginPath();
      pts.forEach((pt, index) => {
        const x = pt.x - rect.x;
        const y = pt.y - rect.y;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(source, -rect.x, -rect.y);
      ctx.restore();
      const out = await canvasToJpegBlob(canvas);
      return { blob: out, mimeType: "image/jpeg", width: rect.w, height: rect.h };
    }
    const rect = clampCropRect(options.rect, width, height);
    canvas.width = rect.w;
    canvas.height = rect.h;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.w, rect.h);
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const out = await canvasToJpegBlob(canvas);
    return { blob: out, mimeType: "image/jpeg", width: rect.w, height: rect.h };
  } finally {
    bitmap?.close?.();
  }
}

async function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("./vendor/pdfjs/pdf.min.js?v=0.39.11").then((mod) => {
      const workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
      if (mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = workerSrc;
      return mod;
    });
  }
  return pdfjsModulePromise;
}

export async function renderPdfFileToPages(file, options = {}) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const originName = file.name || "document.pdf";
  const pageCount = pdf.numPages || 0;
  if (!pageCount) throw new Error(`ไฟล์ PDF “${originName}” ไม่มีหน้าให้ถอด`);
  const pages = [];
  try {
    for (let number = 1; number <= pageCount; number += 1) {
      options.onProgress?.(number, pageCount, originName);
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = IMAGE_MAX_EDGE / Math.max(base.width, base.height, 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (out) => (out ? resolve(out) : reject(new Error(`เรนเดอร์หน้า ${number} ของ PDF ไม่สำเร็จ`))),
          "image/jpeg",
          IMAGE_JPEG_QUALITY,
        );
      });
      const filename = pageCount > 1 ? `${originName} · หน้า ${number}` : originName;
      const entry = {
        id: makePageId(),
        filename,
        originName,
        sourceKey: importFileKey(file),
        filePageNumber: number,
        filePageCount: pageCount,
        mimeType: "image/jpeg",
        blob,
        originalBlob: blob,
        originalMimeType: "image/jpeg",
        previewUrl: URL.createObjectURL(blob),
        previewable: true,
      };
      pages.push(entry);
    }
  } finally {
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
  return pages;
}

export async function prepareImageFileAsPage(file) {
  const originName = file.name || "image.jpg";
  const originalMime = getImageMimeType(file);
  const compressed = await compressImageBlob(file, originalMime);
  const page = {
    id: makePageId(),
    filename: originName,
    originName,
    sourceKey: importFileKey(file),
    filePageNumber: 1,
    filePageCount: 1,
    mimeType: compressed.mimeType,
    blob: compressed.blob,
    originalBlob: compressed.blob,
    originalMimeType: compressed.mimeType,
    previewUrl: "",
    previewable: false,
  };
  await attachPreview(page);
  return page;
}

// Turns a list of image/PDF File objects into ordered page records.
// `sort` natural-sorts the files first (first import). Later appends skip sort.
export async function filesToDocumentPages(files, options = {}) {
  const list = options.sort ? sortFilesByName(files) : [...(files || [])];
  const pages = [];
  for (const file of list) {
    const kind = classifyImportFile(file);
    if (kind === "pdf") {
      const rendered = await renderPdfFileToPages(file, options);
      pages.push(...rendered);
    } else if (kind === "image") {
      pages.push(await prepareImageFileAsPage(file));
    }
  }
  return pages;
}

export function parseDocumentOcrText(raw) {
  const text = String(raw || "")
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) {
    const error = new Error("Gemini ถอดข้อความสำเร็จแต่ไม่พบข้อความในผลลัพธ์");
    error.isEmptyTranscription = true;
    throw error;
  }
  return text;
}
