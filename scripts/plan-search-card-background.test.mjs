import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("index.css");
const plan = read("js/modules/plan.js");
const home = read("js/modules/home.js");

describe("plan search", () => {
  it("connects the plan search action to an accessible search field", () => {
    expect(html).toContain('id="btn-toggle-plan-search"');
    expect(html).toContain('aria-controls="plan-search-panel"');
    expect(html).toContain('id="plan-search-input"');
    expect(html).toContain('id="btn-clear-plan-search"');
    expect(css).toContain(".plan-search-panel:focus-within");
  });

  it("filters joined and available plans using the same normalized query", () => {
    expect(plan).toContain("let planSearchQuery = ''");
    expect(plan).toContain("function normalizePlanSearchValue");
    expect(plan).toContain("function matchesPlanSearch");
    expect(plan).toContain("plansToRender = plansToRender.filter(matchesPlanSearch)");
    expect(plan).toContain("if (!matchesSearch) return false");
    expect(plan).toContain('planSearchInput.addEventListener("input"');
  });
});

describe("daily verse card mode", () => {
  it("preserves the displayed background on the first switch to Heavenly Father cards", () => {
    expect(home).toContain("function getDisplayedVerseCardImageUrl");
    expect(home).toContain("async function fetchRandomVerse(event, options = {})");
    expect(home).toContain('renderDailyVerse({ preserveBackground: true })');
    expect(home).toContain("fetchRandomVerse(null, options)");
    expect(home).toContain("bgImgEl && !options.preserveBackground");
    expect(home).toContain("options.preserveBackground ? getDisplayedVerseCardImageUrl()");
  });

  it("still changes the background for later draw-card actions", () => {
    expect(home).toMatch(/drawBtn\.addEventListener[\s\S]*fetchRandomVerse\(\)/);
    expect(home).toContain("if (!preservedImageUrl)");
    expect(home).toContain('localStorage.setItem("verse_card_bg", nextImageUrl)');
  });
});
