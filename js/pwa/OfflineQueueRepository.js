export class OfflineQueueRepository {
  constructor(db, storeName = "offline_operations") {
    this.db = db;
    this.storeName = storeName;
  }

  async enqueue({ type, payload, idempotencyKey }) {
    const records = await this.db.getAll(this.storeName);
    const existing = records.find(record => record.idempotencyKey === idempotencyKey);
    if (existing) {
      const updated = {
        ...existing, type, payload, attempts: 0, status: "pending",
        nextAttemptAt: Date.now(), updatedAt: new Date().toISOString()
      };
      await this.db.put(this.storeName, updated);
      return updated;
    }

    const operation = {
      id: crypto.randomUUID(), type, payload, idempotencyKey,
      attempts: 0, status: "pending", createdAt: new Date().toISOString(), nextAttemptAt: Date.now()
    };
    await this.db.put(this.storeName, operation);
    return operation;
  }

  async getPending(limit = 25) {
    const now = Date.now();
    const records = await this.db.getAll(this.storeName);
    return records.filter(item => item.status === "pending" && item.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
  }

  async markCompleted(id) { await this.db.delete(this.storeName, id); }

  async markFailed(operation, error, { permanent = false } = {}) {
    const attempts = operation.attempts + 1;
    await this.db.put(this.storeName, {
      ...operation,
      attempts,
      status: permanent || attempts >= 5 ? "failed" : "pending",
      lastError: String(error?.message || error),
      nextAttemptAt: Date.now() + Math.min(60000, 1000 * (2 ** attempts)),
      updatedAt: new Date().toISOString()
    });
  }

  async countPending() {
    const records = await this.db.getAll(this.storeName);
    return records.filter(item => item.status === "pending").length;
  }
}