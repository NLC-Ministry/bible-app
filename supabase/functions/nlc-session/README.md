# nlc-session

Verifies the church Logto access token, upserts `profiles` and `user_identities`, and returns the current app profile.

This function does not sign Supabase JWTs. Database reads/writes after login are handled by `nlc-data`.

Required secrets:

- `NLC_LOGTO_ISSUER=https://sso.newlife.org.tw/oidc`
- `NLC_MEMBER_HUB_URL=https://member.newlife.org.tw`
- `APP_ORIGIN=https://bible.newlife.org.tw`

Supabase default secrets used automatically:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`verify_jwt` must be false because the incoming bearer/auth token is from Logto, not Supabase.
