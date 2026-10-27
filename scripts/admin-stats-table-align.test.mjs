// 後台統計區表格（#622）：數字欄的表頭要和數字一樣靠右（adm-num），不然表頭和數字會貼在欄位兩側。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "admin", "src", "views", "StatsArea.tsx"), "utf8");
const tables = source.match(/<table[\s\S]*?<\/table>/g) || [];
const count = (text, re) => (text.match(re) || []).length;

describe("StatsArea tables", () => {
  it("has the tables this check covers", () => {
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });

  it.each(tables.map((table, index) => [index, table]))("table %i aligns every number column header with its cells", (_index, table) => {
    const numCells = count(table, /<td className="adm-num"/g);
    const numHeaders = count(table, /<th scope="col" className="adm-num"/g);
    expect(numCells).toBeGreaterThan(0);
    expect(numHeaders).toBe(numCells);
  });
});
