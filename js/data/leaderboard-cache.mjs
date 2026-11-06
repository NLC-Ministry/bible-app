// 排行榜的記憶體快取（#667）：60 秒內不重抓，超過先回舊資料、背景重抓，有變才通知畫面。
// 只放記憶體：排行不進 IndexedDB／localStorage／Service Worker（docs/pwa-architecture.md），
// 共用手機時也不會留在裝置上。鍵含使用者 id，換帳號不可能命中別人的資料。
//
// 只存成功的結果。還沒拿到使用者 id 或計畫 id 就直接抓，不經過快取。
// 自己寫入（打卡、加入團隊…）後呼叫 invalidate：連同還在路上的舊請求一起作廢，
// 寫入前發出去的讀取就算晚回來也不會寫回快取。

export const LEADERBOARD_FRESH_MS = 60 * 1000;

const copy = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const isCacheable = (value) => Boolean(value && value.success === true);

export function createLeaderboardCache({
  now = () => Date.now(),
  freshMs = LEADERBOARD_FRESH_MS,
  onChange = () => {}
} = {}) {
  const entries = new Map();
  const inFlight = new Map();
  let generation = 0;

  const keyOf = ({ kind, planId, userId }) => JSON.stringify([kind, planId, userId]);
  const isStale = (entry) => !entry.ended && now() - entry.fetchedAt >= freshMs;

  const fetchAndStore = (key, meta) => {
    const running = inFlight.get(key);
    if (running) return running;
    const startedIn = generation;
    const promise = Promise.resolve()
      .then(meta.fetcher)
      .then((value) => {
        if (isCacheable(value) && startedIn === generation) {
          entries.set(key, { ...meta, value: copy(value), json: JSON.stringify(value), fetchedAt: now() });
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
    inFlight.set(key, promise);
    return promise;
  };

  const revalidate = (key, entry) => {
    fetchAndStore(key, entry)
      .then(() => {
        const latest = entries.get(key);
        if (latest && latest.json !== entry.json) onChange({ kind: entry.kind, planId: entry.planId, reason: "refreshed" });
      })
      .catch(() => {}); // 背景重抓失敗：畫面留著舊資料，下次再試
  };

  return {
    async read({ kind, planId, userId, ended = false, fetcher }) {
      if (!planId || !userId) return fetcher();
      const key = keyOf({ kind, planId, userId });
      const meta = { kind, planId, userId, ended, fetcher };
      const entry = entries.get(key);
      if (entry) {
        const current = { ...entry, ended, fetcher };
        entries.set(key, current);
        if (isStale(current)) revalidate(key, current);
        return copy(current.value);
      }
      const value = await fetchAndStore(key, meta);
      return isCacheable(value) ? copy(value) : value;
    },

    // 回前景用：這個計畫有過期的就在背景重抓，有變才會 onChange
    revalidateStale({ planId, userId }) {
      for (const [key, entry] of entries) {
        if (entry.planId === planId && entry.userId === userId && isStale(entry)) revalidate(key, entry);
      }
    },

    // 給 planId：清掉這個計畫的全部。不給：清掉全部計畫，但已結束的計畫資料不會再變，留著。
    invalidate(planId = null) {
      generation += 1;
      inFlight.clear();
      let removed = false;
      for (const [key, entry] of entries) {
        if (planId ? entry.planId === planId : !entry.ended) {
          entries.delete(key);
          removed = true;
        }
      }
      if (removed) onChange({ kind: null, planId, reason: "invalidated" });
    },

    clear() {
      generation += 1;
      inFlight.clear();
      entries.clear();
    }
  };
}
