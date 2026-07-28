import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/0034_grant_service_role_profile_sync.sql", import.meta.url),
  "utf8"
);

describe("service-role grants for Member Hub profile sync", () => {
  it("allows nlc-session to maintain profile, identity, and org projection tables", () => {
    expect(migration).toContain("GRANT USAGE ON SCHEMA public TO service_role");

    for (const table of [
      "profiles",
      "user_identities",
      "great_regions",
      "pastoral_zones",
      "small_groups"
    ]) {
      expect(migration).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO service_role`
      );
    }
  });
});
