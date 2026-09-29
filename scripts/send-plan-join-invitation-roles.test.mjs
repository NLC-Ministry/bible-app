import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #343：「提醒加入計畫」的權限檢查不能再寫舊角色 senior_pastor，也要有小組長的範圍判斷。
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(root, "supabase", "migrations");
const stripComments = sql => sql.replace(/--.*$/gm, "");

// 最新一支定義 send_plan_join_invitation 的 migration（以後再改寫也會檢查到新的那支）
const latestFile = readdirSync(migrationsDir)
  .filter(name => name.endsWith(".sql"))
  .sort()
  .filter(name => readFileSync(join(migrationsDir, name), "utf8")
    .includes("CREATE OR REPLACE FUNCTION public.send_plan_join_invitation("))
  .pop();
const latest = stripComments(readFileSync(join(migrationsDir, latestFile), "utf8"));
const fn = latest.slice(latest.indexOf("CREATE OR REPLACE FUNCTION public.send_plan_join_invitation("));

describe(`send_plan_join_invitation roles (latest: ${latestFile})`, () => {
  it("uses the current pastor role code, not the retired senior_pastor", () => {
    expect(fn).not.toContain("senior_pastor");
    expect(fn).toContain("role_code NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader')");
    expect(fn).toContain("actor_profile.role_code IN ('admin', 'pastor')");
  });

  it("lets group leaders invite the same members get_unjoined_plan_members lists for them", () => {
    expect(fn).toMatch(/actor_profile\.role_code = 'group_leader'\s+AND public\.values_overlap\(\s*recipient_profile\.small_group,\s*COALESCE\(NULLIF\(actor_profile\.managed_groups, ''\), actor_profile\.small_group, ''\)/);
  });

  it("keeps grants: authenticated + service_role only", () => {
    expect(fn).toContain("REVOKE ALL ON FUNCTION public.send_plan_join_invitation(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;");
    expect(fn).toContain("GRANT EXECUTE ON FUNCTION public.send_plan_join_invitation(uuid, uuid, text, uuid) TO authenticated, service_role;");
  });
});
