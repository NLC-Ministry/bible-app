import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sql = readFileSync(join(root, "supabase", "migrations", "0194_exam_my_result_zone_pr.sql"), "utf8");
const ui = readFileSync(join(root, "js", "modules", "exam.js"), "utf8");

describe("0194: exam_get_my_result — 加牧區 PR 與平均分數", () => {
  it("母體是「跟我同牧區、這份考卷正式卷已批改」的分數，本人沒設定牧區一律 NULL", () => {
    expect(sql).toContain("actor_zone:=NULLIF(BTRIM((SELECT p.pastoral_zone FROM public.profiles p WHERE p.id=actor_id)),'')");
    expect(sql).toContain("IF actor_zone IS NOT NULL THEN");
    expect(sql).toContain("NULLIF(BTRIM(p.pastoral_zone),'')=actor_zone");
    expect(sql).toContain("'myPastoralZone',CASE WHEN show_pr THEN actor_zone ELSE NULL END");
    expect(sql).toContain("'prZone',CASE WHEN show_pr THEN public._exam_pr(at.total_score,zone_scores) ELSE NULL END");
  });

  it("zoneAvg 沿用同一份 zone_scores，母體 0 筆時回 NULL", () => {
    expect(sql).toContain("'zoneAvg',CASE WHEN show_pr AND COALESCE(array_length(zone_scores,1),0)>0");
    expect(sql).toContain("THEN ROUND((SELECT AVG(x) FROM unnest(zone_scores) x)::numeric,1) ELSE NULL END");
  });

  it("prChurch／teams[] 的既有邏輯簽名不變", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.exam_get_my_result(");
    expect(sql).toContain("p_paper_id UUID,p_actor_id UUID DEFAULT NULL,p_attempt_id UUID DEFAULT NULL");
    expect(sql).toContain("'prChurch',CASE WHEN show_pr THEN public._exam_pr(at.total_score,church_scores) ELSE NULL END");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.exam_get_my_result(UUID,UUID,UUID) TO authenticated");
  });
});

describe("exam.js — 牧區 PR 卡片", () => {
  it("全教會、牧區、隊伍卡片剛好排在一起，牧區沒設定時顯示提示而不是隱藏卡片", () => {
    expect(ui).toContain('prTileHtml("全教會", d.prChurch,');
    expect(ui).toContain("prTileHtml(d.myPastoralZone ? `牧區・${esc(d.myPastoralZone)}` : \"牧區\", d.prZone, zoneCaption)");
    expect(ui).toContain('const zoneCaption = !d.myPastoralZone');
    expect(ui).toContain('"尚未設定牧區"');
  });
});
