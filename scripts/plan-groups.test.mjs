// #639 第 2、3 步：計畫關係改讀分組表，取代用 rules.stageNo 推關係的地方。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PLAN_GROUPS,
  buildPlanGroups,
  findAwardGroupForPlan,
  isAwardedThroughGroup,
  presetKeyForPlanId
} from "../js/data/plan-groups.mjs";
import { cleanPlanAssociatedBadges } from "../js/modules/plan-progress-reset.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const CHURCH_LEV = "00000000-0000-0000-c126-000000202610";
const TAOYUAN_LEV = "00000000-0000-0000-c326-000000202611";

describe("分組表 → 分組清單", () => {
  it("成員掛到所屬的組；壞掉的列略過；讀不到回 null", () => {
    const groups = buildPlanGroups(
      [{ id: "g1", key: "k1", kind: "award", name: "鐵獎（甲）", rules: { awardName: "鐵獎" } }, { id: null, key: "x" }],
      [{ group_id: "g1", plan_id: "p1", slot: "出埃及記" }, { group_id: "nope", plan_id: "p2", slot: "利未記" }, { group_id: "g1", plan_id: "p3" }]
    );
    expect(groups).toEqual([{ key: "k1", kind: "award", name: "鐵獎（甲）", rules: { awardName: "鐵獎" }, members: [{ planId: "p1", slot: "出埃及記" }] }]);
    expect(buildPlanGroups(null, [])).toBeNull();
    expect(buildPlanGroups([], undefined)).toBeNull();
  });

  it("用計畫 id 或報名紀錄的 globalPlanId 找所屬分組；全教會和桃園各一組", () => {
    expect(findAwardGroupForPlan({ id: CHURCH_LEV }, null).key).toBe("r1final_church");
    expect(findAwardGroupForPlan({ id: "reading-plan-row", globalPlanId: TAOYUAN_LEV }, null).key).toBe("r1final_taoyuan");
    expect(findAwardGroupForPlan({ id: "00000000-0000-0000-c026-000000000001" }, null)).toBeNull();
    // 讀得到資料庫的分組時只看那份
    expect(findAwardGroupForPlan({ id: CHURCH_LEV }, [])).toBeNull();
  });

  it("presetKey：先看已載入的計畫，再看內建分組", () => {
    expect(presetKeyForPlanId(TAOYUAN_LEV, [])).toBe("church_r1final_taoyuan_2026_11");
    expect(presetKeyForPlanId("p9", [{ id: "p9", presetKey: "custom_key" }])).toBe("custom_key");
    expect(presetKeyForPlanId("unknown", [])).toBeNull();
  });

  it("鐵獎只能合成：分組裡的計畫、或獎名是鐵獎但還沒編組的梯次，都不由單張計畫發獎", () => {
    expect(isAwardedThroughGroup({ id: CHURCH_LEV }, null)).toBe(true);
    expect(isAwardedThroughGroup({ id: "new-cohort", awardName: "鐵獎", stageNo: 2 }, null)).toBe(true);
    expect(isAwardedThroughGroup({ id: "stage-1", awardName: "銅獎", stageNo: 1 }, null)).toBe(false);
    expect(DEFAULT_PLAN_GROUPS.every(group => group.members.length === 4)).toBe(true);
  });
});

describe("重設一張月度期末賽不會收回鐵獎（cleanPlanAssociatedBadges）", () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it("只清這一卷的遍數快取；鐵獎、其他卷、階段遍數都留著", () => {
    store.set("unlocked_badges", JSON.stringify(["church_stage_award_2", "church_stage_award_1"]));
    store.set("church_stage_completed_rounds_2", "1");
    store.set("church_r1final_rounds_church_r1final_2026_10", "2");
    store.set("church_r1final_rounds_church_r1final_2026_09", "1");
    cleanPlanAssociatedBadges({ id: "row-1", globalPlanId: CHURCH_LEV, presetKey: "church_r1final_2026_10", stageNo: 2, planKind: "church_campaign_stage" }, null);
    expect(JSON.parse(store.get("unlocked_badges"))).toEqual(["church_stage_award_2", "church_stage_award_1"]);
    expect(store.get("church_stage_completed_rounds_2")).toBe("1");
    expect(store.has("church_r1final_rounds_church_r1final_2026_10")).toBe(false);
    expect(store.get("church_r1final_rounds_church_r1final_2026_09")).toBe("1");
  });

  it("一般階段照舊清掉自己的階段獎", () => {
    store.set("unlocked_badges", JSON.stringify(["church_stage_award_1", "church_stage_award_2"]));
    cleanPlanAssociatedBadges({ id: "00000000-0000-0000-c026-000000000001", stageNo: 1, planKind: "church_campaign_stage" }, null);
    expect(JSON.parse(store.get("unlocked_badges"))).toEqual(["church_stage_award_2"]);
  });
});

describe("其他原本用階段號碼推關係的地方", () => {
  it("升下一遍時，分組裡的計畫不直接寫入階段獎（鐵獎只能合成）", () => {
    const source = read("../js/modules/plan.js");
    const block = source.slice(source.indexOf("// 記錄此類別完成的遍數"), source.indexOf("checkAchievements().catch"));
    expect(block).toContain("window.isCampaignStagePlan(plan) && !isAwardedThroughGroup(plan, state.planGroups)");
    expect(block).toContain("church_stage_award_${stageNo}");
  });

  it("發布總表後的驗證比對「有哪些階段」，同一階段 4 張月度計畫不會造成誤報", () => {
    const source = read("../js/db.js");
    const block = source.slice(source.indexOf("const materializedStageNumbers"), source.indexOf("const sameStageNumbers"));
    expect(block).toContain("Array.from(new Set(");
  });

  it("本機模式用 presetKey 套用覆蓋的階段定義（不再用 stageNo 找第一張）", () => {
    const source = read("../js/db.js");
    const block = source.slice(source.indexOf("const mergeWithPresets"), source.indexOf("const p = overrideStage"));
    expect(block).toContain("stage.presetKey === key");
    expect(block).not.toContain("getChurchCampaignStageDefinition(originalPreset.stageNo");
  });

  it("團隊辨識只從 church_stage_NN 讀階段號碼：月度期末賽的 r1 不會被當成第 1 階段", () => {
    const source = read("../js/modules/team-registration.js");
    expect(source).toContain("match(/^church_stage_(\\d{2})$/)");
    expect(source).not.toContain("plan.presetKey.match(/\\d+/)");
    const pattern = /^church_stage_(\d{2})$/;
    expect("church_r1final_2026_09".match(pattern)).toBeNull();
    expect("church_stage_03".match(pattern)[1]).toBe("03");
  });

  it("nlc-data 放行讀取分組表；開機時平行載入、讀不到退回內建分組", () => {
    const nlcData = read("../supabase/functions/nlc-data/index.ts");
    const readTables = nlcData.slice(nlcData.indexOf("const READ_TABLES"), nlcData.indexOf("const USER_TABLES"));
    expect(readTables).toContain('"plan_groups"');
    expect(readTables).toContain('"plan_group_members"');
    const db = read("../js/db.js");
    expect(db).toContain("this.loadPlanGroups()");
    expect(db).toContain('state.supabase.from("plan_groups").select("id, key, kind, name, rules")');
  });
});
