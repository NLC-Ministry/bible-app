// 計畫統計用的兩支 RPC（#394 get_plan_reading_log_digest、#397 get_plan_stats_roster）
// 的參數一律在這裡組：可見範圍來自 getVisibleProfileIds 的結果（index.ts 只算一次），
// 前端傳來的 p_whole_church／p_visible_ids／p_actor_id 一律被覆寫。
// 獨立成檔是為了讓 vitest 直接測行為（index.ts 本身是 Deno.serve 進入點）。

export const PLAN_READING_LOG_DIGEST_RPC = "get_plan_reading_log_digest";
export const PLAN_STATS_ROSTER_RPC = "get_plan_stats_roster";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PLAN_ALIASES = 50;
const MAX_TEXT_LENGTH = 200;

export type PlanStatsScope = { p_whole_church: boolean; p_visible_ids: string[] | null };

// visibleIds === null 是全教會範圍；其他角色用名單，空的就只剩本人（跟 applyForcedScope 一樣）。
// SQL 端在 p_whole_church 不是 true 而且名單是空的時候什麼都不回（fail closed）。
export function resolvePlanStatsScope(visibleIds: string[] | null, actorId: string): PlanStatsScope {
  if (visibleIds === null) return { p_whole_church: true, p_visible_ids: null };
  const ids = Array.isArray(visibleIds) ? visibleIds.filter(Boolean) : [];
  return { p_whole_church: false, p_visible_ids: ids.length ? ids : [actorId] };
}

export function buildPlanReadingLogDigestArgs(rawArgs: any, visibleIds: string[] | null, actorId: string) {
  const requestedPlanIds = Array.isArray(rawArgs?.p_plan_ids) ? rawArgs.p_plan_ids : [];
  return {
    p_plan_ids: Array.from(new Set(requestedPlanIds.filter((id: unknown) => typeof id === "string" && UUID_PATTERN.test(id)))),
    ...resolvePlanStatsScope(visibleIds, actorId),
    p_actor_id: actorId,
  };
}

// p_plan_aliases 不是陣列＝沒有計畫篩選（NULL）；是陣列就只留非空字串（原樣比對，不 trim）。
export function buildPlanStatsRosterArgs(rawArgs: any, visibleIds: string[] | null, actorId: string) {
  const rawAliases = rawArgs?.p_plan_aliases;
  const aliases = Array.isArray(rawAliases)
    ? Array.from(new Set(rawAliases.filter((alias: unknown) => typeof alias === "string" && alias.length > 0 && alias.length <= MAX_TEXT_LENGTH)))
      .slice(0, MAX_PLAN_ALIASES)
    : null;
  const zone = rawArgs?.p_pastoral_zone;
  const noteDate = rawArgs?.p_note_date;
  return {
    p_plan_aliases: aliases,
    p_pastoral_zone: typeof zone === "string" && zone.length > 0 && zone.length <= MAX_TEXT_LENGTH ? zone : null,
    p_note_date: typeof noteDate === "string" && DATE_PATTERN.test(noteDate) ? noteDate : null,
    ...resolvePlanStatsScope(visibleIds, actorId),
    p_actor_id: actorId,
  };
}

// App 管理分頁（#551）的統計：範圍一樣只看 getVisibleProfileIds，計畫只收 uuid 與短字串。
export const PASTORAL_OVERVIEW_RPC = "get_pastoral_overview";

export function buildPastoralOverviewArgs(rawArgs: any, visibleIds: string[] | null, actorId: string) {
  const planId = rawArgs?.p_global_plan_id;
  const presetKey = rawArgs?.p_preset_key;
  return {
    p_global_plan_id: typeof planId === "string" && UUID_PATTERN.test(planId) ? planId : null,
    p_preset_key: typeof presetKey === "string" && presetKey.length > 0 && presetKey.length <= MAX_TEXT_LENGTH ? presetKey : null,
    ...resolvePlanStatsScope(visibleIds, actorId),
    p_actor_id: actorId,
  };
}
