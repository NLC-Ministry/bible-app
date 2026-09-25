// Staging 的去識別化樣本資料（#267）。
//
//   node scripts/staging-sample-data.mjs export <輸出檔.json>
//       從正式環境只讀匯出。匯出的 SQL 在資料庫裡就把個資換掉，原始個資不離開
//       正式資料庫。每次執行隨機產生一個鹽值，用來抽樣和重新編號會員 UUID；
//       鹽值只在記憶體裡，不寫進檔案，所以 staging 的 id 無法對回正式環境。
//   node scripts/staging-sample-data.mjs check <檔案.json>
//       掃描匯出檔有沒有殘留個資。有問題 exit code 為 1。
//   node scripts/staging-sample-data.mjs import <檔案.json>
//       匯入 staging（目標寫死，不能指定別的專案）。先刪掉上一次匯入的樣本
//       會員（連帶刪除他們的資料），再匯入；可以重複執行。
//
// 匯出檔含會員的行為資料（雖然已去識別化），不要 commit，用完就刪。
// 見 docs/staging.md。

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROD_REF, STAGING_REF, runSql } from "./lib/supabase-cli-query.mjs";

export const SAMPLE_RATE = 0.25;
export const SAMPLE_EMAIL_SUFFIX = "@example.invalid";
export const PLACEHOLDER_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

/** 完全不匯出的表：太敏感，或對測試沒有幫助。 */
export const EXCLUDED_TABLES = [
  "user_identities",            // Logto 帳號對應（provider_user_id、email）
  "issue_reports",              // 網址、user agent、metadata
  "issue_report_messages",
  "reading_team_member_events", // 稽核記錄，含 jwt_claims
  "reading_teams_events",
  "exam_grading_drafts",
  "exam_paper_testers",         // 測試機制，之後要移除（#260）
  "devotion_video_sync_log",
  "devotional_notes", "devotional_comments", "devotional_likes",
  "small_home_teams", "small_home_team_members"
];

/** 含個人行為資料的表：check 對這些表的任何字串都零容忍。 */
export const PERSONAL_TABLES = [
  "profiles", "reading_plans", "reading_logs", "highlights", "verse_notes",
  "devotion_day_progress", "profile_feature_preferences", "exam_attempts", "exam_answers",
  "exam_grading_assignments", "exam_notifications", "quiz_attempts", "quiz_notifications",
  "lightning_quiz_attempts", "care_reminders", "reading_teams", "reading_team_members"
];

// ── 匯出 SQL ────────────────────────────────────────────────────────────────

export function assertSalt(salt) {
  if (!/^[0-9a-f]{32}$/.test(salt)) throw new Error("salt 必須是 32 個十六進位字元");
}

/**
 * 每個匯出查詢共用的 CTE：
 *   sampled   依大區分層、隨機抽 25% 的會員（seq 用來產生假姓名編號）
 *   gr/pz/sg  組織改名成代號（大區 A、牧區 A-1、小組 A-1-3），結構不變
 *   name_map  舊名稱 → 代號，給 profiles.managed_* 這類以名稱存的欄位用
 */
export function prelude(salt) {
  assertSalt(salt);
  return `WITH
strata AS (
  SELECT p.id,
         row_number() OVER (PARTITION BY coalesce(p.great_region_id::text, '-') ORDER BY md5('${salt}' || p.id::text)) AS rn,
         count(*) OVER (PARTITION BY coalesce(p.great_region_id::text, '-')) AS cnt
  FROM public.profiles p
),
sampled AS (
  SELECT id, row_number() OVER (ORDER BY md5('${salt}' || 'seq' || id::text)) AS seq
  FROM strata WHERE rn <= ceil(cnt * ${SAMPLE_RATE})
),
gr AS (
  SELECT id, name AS old_name,
         CASE WHEN n <= 26 THEN chr(64 + n::int) ELSE 'R' || n END AS code
  FROM (SELECT id, name, row_number() OVER (ORDER BY sort_order, name, id) AS n FROM public.great_regions) x
),
pz AS (
  SELECT z.id, z.name AS old_name,
         coalesce(gr.code, 'X') || '-' || row_number() OVER (PARTITION BY z.great_region_id ORDER BY z.sort_order, z.name, z.id) AS code
  FROM public.pastoral_zones z LEFT JOIN gr ON gr.id = z.great_region_id
),
sg AS (
  SELECT g.id, g.name AS old_name,
         coalesce(pz.code, 'X') || '-' || row_number() OVER (PARTITION BY g.pastoral_zone_id ORDER BY g.sort_order, g.name, g.id) AS code
  FROM public.small_groups g LEFT JOIN pz ON pz.id = g.pastoral_zone_id
),
org AS (
  SELECT id, old_name, '大區 ' || code AS new_name FROM gr
  UNION ALL SELECT id, old_name, '牧區 ' || code FROM pz
  UNION ALL SELECT id, old_name, '小組 ' || code FROM sg
),
name_map AS (
  SELECT DISTINCT ON (old_name) old_name, new_name FROM org ORDER BY old_name, new_name
)
`;
}

function builders(salt) {
  assertSalt(salt);
  const remap = col => `(CASE WHEN ${col} IN (SELECT id FROM sampled) THEN md5('${salt}' || ${col}::text)::uuid END)`;
  const remapOrPlaceholder = col => `coalesce(${remap(col)}, '${PLACEHOLDER_PROFILE_ID}'::uuid)`;
  const inSampled = col => `${col} IN (SELECT id FROM sampled)`;
  const orgName = col => `coalesce((SELECT new_name FROM org WHERE org.id = ${col}), '')`;
  const mapList = col => `(SELECT coalesce(string_agg(coalesce(nm.new_name, '（未知）'), ',' ORDER BY t.ord), '')
      FROM unnest(string_to_array(nullif(${col}, ''), ',')) WITH ORDINALITY t(v, ord)
      LEFT JOIN name_map nm ON nm.old_name = btrim(t.v))`;
  const mapArray = col => `(CASE WHEN ${col} IS NULL OR cardinality(${col}) = 0 THEN ${col} ELSE
      (SELECT array_agg(coalesce(nm.new_name, '（未知）') ORDER BY t.ord)
       FROM unnest(${col}) WITH ORDINALITY t(v, ord) LEFT JOIN name_map nm ON nm.old_name = t.v) END)`;
  const mask = (col, text) => `(CASE WHEN ${col} IS NULL THEN NULL ELSE '${text}' END)`;
  const sampledAttempts = `(SELECT id FROM public.exam_attempts WHERE ${inSampled("user_id")})`;
  const includedTeams = `(SELECT id FROM public.reading_teams WHERE ${inSampled("captain_id")})`;
  return { remap, remapOrPlaceholder, inSampled, orgName, mapList, mapArray, mask, sampledAttempts, includedTeams };
}

const override = pairs => `jsonb_build_object(${pairs.map(([k, v]) => `'${k}', ${v}`).join(", ")})`;
const row = (pairs = []) => (pairs.length ? `to_jsonb(t) || ${override(pairs)}` : "to_jsonb(t)");

/** 匯出／匯入的表，依匯入順序排列。每個 query 只回傳一欄 doc（jsonb）。 */
export function tableQueries(salt) {
  const b = builders(salt);
  const q = (table, pairs, where = "TRUE") => ({ table, sql: `SELECT ${row(pairs)} AS doc FROM public.${table} t WHERE ${where}` });
  return [
    // 設定與組織
    q("role_definitions"),
    q("great_regions", [["name", b.orgName("t.id")]]),
    q("pastoral_zones", [["name", b.orgName("t.id")]]),
    q("small_groups", [["name", b.orgName("t.id")]]),
    {
      table: "profiles",
      sql: `SELECT (to_jsonb(t) - (SELECT coalesce(array_agg(k), '{}') FROM jsonb_object_keys(to_jsonb(t)) k WHERE k LIKE 'member\\_context\\_%'))
        || ${override([
          ["id", b.remap("t.id")],
          ["name", `'測試會友 ' || lpad(s.seq::text, 4, '0')`],
          ["email", `'user' || lpad(s.seq::text, 4, '0') || '${SAMPLE_EMAIL_SUFFIX}'`],
          ["phone", "NULL"], ["avatar_url", "NULL"], ["auth_user_id", "NULL"], ["nlc_member_id", "NULL"],
          ["is_demo", "false"],
          ["great_region", b.orgName("t.great_region_id")],
          ["pastoral_zone", b.orgName("t.pastoral_zone_id")],
          ["small_group", b.orgName("t.small_group_id")],
          ["managed_regions", b.mapList("t.managed_regions")],
          ["managed_zones", b.mapList("t.managed_zones")],
          ["managed_groups", b.mapList("t.managed_groups")]
        ])} AS doc
        FROM public.profiles t JOIN sampled s ON s.id = t.id
        UNION ALL
        SELECT ${override([
          ["id", `'${PLACEHOLDER_PROFILE_ID}'`],
          ["name", "'測試佔位帳號（匯入用）'"],
          ["email", `'placeholder${SAMPLE_EMAIL_SUFFIX}'`],
          ["role_id", "(SELECT id FROM public.role_definitions WHERE code = 'member')"],
          ["is_active", "false"],
          ["is_demo", "false"]
        ])}`
    },
    // 教會內容：原樣，只把人員欄位換掉
    q("app_feature_settings", [["updated_by", b.remap("t.updated_by")]]),
    q("global_plans", [["created_by", b.remap("t.created_by")], ["audience_regions", b.mapArray("t.audience_regions")]]),
    q("plan_devotion_days", [["created_by", b.remap("t.created_by")], ["updated_by", b.remap("t.updated_by")]]),
    q("plan_group_meeting_weeks", [["created_by", b.remap("t.created_by")], ["updated_by", b.remap("t.updated_by")]]),
    q("plan_rule_versions", [["changed_by", b.remap("t.changed_by")]]),
    q("church_announcements", [["created_by", b.remap("t.created_by")], ["audience_scope_name", b.mapList("t.audience_scope_name")]]),
    q("exam_papers", [
      ["created_by", b.remap("t.created_by")], ["published_by", b.remap("t.published_by")],
      ["announced_by", b.remap("t.announced_by")], ["closed_by", b.remap("t.closed_by")]
    ]),
    q("exam_questions"),
    q("lightning_quiz_questions", [["created_by", b.remap("t.created_by")]]),
    q("daily_quizzes", [["reviewed_by", b.remap("t.reviewed_by")], ["updated_by", b.remap("t.updated_by")]]),
    q("quiz_publications", [["published_by", b.remapOrPlaceholder("t.published_by")]]),
    q("quiz_publication_schedules", [["created_by", b.remapOrPlaceholder("t.created_by")], ["scope_name", b.mapList("t.scope_name")]]),
    q("verse_likes"),
    // 抽樣到的會員的資料
    q("reading_plans", [["user_id", b.remap("t.user_id")]], b.inSampled("t.user_id")),
    q("reading_logs", [["user_id", b.remap("t.user_id")]], b.inSampled("t.user_id")),
    q("highlights", [["user_id", b.remap("t.user_id")]], b.inSampled("t.user_id")),
    q("verse_notes", [["user_id", b.remap("t.user_id")], ["content", "'（測試筆記）'"]], b.inSampled("t.user_id")),
    q("devotion_day_progress", [["user_id", b.remap("t.user_id")], ["note", b.mask("t.note", "（測試筆記）")]], b.inSampled("t.user_id")),
    q("profile_feature_preferences", [["profile_id", b.remap("t.profile_id")]], b.inSampled("t.profile_id")),
    q("exam_attempts", [
      ["user_id", b.remap("t.user_id")],
      ["pledge_name", "'測試會友'"],
      ["pledge_snapshot", "'{}'::jsonb"],
      ["grader_overall_comment", b.mask("t.grader_overall_comment", "（測試評語）")]
    ], b.inSampled("t.user_id")),
    q("exam_answers", [
      ["grader_id", b.remap("t.grader_id")],
      ["grader_comment", b.mask("t.grader_comment", "（測試評語）")],
      // 簡答題的作答是自由文字（字串）；選擇／配對／排序是數字、陣列、物件，保留
      ["response", "(CASE WHEN jsonb_typeof(t.response) = 'string' THEN to_jsonb('（測試作答）'::text) ELSE t.response END)"]
    ], `t.attempt_id IN ${b.sampledAttempts}`),
    q("exam_grading_assignments", [["grader_id", b.remap("t.grader_id")], ["assigned_by", b.remap("t.assigned_by")]],
      `t.attempt_id IN ${b.sampledAttempts} AND ${b.inSampled("t.grader_id")}`),
    q("exam_notifications", [["recipient_id", b.remap("t.recipient_id")], ["message", "'（測試通知）'"]],
      `t.attempt_id IN ${b.sampledAttempts} AND ${b.inSampled("t.recipient_id")}`),
    q("quiz_attempts", [["user_id", b.remap("t.user_id")]], b.inSampled("t.user_id")),
    q("quiz_notifications", [["recipient_id", b.remap("t.recipient_id")], ["message", "'（測試通知）'"]], b.inSampled("t.recipient_id")),
    q("lightning_quiz_attempts", [["user_id", b.remap("t.user_id")]], b.inSampled("t.user_id")),
    q("care_reminders", [
      ["sender_id", b.remap("t.sender_id")], ["recipient_id", b.remap("t.recipient_id")],
      ["message", "'（測試關心訊息）'"]
    ], `${b.inSampled("t.sender_id")} AND ${b.inSampled("t.recipient_id")}`),
    q("reading_teams", [
      ["captain_id", b.remap("t.captain_id")],
      ["name", `'測試隊伍 ' || upper(substr(md5('${salt}' || 'team' || t.id::text), 1, 6))`],
      ["invite_code", `upper(substr(md5('${salt}' || 'invite' || t.id::text), 1, 10))`],
      ["carried_from_team_id", `(CASE WHEN t.carried_from_team_id IN ${b.includedTeams} THEN t.carried_from_team_id END)`]
    ], b.inSampled("t.captain_id")),
    q("reading_team_members", [["user_id", b.remap("t.user_id")]],
      `t.team_id IN ${b.includedTeams} AND ${b.inSampled("t.user_id")}`)
  ].map(({ table, sql }) => ({ table, sql: `${prelude(salt)}${sql}` }));
}

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO|SET|VACUUM|REFRESH)\b/i;

/** 匯出查詢只能讀取：保險起見，送到正式環境之前再檢查一次。 */
export function assertReadOnly(sql) {
  // 忽略字串常值裡的字（例如 '（測試作答）'），只看 SQL 關鍵字
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  const match = withoutStrings.match(WRITE_KEYWORDS);
  if (match) throw new Error(`匯出查詢含有寫入關鍵字「${match[0]}」，拒絕送到正式環境`);
}

export function exportSample(runner = runSql) {
  const salt = randomBytes(16).toString("hex");
  const tables = {};
  for (const { table, sql } of tableQueries(salt)) {
    assertReadOnly(sql);
    tables[table] = runner(PROD_REF, `${sql};`).map(r => (typeof r.doc === "string" ? JSON.parse(r.doc) : r.doc));
    console.error(`  ${table}: ${tables[table].length}`);
  }
  return {
    format: "staging-sample-data/v1",
    exported_at: new Date().toISOString(),
    source_ref: PROD_REF,
    sample_rate: SAMPLE_RATE,
    tables
  };
}

// ── 個資檢查 ────────────────────────────────────────────────────────────────

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 前後不能緊鄰英數字：UUID 裡常有 "-0912-3456..." 這種片段
const TW_PHONE = /(?<![0-9A-Za-z])(?:\+?886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?![0-9A-Za-z])/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const URL_PATTERN = /https?:\/\//i;

function* strings(value, path) {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}.${k}`);
}

/** 回傳 { errors, warnings }。errors 非空就不該匯入。 */
export function checkSample(sample) {
  const errors = [];
  const warnings = [];
  const tables = sample?.tables || {};

  for (const table of EXCLUDED_TABLES) if (table in tables) errors.push(`不該匯出的表出現了：${table}`);
  if (sample?.salt !== undefined) errors.push("匯出檔不能包含 salt");

  for (const [i, p] of (tables.profiles || []).entries()) {
    const at = `profiles[${i}]`;
    if (!String(p.email || "").endsWith(SAMPLE_EMAIL_SUFFIX)) errors.push(`${at}.email 不是假 email`);
    if (!/^測試(會友 \d{4}|佔位帳號（匯入用）)$/.test(String(p.name || ""))) errors.push(`${at}.name 不是假姓名`);
    for (const key of ["phone", "avatar_url", "auth_user_id", "nlc_member_id"]) {
      if (p[key] != null) errors.push(`${at}.${key} 應該是 null`);
    }
    if (Object.keys(p).some(k => k.startsWith("member_context_"))) errors.push(`${at} 還有 member_context_* 欄位`);
  }
  for (const [table, prefix] of [["great_regions", "大區 "], ["pastoral_zones", "牧區 "], ["small_groups", "小組 "]]) {
    for (const [i, r] of (tables[table] || []).entries()) {
      if (!String(r.name || "").startsWith(prefix)) errors.push(`${table}[${i}].name 沒有換成代號`);
    }
  }

  for (const [table, rows] of Object.entries(tables)) {
    const personal = PERSONAL_TABLES.includes(table);
    for (const [i, r] of rows.entries()) {
      for (const [path, text] of strings(r, `${table}[${i}]`)) {
        if (UUID.test(text)) continue;
        const findings = [];
        const emails = (text.match(EMAIL) || []).filter(e => !e.toLowerCase().endsWith(SAMPLE_EMAIL_SUFFIX));
        if (emails.length) findings.push("email");
        if (TW_PHONE.test(text)) findings.push("電話");
        if (JWT.test(text)) findings.push("JWT");
        if (personal && URL_PATTERN.test(text)) findings.push("網址");
        if (!findings.length) continue;
        (personal ? errors : warnings).push(`${path}：疑似 ${findings.join("、")}`);
      }
    }
  }
  return { errors, warnings };
}

// ── 匯入 staging ────────────────────────────────────────────────────────────

const quoteIdent = name => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`不合法的欄位名稱：${name}`);
  return `"${name}"`;
};

function dollarQuote(text) {
  let tag = "sample_json";
  while (text.includes(`$${tag}$`)) tag += "_x";
  return `$${tag}$${text}$${tag}$`;
}

/** 產生一批 INSERT。欄位只列資料裡有的，沒列到的欄位用資料表的 default。 */
export function buildInsertSql(table, rows) {
  if (!tableQueries("0".repeat(32)).some(q => q.table === table)) throw new Error(`不在匯入清單裡的表：${table}`);
  const columns = Object.keys(rows[0]).map(quoteIdent).join(", ");
  return `INSERT INTO public.${table} (${columns})
SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.${table}, ${dollarQuote(JSON.stringify(rows))}::jsonb)
ON CONFLICT DO NOTHING;`;
}

/** 依欄位組合分組、切塊（佔位帳號那一列的欄位比較少）。 */
export function chunkRows(rows, maxBytes = 700_000) {
  const groups = new Map();
  for (const r of rows) {
    const key = Object.keys(r).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const chunks = [];
  for (const group of groups.values()) {
    let current = [];
    let size = 0;
    for (const r of group) {
      const bytes = Buffer.byteLength(JSON.stringify(r));
      if (current.length && size + bytes > maxBytes) { chunks.push(current); current = []; size = 0; }
      current.push(r);
      size += bytes;
    }
    if (current.length) chunks.push(current);
  }
  return chunks;
}

export const RESET_SQL = `-- 刪掉上一次匯入的樣本會員；他們的資料由 ON DELETE CASCADE 一起刪掉。
-- quiz_publications / quiz_publication_schedules 對 profiles 是 RESTRICT，要先刪。
DELETE FROM public.quiz_publication_schedules
  WHERE created_by IN (SELECT id FROM public.profiles WHERE email LIKE '%${SAMPLE_EMAIL_SUFFIX}');
DELETE FROM public.quiz_publications
  WHERE published_by IN (SELECT id FROM public.profiles WHERE email LIKE '%${SAMPLE_EMAIL_SUFFIX}');
DELETE FROM public.profiles WHERE email LIKE '%${SAMPLE_EMAIL_SUFFIX}';`;

/** 匯入後檢查：各表筆數，以及關聯是否斷掉（匯入時關閉了 FK 檢查）。 */
export const VERIFY_SQL = `
SELECT 'orphans: ' || k AS k, count(*)::text AS v FROM (
  SELECT 'profiles.role_id' AS k FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM public.role_definitions r WHERE r.id = p.role_id)
  UNION ALL SELECT 'profiles.small_group_id' FROM public.profiles p WHERE p.small_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.small_groups g WHERE g.id = p.small_group_id)
  UNION ALL SELECT 'reading_plans.user_id' FROM public.reading_plans x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.user_id)
  UNION ALL SELECT 'reading_logs.user_id' FROM public.reading_logs x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.user_id)
  UNION ALL SELECT 'reading_logs.plan_id' FROM public.reading_logs x WHERE x.plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.reading_plans r WHERE r.id = x.plan_id)
  UNION ALL SELECT 'exam_attempts.user_id' FROM public.exam_attempts x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.user_id)
  UNION ALL SELECT 'exam_attempts.official_attempt_id' FROM public.exam_attempts x WHERE x.official_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exam_attempts a WHERE a.id = x.official_attempt_id)
  UNION ALL SELECT 'exam_answers.attempt_id' FROM public.exam_answers x WHERE NOT EXISTS (SELECT 1 FROM public.exam_attempts a WHERE a.id = x.attempt_id)
  UNION ALL SELECT 'exam_answers.question_id' FROM public.exam_answers x WHERE NOT EXISTS (SELECT 1 FROM public.exam_questions q WHERE q.id = x.question_id)
  UNION ALL SELECT 'quiz_attempts.publication_id' FROM public.quiz_attempts x WHERE NOT EXISTS (SELECT 1 FROM public.quiz_publications q WHERE q.id = x.publication_id)
  UNION ALL SELECT 'quiz_publications.published_by' FROM public.quiz_publications x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.published_by)
  UNION ALL SELECT 'reading_team_members.team_id' FROM public.reading_team_members x WHERE NOT EXISTS (SELECT 1 FROM public.reading_teams t WHERE t.id = x.team_id)
  UNION ALL SELECT 'reading_teams.captain_id' FROM public.reading_teams x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.captain_id)
  UNION ALL SELECT 'care_reminders.recipient_id' FROM public.care_reminders x WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.recipient_id)
) o GROUP BY k
UNION ALL SELECT 'sample profiles', count(*)::text FROM public.profiles WHERE email LIKE '%${SAMPLE_EMAIL_SUFFIX}'
UNION ALL SELECT 'reading_logs', count(*)::text FROM public.reading_logs
UNION ALL SELECT 'exam_attempts', count(*)::text FROM public.exam_attempts
UNION ALL SELECT 'quiz_attempts', count(*)::text FROM public.quiz_attempts
ORDER BY 1;`;

export function importSample(sample, runner = runSql) {
  const { errors } = checkSample(sample);
  if (errors.length) throw new Error(`匯出檔沒通過個資檢查（${errors.length} 項），拒絕匯入。先跑 check。`);
  // 目標寫死為 staging，沒有任何參數可以改成正式環境
  const target = STAGING_REF;
  runner(target, RESET_SQL);
  for (const { table } of tableQueries("0".repeat(32))) {
    const rows = sample.tables[table] || [];
    for (const chunk of chunkRows(rows)) {
      // 關閉 trigger 與 FK 檢查：匯入的是既有資料，不該再觸發稽核或商業規則
      runner(target, `SET session_replication_role = replica;\n${buildInsertSql(table, chunk)}\nSET session_replication_role = DEFAULT;`);
    }
    console.error(`  ${table}: ${rows.length}`);
  }
  return runner(target, VERIFY_SQL);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main([command, file]) {
  if (command === "export" && file) {
    const sample = exportSample();
    const { errors, warnings } = checkSample(sample);
    writeFileSync(file, JSON.stringify(sample), { mode: 0o600 });
    console.log(`已匯出到 ${file}（不要 commit，用完就刪）`);
    console.log(`個資檢查：${errors.length} 個錯誤、${warnings.length} 個警告`);
    return errors.length ? 1 : 0;
  }
  if (command === "check" && file) {
    const { errors, warnings } = checkSample(JSON.parse(readFileSync(file, "utf8")));
    for (const e of errors) console.log(`❌ ${e}`);
    for (const w of warnings) console.log(`⚠️ ${w}`);
    console.log(`個資檢查：${errors.length} 個錯誤、${warnings.length} 個警告（警告只出現在教會內容表，請人工確認）`);
    return errors.length ? 1 : 0;
  }
  if (command === "import" && file) {
    const rows = importSample(JSON.parse(readFileSync(file, "utf8")));
    for (const r of rows) console.log(`${r.k}: ${r.v}`);
    return rows.some(r => r.k.startsWith("orphans: ") && r.v !== "0") ? 1 : 0;
  }
  console.error("用法：node scripts/staging-sample-data.mjs export|check|import <檔案.json>");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
