# Member Context Org Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Bible app profile page's misleading local organization UI with a Member Hub-synchronized org placement display backed by the existing Supabase projection path.

**Architecture:** Keep the current Vercel Bible app on Supabase Edge Functions for this release. `nlc-session` synchronizes Member Hub context into `public.profiles`; the frontend renders 大區 / 牧區 / 小組 plus a dedicated Member Hub sync timestamp from that local projection.

**Tech Stack:** Static Bible app, plain browser JavaScript, Supabase Edge Functions, Supabase migrations, Vitest.

## Global Constraints

- The temporary architecture is `Logto -> Supabase Edge Function nlc-session -> Member Hub / Platform API -> Supabase profiles projection -> Bible app UI`.
- Member Hub remains the authority for membership and organization placement.
- The profile UI must show 大區 / 牧區 / 小組 and a sync status like `已同步自會員中心：2026-07-28 15:43`.
- The sync status must use a dedicated Member Hub context sync timestamp, not `profiles.updated_at`.
- The Bible app must not let Logto users overwrite Hub-owned organization fields locally.
- Do not replace `nlc-data` or cut over to `bible-backend` in this plan.
- Follow existing plain-script patterns; no new frontend framework or bundler dependency.

---

## File Structure

- Modify `supabase/migrations/0027_member_context_sync_metadata.sql`: add a new append-only migration for `profiles.member_context_synced_at`.
- Modify `supabase/functions/nlc-session/index.ts`: set `member_context_synced_at` on successful Member Hub projection and return it in `profile`.
- Modify `js/db.js`: persist/apply `member_context_synced_at` to `state.currentUser` and cached profile data.
- Modify `js/modules/profile.js`: render the placement display, sync timestamp, empty state, and manual refresh behavior.
- Modify `index.html`: add stable placement display markup and a refresh button inside the existing Member Hub card.
- Modify `index.css`: style the read-only placement display consistently with the current profile card.
- Add/modify tests in `scripts/`: migration, sync payload, profile UI rendering, manual refresh, and config regression coverage.

---

### Task 1: Add Member Context Sync Metadata Projection

**Files:**
- Create: `supabase/migrations/0027_member_context_sync_metadata.sql`
- Test: `scripts/member-context-sync-metadata.test.mjs`

**Interfaces:**
- Produces: `profiles.member_context_synced_at TIMESTAMP WITH TIME ZONE`
- Consumes: existing `public.profiles` table from `supabase/migrations/0001_clean_schema.sql`

- [ ] **Step 1: Write the failing migration test**

Create `scripts/member-context-sync-metadata.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const migrationPath = "supabase/migrations/0027_member_context_sync_metadata.sql";

describe("member context sync metadata migration", () => {
  it("adds a nullable sync timestamp to profiles without rewriting existing rows", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.profiles/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_context_synced_at\s+TIMESTAMP\s+WITH\s+TIME\s+ZONE/i);
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/DEFAULT\s+NOW\(\)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.profiles/i);
  });

  it("documents the column ownership", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("Member Hub context was last successfully projected");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- scripts/member-context-sync-metadata.test.mjs
```

Expected: FAIL because `0027_member_context_sync_metadata.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/0027_member_context_sync_metadata.sql`:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS member_context_synced_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.profiles.member_context_synced_at IS
  'Member Hub context was last successfully projected into this Bible app profile.';
```

- [ ] **Step 4: Run the migration test**

Run:

```bash
npm test -- scripts/member-context-sync-metadata.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0027_member_context_sync_metadata.sql scripts/member-context-sync-metadata.test.mjs
git commit -m "feat(profile): add member context sync metadata"
```

---

### Task 2: Project Sync Timestamp From nlc-session

**Files:**
- Modify: `supabase/functions/nlc-session/index.ts`
- Modify: `scripts/nlc-profile-sync.test.mjs`
- Test: `scripts/nlc-profile-sync.test.mjs`

**Interfaces:**
- Consumes: `member_context_synced_at` column from Task 1
- Produces: `profile.member_context_synced_at` in the `nlc-session` response

- [ ] **Step 1: Add a failing static sync test**

Append this test to `scripts/nlc-profile-sync.test.mjs`:

```js
import fs from "node:fs";

describe("nlc-session member context sync timestamp", () => {
  it("sets member_context_synced_at from the successful session sync timestamp", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("member_context_synced_at");
    expect(source).toMatch(/member_context_synced_at:\s*nowIso/);
    expect(source.indexOf("const nowIso = new Date().toISOString()"))
      .toBeLessThan(source.indexOf("member_context_synced_at: nowIso"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- scripts/nlc-profile-sync.test.mjs
```

Expected: FAIL because `member_context_synced_at` is not assigned.

- [ ] **Step 3: Add the projection field**

In `supabase/functions/nlc-session/index.ts`, update `profilePayload` near `last_seen_at` and `updated_at`:

```ts
    const profilePayload: Record<string, any> = {
      id: profileId,
      name: firstValue(sourceValues.name, existingProfile?.name, "NLC User"),
      email: firstValue(sourceValues.email, existingProfile?.email, null) || null,
      great_region: firstValue(sourceValues.great_region, existingProfile?.great_region),
      pastoral_zone: firstValue(sourceValues.pastoral_zone, existingProfile?.pastoral_zone),
      small_group: firstValue(sourceValues.small_group, existingProfile?.small_group),
      role: syncedRole,
      is_demo: false,
      is_active: true,
      last_seen_at: nowIso,
      member_context_synced_at: nowIso,
      updated_at: nowIso
    };
```

- [ ] **Step 4: Run the sync tests**

Run:

```bash
npm test -- scripts/nlc-profile-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/nlc-session/index.ts scripts/nlc-profile-sync.test.mjs
git commit -m "feat(profile): project member context sync timestamp"
```

---

### Task 3: Apply Sync Metadata In The Frontend Data Layer

**Files:**
- Modify: `js/db.js`
- Test: `scripts/member-context-frontend-sync.test.mjs`

**Interfaces:**
- Consumes: `profile.member_context_synced_at`
- Produces: `state.currentUser.member_context_synced_at`

- [ ] **Step 1: Write the failing frontend sync test**

Create `scripts/member-context-frontend-sync.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const dbSource = fs.readFileSync("js/db.js", "utf8");

describe("member context frontend sync metadata", () => {
  it("copies member_context_synced_at from the projected profile into state.currentUser", () => {
    expect(dbSource).toMatch(/state\.currentUser\.member_context_synced_at\s*=\s*profile\.member_context_synced_at\s*\|\|\s*""/);
  });

  it("preserves member_context_synced_at in the cached nlc profile payload", () => {
    expect(dbSource).toMatch(/localStorage\.setItem\("nlc_supabase_profile",\s*JSON\.stringify\(payload\.profile\)\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- scripts/member-context-frontend-sync.test.mjs
```

Expected: FAIL because `state.currentUser.member_context_synced_at` is not assigned.

- [ ] **Step 3: Apply the metadata in `applyNlcProfile`**

In `js/db.js`, inside `applyNlcProfile(profile, lockedFields = null)`, add this assignment after membership status is applied:

```js
    state.currentUser.member_context_synced_at = profile.member_context_synced_at || "";
```

- [ ] **Step 4: Initialize the field on auth reset**

In `auth.js`, `_resetAppAuthState()` already recreates `state.currentUser`. If implementing this task directly, also inspect `js/state.js` and add this default if `state.currentUser` is defined there:

```js
member_context_synced_at: ""
```

If `state.currentUser` is only constructed in `auth.js`, add the same field to that object.

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm test -- scripts/member-context-frontend-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run profile-adjacent tests**

Run:

```bash
npm test -- scripts/nlc-profile-sync.test.mjs scripts/member-context-frontend-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/db.js js/auth.js js/state.js scripts/member-context-frontend-sync.test.mjs
git commit -m "feat(profile): apply member context sync metadata"
```

---

### Task 4: Replace The Profile Org UI With Read-Only Member Hub Placement

**Files:**
- Modify: `index.html`
- Modify: `index.css`
- Modify: `js/modules/profile.js`
- Test: `scripts/member-context-org-placement-ui.test.mjs`

**Interfaces:**
- Consumes: `state.currentUser.great_region`, `state.currentUser.pastoral_zone`, `state.currentUser.small_group`, `state.currentUser.member_context_synced_at`
- Produces: `renderMemberHubOrgPlacement()` and `formatMemberContextSyncedAt(value)`

- [ ] **Step 1: Write the failing UI structure test**

Create `scripts/member-context-org-placement-ui.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("index.css", "utf8");
const profileJs = fs.readFileSync("js/modules/profile.js", "utf8");

describe("Member Hub org placement UI", () => {
  it("defines a read-only placement section with the required labels and sync status target", () => {
    expect(html).toContain('id="member-hub-org-placement"');
    expect(html).toContain('id="member-hub-org-great-region"');
    expect(html).toContain('id="member-hub-org-pastoral-zone"');
    expect(html).toContain('id="member-hub-org-small-group"');
    expect(html).toContain('id="member-hub-org-sync-status"');
    expect(html).toContain("大區");
    expect(html).toContain("牧區");
    expect(html).toContain("小組");
  });

  it("styles the placement section without relying on inline styles", () => {
    expect(css).toContain(".member-hub-org-placement");
    expect(css).toContain(".member-hub-org-placement__grid");
    expect(css).toContain(".member-hub-org-placement__sync");
  });

  it("renders placement values and formats the Member Hub sync timestamp", () => {
    expect(profileJs).toContain("function formatMemberContextSyncedAt");
    expect(profileJs).toContain("function renderMemberHubOrgPlacement");
    expect(profileJs).toContain("已同步自會員中心");
    expect(profileJs).toContain("尚未設定");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- scripts/member-context-org-placement-ui.test.mjs
```

Expected: FAIL because the placement section and render helpers do not exist.

- [ ] **Step 3: Add placement markup to the Member Hub card**

In `index.html`, inside `#profile-member-hub-card` after the card header and before `.member-hub-profile-card__actions`, add:

```html
                <div class="member-hub-org-placement" id="member-hub-org-placement" aria-live="polite">
                  <div class="member-hub-org-placement__grid">
                    <div class="member-hub-org-placement__item">
                      <span class="member-hub-org-placement__label">大區</span>
                      <strong class="member-hub-org-placement__value" id="member-hub-org-great-region">尚未設定</strong>
                    </div>
                    <div class="member-hub-org-placement__item">
                      <span class="member-hub-org-placement__label">牧區</span>
                      <strong class="member-hub-org-placement__value" id="member-hub-org-pastoral-zone">尚未設定</strong>
                    </div>
                    <div class="member-hub-org-placement__item">
                      <span class="member-hub-org-placement__label">小組</span>
                      <strong class="member-hub-org-placement__value" id="member-hub-org-small-group">尚未設定</strong>
                    </div>
                  </div>
                  <p class="member-hub-org-placement__sync" id="member-hub-org-sync-status">尚未同步</p>
                  <p class="member-hub-org-placement__empty hidden" id="member-hub-org-empty">
                    會員中心尚未提供完整組織歸屬，請至會員中心更新。
                  </p>
                </div>
```

- [ ] **Step 4: Add a refresh action**

In the same `.member-hub-profile-card__actions`, add this button after the Member Hub home link:

```html
                  <button type="button" class="secondary-btn member-hub-profile-card__cta" id="btn-member-hub-refresh">
                    <span class="btn-with-icon"><span class="nlc-icon nlc-icon--sm" data-icon="refresh"
                        aria-hidden="true"></span><span>重新同步</span></span>
                  </button>
```

- [ ] **Step 5: Add CSS**

Append near existing `.member-hub-profile-card` styles in `index.css`:

```css
.member-hub-org-placement {
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 0.85rem;
  background: var(--bg-soft);
}

.member-hub-org-placement__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.member-hub-org-placement__item {
  min-width: 0;
}

.member-hub-org-placement__label {
  display: block;
  font-size: 0.76rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.member-hub-org-placement__value {
  display: block;
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.member-hub-org-placement__sync,
.member-hub-org-placement__empty {
  margin: 0.65rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.45;
}

@media (max-width: 640px) {
  .member-hub-org-placement__grid {
    grid-template-columns: 1fr;
  }
}
```

If `--bg-soft` or `--radius-md` is not defined, use existing nearby token names from `index.css` instead of introducing new variables.

- [ ] **Step 6: Add render helpers**

In `js/modules/profile.js`, add these helpers near the existing Member Hub profile helpers:

```js
function formatMemberContextSyncedAt(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `已同步自會員中心：${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function renderMemberHubOrgPlacement() {
  const user = state.currentUser || {};
  const values = {
    "member-hub-org-great-region": user.great_region || "",
    "member-hub-org-pastoral-zone": user.pastoral_zone || "",
    "member-hub-org-small-group": user.small_group || ""
  };

  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value || "").trim() || "尚未設定";
  });

  const hasAnyPlacement = Object.values(values).some(value => String(value || "").trim());
  const emptyEl = document.getElementById("member-hub-org-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", hasAnyPlacement);

  const syncEl = document.getElementById("member-hub-org-sync-status");
  if (syncEl) syncEl.textContent = formatMemberContextSyncedAt(user.member_context_synced_at || "");
}
```

- [ ] **Step 7: Call the render helper**

In `renderProfileView()`, after the summary/profile values are rendered, call:

```js
  renderMemberHubOrgPlacement();
```

- [ ] **Step 8: Run the UI test**

Run:

```bash
npm test -- scripts/member-context-org-placement-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add index.html index.css js/modules/profile.js scripts/member-context-org-placement-ui.test.mjs
git commit -m "feat(profile): show member hub org placement"
```

---

### Task 5: Wire Manual Refresh And Locked Org Field Behavior

**Files:**
- Modify: `js/modules/profile.js`
- Modify: `scripts/member-context-org-placement-ui.test.mjs`
- Test: `scripts/member-context-org-placement-ui.test.mjs`

**Interfaces:**
- Consumes: `db.syncNlcSessionWithSupabase(force: boolean)`
- Produces: refresh button behavior for `#btn-member-hub-refresh`

- [ ] **Step 1: Extend the UI test for manual refresh behavior**

Append to `scripts/member-context-org-placement-ui.test.mjs`:

```js
describe("Member Hub org placement refresh", () => {
  it("wires the refresh button to force a Member Hub session sync and re-render", () => {
    expect(profileJs).toContain('document.getElementById("btn-member-hub-refresh")');
    expect(profileJs).toContain("syncNlcSessionWithSupabase(true)");
    expect(profileJs).toContain("renderMemberHubOrgPlacement()");
  });

  it("keeps Hub-owned organization fields locked for Logto users", () => {
    expect(profileJs).toContain('"great_region"');
    expect(profileJs).toContain('"pastoral_zone"');
    expect(profileJs).toContain('"small_group"');
    expect(profileJs).toContain("lockedFields.has");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- scripts/member-context-org-placement-ui.test.mjs
```

Expected: FAIL because refresh button behavior is not wired.

- [ ] **Step 3: Add refresh wiring**

In `js/modules/profile.js`, add:

```js
function wireMemberHubOrgRefresh() {
  const btn = document.getElementById("btn-member-hub-refresh");
  if (!btn || btn.dataset.wired === "true") return;
  btn.dataset.wired = "true";
  btn.addEventListener("click", async function () {
    if (typeof auth === "undefined" || !auth.isLoggedIn()) {
      if (typeof showToast === "function") showToast("目前登入方式無法同步會員中心。");
      return;
    }
    if (typeof db === "undefined" || typeof db.syncNlcSessionWithSupabase !== "function") return;
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      await db.syncNlcSessionWithSupabase(true);
      renderMemberHubOrgPlacement();
      if (typeof showToast === "function") showToast("已重新同步會員中心資料。");
    } catch (err) {
      console.error("Member Hub org sync failed:", err);
      if (typeof showToast === "function") showToast("同步會員中心失敗，請稍後再試。");
    } finally {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
  });
}
```

- [ ] **Step 4: Call refresh wiring from profile render**

In `renderProfileView()`, after `renderMemberHubOrgPlacement();`, add:

```js
  wireMemberHubOrgRefresh();
```

- [ ] **Step 5: Ensure locked fields remain disabled**

Inspect the existing locked-field block in `js/modules/profile.js`. It should disable or preserve these fields when listed in `state.profileLockedFields`:

```js
["great_region", "pastoral_zone", "small_group"]
```

If any of those fields are still editable for Logto users, update the lock logic so the form submit uses `state.currentUser` values for locked fields and the inputs/selects are disabled.

- [ ] **Step 6: Run the focused UI test**

Run:

```bash
npm test -- scripts/member-context-org-placement-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run profile sync tests**

Run:

```bash
npm test -- scripts/nlc-profile-sync.test.mjs scripts/member-context-org-placement-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/modules/profile.js scripts/member-context-org-placement-ui.test.mjs
git commit -m "feat(profile): refresh member hub org placement"
```

---

### Task 6: Final Regression Verification

**Files:**
- Modify: none unless verification exposes a bug
- Test: existing suite

**Interfaces:**
- Consumes: all prior task outputs
- Produces: validated branch ready for PR

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
npm test -- scripts/member-context-sync-metadata.test.mjs scripts/nlc-profile-sync.test.mjs scripts/member-context-frontend-sync.test.mjs scripts/member-context-org-placement-ui.test.mjs scripts/vercel-config.test.mjs scripts/nlc-data-query-order.test.mjs scripts/database-defense.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the full Bible app test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` generated.

- [ ] **Step 4: Inspect git diff for accidental secrets or generated config**

Run:

```bash
git diff -- . ':!dist' ':!config.js'
git status --short
```

Expected: no secrets, no committed `.env`, no committed generated `config.js` unless it was already tracked intentionally.

- [ ] **Step 5: Commit any verification fixes**

If Step 1-4 exposed small required fixes, commit them:

```bash
git add <exact changed files>
git commit -m "fix(profile): stabilize member context org placement"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers projection metadata, Edge Function sync, frontend state application, read-only placement UI, manual refresh, locked-field behavior, and regression tests.
- Placeholder scan: No task contains `TBD` or unspecified implementation work. The only conditional instruction is to preserve existing token names if local CSS variables differ, which is necessary because this app's CSS token inventory is existing-code dependent.
- Type consistency: The plan consistently uses `member_context_synced_at`, `renderMemberHubOrgPlacement()`, `formatMemberContextSyncedAt(value)`, and `db.syncNlcSessionWithSupabase(true)`.
