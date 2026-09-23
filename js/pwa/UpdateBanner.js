// Non-blocking "有新版本" prompt, shown only when VersionWatcher found a newer
// build but could not reload silently (user typing, TTS playing, unsynced
// queue). Tapping 更新 reloads now; closing hides it until a newer build than
// the dismissed one appears. The next safe foreground reloads automatically
// anyway, so ignoring the banner is fine.

const BANNER_ID = "app-update-banner";

export function createUpdateBanner({
  onUpdate,
  doc = globalThis.document,
  renderIcon = (key, opts) => globalThis.window?.renderIcon?.(key, opts) || ""
} = {}) {
  let dismissedVersion = null;

  function remove() {
    doc.getElementById(BANNER_ID)?.remove();
  }

  function show(version) {
    if (version && version === dismissedVersion) return;
    if (doc.getElementById(BANNER_ID)) return;

    const banner = doc.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      "bottom:calc(85px + env(safe-area-inset-bottom, 0px))",
      "margin:0 auto",
      "max-width:480px",
      "z-index:9998",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "padding:10px 10px 10px 16px",
      "border-radius:12px",
      "background:var(--bg-card, #fff)",
      "border:1px solid var(--border-card, #e5e5e5)",
      "color:var(--text-primary, #171717)",
      `box-shadow:${globalThis.window?.NLC_SHADOW?.lg || "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"}`,
      "font-size:0.9rem",
      "font-weight:400"
    ].join(";");

    const text = doc.createElement("span");
    text.style.cssText = "flex:1;min-width:0;line-height:1.4";
    text.textContent = "有新版本可以更新";

    const update = doc.createElement("button");
    update.type = "button";
    update.dataset.action = "update";
    update.style.cssText = "display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;padding:8px 14px;background:var(--color-brand, #04A9D2);color:var(--color-brand-foreground, #fff);font-size:0.88rem;font-weight:500;cursor:pointer;white-space:nowrap";
    update.innerHTML = `${renderIcon("refresh", { size: 16 })}<span>更新</span>`;
    const label = () => update.lastElementChild;
    const reset = () => {
      update.disabled = false;
      label().textContent = "再試一次";
    };
    update.addEventListener("click", () => {
      update.disabled = true;
      label().textContent = "更新中…";
      // onUpdate resolves to the VersionWatcher result: "reload"/"repair" are
      // navigating away; "current" means nothing left to do; anything else
      // (offline → "unknown") must give the button back.
      Promise.resolve(onUpdate?.()).then(result => {
        if (result === "current") remove();
        else if (result !== "reload" && result !== "repair") reset();
      }, reset);
    });

    const close = doc.createElement("button");
    close.type = "button";
    close.dataset.action = "dismiss";
    close.setAttribute("aria-label", "稍後再說");
    close.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--text-muted, #737373);cursor:pointer";
    close.innerHTML = renderIcon("close", { size: 16 }) || "×";
    close.addEventListener("click", () => {
      dismissedVersion = version || null;
      remove();
    });

    banner.append(text, update, close);
    doc.body.appendChild(banner);
  }

  return { show, remove };
}
