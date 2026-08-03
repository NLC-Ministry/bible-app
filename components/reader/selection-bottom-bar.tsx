import React, { useState } from "react";
import { Play, Bookmark, Notebook, Copy, Share2 } from "lucide-react";
import { HighlightApiBlock, applySafeHighlightToRange } from "../../lib/blocks/highlight-api.ts";

export interface SelectionBottomBarProps {
  selectedText: string;
  range?: Range | null;
  chapterId?: string;
  verseNum?: number;
  onClose?: () => void;
  onToast?: (message: string) => void;
  onPlay?: (verseNum?: number) => void;
  onColorSelect?: (colorHex: string) => void;
}

// 莫蘭迪/半透明柔和螢光色系 (Harmonized Morandi Palette)
export const MORANDI_HIGHLIGHT_COLORS = {
  yellow: "#fef08a", // 柔黃
  blue: "#a5f3fc",   // 柔藍
  green: "#bbf7d0",  // 柔綠
  orange: "#fed7aa"  // 柔橘粉
};

export const SelectionBottomBar: React.FC<SelectionBottomBarProps> = ({
  selectedText,
  range = null,
  chapterId = "default",
  verseNum,
  onClose,
  onToast,
  onPlay,
  onColorSelect
}) => {
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);

  if (!selectedText) return null;

  const handleHighlight = async (colorHex: string) => {
    setSelectedColor(colorHex);
    setIsHighlighting(true);
    onColorSelect?.(colorHex);

    if (range) {
      applySafeHighlightToRange(range, colorHex);
    }

    const state = (window as any).state;
    const userId = state?.currentUser?.id || "guest";

    await HighlightApiBlock.saveHighlight({
      user_id: userId,
      chapter_id: chapterId,
      selected_text: selectedText,
      start_offset: range?.startOffset || 0,
      end_offset: range?.endOffset || selectedText.length,
      color: colorHex
    });

    setIsHighlighting(false);
    onToast?.("已套用柔和螢光標註");
    onClose?.();
  };

  const handlePlay = () => {
    if (onPlay) {
      onPlay(verseNum);
    } else {
      const toggle = (window as any).toggleReaderAudio;
      if (typeof toggle === "function") {
        toggle(verseNum);
      } else {
        onToast?.("無法啟動朗讀播放");
      }
    }
    onClose?.();
  };

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(selectedText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = selectedText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopied(true);
      onToast?.("已複製選取內容");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[SelectionBar] Copy error:", err);
      onToast?.("複製失敗");
    }
  };

  const handleShare = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "經文摘錄",
          text: selectedText,
          url: typeof window !== "undefined" ? window.location.href : undefined
        });
      } else {
        await handleCopy();
        onToast?.("已複製選取內容，可直接分享！");
      }
    } catch (err) {
      // User cancelled share dialog
    }
  };

  const handleBookmark = () => {
    setBookmarked(!bookmarked);
    onToast?.(bookmarked ? "已取消書籤儲存" : "已儲存至我的書籤");
  };

  const handleNotes = () => {
    onToast?.("開啟靈修筆記...");
  };

  return (
    <div
      data-testid="selection-bottom-bar"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[92vw] sm:max-w-md bg-background/80 backdrop-blur-md border border-white/10 shadow-2xl rounded-full px-3 py-2 flex items-center gap-2 sm:gap-3 animate-in slide-in-from-bottom-6 duration-200 transition-all"
    >
      {/* 柔和螢光色塊 Swatches */}
      <div className="flex items-center gap-1.5 px-1">
        <button
          type="button"
          data-testid="color-yellow"
          disabled={isHighlighting}
          onClick={() => handleHighlight(MORANDI_HIGHLIGHT_COLORS.yellow)}
          style={{ backgroundColor: MORANDI_HIGHLIGHT_COLORS.yellow }}
          className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-115 active:scale-95 ${
            selectedColor === MORANDI_HIGHLIGHT_COLORS.yellow ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          title="柔黃標註"
        />
        <button
          type="button"
          data-testid="color-blue"
          disabled={isHighlighting}
          onClick={() => handleHighlight(MORANDI_HIGHLIGHT_COLORS.blue)}
          style={{ backgroundColor: MORANDI_HIGHLIGHT_COLORS.blue }}
          className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-115 active:scale-95 ${
            selectedColor === MORANDI_HIGHLIGHT_COLORS.blue ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          title="柔藍標註"
        />
        <button
          type="button"
          data-testid="color-green"
          disabled={isHighlighting}
          onClick={() => handleHighlight(MORANDI_HIGHLIGHT_COLORS.green)}
          style={{ backgroundColor: MORANDI_HIGHLIGHT_COLORS.green }}
          className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-115 active:scale-95 ${
            selectedColor === MORANDI_HIGHLIGHT_COLORS.green ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          title="柔綠標註"
        />
        <button
          type="button"
          data-testid="color-orange"
          disabled={isHighlighting}
          onClick={() => handleHighlight(MORANDI_HIGHLIGHT_COLORS.orange)}
          style={{ backgroundColor: MORANDI_HIGHLIGHT_COLORS.orange }}
          className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-115 active:scale-95 ${
            selectedColor === MORANDI_HIGHLIGHT_COLORS.orange ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          title="柔橘粉標註"
        />
      </div>

      {/* 垂直分隔線 Divider */}
      <div className="h-5 w-[1px] bg-border/50 shrink-0 mx-0.5" />

      {/* 輕量 Ghost Button 功能選單 */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          data-testid="btn-play"
          onClick={handlePlay}
          className="flex flex-col items-center justify-center h-9 px-2 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Play className="h-3.5 w-3.5 fill-primary text-primary mb-0.5" />
          <span className="text-[10px] leading-none">朗讀</span>
        </button>

        <button
          type="button"
          data-testid="btn-bookmark"
          onClick={handleBookmark}
          className="flex flex-col items-center justify-center h-9 px-2 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Bookmark className={`h-3.5 w-3.5 mb-0.5 ${bookmarked ? "fill-amber-400 text-amber-400" : ""}`} />
          <span className="text-[10px] leading-none">儲存</span>
        </button>

        <button
          type="button"
          data-testid="btn-notes"
          onClick={handleNotes}
          className="flex flex-col items-center justify-center h-9 px-2 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Notebook className="h-3.5 w-3.5 mb-0.5" />
          <span className="text-[10px] leading-none">筆記</span>
        </button>

        <button
          type="button"
          data-testid="btn-copy"
          onClick={handleCopy}
          className="flex flex-col items-center justify-center h-9 px-2 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Copy className={`h-3.5 w-3.5 mb-0.5 ${copied ? "text-emerald-400" : ""}`} />
          <span className="text-[10px] leading-none">{copied ? "已複製" : "複製"}</span>
        </button>

        <button
          type="button"
          data-testid="btn-share"
          onClick={handleShare}
          className="flex flex-col items-center justify-center h-9 px-2 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Share2 className="h-3.5 w-3.5 mb-0.5" />
          <span className="text-[10px] leading-none">分享</span>
        </button>
      </div>
    </div>
  );
};
