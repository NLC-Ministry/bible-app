export class OfflineSyncManager extends EventTarget {
  constructor({ queueRepository, handlers = {}, registration = null } = {}) {
    super();
    this.queueRepository = queueRepository;
    this.handlers = handlers;
    this.registration = registration;
    this.syncPromise = null;
  }

  async queue(operation) {
    const queued = await this.queueRepository.enqueue(operation);
    await this.requestBackgroundSync();
    await this.emitStatus("queued", queued.id);
    return queued;
  }

  syncPending() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSync().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async runSync() {
    const operations = await this.queueRepository.getPending();
    if (!operations.length) { await this.emitStatus("idle"); return; }
    await this.emitStatus("syncing");

    for (const operation of operations) {
      const handler = this.handlers[operation.type];
      if (!handler) {
        await this.queueRepository.markFailed(operation, new Error(`Unsupported operation: ${operation.type}`), { permanent: true });
        continue;
      }
      try {
        await handler(operation.payload, { idempotencyKey: operation.idempotencyKey });
        await this.queueRepository.markCompleted(operation.id);
      } catch (error) {
        await this.queueRepository.markFailed(operation, error, { permanent: this.isPermanentFailure(error) });
      }
    }
    await this.emitStatus("complete");
  }

  async requestBackgroundSync() {
    try {
      if (this.registration?.sync) await this.registration.sync.register("newlife-reading-sync");
    } catch (error) {
      console.info("[PWA] Background Sync unavailable; online-event fallback will be used.");
    }
  }

  isPermanentFailure(error) {
    const status = Number(error?.status || 0);
    return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
  }

  async emitStatus(status, operationId = null) {
    const pending = await this.queueRepository.countPending();
    this.dispatchEvent(new CustomEvent("status", { detail: { status, pending, operationId } }));
  }
}