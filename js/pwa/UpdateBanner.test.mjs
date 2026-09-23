/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdateBanner } from "./UpdateBanner.js";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const banner = () => document.getElementById("app-update-banner");
const button = action => banner()?.querySelector(`[data-action="${action}"]`);

afterEach(() => banner()?.remove());

describe("UpdateBanner", () => {
  it("shows once, however many times the watcher reports the same update", () => {
    const ui = createUpdateBanner({ onUpdate: vi.fn() });
    ui.show("20260923020202");
    ui.show("20260923020202");
    expect(document.querySelectorAll("#app-update-banner")).toHaveLength(1);
    expect(banner().getAttribute("role")).toBe("status");
  });

  it("runs the update on tap and stays busy while navigating away", async () => {
    const onUpdate = vi.fn(async () => "reload");
    createUpdateBanner({ onUpdate }).show("20260923020202");
    button("update").click();
    await flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(button("update").disabled).toBe(true);
  });

  it("gives the button back when the update could not start (offline)", async () => {
    createUpdateBanner({ onUpdate: async () => "unknown" }).show("20260923020202");
    button("update").click();
    await flush();
    expect(button("update").disabled).toBe(false);
    expect(button("update").textContent).toContain("再試一次");
  });

  it("stays dismissed for that build but returns for a newer one", () => {
    const ui = createUpdateBanner({ onUpdate: vi.fn() });
    ui.show("20260923020202");
    button("dismiss").click();
    expect(banner()).toBeNull();
    ui.show("20260923020202");
    expect(banner()).toBeNull();
    ui.show("20260923030303");
    expect(banner()).not.toBeNull();
  });
});
