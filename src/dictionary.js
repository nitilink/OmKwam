// Everything about the user-editable term-replacement dictionary: its storage
// key, default content, and the small ad-hoc parser that turns lines like
// "มอไซค์ ให้ใช้ รถจักรยานยนต์" into { keyword, term } rules used both in the
// summary prompt and in the local (no-API-key) fallback summarizer.

export const DICTIONARY_STORAGE_KEY = "omkwam.byok.dictionary.v2";

export const DEFAULT_DICTIONARY = `-"มอเตอร์ไซค์", "มอไซค์", "รถเครื่อง" ให้ใช้ "รถจักรยานยนต์"
-"แฟน" ให้ใช้ "คนรัก"
-"เซเว่น" ให้ใช้ "ร้านสะดวกซื้อเซเว่น อีเลฟเว่น"
-"ปั๊มน้ำมัน" ให้ใช้ "สถานีบริการน้ำมัน"
-"[เวลา]โมง" ให้ใช้ "[เวลา]นาฬิกา"
-"[เวลา]ทุ่ม" ให้ใช้ "[เวลา]นาฬิกา"
-"โรงพัก" ให้ใช้ "สถานีตำรวจ"
-"ยาบ้า" ให้ใช้ "เมทแอมเฟตามีนชนิดเม็ด (ยาบ้า) อันเป็นยาเสพติดให้โทษในประเภท ๑" เป็นชื่อเต็มแค่เพียงครั้งแรกของการสรุป ถัดจากนั้นให้ใช้เพียง "เมทแอมเฟตามีน"
-"ยาไอซ์" ให้ใช้ "เมทแอมเฟตามีนชนิดเกล็ด (ยาไอซ์) อันเป็นยาเสพติดให้โทษในประเภท ๑" เป็นชื่อเต็มแค่เพียงครั้งแรกของการสรุป ถัดจากนั้นให้ใช้เพียง "เมทแอมเฟตามีน"

-"ตัวเลข" ให้ใช้ "ตัวอักษรเลขไทย" เสมอ เช่น 12 ให้ใช้ ๑๒
-"เอกสารฝ่ายโจทก์" ให้ใช้ "เอกสารหมาย จ.[ตัวเลข]" เช่น เอกสารหมาย จ.๒
-"เอกสารฝ่ายจำเลย" ให้ใช้ "เอกสารหมาย ล.[ตัวเลข]" เช่น เอกสารหมาย ล.๓
-"การอ้างส่งเอกสารใหม่" ให้ใช้ "ตามเอกสารที่ผู้ถามให้ดู อ้างส่ง ศาลรับไว้หมาย [จ./ล.]" และไม่ต้องใส่วงเล็บเพื่อประกอบการกระทำในกรณีนี้`;

export function cleanDictionaryText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeConfigLine(line) {
  return String(line).trim().replace(/^[-*•]\s*/, "").trim();
}

export function dictionaryRuleMatch(line) {
  return normalizeConfigLine(line).match(/^(.+?)\s*(?:ให้ใช้คำว่า|ให้ใช้|=>|->|=|:)\s*(.+)$/);
}

export function parseDictionaryRules(text) {
  return String(text)
    .split(/\r?\n/)
    .map(normalizeConfigLine)
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
    .flatMap((line, index) => {
      const match = dictionaryRuleMatch(line);
      if (!match) return [];
      // Quotes are stripped per keyword *after* splitting on commas: stripping
      // them from the whole list first would leave inner quotes behind on
      // every item except the first and last (`"ก", "ข"` -> `ก", "ข`).
      const rawKeyword = match[1].trim();
      const term = match[2].replace(/^["'“”]+|["'“”]+$/g, "").trim();
      if (!rawKeyword || !term) return [];
      return rawKeyword
        .split(/\s*,\s*/)
        .map((keyword) => keyword.replace(/^["'“”]+|["'“”]+$/g, "").trim())
        .filter(Boolean)
        .map((keyword, keywordIndex) => ({ id: `dict-${index}-${keywordIndex}-${keyword}`, keyword, term, description: line }));
    })
    .filter(Boolean);
}
