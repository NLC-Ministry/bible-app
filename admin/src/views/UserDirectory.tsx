// 名單與查詢（#550 第二組的使用者名單；#567 和「查詢使用者」合一）：取代 App 管理分頁的「使用者基本資料」。
//
// 和 App 不同：App 一次載入全部的人（含完整 email）在瀏覽器裡篩；這裡篩選在伺服器做，
// 一次 50 人、email 遮罩，「載入更多」再抓下一頁（排序鍵＋id 游標，資料變動中翻頁也不跳過或重複）。
// 匯出（含完整 email）由 admin-api 產生並記稽核。
// 搜尋框也找 email（含其他登入方式的 email）；有計畫權限（plans.read）時同一個字也找隊伍（隊名或邀請碼，#566），
// 符合的隊伍列在名單上面、點了打開隊伍頁。
// 請求預算：打開名單 1 個 directory_list（第一頁順便帶計畫選項）；改條件 1 個；改搜尋字停 300ms 才送，
// 有 plans.read 時多 1 個 team_search（同一個字不重找）。
// 名單狀態放在「人」區那一層（App），打開某人、切到「管理範圍」再回來不重抓。
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Download, FilterX, RefreshCw, Search } from "lucide-react";
import { validateSearchQuery } from "../../../supabase/functions/admin-api/search-query.ts";
import { isAbortError, type AdminApi } from "../api.ts";
import {
  DIRECTORY_PAGE_SIZE,
  EMPTY_FILTERS,
  PARTICIPATION_FILTERS,
  PARTICIPATION_LABEL,
  TEAM_LABEL,
  activeFilterCount,
  directoryParams,
  isFiltered,
  orgFilterOptions,
  orgPickerSummary,
  orgValueLabel,
  pruneOrgFilter,
  syncLabel,
  teamsText,
  type DirectoryFilters,
  type OrgFilter,
  type OrgOptionSection,
  type PlanFilter
} from "../directory.ts";
import { downloadCsv } from "../download.ts";
import { formatDateTime, text } from "../format.ts";
import { formatRoute } from "../route.ts";
import { isWholeChurch, scopeLevel, scopeText } from "../scopes.ts";
import type { TeamSearchResult } from "../teams.ts";
import type { CsvExport, DirectoryCursor, DirectoryItem, DirectoryPage, OrgTreeNode, PlanOption } from "../types.ts";
import { Badge, ErrorNotice, Segmented, Spinner } from "../ui.tsx";

export const SEARCH_DEBOUNCE_MS = 300;

export type DirectoryState = {
  filters: DirectoryFilters;
  items: DirectoryItem[];
  total: number | null;
  allCount: number | null;
  nextCursor: DirectoryCursor | null;
  plans: PlanOption[] | null;
  /** 符合搜尋字的隊伍（teamsQuery 是找的那個字；沒找＝null） */
  teams: TeamSearchResult[] | null;
  teamsQuery: string;
  loaded: boolean;
  loading: boolean;
  error: unknown;
};

export const INITIAL_DIRECTORY: DirectoryState = {
  filters: EMPTY_FILTERS,
  items: [],
  total: null,
  allCount: null,
  nextCursor: null,
  plans: null,
  teams: null,
  teamsQuery: "",
  loaded: false,
  loading: false,
  error: null
};

type Props = {
  api: AdminApi;
  org: readonly OrgTreeNode[];
  capabilities: readonly string[];
  state: DirectoryState;
  setState: Dispatch<SetStateAction<DirectoryState>>;
  doc: Document;
};

const PLAN_FILTER_OPTIONS = (labels: Record<PlanFilter, string>) => PARTICIPATION_FILTERS.map((value) => ({ value, label: labels[value] }));

export function UserDirectory({ api, org, capabilities, state, setState, doc }: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const teamAbortRef = useRef<AbortController | null>(null);
  const teamQueryRef = useRef<string>(state.teamsQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exportNote, setExportNote] = useState("");
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  // 手機一開始收起篩選，名單才不會被擠到第二個畫面
  const [filtersOpen, setFiltersOpen] = useState(() => !(doc.defaultView?.matchMedia?.("(max-width: 767px)")?.matches ?? false));

  // 組織下拉一次只開一個；點外面或按 Esc 收起來
  useEffect(() => {
    if (!openPicker) return undefined;
    const onPointer = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !doc.getElementById(`adm-picker-${openPicker}`)?.contains(target)) setOpenPicker(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenPicker(null); };
    doc.addEventListener("mousedown", onPointer);
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("mousedown", onPointer);
      doc.removeEventListener("keydown", onKey);
    };
  }, [openPicker, doc]);

  const canTeams = capabilities.includes("plans.read");

  // 搜尋字找隊伍：字沒變不重找；失敗不影響名單，只是不列隊伍
  const loadTeams = useCallback((q: string) => {
    const validation = canTeams && q.trim() ? validateSearchQuery(q.trim()) : null;
    const query = validation && validation.ok ? validation.query : "";
    if (query === teamQueryRef.current) return;
    teamQueryRef.current = query;
    teamAbortRef.current?.abort();
    setState((prev) => ({ ...prev, teams: null, teamsQuery: query }));
    if (!query) return;
    const controller = new AbortController();
    teamAbortRef.current = controller;
    const done = (teams: TeamSearchResult[]) => {
      if (!controller.signal.aborted) setState((prev) => (prev.teamsQuery === query ? { ...prev, teams } : prev));
    };
    api.call<TeamSearchResult[]>("team_search", { q: query }, { signal: controller.signal })
      .then((data) => done(Array.isArray(data) ? data : []))
      .catch(() => done([]));
  }, [api, canTeams, setState]);

  const load = useCallback((filters: DirectoryFilters, cursor: DirectoryCursor | null, fresh = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, filters, loading: true, error: null }));
    if (!cursor) loadTeams(filters.q);
    const params: Record<string, unknown> = { ...directoryParams(filters), limit: DIRECTORY_PAGE_SIZE };
    if (cursor) params.cursor = cursor;
    api.call<DirectoryPage>("directory_list", params, { signal: controller.signal, fresh })
      .then((page) => {
        if (controller.signal.aborted) return;
        const items = Array.isArray(page?.items) ? page.items : [];
        setState((prev) => ({
          ...prev,
          // 沒指定計畫時記下伺服器挑的預設計畫，之後的條件與匯出都用同一個
          filters: prev.filters.planId || !page?.plan_id ? prev.filters : { ...prev.filters, planId: page.plan_id },
          items: cursor ? [...prev.items, ...items] : items,
          total: typeof page?.total === "number" ? page.total : prev.total,
          allCount: typeof page?.all_count === "number" ? page.all_count : prev.allCount,
          nextCursor: Array.isArray(page?.next_cursor) && page.next_cursor.length === 6 ? page.next_cursor : null,
          plans: Array.isArray(page?.plans) ? page.plans : prev.plans,
          loaded: true,
          loading: false,
          error: null
        }));
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setState((prev) => ({ ...prev, loading: false, error: err }));
      });
  }, [api, setState, loadTeams]);

  // 第一次打開才抓（失敗時等管理員按重試）
  useEffect(() => {
    if (!state.loaded && !state.loading && state.error === null) load(state.filters, null);
  }, [state.loaded, state.loading, state.error, state.filters, load]);

  useEffect(() => () => {
    abortRef.current?.abort();
    teamAbortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const apply = (patch: Partial<DirectoryFilters>) => load({ ...state.filters, ...patch }, null);

  const onQueryChange = (q: string) => {
    const next = { ...state.filters, q };
    setState((prev) => ({ ...prev, filters: { ...prev.filters, q } }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(next, null), SEARCH_DEBOUNCE_MS);
  };

  const onOrgChange = (key: keyof OrgFilter, values: string[]) => {
    const pruned = pruneOrgFilter(org, { regions: state.filters.regions, zones: state.filters.zones, groups: state.filters.groups, [key]: values });
    apply(pruned);
  };

  const clearFilters = () => load({ ...EMPTY_FILTERS, planId: state.filters.planId }, null);
  const refresh = () => load(state.filters, null, true);

  const options = orgFilterOptions(org, state.filters);
  const plans = state.plans || [];
  const planName = plans.find((plan) => plan.id === state.filters.planId)?.name || "所選計畫";
  const canExport = capabilities.includes("export") && capabilities.includes("support.pii");
  const canOpenUser = capabilities.includes("support.read");
  const filterCount = activeFilterCount(state.filters);

  const exportCsv = () => {
    setExporting(true);
    setExportError(null);
    setExportNote("");
    api.call<CsvExport>("directory_export", directoryParams(state.filters))
      .then((file) => {
        downloadCsv(doc, file.filename, file.csv);
        setExportNote(file.truncated ? `已匯出前 ${file.rows} 人（共 ${file.total} 人，超過上限的沒有匯出）。` : `已匯出 ${file.rows} 人。`);
      })
      .catch((err) => setExportError(err))
      .finally(() => setExporting(false));
  };

  let countText = "讀取中…";
  if (state.total !== null) {
    countText = isFiltered(state.filters) && state.allCount !== null ? `${state.total} / ${state.allCount} 人` : `${state.total} 人`;
  }

  return (
    <div className="adm-directory">
      <div className="adm-directory__toolbar">
        <div className="adm-input-icon adm-directory__search">
          <Search className="adm-icon" aria-hidden="true" />
          <label className="adm-visually-hidden" htmlFor="adm-directory-q">搜尋名單</label>
          <input
            id="adm-directory-q"
            className="adm-input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={canTeams ? "姓名、email、角色、牧區、小組、隊名或邀請碼" : "姓名、email、角色、牧區、小組、隊名"}
            value={state.filters.q}
            maxLength={100}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <span className="adm-directory__count" aria-live="polite">{countText}</span>
        <button type="button" className="adm-icon-button" onClick={refresh} disabled={state.loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${state.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
        {canExport && (
          <button type="button" className="adm-button" onClick={exportCsv} disabled={exporting || !state.loaded} title="依目前的條件匯出名單（含完整 email，會記在稽核紀錄）">
            <Download className="adm-icon" aria-hidden="true" />{exporting ? "匯出中…" : "匯出 CSV"}
          </button>
        )}
      </div>

      <details className="adm-filters" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
        <summary className="adm-filters__summary">
          篩選條件<span className="adm-muted adm-small">{filterCount > 0 ? `已套用 ${filterCount} 項` : "未套用"}</span>
        </summary>
        <div className="adm-filters__body">
          <fieldset className="adm-filters__group">
            <legend>牧養歸屬</legend>
            <OrgPicker id="regions" unit="大區" sections={options.regions} values={state.filters.regions} onChange={(values) => onOrgChange("regions", values)}
              open={openPicker === "regions"} onOpenChange={(open) => setOpenPicker((current) => (open ? "regions" : current === "regions" ? null : current))} />
            <OrgPicker id="zones" unit="牧區" sections={options.zones} values={state.filters.zones} onChange={(values) => onOrgChange("zones", values)}
              open={openPicker === "zones"} onOpenChange={(open) => setOpenPicker((current) => (open ? "zones" : current === "zones" ? null : current))} />
            <OrgPicker id="groups" unit="小組" sections={options.groups} values={state.filters.groups} onChange={(values) => onOrgChange("groups", values)}
              open={openPicker === "groups"} onOpenChange={(open) => setOpenPicker((current) => (open ? "groups" : current === "groups" ? null : current))} />
          </fieldset>
          <fieldset className="adm-filters__group">
            <legend>計畫</legend>
            <label className="adm-filters__field">
              <span className="adm-small adm-muted">讀經計畫</span>
              <select
                className="adm-select"
                value={state.filters.planId || ""}
                disabled={plans.length === 0}
                onChange={(event) => apply({ planId: event.target.value || null })}
              >
                {plans.length === 0 && <option value="">沒有可選的計畫</option>}
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{text(plan.name, "未命名計畫")}</option>)}
              </select>
            </label>
            <div className="adm-filters__field">
              <span className="adm-small adm-muted">計畫參與</span>
              <Segmented label="計畫參與" options={PLAN_FILTER_OPTIONS(PARTICIPATION_LABEL)} value={state.filters.participation}
                disabled={plans.length === 0} onChange={(participation) => apply({ participation })} />
            </div>
            <div className="adm-filters__field">
              <span className="adm-small adm-muted">團隊</span>
              <Segmented label="團隊" options={PLAN_FILTER_OPTIONS(TEAM_LABEL)} value={state.filters.team}
                disabled={plans.length === 0} onChange={(team) => apply({ team })} />
            </div>
          </fieldset>
          <div className="adm-filters__footer">
            <label className="adm-checkbox">
              <input type="checkbox" checked={state.filters.incomplete} onChange={(event) => apply({ incomplete: event.target.checked })} />
              未填會員資料（沒有牧區或沒有名稱）
            </label>
            {(filterCount > 0 || state.filters.q) && (
              <button type="button" className="adm-link-button" onClick={clearFilters}>
                <FilterX className="adm-icon adm-icon--small" aria-hidden="true" />清除全部條件
              </button>
            )}
          </div>
        </div>
      </details>

      {exportError !== null && <ErrorNotice error={exportError} />}
      {exportNote && <p className="adm-muted adm-small" role="status">{exportNote}</p>}
      {state.error !== null && (
        <ErrorNotice error={state.error} action={<button type="button" className="adm-button" onClick={refresh}>重試</button>} />
      )}

      {state.teams && state.teams.length > 0 && <TeamMatches teams={state.teams} />}

      {state.loaded && state.items.length === 0 && !state.loading && state.error === null && (
        <p className="adm-muted adm-empty">沒有符合條件的使用者。</p>
      )}
      {state.items.length > 0 && (
        <div className="adm-dir">
          <div className="adm-dir__head" aria-hidden="true">
            <span>姓名</span><span>牧養歸屬</span><span>{planName}</span><span>管理範圍・會員中心</span>
          </div>
          <ul className="adm-dir__list">
            {state.items.map((item) => <DirectoryRow key={item.id} item={item} canOpenUser={canOpenUser} hasPlan={!!state.filters.planId} />)}
          </ul>
        </div>
      )}
      {state.loading && <Spinner label="載入名單…" />}
      {!state.loading && state.nextCursor !== null && state.error === null && (
        <button type="button" className="adm-button adm-directory__more" onClick={() => load(state.filters, state.nextCursor)}>
          載入更多（還有 {Math.max(0, (state.total ?? 0) - state.items.length)} 人）
        </button>
      )}
    </div>
  );
}

function TeamMatches({ teams }: { teams: readonly TeamSearchResult[] }) {
  return (
    <section className="adm-team-matches" aria-label="符合的隊伍">
      <h3 className="adm-label">符合的隊伍</h3>
      <ul className="adm-result-list">
        {teams.map((team) => (
          <li key={team.id}>
            <a className="adm-result" href={formatRoute({ view: "plans", tab: "teams", planId: team.plan.id, teamId: team.id })}>
              <span className="adm-result__name">
                {text(team.name, "未命名隊伍")}
                {team.matched_code && <Badge tone="brand">邀請碼相符</Badge>}
              </span>
              <span className="adm-result__meta">{text(team.plan.name, "未命名計畫")}</span>
              <span className="adm-result__meta">隊長 {text(team.captain_name, "（未填姓名）")}・{team.member_count}／{team.division} 人</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrgPicker({ id, unit, sections, values, onChange, open, onOpenChange }: {
  id: string;
  unit: string;
  sections: readonly OrgOptionSection[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toggle = (value: string, checked: boolean) => {
    onChange(checked ? [...values, value] : values.filter((item) => item !== value));
  };
  return (
    <details className="adm-picker" id={`adm-picker-${id}`} open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary className="adm-select adm-picker__summary">
        <span className="adm-visually-hidden">{unit}：</span>{orgPickerSummary(values, unit)}
      </summary>
      <div className="adm-picker__panel">
        {values.length > 0 && (
          <button type="button" className="adm-link-button adm-picker__clear" onClick={() => onChange([])}>清除{unit}條件</button>
        )}
        {sections.map((section) => (
          <div key={section.key} className="adm-picker__section" role="group" aria-label={section.title || unit}>
            {section.title && <p className="adm-picker__title">{section.title}</p>}
            {section.values.map((value) => (
              <label key={`${section.key}:${value}`} className="adm-checkbox adm-picker__option">
                <input type="checkbox" checked={values.includes(value)} onChange={(event) => toggle(value, event.target.checked)} />
                {orgValueLabel(value)}
              </label>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function DirectoryRow({ item, canOpenUser, hasPlan }: { item: DirectoryItem; canOpenUser: boolean; hasPlan: boolean }) {
  const name = text(item.name, "（未填姓名）");
  const placement = [item.great_region, item.pastoral_zone, item.small_group].filter(Boolean).join("・");
  const incomplete = !String(item.name || "").trim() || !item.pastoral_zone;
  const leader = isWholeChurch(item.role_code) || scopeLevel(item.role_code) !== null;
  const teams = teamsText(item.teams);
  return (
    <li className="adm-dir__row">
      <div className="adm-dir__cell adm-dir__who">
        <span className="adm-result__name">
          {canOpenUser
            ? <a className="adm-link" href={formatRoute({ view: "user", userId: item.id, reason: "從名單查看" })}>{name}</a>
            : name}
          {item.role_code !== "member" && <Badge tone="brand">{text(item.role_label, item.role_code)}</Badge>}
          {item.is_active === false && <Badge tone="warning">已停用</Badge>}
          {incomplete && <Badge tone="warning">未填會員資料</Badge>}
        </span>
        <span className="adm-result__meta">{text(item.email_masked, "沒有 email")}</span>
      </div>
      <div className="adm-dir__cell">{placement || <span className="adm-muted">未設定</span>}</div>
      <div className="adm-dir__cell">
        {hasPlan
          ? (
            <>
              <Badge tone={item.joined ? "brand" : "neutral"}>{item.joined ? "已加入" : "未加入"}</Badge>
              <span className="adm-small">{teams || (item.joined ? "未組隊（個人速讀中）" : "")}</span>
            </>
          )
          : <span className="adm-muted">—</span>}
      </div>
      <div className="adm-dir__cell adm-small">
        {leader && (
          <span>
            管理範圍：
            {scopeLevel(item.role_code)
              ? <a className="adm-link" href={formatRoute({ view: "people", tab: "scopes", profileId: item.id })}>{scopeText(item)}</a>
              : scopeText(item)}
          </span>
        )}
        <span className="adm-muted">{syncLabel(item.sync_status)}・{formatDateTime(item.synced_at)}</span>
      </div>
    </li>
  );
}
