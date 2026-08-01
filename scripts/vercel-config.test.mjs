// scripts/vercel-config.test.mjs
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const headerFor = (source) => {
  const rule = cfg.headers.find((header) => header.source === source);
  return rule ? rule.headers.find((entry) => entry.key === "Cache-Control")?.value : undefined;
};

describe("vercel.json", () => {
  it("outputs the dist directory", () => expect(cfg.outputDirectory).toBe("dist"));

  it("keeps the stable app entry fresh and recovers stale hashed URLs", () => {
    expect(headerFor("/app.js")).toContain("no-store");
    expect(cfg.rewrites).toContainEqual({ source: "/app.:hash.js", destination: "/app.js" });
    expect(cfg.rewrites).toContainEqual({ source: "/js/app.js", destination: "/app.js" });
  });

  it("keeps entry HTML uncacheable", () => {
    expect(headerFor("/")).toContain("no-store");
    expect(headerFor("/index.html")).toContain("no-store");
  });

  it("caches content-hashed app JS immutably", () => {
    const value = headerFor("/app.(.*).js");
expect(value).toContain("public");
    expect(value).toContain("max-age=31536000");
    expect(value).toContain("immutable");
  });

  it("keeps stable CSS fresh and caches content-hashed CSS immutably", () => {
    expect(headerFor("/index.css")).toContain("no-store");
    const value = headerFor("/index.(.*).css");
expect(value).toContain("public");
    expect(value).toContain("max-age=31536000");
    expect(value).toContain("immutable");
  });

  it("keeps the Service Worker updateable", () => {
    expect(cfg.headers.some((header) => header.source === "/config.js")).toBe(false);
    const value = headerFor("/sw.js");
    expect(value).toContain("no-store");
    expect(value).not.toContain("immutable");
  });

  it("keeps unhashed PWA runtime modules updateable", () => {
    expect(headerFor("/modules/(.*)\\.(js|mjs)")).toContain("no-cache");
    expect(headerFor("/modules/(.*)\\.(js|mjs)")).not.toContain("immutable");
    expect(headerFor("/js/pwa/(.*)\\.js")).toContain("no-cache");
    expect(headerFor("/js/pwa/(.*)\\.js")).not.toContain("immutable");
  });
});
