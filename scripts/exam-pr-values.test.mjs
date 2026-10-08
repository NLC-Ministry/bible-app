import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentMigrationSql } from "./migration-sql.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sql = currentMigrationSql("0169_exam_pr_values.sql");
const ui = readFileSync(join(root, "js", "modules", "exam.js"), "utf8");

describe("0169: _exam_pr 百分等級函式", () => {
  it("mid-rank 公式、夾 1–99、母體 < 5 或值為 NULL 回 NULL", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public._exam_pr(p_value NUMERIC, p_pop NUMERIC[])");
    expect(sql).toContain("WHEN p_value IS NULL THEN NULL");
    expect(sql).toContain("WHEN COALESCE(array_length(p_pop, 1), 0) < 5 THEN NULL");
    expect(sql).toContain("GREATEST(1, LEAST(99, ROUND((");
    expect(sql).toContain("WHERE v < p_value");
    expect(sql).toContain("+ 0.5 * (SELECT COUNT(*) FROM unnest(p_pop) v WHERE v = p_value)");
    expect(sql).toContain("/ array_length(p_pop, 1) * 100");
  });
});

describe("0169: _exam_team_avg_pop 沿用 carry 鏈去重", () => {
  it("固定分母、carry 鏈收斂、只納入有人作答的隊", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\._exam_team_avg_pop\(p_paper_id UUID, p_division INTEGER\)/i);
    expect(sql).toContain("WITH RECURSIVE team_root(id, anchor) AS (");
    expect(sql).toContain("DISTINCT ON (tr.anchor, rt.division)");
    expect(sql).toContain("/ p_division, 1) avg_total");
    expect(sql).toContain("HAVING COUNT(a.id) FILTER (WHERE a.status IN ('submitted', 'graded')) > 0");
  });
});

describe("0169: exam_get_my_result — 會友端 PR", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_get_my_result"),
    sql.indexOf("-- ── 4."));

  it("PR 只有『正式卷 + 已批改 + 已公布』才計算，管理員預覽也不給", () => {
    expect(fn).toContain("show_pr:=(at.attempt_kind='official')AND(at.status='graded')AND published");
    expect(fn).toContain("'prChurch',CASE WHEN show_pr THEN public._exam_pr(at.total_score,church_scores) ELSE NULL END");
  });

  it("teams[] 帶隊長的大區/牧區、隊伍平均與 PR，不含任何隊友分數", () => {
    expect(fn).toContain("'greatRegion',td.captain_region,'pastoralZone',td.captain_zone");
    expect(fn).toContain("public._exam_pr(td.avg_total,public._exam_team_avg_pop(at.paper_id,td.division))");
    expect(fn).toContain("LEFT JOIN public.profiles cap ON cap.id=lt.captain_id");
    // 只回傳彙整（avg_total），不 jsonb_agg 每位隊友的分數
    expect(fn).not.toContain("mm.user_id,'score'");
    expect(fn).toContain("WHERE EXISTS(SELECT 1 FROM public.reading_team_members me");
  });
});

describe("0169: exam_get_stats — 後台 PR + 團隊大區/牧區", () => {
  const fn = sql.slice(sql.indexOf("-- ── 4."));

  it("PR 可見性：admin/pastor 隨時；範圍主管要成績公布後", () => {
    expect(fn).toContain("results_pub:=pr.results_published_at IS NOT NULL");
    expect(fn).toContain("pr_visible:=results_pub OR scope_all");
    expect(fn).toContain("IF pr_visible THEN");
    expect(fn).toContain("'prVisible',pr_visible");
  });

  // #302 起排除試作（NOT a.is_test）
  it("PR 母體一律全教會（不受 scoped 影響）", () => {
    expect(fn).toMatch(/church_scores:=ARRAY\(SELECT a\.total_score FROM public\.exam_attempts a\s*\n?\s*WHERE a\.paper_id=pr\.id AND a\.attempt_kind='official' AND NOT a\.is_test AND a\.status='graded'/);
    expect(fn).toContain("region_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)");
    expect(fn).toContain("team3_avgs:=public._exam_team_avg_pop(pr.id,3)");
    expect(fn).toContain("team6_avgs:=public._exam_team_avg_pop(pr.id,6)");
  });

  it("5 張表都加 PR，公布前（範圍主管）為 NULL", () => {
    expect(fn).toContain("'pr',CASE WHEN pr_visible THEN public._exam_pr(x.\"avgTotal\",region_avgs)ELSE NULL END");
    expect(fn).toContain("'pr',CASE WHEN pr_visible THEN public._exam_pr(x.\"avgTotal\",zone_avgs)ELSE NULL END");
    expect(fn).toContain("'pr',CASE WHEN pr_visible THEN public._exam_pr(x.\"avgTotal\",group_avgs)ELSE NULL END");
    expect(fn).toContain("'pr',CASE WHEN pr_visible AND t.submitted_cnt>0");
    expect(fn).toContain("'prChurch',CASE WHEN pr_visible AND a.status='graded'");
    expect(fn).toContain("'prZone',CASE WHEN pr_visible AND a.status='graded'");
    expect(fn).toContain("'prGroup',CASE WHEN pr_visible AND a.status='graded'");
  });

  it("teamRanking 每列帶隊長的大區/牧區", () => {
    expect(fn).toContain("rt.id team_id,rt.name,rt.division,rt.global_plan_id,rt.captain_id");
    expect(fn).toContain("cap.great_region captain_region,cap.pastoral_zone captain_zone");
    expect(fn).toContain("'greatRegion',t.captain_region,'pastoralZone',t.captain_zone");
    expect(fn).toContain("LEFT JOIN public.profiles cap ON cap.id=lt.captain_id");
  });
});

describe("exam.js — PR 顯示", () => {
  it("會友結果頁：PR 區塊只在 d.prPublished 時顯示，且說明不公布名次", () => {
    expect(ui).toContain("const showPr = d.prPublished === true && !isPractice");
    expect(ui).toContain("本測驗只公布分數與 PR，不公布名次");
    // PR 值現在是一張張大數字卡片（prTileHtml），不是擠在一句話裡的文字。
    expect(ui).toContain("const prTileHtml = (label, value, caption)");
    expect(ui).toContain('prTileHtml("全教會", d.prChurch,');
    expect(ui).toContain("`${t.division}人隊・${esc(t.name || \"\")}`");
    expect(ui).toContain("${prBlockHtml}");
  });

  it("後台統計：PR 欄只在 d.prVisible 時出現，並提示未公布", () => {
    expect(ui).toContain("const prVisible = d.prVisible === true");
    expect(ui).toContain("成績尚未公布，PR 值待公布後才顯示");
    expect(ui).toContain('...(prVisible ? [{ h: "PR", f: (r) => prCell(r.pr) }] : [])');
    expect(ui).toContain('{ h: "全教會PR", f: (r) => prCell(r.prChurch) }');
    expect(ui).toContain('{ h: "牧區PR", f: (r) => prCell(r.prZone) }');
    expect(ui).toContain('{ h: "小組PR", f: (r) => prCell(r.prGroup) }');
  });

  it("團隊排行表加大區/牧區欄", () => {
    expect(ui).toContain('{ h: "大區", f: (r) => esc(r.greatRegion || "—") }');
    expect(ui).toContain('{ h: "牧區", f: (r) => esc(r.pastoralZone || "—") }');
  });

  it("有『匯出團隊排行 CSV』：3+6 人隊合併、含大區/牧區、PR 隨 prVisible", () => {
    expect(ui).toContain('id="exam-teamrank-csv"');
    expect(ui).toContain("const rows = [...rank3, ...rank6].sort(");
    expect(ui).toContain('["隊型", "名次", "隊名", "大區", "牧區", "完成人數"]');
    expect(ui).toContain('.concat(["隊伍總分", "平均（總分÷編制）"])');
    expect(ui).toContain('.concat(prVisible ? ["團隊PR"] : [])');
    expect(ui).toContain("_團隊排行.csv`");
  });
});
