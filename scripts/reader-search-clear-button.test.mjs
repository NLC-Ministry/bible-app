import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");
const bible = readFileSync("js/modules/bible.js", "utf8");
// 目錄（含篩選框）和 /read 共用這個模組（#423）。
const directory = readFileSync("js/modules/bible-nav-directory.mjs", "utf8");

describe("reader search boxes show a single ✕ (#367)", () => {
  it("hides the browser's built-in clear button on both reader search inputs", () => {
    expect(css).toMatch(
      /#global-search-input::-webkit-search-cancel-button,\s*#bible-nav-filter-input::-webkit-search-cancel-button\s*\{[^}]*display:\s*none;/
    );
  });

  it("gives the directory filter the same app clear button as the 🔍 box", () => {
    expect(html).toMatch(/<button type="button" class="search-clear-btn hidden" id="global-search-clear-btn"/);
    expect(html).toMatch(/<button type="button" class="search-clear-btn hidden" id="bible-nav-filter-clear-btn"/);
  });

  it("shows the filter ✕ only with text and resets the filter when tapped", () => {
    expect(bible).toContain("createBibleNavDirectory({");
    expect(directory).toContain('clearBtn.classList.toggle("hidden", !input.value)');
    expect(directory).toContain('$("bible-nav-filter-clear-btn")?.classList.add("hidden")');
    expect(directory).toMatch(/clearBtn\.addEventListener\("click", \(\) => \{\s*clearFilter\(\);/);
  });
});
