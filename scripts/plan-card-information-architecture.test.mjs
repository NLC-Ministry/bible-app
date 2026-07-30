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

  it("keeps team controls visually subordinate to primary plan actions", () => {
    const planCardCss = css.slice(
      css.indexOf("/* Plan cards: one card, clear hierarchy, stable action area */"),
      css.indexOf("/* ==================== 🔔 Notification Bell & Dropdown CSS ====================")
    );

    expect(planCardCss).toContain(".plan-card-team-controls__badge");
    expect(planCardCss).toContain(".plan-card-team-controls__button");
    expect(planCardCss).toContain("min-height: 1.75rem");
    expect(planCardCss).toContain("font-size: 0.72rem");
    expect(planCardCss).toContain("max-width: 100%");
  });

  it("does not duplicate joined-plan team entry points", () => {
    const joinedList = plan.slice(
      plan.indexOf("function renderJoinedPlansList"),
      plan.indexOf("function formatCampaignReadingRange")
    );

    expect(joinedList).toContain("plan-card-team-controls");
    expect(joinedList).toContain("bindPlanParticipationItemActions(card, plan, participationModel)");
    expect(joinedList).not.toContain('action: "team"');
    expect(joinedList).not.toContain('[data-plan-card-action="team"]');
  });

  it("renders joined plans in chronological start-date order", () => {
    const sorter = plan.slice(
      plan.indexOf("function getJoinedPlanStartTime"),
      plan.indexOf("function renderJoinedPlansList")
    );
    const joinedList = plan.slice(
      plan.indexOf("function renderJoinedPlansList"),
      plan.indexOf("function formatCampaignReadingRange")
    );

    expect(sorter).toContain("function sortJoinedPlansChronologically");
    expect(sorter).toContain("leftStart - rightStart");
    expect(sorter).toContain("localeCompare");
    expect(joinedList).toContain("plansToRender = sortJoinedPlansChronologically(plansToRender)");
  });

  it("models joined-plan participation as one item contract", () => {
    expect(plan).toContain("function getPlanParticipationModel");
    expect(plan).toContain('variant: "team-with-other-division-available"');
    expect(plan).toContain('"team-full"');
    expect(plan).toContain('"team-open"');
    expect(plan).toContain('variant: "solo"');
    expect(plan).toContain('action: "join-team-division"');
  });

  it("renders participation status with shadcn item-style parts", () => {
    expect(plan).toContain("function renderPlanParticipationItem");
    expect(plan).toContain("plan-card-participation-item__media");
    expect(plan).toContain("plan-card-participation-item__content");
    expect(plan).toContain("plan-card-participation-item__title");
    expect(plan).toContain("plan-card-participation-item__description");
    expect(plan).toContain("plan-card-participation-item__actions");
    expect(plan).toContain('data-plan-participation-action="${escapeHTML(model.action.action)}"');
  });

  it("does not render joined-card participation as scattered badge fragments", () => {
    const joinedList = plan.slice(
      plan.indexOf("function renderJoinedPlansList"),
      plan.indexOf("function formatCampaignReadingRange")
    );

    expect(joinedList).toContain("renderPlanParticipationItem(participationModel)");
    expect(joinedList).toContain("bindPlanParticipationItemActions(card, plan, participationModel)");
    // The card element itself is legitimately built with document.createElement("div");
    // assert only that the scattered team fragments are gone.
    expect(joinedList).not.toContain("plan-card-team-controls__badge");
    expect(joinedList).not.toContain("plan-card-team-controls__button");
    expect(joinedList).not.toContain("plan-card-participation-state");
  });
});
