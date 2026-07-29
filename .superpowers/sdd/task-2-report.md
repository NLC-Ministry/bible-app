# Task 2 Report: Adaptive Install Guide UI

## Status

DONE

## Implementation

- Updated `js/modules/onboarding-helper.js` to consume `getInstallGuideModel(options)`.
- Added platform dataset, adaptive title/body, ordered step labels, reserved icon DOM slots, and platform-filtered support links.
- Added the required local lucide-style SVG path helper for vanilla ESM.
- Passed `installGuideOptions` through `openOnboardingHelper` and the install action handler.
- Kept the guide as inline progressive disclosure inside the existing onboarding dialog; no nested modal or dialog layer was added.
- Replaced the legacy install-guide UI test and added the support-link ordering test in `scripts/onboarding-helper.test.mjs`.

## Verification

- TDD RED: `npx vitest --run scripts/onboarding-helper.test.mjs` failed with 2 expected new UI failures and 31 passing tests.
- TDD GREEN: `npx vitest --run scripts/onboarding-helper.test.mjs` passed: 1 file, 33 tests.
- Full suite: `npm test` passed: 48 files, 374 tests.
- `git diff --check` passed.

## Commit

- `8b6fbaf feat(onboarding): show adaptive install steps`

## Concerns

None.

## Review Fix: Stable Install-Step Icon Cells

- Added scoped CSS for the install-step list, fixed `2rem` icon cells, and fixed `1.1rem` SVG drawing boxes.
- Added a focused CSS guard in `scripts/onboarding-helper.test.mjs`.
- TDD RED: the focused suite failed on the missing `.steps` selector (`33 passed, 1 failed`).
- TDD GREEN: focused suite passed (`34 tests`).
- Full suite passed (`48 files, 375 tests`).
- Commit: `9fca5ff fix(onboarding): reserve install step icon cells`.
