import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const html = read("index.html");
const css = read("index.css");

const modalStart = html.indexOf('id="tts-guide-modal"');
const modalEnd = html.indexOf("<script", modalStart);
const modal = html.slice(modalStart, modalEnd);

describe("TTS voice-pack guide modal: theme-aware colors", () => {
  it("never uses --bg-panel, an undefined CSS variable that always fell back to hardcoded white", () => {
    // --bg-panel is not defined anywhere in index.css, so
    // `background: var(--bg-panel, #ffffff)` always rendered pure white
    // regardless of theme, while the title/paragraph text used
    // var(--text-primary) which correctly resolves to a near-white color in
    // dark theme (#FAFAFA) — near-white text on a hardcoded white panel,
    // i.e. invisible. The card must use --bg-card (a real, theme-aware
    // token, already #1A1A1A in dark theme / #FDF6E3 in warm theme).
    expect(css).not.toMatch(/--bg-panel:/);
    expect(modal).not.toContain("--bg-panel");
    expect(modal).toContain("background: var(--bg-card)");
  });

  it("never uses --brand-primary, another undefined variable — uses the real --color-brand token instead", () => {
    expect(css).not.toMatch(/--brand-primary:/);
    expect(modal).not.toContain("--brand-primary");
    expect(modal.match(/var\(--color-brand\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders bold emphasis as real <strong> tags, not literal **markdown** asterisks", () => {
    expect(modal).not.toMatch(/\*\*/);
    expect(modal.match(/<strong>/g)?.length).toBeGreaterThanOrEqual(8);
  });
});
