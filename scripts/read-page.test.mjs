// @vitest-environment jsdom
// #416：快速啟動聖經的獨立讀經頁 /read。
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
  { id: 1, name: "創世記", eng: "Genesis", chapters: 50, section: "old" },
  { id: 2, name: "出埃及記", eng: "Exodus", chapters: 40, section: "old" },
  { id: 40, name: "馬太福音", eng: "Matthew", chapters: 28, section: "new" },
  { id: 66, name: "啟示錄", eng: "Revelation", chapters: 22, section: "new" }
];

const readHtml = readFileSync("read.html", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const readEntry = readFileSync("js/read-entry.js", "utf8");
const sw = readFileSync("sw.js", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const bibleJs = readFileSync("js/modules/bible.js", "utf8").replace(/\r\n/g, "\n");

function chapterFor(bookEng, chapter, version = "CUNP") {
  return { reference: `${bookEng} ${chapter}`, translation: version, verses: [
    { verse: 1, text: `${version} ${bookEng} ${chapter}:1` },
    { verse: 2, text: "<b>不要當成 HTML</b>" }
  ] };
}

function mountBody() {
  const body = readHtml.slice(readHtml.indexOf("<body"), readHtml.indexOf("</body>"));
  document.body.innerHTML = body.replace(/^<body[^>]*>/, "").replace(/<script[\s\S]*?<\/script>/g, "");
}

function mount(overrides = {}) {
  const fetchChapter = overrides.fetchChapter || vi.fn(async (eng, ch, version) => chapterFor(eng, ch, version));
  const app = mountReadApp({
    doc: document,
    storage: localStorage,
    books: BOOKS,
    fetchChapter,
    schedule: overrides.schedule || ((fn) => fn()),
    ...overrides,
    fetchChapter
  });
  return { app, fetchChapter };
}

const $ = id => document.getElementById(id);
const verseTexts = () => [...document.querySelectorAll("#read-content .verse-text")].map(el => el.textContent);

beforeEach(() => {
  localStorage.clear();
  mountBody();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("read page opens where the member left off", () => {
  it("opens the saved book, chapter, version and font size from the main app's reader preferences", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 2, chapter: 3 }));
    localStorage.setItem("reader_bible_version", "RCUVTS");
    localStorage.setItem("reader_font_size", "24");
    const { app, fetchChapter } = mount();
    await app.ready;
    expect(fetchChapter).toHaveBeenCalledWith("Exodus", 3, "RCUVTS");
    expect($("read-ref-btn").textContent).toBe("出埃及記 3");
    expect($("read-version-btn").textContent).toBe("RCUV");
    expect($("read-content").style.getPropertyValue("--read-font-size")).toBe("24px");
    expect(verseTexts()[0]).toBe("RCUVTS Exodus 3:1");
  });

  it("falls back to Genesis 1 / CUNP when nothing (or something broken) is saved", async () => {
    localStorage.setItem("reader_state", "{broken");
    const { app, fetchChapter } = mount();
    await app.ready;
    expect(fetchChapter).toHaveBeenCalledWith("Genesis", 1, "CUNP");
  });

  it("renders verse text as text, never as HTML", async () => {
    const { app } = mount();
    await app.ready;
    expect(verseTexts()[1]).toBe("<b>不要當成 HTML</b>");
    expect(document.querySelector("#read-content b")).toBeNull();
  });
});

describe("chapter navigation and pickers", () => {
  it("next/previous cross book boundaries and save the position in the main app's format", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 1, chapter: 50 }));
    const { app, fetchChapter } = mount();
    await app.ready;
    $("read-next").click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Exodus", 1, "CUNP"));
    expect(JSON.parse(localStorage.getItem("reader_state"))).toEqual({ bookId: 2, chapter: 1 });
    $("read-prev").click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Genesis", 50, "CUNP"));
  });

  it("disables previous on the first chapter of the Bible and next on the last", async () => {
    const { app } = mount();
    await app.ready;
    expect($("read-prev").disabled).toBe(true);
    await app.goTo(66, 22);
    expect($("read-next").disabled).toBe(true);
  });

  it("picks a book from the New Testament tab, then a chapter", async () => {
    const { app, fetchChapter } = mount();
    await app.ready;
    $("read-ref-btn").click();
    expect($("read-sheet").classList.contains("hidden")).toBe(false);
    const newTab = [...document.querySelectorAll(".read-segmented__item")].find(b => b.textContent === "新約");
    newTab.click();
    document.querySelector('[data-book-id="40"]').click();
    expect(document.querySelectorAll("[data-chapter]")).toHaveLength(28);
    document.querySelector('[data-chapter="5"]').click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Matthew", 5, "CUNP"));
    expect($("read-sheet").classList.contains("hidden")).toBe(true);
  });

  it("switching version saves it and reloads the chapter in that version", async () => {
    const { app, fetchChapter } = mount();
    await app.ready;
    $("read-version-btn").click();
    document.querySelector('[data-version="NIV"]').click();
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenLastCalledWith("Genesis", 1, "NIV"));
    expect(localStorage.getItem("reader_bible_version")).toBe("NIV");
    expect($("read-ref-btn").textContent).toBe("Genesis 1");
  });

  it("font size steps through the same sizes as the main reader and stops at the ends", async () => {
    localStorage.setItem("reader_font_size", "22");
    const { app } = mount();
    await app.ready;
    $("read-font-up").click();
    expect(localStorage.getItem("reader_font_size")).toBe("24");
    expect($("read-font-up").disabled).toBe(true);
    for (let i = 0; i < 6; i++) $("read-font-down").click();
    expect(localStorage.getItem("reader_font_size")).toBe("16");
    expect($("read-font-down").disabled).toBe(true);
  });
});

describe("never stuck on a blank or loading screen", () => {
  it("offline and not cached: shows 'needs network' with a retry button", async () => {
    const fetchChapter = vi.fn(async () => ({ verses: [{ verse: 1, text: "（經文暫時未載入）" }], isPlaceholder: true }));
    const { app } = mount({ fetchChapter, isOnline: () => false });
    await app.ready;
    expect($("read-content").textContent).toContain("這一章需要網路才能讀取");
    expect([...$("read-content").querySelectorAll("button")].map(b => b.textContent)).toContain("重新載入");
    expect($("read-content").dataset.ready).toBe("1");
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
    expect($("read-content").textContent).toContain("經文暫時載入不了");
  });
});

describe("prefetch for versions without an offline pack", () => {
  it("fetches the next 3 chapters (across books) after showing the chapter", async () => {
    localStorage.setItem("reader_state", JSON.stringify({ bookId: 1, chapter: 49 }));
    const { app, fetchChapter } = mount({ shouldPrefetch: () => true });
    await app.ready;
    await vi.waitFor(() => expect(fetchChapter).toHaveBeenCalledTimes(4));
    expect(fetchChapter.mock.calls.slice(1).map(c => `${c[0]} ${c[1]}`)).toEqual(["Genesis 50", "Exodus 1", "Exodus 2"]);
  });

  it("does not prefetch versions that have an offline pack, or while offline", async () => {
    const packed = mount({ shouldPrefetch: () => false });
    await packed.app.ready;
    expect(packed.fetchChapter).toHaveBeenCalledTimes(1);
    mountBody();
    const offline = mount({ shouldPrefetch: () => true, isOnline: () => false, fetchChapter: vi.fn(async (e, c, v) => chapterFor(e, c, v)) });
    await offline.app.ready;
    expect(offline.fetchChapter).toHaveBeenCalledTimes(1);
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
