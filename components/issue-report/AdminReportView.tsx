// components/issue-report/AdminReportView.tsx
import React, { useState, useEffect } from "react";
import { AdminReportTable } from "./AdminReportTable.tsx";

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

export function convertToCSV(data: IssueReport[]): string {
  if (!data || data.length === 0) return "";
  const headers = ["ID", "建立時間", "分類", "問題描述", "回報者姓名", "回報者牧區", "回報者小組"];
  const rows = data.map(item => [
    item.id,
    item.created_at,
    CATEGORY_MAP[item.category] || item.category,
    item.description.replace(/"/g, '""'),
    item.profiles?.name || "訪客/離線",
    item.profiles?.pastoral_zone || "",
    item.profiles?.small_group || ""
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

  const fetchReports = async () => {
    const state = (window as any).state;
    const currentUser = state?.currentUser;
    const role = currentUser?.role || 'member';
    const realRole = state?.realRole || role;
    const isUserAdmin = role === 'admin' || realRole === 'admin';
    if (!isUserAdmin) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const supabase = state?.supabase;
      const cfg = state?.supabaseConfig || {};
      const supabaseUrl = cfg.url || "";
      const supabaseAnonKey = cfg.anonKey || "";

      if (!supabase) {
        throw new Error("Supabase client is not initialized");
      }

      let accessToken = "";
      if (supabase && typeof supabase.auth?.getSession === "function") {
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (!sessionErr && session) {
          accessToken = session.access_token;
        }
      }
      if (!accessToken && (window as any).auth && typeof (window as any).auth.getValidAccessToken === "function") {
        accessToken = await (window as any).auth.getValidAccessToken();
      }

      if (!accessToken) {
        throw new Error("請先登入管理員帳號");
      }

      const functionUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/nlc-data`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          table: "issue_reports",
          action: "select",
          select: "*, profiles(name, pastoral_zone, small_group)",
          order: { column: "created_at", ascending: false }
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP 錯誤 ${response.status}`);
      }

      setReports(payload.data || []);
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

  const state = (window as any).state;
  const currentUser = state?.currentUser;
  const role = currentUser?.role || 'member';
  const realRole = state?.realRole || role;
  const isUserAdmin = role === 'admin' || realRole === 'admin';

  if (!isUserAdmin) {
    return null;
  }

  const handleExportCSV = () => {
    if (reports.length === 0) return;
    const csvContent = convertToCSV(reports);
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `issue_reports_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (id: string) => {
    try {
      const state = (window as any).state;
      const supabase = state?.supabase;
      const cfg = state?.supabaseConfig || {};
      const supabaseUrl = cfg.url || "";
      const supabaseAnonKey = cfg.anonKey || "";

      if (!supabase) throw new Error("Supabase client is not initialized");

      let accessToken = "";
      if (supabase && typeof supabase.auth?.getSession === "function") {
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (!sessionErr && session) {
          accessToken = session.access_token;
        }
      }
      if (!accessToken && (window as any).auth && typeof (window as any).auth.getValidAccessToken === "function") {
        accessToken = await (window as any).auth.getValidAccessToken();
      }

      if (!accessToken) {
        throw new Error("請先登入管理員帳號");
      }

      const functionUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/nlc-data`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          table: "issue_reports",
          action: "delete",
          filters: [
            { type: "eq", column: "id", value: id }
          ]
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP 錯誤 ${response.status}`);
      }

      setReports(prev => prev.filter(r => r.id !== id));
    } catch (err: any) {
      console.error("[IssueReportAdmin] Delete error:", err);
      throw err;
    }
  };

  return (
    <AdminReportTable
      reports={reports}
      isLoading={isLoading}
      error={error}
      onRefresh={fetchReports}
      onExport={handleExportCSV}
      onDelete={handleDelete}
    />
  );
};
