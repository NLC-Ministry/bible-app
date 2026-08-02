import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveReaderStartIndex, selectPreferredChineseVoice } from "../js/modules/reader-speech.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const css = readFileSync("index.css", "utf8");

describe("reader speech controls", () => {
  it("starts at the selected verse and defaults to the first verse", () => {
    const verses = [{ verseNum: 1 }, { verseNum: 2 }, { verseNum: 7 }];
    expect(resolveReaderStartIndex(verses, 7)).toBe(2);
    expect(resolveReaderStartIndex(verses, null)).toBe(0);
    expect(resolveReaderStartIndex(verses, 99)).toBe(0);
  });

  it("prefers a natural Traditional Chinese voice", () => {
    const voices = [
      { name: "English Natural", lang: "en-US" },
      { name: "Chinese Compact", lang: "zh-TW", default: true },
      { name: "Microsoft HsiaoChen Online (Natural)", lang: "zh-TW" }
    ];
    expect(selectPreferredChineseVoice(voices)?.name).toContain("HsiaoChen");
  });

  it("uses a dedicated one-click selection and a stop-first audio toggle", () => {
    expect(bible).toContain("setReaderStartSelection(verseDiv)");
    expect(bible).toContain('classList.contains("reader-start-selected")');
    expect(bible).toContain('setAttribute("aria-pressed", "true")');
    expect(bible).toContain("state.readerState.selectedVerseNum = null");
    expect(bible).toContain("startVerseNum ?? state.readerState?.selectedVerseNum ?? null");
    expect(bible).toContain("isSpeaking || window.speechSynthesis.speaking || window.speechSynthesis.pending");
    expect(bible).not.toContain("lastFocusedVerseNum) {");
    expect(css).toContain("朗讀起點");
  });

  it("does not cancel speech between verses", () => {
    const audioBlock = bible.slice(bible.indexOf("let isSpeaking = false;"), bible.indexOf("window.searchChapterVerses"));
    expect(audioBlock.match(/speechSynthesis\.cancel\(\)/g)).toHaveLength(1);
    expect(audioBlock).toContain("speechUtterance.voice = preferredReaderVoice");
    expect(audioBlock).toContain("speechUtterance.rate = 0.92");
  });
});
