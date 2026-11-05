// #674：Edge Function 的快取。分兩層，放東西前先想清楚是哪一層：
//
//   · 請求層（createRequestCache）：每個 HTTP 請求建一份，請求結束就丟。範圍、隊伍這類「看人」的結果只能放這裡。
//   · 模組層（createTtlCache、createFeatureFlagCache、createOrgPruneGate）：Edge Function 的模組變數跨請求、跨使用者共用，
//     同一個 isolate 的所有人都看得到。只能放不分人的資料（功能開關、角色定義），或鍵本身已驗證過的資料（見 nlc-data 的 PROFILE_CACHE）。
//
// 模組層快取每個 isolate 各一份：一個 isolate 裡的清除碰不到其他 isolate，所以「改了多久生效」的上限永遠是 TTL。

/** 同一個請求裡同一件事只做一次；並行的呼叫共用同一個 promise（失敗也共用，不重試）。 */
export function createRequestCache() {
  const entries = new Map();
  return {
    once(key, load) {
      if (!entries.has(key)) entries.set(key, Promise.resolve().then(load));
      return entries.get(key);
    }
  };
}

/** Map 依寫入順序排，每筆 TTL 相同，所以最舊的一定在最前面。清理只走到第一筆還沒過期的為止。 */
export function createTtlCache({ ttlMs, maxEntries = 5000, now = () => Date.now() }) {
  const entries = new Map();
  const dropExpired = (at) => {
    for (const [key, entry] of entries) {
      if (at - entry.storedAt < ttlMs) break;
      entries.delete(key);
    }
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      const at = now();
      dropExpired(at);
      entries.delete(key);
      entries.set(key, { value, storedAt: at });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}

/**
 * 功能開關（app_feature_settings 整張表，只有幾列、不含個資）的模組快取。一次讀全部，
 * 所以一批裡不管碰到幾個開關都只有一趟。
 * · 讀取失敗：這次全部當關閉（fail closed），但不快取——不能因為一次失敗把功能關掉 ttlMs 那麼久。
 * · 開著的和關著的都快取，所以開、關兩個方向的延遲上限都是 ttlMs。
 * · 正在讀的時候被 clear()：讀到的可能是改之前的值，不存，下一次重讀。
 */
export function createFeatureFlagCache({ ttlMs, now = () => Date.now() }) {
  let cached = null;
  let inFlight = null;
  let generation = 0;

  const load = async (client, startedGeneration) => {
    try {
      const { data, error } = await client.from("app_feature_settings").select("key, enabled");
      if (error) throw error;
      const flags = new Map((data || []).map((row) => [row.key, row.enabled === true]));
      if (startedGeneration === generation) cached = { flags, storedAt: now() };
      return flags;
    } catch (err) {
      console.warn(JSON.stringify({ event: "feature_flag_read_failed", message: err instanceof Error ? err.message : String(err?.message || err) }));
      return new Map();
    } finally {
      inFlight = null;
    }
  };

  return {
    /** 回傳 Map<key, boolean>，永遠不會 reject；查不到的 key 一律視為關閉。 */
    snapshot(client) {
      if (cached && now() - cached.storedAt < ttlMs) return Promise.resolve(cached.flags);
      if (!inFlight) inFlight = load(client, generation);
      return inFlight;
    },
    clear() {
      cached = null;
      inFlight = null;
      generation += 1;
    }
  };
}

/**
 * 登入時順手清組織節點（prune_orphaned_church_org_nodes）的閘門：每次登入都跑會對 profiles 做 3 次
 * NOT EXISTS DELETE。抽中機率讓尖峰時新開的 isolate 不會同時都跑，時間間隔限制單一 isolate 的次數。
 */
export function createOrgPruneGate({ minIntervalMs, probability, now = () => Date.now(), random = () => Math.random() }) {
  let lastRunAt = null;
  return {
    allow() {
      if (lastRunAt !== null && now() - lastRunAt < minIntervalMs) return false;
      if (random() >= probability) return false;
      lastRunAt = now();
      return true;
    }
  };
}
