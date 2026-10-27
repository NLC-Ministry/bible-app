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

describe("雲柱得獎與兌換總覽（#614）", () => {
  // 公布名單（寫 lightning_quiz_week_rankings）時 trigger 自動發券：9/21 那週 member 得 2 次、other 1 次，
  // 9/28 那週 member 1 次。
  const publish = (tx, weekStart, days) => tx.query(
    `INSERT INTO public.lightning_quiz_week_rankings (week_start, entries, display_days, display_until)
     VALUES ($1::date, $2::jsonb, 1, $1::date + 7)
     ON CONFLICT (week_start) DO UPDATE SET entries = EXCLUDED.entries`,
    [weekStart, JSON.stringify(days.map(([riseDate, winners]) => ({
      riseDate,
      winners: winners.map((userId, index) => ({ rank: index + 1, userId, name: "得獎者", pastoralZone: "牧區 A-1", elapsedMs: 4000 + index }))
    })))]
  );
  const seedVouchers = async tx => {
    await publish(tx, "2026-09-21", [["2026-09-21", [ids.member, ids.other]], ["2026-09-23", [ids.member]]]);
    await publish(tx, "2026-09-28", [["2026-09-28", [ids.member]]]);
    const { rows } = await tx.query(
      `SELECT id, user_id, rise_date::text AS rise_date, expires_on::text AS expires_on FROM public.lightning_quiz_vouchers ORDER BY rise_date, rank`
    );
    return rows;
  };
  const plusDays = async (tx, days) => (await tx.query(
    `SELECT ((NOW() AT TIME ZONE 'Asia/Taipei')::date + $1::int)::text AS d`, [days]
  )).rows[0].d;
  const setExpiry = (tx, voucherIds, expiresOn, actorId) => tx.query(
    `SELECT public.admin_set_lightning_quiz_vouchers_expiry($1::uuid[], $2::date, $3) AS result`,
    [voucherIds, expiresOn, actorId]
  );

  it("改期限只有管理員能做；client 不能直接呼叫（只給 service_role）", async () => {
    await expect(asService(async tx => {
      const [voucher] = await seedVouchers(tx);
      await setExpiry(tx, [voucher.id], await plusDays(tx, 10), ids.member);
    })).rejects.toThrow(/lightning_quiz_admin_required/);
    await expect(as("authenticated", { sub: ids.adminAuth }, tx =>
      tx.query(`SELECT public.admin_set_lightning_quiz_vouchers_expiry(ARRAY[]::uuid[], CURRENT_DATE, NULL)`)
    )).rejects.toThrow(/permission denied/);
  });

  it("只改未兌換、未作廢的；過期的延長後變回可使用，跳過的張數照實回傳", async () => {
    const outcome = await asService(async tx => {
      const [expired, redeemed, voided, available] = await seedVouchers(tx);
      await tx.query(`UPDATE public.lightning_quiz_vouchers SET expires_on = (NOW() AT TIME ZONE 'Asia/Taipei')::date - 1 WHERE id = $1`, [expired.id]);
      await tx.query(`UPDATE public.lightning_quiz_vouchers SET redeemed_at = now(), redeemed_via = 'self' WHERE id = $1`, [redeemed.id]);
      await tx.query(`UPDATE public.lightning_quiz_vouchers SET voided_at = now() WHERE id = $1`, [voided.id]);
      const newDate = await plusDays(tx, 40);
      const { rows: [{ result }] } = await setExpiry(tx, [expired.id, redeemed.id, voided.id, available.id, expired.id], newDate, ids.admin);
      const { rows } = await tx.query(`SELECT id, expires_on::text AS expires_on FROM public.lightning_quiz_vouchers`);
      const { rows: [{ list }] } = await tx.query(`SELECT public.admin_list_lightning_quiz_vouchers(NULL, $1) AS list`, [ids.admin]);
      return { result, newDate, before: { expired, redeemed, voided, available }, after: Object.fromEntries(rows.map(r => [r.id, r.expires_on])), list };
    });
    // 重複的 id 只算一次
    expect(outcome.result).toEqual({ expiresOn: outcome.newDate, updated: 2, skipped: 2 });
    expect(outcome.after[outcome.before.expired.id]).toBe(outcome.newDate);
    expect(outcome.after[outcome.before.available.id]).toBe(outcome.newDate);
    expect(outcome.after[outcome.before.redeemed.id]).toBe(outcome.before.redeemed.expires_on);
    expect(outcome.after[outcome.before.voided.id]).toBe(outcome.before.voided.expires_on);
    const listed = Object.fromEntries(outcome.list.vouchers.map(v => [v.id, v]));
    expect(listed[outcome.before.expired.id]).toMatchObject({ status: "available", userId: ids.member });
  });

  it("新日期要在今天到一年內；沒選券也擋", async () => {
    await expect(asService(async tx => {
      const [voucher] = await seedVouchers(tx);
      await setExpiry(tx, [voucher.id], await plusDays(tx, -1), ids.admin);
    })).rejects.toThrow(/lightning_quiz_voucher_invalid_expiry/);
    await expect(asService(async tx => {
      const [voucher] = await seedVouchers(tx);
      await setExpiry(tx, [voucher.id], await plusDays(tx, 366), ids.admin);
    })).rejects.toThrow(/lightning_quiz_voucher_invalid_expiry/);
    await expect(asService(tx => setExpiry(tx, [], "2026-12-31", ids.admin))).rejects.toThrow(/lightning_quiz_voucher_invalid/);
    const ok = await asService(async tx => {
      const [first, second] = await seedVouchers(tx);
      const today = await plusDays(tx, 0);
      const lastDay = await plusDays(tx, 365);
      return [(await setExpiry(tx, [first.id], today, ids.admin)).rows[0].result.updated,
        (await setExpiry(tx, [second.id], lastDay, ids.admin)).rows[0].result.updated];
    });
    expect(ok).toEqual([1, 1]);
  });

  it("重新公布名單不會蓋掉改過的期限", async () => {
    const outcome = await asService(async tx => {
      const [voucher] = await seedVouchers(tx);
      const newDate = await plusDays(tx, 100);
      await setExpiry(tx, [voucher.id], newDate, ids.admin);
      await publish(tx, "2026-09-21", [["2026-09-21", [ids.member, ids.other]], ["2026-09-23", [ids.member]]]);
      const { rows: [row] } = await tx.query(`SELECT expires_on::text AS expires_on, voided_at FROM public.lightning_quiz_vouchers WHERE id = $1`, [voucher.id]);
      return { newDate, row };
    });
    expect(outcome.row).toEqual({ expires_on: outcome.newDate, voided_at: null });
  });

  it("候選名單的 priorWins 只算這週以前、沒有作廢的券", async () => {
    const candidatesOf = async (tx, weekStart) => {
      const { rows: [{ result }] } = await tx.query(
        `SELECT public.admin_get_lightning_quiz_week_ranking($1::date, $2) AS result`, [weekStart, ids.admin]
      );
      return Object.fromEntries(result.days.flatMap(day => day.candidates).map(c => [c.userId, c.priorWins]));
    };
    const outcome = await asService(async tx => {
      const vouchers = await seedVouchers(tx);
      const question = async riseDate => (await tx.query(
        `INSERT INTO public.lightning_quiz_questions (rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, status)
         VALUES ($1, '07:00', '10:00', 'single', $2::jsonb, '0'::jsonb, 'published') RETURNING id`,
        [riseDate, JSON.stringify({ prompt: "題目", options: ["甲", "乙"] })]
      )).rows[0].id;
      const correct = (questionId, userId, ms) => tx.query(
        `INSERT INTO public.lightning_quiz_attempts (question_id, user_id, completed_at, elapsed_ms, response, is_correct)
         VALUES ($1, $2, now(), $3, '0'::jsonb, TRUE)`, [questionId, userId, ms]
      );
      const q28 = await question("2026-09-28");
      await correct(q28, ids.member, 3000);
      await correct(q28, ids.other, 3500);
      const q21 = await question("2026-09-21");
      await correct(q21, ids.member, 3000);
      const later = await candidatesOf(tx, "2026-09-28");
      const earlier = await candidatesOf(tx, "2026-09-21");
      // member 9/21 的券作廢後少算一次
      await tx.query(`UPDATE public.lightning_quiz_vouchers SET voided_at = now() WHERE id = $1`, [vouchers[0].id]);
      const afterVoid = await candidatesOf(tx, "2026-09-28");
      return { later, earlier, afterVoid };
    });
    expect(outcome.later).toEqual({ [ids.member]: 2, [ids.other]: 1 });
    // 之後的週（9/28）不算進 9/21 那週的「之前」
    expect(outcome.earlier).toEqual({ [ids.member]: 0 });
    expect(outcome.afterVoid[ids.member]).toBe(1);
  });
});

describe("雲柱更正正解（admin_set_lightning_quiz_answer_key，#616）", () => {
  // 已結束、已排程的單選題，原正解 0。member 答 1（錯）、other 答 0（對）、admin 開始了還沒送出。
  const seedQuestion = async (tx, { type = "single", payload, answerKey = 0, riseDate = "2026-09-30", status = "published" } = {}) => {
    const { rows: [{ id }] } = await tx.query(
      `INSERT INTO public.lightning_quiz_questions (rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, explanation, status)
       VALUES ($1, '07:00', '10:00', $2, $3::jsonb, $4::jsonb, '原詳解', $5) RETURNING id`,
      [riseDate, type, JSON.stringify(payload || { stem: "題目", options: ["甲", "乙", "丙"] }), JSON.stringify(answerKey), status]
    );
    return id;
  };
  const attempt = (tx, questionId, userId, response, isCorrect) => tx.query(
    response === null
      ? `INSERT INTO public.lightning_quiz_attempts (question_id, user_id) VALUES ($1, $2)`
      : `INSERT INTO public.lightning_quiz_attempts (question_id, user_id, completed_at, elapsed_ms, response, is_correct)
         VALUES ($1, $2, now(), 4000, $3::jsonb, $4)`,
    response === null ? [questionId, userId] : [questionId, userId, JSON.stringify(response), isCorrect]
  );
  const seedAnswered = async tx => {
    const questionId = await seedQuestion(tx);
    await attempt(tx, questionId, ids.member, 1, false);
    await attempt(tx, questionId, ids.other, 0, true);
    await attempt(tx, questionId, ids.admin, null, null);
    return questionId;
  };
  const correct = (tx, questionId, answerKey, actorId, explanation = null) => tx.query(
    `SELECT public.admin_set_lightning_quiz_answer_key($1, $2::jsonb, $3, $4) AS result`,
    [questionId, JSON.stringify(answerKey), explanation, actorId]
  ).then(({ rows: [{ result }] }) => result);
  const attemptsOf = async (tx, questionId) => Object.fromEntries((await tx.query(
    `SELECT user_id, is_correct, elapsed_ms FROM public.lightning_quiz_attempts WHERE question_id = $1`, [questionId]
  )).rows.map(row => [row.user_id, row]));

  it("只有系統管理員能更正；client 不能直接呼叫（只給 service_role）", async () => {
    await expect(asService(async tx => correct(tx, await seedAnswered(tx), 1, ids.member)))
      .rejects.toThrow(/lightning_quiz_admin_required/);
    await expect(as("authenticated", { sub: ids.adminAuth }, tx =>
      tx.query(`SELECT public.admin_set_lightning_quiz_answer_key(gen_random_uuid(), '1'::jsonb, NULL, NULL)`)
    )).rejects.toThrow(/permission denied/);
    await expect(as("anon", {}, tx =>
      tx.query(`SELECT public.admin_set_lightning_quiz_answer_key(gen_random_uuid(), '1'::jsonb, NULL, NULL)`)
    )).rejects.toThrow(/permission denied/);
  });

  it("更正後已送出的作答重新判對錯，秒數不動，記下最早的原始正解", async () => {
    const outcome = await asService(async tx => {
      const questionId = await seedAnswered(tx);
      const first = await correct(tx, questionId, 1, ids.admin);
      const afterFirst = await attemptsOf(tx, questionId);
      const second = await correct(tx, questionId, 2, ids.admin);
      const afterSecond = await attemptsOf(tx, questionId);
      const { rows: [question] } = await tx.query(
        `SELECT answer_key, explanation, original_answer_key, answer_corrected_by, answer_corrected_at IS NOT NULL AS corrected
         FROM public.lightning_quiz_questions WHERE id = $1`, [questionId]
      );
      return { first, afterFirst, second, afterSecond, question };
    });
    expect(outcome.first).toMatchObject({
      changed: true, answerChanged: true, explanationChanged: false, previousAnswer: 0, answerKey: 1,
      attemptsRescored: 2, becameCorrect: 1, becameWrong: 1, weekStart: "2026-09-28", weekRankingPublished: false
    });
    expect(outcome.afterFirst[ids.member]).toMatchObject({ is_correct: true, elapsed_ms: 4000 });
    expect(outcome.afterFirst[ids.other].is_correct).toBe(false);
    // 還沒送出的作答不動
    expect(outcome.afterFirst[ids.admin].is_correct).toBe(null);
    expect(outcome.second).toMatchObject({ previousAnswer: 1, answerKey: 2, becameCorrect: 0, becameWrong: 1 });
    expect(outcome.afterSecond[ids.member].is_correct).toBe(false);
    expect(outcome.question).toMatchObject({
      answer_key: 2, explanation: "原詳解", original_answer_key: 0, answer_corrected_by: ids.admin, corrected: true
    });
  });

  it("只改詳解：不重判、不標已更正；什麼都沒變就回 changed false", async () => {
    const outcome = await asService(async tx => {
      const questionId = await seedAnswered(tx);
      const same = await correct(tx, questionId, 0, ids.admin);
      const onlyExplanation = await correct(tx, questionId, 0, ids.admin, "  新詳解 ");
      const { rows: [question] } = await tx.query(
        `SELECT explanation, answer_corrected_at, original_answer_key FROM public.lightning_quiz_questions WHERE id = $1`, [questionId]
      );
      return { same, onlyExplanation, question, attempts: await attemptsOf(tx, questionId) };
    });
    expect(outcome.same).toMatchObject({ changed: false, attemptsRescored: 0 });
    expect(outcome.onlyExplanation).toMatchObject({ changed: true, answerChanged: false, explanationChanged: true, attemptsRescored: 0 });
    expect(outcome.question).toEqual({ explanation: "新詳解", answer_corrected_at: null, original_answer_key: null });
    expect(outcome.attempts[ids.member].is_correct).toBe(false);
  });

  it("草稿不走更正（照原本的編輯）；找不到題目回 not_found", async () => {
    await expect(asService(async tx => correct(tx, await seedQuestion(tx, { status: "draft" }), 1, ids.admin)))
      .rejects.toThrow(/lightning_quiz_correction_not_published/);
    await expect(asService(tx => correct(tx, "70000000-0000-4000-8000-000000000001", 1, ids.admin)))
      .rejects.toThrow(/lightning_quiz_not_found/);
  });

  it("新正解要符合題型和題目內容", async () => {
    const reject = (options, answerKey) => expect(asService(async tx => correct(tx, await seedQuestion(tx, options), answerKey, ids.admin)))
      .rejects.toThrow(/lightning_quiz_invalid_answer_key/);
    await reject({}, 3);
    await reject({}, true);
    await reject({}, [0]);
    await reject({ type: "truefalse", payload: { stem: "對嗎" }, answerKey: true }, 1);
    await reject({ type: "multiple", answerKey: [0, 1] }, []);
    await reject({ type: "multiple", answerKey: [0, 1] }, [0, 0]);
    await reject({ type: "multiple", answerKey: [0, 1] }, [0, 5]);
    const matching = { stem: "配對", left: [{ id: "L1", text: "甲" }, { id: "L2", text: "乙" }], right: [{ id: "R1", text: "一" }, { id: "R2", text: "二" }] };
    await reject({ type: "matching", payload: matching, answerKey: { L1: "R1", L2: "R2" } }, { L1: "R1" });
    await reject({ type: "matching", payload: matching, answerKey: { L1: "R1", L2: "R2" } }, { L1: "R1", L2: "R9" });
    // 左右一樣多：一對一，不能兩條線連到同一個右邊
    await reject({ type: "matching", payload: matching, answerKey: { L1: "R1", L2: "R2" } }, { L1: "R1", L2: "R1" });
    const ordering = { stem: "排序", items: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }, { id: "C", text: "丙" }] };
    await reject({ type: "ordering", payload: ordering, answerKey: ["A", "B", "C"] }, ["A", "B"]);
    await reject({ type: "ordering", payload: ordering, answerKey: ["A", "B", "C"] }, ["A", "A", "C"]);
    const menu = { stem: "點餐", items: [{ id: "I1", text: "麵包" }, { id: "I2", text: "魚" }] };
    await reject({ type: "menu", payload: menu, answerKey: { I1: 5 } }, { I1: 0 });
    await reject({ type: "menu", payload: menu, answerKey: { I1: 5 } }, { I9: 1 });
    await reject({ type: "menu", payload: menu, answerKey: { I1: 5 } }, { I1: 21 });
    await reject({ type: "menu", payload: menu, answerKey: { I1: 5 } }, { I1: 1.5 });
  });

  it("各題型都能更正並重判：多選存成排序過的、選單去掉 0、多對一配對可以重複連", async () => {
    const outcome = await asService(async tx => {
      const multiple = await seedQuestion(tx, { type: "multiple", answerKey: [0, 1], riseDate: "2026-09-29" });
      await attempt(tx, multiple, ids.member, [2, 0], false);
      const multipleResult = await correct(tx, multiple, [2, 0], ids.admin);
      const manyToOne = await seedQuestion(tx, {
        type: "matching", riseDate: "2026-09-27",
        payload: { stem: "配對", left: [{ id: "L1", text: "甲" }, { id: "L2", text: "乙" }], right: [{ id: "R1", text: "一" }] },
        answerKey: { L1: "R1", L2: "R1" }
      });
      const matchingResult = await correct(tx, manyToOne, { L1: "R1", L2: "R1" }, ids.admin, "多對一");
      const menu = await seedQuestion(tx, {
        type: "menu", riseDate: "2026-09-26",
        payload: { stem: "點餐", items: [{ id: "I1", text: "麵包" }, { id: "I2", text: "魚" }] }, answerKey: { I1: 5 }
      });
      await attempt(tx, menu, ids.member, { I1: 5, I2: 2 }, false);
      const menuResult = await correct(tx, menu, { I1: 5, I2: 2 }, ids.admin);
      const ordering = await seedQuestion(tx, {
        type: "ordering", riseDate: "2026-09-25",
        payload: { stem: "排序", items: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }] }, answerKey: ["A", "B"]
      });
      await attempt(tx, ordering, ids.member, ["B", "A"], false);
      const orderingResult = await correct(tx, ordering, ["B", "A"], ids.admin);
      const truefalse = await seedQuestion(tx, { type: "truefalse", riseDate: "2026-09-24", payload: { stem: "對嗎" }, answerKey: true });
      await attempt(tx, truefalse, ids.member, true, true);
      const truefalseResult = await correct(tx, truefalse, false, ids.admin);
      return { multipleResult, matchingResult, menuResult, orderingResult, truefalseResult };
    });
    expect(outcome.multipleResult).toMatchObject({ answerKey: [0, 2], becameCorrect: 1 });
    expect(outcome.matchingResult).toMatchObject({ answerChanged: false, explanationChanged: true });
    expect(outcome.menuResult).toMatchObject({ answerKey: { I1: 5, I2: 2 }, becameCorrect: 1 });
    expect(outcome.orderingResult).toMatchObject({ becameCorrect: 1 });
    expect(outcome.truefalseResult).toMatchObject({ becameWrong: 1 });
  });

  it("選單題的正解去掉數量 0 的項目", async () => {
    const result = await asService(async tx => {
      const menu = await seedQuestion(tx, {
        type: "menu", payload: { stem: "點餐", items: [{ id: "I1", text: "麵包" }, { id: "I2", text: "魚" }] }, answerKey: { I1: 5 }
      });
      return correct(tx, menu, { I1: 4, I2: 0 }, ids.admin);
    });
    expect(result.answerKey).toEqual({ I1: 4 });
  });

  it("那週前三名已公布過 → 回 weekRankingPublished，已公布的名單與兌換券不動", async () => {
    const outcome = await asService(async tx => {
      const questionId = await seedAnswered(tx);
      await tx.query(
        `INSERT INTO public.lightning_quiz_week_rankings (week_start, entries, display_days, display_until)
         VALUES ('2026-09-28', $1::jsonb, 1, '2026-10-06')`,
        [JSON.stringify([{ riseDate: "2026-09-30", winners: [{ rank: 1, userId: ids.other, name: "得獎者", pastoralZone: "牧區 A-1", elapsedMs: 4000 }] }])]
      );
      const result = await correct(tx, questionId, 1, ids.admin);
      const { rows: [{ entries }] } = await tx.query(`SELECT entries FROM public.lightning_quiz_week_rankings WHERE week_start = '2026-09-28'`);
      const { rows: vouchers } = await tx.query(`SELECT user_id, voided_at FROM public.lightning_quiz_vouchers WHERE week_start = '2026-09-28'`);
      return { result, entries, vouchers };
    });
    expect(outcome.result).toMatchObject({ weekStart: "2026-09-28", weekRankingPublished: true });
    expect(outcome.entries[0].winners[0].userId).toBe(ids.other);
    expect(outcome.vouchers).toEqual([{ user_id: ids.other, voided_at: null }]);
  });

  it("會友「我的測驗」帶 answerCorrected；後台清單帶更正紀錄", async () => {
    const outcome = await asService(async tx => {
      const questionId = await seedAnswered(tx);
      const historyBefore = (await tx.query(`SELECT public.get_my_lightning_quiz_history('2026-09-30', '2026-09-30', $1) AS h`, [ids.member])).rows[0].h;
      await correct(tx, questionId, 1, ids.admin);
      const history = (await tx.query(`SELECT public.get_my_lightning_quiz_history('2026-09-30', '2026-09-30', $1) AS h`, [ids.member])).rows[0].h;
      const list = (await tx.query(`SELECT public.admin_list_lightning_quiz_questions('2026-09-30', '2026-09-30', $1) AS l`, [ids.admin])).rows[0].l;
      return { historyBefore, history, list };
    });
    expect(outcome.historyBefore[0]).toMatchObject({ answerCorrected: false, result: "wrong" });
    expect(outcome.history[0]).toMatchObject({ answerCorrected: true, result: "correct", answerKey: 1 });
    expect(outcome.history[0]).not.toHaveProperty("originalAnswerKey");
    expect(outcome.list[0]).toMatchObject({ originalAnswerKey: 0, answerKey: 1 });
    expect(typeof outcome.list[0].answerCorrectedAt).toBe("string");
  });
});
