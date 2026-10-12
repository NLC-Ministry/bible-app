// 一張回報的對話（#550 第一組）：原始回報、診斷資訊、往來訊息、回覆／內部備註、改狀態、刪截圖、刪回報。
//
// · 打開時 1 個 report_thread（伺服器記 view_report、標記管理員已讀）；之後畫面在前景時每 20 秒
//   自動更新（refresh: true，不重複記稽核）。截圖是 5 分鐘有效的簽名網址，自動更新會換新的。
// · 診斷資訊展開才抓（report_diagnostics，有快取）。
// · 會改資料的按鈕要 support.write；稽核由伺服器在同一個交易內寫。
// · 會友寫的字一律當文字顯示；不用 style 屬性（CSP），輸入框高度用 CSS field-sizing。
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ChevronLeft, ImagePlus, Send, Shield, Trash2, UserRound, X } from "lucide-react";
import { compressScreenshot } from "../../../lib/issue-report/compress-screenshot.ts";
import { diagnosticsSummaryRows } from "../../../lib/issue-report/report-diagnostics-summary.ts";
import { describeAdminError, type AdminApi } from "../api.ts";
import { REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, formatDate, formatDateTime, label, text } from "../format.ts";
import { formatRoute } from "../route.ts";
import type { ReportMessage, ReportThread } from "../types.ts";
import { Badge, ErrorNotice, Spinner } from "../ui.tsx";
import { statusTone } from "./ReportInbox.tsx";

export const THREAD_REFRESH_MS = 20_000;
export const MAX_REPLY_CHARS = 500;
const STATUSES = ["pending", "processing", "resolved", "ignored"] as const;

type PickedImage = { base64: string; mime: string; w: number; h: number };

type Props = {
  api: AdminApi;
  reportId: string;
  capabilities: readonly string[];
  onChanged: () => void;
  onOpened: (reportId: string) => void;
  onDeleted?: () => void;
  refreshMs?: number;
};

export function ReportThreadView({ api, reportId, capabilities, onChanged, onOpened, onDeleted, refreshMs = THREAD_REFRESH_MS }: Props) {
  const [thread, setThread] = useState<ReportThread | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAttachment, setConfirmAttachment] = useState<string | null>(null);
  const canWrite = capabilities.includes("support.write");

  // 打開：記 view_report
  useEffect(() => {
    let active = true;
    setError(null);
    api.call<ReportThread>("report_thread", { report_id: reportId })
      .then((data) => {
        if (!active) return;
        setThread(data);
        onOpened(reportId);
      })
      .catch((err) => { if (active) setError(err); });
    return () => { active = false; };
  }, [api, reportId, reloadKey, onOpened]);

  const refresh = useCallback(() => {
    return api.call<ReportThread>("report_thread", { report_id: reportId, refresh: true })
      .then((data) => setThread(data))
      .catch(() => { /* 自動更新失敗不打斷畫面，下一輪再試 */ });
  }, [api, reportId]);

  // 前景時每 20 秒自動更新
  useEffect(() => {
    if (!thread || refreshMs <= 0) return undefined;
    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState !== "hidden") void refresh();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [thread !== null, refresh, refreshMs]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setLightbox(null); };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, [lightbox]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: string) => run(async () => {
    const result = await api.call<{ status: string; closed_at: string | null }>("report_set_status", { report_id: reportId, status });
    setThread((prev) => prev ? { ...prev, report: { ...prev.report, status: result.status, closed_at: result.closed_at } } : prev);
    onChanged();
  });

  const deleteAttachment = (messageId: string) => run(async () => {
    await api.call("report_attachment_delete", { message_id: messageId });
    setConfirmAttachment(null);
    await refresh();
    onChanged();
  });

  const deleteReport = (reason: string) => run(async () => {
    await api.call("report_delete", { report_id: reportId, reason: reason.trim() || undefined });
    onChanged();
    onDeleted?.();
  });

  if (error) {
    return (
      <div className="adm-detail">
        <BackLink />
        <ErrorNotice error={error} action={<button type="button" className="adm-button" onClick={() => setReloadKey((n) => n + 1)}>重試</button>} />
      </div>
    );
  }
  if (!thread) {
    return (
      <div className="adm-detail">
        <BackLink />
        <Spinner label="載入對話…" />
      </div>
    );
  }

  const { report, messages } = thread;
  const reporter = report.reporter;
  const lastSeenByMember = lastAdminMessageSeen(messages, report.member_last_read_at);

  return (
    <div className="adm-detail adm-thread">
      <BackLink />
      <header className="adm-thread__header">
        <div className="adm-badges">
          <Badge>{label(REPORT_CATEGORY_LABEL, report.category)}</Badge>
          <Badge tone={statusTone(report.status)}>{label(REPORT_STATUS_LABEL, report.status)}</Badge>
        </div>
        <div className="adm-thread__reporter">
          <span>{reporter ? text(reporter.name, "（未填姓名）") : "訪客／離線"}</span>
          {reporter && (
            <span className="adm-muted adm-small">
              {[reporter.great_region, reporter.pastoral_zone, reporter.small_group].filter(Boolean).join("／") || "沒有牧養歸屬"}
            </span>
          )}
          {reporter && (
            <a
              className="adm-button adm-button--ghost"
              href={formatRoute({ view: "user", userId: reporter.id, tab: "overview", reason: `因回報 ${report.id.slice(0, 8)}` })}
            >
              <UserRound className="adm-icon" aria-hidden="true" />查看這位會友
            </a>
          )}
        </div>
        {canWrite && (
          <div className="adm-thread__actions">
            <label className="adm-visually-hidden" htmlFor="adm-report-status">處理狀態</label>
            <select
              id="adm-report-status"
              className="adm-select"
              value={report.status}
              disabled={busy}
              onChange={(event) => { void setStatus(event.target.value); }}
            >
              {STATUSES.map((status) => <option key={status} value={status}>{REPORT_STATUS_LABEL[status]}</option>)}
            </select>
            <button type="button" className="adm-button adm-button--ghost adm-button--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 className="adm-icon" aria-hidden="true" />刪除回報
            </button>
          </div>
        )}
        {confirmDelete && (
          <DeleteReportConfirm busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={(reason) => { void deleteReport(reason); }} />
        )}
        {actionError !== null && <ErrorNotice error={actionError} />}
      </header>

      <section className="adm-card adm-report-original">
        <div className="adm-card__body">
          <p className="adm-muted adm-small">
            原始回報・{formatDateTime(report.created_at)}{report.url ? `・${report.url}` : ""}
          </p>
          <p className="adm-prewrap">{report.description}</p>
          {report.has_diagnostics
            ? <Diagnostics api={api} reportId={report.id} />
            : <p className="adm-muted adm-small">這筆回報沒有附診斷資訊（較早送出的回報不會附）。</p>}
        </div>
      </section>

      <ol className="adm-messages" aria-label="往來訊息">
        {messages.length === 0 && <li className="adm-muted adm-small adm-messages__empty">還沒有往來訊息</li>}
        {messages.map((message, index) => {
          const day = formatDate(message.created_at);
          const showDay = index === 0 || formatDate(messages[index - 1].created_at) !== day;
          return (
            <MessageItem
              key={message.id}
              message={message}
              dayLabel={showDay ? day : null}
              seenByMember={message.id === lastSeenByMember}
              canWrite={canWrite}
              confirming={confirmAttachment === message.id}
              busy={busy}
              onOpenImage={setLightbox}
              onAskDelete={() => setConfirmAttachment(message.id)}
              onCancelDelete={() => setConfirmAttachment(null)}
              onDelete={() => { void deleteAttachment(message.id); }}
            />
          );
        })}
      </ol>

      {canWrite && (
        <Composer
          api={api}
          reportId={reportId}
          onSent={async () => { await refresh(); onChanged(); }}
        />
      )}

      {lightbox && (
        <div className="adm-lightbox" role="dialog" aria-modal="true" aria-label="截圖" onClick={() => setLightbox(null)}>
          <button type="button" className="adm-icon-button adm-lightbox__close" aria-label="關閉" onClick={() => setLightbox(null)}>
            <X className="adm-icon" aria-hidden="true" />
          </button>
          <img src={lightbox} alt="截圖" />
        </div>
      )}
    </div>
  );
}

/** 會友已讀到哪一則管理員回覆（內部備註不算，會友看不到）。 */
export function lastAdminMessageSeen(messages: readonly ReportMessage[], memberLastReadAt: string | null): string | null {
  if (!memberLastReadAt) return null;
  const readAt = Date.parse(memberLastReadAt);
  if (Number.isNaN(readAt)) return null;
  let seen: string | null = null;
  for (const message of messages) {
    if (message.author_role === "admin" && !message.is_internal && Date.parse(message.created_at) <= readAt) seen = message.id;
  }
  return seen;
}

function BackLink() {
  return (
    <a className="adm-back" href={formatRoute({ view: "inbox", reportId: null })}>
      <ChevronLeft className="adm-icon" aria-hidden="true" />回到收件匣
    </a>
  );
}

function MessageItem({ message, dayLabel, seenByMember, canWrite, confirming, busy, onOpenImage, onAskDelete, onCancelDelete, onDelete }: {
  message: ReportMessage;
  dayLabel: string | null;
  seenByMember: boolean;
  canWrite: boolean;
  confirming: boolean;
  busy: boolean;
  onOpenImage: (url: string) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const fromAdmin = message.author_role === "admin";
  const kind = message.is_internal ? "note" : fromAdmin ? "admin" : "member";
  return (
    <li className={`adm-message-item adm-message-item--${kind}`}>
      {dayLabel && <p className="adm-messages__day">{dayLabel}</p>}
      <p className="adm-message-item__author adm-small">
        {fromAdmin && <Shield className="adm-icon adm-icon--small" aria-hidden="true" />}
        {fromAdmin ? text(message.author_name, "管理員") : "會友"}
        {message.is_internal && "（內部備註，會友看不到）"}
      </p>
      <div className="adm-bubble">
        {message.body && <p className="adm-prewrap">{message.body}</p>}
        {message.has_attachment && (
          message.attachment_url
            ? (
              <button type="button" className="adm-bubble__image" onClick={() => onOpenImage(message.attachment_url as string)} aria-label="放大截圖">
                <img
                  src={message.attachment_url}
                  alt="截圖"
                  width={message.attachment_w ?? undefined}
                  height={message.attachment_h ?? undefined}
                  loading="lazy"
                />
              </button>
            )
            : <p className="adm-muted adm-small">（截圖暫時讀不到）</p>
        )}
        {message.has_attachment && canWrite && (
          confirming
            ? (
              <span className="adm-inline-confirm adm-small">
                刪除這張截圖？
                <button type="button" className="adm-link-button adm-link-button--danger" onClick={onDelete} disabled={busy}>刪除</button>
                <button type="button" className="adm-link-button" onClick={onCancelDelete} disabled={busy}>取消</button>
              </span>
            )
            : <button type="button" className="adm-link-button adm-small" onClick={onAskDelete} disabled={busy}>刪除截圖</button>
        )}
      </div>
      <p className="adm-message-item__time adm-muted adm-small">
        {formatDateTime(message.created_at)}{seenByMember ? "・會友已讀" : ""}
      </p>
    </li>
  );
}

function DeleteReportConfirm({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="adm-notice adm-notice--danger" role="alertdialog" aria-label="確認刪除回報">
      <div className="adm-notice__body">
        <p>刪除後會友那邊也看不到這張回報，連同所有訊息和截圖一起刪除，無法復原。</p>
        <label className="adm-label" htmlFor="adm-delete-reason">刪除原因（選填，會記進稽核）</label>
        <input id="adm-delete-reason" className="adm-input" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
        <div className="adm-row">
          <button type="button" className="adm-button adm-button--danger-solid" onClick={() => onConfirm(reason)} disabled={busy}>確定刪除</button>
          <button type="button" className="adm-button" onClick={onCancel} disabled={busy}>取消</button>
        </div>
      </div>
    </div>
  );
}

function Diagnostics({ api, reportId }: { api: AdminApi; reportId: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; data: Record<string, any> | null; error: unknown }>({ status: "idle", data: null, error: null });
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open || state.status === "loading" || state.status === "ready") return;
    setState({ status: "loading", data: null, error: null });
    api.call<{ diagnostics: Record<string, any> | null }>("report_diagnostics", { report_id: reportId })
      .then((result) => setState({ status: "ready", data: result?.diagnostics ?? null, error: null }))
      .catch((error) => setState({ status: "error", data: null, error }));
  };
  const requests: any[] = Array.isArray(state.data?.recent_requests) ? state.data!.recent_requests : [];
  const errors: any[] = Array.isArray(state.data?.recent_errors) ? state.data!.recent_errors : [];
  return (
    <details className="adm-diagnostics" onToggle={onToggle}>
      <summary>診斷資訊</summary>
      {state.status === "loading" && <Spinner label="讀取中…" />}
      {state.status === "error" && <ErrorNotice error={state.error} />}
      {state.status === "ready" && !state.data && <p className="adm-muted adm-small">這筆回報沒有診斷資訊。</p>}
      {state.status === "ready" && state.data && (
        <div className="adm-diagnostics__body">
          <dl className="adm-fields adm-fields--compact">
            {diagnosticsSummaryRows(state.data).map(([name, value]) => (
              <div className="adm-field" key={name}><dt>{name}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <h4 className="adm-subheading">最近的請求</h4>
          {requests.length === 0 ? <p className="adm-muted adm-small">無</p> : (
            <ul className="adm-mono-list">
              {requests.map((request, index) => (
                <li key={`${request.request_id}-${index}`}>
                  {formatDateTime(request.at)}・{text(request.action)}・{request.status || "失敗"}・{text(request.ms)}ms・<code>{text(request.request_id)}</code>
                </li>
              ))}
            </ul>
          )}
          <h4 className="adm-subheading">最近的錯誤</h4>
          {errors.length === 0 ? <p className="adm-muted adm-small">無</p> : (
            <ul className="adm-mono-list">
              {errors.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="adm-muted">{formatDateTime(entry.at)}・{text(entry.kind)}</span>
                  <p className="adm-prewrap">{text(entry.message)}</p>
                  {entry.stack && <pre className="adm-pre">{String(entry.stack)}</pre>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

function Composer({ api, reportId, onSent }: { api: AdminApi; reportId: string; onSent: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const shot = await compressScreenshot(file).catch(() => null);
    if (!shot) {
      setError("這張圖無法處理，請換一張（PNG、JPEG、WebP）。");
      return;
    }
    setImage(shot);
  };

  const send = async () => {
    if (sending || (!body.trim() && !image)) return;
    setSending(true);
    setError(null);
    try {
      await api.call("report_post", { report_id: reportId, body, is_internal: internal, ...(image ? { image } : {}) });
      setBody("");
      setImage(null);
      setInternal(false);
      await onSent();
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="adm-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error && <p className="adm-danger-text adm-small" role="alert">{error}</p>}
      {image && (
        <div className="adm-composer__preview">
          <img src={`data:${image.mime};base64,${image.base64}`} alt="要送出的截圖" />
          <button type="button" className="adm-button adm-button--ghost" onClick={() => setImage(null)}>移除截圖</button>
        </div>
      )}
      <label className="adm-visually-hidden" htmlFor="adm-reply">回覆內容</label>
      <textarea
        id="adm-reply"
        className="adm-input adm-composer__input"
        rows={3}
        value={body}
        maxLength={MAX_REPLY_CHARS}
        placeholder={internal ? "內部備註（會友看不到）…" : "回覆會友…（Ctrl＋Enter 送出）"}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="adm-composer__bar">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="adm-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => { void pick(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />
        <button type="button" className="adm-icon-button" onClick={() => fileRef.current?.click()} aria-label="附上截圖" title="附上截圖">
          <ImagePlus className="adm-icon" aria-hidden="true" />
        </button>
        <label className="adm-checkbox adm-small">
          <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
          內部備註
        </label>
        <span className="adm-muted adm-small adm-composer__count">{body.length}/{MAX_REPLY_CHARS}</span>
        <button type="submit" className="adm-button adm-button--primary" disabled={sending || (!body.trim() && !image)}>
          <Send className="adm-icon" aria-hidden="true" />{sending ? "送出中…" : internal ? "存備註" : "送出"}
        </button>
      </div>
    </form>
  );
}
