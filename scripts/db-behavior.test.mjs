import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDb } from "./lib/pglite-supabase.mjs";
import { PLAN_INVITE_BATCH_MAX_RECIPIENTS } from "../js/modules/admin-bulk-plan-invite.mjs";
import { createRosterApp } from "./lib/plan-stats-roster-app.mjs";
import { BIBLE_BOOK_CHAPTERS } from "../supabase/functions/_shared/progress/bible-chapters.mjs";
import { buildChurchCampaignDays, getChurchCampaignStageDefinition } from "../supabase/functions/_shared/progress/church-campaign.mjs";
import { buildRound1ReadDateMap, countLateCompletedDays } from "../supabase/functions/_shared/progress/schedule-progress.mjs";
import { computePlanScopedStreak } from "../supabase/functions/_shared/progress/team-progress.mjs";
import {
  PLAN_STATS_ROSTER_SUMMARY_RPC,
  buildPlanStatsRosterArgs,
  buildPlanStatsRosterSummaryArgs
} from "../supabase/functions/nlc-data/plan-stats-scope.ts";

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

describe("總表規則更新時的階段清理（cleanup_removed_church_campaign_stages，#634）", () => {
  const MASTER = "00000000-0000-0000-c026-000000002029";
  const stages = numbers => JSON.stringify(numbers.map(stageNo => ({ stageNo })));
  const count = async (tx, sql) => (await tx.query(sql)).rows[0].n;
  const monthlyPlans = tx => count(tx, `SELECT count(*)::int AS n FROM public.global_plans WHERE rules->>'presetKey' LIKE 'church_r1final_2026%'`);
  const stagePlans = tx => count(tx, `SELECT count(*)::int AS n FROM public.global_plans WHERE id::text LIKE '00000000-0000-0000-c026-0000000000%'`);

  /** 以資料庫擁有者身分執行，結束後一律 rollback。 */
  async function inRollback(fn) {
    let result;
    let failure;
    try {
      await db.transaction(async tx => {
        try {
          // 只看清理觸發器：最小的 stages 不夠 sync 觸發器實體化階段
          await tx.exec(`ALTER TABLE public.global_plans DISABLE TRIGGER trg_sync_church_campaign_stage_plans`);
          // 10 月利未記（月度期末賽）放一筆報名＋打卡；略過「階段未開放」的檢查
          await tx.exec(`SET LOCAL session_replication_role = replica`);
          const { rows } = await tx.query(
            `INSERT INTO public.reading_plans (user_id, global_plan_id, name, start_date, end_date, target_books)
             SELECT $1, id, name, start_date, end_date, target_books FROM public.global_plans
             WHERE rules->>'presetKey' = 'church_r1final_2026_10' RETURNING id`,
            [ids.member]
          );
          await tx.query(`INSERT INTO public.reading_logs (user_id, plan_id, book, chapter) VALUES ($1, $2, '利未記', 1)`, [ids.member, rows[0].id]);
          await tx.exec(`SET LOCAL session_replication_role = DEFAULT`);
          result = await fn(tx, rows[0].id);
        } catch (error) {
          failure = error;
        }
        await tx.rollback();
      });
    } catch (error) {
      if (!failure && !/rollback|aborted/i.test(String(error?.message))) throw error;
    }
    if (failure) throw failure;
    return result;
  }

  it("重新發布（stages 1～10）不會刪掉全教會月度期末賽和會友的報名、打卡", async () => {
    const outcome = await inRollback(async (tx, enrollmentId) => {
      const before = { monthly: await monthlyPlans(tx), stages: await stagePlans(tx) };
      await tx.query(`UPDATE public.global_plans SET rules = rules || jsonb_build_object('stages', $1::jsonb) WHERE id = $2`, [stages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), MASTER]);
      return {
        before,
        monthly: await monthlyPlans(tx),
        stages: await stagePlans(tx),
        enrollments: await count(tx, `SELECT count(*)::int AS n FROM public.reading_plans WHERE id = '${enrollmentId}'`),
        logs: await count(tx, `SELECT count(*)::int AS n FROM public.reading_logs WHERE plan_id = '${enrollmentId}'`)
      };
    });
    expect(outcome.before.monthly).toBe(4);
    expect(outcome).toMatchObject({ monthly: 4, stages: outcome.before.stages, enrollments: 1, logs: 1 });
  });

  it("總表真的移除某個階段時，照舊刪掉那個階段的計畫；月度期末賽不受影響", async () => {
    const outcome = await inRollback(async tx => {
      await tx.query(`UPDATE public.global_plans SET rules = rules || jsonb_build_object('stages', $1::jsonb) WHERE id = $2`, [stages([1, 2, 3, 4, 5, 6, 7, 8, 9]), MASTER]);
      return {
        stage10: await count(tx, `SELECT count(*)::int AS n FROM public.global_plans WHERE id = '00000000-0000-0000-c026-000000000010'`),
        stage9: await count(tx, `SELECT count(*)::int AS n FROM public.global_plans WHERE id = '00000000-0000-0000-c026-000000000009'`),
        monthly: await monthlyPlans(tx)
      };
    });
    expect(outcome).toEqual({ stage10: 0, stage9: 1, monthly: 4 });
  });

  it("總表 rules 沒有 stages 陣列時更新：什麼都不刪", async () => {
    const outcome = await inRollback(async tx => {
      const before = await stagePlans(tx);
      await tx.query(`UPDATE public.global_plans SET rules = rules - 'stages' WHERE id = $1`, [MASTER]);
      await tx.query(`UPDATE public.global_plans SET rules = rules || '{"stages":"not-an-array"}'::jsonb WHERE id = $1`, [MASTER]);
      return { before, stages: await stagePlans(tx), monthly: await monthlyPlans(tx) };
    });
    expect(outcome).toEqual({ before: outcome.before, stages: outcome.before, monthly: 4 });
    expect(outcome.before).toBeGreaterThan(0);
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

describe("大區梯次面板只新增（create_region_stage_cohort，#633）", () => {
  const DEUT = "00000000-0000-0000-c126-000000202612";
  const STAGE3 = "00000000-0000-0000-c026-000000000003";
  const TAOYUAN_DEUT = "00000000-0000-0000-c326-000000202701";
  const createCohort = (tx, { region = "大區 A", source = DEUT, isHidden = true, actor = ids.admin } = {}) => tx.query(
    `SELECT public.create_region_stage_cohort($1, $2::uuid, '2027-02-01', '2027-02-28', $3, $4) AS result`,
    [region, source, isHidden, actor]
  );
  const cohortRows = async tx => (await tx.query(
    `SELECT id, name, start_date::text AS start_date, target_books, is_hidden, rules, source_plan_id
     FROM public.global_plans WHERE plan_kind = 'church_campaign_stage_cohort' ORDER BY id`
  )).rows;

  it("選全教會 12 月申命記：新增一張新 id 的梯次，經卷、規則從來源複製，記下複製來源；既有梯次不變", async () => {
    const outcome = await asService(async tx => {
      const before = await cohortRows(tx);
      const result = (await createCohort(tx)).rows[0].result;
      const after = await cohortRows(tx);
      const source = (await tx.query(`SELECT name, rules FROM public.global_plans WHERE id = $1`, [DEUT])).rows[0];
      return { before, after, result, source };
    });
    const created = outcome.after.find(row => row.id === outcome.result.planId);
    expect(outcome.result).toMatchObject({ created: true, sourcePlanId: DEUT, region: "大區 A", isHidden: true });
    expect(outcome.before.map(row => row.id)).not.toContain(outcome.result.planId);
    expect(created).toMatchObject({
      name: `${outcome.source.name}（大區 A）`,
      start_date: "2027-02-01",
      target_books: ["申命記"],
      is_hidden: true,
      source_plan_id: DEUT
    });
    expect(created.rules).toMatchObject({
      planKind: "church_campaign_stage_cohort",
      name: `${outcome.source.name}（大區 A）`,
      stageNo: 2,
      cohortSourceStageNo: 2,
      cohortRegion: "大區 A",
      awardName: "鐵獎",
      examDate: null,
      parentCampaignId: outcome.source.rules.parentCampaignId
    });
    expect(created.rules.presetKey).toMatch(/^church_r1final_2026_12_cohort_[0-9a-f]{8}$/);
    expect(created.rules).not.toHaveProperty("stages");
    expect(created.rules).not.toHaveProperty("segments");
    // 既有梯次一列都沒動
    expect(outcome.after.filter(row => row.id !== outcome.result.planId)).toEqual(outcome.before);
  });

  it("同一大區、同一張來源再送一次：回 cohort_already_exists，不新增也不修改任何計畫", async () => {
    const outcome = await asService(async tx => {
      await createCohort(tx);
      const before = await cohortRows(tx);
      let error = null;
      await tx.exec(`SAVEPOINT again`);
      try {
        await createCohort(tx, { isHidden: false });
      } catch (caught) {
        error = String(caught.message);
        await tx.exec(`ROLLBACK TO SAVEPOINT again`);
      }
      return { error, before, after: await cohortRows(tx) };
    });
    expect(outcome.error).toMatch(/cohort_already_exists/);
    expect(outcome.after).toEqual(outcome.before);
  });

  it("同一大區換一張來源、或不同大區同一張來源，都可以各自新增", async () => {
    const outcome = await asService(async tx => {
      await tx.query(`INSERT INTO public.great_regions (id, name) VALUES ('10000000-0000-4000-8000-0000000000b1', '大區 B')`);
      const first = (await createCohort(tx)).rows[0].result;
      const otherSource = (await createCohort(tx, { source: STAGE3 })).rows[0].result;
      const otherRegion = (await createCohort(tx, { region: "大區 B" })).rows[0].result;
      return { first, otherSource, otherRegion };
    });
    const ids3 = new Set([outcome.first.planId, outcome.otherSource.planId, outcome.otherRegion.planId]);
    expect(ids3.size).toBe(3);
    expect(outcome.otherSource).toMatchObject({ created: true, sourcePlanId: STAGE3 });
  });

  it("來源只能是全教會正式階段：梯次或不存在的 id 都回 source_plan_not_found", async () => {
    await expect(asService(tx => createCohort(tx, { source: TAOYUAN_DEUT }))).rejects.toThrow(/source_plan_not_found/);
    await expect(asService(tx => createCohort(tx, { source: "70000000-0000-4000-8000-0000000000ff" }))).rejects.toThrow(/source_plan_not_found/);
  });

  it("只有系統管理員／牧師能建立；authenticated 不能冒用身分；anon 不能執行", async () => {
    await expect(asService(tx => createCohort(tx, { actor: ids.member }))).rejects.toThrow(/permission_denied/);
    await expect(as("authenticated", { sub: ids.memberAuth }, tx => createCohort(tx))).rejects.toThrow(/actor_override_forbidden/);
    await expect(as("anon", {}, tx => createCohort(tx, { actor: null }))).rejects.toThrow(/permission denied/);
  });

  it("舊的「大區＋階段號碼」簽章已移除，面板沒有更新既有梯次的路徑", async () => {
    await expect(asService(tx => tx.query(
      `SELECT public.create_region_stage_cohort('大區 A', 3, '2026-11-01', '2026-11-30', TRUE, $1)`, [ids.admin]
    ))).rejects.toThrow(/does not exist/);
  });
});

describe("計畫關聯資料表（plan_groups／source_plan_id，#639）", () => {
  const CHURCH = month => `00000000-0000-0000-c126-0000002026${month}`;
  const TAOYUAN = {
    出埃及記: "00000000-0000-0000-c326-000000202610",
    利未記: "00000000-0000-0000-c326-000000202611",
    民數記: "00000000-0000-0000-c326-000000202612",
    申命記: "00000000-0000-0000-c326-000000202701"
  };

  const groupMembers = async (tx, key) => (await tx.query(
    `SELECT m.plan_id::text AS plan_id, m.slot FROM public.plan_group_members m
     JOIN public.plan_groups g ON g.id = m.group_id WHERE g.key = $1 ORDER BY m.plan_id`,
    [key]
  )).rows;

  it("回填兩組鐵獎：全教會 4 張月度期末賽、桃園 4 張梯次，不互相混用", async () => {
    const outcome = await asService(async tx => ({
      church: await groupMembers(tx, "r1final_church"),
      taoyuan: await groupMembers(tx, "r1final_taoyuan"),
      groups: (await tx.query(`SELECT key, kind, rules->'slots' AS slots FROM public.plan_groups ORDER BY key`)).rows
    }));
    expect(outcome.church).toEqual([
      { plan_id: CHURCH("09"), slot: "出埃及記" },
      { plan_id: CHURCH("10"), slot: "利未記" },
      { plan_id: CHURCH("11"), slot: "民數記" },
      { plan_id: CHURCH("12"), slot: "申命記" }
    ]);
    expect(outcome.taoyuan).toEqual(Object.entries(TAOYUAN).map(([slot, plan_id]) => ({ plan_id, slot })));
    const slots = ["出埃及記", "利未記", "民數記", "申命記"];
    expect(outcome.groups).toEqual([
      { key: "r1final_church", kind: "award", slots },
      { key: "r1final_taoyuan", kind: "award", slots }
    ]);
  });

  it("桃園梯次各自記錄全教會同經卷那張為複製來源；全教會月度計畫沒有來源", async () => {
    const rows = await asService(async tx => (await tx.query(
      `SELECT id::text AS id, source_plan_id::text AS source FROM public.global_plans
       WHERE id::text LIKE '00000000-0000-0000-c126-%' OR id::text LIKE '00000000-0000-0000-c326-%' ORDER BY id`
    )).rows);
    expect(rows).toEqual([
      { id: CHURCH("09"), source: null },
      { id: CHURCH("10"), source: null },
      { id: CHURCH("11"), source: null },
      { id: CHURCH("12"), source: null },
      { id: TAOYUAN.出埃及記, source: CHURCH("09") },
      { id: TAOYUAN.利未記, source: CHURCH("10") },
      { id: TAOYUAN.民數記, source: CHURCH("11") },
      { id: TAOYUAN.申命記, source: CHURCH("12") }
    ]);
  });

  it("同一大區對同一張來源只能有一張；不同大區可以；不能以自己為來源", async () => {
    const insertCopy = (tx, id, region) => tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books, audience_regions, source_plan_id)
       VALUES ($1, '複製', '2026-10-01', '2026-10-31', ARRAY['利未記'], ARRAY[$2], $3)`,
      [id, region, CHURCH("10")]
    );
    await expect(asService(tx => insertCopy(tx, "70000000-0000-4000-8000-000000000001", "桃園")))
      .rejects.toThrow(/global_plans_source_region_key/);
    await expect(asService(tx => insertCopy(tx, "70000000-0000-4000-8000-000000000001", "大區 A"))).resolves.toBeDefined();
    await expect(asService(tx => tx.query(`UPDATE public.global_plans SET source_plan_id = id WHERE id = $1`, [CHURCH("09")])))
      .rejects.toThrow(/global_plans_source_not_self/);
  });

  it("刪掉來源時梯次留著、來源設回 NULL；刪掉計畫時分組成員跟著刪", async () => {
    const outcome = await asService(async tx => {
      await tx.query(`DELETE FROM public.global_plans WHERE id = $1`, [CHURCH("10")]);
      return {
        cohort: (await tx.query(`SELECT source_plan_id FROM public.global_plans WHERE id = $1`, [TAOYUAN.利未記])).rows,
        church: await groupMembers(tx, "r1final_church")
      };
    });
    expect(outcome.cohort).toEqual([{ source_plan_id: null }]);
    expect(outcome.church.map(m => m.slot)).toEqual(["出埃及記", "民數記", "申命記"]);
  });

  it("登入者只能讀、不能寫；anon 完全不能讀", async () => {
    const read = await as("authenticated", { sub: ids.memberAuth }, async tx =>
      (await tx.query(`SELECT count(*)::int AS n FROM public.plan_group_members`)).rows[0].n);
    expect(read).toBe(8);
    await expect(as("authenticated", { sub: ids.memberAuth }, tx =>
      tx.query(`INSERT INTO public.plan_groups (key, kind, name) VALUES ('x', 'award', 'x')`)))
      .rejects.toThrow(/permission denied/);
    await expect(as("anon", {}, tx => tx.query(`SELECT 1 FROM public.plan_groups`))).rejects.toThrow(/permission denied/);
  });
});

describe("小測驗補讀日（沒排章節的日子不出題，#641）", () => {
  // 利未記 27 章分給 31 天：取整數 0 章、餘數 27 從第 1 天起每天補 1 章 → 最後 4 天沒有章節。
  // 用遠在未來的日期，日曆的「今天」不管哪天跑都在這個月之前。
  const REST_PLAN = "40000000-0000-4000-8000-000000000641";
  const RULES = {
    segments: [{ label: "2099年10月", startDate: "2099-10-01", endDate: "2099-10-31", readings: [{ book: "利未記", from: 1, to: 27 }] }]
  };
  const withRestPlan = fn => asService(async tx => {
    await tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books, rules)
       VALUES ($1, '補讀日測試', '2099-10-01', '2099-10-31', ARRAY['LEV'], $2::jsonb)`,
      [REST_PLAN, JSON.stringify(RULES)]
    );
    return fn(tx);
  });
  const calendar = (tx, from, days) => tx.query(
    `SELECT public.get_daily_quiz_calendar($1, $2::date, $3, $4) AS result`, [REST_PLAN, from, days, ids.admin]
  ).then(({ rows: [{ result }] }) => result.days);

  it("每天分到幾章和 Edge Function／會友排程同一套算法", async () => {
    const counts = await withRestPlan(async tx => (await tx.query(
      `SELECT d::date AS day, public._daily_quiz_reading_chapter_count($1, d::date) AS n
       FROM generate_series('2099-10-26'::date, '2099-10-31'::date, '1 day') AS d`, [REST_PLAN]
    )).rows.map(row => row.n));
    expect(counts).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it("沒有 segments 的計畫不判定（回 NULL），不會被當成補讀日", async () => {
    const { rows: [{ n }] } = await asService(tx => tx.query(
      `SELECT public._daily_quiz_reading_chapter_count($1, '2026-10-01') AS n`, [ids.plan]
    ));
    expect(n).toBeNull();
  });

  it("日曆把沒排章節的日子標成 rest_day，不需要處理、也沒有錯誤", async () => {
    const days = await withRestPlan(async tx => {
      // 舊資料：以前按「請 AI 出題」留下的失敗紀錄，也要被補讀日蓋過
      await tx.query(
        `INSERT INTO public.daily_quizzes (global_plan_id, quiz_date, variant, generation_status, generation_error)
         VALUES ($1, '2099-10-28', 'A', 'failed', 'scripture:no_reading_chapters')`, [REST_PLAN]
      );
      return calendar(tx, "2099-10-27", 5);
    });
    expect(days.map(day => day.status)).toEqual(["waiting", "rest_day", "rest_day", "rest_day", "rest_day"]);
    expect(days.slice(1).every(day => day.needsAttention === false && day.aiError === null)).toBe(true);
  });

  it("補讀日按「請 AI 出題」直接擋下，不建紀錄", async () => {
    await expect(withRestPlan(tx => tx.query(
      `SELECT public.swap_daily_quiz_version($1, '2099-10-29', $2)`, [REST_PLAN, ids.admin]
    ))).rejects.toThrow(/quiz_rest_day/);
  });

  it("輔助函式只給 service_role", async () => {
    await expect(as("authenticated", { sub: ids.adminAuth }, tx => tx.query(
      `SELECT public._daily_quiz_reading_chapter_count($1, '2026-10-01')`, [ids.plan]
    ))).rejects.toThrow(/permission denied/);
  });
});

describe("小測驗補發過去沒發出去的日子（publish_daily_quiz_makeup，#643）", () => {
  // 日期都相對於「台北的今天」，任何一天跑結果都一樣
  const taipeiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const shift = (iso, days) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const TODAY = taipeiToday();
  const PAST = shift(TODAY, -2);
  const SKIPPED = shift(TODAY, -3);
  const NO_QUIZ = shift(TODAY, -4);
  const LIVE_PLAN = "40000000-0000-4000-8000-000000000643";
  const ENDED_PLAN = "40000000-0000-4000-8000-000000000644";
  const segments = (start, end, to) => ({ segments: [{ startDate: start, endDate: end, readings: [{ book: "創世記", from: 1, to }] }] });

  const withPlans = fn => asService(async tx => {
    const plan = (id, start, end, to) => tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books, rules)
       VALUES ($1, '補發測試', $2, $3, ARRAY['GEN'], $4::jsonb)`,
      [id, start, end, JSON.stringify(segments(start, end, to))]
    );
    // 進行中的計畫：前後各 5 天、每天 1 章；已結束的計畫：昨天結束
    await plan(LIVE_PLAN, shift(TODAY, -5), shift(TODAY, 5), 11);
    await plan(ENDED_PLAN, shift(TODAY, -10), shift(TODAY, -1), 10);
    const readyQuiz = (planId, date) => tx.query(
      `INSERT INTO public.daily_quizzes (global_plan_id, quiz_date, variant, questions, generation_status, review_status)
       VALUES ($1, $2, 'A', $3, 'ready', 'approved')`, [planId, date, JSON.stringify(QUESTIONS)]
    );
    await readyQuiz(LIVE_PLAN, PAST);
    await readyQuiz(LIVE_PLAN, SKIPPED);
    await readyQuiz(ENDED_PLAN, shift(TODAY, -3));
    await tx.query(`INSERT INTO public.quiz_daily_overrides (global_plan_id, quiz_date, skip) VALUES ($1, $2, TRUE)`, [LIVE_PLAN, SKIPPED]);
    return fn(tx);
  });
  const makeup = (tx, planId, date, actor = ids.admin) => tx.query(
    `SELECT public.publish_daily_quiz_makeup($1, $2::date, $3) AS result`, [planId, date, actor]
  ).then(({ rows: [{ result }] }) => result);
  const calendarDay = async (tx, date) => (await tx.query(
    `SELECT public.get_daily_quiz_calendar($1, $2::date, 1, $3) AS result`, [LIVE_PLAN, date, ids.admin]
  )).rows[0].result.days[0];

  it("補發發給全部小組，作答到今天 23:59（台北）；會友今天的畫面看得到", async () => {
    const outcome = await withPlans(async tx => {
      const before = await calendarDay(tx, PAST);
      const result = await makeup(tx, LIVE_PLAN, PAST);
      const { rows: pubs } = await tx.query(
        `SELECT small_group_id,
           answer_close_at = ((((now() AT TIME ZONE 'Asia/Taipei')::date) + TIME '23:59:59') AT TIME ZONE 'Asia/Taipei') AS closes_tonight
         FROM public.quiz_publications WHERE global_plan_id = $1 AND quiz_date = $2`, [LIVE_PLAN, PAST]
      );
      const groups = (await tx.query(`SELECT count(*)::int AS n FROM public.small_groups`)).rows[0].n;
      const { rows: [{ dashboard }] } = await tx.query(
        `SELECT public.get_daily_quiz_dashboard($1, $2::date, $3) AS dashboard`, [LIVE_PLAN, TODAY, ids.member]
      );
      const after = await calendarDay(tx, PAST);
      return { before, result, pubs, groups, dashboard, after };
    });
    expect(outcome.before).toMatchObject({ status: "scheduled", canMakeup: true, needsAttention: false });
    expect(outcome.result).toMatchObject({ source: "ai", publishedCount: outcome.groups });
    expect(outcome.pubs).toHaveLength(outcome.groups);
    expect(outcome.pubs.every(pub => pub.closes_tonight)).toBe(true);
    expect(outcome.dashboard.myQuiz).toBeNull();
    expect(outcome.dashboard.makeupQuizzes).toHaveLength(1);
    expect(outcome.dashboard.makeupQuizzes[0]).toMatchObject({ quizDate: PAST, attempt: null });
    expect(outcome.dashboard.makeupQuizzes[0].questions).toHaveLength(QUESTIONS.length);
    expect(outcome.after).toMatchObject({ status: "open", canMakeup: false });
  });

  it("截止後就不再出現在會友的補發清單", async () => {
    const dashboard = await withPlans(async tx => {
      await makeup(tx, LIVE_PLAN, PAST);
      await tx.query(`UPDATE public.quiz_publications SET answer_close_at = now() - INTERVAL '1 minute' WHERE quiz_date = $1`, [PAST]);
      return (await tx.query(`SELECT public.get_daily_quiz_dashboard($1, $2::date, $3) AS d`, [LIVE_PLAN, TODAY, ids.member])).rows[0].d;
    });
    expect(dashboard.makeupQuizzes).toEqual([]);
  });

  it("只有系統管理員能補發，而且只限符合條件的過去日子", async () => {
    await expect(withPlans(tx => makeup(tx, LIVE_PLAN, PAST, ids.member))).rejects.toThrow(/quiz_publish_admin_only/);
    await expect(withPlans(tx => makeup(tx, LIVE_PLAN, TODAY))).rejects.toThrow(/quiz_makeup_not_past/);
    await expect(withPlans(tx => makeup(tx, LIVE_PLAN, SKIPPED))).rejects.toThrow(/quiz_day_skipped/);
    await expect(withPlans(tx => makeup(tx, LIVE_PLAN, NO_QUIZ))).rejects.toThrow(/quiz_not_ready/);
    await expect(withPlans(tx => makeup(tx, ENDED_PLAN, shift(TODAY, -3)))).rejects.toThrow(/quiz_makeup_plan_ended/);
    await expect(withPlans(async tx => {
      await makeup(tx, LIVE_PLAN, PAST);
      return makeup(tx, LIVE_PLAN, PAST);
    })).rejects.toThrow(/quiz_already_published/);
  });

  const CUSTOM = [
    { id: "c1", type: "truefalse", payload: { stem: "自訂一" }, answerKey: true, explanation: "" },
    { id: "c2", type: "truefalse", payload: { stem: "自訂二" }, answerKey: false, explanation: "" }
  ];

  it("可補發的過去日子能請 AI 出題、改成自訂題目；計畫結束後照舊擋下", async () => {
    // 通過日期檢查後才會去讀 Vault；測試環境沒有密鑰，所以停在這一步就代表沒被日期擋
    await expect(withPlans(tx => tx.query(`SELECT public.swap_daily_quiz_version($1, $2::date, $3)`, [LIVE_PLAN, NO_QUIZ, ids.admin])))
      .rejects.toThrow(/quiz_generation_secret_missing/);
    await expect(withPlans(tx => tx.query(`SELECT public.swap_daily_quiz_version($1, $2::date, $3)`, [ENDED_PLAN, shift(TODAY, -3), ids.admin])))
      .rejects.toThrow(/quiz_date_passed/);

    const result = await withPlans(async tx => {
      await tx.query(`SELECT public.set_daily_quiz_day_custom($1, $2::date, $3::jsonb, $4)`, [LIVE_PLAN, NO_QUIZ, JSON.stringify(CUSTOM), ids.admin]);
      return makeup(tx, LIVE_PLAN, NO_QUIZ);
    });
    expect(result).toMatchObject({ source: "custom" });
  });
});

describe("合併重複帳號（admin_merge_profiles，#655）", () => {
  // 換登入方式開出的新帳號（source）併回原本的帳號（target）
  const M = {
    target: "21000000-0000-4000-8000-000000000001",
    source: "21000000-0000-4000-8000-000000000002",
    sourceMember: "22000000-0000-4000-8000-000000000002",
    teamA: "23000000-0000-4000-8000-000000000001",
    teamB: "23000000-0000-4000-8000-000000000002"
  };
  const one = async (tx, sql, params = []) => (await tx.query(sql, params)).rows[0];
  const n = async (tx, sql, params = []) => Number((await one(tx, sql, params)).n);

  /** 以資料庫擁有者身分建好兩個帳號的資料，fn 跑完一律 rollback。 */
  async function withAccounts(fn) {
    let result;
    let failure;
    try {
      await db.transaction(async tx => {
        try {
          const role = (await one(tx, `SELECT id FROM public.role_definitions WHERE code = 'member'`)).id;
          await tx.query(
            `INSERT INTO public.profiles (id, name, role_id, email, phone, nlc_member_id, is_active) VALUES
               ($1, '重複會友', $3, NULL, '0912000000', NULL, TRUE),
               ($2, '重複會友', $3, 'dup@example.invalid', NULL, $4, TRUE)`,
            [M.target, M.source, role, M.sourceMember]
          );
          // 10 月利未記已結束（固定期程、教會挑戰階段）：直接寫入要略過各種「已結束」檢查
          await tx.exec(`SET LOCAL session_replication_role = replica`);
          const g10 = (await one(tx, `SELECT id FROM public.global_plans WHERE rules->>'presetKey' = 'church_r1final_2026_10'`)).id;
          const plan = async (userId, globalPlanId, round) => (await one(tx,
            `INSERT INTO public.reading_plans (user_id, global_plan_id, name, start_date, end_date, target_books, current_round)
             SELECT $1, id, name, start_date, end_date, target_books, $3 FROM public.global_plans WHERE id = $2 RETURNING id`,
            [userId, globalPlanId, round])).id;
          const targetPlan = await plan(M.target, g10, 1);
          const sourcePlan = await plan(M.source, g10, 2);
          const sourceOnlyPlan = await plan(M.source, ids.plan, 1);
          const log = (userId, planId, book, chapter, readAt) => tx.query(
            `INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at) VALUES ($1, $2, $3, $4, $5)`,
            [userId, planId, book, chapter, readAt]
          );
          await log(M.target, targetPlan, "利未記", 1, "2026-10-05T01:00:00Z");
          await log(M.target, targetPlan, "利未記", 2, "2026-10-06T01:00:00Z");
          await log(M.source, sourcePlan, "利未記", 2, "2026-10-01T01:00:00Z"); // 比 target 早
          await log(M.source, sourcePlan, "利未記", 3, "2026-10-31T01:00:00Z");
          await log(M.source, sourceOnlyPlan, "創世記", 1, "2026-10-20T01:00:00Z");
          await log(M.target, null, "創世記", 5, "2026-09-01T01:00:00Z");
          await log(M.source, null, "創世記", 5, "2026-09-02T01:00:00Z");
          await log(M.source, null, "創世記", 6, "2026-09-03T01:00:00Z");
          // 兩人在同一階段各在一隊：source 的隊員資格衝突（每人每階段每組別一隊），隊長改成 target
          await tx.query(
            `INSERT INTO public.reading_teams (id, global_plan_id, division, name, captain_id, invite_code) VALUES
               ($1, $3, 3, '甲隊', $4, 'MERGEAAA01'), ($2, $3, 3, '乙隊', $5, 'MERGEBBB01')`,
            [M.teamA, M.teamB, g10, M.target, M.source]
          );
          await tx.query(
            `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role) VALUES
               ($1, $3, 3, $4, 'captain'), ($2, $3, 3, $5, 'captain')`,
            [M.teamA, M.teamB, g10, M.target, M.source]
          );
          await tx.query(
            `INSERT INTO public.user_identities (profile_id, provider, provider_user_id, is_primary) VALUES
               ($1, 'logto', 'merge-sub-phone', TRUE), ($2, 'logto', 'merge-sub-email', TRUE)`,
            [M.target, M.source]
          );
          // 兩個帳號都答了同一份小測驗
          await tx.query(
            `INSERT INTO public.quiz_attempts (publication_id, user_id, answers, score, total, status, completed_at) VALUES
               ($1, $2, '[]', 2, 2, 'submitted', now()), ($1, $3, '[]', 0, 2, 'submitted', now())`,
            [ids.publication, M.target, M.source]
          );
          // source 收過已讀的關心提醒：送出後收件人不能改（enforce_care_reminder_transition，#660）
          await tx.query(
            `INSERT INTO public.care_reminders (sender_id, recipient_id, reason, status, read_at, created_at)
             VALUES ($1, $2, 'care', 'read', '2026-10-02T01:00:00Z', '2026-10-01T01:00:00Z')`,
            [ids.admin, M.source]
          );
          await tx.exec(`SET LOCAL session_replication_role = DEFAULT`);
          result = await fn(tx, { g10, targetPlan, sourcePlan, sourceOnlyPlan });
        } catch (error) {
          failure = error;
        }
        await tx.rollback();
      });
    } catch (error) {
      if (!failure && !/rollback|aborted/i.test(String(error?.message))) throw error;
    }
    if (failure) throw failure;
    return result;
  }

  const merge = async (tx, dryRun, source = M.source, target = M.target) =>
    (await one(tx, `SELECT public.admin_merge_profiles($1, $2, $3) AS r`, [source, target, dryRun])).r;

  const snapshot = async tx => ({
    sourcePlans: await n(tx, `SELECT count(*) AS n FROM public.reading_plans WHERE user_id = $1`, [M.source]),
    sourceLogs: await n(tx, `SELECT count(*) AS n FROM public.reading_logs WHERE user_id = $1`, [M.source]),
    targetLogs: await n(tx, `SELECT count(*) AS n FROM public.reading_logs WHERE user_id = $1`, [M.target]),
    sourceIdentities: await n(tx, `SELECT count(*) AS n FROM public.user_identities WHERE profile_id = $1`, [M.source]),
    sourceActive: (await one(tx, `SELECT is_active FROM public.profiles WHERE id = $1`, [M.source])).is_active,
    merges: await n(tx, `SELECT count(*) AS n FROM public.profile_merges`)
  });

  it("預覽：回報各表要搬幾筆、幾筆衝突，但什麼都不改", async () => {
    const outcome = await withAccounts(async tx => {
      const before = await snapshot(tx);
      const report = await merge(tx, true);
      return { before, report, after: await snapshot(tx) };
    });
    expect(outcome.after).toEqual(outcome.before);
    expect(outcome.report).toMatchObject({
      dryRun: true,
      readingPlans: { moved: 1, mergedIntoExisting: 1 },
      readingLogs: { moved: 3, duplicatesDropped: 2, earlierReadAtKept: 1 }
    });
    const other = Object.fromEntries(outcome.report.otherTables.map(row => [`${row.table}.${row.column}`, row]));
    expect(other["public.reading_team_members.user_id"]).toMatchObject({ moved: 0, conflictsDeleted: 1 });
    expect(other["public.reading_teams.captain_id"]).toMatchObject({ moved: 1, conflictsDeleted: 0 });
    expect(other["public.user_identities.profile_id"]).toMatchObject({ moved: 1 });
    expect(other["public.quiz_attempts.user_id"]).toMatchObject({ moved: 0, conflictsDeleted: 1 });
    expect(other["public.care_reminders.recipient_id"]).toMatchObject({ moved: 1 });
  });

  it("執行：資料搬到原本的帳號，重複的只留一筆（保留較早的打卡時間），新帳號停用", async () => {
    const outcome = await withAccounts(async (tx, plans) => {
      // target 提醒過 source：改指 target 會變成寄給自己（CHECK），留在來源帳號
      await tx.query(
        `INSERT INTO public.care_reminders (sender_id, recipient_id, reason) VALUES ($1, $2, 'care')`,
        [M.target, M.source]
      );
      const report = await merge(tx, false);
      const logs = (await tx.query(
        `SELECT plan_id, book, chapter, read_at FROM public.reading_logs WHERE user_id = $1 ORDER BY book, chapter`, [M.target]
      )).rows;
      return {
        report,
        plans,
        after: await snapshot(tx),
        targetPlans: (await tx.query(`SELECT id, current_round FROM public.reading_plans WHERE user_id = $1 ORDER BY current_round`, [M.target])).rows,
        logs,
        teams: (await tx.query(`SELECT team_id FROM public.reading_team_members WHERE user_id IN ($1, $2)`, [M.target, M.source])).rows,
        captainB: (await one(tx, `SELECT captain_id FROM public.reading_teams WHERE id = $1`, [M.teamB])).captain_id,
        identities: (await tx.query(`SELECT provider_user_id, is_primary FROM public.user_identities WHERE profile_id = $1 ORDER BY provider_user_id`, [M.target])).rows,
        attempts: (await tx.query(`SELECT user_id, score FROM public.quiz_attempts WHERE publication_id = $1 AND user_id IN ($2, $3)`, [ids.publication, M.target, M.source])).rows,
        source: await one(tx, `SELECT is_active, nlc_member_id, email FROM public.profiles WHERE id = $1`, [M.source]),
        target: await one(tx, `SELECT is_active, email FROM public.profiles WHERE id = $1`, [M.target]),
        mergeLog: await one(tx, `SELECT source_profile_id, target_profile_id, jsonb_array_length(removed_rows) AS removed FROM public.profile_merges`),
        reminders: (await tx.query(
          `SELECT sender_id, recipient_id FROM public.care_reminders WHERE $1 IN (sender_id, recipient_id) OR $2 IN (sender_id, recipient_id) ORDER BY sender_id`,
          [M.target, M.source]
        )).rows,
        triggers: (await tx.query(
          `SELECT tgname, tgenabled FROM pg_trigger
           WHERE tgname IN ('trg_reading_plans_progress_transition', 'trg_reading_log_stage_progress_open', 'trg_care_reminders_transition',
                            'trg_block_ended_stage_teams', 'trg_block_ended_stage_team_members')`
        )).rows,
        disabledTriggers: await n(tx, `SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`)
      };
    });
    const { plans } = outcome;
    expect(outcome.report).toMatchObject({ dryRun: false });
    expect(outcome.after).toMatchObject({ sourcePlans: 0, sourceLogs: 0, sourceIdentities: 0, sourceActive: false, merges: 1 });
    expect(outcome.targetPlans).toEqual([
      { id: plans.sourceOnlyPlan, current_round: 1 },
      { id: plans.targetPlan, current_round: 2 }
    ]);
    const byChapter = Object.fromEntries(outcome.logs.map(row => [`${row.book}${row.chapter}`, row]));
    expect(Object.keys(byChapter).sort()).toEqual(["利未記1", "利未記2", "利未記3", "創世記1", "創世記5", "創世記6"].sort());
    expect(byChapter["利未記2"].plan_id).toBe(plans.targetPlan);
    expect(new Date(byChapter["利未記2"].read_at).toISOString()).toBe("2026-10-01T01:00:00.000Z");
    expect(byChapter["利未記3"].plan_id).toBe(plans.targetPlan);
    expect(byChapter["創世記1"].plan_id).toBe(plans.sourceOnlyPlan);
    expect(new Date(byChapter["創世記5"].read_at).toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(outcome.teams).toEqual([{ team_id: M.teamA }]);
    expect(outcome.captainB).toBe(M.target);
    expect(outcome.identities).toEqual([
      { provider_user_id: "merge-sub-email", is_primary: false },
      { provider_user_id: "merge-sub-phone", is_primary: true }
    ]);
    expect(outcome.attempts).toEqual([{ user_id: M.target, score: 2 }]);
    expect(outcome.source).toEqual({ is_active: false, nlc_member_id: null, email: null });
    expect(outcome.target).toEqual({ is_active: true, email: "dup@example.invalid" });
    // 刪掉的：重複的 2 筆打卡、併入後的來源計畫、衝突的隊員資格、重複的小測驗作答
    expect(outcome.mergeLog).toMatchObject({ source_profile_id: M.source, target_profile_id: M.target, removed: 5 });
    // 已讀的關心提醒改寄給 target；target 寄給 source 的那則留在 source（不能寄給自己）
    expect(outcome.reminders).toEqual(expect.arrayContaining([
      { sender_id: ids.admin, recipient_id: M.target },
      { sender_id: M.target, recipient_id: M.source }
    ]));
    expect(outcome.reminders).toHaveLength(2);
    // 暫停的觸發器全部恢復
    expect(outcome.triggers).toHaveLength(5);
    for (const trigger of outcome.triggers) expect(trigger.tgenabled).toBe("O");
    expect(outcome.disabledTriggers).toBe(0);
  });

  it("同一個帳號、找不到帳號、已經併過的帳號：擋下", async () => {
    await expect(withAccounts(tx => merge(tx, true, M.source, M.source))).rejects.toThrow(/profile_merge_same_profile/);
    await expect(withAccounts(tx => merge(tx, true, "21000000-0000-4000-8000-0000000000ff"))).rejects.toThrow(/profile_merge_profile_not_found/);
    await expect(withAccounts(async tx => {
      await merge(tx, false);
      return merge(tx, true);
    })).rejects.toThrow(/profile_merge_already_merged/);
  });

  it("只給 service_role：會友和 anon 都不能呼叫", async () => {
    const privileges = await asService(async tx => one(tx,
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
       FROM pg_proc p WHERE p.proname = 'admin_merge_profiles'`));
    expect(privileges).toEqual({ anon: false, authenticated: false, service: true });
  });
});

describe("帶隊進下一個月（get_reading_team_carryover_offer／carry_reading_teams_to_stage，#659）", () => {
  // #639 在 global_plans 加了 source_plan_id 欄位，跟兩支函式裡同名的變數撞名，
  // offer 從此對每個人都報 42702 ambiguous，隊長永遠看不到帶隊按鈕。
  // 自己建上個月／這個月兩張階段計畫，日期跟著今天算：階段結束後名單不能再動（0163），
  // 用固定日期的月度期末賽，過了那個月測試就會壞。
  const OCT = "70000000-0000-4000-8000-000000000610";
  const NOV = "70000000-0000-4000-8000-000000000611";
  const CAMPAIGN = "70000000-0000-4000-8000-000000000600";
  const TEAM = "70000000-0000-4000-8000-000000000659";
  const offerFor = async (tx, actorId) =>
    (await tx.query(`SELECT public.get_reading_team_carryover_offer($1, $2) AS offer`, [NOV, actorId])).rows[0].offer;
  const seedOctoberTeam = async tx => {
    await tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books, is_hidden, plan_kind, rules) VALUES
         ($1, '上個月', CURRENT_DATE - 20, CURRENT_DATE + 10, ARRAY['利未記'], FALSE, 'church_campaign_stage', jsonb_build_object('parentCampaignId', $3::text)),
         ($2, '這個月', CURRENT_DATE - 5,  CURRENT_DATE + 30, ARRAY['民數記'], FALSE, 'church_campaign_stage', jsonb_build_object('parentCampaignId', $3::text))`,
      [OCT, NOV, CAMPAIGN]
    );
    await tx.query(
      `INSERT INTO public.reading_teams (id, global_plan_id, division, name, captain_id, invite_code)
       VALUES ($1, $2, 3, '十月隊', $3, 'CARRY65901')`,
      [TEAM, OCT, ids.member]
    );
    await tx.query(
      `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role)
       VALUES ($1, $2, 3, $3, 'captain'), ($1, $2, 3, $4, 'member')`,
      [TEAM, OCT, ids.member, ids.other]
    );
  };

  it("上個月的隊長查得到可以帶的隊伍", async () => {
    const offer = await asService(async tx => {
      await seedOctoberTeam(tx);
      return offerFor(tx, ids.member);
    });
    expect(offer).toMatchObject({ eligible: true, sourcePlanId: OCT, targetPlanId: NOV });
    expect(offer.teams).toEqual([expect.objectContaining({ sourceTeamId: TEAM, name: "十月隊", division: 3, memberCount: 2 })]);
  });

  it("隊員（不是隊長）沒有可帶的隊伍", async () => {
    const offer = await asService(async tx => {
      await seedOctoberTeam(tx);
      return offerFor(tx, ids.other);
    });
    expect(offer).toMatchObject({ eligible: false, teams: [] });
  });

  it("帶隊後隊長和隊員都進了下個月的同一支隊伍，offer 不再列這一組", async () => {
    const outcome = await asService(async tx => {
      await seedOctoberTeam(tx);
      await tx.query(`SELECT public.carry_reading_teams_to_stage($1, $2, 3)`, [NOV, ids.member]);
      const members = (await tx.query(
        `SELECT user_id, member_role FROM public.reading_team_members WHERE global_plan_id = $1 ORDER BY member_role`, [NOV]
      )).rows;
      return { members, offer: await offerFor(tx, ids.member) };
    });
    expect(outcome.members).toEqual([
      { user_id: ids.member, member_role: "captain" },
      { user_id: ids.other, member_role: "member" }
    ]);
    expect(outcome.offer).toMatchObject({ eligible: false, teams: [] });
  });
});

describe("月初隊伍接不上：帶隊狀態、隊員接手、補帶、重名（#678）", () => {
  const SOURCE = "70000000-0000-4000-8000-000000000780";
  const TARGET = "70000000-0000-4000-8000-000000000781";
  const CAMPAIGN = "70000000-0000-4000-8000-000000000770";
  const TEAM = "70000000-0000-4000-8000-000000000678";
  const OTHER_TARGET_TEAM = "70000000-0000-4000-8000-000000000679";
  const THIRD = "20000000-0000-4000-8000-000000000678";
  const OUTSIDER = "20000000-0000-4000-8000-000000000679";
  const CAPTAIN = ids.member;
  const MATE = ids.other;
  // 跟 RPC 同一個「今天」：接手時間以台北日期算，CI 跑在 UTC，邊界才不會差一天。
  const TAIPEI_TODAY = `(now() AT TIME ZONE 'Asia/Taipei')::date`;

  const addProfile = (tx, id, name) => tx.query(
    `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, is_active)
     SELECT $1, $2, role_id, great_region, pastoral_zone, TRUE FROM public.profiles WHERE id = $3`,
    [id, name, MATE]
  );
  // 上個月 3 人隊：隊長、隊友、第三位。targetStartedDaysAgo：這個月開始幾天了。
  const seed = async (tx, { targetStartedDaysAgo = 5, teamName = "十月隊" } = {}) => {
    await addProfile(tx, THIRD, "測試會友 0678");
    await addProfile(tx, OUTSIDER, "測試會友 0679");
    await tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books, is_hidden, plan_kind, rules) VALUES
         ($1, '上個月', ${TAIPEI_TODAY} - 40, ${TAIPEI_TODAY} + 10, ARRAY['利未記'], FALSE, 'church_campaign_stage', jsonb_build_object('parentCampaignId', $3::text)),
         ($2, '這個月', ${TAIPEI_TODAY} - $4::int, ${TAIPEI_TODAY} + 25, ARRAY['民數記'], FALSE, 'church_campaign_stage', jsonb_build_object('parentCampaignId', $3::text))`,
      [SOURCE, TARGET, CAMPAIGN, targetStartedDaysAgo]
    );
    await tx.query(
      `INSERT INTO public.reading_teams (id, global_plan_id, division, name, captain_id, invite_code)
       VALUES ($1, $2, 3, $3, $4, 'CARRY67801')`,
      [TEAM, SOURCE, teamName, CAPTAIN]
    );
    await tx.query(
      `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role)
       VALUES ($1, $2, 3, $3, 'captain'), ($1, $2, 3, $4, 'member'), ($1, $2, 3, $5, 'member')`,
      [TEAM, SOURCE, CAPTAIN, MATE, THIRD]
    );
  };
  // 目標計畫裡已經有一支隊（別人建的，或隊長自己重建的）。
  const addTargetTeam = async (tx, { captainId, name, memberIds = [] }) => {
    await tx.query(
      `INSERT INTO public.reading_teams (id, global_plan_id, division, name, captain_id, invite_code)
       VALUES ($1, $2, 3, $3, $4, 'CARRY67802')`,
      [OTHER_TARGET_TEAM, TARGET, name, captainId]
    );
    await tx.query(
      `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role)
       VALUES ($1, $2, 3, $3, 'captain')`,
      [OTHER_TARGET_TEAM, TARGET, captainId]
    );
    for (const userId of memberIds) {
      await tx.query(
        `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role)
         VALUES ($1, $2, 3, $3, 'member')`,
        [OTHER_TARGET_TEAM, TARGET, userId]
      );
    }
  };
  const statusOf = async (tx, actorId) =>
    (await tx.query(`SELECT public.get_reading_team_carry_status($1) AS status`, [actorId])).rows[0].status;
  const carry = async (tx, actorId, teamName = null) =>
    (await tx.query(
      `SELECT public.carry_reading_teams_to_stage(p_target_global_plan_id => $1, p_actor_id => $2, p_division => 3, p_team_name => $3) AS result`,
      [TARGET, actorId, teamName]
    )).rows[0].result;
  const takeOver = async (tx, actorId, teamName = null) =>
    (await tx.query(`SELECT public.take_over_reading_team_carry($1, $2, $3, $4) AS result`, [TARGET, TEAM, teamName, actorId])).rows[0].result;
  const backfill = async (tx, actorId) =>
    (await tx.query(`SELECT public.backfill_reading_team_from_source($1, $2, $3) AS result`, [TARGET, TEAM, actorId])).rows[0].result;
  const joinCarried = async (tx, actorId) =>
    (await tx.query(`SELECT public.join_carried_reading_team($1, $2, $3) AS result`, [TARGET, TEAM, actorId])).rows[0].result;
  const rosterOf = async (tx, teamId) => (await tx.query(
    `SELECT user_id, member_role FROM public.reading_team_members WHERE team_id = $1 ORDER BY member_role, user_id`, [teamId]
  )).rows;
  const carriedTeam = async tx => (await tx.query(
    `SELECT * FROM public.reading_teams WHERE global_plan_id = $1 AND carried_from_team_id = $2`, [TARGET, TEAM]
  )).rows[0];
  const enrolled = async (tx, userId) => (await tx.query(
    `SELECT 1 FROM public.reading_plans WHERE user_id = $1 AND global_plan_id = $2`, [userId, TARGET]
  )).rows.length > 0;

  describe("重名（第 6 點）", () => {
    it("原隊名被別隊用走：帶隊不會失敗，回報要改名，什麼都沒寫入", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "十月隊" });
        return { result: await carry(tx, CAPTAIN), team: await carriedTeam(tx), captainEnrolled: await enrolled(tx, CAPTAIN) };
      });
      expect(outcome.result.teams).toEqual([]);
      expect(outcome.result.skippedTeams).toEqual([expect.objectContaining({ sourceTeamId: TEAM, reason: "duplicate_team_name" })]);
      expect(outcome.team).toBeUndefined();
      expect(outcome.captainEnrolled).toBe(false);
    });

    it("換一個隊名就能帶隊", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "十月隊" });
        const result = await carry(tx, CAPTAIN, "十一月隊");
        const team = await carriedTeam(tx);
        return { result, team, roster: await rosterOf(tx, team.id) };
      });
      expect(outcome.team).toMatchObject({ name: "十一月隊", captain_id: CAPTAIN, status: "ready" });
      expect(outcome.roster).toHaveLength(3);
    });

    it("新隊名也重複：再要求改名一次；不安全的隊名直接拒絕", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "十月隊" });
        return carry(tx, CAPTAIN, "  十月隊 ");
      });
      expect(outcome.skippedTeams[0]).toMatchObject({ reason: "duplicate_team_name" });
      await expect(asService(async tx => {
        await seed(tx);
        return carry(tx, CAPTAIN, "<b>壞名字</b>");
      })).rejects.toThrow(/invalid_team_name/);
    });

    it("接手時原隊名重複：要求改名，沒有留下半套的隊伍", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "十月隊" });
        return takeOver(tx, MATE);
      })).rejects.toThrow(/duplicate_team_name/);
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "十月隊" });
        await takeOver(tx, MATE, "接手隊");
        return carriedTeam(tx);
      });
      expect(outcome).toMatchObject({ name: "接手隊", captain_id: MATE });
    });
  });

  describe("原隊長回來（第 4 點）", () => {
    it("隊伍已被帶入：帶隊回報已由誰帶入，不假裝成功，也不把原隊長加進去", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await takeOver(tx, MATE);
        const team = await carriedTeam(tx);
        return { result: await carry(tx, CAPTAIN), roster: await rosterOf(tx, team.id) };
      });
      expect(outcome.result.teams[0]).toMatchObject({
        sourceTeamId: TEAM,
        alreadyCarried: true,
        actorIsMember: false,
        carriedByName: "測試會友 0002",
        hasVacancy: true
      });
      expect(outcome.roster.map(row => row.user_id)).not.toContain(CAPTAIN);
    });

    it("帶隊狀態也顯示已由誰帶入，有空位時可以一鍵加入，加入後就不再列出", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await takeOver(tx, MATE);
        const before = await statusOf(tx, CAPTAIN);
        const joined = await joinCarried(tx, CAPTAIN);
        const team = await carriedTeam(tx);
        return { before, joined, team, roster: await rosterOf(tx, team.id), after: await statusOf(tx, CAPTAIN), plan: await enrolled(tx, CAPTAIN) };
      });
      expect(outcome.before.teams).toEqual([expect.objectContaining({
        state: "carried", role: "captain", carriedByName: "測試會友 0002", hasVacancy: true
      })]);
      expect(outcome.joined).toMatchObject({ teamId: outcome.team.id, memberCount: 3 });
      expect(outcome.roster).toContainEqual({ user_id: CAPTAIN, member_role: "member" });
      expect(outcome.team.status).toBe("ready");
      expect(outcome.plan).toBe(true);
      expect(outcome.after.teams).toEqual([]);
    });

    it("隊伍額滿時不能一鍵加入", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await takeOver(tx, MATE);
        const team = await carriedTeam(tx);
        await tx.query(
          `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role) VALUES ($1, $2, 3, $3, 'member')`,
          [team.id, TARGET, OUTSIDER]
        );
        await tx.query(`UPDATE public.reading_teams SET status = 'ready' WHERE id = $1`, [team.id]);
        const status = await statusOf(tx, CAPTAIN);
        expect(status.teams[0]).toMatchObject({ state: "carried", hasVacancy: false });
        return joinCarried(tx, CAPTAIN);
      })).rejects.toThrow(/reading_team_full/);
    });

    it("不是這支隊的原隊員不能一鍵加入", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await takeOver(tx, MATE);
        return joinCarried(tx, OUTSIDER);
      })).rejects.toThrow(/team_join_carried_member_required/);
    });
  });

  describe("帶隊狀態（第 1～3 點）", () => {
    it("隊長還沒加入新計畫也看得到可以帶隊，名單列出會帶入的人", async () => {
      const status = await asService(async tx => {
        await seed(tx);
        return statusOf(tx, CAPTAIN);
      });
      expect(status.teams).toHaveLength(1);
      expect(status.teams[0]).toMatchObject({
        state: "carry",
        role: "captain",
        targetPlanId: TARGET,
        sourcePlanId: SOURCE,
        sourceTeamId: TEAM,
        name: "十月隊",
        division: 3,
        memberCount: 3,
        carried: false,
        captainJoinedTarget: false
      });
      expect(status.teams[0].roster.map(row => row.userId).sort()).toEqual([MATE, THIRD].sort());
      expect(status.teams[0].roster.every(row => row.reason === null)).toBe(true);
    });

    it("隊員看到隊長還沒帶隊；未滿 3 天不能接手，回傳可接手的日期", async () => {
      const status = await asService(async tx => {
        await seed(tx, { targetStartedDaysAgo: 2 });
        const opensOn = (await tx.query(`SELECT (${TAIPEI_TODAY} + 1)::text AS day`)).rows[0].day;
        return { ...(await statusOf(tx, MATE)), opensOn };
      });
      expect(status.teams[0]).toMatchObject({
        state: "waiting",
        role: "member",
        captainId: CAPTAIN,
        captainName: "測試會友 0001",
        canTakeover: false,
        takeoverOpensOn: status.opensOn,
        reminderSentToday: false
      });
    });

    it("隊長加入新計畫（個人讀經）後，隊員看得到隊長已加入", async () => {
      const status = await asService(async tx => {
        await seed(tx);
        await tx.query(
          `INSERT INTO public.reading_plans (user_id, global_plan_id, name, start_date, end_date, target_books, is_fixed)
           SELECT $1, id, name, start_date, end_date, target_books, TRUE FROM public.global_plans WHERE id = $2`,
          [CAPTAIN, TARGET]
        );
        return statusOf(tx, MATE);
      });
      expect(status.teams[0]).toMatchObject({ captainJoinedTarget: true, canTakeover: true });
    });

    it("這個月同組別已經有隊的隊員不列出；帶入後全隊都不再列出", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "別隊", memberIds: [THIRD] });
        const third = await statusOf(tx, THIRD);
        await carry(tx, CAPTAIN);
        return { third, captain: await statusOf(tx, CAPTAIN), mate: await statusOf(tx, MATE) };
      });
      expect(outcome.third.teams).toEqual([]);
      expect(outcome.captain.teams).toEqual([]);
      expect(outcome.mate.teams).toEqual([]);
    });

    it("沒有上個月隊伍的人、隱藏或已結束的階段都不列出", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        const outsider = await statusOf(tx, OUTSIDER);
        await tx.query(`UPDATE public.global_plans SET is_hidden = TRUE WHERE id = $1`, [TARGET]);
        const hidden = await statusOf(tx, CAPTAIN);
        await tx.query(`UPDATE public.global_plans SET is_hidden = FALSE, end_date = ${TAIPEI_TODAY} - 1 WHERE id = $1`, [TARGET]);
        const ended = await statusOf(tx, CAPTAIN);
        return { outsider, hidden, ended };
      });
      expect(outcome.outsider.teams).toEqual([]);
      expect(outcome.hidden.teams).toEqual([]);
      expect(outcome.ended.teams).toEqual([]);
    });

    it("提醒隊長一天一次，沿用隊友提醒；傳過後狀態顯示今天已提醒", async () => {
      const send = (tx, actorId) => tx.query(
        `SELECT public.send_reading_team_reminder($1, $2, 'care', '提醒帶隊', $3, $4)`,
        [TEAM, CAPTAIN, SOURCE, actorId]
      );
      const status = await asService(async tx => {
        await seed(tx);
        await send(tx, MATE);
        return statusOf(tx, MATE);
      });
      expect(status.teams[0].reminderSentToday).toBe(true);
      await expect(asService(async tx => {
        await seed(tx);
        await send(tx, MATE);
        await send(tx, MATE);
      })).rejects.toThrow(/team_reminder_daily_limit/);
    });
  });

  describe("隊員接手（第 4 點）", () => {
    it("開始未滿 3 天不能接手", async () => {
      await expect(asService(async tx => {
        await seed(tx, { targetStartedDaysAgo: 2 });
        return takeOver(tx, MATE);
      })).rejects.toThrow(/team_takeover_not_open/);
    });

    it("開始滿 3 天：接手者當新隊長，其他隊員帶入，原隊長不在新隊也不會被加入計畫", async () => {
      const outcome = await asService(async tx => {
        await seed(tx, { targetStartedDaysAgo: 3 });
        const statusBefore = await statusOf(tx, MATE);
        const result = await takeOver(tx, MATE);
        const team = await carriedTeam(tx);
        return {
          statusBefore, result, team,
          roster: await rosterOf(tx, team.id),
          enrolled: { mate: await enrolled(tx, MATE), third: await enrolled(tx, THIRD), captain: await enrolled(tx, CAPTAIN) }
        };
      });
      expect(outcome.statusBefore.teams[0]).toMatchObject({ state: "waiting", canTakeover: true });
      expect(outcome.statusBefore.teams[0].roster.map(row => row.userId)).toEqual([THIRD]);
      expect(outcome.team).toMatchObject({ captain_id: MATE, name: "十月隊", status: "forming", carried_from_team_id: TEAM });
      expect(outcome.roster.sort((a, b) => a.member_role.localeCompare(b.member_role))).toEqual([
        { user_id: MATE, member_role: "captain" },
        { user_id: THIRD, member_role: "member" }
      ]);
      expect(outcome.enrolled).toEqual({ mate: true, third: true, captain: false });
      expect(outcome.result.teams[0]).toMatchObject({ teamId: outcome.team.id, memberCount: 2, skippedMembers: [] });
    });

    it("先按先贏：後按的人已被帶入，回報已在隊上，沒有第二支隊", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await takeOver(tx, MATE);
        const second = await takeOver(tx, THIRD);
        const count = (await tx.query(
          `SELECT COUNT(*)::int AS n FROM public.reading_teams WHERE global_plan_id = $1`, [TARGET]
        )).rows[0].n;
        return { second, count };
      });
      expect(outcome.count).toBe(1);
      expect(outcome.second.teams[0]).toMatchObject({ alreadyCarried: true, actorIsMember: true });
    });

    it("已在別隊或不符合加入條件的隊員略過並列出", async () => {
      const noZone = await asService(async tx => {
        await seed(tx);
        await tx.query(`UPDATE public.profiles SET pastoral_zone = '' WHERE id = $1`, [THIRD]);
        return takeOver(tx, MATE);
      });
      expect(noZone.teams[0].skippedMembers).toEqual([
        { userId: THIRD, name: "測試會友 0678", reason: "plan_requires_pastoral_zone" }
      ]);
      const inOther = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "別隊", memberIds: [THIRD] });
        return takeOver(tx, MATE);
      });
      expect(inOther.teams[0].skippedMembers).toEqual([
        { userId: THIRD, name: "測試會友 0678", reason: "already_in_target_team" }
      ]);
    });

    it("隊長已經重建隊伍時仍可接手，隊長的隊不受影響", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "隊長新隊" });
        const status = await statusOf(tx, MATE);
        await takeOver(tx, MATE);
        const team = await carriedTeam(tx);
        return { status, roster: await rosterOf(tx, team.id), captainTeam: await rosterOf(tx, OTHER_TARGET_TEAM) };
      });
      expect(outcome.status.teams[0]).toMatchObject({ state: "waiting", canTakeover: true });
      expect(outcome.roster.map(row => row.user_id).sort()).toEqual([MATE, THIRD].sort());
      expect(outcome.captainTeam).toEqual([{ user_id: CAPTAIN, member_role: "captain" }]);
    });

    it("只有原隊員能接手；原隊長請走帶隊；已在同組別有隊的人不能接手", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        return takeOver(tx, OUTSIDER);
      })).rejects.toThrow(/team_takeover_member_required/);
      await expect(asService(async tx => {
        await seed(tx);
        return takeOver(tx, CAPTAIN);
      })).rejects.toThrow(/team_takeover_member_required/);
      await expect(asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "別隊", memberIds: [MATE] });
        return takeOver(tx, MATE);
      })).rejects.toThrow(/already_in_plan_division/);
    });

    it("接手者還沒設定牧區：不能接手", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await tx.query(`UPDATE public.profiles SET pastoral_zone = '' WHERE id = $1`, [MATE]);
        return takeOver(tx, MATE);
      })).rejects.toThrow(/plan_requires_pastoral_zone/);
    });
  });

  describe("補帶（第 5 點）", () => {
    it("隊長自己的隊還有空位：補進上月隊員，標成來源隊伍的延續，之後不能再被接手", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "隊長新隊" });
        const statusBefore = await statusOf(tx, CAPTAIN);
        const result = await backfill(tx, CAPTAIN);
        const team = (await tx.query(`SELECT * FROM public.reading_teams WHERE id = $1`, [OTHER_TARGET_TEAM])).rows[0];
        const roster = await rosterOf(tx, OTHER_TARGET_TEAM);
        const statusAfter = await statusOf(tx, CAPTAIN);
        const again = await takeOver(tx, MATE);
        return { statusBefore, result, team, roster, statusAfter, again, plan: await enrolled(tx, THIRD) };
      });
      expect(outcome.statusBefore.teams).toEqual([expect.objectContaining({
        state: "backfill", role: "captain", ownTeamId: OTHER_TARGET_TEAM, ownTeamName: "隊長新隊", ownTeamVacancy: 2
      })]);
      expect(outcome.result).toMatchObject({ teamId: OTHER_TARGET_TEAM, addedCount: 2, skippedMembers: [] });
      expect(outcome.team).toMatchObject({ carried_from_team_id: TEAM, status: "ready" });
      expect(outcome.roster).toHaveLength(3);
      expect(outcome.plan).toBe(true);
      expect(outcome.statusAfter.teams).toEqual([]);
      expect(outcome.again.teams[0]).toMatchObject({ alreadyCarried: true, actorIsMember: true });
    });

    it("補到額滿為止，多的人略過並列出", async () => {
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "隊長新隊", memberIds: [OUTSIDER] });
        const statusBefore = await statusOf(tx, CAPTAIN);
        const result = await backfill(tx, CAPTAIN);
        return { statusBefore, result, roster: await rosterOf(tx, OTHER_TARGET_TEAM) };
      });
      expect(outcome.statusBefore.teams[0].roster.filter(row => row.reason === null)).toHaveLength(1);
      expect(outcome.statusBefore.teams[0].roster.filter(row => row.reason === "team_full")).toHaveLength(1);
      expect(outcome.result.addedCount).toBe(1);
      expect(outcome.result.skippedMembers).toEqual([expect.objectContaining({ reason: "team_full" })]);
      expect(outcome.roster).toHaveLength(3);
    });

    it("隊長在別人的隊當隊員不能補帶，但上月隊員仍可接手", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "別隊", memberIds: [CAPTAIN] });
        return backfill(tx, CAPTAIN);
      })).rejects.toThrow(/team_backfill_captain_required/);
      const outcome = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: OUTSIDER, name: "別隊", memberIds: [CAPTAIN] });
        const captain = await statusOf(tx, CAPTAIN);
        const mate = await statusOf(tx, MATE);
        await takeOver(tx, MATE);
        return { captain, mate, team: await carriedTeam(tx) };
      });
      expect(outcome.captain.teams).toEqual([]);
      expect(outcome.mate.teams[0]).toMatchObject({ state: "waiting", canTakeover: true });
      expect(outcome.team).toMatchObject({ captain_id: MATE });
    });

    it("隊伍額滿、或上月隊員都已經有隊：不顯示補帶", async () => {
      const full = await asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "隊長新隊", memberIds: [MATE, THIRD] });
        return statusOf(tx, CAPTAIN);
      });
      expect(full.teams).toEqual([]);
    });

    it("別人已帶入後，隊長不能再補帶同一支來源隊伍", async () => {
      await expect(asService(async tx => {
        await seed(tx);
        await addTargetTeam(tx, { captainId: CAPTAIN, name: "隊長新隊" });
        await takeOver(tx, MATE);
        return backfill(tx, CAPTAIN);
      })).rejects.toThrow(/team_backfill_already_carried/);
    });
  });

  it("新 RPC 只開給 service_role，authenticated 和 anon 都不能直接呼叫", async () => {
    const { rows } = await db.query(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
       FROM pg_proc p
       WHERE p.proname IN ('get_reading_team_carry_status', 'take_over_reading_team_carry',
                           'backfill_reading_team_from_source', 'join_carried_reading_team')`
    );
    expect(rows).toHaveLength(4);
    rows.forEach(row => expect(row, row.proname).toMatchObject({ anon: false, authenticated: false, service: true }));
  });
});

// #675：測驗作答／計分／關卷／統計的特徵測試。先對改寫前的函式跑過，鎖住行為後才把逐題迴圈換成集合式寫法。
const examId = n => `e${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
const EX = {
  paper: examId(1),
  plainPaper: examId(2),
  emptyPaper: examId(3),
  q: { tf: examId(11), single: examId(12), multi: examId(13), match: examId(14), order: examId(15), nokey: examId(16), missing: examId(17), short: examId(18) },
  plainQ: { a: examId(21), b: examId(22) },
  attempt: examId(31),
  practice: examId(32),
  rehearsal: examId(33),
  otherAttempt: examId(34)
};

async function seedExamPaper(tx, id, { status = "published", openAt = "now() - interval '1 hour'", closeAt = "now() + interval '1 hour'", linkedPlan = null, results = "NULL", practice = true } = {}) {
  await tx.query(
    `INSERT INTO public.exam_papers (id, title, status, open_at, close_at, duration_minutes, total_points, published_at, practice_retake_enabled, linked_plan_id, results_published_at)
     VALUES ($1, '測試試卷', $2, ${openAt}, ${closeAt}, 60, 100, now() - interval '2 hours', $3, $4, ${results})`,
    [id, status, practice, linkedPlan]
  );
}

async function seedExamQuestion(tx, id, paperId, section, position, points, answerKey) {
  await tx.query(
    `INSERT INTO public.exam_questions (id, paper_id, section, position, points, answer_key) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, paperId, section, position, points, answerKey === null ? null : JSON.stringify(answerKey)]
  );
}

async function seedExamAttempt(tx, id, paperId, userId, { status = "submitted", kind = "official", isTest = false, deadline = "now() + interval '30 minutes'", officialId = null, total = null } = {}) {
  await tx.query(
    `INSERT INTO public.exam_attempts (id, paper_id, user_id, status, attempt_kind, is_test, deadline_at, pledge_name, official_attempt_id, practice_acknowledged_at, started_at, submitted_at, auto_score, total_score)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::boolean, ${deadline}, '測試宣示', $7::uuid, CASE WHEN $5::text = 'practice' THEN now() END,
       TIMESTAMPTZ '2026-10-01 10:00:00+08', CASE WHEN $4::text <> 'in_progress' THEN TIMESTAMPTZ '2026-10-01 10:30:00+08' END, $8::numeric, $8::numeric)`,
    [id, paperId, userId, status, kind, isTest, officialId, total]
  );
}

const seedExamAnswer = (tx, attemptId, questionId, section, response, awarded = null) => tx.query(
  `INSERT INTO public.exam_answers (attempt_id, question_id, section, response, auto_correct, awarded_points) VALUES ($1, $2, $3, $4::jsonb, NULL, $5)`,
  [attemptId, questionId, section, response === undefined ? null : JSON.stringify(response), awarded]
);

/** 主試卷：涵蓋所有題型、沒填正解的題目、完全沒作答的題目、簡答。 */
async function seedExamFixture(tx) {
  await tx.query(
    `INSERT INTO public.app_feature_settings (key, enabled) VALUES ('speed_reading_exam', TRUE)
     ON CONFLICT (key) DO UPDATE SET enabled = TRUE`
  );
  await seedExamPaper(tx, EX.paper);
  await seedExamQuestion(tx, EX.q.tf, EX.paper, "truefalse", 1, 2, true);
  await seedExamQuestion(tx, EX.q.single, EX.paper, "single", 1, 3, 1);
  await seedExamQuestion(tx, EX.q.multi, EX.paper, "multiple", 1, 4, [0, 2]);
  await seedExamQuestion(tx, EX.q.match, EX.paper, "matching", 1, 5, { a: 1, b: 2 });
  await seedExamQuestion(tx, EX.q.order, EX.paper, "ordering", 1, 6, [2, 0, 1]);
  await seedExamQuestion(tx, EX.q.nokey, EX.paper, "single", 2, 7, null);
  await seedExamQuestion(tx, EX.q.missing, EX.paper, "single", 3, 8, 0);
  await seedExamQuestion(tx, EX.q.short, EX.paper, "shortanswer", 1, 10, null);
  // 沒有簡答的試卷
  await seedExamPaper(tx, EX.plainPaper);
  await seedExamQuestion(tx, EX.plainQ.a, EX.plainPaper, "truefalse", 1, 2, true);
  await seedExamQuestion(tx, EX.plainQ.b, EX.plainPaper, "single", 1, 3, 1);
  // 沒有題目的試卷
  await seedExamPaper(tx, EX.emptyPaper);
}

/** 主試卷上的一份作答：對 tf／multi／match，錯 single／order，nokey 沒正解，missing 沒作答；自動分 2+4+5=11。 */
async function seedExamAnswers(tx, attemptId, { shortAwarded = null } = {}) {
  await seedExamAnswer(tx, attemptId, EX.q.tf, "truefalse", true);
  await seedExamAnswer(tx, attemptId, EX.q.single, "single", 0);
  await seedExamAnswer(tx, attemptId, EX.q.multi, "multiple", [2, 0]);
  await seedExamAnswer(tx, attemptId, EX.q.match, "matching", { b: 2, a: 1 });
  await seedExamAnswer(tx, attemptId, EX.q.order, "ordering", [2, 1, 0]);
  await seedExamAnswer(tx, attemptId, EX.q.nokey, "single", 1);
  await seedExamAnswer(tx, attemptId, EX.q.short, "shortanswer", "我的簡答", shortAwarded);
}

/** 以超級使用者建好資料後切成 service_role（跟 nlc-data 一樣）執行，結束一律 rollback。 */
async function withExam(fn) {
  let result;
  let failure;
  try {
    await db.transaction(async tx => {
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
      await tx.exec(`SET LOCAL session_replication_role = replica`);
      await seedExamFixture(tx);
      await tx.exec(`SET LOCAL session_replication_role = DEFAULT`);
      // 測試中途要再放資料：暫時切回超級使用者、關掉觸發器
      const seed = async work => {
        await tx.exec(`RESET ROLE`);
        await tx.exec(`SET LOCAL session_replication_role = replica`);
        await work();
        await tx.exec(`SET LOCAL session_replication_role = DEFAULT`);
        await tx.exec(`SET LOCAL ROLE service_role`);
      };
      await tx.exec(`SET LOCAL ROLE service_role`);
      try {
        result = await fn(tx, seed);
      } catch (error) {
        failure = error;
      }
      await tx.rollback();
    });
  } catch (error) {
    if (!failure && !/rollback|aborted/i.test(String(error?.message))) throw error;
  }
  if (failure) throw failure;
  return result;
}

const attemptRow = async (tx, id) => (await tx.query(
  `SELECT status, submit_reason, auto_score::float8 AS auto, manual_score::float8 AS manual, total_score::float8 AS total
   FROM public.exam_attempts WHERE id = $1`, [id]
)).rows[0];

const answerRows = async (tx, id) => Object.fromEntries((await tx.query(
  `SELECT question_id, response, auto_correct, awarded_points::float8 AS points FROM public.exam_answers WHERE attempt_id = $1`, [id]
)).rows.map(row => [row.question_id, { response: row.response, correct: row.auto_correct, points: row.points }]));

describe("測驗計分 _exam_score_attempt（#675 特徵）", () => {
  const score = (tx, id) => tx.query(`SELECT public._exam_score_attempt($1)`, [id]);

  it("各題型計分；沒正解、沒作答都算 0 分；簡答沒批改前狀態留在 submitted、總分 NULL", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member);
        await seedExamAnswers(tx, EX.attempt);
      });
      await score(tx, EX.attempt);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "submitted", auto: 11, manual: null, total: null });
      const rows = await answerRows(tx, EX.attempt);
      expect(rows[EX.q.tf]).toMatchObject({ correct: true, points: 2 });
      expect(rows[EX.q.single]).toMatchObject({ correct: false, points: 0 });
      expect(rows[EX.q.multi]).toMatchObject({ correct: true, points: 4 });
      expect(rows[EX.q.match]).toMatchObject({ correct: true, points: 5 });
      expect(rows[EX.q.order]).toMatchObject({ correct: false, points: 0 });
      expect(rows[EX.q.nokey]).toMatchObject({ correct: false, points: 0 });
      // 沒作答的題目不會補列，簡答不被自動計分碰到
      expect(rows[EX.q.missing]).toBeUndefined();
      expect(rows[EX.q.short]).toMatchObject({ response: "我的簡答", correct: null, points: null });
    });
  });

  it("簡答都批改完 → graded，總分＝自動分＋簡答分", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member);
        await seedExamAnswers(tx, EX.attempt, { shortAwarded: 7 });
      });
      await score(tx, EX.attempt);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", auto: 11, manual: 7, total: 18 });
      expect((await answerRows(tx, EX.attempt))[EX.q.short]).toMatchObject({ correct: null, points: 7 });
    });
  });

  it("試卷有簡答題但這份作答沒有簡答列 → 視同批改完，簡答分 0", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member);
        await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", true);
      });
      await score(tx, EX.attempt);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", auto: 2, manual: 0, total: 2 });
    });
  });

  it("沒有簡答的試卷 → graded、簡答分 0", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.plainPaper, ids.member);
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.a, "truefalse", true);
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.b, "single", 0);
      });
      await score(tx, EX.attempt);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", auto: 2, manual: 0, total: 2 });
    });
  });

  it("沒有題目的試卷：自動分 0（不是 NULL）", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.emptyPaper, ids.member));
      await score(tx, EX.attempt);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", auto: 0, manual: 0, total: 0 });
    });
  });

  it("重作練習：簡答不等批改，直接 graded，manual NULL、總分＝自動分", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { kind: "practice", officialId: EX.attempt });
        await seedExamAnswers(tx, EX.practice);
      });
      await score(tx, EX.practice);
      expect(await attemptRow(tx, EX.practice)).toMatchObject({ status: "graded", auto: 11, manual: null, total: 11 });
    });
  });

  it("作答中或不存在的作答：什麼都不做、不報錯", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
        await seedExamAnswers(tx, EX.attempt);
      });
      await score(tx, EX.attempt);
      await score(tx, examId(999));
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "in_progress", auto: null, total: null });
      expect((await answerRows(tx, EX.attempt))[EX.q.tf]).toMatchObject({ correct: null, points: null });
    });
  });

  it("改正解後重算會覆蓋舊分數；不屬於這份試卷的作答列不受影響", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member);
        await seedExamAnswers(tx, EX.attempt);
        // 掛在別份試卷題目上的髒資料
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.a, "truefalse", true);
      });
      await score(tx, EX.attempt);
      await seed(() => tx.query(`UPDATE public.exam_questions SET answer_key = '0'::jsonb WHERE id = $1`, [EX.q.single]));
      await score(tx, EX.attempt);
      const rows = await answerRows(tx, EX.attempt);
      expect(rows[EX.q.single]).toMatchObject({ correct: true, points: 3 });
      expect(rows[EX.plainQ.a]).toMatchObject({ correct: null, points: null });
      expect((await attemptRow(tx, EX.attempt)).auto).toBe(14);
    });
  });
});

describe("測驗交卷 exam_submit_attempt（#675 特徵）", () => {
  const submit = async (tx, attemptId, answers, reason = "manual", actor = ids.member) => (await tx.query(
    `SELECT public.exam_submit_attempt($1, $2::jsonb, $3, $4) AS result`,
    [attemptId, answers === null ? null : JSON.stringify(answers), reason, actor]
  )).rows[0].result;

  it("送出的答案覆蓋暫存；沒送的保留暫存；JSON null 算有送；每題都補一列；多餘的 key 不理", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
        await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", false, 9);
        await seedExamAnswer(tx, EX.attempt, EX.q.single, "single", 2, 9);
        await seedExamAnswer(tx, EX.attempt, EX.q.multi, "multiple", [1], 9);
      });
      const result = await submit(tx, EX.attempt, {
        [EX.q.tf]: true, [EX.q.multi]: null, [EX.q.short]: "新的簡答", [EX.plainQ.a]: true
      });
      expect(result).toEqual({ attemptId: EX.attempt, status: "submitted", attemptKind: "official", autoScore: null, totalScore: null, alreadySubmitted: false });
      const rows = await answerRows(tx, EX.attempt);
      expect(Object.keys(rows)).toHaveLength(8);
      expect(rows[EX.q.tf]).toEqual({ response: true, correct: null, points: null });
      expect(rows[EX.q.single]).toEqual({ response: 2, correct: null, points: null });
      expect(rows[EX.q.multi]).toEqual({ response: null, correct: null, points: null });
      expect(rows[EX.q.short]).toEqual({ response: "新的簡答", correct: null, points: null });
      expect(rows[EX.q.order]).toEqual({ response: null, correct: null, points: null });
      expect(rows[EX.plainQ.a]).toBeUndefined();
      const { rows: [jsonNull] } = await tx.query(
        `SELECT response IS NULL AS sql_null, jsonb_typeof(response) AS kind FROM public.exam_answers WHERE attempt_id = $1 AND question_id = $2`,
        [EX.attempt, EX.q.multi]
      );
      expect(jsonNull).toEqual({ sql_null: false, kind: "null" });
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "submitted", submit_reason: "manual", auto: null, manual: null, total: null });
    });
  });

  it("p_answers 是 NULL 或不是物件：只用暫存，不報錯", async () => {
    for (const payload of [null, [1, 2], 5]) {
      await withExam(async (tx, seed) => {
        await seed(async () => {
          await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
          await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", false);
        });
        await submit(tx, EX.attempt, payload);
        const rows = await answerRows(tx, EX.attempt);
        expect(rows[EX.q.tf].response).toBe(false);
        expect(Object.keys(rows)).toHaveLength(8);
      });
    }
  });

  it("送出原因只接受 manual／timeout／auto_close，其他一律 manual", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await submit(tx, EX.attempt, {}, "timeout");
      expect((await attemptRow(tx, EX.attempt)).submit_reason).toBe("timeout");
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await submit(tx, EX.attempt, {}, "亂填");
      expect((await attemptRow(tx, EX.attempt)).submit_reason).toBe("manual");
    });
  });

  it("重複送出不覆蓋答案；重作練習不能送出；別人的作答查不到", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "submitted" });
        await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", false);
      });
      expect(await submit(tx, EX.attempt, { [EX.q.tf]: true })).toEqual({ attemptId: EX.attempt, status: "submitted", attemptKind: "official", alreadySubmitted: true });
      expect((await answerRows(tx, EX.attempt))[EX.q.tf].response).toBe(false);
    });
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { status: "in_progress", kind: "practice", officialId: EX.attempt });
      });
      await expect(submit(tx, EX.practice, {})).rejects.toThrow(/exam_practice_no_submit/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await expect(submit(tx, EX.attempt, {}, "manual", ids.other)).rejects.toThrow(/exam_attempt_not_found/);
    });
  });

  it("試作送出就計分；正式作答要等收卷", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET status = 'draft' WHERE id = $1`, [EX.plainPaper]);
        await seedExamAttempt(tx, EX.rehearsal, EX.plainPaper, ids.admin, { status: "in_progress", isTest: true });
      });
      await submit(tx, EX.rehearsal, { [EX.plainQ.a]: true, [EX.plainQ.b]: 1 }, "manual", ids.admin);
      expect(await attemptRow(tx, EX.rehearsal)).toMatchObject({ status: "graded", auto: 5, manual: 0, total: 5 });
    });
  });

  it("已過截止時間才送：先被關卷收走，送出的答案不算", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 minute' WHERE id = $1`, [EX.plainPaper]);
        await seedExamAttempt(tx, EX.attempt, EX.plainPaper, ids.member, { status: "in_progress" });
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.a, "truefalse", true);
      });
      const result = await submit(tx, EX.attempt, { [EX.plainQ.b]: 1 });
      expect(result).toMatchObject({ status: "graded", alreadySubmitted: true });
      const rows = await answerRows(tx, EX.attempt);
      expect(rows[EX.plainQ.a]).toEqual({ response: true, correct: true, points: 2 });
      expect(rows[EX.plainQ.b]).toEqual({ response: null, correct: false, points: 0 });
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", submit_reason: "auto_close", auto: 2, total: 2 });
    });
  });
});

describe("測驗暫存 exam_save_progress（#675 特徵）", () => {
  const save = async (tx, attemptId, answers, actor = ids.member) => (await tx.query(
    `SELECT public.exam_save_progress($1, $2::jsonb, $3) AS result`,
    [attemptId, answers === null ? null : JSON.stringify(answers), actor]
  )).rows[0].result;

  it("只寫有送的題目；已存的被覆蓋並清掉計分；不屬於本卷的題目不理；JSON null 照存", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
        await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", false, 9);
        await seedExamAnswer(tx, EX.attempt, EX.q.single, "single", 2, 9);
      });
      const result = await save(tx, EX.attempt, { [EX.q.tf]: true, [EX.q.multi]: null, [EX.q.short]: "暫存", [EX.plainQ.a]: true, [examId(999)]: 1 });
      expect(result).toMatchObject({ attemptId: EX.attempt, saved: true, attemptKind: "official", practiceCloseAt: null });
      expect(result.secondsRemaining).toBeGreaterThan(0);
      const rows = await answerRows(tx, EX.attempt);
      expect(Object.keys(rows).sort()).toEqual([EX.q.tf, EX.q.single, EX.q.multi, EX.q.short].sort());
      expect(rows[EX.q.tf]).toEqual({ response: true, correct: null, points: null });
      expect(rows[EX.q.single]).toEqual({ response: 2, correct: null, points: 9 });
      expect(rows[EX.q.multi].response).toBeNull();
      const { rows: [row] } = await tx.query(
        `SELECT section, jsonb_typeof(response) AS kind FROM public.exam_answers WHERE attempt_id = $1 AND question_id = $2`,
        [EX.attempt, EX.q.multi]
      );
      expect(row).toEqual({ section: "multiple", kind: "null" });
    });
  });

  it("大寫 UUID 當 key 也對得到題目；同一題大小寫都送時，以小寫那筆為準（jsonb 排序較後）", async () => {
    const upper = id => id.replace(/e/g, "E");
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await save(tx, EX.attempt, { [upper(EX.q.tf)]: "大寫", [upper(EX.q.single)]: "大寫", [EX.q.single]: "小寫" });
      const rows = await answerRows(tx, EX.attempt);
      expect(rows[EX.q.tf].response).toBe("大寫");
      expect(rows[EX.q.single].response).toBe("小寫");
    });
  });

  it("key 不是 UUID 就整筆失敗，即使試卷沒有題目；不是物件也失敗；NULL 視同空物件", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await expect(save(tx, EX.attempt, { "not-a-uuid": 1 })).rejects.toThrow(/invalid input syntax for type uuid/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.emptyPaper, ids.member, { status: "in_progress" }));
      await expect(save(tx, EX.attempt, { "not-a-uuid": 1 })).rejects.toThrow(/invalid input syntax for type uuid/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await expect(save(tx, EX.attempt, [1, 2])).rejects.toThrow(/non-object/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      expect(await save(tx, EX.attempt, null)).toMatchObject({ saved: true });
      expect(await answerRows(tx, EX.attempt)).toEqual({});
    });
  });

  it("鎖定情況：已交卷、超過期限 120 秒、別人的作答、複習期限已過", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "submitted" }));
      await expect(save(tx, EX.attempt, {})).rejects.toThrow(/exam_attempt_locked/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress", deadline: "now() - interval '121 seconds'" }));
      await expect(save(tx, EX.attempt, {})).rejects.toThrow(/exam_time_up/);
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress", deadline: "now() - interval '119 seconds'" }));
      expect(await save(tx, EX.attempt, {})).toMatchObject({ saved: true, secondsRemaining: 0 });
    });
    await withExam(async (tx, seed) => {
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      await expect(save(tx, EX.attempt, {}, ids.other)).rejects.toThrow(/exam_attempt_not_found/);
    });
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET status = 'closed', close_at = now() - interval '1 hour' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { status: "in_progress", kind: "practice", officialId: EX.attempt });
      });
      const result = await save(tx, EX.practice, { [EX.q.tf]: true });
      expect(result).toMatchObject({ saved: true, attemptKind: "practice", secondsRemaining: null });
      expect(result.practiceCloseAt).toBeTruthy();
      expect((await answerRows(tx, EX.practice))[EX.q.tf].response).toBe(true);
    });
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET status = 'closed', close_at = now() - interval '2 days' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { status: "in_progress", kind: "practice", officialId: EX.attempt });
      });
      // 過期的複習先被 sweep 收走 → 鎖定
      await expect(save(tx, EX.practice, {})).rejects.toThrow(/exam_attempt_locked/);
    });
  });
});

describe("測驗關卷（#675 特徵）", () => {
  const sweep = async tx => (await tx.query(`SELECT public._exam_close_expired_papers() AS n`)).rows[0].n;
  const paperRow = async (tx, id) => (await tx.query(`SELECT status, close_reason, closed_at IS NOT NULL AS has_closed_at FROM public.exam_papers WHERE id = $1`, [id])).rows[0];

  it("過截止時間：卷變 closed、正式作答補滿答案並計分、重作練習不動、試作刪除", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 second' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
        await seedExamAnswer(tx, EX.attempt, EX.q.tf, "truefalse", true);
        await seedExamAttempt(tx, EX.otherAttempt, EX.paper, ids.other, { status: "submitted" });
        await seedExamAnswer(tx, EX.otherAttempt, EX.q.tf, "truefalse", true);
        await seedExamAnswer(tx, EX.otherAttempt, EX.q.short, "shortanswer", "簡答", 4);
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.other, { status: "in_progress", kind: "practice", officialId: EX.otherAttempt });
        await seedExamAttempt(tx, EX.rehearsal, EX.paper, ids.admin, { status: "in_progress", isTest: true });
      });
      expect(await sweep(tx)).toBe(1);
      expect(await paperRow(tx, EX.paper)).toEqual({ status: "closed", close_reason: "scheduled", has_closed_at: true });
      // 作答中被收卷：補滿 8 題，簡答沒批改所以停在 submitted
      expect(Object.keys(await answerRows(tx, EX.attempt))).toHaveLength(8);
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "submitted", submit_reason: "auto_close", auto: 2, manual: null, total: null });
      // 收卷前已交：簡答批改過，自動 graded；沒有被補列
      expect(Object.keys(await answerRows(tx, EX.otherAttempt))).toHaveLength(2);
      expect(await attemptRow(tx, EX.otherAttempt)).toMatchObject({ status: "graded", auto: 2, manual: 4, total: 6 });
      expect((await attemptRow(tx, EX.practice)).status).toBe("in_progress");
      expect(await attemptRow(tx, EX.rehearsal)).toBeUndefined();
      // 再跑一次沒有事情做
      expect(await sweep(tx)).toBe(0);
    });
  });

  it("重作練習過了截止後一天自動交卷", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET status = 'closed', close_at = now() - interval '1 day' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { status: "in_progress", kind: "practice", officialId: EX.attempt });
      });
      await sweep(tx);
      expect(await attemptRow(tx, EX.practice)).toMatchObject({ status: "submitted", submit_reason: "auto_close" });
    });
  });

  it("還沒到截止時間：卷不動；開放前的試作留著，開放後才刪", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET open_at = now() + interval '1 hour', close_at = now() + interval '2 hours' WHERE id = $1`, [EX.plainPaper]);
        await seedExamAttempt(tx, EX.rehearsal, EX.plainPaper, ids.admin, { status: "in_progress", isTest: true });
        await seedExamAttempt(tx, EX.otherAttempt, EX.paper, ids.admin, { status: "in_progress", isTest: true });
      });
      expect(await sweep(tx)).toBe(0);
      expect((await paperRow(tx, EX.plainPaper)).status).toBe("published");
      expect((await attemptRow(tx, EX.rehearsal)).status).toBe("in_progress");
      expect(await attemptRow(tx, EX.otherAttempt)).toBeUndefined();
    });
  });

  it("exam_recompute_scores 重算正式與重作練習；改正解後分數跟著變", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await tx.query(`UPDATE public.exam_papers SET status = 'closed', close_at = now() - interval '1 hour' WHERE id = $1`, [EX.plainPaper]);
        await seedExamAttempt(tx, EX.attempt, EX.plainPaper, ids.member, { status: "graded" });
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.a, "truefalse", true);
        await seedExamAnswer(tx, EX.attempt, EX.plainQ.b, "single", 0);
        await seedExamAttempt(tx, EX.practice, EX.plainPaper, ids.member, { status: "submitted", kind: "practice", officialId: EX.attempt });
        await seedExamAnswer(tx, EX.practice, EX.plainQ.b, "single", 0);
        await tx.query(`UPDATE public.exam_questions SET answer_key = '0'::jsonb WHERE id = $1`, [EX.plainQ.b]);
      });
      const { rows: [{ result }] } = await tx.query(`SELECT public.exam_recompute_scores($1, $2) AS result`, [EX.plainPaper, ids.admin]);
      expect(result).toEqual({ paperId: EX.plainPaper, recomputed: 1, practiceRecomputed: 1 });
      expect(await attemptRow(tx, EX.attempt)).toMatchObject({ status: "graded", auto: 5, total: 5 });
      expect(await attemptRow(tx, EX.practice)).toMatchObject({ status: "graded", auto: 3, total: 3 });
    });
  });
});

describe("首頁測驗卡片（#675：不再執行關卷寫入，到時間仍立刻看到已截止）", () => {
  const homeExams = async (tx, actor = ids.member) =>
    (await tx.query(`SELECT public.exam_home_exams($1) AS result`, [actor])).rows[0].result;
  const homeBanner = async (tx, actor = ids.member) =>
    (await tx.query(`SELECT public.exam_home_banner($1) AS result`, [actor])).rows[0].result;
  const paperStatus = async (tx, id) =>
    (await tx.query(`SELECT status FROM public.exam_papers WHERE id = $1`, [id])).rows[0].status;
  const onlyPaper = (tx, id) => tx.query(`DELETE FROM public.exam_papers WHERE id <> $1`, [id]);
  const withoutClock = ({ serverNow: _serverNow, ...card }) => card;

  it("作答期間：可進入、作答中都照實回報", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => onlyPaper(tx, EX.paper));
      expect((await homeExams(tx))[0]).toMatchObject({
        paperId: EX.paper, status: "published", stage: "open", inWindow: true, canEnter: true,
        myAttemptStatus: null, canReviewOfficial: false, canPractice: false, resultReady: false
      });
      await seed(() => seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" }));
      expect((await homeBanner(tx))).toMatchObject({
        paperId: EX.paper, status: "published", stage: "open", canEnter: false,
        myAttemptStatus: "in_progress", canReviewOfficial: false, canPractice: false
      });
    });
  });

  it("已排程未開放：顯示 scheduled，不能進入", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await onlyPaper(tx, EX.paper);
        await tx.query(`UPDATE public.exam_papers SET open_at = now() + interval '1 hour', close_at = now() + interval '2 hours' WHERE id = $1`, [EX.paper]);
      });
      expect((await homeExams(tx))[0]).toMatchObject({ status: "published", stage: "scheduled", inWindow: false, canEnter: false });
    });
  });

  it("過了截止時間、排程還沒跑：卡片跟關卷後一模一樣", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await onlyPaper(tx, EX.paper);
        await tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 second' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
      });
      const before = await homeExams(tx);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        status: "closed", stage: "grading", inWindow: false, canEnter: false,
        myAttemptStatus: "submitted", canReviewOfficial: true, canPractice: true, resultReady: false, myTotalScore: null
      });
      const banner = await homeBanner(tx);
      await tx.query(`SELECT public._exam_close_expired_papers()`);
      expect(await paperStatus(tx, EX.paper)).toBe("closed");
      const after = await homeExams(tx);
      expect(after.map(withoutClock)).toEqual(before.map(withoutClock));
      expect(withoutClock(await homeBanner(tx))).toEqual(withoutClock(banner));
    });
  });

  it("過了截止時間又沒作答：首頁不顯示這份卷", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await onlyPaper(tx, EX.paper);
        await tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 second' WHERE id = $1`, [EX.paper]);
      });
      expect(await homeExams(tx)).toEqual([]);
      expect(await homeBanner(tx)).toBeNull();
    });
  });

  it("首頁兩支 RPC 不寫入：卷、作答、試作都原封不動", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await onlyPaper(tx, EX.paper);
        await tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 second' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "in_progress" });
        await seedExamAttempt(tx, EX.rehearsal, EX.paper, ids.admin, { status: "in_progress", isTest: true });
      });
      await homeExams(tx);
      await homeBanner(tx);
      expect(await paperStatus(tx, EX.paper)).toBe("published");
      expect((await attemptRow(tx, EX.attempt)).status).toBe("in_progress");
      expect((await attemptRow(tx, EX.rehearsal)).status).toBe("in_progress");
      expect(await answerRows(tx, EX.attempt)).toEqual({});
    });
  });

  it("重作練習到期還沒被收：卡片不再顯示作答中", async () => {
    await withExam(async (tx, seed) => {
      await seed(async () => {
        await onlyPaper(tx, EX.paper);
        await tx.query(`UPDATE public.exam_papers SET status = 'closed', close_at = now() - interval '1 day' WHERE id = $1`, [EX.paper]);
        await seedExamAttempt(tx, EX.attempt, EX.paper, ids.member, { status: "graded" });
        await seedExamAttempt(tx, EX.practice, EX.paper, ids.member, { status: "in_progress", kind: "practice", officialId: EX.attempt });
      });
      const { rows: [{ result }] } = await tx.query(`SELECT public._exam_member_paper_summary($1, $2, FALSE) AS result`, [EX.paper, ids.member]);
      expect(result).toMatchObject({ practiceAttemptStatus: "submitted", canPractice: false, practiceReviewReady: true });
    });
  });

  it("功能關閉時回空", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => tx.query(`UPDATE public.app_feature_settings SET enabled = FALSE WHERE key = 'speed_reading_exam'`));
      expect(await homeExams(tx)).toEqual([]);
      expect(await homeBanner(tx)).toBeNull();
    });
  });

  it("其他觸發點都還在：排程，以及進入作答／查成績／我的測驗／後台試卷／統計／交卷", async () => {
    const { rows } = await db.query(`SELECT schedule, command FROM cron.job WHERE jobname = 'exam-auto-close'`);
    expect(rows).toEqual([{ schedule: "* * * * *", command: "SELECT public._exam_close_expired_papers();" }]);
    const triggers = [
      tx => tx.query(`SELECT public.exam_get_for_attempt($1, $2)`, [EX.paper, ids.member]),
      tx => tx.query(`SELECT public.exam_get_my_result($1, $2)`, [EX.paper, ids.member]),
      tx => tx.query(`SELECT public.exam_my_papers($1)`, [ids.member]),
      tx => tx.query(`SELECT public.exam_get_paper_admin($1, $2)`, [EX.paper, ids.admin]),
      tx => tx.query(`SELECT public.exam_get_stats($1, $2)`, [EX.paper, ids.admin]),
      tx => tx.query(`SELECT public.exam_finalize_expired($1, $2)`, [EX.paper, ids.admin])
    ];
    for (const trigger of triggers) {
      await withExam(async (tx, seed) => {
        await seed(() => tx.query(`UPDATE public.exam_papers SET close_at = now() - interval '1 second' WHERE id = $1`, [EX.paper]));
        await trigger(tx);
        expect(await paperStatus(tx, EX.paper)).toBe("closed");
      });
    }
  });
});

describe("測驗統計 exam_get_stats（#675 特徵）", () => {
  const statId = n => `f${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const S = {
    paper: statId(1),
    q: statId(2),
    teamOld: statId(3), team3: statId(4), team6: statId(5),
    leader: statId(9),
    user: n => statId(100 + n),
    attempt: n => statId(200 + n),
    plan: n => statId(300 + n)
  };
  // 1,2,6,10-14 讀完一遍；3 沒讀完；4 只有個人計畫；5 沒計畫；7 交卷未批改；8 作答中；9 試作不算
  const USERS = [
    [1, "大區甲", "牧區一", "小組一", "graded", 90], [2, "大區甲", "牧區一", "小組一", "graded", 80],
    [3, "大區甲", "牧區一", "小組二", "graded", 70], [4, "大區乙", "牧區二", "小組三", "graded", 60],
    [5, "大區乙", "牧區二", "小組三", "graded", 50], [6, "大區乙", "牧區二", "小組四", "graded", 40],
    [7, "大區甲", "牧區一", "小組一", "submitted", null], [8, "大區乙", "牧區二", "小組三", "in_progress", null],
    [9, "大區甲", "牧區一", "小組一", "graded", 100], [10, "大區甲", "牧區一", "小組一", "graded", 30],
    [11, "大區甲", "", "", "graded", 20],
    // 讓牧區一、小組一在開篩選時母體也滿 5 人，prZone／prGroup 才算得出來
    [12, "大區甲", "牧區一", "小組一", "graded", 85], [13, "大區甲", "牧區一", "小組一", "graded", 75],
    [14, "大區甲", "牧區一", "小組一", "graded", 65]
  ];

  async function seedStats(tx) {
    const role = async code => (await tx.query(`SELECT id FROM public.role_definitions WHERE code = $1`, [code])).rows[0].id;
    const memberRole = await role("member");
    await seedExamPaper(tx, S.paper, { linkedPlan: ids.plan, closeAt: "now() - interval '1 hour'", openAt: "now() - interval '2 hours'", status: "closed" });
    await seedExamQuestion(tx, S.q, S.paper, "single", 1, 10, 1);
    for (const [n, region, zone, group, status, total] of USERS) {
      await tx.query(
        `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, small_group, is_active) VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [S.user(n), `統計會友 ${String(n).padStart(2, "0")}`, memberRole, region, zone, group]
      );
      await seedExamAttempt(tx, S.attempt(n), S.paper, S.user(n), { status, total, isTest: n === 9 });
      if (status !== "in_progress") await seedExamAnswer(tx, S.attempt(n), S.q, "single", n % 2);
    }
    await tx.query(
      `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, small_group, managed_zones, is_active) VALUES ($1, '統計牧區長', $2, '大區甲', '牧區一', '小組一', '牧區一', TRUE)`,
      [S.leader, await role("zone_leader")]
    );
    const plan = (n, round, personal = false, globalPlan = ids.plan) => tx.query(
      `INSERT INTO public.reading_plans (id, user_id, global_plan_id, name, start_date, end_date, target_books, current_round, is_personal)
       VALUES ($1, $2, $3, '統計計畫', '2026-09-01', '2026-12-31', ARRAY['GEN'], $4, $5)`,
      [S.plan(n), S.user(n), globalPlan, round, personal]
    );
    await plan(1, 2);
    await plan(2, 1);
    await plan(3, 1);
    await plan(4, 2, true, null);
    await plan(6, 3);
    await plan(10, 2);
    await plan(11, 2);
    await plan(12, 2);
    await plan(13, 2);
    await plan(14, 2);
    const logs = (n, chapters) => Promise.all(chapters.map(chapter => tx.query(
      `INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, round) VALUES ($1, $2, 'GEN', $3, 1)`,
      [S.user(n), S.plan(n), chapter]
    )));
    await logs(2, [1, 2, 3]);
    await logs(3, [1, 2]);
    await logs(4, [1, 2, 3]); // 個人計畫的紀錄不算
    await tx.query(
      `INSERT INTO public.reading_teams (id, global_plan_id, division, name, captain_id, invite_code, carried_from_team_id, created_at) VALUES
         ($1, $4, 3, '舊三人隊', $5, 'STATOLD001', NULL, now() - interval '30 days'),
         ($2, $4, 3, '三人隊', $5, 'STATNEW001', $1, now() - interval '1 day'),
         ($3, $4, 6, '六人隊', $6, 'STATSIX001', NULL, now() - interval '1 day')`,
      [S.teamOld, S.team3, S.team6, ids.plan, S.user(1), S.user(4)]
    );
    const members = (team, division, users) => Promise.all(users.map(n => tx.query(
      `INSERT INTO public.reading_team_members (team_id, global_plan_id, division, user_id, member_role) VALUES ($1, $2, $3, $4, 'member')`,
      [team, ids.plan, division, S.user(n)]
    )));
    await members(S.team3, 3, [1, 2, 3]);
    await members(S.team6, 6, [4, 5, 6]);
  }

  const stats = async (tx, actor, firstRound = false, book = null, chapters = null) => (await tx.query(
    `SELECT public.exam_get_stats($1, $2, $3, $4, $5) AS result`, [S.paper, actor, firstRound, book, chapters]
  )).rows[0].result;

  /** 去掉隨每次執行變動的 id、把名單壓成一行，讓快照讀得懂。 */
  const view = r => ({
    meta: [r.scope, r.prVisible, r.resultsPublished, r.readingBook, r.requireFirstRound].join("|"),
    overall: r.overall,
    byRegion: r.byRegion,
    byZone: r.byZone,
    byGroup: r.byGroup,
    byTeamSize: r.byTeamSize,
    teamRanking: r.teamRanking.map(({ teamId: _teamId, ...team }) => team),
    byQuestion: r.byQuestion,
    roster: r.roster.map(row => [row.name.slice(-2), row.status, row.totalScore, row.timeSeconds, row.teamLabel, row.firstRoundDone, row.prChurch, row.prZone, row.prGroup].join("|"))
  });

  // 快照是改寫前的函式產生的（#675），之後不該因為效能改寫而變動
  const expectStatsGolden = (result, name) =>
    expect(`${JSON.stringify(view(result), null, 1)}\n`).toMatchFileSnapshot(`./fixtures/exam-stats-${name}.json`);

  it("管理員、開「讀完一遍」篩選：母體、PR、缺口都只算讀完的人", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      await expectStatsGolden(await stats(tx, ids.admin, true, " GEN ", 3), "admin-first-round");
    });
  });

  it("管理員、不開篩選但給書卷：統計全算，名單仍標出誰讀完", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      await expectStatsGolden(await stats(tx, ids.admin, false, "GEN", 3), "admin-book-only");
    });
  });

  it("管理員、沒給書卷：firstRoundDone 是 NULL，notReadCount 是 0", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      const result = await stats(tx, ids.admin);
      expect(result.overall.notReadCount).toBe(0);
      expect(result.roster.every(row => row.firstRoundDone === null)).toBe(true);
      // 開關開著但書卷空白：等於沒開
      const blank = await stats(tx, ids.admin, true, "   ", 3);
      expect(blank.requireFirstRound).toBe(false);
      expect(blank.readingBook).toBeNull();
      expect(view(blank).roster).toEqual(view(result).roster);
    });
  });

  it("章數沒給或是 0：只有 current_round>=2 才算讀完", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      for (const chapters of [null, 0]) {
        const flags = Object.fromEntries((await stats(tx, ids.admin, false, "GEN", chapters)).roster.map(row => [row.name.slice(-2), row.firstRoundDone]));
        expect(flags).toMatchObject({ "01": true, "02": false, "03": false, "04": false, "05": false, "06": true, "10": true, "11": true });
      }
    });
  });

  it("牧區長只看自己牧區；成績未公布時看不到 PR", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      await expectStatsGolden(await stats(tx, S.leader, true, "GEN", 3), "zone-leader-first-round");
    });
  });

  it("會友不能看", async () => {
    await withExam(async (tx, seed) => {
      await seed(() => seedStats(tx));
      await expect(stats(tx, ids.member)).rejects.toThrow(/exam_admin_required/);
    });
  });
});

describe("測驗相關索引（#675）", () => {
  it("新索引都建好；重複的都刪了，涵蓋它們的唯一索引都還在", async () => {
    const { rows } = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const names = new Set(rows.map(row => row.indexname));
    for (const name of [
      "idx_quiz_publications_quiz_id", "idx_reading_teams_carried_from_team_id",
      "idx_exam_attempts_paper_is_test", "idx_exam_attempts_official_attempt_id",
      "exam_questions_paper_id_section_position_key", "quiz_publications_global_plan_id_quiz_date_small_group_id_key",
      "exam_answers_attempt_id_question_id_key", "lightning_quiz_attempts_question_id_user_id_key",
      "verse_notes_user_id_book_chapter_verse_key", "highlights_user_id_book_chapter_verse_key"
    ]) expect(names.has(name), name).toBe(true);
    for (const name of [
      "idx_exam_questions_paper", "idx_quiz_publications_plan_date_group", "idx_exam_answers_attempt",
      "idx_lightning_quiz_attempts_question", "idx_verse_notes_user_chapter", "idx_highlights_user_chapter"
    ]) expect(names.has(name), name).toBe(false);
  });
});

describe("批次提醒未報名者（send_plan_join_invitations_batch，#676）", () => {
  const person = n => `20000000-0000-4000-8000-0000000676${String(n).padStart(2, "0")}`;
  const STAGE_PLAN_KEY = "stage-676";
  const OTHER_PRESET_PLAN = "40000000-0000-4000-8000-000000000676";
  // 收件人：組織三層都分得開，才測得出每個角色的範圍
  const R = {
    sameGroup: person(1),
    otherGroup: person(2),
    otherZone: person(3),
    otherRegion: person(4),
    inactive: person(5),
    joined: person(6),
    joinedByPreset: person(7),
    noOrg: person(8),
    unknown: "20000000-0000-4000-8000-000000067699"
  };
  // 發送者：含「管理範圍是空的」三種，一定要 fail closed
  const A = {
    pastor: person(20),
    greatManaged: person(21),
    greatFallback: person(22),
    greatEmpty: person(23),
    zoneManaged: person(24),
    zoneFallback: person(25),
    zoneEmpty: person(26),
    groupManaged: person(27),
    groupFallback: person(28),
    groupEmpty: person(29),
    otherZoneLeader: person(30),
    member: person(31)
  };

  const addPerson = (tx, id, role, { region = "", zone = "", group = "", managedRegions = "", managedZones = "", managedGroups = "", active = true } = {}) => tx.query(
    `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, small_group, managed_regions, managed_zones, managed_groups, is_active)
     SELECT $1, '測試會友 0676', definition.id, $3, $4, $5, $6, $7, $8, $9 FROM public.role_definitions AS definition WHERE definition.code = $2`,
    [id, role, region, zone, group, managedRegions, managedZones, managedGroups, active]
  );

  const seedPeople = async tx => {
    const home = { region: "大區 A", zone: "牧區 A-1", group: "小組 A-1-1" };
    await addPerson(tx, R.sameGroup, "member", home);
    await addPerson(tx, R.otherGroup, "member", { ...home, group: "小組 A-1-2" });
    await addPerson(tx, R.otherZone, "member", { region: "大區 A", zone: "牧區 A-2", group: "小組 A-2-1" });
    await addPerson(tx, R.otherRegion, "member", { region: "大區 B", zone: "牧區 B-1", group: "小組 B-1-1" });
    await addPerson(tx, R.inactive, "member", { ...home, active: false });
    await addPerson(tx, R.joined, "member", home);
    await addPerson(tx, R.joinedByPreset, "member", home);
    await addPerson(tx, R.noOrg, "member");

    await addPerson(tx, A.pastor, "pastor");
    await addPerson(tx, A.greatManaged, "great_zone_leader", { region: "大區 B", managedRegions: "大區 A" });
    await addPerson(tx, A.greatFallback, "great_zone_leader", { region: "大區 A" });
    await addPerson(tx, A.greatEmpty, "great_zone_leader");
    await addPerson(tx, A.zoneManaged, "zone_leader", { zone: "牧區 B-1", managedZones: "牧區 A-1, 牧區 A-2" });
    await addPerson(tx, A.zoneFallback, "zone_leader", { zone: "牧區 A-1" });
    await addPerson(tx, A.zoneEmpty, "zone_leader");
    await addPerson(tx, A.groupManaged, "group_leader", { group: "小組 B-1-1", managedGroups: "小組 A-1-1" });
    await addPerson(tx, A.groupFallback, "group_leader", { group: "小組 A-1-1" });
    await addPerson(tx, A.groupEmpty, "group_leader");
    await addPerson(tx, A.otherZoneLeader, "zone_leader", { zone: "牧區 B-1" });
    await addPerson(tx, A.member, "member", home);

    await tx.query(
      `INSERT INTO public.global_plans (id, name, start_date, end_date, target_books) VALUES ($1, '另一個計畫', '2026-09-01', '2026-12-31', ARRAY['GEN'])`,
      [OTHER_PRESET_PLAN]
    );
    await tx.query(
      `INSERT INTO public.reading_plans (user_id, global_plan_id, name, start_date, end_date, target_books)
       SELECT $1, id, name, start_date, end_date, target_books FROM public.global_plans WHERE id = $2`,
      [R.joined, ids.plan]
    );
    await tx.query(
      `INSERT INTO public.reading_plans (user_id, global_plan_id, preset_key, name, start_date, end_date, target_books)
       SELECT $1, id, $3, name, start_date, end_date, target_books FROM public.global_plans WHERE id = $2`,
      [R.joinedByPreset, OTHER_PRESET_PLAN, STAGE_PLAN_KEY]
    );
  };

  const batch = async (tx, actorId, recipientIds, planKey = STAGE_PLAN_KEY, planId = ids.plan) => (await tx.query(
    `SELECT public.send_plan_join_invitations_batch(p_global_plan_id => $1, p_recipient_ids => $2::uuid[], p_plan_key => $3, p_actor_id => $4) AS result`,
    [planId, recipientIds, planKey, actorId]
  )).rows[0].result.results;
  const single = async (tx, actorId, recipientId, planKey = STAGE_PLAN_KEY) => (await tx.query(
    `SELECT public.send_plan_join_invitation($1, $2, $3, $4) AS result`,
    [ids.plan, recipientId, planKey, actorId]
  )).rows[0].result;
  const statusById = results => Object.fromEntries(results.map(row => [row.recipient_id, row.status]));
  const reminders = async (tx, senderId) => (await tx.query(
    `SELECT sender_id, recipient_id, global_plan_id, plan_key, reason, message, status, sent_on::text AS sent_on
     FROM public.care_reminders WHERE sender_id = $1 ORDER BY recipient_id`,
    [senderId]
  )).rows;
  const uuids = count => Array.from({ length: count }, (_, index) =>
    `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

  // 單筆的結果換成批次的狀態名稱，兩邊才比得起來
  const SINGLE_ERROR_STATUS = {
    plan_invitation_recipient_not_found: "not_found",
    plan_invitation_self_not_allowed: "self",
    plan_member_outside_scope: "outside_scope",
    plan_invitation_recipient_already_joined: "already_joined"
  };
  const singleStatus = async (tx, actorId, recipientId) => {
    await tx.exec("SAVEPOINT single_676");
    try {
      const result = await single(tx, actorId, recipientId);
      return result.sent ? "sent" : "duplicate";
    } catch (error) {
      const code = Object.keys(SINGLE_ERROR_STATUS).find(key => String(error.message).includes(key));
      if (!code) throw error;
      return SINGLE_ERROR_STATUS[code];
    } finally {
      await tx.exec("ROLLBACK TO SAVEPOINT single_676");
    }
  };

  it("每個角色、每種收件人，結果都跟單筆 RPC 一樣（含空範圍 fail closed）", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      const recipients = Object.values(R);
      const actors = [ids.admin, ...Object.values(A).filter(id => id !== A.member)];
      const seen = new Set();
      for (const actorId of actors) {
        const everyone = [...recipients, actorId];
        await tx.exec("SAVEPOINT batch_676");
        const results = statusById(await batch(tx, actorId, everyone));
        await tx.exec("ROLLBACK TO SAVEPOINT batch_676");
        for (const recipientId of everyone) {
          expect(results[recipientId], `actor ${actorId} → ${recipientId}`).toBe(await singleStatus(tx, actorId, recipientId));
          seen.add(results[recipientId]);
        }
      }
      // 這張表真的走過每一種結果，不是全部同一個答案剛好相等
      expect([...seen].sort()).toEqual(["already_joined", "not_found", "outside_scope", "self", "sent"]);
    });
  }, 60_000);

  it("超範圍的人明確回 outside_scope、不寫入；同一批範圍內的人照送", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      const results = statusById(await batch(tx, A.zoneFallback, [R.sameGroup, R.otherGroup, R.otherZone, R.otherRegion]));
      expect(results).toEqual({
        [R.sameGroup]: "sent",
        [R.otherGroup]: "sent",
        [R.otherZone]: "outside_scope",
        [R.otherRegion]: "outside_scope"
      });
      expect((await reminders(tx, A.zoneFallback)).map(row => row.recipient_id).sort()).toEqual([R.sameGroup, R.otherGroup].sort());
    });
  });

  it.each([
    ["大區長", "greatEmpty"],
    ["區長", "zoneEmpty"],
    ["小組長", "groupEmpty"]
  ])("%s沒有管理範圍：所有人都 outside_scope、一筆都不寫（連組織也空白的人）", async (_label, key) => {
    await asService(async tx => {
      await seedPeople(tx);
      const results = await batch(tx, A[key], [R.sameGroup, R.otherRegion, R.noOrg]);
      expect(results.map(row => row.status)).toEqual(["outside_scope", "outside_scope", "outside_scope"]);
      expect(await reminders(tx, A[key])).toEqual([]);
    });
  });

  it("寫進去的內容和單筆完全一樣（訊息由伺服器決定）", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      await single(tx, A.pastor, R.sameGroup);
      await batch(tx, A.greatFallback, [R.sameGroup]);
      const [fromSingle] = await reminders(tx, A.pastor);
      const [fromBatch] = await reminders(tx, A.greatFallback);
      expect({ ...fromBatch, sender_id: null }).toEqual({ ...fromSingle, sender_id: null });
      expect(fromBatch).toMatchObject({
        sender_id: A.greatFallback,
        plan_key: `plan-invite:${ids.plan}`,
        reason: "encouragement",
        message: "邀請你加入「測試計畫」讀經計畫，一起開始讀經吧！",
        status: "unread"
      });
    });
  });

  it("今天已提醒的人不重複：批次再送、單筆先送都回 duplicate；別的發送者、昨天的不算", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      expect(statusById(await batch(tx, A.pastor, [R.sameGroup]))).toEqual({ [R.sameGroup]: "sent" });
      expect(statusById(await batch(tx, A.pastor, [R.sameGroup, R.otherGroup]))).toEqual({ [R.sameGroup]: "duplicate", [R.otherGroup]: "sent" });
      expect(await reminders(tx, A.pastor)).toHaveLength(2);

      // 批次送過 → 單筆看得到
      expect(await single(tx, A.pastor, R.otherGroup)).toEqual({ sent: false, duplicate: true });
      // 單筆送過 → 批次看得到
      await single(tx, A.pastor, R.otherZone);
      expect(statusById(await batch(tx, A.pastor, [R.otherZone]))).toEqual({ [R.otherZone]: "duplicate" });

      // 去重是每位發送者各自算，跟單筆的唯一鍵一樣
      expect(statusById(await batch(tx, A.greatFallback, [R.sameGroup]))).toEqual({ [R.sameGroup]: "sent" });

      // 昨天提醒過的，今天可以再提醒
      await tx.query(
        `INSERT INTO public.care_reminders (sender_id, recipient_id, global_plan_id, plan_key, reason, message, status, sent_on)
         VALUES ($1, $2, $3, $4, 'encouragement', '昨天的提醒', 'unread', CURRENT_DATE - 1)`,
        [A.pastor, R.otherRegion, ids.plan, `plan-invite:${ids.plan}`]
      );
      expect(statusById(await batch(tx, A.pastor, [R.otherRegion]))).toEqual({ [R.otherRegion]: "sent" });
    });
  });

  it("重複的 id 只算一次、NULL 略過；空名單回空結果", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      const results = await batch(tx, A.pastor, [R.sameGroup, R.sameGroup, null, R.sameGroup]);
      expect(results).toEqual([{ recipient_id: R.sameGroup, status: "sent" }]);
      expect(await reminders(tx, A.pastor)).toHaveLength(1);
      expect(await batch(tx, A.pastor, [])).toEqual([]);
      expect(await batch(tx, A.pastor, null)).toEqual([]);
    });
  });

  it(`上限 ${PLAN_INVITE_BATCH_MAX_RECIPIENTS} 人（跟前端分批一致），算的是去重後的人數`, async () => {
    await asService(async tx => {
      const atLimit = await batch(tx, ids.admin, uuids(PLAN_INVITE_BATCH_MAX_RECIPIENTS));
      expect(atLimit).toHaveLength(PLAN_INVITE_BATCH_MAX_RECIPIENTS);
      expect(new Set(atLimit.map(row => row.status))).toEqual(new Set(["not_found"]));
      const withDuplicates = await batch(tx, ids.admin, [...uuids(PLAN_INVITE_BATCH_MAX_RECIPIENTS), ...uuids(10)]);
      expect(withDuplicates).toHaveLength(PLAN_INVITE_BATCH_MAX_RECIPIENTS);
    });
    await expect(asService(tx => batch(tx, ids.admin, uuids(PLAN_INVITE_BATCH_MAX_RECIPIENTS + 1))))
      .rejects.toThrow(/plan_invitation_batch_too_large/);
  }, 60_000);

  it("超過上限整批不寫", async () => {
    await asService(async tx => {
      await seedPeople(tx);
      await tx.exec("SAVEPOINT too_large_676");
      await expect(batch(tx, A.pastor, [R.sameGroup, ...uuids(PLAN_INVITE_BATCH_MAX_RECIPIENTS)]))
        .rejects.toThrow(/plan_invitation_batch_too_large/);
      await tx.exec("ROLLBACK TO SAVEPOINT too_large_676");
      expect(await reminders(tx, A.pastor)).toEqual([]);
    });
  });

  it("身分：沒帶 actor、不存在的 actor、一般會友都拒絕", async () => {
    await expect(asService(tx => batch(tx, null, [ids.member]))).rejects.toThrow(/profile_required/);
    await expect(asService(tx => batch(tx, person(98), [ids.member]))).rejects.toThrow(/profile_required/);
    await expect(asService(tx => batch(tx, ids.member, [ids.other]))).rejects.toThrow(/plan_management_scope_required/);
  });

  it("計畫不存在回 plan_not_found", async () => {
    await expect(asService(tx => batch(tx, ids.admin, [ids.member], "", "40000000-0000-4000-8000-00000000dead")))
      .rejects.toThrow(/plan_not_found/);
  });

  it("只開給 service_role：client 不能直接呼叫，也不能傳別人的 actor", async () => {
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'send_plan_join_invitations_batch'`
    );
    expect(rows).toEqual([{ anon: false, authenticated: false, service: true }]);
    await expect(as("authenticated", { sub: ids.adminAuth }, tx => batch(tx, null, [ids.member])))
      .rejects.toThrow(/permission denied/);
    await expect(as("authenticated", { sub: ids.memberAuth }, tx => batch(tx, ids.admin, [ids.other])))
      .rejects.toThrow(/permission denied/);
    await expect(as("anon", {}, tx => batch(tx, ids.admin, [ids.other])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("克勞斯店家查看兌換紀錄（#679）", () => {
  const SEED_WEEK = "2026-09-21";
  const NOT_ON_LIST_MS = 4567;
  const MERCHANT_KEYS = ["amount", "code", "expiresOn", "name", "rank", "redeemedAt", "redeemedVia", "riseDate", "status"];
  const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];

  // 登入過的帳號（有 user_identities）才能被指定；ids.other 預設沒有身分。
  const addIdentity = (tx, profileId, sub) => tx.query(
    `INSERT INTO public.user_identities (profile_id, provider, provider_user_id, is_primary) VALUES ($1, 'logto', $2, TRUE)`,
    [profileId, sub]
  );
  const setMerchant = async (tx, profileId, enabled, actorId = ids.admin) =>
    (await one(tx, `SELECT public.admin_set_voucher_merchant($1, $2, $3) AS r`, [profileId, enabled, actorId])).r;
  const access = async (tx, actorId) =>
    (await one(tx, `SELECT public.get_my_voucher_merchant_access($1) AS r`, [actorId])).r;
  const list = async (tx, actorId, month = null) =>
    (await one(tx, `SELECT public.get_voucher_merchant_vouchers($1, $2) AS r`, [month, actorId])).r;
  const lookup = async (tx, actorId, code) =>
    (await one(tx, `SELECT public.lookup_voucher_merchant_code($1, $2) AS r`, [code, actorId])).r;
  const candidates = async (tx, query, actorId = ids.admin) =>
    (await one(tx, `SELECT public.admin_search_voucher_merchant_candidates($1, $2) AS r`, [query, actorId])).r;
  const merchants = async (tx, actorId = ids.admin) =>
    (await one(tx, `SELECT public.admin_list_voucher_merchants($1) AS r`, [actorId])).r;

  // 四張券：可使用／已兌換（本人）／已過期／已作廢，都是 member 得的；店家是 other。
  const seedVouchers = async tx => {
    await tx.query(
      `INSERT INTO public.lightning_quiz_week_rankings (week_start, entries, display_days, display_until)
       VALUES ($1::date, $2::jsonb, 1, $1::date + 7)`,
      [SEED_WEEK, JSON.stringify(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map(riseDate => ({
        riseDate,
        winners: [{ rank: 1, userId: ids.member, name: "得獎者甲", pastoralZone: "牧區 A-1", elapsedMs: NOT_ON_LIST_MS }]
      })))]
    );
    const { rows } = await tx.query(`SELECT id, code, rise_date::text AS rise_date FROM public.lightning_quiz_vouchers ORDER BY rise_date`);
    const [available, redeemed, expired, voided] = rows;
    await tx.query(`UPDATE public.lightning_quiz_vouchers SET redeemed_at = NOW(), redeemed_by = $2, redeemed_via = 'self' WHERE id = $1`, [redeemed.id, ids.member]);
    await tx.query(`UPDATE public.lightning_quiz_vouchers SET expires_on = (NOW() AT TIME ZONE 'Asia/Taipei')::date - 1 WHERE id = $1`, [expired.id]);
    await tx.query(`UPDATE public.lightning_quiz_vouchers SET voided_at = NOW() WHERE id = $1`, [voided.id]);
    return { available, redeemed, expired, voided };
  };
  const asMerchant = fn => asService(async tx => {
    await addIdentity(tx, ids.other, "merchant-sub-other");
    await setMerchant(tx, ids.other, true);
    return fn(tx);
  });
  const auditRows = async (tx, actionLike) => {
    await tx.exec("RESET ROLE");
    const { rows } = await tx.query(
      `SELECT action, result, actor_id, actor_role, source, target_user_id, target_id, changes, detail
       FROM audit.admin_events WHERE action LIKE $1 ORDER BY id`,
      [actionLike]
    );
    return rows;
  };
  const thisMonth = tx => one(tx, `SELECT to_char(NOW() AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS m`).then(row => row.m);

  describe("權限", () => {
    it("一般會友沒有入口，直接呼叫清單與查碼都被拒絕", async () => {
      expect(await asService(tx => access(tx, ids.member))).toEqual({ isMerchant: false });
      await expect(asService(tx => list(tx, ids.member))).rejects.toThrow(/voucher_merchant_required/);
      await expect(asService(tx => lookup(tx, ids.member, "ABCDEF"))).rejects.toThrow(/voucher_merchant_required/);
    });

    it("系統管理員沒有被指定也不算店家", async () => {
      expect(await asService(tx => access(tx, ids.admin))).toEqual({ isMerchant: false });
      await expect(asService(tx => list(tx, ids.admin))).rejects.toThrow(/voucher_merchant_required/);
    });

    it("沒有帶呼叫者一律拒絕", async () => {
      await expect(asService(tx => tx.query(`SELECT public.get_voucher_merchant_vouchers(NULL, NULL)`))).rejects.toThrow(/profile_required/);
      await expect(asService(tx => tx.query(`SELECT public.lookup_voucher_merchant_code('ABCDEF', NULL)`))).rejects.toThrow(/profile_required/);
    });

    it("指定後查得到；移除後立刻查不到", async () => {
      const outcome = await asMerchant(async tx => {
        const before = await access(tx, ids.other);
        await seedVouchers(tx);
        const listed = await list(tx, ids.other);
        await setMerchant(tx, ids.other, false);
        const after = await access(tx, ids.other);
        await tx.query("SAVEPOINT s");
        const listError = await list(tx, ids.other).then(() => null, error => String(error.message));
        await tx.query("ROLLBACK TO SAVEPOINT s");
        const lookupError = await lookup(tx, ids.other, "ABCDEF").then(() => null, error => String(error.message));
        await tx.query("ROLLBACK TO SAVEPOINT s");
        return { before, listed, after, listError, lookupError };
      });
      expect(outcome.before).toEqual({ isMerchant: true });
      expect(outcome.listed.vouchers.length).toBeGreaterThan(0);
      expect(outcome.after).toEqual({ isMerchant: false });
      expect(outcome.listError).toMatch(/voucher_merchant_required/);
      expect(outcome.lookupError).toMatch(/voucher_merchant_required/);
    });

    it("帳號停用的店家查不到", async () => {
      await expect(asMerchant(async tx => {
        await tx.query(`UPDATE public.profiles SET is_active = FALSE WHERE id = $1`, [ids.other]);
        return list(tx, ids.other);
      })).rejects.toThrow(/profile_required/);
    });

    it("函式與資料表只給 service_role：anon／authenticated 都不能直接碰", async () => {
      const { rows } = await db.query(
        `SELECT p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p
         WHERE p.proname IN ('get_my_voucher_merchant_access', 'get_voucher_merchant_vouchers', 'lookup_voucher_merchant_code',
                             'admin_list_voucher_merchants', 'admin_search_voucher_merchant_candidates', 'admin_set_voucher_merchant',
                             '_lightning_quiz_voucher_merchant_json', '_lightning_quiz_require_voucher_merchant',
                             '_voucher_merchant_assert_admin', '_voucher_merchant_list_json')`
      );
      expect(rows).toHaveLength(10);
      rows.forEach(row => expect(row, row.proname).toMatchObject({ anon: false, authenticated: false, service: true }));

      const { rows: tables } = await db.query(
        `SELECT c.relname, c.relrowsecurity AS rls,
                has_table_privilege('anon', c.oid, 'SELECT') AS anon,
                has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated,
                has_table_privilege('service_role', c.oid, 'SELECT') AS service
         FROM pg_class c
         WHERE c.relname IN ('lightning_quiz_voucher_merchants', 'lightning_quiz_voucher_lookup_limits') AND c.relkind = 'r'`
      );
      expect(tables).toHaveLength(2);
      tables.forEach(row => expect(row, row.relname).toMatchObject({ rls: true, anon: false, authenticated: false, service: true }));
    });
  });

  describe("清單", () => {
    it("每張券只回白名單欄位，沒有牧區、秒數、會員 ID、管理員姓名", async () => {
      const { result, redeemed } = await asMerchant(async tx => {
        const seeded = await seedVouchers(tx);
        return { result: await list(tx, ids.other), redeemed: seeded.redeemed };
      });
      expect(Object.keys(result).sort()).toEqual(["month", "months", "summary", "today", "truncated", "vouchers"]);
      expect(result.vouchers.length).toBeGreaterThan(0);
      result.vouchers.forEach(voucher => expect(Object.keys(voucher).sort()).toEqual(MERCHANT_KEYS));
      const text = JSON.stringify(result);
      for (const forbidden of ["牧區 A-1", ids.member, redeemed.id, "pastoralZone", "elapsedMs", "userId", "redeemedBy", "redeemedByName", "測試管理員", String(NOT_ON_LIST_MS)]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });

    it("回可使用、已兌換、已過期；已作廢不回；月對帳只算已兌換", async () => {
      const outcome = await asMerchant(async tx => {
        const seeded = await seedVouchers(tx);
        const month = await thisMonth(tx);
        return { seeded, month, result: await list(tx, ids.other, month) };
      });
      const byCode = Object.fromEntries(outcome.result.vouchers.map(voucher => [voucher.code, voucher]));
      expect(byCode[outcome.seeded.available.code].status).toBe("available");
      expect(byCode[outcome.seeded.redeemed.code]).toMatchObject({ status: "redeemed", redeemedVia: "self", amount: 100, rank: 1, name: "得獎者甲" });
      expect(byCode[outcome.seeded.expired.code].status).toBe("expired");
      expect(byCode[outcome.seeded.voided.code]).toBeUndefined();
      expect(outcome.result.vouchers.map(voucher => voucher.status)).not.toContain("void");
      expect(outcome.result.summary).toEqual({ redeemedCount: 1, redeemedAmount: 100 });
      expect(outcome.result.month).toBe(outcome.month);
      expect(outcome.result.months).toContain(outcome.month);
    });

    it("已兌換的券算兌換月，其他算發券月；別的月份查不到", async () => {
      const outcome = await asMerchant(async tx => {
        const seeded = await seedVouchers(tx);
        await tx.query(`UPDATE public.lightning_quiz_vouchers SET redeemed_at = '2026-08-31T16:30:00Z' WHERE id = $1`, [seeded.redeemed.id]); // 台灣 9/1 00:30
        await tx.query(`UPDATE public.lightning_quiz_vouchers SET issued_at = '2026-07-15T00:00:00Z' WHERE id = $1`, [seeded.available.id]);
        return {
          seeded,
          sept: await list(tx, ids.other, "2026-09"),
          july: await list(tx, ids.other, "2026-07"),
          empty: await list(tx, ids.other, "2020-01")
        };
      });
      expect(outcome.sept.vouchers.map(v => v.code)).toEqual([outcome.seeded.redeemed.code]);
      expect(outcome.sept.summary).toEqual({ redeemedCount: 1, redeemedAmount: 100 });
      expect(outcome.july.vouchers.map(v => v.code)).toEqual([outcome.seeded.available.code]);
      expect(outcome.july.summary).toEqual({ redeemedCount: 0, redeemedAmount: 0 });
      expect(outcome.empty.vouchers).toEqual([]);
      expect(outcome.sept.months).toEqual(expect.arrayContaining(["2026-09", "2026-07"]));
      expect(outcome.empty.months).toContain("2020-01");
    });

    it("教會補記顯示 redeemedVia = admin，不帶管理員", async () => {
      const voucher = await asMerchant(async tx => {
        const seeded = await seedVouchers(tx);
        await tx.query(`SELECT public.admin_set_lightning_quiz_voucher_redeemed($1, TRUE, $2)`, [seeded.available.id, ids.admin]);
        return (await lookup(tx, ids.other, seeded.available.code)).voucher;
      });
      expect(voucher).toMatchObject({ status: "redeemed", redeemedVia: "admin" });
      expect(Object.keys(voucher).sort()).toEqual(MERCHANT_KEYS);
    });

    it("月份格式不對就拒絕", async () => {
      await expect(asMerchant(tx => list(tx, ids.other, "2026-13"))).rejects.toThrow(/voucher_merchant_invalid_month/);
      await expect(asMerchant(tx => list(tx, ids.other, "x; DROP"))).rejects.toThrow(/voucher_merchant_invalid_month/);
    });

    it("看名單記一筆稽核（月份、筆數），不記內容", async () => {
      const rows = await asMerchant(async tx => {
        await seedVouchers(tx);
        const month = await thisMonth(tx);
        await list(tx, ids.other, month);
        return auditRows(tx, "voucher_merchant.view_list");
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ result: "ok", actor_id: ids.other, actor_role: "member", source: "nlc-data" });
      expect(rows[0].detail.rows).toBeGreaterThan(0);
      expect(JSON.stringify(rows[0])).not.toContain("得獎者甲");
    });
  });

  describe("查兌換碼", () => {
    it("查得到可使用／已兌換／已過期，不受月份限制，只回白名單欄位", async () => {
      const outcome = await asMerchant(async tx => {
        const seeded = await seedVouchers(tx);
        await tx.query(`UPDATE public.lightning_quiz_vouchers SET issued_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [seeded.available.id]);
        return {
          available: await lookup(tx, ids.other, seeded.available.code),
          redeemed: await lookup(tx, ids.other, seeded.redeemed.code),
          expired: await lookup(tx, ids.other, seeded.expired.code)
        };
      });
      expect(outcome.available).toMatchObject({ found: true, rateLimited: false, voucher: { status: "available" } });
      expect(outcome.redeemed.voucher.status).toBe("redeemed");
      expect(outcome.expired.voucher.status).toBe("expired");
      Object.values(outcome).forEach(result => {
        expect(Object.keys(result.voucher).sort()).toEqual(MERCHANT_KEYS);
        expect(JSON.stringify(result)).not.toContain("牧區 A-1");
      });
    });

    it("已作廢和不存在的回應一模一樣", async () => {
      const outcome = await asMerchant(async tx => {
        const { voided } = await seedVouchers(tx);
        return { voided: await lookup(tx, ids.other, voided.code), missing: await lookup(tx, ids.other, "ZZZZZZ") };
      });
      expect(outcome.voided).toEqual({ found: false, rateLimited: false, voucher: null });
      expect(outcome.missing).toEqual(outcome.voided);
    });

    it("小寫、空白、連字號都認得；格式不對不查也不算失敗次數", async () => {
      const outcome = await asMerchant(async tx => {
        const { available } = await seedVouchers(tx);
        const spaced = `${available.code.slice(0, 3)}- ${available.code.slice(3).toLowerCase()}`;
        const found = await lookup(tx, ids.other, spaced);
        const badFormat = [];
        for (const code of ["ABC", "ABCDEFG", "ABCDE0", "ABCDEI", "ABCDEL", "ABCDEO", "ABCDE1", "%%%%%%", "______", "", "A".repeat(500)]) {
          badFormat.push(await lookup(tx, ids.other, code));
        }
        const nullCode = await lookup(tx, ids.other, null);
        const limit = (await tx.query(`SELECT failed_count FROM public.lightning_quiz_voucher_lookup_limits WHERE profile_id = $1`, [ids.other])).rows[0];
        return { found, badFormat, nullCode, limit };
      });
      expect(outcome.found.found).toBe(true);
      outcome.badFormat.forEach(result => expect(result).toEqual({ found: false, rateLimited: false, voucher: null }));
      expect(outcome.nullCode).toEqual({ found: false, rateLimited: false, voucher: null });
      expect(outcome.limit?.failed_count ?? 0).toBe(0);
    });

    it("每小時猜錯 20 次就鎖住，連對的碼也查不到；時段過了才恢復；查到不算次數", async () => {
      const outcome = await asMerchant(async tx => {
        const { available, voided } = await seedVouchers(tx);
        // 查到的不算失敗
        for (let i = 0; i < 5; i += 1) await lookup(tx, ids.other, available.code);
        // 已作廢的算失敗（和不存在一樣）
        await lookup(tx, ids.other, voided.code);
        for (let i = 0; i < 17; i += 1) await lookup(tx, ids.other, "ZZZZZZ");
        const nineteenth = await lookup(tx, ids.other, "ZZZZZZ");
        const stillOk = await lookup(tx, ids.other, available.code);
        const twentieth = await lookup(tx, ids.other, "ZZZZZY");
        const locked = await lookup(tx, ids.other, available.code);
        const lockedBad = await lookup(tx, ids.other, "ABC");
        await tx.query(`UPDATE public.lightning_quiz_voucher_lookup_limits SET window_started_at = NOW() - INTERVAL '61 minutes' WHERE profile_id = $1`, [ids.other]);
        const reset = await lookup(tx, ids.other, available.code);
        return { nineteenth, stillOk, twentieth, locked, lockedBad, reset };
      });
      expect(outcome.nineteenth.found).toBe(false);
      expect(outcome.nineteenth.rateLimited).toBe(false);
      expect(outcome.stillOk.found).toBe(true);
      expect(outcome.twentieth).toEqual({ found: false, rateLimited: false, voucher: null });
      expect(outcome.locked).toEqual({ found: false, rateLimited: true, voucher: null });
      expect(outcome.lockedBad).toEqual({ found: false, rateLimited: true, voucher: null });
      expect(outcome.reset.found).toBe(true);
    });

    it("每次查詢記稽核：查到、查不到、被鎖；格式不對不記", async () => {
      const rows = await asMerchant(async tx => {
        const { available, voided } = await seedVouchers(tx);
        await lookup(tx, ids.other, available.code);
        await lookup(tx, ids.other, voided.code);
        await lookup(tx, ids.other, "ABC");
        await tx.query(`INSERT INTO public.lightning_quiz_voucher_lookup_limits (profile_id, window_started_at, failed_count)
                        VALUES ($1, NOW(), 20) ON CONFLICT (profile_id) DO UPDATE SET failed_count = 20`, [ids.other]);
        await lookup(tx, ids.other, available.code);
        return auditRows(tx, "voucher_merchant.lookup");
      });
      expect(rows.map(row => [row.result, row.detail.found])).toEqual([["ok", true], ["ok", false], ["denied", false]]);
      rows.forEach(row => expect(row.actor_id).toBe(ids.other));
    });
  });

  describe("管理員增刪", () => {
    it("只有系統管理員能查、搜尋、指定", async () => {
      await expect(asService(tx => merchants(tx, ids.member))).rejects.toThrow(/lightning_quiz_admin_required/);
      await expect(asService(tx => candidates(tx, "測試", ids.member))).rejects.toThrow(/lightning_quiz_admin_required/);
      await expect(asService(tx => setMerchant(tx, ids.member, true, ids.member))).rejects.toThrow(/lightning_quiz_admin_required/);
      // 牧者（雲柱其他管理函式放行）也不行
      await expect(asService(async tx => {
        await tx.query(`UPDATE public.profiles SET role_id = (SELECT id FROM public.role_definitions WHERE code = 'pastor') WHERE id = $1`, [ids.member]);
        return setMerchant(tx, ids.other, true, ids.member);
      })).rejects.toThrow(/lightning_quiz_admin_required/);
    });

    it("沒登入過（沒有 user_identities）、帳號停用、不存在的都不能指定", async () => {
      await expect(asService(tx => setMerchant(tx, ids.other, true))).rejects.toThrow(/voucher_merchant_not_eligible/);
      await expect(asService(async tx => {
        await addIdentity(tx, ids.other, "merchant-sub-other");
        await tx.query(`UPDATE public.profiles SET is_active = FALSE WHERE id = $1`, [ids.other]);
        return setMerchant(tx, ids.other, true);
      })).rejects.toThrow(/voucher_merchant_not_eligible/);
      await expect(asService(tx => setMerchant(tx, "21000000-0000-4000-8000-0000000000fe", true))).rejects.toThrow(/voucher_merchant_not_eligible/);
    });

    it("搜尋只找登入過、啟用中的帳號，email 遮罩，標出已指定", async () => {
      const outcome = await asService(async tx => {
        const none = await candidates(tx, "測試會友 0002");
        await addIdentity(tx, ids.other, "merchant-sub-other");
        await tx.query(`UPDATE public.profiles SET email = 'merchant-shop@example.invalid' WHERE id = $1`, [ids.other]);
        const before = await candidates(tx, "測試會友 0002");
        const byEmail = await candidates(tx, "merchant-shop");
        await setMerchant(tx, ids.other, true);
        const after = await candidates(tx, "測試會友 0002");
        await tx.query("SAVEPOINT s");
        const tooShortError = await candidates(tx, "a").then(() => null, error => String(error.message));
        await tx.query("ROLLBACK TO SAVEPOINT s");
        const wildcardError = await candidates(tx, "%%").then(() => null, error => String(error.message));
        await tx.query("ROLLBACK TO SAVEPOINT s");
        return { none, before, byEmail, after, tooShortError, wildcardError };
      });
      expect(outcome.none.candidates).toEqual([]);
      expect(outcome.before.candidates).toHaveLength(1);
      expect(outcome.before.candidates[0]).toMatchObject({ profileId: ids.other, name: "測試會友 0002", isMerchant: false });
      expect(outcome.byEmail.candidates[0].emailMasked).toBeTruthy();
      expect(outcome.byEmail.candidates[0].emailMasked).not.toContain("merchant-shop");
      expect(outcome.after.candidates[0].isMerchant).toBe(true);
      expect(outcome.tooShortError).toMatch(/voucher_merchant_query_too_short/);
      expect(outcome.wildcardError).toMatch(/voucher_merchant_query_too_short/);
    });

    it("增刪都寫稽核（同一個交易）；重複加入、重複移除不多記", async () => {
      const outcome = await asService(async tx => {
        await addIdentity(tx, ids.other, "merchant-sub-other");
        const added = await setMerchant(tx, ids.other, true);
        const addedAgain = await setMerchant(tx, ids.other, true);
        const listed = await merchants(tx);
        const removed = await setMerchant(tx, ids.other, false);
        const removedAgain = await setMerchant(tx, ids.other, false);
        return { added, addedAgain, listed, removed, removedAgain, rows: await auditRows(tx, "voucher_merchant.%") };
      });
      expect(outcome.added.changed).toBe(true);
      expect(outcome.added.merchants.map(row => row.profileId)).toEqual([ids.other]);
      expect(outcome.addedAgain.changed).toBe(false);
      expect(outcome.listed.merchants[0]).toMatchObject({ profileId: ids.other, name: "測試會友 0002" });
      expect(outcome.removed).toMatchObject({ changed: true, merchants: [] });
      expect(outcome.removedAgain.changed).toBe(false);
      expect(outcome.rows.map(row => row.action)).toEqual(["voucher_merchant.add", "voucher_merchant.remove"]);
      outcome.rows.forEach(row => expect(row).toMatchObject({ result: "ok", actor_id: ids.admin, actor_role: "admin", source: "nlc-data", target_user_id: ids.other }));
      expect(outcome.rows[0].changes).toEqual({ merchant: { before: false, after: true } });
      expect(outcome.rows[1].changes).toEqual({ merchant: { before: true, after: false } });
    });
  });
});

// ── #673 計畫統計名冊彙總：新 RPC 和舊前端算法逐人逐欄比對 ──────────────────────────
// 同一份資料走兩條路：舊的 get_plan_stats_roster＋前端算法，新的 get_plan_stats_roster_summary。
// 比對資料層的每個欄位（連續天數、補讀天數不經畫面的「有沒有讀」閘門）、組員總覽每一列、
// 組織統計樹、兩份 CSV。有差異時訊息會寫出情境、人、欄位、兩邊的值。
describe("計畫統計名冊彙總和舊算法逐人一致（get_plan_stats_roster_summary，#673）", () => {
  const GLOBAL_PLAN = "71000000-0000-4000-8000-000000000001";
  const OTHER_GLOBAL_PLAN = "71000000-0000-4000-8000-000000000002";
  const PLAN_NAME = "十月速讀";
  const ORG_STRUCTURE = {
    regions: ["大區一", "大區二"],
    zones: { 大區一: ["牧區一", "牧區二"], 大區二: ["牧區三"] },
    groups: { 牧區一: ["小組一", "小組二"], 牧區二: ["小組三"], 牧區三: ["小組四"] }
  };
  const ACTOR = "72000000-0000-4000-8000-000000000000";
  // 別名展開：全域計畫的 id、預設代號、名稱都算同一個計畫（getPlanFilterAliases）
  const GLOBAL_PLANS = [{ id: GLOBAL_PLAN, presetKey: "十月-preset", name: PLAN_NAME, books: ["利未記"] }];
  let memberRoleId;
  let app;

  const pad = (value, length) => String(value).padStart(length, "0");
  const taipei = (date, time = "12:00:00") => `${date}T${time}+08:00`;
  const addDays = (date, days) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // 一份情境資料。id 是固定的（失敗可重現），打卡 id 由亂數決定，順序跟插入順序無關。
  function createFixture(seed = 1) {
    const rng = mulberry32(seed);
    const randomUuid = () => {
      const hex = n => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
      return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
    };
    const fixture = { rng, profiles: [], plans: [], logs: [], randomUuid };
    fixture.person = (name, { region = "大區一", zone = "牧區一", group = "小組一" } = {}) => {
      const id = `72000000-0000-4000-8000-${pad(fixture.profiles.length + 1, 12)}`;
      fixture.profiles.push({ id, name, region, zone, group });
      return id;
    };
    // n：想要的 id 順序（一個人多筆報名時，「第一筆」看的就是 id）
    fixture.enroll = (userId, { books = ["利未記"], round = 1, handled = false, global = GLOBAL_PLAN, preset = null, name = PLAN_NAME, personal = false, n = null } = {}) => {
      const id = `73000000-0000-4000-8000-${pad(n ?? fixture.plans.length + 1, 12)}`;
      fixture.plans.push({ id, userId, books, round, handled, global, preset, name, personal });
      return id;
    };
    fixture.read = (userId, planId, book, chapter, at, round = 1) => {
      fixture.logs.push({ id: randomUuid(), userId, planId, book, chapter, at, round });
    };
    return fixture;
  }

  async function insertFixture(tx, fixture) {
    for (const person of fixture.profiles) {
      await tx.query(
        `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, small_group, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [person.id, person.name, memberRoleId, person.region, person.zone, person.group]
      );
    }
    for (const plan of fixture.plans) {
      await tx.query(
        `INSERT INTO public.reading_plans (id, user_id, global_plan_id, name, start_date, end_date, target_books, preset_key, current_round, upgrade_prompt_handled, is_personal)
         VALUES ($1, $2, $3, $4, '2026-10-01', '2026-12-31', $5::text[], $6, $7, $8, $9)`,
        [plan.id, plan.userId, plan.personal ? null : plan.global, plan.name, plan.books, plan.personal ? null : plan.preset, plan.round, plan.handled, plan.personal]
      );
    }
    if (fixture.logs.length) {
      await tx.query(
        `INSERT INTO public.reading_logs (id, user_id, plan_id, book, chapter, round, read_at)
         SELECT (row ->> 'id')::uuid, (row ->> 'userId')::uuid, (row ->> 'planId')::uuid, row ->> 'book',
                (row ->> 'chapter')::integer, (row ->> 'round')::integer, (row ->> 'at')::timestamptz
         FROM jsonb_array_elements($1::jsonb) AS row`,
        [JSON.stringify(fixture.logs)]
      );
    }
  }

  // 寫入都先關掉 trigger（階段開放時間那些），外部的計畫列也不用真的存在。測試結束 rollback。
  async function inRosterTx(fn) {
    let result;
    let failure;
    try {
      await db.transaction(async tx => {
        await tx.exec(`SET LOCAL session_replication_role = replica`);
        try {
          result = await fn(tx);
        } catch (error) {
          failure = error;
        }
        await tx.rollback();
      });
    } catch (error) {
      if (!failure && !/rollback|aborted/i.test(String(error?.message))) throw error;
    }
    if (failure) throw failure;
    return result;
  }

  // 假的 nlc-data：參數一律走真的 args builder，SQL 在 PGlite 用 service_role 跑。
  function createClient(tx, { summary = true, visibleIds = null, calls = [] } = {}) {
    const run = async (sql, params) => {
      await tx.exec(`SAVEPOINT roster_rpc; SET LOCAL ROLE service_role`);
      try {
        const { rows: [{ result }] } = await tx.query(sql, params);
        await tx.exec(`RESET ROLE; RELEASE SAVEPOINT roster_rpc`);
        return { data: result, error: null };
      } catch (error) {
        await tx.exec(`ROLLBACK TO SAVEPOINT roster_rpc; RESET ROLE`);
        return { data: null, error: { message: String(error?.message) } };
      }
    };
    return {
      rpc: async (name, args) => {
        calls.push(name);
        if (name === PLAN_STATS_ROSTER_SUMMARY_RPC) {
          if (!summary) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
          const built = buildPlanStatsRosterSummaryArgs(JSON.parse(JSON.stringify(args)), visibleIds, ACTOR);
          return run(
            `SELECT public.get_plan_stats_roster_summary($1::text[], $2, $3, $4::date, $5::jsonb, $6, $7::uuid[], $8) AS result`,
            [built.p_plan_aliases, built.p_pastoral_zone, built.p_timezone, built.p_start_date,
              built.p_schedule === null ? null : JSON.stringify(built.p_schedule),
              built.p_whole_church, built.p_visible_ids, built.p_actor_id]
          );
        }
        if (name === "get_plan_stats_roster") {
          const built = buildPlanStatsRosterArgs(args, visibleIds, ACTOR);
          return run(
            `SELECT public.get_plan_stats_roster($1::text[], $2, $3::date, $4, $5::uuid[], $6) AS result`,
            [built.p_plan_aliases, built.p_pastoral_zone, built.p_note_date, built.p_whole_church, built.p_visible_ids, built.p_actor_id]
          );
        }
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
    };
  }

  const show = value => (value === undefined ? "undefined" : JSON.stringify(value));

  function diffRosterRuns(label, legacy, summary, statsPlan) {
    const diffs = [];
    const usersOf = run => new Map(run.merged.users.map(user => [user.id, user]));
    const oldUsers = usersOf(legacy);
    const newUsers = usersOf(summary);
    for (const id of new Set([...oldUsers.keys(), ...newUsers.keys()])) {
      const before = oldUsers.get(id);
      const after = newUsers.get(id);
      const who = `${label}／${(before || after).name}（${id}）`;
      if (!before || !after) {
        diffs.push(`${who}：名單不同，舊=${Boolean(before)} 新=${Boolean(after)}`);
        continue;
      }
      for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
        // 靈修全文沒有任何畫面在讀（#673 不再回傳）；roster_stats 下面另外比
        if (field === "today_devotional" || field === "roster_stats") continue;
        if (show(before[field]) !== show(after[field])) diffs.push(`${who}.${field}：舊=${show(before[field])} 新=${show(after[field])}`);
      }
      const logs = legacy.merged.logsByUserId.get(id) || [];
      const oldStreak = computePlanScopedStreak(logs, { preFiltered: true });
      if (oldStreak !== after.roster_stats?.streak) diffs.push(`${who}.最高連續：舊=${oldStreak} 新=${show(after.roster_stats?.streak)}`);
      if (statsPlan) {
        const oldMakeup = countLateCompletedDays(statsPlan.days, statsPlan.startDate, buildRound1ReadDateMap(logs));
        if (oldMakeup !== after.roster_stats?.makeup) diffs.push(`${who}.補讀天數：舊=${oldMakeup} 新=${show(after.roster_stats?.makeup)}`);
      }
    }
    if (legacy.rows && summary.rows) {
      const rowKey = row => row.id;
      const oldRows = new Map(legacy.rows.map(row => [rowKey(row), row]));
      summary.rows.forEach((row, index) => {
        const before = oldRows.get(rowKey(row));
        if (legacy.rows[index]?.id !== row.id) diffs.push(`${label}／組員總覽第 ${index + 1} 列順序：舊=${legacy.rows[index]?.name} 新=${row.name}`);
        for (const field of Object.keys(row)) {
          if (show(before?.[field]) !== show(row[field])) diffs.push(`${label}／組員總覽 ${row.name}.${field}：舊=${show(before?.[field])} 新=${show(row[field])}`);
        }
      });
      if (legacy.rows.length !== summary.rows.length) diffs.push(`${label}／組員總覽人數：舊=${legacy.rows.length} 新=${summary.rows.length}`);
      if (legacy.participantsCsv !== summary.participantsCsv) diffs.push(`${label}／組員總覽 CSV 不同\n舊：\n${legacy.participantsCsv}\n新：\n${summary.participantsCsv}`);
      if (legacy.orgTree !== summary.orgTree) diffs.push(`${label}／組織統計樹不同`);
      if (legacy.zoneCsv !== summary.zoneCsv) diffs.push(`${label}／牧區 CSV 不同\n舊：\n${legacy.zoneCsv}\n新：\n${summary.zoneCsv}`);
    }
    return diffs;
  }

  async function withTimezone(timezone, fn) {
    const previous = process.env.TZ;
    process.env.TZ = timezone;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }

  // 同一份資料跑兩條路。回傳差異清單（空的才對）＋兩邊的結果給呼叫端再驗。
  async function compareRoster(tx, label, { statsPlan, filter = GLOBAL_PLAN, timezone = "Asia/Taipei", visibleIds = null, pastoralZone = "", globalPlans = GLOBAL_PLANS }) {
    return withTimezone(timezone, async () => {
      const options = { filter, statsPlan, globalPlans, orgStructure: ORG_STRUCTURE, pastoralZone };
      const oldCalls = [];
      const legacy = await app.render({ ...options, client: createClient(tx, { summary: false, visibleIds, calls: oldCalls }) });
      const newCalls = [];
      const summary = await app.render({ ...options, client: createClient(tx, { summary: true, visibleIds, calls: newCalls }) });
      // 確認兩條路真的是兩條路：舊路有逐筆打卡；新路只呼叫新 RPC、沒有逐筆打卡
      expect(oldCalls).toContain("get_plan_stats_roster");
      expect(new Set(newCalls)).toEqual(new Set([PLAN_STATS_ROSTER_SUMMARY_RPC]));
      expect(summary.merged.logsByUserId.size).toBe(0);
      // 畫面真的畫出來了，比對才有意義
      if (statsPlan && !pastoralZone) {
        expect(summary.rows.length).toBe(summary.merged.users.length);
        expect(summary.participantsCsv).toContain(summary.rows[0]?.name ?? "人數");
        expect(summary.orgTree).toContain("總閱讀章數");
        expect(summary.zoneCsv).toContain("牧區一");
      }
      return { diffs: diffRosterRuns(`${label}［${timezone}］`, legacy, summary, statsPlan), legacy, summary };
    });
  }

  const dayOf = (...chapters) => ({ chapters: chapters.map(([book, chapter]) => ({ book, chapter })) });
  const lev = n => ["利未記", n];
  // 第 2、5 天是休息日（比對尺上沒有章節）
  const BASE_DAYS = [
    dayOf(lev(1), lev(2)), dayOf(lev(3)), dayOf(), dayOf(lev(4), lev(5)), dayOf(lev(6)), dayOf(),
    dayOf(lev(7), lev(8), lev(9)), dayOf(lev(10)), dayOf(lev(11)), dayOf(lev(12))
  ];
  const makeStatsPlan = (days = BASE_DAYS, overrides = {}) => ({
    id: "stats-plan", globalPlanId: GLOBAL_PLAN, presetKey: null, name: "統計的計畫",
    startDate: "2026-10-01", endDate: "2026-10-10", days, ...overrides
  });

  // 每個情境 build(f) 建資料，回傳 compareRoster 的選項；至少要有一個人才有比到東西。
  const SCENARIOS = {
    遲到加入: f => {
      const late = f.person("晚加入");
      const plan = f.enroll(late);
      // 第五天才開始，前面全部當天補完
      [1, 2, 3, 4, 5, 6].forEach(chapter => f.read(late, plan, "利未記", chapter, taipei("2026-10-05")));
      const onTime = f.person("準時");
      const planB = f.enroll(onTime);
      f.read(onTime, planB, "利未記", 1, taipei("2026-10-01"));
      f.read(onTime, planB, "利未記", 2, taipei("2026-10-01"));
      f.read(onTime, planB, "利未記", 3, taipei("2026-10-02"));
      return {};
    },
    補讀: f => {
      const u = f.person("補讀的人");
      const plan = f.enroll(u);
      // 第 0 天兩章：一章當天、一章隔兩天 → 補讀；第 1 天沒讀完整 → 不算；第 3 天當天完成 → 不算
      f.read(u, plan, "利未記", 1, taipei("2026-10-01"));
      f.read(u, plan, "利未記", 2, taipei("2026-10-03"));
      f.read(u, plan, "利未記", 4, taipei("2026-10-04"));
      f.read(u, plan, "利未記", 5, taipei("2026-10-04"));
      f.read(u, plan, "利未記", 7, taipei("2026-10-09"));
      // 第 6 天只讀了 2/3 章：不算補讀
      f.read(u, plan, "利未記", 8, taipei("2026-10-09"));
      // 提早讀不算補讀
      f.read(u, plan, "利未記", 12, taipei("2026-10-02"));
      return {};
    },
    休息日: f => {
      const u = f.person("跨休息日");
      const plan = f.enroll(u);
      // 休息日也有打卡：連續天數算、補讀天數不受影響
      ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].forEach((date, index) => f.read(u, plan, "利未記", index + 1, taipei(date)));
      return { statsPlan: makeStatsPlan([dayOf(), dayOf(lev(1)), dayOf(), dayOf(lev(2), lev(3)), dayOf()]) };
    },
    多遍: f => {
      const confirmed = f.person("第二遍已確認");
      const a = f.enroll(confirmed, { round: 2, handled: true });
      for (let chapter = 1; chapter <= 27; chapter += 1) f.read(confirmed, a, "利未記", chapter, taipei("2026-10-02"));
      f.read(confirmed, a, "利未記", 1, taipei("2026-10-08"), 2);
      f.read(confirmed, a, "利未記", 2, taipei("2026-10-09"), 2);
      const unconfirmed = f.person("存第二遍但沒確認也沒紀錄");
      const b = f.enroll(unconfirmed, { round: 2, handled: false });
      f.read(unconfirmed, b, "利未記", 1, taipei("2026-10-01"));
      const advanced = f.person("存第三遍有第三遍紀錄");
      const c = f.enroll(advanced, { round: 3, handled: false });
      f.read(advanced, c, "利未記", 1, taipei("2026-10-01"), 3);
      f.read(advanced, c, "利未記", 2, taipei("2026-10-02"), 2);
      const stuck = f.person("存第三遍只有第二遍紀錄");
      const d = f.enroll(stuck, { round: 3, handled: false });
      f.read(stuck, d, "利未記", 1, taipei("2026-10-01"), 2);
      // 只有第二遍紀錄：第一遍日期沒有，補讀應該是 0
      const onlySecond = f.person("只有第二遍紀錄");
      const e = f.enroll(onlySecond, { round: 2, handled: true });
      f.read(onlySecond, e, "利未記", 1, taipei("2026-10-09"), 2);
      f.read(onlySecond, e, "利未記", 2, taipei("2026-10-09"), 2);
      const finished = f.person("第一遍剛好讀完");
      const g = f.enroll(finished);
      for (let chapter = 1; chapter <= 27; chapter += 1) f.read(finished, g, "利未記", chapter, taipei("2026-10-03"));
      return {};
    },
    沒報名: f => {
      f.person("完全沒報名");
      const other = f.person("只報別的計畫");
      const otherPlan = f.enroll(other, { global: OTHER_GLOBAL_PLAN, name: "別的計畫" });
      f.read(other, otherPlan, "利未記", 1, taipei("2026-10-01"));
      const noLogs = f.person("有報名沒打卡");
      f.enroll(noLogs);
      return {};
    },
    退出後重加: f => {
      // 退出＝報名列刪掉、打卡跟著 CASCADE 刪掉（這裡不插入舊資料）；重加是新的一列，只剩新打卡
      const u = f.person("退出又回來");
      const plan = f.enroll(u, { n: 900 });
      f.read(u, plan, "利未記", 1, taipei("2026-10-08"));
      f.read(u, plan, "利未記", 2, taipei("2026-10-09"));
      return {};
    },
    同一人多筆報名: f => {
      // 別名同時對到兩筆：章數只算 id 第一筆；連續天數、補讀天數看兩筆全部，同章後面的 plan 蓋前面的
      const u = f.person("兩筆報名");
      const first = f.enroll(u, { n: 10, global: null, preset: "十月-preset", books: ["利未記"] });
      const second = f.enroll(u, { n: 20, global: GLOBAL_PLAN, books: ["利未記"] });
      f.read(u, first, "利未記", 1, taipei("2026-10-01"));
      f.read(u, first, "利未記", 2, taipei("2026-10-01"));
      f.read(u, second, "利未記", 1, taipei("2026-10-05"));
      f.read(u, second, "利未記", 3, taipei("2026-10-02"));
      f.read(u, second, "利未記", 4, taipei("2026-10-03"));
      // 反過來：全域計畫那筆 id 比較小
      const v = f.person("兩筆報名（反序）");
      const low = f.enroll(v, { n: 30, global: GLOBAL_PLAN, books: ["利未記"] });
      const high = f.enroll(v, { n: 40, global: null, preset: "十月-preset", books: ["民數記"], round: 2, handled: true });
      f.read(v, low, "利未記", 1, taipei("2026-10-05"));
      f.read(v, high, "利未記", 1, taipei("2026-10-01"));
      f.read(v, high, "利未記", 2, taipei("2026-10-01"));
      f.read(v, high, "民數記", 1, taipei("2026-10-09"));
      return {};
    },
    自訂計畫與個人計畫: f => {
      // 同名的個人計畫不能混進來；統計對象也可以是不是教會活動的一般計畫（用名稱當別名）
      const u = f.person("有個人計畫");
      const plan = f.enroll(u, { global: null, preset: "custom-key", name: "自訂讀經" });
      const personal = f.enroll(u, { personal: true, name: "自訂讀經" });
      f.read(u, plan, "利未記", 1, taipei("2026-10-02"));
      f.read(u, personal, "利未記", 2, taipei("2026-10-03"));
      f.read(u, personal, "利未記", 3, taipei("2026-10-04"));
      return { filter: "custom-key", statsPlan: makeStatsPlan(BASE_DAYS, { globalPlanId: null, presetKey: "custom-key", name: "自訂讀經" }) };
    },
    書卷範圍外的打卡: f => {
      // 計畫外的書卷不算章數、也不算最後打卡，但連續天數和補讀的日期照舊算得到（舊算法就是這樣）
      const u = f.person("讀到別卷");
      const plan = f.enroll(u, { books: ["利未記"] });
      f.read(u, plan, "利未記", 1, taipei("2026-10-01"));
      f.read(u, plan, "民數記", 1, taipei("2026-10-02"));
      f.read(u, plan, "民數記", 2, taipei("2026-10-03"));
      const outOnly = f.person("全部讀到別卷");
      const planB = f.enroll(outOnly, { books: ["利未記"] });
      f.read(outOnly, planB, "民數記", 1, taipei("2026-10-02"));
      // 舊的半卷寫法：書卷名稱對不上「詩篇」，全部被濾掉，總章數也是 0
      const half = f.person("半卷寫法");
      const planC = f.enroll(half, { books: ["詩篇 1-110"] });
      f.read(half, planC, "詩篇", 1, taipei("2026-10-01"));
      const blank = f.person("書卷只有空字串");
      const planD = f.enroll(blank, { books: [""] });
      f.read(blank, planD, "民數記", 1, taipei("2026-10-01"));
      return { statsPlan: makeStatsPlan([dayOf(lev(1), ["民數記", 1]), dayOf(["民數記", 2])]) };
    },
    報名沒有書卷清單: f => {
      // target_books 空的要退回 state.globalPlans 的 books：伺服器算不出來，只有這種人回逐筆
      const u = f.person("沒有書卷清單");
      const plan = f.enroll(u, { books: [] });
      f.read(u, plan, "利未記", 1, taipei("2026-10-01"));
      f.read(u, plan, "民數記", 1, taipei("2026-10-02"));
      const none = f.person("沒有書卷清單也沒打卡");
      f.enroll(none, { books: [] });
      const normal = f.person("正常的人");
      const planB = f.enroll(normal);
      f.read(normal, planB, "利未記", 1, taipei("2026-10-01"));
      return {};
    },
    同一毫秒與微秒: f => {
      const u = f.person("同毫秒");
      const plan = f.enroll(u);
      f.read(u, plan, "利未記", 1, "2026-10-01T03:00:00.123456+00:00");
      f.read(u, plan, "利未記", 2, "2026-10-01T03:00:00.123999+00:00");
      f.read(u, plan, "利未記", 3, "2026-10-01T03:00:00.123001+00:00");
      f.read(u, plan, "利未記", 4, "2026-10-01T02:59:59.999999+00:00");
      const v = f.person("同一批打卡");
      const planB = f.enroll(v);
      f.read(v, planB, "利未記", 1, "2026-10-02T03:00:00.5+00:00");
      f.read(v, planB, "利未記", 2, "2026-10-02T03:00:00.5+00:00");
      return {};
    },
    進度四捨五入: f => {
      // 7 / 40 × 100 用浮點數算會落在 17.5 附近；總數用出埃及記 40 章
      const u = f.person("七章");
      const plan = f.enroll(u, { books: ["出埃及記"] });
      for (let chapter = 1; chapter <= 7; chapter += 1) f.read(u, plan, "出埃及記", chapter, taipei("2026-10-02"));
      const v = f.person("一章");
      const planB = f.enroll(v, { books: ["詩篇"] });
      f.read(v, planB, "詩篇", 1, taipei("2026-10-02"));
      const w = f.person("三十三章");
      const planC = f.enroll(w, { books: ["出埃及記", "利未記"] });
      for (let chapter = 1; chapter <= 33; chapter += 1) f.read(w, planC, "出埃及記", (chapter % 40) + 1, taipei("2026-10-02"));
      return {};
    }
  };

  beforeAll(async () => {
    memberRoleId = (await db.query(`SELECT id FROM public.role_definitions WHERE code = 'member'`)).rows[0].id;
    app = createRosterApp({ bibleBooks: BIBLE_BOOK_CHAPTERS });
  });

  afterAll(() => {
    app?.close();
  });

  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(`情境：${name}`, async () => {
      const diffs = await inRosterTx(async tx => {
        const fixture = createFixture();
        const options = build(fixture);
        await insertFixture(tx, fixture);
        const { diffs: found, summary } = await compareRoster(tx, name, { statsPlan: makeStatsPlan(), ...options });
        return { found, people: summary.merged.users.length, enrolled: fixture.plans.length };
      });
      expect(diffs.found).toEqual([]);
      expect(diffs.people).toBeGreaterThan(0);
    }, 60_000);
  }

  it("情境：跨時區邊界（台北午夜前後、看的人在其他時區）", async () => {
    const found = await inRosterTx(async tx => {
      const f = createFixture();
      const u = f.person("午夜前後");
      const plan = f.enroll(u);
      // UTC 15:59:59／16:00:00＝台北的當天最後一秒／隔天第一秒
      f.read(u, plan, "利未記", 1, "2026-09-30T15:59:59+00:00");
      f.read(u, plan, "利未記", 2, "2026-09-30T16:00:00+00:00");
      f.read(u, plan, "利未記", 3, "2026-10-01T15:59:59+00:00");
      f.read(u, plan, "利未記", 4, "2026-10-02T16:00:00+00:00");
      f.read(u, plan, "利未記", 5, "2026-10-03T23:30:00+00:00");
      f.read(u, plan, "利未記", 6, "2026-10-05T00:30:00+00:00");
      // 紐約 11/1 日光節約結束那一天（一天 25 小時），前後都有打卡
      const dst = f.person("跨日光節約");
      const planB = f.enroll(dst);
      ["2026-10-31T12:00:00Z", "2026-11-01T12:00:00Z", "2026-11-02T12:00:00Z"].forEach((at, index) => f.read(dst, planB, "利未記", index + 1, at));
      await insertFixture(tx, f);
      const all = [];
      for (const timezone of ["Asia/Taipei", "UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
        all.push(...(await compareRoster(tx, "跨時區", { statsPlan: makeStatsPlan(), timezone })).diffs);
      }
      return all;
    });
    expect(found).toEqual([]);
  }, 120_000);

  it("情境：教會原始日程（真的活動定義鋪出來的比對尺）", async () => {
    const found = await inRosterTx(async tx => {
      const definition = getChurchCampaignStageDefinition(1);
      const days = buildChurchCampaignDays(definition, BIBLE_BOOK_CHAPTERS, []);
      const startDate = definition.startDate;
      const f = createFixture(7);
      const books = [...new Set(days.flatMap(day => day.chapters.map(chapter => chapter.book)))];
      for (const [index, lag] of [0, 1, 3, 10].entries()) {
        const u = f.person(`落後 ${lag} 天`);
        const plan = f.enroll(u, { books });
        days.slice(0, 30).forEach((day, dayIndex) => {
          day.chapters.forEach(chapter => f.read(u, plan, chapter.book, chapter.chapter, taipei(addDays(startDate, dayIndex + lag), `0${index}:30:00`)));
        });
      }
      await insertFixture(tx, f);
      return (await compareRoster(tx, "教會原始日程", {
        statsPlan: makeStatsPlan(days, { startDate, endDate: definition.endDate })
      })).diffs;
    });
    expect(found).toEqual([]);
  }, 120_000);

  it("情境：限定牧區（首頁的同牧區路徑）和沒有計畫篩選", async () => {
    const found = await inRosterTx(async tx => {
      const f = createFixture();
      const a = f.person("牧區一的人", { zone: "牧區一" });
      const b = f.person("牧區二的人", { zone: "牧區二", group: "小組三" });
      const none = f.person("牧區一沒報名", { zone: "牧區一" });
      f.enroll(none, { global: OTHER_GLOBAL_PLAN, name: "別的計畫", n: 1 });
      const planA = f.enroll(a, { n: 2 });
      const planA2 = f.enroll(a, { global: OTHER_GLOBAL_PLAN, name: "別的計畫", books: ["民數記"], n: 3 });
      const planB = f.enroll(b, { n: 4 });
      f.read(a, planA, "利未記", 1, taipei("2026-10-01"));
      f.read(a, planA2, "民數記", 1, taipei("2026-10-02"));
      // 沒有計畫篩選時兩筆報名的同一章要去重、留最早的時間
      f.read(a, planA2, "利未記", 1, taipei("2026-09-20"));
      f.read(b, planB, "利未記", 1, taipei("2026-10-01"));
      f.read(b, planB, "利未記", 2, taipei("2026-10-02"), 2);
      f.profiles.push({ id: ACTOR, name: "沒有計畫的人", region: "大區一", zone: "牧區一", group: "小組一" });
      await insertFixture(tx, f);
      return [
        ...(await compareRoster(tx, "限定牧區", { statsPlan: null, pastoralZone: "牧區一" })).diffs,
        ...(await compareRoster(tx, "沒有計畫篩選", { statsPlan: null, filter: null })).diffs,
        ...(await compareRoster(tx, "沒有計畫篩選＋牧區", { statsPlan: null, filter: null, pastoralZone: "牧區二" })).diffs
      ];
    });
    expect(found).toEqual([]);
  }, 60_000);

  it("情境：管理範圍（不是全教會時只算可見名單裡的人）", async () => {
    const found = await inRosterTx(async tx => {
      const f = createFixture();
      const inside = f.person("範圍內");
      const outside = f.person("範圍外");
      const planA = f.enroll(inside);
      const planB = f.enroll(outside);
      f.read(inside, planA, "利未記", 1, taipei("2026-10-03"));
      f.read(outside, planB, "利未記", 1, taipei("2026-10-03"));
      await insertFixture(tx, f);
      const { diffs, summary } = await compareRoster(tx, "管理範圍", { statsPlan: makeStatsPlan(), visibleIds: [inside] });
      expect(summary.merged.users.map(user => user.id)).toEqual([inside]);
      return diffs;
    });
    expect(found).toEqual([]);
  }, 60_000);

  // 亂數資料：每個種子一份資料、一個時區，各種邊界混在一起。
  const RANDOM_TIMEZONES = ["Asia/Taipei", "America/New_York", "UTC", "Asia/Kolkata", "Pacific/Auckland", "Asia/Taipei"];
  function buildRandomFixture(seed) {
    const f = createFixture(seed);
    const { rng } = f;
    const pick = list => list[Math.floor(rng() * list.length)];
    const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
    const days = Array.from({ length: int(10, 30) }, () => {
      if (rng() < 0.15) return dayOf();
      return dayOf(...Array.from({ length: int(1, 3) }, () => [pick(["利未記", "民數記"]), int(1, 20)]));
    });
    const randomMoment = () => {
      const date = addDays("2026-09-28", int(0, 40));
      const roll = rng();
      if (roll < 0.25) return taipei(date, "00:00:00"); // 台北午夜
      if (roll < 0.4) return taipei(date, "23:59:59.999");
      if (roll < 0.5) return `${date}T00:00:00+00:00`; // UTC 午夜
      if (roll < 0.6) return `${date}T03:00:00.${pad(int(0, 999999), 6)}+00:00`; // 微秒、同毫秒
      return taipei(date, `${pad(int(0, 23), 2)}:${pad(int(0, 59), 2)}:${pad(int(0, 59), 2)}`);
    };
    const count = int(20, 40);
    for (let index = 0; index < count; index += 1) {
      const region = pick(["大區一", "大區二"]);
      const zone = region === "大區一" ? pick(["牧區一", "牧區二"]) : "牧區三";
      const group = rng() < 0.1 ? "" : pick(["小組一", "小組二", "小組三", "小組四"]);
      const user = f.person(`人${index}`, { region, zone, group });
      if (rng() < 0.1) continue; // 沒報名
      const planSeed = rng();
      const books = planSeed < 0.6 ? ["利未記", "民數記"]
        : planSeed < 0.75 ? ["利未記"]
          : planSeed < 0.85 ? []
            : planSeed < 0.95 ? ["利未記", "民數記", "詩篇 1-110"] : [""];
      // 這個人的報名 id 順序打亂：「第一筆」不一定是全域計畫那筆
      const slots = [0, 1, 2, 3].map(slot => ({ slot, order: rng() })).sort((x, y) => x.order - y.order).map(({ slot }) => 1000 + index * 10 + slot);
      const enrollments = [f.enroll(user, { books, round: int(1, 3), handled: rng() < 0.4, n: slots[0] })];
      if (rng() < 0.2) enrollments.push(f.enroll(user, { global: null, preset: "十月-preset", n: slots[1], books: ["利未記"], round: int(1, 2) }));
      if (rng() < 0.15) enrollments.push(f.enroll(user, { personal: true, name: PLAN_NAME, n: slots[2] }));
      if (rng() < 0.2) enrollments.push(f.enroll(user, { global: OTHER_GLOBAL_PLAN, name: "別的計畫", n: slots[3] }));
      for (const planId of enrollments) {
        if (rng() < 0.1) continue;
        const seen = new Set();
        const logCount = int(0, 40);
        for (let n = 0; n < logCount; n += 1) {
          const book = pick(["利未記", "利未記", "民數記", "申命記"]);
          const chapter = int(1, 20);
          const round = pick([1, 1, 1, 2, 3]);
          const key = `${book}_${chapter}_${round}`;
          if (seen.has(key)) continue;
          seen.add(key);
          f.read(user, planId, book, chapter, randomMoment(), round);
        }
      }
    }
    return { f, days };
  }

  for (const [index, timezone] of RANDOM_TIMEZONES.entries()) {
    const seed = 6730 + index;
    it(`亂數資料：種子 ${seed}（${timezone}）`, async () => {
      const result = await inRosterTx(async tx => {
        const { f, days } = buildRandomFixture(seed);
        await insertFixture(tx, f);
        const { diffs, summary } = await compareRoster(tx, `亂數 ${seed}`, {
          statsPlan: makeStatsPlan(days),
          timezone
        });
        return { diffs, people: summary.merged.users.length, logs: f.logs.length };
      });
      expect(result.diffs).toEqual([]);
      expect(result.people).toBeGreaterThan(5);
      expect(result.logs).toBeGreaterThan(50);
    }, 60_000);
  }

  it("同一份報名不可能有重複的 (書卷, 章, 遍)：彙總直接照這個資料庫約束數章數", async () => {
    await inRosterTx(async tx => {
      const f = createFixture();
      const u = f.person("重複");
      const plan = f.enroll(u);
      f.read(u, plan, "利未記", 1, taipei("2026-10-01"));
      f.read(u, plan, "利未記", 1, taipei("2026-10-02"));
      await expect(insertFixture(tx, f)).rejects.toThrow(/reading_logs_unique/);
    });
  });

  describe("權限與範圍", () => {
    const SIGNATURE = "public.get_plan_stats_roster_summary(text[], text, text, date, jsonb, boolean, uuid[], uuid)";
    const callWith = (tx, wholeChurch, visibleIds, actor = ACTOR, timezone = "Asia/Taipei") => tx.query(
      `SELECT public.get_plan_stats_roster_summary($1::text[], NULL, $2, '2026-10-01', '[]'::jsonb, $3, $4::uuid[], $5) AS result`,
      [[GLOBAL_PLAN], timezone, wholeChurch, visibleIds, actor]
    );

    it("不是全教會、可見名單是空的或 NULL、沒有呼叫者 → 什麼都不回（fail closed）", async () => {
      const people = await inRosterTx(async tx => {
        const f = createFixture();
        const u = f.person("某人");
        const plan = f.enroll(u);
        f.read(u, plan, "利未記", 1, taipei("2026-10-01"));
        await insertFixture(tx, f);
        await tx.exec(`SET LOCAL ROLE service_role`);
        const results = [];
        for (const [wholeChurch, visibleIds, actor] of [[false, [], ACTOR], [false, null, ACTOR], [null, null, ACTOR], [true, null, null]]) {
          const { rows: [{ result }] } = await callWith(tx, wholeChurch, visibleIds, actor);
          results.push(result.people.length, result.plans.length);
        }
        const { rows: [{ result: allowed }] } = await callWith(tx, true, null);
        return { results, allowed: allowed.people.length };
      });
      expect(people.results).toEqual(new Array(8).fill(0));
      expect(people.allowed).toBe(1);
    });

    it("沒帶時區回 NULL（前端退回舊路徑），不是算出錯的日期", async () => {
      const result = await inRosterTx(async tx => {
        await tx.exec(`SET LOCAL ROLE service_role`);
        return (await callWith(tx, true, null, ACTOR, null)).rows[0].result;
      });
      expect(result).toBeNull();
    });

    it("只有 service_role 能呼叫；是 SECURITY DEFINER，search_path 是空的", async () => {
      const { rows: [row] } = await db.query(
        `SELECT p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [SIGNATURE]
      );
      expect(row).toMatchObject({ prosecdef: true, anon: false, authenticated: false, service: true });
      expect(row.proconfig.join(",")).toMatch(/search_path=("")?/);
      await expect(as("authenticated", { sub: ids.adminAuth }, tx => callWith(tx, true, null)))
        .rejects.toThrow(/permission denied/);
    });
  });

  // 驗收：合成 800 人 × 250 章。PGlite 只看相對差距，不代表正式站的絕對耗時。
  it("回應大小：800 人 × 250 章，彙總在舊的 1/10 以下", async () => {
    const measured = await inRosterTx(async tx => {
      const chapters = [];
      for (const book of BIBLE_BOOK_CHAPTERS) {
        for (let chapter = 1; chapter <= book.chapters && chapters.length < 250; chapter += 1) chapters.push([book.name, chapter]);
      }
      const books = [...new Set(chapters.map(([book]) => book))];
      await tx.query(
        `INSERT INTO public.profiles (id, name, role_id, great_region, pastoral_zone, small_group, is_active)
         SELECT ('74000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '會友' || n, $1, '大區一', '牧區' || (n % 20), '小組' || (n % 80), TRUE
         FROM generate_series(1, 800) AS n`,
        [memberRoleId]
      );
      await tx.query(
        `INSERT INTO public.reading_plans (id, user_id, global_plan_id, name, start_date, end_date, target_books)
         SELECT ('75000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('74000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
                $1, $2, '2026-10-01', '2026-12-31', $3::text[]
         FROM generate_series(1, 800) AS n`,
        [GLOBAL_PLAN, PLAN_NAME, books]
      );
      await tx.query(
        `INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, round, read_at)
         SELECT ('74000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('75000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
                entry ->> 0, (entry ->> 1)::integer, 1,
                '2026-10-01 08:00:00+08'::timestamptz + (ordinality * interval '6 hours') + (n * interval '1 second') + interval '123 milliseconds'
         FROM generate_series(1, 800) AS n
         CROSS JOIN jsonb_array_elements($1::jsonb) WITH ORDINALITY AS item(entry, ordinality)`,
        [JSON.stringify(chapters)]
      );
      const schedule = chapters.map(([book, chapter], index) => [Math.floor(index / 3), book, chapter]);
      await tx.exec(`SET LOCAL ROLE service_role`);
      const timed = async (sql, params) => {
        const started = Date.now();
        const { rows: [{ bytes }] } = await tx.query(sql, params);
        return { bytes: Number(bytes), ms: Date.now() - started };
      };
      const before = await timed(
        `SELECT octet_length(public.get_plan_stats_roster($1::text[], NULL, '2026-11-05', TRUE, NULL, $2)::text) AS bytes`,
        [[GLOBAL_PLAN], ACTOR]
      );
      const after = await timed(
        `SELECT octet_length(public.get_plan_stats_roster_summary($1::text[], NULL, 'Asia/Taipei', '2026-10-01', $2::jsonb, TRUE, NULL, $3)::text) AS bytes`,
        [[GLOBAL_PLAN], JSON.stringify(schedule), ACTOR]
      );
      return { before, after };
    });
    console.info(`#673 size: old ${measured.before.bytes} bytes, ${measured.before.ms} ms; new ${measured.after.bytes} bytes, ${measured.after.ms} ms; ratio 1/${(measured.before.bytes / measured.after.bytes).toFixed(1)}`);
    expect(measured.after.bytes).toBeLessThan(measured.before.bytes / 10);
  }, 240_000);
});
