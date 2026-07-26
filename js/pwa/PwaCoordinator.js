import { IndexedDbClient } from "./IndexedDbClient.js";
import { OfflineQueueRepository } from "./OfflineQueueRepository.js";
import { OfflineSyncManager } from "./OfflineSyncManager.js";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar.js";
import { cleanupRetiredOfflineOperations } from "../production-cleanup.mjs";

const READING_OPERATION = "SET_CHAPTER_READ_STATE";

export class PwaCoordinator {
  constructor() {
    this.dbClient = window.pwaDataStore || new IndexedDbClient();
    this.queueRepository = new OfflineQueueRepository(this.dbClient);
    this.registrar = new ServiceWorkerRegistrar();
    this.syncManager = null;
    this.originalLogChapterRead = null;
  }

  async initialize() {
    try {
      await cleanupRetiredOfflineOperations(this.dbClient);
    } catch (error) {
      console.warn("[PWA] Retired offline operations could not be cleaned.", error);
    }

    let registration = null;
    try { registration = await this.registrar.register(); }
    catch (error) { console.warn("[PWA] Service Worker registration failed; app remains online-only.", error); }
    document.documentElement.dataset.pwaServiceWorker = registration ? "registered" : "unsupported";
    if (registration && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(async () => {
        document.documentElement.dataset.pwaServiceWorker = "active";
        if (window.caches) {
          const names = await caches.keys();
          document.documentElement.dataset.pwaCacheCount = String(names.filter(name => name.startsWith("newlife-bible-")).length);
        }
      }).catch(() => {});
    }

    this.syncManager = new OfflineSyncManager({
      queueRepository: this.queueRepository,
      registration,
      handlers: { [READING_OPERATION]: payload => this.syncReadingOperation(payload) }
    });
    this.syncManager.addEventListener("status", event => {
      window.dispatchEvent(new CustomEvent("pwa:sync-status", { detail: event.detail }));
    });
    this.registrar.addEventListener("message", event => {
      if (event.detail?.type === "SYNC_REQUEST") this.syncManager.syncPending().catch(error => console.warn("[PWA] Sync failed.", error));
    });
    window.addEventListener("online", () => this.syncManager.syncPending().catch(error => console.warn("[PWA] Sync failed.", error)));

    this.installReadingLogQueue();
    if (navigator.onLine) this.syncManager.syncPending().catch(error => console.warn("[PWA] Initial sync failed.", error));
    return this;
  }

  installReadingLogQueue() {
    if (!window.db || typeof window.db.logChapterRead !== "function" || this.originalLogChapterRead) return;
    this.originalLogChapterRead = window.db.logChapterRead.bind(window.db);
    window.db.logChapterRead = async (book, chapter, isChecked, roundOverride = null) => {
      const payload = this.createReadingPayload(book, chapter, isChecked, roundOverride);
      if (!navigator.onLine && this.shouldQueue(payload)) {
        await this.applyLocalReadingChange(book, chapter, isChecked, roundOverride);
        await this.queueReadingOperation(payload);
        return { queued: true, offline: true };
      }
      try {
        return await this.originalLogChapterRead(book, chapter, isChecked, roundOverride);
      } catch (error) {
        if (!this.shouldQueue(payload) || !this.isNetworkFailure(error)) throw error;
        await this.queueReadingOperation(payload);
        return { queued: true, offline: true };
      }
    };
  }

  createReadingPayload(book, chapter, isChecked, roundOverride) {
    const plan = window.state?.activePlan || null;
    return {
      book,
      chapter: Number(chapter),
      isChecked: Boolean(isChecked),
      round: Number(roundOverride || plan?.currentRound || 1),
      planId: plan?.id || null,
      presetKey: plan?.presetKey || null,
      readAt: new Date().toISOString()
    };
  }

  shouldQueue() {
    return Boolean(window.state?.isSupabaseMode && window.state?.supabase);
  }

  async applyLocalReadingChange(book, chapter, isChecked, roundOverride) {
    const previousMode = window.state.isSupabaseMode;
    window.state.isSupabaseMode = false;
    try { return await this.originalLogChapterRead(book, chapter, isChecked, roundOverride); }
    finally { window.state.isSupabaseMode = previousMode; }
  }

  async queueReadingOperation(payload) {
    const identity = window.state?.currentProfileId || window.state?.currentUser?.id || window.state?.currentUser?.name || "current";
    const key = ["reading", identity, payload.planId || payload.presetKey || "personal", payload.book, payload.chapter, payload.round].join(":");
    await this.syncManager.queue({ type: READING_OPERATION, payload, idempotencyKey: key });
  }

  async syncReadingOperation(payload) {
    if (!navigator.onLine) throw new TypeError("Network unavailable");
    const dataClient = window.state?.supabase;
    const user = await window.db.getCurrentDbUser();
    if (!dataClient || !user?.id) {
      const error = new Error("Authentication session unavailable");
      error.status = 401;
      throw error;
    }

    const repository = window.readingLogRepository || null;
    const cacheKey = `reading_logs:${user.id}`;
    const row = {
      user_id: user.id,
      plan_id: payload.planId,
      book: payload.book,
      chapter: payload.chapter,
      round: payload.round,
      read_at: payload.readAt
    };
    let result;
    if (payload.isChecked) {
      result = repository
        ? await repository.upsert(row, { onConflict: "user_id,plan_id,book,chapter,round" }, { invalidate: [cacheKey] })
        : await dataClient.from("reading_logs").upsert(row, { onConflict: "user_id,plan_id,book,chapter,round" });
    } else {
      const applyFilters = query => {
        query = query.eq("user_id", user.id).eq("book", payload.book)
          .eq("chapter", payload.chapter).eq("round", payload.round);
        return payload.planId ? query.eq("plan_id", payload.planId) : query.is("plan_id", null);
      };
      result = repository
        ? await repository.delete(applyFilters, { invalidate: [cacheKey] })
        : await applyFilters(dataClient.from("reading_logs").delete());
    }
    if (result?.error) {
      const error = new Error(result.error.message || result.error.error || String(result.error));
      error.status = Number(result.status || result.error.status || 0);
      throw error;
    }
    window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan", source: "offline-sync" } }));
  }

  isNetworkFailure(error) {
    const message = String(error?.message || error).toLowerCase();
    return error instanceof TypeError || message.includes("network") || message.includes("fetch") ||
      message.includes("offline") || message.includes("timeout") || message.includes("failed to load");
  }
}

export async function initializePwa() {
  const coordinator = new PwaCoordinator();
  await coordinator.initialize();
  window.pwaCoordinator = coordinator;
  return coordinator;
}