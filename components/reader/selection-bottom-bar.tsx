import React, { useState } from "react";
import { Copy, Share2, Check, X, Highlighter } from "lucide-react";
import { HighlightApiBlock, HIGHLIGHT_COLORS, applySafeHighlightToRange } from "../../lib/blocks/highlight-api.ts";

export interface SelectionBottomBarProps {
  selectedText: string;
  range: Range | null;
  chapterId?: string;
  onClose: () => void;
  onToast?: (message: string) => void;
}

export const SelectionBottomBar: React.FC<SelectionBottomBarProps> = ({
  selectedText,
  range,
  chapterId = "default",
  onClose,
  onToast
}) => {
  const [copied, setCopied] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);

  if (!selectedText) return null;

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
      onToast?.("已複製選取文字到剪貼簿！");
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
        onToast?.("已複製選取內容，可直接貼上分享！");
      }
    } catch (err) {
      // User cancelled share dialog
    }
  };

  const handleHighlight = async (color: string) => {
    setIsHighlighting(true);

    if (range) {
      applySafeHighlightToRange(range, color);
    }

    const state = (window as any).state;
    const userId = state?.currentUser?.id || "guest";

    await HighlightApiBlock.saveHighlight({
      user_id: userId,
      chapter_id: chapterId,
      selected_text: selectedText,
      start_offset: range?.startOffset || 0,
      end_offset: range?.endOffset || selectedText.length,
      color
    });

    setIsHighlighting(false);
    onToast?.("已標註螢光筆色彩！");
    onClose();
  };

  return (
    <div
      data-testid="selection-bottom-bar"
      className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2.5 rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-bottom-5"
      style={{
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)"
      }}
    >
      {/* Top Header: Preview text */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Highlighter className="h-3.5 w-3.5 text-primary" />
          <span>已選取經文片段</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="關閉選取工具列"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground italic px-1">
        "{selectedText}"
      </p>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Color Palette Dots */}
        <div className="flex items-center gap-2 bg-muted/40 p-1.5 rounded-full border border-border/40">
          <button
            type="button"
            data-testid="color-yellow"
            disabled={isHighlighting}
            onClick={() => handleHighlight(HIGHLIGHT_COLORS.yellow)}
            className="h-6 w-6 rounded-full transition-transform hover:scale-125 focus:scale-125 border border-black/10 shadow-sm"
            style={{ backgroundColor: HIGHLIGHT_COLORS.yellow }}
            title="黃色標註"
          />
          <button
            type="button"
            data-testid="color-green"
            disabled={isHighlighting}
            onClick={() => handleHighlight(HIGHLIGHT_COLORS.green)}
            className="h-6 w-6 rounded-full transition-transform hover:scale-125 focus:scale-125 border border-black/10 shadow-sm"
            style={{ backgroundColor: HIGHLIGHT_COLORS.green }}
            title="綠色標註"
          />
          <button
            type="button"
            data-testid="color-pink"
            disabled={isHighlighting}
            onClick={() => handleHighlight(HIGHLIGHT_COLORS.pink)}
            className="h-6 w-6 rounded-full transition-transform hover:scale-125 focus:scale-125 border border-black/10 shadow-sm"
            style={{ backgroundColor: HIGHLIGHT_COLORS.pink }}
            title="粉色標註"
          />
          <button
            type="button"
            data-testid="color-blue"
            disabled={isHighlighting}
            onClick={() => handleHighlight(HIGHLIGHT_COLORS.blue)}
            className="h-6 w-6 rounded-full transition-transform hover:scale-125 focus:scale-125 border border-black/10 shadow-sm"
            style={{ backgroundColor: HIGHLIGHT_COLORS.blue }}
            title="藍色標註"
          />
        </div>

        {/* Copy & Share Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="btn-copy"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/80 px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "已複製" : "複製"}</span>
          </button>

          <button
            type="button"
            data-testid="btn-share"
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>分享</span>
          </button>
        </div>
      </div>
    </div>
  );
};
