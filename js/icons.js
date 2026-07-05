/**
 * Lucide icon runtime — uses pre-built registry from icon-registry.js
 */

(function () {
  const DEFAULT_SIZE = "1em";
  const SIZE_CLASS_PREFIX = "nlc-icon--";
  /** Component classes that pin icons to xs — use solid Fill variants automatically. */
  const XS_RECIPE_CLASSES = ["dashboard-stat-strip__icon", "search-icon-inside"];

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

  function isXsElement(el) {
    if (!el || !el.classList) return false;
    if (el.classList.contains("nlc-icon--xs")) return true;
    for (let i = 0; i < XS_RECIPE_CLASSES.length; i++) {
      if (el.classList.contains(XS_RECIPE_CLASSES[i])) return true;
    }
    return false;
  }

  function isXsSize(size) {
    if (!size || size === DEFAULT_SIZE) return false;
    if (size === "xs") return true;
    const registry = window.NLC_ICON_SIZES || {};
    return resolveIconSize(size) === registry.xs;
  }

  function resolveSolidIconKey(iconKey, options) {
    const registry = window.NLC_ICON_SVGS || {};
    if (!iconKey || iconKey.endsWith("Fill")) return iconKey;
    const opts = options || {};
    const useSolid =
      opts.solid === true || isXsSize(opts.size) || (opts.element && isXsElement(opts.element));
    if (!useSolid) return iconKey;
    const fillKey = iconKey + "Fill";
    return registry[fillKey] ? fillKey : iconKey;
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
    const resolvedKey = resolveSolidIconKey(iconKey, opts);
    const svg = registry[resolvedKey];
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
      let size = dataSize || classSize || DEFAULT_SIZE;
      if (size === DEFAULT_SIZE && isXsElement(el)) size = "xs";
      applyIconSize(el, size);
      el.innerHTML = renderIcon(key, { size: size, element: el });
    });
  }

  window.resolveIconSize = resolveIconSize;
  window.resolveSolidIconKey = resolveSolidIconKey;
  window.renderIcon = renderIcon;
  window.iconLabel = iconLabel;
  window.hydrateIcons = hydrateIcons;
})();
