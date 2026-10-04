// js/modules/lightning-quiz-ranking.mjs
// 首頁「本週雲柱測驗前三名」卡片（#429）。管理員在後台週統計確認名次並公布後，
// get_lightning_quiz_week_ranking() 回傳最新一份還在公布期間的前三名（固定紀錄），
// 加上目前登入者自己這週每一題的結果。不顯示個人名次。
// 跟當天的作答卡片（lightning-quiz.mjs）是兩張獨立的卡，可以同時出現。

import {
  formatElapsedSeconds,
  formatRankLabel,
  formatWeekRange,
  formatWeekday,
  summarizeMyWeek
} from "./lightning-quiz-analytics.mjs";

// 「看題目與正解」帶去「我的測驗」的提示：開雲柱分頁，清單範圍往前延伸到這一週
// （公布期間可能已經超過「最近一週」）。profile.js 開「我的測驗」時讀一次就清掉。
export const PROFILE_EXAMS_HINT_KEY = "profileExamsHint";

const MY_RESULT_LABELS = {
  correct: "答對",
  wrong: "答錯",
  incomplete: "未完成",
  not_participated: "未作答"
};

function myResultHtml(mine) {
  const result = mine?.result || "not_participated";
  const label = MY_RESULT_LABELS[result] || MY_RESULT_LABELS.not_participated;
  const time = (result === "correct" || result === "wrong") && mine?.elapsedMs != null
    ? `・${escapeHTML(formatElapsedSeconds(mine.elapsedMs))} 秒`
    : "";
  return `<p class="lq-ranking__mine lq-ranking__mine--${escapeHTML(result)}">我的結果：<strong>${escapeHTML(label)}</strong>${time}</p>`;
}

function winnersHtml(winners) {
  if (!Array.isArray(winners) || !winners.length) {
    return '<p class="lq-ranking__empty">這天沒有人答對。</p>';
  }
  return `<ol class="lq-ranking__list">
    ${winners.map(winner => `<li class="lq-ranking__row">
      <span class="lq-ranking__rank">${escapeHTML(formatRankLabel(winner.rank))}</span>
      <span class="lq-ranking__name">${escapeHTML(winner.name || "")}</span>
      <span class="lq-ranking__zone">${escapeHTML(winner.pastoralZone || "")}</span>
      <span class="lq-ranking__time">${escapeHTML(formatElapsedSeconds(winner.elapsedMs))} 秒</span>
    </li>`).join("")}
  </ol>`;
}

export function renderRankingCardHtml(data) {
  const days = Array.isArray(data?.days) ? data.days : [];
  const mine = summarizeMyWeek(days);
  return `<div class="lq-ranking">
    <div class="lq-ranking__head">
      <span class="nlc-icon lq-ranking__icon" data-icon="trophy" aria-hidden="true"></span>
      <h3 class="card-title">雲柱測驗前三名</h3>
      <span class="lq-ranking__range">${escapeHTML(formatWeekRange(data?.weekStart))}</span>
    </div>
    <div class="lq-ranking__days">
      ${days.map(day => `<section class="lq-ranking__day" aria-label="${escapeHTML(formatWeekday(day.riseDate))}">
        <h4 class="lq-ranking__date">${escapeHTML(formatWeekday(day.riseDate))}</h4>
        ${winnersHtml(day.winners)}
        ${myResultHtml(day.mine)}
      </section>`).join("")}
    </div>
    <div class="lq-ranking__footer">
      <span>這週你答對 <strong>${escapeHTML(String(mine.correct))}／${escapeHTML(String(mine.total))}</strong> 題</span>
      <a href="#/profile/exams" class="lq-ranking__history" data-lq-ranking-history>看題目與正解</a>
    </div>
  </div>`;
}

let refreshInFlight = null;
let hideTimer = null;

// 公布期限一到自己收起（秒數由伺服器算）。沒給秒數就不排，避免 Number(null)＝0
// 變成每秒重查的迴圈（#402 的教訓）。
function scheduleHide(secondsUntilHide) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (secondsUntilHide === null || secondsUntilHide === undefined || secondsUntilHide === "") return;
  const seconds = Number(secondsUntilHide);
  if (!Number.isFinite(seconds) || seconds < 0) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    void refreshLightningQuizRankingCard();
  }, (seconds + 1) * 1000);
}

export async function refreshLightningQuizRankingCard() {
  const card = document.getElementById("lightning-quiz-ranking-card");
  const host = document.getElementById("lightning-quiz-ranking-host");
  if (!card || !host) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const result = typeof db !== "undefined" && typeof db.getLightningQuizWeekRanking === "function"
      ? await db.getLightningQuizWeekRanking()
      : { success: false };
    const data = result.success ? (result.data || {}) : { status: "none" };
    if (data.status !== "published" || !Array.isArray(data.days) || !data.days.length) {
      scheduleHide(null);
      card.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    host.innerHTML = renderRankingCardHtml(data);
    if (typeof hydrateIcons === "function") hydrateIcons(host);
    host.querySelector("[data-lq-ranking-history]")?.addEventListener("click", () => {
      try {
        window.sessionStorage.setItem(PROFILE_EXAMS_HINT_KEY, JSON.stringify({ tab: "lightning", from: data.weekStart }));
      } catch {
        // 無痕模式等存不進去：照樣開「我的測驗」，只是停在預設分頁。
      }
    });
    card.classList.remove("hidden");
    scheduleHide(data.secondsUntilHide);
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
