// 翻譯參考資料（#542）：只給譯者參考，不放進注釋內文、不在 App 顯示。下載的檔案快取在
// .cache/commentary/（不進版控）。
// - 和合本＋Strong's 編號：信望愛 qb.php（strong=1&version=unv），FDL 授權。按章抓、限速、快取。
// - 當代譯本繁體版：ebible.org 的 cmncbt_usfm.zip（Biblica，CC BY-SA 4.0）。只當參考，不散布。
// - Strong's 詞典（拼音、英文字義）：Open Scriptures strongs（CC BY-SA）。用來把 TOSN 寫的
//   原文字拼音（例如 tsara‘at）對到這幾節實際出現的 Strong's 編號，再對到和合本用詞。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { REPO_ROOT } from "./tosn-books.mjs";

export const CACHE_DIR = join(REPO_ROOT, ".cache", "commentary");
export const FHL_ENDPOINT = "https://bible.fhl.net/json/qb.php";
export const CCB_ZIP_URL = "https://ebible.org/Scriptures/cmncbt_usfm.zip";
export const LEXICON_URLS = Object.freeze({
  hebrew: "https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js",
  greek: "https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js"
});
export const CCB_NOTICE = "當代譯本繁體版（Copyright © 1979, 2005, 2007, 2012, 2023 Biblica, Inc.，CC BY-SA 4.0，ebible.org cmncbt）——僅供翻譯參考，不得放進注釋內文。";
export const FHL_NOTICE = "和合本 Strong's 編號：信望愛聖經網站 bible.fhl.net（FDL）——僅供翻譯參考。";

// USFM 書卷代碼，順序同 BIBLE_BOOKS。
export const USFM_BOOK_CODES = Object.freeze([
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH",
  "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS",
  "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK",
  "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT",
  "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"
]);

// ── 信望愛：和合本＋Strong's ───────────────────────────────────────────
const CJK_PUNCTUATION = /[\s「」『』，。、：；！？（）《》〈〉…—．·,.;:!?()]/;

// "大痲瘋<WH06883>的災病<WAH09001><WH05061>" → 純文字＋[{ word, strong }]。
// {<WAH0413>} 是和合本沒有譯出的字；<WTH8804> 是詞態；9000 以上是前置詞代碼，都略過。
export function parseStrongText(bibleText) {
  if (String(bibleText || "").trim() === "a") return { text: "（併於上節）", words: [] }; // 信望愛的併節
  const source = String(bibleText || "").replace(/\{[^}]*\}/g, "");
  const words = [];
  let text = "";
  let pending = "";
  for (const match of source.matchAll(/<W(T?)(A?)([HG])(\d+)>|([^<]+)|</g)) {
    if (match[5] !== undefined || match[0] === "<") {
      const piece = match[5] ?? "<";
      text += piece;
      const parts = piece.split(CJK_PUNCTUATION);
      pending = parts[parts.length - 1];
      continue;
    }
    if (match[1]) continue; // 詞態
    const number = Number(match[4]);
    if (match[3] === "H" && number >= 9000) continue;
    if (pending) words.push({ word: pending, strong: `${match[3]}${number}` });
  }
  return { text: text.replace(/\s+/g, ""), words };
}

export function formatStrongWords(words) {
  return (words || []).map(item => `${item.word}=${item.strong}`).join(" ");
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 一章：Map(節 → { text, words })。快取在 .cache/commentary/fhl/<書>/<章>.json。
export async function fetchFhlStrongChapter(book, chapter, { fetchImpl = fetch, delayMs = 400, cacheDir = CACHE_DIR } = {}) {
  const dir = join(cacheDir, "fhl", book.eng.replace(/\s+/g, "_"));
  const path = join(dir, `${chapter}.json`);
  let records;
  if (existsSync(path)) {
    records = JSON.parse(readFileSync(path, "utf8"));
  } else {
    const params = new URLSearchParams({ chineses: book.abbrev, chap: String(chapter), strong: "1", version: "unv", gb: "0" });
    const response = await fetchImpl(`${FHL_ENDPOINT}?${params.toString()}`);
    const payload = await response.json();
    if (!payload || payload.status !== "success" || !Array.isArray(payload.record)) {
      throw new Error(`信望愛 ${book.name} ${chapter} 章讀取失敗`);
    }
    records = payload.record.map(record => ({ verse: Number(record.sec), bible_text: record.bible_text }));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(records), "utf8");
    await sleep(delayMs);
  }
  return new Map(records.filter(record => record.verse > 0).map(record => [record.verse, parseStrongText(record.bible_text)]));
}

// 整卷：Map(章 → Map(節 → { text, words }))。
export async function loadFhlStrongBook(book, options = {}) {
  const chapters = new Map();
  for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
    chapters.set(chapter, await fetchFhlStrongChapter(book, chapter, options));
  }
  return chapters;
}

// ── 當代譯本（USFM）───────────────────────────────────────────────────
const SKIP_LINE = /^\\(?:s\d?|ms\d?|mr|r|d|h|toc\d?|mt\d?|id|ide|rem|sp|qa|cl|cp|is\d?|ip|imt\d?|io\d?|iot|usfm|sts)\b/;
const PARAGRAPH_MARKER = /^\\(?:p|q\d?|qc|qr|qm\d?|m|mi|pi\d?|li\d?|nb|pc|pm|pmo|b)\b\s?/;

// 一卷 USFM → Map("章:節" → 經文)。註腳、交叉引用、標題都拿掉；併節（\v 3-4）兩節都放同一段並註明。
export function parseUsfmBook(usfm) {
  const lines = String(usfm || "")
    .replace(/\\f\s[\s\S]*?\\f\*/g, "")
    .replace(/\\x\s[\s\S]*?\\x\*/g, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !SKIP_LINE.test(line))
    .map(line => line.replace(PARAGRAPH_MARKER, ""));
  const verses = new Map();
  let chapter = 0;
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = current.text.replace(/\\\+?[a-z0-9]+\*?\s?/g, "").replace(/\s+/g, "").trim();
    for (let verse = current.from; verse <= current.to; verse += 1) {
      verses.set(`${chapter}:${verse}`, current.to > current.from ? `（${current.from}-${current.to}節）${text}` : text);
    }
    current = null;
  };
  for (const piece of lines.join(" ").split(/(?=\\c\s+\d+)|(?=\\v\s+\d+)/)) {
    const chapterMatch = piece.match(/^\\c\s+(\d+)/);
    if (chapterMatch) {
      flush();
      chapter = Number(chapterMatch[1]);
      continue;
    }
    const verseMatch = piece.match(/^\\v\s+(\d+)(?:-(\d+))?\s?([\s\S]*)$/);
    if (verseMatch) {
      flush();
      current = { from: Number(verseMatch[1]), to: Number(verseMatch[2] || verseMatch[1]), text: verseMatch[3] };
    } else if (current) {
      current.text += piece;
    }
  }
  flush();
  return verses;
}

// 最小的 zip 解壓（只取檔名結尾符合的檔案）：Windows 上 Git Bash 的 tar 不認得 zip，
// 不靠外部工具。回傳 Map(檔名 → Buffer)。
export function readZipEntries(buffer, accept = () => true) {
  const entries = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("不是 zip 檔");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip 目錄損壞");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || !accept(name)) continue;
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`不支援的壓縮方式：${name}`);
  }
  return entries;
}

async function download(url, path, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）：${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

// 下載並解壓到 .cache/commentary/ccb/（只做一次），回傳這一卷的 Map。
export async function loadCcbBook(bookIndex, { fetchImpl = fetch, cacheDir = CACHE_DIR } = {}) {
  const dir = join(cacheDir, "ccb");
  const extracted = join(dir, "usfm");
  if (!existsSync(extracted) || !readdirSync(extracted).length) {
    mkdirSync(extracted, { recursive: true });
    const zip = join(dir, "cmncbt_usfm.zip");
    if (!existsSync(zip)) await download(CCB_ZIP_URL, zip, fetchImpl);
    for (const [name, data] of readZipEntries(readFileSync(zip), file => /\.usfm$/i.test(file))) {
      writeFileSync(join(extracted, basename(name)), data);
    }
  }
  const code = USFM_BOOK_CODES[bookIndex];
  const name = readdirSync(extracted).find(file => file.toUpperCase().endsWith(".USFM") && file.slice(3, 6).toUpperCase() === code);
  if (!name) throw new Error(`當代譯本沒有這一卷：${code}`);
  return parseUsfmBook(readFileSync(join(extracted, name), "utf8"));
}

// ── Strong's 詞典與拼音比對 ─────────────────────────────────────────────
export function parseLexiconScript(source) {
  const text = String(source || "");
  const start = text.indexOf("{", text.indexOf("="));
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

// { H6883: { xlit, lemma, gloss, kjv }, G26: {...} }
export async function loadLexicon({ fetchImpl = fetch, cacheDir = CACHE_DIR } = {}) {
  const dir = join(cacheDir, "lexicon");
  mkdirSync(dir, { recursive: true });
  const lexicon = {};
  for (const [lang, url] of Object.entries(LEXICON_URLS)) {
    const path = join(dir, `${lang}.js`);
    if (!existsSync(path)) await download(url, path, fetchImpl);
    for (const [key, entry] of Object.entries(parseLexiconScript(readFileSync(path, "utf8")))) {
      lexicon[key] = {
        xlit: entry.xlit || entry.translit || "",
        lemma: entry.lemma || "",
        gloss: String(entry.strongs_def || entry.kjv_def || "").trim(),
        kjv: String(entry.kjv_def || "").trim()
      };
    }
  }
  return lexicon;
}

// 拼音正規化：去掉附加符號與撇號，統一 kh/ch、th/t、ph/p、v/b、雙寫字母。
export function normalizeTranslit(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’ʻʼʾʿ'`´·.\-\s]/g, "")
    .replace(/ch/g, "kh")
    .replace(/([tpbgdk])h/g, (whole, letter) => (letter === "k" ? whole : letter))
    .replace(/[vw]/g, "b")
    .replace(/iy/g, "i")
    .replace(/(.)\1+/g, "$1");
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

export function translitSimilarity(a, b) {
  const x = normalizeTranslit(a);
  const y = normalizeTranslit(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export const TRANSLIT_MATCH_THRESHOLD = 0.7;

// TOSN 的拼音（可能是「ha-’adam」「tohu . . . bohu」）→ 只在這幾節出現過的編號裡找最像的。
// candidates：Map(strong → [和合本用詞…])。對不到的回 { translit, strong: null }，留給譯者判斷。
export function matchOriginalWords(words, candidates, lexicon) {
  const results = [];
  for (const { lang, text } of words || []) {
    const parts = String(text).split(/\s*\.\s*\.\s*\.\s*|\s+/).map(part => part.replace(/[,;]+$/, "")).filter(Boolean);
    for (const part of parts) {
      const forms = [part, part.replace(/^[a-z]{1,3}-/i, "")];
      let best = null;
      for (const [strong, cuvWords] of candidates || []) {
        if ((lang === "greek") !== strong.startsWith("G")) continue;
        const entry = lexicon?.[strong];
        if (!entry?.xlit) continue;
        const score = Math.max(...forms.map(form => translitSimilarity(form, entry.xlit)));
        if (!best || score > best.score) best = { strong, score, entry, cuvWords };
      }
      if (best && best.score >= TRANSLIT_MATCH_THRESHOLD) {
        results.push({ translit: part, strong: best.strong, xlit: best.entry.xlit, gloss: best.entry.gloss, cuv: best.cuvWords.slice(0, 3) });
      } else {
        results.push({ translit: part, strong: null });
      }
    }
  }
  return results;
}
