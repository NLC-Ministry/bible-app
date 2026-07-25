// components/issue-report/AdminReportTable.tsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";

interface IssueReport {
  id: string;
  created_at: string;
  category: "bug" | "ui" | "data" | "other";
  description: string;
  url?: string;
  user_agent?: string;
  status: string;
}

const CATEGORY_MAP = {
  bug: "Bug 錯誤",
  ui: "UI 建議",
  data: "資料問題",
  other: "其他"
};

interface AdminReportTableProps {
  reports: IssueReport[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onExport: () => void;
  onDelete: (id: string) => Promise<void>;
}

export const AdminReportTable: React.FC<AdminReportTableProps> = ({
  reports,
  isLoading,
  error,
  onRefresh,
  onExport,
  onDelete
}) => {
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await onDelete(deleteTargetId);
      setDeleteTargetId(null);
    } catch (err: any) {
      alert(err.message || "刪除失敗");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div 
      className="flex w-full flex-col gap-6 p-6 rounded-xl border transition-all duration-300"
      style={{ 
        backgroundColor: "var(--bg-card)", 
        borderColor: "var(--border-card)",
        color: "var(--text-primary)"
      }}
    >
      {/* Header and Actions */}
      <div 
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--border-card)" }}
      >
        <div>
          <h2 className="text-xl font-bold">問題與建議回報管理</h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>檢視並管理使用者提交的 Bug 報告與介面建議</p>
        </div>
        
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            style={{ 
              backgroundColor: "var(--bg-app)", 
              borderColor: "var(--border-card)", 
              color: "var(--text-primary)" 
            }}
            type="button"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            重新整理
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onExport}
            disabled={reports.length === 0 || isLoading}
            className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--primary-color)" }}
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            匯出 Excel/CSV
          </motion.button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-lg p-4 text-sm border" 
          style={{ 
            backgroundColor: "var(--color-danger-subtle)", 
            borderColor: "var(--color-danger)", 
            color: "var(--color-danger)" 
          }}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">載入錯誤：</span>
            {error}
          </div>
        </motion.div>
      )}

      {/* Reports List Table Container */}
      <div 
        className="overflow-x-auto rounded-lg border shadow max-h-[60vh] overflow-y-auto"
        style={{ 
          backgroundColor: "var(--bg-app)", 
          borderColor: "var(--border-card)" 
        }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12" style={{ color: "var(--text-muted)" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--primary-color)" }} />
            <span className="mt-3 text-sm">正在載入回報清單...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-sm" style={{ color: "var(--text-muted)" }}>
            無任何回報資料
          </div>
        ) : (
          <table className="min-w-full divide-y text-left text-xs" style={{ borderColor: "var(--border-card)" }}>
            <thead className="uppercase tracking-wider font-semibold" style={{ backgroundColor: "var(--bg-card)", color: "var(--text-secondary)" }}>
              <tr>
                <th className="px-4 py-3">建立時間</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-6 py-3 w-1/3">回報內容</th>
                <th className="px-4 py-3">來源網址</th>
                <th className="px-4 py-3">瀏覽器 User Agent</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-card)", color: "var(--text-primary)" }}>
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {new Date(report.created_at).toLocaleString("zh-TW")}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap font-medium">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold text-[10px] ${
                      report.category === "bug" 
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400"
                        : report.category === "ui"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
                        : report.category === "data"
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400"
                        : "bg-slate-50 text-slate-700 dark:bg-zinc-850 dark:text-zinc-400"
                    }`}>
                      {CATEGORY_MAP[report.category] || report.category}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 break-words leading-relaxed text-sm" style={{ color: "var(--text-primary)" }}>
                    {report.description}
                  </td>
                  <td className="px-4 py-3.5 break-all max-w-[150px] hover:underline" style={{ color: "var(--primary-color)" }}>
                    {report.url ? <a href={report.url} target="_blank" rel="noreferrer">{new URL(report.url).pathname + new URL(report.url).search}</a> : "-"}
                  </td>
                  <td className="px-4 py-3.5 max-w-[150px] truncate" style={{ color: "var(--text-muted)" }} title={report.user_agent}>
                    {report.user_agent || "-"}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <motion.button
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => setDeleteTargetId(report.id)}
                      className="inline-flex rounded-lg p-1.5 transition-colors focus:outline-none"
                      style={{ color: "var(--color-danger)" }}
                      title="刪除此回報"
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </motion.button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal / Dialog */}
      <AnimatePresence>
        {deleteTargetId && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-xl p-6 shadow-2xl border"
              style={{ 
                backgroundColor: "var(--bg-card)", 
                borderColor: "var(--border-card)", 
                color: "var(--text-primary)" 
              }}
            >
              <h3 className="text-md font-bold">確認刪除</h3>
              <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
                您確定要刪除這筆使用者問題回報嗎？此動作將從 Supabase 中永久移除，無法復原。
              </p>
              
              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setDeleteTargetId(null)}
                  disabled={isDeleting}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold transition-colors"
                  style={{ 
                    backgroundColor: "var(--bg-app)", 
                    borderColor: "var(--border-card)", 
                    color: "var(--text-primary)" 
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-danger)" }}
                  type="button"
                >
                  {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                  確定刪除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
