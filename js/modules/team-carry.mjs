// 月初帶隊（#678）：狀態快取、帶隊／接手／補帶／加入的流程、首頁和計畫卡片共用的卡片。
// 文字與判斷在 team-carry-model.mjs；這裡才碰 db、DOM 和全域的對話框。
import {
  buildCaptainReminderMessage,
  buildCarryConfirmMessage,
  carryEntriesForPlan,
  describeTeamCarryEntry,
  teamCarryEntryKey
} from "./team-carry-model.mjs";
import { isCampaignStageKind } from "../data/campaign-stage-kinds.mjs";

// ── 狀態：所有入口讀同一份 ──────────────────────────────────────────────────
// 首頁、每張計畫卡片、詳細頁都讀這裡，不會各打一次。
// 查過沒有帶隊的事（絕大多數人）就記到當天結束，之後開機不再多一支請求；
// 本機做了任何團隊異動，db.js 發 reading-team:changed，這兩層都會清掉。
const STATUS_FRESH_MS = 60000;
const HOME_CARD_LIMIT = 3;
const EMPTY_STATUS_STORAGE_KEY = "team-carry-status-empty";
const DISMISSED_STORAGE_KEY = "team-carry-dismissed";

let statusCache = null;

function currentProfileId() {
  return String(state.currentProfileId || (state.currentUser && state.currentUser.id) || "");
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

// 開放的階段計畫變了（管理員開放新的一個月）就要重查。
function openStageSignature() {
  return (state.globalPlans || [])
    .filter(plan => plan && isCampaignStageKind(plan) && !plan.isHidden && !plan.is_hidden)
    .map(plan => String(plan.globalPlanId || plan.id))
    .sort()
    .join(",");
}

function readStorage(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch (_) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // 私密瀏覽或儲存空間滿了：沒記到只是多查一次。
  }
}

function emptyStatusIsRemembered() {
  const remembered = readStorage(EMPTY_STATUS_STORAGE_KEY);
  return Boolean(remembered
    && remembered.profile === currentProfileId()
    && remembered.day === taipeiToday()
    && remembered.stages === openStageSignature());
}

export function invalidateTeamCarryStatus() {
  statusCache = null;
  writeStorage(EMPTY_STATUS_STORAGE_KEY, null);
}

if (typeof window !== "undefined") {
  window.addEventListener("reading-team:changed", invalidateTeamCarryStatus);
}

export function getTeamCarryEntries() {
  if (!state.isSupabaseMode || !state.supabase || typeof db.getReadingTeamCarryStatus !== "function") {
    return Promise.resolve([]);
  }
  const profile = currentProfileId();
  if (statusCache && statusCache.profile === profile
    && (statusCache.pending || Date.now() - statusCache.at < STATUS_FRESH_MS)) {
    return statusCache.promise;
  }
  if (emptyStatusIsRemembered()) return Promise.resolve([]);

  const entry = { profile, pending: true, at: 0, promise: null };
  entry.promise = Promise.resolve()
    .then(() => db.getReadingTeamCarryStatus())
    .then(result => {
      entry.pending = false;
      entry.at = Date.now();
      if (!result || !result.success) {
        // 查不到只能當成沒有卡片，但要留紀錄：#659 就是報錯被當成沒資格，好幾天沒人發現。
        console.warn("[team-carry] status failed:", result && (result.error || result.message));
        if (statusCache === entry) statusCache = null;
        return [];
      }
      const teams = Array.isArray(result.context && result.context.teams) ? result.context.teams : [];
      if (!teams.length) {
        writeStorage(EMPTY_STATUS_STORAGE_KEY, { profile, day: taipeiToday(), stages: openStageSignature() });
      }
      return teams;
    }, error => {
      console.warn("[team-carry] status failed:", error);
      if (statusCache === entry) statusCache = null;
      return [];
    });
  statusCache = entry;
  return entry.promise;
}

export async function getPlanCarryEntries(plan) {
  const planId = typeof db._readingTeamPlanId === "function" ? db._readingTeamPlanId(plan) : null;
  if (!planId) return [];
  return carryEntriesForPlan(await getTeamCarryEntries(), planId);
}

// ── 流程：成功都回 true，呼叫端決定要不要重新載入 ─────────────────────────────
const planOf = entry => ({
  id: entry.targetPlanId,
  globalPlanId: entry.targetPlanId,
  name: entry.targetPlanName
});

const isDuplicateName = result =>
  String(result && result.error && (result.error.message || result.error.error) || result && result.error || "")
    .includes("duplicate_team_name");

async function askNewTeamName(currentName) {
  const value = await window.showPromptDialog({
    title: "隊名已經有人用了",
    message: `「${currentName || ""}」這個隊名在這個計畫已經有人用了，請換一個隊名再帶隊。`,
    defaultValue: currentName || "",
    placeholder: "請輸入團隊名稱",
    confirmText: "用這個隊名",
    cancelText: "取消"
  });
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) {
    alert("團隊名稱不可為空白。");
    return null;
  }
  return trimmed;
}

async function joinCarriedTeam(plan, sourceTeamId, teamName) {
  loader.show("正在加入隊伍…");
  const result = await db.joinCarriedReadingTeam(plan, sourceTeamId);
  loader.hide();
  if (!result.success) {
    alert(result.message || "加入隊伍失敗，請稍後再試。");
    return false;
  }
  alert(`已加入「${(result.data && result.data.name) || teamName || ""}」。`);
  return true;
}

// 隊伍已經被帶入：不能再說帶隊成功。在隊上就說在隊上，有空位就問要不要加入。
async function handleAlreadyCarried(plan, sourceTeamId, team) {
  const planName = plan.name || "這個計畫";
  const teamName = team.name || "";
  if (team.actorIsMember) {
    alert(`你已經在「${teamName}」隊上了。`);
    return true;
  }
  const carriedBy = team.carriedByName || "隊友";
  if (!team.hasVacancy) {
    alert(`「${teamName}」已由${carriedBy}帶入「${planName}」，隊伍已額滿。`);
    return false;
  }
  const confirmed = await window.showConfirmDialog({
    title: `隊伍已由${carriedBy}帶入`,
    message: `「${teamName}」已由${carriedBy}帶入「${planName}」，還有空位。要加入這支隊伍嗎？`,
    confirmText: "加入隊伍",
    cancelText: "先不要"
  });
  if (!confirmed) return false;
  return joinCarriedTeam(plan, sourceTeamId, teamName);
}

// 帶一支隊伍進這張計畫，並告訴隊長結果（誰被略過、為什麼）。
export async function carryTeamIntoPlan(plan, sourceTeam, teamName = null) {
  const planName = plan.name || "這個計畫";
  loader.show("正在帶隊伍加入…");
  const result = await db.carryReadingTeamsToStage(plan, sourceTeam.division, teamName);
  loader.hide();
  if (!result.success) {
    alert(result.message || "帶隊失敗，請稍後再試。");
    return false;
  }
  const data = result.data || {};
  const division = Number(sourceTeam.division);
  const skippedTeam = (data.skippedTeams || []).find(item => Number(item.division) === division);
  const carriedTeam = (data.teams || []).find(item => Number(item.division) === division);
  if (skippedTeam && skippedTeam.reason === "duplicate_team_name") {
    const newName = await askNewTeamName(skippedTeam.name || sourceTeam.name);
    return newName ? carryTeamIntoPlan(plan, sourceTeam, newName) : false;
  }
  if (carriedTeam && carriedTeam.alreadyCarried) {
    return handleAlreadyCarried(plan, sourceTeam.sourceTeamId, carriedTeam);
  }
  const { captainBlocked, memberNotes } = db.describeReadingTeamCarryoverSkips({
    skippedTeam,
    skippedMembers: carriedTeam && carriedTeam.skippedMembers,
    targetName: planName
  });
  if (captainBlocked || !carriedTeam) {
    alert(captainBlocked || "帶隊失敗，請稍後再試。");
    return false;
  }
  alert([`已將「${carriedTeam.name || sourceTeam.name || ""}」帶入「${planName}」。`, ...memberNotes].join("\n"));
  return true;
}

// 先確認再帶隊；團隊視窗、計畫卡片、詳細頁、首頁共用。
export async function carryTeamWithConfirm(plan, team) {
  const confirmed = await window.showConfirmDialog({
    title: "帶隊伍一起加入",
    message: buildCarryConfirmMessage({ ...team, targetPlanName: plan.name }, "carry"),
    confirmText: "帶隊加入",
    cancelText: "取消"
  });
  if (!confirmed) return false;
  return carryTeamIntoPlan(plan, team);
}

async function takeOverTeam(entry, teamName = null) {
  const plan = planOf(entry);
  loader.show("正在帶隊伍加入…");
  const result = await db.takeOverReadingTeamCarry(plan, entry.sourceTeamId, teamName);
  loader.hide();
  if (!result.success) {
    if (isDuplicateName(result)) {
      const newName = await askNewTeamName(teamName || entry.name);
      return newName ? takeOverTeam(entry, newName) : false;
    }
    alert(result.message || "接手帶隊失敗，請稍後再試。");
    return false;
  }
  const team = ((result.data && result.data.teams) || [])[0];
  if (!team) {
    alert("接手帶隊失敗，請稍後再試。");
    return false;
  }
  if (team.alreadyCarried) return handleAlreadyCarried(plan, entry.sourceTeamId, team);
  const { memberNotes } = db.describeReadingTeamCarryoverSkips({
    skippedMembers: team.skippedMembers,
    targetName: plan.name
  });
  alert([`已帶「${team.name || entry.name || ""}」加入「${plan.name || "這個計畫"}」，你是新隊長。`, ...memberNotes].join("\n"));
  return true;
}

async function takeOverTeamWithConfirm(entry) {
  const confirmed = await window.showConfirmDialog({
    title: "由我帶隊加入",
    message: buildCarryConfirmMessage(entry, "takeover"),
    confirmText: "由我帶隊加入",
    cancelText: "取消"
  });
  return confirmed ? takeOverTeam(entry) : false;
}

async function backfillTeamWithConfirm(entry) {
  const confirmed = await window.showConfirmDialog({
    title: "補帶上月隊員",
    message: buildCarryConfirmMessage(entry, "backfill"),
    confirmText: "補帶隊員",
    cancelText: "取消"
  });
  if (!confirmed) return false;
  const plan = planOf(entry);
  loader.show("正在補帶隊員…");
  const result = await db.backfillReadingTeamFromSource(plan, entry.sourceTeamId);
  loader.hide();
  if (!result.success) {
    alert(result.message || "補帶失敗，請稍後再試。");
    return false;
  }
  const data = result.data || {};
  const { memberNotes } = db.describeReadingTeamCarryoverSkips({
    skippedMembers: data.skippedMembers,
    targetName: plan.name
  });
  alert([`已把 ${Number(data.addedCount || 0)} 位隊員補進「${data.name || entry.ownTeamName || ""}」。`, ...memberNotes].join("\n"));
  return true;
}

async function remindCaptain(entry) {
  const { error } = await db.sendReadingTeamReminder({
    teamId: entry.sourceTeamId,
    recipientId: entry.captainId,
    globalPlanId: entry.sourcePlanId,
    reason: "care",
    message: buildCaptainReminderMessage(entry)
  });
  // 今天傳過也算完成（可能是另一台裝置傳的），按鈕一樣變成「今天已提醒」。
  const alreadySent = Boolean(error && /今天已提醒/.test(String(error.message)));
  if (error && !alreadySent) {
    showToast(error.message || "提醒傳送失敗，請稍後再試。", "error");
    return false;
  }
  showToast(alreadySent ? "今天已提醒過隊長。" : "已提醒隊長。", "success");
  return true;
}

// ── 卡片 ──────────────────────────────────────────────────────────────────
function renderCard(entry, { dismissible }) {
  const model = describeTeamCarryEntry(entry);
  if (!model) return "";
  const key = escapeHTML(teamCarryEntryKey(entry));
  return `
    <article class="team-carry-card team-carry-card--${escapeHTML(entry.state)}" data-team-carry-entry="${key}">
      <span class="team-carry-card__media" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(model.icon)}"></span></span>
      <div class="team-carry-card__body">
        <p class="team-carry-card__title">${escapeHTML(model.title)}</p>
        ${model.description ? `<p class="team-carry-card__description">${escapeHTML(model.description)}</p>` : ""}
        ${model.hint ? `<p class="team-carry-card__hint">${escapeHTML(model.hint)}</p>` : ""}
        ${model.actions.length ? `<div class="team-carry-card__actions">${model.actions.map(action => `
          <button type="button" class="${action.primary ? "primary-btn" : "secondary-btn"} team-carry-card__btn" data-team-carry-action="${escapeHTML(action.kind)}"${action.disabled ? " disabled" : ""}>${escapeHTML(action.label)}</button>`).join("")}</div>` : ""}
      </div>
      ${dismissible ? `<button type="button" class="team-carry-card__dismiss icon-button icon-button--subtle" data-team-carry-dismiss aria-label="關閉這張提醒"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>` : ""}
    </article>`;
}

async function runAction(kind, entry) {
  if (kind === "carry") return carryTeamWithConfirm(planOf(entry), entry);
  if (kind === "takeover") return takeOverTeamWithConfirm(entry);
  if (kind === "backfill") return backfillTeamWithConfirm(entry);
  if (kind === "join") return joinCarriedTeam(planOf(entry), entry.sourceTeamId, entry.carriedTeamName);
  return false;
}

// 在 container 裡畫卡片。onDone：帶隊、接手、補帶、加入成功之後做什麼，預設重新載入
//（隊員、團隊分頁、計畫卡片都要換掉，最單純，同探索頁帶隊加入）。
export function renderTeamCarryCards(container, entries, options = {}) {
  if (!container) return;
  const { dismissible = false, onDone = () => window.location.reload(), onDismiss = null } = options;
  const list = Array.isArray(entries) ? entries : [];
  container.innerHTML = list.map(entry => renderCard(entry, { dismissible })).join("");
  container.querySelectorAll("[data-team-carry-entry]").forEach(card => {
    const entry = list.find(item => teamCarryEntryKey(item) === card.dataset.teamCarryEntry);
    if (!entry) return;
    card.querySelectorAll("[data-team-carry-action]").forEach(button => {
      button.addEventListener("click", async event => {
        // 計畫卡片整張都能點，按鈕不能順便把人帶進計畫。
        event.preventDefault();
        event.stopPropagation();
        const kind = button.dataset.teamCarryAction;
        button.disabled = true;
        if (kind === "remind") {
          if (await remindCaptain(entry)) {
            entry.reminderSentToday = true;
            renderTeamCarryCards(container, list, options);
          } else {
            button.disabled = false;
          }
          return;
        }
        if (await runAction(kind, entry)) {
          onDone();
          return;
        }
        button.disabled = false;
      });
    });
    card.querySelector("[data-team-carry-dismiss]")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onDismiss === "function") onDismiss(entry);
    });
  });
  if (typeof hydrateIcons === "function") hydrateIcons(container);
}

// ── 首頁 ──────────────────────────────────────────────────────────────────
// 不想帶隊的人（約 16% 的隊員下個月不會加入）可以關掉首頁這張，同一張不會再出現；計畫卡片上還看得到。
function dismissedKeys() {
  const stored = readStorage(`${DISMISSED_STORAGE_KEY}:${currentProfileId()}`);
  return Array.isArray(stored) ? stored : [];
}

function dismissEntry(entry) {
  writeStorage(`${DISMISSED_STORAGE_KEY}:${currentProfileId()}`, [...dismissedKeys(), teamCarryEntryKey(entry)]);
}

export async function refreshTeamCarryHomeCard() {
  const card = document.getElementById("team-carry-home-card");
  if (!card) return;
  const hide = () => {
    card.classList.add("hidden");
    card.innerHTML = "";
  };
  if (typeof auth === "undefined" || !auth.isLoggedIn()) return hide();

  const dismissed = new Set(dismissedKeys());
  const entries = (await getTeamCarryEntries())
    .filter(entry => !dismissed.has(teamCarryEntryKey(entry)))
    .slice(0, HOME_CARD_LIMIT);
  if (!entries.length) return hide();

  renderTeamCarryCards(card, entries, {
    dismissible: true,
    onDismiss: entry => {
      dismissEntry(entry);
      void refreshTeamCarryHomeCard();
    }
  });
  card.classList.remove("hidden");
}
