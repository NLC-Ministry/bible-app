export class ServiceWorkerRegistrar extends EventTarget {
  constructor({ scriptUrl = "/sw.js", scope = "/" } = {}) {
    super();
    this.scriptUrl = scriptUrl;
    this.scope = scope;
    this.registration = null;
  }

  async register() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
    this.registration = await navigator.serviceWorker.register(this.scriptUrl, {
      scope: this.scope, type: "module", updateViaCache: "none"
    });
    navigator.serviceWorker.addEventListener("message", event => {
      this.dispatchEvent(new CustomEvent("message", { detail: event.data }));
    });
    return this.registration;
  }

  requestSync() {
    navigator.serviceWorker.controller?.postMessage({ type: "SYNC_NOW" });
  }
}