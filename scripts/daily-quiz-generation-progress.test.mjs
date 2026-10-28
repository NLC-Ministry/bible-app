import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  callWithFallback, formatGenerationError, GeminiCallError, geminiHttpError, GenerationError
} from "../supabase/functions/generate-daily-quizzes/gemini-call.ts";
import {
  describeQuizGenerationError, quizGenerationElapsedSeconds, renderQuizGenerationErrorHtml, renderQuizGenerationProgressHtml
} from "../js/modules/quiz-generation-status.mjs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";

// #465：AI 出題的重試／備用模型、卡住自癒、進度與中文錯誤。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const generator = read("supabase/functions/generate-daily-quizzes/index.ts");
const admin = read("js/modules/admin.js");
const fn = name => latestFunctionDefinition(name).text;
const MIGRATION = "20261008064652_daily_quiz_generation_progress.sql";

// 假時鐘：sleep 直接把時間往前推，不真的等
function fakeClock(start = 0) {
  let time = start;
  return { now: () => time, sleep: async ms => { time += ms; }, advance: ms => { time += ms; } };
}

describe("callWithFallback (#465)", () => {
  it("retries a 503 on the same model and then succeeds", async () => {
    const clock = fakeClock();
    const calls = [];
    const result = await callWithFallback({
      step: "draft", models: ["lite"], attemptsPerModel: 3, deadline: 140000, now: clock.now, sleep: clock.sleep,
      call: async model => {
        calls.push(model);
        if (calls.length < 3) throw geminiHttpError(503, "This model is currently experiencing high demand.");
        return { ok: true };
      }
    });
    expect(result).toEqual({ value: { ok: true }, model: "lite" });
    expect(calls).toEqual(["lite", "lite", "lite"]);
    expect(clock.now()).toBe(2000 + 5000);
  });

  it("falls back to the next model when the reviewer keeps returning 503", async () => {
    const clock = fakeClock();
    const calls = [];
    const result = await callWithFallback({
      step: "review", models: ["gemini-3.8-flash", "gemini-3.1-flash-lite"], attemptsPerModel: 2, deadline: 140000,
      now: clock.now, sleep: clock.sleep,
      call: async model => {
        calls.push(model);
        if (model === "gemini-3.8-flash") throw geminiHttpError(503, "overloaded");
        return { reviews: [] };
      }
    });
    expect(result.model).toBe("gemini-3.1-flash-lite");
    expect(calls).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"]);
  });

  it("skips a missing model (404) without retrying it", async () => {
    const clock = fakeClock();
    const calls = [];
    await callWithFallback({
      step: "review", models: ["gone", "lite"], attemptsPerModel: 2, deadline: 140000, now: clock.now, sleep: clock.sleep,
      call: async model => { calls.push(model); if (model === "gone") throw geminiHttpError(404, "not found"); return {}; }
    });
    expect(calls).toEqual(["gone", "lite"]);
  });

  it("does not retry a 400", async () => {
    const clock = fakeClock();
    let count = 0;
    await expect(callWithFallback({
      step: "draft", models: ["lite"], attemptsPerModel: 3, deadline: 140000, now: clock.now, sleep: clock.sleep,
      call: async () => { count += 1; throw geminiHttpError(400, "bad request"); }
    })).rejects.toThrow("draft:400:lite — bad request");
    expect(count).toBe(1);
  });

  it("reports the step, status, model and Google's message when every attempt fails", async () => {
    const clock = fakeClock();
    const failure = await callWithFallback({
      step: "review", models: ["flash", "lite"], attemptsPerModel: 2, deadline: 140000, now: clock.now, sleep: clock.sleep,
      call: async () => { throw geminiHttpError(503, "This model is currently experiencing high demand."); }
    }).catch(error => error);
    expect(failure).toBeInstanceOf(GenerationError);
    expect(failure.message).toBe("review:503:lite — This model is currently experiencing high demand.");
  });

  it("stops before the time budget runs out instead of being killed mid-call", async () => {
    const clock = fakeClock();
    let count = 0;
    const failure = await callWithFallback({
      step: "draft", models: ["lite"], attemptsPerModel: 5, deadline: 30000, now: clock.now, sleep: clock.sleep,
      call: async () => { count += 1; clock.advance(10000); throw geminiHttpError(503, "busy"); }
    }).catch(error => error);
    // 第 1 次失敗後還有 20 秒，等 2 秒再試；第 2 次失敗後只剩 8 秒，不再開新的呼叫
    expect(failure.message).toBe("draft:503:lite — busy");
    expect(count).toBe(2);
    expect(clock.now()).toBeLessThan(30000);
  });

  it("passes the remaining time (minus a margin) as the per-call timeout", async () => {
    const clock = fakeClock(1000);
    let timeout = 0;
    await callWithFallback({
      step: "draft", models: ["lite"], attemptsPerModel: 1, deadline: 101000, now: clock.now, sleep: clock.sleep,
      call: async (_model, ms) => { timeout = ms; return {}; }
    });
    expect(timeout).toBe(95000);
  });

  it("#467: caps each attempt so a hanging reviewer still leaves time for the fallback model", async () => {
    const clock = fakeClock();
    const timeouts = [];
    const result = await callWithFallback({
      step: "review", models: ["gemini-3.8-flash", "gemini-3.1-flash-lite"], attemptsPerModel: 1, deadline: 129000,
      maxAttemptMs: 40000, now: clock.now, sleep: clock.sleep,
      call: async (model, ms) => {
        timeouts.push(ms);
        if (model === "gemini-3.8-flash") { clock.advance(ms); throw new GeminiCallError("timeout", "no response", true); }
        return { reviews: [] };
      }
    });
    expect(timeouts).toEqual([40000, 40000]);
    expect(result.model).toBe("gemini-3.1-flash-lite");
  });

  it("formats errors as step:code[:model][ — detail]", () => {
    expect(formatGenerationError("quality", "insufficient", "3/8 passed")).toBe("quality:insufficient — 3/8 passed");
    expect(formatGenerationError("draft", "timeout", "", "lite")).toBe("draft:timeout:lite");
    expect(new GeminiCallError("invalid_json", "x", true).retryable).toBe(true);
    expect(geminiHttpError(429, "quota").retryable).toBe(true);
    expect(geminiHttpError(400, "bad").retryable).toBe(false);
  });
});

describe("generation error descriptions (#465)", () => {
  it("explains a reviewer 503 in Chinese with the step and model", () => {
    const info = describeQuizGenerationError("review:503:gemini-3.8-flash — This model is currently experiencing high demand.");
    expect(info.title).toBe("AI 審題失敗：Google AI 目前無法使用（503：服務過載或暫停）（模型 gemini-3.8-flash）");
    expect(info.hint).toContain("過幾分鐘");
  });

  it("explains quality, timeout, scripture and legacy formats", () => {
    expect(describeQuizGenerationError("quality:insufficient — 3/8 passed; review_disagrees×4").title)
      .toBe("品質篩選失敗：AI 出的 8 題候選只有 3 題通過品質檢查（需要 5 題）");
    expect(describeQuizGenerationError("generation_timeout").title).toBe("出題超過 5 分鐘沒有進度，已自動停止");
    expect(describeQuizGenerationError("scripture:fetch_failed — scripture_fetch_failed:創世記:1:CUNP:500").title).toBe("抓經文失敗：抓不到當日經文");
    expect(describeQuizGenerationError("gemini_503:This model is overloaded").title).toContain("503");
    expect(describeQuizGenerationError("quiz_quality_insufficient:2/8").title).toContain("只有 2 題通過");
    expect(describeQuizGenerationError("something odd").title).toBe("AI 出題失敗");
  });

  it("shows the raw message (escaped) behind a 原始訊息 toggle", () => {
    const html = renderQuizGenerationErrorHtml("draft:error — <b>x</b>");
    expect(html).toContain("原始訊息");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("generation progress (#465)", () => {
  it("marks finished steps, the current step and the elapsed time", () => {
    const html = renderQuizGenerationProgressHtml({ aiStage: "reviewing" }, 75);
    expect(html).toContain("AI 出題中：AI 審題・已等 1 分 15 秒");
    expect(html.match(/is-done/g)).toHaveLength(3);
    expect(html).toContain('is-current" aria-current="step">AI 審題');
  });

  it("starts at 排隊中 and warns when it takes much longer than usual", () => {
    expect(renderQuizGenerationProgressHtml({}, null)).toContain("AI 出題中：排隊中");
    expect(renderQuizGenerationProgressHtml({ aiStage: "drafting" }, 200)).toContain("比平常久");
  });

  it("computes elapsed seconds against the server clock", () => {
    const day = { aiStartedAt: "2026-10-08T00:00:00Z" };
    const now = Date.parse("2026-10-08T00:00:30Z");
    expect(quizGenerationElapsedSeconds(day, 0, now)).toBe(30);
    expect(quizGenerationElapsedSeconds(day, 5000, now)).toBe(35);
    expect(quizGenerationElapsedSeconds({}, 0, now)).toBeNull();
  });
});

describe("migration: progress and stuck generations (#465)", () => {
  it("all redefined functions live in the new migration", () => {
    for (const name of ["_daily_quiz_generation_stale", "reserve_daily_quiz_generation", "reserve_daily_quiz_regeneration",
      "set_daily_quiz_generation_stage", "complete_daily_quiz_generation", "fail_daily_quiz_generation",
      "get_daily_quiz_calendar", "swap_daily_quiz_version"]) {
      // 之後再改寫過的（#589 保留已通過的題目、#641 補讀日），斷言照樣驗最新版本
      expect(latestFunctionDefinition(name).file >= MIGRATION, name).toBe(true);
    }
  });

  it("a generation with no progress for 5 minutes counts as stuck", () => {
    expect(fn("_daily_quiz_generation_stale")).toContain("p_status = 'generating' AND p_updated_at < NOW() - INTERVAL '5 minutes'");
  });

  it("swap refuses only a live generation, then queues a row the Edge Function takes over", () => {
    const swap = fn("swap_daily_quiz_version");
    expect(swap).toContain("AND NOT public._daily_quiz_generation_stale(q.generation_status, q.updated_at)) THEN\n    RAISE EXCEPTION 'quiz_generating';");
    expect(swap).toContain("'generating', 1, 'queued', NOW()");
    expect(swap.indexOf("INSERT INTO public.daily_quizzes")).toBeLessThan(swap.indexOf("net.http_post"));
    const reserve = fn("reserve_daily_quiz_generation");
    expect(reserve).toContain("AND (quiz.generation_stage = 'queued'\n           OR public._daily_quiz_generation_stale(quiz.generation_status, quiz.updated_at))");
    expect(fn("reserve_daily_quiz_regeneration")).toContain("OR public._daily_quiz_generation_stale(quiz.generation_status, quiz.updated_at))");
  });

  it("the calendar shows stuck generations as failed and exposes the stage", () => {
    const cal = fn("get_daily_quiz_calendar");
    expect(cal).toContain("WHEN ai.generation_status = 'generating' AND NOT ai_stale THEN 'generating'");
    expect(cal).toContain("WHEN ai.generation_status = 'failed' OR ai_stale THEN 'failed'");
    expect(cal).toContain("WHEN ai_stale THEN 'generation_timeout' ELSE ai.generation_error END");
    expect(cal).toContain("'aiStage', CASE WHEN ai_stale THEN NULL ELSE ai.generation_stage END");
    expect(cal).toContain("'aiStartedAt', ai.generation_started_at");
    expect(cal).toContain("'serverNow', NOW()");
    expect(cal).toContain("PERFORM public._daily_quiz_require_admin(p_actor_id);");
  });

  it("stage updates are service-role only; complete/fail clear the stage", () => {
    const sql = currentMigrationSql(MIGRATION);
    expect(fn("set_daily_quiz_generation_stage")).toContain("IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.set_daily_quiz_generation_stage(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.set_daily_quiz_generation_stage(uuid, text) TO service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._daily_quiz_generation_stale(text, timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) TO authenticated, service_role;");
    expect(fn("complete_daily_quiz_generation")).toContain("generation_stage = NULL,");
    expect(fn("complete_daily_quiz_generation")).toContain("review_status = 'approved',");
    expect(fn("fail_daily_quiz_generation")).toContain("generation_stage = NULL,");
  });
});

describe("Edge Function wiring (#465)", () => {
  it("reserves before fetching scripture and fails the reservation when scripture can't be fetched", () => {
    expect(generator.indexOf('supabase.rpc("reserve_daily_quiz_generation"')).toBeLessThan(generator.indexOf("chapterRefs.map(fetchChapter)"));
    expect(generator).toContain("p_error: `scripture:fetch_failed — ${message}`");
  });

  it("reports each stage and has its own time budget below the platform limit", () => {
    expect(generator).toContain('supabase.rpc("set_daily_quiz_generation_stage", { p_quiz_id: quizId, p_stage: stage })');
    for (const stage of ['reportStage("drafting")', 'reportStage("reviewing")', 'reportStage("saving")']) expect(generator).toContain(stage);
    expect(generator).toContain('Number(Deno.env.get("QUIZ_GENERATION_BUDGET_SECONDS") || "") || 140');
    expect(generator).toContain("signal: controller.signal");
  });

  it("the reviewer falls back to the generator model", () => {
    expect(generator).toContain('step: "review", models: [models.reviewer, models.generator], attemptsPerModel: 2');
    expect(generator).toContain('step: "draft", models: [models.generator], attemptsPerModel: 3');
  });

  it("#467: per-call caps, flash-lite reviewer by default, short reviewer quotes", () => {
    expect(generator).toContain("attemptsPerModel: 3, maxAttemptMs: 60000, deadline,");
    expect(generator).toContain("attemptsPerModel: 2, maxAttemptMs: 40000, deadline,");
    expect(generator).toContain('Deno.env.get("GEMINI_QUIZ_REVIEW_MODEL") || "gemini-3.1-flash-lite")');
    expect(generator).toContain("quote 只要能證明對錯的最短連續片段（4～15 個字）");
  });

  it("an early exit fails the queued swap row instead of leaving it waiting", () => {
    expect(generator).toContain('.eq("generation_status", "generating").eq("generation_stage", "queued")');
    for (const code of ["feature_disabled", "no_active_church_plan", "plan_mismatch", "no_reading_chapters"]) {
      expect(generator).toContain(`"${code}")`);
    }
  });
});

describe("admin calendar progress (#465)", () => {
  it("polls a generating day and redraws the calendar when it finishes", () => {
    expect(admin).toContain("if (day.status === 'generating') watchAdminQuizGeneration(root, host, day);");
    expect(admin).toContain("const result = await db.getDailyQuizCalendar(plan, day.date, 1);");
    expect(admin).toContain("if (!slot.isConnected) { clearInterval(clock); return; }");
  });

  it("hides 請 AI 出題 while generating and explains failures in Chinese", () => {
    expect(admin).toContain("if (day.source !== 'custom' && day.status !== 'generating') {");
    expect(admin).toContain("${day.status === 'failed' ? renderQuizGenerationErrorHtml(day.aiError) : ''}");
    expect(admin).not.toContain("稍後重新整理就會看到新題目");
  });
});
