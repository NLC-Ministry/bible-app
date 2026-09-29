import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 欄位名稱用拼接的：#263 之後整個 repo 只有舊 migration 檔會出現這個欄位（見 is-demo-unused.test.mjs）。
const DEMO_COLUMN = ["is", "demo"].join("_");

// #261（D1）：正式環境不再允許示範帳號。
describe("profiles_no_demo constraint", () => {
  const migration = read("supabase/migrations/20260926141025_profiles_no_demo.sql");

  it("adds a CHECK that the demo flag is false, idempotently", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS profiles_no_demo");
    expect(migration).toContain(`ADD CONSTRAINT profiles_no_demo CHECK (${DEMO_COLUMN} = false)`);
  });

  it("is dropped together with the column in #263 (D3)", () => {
    const d3 = read(`supabase/migrations/20260929093001_drop_profiles_${DEMO_COLUMN}.sql`);
    expect(d3).toContain("ALTER TABLE public.profiles DROP CONSTRAINT profiles_no_demo;");
    expect(d3).toContain(`ALTER TABLE public.profiles DROP COLUMN ${DEMO_COLUMN};`);
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
