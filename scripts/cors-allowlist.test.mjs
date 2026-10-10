// Edge Function 的 CORS 白名單（#553）：三支函式內嵌同一段區塊，只對白名單內的網站回
// Access-Control-Allow-Origin；不再把請求帶來的任何 origin 原樣反射回去。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const FUNCTIONS = ["nlc-data", "nlc-session", "exam-write"];
const read = (name) => readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const block = (src) => src.match(/\/\/ >>> cors-allowlist[\s\S]*?\/\/ <<< cors-allowlist/)?.[0] ?? null;
const sources = Object.fromEntries(FUNCTIONS.map((name) => [name, read(name)]));
const code = transformSync(`${block(sources["nlc-data"])}\nreturn { corsAllowOrigin, corsHeadersFor };`, { loader: "ts" }).code;

function load(env = {}) {
  const Deno = { env: { get: (key) => env[key] } };
  return new Function("Deno", code)(Deno);
}
const requestFrom = (origin) => ({ headers: { get: (key) => (key.toLowerCase() === "origin" ? origin : null) } });

describe("cors-allowlist block", () => {
  it("is embedded verbatim in every browser-facing function", () => {
    const expected = block(sources["nlc-data"]);
    expect(expected).toBeTruthy();
    for (const name of FUNCTIONS) expect(block(sources[name]), name).toBe(expected);
  });

  it("no longer reflects the request origin anywhere", () => {
    for (const name of FUNCTIONS) {
      expect(sources[name], name).not.toMatch(/"Access-Control-Allow-Origin":\s*origin\b/);
      expect(sources[name], name).not.toMatch(/req\.headers\.get\("origin"\)\s*\|\|\s*"\*"/);
      expect(sources[name], name).toContain("corsHeadersFor(req)");
    }
  });

  it("allows production, staging, this team's previews and local dev", () => {
    const { corsAllowOrigin } = load();
    for (const origin of [
      "https://bible.newlife.org.tw",
      "https://bible-speed-reading.vercel.app",
      "https://bible-speed-reading-staging.vercel.app",
      "https://bible-speed-reading-8smlvhqd7-a0970927705-1204s-projects.vercel.app",
      "http://localhost:3100",
      "http://127.0.0.1:5173",
      "http://localhost"
    ]) expect(corsAllowOrigin(origin), origin).toBe(origin);
  });

  it("rejects everything else, including look-alikes", () => {
    const { corsAllowOrigin } = load();
    for (const origin of [
      "https://evil.example",
      "https://bible.newlife.org.tw.evil.example",
      "https://bible-speed-reading-evil.vercel.app",
      "https://bible-speed-reading-abc-someone-else-projects.vercel.app",
      "http://bible.newlife.org.tw",
      "https://localhost:3100",
      "http://localhost.evil.example",
      "null",
      ""
    ]) expect(corsAllowOrigin(origin), origin).toBeNull();
    expect(corsAllowOrigin(null)).toBeNull();
  });

  it("adds APP_ORIGIN and APP_ALLOWED_ORIGINS to the list", () => {
    const { corsAllowOrigin } = load({ APP_ORIGIN: "https://a.example/", APP_ALLOWED_ORIGINS: " https://b.example , https://c.example" });
    expect(corsAllowOrigin("https://a.example")).toBe("https://a.example");
    expect(corsAllowOrigin("https://b.example")).toBe("https://b.example");
    expect(corsAllowOrigin("https://c.example")).toBe("https://c.example");
  });

  it("omits Allow-Origin for a disallowed origin but always varies on Origin", () => {
    const { corsHeadersFor } = load();
    const blocked = corsHeadersFor(requestFrom("https://evil.example"));
    expect(blocked["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(blocked.Vary).toBe("Origin");
    const allowed = corsHeadersFor(requestFrom("https://bible.newlife.org.tw"));
    expect(allowed["Access-Control-Allow-Origin"]).toBe("https://bible.newlife.org.tw");
    expect(allowed["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(allowed["Access-Control-Allow-Headers"]).toContain("x-request-id");
  });
});
