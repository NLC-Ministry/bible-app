import { useState, useEffect, useCallback } from "react";

export interface SelectionState {
  selectedText: string;
  range: Range | null;
  startOffset: number;
  endOffset: number;
  containerId: string | null;
}

export function useTextSelection(containerRef?: React.RefObject<HTMLElement | null>) {
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedText: "",
    range: null,
    startOffset: 0,
    endOffset: 0,
    containerId: null
  });

  const clearSelection = useCallback(() => {
    setSelectionState({
      selectedText: "",
      range: null,
      startOffset: 0,
      endOffset: 0,
      containerId: null
    });
    if (typeof window !== "undefined" && window.getSelection) {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
  }, []);

  const handleSelectionChange = useCallback(() => {
    if (typeof window === "undefined" || !window.getSelection) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelectionState(prev => prev.selectedText ? {
        selectedText: "",
        range: null,
        startOffset: 0,
        endOffset: 0,
        containerId: null
      } : prev);
      return;
    }

    const text = sel.toString().trim();
    if (!text) return;

    const range = sel.getRangeAt(0);
    const containerNode = range.commonAncestorContainer;
    const parentElement = containerNode.nodeType === Node.ELEMENT_NODE
      ? (containerNode as HTMLElement)
      : containerNode.parentElement;

    if (containerRef?.current && parentElement && !containerRef.current.contains(parentElement)) {
      return;
    }

    const containerId = parentElement?.id || parentElement?.getAttribute("data-verse") || null;

    setSelectionState({
      selectedText: text,
      range: range.cloneRange(),
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      containerId
    });
  }, [containerRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onMouseUpOrTouchEnd = () => {
      setTimeout(handleSelectionChange, 10);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mouseup", onMouseUpOrTouchEnd);
    document.addEventListener("touchend", onMouseUpOrTouchEnd);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mouseup", onMouseUpOrTouchEnd);
      document.removeEventListener("touchend", onMouseUpOrTouchEnd);
    };
  }, [handleSelectionChange]);

  return {
    selectionState,
    clearSelection
  };
}
