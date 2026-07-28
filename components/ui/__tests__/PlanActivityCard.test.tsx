import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { PlanActivityCard } from "../PlanActivityCard"

describe("PlanActivityCard Component Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // 輔助函數：將 React 節點的 children 轉換為字串
  const getChildrenText = (children: any): string => {
    if (!children) return ""
    if (typeof children === "string" || typeof children === "number") {
      return String(children)
    }
    if (Array.isArray(children)) {
      return children.map(getChildrenText).join("")
    }
    if (children.props && children.props.children) {
      return getChildrenText(children.props.children)
    }
    return ""
  }

  it("未報名狀態下的 Render 結果：顯示立即報名按鈕", () => {
    const setterSpy = vi.fn()
    vi.spyOn(React, "useState").mockReturnValue([null, setterSpy])

    // 呼叫 forwardRef 的 render 函數
    const element = (PlanActivityCard as any).render({
      name: "第一輪熱身賽",
      stageNo: 1,
      awardName: "磐石獎",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      isRegistered: false,
      weeklyRulesSummary: "每週挑戰 7 天",
    }, null)

    expect(element).toBeDefined()

    // 獲取 CardContent 的子元素
    const content = element.props.children.props.children
    
    // 檢查計畫標題
    const headerSection = content.find(
      (child: any) => child && child.props && child.props.className?.includes("space-y-1")
    )
    expect(headerSection).toBeDefined()
    const title = headerSection.props.children.find((child: any) => child && child.type === "h3")
    expect(title.props.children).toBe("第一輪熱身賽")

    // 檢查報名按鈕
    const actionSection = content[3] // 第四個區塊為報名按鈕區
    expect(actionSection).toBeDefined()
    
    const registerButton = actionSection.props.children
    const buttonText = getChildrenText(registerButton)
    expect(buttonText).toContain("立即報名")
    expect(registerButton.props.disabled).toBe(false)
  })

  it("已報名狀態下的 Render 結果：顯示已加入狀態，不顯示立即報名按鈕", () => {
    vi.spyOn(React, "useState").mockReturnValue([null, vi.fn()])

    const element = (PlanActivityCard as any).render({
      name: "第一輪熱身賽",
      stageNo: 1,
      awardName: "磐石獎",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      isRegistered: true,
      registeredTeamName: "得勝小組",
      weeklyRulesSummary: "每週挑戰 7 天",
    }, null)

    const content = element.props.children.props.children
    const actionSection = content[3]

    // 當 isRegistered = true，應渲染已加入的狀態標記，而非報名按鈕
    const statusTextDiv = actionSection.props.children
    expect(statusTextDiv.props.className).toContain("text-emerald-600")
    
    const statusText = getChildrenText(statusTextDiv)
    expect(statusText).toContain("已報名加入")
    expect(statusText).toContain("(得勝小組)")
  })

  it("組別選項 (如 3人組、6人組) 的 Render 與已報名狀態", () => {
    vi.spyOn(React, "useState").mockReturnValue([null, vi.fn()])

    const element = (PlanActivityCard as any).render({
      name: "熱身賽與組隊",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      divisions: [3, 6],
      joinedDivisions: [3],
      divisionTeamNames: { 3: "磐石小組", 6: "" },
    }, null)

    const content = element.props.children.props.children
    const divisionSection = content[3] // 組別按鈕區
    
    // 檢查標題
    const subheader = divisionSection.props.children[0]
    expect(getChildrenText(subheader)).toBe("組隊參賽狀態")

    // 檢查組別按鈕列表
    const buttonsList = divisionSection.props.children[1].props.children
    expect(buttonsList.length).toBe(2)

    // 已加入 3人組
    const firstBtn = buttonsList[0]
    expect(firstBtn.props.className).toContain("border-emerald-500")
    expect(getChildrenText(firstBtn)).toContain("已入 3人組")
    expect(getChildrenText(firstBtn)).toContain("(磐石小組)")

    // 未加入 6人組
    const secondBtn = buttonsList[1]
    expect(secondBtn.props.className).toContain("bg-primary")
    expect(getChildrenText(secondBtn)).toContain("報名 6人組")
  })

  it("載入中狀態 (Loading Lock) 應禁用所有報名按鈕", () => {
    vi.spyOn(React, "useState").mockReturnValue([6, vi.fn()]) // 模擬正在報名 6人組

    const element = (PlanActivityCard as any).render({
      name: "載入測試",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      divisions: [3, 6],
      joinedDivisions: [],
      isLoading: true, // 同時傳入外部載入狀態
    }, null)

    const content = element.props.children.props.children
    const divisionSection = content[3]
    const buttonsList = divisionSection.props.children[1].props.children

    // 所有報名按鈕皆應被禁用 (disabled = true)
    expect(buttonsList[0].props.disabled).toBe(true)
    expect(buttonsList[1].props.disabled).toBe(true)
  })
})
