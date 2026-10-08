import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const sql = currentMigrationSql("0170_exam_paper_linked_plan.sql");
const ui = read("js", "modules", "exam.js");
const db = read("js", "db.js");
const ef = read("supabase", "functions", "nlc-data", "index.ts");

// 使用者需求（2026-09-11）：
//   「這樣對應不精準要用id去對應，這個試卷就是單單對應那個計畫」
//   「在製造測驗卷的時候要可以設定是對應哪個計劃，可以不要對應單純獨立測驗卷」
//   「我希望要草稿狀態才能改，不然沒意義，但這次只能破例手動設定」
// → 用 id 直接綁定試卷↔計畫，取代書卷文字比對猜測；只能在測試版草稿設定，
//   推正式版時帶過去；不另開一支「任何狀態都能改」的 RPC。已發佈且已有人
//   作答的「聖經速讀測驗_創世紀」沒有草稿路徑可補，破例用檔尾註解的手動
//   SQL 一次性處理，不走程式碼路徑。

describe("0170: exam_papers.linked_plan_id 欄位", () => {
  it("新增欄位，FK 到 global_plans，可為 NULL（獨立測驗卷）", () => {
    expect(sql).toContain("ALTER TABLE public.exam_papers");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS linked_plan_id UUID REFERENCES public.global_plans(id) ON DELETE SET NULL");
  });
});

describe("0170: exam_upsert_paper — linked_plan_id 只能在開放作答前設定", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_upsert_paper"), sql.indexOf("-- ── 2."));

  it("用 JSONB `?` 判斷 payload 有沒有帶這個 key，沒帶就不動舊值", () => {
    expect(fn).toContain(`v_has_plan BOOLEAN := p_payload ? 'linked_plan_id'`);
    expect(fn).toContain(`v_plan_id  UUID := NULLIF(p_payload ->> 'linked_plan_id', '')::uuid`);
    expect(fn).toContain("linked_plan_id = CASE WHEN v_has_plan THEN v_plan_id ELSE linked_plan_id END");
  });

  // 0170 時是「只有測試版草稿能改」；#298 起改成用階段判斷：準備中、已排程（開放作答前）都能改，
  // 開放作答後一律不能改——仍然沒有另開「任何狀態都能改」的後門。
  it("開放作答後就不能再改（跟其他欄位同一道階段檢查，沒有另開後門）", () => {
    expect(fn).toContain("IF stage NOT IN ('preparing', 'scheduled') THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;");
  });

  it("新增時直接帶入 linked_plan_id（可為 NULL＝獨立測驗卷）", () => {
    expect(fn).toContain("duration_minutes, total_points, pledge, sections, section_targets, linked_plan_id, created_by");
  });

  it("plan_id 給了就要驗證那個計畫存在", () => {
    expect(fn).toContain("IF v_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.global_plans WHERE id = v_plan_id) THEN");
    expect(fn).toContain("RAISE EXCEPTION 'plan_not_found';");
  });
});

// 0170 時推正式版（exam_push_to_live）會把 linked_plan_id 帶過去；#258／#260 改成單一試卷，
// 這支函式已刪，linked_plan_id 就設在唯一那份試卷上。
describe("exam_push_to_live 已刪（#260）", () => {
  it("沒有推正式版這一步了", () => {
    expect(() => latestFunctionDefinition("exam_push_to_live")).toThrow(/dropped/);
  });
});

describe("0170 不新增任何 RPC：沒有 exam_set_linked_plan 這種例外後門", () => {
  it("SQL / nlc-data / db.js 都不該出現 exam_set_linked_plan", () => {
    expect(sql).not.toContain("exam_set_linked_plan");
    expect(ef).not.toContain("exam_set_linked_plan");
    expect(db).not.toContain("exam_set_linked_plan");
    expect(db).not.toContain("setExamLinkedPlan");
  });

  it("這次的例外走純手動 SQL（檔尾註解），不是程式碼路徑", () => {
    expect(sql).toContain("手動一次性例外");
    expect(sql).toContain("UPDATE public.exam_papers");
    expect(sql).toContain("WHERE title = '聖經速讀測驗_創世紀' AND mode = 'live';");
  });
});

describe("0170: exam_get_stats — v_plans 優先看 pr.linked_plan_id", () => {
  const fn = sql.slice(sql.indexOf("-- ── 3. exam_get_stats"));

  it("只跟著 pr.linked_plan_id 走：沒有書卷比對、沒有考生現況 fallback，也沒有多餘的 v_plans/v_plan_scoped 變數", () => {
    expect(fn).not.toContain("v_plans");
    expect(fn).not.toContain("v_plan_scoped");
    expect(fn).not.toContain("gp.plan_kind='church_campaign_stage'");
    expect(fn).not.toContain("reading_team_members rtm");
  });

  // 使用者：「如果沒有綁訂計畫就不用團隊排名了，那些有關團隊統計就直接隱藏，
  // 不要亂對應團隊跑出錯誤資訊」＋「如果計畫本身也沒有團隊資訊也不用團隊排名」
  it("latest_team 沒有『沒綁定就不鎖範圍』的退路了：不管有沒有綁定都硬性要求屬於 linked_plan_id，沒綁定或那個計畫沒隊就自然是空集合", () => {
    expect(fn).not.toContain("AND(pr.linked_plan_id IS NULL OR rt.global_plan_id=pr.linked_plan_id)");
    expect(fn).toMatch(/WHERE rt\.division IN\(3,6\)\s+AND pr\.linked_plan_id IS NOT NULL\s+AND rt\.global_plan_id=pr\.linked_plan_id/);
  });

  it("HAVING 簡化成 scope_all（lt 已經保證屬於 linked_plan_id，不用再查一次）", () => {
    expect(fn).toContain("HAVING scope_all OR COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded'))>0");
    expect(fn).not.toContain("HAVING(scope_all AND pr.linked_plan_id IS NOT NULL AND lt.global_plan_id=pr.linked_plan_id)");
  });

  it("byTeamSize 也只在有綁定計畫時才算，沒綁定直接回空陣列", () => {
    expect(fn).toContain("'byTeamSize',CASE WHEN pr.linked_plan_id IS NULL THEN '[]'::jsonb ELSE");
  });

  it("byTeamSize 的隊籍判定加 m.global_plan_id=pr.linked_plan_id，只認這個計畫底下的隊籍（不是隨便哪個計畫）", () => {
    expect(fn).toContain("EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division=3 AND m.global_plan_id=pr.linked_plan_id)");
    expect(fn).toContain("EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division=6 AND m.global_plan_id=pr.linked_plan_id)");
    expect(fn).toContain("NOT EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division IN(3,6) AND m.global_plan_id=pr.linked_plan_id)");
  });

  it("回傳的 paper 物件帶 linkedPlanId，前端才能顯示目前鎖定哪個計畫", () => {
    expect(fn).toContain("'linkedPlanId',pr.linked_plan_id");
  });
});

describe("exam.js — 沒有團隊資訊就整段隱藏，不拼湊誤導性資訊", () => {
  it("hasTeamStats：沒有綁定計畫，或綁定的計畫沒有實際隊伍資料（byTeamSize 只剩未組隊不算數），一律視為沒有團隊統計", () => {
    expect(ui).toContain("const hasTeamStats = Boolean(linkedPlanId) && (rank3.length > 0 || rank6.length > 0");
    expect(ui).toContain('d.byTeamSize.some((r) => r.label !== "未組隊")');
  });

  it("組隊規模／團隊排行／匯出按鈕整段包在 hasTeamStats 裡", () => {
    const idx = ui.indexOf("hasTeamStats ? `<details");
    expect(idx).toBeGreaterThan(-1);
    const block = ui.slice(idx, idx + 900);
    expect(block).toContain("組隊規模");
    expect(block).toContain('id="exam-teamrank-csv"');
    expect(block).toContain("3 人隊排行");
    expect(block).toContain("6 人隊排行");
  });

  it("沒有團隊統計時改顯示原因（未綁定 vs 綁定但沒隊）", () => {
    expect(ui).toContain("不顯示團隊統計（去「試卷設定」可以設定）");
    expect(ui).toContain("底下沒有登記任何 3／6 人隊，不顯示團隊統計");
  });
});

describe("exam.js — 試卷設定加「對應計畫」下拉，併進既有的草稿限定存檔", () => {
  it("選項來自 state.globalPlans 的正式階段/延後梯次計畫，含一個「獨立測驗卷」空選項", () => {
    expect(ui).toContain('gp.planKind === "church_campaign_stage" || gp.planKind === "church_campaign_stage_cohort"');
    expect(ui).toContain("（獨立測驗卷，不對應任何計畫）");
    expect(ui).toContain('id="exam-meta-linked-plan"');
  });

  it("目前選中的值來自 paper.linked_plan_id，沒有獨立的儲存按鈕（只有一個 #exam-meta-save）", () => {
    expect(ui).toContain("const linkedPlanId = p.linked_plan_id || \"\";");
    expect(ui).not.toContain('id="exam-meta-save-plan"');
    expect(ui).not.toContain("db.setExamLinkedPlan");
  });

  it("linked_plan_id 併進主存檔的 upsertExamPaper payload，跟其他欄位一樣受草稿限制", () => {
    const fn = ui.slice(ui.indexOf('host.querySelector("#exam-meta-save")'), ui.indexOf('host.querySelector("#exam-meta-save")') + 800);
    expect(fn).toContain('linked_plan_id: host.querySelector("#exam-meta-linked-plan").value || null');
  });

  it("統計頁顯示目前鎖定的對應計畫名稱", () => {
    expect(ui).toContain("const linkedPlanId = d.paper && d.paper.linkedPlanId;");
    expect(ui).toContain("團隊排行已鎖定對應計畫");
  });
});
