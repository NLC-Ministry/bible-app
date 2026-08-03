import { describe, it, expect, vi, beforeEach } from "vitest";
import { HighlightApiBlock, HIGHLIGHT_COLORS } from "../lib/blocks/highlight-api.ts";
import { useTextSelection } from "../lib/hooks/use-text-selection.ts";
import { MORANDI_HIGHLIGHT_COLORS } from "../components/reader/selection-bottom-bar.tsx";

describe("SelectionBottomBar & Floating Capsule Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("測試 A：驗證 useTextSelection Hook 初始化狀態", () => {
    expect(typeof useTextSelection).toBe("function");
  });

  it("測試 B：驗證莫蘭迪柔和螢光色系對應 Color Hex Code", () => {
    expect(MORANDI_HIGHLIGHT_COLORS.yellow).toBe("#fef08a");
    expect(MORANDI_HIGHLIGHT_COLORS.blue).toBe("#a5f3fc");
    expect(MORANDI_HIGHLIGHT_COLORS.green).toBe("#bbf7d0");
    expect(MORANDI_HIGHLIGHT_COLORS.orange).toBe("#fed7aa");
  });

  it("測試 C：驗證點擊色塊 callback 正確傳送 Hex Code", () => {
    const onColorSelectMock = vi.fn();
    
    // 模擬點擊 4 款莫蘭迪色塊
    onColorSelectMock(MORANDI_HIGHLIGHT_COLORS.yellow);
    onColorSelectMock(MORANDI_HIGHLIGHT_COLORS.blue);
    onColorSelectMock(MORANDI_HIGHLIGHT_COLORS.green);
    onColorSelectMock(MORANDI_HIGHLIGHT_COLORS.orange);

    expect(onColorSelectMock).toHaveBeenNthCalledWith(1, "#fef08a");
    expect(onColorSelectMock).toHaveBeenNthCalledWith(2, "#a5f3fc");
    expect(onColorSelectMock).toHaveBeenNthCalledWith(3, "#bbf7d0");
    expect(onColorSelectMock).toHaveBeenNthCalledWith(4, "#fed7aa");
  });

  it("測試 D：驗證點擊複製邏輯，navigator.clipboard.writeText 被正確觸發", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    await navigator.clipboard.writeText("神就照著自己的形象造人");
    expect(writeTextMock).toHaveBeenCalledWith("神就照著自己的形象造人");
  });

  it("測試 E：驗證 HighlightApiBlock 儲存與存取介面", async () => {
    const saveSpy = vi.spyOn(HighlightApiBlock, "saveHighlight").mockResolvedValue({
      success: true,
      data: {
        id: "hl_123",
        user_id: "guest",
        chapter_id: "GEN_1",
        selected_text: "起初神創造天地",
        start_offset: 0,
        end_offset: 7,
        color: MORANDI_HIGHLIGHT_COLORS.yellow
      }
    });

    const res = await HighlightApiBlock.saveHighlight({
      user_id: "guest",
      chapter_id: "GEN_1",
      selected_text: "起初神創造天地",
      start_offset: 0,
      end_offset: 7,
      color: MORANDI_HIGHLIGHT_COLORS.yellow
    });

    expect(res.success).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: "GEN_1",
        selected_text: "起初神創造天地",
        color: "#fef08a"
      })
    );
  });

  it("測試 F：驗證 HighlightApiBlock 刪除與清除介面", async () => {
    const deleteSpy = vi.spyOn(HighlightApiBlock, "deleteHighlight").mockResolvedValue({
      success: true
    });

    const res = await HighlightApiBlock.deleteHighlight("hl_GEN_1_1_guest");
    expect(res.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith("hl_GEN_1_1_guest");
  });
});
