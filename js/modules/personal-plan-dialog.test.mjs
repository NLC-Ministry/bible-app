// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { openPersonalPlanDialog } from "./personal-plan-dialog.mjs";
import { taipeiTodayISO } from "../data/personal-plans.mjs";

const BOOKS = [
  { name: "創世記", section: "old" },
  { name: "出埃及記", section: "old" },
  { name: "馬太福音", section: "new" },
  { name: "馬可福音", section: "new" }
];

const $ = selector => document.querySelector(selector);
const setValue = (selector, value) => { $(selector).value = value; };
const submit = () => $("#personal-plan-dialog form").dispatchEvent(new Event("submit", { cancelable: true }));
const checkedBooks = () => [...document.querySelectorAll(".personal-plan-book:checked")].map(input => input.value);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("#473 新增個人計畫表單", () => {
  it("新約快選＋指定天數 → 回傳欄位並關閉", async () => {
    const pending = openPersonalPlanDialog({ bibleBooks: BOOKS });
    setValue("#personal-plan-name", "讀完福音書");
    $('[data-personal-plan-books="new"]').click();
    expect(checkedBooks()).toEqual(["馬太福音", "馬可福音"]);
    $('[data-personal-plan-time="flexible"]').click();
    expect($('[data-personal-plan-panel="flexible"]').hidden).toBe(false);
    expect($('[data-personal-plan-panel="fixed"]').hidden).toBe(true);
    setValue("#personal-plan-days", "14");
    submit();

    await expect(pending).resolves.toMatchObject({
      name: "讀完福音書",
      isFixed: false,
      startDate: taipeiTodayISO(),
      durationDays: "14",
      books: ["馬太福音", "馬可福音"]
    });
    expect($("#personal-plan-dialog")).toBeNull();
  });

  it("欄位不合法就留在表單上顯示原因", () => {
    void openPersonalPlanDialog({ bibleBooks: BOOKS });
    setValue("#personal-plan-name", "沒有書卷");
    setValue("#personal-plan-end", "2099-12-31");
    submit();
    expect($("#personal-plan-error").hidden).toBe(false);
    expect($("#personal-plan-error").textContent).toBe("請至少選一卷書。");
    expect($("#personal-plan-dialog")).not.toBeNull();
  });

  it("計畫名稱轉義後才放進表單，不會變成 HTML", () => {
    void openPersonalPlanDialog({ plan: { name: "<img src=x>", isFixed: true, startDate: "2099-01-01", endDate: "2099-02-01", target_books: [] }, bibleBooks: BOOKS });
    expect($("#personal-plan-dialog img")).toBeNull();
    expect($("#personal-plan-name").value).toBe("<img src=x>");
  });

  it("取消回傳 null", async () => {
    const pending = openPersonalPlanDialog({ bibleBooks: BOOKS });
    $("[data-personal-plan-cancel]").click();
    await expect(pending).resolves.toBeNull();
  });
});

describe("#473 編輯個人計畫表單", () => {
  const plan = {
    id: "p1",
    name: "舊名字",
    isPersonal: true,
    isFixed: true,
    startDate: "2099-01-01",
    endDate: "2099-03-31",
    target_books: ["創世記"]
  };

  it("帶入原本的名稱、日期與書卷", () => {
    void openPersonalPlanDialog({ plan, bibleBooks: BOOKS });
    expect($("#personal-plan-name").value).toBe("舊名字");
    expect($("#personal-plan-start").value).toBe("2099-01-01");
    expect($("#personal-plan-end").value).toBe("2099-03-31");
    expect(checkedBooks()).toEqual(["創世記"]);
  });

  it("開始打卡後書卷與日期鎖住，只回傳新名稱", async () => {
    const pending = openPersonalPlanDialog({ plan, scheduleLocked: true, bibleBooks: BOOKS });
    const fieldsets = [...document.querySelectorAll(".personal-plan-dialog__fieldset")];
    expect(fieldsets.length).toBe(2);
    expect(fieldsets.every(fieldset => fieldset.disabled)).toBe(true);
    setValue("#personal-plan-name", "新名字");
    submit();
    await expect(pending).resolves.toEqual({ name: "新名字" });
  });
});
