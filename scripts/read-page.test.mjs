// @vitest-environment jsdom
// #416、#423：快速啟動聖經的獨立讀經頁 /read——版面與操作和主 App 讀經頁一致。
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_CHAPTER_KEY, mountReadApp } from "../js/read/read-app.mjs";
import {
  readReaderPreferences,
  writeReaderPosition
} from "../js/data/reader-preferences.mjs";
import { keepLoginFresh, needsBackgroundRefresh } from "../js/read/read-login-keepalive.mjs";
import { ensureOfflineBiblePack } from "../js/pwa/OfflineBibleControls.js";

const BOOKS = [
  { id: 1, name: "創世記", abbrev: "創", eng: "Genesis", chapters: 50, section: "old" },
  { id: 2, name: "出埃及記", abbrev: "出", eng: "Exodus", chapters: 40, section: "old" },
  { id: 40, name: "馬太福音", abbrev: "太", eng: "Matthew", chapters: 28, section: "new" },
  { id: 66, name: "啟示錄", abbrev: "啟", eng: "Revelation", chapters: 22, section: "new" }
];
const COUNTS = { Genesis: Array(50).fill(31), Exodus: Array(40).fill(22), Matthew: Array(28).fill(25), Revelation: Array(22).fill(20) };

const readHtml = readFileSync("read.html", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const readEntry = readFileSync("js/read-entry.js", "utf8");
const readApp = readFileSync("js/read/read-app.mjs", "utf8");
const sw = readFileSync("sw.js", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const bibleJs = readFileSync("js/modules/bible.js", "utf8").replace(/\r\n/g, "\n");

function chapterFor(bookEng, chapter, version = "CUNP") {
  return { reference: `${bookEng} ${chapter}`, translation: version, verses: [
    { verse: 1, text: `${version} ${bookEng} ${chapter}:1` },
    { verse: 2, text: "<b>不要當成 HTML</b>" },
    { verse: 3, text: "第三節" }
  ] };
}

function mountBody() {
  document.body.className = "";
  const body = readHtml.slice(readHtml.indexOf("<body"), readHtml.indexOf("</body>"));
  document.body.innerHTML = body.replace(/^<body[^>]*>/, "").replace(/<script[\s\S]*?<\/script>/g, "");
}

// 測試裡關掉翻頁動畫（prefers-reduced-motion），換章直接發生。
const reducedMotionWin = Object.assign(Object.create(window), {
  matchMedia: () => ({ matches: true }),
  innerWidth: 390,
  innerHeight: 844
});

function mount(overrides = {}) {
  const fetchChapter = overrides.fetchChapter || vi.fn(async (eng, ch, version) => chapterFor(eng, ch, version));
  const clipboard = overrides.clipboard || { writeText: vi.fn(async () => {}) };
  const app = mountReadApp({
    doc: document,
    win: reducedMotionWin,
    storage: localStorage,
    books: BOOKS,
    getVerseCounts: () => COUNTS,
    schedule: overrides.schedule || ((fn) => fn()),
    clipboard,
    share: overrides.share ?? null,
    ...overrides,
    fetchChapter
  });
  return { app, fetchChapter, clipboard };
}

const $ = id => document.getElementById(id);
const verseTexts = () => [...document.querySelectorAll("#bible-content .verse-text")].map(el => el.textContent);
const verseEl = n => document.querySelector(`#bible-content .bible-verse[data-verse="${n}"]`);

beforeEach(() => {
  localStorage.clear();
  mountBody();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("same layout as the main reader (#423)", () => {
  it("uses the main reader's structure, so index.css scrolls .reader-reading-surface (not the locked body)", () => {
    const doc = new DOMParser().parseFromString(readHtml, "text/html");
    expect(doc.body.classList.contains("reader-page")).toBe(true);
    const surface = doc.querySelector("main.main-content > section#reader-view.view-pane.active article.reader-reading-surface");
    expect(surface).not.toBeNull();
    expect(surface.querySelector("#bible-content.bible-text-container")).not.toBeNull();
    expect(doc.querySelector("#reader-top-navbar.native-reader-toolbar")).not.toBeNull();
    expect(doc.querySelector(".reader-floating-nav #floating-prev-btn")).not.toBeNull();
  });

  it("the toolbar keeps the main reader's ids, plus a 回計畫 link into the full app", () => {
    for (const id of ["reader-nav-directory-btn", "reader-book-badge", "reader-nav-ref-label", "reader-version-inline", "reader-nav-version-btn", "reader-settings-trigger-btn"]) {
      expect(indexHtml, id).toContain(`id="${id}"`);
      expect(readHtml, id).toContain(`id="${id}"`);
    }
    expect(readHtml).toMatch(/<a [^>]*id="read-back-link"[^>]*href="\/\?from=read"/);
  });

  it("the version picker is the same markup as the main reader's", () => {
    const pick = html => {
      const el = new DOMParser().parseFromString(html, "text/html").getElementById("bible-version-picker-modal");
      return el.outerHTML.replace(/\s+/g, " ").replace(/> </g, "><");
    };
    expect(pick(readHtml)).toBe(pick(indexHtml));
  });
});

describe("read page opens where the member left off", () => {
  it("opens the saved book, chapter, version and font size from the main app's reader preferences", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 2, chapter: 3 }));
    localStorage.setItem("reader_bible_version", "RCUVTS");
    localStorage.setItem("reader_font_size", "24");
    const { app, fetchChapter } = mount();
    await app.ready;
    expect(fetchChapter).toHaveBeenCalledWith("Exodus", 3, "RCUVTS");
    expect($("reader-nav-ref-label").textContent).toBe("出埃及記 3");
    expect($("reader-version-inline").textContent).toBe("RCUV");
    expect($("bible-title").textContent).toBe("出埃及記 3章");
    expect($("bible-content").style.getPropertyValue("font-size")).toBe("24px");
    expect(verseTexts()[0]).toBe("RCUVTS Exodus 3:1");
  });

  it("falls back to Genesis 1 / CUNP when nothing (or something broken) is saved", async () => {
    localStorage.setItem("reader_state", "{broken");
    const { app, fetchChapter } = mount();
    await app.ready;
    expect(fetchChapter).toHaveBeenCalledWith("Genesis", 1, "CUNP");
  });

  it("renders verses as the main reader's .bible-verse elements, text never as HTML", async () => {
    const { app } = mount();
    await app.ready;
    expect(verseEl(1).getAttribute("role")).toBe("button");
    expect(verseTexts()[1]).toBe("<b>不要當成 HTML</b>");
    expect(document.querySelector("#bible-content b")).toBeNull();
  });
});

describe("chapter navigation (floating arrows, chapter-end links, directory)", () => {
  it("the floating next/previous arrows cross book boundaries and save the position in the main app's format", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 1, chapter: 50 }));
    const { app, fetchChapter } = mount();
    await app.ready;
    $("floating-next-btn").click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Exodus", 1, "CUNP"));
    expect(JSON.parse(localStorage.getItem("reader_state"))).toEqual({ bookId: 2, chapter: 1 });
    $("floating-prev-btn").click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Genesis", 50, "CUNP"));
  });

  it("disables previous on the first chapter of the Bible and next on the last", async () => {
    const { app } = mount();
    await app.ready;
    expect($("floating-prev-btn").disabled).toBe(true);
    await app.goTo(66, 22);
    expect($("floating-next-btn").disabled).toBe(true);
  });

  it("puts the main reader's 上一章｜下一章 links at the chapter end, and they change chapter", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 1, chapter: 2 }));
    const { app, fetchChapter } = mount();
    await app.ready;
    const next = document.querySelector('#bible-content .reader-chapter-end-nav [data-chapter-nav="1"]');
    expect(next.textContent).toBe("下一章");
    next.click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Genesis", 3, "CUNP"));
  });

  it("the shared directory opens from the toolbar and jumps to the chosen verse", async () => {
    const { app, fetchChapter } = mount();
    await app.ready;
    $("reader-nav-directory-btn").click();
    expect($("bible-nav-overlay").classList.contains("hidden")).toBe(false);
    [...document.querySelectorAll(".grid-item-book")].find(el => el.textContent.includes("馬太福音")).click();
    [...document.querySelectorAll(".chapter-nav-grid .grid-item-number")].find(el => el.textContent === "5").click();
    [...document.querySelectorAll(".verse-nav-grid .grid-item-number")].find(el => el.textContent === "3").click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Matthew", 5, "CUNP"));
    expect($("bible-nav-overlay").classList.contains("hidden")).toBe(true);
    expect($("bible-title").textContent).toBe("馬太福音 5章");
  });

  it("the reference chip also opens the directory, like the main reader", async () => {
    const { app } = mount();
    await app.ready;
    $("reader-book-badge").click();
    expect($("bible-nav-overlay").classList.contains("hidden")).toBe(false);
  });

  it("switching version through the version picker saves it and reloads the chapter", async () => {
    const { app, fetchChapter } = mount();
    await app.ready;
    $("reader-nav-version-btn").click();
    expect($("bible-version-picker-modal").classList.contains("hidden")).toBe(false);
    document.querySelector('#bible-version-picker-modal [data-version="NIV"]').click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Genesis", 1, "NIV"));
    expect(localStorage.getItem("reader_bible_version")).toBe("NIV");
    expect($("reader-nav-ref-label").textContent).toBe("Genesis 1");
    expect($("bible-version-picker-modal").classList.contains("hidden")).toBe(true);
  });

  it("text size uses the main reader's 16–24 ticks in the settings sheet", async () => {
    const { app } = mount();
    await app.ready;
    $("reader-settings-trigger-btn").click();
    expect($("typography-settings-backdrop").classList.contains("hidden")).toBe(false);
    document.querySelector('.reader-font-size-tick[data-reader-font-size="24"]').click();
    expect(localStorage.getItem("reader_font_size")).toBe("24");
    expect($("reader-font-size-value").textContent).toBe("24px");
    expect(document.querySelector(".reader-font-size-tick.active").dataset.readerFontSize).toBe("24");
  });

  it("left/right swiping uses the main reader's swipe controller and page flip", () => {
    expect(readApp).toContain("createReaderSwipeController({");
    expect(readApp).toContain("createReaderPageFlip({");
    expect(readApp).toContain('surface?.classList.add("reader-flip-scroll-locked")');
  });
});

describe("select verses → copy / share (#423)", () => {
  it("tapping verses selects them and shows a bar with only 複製 and 分享", async () => {
    const { app } = mount();
    await app.ready;
    verseEl(1).click();
    expect(verseEl(1).classList.contains("verse-selected")).toBe(true);
    const tiles = [...document.querySelectorAll("#selection-bottom-bar-root .yv-tile .yv-tile-label")].map(el => el.textContent);
    expect(tiles).toEqual(["複製", "分享"]);
    verseEl(1).click();
    expect(document.querySelector("#selection-bottom-bar-root .youversion-action-bar")).toBeNull();
  });

  it("copies in exactly the main reader's format", async () => {
    // 提示 2.2 秒後才收掉：這裡不執行那個排程，才看得到提示。
    const { app, clipboard } = mount({ schedule: (fn, ms) => (ms >= 2000 ? null : fn()) });
    await app.ready;
    verseEl(1).click();
    verseEl(2).click();
    document.querySelector('#selection-bottom-bar-root [data-action="copy"]').click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(clipboard.writeText.mock.calls[0][0]).toBe("【創世記 1:1-2】\n1 CUNP Genesis 1:1\n2 <b>不要當成 HTML</b>");
    expect(document.querySelector(".read-toast").textContent).toBe("經文已複製到剪貼簿！");
  });

  it("shares through the system share sheet when available", async () => {
    const share = vi.fn(async () => {});
    const { app } = mount({ share });
    await app.ready;
    verseEl(3).click();
    document.querySelector('#selection-bottom-bar-root [data-action="share"]').click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledWith({ title: "經文分享", text: "【創世記 1:3】\n3 第三節" }));
  });

  it("keeps the selection across chapters and labels chips with book abbreviations, like the main reader", async () => {
    const { app } = mount();
    await app.ready;
    verseEl(1).click();
    await app.goTo(2, 1);
    verseEl(2).click();
    const chips = [...document.querySelectorAll(".yv-chip-ref")].map(el => el.textContent);
    expect(chips).toEqual(["創1:1", "出1:2"]);
    document.querySelector('[data-action="clear-all"]').click();
    expect(app.selection.size).toBe(0);
  });
});

describe("never stuck on a blank or loading screen", () => {
  it("offline and not cached: shows 'needs network' with a retry button", async () => {
    const fetchChapter = vi.fn(async () => ({ verses: [{ verse: 1, text: "（經文暫時未載入）" }], isPlaceholder: true }));
    const { app } = mount({ fetchChapter, isOnline: () => false });
    await app.ready;
    expect($("bible-content").textContent).toContain("這一章需要網路才能讀取");
    expect([...$("bible-content").querySelectorAll("button")].map(b => b.textContent)).toContain("重新載入");
    expect($("bible-content").dataset.ready).toBe("1");
  });

  it("offline: the last chapter shown is still readable from its own saved copy (survives SW cache clears)", async () => {
    const first = mount();
    await first.app.ready;
    expect(localStorage.getItem(LAST_CHAPTER_KEY)).toContain("Genesis 1:1");
    mountBody();
    const fetchChapter = vi.fn(async () => { throw new TypeError("offline"); });
    const { app } = mount({ fetchChapter, isOnline: () => false });
    await app.ready;
    expect(verseTexts()[0]).toBe("CUNP Genesis 1:1");
  });

  it("a chapter request that never answers gives up after 12 seconds", async () => {
    vi.useFakeTimers();
    const fetchChapter = vi.fn(() => new Promise(() => {}));
    const { app } = mount({ fetchChapter });
    await vi.advanceTimersByTimeAsync(12000);
    await app.ready;
    expect($("bible-content").textContent).toContain("經文暫時載入不了");
  });
});

describe("prefetch around the shown chapter (#440)", () => {
  it("fetches the next 2 chapters and the previous one (across books) after showing the chapter", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 1, chapter: 50 }));
    const { app, fetchChapter } = mount();
    await app.ready;
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenCalledTimes(4));
    expect(fetchChapter.mock.calls.slice(1).map(c => `${c[0]} ${c[1]}`)).toEqual(["Exodus 1", "Exodus 2", "Genesis 49"]);
  });

  // 經文包譯本由 fetchBibleChapter 從本機讀；離線時它會退回快取。預抓結果也是翻頁預覽的來源，所以不擋。
  it("prefetches offline-pack versions and while offline too, so the flip preview has the next chapter", async () => {
    localStorage.setItem("reader_bible_version", "OCCB");
    const { app, fetchChapter } = mount({ isOnline: () => false });
    await app.ready;
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenCalledTimes(3));
    expect(fetchChapter.mock.calls.slice(1).map(c => `${c[0]} ${c[1]} ${c[2]}`)).toEqual(["Genesis 2 OCCB", "Genesis 3 OCCB"]);
  });
});

describe("reader preferences stay compatible with the main app", () => {
  it("writes reader_state with only bookId and chapter (state.js merges the whole object)", () => {
    writeReaderPosition(localStorage, { bookId: 5, chapter: 7 });
    expect(JSON.parse(localStorage.getItem("reader_state"))).toEqual({ bookId: 5, chapter: 7 });
    expect(bibleJs).toContain('localStorage.setItem("reader_state", JSON.stringify({\n    bookId: state.readerState.bookId,\n    chapter: state.readerState.chapter\n  }));');
  });

  it("uses the same keys the main reader reads", () => {
    localStorage.setItem("reader_bible_version", "occb");
    localStorage.setItem("reader_font_size", "23");
    const prefs = readReaderPreferences(localStorage, BOOKS);
    expect(prefs.version).toBe("OCCB");
    expect(prefs.fontSize).toBe(22); // 跟 state.js loadLocalSettings() 同一套取最接近的檔位
    expect(bibleJs).toContain('localStorage.setItem("reader_bible_version", newVersion)');
    expect(bibleJs).toContain('localStorage.setItem("reader_font_size", size)');
  });
});

describe("background login keep-alive on /read", () => {
  it("does nothing (and never loads auth) without a refresh token", async () => {
    const loadAuth = vi.fn();
    await expect(keepLoginFresh({ storage: localStorage, loadAuth })).resolves.toBe("skipped");
    expect(loadAuth).not.toHaveBeenCalled();
  });

  it("skips while the access token is still fresh", () => {
    localStorage.setItem("nlc_refresh_token", "r");
    localStorage.setItem("nlc_token_expires_at", String(Date.now() + 30 * 60 * 1000));
    expect(needsBackgroundRefresh(localStorage)).toBe(false);
  });

  it("refreshes through auth.refreshTokens() when the access token is about to expire", async () => {
    localStorage.setItem("nlc_refresh_token", "r");
    localStorage.setItem("nlc_token_expires_at", String(Date.now() - 1000));
    const auth = { refreshTokens: vi.fn(async () => true) };
    await expect(keepLoginFresh({ storage: localStorage, loadAuth: async () => auth })).resolves.toBe("refreshed");
    expect(auth.refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("swallows failures", async () => {
    localStorage.setItem("nlc_refresh_token", "r");
    await expect(keepLoginFresh({ storage: localStorage, loadAuth: async () => { throw new Error("boom"); } })).resolves.toBe("failed");
  });
});

describe("verse commentary on /read (#470)", () => {
  function commentaryDb() {
    return {
      fetchIndex: vi.fn(async () => new Set(["創世記|1"])),
      fetchChapter: vi.fn(async () => ({
        rows: [{ id: "n2", chapter: 1, verse_start: 2, verse_end: 2, content: "第二節說明" }],
        terms: []
      })),
      fetchTermDetails: vi.fn(async () => new Map())
    };
  }

  it("shows the verse icon after the chapter renders; the icon opens the sheet without selecting the verse", async () => {
    const db = commentaryDb();
    const { app } = mount({ commentaryDb: db });
    await app.ready;
    await vi.waitFor(() => expect(document.querySelector('#bible-content [data-verse-commentary="2"]')).not.toBeNull());
    expect(db.fetchChapter).toHaveBeenCalledWith("創世記", 1);
    expect($("reader-commentary-btn").classList.contains("hidden")).toBe(true); // 沒有整章注釋

    document.querySelector('[data-verse-commentary="2"]').click();
    await vi.waitFor(() => expect($("reader-commentary-body").textContent).toContain("第二節說明"));
    expect($("reader-commentary-backdrop").classList.contains("hidden")).toBe(false);
    expect(app.selection.size).toBe(0);
  });

  it("adds 注釋 to the selection toolbar only when a selected verse has commentary", async () => {
    const { app } = mount({ commentaryDb: commentaryDb() });
    await app.ready;
    await vi.waitFor(() => expect(document.querySelector("[data-verse-commentary]")).not.toBeNull());
    app.toggleVerse(1);
    expect(document.querySelector('#selection-bottom-bar-root [data-action="commentary"]')).toBeNull();
    app.toggleVerse(2);
    const tile = document.querySelector('#selection-bottom-bar-root [data-action="commentary"]');
    expect(tile).not.toBeNull();
    tile.click();
    await vi.waitFor(() => expect($("reader-commentary-subtitle").textContent).toBe("創世記 1:2"));
  });

  it("works without commentary (signed out): no icons, no 注釋 tile", async () => {
    const { app } = mount();
    await app.ready;
    app.toggleVerse(1);
    expect(document.querySelector("[data-verse-commentary]")).toBeNull();
    expect(document.querySelector('#selection-bottom-bar-root [data-action="commentary"]')).toBeNull();
  });
});

describe("/read loads nothing login-related before showing scripture", () => {
  it("the entry never statically imports auth, db, state or Supabase", () => {
    const staticImports = [...readEntry.matchAll(/^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm)].map(m => m[1]);
    for (const banned of ["./auth.js", "./db.js", "./state.js", "./auth-launch.mjs"]) {
      expect(staticImports).not.toContain(banned);
    }
    expect(readEntry).toContain('await import("./auth.js")');
  });

  it("read.html loads no external resources (no CDN, no fonts)", () => {
    expect(readHtml).not.toMatch(/(src|href)="https?:\/\//);
  });
});

describe("quick-launch redirect in index.html", () => {
  const redirect = (() => {
    const open = indexHtml.indexOf('<script id="quick-launch-redirect">');
    const start = indexHtml.indexOf(">", open) + 1;
    return indexHtml.slice(start, indexHtml.indexOf("</script>", start));
  })();

  function run({ enabled = true, pathname = "/", search = "", hash = "" } = {}) {
    const location = { pathname, search, hash, replace: vi.fn() };
    const storage = { getItem: key => (key === "quick_launch_bible_enabled" && enabled ? "true" : null) };
    new Function("location", "localStorage", redirect)(location, storage);
    return location.replace;
  }

  it("is the first script in <head>, before any other resource", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    expect(head.indexOf('id="quick-launch-redirect"')).toBeLessThan(head.indexOf('id="boot-watchdog"'));
    expect(head.indexOf('id="quick-launch-redirect"')).toBeLessThan(head.indexOf("<link"));
  });

  it("sends a bare / to /read when quick launch is on", () => {
    expect(run()).toHaveBeenCalledWith("/read");
    expect(run({ pathname: "/index.html" })).toHaveBeenCalledWith("/read");
  });

  it("never redirects when quick launch is off", () => {
    expect(run({ enabled: false })).not.toHaveBeenCalled();
  });

  it.each([
    ["the Logto login callback", "?code=abc&state=xyz"],
    ["a Logto error callback", "?error=access_denied"],
    ["the Member Hub return", "?resume=plan"],
    ["the auth bridge", "?auth_continuation=x"],
    ["the repair page return", "?repaired=1&version=1"],
    ["a notification tap", "?from=notification"],
    ["回計畫 from /read", "?from=read"]
  ])("does not redirect %s", (_label, search) => {
    expect(run({ search })).not.toHaveBeenCalled();
  });

  it("does not redirect hash deep links (#370) or other pages", () => {
    expect(run({ hash: "#/plans" })).not.toHaveBeenCalled();
    expect(run({ pathname: "/exam.html" })).not.toHaveBeenCalled();
  });
});

describe("Service Worker and hosting for /read", () => {
  it("precaches /read and its bundle, and falls back to /read itself when offline", () => {
    expect(sw).toContain('const READ_PAGE_PATH = "/read";');
    expect(sw).toContain('const BUILD_READ_JS_PATH = "__BUILD_READ_JS_PATH__";');
    expect(sw).toMatch(/APP_SHELL = \[[\s\S]*READ_PAGE_PATH,[\s\S]*BUILD_READ_JS_PATH[\s\S]*\];/);
    expect(sw).toContain('fallbackUrl: isReadPage ? READ_PAGE_PATH : "/"');
  });

  it("notification taps open the full app, even from an open /read window", () => {
    expect(sw).toContain('const notificationUrl = "/?from=notification";');
    expect(sw).toContain("self.clients.openWindow(notificationUrl)");
    expect(sw).toContain("client.navigate(notificationUrl)");
    expect(sw).not.toContain('openWindow("/")');
  });

  it("/read is never cached long-term by the CDN, its hashed bundle is immutable", () => {
    const header = source => vercel.headers.find(h => h.source === source)?.headers[0].value || "";
    expect(header("/read")).toContain("no-cache");
    expect(header("/read.html")).toContain("no-cache");
    expect(header("/read.(.*).js")).toContain("immutable");
  });
});

describe("turning quick launch on downloads the offline pack when the version has one", () => {
  function repository(installed = null) {
    return { getInstalledPack: vi.fn(async () => installed), downloadPack: vi.fn(async () => ({})) };
  }

  it("reports unsupported for versions without a pack (和合本)", async () => {
    await expect(ensureOfflineBiblePack(repository(), "CUNP", { online: true })).resolves.toBe("unsupported");
  });

  it("does nothing when already installed or offline", async () => {
    await expect(ensureOfflineBiblePack(repository({ translation: "OCCB" }), "OCCB", { online: true })).resolves.toBe("installed");
    await expect(ensureOfflineBiblePack(repository(), "OCCB", { online: false })).resolves.toBe("offline");
  });

  it("starts the download through the settings page button so its progress shows", async () => {
    document.body.innerHTML = '<div id="offline-bible-settings"><button data-offline-bible-action="WEB"></button></div>';
    const button = document.querySelector("button");
    const click = vi.fn();
    button.addEventListener("click", click);
    const repo = repository();
    await expect(ensureOfflineBiblePack(repo, "web", { online: true })).resolves.toBe("started");
    expect(click).toHaveBeenCalledTimes(1);
    expect(repo.downloadPack).not.toHaveBeenCalled();
  });
});
