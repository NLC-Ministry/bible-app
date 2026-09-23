/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { wireCheckAppUpdate } from "./profile.js";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function mount() {
  document.body.innerHTML = `
    <button type="button" id="btn-check-app-update">
      <span id="check-app-update-status">畫面異常或看起來是舊版時使用</span>
    </button>`;
  return {
    btn: document.getElementById("btn-check-app-update"),
    status: () => document.getElementById("check-app-update-status").textContent
  };
}

describe("個人設定 → 檢查更新", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("is wired from the real settings list markup", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="btn-check-app-update"');
    expect(html).toContain('id="check-app-update-status"');
  });

  it("stays busy while a newer build reloads", async () => {
    const { btn, status } = mount();
    wireCheckAppUpdate({ checkAppUpdate: async () => "reload", startRepair: vi.fn() });
    btn.click();
    await flush();
    expect(status()).toBe("發現新版本，正在更新…");
    expect(btn.disabled).toBe(true);
  });

  it("when already current, arms a second tap that runs the full repair", async () => {
    const startRepair = vi.fn();
    const checkAppUpdate = vi.fn(async () => "current");
    const { btn, status } = mount();
    wireCheckAppUpdate({ checkAppUpdate, startRepair });

    btn.click();
    await flush();
    expect(status()).toContain("已是最新版本");
    expect(startRepair).not.toHaveBeenCalled();

    btn.click();
    await flush();
    expect(startRepair).toHaveBeenCalledOnce();
    expect(checkAppUpdate).toHaveBeenCalledOnce();
  });

  it("reports offline without arming the repair", async () => {
    const startRepair = vi.fn();
    const { btn, status } = mount();
    wireCheckAppUpdate({ checkAppUpdate: async () => "unknown", startRepair });
    btn.click();
    await flush();
    expect(status()).toContain("目前無法連線");
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();
    expect(startRepair).not.toHaveBeenCalled();
  });

  it("binds only once across profile re-renders", async () => {
    const checkAppUpdate = vi.fn(async () => "unknown");
    const { btn } = mount();
    wireCheckAppUpdate({ checkAppUpdate });
    wireCheckAppUpdate({ checkAppUpdate });
    btn.click();
    await flush();
    expect(checkAppUpdate).toHaveBeenCalledOnce();
  });
});
