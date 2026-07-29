# Task 1 Report

## Status

DONE

## Changes

- Added the shared `Input` primitive in `components/ui/input.tsx`.
- Exported `FORM_CONTROL_TEXT_CLASS = "text-base"` from the input primitive.
- Updated `Textarea` and `NativeSelect` to consume the shared class contract.
- Added the source-contract test to `components/issue-report/__tests__/IssueReport.test.ts`.

## TDD Evidence

- RED: `npx vitest --run components/issue-report/__tests__/IssueReport.test.ts` failed as expected because `components/ui/input.tsx` did not exist; 21 tests passed and 1 failed.
- GREEN: focused test passed with 22/22 tests.
- Full suite: `npm test` passed with 48/48 test files and 391/391 tests.
- `git diff --check` passed.

## Commit

`feat(ui): standardize form control font size`

## Concerns

None.

## Review Fix

- Replaced the issue-report drawer textarea and admin user search input with the shared `Textarea` and `Input` primitives while preserving their existing props, copy, and description counter behavior.
- Made `FORM_CONTROL_TEXT_CLASS` the final `cn()` argument so caller `text-sm` classes cannot override `text-base` on `Input`, `Textarea`, or `NativeSelect`.
- Expanded `IssueReport.test.ts` with component-invocation assertions and source guards for both issue-report controls.
- RED: focused test failed with 2 review regression tests failing and 22 passing.
- GREEN: focused test passed with 24/24 tests.
- Full suite: `npm test` passed with 48/48 test files and 393/393 tests.
- `git diff --check` passed.
