// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// #364: 朗讀語速常用值 buttons beside the slider, and the reader toolbar /
// settings dialog staying usable under OS text zoom.

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

function mountRateControls() {
  document.body.innerHTML = `
    <span id="speech-rate-val"></span>
    <input type="range" id="speech-rate-slider" min="0.5" max="2.0" step="0.05" value="1.0">
    <div class="speech-rate-presets">
      <button type="button" class="speech-rate-preset" data-speech-rate="0.75" aria-pressed="false">0.75x</button>
      <button type="button" class="speech-rate-preset" data-speech-rate="1" aria-pressed="false">1.0x</button>
      <button type="button" class="speech-rate-preset" data-speech-rate="1.25" aria-pressed="false">1.25x</button>
      <button type="button" class="speech-rate-preset" data-speech-rate="1.5" aria-pressed="false">1.5x</button>
    </div>`;
}

const pressed = () => [...document.querySelectorAll(".speech-rate-preset")]
  .filter(btn => btn.getAttribute("aria-pressed") === "true")
  .map(btn => btn.dataset.speechRate);

describe("speech rate presets", () => {
  let initSpeechPreferencesControls;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    globalThis.state = { speechSettings: { rate: 1.25, gender: "auto", voiceURI: "" } };
    mountRateControls();
    ({ initSpeechPreferencesControls } = await import("../js/utils.js"));
  });

  afterEach(() => {
    delete globalThis.state;
    document.body.innerHTML = "";
  });

  it("marks the preset matching the saved rate when the dialog opens", () => {
    initSpeechPreferencesControls();
    expect(document.getElementById("speech-rate-slider").value).toBe("1.25");
    expect(pressed()).toEqual(["1.25"]);
  });

  it("applies a preset to the slider, label, state and storage", () => {
    initSpeechPreferencesControls();
    document.querySelector('[data-speech-rate="0.75"]').click();

    expect(document.getElementById("speech-rate-slider").value).toBe("0.75");
    expect(document.getElementById("speech-rate-val").textContent).toBe("0.75x (沉靜慢速)");
    expect(state.speechSettings.rate).toBe(0.75);
    expect(JSON.parse(localStorage.getItem("nlc_speech_settings")).rate).toBe(0.75);
    expect(pressed()).toEqual(["0.75"]);
  });

  it("clears every preset when the slider lands between them", () => {
    initSpeechPreferencesControls();
    const slider = document.getElementById("speech-rate-slider");
    slider.value = "1.1";
    slider.dispatchEvent(new Event("input"));

    expect(state.speechSettings.rate).toBe(1.1);
    expect(pressed()).toEqual([]);
  });

  it("binds each preset once even though the dialog re-inits on every open", () => {
    initSpeechPreferencesControls();
    initSpeechPreferencesControls();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    document.querySelector('[data-speech-rate="1.5"]').click();
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });
});

describe("reader toolbar and settings dialog under OS text zoom", () => {
  it("ships the four presets in the reader settings dialog", () => {
    for (const rate of ["0.75", "1", "1.25", "1.5"]) {
      expect(html).toContain(`class="speech-rate-preset" data-speech-rate="${rate}"`);
    }
  });

  it("keeps the toolbar buttons from being pushed off screen", () => {
    expect(css).toMatch(/#reader-view \.native-reader-toolbar \{[\s\S]*?container-type: inline-size;/);
    expect(css).toMatch(/#reader-view \.native-reader-toolbar > \* \{\s*flex-shrink: 0;/);
    expect(css).toMatch(/#reader-view \.native-reader-toolbar > \.reader-ref-chip \{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/@container \(max-width: 22rem\) \{\s*#reader-view \.native-reader-toolbar > #reader-nav-directory-btn,[\s\S]*?display: none;/);
    // Layout containment on #reader-view would re-anchor its position:fixed
    // descendants (.reader-floating-nav) to the reader box.
    expect(css).not.toMatch(/#reader-view \{[^}]*container-type/);
  });

  it("scrolls the whole settings dialog instead of a squeezed body", () => {
    expect(css).toMatch(/\.reader-settings-dialog \{\s*overflow-x: hidden;\s*overflow-y: auto;/);
    expect(css).toMatch(/\.reader-settings-dialog \.bottom-sheet-body \{[\s\S]*?overflow: visible;/);
  });
});
