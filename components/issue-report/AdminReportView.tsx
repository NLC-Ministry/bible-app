// components/issue-report/AdminReportView.tsx
import React, { useState, useEffect } from "react";
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

/**
 * Converts reports JSON array to CSV format
 */
export function convertToCSV(data: IssueReport[]): string {
  if (!data || data.length === 0) return "";
  const headers = ["ID", "建立時間", "分類", "問題描述", "來源網址", "瀏覽器環境 (User Agent)", "狀態"];
  const rows = data.map(item => [
    item.id,
    item.created_at,
    CATEGORY_MAP[item.category] || item.category,
    item.description.replace(/"/g, '""'), // escape double quotes
    item.url || "",
    item.user_agent || "",
    item.status
  ]);
  
  return [
    headers.join(","),
    ...rows.map(row => row.map(val => `"${val}"`).join(","))
  ].join("\n");
}

export const AdminReportView: React.FC = () => {
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchReports = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const state = (window as any).state;
      const supabase = state?.supabase;
      if (!supabase) {
        throw new Error("Supabase client is not initialized");
      }

      const { data, error: fetchErr } = await supabase
        .from("issue_reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchErr) throw fetchErr;
      setReports(data || []);
    } catch (err: any) {
      console.error("[IssueReportAdmin] Fetch error:", err);
      setError(err.message || "載入回報失敗，請確認管理員權限");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleExportCSV = () => {
    if (reports.length === 0) return;
    const csvContent = convertToCSV(reports);
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" }); // BOM for Excel Chinese reading
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `issue_reports_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      const state = (window as any).state;
      const supabase = state?.supabase;
      if (!supabase) throw new Error("Supabase client is not initialized");

      // Parametrized query built automatically by Supabase query builder
      const { error: delErr } = await supabase
        .from("issue_reports")
        .delete()
        .eq("id", deleteTargetId);

      if (delErr) throw delErr;

      setReports(prev => prev.filter(r => r.id !== deleteTargetId));
      setDeleteTargetId(null);
    } catch (err: any) {
      console.error("[IssueReportAdmin] Delete error:", err);
      alert(err.message || "刪除失敗");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6 p-6 bg-slate-50 dark:bg-zinc-950 rounded-xl">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-neutral-100">問題與建議回報管理</h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">檢視並管理使用者提交的 Bug 報告與介面建議</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={fetchReports}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-neutral-100 dark:hover:bg-zinc-800 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            重新整理
          </button>
          
          <button
            onClick={handleExportCSV}
            disabled={reports.length === 0 || isLoading}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            匯出 Excel/CSV
          </button>
        </div>
      </div>

      {/* Error Alert Box */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200 dark:border-rose-900/30">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">載入錯誤：</span>
            {error}
          </div>
        </div>
      )}

      {/* Reports Table Container */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow dark:border-zinc-800 dark:bg-zinc-900">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-400 dark:text-zinc-500">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <span className="mt-3 text-sm">正在載入回報清單...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-400 dark:text-zinc-500 text-sm">
            無任何回報資料
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 dark:divide-zinc-800 text-left text-xs">
            <thead className="bg-slate-50 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
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
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 text-slate-700 dark:text-zinc-300">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3.5 whitespace-nowrap text-slate-400 dark:text-zinc-500">
                    {new Date(report.created_at).toLocaleString("zh-TW")}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap font-medium text-slate-900 dark:text-neutral-100">
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
                  <td className="px-6 py-3.5 text-slate-800 dark:text-zinc-200 break-words leading-relaxed text-sm">
                    {report.description}
                  </td>
                  <td className="px-4 py-3.5 break-all max-w-[150px] text-indigo-600 dark:text-indigo-400 hover:underline">
                    {report.url ? <a href={report.url} target="_blank" rel="noreferrer">{new URL(report.url).pathname + new URL(report.url).search}</a> : "-"}
                  </td>
                  <td className="px-4 py-3.5 max-w-[150px] truncate text-slate-400 dark:text-zinc-500" title={report.user_agent}>
                    {report.user_agent || "-"}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 uppercase">
                      {report.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <button
                      onClick={() => setDeleteTargetId(report.id)}
                      className="inline-flex rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                      title="刪除此回報"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal / Dialog */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800">
            <h3 className="text-md font-bold text-slate-900 dark:text-neutral-100">確認刪除</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-2">
              您確定要刪除這筆使用者問題回報嗎？此動作將從 Supabase 中永久移除，無法復原。
            </p>
            
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={isDeleting}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-850 dark:text-neutral-200 dark:hover:bg-zinc-800"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 shadow-sm disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                確定刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
