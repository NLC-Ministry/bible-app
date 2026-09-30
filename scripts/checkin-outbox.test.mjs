// 打卡 outbox（#356）：按下去先寫手機、背景送 RPC；網路/401 留著重送，規則拒絕移除並退回。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { CheckInOutbox, checkInOutboxKey, createOfflineOperationsStore, CHECK_IN_OPERATION_TYPE } from "../js/pwa/CheckInOutbox.js";
import { confirmLogoutWithPendingCheckIns, revertRejectedCheckIn, sendQueuedCheckIn, renderPendingCheckInChip } from "../js/pwa/CheckInSync.js";
import { isCheckInBlockedOffline } from "../js/data/chapter-complete.mjs";

const U1 = "user-1";
const U2 = "user-2";
const P = "plan-1";
const P2 = "plan-2";

class MemoryIdb {
  constructor() { this.records = new Map(); this.failPut = false; }
  async getAll() { return [...this.records.values()].map(value => structuredClone(value)); }
  async put(_store, value) {
    if (this.failPut) throw new Error("QuotaExceededError");
    this.records.set(value.id, structuredClone(value));
    return value.id;
  }
  async delete(_store, id) { this.records.delete(id); }
}

function makeOutbox({ send, userId = U1, online = true, idb = new MemoryIdb(), onRejected = null, clock = { t: 1000 } } = {}) {
  let n = 0;
  const outbox = new CheckInOutbox({
    store: createOfflineOperationsStore(idb),
    send: send || vi.fn(async () => ({ ok: true, reason: null })),
    getUserId: () => (typeof userId === "function" ? userId() : userId),
    isOnline: () => (typeof online === "function" ? online() : online),
    onRejected,
    newId: () => `client-${++n}`,
    now: () => clock.t
  });
  return { outbox, idb, clock };
}

const check = (chapter, extra = {}) => ({ userId: U1, planId: P, book: "創世記", chapter, round: 1, checked: true, ...extra });

describe("CheckInOutbox", () => {
  it("builds the idempotency key from plan|book|chapter|round", () => {
    expect(checkInOutboxKey({ planId: P, book: "創世記", chapter: "3", round: 2 })).toBe(`${P}|創世記|3|2`);
  });

  it("collapses check → uncheck of the same chapter to the latest intent", async () => {
    const { outbox, idb } = makeOutbox();
    await outbox.enqueue(check(3), { flush: false });
    await outbox.enqueue(check(3, { checked: false }), { flush: false });
    const items = outbox.pendingItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ checked: false, clientId: "client-2", userId: U1 });
    expect(idb.records.size).toBe(1);
    const [record] = idb.records.values();
    expect(record).toMatchObject({ type: CHECK_IN_OPERATION_TYPE, status: "outbox" });
    // 佇列裡沒有任何憑證
    expect(JSON.stringify(record)).not.toMatch(/token|password|authorization/i);
  });

  it("the old OfflineSyncManager never picks outbox records (status is not 'pending')", async () => {
    const { outbox, idb } = makeOutbox();
    await outbox.enqueue(check(1), { flush: false });
    const [record] = idb.records.values();
    expect(record.status).not.toBe("pending");
  });

  it("enqueue still succeeds when IndexedDB cannot be written", async () => {
    const { outbox, idb } = makeOutbox();
    idb.failPut = true;
    await expect(outbox.enqueue(check(1), { flush: false })).resolves.toMatchObject({ chapter: 1 });
    expect(outbox.pendingCount()).toBe(1);
    expect(outbox.hasUnsavedItems()).toBe(true);
  });

  it("flushes in FIFO order and removes items the server accepted (incl. already_read)", async () => {
    const sent = [];
    const send = vi.fn(async item => {
      sent.push(item.chapter);
      return item.chapter === 2 ? { ok: true, reason: "already_read" } : { ok: true, reason: null };
    });
    const { outbox, idb, clock } = makeOutbox({ send });
    await outbox.enqueue(check(3), { flush: false });
    clock.t += 1;
    await outbox.enqueue(check(1), { flush: false });
    clock.t += 1;
    await outbox.enqueue(check(2), { flush: false });
    const summary = await outbox.flush();
    expect(sent).toEqual([3, 1, 2]);
    expect(summary).toMatchObject({ sent: 3, rejected: 0, failed: 0, remaining: 0 });
    expect(outbox.pendingCount()).toBe(0);
    expect(idb.records.size).toBe(0);
  });

  it("keeps an item when sending throws (network / 401 / 5xx) and backs off until forced", async () => {
    const send = vi.fn(async () => { const e = new Error("Failed to fetch"); e.status = 0; throw e; });
    const { outbox, idb, clock } = makeOutbox({ send });
    await outbox.enqueue(check(1), { flush: false });
    await outbox.enqueue(check(2), { flush: false });
    const first = await outbox.flush();
    expect(first).toMatchObject({ failed: 1, remaining: 2 });
    expect(send).toHaveBeenCalledTimes(1); // FIFO：第一筆失敗就停，不跳過
    expect(outbox.pendingItems()[0]).toMatchObject({ attempts: 1, lastError: "Failed to fetch" });
    expect(idb.records.size).toBe(2);

    const gated = await outbox.flush();
    expect(gated.skipped).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    send.mockImplementation(async () => ({ ok: true, reason: null }));
    const forced = await outbox.flush({ force: true });
    expect(forced).toMatchObject({ sent: 2, remaining: 0 });

    // 退避時間過了，一般 flush 也會送
    await outbox.enqueue(check(5), { flush: false });
    send.mockImplementationOnce(async () => { throw new Error("503"); });
    await outbox.flush();
    clock.t += 60 * 1000;
    await expect(outbox.flush()).resolves.toMatchObject({ sent: 1, remaining: 0 });
  });

  it("does not send while offline or without a signed-in user", async () => {
    let online = false;
    let user = U1;
    const send = vi.fn(async () => ({ ok: true, reason: null }));
    const { outbox } = makeOutbox({ send, online: () => online, userId: () => user });
    await outbox.enqueue(check(1), { flush: false });
    expect((await outbox.flush({ force: true })).skipped).toBe(true);
    online = true;
    user = null;
    expect((await outbox.flush({ force: true })).skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
    user = U1;
    await outbox.flush({ force: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("business rejection removes the item and calls the revert callback with the reason", async () => {
    const onRejected = vi.fn();
    const send = vi.fn(async item => (item.chapter === 1 ? { ok: false, reason: "plan_closed" } : { ok: true, reason: null }));
    const { outbox, idb } = makeOutbox({ send, onRejected });
    await outbox.enqueue(check(1), { flush: false });
    await outbox.enqueue(check(2), { flush: false });
    const summary = await outbox.flush();
    expect(summary).toMatchObject({ sent: 1, rejected: 1, remaining: 0 });
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected.mock.calls[0][0]).toMatchObject({ chapter: 1, checked: true });
    expect(onRejected.mock.calls[0][1]).toBe("plan_closed");
    expect(idb.records.size).toBe(0);
  });

  it("a newer intent for the same chapter survives an in-flight send and is not reverted", async () => {
    const onRejected = vi.fn();
    let outbox;
    const send = vi.fn(async item => {
      if (item.clientId === "client-1") {
        await outbox.enqueue(check(1, { checked: false }), { flush: false });
        return { ok: false, reason: "plan_closed" };
      }
      return { ok: true, reason: "already_unread" };
    });
    ({ outbox } = makeOutbox({ send, onRejected }));
    await outbox.enqueue(check(1), { flush: false });
    await outbox.flush();
    expect(onRejected).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ checked: false, clientId: "client-2" });
    expect(outbox.pendingCount()).toBe(0);
  });

  it("round-advance guard: ensurePlanSynced reports what is still pending for that plan", async () => {
    let online = false;
    const { outbox } = makeOutbox({ online: () => online });
    await outbox.enqueue(check(1), { flush: false });
    await outbox.enqueue(check(2, { planId: P2 }), { flush: false });
    expect(await outbox.ensurePlanSynced(P)).toBe(1);
    online = true;
    expect(await outbox.ensurePlanSynced(P)).toBe(0);
    expect(outbox.pendingCount({ planId: P2 })).toBe(0);
  });

  it("user isolation: only the signed-in user's items are sent; another user's are dropped on login", async () => {
    let user = U2;
    const send = vi.fn(async () => ({ ok: true, reason: null }));
    const { outbox, idb } = makeOutbox({ send, userId: () => user });
    await outbox.enqueue(check(1, { userId: U1 }), { flush: false });
    await outbox.enqueue(check(2, { userId: U2 }), { flush: false });
    await outbox.flush({ force: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].userId).toBe(U2);
    expect(outbox.pendingCount({ userId: U1 })).toBe(1);

    await outbox.enqueue(check(3, { userId: U1 }), { flush: false });
    user = U2;
    await outbox.handleSessionVerified(U2);
    expect(outbox.pendingItems()).toHaveLength(0);
    expect(idb.records.size).toBe(0);
  });

  it("reloads persisted items after an app restart", async () => {
    const idb = new MemoryIdb();
    const { outbox: first } = makeOutbox({ idb });
    await first.enqueue(check(4), { flush: false });
    const { outbox: second } = makeOutbox({ idb });
    await second.load();
    expect(second.ready).toBe(true);
    expect(second.pendingItems()).toEqual([expect.objectContaining({ planId: P, chapter: 4, checked: true, clientId: "client-1" })]);
  });

  it("overlays pending intents on freshly loaded reading logs", async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue(check(1), { flush: false });
    await outbox.enqueue(check(2, { checked: false }), { flush: false });
    const logs = [{ book: "創世記", chapter: 2, round: 1, plan_id: P }, { book: "創世記", chapter: 9, round: 1, plan_id: P }];
    const merged = outbox.applyPendingToLogs(logs, { userId: U1 });
    expect(merged.map(log => log.chapter).sort()).toEqual([1, 9]);
    expect(outbox.applyPendingToLogs(logs, { userId: U2 })).toEqual(logs);
  });

  it("emits change events with the pending count", async () => {
    const { outbox } = makeOutbox({ online: false });
    const counts = [];
    outbox.addEventListener("change", event => counts.push(event.detail.pending));
    await outbox.enqueue(check(1), { flush: false });
    await outbox.clear();
    expect(counts).toEqual([1, 0]);
  });
});

describe("CheckInSync glue", () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it("sends through db.logChapterRead in direct mode with the pressed-at time and client id", async () => {
    const logChapterRead = vi.fn(async () => undefined);
    const item = { planId: P, book: "創世記", chapter: 3, round: 2, checked: true, pressedAt: "2026-09-30T01:00:00.000Z", clientId: "c-9" };
    await expect(sendQueuedCheckIn(item, { db: { logChapterRead } })).resolves.toEqual({ ok: true, reason: null });
    expect(logChapterRead).toHaveBeenCalledWith("創世記", 3, true, 2, { id: P, currentRound: 2 },
      { direct: true, readAt: "2026-09-30T01:00:00.000Z", clientId: "c-9" });
  });

  it("maps CHECK_IN_REJECTED to { ok:false } and rethrows transport errors", async () => {
    const rejected = Object.assign(new Error("計畫已截止"), { code: "CHECK_IN_REJECTED", reason: "plan_closed" });
    const item = { planId: P, book: "創世記", chapter: 3, round: 1, checked: true };
    await expect(sendQueuedCheckIn(item, { db: { logChapterRead: async () => { throw rejected; } } }))
      .resolves.toEqual({ ok: false, reason: "plan_closed" });
    const network = Object.assign(new Error("Failed to fetch"), { status: 0 });
    await expect(sendQueuedCheckIn(item, { db: { logChapterRead: async () => { throw network; } } })).rejects.toBe(network);
  });

  it("reverts a rejected check: drops the log, recalculates, re-renders and toasts the reason", () => {
    const win = dom.window;
    win.state = { readingLogs: [{ book: "創世記", chapter: 3, round: 1, plan_id: P }, { book: "創世記", chapter: 4, round: 1, plan_id: P }], activePlans: [{ id: P }] };
    win.calculatePlanProgress = vi.fn();
    win.renderPlanScheduleTracker = vi.fn();
    win.showToast = vi.fn();
    win.appRouter = { currentTab: "plan-view" };
    win.APP_COPY = { plan: { checkInReasons: { plan_closed: "計畫已截止，無法再修改打卡" } } };
    revertRejectedCheckIn({ planId: P, book: "創世記", chapter: 3, round: 1, checked: true }, "plan_closed", { win });
    expect(win.state.readingLogs.map(log => log.chapter)).toEqual([4]);
    expect(win.calculatePlanProgress).toHaveBeenCalled();
    expect(win.renderPlanScheduleTracker).toHaveBeenCalled();
    expect(win.showToast).toHaveBeenCalledWith("創世記 3章：計畫已截止，無法再修改打卡");

    revertRejectedCheckIn({ planId: P, book: "創世記", chapter: 5, round: 1, checked: false, pressedAt: "x" }, "old_round", { win });
    expect(win.state.readingLogs.map(log => log.chapter)).toEqual([4, 5]);
  });

  it("shows the pending chip while there are items and hides it at 0", () => {
    const doc = dom.window.document;
    renderPendingCheckInChip(2, { doc });
    const chip = doc.getElementById("checkin-pending-chip");
    expect(chip.textContent).toBe("2 章等待同步");
    expect(doc.documentElement.dataset.checkInPending).toBe("2");
    renderPendingCheckInChip(0, { doc });
    expect(doc.getElementById("checkin-pending-chip")).toBeNull();
  });

  it("logout asks for confirmation when check-ins are still pending, and clears them on confirm", async () => {
    const { outbox } = makeOutbox({ online: false });
    await outbox.enqueue(check(1), { flush: false });
    const decline = vi.fn(async () => false);
    await expect(confirmLogoutWithPendingCheckIns({ outbox, confirm: decline, online: () => false })).resolves.toBe(false);
    expect(decline.mock.calls[0][0].message).toContain("1 章");
    expect(outbox.pendingCount()).toBe(1);
    const accept = vi.fn(async () => true);
    await expect(confirmLogoutWithPendingCheckIns({ outbox, confirm: accept, online: () => false })).resolves.toBe(true);
    expect(outbox.pendingCount()).toBe(0);
    const never = vi.fn();
    await expect(confirmLogoutWithPendingCheckIns({ outbox, confirm: never })).resolves.toBe(true);
    expect(never).not.toHaveBeenCalled();
  });

  it("offline mode only blocks check-ins that cannot be queued", () => {
    const db = { canQueueCheckIn: () => true };
    expect(isCheckInBlockedOffline({ offlineMode: false, plan: null, db })).toBe(false);
    expect(isCheckInBlockedOffline({ offlineMode: true, plan: { id: P }, db })).toBe(false);
    expect(isCheckInBlockedOffline({ offlineMode: true, plan: null, db })).toBe(true);
    expect(isCheckInBlockedOffline({ offlineMode: true, plan: { id: P }, db: {} })).toBe(true);
  });
});

describe("db.logChapterRead with the outbox", () => {
  let dom, db, rpc, fakeState, enqueue;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    rpc = vi.fn(async () => ({ data: { ok: true, reason: null }, error: null }));
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    fakeState = {
      isSupabaseMode: true,
      offlineMode: true,
      supabase: { rpc, from: vi.fn(() => { throw new Error("no direct writes"); }) },
      supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
      currentProfileId: U1,
      currentUser: { id: U1 },
      readingLogs: [],
      activePlan: null
    };
    vi.stubGlobal("state", fakeState);
    await import("../js/db.js?checkin-outbox");
    db = dom.window.db || globalThis.db;
    db.getCurrentDbUser = async () => ({ id: U1 });
    db.calculateStreak = () => {};
    db.saveLocalUserStats = () => {};
    enqueue = vi.fn(async item => item);
    dom.window.checkInOutbox = { ready: true, enqueue, applyPendingToLogs: logs => logs };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it("queues a plan check-in even in offline reading mode, without touching the network", async () => {
    const result = await db.logChapterRead("創世記", 3, true, 1, { id: P, currentRound: 1 });
    expect(result).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ userId: U1, planId: P, book: "創世記", chapter: 3, round: 1, checked: true }));
    expect(rpc).not.toHaveBeenCalled();
    expect(fakeState.readingLogs).toHaveLength(1);
  });

  it("free reading keeps the old offline refusal", async () => {
    const error = await db.logChapterRead("詩篇", 23, true, 1, null).catch(e => e);
    expect(error.code).toBe("OFFLINE_READ_ONLY");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("direct mode (the outbox sender) calls the RPC with the queued time and client id", async () => {
    fakeState.offlineMode = false;
    await db.logChapterRead("創世記", 3, true, 1, { id: P, currentRound: 1 },
      { direct: true, readAt: "2026-09-29T10:00:00.000Z", clientId: "c-1" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_chapter_read", expect.objectContaining({
      p_plan_id: P, p_read_at: "2026-09-29T10:00:00.000Z", p_client_id: "c-1"
    }));
  });
});
