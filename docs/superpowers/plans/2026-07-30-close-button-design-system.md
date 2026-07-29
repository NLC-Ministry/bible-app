# Close Button Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad hoc close/dismiss button chrome with a centrally managed shadcn-style icon-button primitive so close controls stay square, accessible, and visually consistent across the Bible app.

**Architecture:** Add a vanilla design-system primitive for icon-only controls in `index.css`, document it in `docs/design-system.md`, migrate known close buttons away from `circular-action-btn` and inline width/height styles, and add static guard tests that prevent future oval close buttons. React-backed surfaces continue to use existing shadcn/Radix primitives (`Button`, `DrawerClose`, `ResponsiveDialog`) rather than new vanilla classes.

**Tech Stack:** Static HTML, vanilla ESM JavaScript, global `index.css`, `css/team-registration.css`, React shadcn/Radix UI primitives where already used, Vitest source/design guard tests.

## Global Constraints

- Do not introduce a React island for vanilla plan, Bible reader, or admin surfaces.
- React-backed surfaces must use existing shadcn/Radix primitives instead of new vanilla-only chrome.
- Vanilla close buttons must use a centrally managed design-system class, not inline sizing or `circular-action-btn`.
- Icon-only controls must have a square touch target: width, height, min-width, and min-height must resolve to the same value.
- Touch targets must remain at least `44px` for interactive close/dismiss controls.
- Use Lucide icons through `data-icon` / `hydrateIcons`; do not add raw inline SVG.
- Keep scope to close/dismiss icon buttons and design-system guardrails. Do not redesign unrelated cards, dialogs, drawers, or navigation.
- Preserve existing dialog behavior, routing behavior, keyboard behavior, and close callbacks.
- Do not change backend, Supabase, auth, or data contracts.

---

## File Structure

- Modify `index.css`
  - Add the central vanilla icon-button primitive.
  - Make `.circular-action-btn` square-safe for existing non-close usages.
  - Remove oval risk from bottom-sheet close classes.
- Modify `docs/design-system.md`
  - Document close/dismiss primitives and anti-patterns.
- Modify `index.html`
  - Migrate static close buttons that currently use `circular-action-btn` or bottom-sheet-specific ad hoc close classes.
- Modify `js/modules/plan.js`
  - Migrate dynamically generated close buttons away from inline width/height and `circular-action-btn`.
- Modify `js/modules/team-registration.js`
  - Align reading-team close buttons to the central primitive while keeping overlay behavior.
- Modify `js/modules/onboarding-helper.js`
  - Replace raw `×` close glyph with the icon primitive and `data-icon="close"`, then hydrate icons after rendering.
- Modify `components/ui/ResponsiveDialog.tsx`
  - Use the existing shadcn `Button` component and `lucide-react` `X` icon for the desktop close control.
- Create `scripts/close-button-design-system.test.mjs`
  - Static guard tests for close-button class usage, sizing, documentation, and React primitive use.

---

### Task 1: Define The Central Close/Icon Button Primitive

**Files:**
- Modify: `index.css`
- Modify: `docs/design-system.md`
- Create: `scripts/close-button-design-system.test.mjs`

**Interfaces:**
- Produces CSS classes:
  - `.icon-button`
  - `.icon-button--subtle`
  - `.icon-button--ghost`
  - `.icon-button--danger`
  - `.dialog-close-button`
- Consumes existing tokens:
  - `--bg-card`
  - `--border-card`
  - `--text-secondary`
  - `--text-primary`
  - `--color-danger`
  - `--color-danger-muted`
  - `--shadow-focus-ring`

- [ ] **Step 1: Write the failing design-system guard test**

Create `scripts/close-button-design-system.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("index.css");
const designSystem = read("docs/design-system.md");

describe("close button design system", () => {
  it("defines a central square icon-button primitive", () => {
    expect(css).toContain(".icon-button {");
    expect(css).toContain("inline-size: 44px");
    expect(css).toContain("block-size: 44px");
    expect(css).toContain("min-inline-size: 44px");
    expect(css).toContain("min-block-size: 44px");
    expect(css).toContain("aspect-ratio: 1");
    expect(css).toContain(".dialog-close-button");
  });

  it("documents close-button primitives and anti-patterns", () => {
    expect(designSystem).toContain("Close / dismiss controls");
    expect(designSystem).toContain("Use `.dialog-close-button.icon-button`");
    expect(designSystem).toContain("Do not use `.circular-action-btn` for dialog close buttons");
    expect(designSystem).toContain("Do not inline width/height on close buttons");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: FAIL because `scripts/close-button-design-system.test.mjs` is new and `.icon-button` / `.dialog-close-button` are not yet defined.

- [ ] **Step 3: Add the CSS primitive**

Append this block near the shared button/component CSS in `index.css`, before the broad global touch-target rule if possible:

```css
/* Icon-only controls: shadcn-style square touch targets for close/search/back actions. */
.icon-button {
  appearance: none;
  inline-size: 44px;
  block-size: 44px;
  min-inline-size: 44px;
  min-block-size: 44px;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  cursor: pointer;
  line-height: 1;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.08s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.icon-button:hover {
  background: color-mix(in srgb, var(--text-primary) 4%, transparent);
  color: var(--text-primary);
}

.icon-button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.icon-button:active {
  transform: scale(0.96);
}

.icon-button--subtle,
.dialog-close-button {
  background: transparent;
  border-color: transparent;
}

.icon-button--ghost {
  background: transparent;
}

.icon-button--danger {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 22%, transparent);
}
```

- [ ] **Step 4: Make existing circular buttons square-safe without changing their visual role**

In `index.css`, update `.circular-action-btn` from:

```css
.circular-action-btn {
  width: 36px;
  height: 36px;
```

to:

```css
.circular-action-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  aspect-ratio: 1;
  padding: 0;
```

In `.plan-detail-compact .circular-action-btn`, replace:

```css
width: 34px;
height: 34px;
```

with:

```css
width: 44px;
height: 44px;
min-width: 44px;
min-height: 44px;
aspect-ratio: 1;
```

- [ ] **Step 5: Document the primitive**

In `docs/design-system.md`, add a subsection under `## Components`:

```md
### Close / dismiss controls

Use `.dialog-close-button.icon-button` for vanilla dialog/card close buttons.

Use `.icon-button` variants for icon-only actions:

| Class | Role |
|-------|------|
| `.icon-button` | Default square icon-only control |
| `.icon-button--subtle` | Transparent close button on cards/dialogs |
| `.icon-button--ghost` | Bordered transparent icon action |
| `.icon-button--danger` | Destructive icon action |
| `.dialog-close-button` | Dialog and card dismiss affordance |

Rules:

- Do not use `.circular-action-btn` for dialog close buttons.
- Do not inline width/height on close buttons.
- Every icon-only close button must resolve to a square `44px` touch target.
- React-backed dialogs/drawers use shadcn/Radix close primitives (`Button`, `DrawerClose`, `ResponsiveDialog`) rather than ad hoc close chrome.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.css docs/design-system.md scripts/close-button-design-system.test.mjs
git commit -m "style(ui): add square icon button primitive"
```

---

### Task 2: Migrate Static Vanilla Close Buttons

**Files:**
- Modify: `index.html`
- Modify: `index.css`
- Modify: `scripts/close-button-design-system.test.mjs`

**Interfaces:**
- Consumes `.icon-button`, `.dialog-close-button`, `.icon-button--subtle`, `.icon-button--ghost`.
- Produces no new runtime APIs.

- [ ] **Step 1: Extend the failing guard test for static markup**

Append these tests to `scripts/close-button-design-system.test.mjs`:

```js
const html = read("index.html");

describe("static close button usage", () => {
  it("does not use circular-action-btn for close buttons", () => {
    expect(html).not.toMatch(/id="btn-close-plan-team-invite"[^>]*class="[^"]*circular-action-btn/);
    expect(html).not.toMatch(/aria-label="[^"]*關閉[^"]*"[^>]*class="[^"]*circular-action-btn/);
  });

  it("uses the central icon button primitive for static close controls", () => {
    expect(html).toContain('id="btn-close-plan-team-invite"');
    expect(html).toMatch(/id="btn-close-plan-team-invite"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(html).toMatch(/id="typography-sheet-close-btn"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(html).toMatch(/id="btn-close-bottom-sheet"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
  });

  it("keeps bottom-sheet close controls square through the shared primitive", () => {
    expect(css).toContain(".bottom-sheet-close-x");
    expect(css).toContain(".bottom-sheet-close-btn");
    expect(css).not.toMatch(/\\.bottom-sheet-close-x[\\s\\S]*?width:\\s*32px/);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: FAIL because static close controls still use `circular-action-btn`, `.bottom-sheet-close-x`, or `.bottom-sheet-close-btn` without the central primitive.

- [ ] **Step 3: Migrate the invite-code panel close button**

In `index.html`, replace:

```html
<button type="button" class="circular-action-btn" id="btn-close-plan-team-invite" aria-label="關閉邀請碼輸入">
```

with:

```html
<button type="button" class="dialog-close-button icon-button icon-button--subtle" id="btn-close-plan-team-invite" aria-label="關閉邀請碼輸入">
```

- [ ] **Step 4: Migrate static bottom-sheet close buttons**

In `index.html`, replace:

```html
<button type="button" class="bottom-sheet-close-x" id="typography-sheet-close-btn"
```

with:

```html
<button type="button" class="bottom-sheet-close-x dialog-close-button icon-button icon-button--subtle" id="typography-sheet-close-btn"
```

Replace:

```html
<button class="bottom-sheet-close-btn" id="btn-close-bottom-sheet" type="button">
```

with:

```html
<button class="bottom-sheet-close-btn dialog-close-button icon-button icon-button--subtle" id="btn-close-bottom-sheet" type="button" aria-label="關閉">
```

- [ ] **Step 5: Remove conflicting bottom-sheet dimensions**

In `index.css`, update `.bottom-sheet-close-x` so it no longer sets `width: 32px` / `height: 32px`. Keep only its bottom-sheet color role.

Replace:

```css
.bottom-sheet-close-x {
  background: transparent;
  border: none;
  font-size: 14px;
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
```

with:

```css
.bottom-sheet-close-x {
  color: var(--text-muted);
}
```

Remove `.bottom-sheet-close-x` from the grouped min-width/min-height rule:

```css
.overlay-back-btn,
.overlay-version,
.view-mode-btn,
.search-cancel-btn,
.search-clear-btn,
.bottom-sheet-close-x {
```

so the selector becomes:

```css
.overlay-back-btn,
.overlay-version,
.view-mode-btn,
.search-cancel-btn,
.search-clear-btn {
```

Keep `.bottom-sheet-close-x:active` if it still makes sense, or delete it because `.icon-button:active` now owns the active scale.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html index.css scripts/close-button-design-system.test.mjs
git commit -m "style(ui): migrate static close controls"
```

---

### Task 3: Migrate Dynamic Vanilla Close Buttons

**Files:**
- Modify: `js/modules/plan.js`
- Modify: `js/modules/team-registration.js`
- Modify: `js/modules/onboarding-helper.js`
- Modify: `css/team-registration.css`
- Modify: `scripts/close-button-design-system.test.mjs`

**Interfaces:**
- Consumes `.dialog-close-button.icon-button`.
- Preserves existing close handlers:
  - `closePlanTeamInvitePanel`
  - `openPlanDetailsDialog` close handlers
  - stats modal close handlers
  - reading team overlay close handlers
  - onboarding helper close handler

- [ ] **Step 1: Extend the failing guard test for dynamic markup**

Append:

```js
const plan = read("js/modules/plan.js");
const teamRegistration = read("js/modules/team-registration.js");
const onboardingHelper = read("js/modules/onboarding-helper.js");
const teamCss = read("css/team-registration.css");

describe("dynamic close button usage", () => {
  it("does not generate close buttons with circular-action-btn or inline square sizing", () => {
    expect(plan).not.toMatch(/aria-label="關閉"[\\s\\S]{0,180}class="[^"]*circular-action-btn/);
    expect(plan).not.toMatch(/aria-label="關閉"[\\s\\S]{0,220}width:\\s*\\d+px;\\s*height:\\s*\\d+px/);
    expect(plan).not.toContain('style="position:absolute;top:1rem;right:1rem;width:30px;height:30px');
  });

  it("uses the central primitive for dynamic close controls", () => {
    expect(plan).toMatch(/id="plan-details-x-btn"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(plan).toMatch(/aria-label="關閉"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(teamRegistration).toContain("dialog-close-button icon-button");
    expect(onboardingHelper).toContain("dialog-close-button icon-button");
  });

  it("does not keep a separate reading-team close button sizing system", () => {
    expect(teamCss).not.toContain(".reading-team-close {");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: FAIL because dynamic plan and reading-team close controls still use ad hoc classes/styles.

- [ ] **Step 3: Migrate plan details dialog close button**

In `js/modules/plan.js`, replace:

```html
<button type="button" id="plan-details-x-btn" aria-label="關閉"
  style="position:absolute;top:1rem;right:1rem;width:30px;height:30px;border-radius:50%;border:none;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-secondary);transition:all 0.15s ease;">
```

with:

```html
<button type="button" id="plan-details-x-btn" class="dialog-close-button icon-button icon-button--subtle" aria-label="關閉"
  style="position:absolute;top:1rem;right:1rem;">
```

- [ ] **Step 4: Migrate stats modal close button**

In `js/modules/plan.js`, replace the close button string near `詳細數據統計`:

```html
<button class="circular-action-btn" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-card); background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; color: var(--text-secondary);" onclick="this.closest('.modal-overlay').remove()" aria-label="關閉"><span class="nlc-icon" data-icon="closeLg" aria-hidden="true"></span></button>
```

with:

```html
<button class="dialog-close-button icon-button icon-button--subtle" onclick="this.closest('.modal-overlay').remove()" aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
```

- [ ] **Step 5: Migrate reading-team close buttons**

In `js/modules/team-registration.js`, replace every:

```html
class="reading-team-close"
```

with:

```html
class="reading-team-close dialog-close-button icon-button icon-button--subtle"
```

In `css/team-registration.css`, delete the full `.reading-team-close { ... }` block because central CSS now owns dimensions and chrome.

- [ ] **Step 6: Migrate onboarding helper close button**

In `js/modules/onboarding-helper.js`, replace:

```html
<button type="button" class="release-onboarding-dialog__close" data-onboarding-close aria-label="關閉使用說明">×</button>
```

with:

```html
<button type="button" class="release-onboarding-dialog__close dialog-close-button icon-button icon-button--subtle" data-onboarding-close aria-label="關閉使用說明"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
```

After onboarding helper content is rendered and event handlers are attached, add icon hydration:

```js
if (typeof globalThis.hydrateIcons === "function") globalThis.hydrateIcons(root);
```

- [ ] **Step 7: Remove conflicting onboarding close dimensions**

In `index.css`, keep `.release-onboarding-dialog__close` positioning but remove min-size/chrome declarations already owned by `.icon-button`.

Replace:

```css
.release-onboarding-dialog__close {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  min-width: 2.5rem;
  min-height: 2.5rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
  line-height: 1;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}
```

with:

```css
.release-onboarding-dialog__close {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
}
```

Delete `.release-onboarding-dialog__close:hover` because `.icon-button:hover` owns hover chrome. Keep the existing grouped `:focus-visible` selector because it applies the same focus ring to onboarding footer actions too.

- [ ] **Step 8: Run tests**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs scripts/onboarding-helper.test.mjs scripts/reading-team-registration.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add js/modules/plan.js js/modules/team-registration.js js/modules/onboarding-helper.js css/team-registration.css index.css scripts/close-button-design-system.test.mjs
git commit -m "style(ui): migrate dynamic close controls"
```

---

### Task 4: Align React Close Controls With Existing Shadcn Primitives

**Files:**
- Modify: `components/ui/ResponsiveDialog.tsx`
- Modify: `components/ui/__tests__/ResponsiveDialog.test.tsx`
- Modify: `scripts/close-button-design-system.test.mjs`

**Interfaces:**
- Consumes existing `Button` from `@/components/ui/button`.
- Consumes existing `X` from `lucide-react`.
- Preserves `data-testid="responsive-dialog-close-btn"`.
- Preserves desktop-only close button behavior.

- [ ] **Step 1: Extend guard test for React close controls**

Append:

```js
const responsiveDialog = read("components/ui/ResponsiveDialog.tsx");

describe("React close button usage", () => {
  it("uses existing shadcn Button for ResponsiveDialog close chrome", () => {
    expect(responsiveDialog).toContain('import { Button } from "@/components/ui/button"');
    expect(responsiveDialog).toContain('import { X } from "lucide-react"');
    expect(responsiveDialog).toContain('<Button');
    expect(responsiveDialog).toContain('variant="ghost"');
    expect(responsiveDialog).toContain('size="icon"');
    expect(responsiveDialog).toContain("<X");
    expect(responsiveDialog).toContain('data-testid="responsive-dialog-close-btn"');
    expect(responsiveDialog).not.toContain("w-8 h-8 flex items-center justify-center");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs components/ui/__tests__/ResponsiveDialog.test.tsx`

Expected: FAIL because `ResponsiveDialog` still uses a raw `<button>`.

- [ ] **Step 3: Update ResponsiveDialog**

In `components/ui/ResponsiveDialog.tsx`, add:

```tsx
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
```

Replace the desktop close `<button>`:

```tsx
<button
  onClick={onClose}
  className="absolute right-4 top-4 rounded-full opacity-70 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-8 h-8 flex items-center justify-center"
  aria-label="Close"
  data-testid="responsive-dialog-close-btn"
>
  <span className="text-xl font-light leading-none">×</span>
</button>
```

with:

```tsx
<Button
  type="button"
  variant="ghost"
  size="icon"
  onClick={onClose}
  className="absolute right-4 top-4 rounded-full opacity-70 hover:opacity-100"
  aria-label="Close"
  data-testid="responsive-dialog-close-btn"
>
  <X className="size-4" aria-hidden="true" />
</Button>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs components/ui/__tests__/ResponsiveDialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ResponsiveDialog.tsx components/ui/__tests__/ResponsiveDialog.test.tsx scripts/close-button-design-system.test.mjs
git commit -m "style(ui): use shadcn button for dialog close"
```

---

### Task 5: Add Future-Proof Guardrails And Full Verification

**Files:**
- Modify: `scripts/close-button-design-system.test.mjs`

**Interfaces:**
- Consumes all migrated close controls from Tasks 1-4.
- Produces CI coverage through existing `vitest run`.

- [ ] **Step 1: Add broad anti-regression scans**

Append:

```js
const files = {
  html,
  plan,
  teamRegistration,
  onboardingHelper,
  responsiveDialog,
};

describe("close button anti-regression guards", () => {
  it("does not add inline width/height close-button chrome in common UI files", () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/aria-label="[^"]*(關閉|Close)[^"]*"[^>]*style="[^"]*(width|inline-size):\\s*\\d+px[^"]*(height|block-size):\\s*\\d+px/);
    }
  });

  it("does not use circular-action-btn for close or dismiss controls", () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/(關閉|Close)[\\s\\S]{0,240}circular-action-btn/);
      expect(source, name).not.toMatch(/circular-action-btn[\\s\\S]{0,240}(關閉|Close)/);
    }
  });

  it("keeps icon-only controls square under global touch target rules", () => {
    expect(css).toMatch(/\\.icon-button\\s*\\{[\\s\\S]*inline-size:\\s*44px[\\s\\S]*block-size:\\s*44px[\\s\\S]*min-inline-size:\\s*44px[\\s\\S]*min-block-size:\\s*44px[\\s\\S]*aspect-ratio:\\s*1/);
    expect(css).toMatch(/\\.circular-action-btn\\s*\\{[\\s\\S]*width:\\s*44px[\\s\\S]*height:\\s*44px[\\s\\S]*min-width:\\s*44px[\\s\\S]*min-height:\\s*44px[\\s\\S]*aspect-ratio:\\s*1/);
  });
});
```

- [ ] **Step 2: Run focused test**

Run: `npx vitest --run scripts/close-button-design-system.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS and generated production assets.

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/close-button-design-system.test.mjs
git commit -m "test(ui): guard close button design system"
```

Vitest already picks up `scripts/*.test.mjs`; `package.json` should remain unchanged.

---

## Manual QA Checklist

After implementation and before PR update, visually inspect at desktop and mobile widths:

- Plan invite-code panel close button: square, not oval.
- Plan search toggle: square after `.circular-action-btn` change.
- Plan details dialog X button: square, aligned top-right.
- Reading-team modals: close button square and visually consistent.
- Typography bottom sheet close: square.
- Admin/global bottom sheet close: square.
- Release onboarding helper close: square and icon renders.
- ResponsiveDialog desktop close in React tests/stories: square and still hidden on mobile.

Keyboard checks:

- Tab reaches close buttons.
- Focus ring is visible.
- Closing user-triggered panels restores focus where the previous behavior required it.

## Self-Review

**Spec coverage:** Task 1 defines and documents the primitive. Tasks 2-4 migrate static, dynamic, and React-backed close controls. Task 5 adds anti-regression guards and full verification.

**Placeholder scan:** No `TBD`, `TODO`, "implement later", or unspecified validation remains. Each task includes file paths, exact test commands, expected outcomes, and commit messages.

**Type consistency:** Class names are consistent throughout: `.icon-button`, `.icon-button--subtle`, `.icon-button--ghost`, `.icon-button--danger`, and `.dialog-close-button`.
