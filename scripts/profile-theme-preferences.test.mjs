import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");
const state = readFileSync("js/state.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");
const bible = readFileSync("js/modules/bible.js", "utf8");

describe("Profile theme preferences", () => {
  it("adds a dedicated preferences tab with light, dark and warm choices (#427)", () => {
    expect(html).toContain('data-profile-open="preferences"');
    expect(html).toContain('id="profile-tab-content-preferences"');
    expect(html).toContain('data-profile-theme="light"');
    expect(html).toContain('data-profile-theme="dark"');
    expect(html).toContain('data-profile-theme="warm"');
    expect(css).toContain(".profile-theme-option__swatch--warm");
    expect(css).toContain(".profile-theme-option.active");
  });

  it("removes the top bar day and night toggle without touching the verse card background action", () => {
    expect(html).not.toContain('id="theme-toggle"');
    expect(css).not.toContain("#theme-toggle");
    expect(state).not.toContain('getElementById("theme-toggle")');
    expect(app).not.toContain('getElementById("theme-toggle")');
    expect(html).toContain('id="btn-change-verse-bg"');
  });

  it("uses one shared theme action for profile and reader controls", () => {
    expect(state).toContain("window.applyAppTheme = applyAppTheme");
    expect(state).toContain('localStorage.setItem("app_theme", nextTheme)');
    expect(profile).toContain('window.applyAppTheme(button.dataset.profileTheme)');
    expect(bible).not.toContain("window.applyAppTheme = function");
  });
});
// #427: run the real theme functions from js/state.js against the real radiogroup in index.html.
describe("Profile theme options switch the app theme (#427)", () => {
  function setup() {
    const group = html.match(/<div class="profile-theme-options"[\s\S]*?<\/div>\s*<\/div>/)[0];
    const dom = new JSDOM(`<!doctype html><html><body class="light-theme">${group}</body></html>`);
    const { window } = dom;
    const start = state.indexOf("// Theme Management");
    const end = state.indexOf("window.applyAppTheme = applyAppTheme");
    const storage = {};
    const run = new window.Function(
      "state", "localStorage", "document", "window", "CustomEvent",
      `${state.slice(start, end)}; return applyAppTheme;`
    );
    const appState = { theme: "light" };
    const applyAppTheme = run(appState, { setItem: (k, v) => { storage[k] = v; } }, window.document, window, window.CustomEvent);
    return { document: window.document, applyAppTheme, appState, storage };
  }

  it("offers 明亮 / 深色 / 暖色 in that order", () => {
    const { document } = setup();
    const options = [...document.querySelectorAll("[data-profile-theme]")];
    expect(options.map((b) => b.dataset.profileTheme)).toEqual(["light", "dark", "warm"]);
    expect(options.map((b) => b.textContent.trim())).toEqual(["明亮", "深色", "暖色"]);
  });

  it("choosing warm applies warm-theme, marks only the warm option checked, and remembers it", () => {
    const { document, applyAppTheme, appState, storage } = setup();
    applyAppTheme("warm");
    expect(document.body.classList.contains("warm-theme")).toBe(true);
    expect(document.body.classList.contains("dark")).toBe(false);
    expect(appState.theme).toBe("warm");
    expect(storage.app_theme).toBe("warm");
    const checked = [...document.querySelectorAll('[data-profile-theme][aria-checked="true"]')].map((b) => b.dataset.profileTheme);
    expect(checked).toEqual(["warm"]);
  });
});
