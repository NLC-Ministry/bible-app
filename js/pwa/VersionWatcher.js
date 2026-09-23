// Detects "this tab is running an old build" by comparing the build id baked
// into the running bundle with /version.json (written by scripts/bundle.mjs on
// every build, served no-store). This replaces guessing staleness from login
// failures: the app now knows directly whether it is out of date.
//
// On mismatch: ask the SW to update, then reload once at a safe moment. If the
// reload still lands on the old build (stuck SW / stale cached HTML), escalate
// to /repair exactly once per target version. sessionStorage guards make both
// steps one-shot so this can never loop.

export const VERSION_RELOAD_KEY = "nlc_version_reload_target";
export const VERSION_REPAIR_KEY = "nlc_version_repair_target";
const BUILD_ID_RE = /^\d{14}$/;

export class VersionWatcher {
  constructor({
    currentVersion,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    storage = globalThis.sessionStorage,
    location = globalThis.location,
    getRegistration = () => globalThis.navigator?.serviceWorker?.getRegistration?.(),
    isSafeToReload = () => true,
    now = () => Date.now(),
    minIntervalMs = 60000,
    updateTimeoutMs = 3000
  } = {}) {
    this.currentVersion = currentVersion;
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.location = location;
    this.getRegistration = getRegistration;
    this.isSafeToReload = isSafeToReload;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.updateTimeoutMs = updateTimeoutMs;
    this.lastCheckAt = 0;
    this.inFlight = null;
  }

  get enabled() {
    return BUILD_ID_RE.test(String(this.currentVersion || ""));
  }

  check({ force = false } = {}) {
    if (!this.enabled) return Promise.resolve("disabled");
    if (this.inFlight) return this.inFlight;
    if (!force && this.now() - this.lastCheckAt < this.minIntervalMs) return Promise.resolve("throttled");
    this.lastCheckAt = this.now();
    this.inFlight = this._check().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async fetchRemoteVersion() {
    try {
      const response = await this.fetchImpl(`/version.json?t=${this.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      const version = String(data?.version || "");
      return BUILD_ID_RE.test(version) ? version : null;
    } catch {
      return null;
    }
  }

  async _check() {
    const remote = await this.fetchRemoteVersion();
    if (!remote) return "unknown";

    if (remote === this.currentVersion) {
      this._remove(VERSION_RELOAD_KEY);
      this._remove(VERSION_REPAIR_KEY);
      return "current";
    }

    if (!this.isSafeToReload()) return "deferred";

    if (this._get(VERSION_RELOAD_KEY) === remote) {
      // Already reloaded once for this build and still running the old one.
      if (this._get(VERSION_REPAIR_KEY) === remote) return "gave-up";
      this._set(VERSION_REPAIR_KEY, remote);
      this.location.replace(`/repair?source=version&version=${this.now()}`);
      return "repair";
    }

    this._set(VERSION_RELOAD_KEY, remote);
    await this._updateServiceWorker();
    this.location.reload();
    return "reload";
  }

  async _updateServiceWorker() {
    try {
      const registration = await this.getRegistration();
      if (!registration?.update) return;
      await Promise.race([
        registration.update(),
        new Promise(resolve => setTimeout(resolve, this.updateTimeoutMs))
      ]);
    } catch {
      // A failed SW update must not block the reload; the navigation itself
      // is network-first and will still fetch the new HTML when online.
    }
  }

  _get(key) { try { return this.storage?.getItem(key) ?? null; } catch { return null; } }
  _set(key, value) { try { this.storage?.setItem(key, value); } catch { /* noop */ } }
  _remove(key) { try { this.storage?.removeItem(key); } catch { /* noop */ } }
}
