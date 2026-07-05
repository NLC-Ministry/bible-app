/**
 * Lucide icon runtime — uses pre-built registry from icon-registry.js
 */

(function () {
  const DEFAULT_SIZE = "1em";
  const SIZE_CLASS_PREFIX = "nlc-icon--";

  function resolveIconSize(size) {
    if (!size || size === DEFAULT_SIZE) return size || DEFAULT_SIZE;
    const registry = window.NLC_ICON_SIZES || {};
    if (registry[size]) return registry[size];
    return size;
  }

  function inferSizeClassFromElement(el) {
    if (!el || !el.classList) return null;
    for (let i = 0; i < el.classList.length; i++) {
      const cls = el.classList[i];
      if (cls.indexOf(SIZE_CLASS_PREFIX) === 0 && cls.length > SIZE_CLASS_PREFIX.length) {
        return cls.slice(SIZE_CLASS_PREFIX.length);
      }
    }
    return null;
  }

  function applyIconSize(el, size) {
    const resolved = resolveIconSize(size);
    if (resolved && resolved !== DEFAULT_SIZE) {
      el.style.setProperty("--nlc-icon-size", resolved);
    }
    return resolved;
  }

  function renderIcon(iconKey, options) {
    const opts = options || {};
    const registry = window.NLC_ICON_SVGS || {};
    const svg = registry[iconKey];
    if (!svg) {
      return `<span class="nlc-icon nlc-icon--missing" aria-hidden="true" data-missing-icon="${iconKey}"></span>`;
    }
    const size = resolveIconSize(opts.size || DEFAULT_SIZE);
    const className = opts.className || "nlc-icon__svg";
    const sized = svg
      .replace(/\swidth="[^"]*"/, ` width="${size}"`)
      .replace(/\sheight="[^"]*"/, ` height="${size}"`);
    return sized.replace("<svg", `<svg class="${className}" aria-hidden="true" focusable="false"`);
  }

  function iconLabel(iconKey, text) {
    return `<span class="btn-with-icon">${renderIcon(iconKey, { className: "nlc-icon nlc-icon--inline" })}<span>${text}</span></span>`;
  }

  function hydrateIcons(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-icon]").forEach(function (el) {
      if (el.querySelector("svg")) return;
      const key = el.getAttribute("data-icon");
      const dataSize = el.getAttribute("data-icon-size") || el.dataset.iconSize;
      const classSize = inferSizeClassFromElement(el);
      const size = dataSize || classSize || DEFAULT_SIZE;
      applyIconSize(el, size);
      el.innerHTML = renderIcon(key, { size: size });
    });
  }

  window.resolveIconSize = resolveIconSize;
  window.renderIcon = renderIcon;
  window.iconLabel = iconLabel;
  window.hydrateIcons = hydrateIcons;
})();
