# Close Button Plan Task 3 Report

## Files changed

- `js/modules/plan.js`
  - Migrated the plan details and statistics modal close controls to `dialog-close-button icon-button icon-button--subtle`.
  - Removed plan-details per-instance hover scripting so shared icon-button hover chrome applies.
- `js/modules/team-registration.js`
  - Added the shared close-button classes to every dynamic reading-team close control, including the error state.
- `css/team-registration.css`
  - Removed the legacy `.reading-team-close` sizing and chrome block.
- `js/modules/onboarding-helper.js`
  - Replaced the textual multiplication-sign close control with a hydrated close icon and shared close-button classes.
  - Hydrates icons after event handlers have been attached.
- `index.css`
  - Retained only onboarding close-button positioning and removed per-instance dimensions, chrome, and hover styling.
- `scripts/close-button-design-system.test.mjs`
  - Added dynamic-markup guard coverage from the task brief.
- `scripts/onboarding-helper.test.mjs`
  - Updated the existing close-control assertion to verify the shared primitive instead of dimensions removed by this task.

## Behavior and accessibility

- Existing close handlers remain in place for plan details, statistics, reading-team overlays, and onboarding.
- Close controls retain accessible Chinese labels and use decorative hydrated icons with `aria-hidden="true"`.
- Shared `.icon-button` controls own the consistent square target, subtle hover treatment, and focus behavior. The onboarding grouped `:focus-visible` selector remains intact.

## Self-review

- Confirmed all specified dynamic close controls use `dialog-close-button icon-button icon-button--subtle`.
- Confirmed plan close controls no longer use `circular-action-btn` or inline square sizing.
- Confirmed `.reading-team-close` no longer has a standalone CSS sizing block.
- Kept scope to the Task 3 controls and necessary test alignment. No framework changes were introduced.

## Verification

Initial guard-test red phase:

```text
$ npx vitest --run scripts/close-button-design-system.test.mjs
Test Files  1 failed (1)
Tests  3 failed | 5 passed (8)
```

Final targeted verification:

```text
$ npx vitest --run scripts/close-button-design-system.test.mjs scripts/onboarding-helper.test.mjs scripts/reading-team-registration.test.mjs
Test Files  3 passed (3)
Tests  78 passed (78)
Start at  02:31:03
Duration  1.06s (transform 72ms, setup 0ms, import 124ms, tests 126ms, environment 716ms)
```

Diff whitespace check:

```text
$ git diff --check
(no output; exit 0)
```

## Concerns

None.
