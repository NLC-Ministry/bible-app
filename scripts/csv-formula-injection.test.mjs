// CSV 公式注入（#553）：所有匯出共用 js/modules/csv-cell.mjs。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { csvCell, neutralizeCsvFormula } from "../js/modules/csv-cell.mjs";
import { prependTaiwanExportTime } from "../js/modules/export-time.mjs";

describe("csvCell", () => {
  it("prefixes cells that a spreadsheet would run as a formula", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell('=HYPERLINK("http://evil.example","點我")')).toBe(`"'=HYPERLINK(""http://evil.example"",""點我"")"`);
    expect(csvCell("+cmd|' /C calc'!A0")).toBe(`"'+cmd|' /C calc'!A0"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@SUM(A1:A2)")).toBe(`"'@SUM(A1:A2)"`);
    expect(csvCell("\t=1")).toBe(`"'\t=1"`);
    expect(csvCell("\r=1")).toBe(`"'\r=1"`);
    expect(csvCell("\n=1")).toBe(`"'\n=1"`);
  });

  it("leaves ordinary text and real numbers alone", () => {
    expect(csvCell("王小明")).toBe(`"王小明"`);
    expect(csvCell("a=b")).toBe(`"a=b"`);
    expect(csvCell(42)).toBe(`"42"`);
    expect(csvCell(-3)).toBe(`"-3"`);
    expect(csvCell("-3")).toBe(`"-3"`);
    expect(csvCell("-12.5%")).toBe(`"-12.5%"`);
    expect(csvCell("+886")).toBe(`"+886"`);
    expect(csvCell("-")).toBe(`"-"`);
    expect(csvCell("")).toBe(`""`);
    expect(csvCell(null)).toBe(`""`);
    expect(csvCell(undefined)).toBe(`""`);
  });

  it("still doubles embedded quotes", () => {
    expect(csvCell('他說"好"')).toBe(`"他說""好"""`);
    expect(neutralizeCsvFormula('=a"b')).toBe(`'=a"b`);
  });

  it("is used by the shared export-time header", () => {
    expect(prependTaiwanExportTime("x", new Date("2026-10-11T00:00:00Z")).split("\n")[0]).toMatch(/^"匯出時間（台灣時間）",".*2026-10-11 08:00"$/);
  });
});

describe("every CSV export uses csvCell", () => {
  const EXPORT_FILES = [
    "js/modules/admin.js",
    "js/modules/plan-stats.js",
    "js/modules/exam.js",
    "js/modules/export-time.mjs",
    "js/modules/lightning-quiz-analytics.mjs",
    "components/issue-report/AdminReportView.tsx"
  ];
  it.each(EXPORT_FILES)("%s has no hand-rolled quote-only CSV escaping", (file) => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    // 舊寫法只跳脫雙引號，沒處理公式開頭
    expect(src).not.toMatch(/replace\(\/"\/g, '""'\)/);
    expect(src).toMatch(/import \{ csvCell \} from "[./]+(js\/modules\/)?csv-cell\.mjs"/);
  });
});
