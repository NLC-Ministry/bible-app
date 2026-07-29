// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { ResponsiveDialog } from "../ResponsiveDialog"

// 定義一個包含 Input 狀態的靜態測試用 Form 組件，避免在 render 時因為函數重新建立而導致 React Unmount / 重設 State
const TestForm = () => {
  const [val, setVal] = React.useState("")
  return (
    <div>
      <input
        data-testid="test-input"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
    </div>
  )
}

describe("ResponsiveDialog Component Tests", () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    
    // 清除 body 的屬性與殘留的 portals
    document.body.innerHTML = ""
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount()
      })
    }
    container.remove()
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  // 輔助函式：模擬 matchMedia 寬度
  function mockViewportWidth(width: number) {
    window.innerWidth = width
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      // 假設斷點設為 768px (或是自訂 query 中包含的數值)
      let matches = false
      if (query.includes("768px")) {
        matches = width >= 768
      } else if (query.includes("1024px")) {
        matches = width >= 1024
      } else {
        matches = width >= 768 // 預設
      }
      
      return {
        matches,
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

  it("當 Viewport 寬度為 1024px 時，組件確實在 DOM 中渲染為 Dialog 版面而非 Drawer", async () => {
    // 模擬電腦端寬度 1024px
    mockViewportWidth(1024)

    const handleClose = vi.fn()

    act(() => {
      root.render(
        <ResponsiveDialog
          isOpen={true}
          onClose={handleClose}
          title="電腦版標題"
          description="這是電腦版的測試彈窗描述"
        >
          <div data-testid="test-child">電腦版內容</div>
        </ResponsiveDialog>
      )
    })

    // 由於 portal 會將內容渲染到 document.body，我們直接在 body 中查找
    const contentElement = document.body.querySelector(
      '[data-testid="responsive-dialog-content"]'
    ) as HTMLElement

    expect(contentElement).toBeDefined()
    expect(contentElement).not.toBeNull()

    // 驗證 data-layout 屬性是否為 "dialog"
    const layout = contentElement.getAttribute("data-layout")
    expect(layout).toBe("dialog")

    // 驗證 CSS Class 是否包含 Dialog 版面的電腦端類別 (如 md:max-w-lg)
    expect(contentElement.className).toContain("md:max-w-lg")

    // 驗證關閉按鈕是否出現在 DOM 中
    const closeBtn = document.body.querySelector(
      '[data-testid="responsive-dialog-close-btn"]'
    ) as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    expect(closeBtn.tagName).toBe("BUTTON")
    expect(closeBtn.getAttribute("aria-label")).toBe("Close")

    act(() => {
      closeBtn.click()
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it("當 Viewport 寬度為 480px 時，組件確實在 DOM 中渲染為 Drawer 版面", async () => {
    // 模擬手機端寬度 480px
    mockViewportWidth(480)

    act(() => {
      root.render(
        <ResponsiveDialog
          isOpen={true}
          onClose={vi.fn()}
          title="手機版標題"
        >
          <div data-testid="test-child">手機版內容</div>
        </ResponsiveDialog>
      )
    })

    const contentElement = document.body.querySelector(
      '[data-testid="responsive-dialog-content"]'
    ) as HTMLElement

    expect(contentElement).not.toBeNull()

    // 驗證 data-layout 屬性是否為 "drawer"
    const layout = contentElement.getAttribute("data-layout")
    expect(layout).toBe("drawer")

    // 驗證 CSS Class 是否包含手機端特定的 rounded-t 上圓角類別
    expect(contentElement.className).toContain("rounded-t-[20px]")

    // 手機端不應顯示電腦端的關閉 X 按鈕
    const closeBtn = document.body.querySelector(
      '[data-testid="responsive-dialog-close-btn"]'
    )
    expect(closeBtn).toBeNull()
  })

  it("響應式視窗大小切換時，輸入表單內的 state 資料必須 100% 保持一致，不因解耦而丟失", async () => {
    // 1. 先模擬手機端環境渲染彈窗
    mockViewportWidth(375)

    act(() => {
      root.render(
        <ResponsiveDialog
          isOpen={true}
          onClose={vi.fn()}
          title="資料一致性測試"
        >
          <TestForm />
        </ResponsiveDialog>
      )
    })

    // 模擬使用者輸入數值
    const input = document.body.querySelector(
      '[data-testid="test-input"]'
    ) as HTMLInputElement
    expect(input).not.toBeNull()

    act(() => {
      // 模擬輸入 'Antigravity React State Test' (繞過 React 的 value 追蹤機制)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, "Antigravity React State Test")
      } else {
        input.value = "Antigravity React State Test"
      }
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // 驗證數值輸入成功
    expect(input.value).toBe("Antigravity React State Test")

    // 2. 模擬螢幕旋轉或視窗調整至電腦版 (1280px)
    mockViewportWidth(1280)

    // 重新觸發 Render 以反應新的媒體查詢狀態
    await act(async () => {
      root.render(
        <ResponsiveDialog
          isOpen={true}
          onClose={vi.fn()}
          title="資料一致性測試"
        >
          <TestForm />
        </ResponsiveDialog>
      )
      // 讓 media query 變更的 useEffect 和 state 更新順利執行並重新渲染
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // 重新取得 Input 元素
    const updatedInput = document.body.querySelector(
      '[data-testid="test-input"]'
    ) as HTMLInputElement
    const contentElement = document.body.querySelector(
      '[data-testid="responsive-dialog-content"]'
    ) as HTMLElement

    // 驗證版面已經切換為 dialog
    expect(contentElement.getAttribute("data-layout")).toBe("dialog")

    // 關鍵斷言：輸入框的值必須依然存在，沒有因為 unmount/remount 而丟失！
    expect(updatedInput.value).toBe("Antigravity React State Test")
  })
})
