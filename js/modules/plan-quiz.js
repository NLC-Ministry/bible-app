// 計畫頁「今日小測驗」的入口與作答畫面（#370 從 plan.js 拆出的 lazy chunk）。
// plan.js 的 renderDailyQuizSection 先確認功能開關、日期，並向伺服器確認今天真的有指派給
// 自己的測驗（或還在作答期間的補發，#643），才下載這個檔並呼叫 showDailyQuiz；沒有測驗的人不會載入。

import {
  normalizeQuestion,
  isResponseComplete,
  renderQuestionFieldsetHtml,
  readResponseFromFieldset,
  bindQuestionFieldset
} from "./quiz-question-types.mjs";
import { renderDailyQuizReviewHtml, drawMatchReviewLines } from "./quiz-review.mjs";
import { getLastTrackerRequestId, renderDailyQuizSection } from "./plan.js";

function quizPublisherLabel(role) {
  return ({
    admin: "系統管理員",
    pastor: "牧者",
    great_zone_leader: "大區長",
    zone_leader: "區長",
    group_leader: "小組長"
  })[role] || "管理者";
}

// 已經讀完一遍（第一遍全部打卡，或已進入第 2 遍以後）就不再檢查當天進度，
// 每次小測驗都可以直接作答；判斷方式跟 memberIsCompletedOnce 同一套。
function hasCompletedDailyQuizFirstRound(plan) {
  return Boolean(plan?.isPlanCompleted) || Number(plan?.currentRound || 1) > 1;
}

function getDailyQuizReadingProgress(plan, quizDate) {
  const round = Number(plan?.currentRound || 1);
  if (hasCompletedDailyQuizFirstRound(plan)) {
    return { total: 0, completed: 0, remaining: 0, isComplete: true, firstRoundCompleted: true };
  }
  const day = Array.isArray(plan?.days)
    ? plan.days.find(item => String(item?.isoDate || "") === String(quizDate || ""))
    : null;
  const chapters = Array.isArray(day?.chapters)
    ? day.chapters.filter(chapter => Number(chapter?.round || round) === round)
    : [];
  const completed = chapters.filter(chapter => Boolean(chapter?.[`isReadR${round}`] || chapter?.isRead)).length;
  return {
    total: chapters.length,
    completed,
    remaining: Math.max(0, chapters.length - completed),
    isComplete: chapters.length > 0 && completed === chapters.length
  };
}

// #643：今天的測驗（myQuiz）之外，還在作答期間的補發（makeupQuizzes）也各畫一份。
// 每一份都是 { quiz, quizDate, makeup, ids }；quizDate 是那份測驗原本的日期（進度檢查、選項順序都照它）。
// 只有一份時 id 和以前一樣；多份時第 2 份起加後綴，同一頁不會有重複的 id。
function dailyQuizIds(index) {
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return {
    entryButton: `daily-quiz-entry-button${suffix}`,
    entryDescription: `daily-quiz-entry-description${suffix}`,
    title: `daily-quiz-title${suffix}`,
    form: `daily-quiz-form${suffix}`
  };
}

function dailyQuizItems(context, quizDate) {
  const items = [];
  if (context.myQuiz) items.push({ quiz: context.myQuiz, quizDate, makeup: false });
  (Array.isArray(context.makeupQuizzes) ? context.makeupQuizzes : []).forEach(quiz => {
    if (quiz?.publicationId) items.push({ quiz, quizDate: String(quiz.quizDate || ""), makeup: true });
  });
  return items.map((item, index) => ({ ...item, ids: dailyQuizIds(index) }));
}

function dailyQuizDateLabel(iso) {
  const [, month, day] = String(iso || "").split("-").map(Number);
  return month && day ? `${month}/${day}` : String(iso || "");
}

function dailyQuizName(item) {
  return item.makeup ? `補發：${dailyQuizDateLabel(item.quizDate)} 小測驗` : "小測驗";
}

function dailyQuizDayWord(item) {
  return item.makeup ? dailyQuizDateLabel(item.quizDate) : "今天";
}

function openDailyQuizContent(host, item, plan, sectionDate) {
  renderAssignedDailyQuiz(host, item, plan, sectionDate);
  if (typeof hydrateIcons === "function") hydrateIcons(host);
}

// 發佈／編輯／匯入題目已搬去系統管理後台（admin.js 的「小測驗」分頁），
// 打卡清單這裡只保留會友「進入小測驗/作答」的入口，所以只在有指派給自己
// 的測驗時才會被呼叫——見 renderDailyQuizSection 的 gate。
function formatDailyQuizTaiwanClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false
    });
  } catch {
    return "";
  }
}

function isDailyQuizClosed(quiz) {
  return Boolean(quiz.answerCloseAt) && new Date(quiz.answerCloseAt).getTime() < Date.now();
}

function renderDailyQuizEntry(host, item, plan, sectionDate) {
  const assignedQuiz = item.quiz;
  const ids = item.ids;
  const dayWord = dailyQuizDayWord(item);
  const isCompleted = Boolean(assignedQuiz.attempt);
  // answerCloseAt（migration 0189）是作答截止時間；00:00 自動發佈是當天 23:59，補發是補發當天 23:59。
  const isClosed = !isCompleted && isDailyQuizClosed(assignedQuiz);
  const buttonLabel = isCompleted ? "查看測驗結果" : isClosed ? "作答已截止" : "進入小測驗";
  const description = isCompleted
    ? `${dayWord}的小測驗已完成，可查看答案與解說`
    : isClosed
      ? `作答時間已於 ${formatDailyQuizTaiwanClock(assignedQuiz.answerCloseAt)} 截止`
      : hasCompletedDailyQuizFirstRound(plan)
        ? "你已讀完一遍，可以直接作答"
        : `完成${dayWord}的速讀進度後即可作答`;

  host.innerHTML = `
    <button type="button" class="daily-quiz-entry-button" id="${ids.entryButton}" aria-describedby="${ids.entryDescription}" ${isClosed ? "disabled" : ""}>
      <span class="daily-quiz-entry-icon" aria-hidden="true"><span class="nlc-icon" data-icon="checkOne"></span></span>
      <span class="daily-quiz-entry-copy">
        <strong>${dailyQuizName(item)}</strong>
        <small id="${ids.entryDescription}">${description}</small>
      </span>
      <span class="daily-quiz-entry-action">${buttonLabel}<span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
    </button>`;

  if (isClosed) return;

  host.querySelector(`#${ids.entryButton}`)?.addEventListener("click", () => {
    if (!isCompleted) {
      const progress = getDailyQuizReadingProgress(plan, item.quizDate);
      if (!progress.isComplete) {
        const message = progress.total > 0
          ? `請先閱讀完${dayWord}的速讀進度，再進入小測驗（尚有 ${progress.remaining} 章）。`
          : `請先完成${dayWord}的速讀進度，再進入小測驗。`;
        if (typeof showToast === "function") showToast(message);
        return;
      }
    }
    openDailyQuizContent(host, item, plan, sectionDate);
  });
}

function dailyQuizEyebrow(item) {
  return item.makeup ? dailyQuizName(item) : "今日小測驗";
}

function renderCompletedDailyQuiz(host, item) {
  const quiz = item.quiz;
  const attempt = quiz.attempt;
  const questions = (quiz.questions || []).map(normalizeQuestion);
  host.innerHTML = `
    <div class="daily-quiz-heading">
      <div><p class="daily-quiz-eyebrow">${dailyQuizEyebrow(item)}</p><h3 id="${item.ids.title}">完成作答</h3></div>
      <span class="daily-quiz-score">${Number(attempt.score ?? 0)}／${Number(attempt.total ?? questions.length)}</span>
    </div>
    ${renderDailyQuizReviewHtml(attempt, questions)}`;
  drawMatchReviewLines(host);
}

// 逐題送出＋最後結算，取代整份一次送出：每題一填完就各自小寫入一次
// （daily_quiz_submit_answer 設計成同一題重送會覆蓋、可安全重複執行），
// 「送出答案」按下去時再把每題目前的作答值保險地全部重送一次
// （排除競態/漏送風險），確認每題都成功後才呼叫 finalize 結算分數——
// 全程沒有「整份題目一次送出」這個動作，結構上排除大 payload 被截斷的風險。
function bindDailyQuizAnswering(host, item, questions, plan, sectionDate) {
  const quiz = item.quiz;
  const form = host.querySelector(`#${item.ids.form}`);
  if (!form) return;

  const fieldsetsByQuestionId = new Map(
    Array.from(form.querySelectorAll("[data-question-id]")).map(el => [el.getAttribute("data-question-id"), el])
  );
  const responses = new Map();
  const timings = new Map();
  let lastAnsweredAt = Date.now();

  questions.forEach(question => {
    const fieldset = fieldsetsByQuestionId.get(question.id);
    if (!fieldset) return;
    bindQuestionFieldset(fieldset, question.type, response => {
      responses.set(question.id, response);
      if (!isResponseComplete(question.type, response, question.payload)) return;
      if (!timings.has(question.id)) {
        const now = Date.now();
        timings.set(question.id, Math.max(0, Math.round((now - lastAnsweredAt) / 1000)));
        lastAnsweredAt = now;
      }
      void db.submitDailyQuizAnswer(quiz.publicationId, question.id, response, timings.get(question.id));
    });
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const incomplete = questions.some(question => {
      const response = readResponseFromFieldset(fieldsetsByQuestionId.get(question.id), question.type);
      responses.set(question.id, response);
      return !isResponseComplete(question.type, response, question.payload);
    });
    if (incomplete) {
      if (typeof showToast === "function") showToast(`請完成全部 ${questions.length} 題後再送出`);
      return;
    }
    const button = form.querySelector("button[type='submit']");
    const originalLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "送出中…"; }

    const submissions = await Promise.all(questions.map(question =>
      db.submitDailyQuizAnswer(quiz.publicationId, question.id, responses.get(question.id), timings.get(question.id) ?? null)
    ));
    const failed = submissions.find(result => !result.success);
    if (failed) {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
      if (typeof showToast === "function") showToast(failed.message || "小測驗送出失敗");
      return;
    }

    const result = await db.finalizeDailyQuizAttempt(quiz.publicationId);
    if (!result.success) {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
      if (typeof showToast === "function") showToast(result.message || "小測驗送出失敗");
      return;
    }
    // 離線時 db.finalizeDailyQuizAttempt 被 PwaCoordinator 攔截排進佇列，
    // 回傳 success:true 但沒有 data.score（伺服器還沒真的結算）。這裡先不要
    // 當作已完成重繪（伺服器端狀態其實還是 in_progress），恢復連線後佇列會
    // 自動送出，屆時再重新整理就能看到真正的分數。
    if (result.queued) {
      if (button) button.textContent = "已離線儲存，待連線後自動送出";
      if (typeof showToast === "function") showToast("目前離線，答案已安全儲存，恢復連線後會自動送出並計算成績。");
      return;
    }
    if (typeof showToast === "function") showToast(`作答完成：${result.data.score}／${result.data.total}`);
    // 重畫的是「今天」這一區（補發也顯示在今天），並展開剛交卷的這一份
    void renderDailyQuizSection(plan, { isoDate: sectionDate }, getLastTrackerRequestId(), { open: true, openPublicationId: quiz.publicationId });
  });
}

function renderAssignedDailyQuiz(host, item, plan, sectionDate) {
  const quiz = item.quiz;
  if (quiz.attempt) {
    renderCompletedDailyQuiz(host, item);
    return;
  }
  const questions = (quiz.questions || []).map(normalizeQuestion);
  // 同一位會友同一天重畫時選項順序不變（自訂題 id 如 c1 每天重複，所以帶計畫＋日期）。
  const shuffleSeed = `${state.currentUser?.id || ""}:${plan?.id || ""}:${item.quizDate}`;
  host.innerHTML = `
    <div class="daily-quiz-heading">
      <div><p class="daily-quiz-eyebrow">${dailyQuizEyebrow(item)}</p><h3 id="${item.ids.title}">${questions.length} 題</h3></div>
      <span class="daily-quiz-status">已由${quizPublisherLabel(quiz.publisherRole)}發佈</span>
    </div>
    <form id="${item.ids.form}" class="daily-quiz-form">
      ${questions.map((question, index) => renderQuestionFieldsetHtml(question, index, { shuffleSeed })).join("")}
      <button type="submit" class="primary-btn daily-quiz-submit">送出答案</button>
    </form>`;
  bindDailyQuizAnswering(host, item, questions, plan, sectionDate);
}

// options.open：直接展開（交卷後重畫時用）；有 openPublicationId 就只展開那一份，否則展開第一份。
// 還沒讀完那天的進度、或已截止的，照樣只畫入口。
function renderDailyQuizItem(host, item, plan, sectionDate, options, isFirst) {
  const wantsOpen = options.open === true
    && (options.openPublicationId ? options.openPublicationId === item.quiz.publicationId : isFirst);
  if (!wantsOpen) {
    renderDailyQuizEntry(host, item, plan, sectionDate);
    return;
  }
  if (!item.quiz.attempt) {
    const progress = getDailyQuizReadingProgress(plan, item.quizDate);
    if (!progress.isComplete || isDailyQuizClosed(item.quiz)) {
      renderDailyQuizEntry(host, item, plan, sectionDate);
      return;
    }
  }
  openDailyQuizContent(host, item, plan, sectionDate);
}

// plan.js 已經把 section 顯示出來、確認至少有一份指派給自己的測驗，這裡只負責畫入口或題目。
export function showDailyQuiz(section, content, context, plan, quizDate, options = {}) {
  const items = dailyQuizItems(context, quizDate);
  if (items.length <= 1) {
    if (items[0]) renderDailyQuizItem(content, items[0], plan, quizDate, options, true);
  } else {
    content.innerHTML = items.map((_, index) => `<div class="daily-quiz-item" data-daily-quiz-item="${index}"></div>`).join("");
    items.forEach((item, index) => {
      renderDailyQuizItem(content.querySelector(`[data-daily-quiz-item="${index}"]`), item, plan, quizDate, options, index === 0);
    });
  }
  if (typeof hydrateIcons === "function") hydrateIcons(section);
}
