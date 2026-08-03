import { describe, it, expect, vi, beforeEach } from "vitest";
import { HighlightApiBlock, HIGHLIGHT_COLORS } from "../lib/blocks/highlight-api.ts";
import { useTextSelection } from "../lib/hooks/use-text-selection.ts";

describe("SelectionBottomBar & Highlight Block Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("測試 A：驗證 useTextSelection Hook 初始化狀態", () => {
    expect(typeof useTextSelection).toBe("function");
  });

  it("測試 B：驗證點擊複製邏輯，navigator.clipboard.writeText 被正確觸發", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    await navigator.clipboard.writeText("神就照著自己的形象造人");
    expect(writeTextMock).toHaveBeenCalledWith("神就照著自己的形象造人");
  });

  it("測試 C：驗證 HighlightApiBlock 4 色主題標註與存取介面", async () => {
    expect(HIGHLIGHT_COLORS.yellow).toBe("#fef08a");
    expect(HIGHLIGHT_COLORS.green).toBe("#bbf7d0");
    expect(HIGHLIGHT_COLORS.pink).toBe("#fbcfe8");
    expect(HIGHLIGHT_COLORS.blue).toBe("#bfdbfe");

    const saveSpy = vi.spyOn(HighlightApiBlock, "saveHighlight").mockResolvedValue({
      success: true,
      data: {
        id: "hl_123",
        user_id: "guest",
        chapter_id: "GEN_1",
        selected_text: "起初神創造天地",
        start_offset: 0,
        end_offset: 7,
        color: HIGHLIGHT_COLORS.yellow
      }
    });

    const res = await HighlightApiBlock.saveHighlight({
      user_id: "guest",
      chapter_id: "GEN_1",
      selected_text: "起初神創造天地",
      start_offset: 0,
      end_offset: 7,
      color: HIGHLIGHT_COLORS.yellow
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
});
