import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #333：兩個環境的 lightning_quiz_settings_weekdays_check 只差括號（AND 有沒有被攤平），
// 用建表時的同一段原文重建，兩邊存下來的格式才會一樣。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const original = read("supabase/migrations/20260927123111_lightning_quiz_calendar_import.sql");
const rebuild = read("supabase/migrations/20260929041515_lightning_quiz_weekdays_check_rebuild.sql");
const CHECK = "CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[])";

describe("lightning_quiz_settings_weekdays_check rebuild", () => {
  it("reuses the exact check text from the migration that created the table", () => {
    expect(original).toContain(CHECK);
    expect(rebuild).toContain(`ADD CONSTRAINT lightning_quiz_settings_weekdays_check\n    ${CHECK};`);
  });

  it("drops and re-adds in one ALTER TABLE so the rule is never missing", () => {
    expect(rebuild).toContain([
      "ALTER TABLE public.lightning_quiz_settings",
      "  DROP CONSTRAINT IF EXISTS lightning_quiz_settings_weekdays_check,",
      "  ADD CONSTRAINT lightning_quiz_settings_weekdays_check"
    ].join("\n"));
  });
});
