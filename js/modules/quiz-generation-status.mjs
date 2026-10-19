// js/modules/quiz-generation-status.mjs
// #465：後台小測驗日曆的 AI 出題進度與錯誤說明。
// - describeQuizGenerationError：把 generation_error 原文翻成中文（新格式見
//   supabase/functions/generate-daily-quizzes/gemini-call.ts，也認得 #465 之前的舊格式）。
// - renderQuizGenerationProgressHtml：出題中的步驟條＋已等秒數。

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

export const QUIZ_GENERATION_STAGES = [
  { key: "queued", label: "排隊中" },
  { key: "scripture", label: "抓經文" },
  { key: "drafting", label: "AI 出題" },
  { key: "reviewing", label: "AI 審題" },
  { key: "saving", label: "儲存" }
];

// 平常大約要多久（只用來提示，不是限制）；超過 STALE_SECONDS 伺服器會自動判定失敗
export const QUIZ_GENERATION_TYPICAL_SECONDS = 60;
export const QUIZ_GENERATION_STALE_SECONDS = 5 * 60;

const STEP_LABELS = {
  scripture: "抓經文",
  draft: "AI 出題",
  review: "AI 審題",
  quality: "品質篩選",
  save: "儲存題目"
};

const NEW_FORMAT = /^(scripture|draft|review|quality|save):([^:\s—]+)(?::([A-Za-z0-9._+:-]+?))?(?: — ([\s\S]*))?$/;

function describeCode(step, code, detail) {
  if (code === "503") return { reason: "Google AI 目前無法使用（503：服務過載或暫停）", hint: "通常是 Google 那邊的問題，過幾分鐘再按「請 AI 出題」。如果一直發生，可以先改成自訂題目。" };
  if (code === "429") return { reason: "AI 用量暫時達到上限（429）", hint: "等一段時間再試；如果每天都發生，要檢查 Gemini API 的額度。" };
  if (code === "500" || code === "502" || code === "504") return { reason: `Google AI 暫時出錯（${code}）`, hint: "過幾分鐘再試一次。" };
  if (code === "404") return { reason: "找不到設定的 AI 模型（404）", hint: "模型名稱可能打錯或已停用，請檢查 GEMINI_QUIZ_MODEL／GEMINI_QUIZ_REVIEW_MODEL。" };
  if (code === "403" || code === "401") return { reason: `AI 金鑰沒有權限（${code}）`, hint: "請檢查 GEMINI_API_KEY 是否有效。" };
  if (code === "400") return { reason: "AI 拒絕了這次請求（400）", hint: "請把原始訊息轉給維護者。" };
  if (code === "timeout") return { reason: "AI 太久沒有回應，超過時間限制", hint: "再試一次；常發生的話請轉給維護者。" };
  if (code === "network") return { reason: "連不上 Google AI", hint: "過幾分鐘再試一次。" };
  if (code === "invalid_json") return { reason: "AI 回傳的內容格式不完整", hint: "再試一次通常就會好。" };
  if (code.startsWith("blocked_")) return { reason: "AI 沒有產生內容（可能被安全機制擋下）", hint: "再試一次；一直發生就改成自訂題目。" };
  if (step === "quality" && code === "insufficient") {
    const passed = /^(\d+)\/(\d+)/.exec(detail || "");
    // #589：kept N/5＝連同之前保留的，目前共有幾題通過（下次只要補不足的）
    const kept = /kept (\d+)\/(\d+)/.exec(detail || "");
    if (kept) {
      return {
        reason: `這次 ${passed ? `${passed[2]} 題候選有 ${passed[1]} 題通過，` : ""}累計已通過 ${kept[1]}／${kept[2]} 題`,
        hint: `已通過的題目會留著，再按「請 AI 出題」只要補 ${Math.max(0, Number(kept[2]) - Number(kept[1]))} 題。`
      };
    }
    return {
      reason: passed ? `AI 出的 ${passed[2]} 題候選只有 ${passed[1]} 題通過品質檢查（需要 5 題）` : "通過品質檢查的題目不足 5 題",
      hint: "這幾章可出的題目可能比較少，可以再試一次，或改成自訂題目。"
    };
  }
  if (step === "scripture") {
    const known = {
      fetch_failed: "抓不到當日經文",
      feature_disabled: "小測驗功能目前關閉",
      no_active_church_plan: "這一天沒有進行中的教會計畫",
      plan_mismatch: "這一天的計畫和目前進行中的計畫不同",
      no_reading_chapters: "這一天沒有排讀經進度",
      chapter_resolution_failed: "算不出這一天要讀的章節",
      plan_lookup_failed: "讀取計畫失敗"
    };
    return { reason: known[code] || "準備經文時出錯", hint: code === "fetch_failed" ? "經文來源可能暫時連不上，過幾分鐘再試。" : "" };
  }
  return { reason: "發生未預期的錯誤", hint: "再試一次；一直發生的話請把原始訊息轉給維護者。" };
}

// 回傳 { title, hint, raw }：title 是一句中文原因（含失敗的步驟），raw 是原文（給維護者看）
export function describeQuizGenerationError(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return { title: "AI 出題失敗", hint: "", raw: "" };
  if (raw === "generation_timeout") {
    return { title: "出題超過 5 分鐘沒有進度，已自動停止", hint: "可能是 AI 服務卡住，可以再按一次「請 AI 出題」。", raw };
  }
  const match = NEW_FORMAT.exec(raw);
  if (match) {
    const [, step, code, model, detail] = match;
    const { reason, hint } = describeCode(step, code, detail);
    return { title: `${STEP_LABELS[step]}失敗：${reason}${model ? `（模型 ${model}）` : ""}`, hint, raw };
  }
  // #465 之前的舊格式
  const legacyGemini = /^gemini_(\d{3}|[a-z_]+)/.exec(raw);
  if (legacyGemini) {
    const code = /^\d{3}$/.test(legacyGemini[1]) ? legacyGemini[1] : `blocked_${legacyGemini[1]}`;
    const { reason, hint } = describeCode("draft", code, "");
    return { title: `AI 失敗：${reason}`, hint, raw };
  }
  const legacyQuality = /^quiz_quality_insufficient:(\d+\/\d+)/.exec(raw);
  if (legacyQuality) {
    const { reason, hint } = describeCode("quality", "insufficient", legacyQuality[1]);
    return { title: `品質篩選失敗：${reason}`, hint, raw };
  }
  if (raw.startsWith("scripture_fetch_failed")) {
    const { reason, hint } = describeCode("scripture", "fetch_failed", "");
    return { title: `抓經文失敗：${reason}`, hint, raw };
  }
  return { title: "AI 出題失敗", hint: "再試一次；一直發生的話請把原始訊息轉給維護者。", raw };
}

export function quizGenerationElapsedSeconds(day, clockOffsetMs = 0, nowMs = Date.now()) {
  const started = Date.parse(day?.aiStartedAt || "");
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round((nowMs + clockOffsetMs - started) / 1000));
}

function formatSeconds(total) {
  if (total == null) return "";
  return total < 60 ? `${total} 秒` : `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
}

export function renderQuizGenerationProgressHtml(day, elapsedSeconds = null) {
  const stage = day?.aiStage || "queued";
  const current = Math.max(0, QUIZ_GENERATION_STAGES.findIndex(item => item.key === stage));
  const steps = QUIZ_GENERATION_STAGES.map((item, index) => {
    const state = index < current ? "is-done" : index === current ? "is-current" : "";
    return `<li class="quiz-generation-progress__step ${state}"${index === current ? ' aria-current="step"' : ""}>${esc(item.label)}</li>`;
  }).join("");
  let note = "通常 30 秒到 1 分鐘，AI 忙碌時會自動重試，可能更久。完成後這裡會自動更新。";
  if (elapsedSeconds != null && elapsedSeconds > QUIZ_GENERATION_TYPICAL_SECONDS * 2) {
    note = "比平常久，AI 可能正在重試。超過 5 分鐘沒有進度會自動停止，屆時可以再試一次。";
  }
  return `<div class="quiz-generation-progress" role="status" aria-live="polite" data-quiz-generation-progress>
    <p class="quiz-generation-progress__title">AI 出題中：${esc(QUIZ_GENERATION_STAGES[current].label)}${elapsedSeconds != null ? `・已等 ${esc(formatSeconds(elapsedSeconds))}` : ""}</p>
    <ol class="quiz-generation-progress__steps">${steps}</ol>
    <p class="admin-daily-quiz-note">${esc(note)}</p>
  </div>`;
}

export function renderQuizGenerationErrorHtml(rawError) {
  const info = describeQuizGenerationError(rawError);
  return `<div class="admin-daily-quiz-note admin-quiz-day-alert" data-quiz-generation-error>
    <p class="quiz-generation-error__title">${esc(info.title)}</p>
    ${info.hint ? `<p class="quiz-generation-error__hint">${esc(info.hint)}</p>` : ""}
    <p class="quiz-generation-error__hint">可以按「請 AI 出題」再試一次，或改成自訂題目。</p>
    ${info.raw ? `<details class="quiz-generation-error__raw"><summary>原始訊息</summary><code>${esc(info.raw)}</code></details>` : ""}
  </div>`;
}
