// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { closeTopmostModal, hideModal, isModalOpen, registerModal, showModal } from "../js/modules/modal-manager.mjs";

describe("ModalManager UI Architecture & Lifecycle Controller", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="test-modal-1" class="hidden" style="display: none;">
        <button data-modal-close id="close-btn-1">Close</button>
      </div>
      <div id="test-modal-2" class="hidden" style="display: none;"></div>
    `;
  });

  it("opens modal cleanly and syncs hidden class with display flex", () => {
    const modal1 = document.getElementById("test-modal-1");
    expect(isModalOpen("test-modal-1")).toBe(false);

    showModal("test-modal-1");

    expect(modal1.classList.contains("hidden")).toBe(false);
    expect(modal1.style.display).toBe("flex");
    expect(modal1.getAttribute("aria-hidden")).toBe("false");
    expect(isModalOpen("test-modal-1")).toBe(true);
  });

  it("closes modal cleanly and syncs hidden class with display none", () => {
    const modal1 = document.getElementById("test-modal-1");
    showModal("test-modal-1");

    hideModal("test-modal-1");

    expect(modal1.classList.contains("hidden")).toBe(true);
    expect(modal1.style.display).toBe("none");
    expect(modal1.getAttribute("aria-hidden")).toBe("true");
    expect(isModalOpen("test-modal-1")).toBe(false);
  });

  it("closes modals in LIFO order via closeTopmostModal", () => {
    showModal("test-modal-1");
    showModal("test-modal-2");

    expect(isModalOpen("test-modal-1")).toBe(true);
    expect(isModalOpen("test-modal-2")).toBe(true);

    closeTopmostModal();

    expect(isModalOpen("test-modal-2")).toBe(false);
    expect(isModalOpen("test-modal-1")).toBe(true);

    closeTopmostModal();

    expect(isModalOpen("test-modal-1")).toBe(false);
  });

  it("binds close button selectors automatically via registerModal", () => {
    registerModal("test-modal-1");
    showModal("test-modal-1");
    expect(isModalOpen("test-modal-1")).toBe(true);

    const closeBtn = document.getElementById("close-btn-1");
    closeBtn.click();

    expect(isModalOpen("test-modal-1")).toBe(false);
  });
});
