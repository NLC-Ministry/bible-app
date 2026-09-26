import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// #261（D1）：正式環境不再允許示範帳號。
describe("profiles_no_demo constraint", () => {
  const migration = read("supabase/migrations/20260926141025_profiles_no_demo.sql");

  it("adds a CHECK that is_demo is false, idempotently", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS profiles_no_demo");
    expect(migration).toMatch(/ADD CONSTRAINT profiles_no_demo CHECK \(is_demo = false\)/);
  });
});

// #262（D2）：離線 Demo 模式已經移除。forceOfflineDemo 原本寫死 false，
// 呼叫的 setDemoMode() 在整個專案裡也沒有定義。
describe("offline demo mode is gone", () => {
  const db = read("js/db.js");

  it("has no forceOfflineDemo switch or setDemoMode call", () => {
    expect(db).not.toMatch(/forceOfflineDemo/);
    expect(db).not.toMatch(/setDemoMode/);
  });

  it("still reports a missing Supabase config instead of silently entering a demo", () => {
    expect(db).toContain('console.error("Supabase config is missing or invalid!");');
  });

  it("drops the unused demoMode copy string", () => {
    expect(read("js/copy/zh-Hant.js")).not.toMatch(/demoMode/);
  });
});
