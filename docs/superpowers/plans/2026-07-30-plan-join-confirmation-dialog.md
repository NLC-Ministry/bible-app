# Plan Join Confirmation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent accidental plan enrollment or team creation by making plan cards exploratory first and requiring a warm, explicit confirmation dialog before mutating membership.

**Architecture:** Keep the static vanilla JavaScript architecture. Add a small shadcn Dialog-inspired modal layer in `js/modules/plan.js` for confirmation, reuse the existing team registration modal for the 3-person and 6-person team choices, and avoid adding React or shadcn runtime dependencies to `bible-app`.

**Tech Stack:** ESM JavaScript, static DOM rendering, Vitest, existing CSS design tokens, shadcn Dialog as UX/structure reference only.

## Global Constraints

- PR #15 is merged into `origin/main`; start implementation from current `origin/main`.
- The next PR for this work is currently expected to be PR #16, unless another PR is opened first.
- Do not add React, Radix, or shadcn runtime dependencies to `bible-app`.
- Use shadcn Dialog principles: modal overlay, inert-feeling background, title, description, clear footer actions, backdrop close, escape close, focus on the safest action.
- Do not use pill-shaped buttons or glossy/3D button styling.
- Tapping a plan card or non-mutating button must only open plan details.
- `自己加入` and `建立團隊` must not directly mutate membership.
- Users must be able to participate solo, in a 3-person team, and in a 6-person team; these options are non-contradicting.
- UX copy must be warm, simple, and non-technical.
- Bump `index.html` cache keys for changed JS/CSS assets and update cache-key tests.

---

## File Structure

- Modify `js/modules/plan.js`
  - Owns preset plan card actions, solo join flow, team entry flow, and the new plan confirmation dialog.
- Modify `js/modules/team-registration.js`
  - Only if needed to accept a cleaner post-confirmation entry option; otherwise keep #15 modal behavior intact.
- Modify `css/team-registration.css`
  - Reuse existing modal styling where possible; add a compact shadcn-like confirmation dialog variant only if current styles cannot represent it cleanly.
- Modify `index.html`
  - Bump JS/CSS cache keys after code or style changes.
- Modify `scripts/reading-team-registration.test.mjs`
  - Add source-level regression tests for confirmation and non-direct mutation.
- Modify `scripts/admin-team-registration-overview.test.mjs`
  - Update cache-key assertions when `index.html` changes.
- Modify `scripts/tab-navigation-lifecycle.test.mjs`
  - Update `js/app.js` cache-key assertion.
- Optional create `scripts/plan-join-confirmation-dialog.test.mjs`
  - Use only if the new tests become too large for `reading-team-registration.test.mjs`.

---

### Task 1: Guard Plan Card Mutations Behind Confirmation

**Files:**
- Modify: `js/modules/plan.js`
- Test: `scripts/reading-team-registration.test.mjs`

**Interfaces:**
- Consumes: existing `joinPlanSoloFromCard(plan, key)`, `createTeamFromPlanCard(plan, key)`, `openPlanDetailsDialog(plan, options)`, `window.openReadingTeamDialog(plan, options)`
- Produces: `confirmPlanJoin({ plan, mode, onConfirm }) => Promise<boolean>` and updated card action handlers

- [ ] **Step 1: Write the failing test**

Add this test near the existing `models plan cards around solo and team participation actions` test in `scripts/reading-team-registration.test.mjs`:

```js
it("requires a confirmation dialog before preset plan solo join or team setup", () => {
  expect(plan).toContain("async function confirmPlanJoin");
  expect(plan).toContain('role="dialog"');
  expect(plan).toContain('aria-modal="true"');
  expect(plan).toContain('id="plan-join-confirmation-title"');
  expect(plan).toContain("要加入這個讀經計畫嗎？");
  expect(plan).toContain("太好了，開始吧");
  expect(plan).toContain("我再看看");

  const soloHandler = plan.slice(
    plan.indexOf("card.querySelector('[data-plan-card-action=\"solo-join\"]')"),
    plan.indexOf("card.querySelector('[data-plan-card-action=\"team-create\"]')")
  );
  expect(soloHandler).toContain("confirmPlanJoin");
  expect(soloHandler.indexOf("confirmPlanJoin")).toBeLessThan(soloHandler.indexOf("joinPlanSoloFromCard"));

  const teamHandler = plan.slice(
    plan.indexOf("card.querySelector('[data-plan-card-action=\"team-create\"]')"),
    plan.indexOf("container.appendChild(card)")
  );
  expect(teamHandler).toContain("confirmPlanJoin");
  expect(teamHandler.indexOf("confirmPlanJoin")).toBeLessThan(teamHandler.indexOf("createTeamFromPlanCard"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: FAIL because `confirmPlanJoin` and the confirmation copy do not exist.

- [ ] **Step 3: Implement the confirmation helper**

In `js/modules/plan.js`, add this helper near the existing preset plan card helpers:

```js
function confirmPlanJoin({ plan, mode, onConfirm }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay plan-join-confirmation-overlay";
    overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:var(--z-modal,700);";

    const title = mode === "team" ? "要和夥伴一起開始嗎？" : "要加入這個讀經計畫嗎？";
    const description = mode === "team"
      ? "你可以先選擇 3 人或 6 人團隊；建立後再把邀請碼分享給朋友。"
      : "加入後就能在首頁看到今天進度，也可以之後再加入團隊。";
    const confirmLabel = mode === "team" ? "選擇團隊人數" : "太好了，開始吧";

    overlay.innerHTML = `
      <section class="plan-join-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-join-confirmation-title" aria-describedby="plan-join-confirmation-description" tabindex="-1">
        <header class="plan-join-confirmation-dialog__header">
          <p class="plan-join-confirmation-dialog__eyebrow">${escapeHTML(plan.name || "讀經計畫")}</p>
          <h3 id="plan-join-confirmation-title">${title}</h3>
          <p id="plan-join-confirmation-description">${description}</p>
        </header>
        <footer class="plan-join-confirmation-dialog__footer">
          <button type="button" class="secondary-btn plan-join-confirmation-dialog__cancel" data-plan-confirm-cancel>我再看看</button>
          <button type="button" class="primary-btn plan-join-confirmation-dialog__confirm" data-plan-confirm-action>${confirmLabel}</button>
        </footer>
      </section>`;

    const panel = overlay.firstElementChild;
    const close = value => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === "Escape") close(false);
    };

    overlay.addEventListener("click", event => {
      if (event.target === overlay) close(false);
    });
    overlay.querySelector("[data-plan-confirm-cancel]").addEventListener("click", () => close(false));
    overlay.querySelector("[data-plan-confirm-action]").addEventListener("click", async () => {
      const button = overlay.querySelector("[data-plan-confirm-action]");
      button.disabled = true;
      await onConfirm();
      close(true);
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    if (typeof hydrateIcons === "function") hydrateIcons(overlay);
    panel.focus();
  });
}
```

- [ ] **Step 4: Route card actions through the helper**

Replace the two preset plan button handlers in `js/modules/plan.js`:

```js
card.querySelector('[data-plan-card-action="solo-join"]')?.addEventListener("click", async event => {
  event.preventDefault();
  event.stopPropagation();
  await confirmPlanJoin({
    plan,
    mode: "solo",
    onConfirm: async () => {
      await joinPlanSoloFromCard(plan, key);
    }
  });
});
card.querySelector('[data-plan-card-action="team-create"]')?.addEventListener("click", async event => {
  event.preventDefault();
  event.stopPropagation();
  await confirmPlanJoin({
    plan,
    mode: "team",
    onConfirm: async () => {
      await createTeamFromPlanCard(plan, key);
    }
  });
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/modules/plan.js scripts/reading-team-registration.test.mjs
git commit -m "fix(plan): confirm before joining plans"
```

---

### Task 2: Style The Dialog As A Compact Shadcn-Like Surface

**Files:**
- Modify: `css/team-registration.css`
- Test: `scripts/reading-team-registration.test.mjs`

**Interfaces:**
- Consumes: `.plan-join-confirmation-overlay`, `.plan-join-confirmation-dialog`, `.plan-join-confirmation-dialog__header`, `.plan-join-confirmation-dialog__footer`
- Produces: responsive modal styling that matches existing app tokens and avoids pill/glossy buttons

- [ ] **Step 1: Write the failing test**

Add this test near the modal styling tests:

```js
it("styles plan join confirmation as a compact non-pill dialog", () => {
  expect(teamCss).toContain(".plan-join-confirmation-overlay");
  expect(teamCss).toContain(".plan-join-confirmation-dialog");
  expect(teamCss).toContain("border-radius: 12px");
  expect(teamCss).toContain(".plan-join-confirmation-dialog__footer");
  expect(teamCss).toContain("@media (max-width: 640px)");
  expect(teamCss).not.toMatch(/\\.plan-join-confirmation-dialog__[^{]+\\{[^}]*border-radius:\\s*999/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: FAIL because the new classes are not styled.

- [ ] **Step 3: Add CSS**

Append this block near the existing dialog CSS in `css/team-registration.css`:

```css
.plan-join-confirmation-overlay {
  padding: 1rem;
  background: rgb(15 23 42 / 0.42);
}

.plan-join-confirmation-dialog {
  width: min(100%, 420px);
  max-height: min(80dvh, 520px);
  overflow: auto;
  border: 1px solid var(--border-card);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 20px 44px rgb(15 23 42 / 0.18);
  padding: 1rem;
}

.plan-join-confirmation-dialog__header {
  display: grid;
  gap: 0.45rem;
}

.plan-join-confirmation-dialog__eyebrow {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.plan-join-confirmation-dialog h3 {
  margin: 0;
  font-size: 1.1rem;
  line-height: 1.35;
}

.plan-join-confirmation-dialog p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.92rem;
  line-height: 1.55;
}

.plan-join-confirmation-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}

.plan-join-confirmation-dialog__footer button {
  min-height: 44px;
  border-radius: 10px;
}

@media (max-width: 640px) {
  .plan-join-confirmation-overlay {
    align-items: flex-end !important;
    padding: 0.75rem;
  }

  .plan-join-confirmation-dialog {
    width: 100%;
    max-height: 72dvh;
  }

  .plan-join-confirmation-dialog__footer {
    flex-direction: column-reverse;
  }

  .plan-join-confirmation-dialog__footer button {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add css/team-registration.css scripts/reading-team-registration.test.mjs
git commit -m "style(plan): add compact join confirmation dialog"
```

---

### Task 3: Keep Team Exploration Non-Mutating

**Files:**
- Modify: `js/modules/plan.js`
- Test: `scripts/reading-team-registration.test.mjs`

**Interfaces:**
- Consumes: existing `createTeamFromPlanCard(plan, key)` and `window.openReadingTeamDialog(plan, options)`
- Produces: `建立團隊` opens the existing 3/6 chooser without joining the plan first; `db.createReadingTeam(...)` remains the first team-flow mutation

- [ ] **Step 1: Write the failing test**

Add this test after the confirmation test:

```js
it("opens team setup from preset cards without joining the plan first", () => {
  const createTeamFlow = plan.slice(
    plan.indexOf("async function createTeamFromPlanCard"),
    plan.indexOf("function renderPresetPlans")
  );
  expect(createTeamFlow).not.toContain("joinPlanSoloFromCard");
  expect(createTeamFlow).not.toContain("await db.joinPresetPlan");
  expect(createTeamFlow).toContain("openReadingTeamDialog(plan");
  expect(createTeamFlow).not.toContain("preferredDivision: 3");

  const teamDialog = teamUi.slice(
    teamUi.indexOf("const renderEmpty = (joinedContexts"),
    teamUi.indexOf("const renderTeam = (context")
  );
  expect(teamDialog).toContain("availableDivisions = [3, 6]");
  expect(teamDialog).toContain("data-division-choice");
  expect(teamDialog).toContain("db.createReadingTeam(plan, preferredDivision");
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: FAIL because `createTeamFromPlanCard` currently calls `joinPlanSoloFromCard` before opening the team dialog.

- [ ] **Step 3: Update team setup entry**

In `js/modules/plan.js`, leave `joinPlanSoloFromCard(plan, key)` as the solo-only enrollment path. Update `createTeamFromPlanCard` so it opens the team setup modal directly without joining the plan:

```js
async function createTeamFromPlanCard(plan, key) {
  if (typeof window.openReadingTeamDialog === "function") {
    await window.openReadingTeamDialog(plan);
  }
  return null;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/modules/plan.js scripts/reading-team-registration.test.mjs
git commit -m "fix(team): choose team size after confirmed join"
```

---

### Task 4: Bump Cache Keys And Guard The Release Asset Version

**Files:**
- Modify: `index.html`
- Modify: `scripts/admin-team-registration-overview.test.mjs`
- Modify: `scripts/tab-navigation-lifecycle.test.mjs`

**Interfaces:**
- Consumes: changed `js/app.js` bundle source and changed `css/team-registration.css`
- Produces: browser cache busting for the next production deployment

- [ ] **Step 1: Write/update failing cache assertions**

In both cache-key tests, use this exact suffix:

```js
const expectedAppCacheKey = "js/app.js?v=20260730_plan_join_confirmation";
const expectedTeamCssCacheKey = "css/team-registration.css?v=20260730_plan_join_confirmation";
```

Apply the app key where `scripts/tab-navigation-lifecycle.test.mjs` checks `js/app.js?v=...`.

Apply the team CSS key where `scripts/admin-team-registration-overview.test.mjs` checks `css/team-registration.css?v=...`.

- [ ] **Step 2: Run tests to verify they fail before HTML update**

Run:

```bash
npx vitest --run scripts/admin-team-registration-overview.test.mjs scripts/tab-navigation-lifecycle.test.mjs
```

Expected: FAIL because `index.html` still references the prior cache keys.

- [ ] **Step 3: Update `index.html` asset keys**

Replace the current `js/app.js?v=...` and `css/team-registration.css?v=...` values with:

```html
js/app.js?v=20260730_plan_join_confirmation
css/team-registration.css?v=20260730_plan_join_confirmation
```

- [ ] **Step 4: Run cache tests**

Run:

```bash
npx vitest --run scripts/admin-team-registration-overview.test.mjs scripts/tab-navigation-lifecycle.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/admin-team-registration-overview.test.mjs scripts/tab-navigation-lifecycle.test.mjs
git commit -m "chore: bump plan join confirmation assets"
```

---

### Task 5: Full Verification And PR

**Files:**
- No new source files unless previous tasks created the optional test file.

**Interfaces:**
- Consumes: all prior task commits
- Produces: pushed branch and PR after passing tests/build

- [ ] **Step 1: Verify branch base**

Run:

```bash
git fetch origin main
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected:
- Current branch is not `main`.
- Worktree is clean before final verification.
- Commits shown are only this feature's commits.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest --run scripts/reading-team-registration.test.mjs scripts/admin-team-registration-overview.test.mjs scripts/tab-navigation-lifecycle.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Push branch**

Run:

```bash
git push -u origin agent/plan-join-confirmation-dialog
```

Expected: branch pushed.

- [ ] **Step 7: Open the next PR**

Run:

```bash
gh pr create --repo NLC-Ministry/bible-app --base main --head agent/plan-join-confirmation-dialog --title "Confirm before joining reading plans" --body "## Summary
- Adds a compact confirmation dialog before solo plan joins or team setup
- Keeps plan cards exploratory and prevents accidental membership changes
- Preserves 3-person and 6-person team options inside the team setup modal

## Verification
- npx vitest --run scripts/reading-team-registration.test.mjs scripts/admin-team-registration-overview.test.mjs scripts/tab-navigation-lifecycle.test.mjs
- npm test
- npm run build
- git diff --check"
```

Expected:
- The PR should be the next new PR after merged #15; currently expected as #16 unless another PR is opened first.

---

## Self-Review

- Spec coverage: The plan covers explicit confirmation before mutating actions, safe exploration, preservation of 3-person and 6-person teams, shadcn Dialog principles without adding React, cache busting, testing, build, and PR creation.
- Placeholder scan: No placeholder tasks are left; all tasks have concrete files, snippets, commands, and expected results.
- Type consistency: `confirmPlanJoin`, `joinPlanSoloFromCard(plan, key, options)`, and `createTeamFromPlanCard(plan, key)` are consistently named across tasks.
