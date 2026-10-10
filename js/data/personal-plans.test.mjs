import { describe, expect, it } from "vitest";
import {
  PERSONAL_PLAN_LIMIT,
  buildPersonalPlanFields,
  buildPersonalPlanInsert,
  canCreatePersonalPlan,
  countActivePersonalPlans,
  isPersonalPlan,
  personalPlanErrorMessage,
  taipeiTodayISO,
  validatePersonalPlanName
} from "./personal-plans.mjs";

const TODAY = "2026-10-10";
const personal = (id, endDate) => ({ id, isPersonal: true, endDate });

describe("#473 個人計畫上限（每人 5 個進行中）", () => {
  it("第 6 個進行中的個人計畫被擋；已結束的不算", () => {
    const five = [1, 2, 3, 4, 5].map(n => personal(`p${n}`, "2026-12-31"));
    expect(countActivePersonalPlans(five, TODAY)).toBe(5);
    expect(canCreatePersonalPlan(five, TODAY)).toBe(false);

    const fourAndEnded = [...five.slice(0, 4), personal("old", "2026-10-09")];
    expect(countActivePersonalPlans(fourAndEnded, TODAY)).toBe(4);
    expect(canCreatePersonalPlan(fourAndEnded, TODAY)).toBe(true);
  });

  it("今天結束的仍算進行中（end_date ≥ 今天，跟觸發器同一條規則）", () => {
    expect(countActivePersonalPlans([personal("p", TODAY)], TODAY)).toBe(1);
  });

  it("教會計畫、舊版沒有 global_plan_id 的列都不算個人計畫", () => {
    const plans = [
      { id: "church", globalPlanId: "g", endDate: "2026-12-31" },
      { id: "legacy", globalPlanId: null, presetKey: null, endDate: "2026-12-31" },
      ...[1, 2, 3, 4].map(n => personal(`p${n}`, "2026-12-31"))
    ];
    expect(isPersonalPlan(plans[1])).toBe(false);
    expect(countActivePersonalPlans(plans, TODAY)).toBe(4);
    expect(canCreatePersonalPlan(plans, TODAY)).toBe(true);
    expect(PERSONAL_PLAN_LIMIT).toBe(5);
  });

  it("台北日期：UTC 16:30 已經是台北隔天", () => {
    expect(taipeiTodayISO(new Date("2026-10-09T16:30:00Z"))).toBe("2026-10-10");
  });
});

describe("#473 表單欄位", () => {
  const base = { name: "  暑假   讀完新約 ", books: ["馬太福音", "馬可福音", "馬太福音"] };

  it("固定日期：起訖日照填，名稱整理空白、書卷去重", () => {
    const result = buildPersonalPlanFields({ ...base, isFixed: true, startDate: "2026-10-01", endDate: "2026-12-31" }, TODAY);
    expect(result).toEqual({
      ok: true,
      fields: {
        name: "暑假 讀完新約",
        start_date: "2026-10-01",
        end_date: "2026-12-31",
        target_books: ["馬太福音", "馬可福音"],
        is_fixed: true
      }
    });
  });

  it("指定天數：從今天起算，第 N 天結束", () => {
    const result = buildPersonalPlanFields({ ...base, isFixed: false, durationDays: "30" }, TODAY);
    expect(result.ok).toBe(true);
    expect(result.fields).toMatchObject({ start_date: TODAY, end_date: "2026-11-08", is_fixed: false });
  });

  it("編輯指定天數的計畫保留原本的開始日", () => {
    const result = buildPersonalPlanFields({ ...base, isFixed: false, startDate: "2026-10-01", durationDays: 10 }, TODAY);
    expect(result.fields).toMatchObject({ start_date: "2026-10-01", end_date: "2026-10-10" });
  });

  it.each([
    [{ ...base, name: "   " }, "請輸入計畫名稱。"],
    [{ ...base, name: "長".repeat(41) }, "計畫名稱最多 40 個字。"],
    [{ ...base, books: [] }, "請至少選一卷書。"],
    [{ ...base, isFixed: true, startDate: "", endDate: "2026-12-31" }, "請選擇開始與結束日期。"],
    [{ ...base, isFixed: true, startDate: "2026-12-31", endDate: "2026-12-01" }, "開始日期不能晚於結束日期。"],
    [{ ...base, isFixed: true, startDate: "2026-09-01", endDate: "2026-10-09" }, "結束日期不能早於今天。"],
    [{ ...base, isFixed: false, durationDays: "0" }, "請輸入有效的計畫天數。"]
  ])("擋下不合法的輸入 %#", (input, message) => {
    expect(buildPersonalPlanFields(input, TODAY)).toEqual({ ok: false, message });
  });

  it("名稱驗證單獨可用（已開始打卡只能改名）", () => {
    expect(validatePersonalPlanName("新名字")).toBe("");
    expect(validatePersonalPlanName("")).toBe("請輸入計畫名稱。");
  });

  it("寫入列：is_personal、不掛教會計畫、從第一遍開始", () => {
    const { fields } = buildPersonalPlanFields({ ...base, isFixed: false, durationDays: 7 }, TODAY);
    expect(buildPersonalPlanInsert("user-1", fields)).toEqual({
      user_id: "user-1",
      ...fields,
      is_personal: true,
      global_plan_id: null,
      preset_key: null,
      current_round: 1,
      upgrade_prompt_handled: false,
      reading_days_per_week: 7,
      rest_weekdays: []
    });
  });
});

describe("#473 伺服器錯誤轉成提示", () => {
  it("上限與鎖定各有說明，其他錯誤用預設文字", () => {
    expect(personalPlanErrorMessage({ message: "personal_plan_limit_reached" })).toContain("最多 5 個進行中");
    expect(personalPlanErrorMessage({ message: "personal_plan_locked_after_first_log" })).toContain("名稱仍可修改");
    expect(personalPlanErrorMessage({ message: "boom" }, "失敗")).toBe("失敗");
  });
});
