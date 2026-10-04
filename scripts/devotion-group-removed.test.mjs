import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// #425：每日靈修（plan_kind='devotional'）與小組聚會週計畫（'group_meeting'）
// 拆成獨立專案 heryiyu/newlife-devotion-group，速讀這邊完整移除。
// 「分享今日金句」／牧區分享牆（devotional_notes 等）是速讀本身的功能，不在此列。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const SOURCES = [
  "js/app.js",
  "js/app-hash-routing.mjs",
  "js/db.js",
  "js/modules/plan.js",
  "js/modules/admin.js",
  "js/modules/home.js",
  "js/modules/profile.js",
  "index.html",
  "index.css",
  "supabase/functions/nlc-data/index.ts",
  "supabase/config.toml"
];

const REMOVED = [
  /plan-devotion/,
  /['"]devotional['"]/,
  /group_meeting/,
  /group-meeting/,
  /devotion_group/,
  /devotionGroup/,
  /DevotionViewer|GroupMeetingViewer/,
  /DevotionalPlan|GroupMeetingPlan/,
  /devotion-home|devotion-view|admin-devotion/,
  /sync-devotion-video|devotion_fetch_playlist_videos/,
  /plan-list-series-pills|pill-btn--series|activePlanSeries/,
  /feature-settings-row|renderFeatureSettingsSubpage/
];

describe("每日靈修／小組聚會已從速讀移除（#425）", () => {
  it("專屬檔案都刪掉了", () => {
    for (const path of [
      "js/modules/plan-devotion.js",
      "supabase/functions/sync-devotion-video/index.ts",
      "docs/group-meeting-plan-design.md"
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it.each(SOURCES)("%s 沒有殘留的靈修／小組程式", path => {
    const source = read(path);
    for (const pattern of REMOVED) {
      expect(source.match(pattern)?.[0] ?? null, `${path} ${pattern}`).toBeNull();
    }
  });

  it("金句分享（devotional_notes）保留", () => {
    expect(read("js/db.js")).toContain('from("devotional_notes")');
    expect(read("index.html")).toContain('id="devotional-content"');
    expect(read("supabase/functions/nlc-data/index.ts")).toContain('"devotional_notes"');
  });

  it("migration 先清 reading_plans 與計畫，再刪函式、資料表、旗標，最後收緊 plan_kind", () => {
    const sql = read("supabase/migrations/20261004015147_remove_devotion_group_meeting.sql");
    const order = [
      "DELETE FROM public.reading_plans",
      "DELETE FROM public.global_plans WHERE plan_kind IN ('devotional', 'group_meeting');",
      "cron.unschedule(existing_job)",
      "EXECUTE format('DROP FUNCTION %s', fn.signature);",
      "DROP TABLE IF EXISTS public.plan_devotion_days;",
      "DROP TABLE IF EXISTS public.profile_feature_preferences;",
      "DELETE FROM public.app_feature_settings",
      "ADD CONSTRAINT global_plans_plan_kind_check",
      "RAISE EXCEPTION 'devotion/group-meeting functions still present: %'"
    ].map(needle => sql.indexOf(needle));
    order.forEach(index => expect(index).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const check = sql.slice(sql.indexOf("ADD CONSTRAINT global_plans_plan_kind_check"));
    expect(check).not.toContain("'devotional'");
    expect(check).not.toContain("'group_meeting'");
  });
});
