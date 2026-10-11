// components/issue-report/AdminReportView.tsx
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, ChevronLeft, ImagePlus, Send, Trash2, Shield } from "lucide-react";
import { AdminReportTable } from "./AdminReportTable.tsx";
import { ThreadPipeline, compressScreenshot, fetchReportDiagnostics, type ThreadImage } from "./IssueReportBlocks.ts";
import { groupMessages, dayKey, dayLabel, clockTime, formatWhen, statusBadgeClass, CATEGORY_BADGE_CLASS } from "./ReportDrawer.tsx";
import { csvCell } from "../../js/modules/csv-cell.mjs";
import { fetchNlcTracked } from "../../js/diagnostics/report-diagnostics.mjs";

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

const CATEGORY_MAP: Record<string, string> = {
  bug: "Bug 錯誤",
  ui: "UI 建議",
  data: "資料問題",
  other: "其他"
};

const STATUS_MAP: Record<string, string> = {
  pending: "待處理",
  processing: "處理中",
  resolved: "已解決",
  ignored: "已忽略",
  closed: "已關閉"
};

export function convertToCSV(data: IssueReport[]): string {
  if (!data || data.length === 0) return "";
  // 改成對話串後，單一「官方回覆 / 回覆時間」欄不再適用（回覆散在對話串裡）；
  // 改放「訊息數 / 最後訊息時間」，一列仍代表一張 issue。
  const headers = ["ID", "建立時間", "分類", "處理狀況", "訊息數", "最後訊息時間", "問題描述", "頁面網址", "回報者姓名", "回報者牧區", "回報者小組"];
  const rows = data.map(item => [
    item.id,
    item.created_at,
    CATEGORY_MAP[item.category] || item.category,
    STATUS_MAP[item.status] || item.status || "待處理",
    (item as any).messageCount ?? "",
    (item as any).lastMessageAt || "",
    item.description || "",
    item.url || "",
    item.profiles?.name || "訪客/離線",
    item.profiles?.pastoral_zone || "",
    item.profiles?.small_group || ""
  ]);
  
  return [
    headers.join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\n");
}

export const AdminReportView: React.FC = () => {
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchReports = async () => {
    const state = (window as any).state;
    const currentUser = state?.currentUser;
    const role = (window as any).getUserRoleCode?.(currentUser)
      || currentUser?.role_definition?.code
      || 'member';
    const isUserAdmin = role === 'admin';
    if (!isUserAdmin) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await ThreadPipeline.adminList(undefined, 100, 0);
      if (!res.success) throw new Error(res.error || "載入回報失敗");
      const mapped: IssueReport[] = res.rows.map((row: any) => ({
        id: row.id,
        created_at: row.createdAt,
        category: row.category,
        description: row.description,
        url: row.url,
        status: row.status,
        metadata: {},
        profiles: row.reporter
          ? { name: row.reporter.name, pastoral_zone: row.reporter.pastoralZone, small_group: row.reporter.smallGroup }
          : null,
        // extra fields the table reads via (report as any)
        ...( { unreadFromMember: !!row.unreadFromMember, messageCount: row.messageCount, lastMessageAt: row.lastMessageAt } as any )
      }));
      setReports(mapped);
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
  const role = (window as any).getUserRoleCode?.(currentUser)
    || currentUser?.role_definition?.code
    || 'member';
  const isUserAdmin = role === 'admin';

  if (!isUserAdmin) {
    return null;
  }

  const handleExportCSV = (exportData?: IssueReport[]) => {
    const target = exportData || reports;
    if (target.length === 0) return;
    const csvContent = convertToCSV(target);
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `issue_reports_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 狀態下拉 / 快速回覆都走 0153 的 RPC（不再直接寫 issue_reports.metadata）。
  const handleUpdate = async (id: string, status: string, reply: string) => {
    const st = await ThreadPipeline.setStatus(id, status);
    if (!st.success) throw new Error(st.error || "狀態更新失敗");
    const text = (reply || "").trim();
    if (text) {
      const posted = await ThreadPipeline.post(id, { body: text });
      if (!posted.success) throw new Error(posted.error || "回覆送出失敗");
    }
    await fetchReports();
  };

  const handleDelete = async (id: string) => {
    const token = (window as any).auth?.getValidAccessToken
      ? await (window as any).auth.getValidAccessToken().catch(() => "")
      : "";
    const cfg = (window as any).state?.supabaseConfig || {};
    const supabaseUrl = String(cfg.url || "").replace(/\/+$/, "");
    if (!token || !supabaseUrl) throw new Error("請先登入管理員帳號");
    const request = {
      table: "issue_reports",
      action: "delete",
      filters: [{ type: "eq", column: "id", value: id }]
    };
    const response = await fetchNlcTracked(`${supabaseUrl}/functions/v1/nlc-data`, {
      method: "POST",
      headers: {
        "apikey": String(cfg.anonKey || ""),
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    }, request);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP 錯誤 ${response.status}`);
    setReports(prev => prev.filter(r => r.id !== id));
    if (openId === id) setOpenId(null);
  };

  return (
    <>
      <AdminReportTable
        reports={reports}
        isLoading={isLoading}
        error={error}
        onRefresh={fetchReports}
        onExport={handleExportCSV}
        onDelete={handleDelete}
        onUpdate={handleUpdate}
        onOpenThread={setOpenId}
      />
      {openId && createPortal(
        <AdminThreadPane
          reportId={openId}
          onClose={() => { setOpenId(null); void fetchReports(); }}
          onChanged={fetchReports}
        />,
        document.body
      )}
    </>
  );
};

// ───────────────────────── 管理端對話 pane ─────────────────────────

const CAT_LABEL: Record<string, string> = { bug: "Bug 錯誤", ui: "UI 建議", data: "資料問題", other: "其他" };
const ST_LABEL: Record<string, string> = { pending: "待處理", processing: "處理中", resolved: "已解決", ignored: "已存檔" };

function taipeiTime(iso?: string, withDate = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return withDate
    ? d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })
    : d.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

/** 回報診斷資訊（#548）的摘要列：[標籤, 值]。 */
export function diagnosticsSummaryRows(d: Record<string, any>): Array<[string, string]> {
  const source = d?.data_source || {};
  const queue = d?.offline_queue || {};
  const rows: Array<[string, string]> = [
    ["版本", d?.build_id || "—"],
    ["送出時間", taipeiTime(d?.submitted_at)],
    ["開啟方式", d?.standalone ? "主畫面 App" : "瀏覽器"],
    ["網路", d?.online === false ? "離線" : "線上"],
    ["頁面", d?.route || "—"],
    ["作用中計畫", d?.active_plan_id || "—"],
    ["資料來源", `${source.reading_data_source || "—"}${source.reading_data_stale === "true" ? "（舊資料）" : ""}`],
    ["資料讀取錯誤", source.repository_error || "無"],
    ["離線佇列", queue.available ? `待送 ${queue.pending ?? 0}／失敗 ${queue.failed ?? 0}` : "讀不到"]
  ];
  if (queue.last_error) rows.push(["佇列最後錯誤", String(queue.last_error)]);
  return rows;
}

export const ReportDiagnosticsPanel: React.FC<{ reportId: string }> = ({ reportId }) => {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [data, setData] = useState<Record<string, any> | null>(null);

  useEffect(() => { setStatus("idle"); setData(null); }, [reportId]);

  // 展開時才讀（列表不帶 metadata，避免每次開對話都多拉一份）
  const onToggle = async (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const open = e.currentTarget.open;
    if (!open || status === "loading" || status === "ready") return;
    setStatus("loading");
    const res = await fetchReportDiagnostics(reportId);
    if (res.success) { setData(res.data ?? null); setStatus("ready"); }
    else setStatus("error");
  };

  const requests: any[] = Array.isArray(data?.recent_requests) ? data!.recent_requests : [];
  const errors: any[] = Array.isArray(data?.recent_errors) ? data!.recent_errors : [];

  return (
    <details className="mt-2 border-t border-border pt-2" onToggle={onToggle}>
      <summary className="cursor-pointer select-none text-[11px] font-medium text-muted-foreground">診斷資訊</summary>
      <div className="mt-2 text-[12px] text-foreground">
        {status === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />讀取中…</div>
        )}
        {status === "error" && <div className="text-muted-foreground">讀取失敗，請收合後再展開一次。</div>}
        {status === "ready" && !data && <div className="text-muted-foreground">這筆回報沒有診斷資訊（較早送出的回報不會附）。</div>}
        {status === "ready" && data && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {diagnosticsSummaryRows(data).map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-all">{value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">最近的請求</div>
              {requests.length === 0 ? <div className="text-muted-foreground">無</div> : (
                <ul className="flex flex-col gap-1 font-mono text-[11px]">
                  {requests.map((r, i) => (
                    <li key={`${r.request_id}-${i}`} className="break-all">
                      {taipeiTime(r.at, false)} · {r.action} · {r.status || "失敗"} · {r.ms}ms · <span className="select-all">{r.request_id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">最近的錯誤</div>
              {errors.length === 0 ? <div className="text-muted-foreground">無</div> : (
                <ul className="flex flex-col gap-2">
                  {errors.map((er, i) => (
                    <li key={`${er.at}-${i}`} className="rounded-md bg-muted px-2 py-1">
                      <div className="text-[11px] text-muted-foreground">{taipeiTime(er.at, false)} · {er.kind}</div>
                      <div className="break-all">{er.message}</div>
                      {er.stack && <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">{er.stack}</pre>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
};

export const AdminThreadPane: React.FC<{
  reportId: string;
  onClose: () => void;
  onChanged: () => void;
  embedded?: boolean;      // true = 填滿父容器（給浮動泡泡用），不畫 fixed 遮罩
  onBack?: () => void;     // embedded 時左上角按鈕的行為（回列表）
}> = ({ reportId, onClose, onChanged, embedded = false, onBack }) => {
  const [thread, setThread] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [image, setImage] = useState<ThreadImage | null>(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [text]);

  const load = async () => {
    const res = await ThreadPipeline.get(reportId, true);
    if (res.success && res.data) setThread(res.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const iv = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 20000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const report = thread?.report;
  const messages: any[] = Array.isArray(thread?.messages) ? thread.messages : [];

  const send = async () => {
    const body = text.trim();
    if ((!body && !image) || busy) return;
    setBusy(true); setErr(null);
    const res = await ThreadPipeline.post(reportId, { body, image, isInternal: internal });
    setBusy(false);
    if (res.success) {
      setText(""); setImage(null); setInternal(false);
      await load();
      onChanged();
    } else {
      setErr(res.error === "rate_limited" ? "訊息太頻繁，請稍候。" : "送出失敗，請再試一次。");
    }
  };

  const pick = async (f?: File) => {
    if (!f) return;
    const shot = await compressScreenshot(f);
    if (!shot) { setErr("這張圖無法處理"); return; }
    setImage(shot);
  };

  const setStatus = async (s: string) => {
    const r = await ThreadPipeline.setStatus(reportId, s);
    if (r.success) { await load(); onChanged(); }
  };

  const delAttachment = async (messageId: string) => {
    if (!window.confirm("刪除這張截圖？")) return;
    const r = await ThreadPipeline.deleteAttachment(messageId);
    if (r.success) await load();
  };

  const body = (
      <>
        <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-2">
          <button type="button" onClick={embedded ? (onBack || onClose) : onClose} className="secondary-btn h-8 w-8 p-0" aria-label={embedded ? "返回列表" : "關閉"}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          {report && (
            <>
              <span className={CATEGORY_BADGE_CLASS}>
                {CAT_LABEL[report.category] || report.category}
              </span>
              <span className={`${statusBadgeClass(report.status)} ml-auto`}>
                {ST_LABEL[report.status] || report.status}
              </span>
              <select
                value={report.status}
                onChange={(e) => setStatus(e.target.value)}
                className="text-sm rounded-md border border-border bg-card text-foreground px-2 py-1"
                aria-label="變更狀態"
              >
                {Object.entries(ST_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </>
          )}
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {loading && !thread ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">載入對話…</span>
            </div>
          ) : (
            <>
              {report && (
                <div className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                    原始回報 · {formatWhen(report.createdAt)}{report.url ? ` · ${report.url}` : ""}
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground">{report.description}</p>
                  <ReportDiagnosticsPanel reportId={reportId} />
                </div>
              )}
              {messages.length === 0 && (
                <div className="mx-auto my-2 rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                  尚無往來訊息
                </div>
              )}
              {groupMessages(messages).map((grp, gi, all) => {
                const m0 = grp[0];
                const fromAdmin = m0.authorRole === "admin";
                const prev = all[gi - 1];
                const showDay = !prev || dayKey(prev[0].createdAt) !== dayKey(m0.createdAt);
                return (
                  <React.Fragment key={m0.id}>
                    {showDay && (
                      <div className="mx-auto my-1 rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
                        {dayLabel(m0.createdAt)}
                      </div>
                    )}
                    <div className={`flex flex-col ${fromAdmin ? "items-end" : "items-start"}`}>
                      <span className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        {fromAdmin && <Shield className="h-3 w-3 text-primary" />}
                        {fromAdmin ? "管理員" : "會友"}{m0.isInternal ? "（內部備註）" : ""}
                      </span>
                      <div className={`flex flex-col gap-1 ${fromAdmin ? "items-end" : "items-start"}`}>
                        {grp.map((m: any) => (
                          <div
                            key={m.id}
                            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                              m.isInternal ? "border"
                              : fromAdmin ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-card border border-border text-foreground rounded-bl-sm"
                            }`}
                            style={m.isInternal ? {
                              background: "var(--color-warning-subtle)",
                              color: "var(--color-warning-foreground, var(--text-primary))",
                              borderColor: "color-mix(in srgb, var(--color-warning) 30%, transparent)"
                            } : undefined}
                          >
                            {m.body && <span>{m.body}</span>}
                            {m.attachmentUrl && (
                              <div className={m.body ? "mt-2" : ""}>
                                <img src={m.attachmentUrl} alt="截圖" onClick={() => setLightbox(m.attachmentUrl)}
                                  className="max-h-52 max-w-full cursor-pointer rounded-md object-cover" />
                                <button type="button" onClick={() => delAttachment(m.id)}
                                  className="mt-1 inline-flex items-center gap-1 bg-transparent text-xs text-destructive hover:underline">
                                  <Trash2 className="h-3 w-3" /> 刪除截圖
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">{clockTime(grp[grp.length - 1].createdAt)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          {err && <p className="mb-2 text-xs text-destructive">{err}</p>}
          {image && (
            <div className="mb-2 flex items-center gap-2">
              <img src={`data:${image.mime};base64,${image.base64}`} alt="待送" className="h-14 w-14 rounded-md border border-border object-cover" />
              <button type="button" className="secondary-btn text-xs" onClick={() => setImage(null)}>移除</button>
            </div>
          )}
          <label className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            內部備註（會友看不到）
          </label>
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { pick(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            <button type="button" className="secondary-btn h-10 w-10 p-0" onClick={() => fileRef.current?.click()} aria-label="加截圖">
              <ImagePlus className="h-4 w-4" />
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
              placeholder="輸入回覆…"
              aria-label="輸入回覆"
              data-admin-reply-textarea
              className="max-h-[120px] min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button type="button" className="primary-btn h-10 w-10 p-0 justify-center"
              disabled={busy || (!text.trim() && !image)} onClick={send} aria-label="送出">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </>
  );

  const lightboxEl = lightbox ? (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
      <img src={lightbox} alt="截圖" className="max-h-[90dvh] max-w-full rounded-md object-contain" />
    </div>
  ) : null;

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {body}
        {lightboxEl}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-stretch justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-background border-l border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
      {lightboxEl}
    </div>
  );
};

// 浮動泡泡的「回覆模式」用：精簡回報清單（最新在上），會友有新訊息標紅點。
export const AdminMiniList: React.FC<{
  onOpen: (reportId: string) => void;
  autoOpenNewest?: boolean;
  reloadKey?: number;
}> = ({ onOpen, autoOpenNewest, reloadKey }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const openedRef = React.useRef(false);

  const load = async () => {
    const res = await ThreadPipeline.adminList(undefined, 50, 0);
    setLoading(false);
    if (!res.success) return;
    setRows(res.rows);
    if (autoOpenNewest && !openedRef.current && res.rows.length) {
      openedRef.current = true;
      onOpen(res.rows[0].id);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadKey]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /><span className="text-sm">載入回報…</span>
      </div>
    );
  }
  if (!rows.length) {
    return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">目前沒有回報</div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          className="w-full text-left rounded-lg border border-border bg-card p-3 shadow-sm hover:border-muted-foreground/40"
        >
          <div className="flex items-center gap-2">
            {r.unreadFromMember && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="會友有新訊息" />}
            <span className={CATEGORY_BADGE_CLASS}>{CAT_LABEL[r.category] || r.category}</span>
            <span className={statusBadgeClass(r.status)}>{ST_LABEL[r.status] || r.status}</span>
            <span className="ml-auto text-xs text-muted-foreground">{formatWhen(r.lastMessageAt || r.createdAt)}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {r.reporter?.name || "訪客/離線"}{r.reporter?.pastoralZone ? ` · ${r.reporter.pastoralZone}` : ""}
          </div>
          <p className="mt-1 text-sm text-foreground line-clamp-2 leading-relaxed">{r.description}</p>
        </button>
      ))}
    </div>
  );
};
