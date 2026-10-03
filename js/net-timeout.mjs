// 開機路徑上的網路等待上限（#415）。
//
// 兩種逾時，用途不同：
// - fetchWithTimeout：真的中斷請求。只給「中斷也沒有副作用」的請求用（讀取、
//   nlc-session 同步）。逾時丟 TypeError，跟「連不上網路」走同一條路
//   （db.isNetworkUnreachableError 認得 TypeError → 離線快照或「重試」登入卡）。
// - withSoftTimeout：呼叫端不再等，但請求本身繼續跑完。給 Logto 換 token／續期用——
//   Logto 若開了 refresh token 換發，請求已被接受卻在回應前被中斷，手上只剩作廢的
//   舊 token，下次續期會被拒、使用者就被登出。

export const BOOT_FETCH_TIMEOUT_MS = 15000;
export const DATA_READ_TIMEOUT_MS = 30000;
export const TOKEN_SOFT_TIMEOUT_MS = 15000;
export const TOKEN_LOCK_WAIT_MS = 10000;
// Logto token 請求本身的硬上限：遠大於軟逾時，只為了不讓真的卡死的請求永遠佔著跨分頁鎖。
export const TOKEN_HARD_TIMEOUT_MS = 60000;

export function createNetworkTimeoutError(ms) {
  const error = new TypeError(`Network request timed out after ${ms}ms`);
  error.code = "NETWORK_TIMEOUT";
  return error;
}

export async function fetchWithTimeout(input, init = {}, timeoutMs = BOOT_FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const outerSignal = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw createNetworkTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

// 等 promise 最多 timeoutMs；逾時就回 fallback（promise 照樣跑完，結果由它自己處理）。
export function withSoftTimeout(promise, timeoutMs, fallback) {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// navigator.locks.request 加等待上限。等不到鎖回 { acquired: false }，不執行 fn。
// 環境不支援 signal 等其他錯誤照樣丟出，讓呼叫端走原本的備用路徑。
export async function requestLockWithTimeout(locks, name, waitMs, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let granted = false;
  try {
    const value = await locks.request(name, { mode: "exclusive", signal: controller.signal }, () => {
      granted = true;
      clearTimeout(timer);
      return fn();
    });
    return { acquired: true, value };
  } catch (error) {
    if (!granted && error && error.name === "AbortError") return { acquired: false, value: undefined };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
