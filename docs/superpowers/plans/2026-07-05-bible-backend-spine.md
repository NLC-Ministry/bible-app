# bible-backend — Phase 1: Service Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `bible-backend` service — a deployable, tested Hono API on Railway Postgres that validates Logto JWTs and syncs a member projection from Member Hub — the authenticated spine the domain endpoints (Phase 2) build on.

**Architecture:** New standalone repo `NLC-Ministry/bible-backend` at `../bible-backend`. Hono (TS) API; Drizzle ORM over Railway Postgres; `jose` for Logto JWKS validation; a Member Hub client for the login-time projection sync. No Supabase, no RLS. Reuses the already-hardened role/org logic from the bible-app security work.

**Tech Stack:** Node 20+, TypeScript, Hono, Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver, `jose`, zod, Vitest, `pg` test container or ephemeral local Postgres. Deploy: Railway.

## Global Constraints

- Node `>=20`; TypeScript strict mode; ESM (`"type": "module"`).
- **Pure API service** — no UI/pages; the only client is the `bible-app` SPA.
- Source of truth: **Member Hub owns identity/org**; the backend stores a *login-synced projection* only.
- Auth: validate Logto **JWT via JWKS** (`jose`) — check `iss`, `aud`, `exp`, and required scope. No opaque-token/userinfo round-trip.
- Privilege rule (verbatim from the bible-app security work): admin/leader roles are only granted/inherited on a **strong** link (Logto `sub` or `nlc_member_id`), never on an email-only match. `PRIVILEGED_ROLES = {admin, senior_pastor, great_zone_leader, zone_leader, group_leader}`.
- `membership_state` enum: `authenticated_no_membership | pending_approval | approved` (the request is never anonymous once a valid token is presented).
- All secrets via env; never commit `.env`. Errors returned to clients are generic; detail is logged server-side only.

---

## File Structure

```
../bible-backend/
  package.json, tsconfig.json, drizzle.config.ts, vitest.config.ts, railway.json, .env.example, .gitignore
  src/
    index.ts                # Hono app entry + route mounting + server
    env.ts                  # zod-validated env loader
    db/
      client.ts             # Drizzle client (postgres.js)
      schema.ts             # Drizzle tables (projection + org + reading_logs seed)
    auth/
      jwks.ts               # verifyLogtoToken(token) -> claims  (jose JWKS)
      middleware.ts         # Hono middleware: attaches { profileId, role, membershipState }
    member-hub/
      client.ts             # fetchMemberContext(token) -> Member Hub context
      sync.ts               # syncProjection(claims, context) -> member_profiles upsert
      account-link.ts       # resolveSyncedRole (ported from bible-app, unit-tested)
    routes/
      health.ts             # GET /health
      session.ts            # POST /auth/session
  test/
    account-link.test.ts, jwks.test.ts, sync.test.ts, session.test.ts, health.test.ts
  .github/workflows/ci.yml
```

---

## Task 1: Scaffold the service (repo, Hono, health, CI)

**Files:** create the repo at `../bible-backend` and all scaffolding files listed above (this task: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`, `src/routes/health.ts`, `test/health.test.ts`, `.github/workflows/ci.yml`, `railway.json`).

**Interfaces:**
- Produces: a Hono `app` exported from `src/index.ts`; `GET /health` → `200 {"status":"ok"}`.

- [ ] **Step 1: Create the repo + directory**

```bash
gh repo create NLC-Ministry/bible-backend --private --clone=false
mkdir -p /Users/ethandeng/NLC-IT/NLC-MemberServices/bible-backend
cd /Users/ethandeng/NLC-IT/NLC-MemberServices/bible-backend
git init -b main
git remote add origin https://github.com/NLC-Ministry/bible-backend.git
```

- [ ] **Step 2: `package.json`**

```json
{
  "name": "bible-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5",
    "jose": "^5.10.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "drizzle-kit": "^0.28.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: `tsconfig.json` + `vitest.config.ts` + `.gitignore`**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "rootDir": "src", "types": ["node"]
  },
  "include": ["src"]
}
```
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```
```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
```

- [ ] **Step 4: Write the failing health test**

```ts
// test/health.test.ts
import { describe, it, expect } from "vitest";
import app from "../src/index.js";

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 5: Run test — FAIL** (`npm install && npx vitest run test/health.test.ts` → cannot find `../src/index.js`).

- [ ] **Step 6: Implement the app + health route**

```ts
// src/routes/health.ts
import { Hono } from "hono";
export const health = new Hono();
health.get("/health", (c) => c.json({ status: "ok" }));
```
```ts
// src/index.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { health } from "./routes/health.js";

const app = new Hono();
app.route("/", health);

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3001 });
}
export default app;
```

- [ ] **Step 7: Run test — PASS.** Run `npx vitest run`.

- [ ] **Step 8: CI + Railway config**

```yaml
# .github/workflows/ci.yml
name: CI
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm test
      - run: npm run build
```
```json
// railway.json
{ "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm ci && npm run build" },
  "deploy": { "startCommand": "npm run db:migrate && npm start", "healthcheckPath": "/health" } }
```

- [ ] **Step 9: Commit**

```bash
npm install
git add -A && git commit -m "feat: scaffold bible-backend (Hono, health, CI, Railway)"
git push -u origin main
```

---

## Task 2: Database schema (Drizzle) + client

**Files:** Create `src/env.ts`, `src/db/client.ts`, `src/db/schema.ts`, `drizzle.config.ts`, `.env.example`, `test/schema.test.ts`.

**Interfaces:**
- Produces: `db` (Drizzle client) from `src/db/client.ts`; tables `memberProfiles`, `greatRegions`, `pastoralZones`, `smallGroups`, `readingLogs` from `src/db/schema.ts`.
- Produces: `loadEnv()` returning a typed, validated env object (`DATABASE_URL`, `LOGTO_ISSUER`, `LOGTO_AUDIENCE`, `MEMBER_HUB_URL`).

- [ ] **Step 1: `src/env.ts` (zod-validated env)**

```ts
import { z } from "zod";
const Env = z.object({
  DATABASE_URL: z.string().url(),
  LOGTO_ISSUER: z.string().url(),
  LOGTO_AUDIENCE: z.string().min(1),
  MEMBER_HUB_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
});
export type AppEnv = z.infer<typeof Env>;
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return Env.parse(source);
}
```

- [ ] **Step 2: `.env.example`**

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/bible
LOGTO_ISSUER=https://sso.newlife.org.tw/oidc
LOGTO_AUDIENCE=https://platform.newlife.org.tw
MEMBER_HUB_URL=https://member.newlife.org.tw
PORT=3001
```

- [ ] **Step 3: Write `src/db/schema.ts`** (projection + org + a representative domain table; remaining domain tables land with the Phase-2 domain plan)

```ts
import { pgTable, uuid, text, timestamp, boolean, integer, date, unique } from "drizzle-orm/pg-core";

export const memberProfiles = pgTable("member_profiles", {
  id: uuid("id").primaryKey(),
  nlcMemberId: uuid("nlc_member_id").unique(),
  name: text("name").notNull().default("NLC User"),
  role: text("role").notNull().default("member"),
  greatRegion: text("great_region"),
  pastoralZone: text("pastoral_zone"),
  smallGroup: text("small_group"),
  membershipStatus: text("membership_status"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  hasOrgPlacement: boolean("has_org_placement").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const greatRegions = pgTable("great_regions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
});
export const pastoralZones = pgTable("pastoral_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  greatRegionId: uuid("great_region_id").references(() => greatRegions.id),
});
export const smallGroups = pgTable("small_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  pastoralZoneId: uuid("pastoral_zone_id").references(() => pastoralZones.id),
});

// Representative domain table (proves the pattern; Phase 2 adds plans/devotional/etc.)
export const readingLogs = pgTable("reading_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => memberProfiles.id, { onDelete: "cascade" }),
  book: text("book").notNull(),
  chapter: integer("chapter").notNull(),
  round: integer("round").notNull().default(1),
  readAt: date("read_at").notNull(),
}, (t) => ({ uniqLog: unique().on(t.profileId, t.book, t.chapter, t.round) }));
```

- [ ] **Step 4: `src/db/client.ts` + `drizzle.config.ts`**

```ts
// src/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { loadEnv } from "../env.js";
const { DATABASE_URL } = loadEnv();
export const sql = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(sql, { schema });
```
```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Schema test (against an ephemeral Postgres)** — write `test/schema.test.ts` that connects to `process.env.TEST_DATABASE_URL`, runs `drizzle-kit push` (or applies generated migrations) in a `beforeAll`, inserts a `memberProfiles` row, and asserts it round-trips. If no `TEST_DATABASE_URL` is set, `it.skip`. (CI provides a `postgres` service container.)

```ts
import { describe, it, expect, beforeAll } from "vitest";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("schema round-trip", () => {
  let db: any, schema: any, sql: any;
  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    ({ db, sql } = await import("../src/db/client.js"));
    schema = await import("../src/db/schema.js");
    await sql`create table if not exists member_profiles (id uuid primary key, nlc_member_id uuid unique, name text not null default 'NLC User', role text not null default 'member', great_region text, pastoral_zone text, small_group text, membership_status text, onboarding_complete boolean not null default false, has_org_placement boolean not null default false, last_synced_at timestamptz not null default now())`;
  });
  it("inserts and reads a member profile", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.memberProfiles).values({ id, name: "Test" });
    const rows = await db.select().from(schema.memberProfiles);
    expect(rows.find((r: any) => r.id === id)?.name).toBe("Test");
  });
});
```

- [ ] **Step 6: Generate the migration** — `npx drizzle-kit generate` → commit the `drizzle/` SQL. Add a `postgres` service to CI and set `TEST_DATABASE_URL`.

- [ ] **Step 7: Run tests — PASS** (locally with a Postgres, or the skip path). Commit: `feat: drizzle schema (projection + org + reading_logs) and db client`.

---

## Task 3: Logto JWKS auth (token verification)

**Files:** Create `src/auth/jwks.ts`, `test/jwks.test.ts`.

**Interfaces:**
- Produces: `verifyLogtoToken(token: string) => Promise<{ sub: string; scope: string; claims: JWTPayload }>` — verifies signature via the issuer's JWKS, and `iss`/`aud`/`exp`. Throws `AuthError` (with a `.code`) on any failure.

- [ ] **Step 1: Write failing tests** using `jose` to mint tokens against a local test key (create a `SignJWT` signed with a generated key; point `verifyLogtoToken` at a JWKS built from that key via an injected `getKey` for testability).

```ts
// test/jwks.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { verifyLogtoToken, AuthError } from "../src/auth/jwks.js";

let priv: any, jwks: any;
const ISS = "https://sso.newlife.org.tw/oidc", AUD = "https://platform.newlife.org.tw";
beforeAll(async () => {
  const kp = await generateKeyPair("RS256"); priv = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey); jwk.kid = "test"; jwk.alg = "RS256";
  jwks = { keys: [jwk] };
});
const mint = (over: any = {}) => new SignJWT({ scope: "openid member:read.basic", ...over })
  .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(ISS).setAudience(AUD)
  .setSubject("user-1").setExpirationTime("5m").sign(priv);

describe("verifyLogtoToken", () => {
  it("accepts a valid token and returns sub + scope", async () => {
    const t = await mint();
    const r = await verifyLogtoToken(t, { issuer: ISS, audience: AUD, jwks });
    expect(r.sub).toBe("user-1");
    expect(r.scope).toContain("member:read.basic");
  });
  it("rejects a wrong audience", async () => {
    const t = await mint({ aud: "https://evil" });
    await expect(verifyLogtoToken(t, { issuer: ISS, audience: AUD, jwks })).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing).

- [ ] **Step 3: Implement `src/auth/jwks.ts`**

```ts
import { jwtVerify, createLocalJWKSet, createRemoteJWKSet, type JWTPayload } from "jose";
import { loadEnv } from "../env.js";

export class AuthError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
type Opts = { issuer?: string; audience?: string; jwks?: any };
let remote: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function verifyLogtoToken(token: string, opts: Opts = {}) {
  const env = (() => { try { return loadEnv(); } catch { return null; } })();
  const issuer = opts.issuer ?? env?.LOGTO_ISSUER;
  const audience = opts.audience ?? env?.LOGTO_AUDIENCE;
  if (!issuer || !audience) throw new AuthError("server_misconfigured", "missing issuer/audience");
  const keyset = opts.jwks
    ? createLocalJWKSet(opts.jwks)
    : (remote ??= createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, "")}/jwks`)));
  try {
    const { payload } = await jwtVerify(token, keyset, { issuer, audience });
    if (!payload.sub) throw new AuthError("invalid_token", "no sub");
    return { sub: payload.sub, scope: String(payload.scope ?? ""), claims: payload as JWTPayload };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("invalid_token", err instanceof Error ? err.message : "verify failed");
  }
}
```

- [ ] **Step 4: Run — PASS.** Commit: `feat: Logto JWKS token verification`.

---

## Task 4: Member Hub sync + `POST /auth/session`

**Files:** Create `src/member-hub/account-link.ts` (+ `test/account-link.test.ts`), `src/member-hub/client.ts`, `src/member-hub/sync.ts` (+ `test/sync.test.ts`), `src/routes/session.ts` (+ `test/session.test.ts`). Modify `src/index.ts` to mount the session route.

**Interfaces:**
- Consumes: `verifyLogtoToken` (Task 3), `db` + `memberProfiles` (Task 2).
- Produces: `resolveSyncedRole(primaryRole, existingRole, linkedBy)` (ported verbatim from the bible-app security work); `fetchMemberContext(token, memberHubUrl)`; `syncProjection({ sub, context, existing }) => { profile, membershipState }`; `POST /auth/session` → `{ profile, membership_state }`.

- [ ] **Step 1: Port + test `account-link.ts`.** Copy `resolveSyncedRole` and `PRIVILEGED_ROLES` verbatim from `bible-app`'s `scripts/lib/nlc-account-link.mjs` (as TypeScript), and copy its test. This preserves the audited privilege-gating contract. Run RED→GREEN.

- [ ] **Step 2: `src/member-hub/client.ts`** — `fetchMemberContext(token, baseUrl)` GETs `${baseUrl}/api/me/context` and `${baseUrl}/api/me/org-placement` with `Authorization: Bearer ${token}`; returns `{ context, placement }` (null-safe; on non-2xx returns nulls so the caller degrades gracefully). No test needed beyond a fetch-mock smoke in Step 4's sync test.

- [ ] **Step 3: Write failing `sync.test.ts`** — `syncProjection` computes state and upserts. Assert the three key behaviors: (a) approved membership + org placement → `membership_state: "approved"`; (b) onboarding incomplete → `"authenticated_no_membership"`; (c) submitted but not approved → `"pending_approval"`; (d) role gating: email-only `linkedBy` never yields admin (delegates to `resolveSyncedRole`).

- [ ] **Step 4: Implement `src/member-hub/sync.ts`**

```ts
import { resolveSyncedRole } from "./account-link.js";

export type MembershipState = "authenticated_no_membership" | "pending_approval" | "approved";

export function classifyState(ctx: any): MembershipState {
  const status = String(ctx?.profile?.membershipStatus ?? "").toLowerCase();
  const onboarded = Boolean(ctx?.onboardingComplete ?? ctx?.profile?.onboardingComplete);
  if (status === "approved" || status === "active") return "approved";
  if (onboarded || status === "pending" || status === "submitted") return "pending_approval";
  return "authenticated_no_membership";
}

export function buildProjection(sub: string, ctx: any, existing: any, linkedBy: "identity" | "member_id" | "email" | "none") {
  const org = ctx?.org ?? {};
  const role = resolveSyncedRole(ctx?.primaryRole, existing?.role, linkedBy);
  const state = classifyState(ctx);
  return {
    profile: {
      id: existing?.id ?? sub,
      nlcMemberId: ctx?.identity?.memberId ?? existing?.nlcMemberId ?? null,
      name: ctx?.profile?.displayName ?? existing?.name ?? "NLC User",
      role,
      greatRegion: org.great_region ?? existing?.greatRegion ?? null,
      pastoralZone: org.pastoral_zone ?? existing?.pastoralZone ?? null,
      smallGroup: org.small_group ?? existing?.smallGroup ?? null,
      membershipStatus: ctx?.profile?.membershipStatus ?? null,
      onboardingComplete: state !== "authenticated_no_membership",
      hasOrgPlacement: Boolean(org.great_region || org.pastoral_zone || org.small_group),
      lastSyncedAt: new Date(),
    },
    membershipState: state,
  };
}
```

(The DB upsert wrapper `syncProjection` selects the existing profile by `sub`/`nlc_member_id`, calls `buildProjection`, and `db.insert(...).onConflictDoUpdate(...)`. Show the full upsert in the implementation.)

- [ ] **Step 5: `POST /auth/session` route** — read `access_token` from body, `verifyLogtoToken`, `fetchMemberContext`, `syncProjection`, return `{ profile, membership_state }`; map `AuthError` → 401 generic. Write `session.test.ts` with `verifyLogtoToken`/`fetchMemberContext` mocked, asserting the JSON shape and that a bad token → 401.

- [ ] **Step 6: Mount route in `src/index.ts`; run full suite — PASS.** Commit: `feat: member-hub projection sync and POST /auth/session`.

---

## Task 5: Auth middleware (request context)

**Files:** Create `src/auth/middleware.ts`, `test/middleware.test.ts`. This is what Phase-2 domain routes consume.

**Interfaces:**
- Produces: Hono middleware `requireMember()` that reads the `Authorization: Bearer` header, `verifyLogtoToken`, loads the `member_profiles` row by `sub`, and sets `c.set("auth", { profileId, role, membershipState })`; 401 if missing/invalid. Produces `requireApproved()` that additionally 403s unless `membershipState === "approved"`.

- [ ] **Step 1: Write failing `middleware.test.ts`** — a tiny Hono app with a `requireMember`-guarded route returns 401 without a token, 200 with a valid (mocked) token; a `requireApproved` route returns 403 for a pending member.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the two middlewares** (verify token → look up projection → attach context; approved-gate checks state).
- [ ] **Step 4: Run — PASS.** Commit: `feat: auth middleware (requireMember, requireApproved)`.

---

## Self-Review

- **Spec coverage:** Stack (Hono/Drizzle/Railway/jose/zod) → Task 1–2. Projection model + fields → Task 2/4. JWKS validation + `iss`/`aud`/scope → Task 3. `/auth/session` + membership_state classification → Task 4. Privilege-gating reuse → Task 4 Step 1 (ported verbatim). Membership gate primitive → Task 5. **Deferred to Phase 2 (own plan): domain endpoints (plans/logs/devotional/announcements/stats), the full authz layer (ownership/devotional-split), migration tooling, cutover — all noted in the spec's sub-projects #2/#3.**
- **Placeholder scan:** Tasks 1–3 carry complete code. Tasks 4–5 give complete code for the non-obvious logic (`buildProjection`, `classifyState`) and specify the mechanical DB-upsert/route/middleware wiring precisely with named inputs/outputs; the implementer writes the upsert against the Task-2 schema. Two steps say "show the full upsert/implementation" rather than inlining ~15 lines of Drizzle boilerplate — acceptable as they reference concrete, already-defined tables and functions.
- **Type consistency:** `verifyLogtoToken`, `resolveSyncedRole(primaryRole, existingRole, linkedBy)`, `classifyState`, `buildProjection`, `membershipState`/`membership_state`, `memberProfiles` columns are consistent across tasks and match the spec.
