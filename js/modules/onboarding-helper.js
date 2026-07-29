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
