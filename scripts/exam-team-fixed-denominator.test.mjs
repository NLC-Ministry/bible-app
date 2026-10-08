import { describe,expect,it } from "vitest";
import fs from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";

// 0129 首次導入「固定分母」；0167 把 teamRanking 隊籍來源從
// exam_attempts.reading_team_id（作答時幾乎沒帶到 → 排行永遠 0 隊）改成即時查
// reading_team_members；0168 再用 carried_from_team_id 收斂 carry 鏈去重
// （同一支隊被 carry 到每個階段各一筆 → 重複列 + 隊數暴增）；0169 是含 PR 值的
// 最終版 exam_get_stats。斷言以最新的 0169 為準。
const sql=currentMigrationSql("0169_exam_pr_values.sql");
const ui=fs.readFileSync(new URL("../js/modules/exam.js",import.meta.url),"utf8");

describe("測驗團隊固定分母",()=>{
  it("使用隊伍 division 而不是已完成人數計算平均",()=>{
    expect(sql).toContain("::numeric/lt.division");
    expect(sql).toContain("PARTITION BY ranked.division ORDER BY ranked.avg_total DESC");
  });
  it("介面明確說明 3 人除 3、6 人除 6",()=>{
    expect(ui).toContain("3 人隊除以 3、6 人隊除以 6");
    expect(ui).toContain("平均（總分÷${size}）");
  });
});

describe("測驗團隊排行：隊籍即時查 reading_team_members",()=>{
  it("teamRanking 不再靠 exam_attempts.reading_team_id 快照",()=>{
    // 病因回歸測試：舊寫法 JOIN exam_attempts a ON a.reading_team_id = rt.id
    // 會因為 reading_team_id 幾乎都是 NULL 而接不到任何列。
    expect(sql).not.toContain("a.reading_team_id=rt.id");
    expect(sql).toContain("JOIN public.reading_team_members m ON m.team_id=lt.team_id");
    expect(sql).toContain("LEFT JOIN public.exam_attempts a");
    expect(sql).toContain("a.user_id=m.user_id AND a.paper_id=pr.id");
  });
  it("系統管理員/牧者列出參與梯次底下每支隊（含 0 人作答）；範圍主管只看有人作答的隊",()=>{
    expect(sql).toContain("scope_all:=(role_c IN('admin','pastor'))");
    // 0169 用「有人作答的梯次」(v_plans) 圈隊；0170 改成直接用試卷綁定的計畫（linked_plan_id）
    expect(sql).toContain("AND pr.linked_plan_id IS NOT NULL\n          AND rt.global_plan_id=pr.linked_plan_id");
    expect(sql).toContain("HAVING scope_all OR COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded'))>0");
  });
  it("未完成成員按 0 分：總分只加 graded 的，分母仍固定 division",()=>{
    expect(sql).toContain("COALESCE(SUM(a.total_score)FILTER(WHERE a.status='graded'),0)::numeric/lt.division");
  });
  it("用 carried_from_team_id 收斂 carry 鏈，每條鏈只取最新階段那一筆隊（去重）",()=>{
    // 病因回歸：carry_reading_teams_to_stage 每階段複製一筆 reading_teams，
    // 同一支隊在 DB 有 N 筆 → 0167 的 membership JOIN 讓它每階段各算一次。
    expect(sql).toContain("WITH RECURSIVE team_root(id,anchor)AS(");
    expect(sql).toContain("rt.carried_from_team_id IS NULL");
    expect(sql).toContain("JOIN team_root r ON rt.carried_from_team_id=r.id");
    expect(sql).toContain("SELECT DISTINCT ON(tr.anchor,rt.division)");
    expect(sql).toContain("ORDER BY tr.anchor,rt.division,rt.created_at DESC,rt.id DESC");
    expect(sql).toContain("FROM latest_team lt");
  });
});
