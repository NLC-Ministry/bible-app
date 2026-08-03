import React, { useState } from "react";
import { Play, Bookmark, Notebook, Copy, Share2, ChevronUp } from "lucide-react";
import { HighlightApiBlock, HIGHLIGHT_COLORS, applySafeHighlightToRange } from "../../lib/blocks/highlight-api.ts";

export interface SelectionBottomBarProps {
  selectedText: string;
  range: Range | null;
  chapterId?: string;
  verseNum?: number;
  onClose: () => void;
  onToast?: (message: string) => void;
  onPlay?: (verseNum?: number) => void;
}

export const SelectionBottomBar: React.FC<SelectionBottomBarProps> = ({
  selectedText,
  range,
  chapterId = "default",
  verseNum,
  onClose,
  onToast,
  onPlay
}) => {
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);

  if (!selectedText) return null;

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
    onClose();
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
      onToast?.("已複製選取經文！");
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

  const handleBookmark = () => {
    setBookmarked(!bookmarked);
    onToast?.(bookmarked ? "已取消書籤儲存" : "已儲存至我的書籤！");
  };

  const handleNotes = () => {
    onToast?.("開啟靈修筆記...");
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
    onToast?.("已完成標註！");
    onClose();
  };

  return (
    <div
      data-testid="selection-bottom-bar"
      className="youversion-action-bar active animate-in slide-in-from-bottom-6 duration-300"
    >
      {/* Drag Pill Handle */}
      <div className="drag-pill" />

      {/* Main Content Row */}
      <div className="yv-content-row">
        {/* Left Color Capsule */}
        <div className="yv-color-capsule">
          <button
            type="button"
            data-testid="color-yellow"
            disabled={isHighlighting}
            onClick={() => handleHighlight("#facc15")}
            className="yv-dot yv-dot-yellow"
            title="黃色標註"
          />
          <button
            type="button"
            data-testid="color-cyan"
            disabled={isHighlighting}
            onClick={() => handleHighlight("#38bdf8")}
            className="yv-dot yv-dot-cyan"
            title="亮青標註"
          />
          <button
            type="button"
            data-testid="color-green"
            disabled={isHighlighting}
            onClick={() => handleHighlight("#4ade80")}
            className="yv-dot yv-dot-green"
            title="綠色標註"
          />
          <button
            type="button"
            data-testid="color-dual"
            disabled={isHighlighting}
            onClick={() => handleHighlight(HIGHLIGHT_COLORS.pink)}
            className="yv-dot yv-dot-dual"
            title="雙色標註"
          />
        </div>

        {/* Right Action Tiles */}
        <div className="yv-action-group">
          <button
            type="button"
            data-testid="btn-play"
            onClick={handlePlay}
            className="yv-tile"
          >
            <Play className="h-4 w-4 fill-primary text-primary" />
            <span className="yv-tile-label">朗讀</span>
          </button>

          <button
            type="button"
            data-testid="btn-bookmark"
            onClick={handleBookmark}
            className="yv-tile"
          >
            <Bookmark className={`h-4 w-4 ${bookmarked ? "fill-amber-400 text-amber-400" : ""}`} />
            <span className="yv-tile-label">儲存</span>
          </button>

          <button
            type="button"
            data-testid="btn-notes"
            onClick={handleNotes}
            className="yv-tile"
          >
            <Notebook className="h-4 w-4" />
            <span className="yv-tile-label">筆記</span>
          </button>

          <button
            type="button"
            data-testid="btn-copy"
            onClick={handleCopy}
            className="yv-tile"
          >
            <Copy className={`h-4 w-4 ${copied ? "text-emerald-400" : ""}`} />
            <span className="yv-tile-label">{copied ? "已複製" : "複製"}</span>
          </button>

          <button
            type="button"
            data-testid="btn-share"
            onClick={handleShare}
            className="yv-tile"
          >
            <Share2 className="h-4 w-4" />
            <span className="yv-tile-label">分享</span>
          </button>
        </div>
      </div>

      {/* Bottom Swipe Hint */}
      <div className="yv-swipe-hint flex items-center justify-center gap-1" onClick={onClose}>
        <ChevronUp className="h-3 w-3" />
        <span>向上滑動查看更多</span>
      </div>
    </div>
  );
};
