# Final Review Fix Report

2026-07-29: Cleared the pending install status when the native prompt is accepted before rendering the installed-success guide. Added a regression confirming accepted outcomes hide and remove `正在開啟安裝提示…`; focused onboarding tests and the full Vitest suite pass.

2026-07-29: Added an in-flight native install-prompt guard and disabled the install action until `userChoice` settles, preventing duplicate prompts and preserving accepted state. Bound the install action label to the supplied guide model and used `canPrompt` to preserve iOS/manual behavior even when a stale prompt event exists. Added focused regressions for double activation, accepted settlement, label rendering, and manual fallback.
2026-07-29: Fixed native install prompt lifecycle ordering so prompt rejection immediately enters failed/manual fallback state, re-enables the action, and cannot be overwritten by a later choice settlement. Accepted outcomes now render an installed state and keep repeat activation from implying another prompt is available. Added focused regressions for both final review findings; focused and full Vitest suites pass.
2026-07-29: Stabilized Android manual fallback options after dismissed or failed native prompts. Repeat activation now keeps manual Android steps, derives the `查看 Android 安裝方式` action label from the effective model, and cannot imply another native prompt is available. Added regressions for repeat activation after both outcomes.

## 2026-07-30 Plan-Team Participation Navigation Final Review

### Status

DONE

### Files Changed

- `index.html`
- `js/copy/zh-Hant.js`
- `js/modules/plan.js`
- `scripts/reading-team-registration.test.mjs`

### Commit

- `c536e94` (`fix(plan): address team participation final review`)

### Verification

- `npx vitest --run scripts/reading-team-registration.test.mjs scripts/plan-primary-navigation.test.mjs`: PASS, 2 files and 34 tests.
- `npm test`: PASS, 49 files and 401 tests.
- `npm run build`: PASS; icon registry, config, and production bundle generated successfully.
- `git diff --check`: PASS with no whitespace errors.

### Self-Review

- Joined team-plan cards now use `db.getMyReadingTeam(plan)` contexts to switch state labels, action labels, action ordering, and behavior. Solo users open the existing team dialog with division 3 preferred; team members enter the plan team surface, including dual-division users.
- Joined-team badges retain per-division controls and now include available member/capacity counts.
- Invite-code joining retains the effective plan returned by `db.joinPresetPlan`, returns a specific failure when auto-joining the plan fails, and does not route or display success in that case.
- Invite success resets the active plan-list filter and panel visibility before entering detail. User-triggered close restores focus; route-triggered reset does not steal focus.
- The invite trigger and all panel-closing paths keep `aria-expanded` synchronized, and the trigger declares `aria-controls`.
- No backend, RPC, React-island, or button-primitive changes were introduced.

### Concerns

None.
