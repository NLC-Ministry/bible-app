import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('語音包安裝指引 Modal 點擊開關測試', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <button type="button" id="btn-show-tts-guide" onclick="window.openTtsGuideModal?.()">
          💡 語音包安裝指引
        </button>
        <div id="tts-guide-modal" class="tts-guide-modal-overlay hidden" style="display: none;">
          <button type="button" id="btn-close-tts-guide" onclick="window.closeTtsGuideModal?.()">&times;</button>
          <button type="button" id="btn-confirm-tts-guide" onclick="window.closeTtsGuideModal?.()">我知道了</button>
        </div>
      </body>
      </html>
    `, { runScripts: "dangerously" });

    window = dom.window;
    document = window.document;

    window.openTtsGuideModal = function () {
      const modal = document.getElementById("tts-guide-modal");
      if (!modal) return false;
      modal.classList.remove("hidden");
      modal.style.display = "flex";
      modal.style.opacity = "1";
      modal.style.pointerEvents = "auto";
      modal.style.visibility = "visible";
      modal.setAttribute("aria-hidden", "false");
      return true;
    };

    window.closeTtsGuideModal = function () {
      const modal = document.getElementById("tts-guide-modal");
      if (!modal) return false;
      modal.classList.add("hidden");
      modal.style.display = "none";
      modal.style.opacity = "0";
      modal.style.pointerEvents = "none";
      modal.style.visibility = "hidden";
      modal.setAttribute("aria-hidden", "true");
      return true;
    };

    document.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest ? e.target.closest("#btn-show-tts-guide, [data-action='open-tts-guide']") : null;
      if (btn) {
        e.preventDefault();
        window.openTtsGuideModal();
      }
      const closeBtn = e.target && e.target.closest ? e.target.closest("#btn-close-tts-guide, #btn-confirm-tts-guide, [data-action='close-tts-guide']") : null;
      if (closeBtn) {
        e.preventDefault();
        window.closeTtsGuideModal();
      }
    });
  });

  it('初始狀態 tts-guide-modal 應為隱藏狀態 (hidden)', () => {
    const modal = document.getElementById('tts-guide-modal');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('點擊 #btn-show-tts-guide 應可成功移除 hidden 並顯示彈窗 (display: flex)', () => {
    const btnShow = document.getElementById('btn-show-tts-guide');
    const modal = document.getElementById('tts-guide-modal');

    btnShow.click();

    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.style.display).toBe('flex');
  });

  it('開啟狀態下點擊 #btn-close-tts-guide 應可成功關閉彈窗 (hidden)', () => {
    const btnShow = document.getElementById('btn-show-tts-guide');
    const btnClose = document.getElementById('btn-close-tts-guide');
    const modal = document.getElementById('tts-guide-modal');

    btnShow.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    btnClose.click();
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');
  });

  it('開啟狀態下點擊 #btn-confirm-tts-guide 應可成功關閉彈窗 (hidden)', () => {
    const btnShow = document.getElementById('btn-show-tts-guide');
    const btnConfirm = document.getElementById('btn-confirm-tts-guide');
    const modal = document.getElementById('tts-guide-modal');

    btnShow.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    btnConfirm.click();
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');
  });
});
