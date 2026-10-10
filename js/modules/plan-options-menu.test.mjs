// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { applyDeletePlanButtonKind } from "./plan-options-menu.mjs";

// 跟 index.html 的 #delete-plan-btn 同結構；renderIcon 用假的，能看出換成哪個 key。
const fakeRenderIcon = key => `<i data-key="${key}"></i>`;

function makeButton() {
  document.body.innerHTML = `
    <button class="options-dropdown-item" id="delete-plan-btn">
      <span class="menu-icon"><span class="nlc-icon" data-icon="logout" aria-hidden="true"><i data-key="logout"></i></span></span><span class="delete-plan-label">退出此計畫</span>
    </button>`;
  return document.getElementById("delete-plan-btn");
}

describe("#473 「...」選單的退出／刪除按鈕", () => {
  let btn;
  beforeEach(() => { btn = makeButton(); });

  it("個人計畫：文字改成「刪除此計畫」、圖示換垃圾桶，不把字塞進圖示裡", () => {
    applyDeletePlanButtonKind(btn, true, fakeRenderIcon);
    const icon = btn.querySelector(".nlc-icon");
    expect(btn.querySelector(".delete-plan-label").textContent).toBe("刪除此計畫");
    expect(icon.getAttribute("data-icon")).toBe("trash");
    expect(icon.querySelector("i").getAttribute("data-key")).toBe("trash");
    expect(icon.textContent).toBe("");
  });

  it("切回教會計畫：文字與圖示都恢復", () => {
    applyDeletePlanButtonKind(btn, true, fakeRenderIcon);
    applyDeletePlanButtonKind(btn, false, fakeRenderIcon);
    const icon = btn.querySelector(".nlc-icon");
    expect(btn.querySelector(".delete-plan-label").textContent).toBe("退出此計畫");
    expect(icon.getAttribute("data-icon")).toBe("logout");
    expect(icon.querySelector("i").getAttribute("data-key")).toBe("logout");
  });

  it("index.html 的按鈕有 delete-plan-label，選單程式不再用 span:last-child 找文字", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
    const plan = readFileSync(`${process.cwd()}/js/modules/plan.js`, "utf8");
    expect(html).toMatch(/id="delete-plan-btn"[\s\S]{0,200}class="delete-plan-label">退出此計畫</);
    expect(plan).not.toContain('deleteBtn.querySelector("span:last-child")');
  });
});
