import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  HUMAN_AUDIO_COPY,
  buildFhlAudioInfoUrl,
  clampHumanAudioRate,
  createHumanAudioPlayer,
  formatAudioClock,
  formatHumanAudioTimelineLabel,
  normalizeSpeechMode,
  readFhlAudioUrl,
  resolveReaderSpeechSource
} from "../js/modules/reader-human-audio.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const utils = readFileSync("js/utils.js", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");
const sw = readFileSync("sw.js", "utf8");

// 假的 <audio>：記錄 play/pause/src，事件用 dispatch() 手動觸發。
function createFakeAudio() {
  const listeners = {};
  return {
    src: "",
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    preload: "",
    paused: true,
    playCalls: 0,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    load() {},
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    dispatch(type) { (listeners[type] || []).forEach(fn => fn()); }
  };
}

function fhlResponse(bookId, chapter) {
  const pad = String(chapter).padStart(3, "0");
  return {
    ok: true,
    json: async () => ({ status: "success", mp3: `https://media.fhl.net/unv1/${bookId}/${bookId}_${pad}.mp3` })
  };
}

describe("真人朗讀：版本與模式（#636）", () => {
  it("預設是裝置語音，只有明確選了 human 才是真人朗讀", () => {
    expect(normalizeSpeechMode(undefined)).toBe("device");
    expect(normalizeSpeechMode("")).toBe("device");
    expect(normalizeSpeechMode("human")).toBe("human");
  });

  it("新標點和合本、官話和合本播真人朗讀；其他版本退回裝置語音並標示 fallback", () => {
    expect(resolveReaderSpeechSource({ mode: "human", version: "CUNP" })).toEqual({ source: "human", fallback: false });
    expect(resolveReaderSpeechSource({ mode: "human", version: "CUV" })).toEqual({ source: "human", fallback: false });
    for (const version of ["RCUVTS", "OCCB", "ESV", "NIV", "NLT", "WEB"]) {
      expect(resolveReaderSpeechSource({ mode: "human", version })).toEqual({ source: "device", fallback: true });
    }
    expect(resolveReaderSpeechSource({ mode: "device", version: "CUNP" })).toEqual({ source: "device", fallback: false });
    expect(resolveReaderSpeechSource({ mode: undefined, version: undefined })).toEqual({ source: "device", fallback: false });
  });
});

describe("真人朗讀：信望愛 API（#636）", () => {
  it("用信望愛公開的 au.php 取和合本（version=0）正體音檔", () => {
    expect(buildFhlAudioInfoUrl(43, 3)).toBe("https://bible.fhl.net/json/au.php?version=0&bid=43&chap=3&gb=0");
  });

  it("只接受 media.fhl.net 的 https 音檔網址", () => {
    expect(readFhlAudioUrl({ status: "success", mp3: "https://media.fhl.net/unv1/43/43_003.mp3" }))
      .toBe("https://media.fhl.net/unv1/43/43_003.mp3");
    expect(readFhlAudioUrl({ status: "fail", mp3: "https://media.fhl.net/unv1/43/43_003.mp3" })).toBeNull();
    expect(readFhlAudioUrl({ status: "success", mp3: "http://media.fhl.net/unv1/43/43_003.mp3" })).toBeNull();
    expect(readFhlAudioUrl({ status: "success", mp3: "https://evil.example/43_003.mp3" })).toBeNull();
    expect(readFhlAudioUrl(null)).toBeNull();
  });
});

describe("真人朗讀：進度顯示（#636）", () => {
  it("時間顯示成 分:秒，長度未知顯示 --:--", () => {
    expect(formatAudioClock(0)).toBe("0:00");
    expect(formatAudioClock(83.9)).toBe("1:23");
    expect(formatAudioClock(3605)).toBe("60:05");
    expect(formatAudioClock(NaN)).toBe("--:--");
    expect(formatAudioClock(Infinity)).toBe("--:--");
  });

  it("進度文字沿用朗讀中／已暫停／已完成的前綴", () => {
    expect(formatHumanAudioTimelineLabel({ status: "speaking", currentTime: 83, duration: 362 })).toBe("朗讀中・1:23／6:02");
    expect(formatHumanAudioTimelineLabel({ status: "paused", currentTime: 83, duration: 362 })).toBe("已暫停・1:23／6:02");
    expect(formatHumanAudioTimelineLabel({ status: "completed", currentTime: 362, duration: 362 })).toBe("已完成・6:02／6:02");
    expect(formatHumanAudioTimelineLabel({ status: "loading", currentTime: 0, duration: NaN })).toBe("載入中…");
  });

  it("語速沿用朗讀語速設定，限制在 0.5～2 倍", () => {
    expect(clampHumanAudioRate(undefined)).toBe(1);
    expect(clampHumanAudioRate(1.25)).toBe(1.25);
    expect(clampHumanAudioRate(0.1)).toBe(0.5);
    expect(clampHumanAudioRate(5)).toBe(2);
  });
});

describe("真人朗讀播放器（#636）", () => {
  it("播一章：取網址、套語速、從頭播；暫停後同一章從原位置續播", async () => {
    const audio = createFakeAudio();
    const fetchImpl = vi.fn(async url => fhlResponse(43, 3));
    const player = createHumanAudioPlayer({ createAudio: () => audio, fetchImpl });

    await player.start({ bookId: 43, chapter: 3, rate: 1.25 });
    expect(fetchImpl).toHaveBeenCalledWith(buildFhlAudioInfoUrl(43, 3));
    expect(audio.src).toBe("https://media.fhl.net/unv1/43/43_003.mp3");
    expect(audio.playbackRate).toBe(1.25);
    expect(player.isLoaded(43, 3)).toBe(true);
    expect(player.isLoaded(43, 4)).toBe(false);

    audio.currentTime = 90;
    player.pause();
    expect(audio.paused).toBe(true);
    await player.resume({ rate: 1 });
    expect(audio.currentTime).toBe(90);
    expect(audio.playbackRate).toBe(1);
    expect(audio.playCalls).toBe(2);
  });

  it("同一章的網址只問一次（預抓下一章後，接章時不用再等網路）", async () => {
    const audio = createFakeAudio();
    const fetchImpl = vi.fn(async url => {
      const chap = Number(new URL(url).searchParams.get("chap"));
      return fhlResponse(43, chap);
    });
    const player = createHumanAudioPlayer({ createAudio: () => audio, fetchImpl });
    player.prefetch(43, 4);
    await player.start({ bookId: 43, chapter: 4, rate: 1 });
    await player.start({ bookId: 43, chapter: 4, rate: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("取不到網址就丟錯，讓讀經頁提示需要網路", async () => {
    const audio = createFakeAudio();
    const player = createHumanAudioPlayer({
      createAudio: () => audio,
      fetchImpl: async () => { throw new TypeError("Failed to fetch"); }
    });
    await expect(player.start({ bookId: 43, chapter: 3, rate: 1 })).rejects.toThrow();
    expect(audio.playCalls).toBe(0);
    expect(player.isLoaded(43, 3)).toBe(false);
  });

  it("網址還在取時按了停止：不會在停止後才開始播", async () => {
    const audio = createFakeAudio();
    let release;
    const fetchImpl = () => new Promise(resolve => { release = () => resolve(fhlResponse(43, 3)); });
    const player = createHumanAudioPlayer({ createAudio: () => audio, fetchImpl });
    const pending = player.start({ bookId: 43, chapter: 3, rate: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    player.stop();
    release();
    await expect(pending).resolves.toBe(false);
    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBe("");
  });

  it("停止後清掉音檔；停止時瀏覽器丟出的 error 事件不會回報成播放失敗", async () => {
    const audio = createFakeAudio();
    const onError = vi.fn();
    const onEnded = vi.fn();
    const player = createHumanAudioPlayer({ createAudio: () => audio, fetchImpl: async () => fhlResponse(43, 3), onError, onEnded });
    await player.start({ bookId: 43, chapter: 3, rate: 1 });
    audio.dispatch("ended");
    expect(onEnded).toHaveBeenCalledTimes(1);
    player.stop();
    audio.dispatch("error");
    audio.dispatch("ended");
    expect(onError).not.toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(player.isLoaded(43, 3)).toBe(false);
  });

  it("拖曳進度條跳到指定秒數", async () => {
    const audio = createFakeAudio();
    const player = createHumanAudioPlayer({ createAudio: () => audio, fetchImpl: async () => fhlResponse(43, 3) });
    await player.start({ bookId: 43, chapter: 3, rate: 1 });
    audio.duration = 362;
    player.seek(120);
    expect(audio.currentTime).toBe(120);
    player.seek(9999);
    expect(audio.currentTime).toBe(362);
    expect(player.getPosition()).toEqual({ currentTime: 362, duration: 362 });
  });
});

describe("真人朗讀接進讀經頁（#636）", () => {
  it("設定裡有「真人朗讀｜裝置語音」切換，預設裝置語音，並註明出處", () => {
    expect(html).toContain('data-speech-mode="human"');
    expect(html).toContain('data-speech-mode="device"');
    expect(html).toContain('id="speech-mode-note"');
    expect(HUMAN_AUDIO_COPY.attribution).toContain("信望愛站");
    expect(HUMAN_AUDIO_COPY.attribution).toContain("FDL");
    expect(utils).toContain('normalizeSpeechMode(getSpeechSetting("mode"');
    expect(utils).toContain('setSpeechSetting("mode"');
  });

  it("進度條在真人朗讀時換成可拖曳的時間軸，沒有音檔的版本顯示一鍵改看和合本", () => {
    expect(html).toContain('id="reader-audio-seek"');
    expect(html).toContain('id="reader-audio-notice"');
    expect(html).toContain('id="reader-audio-switch-cuv"');
    expect(css).toContain(".reader-audio-timeline__seek");
    expect(css).toContain(".reader-audio-timeline__notice");
    expect(bible).toContain('window.selectBibleVersion("CUV")');
  });

  it("播完整章跟裝置語音一樣先打卡再接下一章，下一章音檔不等經文畫好就開始播", () => {
    const start = bible.indexOf("async function continueReaderAudioToNextChapter(sessionId)");
    const end = bible.indexOf("\n}", start);
    const fn = bible.slice(start, end);
    const recordAt = fn.indexOf("recordLeavingReaderChapter({ force: true })");
    const humanAt = fn.indexOf("continueHumanAudioToNextChapter(sessionId)");
    expect(recordAt).toBeGreaterThan(-1);
    expect(humanAt).toBeGreaterThan(recordAt);

    const humanStart = bible.indexOf("async function continueHumanAudioToNextChapter(sessionId)");
    const humanEnd = bible.indexOf("\n}", humanStart);
    const humanFn = bible.slice(humanStart, humanEnd);
    expect(humanFn.indexOf("player.start(")).toBeGreaterThan(-1);
    expect(humanFn.indexOf("player.start(")).toBeLessThan(humanFn.indexOf("navigateToChapter(1, { autoContinue: true })"));
  });

  it("鎖定畫面顯示書卷章節並可切上一章／下一章", () => {
    expect(bible).toContain("new MediaMetadata(");
    expect(bible).toContain("session.setActionHandler(action, handler)");
    expect(bible).toContain('bind("previoustrack", () => { void skipHumanAudioChapter(-1); })');
    expect(bible).toContain('bind("nexttrack", () => { void skipHumanAudioChapter(1); })');
  });

  it("音檔不經過 Service Worker：只攔截 bible.fhl.net 的經文 API，不攔 media.fhl.net", () => {
    const start = sw.indexOf("function isBibleRequest(");
    const end = sw.indexOf("\n}", start);
    const fn = sw.slice(start, end);
    const isBibleRequest = new Function(`${fn}\n}\nreturn isBibleRequest;`)();
    expect(isBibleRequest(new Request("https://bible.fhl.net/json/au.php?version=0&bid=43&chap=3&gb=0"))).toBe(true);
    expect(isBibleRequest(new Request("https://media.fhl.net/unv1/43/43_003.mp3"))).toBe(false);
  });
});
