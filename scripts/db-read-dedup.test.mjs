import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = readFileSync(join(root, "js", "db.js"), "utf8");

describe("db._dedupRead (js/db.js) — source", () => {
  it("defines the in-flight read de-dup helper that clears on settle", () => {
    const fn = db.slice(db.indexOf("_inflightReads: {}"), db.indexOf("applyNlcProfile(profile, lockedFields"));
    expect(fn).toContain("const existing = this._inflightReads[key]");
    expect(fn).toContain("if (existing) return existing");
    expect(fn).toMatch(/\.finally\(\(\) => \{[\s\S]*delete this\._inflightReads\[key\]/);
  });

  it("wraps every notification-badge read that a cold load fires twice", () => {
    for (const [method, key] of [
      ["fetchQuizNotifications", "quizNotifications"],
      ["fetchExamNotifications", "examNotifications"],
      ["fetchIssueThreadUnread", "issueThreadUnread"],
      ["fetchCareReminders", "careReminders"],
    ]) {
      const idx = db.indexOf(`async ${method}(`);
      expect(idx, method).toBeGreaterThan(-1);
      const body = db.slice(idx, idx + 400);
      expect(body, method).toContain(`this._dedupRead("${key}"`);
    }
  });
});

describe("_dedupRead — behaviour", () => {
  // Reconstruct the helper and prove two overlapping calls share one factory run.
  function makeHost() {
    return {
      _inflightReads: {},
      _dedupRead(key, factory) {
        const existing = this._inflightReads[key];
        if (existing) return existing;
        const promise = Promise.resolve()
          .then(factory)
          .finally(() => {
            if (this._inflightReads[key] === promise) delete this._inflightReads[key];
          });
        this._inflightReads[key] = promise;
        return promise;
      },
    };
  }

  it("two overlapping calls run the factory once and get the same result", async () => {
    const host = makeHost();
    let runs = 0;
    const factory = async () => { runs += 1; await new Promise(r => setTimeout(r, 20)); return { n: runs }; };
    const [a, b] = await Promise.all([
      host._dedupRead("k", factory),
      host._dedupRead("k", factory),
    ]);
    expect(runs).toBe(1);
    expect(a).toBe(b);
    expect(a).toEqual({ n: 1 });
  });

  it("clears after settle so a later call re-fetches", async () => {
    const host = makeHost();
    let runs = 0;
    const factory = async () => { runs += 1; return runs; };
    expect(await host._dedupRead("k", factory)).toBe(1);
    expect(host._inflightReads.k).toBeUndefined();
    expect(await host._dedupRead("k", factory)).toBe(2);
  });

  it("different keys never share", async () => {
    const host = makeHost();
    let runs = 0;
    const factory = async () => ++runs;
    await Promise.all([host._dedupRead("a", factory), host._dedupRead("b", factory)]);
    expect(runs).toBe(2);
  });

  it("a rejecting factory still clears the slot (next call can retry)", async () => {
    const host = makeHost();
    let runs = 0;
    const factory = async () => { runs += 1; throw new Error("boom"); };
    await expect(host._dedupRead("k", factory)).rejects.toThrow("boom");
    expect(host._inflightReads.k).toBeUndefined();
    await expect(host._dedupRead("k", factory)).rejects.toThrow("boom");
    expect(runs).toBe(2);
  });
});

describe("getFeatureSetting — one .in() query for the whole allowlist (js/db.js)", () => {
  it("fetches every key at once and serves each from a short-lived cache", () => {
    const fn = db.slice(db.indexOf("async _featureSettingsMap()"), db.indexOf("async updateFeatureSetting("));
    expect(fn).toContain('.in("key", this.FEATURE_SETTING_KEYS)');
    expect(fn).toContain("_featureSettings = { map, at: Date.now() }");
    expect(fn).toContain("_featureSettingsInflight");           // in-flight dedup
    expect(fn).toMatch(/FRESH_MS = \d+/);                       // TTL
  });

  it("getFeatureSetting reads from the map, no per-key .eq() request", () => {
    const fn = db.slice(db.indexOf("async getFeatureSetting("), db.indexOf("async updateFeatureSetting("));
    expect(fn).toContain("const map = await this._featureSettingsMap()");
    expect(fn).toContain("key in map ? map[key] : Boolean(fallback)");
    expect(fn).not.toContain('.eq("key", key)');               // the old per-key query is gone
  });

  it("writes bust the cache so an admin toggle re-reads fresh", () => {
    expect(db).toContain("_invalidateFeatureSettings() { this._featureSettings = null; }");
    const upd = db.slice(db.indexOf("async updateFeatureSetting("), db.indexOf("_maskAdminSender(rows)"));
    expect((upd.match(/this\._invalidateFeatureSettings\(\)/g) || []).length).toBe(2); // supabase + localStorage path
  });
});
