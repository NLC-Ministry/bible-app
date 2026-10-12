// 稽核紀錄（#550 第四組）：誰、什麼時候、對誰做了什麼（#549 的 audit.admin_events）。
//
// 請求預算：打開 1 個 audit_list（第一頁順便帶總數與「動作」「操作者」選項）；改條件 1 個；「載入更多」1 個。
// 點開一筆不再打（清單已帶變更內容），只有內容太大被省略的那筆才打 1 個 audit_event。
// 操作者／對象條件放在網址（#/system/audit?actor=…&target=…），使用者頁可以直接連過來。
// 看清單不記稽核；匯出由 admin-api 產生 CSV 並記 export 稽核。
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, FilterX, RefreshCw, X } from "lucide-react";
import { isAbortError, type AdminApi } from "../api.ts";
import {
  AUDIT_DAY_OPTIONS,
  AUDIT_PAGE_SIZE,
  DEFAULT_AUDIT_FILTERS,
  RESULT_LABEL,
  RESULT_OPTIONS,
  SOURCE_OPTIONS,
  activeAuditFilterCount,
  auditParams,
  diffRows,
  personName,
  prettyJson,
  type AuditDays,
  type AuditFilterState
} from "../audit.ts";
import { downloadCsv } from "../download.ts";
import { formatDateTime, text } from "../format.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import type { AuditEvent, AuditFacets, AuditPage, AuditPerson, CsvExport } from "../types.ts";
import { Badge, ErrorNotice, Field, Segmented, Spinner } from "../ui.tsx";
import { AreaTabs } from "./AreaTabs.tsx";

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "audit" }>;
  capabilities: readonly string[];
  doc: Document;
};

type ListState = {
  filters: AuditFilterState;
  items: AuditEvent[];
  total: number | null;
  facets: AuditFacets | null;
  actor: AuditPerson | null;
  target: AuditPerson | null;
  nextCursor: number | null;
  loaded: boolean;
  loading: boolean;
  error: unknown;
};

const INITIAL: ListState = {
  filters: DEFAULT_AUDIT_FILTERS,
  items: [],
  total: null,
  facets: null,
  actor: null,
  target: null,
  nextCursor: null,
  loaded: false,
  loading: false,
  error: null
};

// 內容太大被省略、點開才抓的那幾筆
type FullState = { event: AuditEvent | null; loading: boolean; error: unknown };

export function AuditLog({ api, route, capabilities, doc }: Props) {
  const [state, setState] = useState<ListState>(INITIAL);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [full, setFull] = useState<Record<number, FullState>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exportNote, setExportNote] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef<AuditFilterState>(INITIAL.filters);
  const canRead = capabilities.includes("audit.read");
  const canExport = canRead && capabilities.includes("export");
  const canOpenUser = capabilities.includes("support.read");

  const load = useCallback((filters: AuditFilterState, cursor: number | null, fresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    filtersRef.current = filters;
    setState((prev) => ({ ...prev, filters, loading: true, error: null }));
    if (cursor === null) setOpen(new Set());
    api.call<AuditPage>("audit_list", { ...auditParams(filters), ...(cursor !== null ? { cursor } : {}), limit: AUDIT_PAGE_SIZE }, { signal: controller.signal, fresh })
      .then((page) => {
        if (controller.signal.aborted) return;
        const items = Array.isArray(page?.items) ? page.items : [];
        setState((prev) => ({
          ...prev,
          items: cursor !== null ? [...prev.items, ...items] : items,
          total: cursor !== null ? prev.total : (typeof page?.total === "number" ? page.total : null),
          facets: cursor !== null ? prev.facets : (page?.facets ?? null),
          actor: cursor !== null ? prev.actor : (page?.actor ?? null),
          target: cursor !== null ? prev.target : (page?.target ?? null),
          nextCursor: typeof page?.next_cursor === "number" ? page.next_cursor : null,
          loaded: true,
          loading: false,
          error: null
        }));
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setState((prev) => ({ ...prev, loading: false, error: err }));
      });
  }, [api]);

  // 打開、以及網址上的操作者／對象改了：用目前的其他條件重抓第一頁
  useEffect(() => {
    if (!canRead) return;
    load({ ...filtersRef.current, actorId: route.actorId, targetId: route.targetId }, null);
  }, [canRead, route.actorId, route.targetId, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!canRead) {
    return (
      <div className="adm-audit">
        <AreaTabs area="system" current="audit" capabilities={capabilities} />
        <div className="adm-message">
          <h2>沒有權限</h2>
          <p>你的帳號不能看稽核紀錄。</p>
        </div>
      </div>
    );
  }

  const filters = state.filters;
  const apply = (patch: Partial<AuditFilterState>) => load({ ...filters, ...patch }, null);
  const go = (actorId: string | null, targetId: string | null) => {
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "audit", actorId, targetId });
  };
  const refresh = () => load(filters, null, true);
  const clearAll = () => {
    if (filters.actorId || filters.targetId) {
      // 網址上的條件一起清掉；換網址會觸發重抓，其他條件先放回預設
      filtersRef.current = { ...DEFAULT_AUDIT_FILTERS, days: filters.days };
      go(null, null);
    } else {
      load({ ...DEFAULT_AUDIT_FILTERS, days: filters.days }, null);
    }
  };

  const toggle = (event: AuditEvent) => {
    const next = new Set(open);
    if (next.has(event.id)) {
      next.delete(event.id);
    } else {
      next.add(event.id);
      if ((event.changes_omitted || event.detail_omitted) && !full[event.id]?.event) fetchFull(event.id);
    }
    setOpen(next);
  };

  const fetchFull = (id: number) => {
    setFull((prev) => ({ ...prev, [id]: { event: null, loading: true, error: null } }));
    api.call<AuditEvent>("audit_event", { id })
      .then((event) => setFull((prev) => ({ ...prev, [id]: { event, loading: false, error: null } })))
      .catch((error) => setFull((prev) => ({ ...prev, [id]: { event: null, loading: false, error } })));
  };

  const exportCsv = () => {
    setExporting(true);
    setExportError(null);
    setExportNote("");
    api.call<CsvExport>("audit_export", auditParams(filters))
      .then((file) => {
        downloadCsv(doc, file.filename, file.csv);
        setExportNote(file.truncated ? `已匯出最新的 ${file.rows} 筆（共 ${file.total} 筆，超過上限的沒有匯出）。` : `已匯出 ${file.rows} 筆。`);
      })
      .catch((err) => setExportError(err))
      .finally(() => setExporting(false));
  };

  const actions = state.facets?.actions || [];
  const actors = state.facets?.actors || [];
  const actorOptions = filters.actorId && !actors.some((actor) => actor.id === filters.actorId)
    ? [{ id: filters.actorId, name: state.actor?.name ?? null, count: 0 }, ...actors]
    : actors;
  const filterCount = activeAuditFilterCount(filters);
  const countText = state.total === null ? "讀取中…" : `${state.total} 筆`;

  return (
    <div className="adm-audit">
      <AreaTabs area="system" current="audit" capabilities={capabilities} />
      <div className="adm-audit__toolbar">
        <label className="adm-visually-hidden" htmlFor="adm-audit-days">期間</label>
        <select id="adm-audit-days" className="adm-select" value={filters.days}
          onChange={(event) => apply({ days: Number(event.target.value) as AuditDays })}>
          {AUDIT_DAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="adm-audit__count" aria-live="polite">{countText}</span>
        <button type="button" className="adm-icon-button" onClick={refresh} disabled={state.loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${state.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
        {canExport && (
          <button type="button" className="adm-button" onClick={exportCsv} disabled={exporting || !state.loaded} title="依目前的條件匯出（會記在稽核紀錄）">
            <Download className="adm-icon" aria-hidden="true" />{exporting ? "匯出中…" : "匯出 CSV"}
          </button>
        )}
      </div>

      <div className="adm-audit__filters">
        <label className="adm-filters__field">
          <span className="adm-small adm-muted">動作</span>
          <select className="adm-select" value={filters.action} onChange={(event) => apply({ action: event.target.value })}>
            <option value="">全部動作</option>
            {filters.action && !actions.some((entry) => entry.action === filters.action) && (
              <option value={filters.action}>{filters.action}</option>
            )}
            {actions.map((entry) => <option key={entry.action} value={entry.action}>{`${entry.label}（${entry.count}）`}</option>)}
          </select>
        </label>
        <label className="adm-filters__field">
          <span className="adm-small adm-muted">操作者</span>
          <select className="adm-select" value={filters.actorId || ""} onChange={(event) => go(event.target.value || null, filters.targetId)}>
            <option value="">全部操作者</option>
            {actorOptions.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.count ? `${personName(actor)}（${actor.count}）` : personName(actor)}</option>
            ))}
          </select>
        </label>
        <div className="adm-filters__field">
          <span className="adm-small adm-muted">結果</span>
          <Segmented label="結果" options={RESULT_OPTIONS} value={filters.result} onChange={(result) => apply({ result })} />
        </div>
        <div className="adm-filters__field">
          <span className="adm-small adm-muted">來源</span>
          <Segmented label="來源" options={SOURCE_OPTIONS} value={filters.source} onChange={(source) => apply({ source })} />
        </div>
      </div>

      {(filters.targetId || filterCount > 0) && (
        <div className="adm-audit__active">
          {filters.targetId && (
            <span className="adm-chip adm-chip--active">
              對象：{personName(state.target ?? { id: filters.targetId, name: null })}
              <button type="button" className="adm-chip__remove" aria-label="取消對象條件" onClick={() => go(filters.actorId, null)}>
                <X className="adm-icon adm-icon--small" aria-hidden="true" />
              </button>
            </span>
          )}
          {filterCount > 0 && (
            <button type="button" className="adm-link-button" onClick={clearAll}>
              <FilterX className="adm-icon adm-icon--small" aria-hidden="true" />清除全部條件
            </button>
          )}
        </div>
      )}
      <p className="adm-muted adm-small">
        保存 1 年。「舊管理畫面」是 App 管理分頁與後台照搬的區塊（操作成功後補記）。看這份清單不會記錄；匯出會。
      </p>

      {exportError !== null && <ErrorNotice error={exportError} />}
      {exportNote && <p className="adm-muted adm-small" role="status">{exportNote}</p>}
      {state.error !== null && (
        <ErrorNotice error={state.error} action={<button type="button" className="adm-button" onClick={refresh}>重試</button>} />
      )}

      {state.loaded && state.items.length === 0 && !state.loading && state.error === null && (
        <p className="adm-muted adm-empty">這段期間沒有符合條件的紀錄。</p>
      )}
      {state.items.length > 0 && (
        <ul className="adm-audit__list">
          {state.items.map((event) => (
            <AuditRow
              key={event.id}
              event={event}
              open={open.has(event.id)}
              full={full[event.id]}
              canOpenUser={canOpenUser}
              onToggle={() => toggle(event)}
              onRetry={() => fetchFull(event.id)}
            />
          ))}
        </ul>
      )}
      {state.loading && <Spinner label="載入稽核紀錄…" />}
      {!state.loading && state.nextCursor !== null && state.error === null && (
        <button type="button" className="adm-button adm-audit__more" onClick={() => load(filters, state.nextCursor)}>
          載入更多{state.total !== null ? `（還有 ${Math.max(0, state.total - state.items.length)} 筆）` : ""}
        </button>
      )}
    </div>
  );
}

function AuditRow({ event, open, full, canOpenUser, onToggle, onRetry }: {
  event: AuditEvent;
  open: boolean;
  full: FullState | undefined;
  canOpenUser: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const shown = full?.event || event;
  const detailId = `adm-audit-detail-${event.id}`;
  const target = event.target_user ? personName(event.target_user) : text(event.target_id, "");
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className={`adm-audit__row${event.result !== "ok" ? " adm-audit__row--flagged" : ""}`}>
      <button type="button" className="adm-audit__summary" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <Chevron className="adm-icon adm-icon--small adm-audit__chevron" aria-hidden="true" />
        <span className="adm-audit__time">{formatDateTime(event.occurred_at)}</span>
        <span className="adm-audit__label">{event.label}</span>
        <span className="adm-audit__actor">
          {event.actor ? personName(event.actor) : "系統"}
          {event.actor_role_label && <span className="adm-muted adm-small">・{event.actor_role_label}</span>}
        </span>
        <span className="adm-audit__target">{target && <><span className="adm-muted adm-small">對象 </span>{target}</>}</span>
        <span className="adm-audit__badges">
          {event.result !== "ok" && <Badge tone="danger">{RESULT_LABEL[event.result] || event.result}</Badge>}
          <Badge tone={event.source === "admin-api" ? "brand" : "neutral"}>{event.source_label}</Badge>
        </span>
      </button>
      {open && (
        <div className="adm-audit__detail" id={detailId}>
          <dl className="adm-fields adm-fields--compact">
            <Field name="動作代碼"><code>{event.action}</code></Field>
            {event.resource && <Field name="資源"><code>{event.resource}</code></Field>}
            {event.target_id && <Field name="對象編號"><code>{event.target_id}</code></Field>}
            {event.reason && <Field name="理由"><span className="adm-prewrap">{event.reason}</span></Field>}
            {event.request_id && <Field name="請求編號"><code>{event.request_id}</code></Field>}
            <Field name="紀錄編號">{event.id}</Field>
          </dl>
          {full?.loading && <Spinner label="載入完整內容…" />}
          {full?.error !== undefined && full?.error !== null && (
            <ErrorNotice error={full.error} action={<button type="button" className="adm-button" onClick={onRetry}>重試</button>} />
          )}
          <ChangesView changes={shown.changes} omitted={!full?.event && event.changes_omitted} />
          {(shown.detail !== null && shown.detail !== undefined) && (
            <>
              <h4 className="adm-subheading">補充資訊</h4>
              <pre className="adm-pre">{prettyJson(shown.detail)}</pre>
            </>
          )}
          <div className="adm-audit__links">
            {event.actor && (
              <a className="adm-link" href={formatRoute({ view: "audit", actorId: event.actor.id, targetId: null })}>只看 {personName(event.actor)} 的操作</a>
            )}
            {event.target_user && (
              <a className="adm-link" href={formatRoute({ view: "audit", actorId: null, targetId: event.target_user.id })}>只看對 {personName(event.target_user)} 的紀錄</a>
            )}
            {event.target_user && canOpenUser && (
              <a className="adm-link" href={formatRoute({ view: "user", userId: event.target_user.id, tab: "overview", reason: "" })}>打開 {personName(event.target_user)}</a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ChangesView({ changes, omitted }: { changes: unknown; omitted: boolean }) {
  // 太大被省略：點開時另外抓（上面顯示載入中或錯誤）
  if (omitted || changes === null || changes === undefined) return null;
  const rows = diffRows(changes);
  return (
    <>
      <h4 className="adm-subheading">變更內容</h4>
      {rows ? (
        <div className="adm-diff-wrap">
          <table className="adm-diff">
            <thead><tr><th scope="col">欄位</th><th scope="col">之前</th><th scope="col">之後</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.field}><th scope="row"><code>{row.field}</code></th><td>{row.before}</td><td>{row.after}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="adm-pre">{prettyJson(changes)}</pre>
      )}
    </>
  );
}
