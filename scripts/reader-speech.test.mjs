import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getReaderSpeechRate, resolveReaderStartIndex, selectPreferredChineseVoice } from "../js/modules/reader-speech.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const css = readFileSync("index.css", "utf8");
const html = readFileSync("index.html", "utf8");

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

  it("uses calmer reader speech rates for natural listening", () => {
    expect(getReaderSpeechRate("zh-TW")).toBe(0.82);
    expect(getReaderSpeechRate("en-US")).toBe(0.88);
  });

  it("uses a dedicated one-click selection and a stop-first audio toggle", () => {
    expect(bible).toContain("setReaderStartSelection(verseDiv)");
    expect(bible).toContain('classList.contains("reader-start-selected")');
    expect(bible).toContain('setAttribute("aria-pressed", "true")');
    expect(bible).toContain("state.readerState.selectedVerseNum = null");
    expect(bible).toContain("startVerseNum ?? state.readerState?.selectedVerseNum ?? null");
    expect(bible).toContain("isSpeaking || window.speechSynthesis.speaking || window.speechSynthesis.pending");
    expect(bible).toContain("resetReaderAudioState()");
    expect(bible).toContain("warmReaderVoice(targetLang).then");
    expect(bible).not.toContain("lastFocusedVerseNum) {");
    expect(css).toContain("朗讀起點");
  });

  it("shows verse progress, follows playback, and distinguishes automatic from manual chapter navigation", () => {
    expect(html).toContain('id="reader-audio-timeline"');
    expect(html).toContain('id="reader-audio-progress-track"');
    expect(html).toContain('id="reader-audio-progress-fill"');
    expect(css).toContain(".reader-audio-timeline__track");
    expect(bible).toContain("updateReaderAudioTimeline(currentSpeakingVerseIndex, verseListForSpeaking.length");
    expect(bible).toContain("continueReaderAudioToNextChapter(sessionId)");
    expect(bible).toContain("navigateToChapter(1, { autoContinue: true })");
    expect(bible).toContain("if (!autoContinue) stopReaderAudio(true)");
    expect(bible).toContain("resetReaderAudioAfterManualChapterChange(hadAudioPosition)");
    expect(bible).toContain('scrollIntoView?.({ behavior: "smooth", block: "center" })');
  });

  it("does not cancel speech between verses", () => {
    const audioBlock = bible.slice(bible.indexOf("let isSpeaking = false;"), bible.indexOf("window.searchChapterVerses"));
    expect(audioBlock.match(/speechSynthesis\.cancel\(\)/g)).toHaveLength(1);
    expect(audioBlock).toContain("speechUtterance.voice = voiceToUse");
    expect(audioBlock).toContain("speechUtterance.rate = getReaderSpeechRate");
    expect(audioBlock).toContain("selectPreferredVoice");
    expect(audioBlock).toContain("pendingReaderVoicePromise = getInstalledReaderVoice(targetLang)");
  });

  it("provides an accessible, unconditionally registered TTS guide modal overlay", () => {
    const html = readFileSync("index.html", "utf8");
    const profile = readFileSync("js/modules/profile.js", "utf8");
    expect(html).toContain('id="tts-guide-modal"');
    expect(html).toContain('class="tts-guide-modal-overlay hidden"');
    expect(html).toContain('onclick="if(event.target===this)window.closeTtsGuideModal?.()"');
    expect(css).toContain(".tts-guide-modal-overlay {");
    expect(css).toContain("position: fixed;");
    expect(css).toContain("z-index: 10000;");
    expect(css).toContain(".tts-guide-modal-overlay.hidden {");
    expect(profile).toContain("window.openTtsGuideModal = function");
    expect(profile).toContain("window.closeTtsGuideModal = function");
  });

  it("integrates TTS speech settings into the reader typography settings sheet", () => {
    const html = readFileSync("index.html", "utf8");
    const utils = readFileSync("js/utils.js", "utf8");
    expect(html).toContain('id="typography-settings-sheet"');
    expect(html).toContain('閱讀與朗讀設定');
    expect(html).toContain('id="speech-rate-slider"');
    expect(html).toContain('id="speech-voice-select"');
    expect(html).toContain('id="btn-preview-speech"');
    expect(html).toContain('id="btn-show-tts-guide"');
    expect(utils).toContain('export function initSpeechPreferencesControls()');
    expect(utils).toContain('window.initSpeechPreferencesControls = initSpeechPreferencesControls');
  });

  it("places preview button on dedicated row and applies design system button styles", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('class="speech-preview-btn"');
    expect(html).toContain('class="speech-gender-btn active"');
    expect(css).toContain('.speech-gender-btn.active');
    expect(css).toContain('.speech-preview-btn');
    expect(css).toContain('.speech-voice-select');
  });
});
