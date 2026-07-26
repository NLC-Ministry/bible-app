# NLC Edge Functions

The app uses church Logto login, not Supabase Auth, in production.

Current flow:

1. Frontend completes Logto PKCE login.
2. Frontend calls `nlc-session` with the Logto access token.
3. `nlc-session` verifies Logto userinfo and upserts `profiles` / `user_identities` with the service role.
4. Frontend uses a small client shim that calls `nlc-data` for database reads/writes.
5. `nlc-data` verifies the Logto access token on each request, resolves the current profile, and applies server-side table/action restrictions before using the Supabase service role.

Required Supabase Edge Function secrets:

```bash
NLC_LOGTO_ISSUER=https://sso.newlife.org.tw/oidc
NLC_MEMBER_HUB_URL=https://member.newlife.org.tw
NLC_PLATFORM_API_URL=https://platform.newlife.org.tw/platform/v1
APP_ORIGIN=https://bible.newlife.org.tw
```

Frontend builds should also set:

```bash
NLC_BIBLE_BACKEND_URL=https://bible-api.newlife.org.tw
```

This exposes `window.NLC_CONFIG.bibleBackendUrl` for the backend-backed session
cutover. Keep `NLC_MEMBER_HUB_URL` configured for the current `nlc-session`
bridge until the frontend no longer calls that Edge Function.

Supabase provides these default secrets automatically:

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

`NLC_SUPABASE_JWT_SECRET` is no longer required. The app no longer signs custom Supabase JWTs.

Both functions must have `verify_jwt = false` because the incoming bearer token is a Logto token, not a Supabase token.
