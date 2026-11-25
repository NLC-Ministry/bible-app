import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { BIBLE_TOPIC_INDEX_STATUS, BIBLE_TOPICS } from "../js/data/bible-topic-index.mjs";
import { BIBLE_SEARCH_EVAL_SET } from "../js/data/bible-search-eval-set.mjs";
import {
  evaluateBibleSearch,
  formatTopicRefLabel,
  matchBibleTopics,
  pickTopicRefText,
  normalizeTopicQuery,
  parseTopicRef,
  searchTopicRefs,
  topicRefContainsVerse
} from "../js/modules/bible-topic-search.mjs";

function loadBibleData() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync("js/data/bible_data.js", "utf8"), context);
  vm.runInContext(readFileSync("js/data/bible_verse_counts.js", "utf8"), context);
  return { books: context.window.BIBLE_BOOKS, verseCounts: context.window.BIBLE_VERSE_COUNTS };
}

const { books, verseCounts } = loadBibleData();

function refProblem(ref) {
  const parsed = parseTopicRef(ref);
  if (!parsed) return `${ref}: 格式不對`;
  const book = books.find(item => item.eng === parsed.bookEng);
  if (!book) return `${ref}: 沒有這卷書`;
  if (parsed.chapter > book.chapters) return `${ref}: 沒有這一章`;
  const versesInChapter = verseCounts[parsed.bookEng]?.[parsed.chapter - 1];
  if (!versesInChapter || parsed.endVerse > versesInChapter) return `${ref}: 超過這章的節數`;
  return null;
}

describe("經文主題索引資料（#714）", () => {
  it("還是草稿，牧者審過才改狀態", () => {
    expect(["draft", "reviewed"]).toContain(BIBLE_TOPIC_INDEX_STATUS);
  });

  it("每個主題有唯一 id、中英文名稱、同義詞和經文", () => {
    const ids = BIBLE_TOPICS.map(topic => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of BIBLE_TOPICS) {
      expect(topic.name, topic.id).toBeTruthy();
      expect(topic.en, topic.id).toBeTruthy();
      expect(topic.terms.length, topic.id).toBeGreaterThan(0);
      expect(topic.refs.length, topic.id).toBeGreaterThan(0);
      expect(new Set(topic.refs).size, `${topic.id} 經文重複`).toBe(topic.refs.length);
    }
  });

  it("所有章節位置都對得上書卷、章數與節數", () => {
    const problems = BIBLE_TOPICS.flatMap(topic => topic.refs).map(refProblem).filter(Boolean);
    expect(problems).toEqual([]);
  });

  it("只存章節位置，不存經文全文", () => {
    for (const topic of BIBLE_TOPICS) {
      expect(Object.keys(topic).sort()).toEqual(["en", "id", "name", "refs", "terms"]);
    }
  });

  it("不收敏感詞：搜到時要不要加關懷聯絡方式另外討論", () => {
    const terms = BIBLE_TOPICS.flatMap(topic => topic.terms);
    for (const sensitive of ["自殺", "想死", "輕生", "離婚"]) {
      expect(terms).not.toContain(sensitive);
    }
  });
});

describe("matchBibleTopics", () => {
  it("問句裡有同義詞就找到主題，即使經文沒有那兩個字", () => {
    const [first] = matchBibleTopics("憂慮的時候", BIBLE_TOPICS);
    expect(first.topic.id).toBe("anxiety");
    expect(matchBibleTopics("最近很焦慮", BIBLE_TOPICS)[0].topic.id).toBe("anxiety");
  });

  it("單一個字只在整個問句就是那個字時才算", () => {
    expect(matchBibleTopics("愛", BIBLE_TOPICS)[0].topic.id).toBe("love");
    expect(matchBibleTopics("可愛", BIBLE_TOPICS).map(match => match.topic.id)).not.toContain("love");
    expect(matchBibleTopics("錢", BIBLE_TOPICS)[0].topic.id).toBe("provision");
  });

  it("英文詞從字首比對，不會在單字中間誤中", () => {
    expect(matchBibleTopics("I am worried", BIBLE_TOPICS)[0].topic.id).toBe("anxiety");
    expect(matchBibleTopics("interest", BIBLE_TOPICS).map(match => match.topic.id)).not.toContain("weariness");
  });

  it("較長、較貼切的詞排前面，並限制數量", () => {
    // 「睡不著」三個字比「壓力」「工作」長，排第一；同分時照索引順序。
    const matches = matchBibleTopics("工作壓力好大又睡不著", BIBLE_TOPICS, { limit: 2 });
    expect(matches).toHaveLength(2);
    expect(matches.map(match => match.topic.id)).toEqual(["anxiety", "weariness"]);
    expect(matchBibleTopics("工作壓力好大又睡不著", BIBLE_TOPICS).map(match => match.topic.id)).toContain("work");
  });

  it("空白、標點與全形字不影響比對；沒命中回傳空陣列", () => {
    expect(normalizeTopicQuery("  憂慮？ ")).toBe("憂慮");
    expect(matchBibleTopics("", BIBLE_TOPICS)).toEqual([]);
    expect(matchBibleTopics("創世記", BIBLE_TOPICS)).toEqual([]);
  });
});

describe("章節位置", () => {
  it("解析單節與同章範圍", () => {
    expect(parseTopicRef("1 Corinthians 13:4-7")).toEqual({ bookEng: "1 Corinthians", chapter: 13, verse: 4, endVerse: 7 });
    expect(parseTopicRef("Song of Solomon 2:4")).toEqual({ bookEng: "Song of Solomon", chapter: 2, verse: 4, endVerse: 4 });
    expect(parseTopicRef("John 3")).toBeNull();
    expect(parseTopicRef("John 3:16-15")).toBeNull();
  });

  it("範圍包含的節才算命中", () => {
    expect(topicRefContainsVerse("Philippians 4:6-7", "Philippians 4:7")).toBe(true);
    expect(topicRefContainsVerse("Philippians 4:6-7", "Philippians 4:8")).toBe(false);
    expect(topicRefContainsVerse("Philippians 4:6-7", "Philemon 4:6")).toBe(false);
  });

  it("中英文標籤與範圍經文", () => {
    const parsed = parseTopicRef("Philippians 4:6-7");
    expect(formatTopicRefLabel(parsed, "腓立比書")).toBe("腓立比書 4章:6-7節");
    expect(formatTopicRefLabel(parseTopicRef("John 3:16"), "John", true)).toBe("John 3:16");
    const chapter = [
      { verse: 7, text: "神所賜<b>出人意外</b>的平安" },
      { verse: 5, text: "不取" },
      { verse: 6, text: "應當一無掛慮" }
    ];
    expect(pickTopicRefText(chapter, parsed)).toBe("應當一無掛慮 神所賜出人意外的平安");
    expect(pickTopicRefText(null, parsed)).toBe("");
    // 巢狀或不完整的標籤剝一次後不可留下 < 或 >（CodeQL 不完整清除）
    const nested = pickTopicRefText([{ verse: 6, text: "a<<script>script>b<i" }], parsed);
    expect(nested).not.toMatch(/[<>]/);
    expect(nested).toBe("ab");
  });

  it("多個主題的經文依序攤平並去重", () => {
    const refs = searchTopicRefs("禱告和感恩", BIBLE_TOPICS);
    expect(refs.length).toBeLessThanOrEqual(12);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs[0]).toBe("Philippians 4:6");
  });
});

describe("測試題庫（#714 第 0 階段）", () => {
  it("題庫的期望經文都是有效的章節位置", () => {
    const problems = BIBLE_SEARCH_EVAL_SET.flatMap(item => item.expect).map(refProblem).filter(Boolean);
    expect(problems).toEqual([]);
    const queries = BIBLE_SEARCH_EVAL_SET.map(item => item.query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("主題索引的命中率不低於目前基準（20/28）", async () => {
    // 基準是 2026-11-25 的草稿版；沒中的多半是口語問句，留給第 2 階段的語意搜尋。
    // 命中率下降代表改索引時弄壞了比對；上升就把基準一起調高。
    const result = await evaluateBibleSearch(BIBLE_SEARCH_EVAL_SET, query => searchTopicRefs(query, BIBLE_TOPICS));
    expect(result.total).toBe(BIBLE_SEARCH_EVAL_SET.length);
    expect(result.hits).toBeGreaterThanOrEqual(20);
  });
});
