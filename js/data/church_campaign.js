// 教會長期讀經活動的定義與排程：本體在 supabase/functions/_shared/progress/church-campaign.mjs（#564，
// 伺服器和會友 App 共用同一份），這裡只掛到 window 給舊程式用；書卷表預設照舊用 window.BIBLE_BOOKS。
import {
  CHURCH_CAMPAIGN,
  CHURCH_CAMPAIGN_ID,
  CHURCH_CAMPAIGN_PRESET_KEY,
  FIRST_ROUND_FINAL_BOOK_BADGE_IDS,
  buildChurchCampaignDays as buildCampaignDays,
  cloneChurchCampaign,
  createChurchCampaignStageDefinitions,
  getChurchCampaignStageDefinition,
  getChurchCampaignStageId,
  getChurchCampaignStagePresetKey,
  getChurchCampaignTeamStatus,
  validateChurchCampaign as validateCampaign
} from "../../supabase/functions/_shared/progress/church-campaign.mjs";

function validateChurchCampaign(definition, bibleBooks = window.BIBLE_BOOKS || []) {
  return validateCampaign(definition, bibleBooks);
}

function buildChurchCampaignDays(definition, bibleBooks = window.BIBLE_BOOKS || [], restWeekdays = []) {
  return buildCampaignDays(definition, bibleBooks, restWeekdays);
}

window.CHURCH_CAMPAIGN_ID = CHURCH_CAMPAIGN_ID;
window.CHURCH_CAMPAIGN_PRESET_KEY = CHURCH_CAMPAIGN_PRESET_KEY;
window.CHURCH_CAMPAIGN = CHURCH_CAMPAIGN;
window.getChurchCampaignStageId = getChurchCampaignStageId;
window.getChurchCampaignStagePresetKey = getChurchCampaignStagePresetKey;
window.createChurchCampaignStageDefinitions = createChurchCampaignStageDefinitions;
window.FIRST_ROUND_FINAL_BOOK_BADGE_IDS = FIRST_ROUND_FINAL_BOOK_BADGE_IDS;
// 另外掛一份：window.CHURCH_CAMPAIGN 可能被管理員存的舊版規則（沒有這個欄位）整個換掉。
window.FIRST_ROUND_FINAL_COHORTS = cloneChurchCampaign(CHURCH_CAMPAIGN.firstRoundFinalCohorts || []);
window.getChurchCampaignStageDefinition = getChurchCampaignStageDefinition;
window.cloneChurchCampaign = cloneChurchCampaign;
window.validateChurchCampaign = validateChurchCampaign;
window.buildChurchCampaignDays = buildChurchCampaignDays;
window.getChurchCampaignTeamStatus = getChurchCampaignTeamStatus;

// ── 進度比對的「教會原始日程」──────────────────────────────────────────────
// 「落後 / 超前 / 補讀」的唯一比對尺：該階段書卷 ÷ 起訖天數、平均鋪、每週七日。
// 不套使用者的 level、也不套使用者個人的休息日（第 3 參數固定傳 []）。
// 非教會 campaign 的計畫沒有 campaignDefinition → 退回 plan.days（原則只規範教會階段）。
const _canonicalStageScheduleCache = new Map();
function getCanonicalStageScheduleDays(plan) {
  if (!plan) return [];
  const def = plan.campaignDefinition;
  if (!def) return Array.isArray(plan.days) ? plan.days : [];
  const key = String(def.id || def.presetKey || plan.presetKey || plan.globalPlanId || plan.id || "")
    + "|" + String(def.startDate || plan.startDate || "")
    + "|" + String(def.endDate || plan.endDate || "");
  const cached = _canonicalStageScheduleCache.get(key);
  if (cached) return cached;
  let built = null;
  try {
    built = buildChurchCampaignDays(def, window.BIBLE_BOOKS || [], []);
  } catch (error) {
    console.warn("getCanonicalStageScheduleDays: build failed, using plan.days", error);
  }
  if (!Array.isArray(built) || !built.length) {
    built = Array.isArray(plan.days) ? plan.days : [];
  }
  if (key !== "||") _canonicalStageScheduleCache.set(key, built);
  return built;
}
window.getCanonicalStageScheduleDays = getCanonicalStageScheduleDays;

