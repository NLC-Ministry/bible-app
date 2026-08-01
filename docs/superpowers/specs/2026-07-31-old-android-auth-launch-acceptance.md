# Old Android Auth Launch Acceptance (Bible App)

## Scope

This acceptance checklist validates that Bible app interactive auth satisfies Auth Launch Policy v1 on legacy Android devices.

## Devices

- Android 6.0 WebView (LINE or shared link entry)
- Android 7.x Chrome (LINE/Instagram shared link entry)
- Android 8.x–10.x Chrome (LINE/Instagram shared link entry)
- Android modern Chrome (baseline)
- LINE iOS
- iOS Safari
- PWA installed + non-installed

## Must-hold outcomes

- Interactive auth must not start in detected embedded browsers.
- Bridge is rendered once in embedded contexts with action `開啟瀏覽器繼續`.
- `openExternalBrowser=1` and `auth_bridge_attempted=1` are transport-only and are not sent as auth params.
- On manual open in browser from bridge, legacy flow resumes automatically when environment becomes allowed.
- OAuth state/nonce/PKCE are created only in the browser that performs callback validation.
- callback URL preserves query string across service-worker fallback.
- sync failures retry without forcing login; one obvious retry action is shown.
- no raw technical object/stack is shown to user.

## Scenario matrix

### Scenario A: LINE shared link on old Android

1) Open Bible app via LINE postback.
2) Bridge is shown with one primary action.
3) Tap primary action.
4) Auth completes in standard browser.
5) Return to app context.
6) Expect: successful callback + destination preserved.

### Scenario B: Instagram old Android shared link

1) Open via Instagram in-app browser.
2) Verify bridge path and no embedded start.
3) Continue in browser.
4) Expect: same flow completion and preserved `returnTo`.

### Scenario C: Old Android WebView direct entry

1) Open a direct link with injected old Android WebView UA.
2) Bridge decision must be `bridge`.
3) Return path still contains continuation + `flowId`.
4) Ensure no raw errors shown if provider errors occur.

### Scenario D: PWA installed old Android

1) Open entry in installed PWA.
2) Enter auth flow from embedded detection path.
3) Verify the auth bridge resume flow and callback handling are bypassing stale app-shell cache and keeping query params.

### Scenario E: Retry and sync

1) Simulate temporary `nlc-session` failure after successful OAuth callback.
2) Expect one retriable sync action and no automatic immediate full logout/login.
3) Token refresh occurs at most once per retry cycle.

## Stop conditions

- No old-Android row in matrix passes without verification.
- Any flow that enters embedded browser and starts OAuth directly is fail.
- Any route that strips query params or loses `flowId` during callback is fail.
