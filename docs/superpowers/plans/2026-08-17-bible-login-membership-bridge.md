# Bible Login Membership Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a member finishes the onboarding they can do themselves, they enter the full Bible app (reader and 讀經計畫) without waiting for pastor approval or a confirmed 小組.

**Architecture:** Member Hub stays the authority. Bible reads v2 `requiredAction` / `membershipLifecycleState` from `nlc-session` and uses one user-completion predicate for both the login card and plan entry. Incomplete users stay on the same login card, which launches Hub `/member/continue?satellite=bible-app`. After they submit, Hub returns them to Bible even while review is pending. Hub still owns the forms.

**Tech Stack:** Bible vanilla JS + Vitest; Member Hub Next.js + Jest; existing auth-launch / embedded-browser transport; Node 20.

## Global Constraints

- Run every verification command under Node 20 (`nvm use` in that repo first).
- Per-repo git: `cd bible-app` or `cd mms-core` before any git/test command.
- Do not collect 姓名, 小組, or the official form inside Bible.
- Do not wait for `membershipLifecycleState === 'approved'` or `hasRequiredPlacement` to enter the app.
- `new_friend` leave-a-name alone does not finish Bible onboarding.
- 慕道友 (`pending`) and 正式會員 (`approved`) use the same door.
- Interactive auth never starts in an embedded browser.
- User-facing errors: Traditional Chinese plus a stable internal code. Never show raw error objects.
- Invented Bible names (`教會肢體`, email local-part) are never a successful login.
- Ship login coach, predicate, and Hub return together. Do not enable the coach CTA without a working satellite return.

---

## File map

### Bible (`bible-app`)

- Modify: `js/member-journey.mjs` — user-completion predicate (app door).
- Modify: `scripts/canonical-member-journey-contract.test.mjs` — new allow/block matrix.
- Create: `js/login-onboarding-gate.mjs` — login-card copy and view model.
- Create: `scripts/login-onboarding-gate.test.mjs`
- Modify: `js/utils.js` — `getPlanEligibilityBlock` uses the same predicate; no `pastoral_zone` authority; Hub-complete skips name heuristic.
- Modify: `js/app.js` — plan-gate copy only for remaining fail-closed reasons.
- Modify: `scripts/plan-eligibility-gate.test.mjs`
- Modify: `index.html` — login-card status/detail slots.
- Modify: `js/db.js` — after SSO, sync Hub, then hide gate only if predicate is null.
- Modify: `js/auth.js` — login-button click can launch Hub continue when already token-authenticated.
- Modify: `supabase/functions/nlc-session/index.ts` — stop inventing profile names.
- Modify: `scripts/lib/nlc-profile-sync.mjs` — `resolveProjectedProfileName`.
- Modify: `scripts/nlc-profile-sync.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-17-bible-login-membership-bridge-design.md` — mark approved after implementation.

### Member Hub (`mms-core`)

- Modify: `lib/member-journey-resolver.ts` — satellite return for user-complete actions; `isBibleAppSatellitePath`.
- Modify: `lib/member-journey-resolver.test.ts`
- Modify: `app/actions/onboarding-actions.ts` — reject `deferred` for bible-app continue; pass continue into official register URL.
- Modify: `app/actions/onboarding-intent.test.ts`
- Modify: `app/onboarding/page.tsx` — hide 我先看看，稍後再填 when continue is bible-app.
- Modify: `app/member/register-official/page.tsx` — honor `continue=`; 返回聖經速讀 after submit.
- Create: `components/member/satellite-return-link.tsx`
- Create: `components/member/satellite-return-link.test.tsx`

---

### Task 1: User-completion predicate (Bible)

**Files:**
- Modify: `bible-app/js/member-journey.mjs`
- Modify: `bible-app/scripts/canonical-member-journey-contract.test.mjs`

**Interfaces:**
- Consumes: existing v2 projection fields on `user`.
- Produces: `getUserOnboardingBlock(user, options?) -> { reason, requiredAction, requiredActionUrl } | null`. `getCanonicalMemberPrerequisiteBlock` becomes an alias of that function so plan-view keeps compiling.

- [ ] **Step 1: Rewrite the failing matrix in `scripts/canonical-member-journey-contract.test.mjs`**

Replace the `canonical Bible member prerequisite` describe block with:

```js
import {
  getCanonicalMemberPrerequisiteBlock,
  getUserOnboardingBlock,
  isCanonicalMemberJourneyProjection,
} from '../js/member-journey.mjs';

describe('canonical Bible user-onboarding door', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');
  const base = {
    member_context_contract_version: 2,
    member_context_membership_lifecycle_state: 'none',
    member_context_placement_state: 'missing',
    member_context_placement_workflow_state: 'none',
    member_context_has_required_placement: false,
    member_context_required_action: 'submit_membership',
    member_context_required_action_url: 'https://member.newlife.org.tw/member/continue',
    member_context_synced_at: '2026-08-14T11:59:00.000Z',
    member_context_sync_status: 'success',
  };

  it('aliases the old prerequisite helper to the user-completion door', () => {
    expect(getCanonicalMemberPrerequisiteBlock).toBe(getUserOnboardingBlock);
  });

  it('fails closed when v2 projection is missing', () => {
    expect(getUserOnboardingBlock({ name: '王大明' }, { now })).toMatchObject({
      reason: 'member_context_unavailable',
    });
  });

  it('blocks a visitor who still owes the official form', () => {
    expect(getUserOnboardingBlock(base, { now })).toMatchObject({
      reason: 'membership_application_required',
      requiredAction: 'submit_membership',
    });
  });

  it('blocks complete_profile even if lifecycle looks pending', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'pending',
      member_context_required_action: 'complete_profile',
    }, { now })).toMatchObject({ reason: 'member_profile_required' });
  });

  it('lets a pending official application in without placement', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'pending',
      member_context_required_action: 'await_membership_review',
    }, { now })).toBeNull();
  });

  it('lets a pastor-created seeker in without an official form', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'pending',
      member_context_required_action: 'submit_membership',
    }, { now })).toBeNull();
  });

  it('lets an official member in without confirmed placement', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'approved',
      member_context_required_action: 'request_placement',
    }, { now })).toBeNull();
  });

  it('lets approved + placed members in', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'approved',
      member_context_placement_state: 'active',
      member_context_has_required_placement: true,
      member_context_required_action: 'none',
    }, { now })).toBeNull();
    expect(isCanonicalMemberJourneyProjection({
      member_context_contract_version: 2,
    })).toBe(true);
  });

  it('blocks inactive and unknown actions', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'inactive',
      member_context_required_action: 'none',
    }, { now })).toMatchObject({ reason: 'inactive_membership' });
    expect(getUserOnboardingBlock({
      ...base,
      member_context_required_action: 'verify_phone',
    }, { now })).toMatchObject({ reason: 'unknown_member_hub_action' });
    expect(getUserOnboardingBlock({
      ...base,
      member_context_required_action: 'resolve_membership_record',
    }, { now })).toMatchObject({ reason: 'membership_record_inconsistent' });
  });

  it('fails closed after the projection is older than 15 minutes', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'approved',
      member_context_required_action: 'none',
      member_context_synced_at: '2026-08-14T11:40:00.000Z',
    }, { now })).toMatchObject({ reason: 'member_context_unavailable' });
  });
});
```

Keep the existing SQL/nlc-session projection describe blocks.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
cd bible-app && nvm use && npm test -- scripts/canonical-member-journey-contract.test.mjs
```

Expected: FAIL because `getUserOnboardingBlock` does not exist and the old helper still blocks missing placement.

- [ ] **Step 3: Implement the predicate**

In `js/member-journey.mjs`, add:

```js
const USER_COMPLETE_ACTIONS = new Set([
  'await_membership_review',
  'request_placement',
  'await_placement_review',
  'none',
]);

export function getUserOnboardingBlock(user, options = {}) {
  if (!user || user.is_demo) return null;
  if (!isCanonicalMemberJourneyProjection(user)) {
    return { reason: 'member_context_unavailable', requiredAction: '', requiredActionUrl: null };
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Number(options.maxAgeMs)
    : DEFAULT_MAX_PROJECTION_AGE_MS;
  const syncedAt = Date.parse(String(user?.member_context_synced_at || ''));
  const projectionAge = Number.isFinite(syncedAt) ? Math.max(0, now - syncedAt) : Infinity;
  const recovery = recoveryFields(user);

  if (projectionAge > maxAgeMs) {
    return { reason: 'member_context_unavailable', ...recovery };
  }

  const action = recovery.requiredAction;
  if (!KNOWN_REQUIRED_ACTIONS.has(action)) {
    return { reason: 'unknown_member_hub_action', ...recovery };
  }

  const membershipState = String(user?.member_context_membership_lifecycle_state || '');
  if (!KNOWN_MEMBERSHIP_STATES.has(membershipState)) {
    return { reason: 'unknown_member_hub_state', ...recovery };
  }
  if (membershipState === 'inactive') {
    return { reason: 'inactive_membership', ...recovery };
  }
  if (action === 'resolve_membership_record') {
    return { reason: 'membership_record_inconsistent', ...recovery };
  }
  if (action === 'complete_profile') {
    return { reason: 'member_profile_required', ...recovery };
  }
  if (action === 'submit_membership' && membershipState !== 'pending' && membershipState !== 'approved') {
    return { reason: 'membership_application_required', ...recovery };
  }
  if (membershipState === 'pending' || membershipState === 'approved' || USER_COMPLETE_ACTIONS.has(action)) {
    return null;
  }
  return { reason: 'unknown_member_hub_action', ...recovery };
}

export const getCanonicalMemberPrerequisiteBlock = getUserOnboardingBlock;
```

Remove the old function body that required `approved` + active placement.

- [ ] **Step 4: Re-run the focused test**

```bash
cd bible-app && npm test -- scripts/canonical-member-journey-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit in `bible-app`**

```bash
cd bible-app
git add js/member-journey.mjs scripts/canonical-member-journey-contract.test.mjs
git commit -m "$(cat <<'EOF'
feat(auth): treat user-finished Hub onboarding as the Bible app door

Pending seekers and members without confirmed placement can enter once
their own Hub work is done.
EOF
)"
```

---

### Task 2: Hub resolver returns to Bible after user-complete actions

**Files:**
- Modify: `mms-core/lib/member-journey-resolver.ts`
- Modify: `mms-core/lib/member-journey-resolver.test.ts`

**Interfaces:**
- Consumes: `RequiredAction`, existing `MemberJourneyReturn`.
- Produces: `isBibleAppSatellitePath(path: string | null | undefined): boolean`. `resolveMemberJourneyDestination` returns the registered Bible origin for `await_membership_review`, `request_placement`, `await_placement_review`, and `none` when `satellite=bible-app` is valid.

- [ ] **Step 1: Add failing resolver tests**

In `lib/member-journey-resolver.test.ts`, replace the `it.each` that currently forbids a Bible origin for pending actions. Keep Hub-internal routing when there is **no** satellite. Add:

```ts
import { isBibleAppSatellitePath } from './member-journey-resolver'

it('recognizes a bible-app continue path', () => {
  expect(isBibleAppSatellitePath('/member/continue?satellite=bible-app&returnTo=%2F')).toBe(true)
  expect(isBibleAppSatellitePath('/member')).toBe(false)
  expect(isBibleAppSatellitePath('/member/continue?satellite=evil-app&returnTo=%2F')).toBe(false)
})

it.each([
  'await_membership_review',
  'request_placement',
  'await_placement_review',
  'none',
] as const)('returns bible-app to the satellite when user work is done (%s)', (requiredAction) => {
  expect(resolveMemberJourneyDestination(
    { requiredAction, requiredActionUrl: 'https://member.newlife.org.tw/member/continue' },
    { satellite: 'bible-app', returnTo: '/' },
  )).toBe('https://bible.newlife.org.tw/')
})

it.each([
  ['submit_membership', '/member/register-official'],
  ['complete_profile', '/onboarding?next='],
  ['resolve_membership_record', '/member/journey?consistency=1'],
] as const)('keeps %s on Member Hub even for bible-app', (requiredAction, expectedPrefix) => {
  const destination = resolveMemberJourneyDestination(
    { requiredAction, requiredActionUrl: 'https://member.newlife.org.tw/member/continue' },
    { satellite: 'bible-app', returnTo: '/' },
  )
  expect(destination.startsWith(expectedPrefix)).toBe(true)
  expect(destination).not.toContain('https://bible.newlife.org.tw')
})

it('keeps pending members on Hub journey when no satellite is registered', () => {
  expect(resolveMemberJourneyDestination(
    { requiredAction: 'await_membership_review', requiredActionUrl: null },
    {},
  )).toContain('/member/journey?membership=pending')
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
cd mms-core && nvm use && pnpm test --runInBand lib/member-journey-resolver.test.ts
```

Expected: FAIL (`isBibleAppSatellitePath` missing; pending + satellite still Hub-internal).

- [ ] **Step 3: Implement**

In `lib/member-journey-resolver.ts`:

```ts
const SATELLITE_RETURN_ACTIONS: ReadonlySet<RequiredAction> = new Set([
  'await_membership_review',
  'request_placement',
  'await_placement_review',
  'none',
])

export function isBibleAppSatellitePath(path: string | null | undefined): boolean {
  if (!path || !isValidRedirectPath(path)) return false
  try {
    const url = new URL(path, 'https://member.invalid')
    return url.pathname === '/member/continue' && url.searchParams.get('satellite') === 'bible-app'
  } catch {
    return false
  }
}

export function resolveMemberJourneyDestination(
  context: ResolverContext,
  input: MemberJourneyReturn,
): string {
  const target = validatedReturn(input)
  const continuePath = buildMemberContinuePath(input)

  if (target && SATELLITE_RETURN_ACTIONS.has(context.requiredAction)) {
    return `${target.definition.origin}${target.returnPath}`
  }

  switch (context.requiredAction) {
    case 'complete_profile':
      return `/onboarding?next=${encodeURIComponent(continuePath)}`
    case 'submit_membership':
      return internalDestination('/member/register-official', continuePath)
    case 'await_membership_review':
      return internalDestination('/member/journey?membership=pending', continuePath)
    case 'resolve_membership_record':
      return internalDestination('/member/journey?consistency=1', continuePath)
    case 'request_placement':
      return internalDestination('/member/profile?placement=request', continuePath)
    case 'await_placement_review':
      return internalDestination('/member/journey?placement=pending', continuePath)
    case 'none':
      return '/member'
    default:
      return internalDestination('/member/journey?recovery=unknown', continuePath)
  }
}
```

Keep `buildMemberContinuePath` and `normalizeSatelliteReturnPath` unchanged.

- [ ] **Step 4: Re-run the focused test**

```bash
cd mms-core && pnpm test --runInBand lib/member-journey-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit in `mms-core`**

```bash
cd mms-core
git add lib/member-journey-resolver.ts lib/member-journey-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(journey): return bible-app after the member finishes Hub work

Pending review and missing placement are no longer satellite walls when
the continue context is bible-app.
EOF
)"
```

---

### Task 3: Block deferred skip for Bible continue

**Files:**
- Modify: `mms-core/app/actions/onboarding-actions.ts`
- Modify: `mms-core/app/actions/onboarding-intent.test.ts`
- Modify: `mms-core/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `isBibleAppSatellitePath`, `selectOnboardingIntent(intent, next)`.
- Produces: `deferred` returns `{ success: false, error: '請先完成會籍登記，才能返回聖經速讀。' }` when `next` is a bible-app continue path. Official intent appends `?continue=` when `next` is that path.

- [ ] **Step 1: Add failing action tests**

In `app/actions/onboarding-intent.test.ts`:

```ts
it('rejects deferred skip when returning to bible-app', async () => {
  const result = await selectOnboardingIntent(
    'deferred',
    '/member/continue?satellite=bible-app&returnTo=%2F',
  )
  expect(result).toEqual({
    success: false,
    error: '請先完成會籍登記，才能返回聖經速讀。',
  })
})

it('keeps deferred available for Member Hub-only next paths', async () => {
  const result = await selectOnboardingIntent('deferred', '/member')
  expect(result).toEqual({ success: true, redirect: '/member' })
})

it('carries bible-app continue into the official register URL', async () => {
  const next = '/member/continue?satellite=bible-app&returnTo=%2F'
  const result = await selectOnboardingIntent('official', next)
  expect(result).toEqual({
    success: true,
    redirect: `/member/register-official?continue=${encodeURIComponent(next)}`,
  })
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
cd mms-core && pnpm test --runInBand app/actions/onboarding-intent.test.ts
```

Expected: FAIL (deferred still succeeds for bible-app).

- [ ] **Step 3: Implement**

At the top of `selectOnboardingIntent` after `safeNext` is computed:

```ts
import { isBibleAppSatellitePath } from '@/lib/member-journey-resolver'

const bibleContinue = isBibleAppSatellitePath(safeNext)

if (intent === 'deferred' && bibleContinue) {
  return { success: false, error: '請先完成會籍登記，才能返回聖經速讀。' }
}
```

In the official branch, after a successful profile update:

```ts
const redirect = bibleContinue
  ? `/member/register-official?continue=${encodeURIComponent(safeNext)}`
  : '/member/register-official'
return { success: true, redirect }
```

On `app/onboarding/page.tsx`, hide the deferred button when `isBibleAppSatellitePath(safeNext)` is true. Import the helper. Do not remove the Hub-only deferred path.

- [ ] **Step 4: Re-run tests**

```bash
cd mms-core && pnpm test --runInBand app/actions/onboarding-intent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit in `mms-core`**

```bash
cd mms-core
git add app/actions/onboarding-actions.ts app/actions/onboarding-intent.test.ts app/onboarding/page.tsx
git commit -m "$(cat <<'EOF'
fix(onboarding): do not let bible-app skip official membership

Deferred browse-only completion is Hub-only. Bible continue must collect
the official form.
EOF
)"
```

---

### Task 4: Official form returns to Bible

**Files:**
- Create: `mms-core/components/member/satellite-return-link.tsx`
- Create: `mms-core/components/member/satellite-return-link.test.tsx`
- Modify: `mms-core/app/member/register-official/page.tsx`

**Interfaces:**
- Consumes: `continue` search param, `isBibleAppSatellitePath`, `isValidRedirectPath`.
- Produces: `<SatelliteReturnLink continuePath={string | null} />` rendering 返回聖經速讀 when the path is a bible-app continue URL.

- [ ] **Step 1: Write the failing component test**

`components/member/satellite-return-link.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { SatelliteReturnLink } from './satellite-return-link'

describe('SatelliteReturnLink', () => {
  it('renders a bible-app continue action', () => {
    render(
      <SatelliteReturnLink continuePath="/member/continue?satellite=bible-app&returnTo=%2F" />,
    )
    const link = screen.getByRole('link', { name: '返回聖經速讀' })
    expect(link).toHaveAttribute(
      'href',
      '/member/continue?satellite=bible-app&returnTo=%2F',
    )
  })

  it('renders nothing for a Hub-only continue path', () => {
    const view = render(<SatelliteReturnLink continuePath="/member/journey" />)
    expect(view.container).toBeEmptyDOMElement()
  })
})
```

Follow the existing Jest + Testing Library import style in `app/pastoral/members/[id]/page.test.tsx` if this file’s helpers differ; keep the assertions.

- [ ] **Step 2: Run the test and confirm RED**

```bash
cd mms-core && pnpm test --runInBand components/member/satellite-return-link.test.tsx
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement the link and wire the official success screen**

`components/member/satellite-return-link.tsx`:

```tsx
import Link from 'next/link'
import { isBibleAppSatellitePath } from '@/lib/member-journey-resolver'
import { Button } from '@/components/ui/button'

export function SatelliteReturnLink({ continuePath }: { continuePath: string | null }) {
  if (!isBibleAppSatellitePath(continuePath)) return null
  return (
    <Button asChild className="w-full">
      <Link href={continuePath}>返回聖經速讀</Link>
    </Button>
  )
}
```

On `register-official/page.tsx`:

- Import `useSearchParams` and `SatelliteReturnLink`.
- `const continuePath = searchParams.get('continue')`.
- On successful submit (`submitted === true`), render `<SatelliteReturnLink continuePath={continuePath} />` above 回到會籍旅程.
- If `isBibleAppSatellitePath(continuePath)`, `useEffect` assigns `window.location.href = continuePath` once after submit so they do not have to tap (the button remains as fallback).
- Preserve `continue` when linking internally (`REGISTER_OFFICIAL_RETURN_TO` must include the current search when a continue param exists).

- [ ] **Step 4: Re-run tests**

```bash
cd mms-core && pnpm test --runInBand components/member/satellite-return-link.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit in `mms-core`**

```bash
cd mms-core
git add components/member/satellite-return-link.tsx components/member/satellite-return-link.test.tsx app/member/register-official/page.tsx
git commit -m "$(cat <<'EOF'
feat(onboarding): send bible-app back after official submit

The success screen returns through /member/continue so pending review
can re-enter the satellite.
EOF
)"
```

---

### Task 5: Stop inventing Bible profile names

**Files:**
- Modify: `bible-app/scripts/lib/nlc-profile-sync.mjs`
- Modify: `bible-app/scripts/nlc-profile-sync.test.mjs`
- Modify: `bible-app/supabase/functions/nlc-session/index.ts`

**Interfaces:**
- Produces: `resolveProjectedProfileName({ hubName, existingName }) -> string`. Empty string when Hub has no name. Never `教會肢體` or the email local-part.

- [ ] **Step 1: Write the failing tests**

In `scripts/nlc-profile-sync.test.mjs`:

```js
import { resolveProjectedProfileName } from "./lib/nlc-profile-sync.mjs";

describe("resolveProjectedProfileName", () => {
  it("keeps a Hub name", () => {
    expect(resolveProjectedProfileName({
      hubName: "王大明",
      existingName: "教會肢體",
    })).toBe("王大明");
  });

  it("keeps a real existing name when Hub is empty", () => {
    expect(resolveProjectedProfileName({
      hubName: "",
      existingName: "王大明",
    })).toBe("王大明");
  });

  it("does not invent a name from email or 教會肢體", () => {
    expect(resolveProjectedProfileName({
      hubName: "",
      existingName: "教會肢體",
    })).toBe("");
    expect(resolveProjectedProfileName({
      hubName: null,
      existingName: "",
    })).toBe("");
  });
});
```

Also add a source assertion that `supabase/functions/nlc-session/index.ts` contains `resolveProjectedProfileName` and no longer contains `lookupEmail ? lookupEmail.split("@")[0]`.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
cd bible-app && npm test -- scripts/nlc-profile-sync.test.mjs
```

Expected: FAIL (`resolveProjectedProfileName` missing).

- [ ] **Step 3: Implement**

In `scripts/lib/nlc-profile-sync.mjs`:

```js
const INVENTED_PROFILE_NAMES = new Set(["教會肢體", "NLC User", "新使用者", "尚未取得姓名", "未命名使用者"]);

export function resolveProjectedProfileName({ hubName, existingName }) {
  const hub = String(hubName || "").trim();
  if (hub && !INVENTED_PROFILE_NAMES.has(hub)) return hub;
  const existing = String(existingName || "").trim();
  if (existing && !INVENTED_PROFILE_NAMES.has(existing)) return existing;
  return "";
}
```

In `nlc-session/index.ts`, import/copy the helper the same way other sync helpers are duplicated (see the file header: keep in sync via tests). Replace:

```ts
const nextProfileName = firstValue(sourceValues.name, existingProfile?.name, lookupEmail ? lookupEmail.split("@")[0] : null, "教會肢體");
```

with:

```ts
const nextProfileName = resolveProjectedProfileName({
  hubName: sourceValues.name,
  existingName: existingProfile?.name,
});
```

If `nextProfileName` is `""`, still write `name: ""` (or null if the column allows). Do not skip the profile upsert.

- [ ] **Step 4: Re-run tests**

```bash
cd bible-app && npm test -- scripts/nlc-profile-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit in `bible-app`**

```bash
cd bible-app
git add scripts/lib/nlc-profile-sync.mjs scripts/nlc-profile-sync.test.mjs supabase/functions/nlc-session/index.ts
git commit -m "$(cat <<'EOF'
fix(session): stop inventing a Bible profile name

Empty Hub names stay empty so login cannot treat 教會肢體 or an email
prefix as finished onboarding.
EOF
)"
```

---

### Task 6: Login card becomes the onboarding coach

**Files:**
- Create: `bible-app/js/login-onboarding-gate.mjs`
- Create: `bible-app/scripts/login-onboarding-gate.test.mjs`
- Modify: `bible-app/index.html`
- Modify: `bible-app/js/db.js`
- Modify: `bible-app/js/auth.js` (only if the gate button must switch from SSO to Hub continue)

**Interfaces:**
- Consumes: `getUserOnboardingBlock`, `auth.isLoggedIn()`, `auth.getMemberHubUrl`.
- Produces: `getLoginGateCopy(block | null, { hasTokens })` and `applyLoginGateView({ block, hasTokens, loginGate, appLayout, titleEl, subtitleEl, buttonEl })`.

- [ ] **Step 1: Write failing copy/view tests**

`scripts/login-onboarding-gate.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { getLoginGateCopy } from "../js/login-onboarding-gate.mjs";

describe("login gate copy", () => {
  it("asks anonymous users to start SSO", () => {
    const copy = getLoginGateCopy(null, { hasTokens: false });
    expect(copy.button).toBe("使用 NLC 身份登入 (SSO)");
    expect(copy.enterApp).toBe(false);
  });

  it("keeps the card up for a missing name", () => {
    const copy = getLoginGateCopy({
      reason: "member_profile_required",
      requiredActionUrl: "https://member.newlife.org.tw/member/continue",
    }, { hasTokens: true });
    expect(copy.enterApp).toBe(false);
    expect(copy.button).toContain("會員中心");
    expect(copy.subtitle).toContain("姓名");
  });

  it("keeps the card up until the official form is submitted", () => {
    const copy = getLoginGateCopy({
      reason: "membership_application_required",
    }, { hasTokens: true });
    expect(copy.enterApp).toBe(false);
    expect(copy.subtitle).toContain("會籍");
  });

  it("enters the app when Hub says user work is done", () => {
    expect(getLoginGateCopy(null, { hasTokens: true }).enterApp).toBe(true);
  });
});
```

Also add a source test that `js/db.js` calls `getUserOnboardingBlock` (or `getLoginGateCopy`) **before** `updateAuthUI` hides the gate, and that a token session with a block does not add `hidden` to `#login-gate`.

- [ ] **Step 2: Run tests and confirm RED**

```bash
cd bible-app && npm test -- scripts/login-onboarding-gate.test.mjs
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement copy + HTML + wiring**

`js/login-onboarding-gate.mjs`:

```js
export function getLoginGateCopy(block, { hasTokens } = {}) {
  if (!hasTokens) {
    return {
      enterApp: false,
      title: "新生命聖經速讀計畫",
      subtitle: "跟弟兄姊妹一起速讀聖經，登入後進度會自動同步。",
      button: "使用 NLC 身份登入 (SSO)",
      mode: "sso",
    };
  }
  if (!block) {
    return { enterApp: true, title: "", subtitle: "", button: "", mode: "enter" };
  }
  if (block.reason === "member_profile_required") {
    return {
      enterApp: false,
      title: "請先填寫姓名",
      subtitle: "帳號已建立，但會員中心還沒有姓名。請到會員中心完成資料。這不是登入失敗。",
      button: "前往會員中心填寫姓名",
      mode: "hub-continue",
    };
  }
  if (block.reason === "membership_application_required") {
    return {
      enterApp: false,
      title: "請先完成會籍登記",
      subtitle: "請先送出正式會籍申請。牧者審核可以稍後完成，送出後即可使用聖經速讀。",
      button: "前往會員中心填寫會籍",
      mode: "hub-continue",
    };
  }
  if (block.reason === "member_context_unavailable") {
    return {
      enterApp: false,
      title: "正在確認會員資料",
      subtitle: "登入已完成，但會員中心暫時無法同步。請重試，不需要重新註冊。支援代碼：MEMBER_CONTEXT_UNAVAILABLE",
      button: "重新確認會員資料",
      mode: "retry-sync",
    };
  }
  if (block.reason === "inactive_membership") {
    return {
      enterApp: false,
      title: "目前無法使用聖經速讀",
      subtitle: "您的會籍目前不是可使用狀態。請到會員中心查看，或聯繫教會同工。",
      button: "前往會員中心",
      mode: "hub-continue",
    };
  }
  return {
    enterApp: false,
    title: "需要在會員中心繼續",
    subtitle: "請由會員中心安全地繼續。不要重複註冊帳號。",
    button: "前往會員中心",
    mode: "hub-continue",
  };
}

export function hubContinueHref(auth) {
  if (auth && typeof auth.getMemberHubUrl === "function") {
    return auth.getMemberHubUrl("member/continue?satellite=bible-app&returnTo=%2F");
  }
  return "https://member.newlife.org.tw/member/continue?satellite=bible-app&returnTo=%2F";
}
```

In `index.html` `#login-gate`, give the subtitle `id="login-gate-subtitle"` so JS can replace it. Keep `#btn-gate-nlc-login`.

In `db.js` after a successful token path (the `if (auth.isLoggedIn())` block around the NLC session sync):

1. Always `syncNlcSessionWithSupabase(true)` first. On throw, do **not** call `_applyTokenProfileFallback` as a way to enter the app.
2. `const block = getUserOnboardingBlock(state.currentUser)`.
3. `const copy = getLoginGateCopy(block, { hasTokens: true })`.
4. If `copy.enterApp`, `updateAuthUI({ user: { id: ... } })` as today.
5. Else keep `#login-gate` visible, hide `.app-layout`, set subtitle/button from `copy`, store `button.dataset.loginGateMode = copy.mode`.

Change the NLC login button handler:

- `mode === "sso"` → existing `authLaunch.startInteractiveAuth`.
- `mode === "hub-continue"` → if embedded browser, use `auth._addBrowserLaunchTransportParams(hubContinueHref(auth))` then `window.location`; else `window.location.assign(hubContinueHref(auth))`. Do not start Bible OIDC again.
- `mode === "retry-sync"` → `syncNlcSessionWithSupabase(true)` then re-apply the gate.

On `visibilitychange` while the login gate is visible and tokens exist, force one sync and re-apply the predicate (same as plan-gate return sync).

- [ ] **Step 4: Run login-gate tests plus a source check that tokens no longer hide the gate unconditionally**

```bash
cd bible-app && npm test -- scripts/login-onboarding-gate.test.mjs scripts/login-auto-repair.test.mjs
```

Expected: PASS. Update `login-auto-repair.test.mjs` only if the button handler string it asserts moved; keep repair-before-login behavior.

- [ ] **Step 5: Commit in `bible-app`**

```bash
cd bible-app
git add js/login-onboarding-gate.mjs scripts/login-onboarding-gate.test.mjs index.html js/db.js js/auth.js
git commit -m "$(cat <<'EOF'
feat(auth): keep the login card until Hub onboarding is user-complete

SSO tokens are no longer enough. The same card launches Member Hub
continue when name or the official form is still owed.
EOF
)"
```

---

### Task 7: Plan-view uses the same door

**Files:**
- Modify: `bible-app/js/utils.js`
- Modify: `bible-app/js/app.js`
- Modify: `bible-app/scripts/plan-eligibility-gate.test.mjs`

**Interfaces:**
- Consumes: `getUserOnboardingBlock`.
- Produces: `getPlanEligibilityBlock` returns that result. No `pastoral_zone` authority. If the user-completion block is null, return null even when the local name heuristic flags.

- [ ] **Step 1: Update `scripts/plan-eligibility-gate.test.mjs` to the new contract**

Change the `getPlanEligibilityBlock` source test so it:

- contains `getUserOnboardingBlock` or `getCanonicalMemberPrerequisiteBlock`
- does **not** use `!String(u.pastoral_zone || "").trim()` as a blocking branch
- contains `if (!canonicalBlock) return null` (Hub-complete wins over name flags)

Change copy tests: remove “完成會員資料後即可進入計畫” / missing_zone as the membership coach. Remaining copy may exist for `member_context_unavailable`, `inactive_membership`, and unknown action only. Login card owns 姓名 / 會籍 speech.

If plan-view can still render a fail-closed gate, the Hub link must stay `member/continue?satellite=bible-app`.

- [ ] **Step 2: Run the test and confirm RED**

```bash
cd bible-app && npm test -- scripts/plan-eligibility-gate.test.mjs
```

Expected: FAIL (utils still has pastoral_zone fallback and name heuristic after a null canonical block).

- [ ] **Step 3: Implement**

Replace `getPlanEligibilityBlock` with:

```js
function getPlanEligibilityBlock(user) {
  const u = user || (typeof state !== "undefined" ? state.currentUser : null) || {};
  if (!u || u.is_demo) return null;
  return getUserOnboardingBlock(u);
}
```

In `getPlanEligibilityGateCopy`, keep only fail-closed reasons (`member_context_unavailable`, `inactive_membership`, `unknown_member_hub_action`, `unknown_member_hub_state`, `membership_record_inconsistent`). Other reasons should not appear if Task 6 hid the app; if they do, map them to the same 前往會員中心 continue URL without claiming 計畫 needs 牧區.

- [ ] **Step 4: Re-run plan and journey tests**

```bash
cd bible-app && npm test -- scripts/plan-eligibility-gate.test.mjs scripts/canonical-member-journey-contract.test.mjs scripts/login-onboarding-gate.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit in `bible-app`**

```bash
cd bible-app
git add js/utils.js js/app.js scripts/plan-eligibility-gate.test.mjs
git commit -m "$(cat <<'EOF'
fix(plans): stop using pastoral_zone as a membership wall

Plan entry now uses the same user-completion predicate as the login
card, including pending members without confirmed placement.
EOF
)"
```

---

### Task 8: Full-suite verification and spec status

**Files:**
- Modify: `bible-app/docs/superpowers/specs/2026-08-17-bible-login-membership-bridge-design.md` (Status → Approved for implementation, then Implemented when green)

- [ ] **Step 1: Run Bible tests**

```bash
cd bible-app && nvm use && npm test
```

Expected: PASS. Fix any source-string tests that still expect `教會肢體` as a written profile name or `pastoral_zone` as a gate.

- [ ] **Step 2: Run Hub focused + related tests**

```bash
cd mms-core && nvm use && pnpm test --runInBand lib/member-journey-resolver.test.ts app/actions/onboarding-intent.test.ts components/member/satellite-return-link.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Flip spec status**

Set the Bible spec status to `Implemented` only after both suites above are green. Add a one-line note at the top of the 2026-08-14 Hub journey spec: Bible app entry now uses user-completion, not `approved && hasRequiredPlacement`. Do not change Hub field semantics.

- [ ] **Step 4: Commit docs in each repo that changed**

Bible:

```bash
cd bible-app
git add docs/superpowers/specs/2026-08-17-bible-login-membership-bridge-design.md
git commit -m "$(cat <<'EOF'
docs: mark the Bible login membership bridge implemented
EOF
)"
```

Hub, if the 2026-08-14 spec note was added:

```bash
cd mms-core
git add docs/superpowers/specs/2026-08-14-canonical-member-journey-contract-design.md
git commit -m "$(cat <<'EOF'
docs: note Bible entry no longer waits for placement
EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Empty name is invalid login | 5, 6 |
| Unsubmitted official form is invalid login | 1, 6 |
| `new_friend` alone is not enough | 1 (`submit_membership` + `none`) |
| Pending application enters full app | 1, 7 |
| No wait for approved placement | 1, 2, 7 |
| Seeker and official same door | 1 |
| Login card is the coach | 6 |
| Hub owns forms | 2, 3, 4 |
| Return while review pending | 2, 4 |
| No deferred skip from Bible | 3 |
| No invented names | 5 |
| Fail closed without Hub context | 1, 6 |
| Embedded-browser transport | 6 (openExternalBrowser on Hub continue) |
| Plan-view same predicate | 7 |

## Placeholder / type check

- `getUserOnboardingBlock` is the only app-door name. `getCanonicalMemberPrerequisiteBlock` is an alias.
- `isBibleAppSatellitePath` is the only continue detector.
- `resolveProjectedProfileName` is the only name writer for nlc-session.
- No TBD / later / similar-to-task-N leftovers.
