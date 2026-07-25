import React from "react";
import { MessageSquare, X, Loader2 } from "lucide-react";
import { ReportPipeline, initOfflineReportSync } from "./IssueReportBlocks.ts";

export const IssueReportFab: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [category, setCategory] = React.useState("bug");
  const [description, setDescription] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // 1. Route Protection & Location check
  const [currentPath, setCurrentPath] = React.useState(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handleLocationChange);
    // Periodically sync path to catch SPA custom tab routing shifts
    const interval = setInterval(handleLocationChange, 500);

    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      clearInterval(interval);
    };
  }, []);

  // 2. Smart Scroll Hide with Throttle
  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let lastScrollY = window.scrollY;
    let throttleTimeout: any = null;
    let scrollStopTimeout: any = null;

    const handleScroll = (event: Event) => {
      if (throttleTimeout) return;

      throttleTimeout = setTimeout(() => {
        const target = event.target as HTMLElement;
        const currentScrollY = target.scrollTop !== undefined ? target.scrollTop : window.scrollY;

        if (scrollStopTimeout) clearTimeout(scrollStopTimeout);

        if (currentScrollY > lastScrollY && currentScrollY > 50) {
          // Scrolling down - hide
          setIsVisible(false);
        } else {
          // Scrolling up - show
          setIsVisible(true);
        }

        lastScrollY = currentScrollY;
        throttleTimeout = null;

        // Auto-show when scrolling stops for a brief period
        scrollStopTimeout = setTimeout(() => {
          setIsVisible(true);
        }, 150);
      }, 50); // 50ms throttle
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (throttleTimeout) clearTimeout(throttleTimeout);
      if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
    };
  }, []);

  // Initialize offline sync on mount
  React.useEffect(() => {
    initOfflineReportSync();
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setMessage(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    // Reset form states
    setCategory("bug");
    setDescription("");
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    const result = await ReportPipeline.execute(category, description);

    setIsLoading(false);

    if (result.success) {
      const isOffline = result.source === "offline";
      setMessage({
        type: "success",
        text: isOffline ? "已保存至離線佇列，恢復連線後會自動上傳！" : "感謝回報！我們會盡快處理！"
      });
      // Clear description
      setDescription("");
      // Close drawer after 2 seconds
      setTimeout(() => {
        handleClose();
      }, 2000);
    } else {
      setMessage({
        type: "error",
        text: result.error || "回報提交失敗，請重試"
      });
    }
  };

  // Check if we are on a login or excluded auth page
  const isExcluded =
    (currentPath || "") === "/login" ||
    (currentPath || "").startsWith("/auth") ||
    (currentPath || "") === "/signup" ||
    // Integration fallback checking if the login gate DOM is visible on screen
    (typeof document !== "undefined" && document.getElementById("login-gate") && !document.getElementById("login-gate")?.classList.contains("hidden"));

  if (isExcluded) {
    return null;
  }

  return (
    <>
      {/* Floating Action Button (FAB) */}
      <button
        onClick={handleOpen}
        className={`fixed bottom-20 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-all duration-300 hover:scale-110 hover:bg-indigo-700 active:scale-95 ${
          isOpen ? "scale-0 opacity-0 pointer-events-none" : ""
        } ${
          !isVisible && !isOpen ? "translate-y-24 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
        }`}
        aria-label="打開問題回報與建議表單"
      >
        <MessageSquare className="h-6 w-6" />
      </button>

      {/* Backdrop Overlay */}
      {isOpen && (
        <div
          onClick={handleClose}
          className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm transition-opacity duration-300"
        />
      )}

      {/* Bottom Drawer (Mobile-First Drawer UI) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[9999] mx-auto flex max-w-lg flex-col rounded-t-2xl bg-white p-6 shadow-2xl transition-all duration-300 dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800 ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
        role="dialog"
        aria-labelledby="issue-report-title"
      >
        {/* Drag Handle indicator for mobile context */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-zinc-700" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-zinc-800">
          <h2 id="issue-report-title" className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
            問題與建議回報
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message Alert Panel */}
        {message && (
          <div
            className={`mt-4 rounded-lg p-3 text-sm font-medium ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          {/* Category Selector */}
          <div>
            <label
              htmlFor="category"
              className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-zinc-400"
            >
              問題分類
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isLoading}
              className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-neutral-100"
            >
              <option value="bug">Bug 錯誤</option>
              <option value="ui">UI 建議</option>
              <option value="data">資料問題</option>
              <option value="other">其他</option>
            </select>
          </div>

          {/* Description Textarea */}
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="description"
                className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-zinc-400"
              >
                問題描述
              </label>
              <span
                className={`text-xs ${
                  description.length < 1 || description.length > 500
                    ? "text-rose-500 font-medium"
                    : "text-slate-400 dark:text-zinc-500"
                }`}
              >
                {description.length} / 500 字
              </span>
            </div>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              rows={4}
              placeholder="請詳細描述您遇到的問題或建議，最少 1 個字，最多 500 個字..."
              className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-neutral-100"
            />
            <p className="mt-1.5 text-xs text-slate-400 dark:text-zinc-500">
              * 系統將自動附帶當前 URL、瀏覽器與登入資訊，以加速除錯。
            </p>
          </div>

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={isLoading || description.length < 1 || description.length > 500}
            className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在提交...
              </>
            ) : (
              "提交報告"
            )}
          </button>
        </form>
      </div>
    </>
  );
};
