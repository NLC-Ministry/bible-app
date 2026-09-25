import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 0212 把 Edge Function 網址改成從 Vault `project_url` 讀取。寫死網址會讓
// staging 分支的排程／trigger 去呼叫正式環境（issue #252）。
const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const migration = readFileSync(
  new URL("../supabase/migrations/0212_edge_function_url_from_vault.sql", import.meta.url),
  "utf8"
);

// 0212 之前寫死網址的舊檔，已被 0212 取代，保留原樣。
const LEGACY_HARDCODED_URL_MIGRATIONS = new Set([
  "0077_issue_report_sheet_sync_trigger.sql",
  "0085_schedule_daily_church_quizzes.sql",
  "0086_manual_daily_quiz_regeneration.sql",
  "0088_daily_quiz_feature_flag.sql",
  "0090_quiz_publish_flow_redesign.sql",
  "0155_devotion_video_sync.sql",
  "0184_schedule_issue_report_maintenance.sql",
  "0189_daily_quiz_scheduled_publish.sql"
]);

const REDEFINED_FUNCTIONS = [
  ["notify_issue_report_sheet_sync", "issue-report-sheet-sync"],
  ["invoke_daily_church_quiz_generation", "generate-daily-quizzes"],
  ["request_daily_quiz_regeneration", "generate-daily-quizzes"],
  ["invoke_devotion_video_sync", "sync-devotion-video"],
  ["invoke_issue_report_maintenance", "issue-report-maintenance"],
  ["invoke_daily_quiz_schedule_sweep", "daily-quiz-schedule-sweep"]
];

function functionBlock(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined in 0212`).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION", start + 1);
  return migration.slice(start, next === -1 ? undefined : next);
}

describe("Edge Function URLs come from Vault, not hardcoded project refs", () => {
  it("no migration after 0212 hardcodes a *.supabase.co URL", () => {
    const offenders = readdirSync(migrationsDirectory)
      .filter(file => file.endsWith(".sql") && !LEGACY_HARDCODED_URL_MIGRATIONS.has(file))
      .filter(file => {
        const sql = readFileSync(join(migrationsDirectory, file), "utf8");
        // 只抓真正的 SQL 字串值；0212 的部署說明註解裡的網址不算。
        return sql
          .split(/\r?\n/)
          .filter(line => !line.trim().startsWith("--"))
          .some(line => /https:\/\/[a-z0-9]+\.supabase\.co/.test(line));
      });

    expect(offenders, `Hardcoded Supabase URL in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("builds the URL from Vault project_url and fails closed", () => {
    const helper = functionBlock("edge_function_url");
    expect(helper).toContain("SECURITY DEFINER");
    expect(helper).toContain("SET search_path = ''");
    expect(helper).toContain("vault.decrypted_secrets");
    expect(helper).toContain("name = 'project_url'");
    expect(helper).toContain("RETURN NULL");
    // 只接受 Supabase 專案網址，避免把 header 裡的 secret 送到任意主機
    expect(helper).toContain("^https://[a-z0-9]+\\.supabase\\.co$");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.edge_function_url(TEXT) FROM PUBLIC, anon, authenticated;"
    );
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.edge_function_url/);
  });

  it.each(REDEFINED_FUNCTIONS)("%s calls %s via edge_function_url and skips when unset", (name, edgeFunction) => {
    const block = functionBlock(name);
    expect(block).toContain(`public.edge_function_url('${edgeFunction}')`);
    expect(block).toContain("url := target_url");
    expect(block).toContain("IF target_url IS NULL THEN");
    expect(block).not.toMatch(/supabase\.co/);
  });

  it("revokes PUBLIC execute on every redefined function", () => {
    for (const [name] of REDEFINED_FUNCTIONS) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC`));
    }
  });

  it("keeps request_daily_quiz_regeneration grants unchanged", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) TO authenticated, service_role;"
    );
  });
});
