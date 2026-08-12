import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
type BookInfo = { id: number; chapters: number };
type ChapterRef = { book: string; chapter: number };

const BOOKS: Record<string, BookInfo> = {
  "創世記": { id: 1, chapters: 50 }, "出埃及記": { id: 2, chapters: 40 }, "利未記": { id: 3, chapters: 27 },
  "民數記": { id: 4, chapters: 36 }, "申命記": { id: 5, chapters: 34 }, "約書亞記": { id: 6, chapters: 24 },
  "士師記": { id: 7, chapters: 21 }, "路得記": { id: 8, chapters: 4 }, "撒母耳記上": { id: 9, chapters: 31 },
  "撒母耳記下": { id: 10, chapters: 24 }, "列王紀上": { id: 11, chapters: 22 }, "列王紀下": { id: 12, chapters: 25 },
  "歷代志上": { id: 13, chapters: 29 }, "歷代志下": { id: 14, chapters: 36 }, "以斯拉記": { id: 15, chapters: 10 },
  "尼希米記": { id: 16, chapters: 13 }, "以斯帖記": { id: 17, chapters: 10 }, "約伯記": { id: 18, chapters: 42 },
  "詩篇": { id: 19, chapters: 150 }, "箴言": { id: 20, chapters: 31 }, "傳道書": { id: 21, chapters: 12 },
  "雅歌": { id: 22, chapters: 8 }, "以賽亞書": { id: 23, chapters: 66 }, "耶利米書": { id: 24, chapters: 52 },
  "耶利米哀歌": { id: 25, chapters: 5 }, "以西結書": { id: 26, chapters: 48 }, "但以理書": { id: 27, chapters: 12 },
  "何西阿書": { id: 28, chapters: 14 }, "約珥書": { id: 29, chapters: 3 }, "阿摩司書": { id: 30, chapters: 9 },
  "俄巴底亞書": { id: 31, chapters: 1 }, "約拿書": { id: 32, chapters: 4 }, "彌迦書": { id: 33, chapters: 7 },
  "那鴻書": { id: 34, chapters: 3 }, "哈巴谷書": { id: 35, chapters: 3 }, "西番雅書": { id: 36, chapters: 3 },
  "哈該書": { id: 37, chapters: 2 }, "撒迦利亞書": { id: 38, chapters: 14 }, "瑪拉基書": { id: 39, chapters: 4 },
  "馬太福音": { id: 40, chapters: 28 }, "馬可福音": { id: 41, chapters: 16 }, "路加福音": { id: 42, chapters: 24 },
  "約翰福音": { id: 43, chapters: 21 }, "使徒行傳": { id: 44, chapters: 28 }, "羅馬書": { id: 45, chapters: 16 },
  "哥林多前書": { id: 46, chapters: 16 }, "哥林多後書": { id: 47, chapters: 13 }, "加拉太書": { id: 48, chapters: 6 },
  "以弗所書": { id: 49, chapters: 6 }, "腓立比書": { id: 50, chapters: 4 }, "歌羅西書": { id: 51, chapters: 4 },
  "帖撒羅尼迦前書": { id: 52, chapters: 5 }, "帖撒羅尼迦後書": { id: 53, chapters: 3 }, "提摩太前書": { id: 54, chapters: 6 },
  "提摩太後書": { id: 55, chapters: 4 }, "提多書": { id: 56, chapters: 3 }, "腓利門書": { id: 57, chapters: 1 },
  "希伯來書": { id: 58, chapters: 13 }, "雅各書": { id: 59, chapters: 5 }, "彼得前書": { id: 60, chapters: 5 },
  "彼得後書": { id: 61, chapters: 3 }, "約翰一書": { id: 62, chapters: 5 }, "約翰二書": { id: 63, chapters: 1 },
  "約翰三書": { id: 64, chapters: 1 }, "猶大書": { id: 65, chapters: 1 }, "啟示錄": { id: 66, chapters: 22 }
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid_date:${value}`);
  return parsed;
}

function dayDifference(later: string, earlier: string) {
  return Math.floor((utcDate(later).getTime() - utcDate(earlier).getTime()) / 86400000);
}

function resolveDailyChapters(rules: any, quizDate: string): ChapterRef[] {
  const segments = Array.isArray(rules?.segments) ? rules.segments : [];
  const segment = segments.find((item: any) => item?.startDate <= quizDate && item?.endDate >= quizDate);
  if (!segment) return [];
  const allChapters: ChapterRef[] = [];
  for (const reading of Array.isArray(segment.readings) ? segment.readings : []) {
    const info = BOOKS[String(reading?.book || "")];
    if (!info) throw new Error(`unknown_bible_book:${String(reading?.book || "")}`);
    const from = Number(reading?.from || 1);
    const to = Number(reading?.to || info.chapters);
    for (let chapter = from; chapter <= to; chapter += 1) allChapters.push({ book: String(reading.book), chapter });
  }
  const dayCount = dayDifference(String(segment.endDate), String(segment.startDate)) + 1;
  const dayIndex = dayDifference(quizDate, String(segment.startDate));
  if (dayIndex < 0 || dayIndex >= dayCount || allChapters.length === 0) return [];
  const base = Math.floor(allChapters.length / dayCount);
  const remainder = allChapters.length % dayCount;
  const count = base + (dayIndex < remainder ? 1 : 0);
  const startIndex = dayIndex * base + Math.min(dayIndex, remainder);
  return allChapters.slice(startIndex, startIndex + count);
}

function stripHtml(value: unknown) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchChapterText(ref: ChapterRef) {
  const info = BOOKS[ref.book];
  if (!info) throw new Error(`unknown_bible_book:${ref.book}`);
  const errors: string[] = [];
  for (const translation of ["CUNP", "CUV"]) {
    try {
      const response = await fetch(`https://bolls.life/get-chapter/${translation}/${info.id}/${ref.chapter}/`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status}`);
      const verses = await response.json();
      if (!Array.isArray(verses) || verses.length === 0) throw new Error("empty_chapter");
      const text = verses.map((verse: any, index: number) => `${Number(verse?.verse || index + 1)} ${stripHtml(verse?.text)}`).filter(Boolean).join("\n");
      if (!/[\u3400-\u9fff]/.test(text)) throw new Error("non_chinese_chapter");
      return `${ref.book} ${ref.chapter} 章\n${text}`;
    } catch (error) {
      errors.push(`${translation}:${String((error as Error)?.message || error)}`);
    }
  }
  throw new Error(`scripture_fetch_failed:${ref.book}:${ref.chapter}:${errors.join("|")}`);
}

function extractGeminiText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = (Array.isArray(parts) ? parts : [])
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (text) return text;
  const reason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason || "output_text_missing";
  throw new Error(`gemini_${String(reason).toLowerCase()}`);
}

function validateQuestions(value: any) {
  const questions = value?.questions;
  if (!Array.isArray(questions) || questions.length !== 5) throw new Error("quiz_five_questions_required");
  questions.forEach((question: any, index: number) => {
    if (!question || !Array.isArray(question.options) || question.options.length !== 4) throw new Error(`invalid_question_options:${index}`);
    if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) throw new Error(`invalid_correct_index:${index}`);
    [question.question, question.explanation, question.verseRef, ...question.options].forEach((text: unknown) => {
      if (!String(text || "").trim()) throw new Error(`empty_question_field:${index}`);
    });
  });
  return questions;
}

async function generateVariant(apiKey: string, model: string, variant: string, scripture: string, refs: ChapterRef[]) {
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("invalid_gemini_model");
  const angle = variant === "A" ? "經文事實、事件先後與關鍵細節" : variant === "B" ? "人物、對話、動機與因果關係" : "核心信息、上下文理解與可由經文直接支持的應用";
  const referenceLabel = refs.map(ref => `${ref.book}${ref.chapter}章`).join("、");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "你是教會聖經小測驗編輯。只能根據提供的當日經文出題，不得補充經文外的傳統、推測或神學立場。使用繁體中文。每題只有一個正確答案，錯誤選項必須合理但可由經文明確排除。" }]
      },
      contents: [{
        role: "user",
        parts: [{ text: `請為 ${referenceLabel} 產生版本 ${variant} 的 5 題四選一小測驗。此版本著重：${angle}。每題附正確答案、簡短解說與精確經節出處。\n\n當日經文：\n${scripture}` }]
      }],
      generationConfig: {
        maxOutputTokens: 3000,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object", additionalProperties: false, required: ["questions"],
          properties: { questions: {
            type: "array", minItems: 5, maxItems: 5,
            items: {
              type: "object", additionalProperties: false,
              required: ["id", "question", "options", "correctIndex", "explanation", "verseRef"],
              properties: {
                id: { type: "string" }, question: { type: "string" },
                options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
                correctIndex: { type: "integer", minimum: 0, maximum: 3 },
                explanation: { type: "string" }, verseRef: { type: "string" }
              }
            }
          } }
        }
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`gemini_${response.status}:${payload?.error?.message || "request_failed"}`);
  return validateQuestions(JSON.parse(extractGeminiText(payload)));
}

Deno.serve(async req => {
  const invocationId = crypto.randomUUID();
  console.info("daily_quiz_invocation_received", JSON.stringify({ invocationId, method: req.method, hasCronSecret: Boolean(req.headers.get("x-cron-secret")) }));
  if (req.method !== "POST") {
    console.warn("daily_quiz_method_rejected", JSON.stringify({ invocationId, method: req.method }));
    return respond({ error: "method_not_allowed", invocationId }, 405);
  }
  const cronSecret = Deno.env.get("QUIZ_GENERATION_CRON_SECRET") || "";
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    console.warn("daily_quiz_auth_rejected", JSON.stringify({ invocationId, secretConfigured: Boolean(cronSecret) }));
    return respond({ error: "unauthorized", invocationId }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
  const model = Deno.env.get("GEMINI_QUIZ_MODEL") || "gemini-3.1-flash-lite";
  if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
    console.error("daily_quiz_server_not_configured", JSON.stringify({ invocationId, supabaseUrl: Boolean(supabaseUrl), serviceRoleKey: Boolean(serviceRoleKey), geminiApiKey: Boolean(geminiApiKey) }));
    return respond({ error: "server_not_configured", invocationId }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const quizDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.quizDate || "")) ? String(body.quizDate) : taipeiDate();
  const requestedVariants = Array.from(new Set(
    (Array.isArray(body?.variants) ? body.variants : ["A", "B", "C"])
      .map((value: unknown) => String(value || "").trim().toUpperCase())
      .filter((value: string) => ["A", "B", "C"].includes(value))
  ));
  console.info("daily_quiz_generation_started", JSON.stringify({ invocationId, source: String(body?.source || "unknown"), quizDate, requestedVariants, model }));
  if (requestedVariants.length === 0) return respond({ error: "quiz_variants_required", date: quizDate, invocationId }, 400);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: plans, error: planError } = await supabase.from("global_plans")
    .select("id, name, start_date, end_date, rules")
    .eq("plan_kind", "church_campaign_stage").eq("is_hidden", false)
    .lte("start_date", quizDate).gte("end_date", quizDate)
    .order("start_date", { ascending: false }).limit(1);
  if (planError) {
    console.error("daily_quiz_plan_lookup_failed", JSON.stringify({ invocationId, error: planError.message }));
    return respond({ error: planError.message, invocationId }, 500);
  }
  const plan = plans?.[0];
  if (!plan) {
    console.warn("daily_quiz_no_active_plan", JSON.stringify({ invocationId, quizDate }));
    return respond({ date: quizDate, status: "no_active_church_plan", requests: 0, invocationId });
  }
  if (body?.planId && String(body.planId) !== String(plan.id)) {
    console.warn("daily_quiz_plan_mismatch", JSON.stringify({ invocationId, requestedPlanId: String(body.planId), activePlanId: String(plan.id) }));
    return respond({ error: "quiz_plan_mismatch", date: quizDate, invocationId }, 409);
  }

  let chapterRefs: ChapterRef[];
  try { chapterRefs = resolveDailyChapters(plan.rules, quizDate); }
  catch (error) {
    const message = String((error as Error)?.message || error);
    console.error("daily_quiz_chapter_resolution_failed", JSON.stringify({ invocationId, error: message }));
    return respond({ error: message, date: quizDate, invocationId }, 500);
  }
  if (chapterRefs.length === 0) return respond({ date: quizDate, planId: plan.id, status: "no_reading_chapters", requests: 0 });

  let scripture: string;
  try { scripture = (await Promise.all(chapterRefs.map(fetchChapterText))).join("\n\n"); }
  catch (error) {
    const message = String((error as Error)?.message || error);
    console.error("daily_quiz_scripture_fetch_failed", JSON.stringify({ invocationId, error: message }));
    return respond({ error: message, date: quizDate, invocationId }, 502);
  }

  const results: any[] = [];
  let requests = 0;
  for (const variant of requestedVariants) {
    console.info("daily_quiz_variant_reserving", JSON.stringify({ invocationId, variant }));
    let { data: reservation, error: reservationError } = await supabase.rpc("reserve_daily_quiz_generation", {
      p_global_plan_id: plan.id, p_quiz_date: quizDate, p_variant: variant, p_chapter_refs: chapterRefs
    });
    if (reservationError) {
      console.error("daily_quiz_reservation_failed", JSON.stringify({ invocationId, variant, error: reservationError.message }));
      results.push({ variant, status: "reservation_failed", error: reservationError.message }); continue;
    }
    if (!reservation?.reserved && body?.retryExisting === true) {
      ({ data: reservation, error: reservationError } = await supabase.rpc("reserve_daily_quiz_regeneration", {
        p_global_plan_id: plan.id, p_quiz_date: quizDate, p_variant: variant, p_chapter_refs: chapterRefs
      }));
      if (reservationError) {
        console.error("daily_quiz_regeneration_reservation_failed", JSON.stringify({ invocationId, variant, error: reservationError.message }));
        results.push({ variant, status: "reservation_failed", error: reservationError.message }); continue;
      }
    }
    if (!reservation?.reserved) { results.push({ variant, status: "already_attempted" }); continue; }
    requests += 1;
    try {
      console.info("daily_quiz_gemini_request_started", JSON.stringify({ invocationId, variant, model, chapterCount: chapterRefs.length }));
      const questions = await generateVariant(geminiApiKey, model, variant, scripture, chapterRefs);
      const { error: completionError } = await supabase.rpc("complete_daily_quiz_generation", { p_quiz_id: reservation.quizId, p_questions: questions, p_model: model });
      if (completionError) throw completionError;
      results.push({ variant, status: "ready", questionCount: questions.length });
      console.info("daily_quiz_variant_ready", JSON.stringify({ invocationId, variant, questionCount: questions.length }));
    } catch (error) {
      const message = String((error as Error)?.message || error);
      await supabase.rpc("fail_daily_quiz_generation", { p_quiz_id: reservation.quizId, p_error: message });
      results.push({ variant, status: "failed", error: message });
      console.error("daily_quiz_variant_failed", JSON.stringify({ invocationId, variant, error: message }));
    }
  }
  console.info("daily_quiz_generation_finished", JSON.stringify({ invocationId, quizDate, requests, results: results.map(result => ({ variant: result.variant, status: result.status })) }));
  return respond({ date: quizDate, planId: plan.id, chapterRefs, requests, results, invocationId });
});
