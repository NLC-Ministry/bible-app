// #639 — 鐵獎改讀分組表：全教會、桃園各是一組，四卷要在同一組裡湊齊（不能混組）。
// 徽章仍然只有一個鐵獎，任一組湊齊就能合成；畫面跟著最接近完成的那組。
// （#327 原本允許全教會版、桃園版混著湊，維護者 2026-10-28 改成分組。）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as planGroups from "../js/data/plan-groups.mjs";

const utilsSource = readFileSync(new URL("../js/utils.js", import.meta.url), "utf8");

function extractRange(source, fromSig, toSig) {
  const start = source.indexOf(fromSig);
  const end = source.indexOf("\n}", source.indexOf(toSig)) + 2;
  if (start === -1 || end <= 1) throw new Error(`Could not slice ${fromSig}..${toSig}`);
  return source.slice(start, end);
}

const statusSrc = extractRange(utilsSource, "function findActivePlanByKey", "function getFirstRoundFinalStatus");

const CHURCH = ["church_r1final_2026_09", "church_r1final_2026_10", "church_r1final_2026_11", "church_r1final_2026_12"];
const TAOYUAN = ["church_r1final_taoyuan_2026_10", "church_r1final_taoyuan_2026_11", "church_r1final_taoyuan_2026_12", "church_r1final_taoyuan_2027_01"];
const TAOYUAN_IDS = ["00000000-0000-0000-c326-000000202610", "00000000-0000-0000-c326-000000202611", "00000000-0000-0000-c326-000000202612", "00000000-0000-0000-c326-000000202701"];
const BOOK_BADGES = ["church_r1final_book_ex", "church_r1final_book_lev", "church_r1final_book_num", "church_r1final_book_deut"];

const plan = (presetKey, currentRound = 1, progress = 100) => ({
  presetKey, currentRound, progress, planKind: "church_campaign_stage", stageNo: 2
});
const cohortPlan = (presetKey, currentRound = 1, progress = 100) => ({
  ...plan(presetKey, currentRound, progress), planKind: "church_campaign_stage_cohort"
});
// 本地時間（合成日比較用 new Date("YYYY-MM-DDT00:00:00") 也是本地時間）
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe("鐵獎依分組計算（#639）", () => {
  let store;
  let localStorage;
  let state;
  let window;
  let api;

  beforeEach(async () => {
    store = new Map();
    localStorage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    };
    state = { activePlans: [], globalPlans: [], planGroups: null };
    // 每個測試重新載入 church_campaign.js（本體在 _shared/progress/church-campaign.mjs，#564），
    // CHURCH_CAMPAIGN 才是新的一份；它把函式掛到全域的 window。
    vi.resetModules();
    globalThis.window = {};
    globalThis.window.window = globalThis.window;
    await import("../js/data/church_campaign.js");
    window = globalThis.window;
    // eslint-disable-next-line no-new-func
    api = new Function("state", "localStorage", "window",
      "computeIronGroupStatus", "getIronAwardGroups", "pickGoverningIronGroup", "presetKeyForPlanId",
      `${statusSrc}\nreturn { getFirstRoundFinalStatus, findActivePlanByKey };`
    )(state, localStorage, window,
      planGroups.computeIronGroupStatus, planGroups.getIronAwardGroups,
      planGroups.pickGoverningIronGroup, planGroups.presetKeyForPlanId);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.window;
  });

  it("內建分組跟回填 migration 一致：兩組、各 4 張、日期記在 rules", () => {
    const backfill = readFileSync(new URL("../supabase/migrations/20261028034547_plan_groups_source_plan.sql", import.meta.url), "utf8");
    const dates = readFileSync(new URL("../supabase/migrations/20261028043243_iron_award_group_dates.sql", import.meta.url), "utf8");
    const groups = planGroups.getIronAwardGroups(null);
    expect(groups.map(group => group.key)).toEqual(["r1final_church", "r1final_taoyuan"]);
    groups.forEach(group => {
      group.members.forEach(member => {
        expect(backfill).toMatch(new RegExp(`'${group.key}',\\s*'${member.planId}'::UUID, '${member.slot}'`));
      });
      expect(dates).toContain(`"seasonEndDate":"${group.rules.seasonEndDate}","finalSynthesisDate":"${group.rules.finalSynthesisDate}"`);
    });
    expect(groups[1].members.map(member => member.presetKey)).toEqual(TAOYUAN);
    // 跟 10 月出埃及記（桃園）migration 的 presetKey 一致
    const exodusMigration = readFileSync(new URL("../supabase/migrations/20260928101019_taoyuan_first_round_final_exodus.sql", import.meta.url), "utf8");
    expect(exodusMigration).toContain(`"presetKey":"${TAOYUAN[0]}"`);
  });

  it("只讀全教會版的人：行為不變（2027-01-02 起可合成、提示 12/31）", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)));

    vi.setSystemTime(at(2026, 12, 31));
    let status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_church");
    expect(status.synthesisDate).toBe("2027-01-02");
    expect(status.seasonEndLabel).toBe("12/31");
    expect(status.thresholdMet).toBe(true);
    expect(status.canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 1, 2, 0));
    status = api.getFirstRoundFinalStatus();
    expect(status.canSynthesize).toBe(true);
    expect(status.starSum).toBe(4);
    expect(status.months.map(m => m.badgeId)).toEqual(BOOK_BADGES);
    expect(status.months.map(m => m.key)).toEqual(CHURCH);
  });

  it("只讀桃園版的人：四卷小徽章都亮，2027-02-02 前不能合成，當天起可以", () => {
    state.activePlans.push(...TAOYUAN.map(key => cohortPlan(key)));

    vi.setSystemTime(at(2027, 1, 15));   // 全教會已可合成，桃園還不行
    let status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_taoyuan");
    expect(status.months.map(m => m.completedRounds)).toEqual([1, 1, 1, 1]);
    expect(status.collected).toBe(4);
    expect(status.synthesisDate).toBe("2027-02-02");
    expect(status.seasonEndLabel).toBe("1/31");
    expect(status.canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 2, 1, 23));
    expect(api.getFirstRoundFinalStatus().canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 2, 2, 0));
    status = api.getFirstRoundFinalStatus();
    expect(status.seasonEnded).toBe(true);
    expect(status.canSynthesize).toBe(true);
  });

  it("全教會＋桃園混讀、各卷只讀一版：不能跨組湊，兩組各 2 卷，未達鐵獎", () => {
    state.activePlans.push(
      plan(CHURCH[0]), cohortPlan(TAOYUAN[1]), plan(CHURCH[2]), cohortPlan(TAOYUAN[3])
    );
    vi.setSystemTime(at(2027, 2, 2, 8));
    const status = api.getFirstRoundFinalStatus();
    expect(status.groups.map(group => [group.key, group.collected])).toEqual([["r1final_church", 2], ["r1final_taoyuan", 2]]);
    expect(status.collected).toBe(2);
    expect(status.thresholdMet).toBe(false);
    expect(status.canSynthesize).toBe(false);
  });

  it("全教會三卷＋桃園申命記：畫面跟著全教會那組（3/4），桃園那卷不算進來", () => {
    state.activePlans.push(plan(CHURCH[0]), plan(CHURCH[1]), plan(CHURCH[2]), cohortPlan(TAOYUAN[3]));
    vi.setSystemTime(at(2027, 1, 10));
    const status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_church");
    expect(status.months.map(m => m.completedRounds)).toEqual([1, 1, 1, 0]);
    expect(status.thresholdMet).toBe(false);
  });

  it("全教會四卷讀完、另外也讀了桃園版：桃園的遍數不加進全教會組，適用全教會合成日", () => {
    state.activePlans.push(
      plan(CHURCH[0], 1, 100), cohortPlan(TAOYUAN[0], 2, 100),
      plan(CHURCH[1], 1, 100), cohortPlan(TAOYUAN[1], 1, 100),
      plan(CHURCH[2], 1, 100),
      plan(CHURCH[3], 1, 100), cohortPlan(TAOYUAN[3], 1, 40)
    );
    vi.setSystemTime(at(2027, 1, 2, 9));
    const status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_church");
    expect(status.months.map(m => m.completedRounds)).toEqual([1, 1, 1, 1]);
    expect(status.starSum).toBe(4);
    expect(status.synthesisDate).toBe("2027-01-02");
    expect(status.canSynthesize).toBe(true);
  });

  it("兩組都湊齊：現在就能合成的那組優先（1/10 跟著全教會，不用等到 2/2）", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)), ...TAOYUAN.map(key => cohortPlan(key, 3, 100)));
    vi.setSystemTime(at(2027, 1, 10));
    const status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_church");
    expect(status.canSynthesize).toBe(true);
  });

  it("分組讀 state.planGroups：資料庫裡的組優先於內建分組", () => {
    const groups = planGroups.buildPlanGroups(
      [{ id: "g1", key: "r1final_custom", kind: "award", name: "鐵獎（測試）",
        rules: { awardName: "鐵獎", seasonEndDate: "2027-03-31", finalSynthesisDate: "2027-04-02" } }],
      ["出埃及記", "利未記", "民數記", "申命記"].map((slot, index) => ({ group_id: "g1", plan_id: `custom-${index}`, slot }))
    );
    state.planGroups = groups;
    state.activePlans.push(...[0, 1, 2, 3].map(index => ({ ...cohortPlan(`custom_key_${index}`), globalPlanId: `custom-${index}` })));
    state.activePlans.push(...CHURCH.map(key => plan(key)));   // 不在資料庫的分組裡 → 不算
    vi.setSystemTime(at(2027, 4, 2, 9));
    const status = api.getFirstRoundFinalStatus();
    expect(status.groups.map(group => group.key)).toEqual(["r1final_custom"]);
    expect(status.collected).toBe(4);
    expect(status.synthesisDate).toBe("2027-04-02");
    expect(status.canSynthesize).toBe(true);
  });

  it("桃園計畫輪替出 activePlans 後，已拿到的小徽章不會熄掉（快取按 presetKey 分開存）", () => {
    state.activePlans.push(cohortPlan(TAOYUAN[0], 2, 100));
    api.getFirstRoundFinalStatus();
    expect(localStorage.getItem("church_r1final_rounds_" + TAOYUAN[0])).toBe("2");
    state.activePlans.length = 0;
    expect(api.getFirstRoundFinalStatus().months[0].completedRounds).toBe(2);
  });

  it("報名紀錄只剩 global_plan_id 時，用分組成員的計畫 id 對回桃園計畫", () => {
    state.activePlans.push({ ...cohortPlan(TAOYUAN_IDS[0]), presetKey: undefined, globalPlanId: TAOYUAN_IDS[0] });
    const status = api.getFirstRoundFinalStatus();
    expect(status.groupKey).toBe("r1final_taoyuan");
    expect(status.months[0].completedRounds).toBe(1);
  });

  it("合成後在同一組多讀的遍數會讓鐵獎升級；另一組沒湊齊的遍數不算", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)));
    vi.setSystemTime(at(2027, 1, 2, 9));
    store.set("church_r1final_synthesized", "1");
    store.set("church_r1final_iron_tier", "1");
    expect(api.getFirstRoundFinalStatus().ironTier).toBe(1);

    // 桃園版申命記多讀了幾遍，但桃園那組沒湊齊 → 不升級
    state.activePlans.push(cohortPlan(TAOYUAN[3], 4, 100));
    expect(api.getFirstRoundFinalStatus().ironTier).toBe(1);

    // 全教會版申命記多讀 → 升級並寫回
    state.activePlans[3] = plan(CHURCH[3], 4, 100);
    const status = api.getFirstRoundFinalStatus();
    expect(status.previewTier).toBeGreaterThan(1);
    expect(status.ironTier).toBe(status.previewTier);
    expect(store.get("church_r1final_iron_tier")).toBe(String(status.previewTier));
  });

  it("合成後等級只升不降：目前算出的等級較低時，維持合成時的等級", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)));   // S=4 → tier 1
    store.set("church_r1final_synthesized", "1");
    store.set("church_r1final_iron_tier", "5");
    const status = api.getFirstRoundFinalStatus();
    expect(status.previewTier).toBe(1);
    expect(status.ironTier).toBe(5);
    expect(store.get("church_r1final_iron_tier")).toBe("5");
  });

  it("還沒合成時，鐵獎等級一律 0", () => {
    state.activePlans.push(...TAOYUAN.map(key => cohortPlan(key, 3, 100)));
    expect(api.getFirstRoundFinalStatus().ironTier).toBe(0);
  });
});
