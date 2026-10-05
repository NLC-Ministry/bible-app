// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  COMMENTARY_IMAGE_DIR,
  COMMENTARY_INDEX_TTL_MS,
  COMMENTARY_TOPICS,
  buildCommentaryBodyHTML,
  buildCommentaryIndex,
  commentaryChapterKey,
  normalizeTopicTags,
  parseCommentaryIndexCache,
  resolveCommentaryImages,
  serializeCommentaryIndex,
  splitCommentaryParagraphs
} from "../js/data/passage-commentary.mjs";
import { createReaderCommentaryController } from "../js/modules/reader-commentary.mjs";
import { findCommentaryForChapter, sortCommentaryRows } from "../js/modules/admin-commentary.mjs";

const read = path => readFileSync(path, "utf8"); // jsdom 的 URL 不是 Node 的 URL，fs 不收
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

  it("caches the chapter index until the TTL runs out", () => {
    const index = buildCommentaryIndex([
      { book: "出埃及記", chapter: 26 },
      { book: "民數記", chapter: "2" },
      { book: "", chapter: 1 },
      { book: "創世記", chapter: 0 }
    ]);
    expect([...index]).toEqual(["出埃及記|26", "民數記|2"]);
    const raw = serializeCommentaryIndex(index, 1000);
    expect(parseCommentaryIndexCache(raw, 1000 + COMMENTARY_INDEX_TTL_MS - 1).has(commentaryChapterKey("出埃及記", 26))).toBe(true);
    expect(parseCommentaryIndexCache(raw, 1000 + COMMENTARY_INDEX_TTL_MS)).toBeNull();
    expect(parseCommentaryIndexCache(raw, 999)).toBeNull();
    expect(parseCommentaryIndexCache("not json")).toBeNull();
    expect(parseCommentaryIndexCache(null)).toBeNull();
  });

  it("splits paragraphs on blank lines and escapes admin-written text", () => {
    expect(splitCommentaryParagraphs("第一段\r\n\r\n第二段\n續行\n\n\n")).toEqual(["第一段", "第二段\n續行"]);
    const html = buildCommentaryBodyHTML({
      title: "會幕<b>",
      content: "<img src=x onerror=alert(1)>\n第二行\n\n第二段",
      topic_tags: ["tabernacle"]
    }, escapeHTML);
    expect(html).toContain('<h4 class="reader-commentary-title">會幕&lt;b&gt;</h4>');
    expect(html).toContain("<p>&lt;img src=x onerror=alert(1)&gt;<br>第二行</p><p>第二段</p>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('src="assets/commentary/tabernacle-layout.svg"');
    expect(html).toContain('loading="lazy"');
    expect(buildCommentaryBodyHTML({ content: "只有內容" }, escapeHTML)).not.toContain("reader-commentary-figures");
  });
});

function mountReaderDom() {
  document.body.innerHTML = `
    <button id="reader-commentary-btn" class="hidden"></button>
    <div id="reader-commentary-backdrop" class="hidden">
      <p id="reader-commentary-subtitle"></p>
      <button id="reader-commentary-close-btn"></button>
      <div id="reader-commentary-body"></div>
    </div>`;
}

function createController(db) {
  const tasks = [];
  const controller = createReaderCommentaryController({
    db,
    openLayer: element => element.classList.remove("hidden"),
    closeLayer: element => element.classList.add("hidden"),
    escapeHTML,
    schedule: callback => tasks.push(callback)
  });
  const flush = async () => { while (tasks.length) await tasks.shift()(); };
  return { controller, flush };
}

describe("reader commentary controller (#447)", () => {
  it("waits for the scheduler before looking anything up, then shows the button only for chapters with commentary", async () => {
    mountReaderDom();
    const db = { fetchPassageCommentaryIndex: vi.fn(async () => new Set(["出埃及記|26"])), fetchPassageCommentary: vi.fn() };
    const { controller, flush } = createController(db);
    const button = document.getElementById("reader-commentary-btn");

    const pending = controller.refreshForChapter("出埃及記", 26);
    expect(db.fetchPassageCommentaryIndex).not.toHaveBeenCalled();
    await flush();
    expect(await pending).toBe(true);
    expect(button.classList.contains("hidden")).toBe(false);

    controller.resetForChapter();
    expect(button.classList.contains("hidden")).toBe(true);
    const other = controller.refreshForChapter("創世記", 1);
    await flush();
    expect(await other).toBe(false);
    expect(button.classList.contains("hidden")).toBe(true);
    expect(db.fetchPassageCommentary).not.toHaveBeenCalled();
  });

  it("ignores a lookup that finishes after the reader already moved to another chapter", async () => {
    mountReaderDom();
    const db = { fetchPassageCommentaryIndex: vi.fn(async () => new Set(["出埃及記|26"])), fetchPassageCommentary: vi.fn() };
    const { controller, flush } = createController(db);
    const stale = controller.refreshForChapter("出埃及記", 26);
    controller.resetForChapter();
    await flush();
    expect(await stale).toBe(false);
    expect(document.getElementById("reader-commentary-btn").classList.contains("hidden")).toBe(true);
  });

  it("fetches the commentary only when opened, and offers a retry when that fails", async () => {
    mountReaderDom();
    const fetchPassageCommentary = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ title: "會幕", content: "內容", topic_tags: ["tabernacle"] });
    const db = { fetchPassageCommentaryIndex: async () => new Set(["出埃及記|26"]), fetchPassageCommentary };
    const { controller, flush } = createController(db);
    controller.bind();
    const pending = controller.refreshForChapter("出埃及記", 26, "出埃及記 26章");
    await flush();
    await pending;

    expect(await controller.open()).toBe(false);
    const body = document.getElementById("reader-commentary-body");
    expect(controller.isOpen()).toBe(true);
    expect(document.getElementById("reader-commentary-subtitle").textContent).toBe("出埃及記 26章");
    expect(body.querySelector("[data-commentary-retry]")).not.toBeNull();

    expect(await controller.open()).toBe(true);
    expect(fetchPassageCommentary).toHaveBeenLastCalledWith("出埃及記", 26);
    expect(body.querySelector(".reader-commentary-title").textContent).toBe("會幕");
    expect(body.querySelector("img").getAttribute("src")).toBe("assets/commentary/tabernacle-layout.svg");

    expect(controller.close()).toBe(true);
    expect(controller.isOpen()).toBe(false);
    expect(controller.close()).toBe(false);
  });
});

describe("admin commentary helpers (#447)", () => {
  const books = [{ name: "創世記" }, { name: "出埃及記" }, { name: "民數記" }];

  it("sorts rows in Bible order, then by chapter", () => {
    const rows = [
      { id: 1, book: "民數記", chapter: 2 },
      { id: 2, book: "出埃及記", chapter: 27 },
      { id: 3, book: "出埃及記", chapter: 3 },
      { id: 4, book: "創世記", chapter: 1 }
    ];
    expect(sortCommentaryRows(rows, books).map(row => row.id)).toEqual([4, 3, 2, 1]);
  });

  it("finds an existing commentary for the same chapter, ignoring the row being edited", () => {
    const rows = [{ id: "a", book: "出埃及記", chapter: 26 }];
    expect(findCommentaryForChapter(rows, "出埃及記", "26")?.id).toBe("a");
    expect(findCommentaryForChapter(rows, "出埃及記", 26, "a")).toBeNull();
    expect(findCommentaryForChapter(rows, "出埃及記", 25)).toBeNull();
  });
});

describe("passage commentary wiring (#447)", () => {
  const migration = read("supabase/migrations/20261004165112_passage_commentary.sql");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const bible = read("js/modules/bible.js");
  const plan = read("js/modules/plan.js");
  const html = read("index.html");
  const app = read("js/app.js");

  it("creates one commentary per chapter, readable when published and writable only by admins", () => {
    expect(migration).toContain("UNIQUE (book, chapter)");
    expect(migration).toContain("ALTER TABLE public.passage_commentary ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (is_published = TRUE OR public.current_role_code() = 'admin')");
    expect(migration).toContain("WITH CHECK (public.current_role_code() = 'admin')");
    expect(migration).toContain("REVOKE ALL ON TABLE public.passage_commentary FROM PUBLIC, anon;");
    expect(migration).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
  });

  it("lets members read only published commentary through nlc-data and keeps writes admin-only", () => {
    expect(edge).toMatch(/READ_TABLES = new Set\(\[[\s\S]*"passage_commentary"[\s\S]*?\]\)/);
    expect(edge).toContain('const ADMIN_ONLY_WRITE_TABLES = new Set(["passage_commentary"]);');
    expect(edge).toContain("(ADMIN_ONLY_WRITE_TABLES.has(table) && isAdmin(profile))");
    expect(edge).toContain('if (table === "passage_commentary" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };');
    const adminWriteTables = edge.match(/const ADMIN_WRITE_TABLES = new Set\(\[([^\]]*)\]\)/);
    expect(adminWriteTables[1]).not.toContain("passage_commentary");
  });

  it("looks up commentary only after the chapter text has rendered", () => {
    const renderStart = bible.indexOf("export async function renderReaderText(");
    const renderEnd = bible.indexOf("function renderReaderLoadRetryState(", renderStart);
    const render = bible.slice(renderStart, renderEnd);
    expect(render).toContain("readerCommentary.resetForChapter();");
    const refreshAt = render.indexOf("readerCommentary.refreshForChapter(");
    expect(refreshAt).toBeGreaterThan(render.indexOf("refreshVerseSelectionUI();"));
    expect(refreshAt).toBeGreaterThan(render.indexOf("await fetchBibleChapter("));
  });

  it("stays out of the plan's inline reader", () => {
    expect(plan).not.toMatch(/commentary/i);
  });

  it("mounts the sheet outside every .view-pane and lets the back button close it", () => {
    const sheetIndex = html.indexOf('id="reader-commentary-backdrop"');
    expect(sheetIndex).toBeGreaterThan(html.indexOf('id="bible-nav-overlay"'));
    expect(html).toContain('class="reader-icon-btn native-toolbar-btn reader-commentary-btn hidden" id="reader-commentary-btn"');
    expect(app).toContain("window.closeReaderCommentarySheet()");
  });
});
