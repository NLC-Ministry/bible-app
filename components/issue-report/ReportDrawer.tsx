// components/issue-report/ReportDrawer.tsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { ReportPipeline } from "./IssueReportBlocks.ts";

interface ReportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReportDrawer: React.FC<ReportDrawerProps> = ({ isOpen, onClose }) => {
  const [category, setCategory] = React.useState("bug");
  const [description, setDescription] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleClose = () => {
    onClose();
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
      setDescription("");
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

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
          />

          {/* Bottom Drawer (Shadcn UI & Framer Motion styled) */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed inset-x-0 bottom-0 z-[9999] mx-auto flex max-w-lg flex-col rounded-t-2xl border-t p-6 shadow-2xl"
            style={{ 
              backgroundColor: "var(--bg-card)", 
              borderColor: "var(--border-card)",
              color: "var(--text-primary)" 
            }}
            role="dialog"
            aria-labelledby="issue-report-title"
          >
            {/* Drag Handle indicator */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-700" />

            {/* Header */}
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border-card)" }}>
              <h2 id="issue-report-title" className="text-lg font-bold">
                問題與建議回報
              </h2>
              <button
                onClick={handleClose}
                className="rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--text-secondary)" }}
                aria-label="關閉"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Message Alert Panel */}
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 rounded-lg p-3 text-sm font-semibold flex items-center gap-2 border`}
                style={{
                  backgroundColor: message.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
                  borderColor: message.type === "success" ? "var(--color-success-border)" : "var(--color-danger)",
                  color: message.type === "success" ? "var(--color-success-foreground)" : "var(--color-danger)"
                }}
              >
                {message.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                <span>{message.text}</span>
              </motion.div>
            )}

            {/* Form Body */}
            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
              {/* Category Selector */}
              <div>
                <label
                  htmlFor="category"
                  className="block text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--text-secondary)" }}
                >
                  問題分類
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={isLoading}
                  className="mt-1.5 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  style={{ 
                    backgroundColor: "var(--bg-input)", 
                    borderColor: "var(--border-card)",
                    color: "var(--text-primary)" 
                  }}
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
                    className="block text-xs font-bold uppercase tracking-wider"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    問題描述
                  </label>
                  <span
                    className="text-xs"
                    style={{ 
                      color: description.length < 1 || description.length > 500
                        ? "var(--color-danger)"
                        : "var(--text-muted)"
                    }}
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
                  className="mt-1.5 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  style={{ 
                    backgroundColor: "var(--bg-input)", 
                    borderColor: "var(--border-card)",
                    color: "var(--text-primary)" 
                  }}
                />
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  * 系統將自動附帶當前 URL、瀏覽器與登入資訊，以加速除錯。
                </p>
              </div>

              {/* Submit Action Button */}
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={isLoading || description.length < 1 || description.length > 500}
                className="flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:pointer-events-none"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在提交...
                  </>
                ) : (
                  "提交報告"
                )}
              </motion.button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
