import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");
const css = readFileSync(join(root, "index.css"), "utf8");

describe("plan card information architecture", () => {
  it("uses shared semantic plan-card builders instead of scattered inline islands", () => {
    expect(plan).toContain("function renderPlanCardShell");
    expect(plan).toContain("function renderPlanCardHeader");
    expect(plan).toContain("function renderPlanCardStatusSummary");
    expect(plan).toContain("function renderPlanCardActions");
    expect(plan).toContain("plan-card__header");
    expect(plan).toContain("plan-card__status");
    expect(plan).toContain("plan-card__actions");
  });

  it("keeps card actions focused on the next task instead of making preview a peer action", () => {
    const presetList = plan.slice(
      plan.indexOf("function renderPresetPlansList"),
      plan.indexOf("function isChapterReadForRound")
    );

    expect(presetList).not.toContain("預覽詳情");
    expect(presetList).toContain("自己加入");
    expect(presetList).toContain("建立團隊");
    expect(presetList).toContain("event.stopPropagation()");
  });

  it("moves plan-card presentation from inline styles to stable CSS classes", () => {
    expect(css).toContain(".plan-card {");
    expect(css).toContain(".plan-card__main");
    expect(css).toContain(".plan-card__status");
    expect(css).toContain(".plan-card__actions");
    expect(css).toContain(".plan-card__primary-action");
    expect(css).toContain(".plan-card__secondary-action");

    const joinedList = plan.slice(
      plan.indexOf("function renderJoinedPlansList"),
      plan.indexOf("function formatCampaignReadingRange")
    );
    const presetList = plan.slice(
      plan.indexOf("function renderPresetPlansList"),
      plan.indexOf("function isChapterReadForRound")
    );
    expect(joinedList).not.toContain("card.style = `");
    expect(presetList).not.toContain("card.style = ");
  });

  it("follows compact item-style cards without pill actions or duplicate vertical stage media", () => {
    const planCardCss = css.slice(
      css.indexOf("/* Plan cards: one card, clear hierarchy, stable action area */"),
      css.indexOf("/* ==================== 🔔 Notification Bell & Dropdown CSS ====================")
    );
    const coverRenderer = plan.slice(
      plan.indexOf("function getPlanCoverHtml"),
      plan.indexOf("function renderPlanCardHeader")
    );

    expect(planCardCss).not.toMatch(/border-radius:\s*9999?px/);
    expect(planCardCss).not.toContain("border-radius: 20px");
    expect(coverRenderer).not.toContain("flex-direction: column");
    expect(coverRenderer).not.toContain("✦<br>第<br>");
    expect(coverRenderer).toContain("plan-cover-thumbnail--icon");
  });

  it("keeps plan card actions flat without glossy or lifted button states", () => {
    const planCardCss = css.slice(
      css.indexOf("/* Plan cards: one card, clear hierarchy, stable action area */"),
      css.indexOf("/* ==================== 🔔 Notification Bell & Dropdown CSS ====================")
    );

    expect(planCardCss).toContain(".plan-card .primary-btn::after");
    expect(planCardCss).toContain("content: none");
    expect(planCardCss).toContain("backdrop-filter: none");
    expect(planCardCss).toContain("box-shadow: none");
    expect(planCardCss).not.toContain("translateY(-1px)");
    expect(planCardCss).not.toContain("linear-gradient");
  });
});
