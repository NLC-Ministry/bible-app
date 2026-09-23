import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sw = read("sw.js");
const vercelConfig = read("vercel.json");
const admin = read("js/modules/admin.js");

// 歷史：lazy module 曾以「未帶 hash 的原始檔」發佈在 /modules/，靠 ?v= 查詢字串
// 和 SW network-first 路徑判斷來避免吃到舊快取——路徑前綴寫錯過一次，導致 lazy
// module 無論重開幾次都卡在舊版。現在 lazy module 一律由 esbuild code splitting
// 產生「檔名帶內容 hash」的 chunk（dist/chunks/），檔名不變內容就不變，所以：
//   - chunk 可以永久快取（immutable），SW 用 cacheFirst 就是正確的；
//   - 不能再有任何「未帶 hash、內容會變」的 lazy module 路徑規則。
describe("sw.js：lazy module 是帶 hash 的 chunk，不再有未帶 hash 的 network-first 路徑判斷", () => {
  it("不再特判 /js/modules/、/js/data/、/modules/、/data/", () => {
    expect(sw).not.toContain('url.pathname.startsWith("/js/modules/")');
    expect(sw).not.toContain('url.pathname.startsWith("/js/data/")');
    expect(sw).not.toContain('url.pathname.startsWith("/modules/")');
    expect(sw).not.toContain('url.pathname.startsWith("/data/")');
  });
});

describe("vercel.json：chunk 永久快取，且沒有舊的未帶 hash 模組規則", () => {
  it("/chunks/ 是 immutable，/js/modules/ 與 /modules/ 規則已移除", () => {
    const config = JSON.parse(vercelConfig);
    const chunkRule = config.headers.find(rule => rule.source === "/chunks/(.*)");
    expect(chunkRule.headers[0].value).toContain("immutable");
    expect(vercelConfig).not.toContain('"/js/modules/(.*)');
    expect(vercelConfig).not.toMatch(/"source":\s*"\/modules\//);
  });
});
