import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDb } from "./lib/pglite-supabase.mjs";

// #594：在 PGlite 從空資料庫套用 supabase/migrations/ 的全部 migration，實際執行重要 RPC，把行為鎖住
//（test:changed 靠這個路徑字串，改了 migration 就會跑這支）。
// 以前測試套件沒有任何實際跑 SQL 的測試，權限守門、重算、fail closed 都只靠讀程式碼。

let db;

const ids = {
  region: "10000000-0000-4000-8000-000000000001",
  zone: "10000000-0000-4000-8000-000000000002",
  group: "10000000-0000-4000-8000-000000000003",
  admin: "20000000-0000-4000-8000-000000000001",
  member: "20000000-0000-4000-8000-000000000002",
  other: "20000000-0000-4000-8000-000000000003",
  adminAuth: "30000000-0000-4000-8000-000000000001",
  memberAuth: "30000000-0000-4000-8000-000000000002",
  plan: "40000000-0000-4000-8000-000000000001",
  quiz: "50000000-0000-4000-8000-000000000001",
  publication: "60000000-0000-4000-8000-000000000001"
};
const QUIZ_DATE = "2026-10-01";

const QUESTIONS = [
  { id: "q1", type: "single", payload: { prompt: "第一題", options: ["甲", "乙", "丙"] }, answerKey: 0, explanation: "原解說" },
  { id: "q2", type: "truefalse", payload: { prompt: "第二題" }, answerKey: true, explanation: "" }
];

const answer = (questionId, response, correct) => ({ questionId, response, correct, timeSpentSeconds: 5 });

/**
 * 以指定角色、JWT claims 執行（跟 PostgREST 一樣：SET ROLE＋request.jwt.claims），
 * 結束後一律 rollback，不影響其他測試。
 */
async function as(role, claims, fn) {
  let result;
  let failure;
  try {
    await db.transaction(async tx => {
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })]);
      await tx.exec(`SET LOCAL ROLE ${role}`);
      try {
        result = await fn(tx);
      } catch (error) {
        failure = error;
      }
      await tx.rollback();
    });
  } catch (error) {
    // PGlite 的 rollback() 會讓 transaction() 以中止結束；真正的錯誤記在 failure
    if (!failure && !/rollback|aborted/i.test(String(error?.message))) throw error;
  }
  if (failure) throw failure;
  return result;
}

const asService = fn => as("service_role", {}, fn);

async function seed() {
  const roleId = async code =>
    (await db.query(`SELECT id FROM public.role_definitions WHERE code = $1`, [code])).rows[0]?.id;
  const adminRole = await roleId("admin");
  const memberRole = await roleId("member");
  if (!adminRole || !memberRole) throw new Error("role_definitions 少了 admin／member");

  await db.query(`INSERT INTO public.great_regions (id, name) VALUES ($1, '大區 A')`, [ids.region]);
  await db.query(`INSERT INTO public.pastoral_zones (id, great_region_id, name) VALUES ($1, $2, '牧區 A-1')`, [ids.zone, ids.region]);
  await db.query(`INSERT INTO public.small_groups (id, pastoral_zone_id, name) VALUES ($1, $2, '小組 A-1-1')`, [ids.group, ids.zone]);
  // 0001 在 auth.users 上的 on_auth_user_created 讀 NEW.app_metadata（Supabase 的欄位叫 raw_app_meta_data），
  // 正式站登入走 Logto、不會新增 auth.users；這裡只要有那兩列給 profiles.auth_user_id 參照，略過 trigger。
  await db.exec(`SET session_replication_role = replica`);
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'admin@example.invalid'), ($2, 'member@example.invalid')`, [ids.adminAuth, ids.memberAuth]);
  await db.exec(`SET session_replication_role = DEFAULT`);
  const profile = (id, authId, name, role) => db.query(
    `INSERT INTO public.profiles (id, auth_user_id, name, role_id, great_region_id, pastoral_zone_id, small_group_id,
       great_region, pastoral_zone, small_group, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '大區 A', '牧區 A-1', '小組 A-1-1', TRUE)`,
    [id, authId, name, role, ids.region, ids.zone, ids.group]
  );
  await profile(ids.admin, ids.adminAuth, "測試管理員", adminRole);
  await profile(ids.member, ids.memberAuth, "測試會友 0001", memberRole);
  await profile(ids.other, null, "測試會友 0002", memberRole);

  await db.query(
    `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books) VALUES ($1, '測試計畫', '2026-09-01', '2026-12-31', ARRAY['GEN'])`,
    [ids.plan]
  );
  await db.query(
    `INSERT INTO public.daily_quizzes (id, global_plan_id, quiz_date, variant, questions, generation_status, review_status, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, 'A', $4, 'ready', 'approved', $5, now())`,
    [ids.quiz, ids.plan, QUIZ_DATE, JSON.stringify(QUESTIONS), ids.admin]
  );
  await db.query(
    `INSERT INTO public.quiz_publications (id, global_plan_id, quiz_date, quiz_id, small_group_id, published_by, publisher_role, scope_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', 'group')`,
    [ids.publication, ids.plan, QUIZ_DATE, ids.quiz, ids.group, ids.admin]
  );
  // member 答 q1=1（舊正解 0 → 錯）、q2=true（對）；other 答 q1=0（對）、q2=false（錯）。兩人都 1 分。
  const attempt = (userId, answers, score) => db.query(
    `INSERT INTO public.quiz_attempts (publication_id, user_id, answers, score, total, status, completed_at)
     VALUES ($1, $2, $3, $4, 2, 'submitted', now())`,
    [ids.publication, userId, JSON.stringify(answers), score]
  );
  await attempt(ids.member, [answer("q1", 1, false), answer("q2", true, true)], 1);
  await attempt(ids.other, [answer("q1", 0, true), answer("q2", false, false)], 1);
}

beforeAll(async () => {
  db = await createMigratedDb();
  await seed();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const setAnswerKey = (tx, answerKey, actorId) => tx.query(
  `SELECT public.set_daily_quiz_answer_key($1, $2, 'q1', $3::jsonb, NULL, $4) AS result`,
  [ids.plan, QUIZ_DATE, JSON.stringify(answerKey), actorId]
);

describe("小測驗更正答案（set_daily_quiz_answer_key，#590）", () => {
  it("只有系統管理員能更正：會友被擋", async () => {
    await expect(asService(tx => setAnswerKey(tx, 1, ids.member))).rejects.toThrow(/quiz_publish_admin_only/);
  });

  it("authenticated 不能冒用別人的身分（p_actor_id 只給 service_role）", async () => {
    await expect(as("authenticated", { sub: ids.memberAuth }, tx => setAnswerKey(tx, 1, ids.admin)))
      .rejects.toThrow(/actor_override_forbidden/);
  });

  it("authenticated 用自己的身分、但不是管理員 → 被擋", async () => {
    await expect(as("authenticated", { sub: ids.memberAuth }, tx => setAnswerKey(tx, 1, null)))
      .rejects.toThrow(/quiz_publish_admin_only/);
  });

  it("anon 完全不能執行", async () => {
    await expect(as("anon", {}, tx => setAnswerKey(tx, 1, null))).rejects.toThrow(/permission denied/);
  });

  it("更正後所有作答重新判對錯、重算分數，並記下原本的正解", async () => {
    const outcome = await asService(async tx => {
      const { rows: [{ result }] } = await setAnswerKey(tx, 1, ids.admin);
      const { rows: attempts } = await tx.query(
        `SELECT user_id, score, answers FROM public.quiz_attempts WHERE publication_id = $1 ORDER BY user_id`,
        [ids.publication]
      );
      const { rows: [{ questions }] } = await tx.query(`SELECT questions FROM public.daily_quizzes WHERE id = $1`, [ids.quiz]);
      return { result, attempts, questions };
    });

    expect(outcome.result).toMatchObject({ changed: true, previousAnswer: 0, answerKey: 1, attemptsUpdated: 2, scoresChanged: 2 });
    const byUser = Object.fromEntries(outcome.attempts.map(row => [row.user_id, row]));
    expect(byUser[ids.member].score).toBe(2);
    expect(byUser[ids.member].answers[0].correct).toBe(true);
    expect(byUser[ids.other].score).toBe(0);
    expect(byUser[ids.other].answers[0].correct).toBe(false);
    expect(outcome.questions[0].answerKey).toBe(1);
    expect(outcome.questions[0].answerCorrected).toMatchObject({ by: ids.admin, originalAnswer: 0 });
    // 其他題不動
    expect(outcome.questions[1]).toEqual(QUESTIONS[1]);

    // as() 結束後 rollback：其他測試看到的還是原本的資料
    const { rows } = await db.query(`SELECT score FROM public.quiz_attempts WHERE publication_id = $1`, [ids.publication]);
    expect(rows.map(row => row.score)).toEqual([1, 1]);
  });

  it("新正解要符合題型", async () => {
    await expect(asService(tx => setAnswerKey(tx, 5, ids.admin))).rejects.toThrow(/invalid_quiz_answer_key/);
    await expect(asService(tx => setAnswerKey(tx, true, ids.admin))).rejects.toThrow(/invalid_quiz_answer_key/);
  });

  it("已核准的題目不能直接改（只有更正 RPC 能放行）", async () => {
    await expect(asService(tx => tx.query(
      `UPDATE public.daily_quizzes SET questions = '[]'::jsonb WHERE id = $1`, [ids.quiz]
    ))).rejects.toThrow(/quiz_approval_locked/);
  });
});

describe("牧養總覽的管理範圍（get_pastoral_overview）", () => {
  const overview = (wholeChurch, visibleIds) => asService(async tx => {
    const { rows: [{ result }] } = await tx.query(
      `SELECT public.get_pastoral_overview($1, NULL, $2, $3::uuid[], $4) AS result`,
      [ids.plan, wholeChurch, visibleIds, ids.admin]
    );
    return (result?.people ?? []).map(person => person.id).sort();
  });

  it("不是全教會、可見名單是空的或 NULL → 什麼都不回（fail closed）", async () => {
    expect(await overview(false, [])).toEqual([]);
    expect(await overview(false, null)).toEqual([]);
    expect(await overview(null, null)).toEqual([]);
  });

  it("只回可見名單裡的人", async () => {
    expect(await overview(false, [ids.member])).toEqual([ids.member]);
  });

  it("全教會看得到所有啟用中的帳號", async () => {
    expect(await overview(true, null)).toEqual([ids.admin, ids.member, ids.other].sort());
  });

  it("client 不能直接呼叫（只給 service_role）", async () => {
    await expect(as("authenticated", { sub: ids.adminAuth }, tx => tx.query(
      `SELECT public.get_pastoral_overview($1, NULL, TRUE, NULL, NULL)`, [ids.plan]
    ))).rejects.toThrow(/permission denied/);
  });
});

describe("雲柱選單題（menu，#612）", () => {
  const grade = (answerKey, response) => asService(async tx =>
    (await tx.query(`SELECT public._lightning_quiz_answer_is_correct('menu', $1::jsonb, $2::jsonb) AS ok`,
      [JSON.stringify(answerKey), JSON.stringify(response)])).rows[0].ok);

  it("數量全對才算對，兩邊數量為 0 的項目都不算", async () => {
    expect(await grade({ I1: 7, I2: 7 }, { I2: 7, I1: 7 })).toBe(true);
    expect(await grade({ I1: 7, I2: 7 }, { I1: 7, I2: 7, I3: 0 })).toBe(true);
    expect(await grade({ I1: 7, I2: 7, I3: 0 }, { I1: 7, I2: 7 })).toBe(true);
    expect(await grade({ I1: 7, I2: 7 }, { I1: 7, I2: 8 })).toBe(false);
    expect(await grade({ I1: 7, I2: 7 }, { I1: 7, I2: 7, I3: 1 })).toBe(false);
    expect(await grade({ I1: 7, I2: 7 }, { I1: 7 })).toBe(false);
  });

  it("壞掉的作答（不是物件、數量是字串）判錯而不是報錯；正解全是 0 也不會被空作答判對", async () => {
    expect(await grade({ I1: 7 }, [7])).toBe(false);
    expect(await grade({ I1: 7 }, { I1: "7" })).toBe(false);
    expect(await grade({}, {})).toBe(false);
  });

  it("其他題型的判分照舊", async () => {
    const other = (type, key, response) => asService(async tx =>
      (await tx.query(`SELECT public._lightning_quiz_answer_is_correct($1, $2::jsonb, $3::jsonb) AS ok`,
        [type, JSON.stringify(key), JSON.stringify(response)])).rows[0].ok);
    expect(await other("multiple", [0, 2], [2, 0])).toBe(true);
    expect(await other("matching", { L1: "R1" }, { L1: "R1" })).toBe(true);
    expect(await other("single", 1, 0)).toBe(false);
  });

  it("題目表接受 menu 題型", async () => {
    await asService(async tx => {
      await tx.query(
        `INSERT INTO public.lightning_quiz_questions (rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key)
         VALUES ('2099-01-05', '07:00', '10:00', 'menu', $1::jsonb, $2::jsonb)`,
        [JSON.stringify({ stem: "每種潔淨的動物帶幾隻？", items: [{ id: "I1", text: "牛" }, { id: "I2", text: "豬" }] }), JSON.stringify({ I1: 7 })]
      );
    });
  });

  it("client 不能直接呼叫判分函式", async () => {
    await expect(as("authenticated", { sub: ids.memberAuth }, tx =>
      tx.query(`SELECT public._lightning_quiz_answer_is_correct('menu', '{}'::jsonb, '{}'::jsonb)`)
    )).rejects.toThrow(/permission denied/);
  });
});
