// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as onboardingHelper from "../js/modules/onboarding-helper.js";
import {
  ONBOARDING_STORAGE_KEY,
  closeOnboardingHelper,
  captureInstallPrompt,
  createMemoryStorage,
  getInstallInstructions,
  getOnboardingSteps,
  getOnboardingVersion,
  markOnboardingSeen,
  openOnboardingHelper,
  shouldAutoShowOnboarding
} from "../js/modules/onboarding-helper.js";

describe("release onboarding helper state", () => {
  it("uses the 0.1.0 onboarding version from runtime config", () => {
    expect(getOnboardingVersion({ onboardingVersion: "0.1.0" })).toBe("0.1.0");
  });

  it("defines the three approved onboarding steps with user-facing copy", () => {
    expect(getOnboardingSteps()).toEqual([
      {
        id: "install",
        title: "加到主畫面",
        body: "像 App 一樣快速打開，每天讀經更方便。",
        primaryLabel: "查看安裝方式"
      },
      {
        id: "join-plan",
        title: "和教會朋友一起加入計畫",
        body: "到「計畫」選擇讀經計畫，和小組一起開始。",
        primaryLabel: "前往計畫"
      },
      {
        id: "track-progress",
        title: "追蹤你的讀經進度",
        body: "完成每日章節後打卡，查看個人與團體進度。",
        primaryLabel: "查看進度"
      }
    ]);
  });

  it("does not use system-oriented words in user-facing onboarding copy", () => {
    const text = JSON.stringify(getOnboardingSteps());
    expect(text).not.toMatch(/PWA|cache|release|onboarding/i);
  });

  it("auto-shows only after login and sync when this version is unseen", () => {
    const storage = createMemoryStorage();
    expect(shouldAutoShowOnboarding({
      auth: { loggedIn: true },
      syncComplete: true,
      storage,
      config: { onboardingVersion: "0.1.0" }
    })).toBe(true);
  });

  it("does not auto-show before sync completes", () => {
    const storage = createMemoryStorage();
    expect(shouldAutoShowOnboarding({
      auth: { loggedIn: true },
      syncComplete: false,
      storage,
      config: { onboardingVersion: "0.1.0" }
    })).toBe(false);
  });

  it("does not auto-show after the version is dismissed", () => {
    const storage = createMemoryStorage({ [ONBOARDING_STORAGE_KEY]: "0.1.0" });
    expect(shouldAutoShowOnboarding({
      auth: { loggedIn: true },
      syncComplete: true,
      storage,
      config: { onboardingVersion: "0.1.0" }
    })).toBe(false);
  });

  it("defers opening the helper after eligibility is confirmed", () => {
    document.body.innerHTML = "";
    vi.useFakeTimers();

    expect(typeof onboardingHelper.maybeShowReleaseOnboarding).toBe("function");

    const shown = onboardingHelper.maybeShowReleaseOnboarding({
      auth: { loggedIn: true },
      syncComplete: true,
      storage: createMemoryStorage(),
      config: { onboardingVersion: "0.1.0" }
    });

    expect(shown).toBe(true);
    expect(document.getElementById("release-onboarding-dialog")).toBeNull();

    vi.advanceTimersByTime(250);
    expect(document.getElementById("release-onboarding-dialog")).toBeTruthy();

    vi.useRealTimers();
  });

  it("stores the current onboarding version when dismissed", () => {
    const storage = createMemoryStorage();
    markOnboardingSeen({ storage, config: { onboardingVersion: "0.1.0" } });
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBe("0.1.0");
  });
});

describe("release onboarding helper dialog", () => {
  it("renders an accessible dialog with the first step", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    const dialog = document.getElementById("release-onboarding-dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("加到主畫面");
    expect(dialog.textContent).toContain("像 App 一樣快速打開，每天讀經更方便。");
    expect(dialog.textContent).toContain("稍後再看");
    expect(dialog.textContent).toContain("不要再顯示此版本");
  });

  it("moves focus into the dialog when opened", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    expect(document.activeElement).toBe(document.getElementById("release-onboarding-dialog"));
  });

  it("closes when Escape is pressed", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    document.getElementById("release-onboarding-dialog").dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true
    }));

    expect(document.getElementById("release-onboarding-dialog")).toBeNull();
  });

  it("restores focus to its trigger when closed", () => {
    document.body.innerHTML = '<button type="button" id="onboarding-trigger">Open</button>';
    const trigger = document.getElementById("onboarding-trigger");
    trigger.focus();

    openOnboardingHelper({ trigger, config: { onboardingVersion: "0.1.0" } });
    closeOnboardingHelper();

    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab and Shift+Tab focus within dialog controls", () => {
    document.body.innerHTML = '<button type="button" id="outside-control">Outside</button>';
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    const dialog = document.getElementById("release-onboarding-dialog");
    const controls = [...dialog.querySelectorAll("button:not([disabled])")];
    const firstControl = controls[0];
    const lastControl = controls.at(-1);

    lastControl.focus();
    lastControl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(firstControl);

    firstControl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true
    }));
    expect(document.activeElement).toBe(lastControl);
  });

  it("can start from the join-plan step for manual recall", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ startStep: "join-plan", manual: true });
    expect(document.getElementById("release-onboarding-dialog").textContent).toContain("和教會朋友一起加入計畫");
  });

  it("dismisses the current version only when remember is requested", () => {
    document.body.innerHTML = "";
    const storage = createMemoryStorage();
    openOnboardingHelper({ storage, config: { onboardingVersion: "0.1.0" } });
    closeOnboardingHelper({ remember: false, storage, config: { onboardingVersion: "0.1.0" } });
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();

    openOnboardingHelper({ storage, config: { onboardingVersion: "0.1.0" } });
    closeOnboardingHelper({ remember: true, storage, config: { onboardingVersion: "0.1.0" } });
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBe("0.1.0");
  });
});

describe("release onboarding helper actions", () => {
  it("shows iOS home-screen instructions when install prompt is unavailable", () => {
    expect(getInstallInstructions("Mozilla/5.0 iPhone Safari", false)).toContain("Safari");
    expect(getInstallInstructions("Mozilla/5.0 iPhone Safari", false)).toContain("加入主畫面");
  });

  it("uses captured browser install prompt for install action", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "accepted" })
    };
    captureInstallPrompt(prompt);
    openOnboardingHelper({ startStep: "install" });
    document.querySelector("[data-onboarding-primary]").click();
    await Promise.resolve();
    expect(prompt.prompt).toHaveBeenCalledOnce();
  });

  it("navigates to plan tab from join-plan action", () => {
    document.body.innerHTML = "";
    const switchTab = vi.fn();
    globalThis.appRouter = { switchTab };
    openOnboardingHelper({ startStep: "join-plan" });
    document.querySelector("[data-onboarding-primary]").click();
    expect(switchTab).toHaveBeenCalledWith("plan-view");
  });
});
