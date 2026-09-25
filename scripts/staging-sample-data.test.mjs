import { describe, expect, it } from "vitest";
import {
  EXCLUDED_TABLES,
  PLACEHOLDER_PROFILE_ID,
  RESET_SQL,
  assertReadOnly,
  buildInsertSql,
  checkSample,
  chunkRows,
  exportSample,
  importSample,
  tableQueries
} from "./staging-sample-data.mjs";
import { PROD_REF, STAGING_REF } from "./lib/supabase-cli-query.mjs";

// #267：從正式環境只讀匯出去識別化樣本，匯入 staging。
const SALT = "0123456789abcdef0123456789abcdef";
const queries = tableQueries(SALT);

const cleanProfile = (n = 1) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: `測試會友 ${String(n).padStart(4, "0")}`,
  email: `user${String(n).padStart(4, "0")}@example.invalid`,
  phone: null, avatar_url: null, auth_user_id: null, nlc_member_id: null,
  great_region: "大區 A", small_group: "小組 A-1-1"
});
const cleanSample = () => ({
  tables: {
    profiles: [cleanProfile()],
    great_regions: [{ id: "g", name: "大區 A" }],
    pastoral_zones: [{ id: "z", name: "牧區 A-1" }],
    small_groups: [{ id: "s", name: "小組 A-1-1" }],
    verse_notes: [{ id: "v", content: "（測試筆記）" }],
    church_announcements: [{ id: "a", content: "歡迎參加" }]
  }
});

describe("export queries", () => {
  it("are read-only, so nothing is ever written to production", () => {
    for (const { table, sql } of queries) {
      expect(() => assertReadOnly(sql), table).not.toThrow();
      expect(sql.trimStart().startsWith("WITH"), table).toBe(true);
    }
  });

  it("assertReadOnly rejects write statements but ignores words inside string literals", () => {
    expect(() => assertReadOnly("SELECT 1; DELETE FROM public.profiles")).toThrow(/DELETE/);
    expect(() => assertReadOnly("WITH x AS (UPDATE public.profiles SET name = '' RETURNING 1) SELECT 1")).toThrow();
    expect(() => assertReadOnly("SELECT 'DELETE me' AS doc")).not.toThrow();
  });

  it("never touches excluded tables such as user_identities or audit logs", () => {
    for (const { sql } of queries) {
      for (const table of EXCLUDED_TABLES) expect(sql).not.toMatch(new RegExp(`public\\.${table}\\b`));
    }
    expect(queries.map(q => q.table)).not.toEqual(expect.arrayContaining(["user_identities"]));
  });

  it("replaces profile identifiers and contact details inside the query", () => {
    const profiles = queries.find(q => q.table === "profiles").sql;
    for (const expected of [
      "'測試會友 '", "@example.invalid", "'phone', NULL", "'avatar_url', NULL",
      "'auth_user_id', NULL", "'nlc_member_id', NULL", "member\\_context\\_%", PLACEHOLDER_PROFILE_ID
    ]) expect(profiles).toContain(expected);
    // 會員 UUID 用鹽值重新編號
    expect(profiles).toContain(`md5('${SALT}' || t.id::text)::uuid`);
  });

  it("masks free text in personal tables", () => {
    const sql = table => queries.find(q => q.table === table).sql;
    expect(sql("exam_attempts")).toContain("'pledge_name', '測試會友'");
    expect(sql("exam_answers")).toContain("jsonb_typeof(t.response) = 'string'");
    expect(sql("verse_notes")).toContain("'content', '（測試筆記）'");
    expect(sql("care_reminders")).toContain("'message', '（測試關心訊息）'");
    expect(sql("reading_teams")).toContain("'invite_code', upper(substr(md5(");
  });

  it("samples a quarter of members, stratified by great region", () => {
    expect(queries[0].sql).toContain("PARTITION BY coalesce(p.great_region_id::text, '-')");
    expect(queries[0].sql).toContain("rn <= ceil(cnt * 0.25)");
  });

  it("rejects a malformed salt so it can't inject SQL", () => {
    expect(() => tableQueries("x'; DROP TABLE profiles; --")).toThrow(/salt/);
  });

  it("reads only from production and does not write the salt to the export file", () => {
    const targets = new Set();
    const sample = exportSample((ref, sql) => { targets.add(ref); assertReadOnly(sql); return [{ doc: { id: "x" } }]; });
    expect([...targets]).toEqual([PROD_REF]);
    expect(JSON.stringify(sample)).not.toMatch(/"salt"/);
    expect(Object.keys(sample.tables)).toEqual(queries.map(q => q.table));
  });
});

describe("checkSample", () => {
  it("passes a properly anonymized sample", () => {
    expect(checkSample(cleanSample()).errors).toEqual([]);
  });

  it("catches a real email, phone, name, or leftover member-context field in profiles", () => {
    const sample = cleanSample();
    sample.tables.profiles.push({ ...cleanProfile(2), email: "someone@gmail.com", name: "王小明", phone: "0912-345-678", member_context_sync_error: "x" });
    const { errors } = checkSample(sample);
    expect(errors.join("\n")).toMatch(/email 不是假 email/);
    expect(errors.join("\n")).toMatch(/name 不是假姓名/);
    expect(errors.join("\n")).toMatch(/phone 應該是 null/);
    expect(errors.join("\n")).toMatch(/member_context_/);
  });

  it("catches PII hidden in free text of personal tables", () => {
    const sample = cleanSample();
    sample.tables.verse_notes.push({ id: "v2", content: "有事打給我 0912345678" });
    sample.tables.verse_notes.push({ id: "v3", content: { nested: ["寫信到 me@example.com"] } });
    sample.tables.verse_notes.push({ id: "v4", content: "token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4eHh4eHgifQ.sig" });
    const { errors } = checkSample(sample);
    expect(errors.filter(e => e.startsWith("verse_notes"))).toHaveLength(3);
  });

  it("does not mistake digit runs inside UUIDs for phone numbers", () => {
    const sample = cleanSample();
    sample.tables.verse_notes.push({ id: "5a1c2e3f-0912-4345-8678-0934567812ab", content: "（測試筆記）" });
    sample.tables.verse_notes.push({ id: "v5", content: "ref 5a1c-0912345678ab" });
    expect(checkSample(sample).errors).toEqual([]);
  });

  it("only warns (not fails) for contact info in church content tables", () => {
    const sample = cleanSample();
    sample.tables.church_announcements.push({ id: "a2", content: "聯絡辦公室 office@church.org" });
    const { errors, warnings } = checkSample(sample);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("fails on excluded tables, un-renamed org units, or a stored salt", () => {
    const sample = cleanSample();
    sample.tables.user_identities = [];
    sample.tables.small_groups.push({ id: "s2", name: "王大明小組" });
    sample.salt = SALT;
    const { errors } = checkSample(sample);
    expect(errors.join("\n")).toMatch(/user_identities/);
    expect(errors.join("\n")).toMatch(/small_groups\[1\]\.name/);
    expect(errors.join("\n")).toMatch(/salt/);
  });
});

describe("import", () => {
  it("only ever targets staging", () => {
    const targets = new Set();
    importSample(cleanSample(), ref => { targets.add(ref); return []; });
    expect([...targets]).toEqual([STAGING_REF]);
    expect(targets.has(PROD_REF)).toBe(false);
  });

  it("refuses to import a sample that fails the PII check", () => {
    const sample = cleanSample();
    sample.tables.profiles[0].email = "real@gmail.com";
    let called = false;
    expect(() => importSample(sample, () => { called = true; return []; })).toThrow(/個資檢查/);
    expect(called).toBe(false);
  });

  it("builds inserts that list only present columns and survive a hostile dollar tag", () => {
    const sql = buildInsertSql("verse_notes", [{ id: "v", content: "$sample_json$ nope" }]);
    expect(sql).toContain('INSERT INTO public.verse_notes ("id", "content")');
    expect(sql).toContain("$sample_json_x$");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(() => buildInsertSql("user_identities", [{ id: "x" }])).toThrow(/不在匯入清單/);
    expect(() => buildInsertSql("verse_notes", [{ 'id"; DROP': 1 }])).toThrow(/欄位名稱/);
  });

  it("splits rows by column set and size", () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3, b: 1 }];
    expect(chunkRows(rows)).toEqual([[{ a: 1 }, { a: 2 }], [{ a: 3, b: 1 }]]);
    expect(chunkRows([{ a: "x".repeat(10) }, { a: "y".repeat(10) }], 15)).toHaveLength(2);
  });

  it("resets only sample profiles, never real staging users", () => {
    expect(RESET_SQL).toMatch(/DELETE FROM public\.profiles WHERE email LIKE '%@example\.invalid'/);
    expect(RESET_SQL).not.toMatch(/TRUNCATE/i);
  });
});
