export class IndexedDbClient {
  constructor({ name = "newlife-bible", version = 1 } = {}) {
    this.name = name;
    this.version = version;
    this.connectionPromise = null;
  }

  open() {
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);
      request.onupgradeneeded = () => this.upgrade(request.result, request.transaction);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn("[PWA] IndexedDB upgrade is blocked by another tab.");
    });
    return this.connectionPromise;
  }

  upgrade(db) {
    if (!db.objectStoreNames.contains("offline_operations")) {
      const store = db.createObjectStore("offline_operations", { keyPath: "id" });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("nextAttemptAt", "nextAttemptAt", { unique: false });
      store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
    }
  }

  async run(storeName, mode, executor) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try { request = executor(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(request && "result" in request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error || request?.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  put(storeName, value) { return this.run(storeName, "readwrite", store => store.put(value)); }
  delete(storeName, key) { return this.run(storeName, "readwrite", store => store.delete(key)); }
  getAll(storeName) { return this.run(storeName, "readonly", store => store.getAll()); }
  clear(storeName) { return this.run(storeName, "readwrite", store => store.clear()); }
}