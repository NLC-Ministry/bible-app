import { describe, it, expect, vi, beforeEach } from "vitest"
import { UserBadgeCard } from "../UserBadgeCard"

describe("UserBadgeCard Component Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("情境 A：當帶入 { hasReward: true } 時，驗證 Badge 確留在 DOM 中被 Render 出來", () => {
    const element = (UserBadgeCard as any).render({
      user: { hasReward: true }
    }, null)

    expect(element).toBeDefined()
    expect(element).not.toBeNull()
    
    // 獲取渲染出的 Badge
    const badge = element.props.children
    expect(badge).toBeDefined()
    
    const textSpan = badge.props.children.find((child: any) => child && child.type === "span")
    expect(textSpan.props.children).toBe("榮譽徽章")
  })

  it("情境 A 相容性檢查：同時支援 has_reward, rewardStatus, is_completed 等多個欄位", () => {
    const elementHasReward = (UserBadgeCard as any).render({
      user: { has_reward: true }
    }, null)
    expect(elementHasReward).not.toBeNull()

    const elementRewardStatus = (UserBadgeCard as any).render({
      user: { rewardStatus: true }
    }, null)
    expect(elementRewardStatus).not.toBeNull()

    const elementCompleted = (UserBadgeCard as any).render({
      user: { is_completed: true }
    }, null)
    expect(elementCompleted).not.toBeNull()
  })

  it("情境 B：當帶入 undefined 時，元件不崩潰且安全隱藏 (回傳 null)", () => {
    const element = (UserBadgeCard as any).render({
      user: undefined
    }, null)

    expect(element).toBeNull()
  })

  it("情境 B：當帶入空物件時，元件不崩潰且安全隱藏 (回傳 null)", () => {
    const element = (UserBadgeCard as any).render({
      user: {}
    }, null)

    expect(element).toBeNull()
  })
})
