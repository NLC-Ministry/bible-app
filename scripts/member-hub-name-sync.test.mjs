import { describe, expect, it } from "vitest";
import fs from "node:fs";

const db = fs.readFileSync("js/db.js", "utf8");
const session = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");
const data = fs.readFileSync("supabase/functions/nlc-data/index.ts", "utf8");

function loadNormalizeMemberName() {
  const start = session.indexOf("function normalizeMemberName(");
  const end = session.indexOf("\n}\n", start) + 2;
  const source = session.slice(start, end).replace("value: unknown", "value");
  return new Function(`return (${source});`)();
}

describe("Member Hub canonical name sync", () => {
  it("does not write profile identity while saving reading progress", () => {
    const saveLogStart = db.indexOf("async saveReadingLog(");
    const syncMethodStart = db.indexOf("async syncProfileStatsToSupabase()", saveLogStart);
    expect(db.slice(saveLogStart, syncMethodStart)).not.toContain("this.syncProfileStatsToSupabase()");
  });

  it("blocks stale profile writes for a Hub-managed name", () => {
    expect(db).toContain('if (lockedFields.has("name"))');
    expect(db).toContain('reason: "member_hub_managed_name"');
    expect(data).toContain('canonical_source: "member_hub"');
    expect(data.indexOf("if (hubIdentity)"))
      .toBeLessThan(data.indexOf("const nextName = payload.name"));
  });

  it("fetches current UserInfo on every real session sync", () => {
    expect(session).toContain("let freshUserinfo: any = null");
    expect(session).toContain("freshUserinfo = fullUserinfo");
    expect(session).not.toContain("UserInfo from token missing sub");
  });

  it("rejects blank, oversized, control-character, and mojibake names", () => {
    const normalizeMemberName = loadNormalizeMemberName();
    expect(normalizeMemberName("   ")).toBeNull();
    expect(normalizeMemberName("A\u0000B")).toBeNull();
    expect(normalizeMemberName("王\uFFFD明")).toBeNull();
    expect(normalizeMemberName("Fran\u00C3\u00A7ois")).toBeNull();
    expect(normalizeMemberName("王".repeat(41))).toBeNull();
    expect(normalizeMemberName(" 王 小明 ")).toBe("王 小明");
    expect(normalizeMemberName("Ethan D")).toBe("Ethan D");
  });

  it("only resets review approval for a valid canonical name change", () => {
    expect(session).toContain("const canonicalNameChanged");
    expect(session).toContain("profilePayload.name_review_approved = false");
    expect(session.indexOf("const canonicalName ="))
      .toBeLessThan(session.indexOf("const canonicalNameChanged"));
  });
});
