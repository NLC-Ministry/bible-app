import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "index.css"), "utf8");
const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");

describe("plan primary navigation", () => {
  it("places the four primary views in task-priority order above the content", () => {
    const progress = html.indexOf('data-plan-primary-view="progress"');
    const personal = html.indexOf('data-plan-primary-view="personal"');
    const stats = html.indexOf('data-plan-primary-view="stats"');
    const ranking = html.indexOf('data-plan-primary-view="ranking"');
    expect(progress).toBeGreaterThan(-1);
    expect(progress).toBeLessThan(personal);
    expect(personal).toBeLessThan(stats);
    expect(stats).toBeLessThan(ranking);
  });

  it("keeps personal statistics in the plan and removes the duplicate profile card", () => {
    expect(html).toContain('data-plan-primary-view="personal"');
    expect(html).toContain('id="stats-personal-section"');
    expect(html).not.toContain('id="profile-personal-stats-card"');
    expect(html).not.toContain('id="profile-personal-stats-container"');
  });

  it("removes the old bottom pill row from the visual and accessibility trees", () => {
    expect(html).toContain('class="status-pills-row plan-detail-tabs hidden" aria-hidden="true" style="display: none;"');
    expect(css).toContain('.plan-detail-tabs { display: none !important; }');
  });

  it("uses a sticky four-column, touch-accessible tab strip", () => {
    expect(css).toContain("position: sticky");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("min-height: 44px");
  });

  it("routes every primary tab through one controller and nests member status in group statistics", () => {
    expect(plan).toContain("async switchPrimaryView(view, options = {})");
    expect(plan).toContain("updatePlanPrimaryTabs(target)");
    expect(plan).toContain("stats.insertBefore(members, stats.firstChild)");
    expect(plan).not.toContain("data-plan-page-index");
  });
});