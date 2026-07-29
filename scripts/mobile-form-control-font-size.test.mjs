import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("index.css", "utf8");
const nonTextualInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit"
]);
const safetySectionMarker = "/* Mobile form control font-size safety net */";
const protectedSelectors = [
  ".form-control",
  ".reader-search-input",
  "#plan-search-input",
  ".inline-select",
  ".reader-select-compact",
  ".announcement-form-panel__input",
  ".announcement-form-panel__textarea",
  ".devotional-textarea",
  ".member-search-wrapper input"
];

const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim(),
  declarations: match[2],
  start: match.index,
  end: match.index + match[0].length
}));

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(path);
    return entry.isFile() && /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

function findSmallInlineControlFontSizes(source, file) {
  const violations = [];
  const controlPattern = /<(input|textarea|select)\b[^>]*>/gi;

  for (const match of source.matchAll(controlPattern)) {
    const [, tagName] = match;
    const tag = match[0];
    const type = tag.match(/\btype\s*=\s*["']?([^\s"'>]+)/i)?.[1]?.toLowerCase();
    if (tagName.toLowerCase() === "input" && nonTextualInputTypes.has(type)) continue;

    const style = tag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    const fontSize = style?.match(/\bfont-size\s*:\s*([0-9]*\.?[0-9]+)\s*(px|rem)\b/i);
    if (!fontSize) continue;

    const size = Number(fontSize[1]);
    const unit = fontSize[2].toLowerCase();
    const isTooSmall = (unit === "px" && size < 16) || (unit === "rem" && size < 1);
    if (!isTooSmall) continue;

    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${line} has inline font-size: ${fontSize[1]}${unit}`);
  }

  return violations;
}

describe("mobile form control font-size safety", () => {
  it("defines a 16px minimum form-control text token", () => {
    expect(css).toContain("--form-control-text-size: 1rem");
  });

  it("protects textual native form controls from iOS focus zoom", () => {
    expect(css).toContain('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])');
    expect(css).toContain("textarea");
    expect(css).toContain("select");
    expect(css).toContain("font-size: var(--form-control-text-size)");
  });

  it("protects app-specific vanilla form-control classes", () => {
    protectedSelectors.forEach((selector) => {
      expect(css).toContain(selector);
    });
  });

  it("uses a winning safety rule for protected controls", () => {
    const safetySectionStart = css.indexOf(safetySectionMarker);
    expect(safetySectionStart).toBeGreaterThanOrEqual(0);

    const safetyRule = cssRules.find(
      (rule) =>
        rule.end > safetySectionStart &&
        rule.declarations.includes("font-size: var(--form-control-text-size)")
    );

    expect(safetyRule).toBeDefined();
    expect(safetyRule.selectors).not.toMatch(/:where\(/);
    protectedSelectors.forEach((selector) => {
      expect(safetyRule.selectors).toContain(selector);
    });

    const laterProtectedFontSizeRules = cssRules.filter(
      (rule) =>
        rule.start > safetyRule.end &&
        rule.declarations.match(/font-size\s*:/) &&
        protectedSelectors.some((selector) => rule.selectors.includes(selector))
    );

    expect(laterProtectedFontSizeRules).toEqual([]);
  });

  it("does not disable user scaling as an auto-zoom workaround", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/maximum-scale\s*=\s*1/i);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/i);
  });

  it("does not set an inline font size below 16px on text-entry controls", () => {
    const sourceFiles = ["index.html", ...listJavaScriptFiles("js")].sort();
    const violations = sourceFiles.flatMap((file) =>
      findSmallInlineControlFontSizes(readFileSync(file, "utf8"), file)
    );

    expect(violations).toEqual([]);
  });
});
