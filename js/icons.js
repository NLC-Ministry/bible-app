/**
 * IconPark Outline runtime — uses pre-built registry from icon-registry.js
 */

(function () {
  const DEFAULT_SIZE = "1em";

  function renderIcon(iconKey, options) {
    const opts = options || {};
    const registry = window.NLC_ICON_SVGS || {};
    const svg = registry[iconKey];
    if (!svg) {
      return `<span class="nlc-icon nlc-icon--missing" aria-hidden="true" data-missing-icon="${iconKey}"></span>`;
    }
    const size = opts.size || DEFAULT_SIZE;
    const className = opts.className || "nlc-icon";
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
      const size = el.getAttribute("data-icon-size") || el.dataset.iconSize || DEFAULT_SIZE;
      const extraClass = el.className || "nlc-icon";
      el.innerHTML = renderIcon(key, { size: size, className: extraClass });
    });
  }

  window.renderIcon = renderIcon;
  window.iconLabel = iconLabel;
  window.hydrateIcons = hydrateIcons;
})();
