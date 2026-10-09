// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  COMMENTARY_IMAGE_DIR,
  COMMENTARY_INDEX_CACHE_KEY,
  COMMENTARY_INDEX_TTL_MS,
  COMMENTARY_TOPICS,
  buildCommentaryBodyHTML,
  buildCommentaryIndex,
  buildVerseCommentaryHTML,
  commentaryChapterKey,
  commentaryReferenceLabel,
  findTermRanges,
  formatVerseRuns,
  indexMayHaveCommentary,
  markTermsHTML,
  normalizeTopicTags,
  normalizeVerseRange,
  parseCommentaryIndexCache,
  parseTermAliases,
  plainVerseText,
  resolveChapterCommentary,
  resolveCommentaryImages,
  serializeCommentaryIndex,
  splitCommentaryParagraphs
} from "../js/data/passage-commentary.mjs";
import { COMMENTARY_INDEX_RETRY_MS, createCommentaryRepository } from "../js/data/commentary-repository.mjs";
import { createReaderCommentaryController } from "../js/modules/reader-commentary.mjs";
import {
  findCommentaryForChapter,
  renderAdminCommentary,
  sortCommentaryItems,
  sortCommentaryRows,
  termScopeLabel,
  termScopeOf,
  verseCountFor
} from "../js/modules/admin-commentary.mjs";
import { createReadCommentaryDb, readUsableAccessToken } from "../js/read/read-commentary-client.mjs";

const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n"); // jsdom 的 URL 不是 Node 的 URL，fs 不收
const escapeHTML = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("passage commentary data helpers (#447)", () => {
  it("ships an image file for every topic in the library", () => {
    for (const topic of COMMENTARY_TOPICS) {
      expect(topic.images.length).toBeGreaterThan(0);
      for (const image of topic.images) {
        expect(existsSync(`${COMMENTARY_IMAGE_DIR}${image.file}`), image.file).toBe(true);
        expect(image.alt).toBeTruthy();
        expect(image.caption).toBeTruthy();
      }
    }
  });

  it("drops unknown or duplicate topic tags and resolves each image once", () => {
    expect(normalizeTopicTags(["tabernacle", "gone", "tabernacle", "israel-camp"])).toEqual(["tabernacle", "israel-camp"]);
    expect(normalizeTopicTags(null)).toEqual([]);
    const images = resolveCommentaryImages(["tabernacle", "tabernacle"]);
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe("assets/commentary/tabernacle-layout.svg");
  });

  it("splits paragraphs on blank lines and escapes admin-written text", () => {
    expect(splitCommentaryParagraphs("第一段\r\n\r\n第二段\n續行\n\n\n")).toEqual(["第一段", "第二段\n續行"]);
    const html = buildCommentaryBodyHTML({
      title: "會幕<b>",
      content: "<img src=x onerror=alert(1)>\n第二行\n\n第二段",
      topic_tags: ["tabernacle"],
      source: "教會<i>"
    }, escapeHTML);
    expect(html).toContain('<h4 class="reader-commentary-title">會幕&lt;b&gt;</h4>');
    expect(html).toContain("<p>&lt;img src=x onerror=alert(1)&gt;<br>第二行</p><p>第二段</p>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('src="assets/commentary/tabernacle-layout.svg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('<p class="reader-commentary-source">出處：教會&lt;i&gt;</p>');
    expect(buildCommentaryBodyHTML({ content: "只有內容" }, escapeHTML)).not.toContain("reader-commentary-figures");
    expect(buildCommentaryBodyHTML({ content: "只有內容" }, escapeHTML)).not.toContain("reader-commentary-source");
  });
});

describe("chapter index (#470)", () => {
  it("indexes chapters and whole-book terms, and caches until the TTL runs out", () => {
    const index = buildCommentaryIndex([
      { book: "出埃及記", chapter: 26 },
      { book: "民數記", chapter: "2" },
      { book: "利未記", chapter: null },
      { book: "", chapter: 1 },
      { book: "創世記", chapter: 0 }
    ]);
    expect([...index]).toEqual(["出埃及記|26", "民數記|2", "利未記|*"]);
    expect(indexMayHaveCommentary(index, "出埃及記", 26)).toBe(true);
    expect(indexMayHaveCommentary(index, "出埃及記", 25)).toBe(false);
    expect(indexMayHaveCommentary(index, "利未記", 13)).toBe(true);
    expect(indexMayHaveCommentary(null, "利未記", 13)).toBe(false);

    const raw = serializeCommentaryIndex(index, 1000);
    expect(parseCommentaryIndexCache(raw, 1000 + COMMENTARY_INDEX_TTL_MS - 1).has(commentaryChapterKey("出埃及記", 26))).toBe(true);
    expect(parseCommentaryIndexCache(raw, 1000 + COMMENTARY_INDEX_TTL_MS)).toBeNull();
    expect(parseCommentaryIndexCache(raw, 999)).toBeNull();
    expect(parseCommentaryIndexCache("not json")).toBeNull();
    expect(parseCommentaryIndexCache(null)).toBeNull();
  });

  it("uses a new cache key, so a #447 chapter-only index is not mistaken for the new one", () => {
    expect(COMMENTARY_INDEX_CACHE_KEY).not.toBe("passage_commentary_index_v1");
  });
});

describe("verse ranges and term matching (#470)", () => {
  it("normalizes verse ranges: blank start = whole chapter, single verse, swapped ends", () => {
    expect(normalizeVerseRange(null, null)).toBeNull();
    expect(normalizeVerseRange("", "5")).toBeNull();
    expect(normalizeVerseRange("3", "")).toEqual({ start: 3, end: 3 });
    expect(normalizeVerseRange(7, 2)).toEqual({ start: 2, end: 7 });
    expect(formatVerseRuns([5, 1, 2, 3, 3])).toBe("1-3、5");
    expect(commentaryReferenceLabel({ book: "出埃及記", chapter: 26 })).toBe("出埃及記 26 章");
    expect(commentaryReferenceLabel({ book: "出埃及記", chapter: 26, verse_start: 1, verse_end: 5 })).toBe("出埃及記 26:1-5");
  });

  it("parses aliases from commas, 頓號 and new lines, dropping duplicates", () => {
    expect(parseTermAliases("帳幕、 Tabernacle,tabernacle\n會幕；")).toEqual(["帳幕", "Tabernacle", "會幕"]);
    expect(parseTermAliases(["a", "", "A"])).toEqual(["a"]);
  });

  it("finds non-overlapping matches, longest first, ignoring English case", () => {
    expect(findTermRanges("會幕的幔子在會幕裡", ["會幕", "幔子"])).toEqual([
      { start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 8 }
    ]);
    expect(findTermRanges("至聖所與聖所", ["聖所", "至聖所"])).toEqual([{ start: 0, end: 3 }, { start: 4, end: 6 }]);
    expect(findTermRanges("The Tabernacle", ["tabernacle"])).toEqual([{ start: 4, end: 14 }]);
  });

  it("marks terms in plain text and escapes everything else", () => {
    expect(plainVerseText("<b>摩西</b> &amp; 亞倫")).toBe("摩西 & 亞倫");
    expect(markTermsHTML("<會幕>", ["會幕"], escapeHTML)).toBe('&lt;<mark class="reader-commentary-mark">會幕</mark>&gt;');
  });
});

describe("resolveChapterCommentary (#470)", () => {
  const textByVerse = new Map([
    [1, "你要用十幅幔子做帳幕"],
    [2, "每幅幔子要長二十八肘"],
    [3, "這五幅幔子要幅幅相連"],
    [4, "在這相連的幔子末幅邊上"]
  ]);

  it("separates the chapter note from verse notes and maps ranges onto verses", () => {
    const result = resolveChapterCommentary({
      chapter: 26,
      textByVerse,
      rows: [
        { id: "c", chapter: 26, content: "整章" },
        { id: "n2", chapter: 26, verse_start: 2, verse_end: 3, content: "二到三節" },
        { id: "other", chapter: 25, verse_start: 1, verse_end: 1, content: "別章" }
      ],
      terms: []
    });
    expect(result.chapterRow.id).toBe("c");
    expect([...result.entries.keys()]).toEqual([2, 3]);
    expect(result.entries.get(2).notes.map(note => note.id)).toEqual(["n2"]);
    expect(result.iconVerses).toEqual([2, 3]);
  });

  it("puts a whole-book term's icon only on its first mention in the chapter, but every mention has content", () => {
    const result = resolveChapterCommentary({
      chapter: 26,
      textByVerse,
      rows: [],
      terms: [
        { id: "t1", term: "幔子", aliases: [], chapter: null },
        { id: "t2", term: "帳幕", aliases: ["會幕"], chapter: 26 },
        { id: "t3", term: "肘", aliases: [], chapter: 25 },
        { id: "t4", term: "約櫃", aliases: [], chapter: null }
      ]
    });
    expect(result.chapterRow).toBeNull();
    expect([...result.entries.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(result.entries.get(1).terms.map(term => term.id)).toEqual(["t1", "t2"]);
    expect(result.entries.get(4).terms.map(term => term.id)).toEqual(["t1"]);
    expect(result.iconVerses).toEqual([1]);
  });

  it("attaches verse-scoped terms without looking at the text", () => {
    const result = resolveChapterCommentary({
      chapter: 26,
      textByVerse,
      terms: [{ id: "t", term: "基路伯", aliases: [], chapter: 26, verse_start: 3, verse_end: 4 }]
    });
    expect([...result.entries.keys()]).toEqual([3, 4]);
    expect(result.iconVerses).toEqual([3, 4]);
  });
});

describe("buildVerseCommentaryHTML (#470)", () => {
  it("quotes the verses with marks, lists notes and term cards once, and dedupes images", () => {
    const term = { id: "t", term: "幔子", aliases: [], definition: "遮蔽<用>的布", topic_tags: ["tabernacle"], source: "Tyndale" };
    const html = buildVerseCommentaryHTML({
      chapter: 26,
      verses: [{ verse: 1, text: "十幅<b>幔子</b>", terms: [term] }],
      notes: [{ id: "n", verse_start: 1, verse_end: 3, title: "幔子", content: "說明", topic_tags: ["tabernacle"] }],
      terms: [term]
    }, escapeHTML);
    expect(html).toContain('<span class="reader-commentary-quote__num">1</span>十幅<mark class="reader-commentary-mark">幔子</mark>');
    expect(html).toContain('<p class="reader-commentary-note__ref">26:1-3</p>');
    expect(html).toContain('<h5 class="reader-commentary-term__name">幔子</h5>');
    expect(html).toContain("<p>遮蔽&lt;用&gt;的布</p>");
    expect(html).toContain("出處：Tyndale");
    expect(html.match(/<figure/g)).toHaveLength(1);
    expect(buildVerseCommentaryHTML({ chapter: 1, verses: [], notes: [], terms: [] }, escapeHTML)).not.toContain("reader-commentary-section");
  });
});

// 假的 supabase-js 查詢：記下每次請求，依 table 回傳資料（支援 range 分頁）。
function createFakeFrom(tables) {
  const calls = [];
  const from = table => {
    const request = { table, filters: [], orders: [], range: null, select: null };
    const builder = {
      select(columns) { request.select = columns; return builder; },
      eq(column, value) { request.filters.push(["eq", column, value]); return builder; },
      in(column, value) { request.filters.push(["in", column, value]); return builder; },
      order(column) { request.orders.push(column); return builder; },
      range(start, end) { request.range = [start, end]; return builder; },
      then(resolve, reject) {
        calls.push(request);
        const source = tables[table];
        if (source instanceof Error) return Promise.resolve({ data: null, error: source }).then(resolve, reject);
        let rows = typeof source === "function" ? source(request) : (source || []);
        if (request.range) rows = rows.slice(request.range[0], request.range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      }
    };
    return builder;
  };
  return { from, calls };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

describe("commentary repository (#470)", () => {
  it("reads the index view with a stable order, caches it, and backs off after a failure", async () => {
    let clock = 10_000;
    const storage = memoryStorage();
    const { from, calls } = createFakeFrom({ commentary_chapter_index: [{ book: "出埃及記", chapter: 26 }, { book: "利未記", chapter: null }] });
    const repo = createCommentaryRepository({ from, storage, now: () => clock });
    const index = await repo.fetchIndex();
    expect([...index]).toEqual(["出埃及記|26", "利未記|*"]);
    expect(calls[0].orders).toEqual(["book", "chapter"]);
    await repo.fetchIndex();
    expect(calls).toHaveLength(1);

    const failing = createCommentaryRepository({ from: createFakeFrom({ commentary_chapter_index: new Error("offline") }).from, storage: memoryStorage(), now: () => clock });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await failing.fetchIndex()).size).toBe(0);
    warn.mockRestore();
    clock += COMMENTARY_INDEX_RETRY_MS - 1;
    expect((await failing.fetchIndex()).size).toBe(0);
  });

  it("fetches a chapter's notes plus the book's term list once, and term details only for missing ids", async () => {
    const { from, calls } = createFakeFrom({
      passage_commentary: [{ id: "n1", chapter: 26, verse_start: 1, verse_end: 1, content: "x" }],
      commentary_terms: request => (request.select.includes("definition")
        ? [{ id: "t1", term: "幔子", definition: "布" }]
        : [{ id: "t1", term: "幔子", aliases: [], chapter: null }])
    });
    const repo = createCommentaryRepository({ from, storage: memoryStorage() });
    const chapter = await repo.fetchChapter("出埃及記", 26);
    expect(chapter.rows).toHaveLength(1);
    expect(chapter.terms[0].id).toBe("t1");
    await repo.fetchChapter("出埃及記", 26);
    await repo.fetchChapter("出埃及記", 27);
    const termListCalls = calls.filter(call => call.table === "commentary_terms");
    expect(termListCalls).toHaveLength(1);
    expect(termListCalls[0].filters).toContainEqual(["eq", "is_published", true]);
    expect(calls.filter(call => call.table === "passage_commentary")).toHaveLength(2);

    const details = await repo.fetchTermDetails(["t1"]);
    expect(details.get("t1").definition).toBe("布");
    await repo.fetchTermDetails(["t1"]);
    expect(calls.filter(call => call.table === "commentary_terms" && call.select.includes("definition"))).toHaveLength(1);

    repo.invalidate();
    await repo.fetchChapter("出埃及記", 26);
    expect(calls.filter(call => call.table === "passage_commentary")).toHaveLength(3);
  });
});

function mountReaderDom() {
  document.body.innerHTML = `
    <button id="reader-commentary-btn" class="hidden"></button>
    <div id="bible-content">
      <div class="bible-verse" data-verse="1"><span class="verse-num">1</span><span class="verse-text">十幅幔子</span></div>
      <div class="bible-verse" data-verse="2"><span class="verse-num">2</span><span class="verse-text">每幅幔子</span></div>
      <div class="bible-verse" data-verse="3"><span class="verse-num">3</span><span class="verse-text">相連</span></div>
    </div>
    <div id="reader-commentary-backdrop" class="hidden">
      <p id="reader-commentary-subtitle"></p>
      <button id="reader-commentary-close-btn"></button>
      <div id="reader-commentary-body"></div>
    </div>`;
}

const TEXT = new Map([[1, "十幅幔子"], [2, "每幅幔子"], [3, "相連"]]);

function createController(db, extra = {}) {
  const tasks = [];
  const controller = createReaderCommentaryController({
    db,
    openLayer: element => element.classList.remove("hidden"),
    closeLayer: element => element.classList.add("hidden"),
    escapeHTML,
    schedule: callback => tasks.push(callback),
    ...extra
  });
  const flush = async () => { while (tasks.length) await tasks.shift()(); };
  return { controller, flush };
}

function chapterDb(overrides = {}) {
  return {
    fetchIndex: vi.fn(async () => new Set(["出埃及記|26"])),
    fetchChapter: vi.fn(async () => ({
      rows: [
        { id: "c", chapter: 26, title: "會幕", content: "整章內容", topic_tags: ["tabernacle"] },
        { id: "n3", chapter: 26, verse_start: 3, verse_end: 3, content: "第三節說明" }
      ],
      terms: [{ id: "t", term: "幔子", aliases: [], chapter: null }]
    })),
    fetchTermDetails: vi.fn(async () => new Map([["t", { id: "t", term: "幔子", definition: "布做的簾子" }]])),
    ...overrides
  };
}

describe("reader commentary controller (#447, #470)", () => {
  it("waits for the scheduler, then shows the chapter button and the verse icons", async () => {
    mountReaderDom();
    const db = chapterDb();
    const onChange = vi.fn();
    const { controller, flush } = createController(db, { onChange });
    const button = document.getElementById("reader-commentary-btn");

    const pending = controller.refreshForChapter("出埃及記", 26, "出埃及記 26章", TEXT);
    expect(db.fetchIndex).not.toHaveBeenCalled();
    await flush();
    expect(await pending).toBe(true);
    expect(button.classList.contains("hidden")).toBe(false);
    // 整卷詞條「幔子」只在第一次出現的第 1 節放 icon；第 3 節是節注釋。
    const icons = [...document.querySelectorAll(".verse-commentary-btn")].map(icon => icon.dataset.verseCommentary);
    expect(icons).toEqual(["1", "3"]);
    expect(document.querySelector('.bible-verse[data-verse="1"]').classList.contains("has-commentary")).toBe(true);
    expect(controller.versesWithCommentary([3, 2, 1, 9])).toEqual([1, 2, 3]);
    expect(onChange).toHaveBeenCalled();
    expect(db.fetchTermDetails).not.toHaveBeenCalled();

    controller.resetForChapter();
    expect(button.classList.contains("hidden")).toBe(true);
    expect(document.querySelectorAll(".verse-commentary-btn")).toHaveLength(0);
    expect(controller.versesWithCommentary([1])).toEqual([]);
  });

  it("skips the chapter fetch when the index has nothing for it", async () => {
    mountReaderDom();
    const db = chapterDb({ fetchIndex: vi.fn(async () => new Set(["創世記|1"])) });
    const { controller, flush } = createController(db);
    const pending = controller.refreshForChapter("出埃及記", 26, "", TEXT);
    await flush();
    expect(await pending).toBe(false);
    expect(db.fetchChapter).not.toHaveBeenCalled();
    expect(document.getElementById("reader-commentary-btn").classList.contains("hidden")).toBe(true);
  });

  it("ignores a lookup that finishes after the reader already moved to another chapter", async () => {
    mountReaderDom();
    const db = chapterDb();
    const { controller, flush } = createController(db);
    const stale = controller.refreshForChapter("出埃及記", 26, "", TEXT);
    controller.resetForChapter();
    await flush();
    expect(await stale).toBe(false);
    expect(document.querySelectorAll(".verse-commentary-btn")).toHaveLength(0);
  });

  it("opens the chapter note from the toolbar button without another request", async () => {
    mountReaderDom();
    const db = chapterDb();
    const { controller, flush } = createController(db);
    controller.bind();
    const pending = controller.refreshForChapter("出埃及記", 26, "出埃及記 26章", TEXT);
    await flush();
    await pending;
    document.getElementById("reader-commentary-btn").click();
    expect(controller.isOpen()).toBe(true);
    expect(document.getElementById("reader-commentary-subtitle").textContent).toBe("出埃及記 26章");
    expect(document.querySelector(".reader-commentary-title").textContent).toBe("會幕");
    expect(db.fetchChapter).toHaveBeenCalledTimes(1);
    expect(controller.close()).toBe(true);
    expect(controller.close()).toBe(false);
  });

  it("a verse icon opens that verse's notes and terms and does not select the verse", async () => {
    mountReaderDom();
    const db = chapterDb();
    const { controller, flush } = createController(db);
    controller.bind();
    const toggle = vi.fn();
    document.getElementById("bible-content").addEventListener("click", toggle);
    const pending = controller.refreshForChapter("出埃及記", 26, "", TEXT);
    await flush();
    await pending;

    document.querySelector('[data-verse-commentary="1"]').click();
    await vi.waitFor(() => expect(document.querySelector(".reader-commentary-term__name")).not.toBeNull());
    expect(toggle).not.toHaveBeenCalled();
    expect(document.getElementById("reader-commentary-subtitle").textContent).toBe("出埃及記 26:1");
    expect(document.querySelector(".reader-commentary-quote").innerHTML).toContain('<mark class="reader-commentary-mark">幔子</mark>');
    expect(document.getElementById("reader-commentary-body").textContent).toContain("布做的簾子");
    expect(db.fetchTermDetails).toHaveBeenCalledWith(["t"]);

    // 點經文本身仍然是選取
    document.querySelector('.bible-verse[data-verse="2"] .verse-text').click();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("opens several selected verses at once, listing a shared term once, and offers a retry when details fail", async () => {
    mountReaderDom();
    const fetchTermDetails = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Map([["t", { id: "t", term: "幔子", definition: "布做的簾子" }]]));
    const db = chapterDb({ fetchTermDetails });
    const { controller, flush } = createController(db);
    controller.bind();
    const pending = controller.refreshForChapter("出埃及記", 26, "", TEXT);
    await flush();
    await pending;

    expect(await controller.openVerses([3, 1, 2])).toBe(false);
    const body = document.getElementById("reader-commentary-body");
    expect(body.querySelector("[data-commentary-retry]")).not.toBeNull();
    body.querySelector("[data-commentary-retry]").click();
    await vi.waitFor(() => expect(body.querySelector(".reader-commentary-term__name")).not.toBeNull());
    expect(document.getElementById("reader-commentary-subtitle").textContent).toBe("出埃及記 26:1-3");
    expect(body.querySelectorAll(".reader-commentary-quote")).toHaveLength(3);
    expect(body.querySelectorAll(".reader-commentary-term")).toHaveLength(1);
    expect(body.querySelectorAll(".reader-commentary-note")).toHaveLength(1);
  });
});

describe("/read commentary client (#470)", () => {
  it("uses only an access token that has not expired", () => {
    const storage = memoryStorage();
    expect(readUsableAccessToken(storage, 0)).toBeNull();
    storage.setItem("nlc_access_token", "tok");
    storage.setItem("nlc_token_expires_at", String(10 * 60 * 1000));
    expect(readUsableAccessToken(storage, 0)).toBe("tok");
    expect(readUsableAccessToken(storage, 9 * 60 * 1000)).toBeNull();
  });

  it("never calls the API when signed out, and sends nlc-data selects with the stored token", async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ book: "出埃及記", chapter: 26 }] }) }));
    const client = createReadCommentaryDb({ storage, config: { url: "https://x.supabase.co/", anonKey: "anon" }, fetchImpl, now: () => 0 });
    expect((await client.fetchIndex()).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    storage.setItem("nlc_access_token", "tok");
    storage.setItem("nlc_token_expires_at", String(60 * 60 * 1000));
    const index = await client.fetchIndex();
    expect(index.has("出埃及記|26")).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/functions/v1/nlc-data");
    expect(init.headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ table: "commentary_chapter_index", action: "select", select: "book, chapter", range: { from: 0, to: 999 } });
    expect(body.orders.map(order => order.column)).toEqual(["book", "chapter"]);
  });
});

describe("admin commentary helpers (#447, #470)", () => {
  const books = [{ name: "創世記", eng: "Genesis" }, { name: "出埃及記", eng: "Exodus" }, { name: "民數記", eng: "Numbers" }];

  it("sorts rows in Bible order, then chapter, chapter notes first, then verses", () => {
    const rows = [
      { id: 1, book: "民數記", chapter: 2 },
      { id: 2, book: "出埃及記", chapter: 27 },
      { id: 3, book: "出埃及記", chapter: 3, verse_start: 5, verse_end: 6 },
      { id: 5, book: "出埃及記", chapter: 3 },
      { id: 4, book: "創世記", chapter: 1 }
    ];
    expect(sortCommentaryRows(rows, books).map(row => row.id)).toEqual([4, 5, 3, 2, 1]);
  });

  it("finds an existing commentary for the same chapter and range, ignoring the row being edited", () => {
    const rows = [
      { id: "a", book: "出埃及記", chapter: 26 },
      { id: "b", book: "出埃及記", chapter: 26, verse_start: 1, verse_end: 5 }
    ];
    expect(findCommentaryForChapter(rows, "出埃及記", "26")?.id).toBe("a");
    expect(findCommentaryForChapter(rows, "出埃及記", 26, "a")).toBeNull();
    expect(findCommentaryForChapter(rows, "出埃及記", 26, null, 1, 5)?.id).toBe("b");
    expect(findCommentaryForChapter(rows, "出埃及記", 26, null, 1, 4)).toBeNull();
    expect(findCommentaryForChapter(rows, "出埃及記", 25)).toBeNull();
  });

  it("looks up verse counts by the English book name", () => {
    expect(verseCountFor({ Exodus: [22, 25] }, books, "出埃及記", 2)).toBe(25);
    expect(verseCountFor(null, books, "出埃及記", 2)).toBe(0);
  });

  it("labels term scopes", () => {
    expect(termScopeOf({ chapter: null })).toBe("book");
    expect(termScopeOf({ chapter: 26 })).toBe("chapter");
    expect(termScopeOf({ chapter: 26, verse_start: 1, verse_end: 1 })).toBe("verses");
    expect(termScopeLabel({ book: "出埃及記", chapter: null })).toBe("出埃及記（整卷）");
    expect(termScopeLabel({ book: "出埃及記", chapter: 26, verse_start: 1, verse_end: 5 })).toBe("出埃及記 26:1-5");
  });

  it("mixes notes and terms in Bible order: whole-book terms first, then by chapter and verse, notes before terms (#475)", () => {
    const notes = [
      { id: "n26", book: "出埃及記", chapter: 26 },
      { id: "n26v3", book: "出埃及記", chapter: 26, verse_start: 3, verse_end: 5 },
      { id: "g1", book: "創世記", chapter: 1 }
    ];
    const terms = [
      { id: "t26", book: "出埃及記", chapter: 26, term: "幔子" },
      { id: "tbook", book: "出埃及記", chapter: null, term: "會幕" },
      { id: "tv3", book: "出埃及記", chapter: 26, verse_start: 3, verse_end: 5, term: "鈕扣" }
    ];
    expect(sortCommentaryItems(notes, terms, books).map(item => `${item.kind}:${item.row.id}`)).toEqual([
      "note:g1", "term:tbook", "note:n26", "term:t26", "note:n26v3", "term:tv3"
    ]);
  });
});

// #475：注釋與詞條同一頁。把 index.html 的區塊掛進 jsdom，用假的 db 操作。
describe("admin commentary page with notes and terms together (#475)", () => {
  const html = read("index.html");
  const books = [{ name: "創世記", eng: "Genesis", chapters: 50 }, { name: "出埃及記", eng: "Exodus", chapters: 40 }];

  function mountAdmin(overrides = {}) {
    const start = html.indexOf('<div id="admin-section-commentary"');
    const end = html.indexOf("<!-- 首頁「雲柱測驗」後台", start);
    document.body.innerHTML = html.slice(start, end);
    const db = {
      fetchAllPassageCommentaryForAdmin: vi.fn(async () => [
        { id: "n1", book: "出埃及記", chapter: 26, verse_start: 3, verse_end: 5, title: "兩組幔子", content: "說明", topic_tags: [] }
      ]),
      fetchAllCommentaryTermsForAdmin: vi.fn(async () => [
        { id: "t1", book: "出埃及記", chapter: null, term: "幔子", aliases: ["帳幕"], definition: "布簾", topic_tags: [] }
      ]),
      savePassageCommentary: vi.fn(async () => true),
      saveCommentaryTerm: vi.fn(async () => true),
      deletePassageCommentary: vi.fn(async () => true),
      deleteCommentaryTerm: vi.fn(async () => true),
      ...overrides
    };
    const showToast = vi.fn();
    const confirm = vi.fn(async () => true);
    const ready = renderAdminCommentary({ db, books, verseCounts: { Exodus: Array(40).fill(35) }, escapeHTML, showToast, confirm });
    return { db, showToast, confirm, ready };
  }

  const $ = id => document.getElementById(id);
  const visibleKinds = () => [...document.querySelectorAll("[data-admin-commentary-kind]")].map(card => card.dataset.adminCommentaryKind);

  it("there is no separate 經文詞條 page any more", () => {
    const admin = read("js/modules/admin.js");
    expect(admin).not.toContain("commentary-terms");
    expect(html).not.toContain('id="admin-section-commentary-terms"');
    expect(existsSync("js/modules/admin-commentary-terms.mjs")).toBe(false);
  });

  it("lists notes and terms together and filters by type", async () => {
    const { ready } = mountAdmin();
    expect(await ready).toBe(true);
    expect(visibleKinds()).toEqual(["term", "note"]);
    expect($("admin-commentary-list").textContent).toContain("幔子（帳幕）");
    expect($("admin-commentary-list").textContent).toContain("出埃及記 26:3-5・兩組幔子");

    $("admin-commentary-kind-filter").querySelector('[data-kind-filter="note"]').click();
    expect(visibleKinds()).toEqual(["note"]);
    $("admin-commentary-kind-filter").querySelector('[data-kind-filter="term"]').click();
    expect(visibleKinds()).toEqual(["term"]);
  });

  it("switches the editor fields with the type and saves a term to the terms table", async () => {
    const { db, ready } = mountAdmin();
    await ready;
    $("admin-commentary-create").click();
    expect($("admin-commentary-term-fields").classList.contains("hidden")).toBe(true);
    expect($("admin-commentary-heading-field").classList.contains("hidden")).toBe(false);

    $("admin-commentary-kind").querySelector('[data-commentary-kind="term"]').click();
    expect($("admin-commentary-term-fields").classList.contains("hidden")).toBe(false);
    expect($("admin-commentary-heading-field").classList.contains("hidden")).toBe(true);
    expect($("admin-commentary-chapter-field").classList.contains("hidden")).toBe(true); // 整卷不用選章
    expect($("admin-commentary-content-label").textContent).toBe("解釋");

    $("admin-commentary-scope").querySelector('[data-term-scope="verses"]').click();
    expect($("admin-commentary-verse-field").classList.contains("hidden")).toBe(false);
    $("admin-commentary-book").value = "出埃及記";
    $("admin-commentary-book").onchange();
    $("admin-commentary-chapter").value = "26";
    $("admin-commentary-verse-start").value = "3";
    $("admin-commentary-term-name").value = "鈕扣";
    $("admin-commentary-term-aliases").value = "扣子、鈕扣";
    $("admin-commentary-content").value = "藍色的扣環";
    await $("admin-commentary-save").onclick();

    expect(db.savePassageCommentary).not.toHaveBeenCalled();
    expect(db.saveCommentaryTerm).toHaveBeenCalledWith(expect.objectContaining({
      id: null, term: "鈕扣", aliases: ["扣子", "鈕扣"], definition: "藍色的扣環",
      book: "出埃及記", scope: "verses", chapter: 26, verseStart: 3, verseEnd: 3
    }));
    expect($("admin-commentary-editor").classList.contains("hidden")).toBe(true);
  });

  it("saves a note to the notes table and still blocks a second whole-chapter note", async () => {
    const { db, showToast, ready } = mountAdmin({
      fetchAllPassageCommentaryForAdmin: vi.fn(async () => [{ id: "c", book: "出埃及記", chapter: 26, content: "整章" }])
    });
    await ready;
    $("admin-commentary-create").click();
    $("admin-commentary-book").value = "出埃及記";
    $("admin-commentary-book").onchange();
    $("admin-commentary-chapter").value = "26";
    $("admin-commentary-content").value = "又一則整章";
    await $("admin-commentary-save").onclick();
    expect(db.savePassageCommentary).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("這一章已經有整章注釋了，請在清單中編輯它。");

    $("admin-commentary-verse-start").value = "2";
    await $("admin-commentary-save").onclick();
    expect(db.savePassageCommentary).toHaveBeenCalledWith(expect.objectContaining({ book: "出埃及記", chapter: 26, verseStart: 2, verseEnd: 2, content: "又一則整章" }));
    expect(db.saveCommentaryTerm).not.toHaveBeenCalled();
  });

  it("editing keeps the type fixed, and deleting goes to the right table", async () => {
    const { db, confirm, ready } = mountAdmin();
    await ready;
    document.querySelector('[data-admin-commentary-kind="note"] [data-commentary-edit]').click();
    expect([...$("admin-commentary-kind").querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    expect($("admin-commentary-book").disabled).toBe(true);
    expect($("admin-commentary-heading").value).toBe("兩組幔子");

    document.querySelector('[data-admin-commentary-kind="term"] [data-commentary-edit]').click();
    expect($("admin-commentary-term-name").value).toBe("幔子");
    expect($("admin-commentary-book").disabled).toBe(false); // 詞條可以改範圍

    document.querySelector('[data-admin-commentary-kind="term"] [data-commentary-delete]').click();
    await vi.waitFor(() => expect(db.deleteCommentaryTerm).toHaveBeenCalledWith("t1"));
    expect(confirm.mock.calls[0][0].title).toBe("確定要刪除詞條「幔子」嗎？");
    expect(db.deletePassageCommentary).not.toHaveBeenCalled();
  });
});

describe("passage commentary wiring (#447, #470)", () => {
  const migration = read("supabase/migrations/20261009064256_verse_commentary_terms.sql");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const bible = read("js/modules/bible.js");
  const plan = read("js/modules/plan.js");
  const html = read("index.html");
  const readHtml = read("read.html");
  const app = read("js/app.js");
  const admin = read("js/modules/admin.js");

  it("allows verse notes next to the one chapter note, adds terms and an index view, all admin-written", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS passage_commentary_book_chapter_key");
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_chapter_note_key[\s\S]*?WHERE verse_start IS NULL;/);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.commentary_terms");
    expect(migration).toContain("ALTER TABLE public.commentary_terms ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (is_published = TRUE OR public.current_role_code() = 'admin')");
    expect(migration).toContain("WITH CHECK (public.current_role_code() = 'admin')");
    expect(migration).toContain("REVOKE ALL ON TABLE public.commentary_terms FROM PUBLIC, anon;");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.commentary_chapter_index FROM PUBLIC, anon;");
    expect(migration).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
  });

  it("lets members read only published commentary and terms through nlc-data and keeps writes admin-only", () => {
    const readTables = edge.match(/const READ_TABLES = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const table of ["passage_commentary", "commentary_terms", "commentary_chapter_index"]) expect(readTables).toContain(`"${table}"`);
    expect(edge).toContain('const ADMIN_ONLY_WRITE_TABLES = new Set(["passage_commentary", "commentary_terms"]);');
    expect(edge).toContain("(ADMIN_ONLY_WRITE_TABLES.has(table) && isAdmin(profile))");
    expect(edge).toContain('if (table === "passage_commentary" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };');
    expect(edge).toContain('if (table === "commentary_terms" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };');
    const adminWriteTables = edge.match(/const ADMIN_WRITE_TABLES = new Set\(\[([^\]]*)\]\)/);
    expect(adminWriteTables[1]).not.toContain("commentary");
  });

  it("looks up commentary only after the chapter text has rendered, matching terms against that text", () => {
    const renderStart = bible.indexOf("export async function renderReaderText(");
    const renderEnd = bible.indexOf("function renderReaderLoadRetryState(", renderStart);
    const render = bible.slice(renderStart, renderEnd);
    expect(render).toContain("readerCommentary.resetForChapter();");
    const refreshAt = render.indexOf("readerCommentary.refreshForChapter(");
    expect(refreshAt).toBeGreaterThan(render.indexOf("refreshVerseSelectionUI();"));
    expect(refreshAt).toBeGreaterThan(render.indexOf("await fetchBibleChapter("));
    expect(render).toContain("renderedReaderChapter.textByVerse);");
  });

  it("shows 注釋 in the selection toolbar only for selected verses that have commentary", () => {
    expect(bible).toContain("readerCommentary.versesWithCommentary(");
    expect(bible).toMatch(/\$\{commentaryVerses\.length \? `<button type="button" class="yv-tile" data-action="commentary"/);
    expect(read("js/read/read-app.mjs")).toMatch(/\$\{commentaryVerses\.length \? `<button type="button" class="yv-tile" data-action="commentary"/);
  });

  it("the plan's old inline reader has no entry point, so plan reading goes through the main reader", () => {
    expect(html).not.toContain('id="btn-start-reading-today"');
    expect(plan).toContain("appRouter.switchTab('reader-view', { fromPlan: true });");
    expect(plan).not.toMatch(/commentary/i);
  });

  it("mounts the sheet outside every .view-pane in both readers and lets the back button close it", () => {
    const sheetIndex = html.indexOf('id="reader-commentary-backdrop"');
    expect(sheetIndex).toBeGreaterThan(html.indexOf('id="bible-nav-overlay"'));
    expect(html).toContain('class="reader-icon-btn native-toolbar-btn reader-commentary-btn hidden" id="reader-commentary-btn"');
    expect(app).toContain("window.closeReaderCommentarySheet()");
    expect(readHtml.indexOf('id="reader-commentary-backdrop"')).toBeGreaterThan(readHtml.indexOf("</main>"));
    expect(readHtml).toContain('id="reader-commentary-btn"');
  });

  it("keeps a single 經文注釋 admin page for notes and terms (#475)", () => {
    expect(admin).toContain("{ id: 'commentary',    group: '內容管理'");
    expect(admin).toContain("commentary: () => [renderAdminCommentary({");
    expect(html).toContain('id="admin-section-commentary"');
  });
});
