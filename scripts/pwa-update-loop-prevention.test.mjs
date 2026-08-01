import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("js/pwa/ServiceWorkerRegistrar.js"), "utf8");

describe("PWA update loop prevention", () => {
  it("does not reload or force a second update when the worker takes control", () => {
    expect(source).not.toContain("window.location.reload()");
    expect(source).not.toContain("await this.registration.update()");
    expect(source).toContain('new CustomEvent("pwa:update-ready")');
  });
});