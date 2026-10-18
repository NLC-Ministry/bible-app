// 回報收件匣（#550 第一組）：左邊清單、右邊對話；手機一次只顯示一邊。
//
// 請求預算：打開收件匣 1 個 report_list（第一頁順便帶各狀態筆數）；切篩選、按「重新整理」、
// 「載入更多」才再打。清單狀態放在 App 那一層（#567），從回報打開某人再回來不重抓。
// 會友寫的內容一律當文字顯示（React 預設跳脫），不用 innerHTML。
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Download, RefreshCw } from "lucide-react";
import { isAbortError, type AdminApi } from "../api.ts";
import { downloadCsv } from "../download.ts";
import { REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, formatDateTime, label, text } from "../format.ts";
import { formatRoute } from "../route.ts";
import type { ReportCounts, ReportExport, ReportListItem, ReportPage, Cursor } from "../types.ts";
import { Badge, ErrorNotice, Spinner } from "../ui.tsx";
import { ReportThreadView } from "./ReportThread.tsx";

export const REPORT_PAGE_SIZE = 30;

export const INBOX_FILTERS = ["open", "unread", "resolved", "ignored", "all"] as const;
export type InboxFilter = typeof INBOX_FILTERS[number];

// open＝待處理＋處理中；不叫「待處理」，免得和狀態標籤的「待處理」（pending）混在一起
const FILTER_LABEL: Record<InboxFilter, string> = {
  open: "未結案",
  unread: "有新訊息",
  resolved: "已解決",
  ignored: "已存檔",
  all: "全部"
};

export function filterParams(filter: InboxFilter): Record<string, unknown> {
  if (filter === "unread") return { unread_only: true };
  if (filter === "all") return {};
  return { status: filter };
}

export type InboxState = {
  filter: InboxFilter;
  items: ReportListItem[];
  cursor: Cursor | null;
  counts: ReportCounts | null;
  loaded: InboxFilter | null; // 目前 items 是哪個篩選的結果
  loading: boolean;
  error: unknown;
};

export const INITIAL_INBOX: InboxState = { filter: "open", items: [], cursor: null, counts: null, loaded: null, loading: false, error: null };

/** 這次打開過的回報：清單若比對話晚回來（伺服器還沒標已讀），用這裡補成已讀。 */
export function markOpened(items: ReportListItem[], opened: ReadonlyMap<string, number>): { items: ReportListItem[]; cleared: number } {
  let cleared = 0;
  const next = items.map((item) => {
    const at = opened.get(item.id);
    if (!item.unread || at === undefined) return item;
    const last = Date.parse(item.last_message_at || item.created_at);
    if (Number.isNaN(last) || last > at) return item;
    cleared += 1;
    return { ...item, unread: false };
  });
  return { items: next, cleared };
}

export function statusTone(status: string): "neutral" | "brand" | "warning" {
  if (status === "pending") return "warning";
  if (status === "processing") return "brand";
  return "neutral";
}

type Props = {
  api: AdminApi;
  reportId: string | null;
  capabilities: readonly string[];
  state: InboxState;
  setState: Dispatch<SetStateAction<InboxState>>;
  doc: Document;
};

export function ReportInbox({ api, reportId, capabilities, state, setState, doc }: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(new Map<string, number>());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exportNote, setExportNote] = useState("");

  const load = useCallback((filter: InboxFilter, cursor: Cursor | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, filter, loading: true, error: null, ...(cursor ? {} : { items: prev.loaded === filter ? prev.items : [] }) }));
    const params: Record<string, unknown> = { ...filterParams(filter), limit: REPORT_PAGE_SIZE };
    if (cursor) params.cursor = cursor;
    api.call<ReportPage>("report_list", params, { signal: controller.signal })
      .then((page) => {
        const { items, cleared } = markOpened(Array.isArray(page?.items) ? page.items : [], openedRef.current);
        const counts = page?.counts ? { ...page.counts, unread: Math.max(0, page.counts.unread - cleared) } : null;
        setState((prev) => ({
          ...prev,
          filter,
          items: cursor ? [...prev.items, ...items] : items,
          cursor: page?.next_cursor && typeof page.next_cursor.at === "string" ? page.next_cursor : null,
          counts: counts ?? prev.counts,
          loaded: filter,
          loading: false,
          error: null
        }));
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setState((prev) => ({ ...prev, loading: false, error: err }));
      });
  }, [api, setState]);

  // 第一次打開才抓（失敗時等管理員按重試，不自動重抓）
  useEffect(() => {
    if (state.loaded !== state.filter && !state.loading && state.error === null) load(state.filter, null);
  }, [state.filter, state.loaded, state.loading, state.error, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refresh = () => load(state.filter, null);

  // 對話裡改了狀態、回覆、刪除 → 重抓第一頁，順便丟掉某人頁面的快取
  const onThreadChanged = useCallback(() => {
    api.invalidate(["user_summary", "user_section", "user_timeline"]);
    load(state.filter, null);
  }, [api, load, state.filter]);

  const onThreadOpened = useCallback((id: string) => {
    openedRef.current.set(id, Date.now());
    setState((prev) => {
      const { items, cleared } = markOpened(prev.items, openedRef.current);
      if (!cleared) return prev;
      return { ...prev, items, counts: prev.counts ? { ...prev.counts, unread: Math.max(0, prev.counts.unread - cleared) } : prev.counts };
    });
  }, [setState]);

  // 刪掉回報 → 回到收件匣（清單已在 onChanged 重抓）
  const onThreadDeleted = useCallback(() => {
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "inbox", reportId: null });
  }, [doc]);

  const canExport = capabilities.includes("export") && state.filter !== "unread";
  const exportCsv = () => {
    setExporting(true);
    setExportError(null);
    setExportNote("");
    api.call<ReportExport>("report_export", state.filter === "all" ? {} : { status: state.filter })
      .then((file) => {
        downloadCsv(doc, file.filename, file.csv);
        setExportNote(file.truncated ? `已匯出最新 ${file.rows} 筆（共 ${file.total} 筆，超過上限的沒有匯出）。` : `已匯出 ${file.rows} 筆。`);
      })
      .catch((err) => setExportError(err))
      .finally(() => setExporting(false));
  };

  return (
    <div className={`adm-support${reportId ? " adm-support--user-open" : ""}`}>
      <div className="adm-support__search adm-inbox">
        <div className="adm-inbox__toolbar">
          <h2 className="adm-inbox__title">回報收件匣</h2>
          <button type="button" className="adm-icon-button" onClick={refresh} disabled={state.loading} aria-label="重新整理" title="重新整理">
            <RefreshCw className={`adm-icon${state.loading ? " adm-spin" : ""}`} aria-hidden="true" />
          </button>
          {capabilities.includes("export") && (
            <button
              type="button"
              className="adm-icon-button"
              onClick={exportCsv}
              disabled={!canExport || exporting}
              aria-label="匯出 CSV"
              title={state.filter === "unread" ? "「有新訊息」不能匯出，請改選狀態篩選" : "匯出目前篩選的回報（CSV）"}
            >
              <Download className="adm-icon" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="adm-chips" role="group" aria-label="篩選回報">
          {INBOX_FILTERS.map((filter) => {
            const count = state.counts ? state.counts[filter] : null;
            return (
              <button
                key={filter}
                type="button"
                className={`adm-chip${state.filter === filter ? " adm-chip--active" : ""}`}
                aria-pressed={state.filter === filter}
                onClick={() => { if (filter !== state.filter) load(filter, null); }}
              >
                {FILTER_LABEL[filter]}
                {count !== null && count !== undefined && <span className="adm-chip__count">{count}</span>}
              </button>
            );
          })}
        </div>
        {exportError !== null && <ErrorNotice error={exportError} />}
        {exportNote && <p className="adm-muted adm-small" role="status">{exportNote}</p>}
        {state.error !== null && (
          <ErrorNotice error={state.error} action={<button type="button" className="adm-button" onClick={refresh}>重試</button>} />
        )}
        {state.loaded === state.filter && state.items.length === 0 && !state.loading && state.error === null && (
          <p className="adm-muted adm-empty">沒有{FILTER_LABEL[state.filter] === "全部" ? "任何" : `「${FILTER_LABEL[state.filter]}」的`}回報。</p>
        )}
        <ul className="adm-result-list">
          {state.items.map((item) => <InboxRow key={item.id} item={item} active={item.id === reportId} />)}
        </ul>
        {state.loading && <Spinner label="載入回報…" />}
        {!state.loading && state.cursor && (
          <button type="button" className="adm-button adm-inbox__more" onClick={() => load(state.filter, state.cursor)}>載入更多</button>
        )}
      </div>
      <div className="adm-support__detail">
        {reportId
          ? (
            <ReportThreadView
              key={reportId}
              api={api}
              reportId={reportId}
              capabilities={capabilities}
              onChanged={onThreadChanged}
              onOpened={onThreadOpened}
              onDeleted={onThreadDeleted}
            />
          )
          : <p className="adm-muted adm-empty">點選左邊的回報查看對話。</p>}
      </div>
    </div>
  );
}

function InboxRow({ item, active }: { item: ReportListItem; active: boolean }) {
  const reporter = item.reporter;
  return (
    <li>
      <a
        className={`adm-result adm-report-row${active ? " adm-result--active" : ""}`}
        href={formatRoute({ view: "inbox", reportId: item.id })}
        aria-current={active ? "page" : undefined}
      >
        <span className="adm-report-row__head">
          {item.unread && <span className="adm-dot" role="img" aria-label="會友有新訊息" />}
          <Badge>{label(REPORT_CATEGORY_LABEL, item.category)}</Badge>
          <Badge tone={statusTone(item.status)}>{label(REPORT_STATUS_LABEL, item.status)}</Badge>
          <time className="adm-muted adm-small adm-report-row__time">{formatDateTime(item.last_message_at || item.created_at)}</time>
        </span>
        <span className="adm-result__name">
          {reporter ? text(reporter.name, "（未填姓名）") : "訪客／離線"}
          {reporter?.pastoral_zone && <span className="adm-muted adm-small">{reporter.pastoral_zone}</span>}
        </span>
        <span className="adm-report-row__desc">{text(item.description, "（沒有描述）")}</span>
        {item.message_count > 0 && <span className="adm-muted adm-small">{item.message_count} 則訊息</span>}
      </a>
    </li>
  );
}
