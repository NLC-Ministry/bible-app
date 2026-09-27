import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// #263 第 1 步：網站與 Edge Functions 不再讀寫 profiles.is_demo。
// profiles_no_demo（D1）保證沒有示範帳號，所以「排除示範帳號」的條件永遠成立；
// 程式碼不再引用這個欄位之後，第 2 步才能安全刪掉它。
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(js|mjs|ts|tsx|html)$/.test(name)) out.push(path);
  }
  return out;
}

describe("is_demo is no longer used by the app", () => {
  const files = [
    ...walk("js"),
    ...walk("components"),
    ...walk("lib"),
    "index.html",
    "exam.html",
    "grade.html",
    "supabase/functions/nlc-data/index.ts",
    "supabase/functions/nlc-session/index.ts",
    "scripts/staging-sample-data.mjs"
  ];

  it.each(files)("%s does not reference is_demo", file => {
    expect(readFileSync(file, "utf8")).not.toMatch(/is_demo|isDemo\b/);
  });
});
