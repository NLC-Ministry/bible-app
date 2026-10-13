// #327 — 桃園版第一輪期末賽（church_r1final_taoyuan_*）算進四卷小徽章與鐵獎。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const utilsSource = readFileSync(new URL("../js/utils.js", import.meta.url), "utf8");

function extractRange(source, fromSig, toSig) {
  const start = source.indexOf(fromSig);
  const end = source.indexOf("\n}", source.indexOf(toSig)) + 2;
  if (start === -1 || end <= 1) throw new Error(`Could not slice ${fromSig}..${toSig}`);
  return source.slice(start, end);
}

const statusSrc = extractRange(utilsSource, "function getFirstRoundFinalMonthlyKeys", "function getFirstRoundFinalStatus");

const CHURCH = ["church_r1final_2026_09", "church_r1final_2026_10", "church_r1final_2026_11", "church_r1final_2026_12"];
const TAOYUAN = ["church_r1final_taoyuan_2026_10", "church_r1final_taoyuan_2026_11", "church_r1final_taoyuan_2026_12", "church_r1final_taoyuan_2027_01"];
const BOOK_BADGES = ["church_r1final_book_ex", "church_r1final_book_lev", "church_r1final_book_num", "church_r1final_book_deut"];

const plan = (presetKey, currentRound = 1, progress = 100) => ({
  presetKey, currentRound, progress, planKind: "church_campaign_stage", stageNo: 2
});
const cohortPlan = (presetKey, currentRound = 1, progress = 100) => ({
  ...plan(presetKey, currentRound, progress), planKind: "church_campaign_stage_cohort"
});
// 本地時間（合成日比較用 new Date("YYYY-MM-DDT00:00:00") 也是本地時間）
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe("桃園版第一輪期末賽算進鐵獎（#327）", () => {
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
    state = { activePlans: [], globalPlans: [] };
    // 每個測試重新載入 church_campaign.js（本體在 _shared/progress/church-campaign.mjs，#564），
    // CHURCH_CAMPAIGN 才是新的一份；它把函式掛到全域的 window。
    vi.resetModules();
    globalThis.window = {};
    globalThis.window.window = globalThis.window;
    await import("../js/data/church_campaign.js");
    window = globalThis.window;
    window.CHURCH_PLAN_PRESETS = Object.fromEntries(CHURCH.map(key => [key, {}]));
    // eslint-disable-next-line no-new-func
    api = new Function("state", "localStorage", "window",
      `${statusSrc}\nreturn { getFirstRoundFinalStatus, getFirstRoundFinalMonthlyKeys, findActivePlanByKey };`
    )(state, localStorage, window);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.window;
  });

  it("桃園設定：合成日 2027-02-02 放在 finalSynthesisDate 旁邊，全教會維持 2027-01-02", () => {
    expect(window.CHURCH_CAMPAIGN.finalSynthesisDate).toBe("2027-01-02");
    const [taoyuan] = window.CHURCH_CAMPAIGN.firstRoundFinalCohorts;
    expect(taoyuan.region).toBe("桃園");
    expect(taoyuan.finalSynthesisDate).toBe("2027-02-02");
    expect(taoyuan.presetKeys).toEqual(TAOYUAN);
    // 跟 10 月出埃及記（桃園）migration 的 presetKey 一致
    const exodusMigration = readFileSync(new URL("../supabase/migrations/20260928101019_taoyuan_first_round_final_exodus.sql", import.meta.url), "utf8");
    expect(exodusMigration).toContain(`"presetKey":"${TAOYUAN[0]}"`);
    expect(api.getFirstRoundFinalMonthlyKeys()).toEqual([...CHURCH, ...TAOYUAN]);
  });

  it("只讀桃園版的人：四卷小徽章都亮", () => {
    vi.setSystemTime(at(2027, 1, 31));
    state.activePlans.push(...TAOYUAN.map(key => cohortPlan(key)));
    const status = api.getFirstRoundFinalStatus();
    expect(status.months.map(m => m.badgeId)).toEqual(BOOK_BADGES);
    expect(status.months.map(m => m.completedRounds)).toEqual([1, 1, 1, 1]);
    expect(status.collected).toBe(4);
    expect(status.thresholdMet).toBe(true);
    expect(status.starSum).toBe(4);
  });

  it("只讀桃園版的人：2027-02-02 前不能合成，當天起可以", () => {
    state.activePlans.push(...TAOYUAN.map(key => cohortPlan(key)));

    vi.setSystemTime(at(2027, 1, 15));   // 全教會已可合成，桃園還不行
    let status = api.getFirstRoundFinalStatus();
    expect(status.synthesisDate).toBe("2027-02-02");
    expect(status.seasonEndLabel).toBe("1/31");
    expect(status.seasonEnded).toBe(false);
    expect(status.canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 2, 1, 23));
    expect(api.getFirstRoundFinalStatus().canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 2, 2, 0));
    status = api.getFirstRoundFinalStatus();
    expect(status.seasonEnded).toBe(true);
    expect(status.canSynthesize).toBe(true);
  });

  it("只有一卷只在桃園版讀完，就適用桃園合成日", () => {
    state.activePlans.push(plan(CHURCH[0]), plan(CHURCH[1]), plan(CHURCH[2]), cohortPlan(TAOYUAN[3]));
    vi.setSystemTime(at(2027, 1, 10));
    const status = api.getFirstRoundFinalStatus();
    expect(status.thresholdMet).toBe(true);
    expect(status.synthesisDate).toBe("2027-02-02");
    expect(status.canSynthesize).toBe(false);
  });

  it("只讀全教會版的人：行為不變（2027-01-02 起可合成、提示 12/31）", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)));

    vi.setSystemTime(at(2026, 12, 31));
    let status = api.getFirstRoundFinalStatus();
    expect(status.synthesisDate).toBe("2027-01-02");
    expect(status.seasonEndLabel).toBe("12/31");
    expect(status.thresholdMet).toBe(true);
    expect(status.canSynthesize).toBe(false);

    vi.setSystemTime(at(2027, 1, 2, 0));
    status = api.getFirstRoundFinalStatus();
    expect(status.canSynthesize).toBe(true);
    expect(status.starSum).toBe(4);
    expect(status.months.map(m => m.key)).toEqual(CHURCH);
  });

  it("全教會版四卷都讀完、另外也讀了桃園版：仍適用全教會合成日，同一卷不重複計算", () => {
    // 出埃及記：全教會 1 遍、桃園 2 遍 → 算 2（取多的，不是 3）
    // 利未記：兩版都 1 遍 → 算 1（不是 2）
    state.activePlans.push(
      plan(CHURCH[0], 1, 100), cohortPlan(TAOYUAN[0], 2, 100),
      plan(CHURCH[1], 1, 100), cohortPlan(TAOYUAN[1], 1, 100),
      plan(CHURCH[2], 1, 100),
      plan(CHURCH[3], 1, 100), cohortPlan(TAOYUAN[3], 1, 40)
    );
    vi.setSystemTime(at(2027, 1, 2, 9));
    const status = api.getFirstRoundFinalStatus();
    expect(status.months.map(m => m.completedRounds)).toEqual([2, 1, 1, 1]);
    expect(status.collected).toBe(4);
    expect(status.starSum).toBe(5);
    expect(status.synthesisDate).toBe("2027-01-02");
    expect(status.canSynthesize).toBe(true);
  });

  it("全教會＋桃園混讀、各卷只讀一版：四卷湊齊，collected 不會超過 4", () => {
    state.activePlans.push(
      plan(CHURCH[0]), cohortPlan(TAOYUAN[1]), plan(CHURCH[2]), cohortPlan(TAOYUAN[3])
    );
    vi.setSystemTime(at(2027, 2, 2, 8));
    const status = api.getFirstRoundFinalStatus();
    expect(status.collected).toBe(4);
    expect(status.total).toBe(4);
    expect(status.starSum).toBe(4);
    expect(status.synthesisDate).toBe("2027-02-02");
    expect(status.canSynthesize).toBe(true);
  });

  it("桃園計畫輪替出 activePlans 後，已拿到的小徽章不會熄掉（快取按 presetKey 分開存）", () => {
    state.activePlans.push(cohortPlan(TAOYUAN[0], 2, 100));
    api.getFirstRoundFinalStatus();
    expect(localStorage.getItem("church_r1final_rounds_" + TAOYUAN[0])).toBe("2");
    state.activePlans.length = 0;
    expect(api.getFirstRoundFinalStatus().months[0].completedRounds).toBe(2);
  });

  it("報名紀錄只剩 global_plan_id 時，透過 state.globalPlans 的 presetKey 對回桃園計畫", () => {
    state.globalPlans.push({ id: "00000000-0000-0000-c326-000000202610", presetKey: TAOYUAN[0] });
    state.activePlans.push({ ...cohortPlan("00000000-0000-0000-c326-000000202610"), globalPlanId: "00000000-0000-0000-c326-000000202610" });
    expect(api.getFirstRoundFinalStatus().months[0].completedRounds).toBe(1);
  });

  it("CHURCH_CAMPAIGN 被舊版規則換掉（沒有 firstRoundFinalCohorts）時仍認得桃園", () => {
    const { firstRoundFinalCohorts: _drop, ...legacy } = window.CHURCH_CAMPAIGN;
    window.CHURCH_CAMPAIGN = legacy;
    state.activePlans.push(...TAOYUAN.map(key => cohortPlan(key)));
    vi.setSystemTime(at(2027, 2, 2, 8));
    const status = api.getFirstRoundFinalStatus();
    expect(status.collected).toBe(4);
    expect(status.canSynthesize).toBe(true);
  });

  it("1/2 用全教會版合成後，1 月在桃園版多讀的遍數仍會讓鐵獎升級（取較高者）", () => {
    state.activePlans.push(...CHURCH.map(key => plan(key)));
    vi.setSystemTime(at(2027, 1, 2, 9));
    // 合成當下四卷各 1 遍 → S=4 → tier 1
    store.set("church_r1final_synthesized", "1");
    store.set("church_r1final_iron_tier", "1");
    expect(api.getFirstRoundFinalStatus().ironTier).toBe(1);

    // 1 月在桃園版申命記多讀了幾遍
    state.activePlans.push(cohortPlan(TAOYUAN[3], 4, 100));
    vi.setSystemTime(at(2027, 1, 31));
    const status = api.getFirstRoundFinalStatus();
    expect(status.months[3].completedRounds).toBeGreaterThan(1);
    expect(status.previewTier).toBeGreaterThan(1);
    expect(status.ironTier).toBe(status.previewTier);
    expect(store.get("church_r1final_iron_tier")).toBe(String(status.previewTier));   // 升級會寫回
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
