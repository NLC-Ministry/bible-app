// Detects "this tab is running an old build" by comparing the build id baked
// into the running bundle with /version.json (written by scripts/bundle.mjs on
// every build, served no-store). This replaces guessing staleness from login
// failures: the app now knows directly whether it is out of date.
//
// On mismatch: ask the SW to update, then reload once at a safe moment. If the
// reload still lands on the old build (stuck SW / stale cached HTML), escalate
// to /repair exactly once per target version. sessionStorage guards make both
// steps one-shot so this can never loop.
//
// Not a safe moment (typing, TTS, unsynced queue) → report it through
// onUpdateAvailable so the UI can offer a tap-to-update banner; the user's tap
// calls check({ force: true, ignoreSafety: true }). Exception: a running build
// older than /version.json's minVersion (release-policy.json, for breaking
// backend changes) reloads immediately regardless of safety.

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
    onUpdateAvailable = () => {},
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
    this.onUpdateAvailable = onUpdateAvailable;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.updateTimeoutMs = updateTimeoutMs;
    this.lastCheckAt = 0;
    this.inFlight = null;
  }

  get enabled() {
    return BUILD_ID_RE.test(String(this.currentVersion || ""));
  }

  check({ force = false, ignoreSafety = false } = {}) {
    if (!this.enabled) return Promise.resolve("disabled");
    if (this.inFlight) return this.inFlight;
    if (!force && this.now() - this.lastCheckAt < this.minIntervalMs) return Promise.resolve("throttled");
    this.lastCheckAt = this.now();
    this.inFlight = this._check({ ignoreSafety }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async fetchRemoteVersion() {
    try {
      const response = await this.fetchImpl(`/version.json?t=${this.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      const version = String(data?.version || "");
      if (!BUILD_ID_RE.test(version)) return null;
      const minVersion = String(data?.minVersion || "");
      return { version, minVersion: BUILD_ID_RE.test(minVersion) ? minVersion : null };
    } catch {
      return null;
    }
  }

  async _check({ ignoreSafety }) {
    const info = await this.fetchRemoteVersion();
    if (!info) return "unknown";
    const remote = info.version;

    if (remote === this.currentVersion) {
      this._remove(VERSION_RELOAD_KEY);
      this._remove(VERSION_REPAIR_KEY);
      return "current";
    }

    // Build ids are UTC timestamps (YYYYMMDDHHmmss), so string order = time order.
    const forced = Boolean(info.minVersion) && this.currentVersion < info.minVersion;
    if (!forced && !ignoreSafety && !this.isSafeToReload()) {
      try { this.onUpdateAvailable(remote); } catch { /* UI must not break the check */ }
      return "deferred";
    }

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
