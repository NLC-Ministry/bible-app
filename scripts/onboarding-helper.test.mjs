// @vitest-environment jsdom
import { readFileSync } from "node:fs";
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

  it("shows at most once per session when storage access fails", () => {
    const storage = {
      getItem() {
        throw new Error("storage unavailable");
      },
      setItem() {
        throw new Error("storage unavailable");
      }
    };
    const config = { onboardingVersion: "0.1.0" };

    delete globalThis.__bibleOnboardingSeenInSession;
    expect(shouldAutoShowOnboarding({ auth: { loggedIn: true }, syncComplete: true, storage, config })).toBe(true);
    markOnboardingSeen({ storage, config });
    expect(shouldAutoShowOnboarding({ auth: { loggedIn: true }, syncComplete: true, storage, config })).toBe(false);
    delete globalThis.__bibleOnboardingSeenInSession;
  });
});

describe("release onboarding helper dialog", () => {
  it("renders an accessible shadcn-style helper sheet with all actions", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    const dialog = document.getElementById("release-onboarding-dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("一起開始今天的讀經！");
    expect(dialog.textContent).toContain("加到主畫面");
    expect(dialog.textContent).toContain("和教會朋友一起加入計畫");
    expect(dialog.textContent).toContain("追蹤你的讀經進度");
    expect(dialog.textContent).toContain("稍後再看");
    expect(dialog.textContent).toContain("不再顯示這個提示");
    expect(dialog.textContent).not.toContain("0.1.0");
    expect(dialog.textContent).not.toContain("版本");
    expect(dialog.querySelector("[data-onboarding-prev]")).toBeNull();
    expect(dialog.querySelector("[data-onboarding-next]")).toBeNull();
    expect(dialog.querySelector("[data-onboarding-count]")).toBeNull();
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

  it("closes when the backdrop is clicked", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    document.querySelector("[data-onboarding-backdrop]").click();

    expect(document.getElementById("release-onboarding-dialog")).toBeNull();
  });

  it("closes when the overlay root outside the dialog is clicked", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ config: { onboardingVersion: "0.1.0" } });

    document.getElementById("release-onboarding-root").click();

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

  it("keeps every helper action visible during manual recall", () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ startStep: "join-plan", manual: true });
    const dialog = document.getElementById("release-onboarding-dialog");
    expect(dialog.textContent).toContain("加到主畫面");
    expect(dialog.textContent).toContain("和教會朋友一起加入計畫");
    expect(dialog.textContent).toContain("追蹤你的讀經進度");
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

  it("does not dismiss automatic onboarding when manual recall is completed", () => {
    document.body.innerHTML = "";
    const storage = createMemoryStorage();
    openOnboardingHelper({ manual: true, storage, config: { onboardingVersion: "0.1.0" } });

    document.querySelector("[data-onboarding-later]").click();

    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
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
    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();
    expect(prompt.prompt).toHaveBeenCalledOnce();
  });

  it("opens a visible install guide when browser install prompt is unavailable", async () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ startStep: "install" });

    const guide = document.querySelector("[data-onboarding-install-guide]");
    expect(guide.hidden).toBe(true);

    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();

    expect(guide.hidden).toBe(false);
    expect(guide.textContent).toContain("加入主畫面");
    expect(document.activeElement).toBe(guide);
  });

  it("shows Traditional Chinese install reference links for iPhone, iPad, and Android", async () => {
    document.body.innerHTML = "";
    openOnboardingHelper({ startStep: "install" });

    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();

    const links = [...document.querySelectorAll("[data-onboarding-install-guide-links] a")];
    const labels = links.map((link) => link.textContent.trim());
    const hrefs = links.map((link) => link.getAttribute("href"));

    expect(labels).toEqual(["iPhone", "iPad", "Android"]);
    expect(hrefs).toEqual([
      "https://support.apple.com/zh-tw/guide/iphone/iphea86e5236/ios",
      "https://support.apple.com/zh-tw/guide/ipad/ipad8f1f7a29/26/ipados/26",
      "https://support.google.com/chrome/answer/9658361?hl=zh-Hant&co=GENIE.Platform%3DAndroid"
    ]);
  });

  it("opens discoverable plans from the join-plan action", async () => {
    document.body.innerHTML = "";
    const switchTab = vi.fn();
    globalThis.appRouter = { switchTab };
    openOnboardingHelper({ startStep: "join-plan" });
    document.querySelector('[data-onboarding-action="join-plan"]').click();
    await Promise.resolve();
    expect(switchTab).toHaveBeenCalledWith("plan-view", { onboardingPlanDestination: "discover" });
  });

  it("opens the active plan progress from the progress action", async () => {
    document.body.innerHTML = "";
    const switchTab = vi.fn();
    globalThis.appRouter = { switchTab };
    globalThis.state = { activePlan: { id: "active-plan" } };
    openOnboardingHelper({ startStep: "track-progress" });
    document.querySelector('[data-onboarding-action="track-progress"]').click();
    await Promise.resolve();
    expect(switchTab).toHaveBeenCalledWith("plan-view", { onboardingPlanDestination: "active-progress" });
  });
});

describe("release onboarding accessibility behavior", () => {
  it("closes on Escape and returns focus to the manual trigger", () => {
    document.body.innerHTML = '<button id="trigger">使用說明</button>';
    const trigger = document.getElementById("trigger");
    trigger.focus();
    openOnboardingHelper({ manual: true, trigger });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.getElementById("release-onboarding-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps dialog dimensions bounded for mobile layouts", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain("width: min(100vw, 34rem)");
    expect(css).toContain("max-height: min(88dvh, 42rem)");
    expect(css).toContain("overflow: auto");
    expect(css).toContain("@media (min-width: 768px)");
  });

  it("uses visible keyboard focus styles for every dialog control type", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain(".release-onboarding-dialog__close:focus-visible");
    expect(css).toContain(".release-onboarding-action__button:focus-visible");
    expect(css).toContain(".release-onboarding-dialog__footer-btn:focus-visible");
  });

  it("uses a larger subtle close button treatment for the dialog dismiss control", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain(".release-onboarding-dialog__close {");
    expect(css).toContain("min-width: 2.5rem");
    expect(css).toContain("min-height: 2.5rem");
    expect(css).toContain("border: 0");
    expect(css).toContain("background: transparent");
  });

  it("does not rely on an undefined text button class", () => {
    const helper = readFileSync("js/modules/onboarding-helper.js", "utf8");
    expect(helper).not.toContain('class="text-btn"');
  });
});
