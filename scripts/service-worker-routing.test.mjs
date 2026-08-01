import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "sw.js"), "utf8");

describe("Service Worker data-route isolation", () => {
  it("bypasses every Supabase host and API family", () => {
    expect(source).toContain('hostname.endsWith(".supabase.co")');
    for (const path of ["/rest/v1/", "/auth/v1/", "/functions/v1/", "/storage/v1/", "/realtime/v1/"]) {
      expect(source).toContain(`"${path}"`);
    }
    expect(source).toContain('url.searchParams.has("auth_continuation")');
    expect(source).toContain('url.searchParams.has("auth_bridge_attempted")');
    expect(source).toContain('url.searchParams.has("openExternalBrowser")');
    expect(source).toContain('hasOauthCallbackSignal');
  });

  it("returns before respondWith for protected data requests", () => {
    const bypass = source.indexOf("if (shouldBypassCache(request)) return;");
    const firstRespondWith = source.indexOf("event.respondWith", bypass);
    expect(bypass).toBeGreaterThan(-1);
    expect(firstRespondWith).toBeGreaterThan(bypass);
  });
});
