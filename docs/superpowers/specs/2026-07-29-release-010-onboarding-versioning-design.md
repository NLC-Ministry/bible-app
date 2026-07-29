# Bible App 0.1.0 Onboarding And Versioning Design

**Date:** 2026-07-29
**Status:** Draft for review
**Project:** `bible-app`

## Purpose

Introduce a release-aware onboarding helper for Bible app users and establish the app's first explicit product version: `0.1.0`.

This release should stabilize the current Supabase-powered Vercel app before the future Bible backend and PostgreSQL-on-Railway architecture becomes the app's primary data platform.

## Product Versioning Decision

Use `0.1.0` for this release.

The app is useful and production-facing, but the core architecture is still intentionally transitional:

```text
Vercel static app
-> Supabase Edge Functions and database
-> Member Hub / Logto for identity and member context
```

Reserve `1.0.0` for the later milestone where Bible app has its own backend service and PostgreSQL data store on Railway, with the major runtime contracts stabilized.

Versioning goals for `0.1.0`:

- Give support staff a concrete app version to ask users for.
- Let the PWA cache update intentionally.
- Gate onboarding by release version.
- Prepare the app for future release notes and update prompts.

## Onboarding Necessity

The onboarding helper is worth shipping in `0.1.0` because it teaches three behaviors that directly affect retention:

- Installing the PWA to the home screen.
- Joining a Bible reading plan with church friends.
- Tracking reading progress over time.

This should not feel like a mandatory tutorial. It should feel like a short release guide that helps users get value from the app quickly.

## User Experience Strategy

Show the helper after successful Logto login, delayed until the initial profile/session sync has completed.

The helper must not compete with authentication, loading, or member-context sync. The trigger should be:

```text
user is logged in
AND initial session/profile sync finished
AND lastSeenOnboardingVersion !== ONBOARDING_VERSION
AND user has not dismissed this onboarding version
```

The helper should be short, dismissible, and recallable.

Required controls:

- Primary action for the current step.
- Next/back or swipe-style step navigation.
- `稍後再看` to close without completing all steps.
- `不要再顯示此版本` to dismiss the current release helper.

The helper must not block reading, plan usage, profile sync, or sign-out.

## Onboarding Content

Use three compact steps. Each step should have one clear message and one useful action.

### 1. Add To Home Screen

Title:

```text
加到主畫面
```

Body:

```text
像 App 一樣快速打開，每天讀經更方便。
```

Primary action:

```text
查看安裝方式
```

Behavior:

- If the browser supports the PWA install prompt, use it when available.
- If the install prompt is unavailable, show platform-specific instructions for iOS Safari, Android Chrome, or a generic browser fallback.
- Do not imply installation is required.

### 2. Join A Plan With Church Friends

Title:

```text
和教會朋友一起加入計畫
```

Body:

```text
到「計畫」選擇讀經計畫，和小組一起開始。
```

Primary action:

```text
前往計畫
```

Behavior:

- Close the helper.
- Navigate to the Plan tab.
- If the user has no joined plans, keep them on the plan list where joinable plans are visible.

### 3. Track Reading Progress

Title:

```text
追蹤你的讀經進度
```

Body:

```text
完成每日章節後打卡，查看個人與團體進度。
```

Primary action:

```text
查看進度
```

Behavior:

- If the user has an active plan, open the active plan progress view.
- If the user has no active plan, navigate to the Plan tab instead.

## Recall Entry Point

Add a stable recall entry under:

```text
Profile / Settings -> 使用說明
```

Recommended label:

```text
使用說明
```

Rationale:

- It is plain and respectful.
- It avoids making users feel like beginners.
- It fits the profile/settings information architecture.

Deferred secondary entry:

- A Plan page empty-state help action may be added in a later release, but it is not required for `0.1.0`.

The helper should use the same content whether opened automatically or manually. Manual opening must not modify the user's dismissal preference unless the user explicitly chooses `不要再顯示此版本`.

## Versioning Contract

Define app versioning as runtime-readable configuration, not only `package.json` metadata.

Required values:

```text
APP_VERSION=0.1.0
ONBOARDING_VERSION=0.1.0
```

Expected usage:

- `package.json.version` is the source of the product release version.
- Build/runtime config exposes `APP_VERSION` to browser code.
- Onboarding logic compares `ONBOARDING_VERSION` with local storage.
- Service worker cache naming derives from the app version and/or build id.
- Support/debug UI can display the current app version.

Recommended local storage key:

```text
bible_onboarding_seen_version
```

Recommended stored value:

```text
0.1.0
```

When the app reaches a future meaningful onboarding release, bump `ONBOARDING_VERSION`. Minor technical builds should not automatically show onboarding unless user-facing guidance changed.

## Psychological And UX Principles

Use progressive disclosure:

- Teach only the next useful action.
- Do not explain every app feature.
- Let users leave immediately.

Use timing sensitivity:

- Never show while login or sync is still active.
- Show after the app is stable and usable.

Use autonomy:

- Users can close the helper.
- Users can recall it.
- Users can suppress it for the current version.

Use value-first copy:

- Explain why an action helps the user's reading rhythm.
- Avoid system-oriented wording such as PWA, cache, release, or onboarding in user-facing text.

## Accessibility Requirements

The helper should be an accessible dialog:

- `role="dialog"` and `aria-modal="true"`.
- Clear title for the active step.
- Keyboard support for close, next, previous, and primary action.
- Focus is trapped while the dialog is open.
- Focus returns to the invoking control after close when opened manually.
- Dialog content must fit mobile and desktop without clipped buttons or overlapping text.

## Error And Edge Cases

If PWA install prompt is unavailable:

- Show manual install instructions.
- Keep the step useful instead of showing an error.

If login succeeds but profile sync fails:

- Do not auto-show onboarding yet.
- Let the app's existing sync error handling guide the user.

If local storage is unavailable:

- The helper may show once per session.
- It must not crash login or app rendering.

If a user dismisses `0.1.0`:

- Do not auto-show the `0.1.0` helper again.
- Manual recall remains available from `使用說明`.

## Testing Requirements

Add focused tests for:

- App version is `0.1.0`.
- Runtime config exposes `APP_VERSION`.
- Service worker/cache version derives from the release version or explicit build version.
- Onboarding auto-shows only after successful login and initial session/profile sync.
- Onboarding does not auto-show if `bible_onboarding_seen_version` equals `ONBOARDING_VERSION`.
- Closing with `稍後再看` hides the helper without breaking app state.
- Choosing `不要再顯示此版本` stores the current onboarding version.
- Manual recall from Profile / Settings opens the helper regardless of dismissed state.
- Primary actions navigate to the expected app areas.
- PWA install fallback copy appears when no install prompt is available.

## Out Of Scope

- Moving the app to `bible-backend`.
- Introducing Railway PostgreSQL for Bible app data.
- Designing a full release notes center.
- Adding admin-managed onboarding content.
- Rebuilding the main tab navigation.
- Forcing PWA installation.
