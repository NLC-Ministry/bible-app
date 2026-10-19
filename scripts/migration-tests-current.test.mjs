import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { currentMigrationSql, functionStatements, latestFunctionDefinition, migrationFiles, readMigration } from "./migration-sql.mjs";

// #458：測試對 migration 原始檔做字串斷言時，斷言的函式如果之後被更新的 migration 改寫或刪掉，
// 舊檔的斷言永遠會過，正式資料庫實際跑的版本卻沒人驗。這裡擋住這種情況：
// 要驗函式就用 currentMigrationSql()／latestFunctionDefinition()（scripts/migration-sql.mjs）。
const root = fileURLToPath(new URL("../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", ".claude", "dist", "dist-admin"]);

// 刻意讀原始檔、而且提到的函式之後被改寫過的少數情況：檔名 → { migration: 理由 }。
const ALLOWED_RAW_READS = {
  // #589：檔名常數只拿來比對 latestFunctionDefinition().file，SQL 斷言都走 currentMigrationSql／latestFunctionDefinition
  "scripts/daily-quiz-generation-progress.test.mjs": {
    "20261008064652_daily_quiz_generation_progress.sql": "檔名常數只用來比對函式最新定義所在的檔案",
  },
  // 這裡列的是 0212 之前寫死網址的舊檔「檔名清單」，不是讀檔做斷言
  "scripts/edge-function-url-from-vault.test.mjs": {
    "0077_issue_report_sheet_sync_trigger.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0085_schedule_daily_church_quizzes.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0086_manual_daily_quiz_regeneration.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0088_daily_quiz_feature_flag.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0090_quiz_publish_flow_redesign.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0155_devotion_video_sync.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0184_schedule_issue_report_maintenance.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
    "0189_daily_quiz_scheduled_publish.sql": "LEGACY_HARDCODED_URL_MIGRATIONS 檔名清單",
  },
};

function testFiles(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : testFiles(join(dir, entry.name));
    return /\.test\.(m?js|ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

const MIGRATIONS = migrationFiles();

// 測試裡「直接」引用的 migration 檔：完整檔名，或用 endsWith("_xxx.sql") 找的檔尾。
// 包在 currentMigrationSql("…") 裡的不算，那已經是讀現在的版本。
function rawMigrationRefs(source) {
  const text = source.replace(/currentMigrationSql\(\s*"[^"]+"\s*\)/g, "");
  const refs = new Set();
  for (const match of text.matchAll(/["'`/]((?:\d{4}|\d{14})_[\w-]+\.sql)/g)) {
    if (MIGRATIONS.includes(match[1])) refs.add(match[1]);
  }
  for (const match of text.matchAll(/["'`](_[\w-]+\.sql)["'`]/g)) {
    const file = MIGRATIONS.find(name => name.endsWith(match[1]));
    if (file) refs.add(file);
  }
  return refs;
}

function latestFile(name) {
  try {
    return latestFunctionDefinition(name).file;
  } catch (error) {
    return /was dropped in (\S+)/.exec(error.message)?.[1] ?? null;
  }
}

describe("migration 字串斷言驗的是現在的函式（#458）", () => {
  it("沒有測試對「之後已被改寫或刪除」的函式讀舊 migration 原始檔", () => {
    const offenders = [];
    for (const file of testFiles()) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === "scripts/migration-tests-current.test.mjs") continue;
      const source = readFileSync(file, "utf8");
      for (const migration of rawMigrationRefs(source)) {
        if (ALLOWED_RAW_READS[rel]?.[migration]) continue;
        const names = new Set(functionStatements(readMigration(migration)).map(statement => statement.name));
        for (const name of names) {
          if (!new RegExp(`\\b${name}\\b`, "i").test(source)) continue;
          const latest = latestFile(name);
          if (latest && latest !== migration) offenders.push(`${rel}: ${migration} 的 ${name}（最新在 ${latest}）`);
        }
      }
    }
    expect(offenders, "改用 currentMigrationSql()／latestFunctionDefinition()，或在 ALLOWED_RAW_READS 寫明理由").toEqual([]);
  });

  it("白名單裡的每一筆都還用得到", () => {
    for (const [rel, entries] of Object.entries(ALLOWED_RAW_READS)) {
      const refs = rawMigrationRefs(readFileSync(join(root, rel), "utf8"));
      for (const migration of Object.keys(entries)) expect(refs.has(migration), `${rel} → ${migration}`).toBe(true);
    }
  });
});

describe("scripts/migration-sql.mjs", () => {
  it("取到的是最後一次定義，刪掉的函式會丟錯（含 DO 區塊裡的動態 DROP）", () => {
    // send_plan_join_invitation：0045 建立，20260929101811 改寫
    expect(latestFunctionDefinition("send_plan_join_invitation").file).toBe("20260929101811_send_plan_join_invitation_pastor_group_leader.sql");
    expect(() => latestFunctionDefinition("exam_push_to_live")).toThrow(/dropped in 20260927051721/);
    expect(() => latestFunctionDefinition("schedule_daily_quiz_publish")).toThrow(/dropped in 20260929043341/);
  });

  it("currentMigrationSql 換掉函式本體、保留其餘內容", () => {
    const current = currentMigrationSql("0045_plan_join_encouragement.sql");
    expect(current).toContain(latestFunctionDefinition("send_plan_join_invitation").text);
    expect(current).toContain("INSERT INTO public.care_reminders");
    expect(current).not.toContain("\r\n");
  });
});
