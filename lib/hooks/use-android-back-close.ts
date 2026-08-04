import { useEffect, useRef } from "react";

interface UseAndroidBackCloseProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Android 返回鍵相容防線 Hook
 * - 當彈窗開啟時，自動 `pushState` 寫入虛擬記錄，鎖定 Android 實體與手勢返回鍵。
 * - 當使用者在 Android 按下返回鍵時，攔截 `popstate` 並優先執行 `onClose` 關閉彈窗。
 * - 支援多層 Modal/Drawer 嵌套（LIFO 順序）。
 * - 關閉時（不論是返回鍵或 UI 觸發）與 Unmount 時，皆會乾淨清理 History Stack 與監聽器，避免污染。
 */
export function useAndroidBackClose({ isOpen, onClose }: UseAndroidBackCloseProps) {
  const isPopStateTriggered = useRef(false);
  const modalIdRef = useRef<string>("");

  // 延遲初始化唯一的 Modal ID，避免在不必要的渲染時產生新 ID
  if (!modalIdRef.current) {
    modalIdRef.current = `modal-virtual-${Math.random().toString(36).substring(2, 11)}`;
  }

  useEffect(() => {
    if (!isOpen) return;

    const modalId = modalIdRef.current;
    isPopStateTriggered.current = false;

    // 當 Modal 開啟且當前 History State 不是我們的 Modal 時，Push 虛擬紀錄
    if (!window.history.state || window.history.state.modalId !== modalId) {
      window.history.pushState({ modalId }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      // 若 event.state 中的 modalId 與當前不同，代表當前這筆虛擬紀錄已被 pop 掉 (返回鍵被按下了)
      const currentModalIdInState = event.state?.modalId;
      if (currentModalIdInState !== modalId) {
        isPopStateTriggered.current = true;
        onClose();
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);

      // Cleanup 階段：
      // 如果關閉不是由 popstate 觸發的 (意即透過 UI 點擊 Close Btn、點 Backdrop 或 Unmount 關閉)，
      // 且當前歷史棧頂部依然是這個 Modal 的虛擬 state，我們需要將它 back 退回，清理歷史棧。
      if (!isPopStateTriggered.current) {
        if (window.history.state?.modalId === modalId) {
          window.history.back();
        }
      }
    };
  }, [isOpen, onClose]);
}
export default useAndroidBackClose;
