// 個人計畫（#473）：使用者自己建立、只屬於自己的讀經計畫。
//
// 存在 reading_plans（is_personal = true，global_plan_id 與 preset_key 都空），
// 不算進排行榜、團隊、教會統計。規則的真正把關在伺服器觸發器
// enforce_personal_plan_rules（migration 20261010153702）；這裡只是提早擋、給對的提示。
//   · 每人最多 5 個「進行中」（end_date ≥ 台北今天）的個人計畫，已結束的不算。
//   · 開始打卡後，書卷與日期鎖住；改名不受限。

export const PERSONAL_PLAN_LIMIT = 5;
export const PERSONAL_PLAN_NAME_MAX = 40;
export const PERSONAL_PLAN_MAX_DAYS = 3650;

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function taipeiTodayISO(date = new Date()) {
  return taipeiDateFormatter.format(date);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayCount(startKey, endKey) {
  const toUtc = key => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(endKey) - toUtc(startKey)) / 86400000) + 1;
}

export function isPersonalPlan(plan) {
  return Boolean(plan) && (plan.isPersonal === true || plan.is_personal === true);
}

function planEndDate(plan) {
  return String(plan && (plan.endDate || plan.end_date) || "").slice(0, 10);
}

// 進行中＝結束日還沒過（台北時間）。跟觸發器同一條規則。
export function isActivePersonalPlan(plan, todayISO = taipeiTodayISO()) {
  if (!isPersonalPlan(plan)) return false;
  const end = planEndDate(plan);
  return isDateKey(end) && end >= todayISO;
}

export function countActivePersonalPlans(plans, todayISO = taipeiTodayISO()) {
  return (Array.isArray(plans) ? plans : []).filter(plan => isActivePersonalPlan(plan, todayISO)).length;
}

export function canCreatePersonalPlan(plans, todayISO = taipeiTodayISO()) {
  return countActivePersonalPlans(plans, todayISO) < PERSONAL_PLAN_LIMIT;
}

export function normalizePersonalPlanName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

// 表單輸入 → reading_plans 欄位。
// 固定日期：起訖日；非固定：從今天（台北）起算 durationDays 天，跟教會彈性計畫加入時一樣。
// 回傳 { ok: true, fields } 或 { ok: false, message }。
export function validatePersonalPlanName(value) {
  const name = normalizePersonalPlanName(value);
  if (!name) return "請輸入計畫名稱。";
  if (name.length > PERSONAL_PLAN_NAME_MAX) return `計畫名稱最多 ${PERSONAL_PLAN_NAME_MAX} 個字。`;
  return "";
}

export function buildPersonalPlanFields(input = {}, todayISO = taipeiTodayISO()) {
  const nameError = validatePersonalPlanName(input.name);
  if (nameError) return { ok: false, message: nameError };
  const name = normalizePersonalPlanName(input.name);

  const books = [...new Set((Array.isArray(input.books) ? input.books : []).map(String).filter(Boolean))];
  if (books.length === 0) return { ok: false, message: "請至少選一卷書。" };

  const isFixed = input.isFixed !== false;
  let startDate;
  let endDate;
  if (isFixed) {
    startDate = String(input.startDate || "").slice(0, 10);
    endDate = String(input.endDate || "").slice(0, 10);
    if (!isDateKey(startDate) || !isDateKey(endDate)) return { ok: false, message: "請選擇開始與結束日期。" };
    if (startDate > endDate) return { ok: false, message: "開始日期不能晚於結束日期。" };
    if (endDate < todayISO) return { ok: false, message: "結束日期不能早於今天。" };
    if (dayCount(startDate, endDate) > PERSONAL_PLAN_MAX_DAYS) return { ok: false, message: "計畫最長 10 年。" };
  } else {
    const days = Math.floor(Number(input.durationDays));
    if (!Number.isFinite(days) || days <= 0) return { ok: false, message: "請輸入有效的計畫天數。" };
    if (days > PERSONAL_PLAN_MAX_DAYS) return { ok: false, message: `計畫天數最多 ${PERSONAL_PLAN_MAX_DAYS} 天。` };
    startDate = String(input.startDate || todayISO).slice(0, 10);
    if (!isDateKey(startDate)) startDate = todayISO;
    endDate = addDays(startDate, days - 1);
  }

  return {
    ok: true,
    fields: {
      name,
      start_date: startDate,
      end_date: endDate,
      target_books: books,
      is_fixed: isFixed
    }
  };
}

// 新增時寫進 reading_plans 的整列。user_id 正式站由 nlc-data 強制成呼叫者。
export function buildPersonalPlanInsert(userId, fields) {
  return {
    user_id: userId,
    ...fields,
    is_personal: true,
    global_plan_id: null,
    preset_key: null,
    current_round: 1,
    upgrade_prompt_handled: false,
    reading_days_per_week: 7,
    rest_weekdays: []
  };
}

export function personalPlanErrorMessage(error, fallback = "儲存個人計畫失敗，請稍後再試。") {
  const raw = String(error && (error.message || error.error || error.details || error.hint) || error || "");
  if (raw.includes("personal_plan_limit_reached")) {
    return `每人最多 ${PERSONAL_PLAN_LIMIT} 個進行中的個人計畫，等其中一個結束或刪除後再新增。`;
  }
  if (raw.includes("personal_plan_locked_after_first_log")) {
    return "這個計畫已經開始打卡，書卷與日期不能再改；名稱仍可修改。";
  }
  return fallback;
}
