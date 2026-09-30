// 打卡 outbox（#356）：計畫內的打卡／取消打卡一律先寫進手機，再背景送 record_chapter_read /
// unrecord_chapter_read。按下去這一步一定成功；送不出去（網路、登入過期、5xx）就留著等下次，
// 伺服器規則拒絕（{ ok:false, reason }）才移除並通知呼叫端把畫面退回。
//
// 這支檔案只有純邏輯，不碰 window/state/DOM：儲存、送出、判斷連線、目前使用者都由外面注入，
// 測試直接用記憶體假件跑。接到 app 的膠水在 js/pwa/CheckInSync.js。
//
// 儲存沿用 IndexedDB 既有的 offline_operations store（不升版本，避免舊分頁擋住升級）：
// 每筆 status 固定是 "outbox"，舊的 OfflineSyncManager 只撿 status === "pending"，永遠不會碰到。
// 憑證一律不進佇列：每筆只有使用者 id、計畫 id、章節、遍數、想要的狀態、按下時間、client_id。

export const CHECK_IN_OPERATION_TYPE = "CHECK_IN_CHAPTER";
export const CHECK_IN_OUTBOX_STATUS = "outbox";
const RECORD_ID_PREFIX = "checkin:";

export function checkInOutboxKey({ planId, book, chapter, round }) {
  return `${planId}|${book}|${Number(chapter)}|${Number(round) || 1}`;
}

function defaultNewId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch (_) { /* fall through */ }
  return `ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// IndexedDbClient（或任何有 getAll/put/delete 的東西）→ outbox 用的 store 介面。
export function createOfflineOperationsStore(dbClient, storeName = "offline_operations") {
  if (!dbClient) return null;
  return {
    async getAll() {
      const records = await dbClient.getAll(storeName);
      return (records || []).filter(record => record && record.type === CHECK_IN_OPERATION_TYPE);
    },
    put(record) { return dbClient.put(storeName, record); },
    delete(id) { return dbClient.delete(storeName, id); }
  };
}

function toRecord(item) {
  const { key, ...payload } = item;
  return {
    id: RECORD_ID_PREFIX + key,
    idempotencyKey: RECORD_ID_PREFIX + key,
    type: CHECK_IN_OPERATION_TYPE,
    status: CHECK_IN_OUTBOX_STATUS,
    createdAt: payload.pressedAt,
    nextAttemptAt: 0,
    payload
  };
}

function fromRecord(record) {
  const payload = record && record.payload;
  if (!payload || !payload.planId || !payload.book) return null;
  return { ...payload, key: checkInOutboxKey(payload) };
}

export class CheckInOutbox extends EventTarget {
  constructor({
    store = null,
    send,
    getUserId = () => null,
    isOnline = () => true,
    onRejected = null,
    newId = defaultNewId,
    now = () => Date.now(),
    backoffBaseMs = 2000,
    backoffMaxMs = 5 * 60 * 1000
  } = {}) {
    super();
    if (typeof send !== "function") throw new TypeError("CheckInOutbox needs a send(item) function");
    this.store = store;
    this.send = send;
    this.getUserId = getUserId;
    this.isOnline = isOnline;
    this.onRejected = onRejected;
    this.newId = newId;
    this.now = now;
    this.backoffBaseMs = backoffBaseMs;
    this.backoffMaxMs = backoffMaxMs;
    this.items = new Map();
    this.unsaved = new Set();
    this.lastSeq = 0;
    this.failures = 0;
    this.retryAt = 0;
    this.flushPromise = null;
    this.ready = false;
  }

  async load() {
    if (this.store) {
      try {
        const records = await this.store.getAll();
        for (const record of records) {
          const item = fromRecord(record);
          if (!item) continue;
          const current = this.items.get(item.key);
          if (!current || Number(item.seq || 0) > Number(current.seq || 0)) this.items.set(item.key, item);
          this.lastSeq = Math.max(this.lastSeq, Number(item.seq || 0));
        }
      } catch (error) {
        console.warn("[CheckInOutbox] Could not read the outbox; continuing in memory.", error);
      }
    }
    this.ready = true;
    this.emitChange();
    return this;
  }

  // 按下去這一步：永遠成功（IndexedDB 寫失敗也留在記憶體裡照送）。
  // 同一章同一遍只留最後一次的意圖（勾→取消 = 一筆取消）。
  async enqueue({ userId, planId, book, chapter, round, checked, pressedAt = null }, { flush = true } = {}) {
    const base = { planId, book, chapter: Number(chapter), round: Number(round) || 1 };
    const key = checkInOutboxKey(base);
    this.lastSeq = Math.max(this.lastSeq + 1, this.now());
    const item = {
      ...base,
      key,
      userId: userId || null,
      checked: Boolean(checked),
      clientId: this.newId(),
      pressedAt: pressedAt || new Date(this.now()).toISOString(),
      seq: this.lastSeq,
      attempts: 0,
      lastError: null
    };
    this.items.set(key, item);
    this.emitChange();
    await this.persist(item);
    if (flush) this.flush().catch(error => console.warn("[CheckInOutbox] Flush after enqueue failed.", error));
    return item;
  }

  async persist(item) {
    if (!this.store) { this.unsaved.add(item.key); return; }
    this.unsaved.add(item.key);
    try {
      await this.store.put(toRecord(item));
      if (this.items.get(item.key) === item) this.unsaved.delete(item.key);
    } catch (error) {
      console.warn("[CheckInOutbox] Could not persist a check-in; kept in memory until it is sent.", error);
    }
  }

  async remove(item) {
    // 同一章已經有更新的意圖（同一個 record id）：它還要送，store 裡那筆不能刪。
    if (this.items.get(item.key) !== item) return;
    this.items.delete(item.key);
    this.unsaved.delete(item.key);
    if (!this.store) return;
    try { await this.store.delete(RECORD_ID_PREFIX + item.key); }
    catch (error) { console.warn("[CheckInOutbox] Could not delete a sent check-in.", error); }
  }

  pendingItems({ userId = undefined, planId = undefined } = {}) {
    return [...this.items.values()]
      .filter(item => (userId === undefined || item.userId === userId) && (planId === undefined || item.planId === planId))
      .sort((a, b) => a.seq - b.seq);
  }

  // 預設只算目前使用者的；沒有使用者（登出中）就算全部。
  pendingCount({ planId = undefined, userId = undefined } = {}) {
    const owner = userId !== undefined ? userId : (this.getUserId() || undefined);
    return this.pendingItems({ userId: owner, planId }).length;
  }

  hasUnsavedItems() { return this.unsaved.size > 0; }

  // FIFO 送出。force=false 時尊重退避時間（前景、enqueue 觸發）；上線、重新登入、使用者主動要求用 force。
  flush({ force = false } = {}) {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.runFlush({ force }).finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  async runFlush({ force }) {
    const summary = { sent: 0, rejected: 0, failed: 0, remaining: 0, skipped: false };
    const userId = this.getUserId();
    if (!userId || !this.isOnline() || (!force && this.now() < this.retryAt)) {
      summary.skipped = true;
      summary.remaining = this.pendingCount();
      return summary;
    }

    while (true) {
      const [item] = this.pendingItems({ userId });
      if (!item) break;
      if (!this.isOnline()) break;
      let result;
      try {
        result = await this.send(item);
      } catch (error) {
        // 網路／401／5xx：留著，下次再送；整個 flush 停下來（FIFO，不跳過前面那筆）。
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastError = String((error && error.message) || error);
        this.failures += 1;
        this.retryAt = this.now() + Math.min(this.backoffMaxMs, this.backoffBaseMs * (2 ** (this.failures - 1)));
        if (this.items.get(item.key) === item) await this.persist(item);
        summary.failed += 1;
        break;
      }
      this.failures = 0;
      this.retryAt = 0;
      const superseded = this.items.get(item.key) !== item;
      await this.remove(item);
      if (result && result.ok === false) {
        summary.rejected += 1;
        // 送出期間使用者又改了同一章：新的意圖還在佇列裡，畫面本來就是新的狀態，不退回。
        if (!superseded) {
          this.dispatchEvent(new CustomEvent("rejected", { detail: { item, reason: result.reason || null } }));
          if (typeof this.onRejected === "function") {
            try { await this.onRejected(item, result.reason || null); }
            catch (error) { console.warn("[CheckInOutbox] Revert after rejection failed.", error); }
          }
        }
      } else {
        summary.sent += 1;
        this.dispatchEvent(new CustomEvent("sent", { detail: { item, result: result || { ok: true, reason: null } } }));
      }
      this.emitChange();
    }
    summary.remaining = this.pendingCount();
    this.emitChange();
    return summary;
  }

  // 「進入下一遍」前：先送一次，回傳這個計畫還剩幾章沒送出。
  async ensurePlanSynced(planId) {
    try { await this.flush({ force: true }); }
    catch (error) { console.warn("[CheckInOutbox] Flush before round advance failed.", error); }
    return this.pendingCount({ planId });
  }

  // 換人登入：別人的打卡不能用這個帳號送出，直接丟掉。
  async dropOtherUsers(userId) {
    if (!userId) return 0;
    const others = [...this.items.values()].filter(item => item.userId !== userId);
    for (const item of others) await this.remove(item);
    if (others.length) this.emitChange();
    return others.length;
  }

  // 登入身分確認過（開 app、重新登入、恢復連線）：先丟掉別人的，再強制送一次自己的。
  async handleSessionVerified(userId) {
    if (!userId) return null;
    await this.dropOtherUsers(userId);
    return this.flush({ force: true });
  }

  async clear() {
    const all = [...this.items.values()];
    for (const item of all) await this.remove(item);
    this.emitChange();
    return all.length;
  }

  // 重新載入 reading_logs 後，把還沒送出的意圖疊回去，免得畫面把剛勾的章又顯示成沒勾。
  applyPendingToLogs(logs, { userId = this.getUserId() } = {}) {
    const list = Array.isArray(logs) ? logs.slice() : [];
    if (!userId) return list;
    const items = this.pendingItems({ userId });
    if (!items.length) return list;
    const sameChapter = (log, item) => log && log.plan_id === item.planId && String(log.book) === String(item.book) &&
      Number(log.chapter) === item.chapter && Number(log.round || 1) === item.round;
    let result = list;
    for (const item of items) {
      if (item.checked) {
        if (!result.some(log => sameChapter(log, item))) {
          result.push({ book: item.book, chapter: item.chapter, round: item.round, plan_id: item.planId, read_at: item.pressedAt, pending: true });
        }
      } else {
        result = result.filter(log => !sameChapter(log, item));
      }
    }
    return result;
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent("change", { detail: { pending: this.pendingCount() } }));
  }
}
