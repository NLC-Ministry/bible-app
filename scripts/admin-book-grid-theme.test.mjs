import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

// #469：新增計畫的書卷勾選格寫死白底，深色主題下白底白字看不到書名。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const planAdmin = read("js/modules/plan-admin.js");
const css = read("index.css");
const html = readLegacyIndexHtml();

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `index.css 缺少 ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("新增計畫書卷勾選格跟隨主題", () => {
  it("書卷格子用 class，不再寫死背景色", () => {
    const start = planAdmin.indexOf("BIBLE_BOOKS.forEach(book => {");
    const body = planAdmin.slice(start, planAdmin.indexOf("});", start));
    expect(body).toContain('label.className = "admin-book-option";');
    expect(body).not.toMatch(/background:\s*white/);
    expect(body).not.toContain("label.style");
  });

  it("格子背景與文字用主題 token，書名不換行", () => {
    const option = rule(".admin-book-option");
    expect(option).toContain("background: var(--bg-card);");
    expect(option).toContain("color: var(--text-primary);");
    expect(rule(".admin-book-option__name")).toContain("white-space: nowrap;");
  });

  it("勾選中的格子用品牌色標示", () => {
    const checked = rule(".admin-book-option:has(input:checked)");
    expect(checked).toContain("border-color: var(--color-brand);");
    expect(checked).toContain("background: var(--color-brand-subtle);");
  });

  it("兩個書卷 grid 用共用 class，不再用 70px 最小寬度", () => {
    expect(html).toMatch(/id="admin-old-books-grid" class="admin-book-grid"/);
    expect(html).toMatch(/id="admin-new-books-grid" class="admin-book-grid"/);
    expect(html).not.toContain("minmax(70px, 1fr)");
  });
});
