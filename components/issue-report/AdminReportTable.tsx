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
  profiles?: {
    name?: string;
    pastoral_zone?: string;
    small_group?: string;
  } | null;
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
      className="flex w-full flex-col gap-6 p-6 rounded-xl border border-border/50 bg-card text-card-foreground shadow-lg backdrop-blur-md transition-all duration-300"
    >
      {/* Header and Actions */}
      <div 
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/50 pb-4"
      >
        <div>
          <h2 className="text-xl font-bold text-foreground">問題與建議回報管理</h2>
          <p className="text-xs mt-1 text-muted-foreground">檢視並管理使用者提交的 Bug 報告與介面建議</p>
        </div>
        
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            type="button"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            重新整理
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onExport}
            disabled={reports.length === 0 || isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            匯出 Excel/CSV
          </motion.button>
        </div>
      </div>

      {/* Error State */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 rounded-lg p-4 text-sm border border-destructive/30 bg-destructive/10 text-destructive" 
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">載入錯誤：</span>
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reports List Table Container */}
      <div 
        className="overflow-x-auto rounded-lg border border-border/50 bg-background/50 shadow max-h-[60vh] overflow-y-auto scrollbar-thin"
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="mt-3 text-sm">正在載入回報清單...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-sm text-muted-foreground">
            無任何回報資料
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border/50 text-left text-xs">
            <thead className="uppercase tracking-wider font-semibold bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-3">建立時間</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-6 py-3 w-1/2">回報內容</th>
                <th className="px-4 py-3">回報人姓名 / 牧區 / 小組</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-foreground">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground">
                    {new Date(report.created_at).toLocaleString("zh-TW")}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap font-medium">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold text-[10px] ${
                      report.category === "bug" 
                        ? "bg-red-950/20 text-red-400 border border-red-500/20"
                        : report.category === "ui"
                        ? "bg-amber-950/20 text-amber-400 border border-amber-500/20"
                        : report.category === "data"
                        ? "bg-emerald-950/20 text-emerald-400 border border-emerald-500/20"
                        : "bg-muted text-muted-foreground border border-border/50"
                    }`}>
                      {CATEGORY_MAP[report.category] || report.category}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 break-words leading-relaxed text-sm text-foreground">
                    {report.description}
                  </td>
                  <td className="px-4 py-3.5 max-w-[200px]">
                    {report.profiles ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-sm">{report.profiles.name || "未填姓名"}</span>
                        <span className="text-[10px] text-muted-foreground">{report.profiles.pastoral_zone || "無牧區"} / {report.profiles.small_group || "無小組"}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">訪客 / 離線回報</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setDeleteTargetId(report.id)}
                      className="inline-flex rounded-lg p-1.5 text-destructive hover:bg-destructive/10 transition-colors focus:outline-none"
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
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-xl p-6 shadow-2xl border border-border/50 bg-card text-foreground"
            >
              <h3 className="text-md font-bold text-foreground">確認刪除</h3>
              <p className="text-sm mt-2 text-muted-foreground">
                您確定要刪除這筆使用者問題回報嗎？此動作將從 Supabase 中永久移除，無法復原。
              </p>
              
              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setDeleteTargetId(null)}
                  disabled={isDeleting}
                  className="rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  type="button"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-2 text-xs font-semibold shadow-sm disabled:opacity-50"
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
