import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("js/app.js");
const css = read("index.css");

describe("header notification and plan options menu", () => {
  it("counts unique unread reminders and exposes the full count accessibly", () => {
    expect(app).toContain("const unreadReminderKeys = new Set()");
    expect(app).toContain('if (!reminder || reminder.status === "read") return');
    expect(app).toContain("const count = unreadReminderKeys.size");
    expect(app).toContain("通知，${count} 則未讀");
    expect(app).not.toContain('[data-care-reminder-badge]');
    expect(app).not.toContain("個人，${count} 則未讀關心提醒");
  });

  it("keeps the numeric bell badge visible outside the circular button", () => {
    expect(css).toContain("#btn-notification-bell,");
    expect(css).toContain(".notification-menu-container");
    expect(css).toContain("overflow: visible");
    expect(css).toMatch(/\.notification-bell-badge\s*\{[\s\S]*?min-width:\s*20px/);
    expect(css).toMatch(/\.notification-bell-badge\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  });

  it("uses theme-aware text and hover colors in the plan options menu", () => {
    expect(css).toMatch(/#plan-options-dropdown \.options-dropdown-item\s*\{[\s\S]*?color:\s*var\(--text-primary\)/);
    expect(css).toMatch(/#plan-options-dropdown \.options-dropdown-item:hover\s*\{[\s\S]*?var\(--surface-popover\)/);
    expect(css).toMatch(/#plan-options-dropdown \.options-dropdown-item \.menu-icon\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/);
  });
});