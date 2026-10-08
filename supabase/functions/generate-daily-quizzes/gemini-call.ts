// #465：呼叫 Gemini 的逾時、重試、備用模型，以及寫進 generation_error 的錯誤格式。
// 獨立成檔是為了讓 vitest 直接測行為（index.ts 本身是 Deno.serve 進入點）。
//
// 錯誤格式（後台 js/modules/quiz-generation-status.mjs 會解析成中文）：
//   <步驟>:<代碼>[:<模型>][ — <原文>]
//   步驟：scripture（抓經文）draft（出題）review（審題）quality（品質篩選）save（儲存）
//   代碼：HTTP 狀態碼，或 timeout／network／invalid_json／blocked_<原因>／insufficient／error
//   例：review:503:gemini-3.8-flash — This model is currently experiencing high demand.

export type GenerationStep = "scripture" | "draft" | "review" | "quality" | "save";

export class GenerationError extends Error {
  step: GenerationStep;
  code: string;
  model: string;
  detail: string;
  constructor(step: GenerationStep, code: string, detail = "", model = "") {
    super(formatGenerationError(step, code, detail, model));
    this.step = step;
    this.code = code;
    this.model = model;
    this.detail = detail;
  }
}

export function formatGenerationError(step: string, code: string, detail = "", model = "") {
  const clean = String(detail || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${step}:${code}${model ? `:${model}` : ""}${clean ? ` — ${clean}` : ""}`;
}

// 一次 Gemini 呼叫失敗的原因；retryable 表示同一個模型再試一次可能會好
export class GeminiCallError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function geminiHttpError(status: number, message: string) {
  return new GeminiCallError(String(status), message || "request_failed", RETRYABLE_STATUS.has(status));
}

// 模型不存在或不能用（404／403）：換備用模型，同一個模型不用重試
export function shouldSkipModel(error: GeminiCallError) {
  return error.code === "404" || error.code === "403";
}

export type CallAttempt = (model: string, timeoutMs: number) => Promise<unknown>;

export type FallbackOptions = {
  step: GenerationStep;
  models: string[];
  attemptsPerModel: number;
  deadline: number;
  call: CallAttempt;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: number[];
  // 剩下的時間少於這個值就不再開新的一次呼叫（留給後面的步驟與寫入失敗）
  minAttemptMs?: number;
  onRetry?: (info: { model: string; attempt: number; code: string; message: string; waitMs: number }) => void;
};

// 依序嘗試 models；每個模型最多 attemptsPerModel 次，可重試的錯誤會等 backoff 後再試。
// 成功回傳 { value, model }；全部失敗丟 GenerationError（帶最後一次的模型、代碼、原文）。
export async function callWithFallback(options: FallbackOptions): Promise<{ value: unknown; model: string }> {
  const now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const backoff = options.backoffMs || [2000, 5000, 10000];
  const minAttemptMs = options.minAttemptMs ?? 15000;
  const models = Array.from(new Set(options.models.filter(Boolean)));
  let last: { model: string; code: string; message: string } = { model: models[0] || "", code: "timeout", message: "generation_budget_exhausted" };

  for (const model of models) {
    for (let attempt = 1; attempt <= options.attemptsPerModel; attempt += 1) {
      const remaining = options.deadline - now();
      if (remaining < minAttemptMs) {
        throw new GenerationError(options.step, "timeout", `budget exhausted after ${last.code}: ${last.message}`, last.model || model);
      }
      try {
        return { value: await options.call(model, remaining - 5000), model };
      } catch (error) {
        const failure = error instanceof GeminiCallError ? error : new GeminiCallError("error", String((error as Error)?.message || error), false);
        last = { model, code: failure.code, message: failure.message };
        if (shouldSkipModel(failure) || !failure.retryable || attempt === options.attemptsPerModel) break;
        const waitMs = backoff[Math.min(attempt - 1, backoff.length - 1)];
        if (options.deadline - now() - waitMs < minAttemptMs) break;
        options.onRetry?.({ model, attempt, code: failure.code, message: failure.message, waitMs });
        await sleep(waitMs);
      }
    }
  }
  throw new GenerationError(options.step, last.code, last.message, last.model);
}
