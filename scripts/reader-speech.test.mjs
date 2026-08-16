import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getReaderSpeechRate, resolveReaderStartIndex, selectPreferredChineseVoice } from "../js/modules/reader-speech.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
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

  it("uses a dedicated one-click selection and a resumable audio toggle", () => {
    expect(bible).toContain("setReaderStartSelection(verseDiv)");
    expect(bible).toContain('classList.contains("reader-start-selected")');
    expect(bible).toContain('setAttribute("aria-pressed", "true")');
    expect(bible).toContain("state.readerState.selectedVerseNum = null");
    expect(bible).toContain("startVerseNum ?? state.readerState?.selectedVerseNum ?? null");
    expect(bible).toContain("let isReaderAudioPaused = false");
    expect(bible).toContain("function pauseReaderAudio()");
    expect(bible).toContain("state.readerState.selectedVerseNum = currentItem.verseNum");
    expect(bible).toContain("if (isSpeaking)");
    expect(bible).toContain("resetReaderAudioState()");
    expect(bible).toContain("window.clearReaderAudioOnPageExit = function");
    expect(app).toContain('previousTab === "reader-view"');
    expect(app).toContain("window.clearReaderAudioOnPageExit()");
    expect(bible).toContain("warmReaderVoice(targetLang).then");
    expect(bible).not.toContain("lastFocusedVerseNum) {");
    expect(css).toContain("朗讀起點");
  });

  it("pausing cancels playback instead of suspending it, so resuming always restarts from whichever verse is marked", () => {
    // Regression for: speechSynthesis.pause()/.resume() truly suspends and
    // resumes mid-utterance, so tapping a different verse while paused had
    // no effect — playback just picked back up where it left off. Pause now
    // fully cancels and marks the current verse; the toggle handler's play
    // branch always restarts fresh from state.readerState.selectedVerseNum,
    // so a verse tapped while paused is honored on the next press.
    expect(bible).not.toContain("function resumeReaderAudio()");
    expect(bible).not.toContain("window.speechSynthesis.resume()");
    expect(bible).not.toContain("window.speechSynthesis.pause()");
    const pauseStart = bible.indexOf("function pauseReaderAudio()");
    const pauseEnd = bible.indexOf("\n}", pauseStart);
    const pauseFn = bible.slice(pauseStart, pauseEnd);
    expect(pauseFn).toContain("window.speechSynthesis.cancel()");
    expect(pauseFn).toContain("isSpeaking = false;");
    expect(pauseFn).toContain("isReaderAudioPaused = true;");
    expect(pauseFn).toContain("currentAudioSessionId++;");
    const toggleStart = bible.indexOf("window.toggleReaderAudio = async function");
    const toggleEnd = bible.indexOf("\n};", toggleStart);
    const toggleFn = bible.slice(toggleStart, toggleEnd);
    expect(toggleFn).not.toContain("resumeReaderAudio()");
    expect(toggleFn).toContain("if (isReaderAudioPaused || window.speechSynthesis.speaking || window.speechSynthesis.pending)");
    expect(toggleFn).toContain("stopReaderAudio(true);");
    expect(toggleFn).toContain("const selectedVerseNum = startVerseNum ?? state.readerState?.selectedVerseNum ?? null;");
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
    expect(bible).toContain('scrollReaderVerseIntoView(verseEl, "smooth")');
  });

  it("waits for a successfully rendered next chapter before continuing audio", () => {
    expect(bible).toContain("renderReaderText({ preserveAudio: autoContinue, autoContinue })");
    expect(bible).toContain("if (autoContinue && rendered !== true) return false;");
    expect(bible).toContain("options.autoRetryAttempted !== true");
    expect(bible).toContain("autoRetryAttempted: true");
    expect(bible).toContain("return true;");
  });

  it("resets the actual reader scroll surface after the next chapter layout and follows verse one", () => {
    expect(bible).toContain('document.querySelector("#reader-view .reader-reading-surface")');
    expect(bible).toContain('scrollSurface.scrollTo({ top: safeTop, behavior })');
    expect(bible).toContain("async function resetReaderScrollAfterChapterRender(sessionId)");
    expect(bible).toContain("await nextReaderLayoutFrame()");
    expect(bible).toContain("if (sessionId !== currentAudioSessionId || !isSpeaking) return false;");
    expect(bible).toContain("const scrollReset = await resetReaderScrollAfterChapterRender(sessionId);");
    expect(bible).toContain('setReaderScrollTop(0, "auto")');
    expect(bible).not.toContain('verseEl.scrollIntoView?.({ behavior: "smooth", block: "center" })');
  });

  it("calculates verse following against the reader's own scroll surface", () => {
    const helperStart = bible.indexOf("function getReaderScrollSurface()");
    const helperEnd = bible.indexOf("function nextReaderLayoutFrame()", helperStart);
    const helperSource = bible.slice(helperStart, helperEnd);
    const calls = [];
    const scrollSurface = {
      scrollTop: 600,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo: options => calls.push(options)
    };
    const fakeDocument = {
      querySelector: selector => selector === "#reader-view .reader-reading-surface" ? scrollSurface : null
    };
    const verse = { getBoundingClientRect: () => ({ top: 500, height: 40 }) };
    const scrollReaderVerseIntoView = new Function(
      "document",
      `${helperSource}\nreturn scrollReaderVerseIntoView;`
    )(fakeDocument);

    expect(scrollReaderVerseIntoView(verse, "smooth")).toBe(true);
    expect(calls).toEqual([{ top: 820, behavior: "smooth" }]);
  });

  it("does not cancel speech between verses", () => {
    const audioBlock = bible.slice(bible.indexOf("let isSpeaking = false;"), bible.indexOf("window.searchChapterVerses"));
    // stopReaderAudio() and pauseReaderAudio() (a full cancel + verse-marker
    // remember, not a true suspend — see the other pause/resume test) each
    // call cancel() once for their own user-initiated reason. Neither is on
    // the between-verse onend/speakNextVerseInQueue path.
    expect(audioBlock.match(/speechSynthesis\.cancel\(\)/g)).toHaveLength(2);
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
    expect(html).toContain('class="bottom-sheet-backdrop reader-settings-dialog-backdrop hidden"');
    expect(html).toContain('class="bottom-sheet-container reader-settings-dialog"');
    expect(html).not.toContain('<div class="bottom-sheet-drag-handle"></div>');
    expect(html).toContain('閱讀與朗讀設定');
    expect(html).toContain('id="speech-rate-slider"');
    expect(html).toContain('id="speech-voice-select"');
    expect(html).toContain('id="btn-preview-speech"');
    expect(html).toContain('id="btn-show-tts-guide"');
    expect(html).toContain('id="typography-sheet-apply-btn"');
    expect(html).toContain('class="reader-settings-apply-btn"');
    expect(html).toContain('套用設定');
    expect(utils).toContain('export function initSpeechPreferencesControls()');
    expect(utils).toContain('window.initSpeechPreferencesControls = initSpeechPreferencesControls');
  });

  it("keeps the icon-only preview beside the voice picker and uses system styles", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('class="speech-preview-btn"');
    expect(html).toContain('class="speech-voice-row"');
    expect(html).toContain('aria-label="播放試聽語音"');
    expect(html).not.toContain('id="btn-preview-text"');
    expect(html).not.toContain('即時自動儲存');
    expect(html).toContain('<span>語音設定指南</span>');
    expect(html).not.toContain('data-speech-gender');
    expect(html).not.toContain('聲線偏好');
    expect(css).not.toContain('.speech-gender-btn');
    expect(css).toContain('.speech-preview-btn');
    expect(css).toContain('.speech-voice-select');
    expect(css).toContain('.tts-guide-button');
    expect(css).toContain('.reader-settings-footer');
    expect(css).toContain('.reader-settings-apply-btn');
    expect(css).toMatch(/\.reader-settings-dialog-backdrop \{[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
    expect(css).toMatch(/\.reader-settings-dialog \{[\s\S]*width: min\(34rem, 90vw\);[\s\S]*max-height: min\(82dvh, 44rem\);[\s\S]*border-radius: 20px;/);
    expect(css).toMatch(/\.reader-font-size-tick\.active \{[\s\S]*background: color-mix\(in srgb, var\(--color-brand\)/);
  });

  it("confirms and persists reader settings from the explicit apply button", () => {
    const bible = readFileSync("js/modules/bible.js", "utf8");
    expect(bible).toContain('document.getElementById("typography-sheet-apply-btn")');
    expect(bible).toContain('localStorage.setItem("nlc_speech_settings", JSON.stringify(state.speechSettings))');
    expect(bible).toContain('showToast("閱讀與朗讀設定已套用")');
    expect(bible).toMatch(/settingsApplyBtn\.addEventListener\("click"[\s\S]*closeReaderLayer\(settingsBackdrop\)/);
  });

  it("does not force the centered settings backdrop back to block layout", () => {
    const utils = readFileSync("js/utils.js", "utf8");
    const openSheet = utils.slice(utils.indexOf("export function openTypographySheet"), utils.indexOf("let previewSessionId"));
    expect(openSheet).toContain('backdrop.style.removeProperty("display")');
    expect(openSheet).not.toContain('backdrop.style.display = "block"');
  });

  it("replaces the hydrated preview icon with pause while audio is playing", () => {
    const utils = readFileSync("js/utils.js", "utf8");
    expect(utils).toContain('btnIcon.setAttribute("data-icon", "pause")');
    expect(utils).toContain("btnIcon.replaceChildren()");
    expect(utils).toContain("window.hydrateIcons(btnPreviewSpeech)");
    expect(utils).not.toContain('getSpeechSetting("gender"');
  });
});
