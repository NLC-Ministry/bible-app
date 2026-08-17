# Bible Login Membership Bridge

**Date:** 2026-08-17  
**Status:** Implemented  
**Project:** `bible-app` (login gate, session validity, plan entry) with Member Hub continue/return work in `mms-core`  
**Related** (Member Hub repo `mms-core`):

- `docs/superpowers/specs/2026-08-14-canonical-member-journey-contract-design.md` — Hub v2 fields stay; Bible **does not** use `approved && hasRequiredPlacement` as the app door
- `docs/superpowers/specs/2026-07-06-membership-state-contract-design.md` — Hub still records 家 placement for pastors; Bible no longer waits for it
- `docs/superpowers/specs/2026-08-16-staff-member-page-design.md` — 慕道友 with assigned 小組 is a Hub/staff fact, not a Bible gate

## Problem

Bible’s login card treats Logto tokens as success. A user can hide `#login-gate` with an empty Logto name, no Member Hub onboarding, and no submitted application. Membership work appears later as a plan-view wall that asks for Hub placement. Pastor and admin review takes time. Unbaptized people who already belong in church life are blocked as if they were incomplete.

The user’s job is to finish onboarding they can do themselves. The church’s job is to approve and confirm 小組. Those must not be the same gate.

## Product decision

**One user-completion gate.** After the member has finished every onboarding step they can do, they enter the **full** Bible app (reader and 讀經計畫). They do not wait for pastor approval, and they do not wait for an approved placement. 慕道友 (`seeker`) and 正式會員 (`official_member` / `baptized`) use the same door. Baptism is not an access axis.

This is revised Option A: keep the Hub-backed login coach; drop the second threshold that locked plans on `hasRequiredPlacement`.

## Goals

- Make empty Logto/Hub name an invalid Bible login, not a degraded signed-in session.
- Make an unsubmitted membership application an invalid Bible login.
- Let a submitted-but-pending application into the full app.
- Let a 慕道友 or 正式會員 without confirmed 小組 into the full app once their user-facing work is done.
- Keep the same login card as the coach until that work is done; do not hide it on tokens alone.
- Keep Member Hub as the only place that collects 姓名 and 會籍 / 小組 claim forms.
- Close Bible → Hub → Bible with the existing auth-launch transport and `/member/continue`.

## Non-goals

- Do not collect 姓名, 小組, or the official form inside Bible.
- Do not change Hub `membership_status` vocabulary or pastoral review.
- Do not make `claimed_home_node_id` equal `hasRequiredPlacement` in Hub. Staff pages stay honest.
- Do not wait for `membershipLifecycleState === 'approved'`.
- Do not wait for `hasRequiredPlacement` or local `pastoral_zone` to enter reader or plans.
- Do not keep the current plan-eligibility speech as a second onboarding coach.
- Do not let 我先看看，稍後再填 (`deferred`) count as finished when the person came from Bible.

## User-completion predicate

Member Hub remains the authority. Bible reads v2 journey fields (and name) from the existing `nlc-session` projection. Bible **does not** re-derive church lifecycle.

A person **may enter the full Bible app** when all of the following are true:

1. Interactive Logto authentication succeeded in a real browser (existing auth-launch / embedded-browser rules).
2. A Member Hub profile exists for this identity. Missing Hub context is `MEMBER_CONTEXT_UNAVAILABLE`, not a pass.
3. Canonical Hub name is present. `complete_profile` is not finished work. Invented Bible fallbacks (`教會肢體`, email local-part used as a name) are not a name.
4. Hub lifecycle is not `inactive`.
5. The member is not in a fail-closed recovery state (`resolve_membership_record`, unknown `requiredAction`).
6. **User-facing onboarding is done**, meaning either:
   - `requiredAction` is one of `await_membership_review`, `request_placement`, `await_placement_review`, `none`, or
   - `membershipLifecycleState` is `pending` or `approved` (already 慕道友 / 已受洗 / 正式會員, including pastor-created seekers who never filed the new official form).

A person **must stay on the login coach** when:

- `requiredAction` is `complete_profile`, or
- `requiredAction` is `submit_membership` **and** `membershipLifecycleState` is `none` (still a visitor who has not become a church-lifecycle person and has not submitted formal membership).

`new_friend` leave-a-name alone does not finish Bible onboarding. They still owe the official 會籍 form unless a pastor has already moved them to `seeker` / `baptized` / `official_member`.

Rejected formal application (`submit_membership` while still `pending`/`none` after rejection) is unfinished user work: stay on the coach and send them to Hub to resubmit.

## Login card states

Keep the existing 440px `#login-gate` card. After SSO it **stays visible** until the predicate passes. One primary action per state. No inputs on the card.

| State | Card job | Primary action |
| --- | --- | --- |
| Anonymous | Start church identity | 使用 NLC 身份登入 |
| `complete_profile` | Invalid login; name still owed | Launch Hub `/member/continue` (fills name / onboarding) |
| Visitor `submit_membership` | Invalid login; 會籍 form still owed | Launch Hub continue (official form) |
| User-complete | Hide the gate | Enter the app |
| `resolve_membership_record` / unknown action | Do not guess | Launch Hub continue; do not enter |
| `inactive` | Cannot use member reading | Hub journey / support; do not enter |
| Context unavailable | Do not fake success | Retry sync; keep gate |

Pending review copy may say 申請已送出，您可以開始使用. It must **not** say they must wait for a pastor before using the app. 小組 assignment may still show later on the profile page as Hub display, not as a lock.

On return from LINE / Hub, force one `nlc-session` sync before painting state.

## Plan entry

Once the login gate hides, **讀經計畫 uses the same predicate**. Do not re-check `hasRequiredPlacement` or `pastoral_zone` as authority.

Local org strings remain display projections. Missing 牧區 after a completed user onboarding is empty display, not a wall.

Bible-specific name-review heuristics must not override a Hub-complete name. They may still flag admin review in the directory; they must not keep a Hub-complete member on the login card.

## Browser and Hub continue

Reuse Bible `authLaunch` / continuation transport. Do not start OIDC in an embedded browser.

Incomplete users open:

```text
https://member.newlife.org.tw/member/continue?satellite=bible-app&returnTo=/
```

Hub resolver still routes to the current workflow (`/onboarding`, `/member/register-official`, journey, and so on).

**Amendment to 2026-08-14 return rule for this satellite:** after the user completes the workflow they were sent to do, Hub may return them to Bible even when `requiredAction` is still `await_membership_review`, `request_placement`, or `await_placement_review`. Waiting for `requiredAction === none` would recreate the pastor-delay wall.

Required Hub-side behavior in the same change:

- Official (and related) forms honor `continue=` / satellite return and show 返回聖經速讀 when `satellite=bible-app`.
- Onboarding **deferred** (`我先看看，稍後再填`) is not offered, or does not mark work complete, when the continue context is `bible-app`.
- Bible-only Logto login must still produce a Hub profile (JIT or equivalent). Webhook-or-nothing is not enough; missing profile fails closed on the login card.

## Relationship to Hub v1 / v2

| Field | Hub meaning (unchanged) | Bible login / plans |
| --- | --- | --- |
| `membership_status` seeker vs official_member | Faith-journey label for pastors | Ignored as a door |
| v1 `membershipState` | Placement-coupled satellite label | Not the app door |
| `hasRequiredPlacement` | Pastor-confirmed 家 | Display / staff; not the app door |
| `requiredAction` `complete_profile` / visitor `submit_membership` | User still owes Hub work | Login coach |
| `requiredAction` await / request_placement / none | Church or already-placed work | Enter app |
| `membershipLifecycleState` pending / approved | Already in church lifecycle | Enter app if named |

Hub staff UI may still caption 慕道友 vs 正式會員 and 自填小組 vs 已指派小組. That honesty stays on the member page. Bible must not wait for it.

## Error handling

User-facing Traditional Chinese plus a stable internal code:

- `MEMBER_CONTEXT_UNAVAILABLE` — retry sync; do not enter
- `MEMBER_PROFILE_REQUIRED` — `complete_profile`
- `MEMBERSHIP_APPLICATION_REQUIRED` — visitor still owes official form
- `MEMBERSHIP_RECORD_INCONSISTENT` — Hub recovery
- `MEMBERSHIP_INACTIVE` — cannot enter

Never show raw error objects. Never treat degraded `nlc-session` as a successful login.

## Test strategy

Bible:

- Token-only SSO with empty name keeps `#login-gate` and does not invent `教會肢體` as success.
- Visitor with no official application stays on the coach.
- `new_friend` only stays on the coach.
- Official application `pending` (seeker or still visitor+open formal app) hides the gate and can open plan-view.
- Seeker or official_member with `placementState=missing` hides the gate and can open plan-view.
- Pastor-created seeker (lifecycle `pending`, no official row) with a name hides the gate.
- Inactive stays blocked.
- Unknown `requiredAction` stays blocked and launches continue.
- Embedded-browser SSO still uses the existing bridge; Hub continue uses the same transport.
- Return from Hub forces one sync, then re-evaluates the predicate.

Hub:

- `/member/continue?satellite=bible-app` after official submit returns to the registered Bible origin while review is still pending.
- Deferred skip is not a valid completion for `satellite=bible-app`.
- Official form preserves satellite return.

## Rollout

Ship as one product change: login-gate predicate + plan-view predicate + Hub return-after-submit. Do not ship the coach without the return path, or users will finish the form and land in a dead Hub page.

Rollback: restore token login-gate and the previous plan-eligibility behavior. Hub continue may remain; Bible can ignore extra returns.

## Acceptance

- SSO without a Hub name is not a Bible login.
- Visitor who has not submitted official 會籍 is not a Bible login.
- Submitted pending 會籍, with or without confirmed 小組, can use reader and 讀經計畫.
- 慕道友 and 正式會員 use that same rule.
- The login card, not plan-view, is the onboarding coach.
- Hub still owns the forms. Bible only reflects `requiredAction` / lifecycle and launches continue.
