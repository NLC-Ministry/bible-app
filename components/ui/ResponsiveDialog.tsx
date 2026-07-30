import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "../../lib/utils"

/**
 * 響應式媒體查詢 Hook
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia(query).matches
    }
    return false
  })

  // 在 Render 階段進行狀態同步 (React 官方推薦的衍生狀態模式)
  // 這確保當測試中直接修改 mock matchMedia 或是視窗大小變更重新 render 時，狀態能即時更新
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const freshMatches = window.matchMedia(query).matches
    if (freshMatches !== matches) {
      setMatches(freshMatches)
    }
  }

  React.useEffect(() => {
    const media = window.matchMedia(query)
    const listener = () => setMatches(media.matches)
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [query])

  return matches
}

export interface ResponsiveDialogProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  /**
   * 允許自訂響應式斷點，預設為 (min-width: 768px) 代表 md 斷點
   */
  breakpointQuery?: string
}

/**
 * 響應式雙端彈窗元件 (ResponsiveDialog)
 * - 手機端 (< 768px)：底部滑出式抽屜 (Drawer)
 * - 電腦端 (>= 768px)：畫面中央浮動彈窗 (Dialog)
 * - 採用單一 DOM 樹架構，切換視窗尺寸時不會觸發 React Unmount，100% 完整保留 Form 表單與 Input 狀態值！
 */
export function ResponsiveDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  breakpointQuery = "(min-width: 768px)",
}: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(breakpointQuery)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  // 防止 SSR 水合錯誤
  if (!mounted || !isOpen) return null

  const overlay = (
    <div
      className={cn(
        "fixed inset-0 z-50 flex bg-black/60 backdrop-blur-[4px] transition-all duration-300 ease-out",
        isDesktop ? "items-center justify-center p-4 animate-in fade-in" : "items-end justify-center"
      )}
      onClick={onClose}
      data-testid="responsive-dialog-overlay"
      data-layout={isDesktop ? "dialog" : "drawer"}
    >
      {/* 彈窗主體外盒 */}
      <div
        className={cn(
          "bg-card text-card-foreground shadow-2xl border border-border/80 flex flex-col w-full outline-none",
          // 1. 手機端樣式 (Drawer)：底部吸附、寬度 100%、上方圓角、滑出動畫
          "rounded-t-[20px] max-h-[85vh] p-6 pb-8 transition-transform duration-300 ease-out translate-y-0 animate-in slide-in-from-bottom",
          // 2. 電腦端樣式 (Dialog)：中央浮動、寬度限制、四周圓角、縮放動畫
          isDesktop && "md:rounded-xl md:max-w-lg md:max-h-[90vh] md:p-6 md:my-8 md:translate-y-0 md:zoom-in-95 md:duration-200",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid="responsive-dialog-content"
        data-layout={isDesktop ? "dialog" : "drawer"}
      >
        {/* 手機端頂部拉條 Handle */}
        {!isDesktop && (
          <div className="mx-auto -mt-2 mb-4 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors" />
        )}

        {/* 標題與描述區 */}
        <div className="flex flex-col gap-1.5 text-left mb-3">
          <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground select-none">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground leading-normal">
              {description}
            </p>
          )}
        </div>

        {/* 彈窗內容區 (保留捲動機制) */}
        <div className="flex-1 overflow-y-auto py-2 text-sm leading-relaxed text-foreground/90 scrollbar-thin">
          {children}
        </div>

        {/* 底部按鈕區 */}
        {footer && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 mt-4 pt-2 border-t border-border/30">
            {footer}
          </div>
        )}

        {/* 電腦端專屬關閉按鈕 */}
        {isDesktop && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full opacity-70 hover:opacity-100"
            aria-label="Close"
            data-testid="responsive-dialog-close-btn"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
