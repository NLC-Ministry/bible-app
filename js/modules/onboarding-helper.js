export const ONBOARDING_STORAGE_KEY = "bible_onboarding_seen_version";

export function getOnboardingVersion(config = globalThis.APP_CONFIG || {}) {
  return String(config.onboardingVersion || config.appVersion || "0.1.0");
}

export function getOnboardingSteps() {
  return [
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
  ];
}

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function isLoggedIn(auth) {
  if (!auth) return false;
  if (typeof auth.isLoggedIn === "function") return auth.isLoggedIn();
  return Boolean(auth.loggedIn);
}

export function shouldAutoShowOnboarding({ auth, syncComplete, storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
  if (!isLoggedIn(auth)) return false;
  if (!syncComplete) return false;
  const version = getOnboardingVersion(config);
  try {
    return storage?.getItem(ONBOARDING_STORAGE_KEY) !== version;
  } catch {
    return globalThis.__bibleOnboardingSeenInSession !== version;
  }
}

export function maybeShowReleaseOnboarding(options = {}) {
  if (!shouldAutoShowOnboarding(options)) return false;
  globalThis.setTimeout(() => openOnboardingHelper(options), 250);
  return true;
}

export function markOnboardingSeen({ storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
  try {
    storage?.setItem(ONBOARDING_STORAGE_KEY, getOnboardingVersion(config));
  } catch {
    globalThis.__bibleOnboardingSeenInSession = getOnboardingVersion(config);
  }
}

let activeStepIndex = 0;
let lastTrigger = null;
let deferredInstallPrompt = null;

function handleDialogKeydown(event) {
  if (event.key === "Escape") {
    closeOnboardingHelper();
  }
}

export function captureInstallPrompt(event) {
  event?.preventDefault?.();
  deferredInstallPrompt = event;
}

export function getInstallInstructions(userAgent = globalThis.navigator?.userAgent || "", standalone = globalThis.navigator?.standalone) {
  const ua = String(userAgent);
  if (standalone || globalThis.matchMedia?.("(display-mode: standalone)")?.matches) {
    return "你已經可以像 App 一樣從主畫面打開。";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "請在 Safari 點選分享按鈕，選擇「加入主畫面」。";
  }
  if (/Android/i.test(ua)) {
    return "請在瀏覽器選單中選擇「安裝應用程式」或「加入主畫面」。";
  }
  return "請使用瀏覽器選單將此頁加入主畫面，之後就能更快回來讀經。";
}

function stepIndexFor(id) {
  const index = getOnboardingSteps().findIndex((step) => step.id === id);
  return index >= 0 ? index : 0;
}

function renderStep(dialog) {
  const steps = getOnboardingSteps();
  const step = steps[activeStepIndex] || steps[0];
  dialog.querySelector("[data-onboarding-title]").textContent = step.title;
  dialog.querySelector("[data-onboarding-body]").textContent = step.body;
  dialog.querySelector("[data-onboarding-primary]").textContent = step.primaryLabel;
  dialog.querySelector("[data-onboarding-count]").textContent = `${activeStepIndex + 1} / ${steps.length}`;
  dialog.querySelector("[data-onboarding-prev]").disabled = activeStepIndex === 0;
  dialog.querySelector("[data-onboarding-next]").textContent = activeStepIndex === steps.length - 1 ? "完成" : "下一步";
  dialog.querySelector("[data-onboarding-dots]").innerHTML = steps
    .map((item, index) => `<span class="release-onboarding-dialog__dot${index === activeStepIndex ? " is-active" : ""}" aria-label="${item.title}"></span>`)
    .join("");
  const guide = dialog.querySelector("[data-onboarding-install-guide]");
  if (guide) guide.hidden = true;
}

function showInstallGuide() {
  const guide = document.querySelector("[data-onboarding-install-guide]");
  const text = document.querySelector("[data-onboarding-install-guide-text]");
  if (!guide || !text) return;
  text.textContent = getInstallInstructions();
  guide.hidden = false;
  guide.focus?.();
}

async function runPrimaryAction() {
  const step = getOnboardingSteps()[activeStepIndex];
  if (!step) return;

  if (step.id === "install") {
    if (deferredInstallPrompt?.prompt) {
      try {
        await deferredInstallPrompt.prompt();
        deferredInstallPrompt = null;
      } catch (error) {
        console.warn("Browser install prompt failed:", error);
        showInstallGuide();
      }
      return;
    }
    showInstallGuide();
    return;
  }

  if (step.id === "join-plan") {
    closeOnboardingHelper();
    await globalThis.appRouter?.switchTab?.("plan-view", { onboardingPlanDestination: "discover" });
    return;
  }

  if (step.id === "track-progress") {
    closeOnboardingHelper();
    const destination = globalThis.state?.activePlan ? "active-progress" : "discover";
    await globalThis.appRouter?.switchTab?.("plan-view", { onboardingPlanDestination: destination });
  }
}

function dialogTemplate() {
  return `
    <div class="release-onboarding-backdrop" data-onboarding-backdrop></div>
    <section class="release-onboarding-dialog" id="release-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="release-onboarding-title" tabindex="-1">
      <button type="button" class="release-onboarding-dialog__close" data-onboarding-close aria-label="關閉使用說明">×</button>
      <p class="release-onboarding-dialog__eyebrow">使用說明</p>
      <div class="release-onboarding-dialog__preview" aria-hidden="true">
        <span class="release-onboarding-dialog__preview-icon nlc-icon nlc-icon--lg" data-icon="home"></span>
        <span class="release-onboarding-dialog__preview-line"></span>
        <span class="release-onboarding-dialog__preview-check">已準備好</span>
      </div>
      <h2 class="release-onboarding-dialog__title" id="release-onboarding-title" data-onboarding-title></h2>
      <p class="release-onboarding-dialog__body" data-onboarding-body></p>
      <div class="release-onboarding-install-guide" data-onboarding-install-guide tabindex="-1" aria-live="polite" hidden>
        <strong>安裝方式</strong>
        <p data-onboarding-install-guide-text></p>
      </div>
      <p class="release-onboarding-dialog__count" data-onboarding-count></p>
      <div class="release-onboarding-dialog__dots" data-onboarding-dots aria-hidden="true"></div>
      <div class="release-onboarding-dialog__actions">
        <button type="button" class="pill-btn" data-onboarding-prev>上一步</button>
        <button type="button" class="pill-btn" data-onboarding-next>下一步</button>
        <button type="button" class="primary-btn" data-onboarding-primary></button>
      </div>
      <div class="release-onboarding-dialog__footer">
        <button type="button" class="release-onboarding-dialog__footer-btn" data-onboarding-later>稍後再看</button>
        <button type="button" class="release-onboarding-dialog__footer-btn" data-onboarding-dismiss>不要再顯示此版本</button>
      </div>
    </section>
  `;
}

export function closeOnboardingHelper({ remember = false, storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
  if (remember) markOnboardingSeen({ storage, config });
  document.removeEventListener("keydown", handleDialogKeydown);
  document.getElementById("release-onboarding-root")?.remove();
  if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
}

export function openOnboardingHelper({ startStep = "install", trigger = null, storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
  document.getElementById("release-onboarding-root")?.remove();
  activeStepIndex = stepIndexFor(startStep);
  lastTrigger = trigger;

  const root = document.createElement("div");
  root.id = "release-onboarding-root";
  root.className = "release-onboarding-root";
  root.innerHTML = dialogTemplate();
  document.body.appendChild(root);
  document.addEventListener("keydown", handleDialogKeydown);

  const dialog = root.querySelector("#release-onboarding-dialog");
  renderStep(dialog);
  globalThis.hydrateIcons?.(root);

  root.querySelector("[data-onboarding-close]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-later]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-dismiss]").addEventListener("click", () => closeOnboardingHelper({ remember: true, storage, config }));
  root.querySelector("[data-onboarding-primary]").addEventListener("click", () => {
    runPrimaryAction().catch((error) => console.warn("Onboarding action failed:", error));
  });
  root.querySelector("[data-onboarding-prev]").addEventListener("click", () => {
    activeStepIndex = Math.max(0, activeStepIndex - 1);
    renderStep(dialog);
  });
  root.querySelector("[data-onboarding-next]").addEventListener("click", () => {
    if (activeStepIndex >= getOnboardingSteps().length - 1) {
      closeOnboardingHelper({ storage, config });
      return;
    }
    activeStepIndex += 1;
    renderStep(dialog);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;

    const controls = [...dialog.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")];
    if (controls.length === 0) return;

    event.preventDefault();
    const currentIndex = controls.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
      : (currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
    controls[nextIndex].focus();
  });

  dialog.focus?.();
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("beforeinstallprompt", captureInstallPrompt);
}

globalThis.openOnboardingHelper = openOnboardingHelper;
