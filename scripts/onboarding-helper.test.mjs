// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as onboardingHelper from "../js/modules/onboarding-helper.js";
import {
  ONBOARDING_STORAGE_KEY,
  closeOnboardingHelper,
  captureInstallPrompt,
  createMemoryStorage,
  getInstallGuideModel,
  getInstallInstructions,
  getInstallPlatform,
  getInstallPromptState,
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
  it("detects installed, iOS, Android prompt, Android manual, desktop, and generic install platforms", () => {
    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 iPhone Safari",
      standalone: true
    })).toBe("installed");

    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari",
      standalone: false
    })).toBe("ios");

    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      standalone: false,
      hasTouch: true
    })).toBe("ios");

    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 Linux; Android 15; Pixel Chrome/140 Mobile Safari",
      hasPrompt: true
    })).toBe("android-prompt");

    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 Linux; Android 15; Pixel Chrome/140 Mobile Safari",
      hasPrompt: false
    })).toBe("android-manual");

    expect(getInstallPlatform({
      userAgent: "Mozilla/5.0 Macintosh; Intel Mac OS X 15_0 AppleWebKit Chrome/140 Safari",
      hasPrompt: true
    })).toBe("desktop");

    expect(getInstallPlatform({
      userAgent: "Unknown browser",
      hasPrompt: false
    })).toBe("generic");
  });

  it("returns concise Traditional Chinese install guide models per platform", () => {
    expect(getInstallGuideModel({
      userAgent: "Mozilla/5.0 iPhone Safari",
      standalone: false,
      hasPrompt: false
    })).toMatchObject({
      platform: "ios",
      title: "在 Safari 加到主畫面",
      primaryLabel: "查看 iPhone 安裝方式",
      canPrompt: false,
      installed: false
    });
    expect(getInstallGuideModel({
      userAgent: "Mozilla/5.0 iPhone Safari",
      standalone: false,
      hasPrompt: false
    }).steps).toEqual([
      { icon: "share", label: "點 Safari 下方的分享按鈕。" },
      { icon: "add-square", label: "選擇「加入主畫面」。" },
      { icon: "check", label: "點右上角「新增」。" }
    ]);

    expect(getInstallGuideModel({
      userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
      hasPrompt: true
    })).toMatchObject({
      platform: "android-prompt",
      title: "安裝成 App",
      primaryLabel: "安裝 App",
      canPrompt: true,
      installed: false
    });

    expect(getInstallGuideModel({
      userAgent: "Mozilla/5.0 iPad Safari",
      standalone: true
    })).toMatchObject({
      platform: "installed",
      title: "已經加到主畫面",
      primaryLabel: "已安裝",
      canPrompt: false,
      installed: true
    });
  });

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

  it("does not prompt twice while the native install choice is pending", async () => {
    document.body.innerHTML = "";
    let resolveChoice;
    const userChoice = new Promise((resolve) => {
      resolveChoice = resolve;
    });
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    const installButton = document.querySelector('[data-onboarding-action="install"]');

    installButton.click();
    installButton.click();

    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(getInstallPromptState()).toBe("available");
    expect(installButton.disabled).toBe(true);

    resolveChoice({ outcome: "accepted" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(getInstallPromptState()).toBe("accepted");
    expect(installButton.disabled).toBe(false);
  });

  it("fails promptly when the browser prompt rejects before user choice settles", async () => {
    document.body.innerHTML = "";
    let resolveChoice;
    const userChoice = new Promise((resolve) => {
      resolveChoice = resolve;
    });
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(() => Promise.reject(new Error("prompt failed"))),
      userChoice
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    const installButton = document.querySelector('[data-onboarding-action="install"]');

    installButton.click();
    try {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(getInstallPromptState()).toBe("failed");
      expect(installButton.disabled).toBe(false);
      expect(document.querySelector("[data-onboarding-install-guide]").hidden).toBe(false);
      expect(document.querySelector("[data-onboarding-install-status]").textContent).toContain("手動方式");

      resolveChoice({ outcome: "accepted" });
      await Promise.resolve();
      await Promise.resolve();
      expect(getInstallPromptState()).toBe("failed");
    } finally {
      resolveChoice({ outcome: "dismissed" });
      await Promise.resolve();
      await Promise.resolve();
      closeOnboardingHelper();
    }
  });

  it("keeps accepted install state when the action is activated again", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "accepted" })
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    const installButton = document.querySelector('[data-onboarding-action="install"]');

    installButton.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    installButton.click();
    await Promise.resolve();

    expect(getInstallPromptState()).toBe("accepted");
    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(installButton.textContent.trim()).toBe("已安裝");
    expect(document.querySelector("[data-onboarding-install-guide-title]").textContent).toBe("已經加到主畫面");
  });

  it("uses the supplied install guide label and preserves manual install behavior", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "accepted" })
    };
    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 iPhone Safari",
        standalone: false,
        hasPrompt: false
      }
    });

    expect(document.querySelector('[data-onboarding-action="install"]').textContent.trim()).toBe("查看 iPhone 安裝方式");
    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();

    expect(prompt.prompt).not.toHaveBeenCalled();
    expect(document.querySelector("[data-onboarding-install-guide]").hidden).toBe(false);
    captureInstallPrompt({ preventDefault() {} });
  });

  it("records accepted Android native install prompt outcome", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "accepted" })
    };

    captureInstallPrompt(prompt);
    expect(getInstallPromptState()).toBe("available");

    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(getInstallPromptState()).toBe("accepted");
  });

  it("hides the pending install status after accepting the native prompt", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "accepted" })
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();
    await Promise.resolve();

    const status = document.querySelector("[data-onboarding-install-status]");
    expect(status.textContent).not.toContain("正在開啟安裝提示…");
    expect(status.hidden).toBe(true);
  });

  it("falls back to manual Android steps when native install prompt is dismissed", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "dismissed" })
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(getInstallPromptState()).toBe("dismissed");
    expect(document.querySelector("[data-onboarding-install-guide]").hidden).toBe(false);
    expect(document.querySelector("[data-onboarding-install-guide-title]").textContent).toBe("從瀏覽器選單加入");
    expect(document.querySelector("[data-onboarding-install-status]").textContent).toContain("也可以手動加入");
  });

  it("keeps Android manual steps and label when activated again after dismissal", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "dismissed" })
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    const installButton = document.querySelector('[data-onboarding-action="install"]');

    installButton.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    installButton.click();
    await Promise.resolve();

    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(installButton.textContent.trim()).toBe("查看 Android 安裝方式");
    expect(document.querySelector("[data-onboarding-install-guide]").dataset.onboardingPlatform).toBe("android-manual");
    expect(document.querySelector("[data-onboarding-install-guide-title]").textContent).toBe("從瀏覽器選單加入");
  });

  it("keeps Android manual steps and label when activated again after prompt rejection", async () => {
    document.body.innerHTML = "";
    const prompt = {
      preventDefault() {},
      prompt: vi.fn(() => Promise.reject(new Error("prompt failed"))),
      userChoice: Promise.resolve({ outcome: "dismissed" })
    };

    captureInstallPrompt(prompt);
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      }
    });
    const installButton = document.querySelector('[data-onboarding-action="install"]');

    installButton.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    installButton.click();
    await Promise.resolve();

    expect(prompt.prompt).toHaveBeenCalledOnce();
    expect(getInstallPromptState()).toBe("failed");
    expect(installButton.textContent.trim()).toBe("查看 Android 安裝方式");
    expect(document.querySelector("[data-onboarding-install-guide]").dataset.onboardingPlatform).toBe("android-manual");
    expect(document.querySelector("[data-onboarding-install-guide-title]").textContent).toBe("從瀏覽器選單加入");
  });

  it("opens a compact iOS step-by-step install guide when native prompt is unavailable", async () => {
    document.body.innerHTML = "";
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 iPhone Safari",
        standalone: false,
        hasPrompt: false
      }
    });

    const guide = document.querySelector("[data-onboarding-install-guide]");
    expect(guide.hidden).toBe(true);

    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();

    expect(guide.hidden).toBe(false);
    expect(guide.dataset.onboardingPlatform).toBe("ios");
    expect(document.querySelector("[data-onboarding-install-guide-title]").textContent).toBe("在 Safari 加到主畫面");
    expect(document.querySelector("[data-onboarding-install-guide-body]").textContent).toContain("三個步驟");

    const stepItems = [...document.querySelectorAll("[data-onboarding-install-guide-steps] li")];
    const steps = stepItems.map((item) => item.querySelector("[data-onboarding-install-guide-step-label]").textContent.trim());
    expect(steps).toEqual([
      "點 Safari 下方的分享按鈕。",
      "選擇「加入主畫面」。",
      "點右上角「新增」。"
    ]);
    expect(stepItems.map((item) => item.querySelector("[data-onboarding-install-guide-step-icon]").dataset.installStepIcon)).toEqual([
      "share",
      "add-square",
      "check"
    ]);
    expect(document.activeElement).toBe(guide);
  });

  it("keeps support links secondary to platform-specific install steps", async () => {
    document.body.innerHTML = "";
    openOnboardingHelper({
      startStep: "install",
      installGuideOptions: {
        userAgent: "Mozilla/5.0 iPhone Safari",
        standalone: false,
        hasPrompt: false
      }
    });

    document.querySelector('[data-onboarding-action="install"]').click();
    await Promise.resolve();

    const guideText = document.querySelector("[data-onboarding-install-guide]").textContent;
    const firstStepIndex = guideText.indexOf("點 Safari 下方的分享按鈕");
    const linkIndex = guideText.indexOf("詳細說明");
    expect(firstStepIndex).toBeGreaterThan(-1);
    expect(linkIndex).toBeGreaterThan(firstStepIndex);

    const links = [...document.querySelectorAll("[data-onboarding-install-guide-links] a")];
    expect(links.map((link) => link.textContent.trim())).toEqual(["iPhone", "iPad"]);
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
  it("styles install guidance as compact progressive disclosure", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain(".release-onboarding-install-guide__steps");
    expect(css).toContain(".release-onboarding-install-guide__step-icon");
    expect(css).toContain(".release-onboarding-install-guide__step-icon svg");
    expect(css).toContain(".release-onboarding-install-guide__support");
    expect(css).toContain(".release-onboarding-install-guide__status");
  });

  it("keeps install helper copy free from platform implementation terms", () => {
    const copy = [
      JSON.stringify(getOnboardingSteps()),
      JSON.stringify(getInstallGuideModel({
        userAgent: "Mozilla/5.0 iPhone Safari",
        standalone: false,
        hasPrompt: false
      })),
      JSON.stringify(getInstallGuideModel({
        userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari",
        hasPrompt: true
      })),
      JSON.stringify(getInstallGuideModel({
        userAgent: "Unknown browser",
        hasPrompt: false
      }))
    ].join(" ");
    expect(copy).not.toMatch(/PWA|beforeinstallprompt|cache|release|onboarding/i);
  });

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

  it("uses the shared subtle icon button treatment for the dialog dismiss control", () => {
    const css = readFileSync("index.css", "utf8");
    const helper = readFileSync("js/modules/onboarding-helper.js", "utf8");
    expect(css).toContain(".release-onboarding-dialog__close {");
    expect(helper).toContain("release-onboarding-dialog__close dialog-close-button icon-button icon-button--subtle");
    expect(css).not.toMatch(/\.release-onboarding-dialog__close\s*\{[^}]*min-(?:width|height)/);
  });

  it("reserves a stable icon cell for every install guide step", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain(".release-onboarding-install-guide__steps {");
    expect(css).toContain(".release-onboarding-install-guide__step-icon {");
    expect(css).toContain(".release-onboarding-install-guide__step-icon svg {");
    expect(css).toContain("grid-template-columns: 2rem minmax(0, 1fr)");
    expect(css).toContain("width: 2rem");
    expect(css).toContain("height: 2rem");
    expect(css).toContain("width: 1.05rem");
    expect(css).toContain("height: 1.05rem");
  });

  it("does not rely on an undefined text button class", () => {
    const helper = readFileSync("js/modules/onboarding-helper.js", "utf8");
    expect(helper).not.toContain('class="text-btn"');
  });
});
