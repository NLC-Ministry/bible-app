import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const migration = read("supabase/migrations/0058_carry_reading_team_to_next_stage.sql");
const migrationSkip = read("supabase/migrations/0154_carryover_skip_conflicting_members.sql");
const plan = read("js/modules/plan.js");
const db = read("js/db.js");
const edge = read("supabase/functions/nlc-data/index.ts");
const teamUi = read("js/modules/team-registration.js");
const migrationByDate = read("supabase/migrations/20260928101011_carryover_next_plan_by_date.sql");
const migrationDivision = read("supabase/migrations/20260928120418_carryover_single_division.sql");
const migrationTaoyuan = read("supabase/migrations/20260928101019_taoyuan_first_round_final_exodus.sql");
const migrationTaoyuanLevNumDeut = read("supabase/migrations/20260928155627_taoyuan_first_round_final_lev_num_deut.sql");

// 取出某個 CREATE OR REPLACE FUNCTION 到下一個 REVOKE 之間的本體。
const sliceFunction = (sql, name) => {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION " + name + "(");
  expect(start, name + " not found").toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("REVOKE ALL ON FUNCTION " + name, start));
};

describe("reading team stage carryover", () => {
  it("offers carryover only to captains of the immediately previous stage", () => {
    expect(migration).toContain("source_stage_no := target_stage_no - 1");
    expect(migration).toContain("source_team.captain_id = actor_id");
    expect(migration).toContain("own_membership.member_role = 'captain'");
    expect(migration).toContain("target_stage_not_open");
    expect(migration).toContain("is_hidden = FALSE");
  });

  it("copies the complete roster and plan enrollment in one idempotent operation (original 0058 shape)", () => {
    expect(migration).toContain("carried_from_team_id");
    expect(migration).toContain("idx_reading_teams_one_carryover_per_stage");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toMatch(/INSERT INTO public\.reading_team_members[\s\S]*FROM public\.reading_team_members source_member/);
    expect(migration).toMatch(/INSERT INTO public\.reading_plans[\s\S]*ON CONFLICT \(user_id, global_plan_id\)/);
    // 0058's original all-or-nothing behavior — superseded by 0154 below.
    expect(migration).toContain("team_carryover_member_conflict");
  });

  it("exposes the offer and confirmation RPCs through both data paths", () => {
    for (const name of [
      "get_reading_team_carryover_offer",
      "carry_reading_teams_to_stage"
    ]) {
      expect(edge).toContain('"' + name + '"');
      expect(migration).toContain("FUNCTION public." + name);
    }
    expect(db).toContain("getReadingTeamCarryoverOffer(plan)");
    expect(db).toContain("carryReadingTeamsToStage(plan, division = null)");
  });

  // 0154: a member who quit the roster mid-season and independently joined a
  // different team in the next stage used to block the WHOLE carry-over for
  // every willing teammate (captain included) — a single RAISE EXCEPTION
  // rolled back the entire transaction. Real report: "隊長想保留隊伍進下一
  // 階段，但一位隊員退出了導致無法帶著其他隊員繼續進入". Fixed by skipping
  // just the conflicting member (or, if it's the captain themself, just that
  // one division's team) and reporting who was skipped instead of failing.
  it("skips a conflicting member instead of blocking the whole team (migration 0154)", () => {
    expect(migrationSkip).toContain("CREATE OR REPLACE FUNCTION public.carry_reading_teams_to_stage");
    expect(migrationSkip).not.toMatch(/RAISE EXCEPTION 'team_carryover_member_conflict'/);
    expect(migrationSkip).toContain("carried_from_team_id");
    expect(migrationSkip).toContain("pg_advisory_xact_lock");
    expect(migrationSkip).toMatch(/INSERT INTO public\.reading_team_members[\s\S]*FROM public\.reading_team_members source_member/);
    expect(migrationSkip).toMatch(/INSERT INTO public\.reading_plans[\s\S]*ON CONFLICT \(user_id, global_plan_id\)/);
    // Non-captain conflicts: excluded from the INSERT, reported per team.
    expect(migrationSkip).toContain("'skippedMembers'");
    expect(migrationSkip).toContain("GET DIAGNOSTICS carried_count = ROW_COUNT");
    // Captain conflicts: that one team is skipped, other divisions unaffected.
    expect(migrationSkip).toContain("captain_already_in_target");
    expect(migrationSkip).toContain("'skippedTeams'");
    expect(migrationSkip).toContain("CONTINUE;");
    // A captain with zero eligible source teams still gets the original error.
    expect(migrationSkip).toContain("team_carryover_captain_required");
    // Carries forward migration 0137's dynamic patch (cohort stages + region guard)
    // instead of silently reverting it with this CREATE OR REPLACE.
    expect(migrationSkip).toContain("public.is_campaign_stage_kind(plan_kind)");
    expect(migrationSkip).toContain("public.is_campaign_stage_kind(source_plan.plan_kind)");
    expect(migrationSkip).toContain("source_plan.audience_regions IS NOT DISTINCT FROM target_plan.audience_regions");
  });

  it("its reading_plans INSERT does not name the dropped `level` column (P0 regression)", () => {
    // migration 0138 dropped reading_plans.level; 0154's CREATE OR REPLACE must
    // not re-introduce it, or every carry_reading_teams_to_stage call raises
    // `column "level" of relation "reading_plans" does not exist`. (Fixed by
    // re-running the corrected 0154 — it is only CREATE OR REPLACE + GRANT, idempotent.)
    const insert = migrationSkip.slice(
      migrationSkip.indexOf("INSERT INTO public.reading_plans("),
      migrationSkip.indexOf("FROM public.reading_team_members carried_member"),
    );
    expect(insert).not.toMatch(/^\s*level,/m);
    expect(insert).not.toMatch(/^\s*'normal',/m);
  });

  // 舊流程：先是一次性自動彈窗（0058 時代），後來改成上一個計畫團隊卡片上的常駐按鈕。
  // #321 再改成「在下一個計畫裡帶隊」：加入團隊視窗最上面＋加入計畫時的提示，每隊一顆按鈕。
  it("offers carry-over inside the next plan, one button per team (#321)", () => {
    expect(plan).not.toContain("maybeOfferNextStageTeamCarryover");
    expect(plan).not.toContain("reading_team_carryover_deferred_");
    expect(plan).not.toContain("teamCarryoverCheckedSignature");
    // 上一個計畫團隊卡片上的舊按鈕已拿掉
    expect(teamUi).not.toContain("renderCaptainCarryoverAction");
    expect(teamUi).not.toContain("carryTeamToStage");
    expect(teamUi).not.toContain("findNextCampaignStagePlan");

    // 目標計畫就是使用者所在的這張，後端的 offer 以它為準
    expect(teamUi).toContain("db.getReadingTeamCarryoverOffer(plan)");
    expect(teamUi).toContain("db.carryReadingTeamsToStage(plan, sourceTeam.division)");
    // 加入團隊視窗最上面，只列這裡還沒加入的組別
    expect(teamUi).toContain("data-team-carryover");
    expect(teamUi).toContain("void renderCarryoverSection(availableDivisions)");
    expect(teamUi).toContain("availableDivisions.includes(Number(team.division))");
    expect(teamUi).toContain("帶上一個計畫的隊伍一起加入");
    // 加入計畫時的提示
    expect(teamUi).toContain("window.offerReadingTeamCarryoverOnJoin = async function");
    expect(teamUi).toContain("只有我自己加入");
    expect(plan).toContain("async function joinPlanFromExplore(plan, key)");
    expect(plan).toContain("window.offerReadingTeamCarryoverOnJoin(plan)");
    expect(plan).toContain("onJoin: () => joinPlanFromExplore(plan, key)");
    // 結果說明（誰被略過、為什麼）
    expect(teamUi).toContain("db.describeReadingTeamCarryoverSkips(");
    expect(db).toContain("plan_requires_pastoral_zone: names =>");
  });

  // #321: 第一輪期末賽拆成 9～12 月四張、全部 stageNo 2，stageNo + 1 找不到 9 月 → 10 月。
  it("finds the previous plan by start date within the same campaign and region (#321)", () => {
    const fn = sliceFunction(migrationByDate, "public.previous_campaign_stage_plan_id");
    expect(fn).toContain("source_plan.start_date < target_plan.start_date");
    expect(fn).toContain("source_plan.audience_regions IS NOT DISTINCT FROM target_plan.audience_regions");
    expect(fn).toContain("rules->>'parentCampaignId'");
    expect(fn).toContain("ORDER BY source_plan.start_date DESC");
    expect(fn).toContain("supersededBy");

    for (const name of ["get_reading_team_carryover_offer", "carry_reading_teams_to_stage"]) {
      const body = sliceFunction(migrationByDate, "public." + name);
      expect(body).toContain("public.previous_campaign_stage_plan_id(target_plan.id)");
      expect(body).not.toContain("target_stage_no - 1");
      expect(body).not.toContain("target_stage_no <= 1");
    }
  });

  it("skips members who can't join the target plan instead of failing the whole team (#321)", () => {
    const carry = sliceFunction(migrationByDate, "public.carry_reading_teams_to_stage");
    expect(migrationByDate).toContain("PERFORM public.assert_campaign_stage_open(p_target_global_plan_id, p_profile_id)");
    expect(carry).toContain("public.campaign_stage_join_block_reason(p_target_global_plan_id, source_member.user_id)");
    expect(carry).toContain("captain_block_reason := public.campaign_stage_join_block_reason(p_target_global_plan_id, actor_id)");
    expect(carry).toContain("'reason', blocked.reason");
    expect(carry).toContain("'targetPlanName', target_plan.name");
    // 0154 行為保留
    expect(carry).toContain("captain_already_in_target");
    expect(carry).toContain("pg_advisory_xact_lock");
    expect(carry).toContain("team_carryover_captain_required");
    expect(carry).not.toMatch(/^\s*level,/m);
  });

  it("locks down the new helper functions to service_role (#321)", () => {
    for (const sig of [
      "public.campaign_stage_join_block_reason(UUID, UUID)",
      "public.previous_campaign_stage_plan_id(UUID)"
    ]) {
      expect(migrationByDate).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migrationByDate).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
    for (const sig of [
      "public.get_reading_team_carryover_offer(UUID, UUID)",
      "public.carry_reading_teams_to_stage(UUID, UUID)"
    ]) {
      expect(migrationByDate).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("carries a single division when asked (#321)", () => {
    const fn = sliceFunction(migrationDivision, "public.carry_reading_teams_to_stage");
    expect(migrationDivision).toContain("DROP FUNCTION IF EXISTS public.carry_reading_teams_to_stage(UUID, UUID);");
    expect(fn).toContain("p_division INTEGER DEFAULT NULL");
    expect(fn).toContain("AND (p_division IS NULL OR team.division = p_division)");
    // 其餘行為跟 20260928101011 一樣
    expect(fn).toContain("public.previous_campaign_stage_plan_id(target_plan.id)");
    expect(fn).toContain("public.campaign_stage_join_block_reason(p_target_global_plan_id, source_member.user_id)");
    expect(fn).toContain("pg_advisory_xact_lock");
    expect(fn).not.toMatch(/^s*level,/m);
    expect(migrationDivision).toContain("REVOKE ALL ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;");
    expect(migrationDivision).toContain("GRANT EXECUTE ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER) TO authenticated, service_role;");
    expect(db).toContain("args.p_division = Number(division)");
  });

  it("creates the 桃園 first-round-final Exodus plan right after the 桃園 warm-up (#321)", () => {
    expect(migrationTaoyuan).toContain("'church_campaign_stage_cohort'");
    expect(migrationTaoyuan).toContain("ARRAY['桃園']::TEXT[]");
    expect(migrationTaoyuan).toContain("'2026-10-01'::DATE, '2026-10-31'::DATE, ARRAY['出埃及記']::TEXT[]");
    const rules = JSON.parse(migrationTaoyuan.match(/'(\{"parentCampaignId".*?\})'::JSONB/)[1]);
    expect(rules.parentCampaignId).toBe("00000000-0000-0000-c026-000000002029");
    expect(rules.stageNo).toBe(2);
    expect(rules.presetKey.startsWith("church_r1final_")).toBe(true);
    expect(rules.books).toEqual(["出埃及記"]);
    // 重跑不覆蓋管理員的開放／隱藏設定
    const onConflict = migrationTaoyuan.slice(migrationTaoyuan.indexOf("ON CONFLICT"));
    expect(onConflict).not.toContain("is_hidden");
  });

  it("creates the 桃園 first-round-final 利未記／民數記／申命記 plans, all hidden until admin opens them (#326)", () => {
    expect(migrationTaoyuanLevNumDeut).toContain("'church_campaign_stage_cohort'");
    expect(migrationTaoyuanLevNumDeut).toContain("ARRAY['桃園']::TEXT[]");
    expect(migrationTaoyuanLevNumDeut).toContain("'2026-11-01'::DATE, '2026-11-30'::DATE, ARRAY['利未記']::TEXT[]");
    expect(migrationTaoyuanLevNumDeut).toContain("'2026-12-01'::DATE, '2026-12-31'::DATE, ARRAY['民數記']::TEXT[]");
    expect(migrationTaoyuanLevNumDeut).toContain("'2027-01-01'::DATE, '2027-01-31'::DATE, ARRAY['申命記']::TEXT[]");
    expect(migrationTaoyuanLevNumDeut).toContain("'00000000-0000-0000-c326-000000202611'::UUID");
    expect(migrationTaoyuanLevNumDeut).toContain("'00000000-0000-0000-c326-000000202612'::UUID");
    expect(migrationTaoyuanLevNumDeut).toContain("'00000000-0000-0000-c326-000000202701'::UUID");

    const rulesBlobs = [...migrationTaoyuanLevNumDeut.matchAll(/'(\{"parentCampaignId".*?\})'::JSONB/g)]
      .map(match => JSON.parse(match[1]));
    expect(rulesBlobs).toHaveLength(3);
    expect(rulesBlobs.map(rules => rules.presetKey)).toEqual([
      "church_r1final_taoyuan_2026_11",
      "church_r1final_taoyuan_2026_12",
      "church_r1final_taoyuan_2027_01"
    ]);
    expect(rulesBlobs.map(rules => rules.books)).toEqual([["利未記"], ["民數記"], ["申命記"]]);
    rulesBlobs.forEach(rules => {
      expect(rules.parentCampaignId).toBe("00000000-0000-0000-c026-000000002029");
      expect(rules.stageNo).toBe(2);
      expect(rules.presetKey.startsWith("church_r1final_")).toBe(true);
    });

    // 三張都先隱藏，由管理員每月開放
    const valuesSection = migrationTaoyuanLevNumDeut.slice(
      migrationTaoyuanLevNumDeut.indexOf("VALUES"),
      migrationTaoyuanLevNumDeut.indexOf("ON CONFLICT")
    );
    expect(valuesSection.match(/TRUE, TRUE, 'church_campaign_stage_cohort'/g)).toHaveLength(3);

    // 重跑不覆蓋管理員的開放／隱藏設定
    const onConflict = migrationTaoyuanLevNumDeut.slice(migrationTaoyuanLevNumDeut.indexOf("ON CONFLICT"));
    expect(onConflict).not.toContain("is_hidden");
  });

  it("uses the account logout icon for captain member removal controls", () => {
    const removeButtons = [...teamUi.matchAll(/<button[^>]+data-team-remove-user[\s\S]*?<\/button>/g)]
      .map(match => match[0]);
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach(button => {
      expect(button).toContain('data-icon="logout"');
      expect(button).not.toContain('data-icon="trash"');
    });
  });
});
