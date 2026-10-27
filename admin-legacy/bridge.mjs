// 舊管理畫面（iframe）和後台外殼（admin/src/views/LegacyHost.tsx）之間的通道（#550）。
//
// 握手：iframe 對 parent 送 hello → 外殼建一條 MessageChannel，把其中一端連同 init（要開哪一區、主題）
// 送過來 → 之後全部走這條 port：要 token、匯出前記稽核、換區、主題、計畫（#620）、操作中（延後閒置登出）。
// 只收同網域、而且是 parent 送來的 init；直接開 /legacy（不在後台裡）就停在說明畫面。

export const HELLO_TYPE = "adm-legacy-hello";
export const INIT_TYPE = "adm-legacy-init";
export const REQUEST_TIMEOUT_MS = 60_000;

export function waitForBridge(win, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!win.parent || win.parent === win) {
      reject(new Error("not_embedded"));
      return;
    }
    const timer = win.setTimeout(() => {
      cleanup();
      reject(new Error("bridge_timeout"));
    }, timeoutMs);
    function onMessage(event) {
      if (event.origin !== win.location.origin || event.source !== win.parent) return;
      const data = event.data;
      const port = event.ports && event.ports[0];
      if (!data || data.type !== INIT_TYPE || !port) return;
      cleanup();
      resolve(createBridge(win, port, data));
    }
    function cleanup() {
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
    }
    win.addEventListener("message", onMessage);
    win.parent.postMessage({ type: HELLO_TYPE }, win.location.origin);
  });
}

export function createBridge(win, port, init = {}) {
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  port.onmessage = (event) => {
    const message = event.data || {};
    if (typeof message.replyTo === "number" && pending.has(message.replyTo)) {
      const { resolve, timer } = pending.get(message.replyTo);
      pending.delete(message.replyTo);
      win.clearTimeout(timer);
      resolve(message);
      return;
    }
    listeners.forEach((listener) => listener(message));
  };
  return {
    init: {
      section: typeof init.section === "string" ? init.section : "",
      theme: typeof init.theme === "string" ? init.theme : "light",
      // 外框選的計畫（#620）；null＝外框沒給，用 iframe 自己的計畫篩選
      plan: typeof init.plan === "string" && init.plan ? init.plan : null
    },
    /** 送出並等回覆（{ ok, ... }）；外殼沒回就當失敗。 */
    request(type, payload = {}) {
      seq += 1;
      const id = seq;
      return new Promise((resolve) => {
        const timer = win.setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: "bridge_timeout" });
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, timer });
        port.postMessage({ ...payload, id, type });
      });
    },
    post(type, payload = {}) {
      port.postMessage({ ...payload, type });
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
const ACTIVITY_THROTTLE_MS = 20_000;

/** 在 iframe 裡操作時，外殼的閒置計時器看不到；節流後轉告外殼。 */
export function forwardActivity(win, bridge, now = () => Date.now()) {
  let last = 0;
  const onActivity = () => {
    const at = now();
    if (at - last < ACTIVITY_THROTTLE_MS) return;
    last = at;
    bridge.post("activity");
  };
  ACTIVITY_EVENTS.forEach((name) => win.addEventListener(name, onActivity, { passive: true, capture: true }));
  return () => ACTIVITY_EVENTS.forEach((name) => win.removeEventListener(name, onActivity, { capture: true }));
}
