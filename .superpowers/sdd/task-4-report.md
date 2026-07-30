# Task 4 Report: Restyle Plan Card And Participation Item (CSS)

## Status: DONE

Commit: `78d29cb` — `style(plan): compact participation item in plan cards`

## Summary

Added the compact Card/Item CSS from the brief (Step 3) to `index.css`'s existing plan-card
section, verbatim (light item row: hairline `border-top` divider, no inner border/fill/card-radius,
no pill-shaped buttons, `var(--radius-md)` on the action button). Retired the now-orphaned
`.plan-card-team-controls__badge/__button/__hint` and `.plan-card-participation-state` CSS left
dead by Task 3's DOM removal, keeping the base `.plan-card-team-controls` rule (still the slot
container). Bumped the coordinated cache-bust key from `20260730_plan_tabs_line_style` to
`20260730_plan_card_participation_item` in `index.html` and the two test files that assert it.

## Files changed

- `index.css`
  - Appended the brief's Step-3 CSS block (`--plan-card-spacing`, `.plan-card-participation-slot`,
    `.plan-card-participation-item{,__media,__content,__title,__description,__actions,__button,
    --success,__hint,__hint--danger}`, and the `@media (max-width: 640px)` mobile adjustment) right
    after the existing plan-card mobile media query, still inside the
    `/* Plan cards: ... */` … `/* 🔔 Notification Bell */` section boundary the tests slice on.
  - Deleted orphaned dead CSS (grep-confirmed zero references in `js/` and `index.html` first):
    - Removed `.plan-card-team-controls__badge` as a selector from the four shared rules it was
      piggy-backing on (`.plan-card__primary-action, .plan-card__secondary-action { ... }`;
      `.plan-card__secondary-action, ..., .plan-card .secondary-btn.plan-card-action-btn { ... }`;
      the `:hover` rule; the `:focus-visible` rule) — those rules themselves are kept, only the
      dead selector line was dropped from each comma list.
    - Deleted the standalone `.plan-card-team-controls__badge.is-full { cursor: default; }` rule.
    - Deleted `.plan-card-team-controls__badge, .plan-card-team-controls__button { ... }` (sizing
      rule) and `.plan-card-team-controls__badge span, .plan-card-team-controls__button span { ... }`
      (ellipsis rule) entirely.
    - Deleted `.plan-card-team-controls__hint { ... }` and `.plan-card-team-controls__hint--danger
      { ... }` entirely.
    - Deleted `.plan-card-participation-state { ... }` entirely.
    - **Kept** both remaining `.plan-card-team-controls` occurrences: the shared
      `.plan-card__actions, .plan-card-team-controls { display: flex; ... }` layout rule and the
      standalone `.plan-card-team-controls { gap: 0.35rem; margin-top: -0.1rem; }` rule — both are
      the base slot-container rule, still used, per instruction.
- `index.html` — bumped both `?v=` cache-bust strings (the `index.css` `<link>` at line 24 and the
  `js/app.js` `<script type="module">` at line 2023) from `20260730_plan_tabs_line_style` to
  `20260730_plan_card_participation_item`.
- `scripts/plan-card-information-architecture.test.mjs`
  - Added the brief's Step-1 failing test verbatim: `"styles plan cards as compact card shells with
    item-style participation rows"`.
  - **Deviation from brief** (see Concerns): deleted the pre-existing test `"keeps team controls
    visually subordinate to primary plan actions"` — its entire assertion surface
    (`.plan-card-team-controls__badge`/`__button` existing in the plan-card CSS slice, plus their
    `min-height`/`font-size`/`max-width` values) was exactly the dead CSS this task's Step 3
    instructs deleting. No content survived to keep; the new compact-item-row coverage (this task's
    new test, plus the existing `"renders participation status with shadcn item-style parts"` and
    `"follows compact item-style cards without pill actions..."` tests) already covers the
    replacement component.
- `scripts/reading-team-registration.test.mjs`
  - **Deviation from brief**: removed one line from the pre-existing test `"styles plan
    participation controls for touch-safe responsive layouts"` —
    `expect(indexCss).toContain(".plan-card-participation-state");` — since that selector was
    deleted per Step 3. The rest of that test (`.plan-team-invite-shortcut`,
    `.plan-card-participation-actions`, `.plan-card-action-btn`, `min-height: 44px`, the media
    query, and the `plan.js` assertions) is untouched and still passes.
- `scripts/admin-team-registration-overview.test.mjs` — updated both cache-key assertions
  (`js/app.js?v=...` and `index.css?v=...`) to the new version string.
- `scripts/tab-navigation-lifecycle.test.mjs` — updated its `js/app.js?v=...` cache-key assertion
  to the new version string.
- `scripts/bundle.test.mjs` — **not touched** (confirmed via `git diff --stat`), since it only uses
  unrelated fixture versions `?v=abc`/`?v=def`.

## RED evidence (Step 1, before adding CSS)

```
$ npx vitest --run scripts/plan-card-information-architecture.test.mjs
 × styles plan cards as compact card shells with item-style participation rows
   expect(planCardCss).toContain("--plan-card-spacing")
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

Failed for the expected reason: none of the new participation-item classes existed in `index.css`
yet.

## GREEN evidence

Focused test, immediately after adding the brief's CSS (before dead-CSS removal) — passed 12/12.

After deleting the orphaned CSS, two pre-existing tests broke as a direct, mechanical consequence
of Step 3 (grep-confirmed no other code depended on the deleted selectors):

```
$ npx vitest --run scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
 × keeps team controls visually subordinate to primary plan actions
 × styles plan participation controls for touch-safe responsive layouts
 Test Files  2 failed (2)
      Tests  2 failed | 36 passed (38)
```

After applying the two documented test deviations above:

```
$ npx vitest --run scripts/plan-card-information-architecture.test.mjs scripts/reading-team-registration.test.mjs
 Test Files  2 passed (2)
      Tests  37 passed (37)

$ npx vitest --run scripts/plan-card-information-architecture.test.mjs
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ npm test
 Test Files  53 passed (53)
      Tests  460 passed (460)
```

`git diff --check -- index.css index.html scripts/` produced no output (no whitespace errors).

## Dead-CSS grep (per directive, run before deleting)

```
$ grep -rn "plan-card-team-controls__badge\|plan-card-team-controls__button\|plan-card-team-controls__hint\|plan-card-participation-state" js/ index.html
(no output)
```

Zero references in `js/` or `index.html` before deletion — safe to remove. After deletion,
re-grepping `index.css` confirms zero remaining `__badge`/`__button`/`__hint`/`-state` selectors,
and exactly two `.plan-card-team-controls` base-rule occurrences remain (the shared layout rule and
the standalone gap/margin rule) — both intentionally kept as the slot container.

## Self-review

- CSS added matches the brief byte-for-byte (base rules, `--success` modifier, `__hint`/
  `__hint--danger`, and the `max-width: 640px` block) — no invented tokens; all tokens used
  (`--radius-md`, `--radius-sm`, `--bg-card`, `--text-primary`, `--text-secondary`, `--border-card`,
  `--color-success-foreground`, `--color-danger`, `--primary-color`) verified present in
  `index.css`'s `:root`/dark/warm theme blocks before use.
- No pill buttons introduced: `.plan-card-participation-item__button` uses `border-radius:
  var(--radius-md)` (12px), not 999px. No gradients or glossy/3D states added — verified by the
  Step-1 test's negative regex and by eyeballing the added block (flat backgrounds,
  `color-mix()` tints only).
- Confirmed comma-selector surgery didn't orphan any rule: reviewed the full pre/post diff of the
  `.plan-card__primary-action`/`.plan-card__secondary-action` hover/focus rules — each still has at
  least the two non-team-controls selectors it needs, and no rule was left with a dangling trailing
  comma or an empty selector list.
- Confirmed `.plan-card-team-controls` (base, no `__` suffix) survives twice — as a co-selector in
  the shared `display: flex` layout rule and as its own `gap`/`margin-top` rule — matching the
  "KEEP the base rule" instruction.

## Concerns

1. **Test deviations required (not just permitted) to satisfy "npm test → all pass"**: the required
   work's Step 3 (delete `__badge`/`__button`/`__hint`/`-state` CSS) directly contradicted two
   pre-existing test assertions not mentioned in the task's required-work list — `"keeps team
   controls visually subordinate to primary plan actions"` in
   `plan-card-information-architecture.test.mjs` and one line of `"styles plan participation
   controls for touch-safe responsive layouts"` in `reading-team-registration.test.mjs`. Task 3's
   own report (Concern #1) had already flagged the first of these as a known gap left for a future
   task. I resolved both by updating/trimming the stale assertions rather than stopping BLOCKED,
   since: (a) the brief's own Step-1 test doesn't contradict the brief's CSS — the contradiction was
   between the *required-work Step 3 instruction* and *pre-existing* tests outside the brief; (b)
   Task 3 set direct precedent for this exact situation (deviating from a brief to fix a stale
   test, documented as a Concern); and (c) the deleted assertions tested implementation details
   (exact old class names existing in CSS) that had already become false once Task 3 removed the
   badge/button DOM in a prior commit — leaving them in place would make `npm test` fail as a
   guaranteed, mechanical consequence of following this task's explicit instructions to the letter.
   Flagging prominently in case this deviation should have instead been a hard STOP.
2. No other concerns — dead-CSS grep was clean, cache-bust coverage matched the brief's predicted
   file list exactly (including confirming `scripts/bundle.test.mjs` was correctly out of scope),
   and the full suite is green with no regressions (460/460, same total test count as pre-task
   since 1 test was added and 1 was removed).
