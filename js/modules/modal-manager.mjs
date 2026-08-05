/**
 * ModalManager - Centralized Overlay Lifecycle & Modal Stack Management
 */

const activeModalStack = [];

function resolveElement(target) {
  if (!target) return null;
  if (typeof target === "string") {
    return document.getElementById(target);
  }
  if (target instanceof HTMLElement) {
    return target;
  }
  return null;
}

export function isModalOpen(target) {
  const el = resolveElement(target);
  if (!el) return false;
  return !el.classList.contains("hidden") && el.style.display !== "none";
}

export function showModal(target, options = {}) {
  const el = resolveElement(target);
  if (!el) return false;

  const displayStyle = options.display || "flex";

  el.classList.remove("hidden");
  el.style.display = displayStyle;
  el.style.opacity = "1";
  el.style.pointerEvents = "auto";
  el.style.visibility = "visible";
  el.setAttribute("aria-hidden", "false");

  // Prevent duplicate stack entries
  const existingIdx = activeModalStack.indexOf(el);
  if (existingIdx !== -1) {
    activeModalStack.splice(existingIdx, 1);
  }
  activeModalStack.push(el);

  if (typeof options.onOpen === "function") {
    options.onOpen(el);
  }

  return true;
}

export function hideModal(target, options = {}) {
  const el = resolveElement(target);
  if (!el) return false;

  el.classList.add("hidden");
  el.style.display = "none";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.style.visibility = "hidden";
  el.setAttribute("aria-hidden", "true");

  const idx = activeModalStack.indexOf(el);
  if (idx !== -1) {
    activeModalStack.splice(idx, 1);
  }

  if (typeof options.onClose === "function") {
    options.onClose(el);
  }

  return true;
}

export function closeTopmostModal() {
  if (activeModalStack.length === 0) return false;
  const topModal = activeModalStack[activeModalStack.length - 1];
  return hideModal(topModal);
}

export function registerModal(modalId, options = {}) {
  const el = resolveElement(modalId);
  if (!el) return null;

  // Bind close buttons inside modal
  const closeSelectors = options.closeSelectors || ["[data-close-modal]", "[data-modal-close]"];
  closeSelectors.forEach(selector => {
    const btns = el.querySelectorAll(selector);
    btns.forEach(btn => {
      btn.removeEventListener("click", el._modalCloseHandler);
      const handler = (e) => {
        e.preventDefault();
        hideModal(el);
      };
      btn.addEventListener("click", handler);
    });
  });

  // Bind backdrop click
  if (options.backdropDismiss !== false) {
    el.addEventListener("click", (e) => {
      if (e.target === el) {
        hideModal(el);
      }
    });
  }

  return el;
}

export function initModalManager() {
  if (typeof window === "undefined") return;

  window.removeEventListener("keydown", handleGlobalEscKey);
  window.addEventListener("keydown", handleGlobalEscKey);

  // Global event delegation for modal triggers & close actions
  document.removeEventListener("click", handleGlobalModalClickDelegation);
  document.addEventListener("click", handleGlobalModalClickDelegation);
}

function handleGlobalEscKey(e) {
  if (e.key === "Escape" || e.key === "Esc") {
    if (activeModalStack.length > 0) {
      closeTopmostModal();
    }
  }
}

function handleGlobalModalClickDelegation(e) {
  const openGuideBtn = e.target.closest("#btn-show-tts-guide, [data-open-tts-guide]");
  if (openGuideBtn) {
    e.preventDefault();
    showModal("tts-guide-modal");
    return;
  }

  const closeGuideBtn = e.target.closest("#btn-close-tts-guide, #btn-confirm-tts-guide, [data-close-tts-guide]");
  if (closeGuideBtn) {
    e.preventDefault();
    hideModal("tts-guide-modal");
  }
}

// Expose on window for vanilla JS & early HTML inline calls compatibility
if (typeof window !== "undefined") {
  window.openTtsGuideModal = function () {
    return showModal("tts-guide-modal");
  };

  window.closeTtsGuideModal = function () {
    return hideModal("tts-guide-modal");
  };

  window.ModalManager = {
    showModal,
    hideModal,
    closeTopmostModal,
    isModalOpen,
    registerModal,
    initModalManager,
    get activeStack() { return activeModalStack; }
  };
}
