/**
 * leaderboard-ranking.test.mjs
 * 排行榜排序穩定性與 Dense Rank 單元測試
 *
 * 測試情境：
 *  情況 A：兩位使用者進度相同，但 User A 比 User B 早 10 分鐘完成 → A 排前面
 *  情況 B：兩位使用者進度與完成時間完全相同 → 取得相同名次且多次 Fetch 順序一致
 *  情況 C：一般排行（進度不同）→ 高進度者優先
 *  情況 D：多人同分不同時間 → 按 last_read ASC 穩定排列
 *  情況 E：所有人都未開始（completed = 0）→ 按 id ASC 穩定排列
 */

import { describe, it, expect } from "vitest";
import {
  compareLeaderboardEntries,
  sortLeaderboard,
  assignDenseRanks,
  buildLeaderboard
} from "../js/modules/leaderboard-utils.js";

// ─────────────────────────────────────────────────────────────────
// 測試資料工廠
// ─────────────────────────────────────────────────────────────────
function makeUser(overrides) {
  return {
    id: "user-aaa",
    name: "預設使用者",
    completed: 0,
    last_read: null,
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────
// 情況 A：相同進度，不同完成時間
// ─────────────────────────────────────────────────────────────────
describe("情況 A：相同進度，不同完成時間", () => {
  const userA = makeUser({
    id: "uuid-user-a",
    name: "User A",
    completed: 50,
    last_read: "2026-07-28T06:00:00Z"  // 早 10 分鐘完成
  });
  const userB = makeUser({
    id: "uuid-user-b",
    name: "User B",
    completed: 50,
    last_read: "2026-07-28T06:10:00Z"  // 晚 10 分鐘
  });

  it("compareLeaderboardEntries 應傳回負數（A 排 B 前面）", () => {
    expect(compareLeaderboardEntries(userA, userB)).toBeLessThan(0);
  });

  it("compareLeaderboardEntries 應傳回正數（B 排 A 後面）", () => {
    expect(compareLeaderboardEntries(userB, userA)).toBeGreaterThan(0);
  });

  it("sortLeaderboard 後 User A 應排在第一位", () => {
    const sorted = sortLeaderboard([userB, userA]);
    expect(sorted[0].name).toBe("User A");
    expect(sorted[1].name).toBe("User B");
  });

  it("Dense Rank：A 名次為 #1，B 名次為 #2（不同 last_read 不共享名次）", () => {
    const leaderboard = buildLeaderboard([userB, userA]);
    const a = leaderboard.find(u => u.name === "User A");
    const b = leaderboard.find(u => u.name === "User B");
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 情況 B：進度與完成時間完全相同 → 相同名次且順序不跳動
// ─────────────────────────────────────────────────────────────────
describe("情況 B：進度與完成時間完全相同", () => {
  const SAME_TIME = "2026-07-28T08:00:00Z";

  const userC = makeUser({
    id: "uuid-user-c",  // 字典序較小
    name: "User C",
    completed: 80,
    last_read: SAME_TIME
  });
  const userD = makeUser({
    id: "uuid-user-d",  // 字典序較大
    name: "User D",
    completed: 80,
    last_read: SAME_TIME
  });

  it("兩者 Dense Rank 名次相同（共享 #1）", () => {
    const leaderboard = buildLeaderboard([userD, userC]);
    const c = leaderboard.find(u => u.name === "User C");
    const d = leaderboard.find(u => u.name === "User D");
    expect(c.rank).toBe(1);
    expect(d.rank).toBe(1);
  });

  it("多次呼叫 sortLeaderboard 結果 100% 一致（不跳動）", () => {
    const run1 = sortLeaderboard([userD, userC]).map(u => u.name);
    const run2 = sortLeaderboard([userC, userD]).map(u => u.name);
    const run3 = sortLeaderboard([userD, userC]).map(u => u.name);

    // 應完全相同（id ASC 確定性防線：C id < D id，故 C 在前）
    expect(run1).toEqual(["User C", "User D"]);
    expect(run2).toEqual(["User C", "User D"]);
    expect(run3).toEqual(["User C", "User D"]);
    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  it("後一位未共享名次的人名次應為 #3（Dense，非 #2）", () => {
    const userE = makeUser({
      id: "uuid-user-e",
      name: "User E",
      completed: 60,
      last_read: "2026-07-28T09:00:00Z"
    });
    const leaderboard = buildLeaderboard([userD, userC, userE]);
    const e = leaderboard.find(u => u.name === "User E");
    expect(e.rank).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────
// 情況 C：一般排行（進度明顯不同）
// ─────────────────────────────────────────────────────────────────
describe("情況 C：進度不同的一般排行", () => {
  const users = [
    makeUser({ id: "id-3", name: "C3", completed: 30, last_read: "2026-07-01T00:00:00Z" }),
    makeUser({ id: "id-1", name: "C1", completed: 100, last_read: "2026-07-01T00:00:00Z" }),
    makeUser({ id: "id-2", name: "C2", completed: 70, last_read: "2026-07-01T00:00:00Z" }),
  ];

  it("排序後應為 C1(100) > C2(70) > C3(30)", () => {
    const sorted = sortLeaderboard(users);
    expect(sorted.map(u => u.name)).toEqual(["C1", "C2", "C3"]);
  });

  it("Dense Rank：三者名次皆不同（#1, #2, #3）", () => {
    const lb = buildLeaderboard(users);
    expect(lb.find(u => u.name === "C1").rank).toBe(1);
    expect(lb.find(u => u.name === "C2").rank).toBe(2);
    expect(lb.find(u => u.name === "C3").rank).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────
// 情況 D：多人同分不同時間
// ─────────────────────────────────────────────────────────────────
describe("情況 D：多人同分不同完成時間", () => {
  const users = [
    makeUser({ id: "id-z", name: "Z", completed: 50, last_read: "2026-07-28T12:00:00Z" }),
    makeUser({ id: "id-x", name: "X", completed: 50, last_read: "2026-07-28T10:00:00Z" }),
    makeUser({ id: "id-y", name: "Y", completed: 50, last_read: "2026-07-28T11:00:00Z" }),
  ];

  it("相同進度按 last_read ASC 排序：X(10) > Y(11) > Z(12)", () => {
    const sorted = sortLeaderboard(users);
    expect(sorted.map(u => u.name)).toEqual(["X", "Y", "Z"]);
  });

  it("三者 Dense Rank 皆不同（各自 last_read 不同）", () => {
    const lb = buildLeaderboard(users);
    expect(lb.find(u => u.name === "X").rank).toBe(1);
    expect(lb.find(u => u.name === "Y").rank).toBe(2);
    expect(lb.find(u => u.name === "Z").rank).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────
// 情況 E：all completed = 0（未開始）→ 全部顯示最後名次（總人數）
// ─────────────────────────────────────────────────────────────────
describe("情況 E：所有人未開始（completed = 0）", () => {
  const users = [
    makeUser({ id: "id-beta", name: "Beta", completed: 0, last_read: null }),
    makeUser({ id: "id-alpha", name: "Alpha", completed: 0, last_read: null }),
    makeUser({ id: "id-gamma", name: "Gamma", completed: 0, last_read: null }),
  ];

  it("排序後按 id ASC 字典序穩定排列：alpha < beta < gamma", () => {
    const sorted = sortLeaderboard(users);
    expect(sorted.map(u => u.id)).toEqual(["id-alpha", "id-beta", "id-gamma"]);
  });

  it("所有人名次皆為總人數（最後一名），而非 #1", () => {
    const lb = buildLeaderboard(users);
    const total = users.length; // 3
    lb.forEach(u => expect(u.rank).toBe(total));
  });

  it("單人未開始 → 名次 = 1（= 總人數 = 1）", () => {
    const lb = buildLeaderboard([makeUser({ id: "only", name: "Only", completed: 0 })]);
    expect(lb[0].rank).toBe(1); // total = 1，所以最後名次 = 1
  });

  it("部分開始、部分未開始：未開始者顯示總人數名次", () => {
    const started = makeUser({ id: "id-s", name: "Started", completed: 10, last_read: "2026-07-01T00:00:00Z" });
    const notStarted1 = makeUser({ id: "id-n1", name: "N1", completed: 0, last_read: null });
    const notStarted2 = makeUser({ id: "id-n2", name: "N2", completed: 0, last_read: null });
    const lb = buildLeaderboard([notStarted1, notStarted2, started]);
    const total = 3;
    expect(lb.find(u => u.name === "Started").rank).toBe(1);
    expect(lb.find(u => u.name === "N1").rank).toBe(total);
    expect(lb.find(u => u.name === "N2").rank).toBe(total);
  });
});

// ─────────────────────────────────────────────────────────────────
// 邊界條件測試
// ─────────────────────────────────────────────────────────────────
describe("邊界條件", () => {
  it("空陣列不崩潰", () => {
    expect(buildLeaderboard([])).toEqual([]);
    expect(sortLeaderboard([])).toEqual([]);
    expect(assignDenseRanks([])).toEqual([]);
  });

  it("單人陣列回傳 rank = 1", () => {
    const lb = buildLeaderboard([makeUser({ id: "solo", name: "Solo", completed: 10 })]);
    expect(lb).toHaveLength(1);
    expect(lb[0].rank).toBe(1);
  });

  it("null 輸入不崩潰", () => {
    expect(sortLeaderboard(null)).toEqual([]);
    expect(assignDenseRanks(null)).toEqual([]);
  });

  it("has_read = null 的使用者排在有時間的後面", () => {
    const withTime = makeUser({ id: "id-1", name: "A", completed: 50, last_read: "2026-01-01T00:00:00Z" });
    const noTime = makeUser({ id: "id-2", name: "B", completed: 50, last_read: null });
    const sorted = sortLeaderboard([noTime, withTime]);
    expect(sorted[0].name).toBe("A");  // 有時間的排前面
    expect(sorted[1].name).toBe("B");  // null 排後面
  });
});
