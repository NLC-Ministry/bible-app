import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";

// #449：雲柱測驗詳解欄位＋題目附圖
const read = path => readFileSync(path, "utf8");
// 函式換成目前的定義（get_my_lightning_quiz_history／admin_list 之後在 #616 又改寫過）
const migration = currentMigrationSql("20261005124326_lightning_quiz_image_explanation.sql");
const fnBlock = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("GRANT EXECUTE", start));
};

describe("migration 20261005124326", () => {
  it("adds explanation as a separate column, never inside the payload members get during the window", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT ''");
    expect(migration).not.toContain("get_todays_lightning_quiz(");
  });

  it("history (only ended, published questions) and the admin list return explanation", () => {
    const history = fnBlock("get_my_lightning_quiz_history");
    expect(history).toContain("'explanation', q.explanation");
    expect(history).toContain("q.status = 'published'");
    expect(history).toContain("_lightning_quiz_window_ended(q.rise_date, q.rise_time_end)");
    expect(fnBlock("admin_list_lightning_quiz_questions")).toContain("'explanation', q.explanation");
    expect(fnBlock("admin_list_lightning_quiz_questions")).toContain("_lightning_quiz_actor_is_admin(actor_id)");
  });

  it("upsert takes p_explanation (NULL keeps the old one) and still refuses locked questions", () => {
    const upsert = fnBlock("admin_upsert_lightning_quiz_question");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid);");
    expect(upsert).toContain("p_explanation TEXT DEFAULT NULL");
    expect(upsert).toContain("v_explanation := COALESCE(BTRIM(p_explanation), existing.explanation);");
    expect(upsert).toContain("AND existing.explanation = v_explanation THEN");
    expect(upsert.indexOf("RAISE EXCEPTION 'lightning_quiz_locked'")).toBeLessThan(upsert.indexOf("UPDATE public.lightning_quiz_questions SET"));
  });

  it("grants every recreated function explicitly, without anon", () => {
    for (const sig of [
      "get_my_lightning_quiz_history(date, date, uuid)",
      "admin_list_lightning_quiz_questions(date, date, uuid)",
      "admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, text, uuid)"
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
    }
  });
});

describe("front end", () => {
  const admin = read("js/modules/admin.js");
  const db = read("js/db.js");
  const profile = read("js/modules/profile.js");

  it("the admin editor keeps payload.image and sends the explanation", () => {
    expect(admin).toContain("question.payload.image = JSON.parse(imageJson)");
    expect(admin).toContain('data-field="explanation"');
    expect(admin).toContain("explanation: question.explanation");
    expect(db).toContain('p_explanation: typeof q.explanation === "string" ? q.explanation : null');
  });

  it("「我的測驗」 shows the explanation after the window", () => {
    expect(profile).toContain("item.explanation");
    expect(profile).toContain("解說：");
  });

  it("the 10/7 image ships as a static asset", () => {
    expect(readFileSync("assets/quiz/lightning-2026-10-07.webp").length).toBeGreaterThan(10000);
  });
});
