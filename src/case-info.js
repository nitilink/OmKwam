// "Case Info" is the limited case context (preliminary facts, case documents,
// proper names) the user can optionally provide to help Gemini spell names and
// group issues correctly. This module owns its storage key, shape, and the two
// text formats it's rendered as: a compact prompt block and a plain export.

import { readStorage, writeStorage } from "./storage.js?v=0.39.12";

export const CASE_INFO_STORAGE_KEY = "omkwam.byok.caseInfo.2026-06-24-v1";

export const DEFAULT_CASE_INFO = {
  facts: "",
  documents: "",
  properNames: "",
};

export function cleanCaseInfoValue(value, maxLength = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeCaseInfo(value = {}) {
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

export function readCaseInfoStorage() {
  try {
    return normalizeCaseInfo(JSON.parse(readStorage(CASE_INFO_STORAGE_KEY, "{}")));
  } catch {
    return { ...DEFAULT_CASE_INFO };
  }
}

export function writeCaseInfoStorage(value) {
  writeStorage(CASE_INFO_STORAGE_KEY, JSON.stringify(normalizeCaseInfo(value)));
}

export function formatCaseInfoForPrompt(info) {
  const clean = normalizeCaseInfo(info);
  const lines = [
    ["รายละเอียดคดีเบื้องต้น", clean.facts],
    ["เอกสารในสำนวน", clean.documents],
    ["ชื่อเฉพาะของบุคคล สิ่งของ หรือสถานที่", clean.properNames],
  ].filter(([, value]) => value);
  return lines.map(([label, value]) => `- ${label}: ${value}`).join("\n");
}

export function formatCaseInfoForExport(info) {
  const clean = normalizeCaseInfo(info);
  return [
    ["รายละเอียดคดีเบื้องต้น", clean.facts],
    ["เอกสารในสำนวน", clean.documents],
    ["ชื่อเฉพาะของบุคคล สิ่งของ หรือสถานที่", clean.properNames],
  ].map(([label, value]) => `${label}\n${value || ""}`.trimEnd()).join("\n\n").trim();
}

export function hasCaseInfoContent(value) {
  const clean = normalizeCaseInfo(value);
  return Boolean(clean.facts || clean.documents || clean.properNames);
}
