import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DAILY_VERSES, pickDailyVerse } from "../js/data/daily_verses.mjs";

describe("DAILY_VERSES", () => {
  it("每條都有以「」包住的經文與「書卷 章:節」格式的出處", () => {
    for (const v of DAILY_VERSES) {
      expect(v.text).toMatch(/^「.+」$/);
      expect(v.source).toMatch(/^\S+ \d+:\d+(-\d+)?$/);
    }
  });

  it("出處與經文皆不重複", () => {
    const sources = DAILY_VERSES.map((v) => v.source);
    const texts = DAILY_VERSES.map((v) => v.text);
    expect(new Set(sources).size).toBe(sources.length);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("不再含已移除的錯標／不適合條目", () => {
    expect(DAILY_VERSES.some((v) => v.source === "詩篇 119:10" && !v.text.includes("一心尋求"))).toBe(false);
    expect(DAILY_VERSES.some((v) => v.source === "哥林多前書 6:9-10")).toBe(false);
    expect(DAILY_VERSES.some((v) => v.text.includes("逿"))).toBe(false);
  });
});

describe("pickDailyVerse", () => {
  it("同一天永遠同一句", () => {
    expect(pickDailyVerse("2026-09-30")).toBe(pickDailyVerse("2026-09-30"));
  });

  it("連續兩天不同，且一輪內不重複", () => {
    const n = DAILY_VERSES.length;
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
      seen.add(pickDailyVerse(d).source);
    }
    expect(seen.size).toBe(n);
  });

  it("日期格式錯誤時退回第一條、不丟例外", () => {
    expect(pickDailyVerse("bad")).toBe(DAILY_VERSES[0]);
  });
});

describe("home.js 接線", () => {
  const src = readFileSync(new URL("../js/modules/home.js", import.meta.url), "utf8");
  it("每日預設用 pickDailyVerse(todayStr)，手動換一句才隨機", () => {
    expect(src).toMatch(/import \{ DAILY_VERSES, pickDailyVerse \} from "\.\.\/data\/daily_verses\.mjs"/);
    expect(src).toMatch(/pickDailyVerse\(todayStr\)/);
  });
});
