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

  it("keeps entry HTML uncacheable", () => {
    expect(headerFor("/")).toContain("no-store");
    expect(headerFor("/index.html")).toContain("no-store");
  });

  it("keeps app JS revalidatable so missing assets cannot be cached for a year", () => {
    const value = headerFor("/app.(.*).js");
    expect(value).toContain("no-cache");
    expect(value).toContain("must-revalidate");
    expect(value).not.toContain("immutable");
    expect(value).not.toContain("max-age=31536000");
  });

  it("keeps CSS revalidatable so missing stylesheets cannot be cached for a year", () => {
    const value = headerFor("/(.*)\\.css");
    expect(value).toContain("no-cache");
    expect(value).toContain("must-revalidate");
    expect(value).not.toContain("immutable");
    expect(value).not.toContain("max-age=31536000");
  });

  it("keeps the Service Worker updateable", () => {
    expect(cfg.headers.some((header) => header.source === "/config.js")).toBe(false);
    const value = headerFor("/sw.js");
    expect(value).toContain("no-store");
    expect(value).not.toContain("immutable");
  });

  it("keeps unhashed PWA runtime modules updateable", () => {
    expect(headerFor("/modules/(.*).js")).toContain("no-cache");
    expect(headerFor("/modules/(.*).js")).not.toContain("immutable");
    expect(headerFor("/js/pwa/(.*).js")).toContain("no-cache");
    expect(headerFor("/js/pwa/(.*).js")).not.toContain("immutable");
  });
});
