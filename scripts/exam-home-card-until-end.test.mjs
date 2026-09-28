import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 第 2 批上線前修正（#297／#298）：結束的測驗不能永遠留在首頁。
//   · 還沒結束：所有人看得到
//   · 結束後：只有有正式作答的人看得到，結束那天為止（隔天台北 00:00 拿掉）
//   · 沒作答的人：結束後就看不到
//   · 我的測驗：自己作答過的永遠查得到，另外列出還沒結束的卷
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20260928043848_exam_home_card_until_exam_ends.sql");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

describe("_exam_home_visible", () => {
  const fn = () => fnBody("_exam_home_visible");

  it("papers that haven't ended are visible to everyone", () => {
    expect(fn()).toContain("WHEN pr.status = 'published' AND NOW() < pr.close_at THEN TRUE");
  });

  it("drafts are never visible", () => {
    expect(fn()).toContain("WHEN pr.status NOT IN ('published', 'closed') THEN FALSE");
  });

  it("after the end, only members with a real (non-trial) attempt see it, until the end of that day in Taipei", () => {
    expect(fn()).toContain("AND a.attempt_kind = 'official' AND NOT a.is_test)");
    expect(fn()).toContain("NOW() < ((date_trunc('day', COALESCE(pr.closed_at, pr.close_at) AT TIME ZONE 'Asia/Taipei')");
    expect(fn()).toContain("+ INTERVAL '1 day') AT TIME ZONE 'Asia/Taipei')");
  });

  it("is an internal helper (service_role only)", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._exam_home_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public._exam_home_visible(uuid, uuid) TO service_role;");
  });
});

describe("home and my exams use the rule", () => {
  it("home list and legacy banner filter through _exam_home_visible", () => {
    expect(fnBody("exam_home_exams")).toContain("WHERE pr.status IN ('published', 'closed') AND public._exam_home_visible(pr.id, actor_id)");
    expect(fnBody("exam_home_banner")).toContain("WHERE pr.status IN ('published', 'closed') AND public._exam_home_visible(pr.id, actor_id)");
  });

  it("my exams: own attempts forever, plus papers that haven't ended", () => {
    expect(fnBody("exam_my_papers")).toContain("AND (oa.id IS NOT NULL OR (pr.status = 'published' AND NOW() < pr.close_at))");
  });

  it("keeps the anon check", () => {
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});
