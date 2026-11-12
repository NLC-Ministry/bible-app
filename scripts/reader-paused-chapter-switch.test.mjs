import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldStopPausedAudioForRender } from "../js/modules/reader-human-audio.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");

function fnBody(signature) {
  const start = bible.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  return bible.slice(start, bible.indexOf("\n}", start));
}

describe("朗讀暫停後換章（#705）", () => {
  it("暫停中換到別章：收掉朗讀（跟上一章／下一章按鈕一致）", () => {
    expect(shouldStopPausedAudioForRender({ paused: true, pausedChapterKey: "43:4", renderChapterKey: "4:1" })).toBe(true);
  });

  it("同一章重新顯示（換譯本、改字級）：保留暫停", () => {
    expect(shouldStopPausedAudioForRender({ paused: true, pausedChapterKey: "43:4", renderChapterKey: "43:4" })).toBe(false);
  });

  it("沒有暫停、或朗讀自動接下一章（preserveAudio）：不在這裡處理", () => {
    expect(shouldStopPausedAudioForRender({ paused: false, pausedChapterKey: "43:4", renderChapterKey: "4:1" })).toBe(false);
    expect(shouldStopPausedAudioForRender({ paused: true, preserveAudio: true, pausedChapterKey: "43:4", renderChapterKey: "4:1" })).toBe(false);
  });

  it("不知道暫停在哪一章：當作別章，收掉（寧可收掉也不留錯的進度列）", () => {
    expect(shouldStopPausedAudioForRender({ paused: true, pausedChapterKey: "", renderChapterKey: "4:1" })).toBe(true);
  });

  it("暫停時記下是哪一章；renderReaderText 用它決定要不要收掉暫停中的朗讀", () => {
    expect(fnBody("function pauseReaderAudio(")).toContain("pausedReaderAudioChapterKey = ");
    const render = fnBody("export async function renderReaderText(");
    expect(render).toContain("shouldStopPausedAudioForRender({");
    expect(render).toContain("paused: isReaderAudioPaused");
  });
});
