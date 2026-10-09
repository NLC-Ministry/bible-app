// Tyndale Open Study Notes（TOSN）匯入工具的共用函式（#471、#476）。
// - parseTosnStudyNotes：從 StudyNotes.xml 取出某一卷的節注釋（英文純文字＋經文範圍）。
// - buildImportSql：把翻好的內容轉成匯入 SQL（待審、未發布；source_ref 已存在就跳過，
//   重跑不會蓋掉審過的內容）。
// 授權：TOSN 是 CC BY-SA 4.0，翻譯是衍生著作，必須標示改編自 TOSN 並註明做了什麼改動。

export const TOSN_ATTRIBUTION = "改編自 Tyndale Open Study Notes（© 2022 Tyndale House Publishers，CC BY-SA 4.0，原著免費提供於 tyndaleopenresources.com），由新生命教會譯為繁體中文，經文用詞對照和合本。";

// TOSN 的書卷代碼，順序同 js/data/bible_data.js 的 BIBLE_BOOKS（創世記 → 啟示錄）。
export const TOSN_BOOK_CODES = Object.freeze([
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "ISam", "IISam", "IKgs", "IIKgs",
  "IChr", "IIChr", "Ezra", "Neh", "Esth", "Job", "Ps", "Pr", "Eccl", "Song", "Isa", "Jer", "Lam",
  "Ezek", "Dan", "Hos", "Joel", "Amos", "Obad", "Jon", "Mic", "Nah", "Hab", "Zeph", "Hagg", "Zech",
  "Mal", "Matt", "Mark", "Luke", "John", "Acts", "Rom", "ICor", "IICor", "Gal", "Eph", "Phil", "Col",
  "IThes", "IIThes", "ITim", "IITim", "Titus", "Phlm", "Heb", "Jas", "IPet", "IIPet", "IJn", "IIJn",
  "IIIJn", "Jude", "Rev"
]);

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&#39;": "'", "&nbsp;": " " };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, entity => ENTITIES[entity] || entity);
}

// 一則注釋的 <body>：每個 <p> 一段；開頭的經文出處（sn-ref）拿掉，其餘標籤只留文字。
export function studyNoteBodyToText(bodyXml) {
  const paragraphs = [];
  for (const match of String(bodyXml || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntities(match[1]
      .replace(/<span class="sn-ref">[\s\S]*?<\/span>/, "")
      .replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

// "Lev.1.3-17" → 同一章；"Lev.1.1-7.38" → 跨章（掛在起始節，標題寫原範圍）。
export function parseTosnRef(ref, bookCode) {
  const match = String(ref || "").match(new RegExp(`^${bookCode}\\.(\\d+)\\.(\\d+)(?:-(?:(\\d+)\\.)?(\\d+))?$`));
  if (!match) return null;
  const chapter = Number(match[1]);
  const verseStart = Number(match[2]);
  const endChapter = match[3] ? Number(match[3]) : chapter;
  const verseEnd = match[4] ? Number(match[4]) : verseStart;
  if (endChapter !== chapter) {
    return {
      chapter, verse_start: verseStart, verse_end: verseStart, cross_chapter: true,
      range: `${chapter}:${verseStart}–${endChapter}:${verseEnd}`
    };
  }
  return {
    chapter, verse_start: verseStart, verse_end: verseEnd, cross_chapter: false,
    range: verseStart === verseEnd ? `${chapter}:${verseStart}` : `${chapter}:${verseStart}-${verseEnd}`
  };
}

export function parseTosnStudyNotes(xml, bookCode) {
  const notes = [];
  const pattern = new RegExp(`<item name="(${bookCode}\\.[^"]+)"[^>]*>[\\s\\S]*?<body>([\\s\\S]*?)<\\/body>`, "g");
  for (const match of String(xml || "").matchAll(pattern)) {
    const position = parseTosnRef(match[1], bookCode);
    if (!position) throw new Error(`看不懂的經文範圍：${match[1]}`);
    notes.push({ ref: match[1], ...position, en: studyNoteBodyToText(match[2]) });
  }
  return notes;
}

// 重新取出時保留已經翻好的中文（依 ref 對應）。
export function mergeTranslations(extracted, existing) {
  const previous = new Map((existing || []).map(note => [note.ref, note]));
  return extracted.map(note => {
    const old = previous.get(note.ref);
    return { ...note, title: old?.title ?? (note.cross_chapter ? `${note.range} 總覽` : ""), zh: old?.zh ?? "" };
  });
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

// 每 50 則一個 INSERT；source_ref 已存在就略過（重跑不會蓋掉審過的內容）。
export function buildImportSql(file, { batchSize = 50 } = {}) {
  const book = String(file?.book || "").trim();
  if (!book) throw new Error("缺少書卷名稱（book）");
  const notes = Array.isArray(file?.notes) ? file.notes : [];
  const missing = notes.filter(note => !String(note.zh || "").trim()).map(note => note.ref);
  if (missing.length) throw new Error(`還有 ${missing.length} 則沒有譯文：${missing.slice(0, 5).join("、")}${missing.length > 5 ? "…" : ""}`);
  const source = String(file.attribution || TOSN_ATTRIBUTION);
  const statements = [];
  for (let i = 0; i < notes.length; i += batchSize) {
    const values = notes.slice(i, i + batchSize).map(note => `  (${[
      sqlString(book), Number(note.chapter), Number(note.verse_start), Number(note.verse_end),
      sqlString(String(note.title || "").trim()), sqlString(String(note.zh).trim()), "'{}'::text[]",
      sqlString(source), sqlString(note.en || ""), sqlString(`TOSN:${note.ref}`), "FALSE", "'pending'"
    ].join(", ")})`);
    statements.push(`INSERT INTO public.passage_commentary
  (book, chapter, verse_start, verse_end, title, content, topic_tags, source, source_text, source_ref, is_published, review_status)
VALUES
${values.join(",\n")}
ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;`);
  }
  return `-- 經文注釋匯入：${book}（${notes.length} 則，Tyndale Open Study Notes 譯文，待審、未發布）\nBEGIN;\n${statements.join("\n\n")}\nCOMMIT;\n`;
}
