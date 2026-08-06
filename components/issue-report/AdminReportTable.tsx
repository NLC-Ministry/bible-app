import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Trash2, Loader2, AlertCircle, RefreshCw, MessageSquare, Filter } from "lucide-react";

interface IssueReport {
  id: string;
  created_at: string;
  category: "bug" | "ui" | "data" | "other";
  description: string;
  url?: string;
  user_agent?: string;
  status: string;
  metadata?: Record<string, any>;
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

const STATUS_MAP = {
  pending: { label: "待處理", className: "bg-yellow-950/20 text-yellow-400 border border-yellow-500/20" },
  processing: { label: "處理中", className: "bg-blue-950/20 text-blue-400 border border-blue-500/20" },
  resolved: { label: "已解決", className: "bg-emerald-950/20 text-emerald-400 border border-emerald-500/20" },
  ignored: { label: "已忽略", className: "bg-gray-900 text-gray-400 border border-border/50" }
};

export type StatusFilter = "all" | "pending" | "processing" | "resolved" | "ignored";

export const STATUS_FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "pending", label: "待處理" },
  { id: "processing", label: "處理中" },
  { id: "resolved", label: "已解決" },
  { id: "ignored", label: "已忽略" }
];

interface AdminReportTableProps {
  reports: IssueReport[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onExport: (exportData?: IssueReport[]) => void;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, status: string, reply: string) => Promise<void>;
}

export const AdminReportTable: React.FC<AdminReportTableProps> = ({
  reports,
  isLoading,
  error,
  onRefresh,
  onExport,
  onDelete,
  onUpdate
}) => {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");

  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [replyTargetId, setReplyTargetId] = React.useState<string | null>(null);
  const [replyStatus, setReplyStatus] = React.useState<string>("pending");
  const [replyText, setReplyText] = React.useState<string>("");
  const [isSavingReply, setIsSavingReply] = React.useState(false);

  const statusCounts = React.useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: reports.length,
      pending: 0,
      processing: 0,
      resolved: 0,
      ignored: 0
    };
    reports.forEach(r => {
      const st = (r.status || "pending") as StatusFilter;
      if (st in counts && st !== "all") {
        counts[st]++;
      } else if (st !== "all") {
        counts.pending++;
      }
    });
    return counts;
  }, [reports]);

  const filteredReports = React.useMemo(() => {
    if (statusFilter === "all") return reports;
    return reports.filter(r => (r.status || "pending") === statusFilter);
  }, [reports, statusFilter]);

  const handleReplyOpen = (report: IssueReport) => {
    setReplyTargetId(report.id);
    setReplyStatus(report.status || "pending");
    setReplyText(report.metadata?.reply || "");
  };

  const handleReplySave = async () => {
    if (!replyTargetId) return;
    setIsSavingReply(true);
    try {
      await onUpdate(replyTargetId, replyStatus, replyText.trim());
      setReplyTargetId(null);
    } catch (err: any) {
      alert(err.message || "更新失敗");
    } finally {
      setIsSavingReply(false);
    }
  };

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
            onClick={() => onExport(filteredReports)}
            disabled={filteredReports.length === 0 || isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            匯出 Excel/CSV
          </motion.button>
        </div>
      </div>

      {/* Status Filter Bar */}
      <div 
        className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-4"
        data-testid="status-filter-bar"
      >
        <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          處理狀態：
        </span>
        {STATUS_FILTER_OPTIONS.map((option) => {
          const count = statusCounts[option.id];
          const isActive = statusFilter === option.id;
          return (
            <motion.button
              key={option.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              data-testid={`filter-status-${option.id}`}
              onClick={() => setStatusFilter(option.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/30"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background/80 text-muted-foreground border border-border/30"
                }`}
              >
                {count}
              </span>
            </motion.button>
          );
        })}
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
        ) : filteredReports.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-sm text-muted-foreground">
            <Filter className="h-8 w-8 text-muted-foreground/40 mb-2" />
            無符合「{STATUS_FILTER_OPTIONS.find(o => o.id === statusFilter)?.label}」狀態的回報資料
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border/50 text-left text-xs">
            <thead className="uppercase tracking-wider font-semibold bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-3">建立時間</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-6 py-3 w-1/3">回報內容</th>
                <th className="px-4 py-3">姓名</th>
                <th className="px-4 py-3">牧區</th>
                <th className="px-4 py-3">小組</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-foreground">
              {filteredReports.map((report) => (
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
                  <td className="px-4 py-3.5 whitespace-nowrap font-medium">
                    <select
                      value={report.status || "pending"}
                      onChange={async (e) => {
                        const newStatus = e.target.value;
                        try {
                          await onUpdate(report.id, newStatus, report.metadata?.reply || "");
                        } catch (err: any) {
                          alert(err.message || "狀態更新失敗");
                        }
                      }}
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold border focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer transition-colors ${
                        report.status === "processing"
                          ? "bg-blue-950/40 text-blue-400 border-blue-500/40 hover:bg-blue-900/50"
                          : report.status === "resolved"
                          ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/40 hover:bg-emerald-900/50"
                          : report.status === "ignored"
                          ? "bg-gray-900/80 text-gray-400 border-border/50 hover:bg-gray-800"
                          : "bg-yellow-950/40 text-yellow-400 border-yellow-500/40 hover:bg-yellow-900/50"
                      }`}
                      title="變更問題處理狀態"
                    >
                      <option value="pending" className="bg-card text-yellow-400">待處理 (Pending)</option>
                      <option value="processing" className="bg-card text-blue-400">處理中 (Processing)</option>
                      <option value="resolved" className="bg-card text-emerald-400">已解決 (Resolved)</option>
                      <option value="ignored" className="bg-card text-gray-400">已忽略 (Ignored)</option>
                    </select>
                  </td>
                  <td className="px-6 py-3.5 break-words leading-relaxed text-sm text-foreground">
                    <div>{report.description}</div>
                    {report.metadata?.reply && (
                      <div className="mt-2 rounded-lg bg-primary/10 border border-primary/20 p-2.5 text-xs text-primary-foreground">
                        <div className="font-semibold text-primary mb-1">管理員回覆：</div>
                        <div className="text-foreground">{report.metadata.reply}</div>
                        {report.metadata.replied_at && (
                          <div className="mt-1 text-[10px] text-muted-foreground text-right">
                            {new Date(report.metadata.replied_at).toLocaleString("zh-TW")}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {report.profiles ? (
                      <span className="font-semibold text-sm">{report.profiles.name || "未填姓名"}</span>
                    ) : (
                      <span className="text-muted-foreground">訪客 / 離線回報</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-sm text-muted-foreground">
                    {report.profiles ? (report.profiles.pastoral_zone || "無牧區") : "-"}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-sm text-muted-foreground">
                    {report.profiles ? (report.profiles.small_group || "無小組") : "-"}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-1">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleReplyOpen(report)}
                        className="inline-flex rounded-lg p-1.5 text-primary hover:bg-primary/10 transition-colors focus:outline-none"
                        title="回覆 / 修改狀態"
                        type="button"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </motion.button>
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
                    </div>
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

      {/* Reply Modal / Dialog */}
      <AnimatePresence>
        {replyTargetId && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-xl p-6 shadow-2xl border border-border/50 bg-card text-foreground"
            >
              <h3 className="text-md font-bold text-foreground">回覆與狀態管理</h3>
              <p className="text-xs mt-1 text-muted-foreground">
                撰寫回覆訊息，並變更此使用者回報的進度狀態。
              </p>
              
              <div className="mt-4 flex flex-col gap-4">
                {/* Status Selection */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reply-status-select" className="text-xs font-semibold text-muted-foreground">
                    處理狀態
                  </label>
                  <select
                    id="reply-status-select"
                    value={replyStatus}
                    onChange={(e) => setReplyStatus(e.target.value)}
                    disabled={isSavingReply}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
                  >
                    <option value="pending">待處理 (Pending)</option>
                    <option value="processing">處理中 (Processing)</option>
                    <option value="resolved">已解決 (Resolved)</option>
                    <option value="ignored">已忽略 (Ignored)</option>
                  </select>
                </div>

                {/* Reply Message Textarea */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="reply-message-textarea" className="text-xs font-semibold text-muted-foreground">
                      回覆內容
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      {replyText.length} / 500 字
                    </span>
                  </div>
                  <textarea
                    id="reply-message-textarea"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value.substring(0, 500))}
                    disabled={isSavingReply}
                    rows={4}
                    placeholder="請輸入回覆使用者的訊息..."
                    className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
                  />
                </div>
              </div>
              
              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setReplyTargetId(null)}
                  disabled={isSavingReply}
                  className="rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  type="button"
                >
                  取消
                </button>
                <button
                  onClick={handleReplySave}
                  disabled={isSavingReply}
                  className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-xs font-semibold shadow-sm disabled:opacity-50"
                  type="button"
                >
                  {isSavingReply && <Loader2 className="h-3 w-3 animate-spin" />}
                  儲存回覆
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
