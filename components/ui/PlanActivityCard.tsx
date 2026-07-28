import React from "react"
import { Calendar, Users, RefreshCw, Trophy, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PlanActivityCardProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string // 計畫名稱, e.g., "第一輪熱身賽"
  stageNo?: number // 階段編號, e.g., 1 (會顯示在 Badge "第 1 階段")
  awardName?: string // 獎項名稱, e.g., "磐石獎" (會顯示獎勵 Badge 附帶 Trophy icon)
  startDate: string // 開始日期, e.g., "2026-08-01"
  endDate: string // 結束日期, e.g., "2026-08-31"
  description?: string // 描述/規則
  weeklyRulesSummary?: string // 每週規則/時程, e.g., "每週挑戰 7 天"
  
  // 單一報名狀態
  isRegistered?: boolean // 是否已報名/已加入
  registeredTeamName?: string // 已加入的團隊名稱
  
  // 組隊或多組別選項 (如 3人組、6人組)
  divisions?: number[] // e.g., [3, 6]
  joinedDivisions?: number[] // 已加入的組別, e.g., [3]
  divisionTeamNames?: Record<number, string> // 組別對應的團隊名稱, e.g., { 3: "得勝小組" }
  
  // 事件處理器與載入狀態
  onRegister?: (division?: number) => Promise<void> | void
  isLoading?: boolean // 外部控制的載入狀態
}

export const PlanActivityCard = React.forwardRef<HTMLDivElement, PlanActivityCardProps>(
  (
    {
      className,
      name,
      stageNo,
      awardName,
      startDate,
      endDate,
      description,
      weeklyRulesSummary,
      isRegistered = false,
      registeredTeamName,
      divisions,
      joinedDivisions = [],
      divisionTeamNames = {},
      onRegister,
      isLoading = false,
      ...props
    },
    ref
  ) => {
    // 內部安全防連點載入狀態：記錄當前點擊報名的組別 (單一報名則為 0)
    const [submittingDivision, setSubmittingDivision] = React.useState<number | null>(null)

    const handleRegister = async (division?: number) => {
      if (submittingDivision !== null || isLoading) return
      
      const targetDiv = division ?? 0
      setSubmittingDivision(targetDiv)
      
      try {
        if (onRegister) {
          await onRegister(division)
        }
      } catch (error) {
        console.error("Registration failed:", error)
      } finally {
        setSubmittingDivision(null)
      }
    }

    const isAnyLoading = submittingDivision !== null || isLoading

    return (
      <Card
        ref={ref}
        className={cn(
          "w-full bg-card text-card-foreground border border-border/60 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden",
          className
        )}
        {...props}
      >
        <CardContent className="p-4 sm:p-5 flex flex-col gap-4">
          {/* 上方：標籤與獎勵列 */}
          <div className="flex flex-wrap items-center gap-2">
            {stageNo !== undefined && (
              <Badge
                variant="outline"
                className="bg-primary/5 text-primary border-primary/20 font-medium text-xs rounded-md px-2.5 py-0.5 whitespace-nowrap"
              >
                第 {stageNo} 階段
              </Badge>
            )}
            {awardName && (
              <Badge
                variant="secondary"
                className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium text-xs rounded-md px-2 py-0.5 flex items-center gap-1 whitespace-nowrap"
              >
                <Trophy className="h-3.5 w-3.5 text-amber-500" />
                <span>{awardName}</span>
              </Badge>
            )}
          </div>

          {/* 中上方：計畫名稱與說明描述 */}
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              {name}
            </h3>
            {description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {/* 中間：規則與時程清單（二欄/縱向自適應） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 border-t border-b border-border/40 mt-1">
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
              <span className="truncate">
                {startDate} 至 {endDate}
              </span>
            </div>
            {weeklyRulesSummary && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{weeklyRulesSummary}</span>
              </div>
            )}
          </div>

          {/* 下方：行動與報名區域 */}
          {divisions && divisions.length > 0 ? (
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>組隊參賽狀態</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {divisions.map((div) => {
                  const hasJoined = joinedDivisions.includes(div)
                  const teamName = divisionTeamNames[div] || (hasJoined ? registeredTeamName : "")
                  const isThisLoading = submittingDivision === div
                  
                  if (hasJoined) {
                    return (
                      <Button
                        key={div}
                        variant="outline"
                        size="sm"
                        className="h-10 text-xs border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 hover:bg-emerald-500/10 cursor-default"
                        disabled={isAnyLoading}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Users className="h-3.5 w-3.5 text-emerald-500" />
                        <span>已入 {div}人組 {teamName ? `(${teamName})` : ""}</span>
                      </Button>
                    )
                  }

                  return (
                    <Button
                      key={div}
                      variant="default"
                      size="sm"
                      className="h-10 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium flex items-center gap-1.5 px-4 shadow-sm active:scale-98 transition-all"
                      disabled={isAnyLoading}
                      onClick={async (e) => {
                        e.stopPropagation()
                        await handleRegister(div)
                      }}
                    >
                      {isThisLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Users className="h-3.5 w-3.5" />
                      )}
                      <span>報名 {div}人組</span>
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-center justify-between sm:justify-end gap-3 flex-wrap">
              {isRegistered ? (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium py-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <Users className="h-3 w-3 text-emerald-500" />
                  </span>
                  <span>已報名加入 {registeredTeamName ? `(${registeredTeamName})` : ""}</span>
                </div>
              ) : (
                <Button
                  variant="default"
                  className="h-10 px-5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium flex items-center gap-2 shadow-sm rounded-lg active:scale-98 transition-all w-full sm:w-auto justify-center"
                  disabled={isAnyLoading}
                  onClick={async (e) => {
                    e.stopPropagation()
                    await handleRegister()
                  }}
                >
                  {isAnyLoading && submittingDivision === 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                  <span>立即報名</span>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }
)

PlanActivityCard.displayName = "PlanActivityCard"
