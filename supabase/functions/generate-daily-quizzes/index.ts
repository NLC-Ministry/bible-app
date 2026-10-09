import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assignCandidateIds, buildVerseIndex, CANDIDATE_COUNT, formatScripture, QUIZ_QUESTION_COUNT, selectQuestions, toBlindReviewItems,
  type ChapterVerses
} from "./quiz-quality.ts";
import { callWithFallback, GeminiCallError, geminiHttpError, GenerationError, type GenerationStep } from "./gemini-call.ts";

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

async function fetchChapter(ref: ChapterRef): Promise<ChapterVerses> {
  const info = BOOKS[ref.book];
  if (!info) throw new Error(`unknown_bible_book:${ref.book}`);
  const errors: string[] = [];
  for (const translation of ["CUNP", "CUV"]) {
    try {
      const response = await fetch(`https://bolls.life/get-chapter/${translation}/${info.id}/${ref.chapter}/`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length === 0) throw new Error("empty_chapter");
      const verses = payload.map((verse: any, index: number) => ({ verse: Number(verse?.verse || index + 1), text: stripHtml(verse?.text) }))
        .filter((verse: { text: string }) => verse.text);
      if (!verses.some((verse: { text: string }) => /[㐀-鿿]/.test(verse.text))) throw new Error("non_chinese_chapter");
      return { book: ref.book, chapter: ref.chapter, verses };
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
  // 被安全機制擋掉或沒有輸出：換個時間或換模型可能就好，所以算可重試
  throw new GeminiCallError(`blocked_${String(reason).toLowerCase()}`, "no output text", true);
}

function validateQuestions(questions: any[]) {
  if (!Array.isArray(questions) || questions.length !== QUIZ_QUESTION_COUNT) throw new Error("quiz_five_questions_required");
  questions.forEach((question: any, index: number) => {
    if (!question || !Array.isArray(question.options) || question.options.length !== 4) throw new Error(`invalid_question_options:${index}`);
    if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) throw new Error(`invalid_correct_index:${index}`);
    [question.question, question.explanation, question.verseRef, ...question.options].forEach((text: unknown) => {
      if (!String(text || "").trim()) throw new Error(`empty_question_field:${index}`);
    });
  });
  return questions;
}

function normalizeGeminiModel(value: unknown) {
  let model = String(value || "").trim();
  model = model.replace(/^GEMINI_QUIZ(?:_REVIEW)?_MODEL\s*=\s*/i, "").trim();
  if ((model.startsWith('"') && model.endsWith('"')) || (model.startsWith("'") && model.endsWith("'"))) {
    model = model.slice(1, -1).trim();
  }
  return model.replace(/^models\//i, "").trim();
}

// 單次呼叫：逾時用 AbortController 中斷，失敗一律丟 GeminiCallError（重試由 callWithFallback 決定）
async function callGeminiOnce(apiKey: string, model: string, instruction: string, prompt: string, schema: unknown, timeoutMs: number) {
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new GeminiCallError("invalid_model", "invalid_gemini_model", false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 24000, responseMimeType: "application/json", responseJsonSchema: schema }
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new GeminiCallError("timeout", `no response within ${Math.round(timeoutMs / 1000)}s`, true);
      throw new GeminiCallError("network", String((error as Error)?.message || error), true);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw geminiHttpError(response.status, String(payload?.error?.message || ""));
    const text = extractGeminiText(payload);
    try { return JSON.parse(text); }
    catch { throw new GeminiCallError("invalid_json", `finishReason=${payload?.candidates?.[0]?.finishReason || "unknown"}`, true); }
  } finally {
    clearTimeout(timer);
  }
}

const GENERATOR_INSTRUCTION = [
  "你是教會聖經小測驗的出題編輯。只能根據提供的當日經文出題，不得使用經文以外的傳統、推測或神學立場。使用繁體中文。",
  "規則：",
  "1. 每題四個選項，恰好一個正確。",
  "2. evidence 依選項順序列出四個選項各自的舉證：verseRef 格式為「書名 章:節」或「書名 章:節-節」（同一章內），書名必須和經文標題完全相同；quote 是從當日經文逐字複製的一段連續文字（至少 4 個字，不可改寫、不可加省略號）；reason 用一句短句（約 20 字內）說明這段經文如何證明此選項正確或錯誤，不要寫成長篇解說。",
  "3. 正確選項的 quote 必須直接證明它正確。",
  "4. 每個錯誤選項都要能被經文直接排除。最常見的做法：題目問的是經文明寫的唯一答案（誰、幾、哪裡、哪一個先發生），正解那段經文本身就排除了其他選項——這時錯誤選項的 quote 直接用正解那段經文，reason 寫成「經文明說是甲，所以不是乙」即可，不必另外找其他經文。",
  "   只有在正解經文無法排除某個錯誤選項時（例如經文說甲做了這件事，但沒有說只有甲做），才需要另外找與它矛盾的經文；找不到，就換一個錯誤選項。不可以只因為「經文沒有提到」而判定錯誤。",
  "5. 不可使用「以上皆是」「以上皆非」「無法確定」之類的選項；選項文字不可重複，也不可以兩個選項其實是同一件事的不同說法。",
  "6. 不要問經文沒有明寫的動機、心情、意義或屬靈教訓；題目只能有一種合理的讀法。",
  "7. explanation 用一兩句話說明正解，verseRef 填正解的出處（格式同上）。"
].join("\n");

const REVIEWER_INSTRUCTION = [
  "你是聖經小測驗的審題員。只根據提供的當日經文判斷，不得使用經文以外的知識或傳統。",
  "對每一題的每一個選項，依選項順序獨立判定：",
  "correct：經文有明確文字證明此選項正確，且符合題意。",
  "incorrect：經文有明確文字與此選項矛盾。題目問的是經文明寫的唯一答案（誰、幾、哪裡、哪一個先發生）時，經文寫明答案是別的，就足以判此選項 incorrect，quote 可以就是寫明答案的那段經文。",
  "undeterminable：經文無法明確證明對或錯——包括經文完全沒有談到題目問的事、題目有兩種以上合理讀法、或需要推測。經文已經寫明唯一答案時，不要因為「經文沒有另外提到這個錯誤選項」就判 undeterminable。",
  "correct 與 incorrect 都要附 verseRef（「書名 章:節」或「書名 章:節-節」，書名和經文標題完全相同）與從經文逐字複製的 quote；undeterminable 時兩者留空字串。",
  "quote 只要能證明對錯的最短連續片段（4～15 個字），不要整節照抄；同一題的多個選項可以引用同一段。只輸出判定結果，不要寫說明。"
].join("\n");

const EVIDENCE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verseRef", "quote", "reason"],
  properties: { verseRef: { type: "string" }, quote: { type: "string" }, reason: { type: "string" } }
};

const CANDIDATES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["questions"],
  properties: { questions: {
    type: "array", minItems: CANDIDATE_COUNT, maxItems: CANDIDATE_COUNT,
    items: {
      type: "object", additionalProperties: false,
      required: ["question", "options", "correctIndex", "explanation", "verseRef", "evidence"],
      properties: {
        question: { type: "string" },
        options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
        correctIndex: { type: "integer", minimum: 0, maximum: 3 },
        explanation: { type: "string" }, verseRef: { type: "string" },
        evidence: { type: "array", minItems: 4, maxItems: 4, items: EVIDENCE_SCHEMA }
      }
    }
  } }
};

const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["reviews"],
  properties: { reviews: {
    type: "array",
    items: {
      type: "object", additionalProperties: false, required: ["id", "judgments"],
      properties: {
        id: { type: "string" },
        judgments: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object", additionalProperties: false, required: ["verdict", "verseRef", "quote"],
            properties: {
              verdict: { type: "string", enum: ["correct", "incorrect", "undeterminable"] },
              verseRef: { type: "string" }, quote: { type: "string" }
            }
          }
        }
      }
    }
  } }
};

type StageReporter = (stage: "drafting" | "reviewing" | "saving") => Promise<void>;
type GenerationContext = {
  apiKey: string; models: { generator: string; reviewer: string }; deadline: number; invocationId: string; variant: string;
};

function retryLogger(context: GenerationContext, step: GenerationStep) {
  return (info: { model: string; attempt: number; code: string; message: string; waitMs: number }) =>
    console.warn("daily_quiz_gemini_retry", JSON.stringify({ invocationId: context.invocationId, variant: context.variant, step, ...info }));
}

// #414：出 CANDIDATE_COUNT 題候選 → 程式比對舉證 → 另一個模型盲審 → 取前 5 題通過的；
// 不足 5 題就整版失敗，交給既有的 20:00 重試與後台標紅。
// #465：每次呼叫都有逾時與重試；審題模型一直失敗（例如持續 503）就改用出題模型代審。
// #467：單次呼叫有上限（出題 60 秒、審題 40 秒），模型不回應時備用模型還有時間接手。
async function generateVariant(context: GenerationContext, chapters: ChapterVerses[], refs: ChapterRef[], reportStage: StageReporter) {
  const { apiKey, models, deadline, invocationId, variant } = context;
  const angle = variant === "A" ? "經文事實、事件先後與關鍵細節" : "人物、對話與經文明寫的因果關係";
  const referenceLabel = refs.map(ref => `${ref.book}${ref.chapter}章`).join("、");
  const scripture = formatScripture(chapters);

  await reportStage("drafting");
  const draft = await callWithFallback({
    step: "draft", models: [models.generator], attemptsPerModel: 3, maxAttemptMs: 60000, deadline,
    call: (model, timeoutMs) => callGeminiOnce(apiKey, model, GENERATOR_INSTRUCTION,
      `請為 ${referenceLabel} 產生版本 ${variant} 的 ${CANDIDATE_COUNT} 題四選一候選題（之後會由審題員篩選）。此版本著重：${angle}。各題不要重複考同一件事。\n\n當日經文：\n${scripture}`,
      CANDIDATES_SCHEMA, timeoutMs),
    onRetry: retryLogger(context, "draft")
  });
  const candidates = assignCandidateIds(draft.value);

  await reportStage("reviewing");
  const review = await callWithFallback({
    step: "review", models: [models.reviewer, models.generator], attemptsPerModel: 2, maxAttemptMs: 40000, deadline,
    call: (model, timeoutMs) => callGeminiOnce(apiKey, model, REVIEWER_INSTRUCTION,
      `請審以下 ${candidates.length} 題四選一題目，每一題都要回覆，id 照抄。\n\n題目：\n${JSON.stringify(toBlindReviewItems(candidates))}\n\n當日經文：\n${scripture}`,
      REVIEW_SCHEMA, timeoutMs),
    onRetry: retryLogger(context, "review")
  });
  if (review.model !== models.reviewer) {
    console.warn("daily_quiz_review_fallback", JSON.stringify({ invocationId, variant, wanted: models.reviewer, used: review.model }));
  }
  const { questions, acceptedCount, rejected } = selectQuestions(candidates, (review.value as any)?.reviews, buildVerseIndex(chapters));
  console.info("daily_quiz_quality_check", JSON.stringify({ invocationId, variant, candidates: candidates.length, accepted: acceptedCount, rejected, reviewModel: review.model }));
  if (questions.length < QUIZ_QUESTION_COUNT) {
    throw new GenerationError("quality", "insufficient", `${acceptedCount}/${candidates.length} passed; ${summarizeRejections(rejected)}`);
  }
  await reportStage("saving");
  return { questions: validateQuestions(questions), model: review.model === draft.model ? draft.model : `${draft.model}+review:${review.model}` };
}

// 淘汰原因統計（例如 review_disagrees×4, quote_not_found×2），寫進錯誤方便看出是哪一關卡太嚴
function summarizeRejections(rejected: { problems: string[] }[]) {
  const counts = new Map<string, number>();
  for (const item of rejected) {
    for (const problem of new Set(item.problems.map(value => value.split(":")[0]))) counts.set(problem, (counts.get(problem) || 0) + 1);
  }
  return Array.from(counts, ([key, count]) => `${key}×${count}`).join(", ") || "none";
}

function errorText(error: unknown, step: GenerationStep) {
  if (error instanceof GenerationError) return error.message;
  const message = String((error as Error)?.message || error);
  return `${step}:error — ${message}`;
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

  // #465：自己的時間預算要比平台的執行上限短，逾時時才來得及把那一列寫成失敗
  const budgetSeconds = Number(Deno.env.get("QUIZ_GENERATION_BUDGET_SECONDS") || "") || 140;
  const deadline = Date.now() + budgetSeconds * 1000;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
  const model = normalizeGeminiModel(Deno.env.get("GEMINI_QUIZ_MODEL") || "gemini-3.1-flash-lite");
  const reviewModel = normalizeGeminiModel(Deno.env.get("GEMINI_QUIZ_REVIEW_MODEL") || "gemini-3.1-flash-lite");
  if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
    console.error("daily_quiz_server_not_configured", JSON.stringify({ invocationId, supabaseUrl: Boolean(supabaseUrl), serviceRoleKey: Boolean(serviceRoleKey), geminiApiKey: Boolean(geminiApiKey) }));
    return respond({ error: "server_not_configured", invocationId }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const quizDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.quizDate || "")) ? String(body.quizDate) : taipeiDate();
  const requestedVariants = Array.from(new Set(
    (Array.isArray(body?.variants) ? body.variants : ["A", "B"])
      .map((value: unknown) => String(value || "").trim().toUpperCase())
      .filter((value: string) => ["A", "B"].includes(value))
  ));
  console.info("daily_quiz_generation_started", JSON.stringify({ invocationId, source: String(body?.source || "unknown"), quizDate, requestedVariants, model, reviewModel, budgetSeconds }));
  if (requestedVariants.length === 0) return respond({ error: "quiz_variants_required", date: quizDate, invocationId }, 400);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 「請 AI 出題」會先建一筆排隊中的列；這次請求在出題前就結束的話，把它寫成失敗並說明原因，
  // 不要讓後台空等 5 分鐘才看到 generation_timeout。
  const failQueued = async (planId: unknown, code: string, detail = "") => {
    if (!planId) return;
    const { data: queued } = await supabase.from("daily_quizzes").select("id")
      .eq("global_plan_id", String(planId)).eq("quiz_date", quizDate).in("variant", requestedVariants)
      .eq("generation_status", "generating").eq("generation_stage", "queued");
    for (const row of queued || []) {
      await supabase.rpc("fail_daily_quiz_generation", { p_quiz_id: row.id, p_error: `scripture:${code}${detail ? ` — ${detail}` : ""}` });
    }
  };

  const { data: quizFeature, error: quizFeatureError } = await supabase.from("app_feature_settings")
    .select("enabled").eq("key", "daily_quiz").maybeSingle();
  if (quizFeatureError || quizFeature?.enabled !== true) {
    console.info("daily_quiz_feature_disabled", JSON.stringify({ invocationId, settingFound: Boolean(quizFeature), settingError: quizFeatureError?.message || null }));
    await failQueued(body?.planId, "feature_disabled");
    return respond({ status: "feature_disabled", requests: 0, invocationId });
  }
  const { data: plans, error: planError } = await supabase.from("global_plans")
    .select("id, name, start_date, end_date, rules")
    .eq("plan_kind", "church_campaign_stage").eq("is_hidden", false)
    .lte("start_date", quizDate).gte("end_date", quizDate)
    .order("start_date", { ascending: false }).limit(1);
  if (planError) {
    console.error("daily_quiz_plan_lookup_failed", JSON.stringify({ invocationId, error: planError.message }));
    await failQueued(body?.planId, "plan_lookup_failed", planError.message);
    return respond({ error: planError.message, invocationId }, 500);
  }
  const plan = plans?.[0];
  if (!plan) {
    console.warn("daily_quiz_no_active_plan", JSON.stringify({ invocationId, quizDate }));
    await failQueued(body?.planId, "no_active_church_plan");
    return respond({ date: quizDate, status: "no_active_church_plan", requests: 0, invocationId });
  }
  if (body?.planId && String(body.planId) !== String(plan.id)) {
    console.warn("daily_quiz_plan_mismatch", JSON.stringify({ invocationId, requestedPlanId: String(body.planId), activePlanId: String(plan.id) }));
    await failQueued(body.planId, "plan_mismatch");
    return respond({ error: "quiz_plan_mismatch", date: quizDate, invocationId }, 409);
  }

  let chapterRefs: ChapterRef[];
  try { chapterRefs = resolveDailyChapters(plan.rules, quizDate); }
  catch (error) {
    const message = String((error as Error)?.message || error);
    console.error("daily_quiz_chapter_resolution_failed", JSON.stringify({ invocationId, error: message }));
    await failQueued(plan.id, "chapter_resolution_failed", message);
    return respond({ error: message, date: quizDate, invocationId }, 500);
  }
  if (chapterRefs.length === 0) {
    await failQueued(plan.id, "no_reading_chapters");
    return respond({ date: quizDate, planId: plan.id, status: "no_reading_chapters", requests: 0 });
  }

  // #465：先預約（後台立刻看到「抓經文」），再抓經文；抓不到就把預約到的都寫成失敗
  const results: any[] = [];
  const reserved: { variant: string; quizId: string }[] = [];
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
    reserved.push({ variant, quizId: reservation.quizId });
  }

  let chapters: ChapterVerses[] = [];
  if (reserved.length) {
    try { chapters = await Promise.all(chapterRefs.map(fetchChapter)); }
    catch (error) {
      const message = String((error as Error)?.message || error);
      console.error("daily_quiz_scripture_fetch_failed", JSON.stringify({ invocationId, error: message }));
      for (const { variant, quizId } of reserved) {
        await supabase.rpc("fail_daily_quiz_generation", { p_quiz_id: quizId, p_error: `scripture:fetch_failed — ${message}` });
        results.push({ variant, status: "failed", error: message });
      }
      return respond({ error: message, date: quizDate, results, invocationId }, 502);
    }
  }

  let requests = 0;
  for (const { variant, quizId } of reserved) {
    requests += 1;
    let step: GenerationStep = "draft";
    const reportStage: StageReporter = async stage => {
      step = stage === "drafting" ? "draft" : stage === "reviewing" ? "review" : "save";
      const { error } = await supabase.rpc("set_daily_quiz_generation_stage", { p_quiz_id: quizId, p_stage: stage });
      // 進度寫不進去不影響出題（例如 migration 還沒推）；只記 log
      if (error) console.warn("daily_quiz_stage_update_failed", JSON.stringify({ invocationId, variant, stage, error: error.message }));
    };
    try {
      console.info("daily_quiz_gemini_request_started", JSON.stringify({ invocationId, variant, model, reviewModel, chapterCount: chapterRefs.length }));
      const generated = await generateVariant({ apiKey: geminiApiKey, models: { generator: model, reviewer: reviewModel }, deadline, invocationId, variant }, chapters, chapterRefs, reportStage);
      const { error: completionError } = await supabase.rpc("complete_daily_quiz_generation", { p_quiz_id: quizId, p_questions: generated.questions, p_model: generated.model });
      if (completionError) throw new GenerationError("save", "error", completionError.message);
      results.push({ variant, status: "ready", questionCount: generated.questions.length, model: generated.model });
      console.info("daily_quiz_variant_ready", JSON.stringify({ invocationId, variant, questionCount: generated.questions.length, model: generated.model }));
    } catch (error) {
      const message = errorText(error, step);
      await supabase.rpc("fail_daily_quiz_generation", { p_quiz_id: quizId, p_error: message });
      results.push({ variant, status: "failed", error: message });
      console.error("daily_quiz_variant_failed", JSON.stringify({ invocationId, variant, error: message }));
    }
  }
  console.info("daily_quiz_generation_finished", JSON.stringify({ invocationId, quizDate, requests, results: results.map(result => ({ variant: result.variant, status: result.status })) }));
  return respond({ date: quizDate, planId: plan.id, chapterRefs, requests, results, invocationId });
});
