export const RETIRED_PLAN_PRESET_KEYS = Object.freeze(["q1", "q2", "q3", "q4"]);
export const RETIRED_GLOBAL_PLAN_IDS = Object.freeze([
  "00000000-0000-0000-c026-000000009999"
]);
export const RETIRED_PLAN_NAMES = Object.freeze([
  "測試讀書計畫",
  "測試讀經計畫",
  "團報測試計畫",
  "第一季速讀：2026年7月~9月",
  "第二季速讀：2026年10月~12月",
  "第三季速讀：2027年1月~3月",
  "第四季速讀：2027年4月~6月"
]);
export const RETIRED_BADGE_IDS = Object.freeze([
  "subscribe_plan",
  "streak_30",
  "complete_plan",
  "share_verse",
  "read_all_bible"
]);

const retiredPlanKeys = new Set([
  ...RETIRED_PLAN_PRESET_KEYS,
  ...RETIRED_GLOBAL_PLAN_IDS,
  ...RETIRED_PLAN_NAMES
]);
const retiredBadgeIds = new Set(RETIRED_BADGE_IDS);

function parseStoredArray(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isRetiredPlanReference(value) {
  return value != null && retiredPlanKeys.has(String(value));
}

export function isRetiredPlanRecord(record) {
  if (!record || typeof record !== "object") return false;
  return [
    record.id,
    record.plan_id,
    record.globalPlanId,
    record.global_plan_id,
    record.presetKey,
    record.preset_key,
    record.name
  ].some(isRetiredPlanReference);
}

export function cleanupProductionStorage(storage) {
  if (!storage) return { plans: 0, logs: 0, badges: 0 };

  const activePlans = parseStoredArray(storage, "active_reading_plans");
  const retiredLocalPlanIds = new Set(
    activePlans.filter(isRetiredPlanRecord).flatMap(plan => [
      plan.id,
      plan.globalPlanId,
      plan.global_plan_id,
      plan.presetKey,
      plan.preset_key,
      plan.name
    ]).filter(Boolean).map(String)
  );
  const shouldRemovePlanReference = value =>
    isRetiredPlanReference(value) || (value != null && retiredLocalPlanIds.has(String(value)));

  const keptPlans = activePlans.filter(plan => !isRetiredPlanRecord(plan));
  storage.setItem("active_reading_plans", JSON.stringify(keptPlans));

  const globalPlans = parseStoredArray(storage, "global_plans_presets");
  storage.setItem(
    "global_plans_presets",
    JSON.stringify(globalPlans.filter(plan => !isRetiredPlanRecord(plan)))
  );

  const readingLogs = parseStoredArray(storage, "reading_logs");
  const keptLogs = readingLogs.filter(log => ![
    log.plan_id,
    log.globalPlanId,
    log.global_plan_id,
    log.presetKey,
    log.preset_key,
    log.planName,
    log.name
  ].some(shouldRemovePlanReference));
  storage.setItem("reading_logs", JSON.stringify(keptLogs));

  if (shouldRemovePlanReference(storage.getItem("selected_plan_key"))) {
    storage.removeItem("selected_plan_key");
  }

  const unlockedBadges = parseStoredArray(storage, "unlocked_badges");
  const keptBadges = unlockedBadges.filter(id => !retiredBadgeIds.has(String(id)));
  storage.setItem("unlocked_badges", JSON.stringify(keptBadges));

  const keysToRemove = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const belongsToRetiredBadge = RETIRED_BADGE_IDS.some(id =>
      key === `${id}_unlocked`
      || key === `notified_${id}`
      || key.startsWith(`date_unlocked_${id}_lvl_`)
    );
    if (belongsToRetiredBadge) keysToRemove.push(key);
  }
  [
    "badge_share_verse_unlocked",
    "notified_badge-share",
    "has_shared_verse",
    "verse_share_count"
  ].forEach(key => keysToRemove.push(key));
  [...new Set(keysToRemove)].forEach(key => storage.removeItem(key));

  storage.setItem("production_cleanup_version", "1");
  return {
    plans: activePlans.length - keptPlans.length,
    logs: readingLogs.length - keptLogs.length,
    badges: unlockedBadges.length - keptBadges.length
  };
}

export async function cleanupRetiredOfflineOperations(dbClient) {
  if (!dbClient || typeof dbClient.getAll !== "function" || typeof dbClient.delete !== "function") return 0;
  const operations = await dbClient.getAll("offline_operations");
  const retired = (operations || []).filter(operation => isRetiredPlanRecord(operation.payload));
  await Promise.all(retired.map(operation => dbClient.delete("offline_operations", operation.id)));
  return retired.length;
}
