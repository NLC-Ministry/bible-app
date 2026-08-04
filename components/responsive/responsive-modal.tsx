import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { useMediaQuery } from "../ui/ResponsiveDialog"
import { useAndroidBackClose } from "../../lib/hooks/use-android-back-close"

export interface ResponsiveModalProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  breakpointQuery?: string
}

/**
 * 響應式雙端彈窗元件 (ResponsiveModal)
 * - 手機端 (< 768px)：底部滑出式抽屜 (Drawer)
 * - 電腦端 (>= 768px)：畫面中央浮動彈窗 (Dialog)
 * - 整合 `useAndroidBackClose` 確保實體與手勢返回鍵相容。
 */
export function ResponsiveModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  breakpointQuery = "(min-width: 768px)",
}: ResponsiveModalProps) {
  // 綁定 Android 返回鍵相容防線 Hook
  useAndroidBackClose({ isOpen, onClose })

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
      data-testid="responsive-modal-overlay"
      data-layout={isDesktop ? "dialog" : "drawer"}
    >
      <div
        className={cn(
          "bg-card text-card-foreground shadow-2xl border border-border/80 flex flex-col w-full outline-none",
          // 手機端 (Drawer)：底部吸附、圓角、滑出動畫
          "rounded-t-[20px] max-h-[85vh] p-6 pb-8 transition-transform duration-300 ease-out translate-y-0 animate-in slide-in-from-bottom",
          // 電腦端 (Dialog)：中央浮動、寬度限制、縮放動畫
          isDesktop && "md:rounded-xl md:max-w-lg md:max-h-[90vh] md:p-6 md:my-8 md:translate-y-0 md:zoom-in-95 md:duration-200",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid="responsive-modal-content"
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
            data-testid="responsive-modal-close-btn"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
export default ResponsiveModal;
