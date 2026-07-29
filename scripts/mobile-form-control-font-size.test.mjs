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
const textEntrySourceFiles = [
  "components/ui/input.tsx",
  "components/ui/textarea.tsx",
  "components/ui/native-select.tsx",
  "components/issue-report/ReportDrawer.tsx",
  "components/issue-report/AdminUsersAccordion.tsx"
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

function listReactComponentFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listReactComponentFiles(path);
    return entry.isFile() && /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

function findSmallControlTextClasses(source, file) {
  const violations = [];
  const controlPattern = /<(input|textarea|select|Input|Textarea|NativeSelect)\b[^>]*>/gi;

  for (const match of source.matchAll(controlPattern)) {
    const [, tagName] = match;
    const tag = match[0];
    const type = tag.match(/\btype\s*=\s*["']?([^\s"'>]+)/i)?.[1]?.toLowerCase();
    if (tagName.toLowerCase() === "input" && nonTextualInputTypes.has(type)) continue;
    if (!/\bclassName\s*=/.test(tag) && !/\bclass\s*=/.test(tag)) continue;
    if (!/\btext-(xs|sm)\b/.test(tag)) continue;

    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${line} applies text-xs/text-sm to a text-entry control`);
  }

  return violations;
}

function findSmallInlineControlFontSizes(source, file) {
  const violations = [];
  const controlPattern = /<(input|textarea|select|Input|Textarea|NativeSelect)\b[^>]*>/gi;

  for (const match of source.matchAll(controlPattern)) {
    const [, tagName] = match;
    const tag = match[0];
    const type = tag.match(/\btype\s*=\s*["']?([^\s"'>]+)/i)?.[1]?.toLowerCase();
    if (tagName.toLowerCase() === "input" && nonTextualInputTypes.has(type)) continue;

    const styleAttribute = tag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    const cssFontSize = styleAttribute?.match(/\bfont-size\s*:\s*([^;]+)/i)?.[1];
    const jsxFontSize = tag.match(/\bfontSize\s*:\s*([^,}]+)/i)?.[1];
    const rawFontSize = cssFontSize ?? jsxFontSize;
    if (rawFontSize === undefined) continue;

    const value = rawFontSize.trim().replace(/^["']|["']$/g, "");
    const numericFontSize = value.match(/^([0-9]*\.?[0-9]+)(px|rem)$/i);
    const unitlessJsxFontSize = cssFontSize === undefined && jsxFontSize !== undefined &&
      /^\d+(?:\.\d+)?$/.test(value);
    const isSafe = numericFontSize
      ? (numericFontSize[2].toLowerCase() === "px" && Number(numericFontSize[1]) >= 16) ||
        (numericFontSize[2].toLowerCase() === "rem" && Number(numericFontSize[1]) >= 1)
      : unitlessJsxFontSize && Number(value) >= 16;
    if (isSafe) continue;

    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${line} has inline font-size: ${value}`);
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
    const sourceFiles = ["index.html", ...listJavaScriptFiles("js"), ...textEntrySourceFiles].sort();
    const violations = sourceFiles.flatMap((file) =>
      findSmallInlineControlFontSizes(readFileSync(file, "utf8"), file)
    );

    expect(violations).toEqual([]);
  });
});

describe("React text-entry controls avoid small text classes", () => {
  it("does not use text-sm or text-xs directly on text-entry controls", () => {
    const sourceFiles = [...new Set([...textEntrySourceFiles, ...listReactComponentFiles("components")])].sort();
    const violations = sourceFiles.flatMap((file) =>
      findSmallControlTextClasses(readFileSync(file, "utf8"), file)
    );

    expect(violations).toEqual([]);
  });

  it("audits only the control opening tag so nearby helper text can stay compact", () => {
    expect(
      findSmallControlTextClasses(
        '<Textarea className="min-h-[80px]" />\n<p className="text-sm">Helper</p>',
        "fixture.tsx"
      )
    ).toEqual([]);

    expect(
      findSmallControlTextClasses('<Textarea className="min-h-[80px] text-sm" />', "fixture.tsx")
    ).toEqual([expect.stringContaining("fixture.tsx:1 applies text-xs/text-sm")]);
  });
});

describe("inline text-entry font-size audit", () => {
  it("accepts only demonstrably safe px/rem values, including JSX styles", () => {
    expect(findSmallInlineControlFontSizes('<Input style={{ fontSize: "16px" }} />', "fixture.tsx")).toEqual([]);
    expect(findSmallInlineControlFontSizes('<Textarea style={{ fontSize: "1rem" }} />', "fixture.tsx")).toEqual([]);
    expect(findSmallInlineControlFontSizes('<Input style={{ fontSize: 16 }} />', "fixture.tsx")).toEqual([]);
    expect(findSmallInlineControlFontSizes('<NativeSelect style={{ fontSize: "var(--small-size)" }} />', "fixture.tsx")).toEqual([
      expect.stringContaining("fixture.tsx:1 has inline font-size")
    ]);
  });

  it.each(["16", "12"])("rejects unitless HTML font-size values: %s", (fontSize) => {
    expect(findSmallInlineControlFontSizes(`<input style="font-size: ${fontSize}">`, "fixture.html")).toEqual([
      expect.stringContaining(`fixture.html:1 has inline font-size: ${fontSize}`)
    ]);
  });

  it("rejects a unitless JSX fontSize below 16", () => {
    expect(findSmallInlineControlFontSizes('<Textarea style={{ fontSize: 12 }} />', "fixture.tsx")).toEqual([
      expect.stringContaining("fixture.tsx:1 has inline font-size: 12")
    ]);
  });

  it.each(["0.8em", "75%", "12pt", "calc(1rem - 2px)", "var(--small-size)"])(
    "rejects ambiguous inline font-size values: %s",
    (fontSize) => {
      expect(findSmallInlineControlFontSizes(`<input style="font-size: ${fontSize}">`, "fixture.html")).toEqual([
        expect.stringContaining("fixture.html:1 has inline font-size")
      ]);
    }
  );
});
