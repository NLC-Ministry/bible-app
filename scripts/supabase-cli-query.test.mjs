// #680：CLI 3.0.0 在代理程式模式下，沒帶 --read-only 的 db query 一律要使用者同意。
import { describe, expect, it } from "vitest";
import { PROD_REF, STAGING_REF, SUPABASE_CLI, buildQueryCommand, remoteFlag, runSqlWrite, supabaseCommand } from "./lib/supabase-cli-query.mjs";

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
});

describe("runSqlWrite", () => {
  it("不准寫正式站", () => {
    expect(() => runSqlWrite(PROD_REF, "select 1;")).toThrow(/正式站/);
  });
});
