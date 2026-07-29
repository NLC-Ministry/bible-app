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
    return true;
  }
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
}

function dialogTemplate() {
  return `
    <div class="release-onboarding-backdrop" data-onboarding-backdrop></div>
    <section class="release-onboarding-dialog" id="release-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="release-onboarding-title" tabindex="-1">
      <button type="button" class="release-onboarding-dialog__close" data-onboarding-close aria-label="關閉使用說明">×</button>
      <p class="release-onboarding-dialog__eyebrow">使用說明</p>
      <h2 class="release-onboarding-dialog__title" id="release-onboarding-title" data-onboarding-title></h2>
      <p class="release-onboarding-dialog__body" data-onboarding-body></p>
      <p class="release-onboarding-dialog__count" data-onboarding-count></p>
      <div class="release-onboarding-dialog__actions">
        <button type="button" class="pill-btn" data-onboarding-prev>上一步</button>
        <button type="button" class="pill-btn" data-onboarding-next>下一步</button>
        <button type="button" class="primary-btn" data-onboarding-primary></button>
      </div>
      <div class="release-onboarding-dialog__footer">
        <button type="button" class="text-btn" data-onboarding-later>稍後再看</button>
        <button type="button" class="text-btn" data-onboarding-dismiss>不要再顯示此版本</button>
      </div>
    </section>
  `;
}

export function closeOnboardingHelper({ remember = false, storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
  if (remember) markOnboardingSeen({ storage, config });
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

  const dialog = root.querySelector("#release-onboarding-dialog");
  renderStep(dialog);

  root.querySelector("[data-onboarding-close]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-later]").addEventListener("click", () => closeOnboardingHelper({ storage, config }));
  root.querySelector("[data-onboarding-dismiss]").addEventListener("click", () => closeOnboardingHelper({ remember: true, storage, config }));
  root.querySelector("[data-onboarding-prev]").addEventListener("click", () => {
    activeStepIndex = Math.max(0, activeStepIndex - 1);
    renderStep(dialog);
  });
  root.querySelector("[data-onboarding-next]").addEventListener("click", () => {
    if (activeStepIndex >= getOnboardingSteps().length - 1) {
      closeOnboardingHelper({ remember: true, storage, config });
      return;
    }
    activeStepIndex += 1;
    renderStep(dialog);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOnboardingHelper({ storage, config });
      return;
    }
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
