# Bible App Old-Android Auth Launch Compatibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bible app browser-switch and authentication flow resilient on old Android devices while preserving Auth Launch Policy v1 behavior and user-safe low-friction UX.

**Architecture:** Keep the single auth-launch boundary in the Bible app as the only entry to interactive auth. `auth-launch` creates a canonical continuation with `flowId`, routes embedded environments to a bridge flow, and performs OIDC only in the browser that will run callback validation. Existing Member Hub policy (ULID flow IDs, transport-parameter stripping, continuation validation) remains the integration contract.

**Tech Stack:** Vanilla JavaScript (ESM modules), Vitest, Logto OIDC Authorization Code + PKCE, `intent://` fallback where available, service worker, static caching.

## Global Constraints

- Node runtime for implementation work uses Node `20.x` compatibility.
- Policy version is `1`.
- Interactive auth must never intentionally start inside a detected embedded browser.
- `auth_bridge_attempted=1` and `openExternalBrowser=1` are transport/UI parameters and MUST be stripped from canonical destinations before generating OAuth state, nonce, PKCE, callback URL, or `returnTo`.
- OAuth state, nonce, and PKCE must be generated in the browser that completes authentication.
- Callback handling must verify state and nonce.
- User-facing auth/sync failures must show safe Traditional Chinese copy and stable reason codes; no raw object output.
- Old Android behavior is a first-class acceptance surface and is a no-go if unsupported.
- Bridge and callback URLs must not be rendered by stale app-shell cache that drops query parameters.

## File Structure

- Modify: `js/auth-environment.js` to adopt a stricter v1 detection model and explicit old-Android fixture coverage.
- Create: `js/auth-policy-fixtures.mjs` with full policy fixtures for Member Hub parity plus old-Android legacy variants.
- Modify: `js/auth-launch.mjs` (new module used as the single auth-launch boundary).
- Modify: `js/auth.js` to accept and preserve `AuthContinuation` and validate nonce.
- Modify: `js/db.js` to route all `auth.login()` calls through `authLaunch` and to consume structured sync-retry results.
- Modify: `scripts/auth-embedded-browser-gate.test.mjs`, `js/auth-launch.test.mjs`, `scripts/member-context-frontend-sync.test.mjs`, `scripts/service-worker-routing.test.mjs`.
- Modify: `sw.js` with explicit bypass for bridge/callback routes and query-preserving callback handling.
- Modify: app bootstrap module imports (`js/app.js`) so auth-launch is initialized with feature entry.

---

### Task 1: Add old-Android fixture matrix for policy conformance

**Files:**
- Create: `js/auth-policy-fixtures.mjs`
- Modify: `js/auth-environment.js`
- Modify: `scripts/auth-embedded-browser-gate.test.mjs`

**Interfaces:**
- Produces:
  - `AUTH_POLICY_VERSION = 1`
  - `EnvironmentFixture` with fields: `policyVersion`, `name`, `userAgent`, `expected {kind, container, browser, decision, reasonCode, confidence}`
  - `CONTINUATION_FIXTURE`-aligned `returnTo` expectations and transport stripping checks

- [ ] **Step 1: Write fixture-driven failing tests**

```javascript
import { AUTH_POLICY_V1_ENVIRONMENT_FIXTURES, AUTH_POLICY_VERSION, validateEnvironmentFixture } from "./js/auth-policy-fixtures.mjs"

it("matches every legacy and modern policy fixture", () => {
  for (const fixture of AUTH_POLICY_V1_ENVIRONMENT_FIXTURES) {
    expect(detectAuthenticationEnvironment({ userAgent: fixture.userAgent })).toMatchObject(fixture.expected)
  }
})
```

Run:

```bash
npm test -- scripts/auth-embedded-browser-gate.test.mjs
```

Expected: FAIL because fixtures and strict matcher behavior are not yet added.

- [ ] **Step 2: Add old-Android fixture set**

Include explicit fixtures for:
- `LINE Android (old)`
- `Instagram Android (old)`
- `Android WebView (old)`
- `Samsung Browser old Android`
- `Chrome Android (legacy)`
- `Unknown old Android browser with strong embedded signal`
- Existing modern fixtures: iOS/Android LINE, Instagram, Facebook, Messenger, WeChat, Android WebView, Chrome, Edge, Firefox, Safari, Samsung Internet, unknown.

Expected output: fixture object with `policyVersion: 1` and concrete `expected` values.

- [ ] **Step 3: Update current detection unit tests to strict assertion set**

Replace permissive checks (`canUseInteractiveAuth`, `app`) with:
- `kind`
- `container`
- `browser`
- `decision`
- `reasonCode`
- `confidence`

Run:

```bash
npm test -- scripts/auth-embedded-browser-gate.test.mjs
```

Expected: PASS only when all fixtures are correctly parsed and matched.

---

### Task 2: Make auth-environment model policy-conformant and old-Android-safe

**Files:**
- Modify: `js/auth-environment.js`
- Modify: `js/auth-environment.test.mjs` (if created in your branch)

**Interfaces:**
- Produces:
  - `detectAuthenticationEnvironment({ userAgent })` returning model:
    - `kind: "embedded_browser" | "standard_browser" | "unknown"`
    - `container: "line" | "instagram" | "facebook" | "messenger" | "wechat" | "android_webview" | null`
    - `browser: "chrome" | "safari" | "edge" | "firefox" | "samsung_internet" | "other" | null`
    - `decision: "bridge" | "allow"`
    - `reasonCode: "embedded_browser_unreliable" | "strong_embedded_signal" | null`

- [ ] **Step 1: Rewrite legacy API fields**

Remove old fields (`app`, `canUseInteractiveAuth`, `canAttemptExternalBrowser`) and route all callers to `decision`.

- [ ] **Step 2: Normalize old embedded signals**

For legacy Android/embedded UA forms (`/; wv)/`, `version/4.0 chrome/`, `line/` on old Android, legacy Facebook/LINE shells), map to `decision: "bridge"` and `container: "android_webview" | "line" | "instagram" | "messenger"` as appropriate.

- [ ] **Step 3: Guard unknown + strong embedded signals**

Return `decision: "bridge"` when `unknown` but strong embed signal exists; this must remain true for old Android WebView variants that are not cleanly recognized by modern regex.

Run:

```bash
npm test -- js/auth-environment.test.mjs scripts/auth-embedded-browser-gate.test.mjs
```

Expected: PASS.

---

### Task 3: Move all interactive auth into a new auth-launch boundary module

**Files:**
- Create: `js/auth-launch.mjs`
- Modify: `js/db.js`
- Modify: `js/auth.js`
- Add: `js/auth-launch.test.mjs`

**Interfaces:**
- Produces:
  - `window.authLaunch.startInteractiveAuth({ intent, returnTo, target? })`
  - `window.authLaunch.continueInteractiveAuth(continuation)`
  - `window.authLaunch.renderBridge(continuation, environment)`
  - `window.authLaunch.parseContinuationFromSearchParams(search)`

- [ ] **Step 1: Write boundary tests**

Tests must verify:
- Embedded old-Android UA does not call `auth.login()` directly.
- The route bridge path is returned/constructed with serialized continuation and `auth_bridge_attempted=1`.
- Standard Android Chrome uses normal auth call.
- The bridge has primary action `開啟瀏覽器繼續` and keeps manual fallback available.

Run:

```bash
npm test -- js/auth-launch.test.mjs
```

Expected: FAIL because new module is not implemented.

- [ ] **Step 2: Implement `js/auth-launch.mjs`**

- Parse UA with `detectAuthenticationEnvironment` and create/validate continuation through `auth-continuation`.
- For `decision === "bridge"`, route to the bridge flow with serialized continuation and retry markers.
- For `decision === "allow"`, call `auth.login(continuation)`.

- [ ] **Step 3: Wire login and account actions through boundary**

In `js/db.js`, replace any `auth.login()` action wiring with `authLaunch.startInteractiveAuth(...)` (login, retry login path, and account-center style actions where relevant).

Run:

```bash
npm test -- js/auth-launch.test.mjs scripts/auth-embedded-browser-gate.test.mjs
```

Expected: PASS.

---

### Task 4: Add continuation transport stripping + nonce binding for old Android callback paths

**Files:**
- Create: `js/auth-continuation.mjs`
- Modify: `js/auth.js`
- Create: `js/auth-callback.test.mjs`

**Interfaces:**
- Produces:
  - `createAuthContinuation({intent, returnTo, target?})`
  - `parseAuthContinuation(params)`
  - `serializeAuthContinuation(continuation)`
  - `stripAuthTransportParams(url)`
  - `cleanReturnTo(raw)`

- [ ] **Step 1: Add failing callback/continuation tests**

Add tests for:
- protocol-relative `//` returnTo rejected
- transport params removed from `returnTo`
- old Android browser with `openExternalBrowser=1&auth_bridge_attempted=1` still survives into canonical return
- callback must fail safely when nonce missing/mismatched

Run:

```bash
npm test -- js/auth-continuation.test.mjs js/auth-callback.test.mjs
```

Expected: FAIL because module/validation absent.

- [ ] **Step 2: Bind `flowId` + `nonce` transaction before callback in browser**

In `js/auth.js`, when login begins, generate `flowId`, state, verifier, and nonce in final browser and persist all three transaction values together.

- [ ] **Step 3: Validate `id_token.nonce` at callback**

Reject missing/mismatched nonce with safe Traditional Chinese reason and non-sensitive logs including `flowId`.

- [ ] **Step 4: Verify tests**

```bash
npm test -- js/auth-callback.test.mjs js/auth-continuation.test.mjs
```

Expected: PASS.

---

### Task 5: Preserve old Android bridge usability and avoid fragile launch assumptions

**Files:**
- Modify: `js/auth-launch.mjs`
- Modify: bridge initialization and auth-launch module entry points to ensure resume behavior is validated on standard-browser fallback.
- Add: `js/auth-bridge-route.test.mjs` if a route-level test exists in the app shell

**Interfaces:**
- Produces: route-usable continuation resume behavior with auto-check on standard browser decision.

- [ ] **Step 1: Write fail test for manual open behavior**

On old Android and old Android embedded paths:
- route displays bridge on embedded launch,
- opening page manually in browser resumes auth immediately when environment decision becomes allow,
- user still has explicit one-tap primary CTA.

Run:

```bash
npm test -- js/auth-launch.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement bridge with idempotent resume**

- Show one focused action first.
- Render instructions only after failed continuation.
- On bridge load, parse and validate continuation again.
- If environment is now `decision === "allow"`, immediately route through `continueInteractiveAuth()`.

- [ ] **Step 3: Verify**

```bash
npm test -- js/auth-launch.test.mjs
```

Expected: PASS.

---

### Task 6: Make sync retry an explicit non-reauth recovery path

**Files:**
- Modify: `js/db.js`
- Modify: `scripts/member-context-frontend-sync.test.mjs`

**Interfaces:**
- Produces:
  - `SyncResult`:
    - `{ status: "success", data }`
    - `{ status: "retryable_failure", stage, reasonCode }`
    - `{ status: "reauthentication_required", reasonCode }`
    - `{ status: "support_required", stage, reasonCode }`

- [ ] **Step 1: Write failing sync tests**

Coverage must include:
- temporary `nlc-session` failure keeps tokens and enables one `重新同步`.
- token refresh attempted at most once per retry cycle.
- `reauthentication_required` escalates via `authLaunch.continueInteractiveAuth`.

Run:

```bash
npm test -- scripts/member-context-frontend-sync.test.mjs
```

Expected: FAIL with current generic catch behavior.

- [ ] **Step 2: Implement structured sync result + retry UI state**

Refactor `syncNlcSessionWithSupabase(true)` and login flow error handling to return status-driven result.

- [ ] **Step 3: Verify**

```bash
npm test -- scripts/member-context-frontend-sync.test.mjs
```

Expected: PASS.

---

### Task 7: Service worker path safety for old Android + callback preservation

**Files:**
- Modify: `sw.js`
- Modify: `scripts/service-worker-routing.test.mjs`

**Interfaces:**
- Produces bypass logic for:
  - auth bridge/callback flow
  - bridge callback paths
  - callback URLs with query
  - `nlc-session`, `logto`, Line/SSO endpoints

- [ ] **Step 1: Extend SW routing tests**

Assert that on old-Android user agents, opening the auth bridge continuation URL is not served as stale cache and callback URLs keep query params during fallback.

Run:

```bash
npm test -- scripts/service-worker-routing.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Harden SW bypass rules**

Update `shouldBypassCache` to explicitly bypass auth bridge/callback and preserve query strings.

- [ ] **Step 3: Verify**

```bash
npm test -- scripts/service-worker-routing.test.mjs scripts/app-version-config.test.mjs
```

Expected: PASS.

---

### Task 8: Add old Android acceptance matrix in spec + smoke artifacts

**Files:**
- Add/update: `docs/superpowers/specs/2026-07-31-old-android-auth-launch-acceptance.md`
- Modify: `bible-app/` QA run script or plan references if any.

**Interfaces:**
- Produces a test matrix checklist for manual QA across:
  - iOS Safari
  - Android modern Chrome
  - Android old Chrome/old WebView
  - LINE iOS
  - LINE Android
  - Instagram Webview
  - PWA installed and non-installed states

- [ ] **Step 1: Add explicit acceptance criteria**

Include steps for:
- open Bible app link from LINE chat,
- bridge appears once,
- Safari/Chrome opens,
- auth succeeds,
- sync succeeds or shows only retriable action,
- callback never drops query params on old Android.

- [ ] **Step 2: Add checklist gate**

Document this checklist as required for closing implementation and release sign-off.

- [ ] **Step 3: Verify content references**

Run:

```bash
rg -n "old Android|auth launch|embedded browser|flowId|auth_bridge_attempted" docs/superpowers/plans/2026-07-31-bible-app-old-android-auth-launch-compatibility.md docs/superpowers/specs/2026-07-31-old-android-auth-launch-acceptance.md
```

Expected: PASS (all required terms present).

---

## Self-Review

1. **Spec coverage**
- Old Android UA coverage is explicitly in Task 1/2/7.
- Bridge UX and resume behavior is covered in Task 5.
- Transaction integrity (state/nonce/PKCE + flowId) covered in Task 4.
- Sync retry behavior covered in Task 6.

2. **Placeholder scan**
- No TODO placeholders used.

3. **Type consistency**
- `environment` shape used by `auth-launch` and tests uses the v1 keys from Task 2.

Plan complete and saved to `docs/superpowers/plans/2026-07-31-bible-app-old-android-auth-launch-compatibility.md`. Two execution options:

1. Subagent-Driven (recommended) — execute each task as an isolated subagent context, then review per task.
2. Inline Execution — execute task-by-task in this session and keep checkpoints.

I recommend Subagent-Driven for this because old-Android edge cases and auth boundary behavior are independent and high-risk to regress.
