// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { ResponsiveModal } from "../responsive-modal"

describe("ResponsiveModal Android Back Button Interception Tests", () => {
  let container: HTMLDivElement
  let root: any
  let pushStateSpy: any
  let backSpy: any

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    // 清除 body portal 及狀態
    document.body.innerHTML = ""
    document.body.appendChild(container)

    // Mock history API
    pushStateSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {})

    // 重設 history.state
    Object.defineProperty(window.history, "state", {
      value: null,
      writable: true,
      configurable: true,
    })
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount()
      })
    }
    container.remove()
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  });

  // 輔助函式：模擬 matchMedia 寬度
  function mockViewportWidth(width: number) {
    window.innerWidth = width
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      return {
        matches: width >= 768,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    })
  }

  it("當彈窗開啟 (isOpen=true) 時，應調用 pushState 寫入虛擬 state", () => {
    mockViewportWidth(1024)

    act(() => {
      root.render(
        <ResponsiveModal isOpen={true} onClose={vi.fn()} title="測試彈窗">
          <div>內容</div>
        </ResponsiveModal>
      )
    })

    // 驗證 pushState 被呼叫，且帶有 modalId 的 state 參數
    expect(pushStateSpy).toHaveBeenCalledTimes(1)
    const pushStateArgs = pushStateSpy.mock.calls[0]
    expect(pushStateArgs[0]).toHaveProperty("modalId")
    expect(pushStateArgs[0].modalId).toContain("modal-virtual-")
  });

  it("當使用者觸發 popstate (例如按返回鍵) 且歷史紀錄的 modalId 改變時，應觸發 onClose", () => {
    mockViewportWidth(1024)
    const handleClose = vi.fn()

    // 模擬 pushState 更新了 history.state
    pushStateSpy.mockImplementation((state: any) => {
      Object.defineProperty(window.history, "state", {
        value: state,
        writable: true,
        configurable: true,
      })
    })

    act(() => {
      root.render(
        <ResponsiveModal isOpen={true} onClose={handleClose} title="測試彈窗">
          <div>內容</div>
        </ResponsiveModal>
      )
    })

    expect(pushStateSpy).toHaveBeenCalledTimes(1)

    // 模擬返回鍵被按下，這會使得 history state 回退 (例如變為 null，代表 modalId 消失了)
    Object.defineProperty(window.history, "state", {
      value: null,
      writable: true,
      configurable: true,
    })

    act(() => {
      // 觸發 popstate 事件
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }))
    })

    // 驗證 onClose 被正確執行
    expect(handleClose).toHaveBeenCalledTimes(1)
  });

  it("當透過 UI 觸發關閉 (非返回鍵，即 onClose 被其他按鈕觸發且元件更新 isOpen=false) 時，應調用 history.back() 清除虛擬紀錄", () => {
    mockViewportWidth(1024)
    const handleClose = vi.fn()

    pushStateSpy.mockImplementation((state: any) => {
      Object.defineProperty(window.history, "state", {
        value: state,
        writable: true,
        configurable: true,
      })
    })

    // 渲染開啟狀態
    act(() => {
      root.render(
        <ResponsiveModal isOpen={true} onClose={handleClose} title="測試彈窗">
          <div>內容</div>
        </ResponsiveModal>
      )
    })

    expect(pushStateSpy).toHaveBeenCalledTimes(1)

    // 模擬 UI 關閉（如點擊關閉，外部狀態變更，使得 isOpen 變為 false 重新渲染）
    act(() => {
      root.render(
        <ResponsiveModal isOpen={false} onClose={handleClose} title="測試彈窗">
          <div>內容</div>
        </ResponsiveModal>
      )
    })

    // 驗證 history.back() 有被呼叫用以清除歷史棧
    expect(backSpy).toHaveBeenCalledTimes(1)
  });

  it("當元件直接 Unmount 時，應清理 History Stack (調用 history.back())，避免造成 History 污染", () => {
    mockViewportWidth(1024)

    pushStateSpy.mockImplementation((state: any) => {
      Object.defineProperty(window.history, "state", {
        value: state,
        writable: true,
        configurable: true,
      })
    })

    act(() => {
      root.render(
        <ResponsiveModal isOpen={true} onClose={vi.fn()} title="測試彈窗">
          <div>內容</div>
        </ResponsiveModal>
      )
    })

    expect(pushStateSpy).toHaveBeenCalledTimes(1)

    // Unmount 元件
    act(() => {
      root.unmount()
      root = null
    })

    // 驗證 history.back() 有被呼叫
    expect(backSpy).toHaveBeenCalledTimes(1)
  });
});
