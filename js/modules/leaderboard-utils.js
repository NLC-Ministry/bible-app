/**
 * leaderboard-utils.js
 * 讀經排行榜排序與名次計算工具模組
 *
 * 設計原則：
 *  1. 多重排序權重：completed DESC → last_read ASC → id ASC
 *  2. Dense Rank 邏輯：進度與完成時間完全相同者共享相同名次
 *  3. 安全性：last_read 與 id 僅用於排序計算，不在 UI 上額外揭露
 *  4. 純函數設計，方便單元測試與前端重用
 */

/**
 * 多重排序比較函數 (Multi-column Comparator)
 *
 * 排序規則（優先順序）：
 *  1. completed（章數/進度）DESC — 進度高的排前面
 *  2. last_read ASC — 相同進度時，最早完成最新進度的人優先（鼓勵提早讀完）
 *     若 last_read 為 null/undefined 則排最後
 *  3. id ASC — 確保 100% 確定性，完全相同時以 UUID 字典序排列
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function compareLeaderboardEntries(a, b) {
  // ── 主排序：進度章數（DESC）──
  const completedDiff = (b.completed ?? 0) - (a.completed ?? 0);
  if (completedDiff !== 0) return completedDiff;

  // ── 次排序：最早達到目前進度的人優先（ASC）──
  // null/undefined 表示從未讀過，排在有完成時間的後面
  const aTime = a.last_read ? new Date(a.last_read).getTime() : Infinity;
  const bTime = b.last_read ? new Date(b.last_read).getTime() : Infinity;
  if (aTime !== bTime) return aTime - bTime;

  // ── 確定性防線：user_id 字典序（ASC）──
  const aId = String(a.id ?? a.name ?? "");
  const bId = String(b.id ?? b.name ?? "");
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * 對使用者列表套用多重排序
 *
 * @param {Array<Object>} users — 原始使用者陣列（不會修改原陣列）
 * @returns {Array<Object>} — 已排序的新陣列
 */
export function sortLeaderboard(users) {
  if (!Array.isArray(users)) return [];
  return [...users].sort(compareLeaderboardEntries);
}

/**
 * 為已排序的使用者列表指派 Dense Rank 名次
 *
 * Dense Rank 規則：
 *  - 若 A、B 的 completed 與 last_read 完全相同 → 同名次
 *  - 下一位名次直接遞增 1（不跳號）
 *
 * 用於排名判斷的鍵：completed + last_read（不含 id，因為 id 只是確定性防線）
 *
 * @param {Array<Object>} sortedUsers — 必須已經過 sortLeaderboard 處理
 * @returns {Array<Object>} — 新陣列，每個元素增加 `rank` 欄位（number）
 */
export function assignDenseRanks(sortedUsers) {
  if (!sortedUsers || sortedUsers.length === 0) return [];

  const total = sortedUsers.length;
  let currentRank = 1;

  return sortedUsers.map((user, index) => {
    // 未開始（completed = 0）→ 顯示最後名次（= 總人數）
    // 讓每個人都感受「從最後名從頭衝」的動力
    const score = user.completed ?? user.progress ?? 0;
    if (score === 0) return { ...user, rank: total };

    if (index === 0) {
      return { ...user, rank: 1 };
    }
    const prev = sortedUsers[index - 1];
    // Dense Rank 相同條件：進度相同 且 last_read 相同（包含都為 null 的情況）
    const sameCompleted = (user.completed ?? 0) === (prev.completed ?? 0);
    const sameLastRead = (user.last_read ?? null) === (prev.last_read ?? null);
    if (sameCompleted && sameLastRead) {
      // 同分同時間 → 決用上一個名次
      return { ...user, rank: currentRank };
    } else {
      // 不同分或不同時間 → 名次遞增（Dense: +1，不跳號）
      currentRank = index + 1;
      return { ...user, rank: currentRank };
    }
  });
}

/**
 * 一站式排行榜建立：排序 + Dense Rank 指派
 *
 * @param {Array<Object>} users — 使用者陣列，每個元素至少需包含：
 *   { id, name, completed, last_read? }
 * @returns {Array<Object>} — 完整排行榜陣列（含 `rank` 欄位）
 */
export function buildLeaderboard(users) {
  const sorted = sortLeaderboard(users);
  return assignDenseRanks(sorted);
}
