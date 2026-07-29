# Plan Card Participation Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign joined plan cards so the plan uses a compact shadcn-inspired Card structure and participation/team state is rendered as one cohesive Item-style component with clear variants.

**Architecture:** Keep the existing vanilla ESM renderer in `js/modules/plan.js`. Add a pure `renderPlanParticipationItem(...)` helper that owns all participation/team variants, and let `renderJoinedPlansList()` provide a single `.plan-card-participation-slot` instead of separate state badges and buttons. CSS in `index.css` should mirror shadcn Card/Item composition: Card shell, Card header/content/footer, and one compact Item row for status + description + action.

**Tech Stack:** Vanilla ESM JavaScript, existing `hydrateIcons` Lucide icon pipeline, `index.css`, Vitest string/behavior tests.

## Global Constraints

- Do not add React or shadcn runtime dependencies; use shadcn Card and Item as design references only.
- Do not use pill-shaped buttons or glossy/3D button states.
- Keep cards compact on mobile: no scattered badge islands, no nested cards, no duplicated team actions.
- Preserve current behavior: clicking the card opens plan progress; clicking participation actions must stop propagation.
- Preserve variants for solo reading, current team membership, full team, open team, and another division available.
- Joined plans remain sorted chronologically by `startDate`.
- Use test-driven development: write failing tests before production changes.

---

## File Structure

- Modify `js/modules/plan.js`
  - Add pure helpers:
    - `getPlanParticipationModel(plan, contexts = [])`
    - `renderPlanParticipationItem(model)`
    - `bindPlanParticipationItemActions(card, plan, model)`
  - Replace the existing ad hoc `.plan-card-participation-state`, `.plan-card-team-controls__badge`, and `.plan-card-team-controls__button` assembly inside `renderJoinedPlansList()`.
  - Keep `openJoinedPlanProgress(plan)` and `openJoinedPlanTeam(plan)` as existing behavior boundaries.
- Modify `index.css`
  - Keep existing `.plan-card` class names but align their roles with Card composition.
  - Add `.plan-card-participation-item` and children for Item composition.
  - Retire visual reliance on `.plan-card-team-controls__badge` / `.plan-card-team-controls__button` in joined cards.
- Modify `scripts/plan-card-information-architecture.test.mjs`
  - Add architecture tests for Card + Item composition.
  - Add tests that joined cards no longer contain scattered team badge/button fragments.
- Modify `scripts/reading-team-registration.test.mjs`
  - Update older expectations around `updateJoinedPlanTeamAction` and team controls.
  - Add coverage for full 3-person team + available 6-person action.

---

### Task 1: Model Participation State As One Data Contract

**Files:**
- Modify: `js/modules/plan.js`
- Test: `scripts/plan-card-information-architecture.test.mjs`

**Interfaces:**
- Consumes: `plan`, `contexts`, existing `window.isReadingTeamPlan(plan)`.
- Produces:
  - `getPlanParticipationModel(plan, contexts = [])`
  - Return shape:
    ```js
    {
      variant: "solo" | "team-open" | "team-full" | "team-missing" | "team-with-other-division-available",
      title: string,
      description: string,
      tone: "neutral" | "brand" | "success" | "warning",
      icon: string,
      action: null | { label: string, division: 3 | 6, action: "join-team-division" | "open-team" }
    }
    ```

- [ ] **Step 1: Write the failing architecture test**

Add to `scripts/plan-card-information-architecture.test.mjs`:

```js
it("models joined-plan participation as one item contract", () => {
  expect(plan).toContain("function getPlanParticipationModel");
  expect(plan).toContain('variant: "team-with-other-division-available"');
  expect(plan).toContain('variant: "team-full"');
  expect(plan).toContain('variant: "team-open"');
  expect(plan).toContain('variant: "solo"');
  expect(plan).toContain('action: "join-team-division"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: FAIL because `getPlanParticipationModel` does not exist yet.

- [ ] **Step 3: Add the model helper before `renderJoinedPlansList()`**

Add this near `sortJoinedPlansChronologically(...)` in `js/modules/plan.js`:

```js
function getPlanParticipationModel(plan, contexts = []) {
  const normalizedContexts = Array.isArray(contexts) ? contexts.filter(Boolean) : [];
  const divisions = [3, 6];
  const joinedContexts = normalizedContexts.filter(context => context && context.team);
  const joinedContext = joinedContexts[0] || null;
  const joinedDivision = joinedContext ? Number(joinedContext.team.division) : null;
  const availableDivision = divisions.find(division => division !== joinedDivision);

  if (!joinedContext) {
    return {
      variant: "solo",
      title: "個人讀經中",
      description: "尚未加入團隊",
      tone: "neutral",
      icon: "user",
      action: {
        label: "建立 / 加入團隊",
        division: 3,
        action: "join-team-division"
      }
    };
  }

  const team = joinedContext.team || {};
  const division = Number(team.division || joinedDivision || 3);
  const memberCount = Number(team.memberCount || team.current_count || joinedContext.memberCount || 0);
  const capacity = Number(team.capacity || team.division || division);
  const isFull = capacity > 0 && memberCount >= capacity;
  const teamName = String(team.name || "團隊").trim() || "團隊";
  const description = `${division}人組・${teamName}・${memberCount}/${capacity}`;

  if (availableDivision) {
    return {
      variant: "team-with-other-division-available",
      title: "團隊讀經中",
      description,
      tone: isFull ? "success" : "brand",
      icon: "users",
      action: {
        label: `報名 ${availableDivision}人組`,
        division: availableDivision,
        action: "join-team-division"
      }
    };
  }

  return {
    variant: isFull ? "team-full" : "team-open",
    title: "團隊讀經中",
    description,
    tone: isFull ? "success" : "brand",
    icon: "users",
    action: {
      label: "查看團隊",
      division,
      action: "open-team"
    }
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/modules/plan.js scripts/plan-card-information-architecture.test.mjs
git commit -m "feat(plan): model plan participation item state"
```

---

### Task 2: Render Participation As A Compact Item

**Files:**
- Modify: `js/modules/plan.js`
- Test: `scripts/plan-card-information-architecture.test.mjs`

**Interfaces:**
- Consumes: `getPlanParticipationModel(plan, contexts)`.
- Produces:
  - `renderPlanParticipationItem(model)`
  - HTML root: `.plan-card-participation-item`
  - Child roles:
    - `.plan-card-participation-item__media`
    - `.plan-card-participation-item__content`
    - `.plan-card-participation-item__title`
    - `.plan-card-participation-item__description`
    - `.plan-card-participation-item__actions`

- [ ] **Step 1: Write the failing renderer test**

Add to `scripts/plan-card-information-architecture.test.mjs`:

```js
it("renders participation status with shadcn item-style parts", () => {
  expect(plan).toContain("function renderPlanParticipationItem");
  expect(plan).toContain("plan-card-participation-item__media");
  expect(plan).toContain("plan-card-participation-item__content");
  expect(plan).toContain("plan-card-participation-item__title");
  expect(plan).toContain("plan-card-participation-item__description");
  expect(plan).toContain("plan-card-participation-item__actions");
  expect(plan).toContain('data-plan-participation-action="${escapeHTML(model.action.action)}"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: FAIL because `renderPlanParticipationItem` does not exist.

- [ ] **Step 3: Add the renderer**

Add after `getPlanParticipationModel(...)`:

```js
function renderPlanParticipationItem(model) {
  if (!model) return "";
  const actionHtml = model.action ? `
    <button
      type="button"
      class="plan-card-participation-item__button"
      data-plan-participation-action="${escapeHTML(model.action.action)}"
      data-plan-participation-division="${escapeHTML(String(model.action.division || ""))}"
    >
      ${escapeHTML(model.action.label)}
    </button>
  ` : "";

  return `
    <div class="plan-card-participation-item plan-card-participation-item--${escapeHTML(model.variant)} plan-card-participation-item--${escapeHTML(model.tone)}">
      <div class="plan-card-participation-item__media" aria-hidden="true">
        <span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(model.icon)}"></span>
      </div>
      <div class="plan-card-participation-item__content">
        <div class="plan-card-participation-item__title">${escapeHTML(model.title)}</div>
        <div class="plan-card-participation-item__description">${escapeHTML(model.description)}</div>
      </div>
      ${actionHtml ? `<div class="plan-card-participation-item__actions">${actionHtml}</div>` : ""}
    </div>
  `;
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/modules/plan.js scripts/plan-card-information-architecture.test.mjs
git commit -m "feat(plan): render compact participation item"
```

---

### Task 3: Replace Scattered Team Controls In Joined Cards

**Files:**
- Modify: `js/modules/plan.js`
- Test: `scripts/reading-team-registration.test.mjs`
- Test: `scripts/plan-card-information-architecture.test.mjs`

**Interfaces:**
- Consumes: `getPlanParticipationModel(plan, contexts)`, `renderPlanParticipationItem(model)`.
- Produces: `bindPlanParticipationItemActions(card, plan, model)`.

- [ ] **Step 1: Write failing tests for removing fragments**

Update `scripts/plan-card-information-architecture.test.mjs`:

```js
it("does not render joined-card participation as scattered badge fragments", () => {
  const joinedList = plan.slice(
    plan.indexOf("function renderJoinedPlansList"),
    plan.indexOf("function formatCampaignReadingRange")
  );

  expect(joinedList).toContain("renderPlanParticipationItem(participationModel)");
  expect(joinedList).toContain("bindPlanParticipationItemActions(card, plan, participationModel)");
  expect(joinedList).not.toContain("document.createElement(\"div\")");
  expect(joinedList).not.toContain("plan-card-team-controls__badge");
  expect(joinedList).not.toContain("plan-card-team-controls__button");
});
```

Update the old expectations in `scripts/reading-team-registration.test.mjs` so the plan no longer expects `updateJoinedPlanTeamAction` or `"建立 / 加入團隊"` in joined card actions. Replace them with:

```js
expect(plan).toContain("function getPlanParticipationModel");
expect(plan).toContain("function renderPlanParticipationItem");
expect(plan).toContain("function bindPlanParticipationItemActions");
expect(plan).toContain("團隊讀經中");
expect(plan).toContain("個人讀經中");
expect(plan).toContain("報名 ${availableDivision}人組");
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
```

Expected: FAIL because `renderJoinedPlansList()` still builds team fragments manually.

- [ ] **Step 3: Add the action binder**

Add after `renderPlanParticipationItem(...)`:

```js
function bindPlanParticipationItemActions(card, plan, model) {
  if (!card || !plan || !model || !model.action) return;
  card.querySelectorAll("[data-plan-participation-action]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-plan-participation-action");
      const division = Number(button.getAttribute("data-plan-participation-division") || model.action.division || 3);

      if (action === "open-team") {
        await openJoinedPlanTeam(plan);
        return;
      }

      if (action === "join-team-division" && typeof window.openReadingTeamDialog === "function") {
        await window.openReadingTeamDialog(plan, { preferredDivision: division });
      }
    });
  });
}
```

- [ ] **Step 4: Replace the manual team container logic**

Inside `renderJoinedPlansList()`, keep `const teamHtml = isTeamPlan ? '<div class="plan-card-team-controls"></div>' : "";` only as a temporary slot, then replace post-render manual DOM creation with:

```js
if (isTeamPlan) {
  const teamContainer = card.querySelector(".plan-card-team-controls");
  if (teamContainer) {
    teamContainer.classList.add("plan-card-participation-slot");
    teamContainer.innerHTML = renderPlanParticipationItem(getPlanParticipationModel(plan, []));
  }
}
```

Then replace the async `window.getReadingTeamContextsForPlan(plan)` success branch with:

```js
const participationModel = getPlanParticipationModel(plan, contexts);
teamContainer.innerHTML = renderPlanParticipationItem(participationModel);
bindPlanParticipationItemActions(card, plan, participationModel);
if (typeof hydrateIcons === "function") hydrateIcons(teamContainer);
```

Keep existing loading and error strings, but render them inside the same slot:

```js
teamContainer.innerHTML = `<span class="plan-card-participation-item__hint">正在載入團隊狀態...</span>`;
teamContainer.innerHTML = `<span class="plan-card-participation-item__hint plan-card-participation-item__hint--danger">無法載入團隊資料</span>`;
```

Remove manual creation of:

```js
const participationLabel = document.createElement("div");
const badge = document.createElement("div");
const btn = document.createElement("button");
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/modules/plan.js scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
git commit -m "refactor(plan): use item component for joined participation"
```

---

### Task 4: Restyle Plan Card And Participation Item

**Files:**
- Modify: `index.css`
- Test: `scripts/plan-card-information-architecture.test.mjs`

**Interfaces:**
- Consumes HTML classes from Task 2/3.
- Produces compact Card/Item presentation:
  - `.plan-card`
  - `.plan-card__main`
  - `.plan-card-participation-slot`
  - `.plan-card-participation-item`
  - `.plan-card-participation-item__button`

- [ ] **Step 1: Write failing CSS tests**

Add to `scripts/plan-card-information-architecture.test.mjs`:

```js
it("styles plan cards as compact card shells with item-style participation rows", () => {
  const planCardCss = css.slice(
    css.indexOf("/* Plan cards: one card, clear hierarchy, stable action area */"),
    css.indexOf("/* ==================== 🔔 Notification Bell & Dropdown CSS ====================")
  );

  expect(planCardCss).toContain("--plan-card-spacing");
  expect(planCardCss).toContain(".plan-card-participation-item");
  expect(planCardCss).toContain(".plan-card-participation-item__media");
  expect(planCardCss).toContain(".plan-card-participation-item__content");
  expect(planCardCss).toContain(".plan-card-participation-item__actions");
  expect(planCardCss).toContain(".plan-card-participation-item__button");
  expect(planCardCss).not.toMatch(/plan-card-participation-item__button[\\s\\S]*border-radius:\\s*999/);
});
```

- [ ] **Step 2: Run the CSS test to verify it fails**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: FAIL because the new CSS classes do not exist.

- [ ] **Step 3: Add compact Card/Item CSS**

Append inside the existing plan-card CSS section in `index.css`:

```css
.plan-card {
  --plan-card-spacing: 0.75rem;
}

.plan-card-participation-slot {
  margin-top: 0.25rem;
  min-width: 0;
}

.plan-card-participation-item {
  align-items: center;
  background: color-mix(in srgb, var(--text-primary) 3%, var(--bg-card));
  border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0.625rem;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  min-width: 0;
  padding: 0.625rem;
}

.plan-card-participation-item__media {
  align-items: center;
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  border-radius: var(--radius-sm);
  color: var(--primary-color);
  display: inline-flex;
  height: 2rem;
  justify-content: center;
  width: 2rem;
}

.plan-card-participation-item__content {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.plan-card-participation-item__title {
  color: var(--text-primary);
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.3;
}

.plan-card-participation-item__description {
  color: var(--text-secondary);
  font-size: 0.74rem;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-card-participation-item__actions {
  display: inline-flex;
  justify-content: flex-end;
  min-width: 0;
}

.plan-card-participation-item__button {
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  display: inline-flex;
  font-size: 0.74rem;
  font-weight: 500;
  justify-content: center;
  min-height: 2rem;
  padding: 0 0.625rem;
  white-space: nowrap;
}

.plan-card-participation-item__button:hover,
.plan-card-participation-item__button:focus-visible {
  background: color-mix(in srgb, var(--primary-color) 8%, var(--bg-card));
  border-color: color-mix(in srgb, var(--primary-color) 26%, var(--border-card));
  outline: none;
}

.plan-card-participation-item--success .plan-card-participation-item__media {
  background: color-mix(in srgb, var(--color-success-foreground) 10%, transparent);
  color: var(--color-success-foreground);
}

.plan-card-participation-item__hint {
  color: var(--text-secondary);
  display: block;
  font-size: 0.76rem;
  padding: 0.375rem 0;
}

.plan-card-participation-item__hint--danger {
  color: var(--color-danger);
}
```

Add mobile adjustment:

```css
@media (max-width: 640px) {
  .plan-card-participation-item {
    grid-template-columns: 2rem minmax(0, 1fr);
  }

  .plan-card-participation-item__actions {
    grid-column: 2;
    justify-content: flex-start;
  }

  .plan-card-participation-item__button {
    min-height: 2rem;
  }
}
```

- [ ] **Step 4: Run focused CSS tests**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.css scripts/plan-card-information-architecture.test.mjs
git commit -m "style(plan): compact participation item in plan cards"
```

---

### Task 5: Verify Behavior, Build, And Production Readiness

**Files:**
- No new code unless tests expose regressions.

**Interfaces:**
- Verifies all prior tasks.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs scripts/plan-primary-navigation.test.mjs scripts/church-campaign.test.mjs
```

Expected: all selected test files pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all Vitest files pass with zero failures.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: build completes and emits `dist/app.<hash>.js` and `dist/index.<hash>.css`.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 5: Manual mobile smoke**

Serve locally:

```bash
npm run dev
```

Open the mobile viewport and verify:

- Joined plan card order remains chronological.
- Each card shows one cohesive participation item.
- Full 3-person team plus available 6-person action appears as one row.
- Solo participation appears as one row.
- Buttons do not overflow at 375px and 412px widths.
- Clicking card background opens the plan.
- Clicking participation action opens the team dialog and does not open the plan detail first.

- [ ] **Step 6: Commit any final fixes**

Only if Step 5 finds a small issue:

```bash
git add js/modules/plan.js index.css scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
git commit -m "fix(plan): polish participation item behavior"
```

---

## Self-Review

- **Spec coverage:** The plan covers Card shell structure, compact Item-style participation component, the `3人組 full + 報名 6人組` case, solo state, team-open/team-full variants, no duplicate/scattered badges, responsive compactness, behavior preservation, tests, and build verification.
- **Placeholder scan:** No placeholder markers remain. Every task has exact files, helper names, tests, commands, and expected outcomes.
- **Type consistency:** `getPlanParticipationModel`, `renderPlanParticipationItem`, and `bindPlanParticipationItemActions` names are consistent across tasks. Model fields are consistently consumed by the renderer and action binder.
