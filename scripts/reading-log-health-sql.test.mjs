import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 打卡健康檢查 SQL（#350）：要能在 Supabase SQL Editor 一次貼一段執行，
// 所以不能依賴暫存表或跨段的 transaction。
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const file = join(repoRoot, "supabase/queries/reading_log_health.sql");

describe("supabase/queries/reading_log_health.sql", () => {
  it("exists", () => {
    expect(existsSync(file)).toBe(true);
  });

  it("has no temp tables or transaction control", () => {
    const sql = readFileSync(file, "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/CREATE\s+TEMP/i);
    expect(sql).not.toMatch(/\bBEGIN\s*;/i);
    expect(sql).not.toMatch(/\bCOMMIT\s*;/i);
  });

  it("lists all 66 books using the names in bible_data.js", () => {
    const sql = readFileSync(file, "utf8");
    const data = readFileSync(join(repoRoot, "js/data/bible_data.js"), "utf8");
    const names = [...data.matchAll(/\{ id: \d+, name: "([^"]+)"/g)].map(m => m[1]);
    expect(names.length).toBe(66);
    for (const n of names) expect(sql).toContain(`'${n}'`);
  });
});
