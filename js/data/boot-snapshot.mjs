// 開機快照（#630）：快取先畫、背景更新。
//
// 每次開機資料完整載入成功後，把畫首頁需要、但本機原本沒有存的部分（教會計畫、
// 個人資料、我的計畫、角色定義）存一份到 IndexedDB。下次開 App 時先用它（加上
// 既有的閱讀紀錄離線快照）畫出首頁，背景照常向伺服器要新資料，回來再原地重畫。
//
// 一台裝置只存一份（固定 key），裡面記著是誰的；身分對不上、太舊、格式不認得都不用。

export const BOOT_SNAPSHOT_STORE = "server_cache";
export const BOOT_SNAPSHOT_KEY = "boot_snapshot";
export const BOOT_SNAPSHOT_VERSION = 1;
export const BOOT_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function buildBootSnapshot({ userId, globalPlans, profile, plans, roleDefinitions, now = Date.now() }) {
  if (!userId || !Array.isArray(globalPlans) || !Array.isArray(plans) || !profile) return null;
  return {
    key: BOOT_SNAPSHOT_KEY,
    table: "boot_snapshot",
    updatedAt: now,
    version: BOOT_SNAPSHOT_VERSION,
    userId: String(userId),
    globalPlans,
    profile,
    plans,
    roleDefinitions: Array.isArray(roleDefinitions) ? roleDefinitions : []
  };
}

export function isUsableBootSnapshot(snapshot, { userId, now = Date.now(), maxAgeMs = BOOT_SNAPSHOT_MAX_AGE_MS } = {}) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.version !== BOOT_SNAPSHOT_VERSION) return false;
  if (!userId || snapshot.userId !== String(userId)) return false;
  const age = now - Number(snapshot.updatedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return false;
  return Array.isArray(snapshot.globalPlans) && Array.isArray(snapshot.plans) && !!snapshot.profile;
}

// 轉成 loadUserData 套用段（_applyLoadedUserData）吃的形狀。閱讀紀錄用既有的離線快照：
// 還能打卡的計畫的逐筆紀錄＋已關閉計畫的摘要（沒有摘要就不能用——已關閉計畫的進度會歸零）。
export function bootSnapshotToLoadResults(snapshot, { logs, scope, digest }) {
  if (!digest || !scope || scope.mode !== "open") return null;
  const ok = data => ({ data, error: null });
  return {
    globalPlansResult: ok(snapshot.globalPlans),
    profileResult: ok(snapshot.profile),
    plansResult: ok(snapshot.plans),
    // 螢光筆本來就在 localStorage，開機已經讀進來；這裡不要合併任何東西
    highlightsResult: { data: null, error: { message: "boot_snapshot" } },
    bootLogs: {
      logsResult: ok(Array.isArray(logs) ? logs : []),
      scope,
      digest,
      openPlanIds: scope.openPlanIds || [],
      closedPlanIds: []
    }
  };
}
