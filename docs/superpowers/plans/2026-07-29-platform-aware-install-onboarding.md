# Platform-Aware Install Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Bible app release onboarding helper so “加到主畫面” gives platform-specific install guidance without making the helper feel like a long support article.

**Architecture:** Keep the release helper as a lazy-loaded vanilla ESM module in `js/modules/onboarding-helper.js`. Add a small platform/install model that returns structured UI data, then render that data inside the existing install action card with progressive disclosure. Each manual step must include an icon slot so users can visually match the browser control they are looking for, such as Safari Share, browser menu, Add, and Done. Android/Chromium uses the captured `beforeinstallprompt` event when available; iOS and unsupported browsers reveal compact manual steps and keep external support links secondary.

**Tech Stack:** Vanilla ESM JavaScript, existing CSS in `index.css`, Vitest + jsdom tests in `scripts/onboarding-helper.test.mjs`, existing build pipeline in `scripts/bundle.mjs`.

## Global Constraints

- Do not add dependencies.
- Do not make the onboarding helper larger than necessary on the initial app path; `js/app.js` must continue lazy-loading `./modules/onboarding-helper.js?v=20260729_release_010`.
- Do not use technical terms in member-facing copy: no `PWA`, `beforeinstallprompt`, `cache`, `release`, or `onboarding`.
- iOS cannot open the native Share sheet or Add to Home Screen UI directly; guide the user manually.
- Android/Chromium can call `deferredPrompt.prompt()` only after the browser fires `beforeinstallprompt` and the user taps our install action.
- Keep Apple/Google support links secondary, under the inline steps.
- Every install step must reserve a stable visual icon cell; text-only numbered steps are not enough.
- Do not stack a second modal inside the onboarding modal. If the guide needs more room, replace the current dialog content with a single install-guide view inside the same root, or close the intro dialog before opening a dedicated install dialog.
- Prefer existing shadcn/Radix-inspired component patterns for any new dialog/drawer surface. Because this helper is vanilla ESM and lazily loaded, do not introduce a React mount or new dependency only for this flow.
- Preserve current helper actions: install guide, join plan, track progress, later, never show this prompt again.
- Preserve accessibility: dialog focus trap, Escape close, outside click close, focus return to trigger.
- Follow TDD: write failing tests, run them red, implement, run green.

---

## File Structure

- Modify: `js/modules/onboarding-helper.js`
  - Owns install platform detection, step copy, install prompt lifecycle, and rendering inside the existing helper dialog.
- Modify: `scripts/onboarding-helper.test.mjs`
  - Adds platform-model, UI, prompt lifecycle, and accessibility regression coverage.
- Modify: `index.css`
  - Adds compact step-list, platform badge, secondary links, and prompt-status styles for the existing install guide.
- No changes expected: `js/app.js`
  - It already captures `beforeinstallprompt` cheaply and lazy-loads the helper. Only touch if tests show the captured prompt no longer reaches `captureInstallPrompt()`.

## UX Component Strategy

- Default state: keep the existing onboarding helper as a short three-action dialog. Do not show installation details until the user taps the install action.
- Expanded state: the install action reveals a compact guide inside the same surface when there is enough room. Each row has a fixed icon cell and a text label, so users can compare the icon with Safari/Chrome controls.
- Mobile overflow state: if the guide makes the dialog too tall, switch the same surface into an install-guide view with a back button to return to the three-action intro. This is a replacement view, not a nested dialog.
- Dialog/drawer pattern: follow the existing shadcn/Radix-inspired `ResponsiveDialog` behavior visually: centered dialog on wider screens, bottom-sheet-like safe-area behavior on small mobile screens, outside click closes, Escape closes, focus remains trapped.
- Iconography: use lucide-style line icons rendered by a local helper in this vanilla module. Keep the icon list intentionally small: `share`, `add-square`, `check`, `more-vertical`, `download`, `app-window`.

---

### Task 1: Platform Install Model

**Files:**
- Modify: `js/modules/onboarding-helper.js`
- Modify: `scripts/onboarding-helper.test.mjs`

**Interfaces:**
- Produces: `getInstallPlatform({ userAgent?: string, standalone?: boolean, displayModeStandalone?: boolean, hasPrompt?: boolean }): "installed" | "ios" | "android-prompt" | "android-manual" | "desktop" | "generic"`
- Produces: `getInstallGuideModel(options?: object): { platform: string, title: string, body: string, primaryLabel: string, steps: { icon: string, label: string }[], links: { label: string, href: string }[], canPrompt: boolean, installed: boolean }`
- Consumes: existing `getInstallReferenceLinks()`, `deferredInstallPrompt`, `globalThis.navigator`, and `globalThis.matchMedia`.

- [ ] **Step 1: Write failing platform-model tests**

Add these imports in `scripts/onboarding-helper.test.mjs`:

```js
import {
  getInstallGuideModel,
  getInstallPlatform
} from "../js/modules/onboarding-helper.js";
```

Add this test block under `describe("release onboarding helper actions", () => {`:

```js
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
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: FAIL because `getInstallPlatform` and `getInstallGuideModel` are not exported.

- [ ] **Step 3: Implement the platform model**

In `js/modules/onboarding-helper.js`, replace the current `getInstallInstructions()` implementation area with:

```js
export function getInstallPlatform({
  userAgent = globalThis.navigator?.userAgent || "",
  standalone = globalThis.navigator?.standalone,
  displayModeStandalone = globalThis.matchMedia?.("(display-mode: standalone)")?.matches,
  hasPrompt = Boolean(deferredInstallPrompt?.prompt)
} = {}) {
  const ua = String(userAgent);
  if (standalone || displayModeStandalone) return "installed";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return hasPrompt ? "android-prompt" : "android-manual";
  if (hasPrompt) return "desktop";
  return "generic";
}

function getInstallGuideLinks(platform) {
  const links = getInstallReferenceLinks();
  if (platform === "ios") return links.filter((link) => link.label === "iPhone" || link.label === "iPad");
  if (platform === "android-manual" || platform === "android-prompt") return links.filter((link) => link.label === "Android");
  return links;
}

export function getInstallGuideModel(options = {}) {
  const platform = getInstallPlatform(options);
  const models = {
    installed: {
      platform,
      title: "已經加到主畫面",
      body: "你現在已經可以像 App 一樣快速打開。",
      primaryLabel: "已安裝",
      steps: [
        { icon: "app-window", label: "下次請從主畫面上的「新生命聖經速讀計畫」圖示開啟。" }
      ],
      canPrompt: false,
      installed: true
    },
    ios: {
      platform,
      title: "在 Safari 加到主畫面",
      body: "照著三個步驟，就能像 App 一樣每天快速打開。",
      primaryLabel: "查看 iPhone 安裝方式",
      steps: [
        { icon: "share", label: "點 Safari 下方的分享按鈕。" },
        { icon: "add-square", label: "選擇「加入主畫面」。" },
        { icon: "check", label: "點右上角「新增」。" }
      ],
      canPrompt: false,
      installed: false
    },
    "android-prompt": {
      platform,
      title: "安裝成 App",
      body: "你的瀏覽器支援直接安裝，點一下就會開啟安裝提示。",
      primaryLabel: "安裝 App",
      steps: [
        { icon: "download", label: "點「安裝 App」。" },
        { icon: "check", label: "在瀏覽器提示中選擇「安裝」。" },
        { icon: "app-window", label: "之後從主畫面圖示打開。" }
      ],
      canPrompt: true,
      installed: false
    },
    "android-manual": {
      platform,
      title: "從瀏覽器選單加入",
      body: "如果沒有跳出安裝提示，可以從瀏覽器選單手動加入。",
      primaryLabel: "查看 Android 安裝方式",
      steps: [
        { icon: "more-vertical", label: "點右上角「⋮」選單。" },
        { icon: "add-square", label: "選擇「加到主畫面」或「安裝應用程式」。" },
        { icon: "check", label: "點「新增」或「安裝」。" }
      ],
      canPrompt: false,
      installed: false
    },
    desktop: {
      platform,
      title: "安裝到電腦",
      body: "可從網址列或瀏覽器選單安裝，之後像桌面 App 一樣開啟。",
      primaryLabel: "安裝 App",
      steps: [
        { icon: "download", label: "點網址列右側的安裝圖示，或打開瀏覽器選單。" },
        { icon: "check", label: "選擇「安裝」。" },
        { icon: "app-window", label: "之後從 Dock、開始功能表或啟動台開啟。" }
      ],
      canPrompt: true,
      installed: false
    },
    generic: {
      platform,
      title: "加入主畫面",
      body: "不同瀏覽器的名稱略有不同，可以從選單找到加入或安裝選項。",
      primaryLabel: "查看安裝方式",
      steps: [
        { icon: "more-vertical", label: "打開瀏覽器選單。" },
        { icon: "add-square", label: "尋找「加入主畫面」、「安裝」或「新增到桌面」。" },
        { icon: "app-window", label: "完成後從主畫面圖示開啟。" }
      ],
      canPrompt: false,
      installed: false
    }
  };

  return {
    ...models[platform],
    links: getInstallGuideLinks(platform)
  };
}

export function getInstallInstructions(userAgent = globalThis.navigator?.userAgent || "", standalone = globalThis.navigator?.standalone) {
  return getInstallGuideModel({ userAgent, standalone }).steps.map((step) => step.label).join(" ");
}
```

- [ ] **Step 4: Run tests to verify green**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/modules/onboarding-helper.js scripts/onboarding-helper.test.mjs
git commit -m "feat(onboarding): model platform install guidance"
```

---

### Task 2: Adaptive Install Guide UI

**Files:**
- Modify: `js/modules/onboarding-helper.js`
- Modify: `scripts/onboarding-helper.test.mjs`

**Interfaces:**
- Consumes: `getInstallGuideModel(options?: object)`
- Produces: updated install guide markup with:
  - `[data-onboarding-install-guide-title]`
  - `[data-onboarding-install-guide-body]`
  - `[data-onboarding-install-guide-steps]`
  - `[data-onboarding-install-guide-step-icon]`
  - `[data-onboarding-install-guide-step-label]`
  - `[data-onboarding-install-guide-links]`
  - `[data-onboarding-platform]`
- Produces: a single-surface guide expansion. The implementation may use inline progressive disclosure on desktop/tablet and a full-width replacement panel on narrow mobile, but must not render one modal/dialog inside another.

- [ ] **Step 1: Write failing UI tests**

In `scripts/onboarding-helper.test.mjs`, replace the current test named `"opens a visible install guide when browser install prompt is unavailable"` with:

```js
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
```

Add another test:

```js
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
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: FAIL because `openOnboardingHelper()` ignores `installGuideOptions`, guide title/body/steps nodes do not exist, and all links are still rendered for every platform.

- [ ] **Step 3: Update guide markup**

In `renderActionRows()`, replace the install guide block with:

```js
          <div class="release-onboarding-install-guide" data-onboarding-install-guide tabindex="-1" aria-live="polite" hidden>
            <div class="release-onboarding-install-guide__heading">
              <span class="release-onboarding-install-guide__badge" data-onboarding-install-guide-badge>安裝</span>
              <strong data-onboarding-install-guide-title>安裝方式</strong>
            </div>
            <p data-onboarding-install-guide-body></p>
            <ol class="release-onboarding-install-guide__steps" data-onboarding-install-guide-steps></ol>
            <div class="release-onboarding-install-guide__support">
              <span>詳細說明</span>
              <div class="release-onboarding-install-guide__links" data-onboarding-install-guide-links aria-label="安裝參考連結"></div>
            </div>
          </div>
```

- [ ] **Step 4: Update open helper signature**

Change:

```js
export function openOnboardingHelper({ startStep = "install", trigger = null, storage = globalThis.localStorage, config = globalThis.APP_CONFIG || {} } = {}) {
```

to:

```js
export function openOnboardingHelper({
  startStep = "install",
  trigger = null,
  storage = globalThis.localStorage,
  config = globalThis.APP_CONFIG || {},
  installGuideOptions = {}
} = {}) {
```

- [ ] **Step 5: Update action handler wiring**

Inside the existing button click listener, replace:

```js
runPrimaryAction(button.dataset.onboardingAction).catch((error) => console.warn("Onboarding action failed:", error));
```

with:

```js
runPrimaryAction(button.dataset.onboardingAction, { installGuideOptions }).catch((error) => console.warn("Onboarding action failed:", error));
```

- [ ] **Step 6: Update `runPrimaryAction` and `showInstallGuide`**

Replace:

```js
function showInstallGuide() {
```

with:

```js
function showInstallGuide(options = {}) {
```

Replace the body of `showInstallGuide()` with:

```js
  const guide = document.querySelector("[data-onboarding-install-guide]");
  const title = document.querySelector("[data-onboarding-install-guide-title]");
  const body = document.querySelector("[data-onboarding-install-guide-body]");
  const badge = document.querySelector("[data-onboarding-install-guide-badge]");
  const steps = document.querySelector("[data-onboarding-install-guide-steps]");
  const links = document.querySelector("[data-onboarding-install-guide-links]");
  if (!guide || !title || !body || !badge || !steps || !links) return;

  const model = getInstallGuideModel(options);
  guide.dataset.onboardingPlatform = model.platform;
  badge.textContent = model.installed ? "完成" : "安裝";
  title.textContent = model.title;
  body.textContent = model.body;
  steps.innerHTML = model.steps
    .map((step) => `
      <li>
        <span class="release-onboarding-install-guide__step-icon" data-onboarding-install-guide-step-icon data-install-step-icon="${step.icon}" aria-hidden="true">
          ${renderInstallStepIcon(step.icon)}
        </span>
        <span data-onboarding-install-guide-step-label>${step.label}</span>
      </li>
    `)
    .join("");
  links.innerHTML = model.links
    .map(({ label, href }) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .join("");
  guide.hidden = false;
  guide.focus?.();
```

Change:

```js
async function runPrimaryAction(stepId) {
```

to:

```js
async function runPrimaryAction(stepId, { installGuideOptions = {} } = {}) {
```

Change both `showInstallGuide();` calls in the install action to:

```js
showInstallGuide(installGuideOptions);
```

- [ ] **Step 7: Add minimal install-step icons**

Add this helper near `showInstallGuide()`:

```js
const INSTALL_STEP_ICON_PATHS = {
  share: '<path d="M12 3v10"/><path d="m8 7 4-4 4 4"/><path d="M5 11v8h14v-8"/>',
  "add-square": '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "more-vertical": '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  "app-window": '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M8 9h8"/><path d="M8 13h5"/>'
};

function renderInstallStepIcon(icon) {
  const path = INSTALL_STEP_ICON_PATHS[icon] || INSTALL_STEP_ICON_PATHS["app-window"];
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${path}</svg>`;
}
```

These are lucide-style line icons sized by CSS. Do not import `lucide-react` into this helper because the current onboarding module is browser ESM, not a React component tree.

- [ ] **Step 8: Run tests to verify green**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add js/modules/onboarding-helper.js scripts/onboarding-helper.test.mjs
git commit -m "feat(onboarding): show adaptive install steps"
```

---

### Task 3: Android Native Prompt Lifecycle

**Files:**
- Modify: `js/modules/onboarding-helper.js`
- Modify: `scripts/onboarding-helper.test.mjs`

**Interfaces:**
- Consumes: `deferredInstallPrompt`, `captureInstallPrompt(event)`
- Produces: `getInstallPromptState(): "unavailable" | "available" | "accepted" | "dismissed" | "failed"`
- Produces: visible status node `[data-onboarding-install-status]`

- [ ] **Step 1: Write failing prompt lifecycle tests**

Add this import:

```js
  getInstallPromptState,
```

Add tests under `describe("release onboarding helper actions", () => {`:

```js
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
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: FAIL because `getInstallPromptState` and status node do not exist, and the code does not await `userChoice`.

- [ ] **Step 3: Implement prompt state**

Near `let deferredInstallPrompt = null;`, add:

```js
let installPromptState = "unavailable";
```

Change `captureInstallPrompt(event)` to:

```js
export function captureInstallPrompt(event) {
  event?.preventDefault?.();
  deferredInstallPrompt = event;
  installPromptState = event?.prompt ? "available" : "unavailable";
}

export function getInstallPromptState() {
  return installPromptState;
}
```

- [ ] **Step 4: Add status markup**

In the install guide block from Task 2, insert after the body paragraph:

```js
            <p class="release-onboarding-install-guide__status" data-onboarding-install-status hidden></p>
```

- [ ] **Step 5: Add status helper**

Add this function near `showInstallGuide()`:

```js
function setInstallStatus(message) {
  const status = document.querySelector("[data-onboarding-install-status]");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}
```

- [ ] **Step 6: Update native prompt branch**

Inside `runPrimaryAction()`, replace the native prompt block with:

```js
    if (deferredInstallPrompt?.prompt) {
      try {
        setInstallStatus("正在開啟安裝提示…");
        const promptEvent = deferredInstallPrompt;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice?.catch(() => null);
        const outcome = choice?.outcome;
        installPromptState = outcome === "accepted" ? "accepted" : "dismissed";
        deferredInstallPrompt = null;

        if (installPromptState === "dismissed") {
          showInstallGuide({
            ...installGuideOptions,
            hasPrompt: false
          });
          setInstallStatus("也可以手動加入主畫面。");
        }
      } catch (error) {
        installPromptState = "failed";
        deferredInstallPrompt = null;
        console.warn("Browser install prompt failed:", error);
        showInstallGuide({
          ...installGuideOptions,
          hasPrompt: false
        });
        setInstallStatus("安裝提示沒有開啟，請改用手動方式。");
      }
      return;
    }
```

- [ ] **Step 7: Run tests to verify green**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/modules/onboarding-helper.js scripts/onboarding-helper.test.mjs
git commit -m "feat(onboarding): handle native install prompt outcomes"
```

---

### Task 4: Visual Polish, Copy Guardrails, and Production Verification

**Files:**
- Modify: `index.css`
- Modify: `scripts/onboarding-helper.test.mjs`

**Interfaces:**
- Consumes: markup classes from Task 2 and Task 3:
  - `.release-onboarding-install-guide__heading`
  - `.release-onboarding-install-guide__badge`
  - `.release-onboarding-install-guide__steps`
  - `.release-onboarding-install-guide__step-icon`
  - `.release-onboarding-install-guide__support`
  - `.release-onboarding-install-guide__status`

- [ ] **Step 1: Write failing CSS/copy tests**

Add tests under `describe("release onboarding accessibility behavior", () => {`:

```js
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
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs
```

Expected: FAIL because the new CSS selectors are not defined.

- [ ] **Step 3: Add compact guide styles**

In `index.css`, near the existing `.release-onboarding-install-guide` rules, add:

```css
.release-onboarding-install-guide__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.release-onboarding-install-guide__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.2rem;
  min-height: 1.35rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: 0.72rem;
  font-weight: var(--type-weight-strong);
}

.release-onboarding-install-guide__status {
  margin: 0.55rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.45;
}

.release-onboarding-install-guide__status[hidden] {
  display: none;
}

.release-onboarding-install-guide__steps {
  display: grid;
  gap: 0.55rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.release-onboarding-install-guide__steps li {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  color: var(--text-primary);
  font-size: 0.86rem;
  line-height: 1.45;
}

.release-onboarding-install-guide__step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--primary-color) 14%, var(--bg-card));
  color: var(--primary-color);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.release-onboarding-install-guide__step-icon svg {
  width: 1.05rem;
  height: 1.05rem;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.release-onboarding-install-guide__support {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.6rem;
  margin-top: 0.75rem;
  color: var(--text-muted);
  font-size: 0.78rem;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest --run scripts/onboarding-helper.test.mjs scripts/app-version-config.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected:
- `npm test`: all Vitest files pass.
- `npm run build`: emits a hashed `dist/app.<hash>.js` and copies `dist/modules/onboarding-helper.js`.

- [ ] **Step 6: Manual browser smoke test**

Serve locally:

```bash
npm run dev
```

Expected: local server URL appears, usually `http://localhost:3000` or the next available port.

Manual checks:
- Open app on desktop browser.
- Run in console:

```js
window.openOnboardingHelper({ manual: true, installGuideOptions: { userAgent: "Mozilla/5.0 iPhone Safari", standalone: false, hasPrompt: false } })
```

Expected:
- Dialog opens.
- Click `查看 iPhone 安裝方式`.
- Inline guide expands with iOS steps.
- Outside click closes the dialog.

Run in console:

```js
window.openOnboardingHelper({ manual: true, installGuideOptions: { userAgent: "Mozilla/5.0 Linux; Android 15 Chrome/140 Mobile Safari", hasPrompt: false } })
```

Expected:
- Click install action.
- Inline guide expands with Android manual steps.
- Only Android support link appears.

- [ ] **Step 7: Commit**

```bash
git add index.css scripts/onboarding-helper.test.mjs
git commit -m "style(onboarding): polish install guidance"
```

---

## Self-Review

**Spec coverage:**  
- Android native prompt: Task 3.  
- iOS manual steps: Task 1 and Task 2.  
- Unsupported/manual browser fallback: Task 1 and Task 2.  
- Keep helper lightweight: Task 2 progressive disclosure and Task 4 CSS.  
- Preserve lazy loading: Global constraints and Task 4 build verification.  
- Prevent jargon: Task 4 copy guardrail.

**Placeholder scan:**  
No `TBD`, `TODO`, “add appropriate,” or “similar to” placeholders remain.

**Type consistency:**  
`getInstallPlatform`, `getInstallGuideModel`, `getInstallPromptState`, `installGuideOptions`, and DOM data attributes are defined before use and named consistently across tasks.

**Sources used for design decisions:**  
- web.dev recommends install promotion be dismissible, non-disruptive, and only shown after `beforeinstallprompt` fires: https://web.dev/articles/promote-install  
- web.dev documents iOS/iPadOS manual Share-menu installation and Chromium prompt behavior: https://web.dev/learn/pwa/installation  
- MDN confirms `beforeinstallprompt` is not supported on iOS and install support varies by browser/platform: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable  
- MDN PWA best practices recommend adapting to browsers/devices and preserving streamlined app-like UX: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Best_practices
