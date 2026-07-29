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

function getInstallReferenceLinks() {
  return [
    {
      label: "iPhone",
      href: "https://support.apple.com/zh-tw/guide/iphone/iphea86e5236/ios"
    },
    {
      label: "iPad",
      href: "https://support.apple.com/zh-tw/guide/ipad/ipad8f1f7a29/26/ipados/26"
    },
    {
      label: "Android",
      href: "https://support.google.com/chrome/answer/9658361?hl=zh-Hant&co=GENIE.Platform%3DAndroid"
    }
  ];
}

function iconForStep(stepId) {
  if (stepId === "install") return "home";
  if (stepId === "join-plan") return "people";
  return "bookOpen";
}

function renderActionRows() {
  return getOnboardingSteps().map((step) => `
    <article class="release-onboarding-action" data-onboarding-action-card="${step.id}">
      <span class="release-onboarding-action__icon nlc-icon nlc-icon--md" data-icon="${iconForStep(step.id)}" aria-hidden="true"></span>
      <div class="release-onboarding-action__content">
        <h3>${step.title}</h3>
        <p>${step.body}</p>
        ${step.id === "install" ? `
          <div class="release-onboarding-install-guide" data-onboarding-install-guide tabindex="-1" aria-live="polite" hidden>
            <strong>安裝方式</strong>
            <p data-onboarding-install-guide-text></p>
            <div class="release-onboarding-install-guide__links" data-onboarding-install-guide-links aria-label="安裝參考連結"></div>
          </div>
        ` : ""}
      </div>
      <button type="button" class="release-onboarding-action__button" data-onboarding-action="${step.id}">
        ${step.primaryLabel}
      </button>
    </article>
  `).join("");
}

function showInstallGuide() {
  const guide = document.querySelector("[data-onboarding-install-guide]");
  const text = document.querySelector("[data-onboarding-install-guide-text]");
  const links = document.querySelector("[data-onboarding-install-guide-links]");
  if (!guide || !text || !links) return;
  text.textContent = getInstallInstructions();
  links.innerHTML = getInstallReferenceLinks()
    .map(({ label, href }) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .join("");
  guide.hidden = false;
  guide.focus?.();
}

async function runPrimaryAction(stepId) {
  const step = getOnboardingSteps().find((item) => item.id === stepId);
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
      <div class="release-onboarding-dialog__header">
        <p class="release-onboarding-dialog__eyebrow">使用說明</p>
        <h2 class="release-onboarding-dialog__title" id="release-onboarding-title">一起開始今天的讀經！</h2>
        <p class="release-onboarding-dialog__body">三個小功能，幫你更快開始今天的讀經。</p>
      </div>
      <div class="release-onboarding-dialog__actions" data-onboarding-actions>
        ${renderActionRows()}
      </div>
      <div class="release-onboarding-dialog__footer">
        <button type="button" class="release-onboarding-dialog__footer-btn" data-onboarding-later>稍後再看</button>
        <button type="button" class="release-onboarding-dialog__footer-btn" data-onboarding-dismiss>不再顯示這個提示</button>
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
  lastTrigger = trigger;

  const root = document.createElement("div");
  root.id = "release-onboarding-root";
  root.className = "release-onboarding-root";
  root.innerHTML = dialogTemplate(config);
  document.body.appendChild(root);
  document.addEventListener("keydown", handleDialogKeydown);

  const dialog = root.querySelector("#release-onboarding-dialog");
  globalThis.hydrateIcons?.(root);

  root.querySelector("[data-onboarding-close]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-later]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-dismiss]").addEventListener("click", () => closeOnboardingHelper({ remember: true, storage, config }));
  root.querySelectorAll("[data-onboarding-action]").forEach((button) => {
    button.addEventListener("click", () => {
      runPrimaryAction(button.dataset.onboardingAction).catch((error) => console.warn("Onboarding action failed:", error));
    });
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
if (globalThis.__bibleDeferredInstallPrompt) {
  captureInstallPrompt(globalThis.__bibleDeferredInstallPrompt);
}

globalThis.openOnboardingHelper = openOnboardingHelper;
