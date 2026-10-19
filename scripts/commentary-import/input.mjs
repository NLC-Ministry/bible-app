// 翻譯輸入檔（#542）：每則注釋附上預處理稿、被解釋的片語、這幾節的和合本＋Strong's 用詞對照、
// 當代譯本經文、原文字拼音對到的編號與和合本用詞、相關的用語表條目。純函式，prepare.mjs 負責抓資料。

import { noteVerses } from "./tosn.mjs";
import { CCB_NOTICE, FHL_NOTICE, formatStrongWords, matchOriginalWords, normalizeTranslit } from "./sources.mjs";

export const MAX_INPUT_VERSES = 20;

export const TRANSLATION_INSTRUCTIONS = Object.freeze([
  "每則把 en 譯成繁體中文，寫進 content/commentary/tosn/<書>.json 同一則的 zh（跨章總覽可以改 title）。",
  "en 裡已經換成中文的經文出處（出27:21、5:17-19、第16章）照抄，不要改寫；閱讀器靠這些寫法做成可點的連結。",
  "excerpts 是被解釋的經文片語：從 verses 的和合本（cuv）找出對應字句，用「」框起來；heading 為 true 的寫成「片語」：說明。",
  "original_words 是 TOSN 提到的原文字：strong 有值的，用 cuv 列出的和合本用詞；沒有值的自己判斷。",
  "glossary 是用語表裡跟這則有關的條目，照用。ccb（當代譯本）只幫助理解和合本較古的文句，不要照抄進譯文。",
  "譯完跑 node scripts/commentary-import/align.mjs <書名>：出處寫法對齊譯文、片語填上和合本字句。"
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 用語表裡出現在這則英文（或原文字拼音相同）的條目。
export function glossaryHits(note, glossary) {
  const en = String(note.en || "");
  const words = new Set((note.original_words || []).map(word => normalizeTranslit(word.text)));
  const hits = [];
  for (const term of glossary?.terms || []) {
    const byEn = term.en && new RegExp(`(^|[^A-Za-z])${escapeRegExp(term.en)}(?:s|es)?(?![A-Za-z])`, "i").test(en);
    const byTranslit = term.translit && words.has(normalizeTranslit(term.translit));
    if (byEn || byTranslit) {
      const hit = { en: term.en, zh: term.zh };
      if (term.strong) hit.strong = term.strong;
      if (term.note) hit.note = term.note;
      hits.push(hit);
    }
  }
  return hits;
}

// 範圍不長就附每一節；太長（跨章總覽、整章導讀）只附起始節，避免輸入檔爆量。
export function inputVerses(note, verseCounts) {
  const all = noteVerses(note, verseCounts);
  return all.length <= MAX_INPUT_VERSES ? { verses: all, truncated: false } : { verses: all.slice(0, 1), truncated: true };
}

// cuv：Map(章 → Map(節 → { text, words }))；ccb：Map("章:節" → 經文)。
export function buildNoteInput(note, { cuv, ccb, lexicon, glossary, verseCounts = [] }) {
  const { verses, truncated } = inputVerses(note, verseCounts);
  const candidates = new Map();
  for (const position of noteVerses(note, verseCounts)) {
    for (const { word, strong } of cuv?.get(position.chapter)?.get(position.verse)?.words || []) {
      if (!candidates.has(strong)) candidates.set(strong, []);
      if (!candidates.get(strong).includes(word)) candidates.get(strong).push(word);
    }
  }
  const input = {
    ref: note.ref,
    range: note.range,
    en: note.prepared ?? note.en,
    excerpts: (note.excerpts || []).map(excerpt => ({ en: excerpt.en, heading: Boolean(excerpt.heading) })),
    verses: verses.map(position => {
      const verse = cuv?.get(position.chapter)?.get(position.verse);
      return {
        ref: `${position.chapter}:${position.verse}`,
        cuv: verse?.text || "",
        ccb: ccb?.get(`${position.chapter}:${position.verse}`) || "",
        strongs: formatStrongWords(verse?.words)
      };
    }),
    original_words: matchOriginalWords(note.original_words, candidates, lexicon),
    glossary: glossaryHits(note, glossary)
  };
  if (note.cross_chapter) input.title = note.title || `${note.range} 總覽`;
  if (truncated) input.verses_note = "範圍超過 20 節，只附起始節。";
  return input;
}

export function buildTranslationInput(file, deps, { all = false } = {}) {
  const notes = (file.notes || []).filter(note => all || !String(note.zh || "").trim());
  return {
    book: file.book,
    sourceVersion: file.sourceVersion || "",
    notices: [FHL_NOTICE, CCB_NOTICE],
    instructions: TRANSLATION_INSTRUCTIONS,
    notes: notes.map(note => buildNoteInput(note, deps))
  };
}

// 用語表寫回檔案：一條一行，diff 好讀。
export function serializeGlossary(glossary) {
  const { terms = [], ...rest } = glossary || {};
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  const lines = terms.map(term => `    ${JSON.stringify(term).replace(/","/g, "\", \"").replace(/":"/g, "\": \"").replace(/":(true|false)/g, "\": $1").replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
  return `${head},\n  "terms": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

// 拼音對到的編號裡、用語表還沒有的 → 補進用語表的候選（auto: true，用前看一下）。
export function glossaryCandidates(input, glossary, book) {
  const known = new Set((glossary?.terms || []).map(term => term.strong).filter(Boolean));
  const added = new Map();
  for (const note of input.notes || []) {
    for (const word of note.original_words || []) {
      if (!word.strong || known.has(word.strong) || added.has(word.strong) || !word.cuv?.length) continue;
      added.set(word.strong, {
        translit: word.translit,
        strong: word.strong,
        zh: word.cuv[0],
        gloss: word.gloss || "",
        ref: note.ref,
        source: `strongs:${book}`,
        auto: true
      });
    }
  }
  return Array.from(added.values());
}
