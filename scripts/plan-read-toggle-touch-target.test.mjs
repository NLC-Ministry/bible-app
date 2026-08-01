import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const plan = readFileSync("js/modules/plan.js", "utf8");
const css = readFileSync("index.css", "utf8");
const html = readFileSync("index.html", "utf8");

describe("plan chapter read toggle touch target", () => {
  it("uses two separate semantic buttons for read state and opening the reader", () => {
    expect(plan).toContain('class="task-read-toggle"');
    expect(plan).toContain('class="task-open-button"');
    expect(plan).toContain('aria-pressed="${isCurrentRead ? \'true\' : \'false\'}"');
    expect(plan).not.toContain('onclick="event.stopPropagation(); window.toggleYouVersionChapter');
    expect(plan).not.toContain('taskItem.setAttribute("role", "button")');
  });

  it("keeps the read action from bubbling into the chapter-open action", () => {
    const start = plan.indexOf('readToggle.addEventListener("click"');
    const end = plan.indexOf('openButton.addEventListener("click", openChapter)', start);
    const handlers = plan.slice(start, end + 55);

    expect(start).toBeGreaterThan(-1);
    expect(handlers).toContain("event.stopPropagation()");
    expect(handlers).toContain("window.toggleYouVersionChapter(readToggle");
    expect(handlers).toContain('openButton.addEventListener("click", openChapter)');
  });

  it("provides a 48px touch target while keeping the visual checkbox compact", () => {
    const toggleBlock = css.match(/\.plan-task-item \.task-read-toggle \{[^}]+\}/s)?.[0] || "";
    const checkboxBlock = css.match(/\.plan-task-item \.task-checkbox \{[^}]+\}/s)?.[0] || "";

    expect(toggleBlock).toContain("width: 48px");
    expect(toggleBlock).toContain("height: 48px");
    expect(toggleBlock).toContain("touch-action: manipulation");
    expect(checkboxBlock).toContain("width: 24px");
    expect(checkboxBlock).toContain("height: 24px");
    expect(checkboxBlock).toContain("pointer-events: none");
  });

  it("bumps the stylesheet cache key", () => {
    expect(html).toContain("index.css?v=20260801_upgrade_gate_autoread_stats");
  });
});

