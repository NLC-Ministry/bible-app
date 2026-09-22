import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sw = read("sw.js");
const vercelConfig = read("vercel.json");
const admin = read("js/modules/admin.js");

// 真正的 bug：sw.js／vercel.json 判斷「lazy module 要不要一律 network-first / 不快取」
// 時，路徑寫成 /modules/、/data/，但實際被請求的路徑是 js/modules/xxx.js、
// js/data/xxx.js（少了 js/ 前綴）——導致這個判斷式永遠不會命中，所有 lazy module
// （home.js/bible.js/plan.js/admin.js/profile.js/team-registration.js，以及被
// admin.js 動態載入的 exam.js）全部掉進 cacheFirst：一旦快取過一次，不管改版
// 幾次、使用者重開 App 幾次，都會一直吃同一份舊快取，直到 SW 整個換版才會清掉。
describe("sw.js：lazy module 的路徑判斷要用真正被請求的 js/modules、js/data 前綴", () => {
  it("network-first 判斷式用的是 /js/modules/、/js/data/，不是少了 js/ 前綴的 /modules/、/data/", () => {
    expect(sw).toContain('url.pathname.startsWith("/js/modules/")');
    expect(sw).toContain('url.pathname.startsWith("/js/data/")');
    expect(sw).not.toContain('url.pathname.startsWith("/modules/")');
    expect(sw).not.toContain('url.pathname.startsWith("/data/")');
  });
});

describe("vercel.json：/js/modules/ 的 Cache-Control 規則要跟 /js/pwa/、/js/data/ 用同樣的前綴", () => {
  it("header source 是 /js/modules/(.*).(js|mjs)，不是少了 js/ 前綴的 /modules/", () => {
    expect(vercelConfig).toContain('"/js/modules/(.*)\\\\.(js|mjs)"');
    expect(vercelConfig).not.toMatch(/"source":\s*"\/modules\//);
  });
});

describe("admin.js：動態載入 exam.js 的版本號要跟得上 exam.js 本身的最新 ?v=", () => {
  it("exam.js 的 import 版本號已經同步到最新（不再是 0170 那次的舊版本號）", () => {
    expect(admin).toMatch(/from "\.\/exam\.js\?v=[^"]+"/);
    expect(admin).not.toContain("20260911_exam_paper_linked_plan");
  });

  it("import 版本號要跟 js/exam-entry.js 裡 exam.js 的版本號完全一致，避免兩邊各自漂移", () => {
    const examEntry = read("js/exam-entry.js");
    const adminVersionMatch = admin.match(/from "\.\/exam\.js\?v=([^"]+)"/);
    const entryVersionMatch = examEntry.match(/from '\.\/modules\/exam\.js\?v=([^']+)'/);
    expect(adminVersionMatch).not.toBeNull();
    expect(entryVersionMatch).not.toBeNull();
    expect(adminVersionMatch[1]).toBe(entryVersionMatch[1]);
  });
});
