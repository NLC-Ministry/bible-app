// 真人朗讀逐節時間表（#637）：每章每節在信望愛和合本朗讀 mp3 裡的開始秒數。
// 由 scripts/human-audio-timing/ 離線對齊產生，按書卷放在 /assets/audio-timing/<書卷編號>.json：
//   { "v": 1, "book": 19, "chapters": { "117": [[1, 3.53], [2, 17.39]] } }
// 哪一章沒有時間表（檔案不在、抓不到、或那章對齊失敗），就退回 #636 的整章播放：不標示節、不能從某節開始。

export const AUDIO_TIMING_DIR = "/assets/audio-timing/";
export const AUDIO_TIMING_FORMAT_VERSION = 1;

export function buildAudioTimingUrl(bookId) {
  return `${AUDIO_TIMING_DIR}${Number(bookId)}.json`;
}

// 時間表整理成依節數排序、開始秒數遞增的 [{ verse, start }]；資料不對就回 null（當作沒有時間表）。
export function normalizeChapterTimings(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const timings = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    const verse = Number(row[0]);
    const start = Number(row[1]);
    if (!Number.isInteger(verse) || verse < 1 || !Number.isFinite(start) || start < 0) return null;
    timings.push({ verse, start });
  }
  timings.sort((a, b) => a.verse - b.verse);
  for (let i = 1; i < timings.length; i++) {
    if (timings[i].verse === timings[i - 1].verse || timings[i].start < timings[i - 1].start) return null;
  }
  return timings;
}

export function readBookTimings(payload, bookId) {
  if (!payload || payload.v !== AUDIO_TIMING_FORMAT_VERSION || Number(payload.book) !== Number(bookId)) return null;
  return payload.chapters && typeof payload.chapters === "object" ? payload.chapters : null;
}

// 現在念到第幾節：最後一個「開始秒數 ≤ 現在」的節。章首報章名的時間（第一節之前）回 null。
export function findVerseAtTime(timings, seconds) {
  if (!Array.isArray(timings) || timings.length === 0) return null;
  const t = Number(seconds);
  if (!Number.isFinite(t) || t < timings[0].start) return null;
  let lo = 0;
  let hi = timings.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timings[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  // 併節（同一個開始秒數，例如民 1:20–21）：回第一節，lastVerse 是併在一起的最後一節。
  let first = lo;
  while (first > 0 && timings[first - 1].start === timings[lo].start) first--;
  return { verse: timings[first].verse, lastVerse: timings[lo].verse, index: first, total: timings.length };
}

export function getVerseStartTime(timings, verseNum) {
  if (!Array.isArray(timings)) return null;
  const found = timings.find(item => item.verse === Number(verseNum));
  return found ? found.start : null;
}

export function formatHumanAudioVerseLabel({ status = "speaking", verse, lastVerse = verse, total } = {}) {
  const prefix = status === "paused" ? "已暫停・" : status === "completed" ? "已完成・" : "朗讀中・";
  const range = lastVerse > verse ? `${verse}–${lastVerse}` : `${verse}`;
  return `${prefix}第 ${range} 節／共 ${total} 節`;
}

// 一個書卷一個檔，抓過就留在記憶體；抓不到也記住（null），這次開著 App 時不再重抓。
export function createAudioTimingStore({ fetchImpl = (...args) => fetch(...args) } = {}) {
  const books = new Map();

  function loadBook(bookId) {
    const key = Number(bookId);
    if (!books.has(key)) {
      const pending = Promise.resolve()
        .then(() => fetchImpl(buildAudioTimingUrl(key)))
        .then(response => (response?.ok ? response.json() : null))
        .then(payload => readBookTimings(payload, key))
        .catch(() => null);
      books.set(key, pending);
    }
    return books.get(key);
  }

  return {
    async getChapter(bookId, chapter) {
      const chapters = await loadBook(bookId);
      return normalizeChapterTimings(chapters?.[String(Number(chapter))]);
    },
    prefetch(bookId) {
      void loadBook(bookId);
    }
  };
}
