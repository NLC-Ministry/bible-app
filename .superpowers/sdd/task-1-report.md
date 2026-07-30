# Task 1 Report: Model Participation State As One Data Contract

## Status: DONE

## Summary

Added the pure helper `getPlanParticipationModel(plan, contexts = [])` to
`js/modules/plan.js` (immediately before `renderJoinedPlansList()`), plus its source-contract
test in `scripts/plan-card-information-architecture.test.mjs`. Followed TDD (RED -> GREEN),
full suite green, committed.

One brief-internal contradiction surfaced during Step 4 and was resolved by the coordinator
(details below); the helper code itself was kept exactly as in the brief.

## TDD Evidence

### Step 1-2: RED
Added the brief's test verbatim, then ran:
```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```
Failed as expected:
```
AssertionError: expected '// Combined plan and stats module\n\n…' to contain 'function getPlanParticipationModel'
```
Correct RED reason: the helper did not exist yet.

### Step 3: Added the helper
Added `getPlanParticipationModel` to `js/modules/plan.js` verbatim from the brief, including
the final `return { variant: isFull ? "team-full" : "team-open", ... }` ternary. Insertion
point: right before `function renderJoinedPlansList()` (near
`sortJoinedPlansChronologically`), at line ~1348.

### Brief contradiction found + coordinator fix
Re-running the focused test after Step 3 was still RED on two assertions:
```
AssertionError: ... to contain 'variant: "team-full"'
```
Because the brief's Step-3 code emits the variant via a ternary
(`variant: isFull ? "team-full" : "team-open"`), the literal substrings
`variant: "team-full"` / `variant: "team-open"` never appear in source. The brief's Step-1
test and Step-3 code were mutually inconsistent. I paused and reported rather than guessing.

Coordinator resolved it by relaxing those two test assertions (keeping the helper's ternary
untouched):
```js
expect(plan).toContain('"team-full"');   // was: 'variant: "team-full"'
expect(plan).toContain('"team-open"');   // was: 'variant: "team-open"'
```
The other three assertions were left as-is.

### Step 4: GREEN (focused)
```bash
npx vitest --run scripts/plan-card-information-architecture.test.mjs
```
Result:
```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### Full suite (no regressions)
```bash
npm test
```
Result:
```
 Test Files  53 passed (53)
      Tests  458 passed (458)
```

## Files changed

- `js/modules/plan.js` — added `getPlanParticipationModel(plan, contexts = [])` before
  `renderJoinedPlansList()`. Pure function, no side effects; returns the participation
  data contract (variants: `solo`, `team-open`, `team-full`,
  `team-with-other-division-available`). Division availability computed against a `Set` of
  ALL joined divisions, so a member in both 3- and 6-person teams is never offered a
  division they already joined.
- `scripts/plan-card-information-architecture.test.mjs` — added the
  "models joined-plan participation as one item contract" source-contract test (with the two
  coordinator-adjusted literal assertions).

## Commit

`dce438f` — feat(plan): model plan participation item state

## Self-review

- Helper is pure: only reads `plan`/`contexts`, no DOM/global mutation; safe to unit-test as
  a source-contract and later to call from render code.
- Icons restricted to registered Lucide keys `user` (solo) and `people` (team) per the return
  shape spec.
- `escapeHTML`/`hydrateIcons` not needed and not referenced by this function.
- Division-availability logic correctly handles the both-divisions-joined case:
  `availableDivision` is `undefined`, so the model falls through to `team-full`/`team-open`
  with the `open-team` (查看團隊) action rather than offering a duplicate join.
- No behavior change to existing render paths yet — this task only introduces the model; wiring
  it into the card UI is a downstream task.

## Concerns

- Minor: the brief shipped a self-contradictory Step-1 test vs Step-3 code (literal
  `variant: "..."` assertions against a ternary). Resolved by the coordinator by relaxing the
  test, not the code. No functional impact. Downstream tasks that consume this model should
  rely on the returned object shape, not on source-string assertions.
