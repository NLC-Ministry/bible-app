// #680：CLI 3.0.0 在代理程式模式下，沒帶 --read-only 的 db query 一律要使用者同意。
import { describe, expect, it } from "vitest";
import { PROD_REF, STAGING_REF, SUPABASE_CLI, buildQueryCommand, parseCliRows, remoteFlag, runSqlWrite, supabaseCommand } from "./lib/supabase-cli-query.mjs";

describe("supabaseCommand", () => {
  it("釘住 CLI 版本，不讓 npx 自己升級", () => {
    expect(SUPABASE_CLI).toMatch(/^supabase@\d+\.\d+\.\d+$/);
    expect(supabaseCommand(["functions", "list"])).toBe(`npx ${SUPABASE_CLI} functions list`);
  });
});

describe("remoteFlag", () => {
  it("組出 --remote=<ref>，格式不對或沒設定就擋下", () => {
    expect(remoteFlag(STAGING_REF)).toBe(`--remote=${STAGING_REF}`);
    expect(() => remoteFlag("")).toThrow(/project ref/);
    expect(() => remoteFlag("not-a-ref")).toThrow(/project ref/);
  });
});

describe("buildQueryCommand", () => {
  it("預設是唯讀，不用使用者同意", () => {
    const command = buildQueryCommand(STAGING_REF, "a/b.sql");
    expect(command).toContain(`--remote=${STAGING_REF}`);
    expect(command).toContain("--read-only");
    expect(command).toContain('-f "a/b.sql"');
    expect(command).not.toMatch(/--yes|--linked|--project-ref/);
  });

  it("寫入才帶 --yes，而且不帶 --read-only", () => {
    const command = buildQueryCommand(STAGING_REF, "a.sql", { write: true });
    expect(command).toContain("--yes");
    expect(command).not.toContain("--read-only");
  });

  it("擋掉會破壞指令的路徑", () => {
    expect(() => buildQueryCommand(STAGING_REF, 'a".sql')).toThrow(/不支援的路徑/);
  });

  // #717：不指定的話，CLI 只在偵測到 AI agent 時輸出 JSON，人在 PowerShell 手動跑會輸出表格。
  // 用 --output-format 指定格式，不用 --agent（那會改變 CLI 的安全行為判斷）。
  it("明確要 JSON 輸出，不靠 agent 偵測，也不碰 --agent", () => {
    for (const command of [buildQueryCommand(STAGING_REF, "a.sql"), buildQueryCommand(STAGING_REF, "a.sql", { write: true })]) {
      expect(command).toContain("--output-format json");
      expect(command).not.toContain("--agent");
    }
  });
});

// #717：CLI 3.0.0 帶 --output-format json 時，人手動跑輸出純陣列，agent 模式輸出 { rows }（2026-11-25 實測）。
describe("parseCliRows", () => {
  it("讀人手動跑時的純陣列", () => {
    expect(parseCliRows('[\n  {\n    "one": 1,\n    "two": "a"\n  }\n]\n')).toEqual([{ one: 1, two: "a" }]);
    expect(parseCliRows("[]\n")).toEqual([]);
  });

  it("讀 agent 模式的 { rows }", () => {
    const output = JSON.stringify({ boundary: "x", rows: [{ one: 1 }], warning: "untrusted" }, null, 2);
    expect(parseCliRows(output)).toEqual([{ one: 1 }]);
  });

  it("略過 JSON 前面的訊息行", () => {
    expect(parseCliRows('Initialising login role...\n[{"one":1}]')).toEqual([{ one: 1 }]);
  });

  it("輸出是表格時，提示格式不對，不印整張表，ref 要遮掉", () => {
    const ref = "abcdefghijklmnopqrst";
    const table = `Target: project ${ref}\n┌─────┐\n│ one │\n├─────┤\n${"│ 1   │\n".repeat(500)}└─────┘`;
    let message = "";
    try { parseCliRows(table, { ref }); } catch (error) { message = error.message; }
    expect(message).toMatch(/輸出格式/);
    expect(message).not.toContain(ref);
    expect(message.length).toBeLessThan(800);
  });
});

describe("runSqlWrite", () => {
  it("不准寫正式站", () => {
    expect(() => runSqlWrite(PROD_REF, "select 1;")).toThrow(/正式站/);
  });
});
