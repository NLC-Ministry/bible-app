# nlc-session

Verifies the church Logto access token, upserts `profiles` and `user_identities`, and returns the current app profile.

This function does not sign Supabase JWTs. Database reads/writes after login are handled by `nlc-data`.

## Sync flow

1. **Logto userinfo** — identity anchor (`sub`, email).
2. **Member Hub** `GET /api/me/context` — `memberId`, display name, membership status, coarse org.
3. **Platform API** `GET /members/{memberId}/organization` — full care chain (大區 → 牧區 → 小組).
4. **Fallback** `GET /api/me/org-placement` — when Platform org is empty; uses `home.path` only.

Org mapping helpers are duplicated from [`scripts/lib/nlc-profile-sync.mjs`](../../../scripts/lib/nlc-profile-sync.mjs) and covered by `scripts/nlc-profile-sync.test.mjs`.

## Role policy (Phase 1)

- Hub `primaryRole === "admin"` → app `admin`.
- Otherwise **preserve** existing `profiles.role` (including SQL-promoted `admin` / `senior_pastor`).
- **Phase 2 TODO:** map org-placement `leaderships[].roleName` → scoped app roles. See [Member Hub 組織定位](https://nlc-b1ffeeba.mintlify.site/api-reference/member-org-placement).

## Required secrets

- `NLC_LOGTO_ISSUER=https://sso.newlife.org.tw/oidc`
- `NLC_MEMBER_HUB_URL=https://member.newlife.org.tw`
- `NLC_PLATFORM_API_URL=https://platform.newlife.org.tw/platform/v1`
- `APP_ORIGIN=https://bible.newlife.org.tw`

Supabase default secrets used automatically:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`verify_jwt` must be false because the incoming bearer/auth token is from Logto, not Supabase.

## Frontend requirements

The SPA must request Logto tokens with `resource=https://platform.newlife.org.tw` and scopes including `member:read.basic` (see `.env.example` / `NLC_CONFIG`). Without `resource`, Logto may issue opaque tokens that Platform API rejects.

Apply migration `0008_nlc_member_id.sql` before deploy so `profiles.nlc_member_id` exists.
