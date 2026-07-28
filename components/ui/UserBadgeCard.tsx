import React from "react"
import { Badge } from "@/components/ui/badge"
import { Trophy } from "lucide-react"
import { cn } from "@/lib/utils"

export interface UserBadgeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  user?: {
    name?: string
    has_reward?: boolean
    hasReward?: boolean
    rewardStatus?: boolean | string
    is_completed?: boolean
    [key: string]: any
  } | null
}

export const UserBadgeCard = React.forwardRef<HTMLDivElement, UserBadgeCardProps>(
  ({ className, user, ...props }, ref) => {
    // 1. 容錯數據解析與 Console Debugging
    console.log('[Badge Debug] Raw user data:', user)

    // 擴充條件判斷（compatibility check）
    const hasReward = !!(
      user?.has_reward ||
      user?.hasReward ||
      user?.rewardStatus === true ||
      user?.rewardStatus === "true" ||
      user?.rewardStatus === "active" ||
      user?.is_completed
    )

    // 安全性：若 user 資料為 undefined / null，應優雅降級不崩潰，若沒有徽章則隱藏
    if (!user || !hasReward) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-1.5", className)}
        style={{ overflow: "visible" }} // 確保父容器沒有設定 overflow-hidden 導致懸浮/邊角的 Badge 被遮蔽
        {...props}
      >
        {/* 顯式 CSS 與 DOM 保險 (Explicit Rendering Guard) */}
        <Badge
          variant="secondary"
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md shadow-sm transition-all duration-200"
          style={{
            display: "inline-flex",
            zIndex: 50,
            opacity: 1,
            backgroundColor: "rgba(245, 158, 11, 0.2)", // bg-amber-500/20
            color: "#fcd34d", // text-amber-300
            border: "1px solid rgba(245, 158, 11, 0.5)", // border-amber-500/50
          }}
        >
          <Trophy className="h-3.5 w-3.5 text-amber-500" />
          <span>榮譽徽章</span>
        </Badge>
      </div>
    )
  }
)

UserBadgeCard.displayName = "UserBadgeCard"
