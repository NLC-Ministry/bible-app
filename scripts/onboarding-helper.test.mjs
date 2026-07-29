// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STORAGE_KEY,
  closeOnboardingHelper,
  createMemoryStorage,
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
