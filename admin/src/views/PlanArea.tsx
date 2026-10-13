// 後台「計畫」區（#565）：上面選一次計畫，下面分頁 總覽／名單／團隊／測驗作答／計畫設定（照搬，LegacyHost）。
//
// 請求預算（需要時才調閱）：打開計畫區＝plan_options＋plan_summary（只有數字）；切到名單才載 plan_roster（記稽核，
// 之後展開、篩選、排序都不再發請求）；測驗作答打開才載 plan_quiz；團隊用總覽的數字，不另外載。
// 全部走 api.ts 的 60 秒快取；選的計畫、名單條件放在 App 那一層（ui），切到計畫設定或別區再回來不會不見。
// 名單篩選、排序、從總覽點進名單的條件都是伺服器同一份規則（plans.ts → _shared/progress/plan-report.mjs）。
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  FilterX,
  HeartHandshake,
  Plus,
  RefreshCw,
  Search,
  Send,
  TriangleAlert
} from "lucide-react";
import { cacheKey, type AdminAction, type AdminApi } from "../api.ts";
import { downloadCsv } from "../download.ts";
import { formatDate, formatDateTime, text } from "../format.ts";
import {
  CARE_REMINDER_REASONS,
  CHECKIN_OPTIONS,
  MAX_CARE_MESSAGE_CHARS,
  PRESET_OPTIONS,
  PROGRESS_OPTIONS,
  ROSTER_PAGE_SIZE,
  SORT_OPTIONS,
  TEAM_OPTIONS,
  UNIT_LEVEL_LABEL,
  activePreset,
  applyRosterFilters,
  careReasonText,
  chaptersByRoundText,
  defaultCareMessage,
  defaultCareReason,
  defaultFilters,
  describeFilters,
  drillFilters,
  filterCount,
  funnelLayers,
  lateText,
  pct,
  pickPlanId,
  presetFilters,
  scheduleLine,
  sortRoster,
  statusTone,
  teamText,
  type Bucket,
  type CareReminderReason,
  type DrillKey,
  type PlanMeta,
  type PlanOptions,
  type PlanQuiz,
  type PlanRoster,
  type PlanSummary,
  type RosterFilters,
  type RosterRow,
  type RosterSort,
  type UnitRow
} from "../plans.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import type { CsvExport } from "../types.ts";
import { Badge, ErrorNotice, Segmented, Spinner } from "../ui.tsx";
import { AreaTabs } from "./AreaTabs.tsx";

export type PlanUiState = {
  planId: string | null;
  filters: RosterFilters;
  sort: RosterSort;
  shown: number;
  /** null：還沒動過，電腦版展開、手機收起 */
  filtersOpen: boolean | null;
  openRows: string[];
  expandedUnits: string[];
  /** 今天已送出的關心提醒（計畫 id:人 → 內容），重開那一列看得到送了什麼 */
  sent: Record<string, string>;
};

export const INITIAL_PLAN_UI: PlanUiState = {
  planId: null,
  filters: defaultFilters(),
  sort: "behind",
  shown: ROSTER_PAGE_SIZE,
  filtersOpen: null,
  openRows: [],
  expandedUnits: [],
  sent: {}
};

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "plans" }>;
  capabilities: readonly string[];
  ui: PlanUiState;
  setUi: Dispatch<SetStateAction<PlanUiState>>;
  doc: Document;
};

type Loaded<T> = { data: T | null; error: unknown; loading: boolean };

// 打開才載；同一份參數 60 秒內走快取（api.peek），重新整理先 invalidate 再換 refresh 讓這裡重抓
function useAdminData<T>(api: AdminApi, action: AdminAction, params: Record<string, unknown> | null, refresh: number): Loaded<T> {
  const key = params ? cacheKey(action, params) : "";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [state, setState] = useState<Loaded<T> & { key: string }>(() => ({
    key, data: params ? api.peek<T>(action, params) ?? null : null, error: null, loading: false
  }));

  useEffect(() => {
    const current = paramsRef.current;
    if (!current) return undefined;
    const cached = api.peek<T>(action, current);
    if (cached !== undefined) {
      setState({ key, data: cached, error: null, loading: false });
      return undefined;
    }
    let active = true;
    setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: null, loading: true }));
    api.call<T>(action, current)
      .then((data) => { if (active) setState({ key, data, error: null, loading: false }); })
      .catch((error) => { if (active) setState({ key, data: null, error, loading: false }); });
    return () => { active = false; };
  }, [api, action, key, refresh]);

  if (!params) return { data: null, error: null, loading: false };
  if (state.key === key) return state;
  const cached = api.peek<T>(action, params);
  return cached !== undefined ? { data: cached, error: null, loading: false } : { data: null, error: null, loading: true };
}

export function PlanArea({ api, route, capabilities, ui, setUi, doc }: Props) {
  const [refresh, setRefresh] = useState(0);
  const options = useAdminData<PlanOptions>(api, "plan_options", {}, refresh);
  const planId = options.data ? pickPlanId(options.data, [route.planId, ui.planId]) : (route.planId || ui.planId);
  const planParams = planId ? { global_plan_id: planId } : null;
  const summary = useAdminData<PlanSummary>(api, "plan_summary", planParams, refresh);
  const roster = useAdminData<PlanRoster>(api, "plan_roster", route.tab === "roster" ? planParams : null, refresh);
  const quiz = useAdminData<PlanQuiz>(api, "plan_quiz", route.tab === "quiz" ? planParams : null, refresh);

  // 換了計畫：名單的展開、顯示筆數重來（條件保留）
  useEffect(() => {
    if (planId && planId !== ui.planId) {
      setUi((prev) => ({ ...prev, planId, shown: ROSTER_PAGE_SIZE, openRows: [], expandedUnits: [] }));
    }
  }, [planId, ui.planId, setUi]);

  // SQL 另外數的人數和名單對不上：不要留在快取裡，下次打開重抓
  const summaryInconsistent = summary.data?.meta?.consistent === false;
  const rosterInconsistent = roster.data?.meta?.consistent === false;
  useEffect(() => {
    if (summaryInconsistent || rosterInconsistent) api.invalidate(["plan_summary", "plan_roster"]);
  }, [api, summaryInconsistent, rosterInconsistent]);

  const reload = () => {
    api.invalidate(["plan_options", "plan_summary", "plan_roster", "plan_quiz"]);
    setRefresh((value) => value + 1);
  };

  const go = (tab: Extract<AdminRoute, { view: "plans" }>["tab"]) => {
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "plans", tab, planId: route.planId });
  };
  const drill = (filters: RosterFilters) => {
    setUi((prev) => ({ ...prev, filters, shown: ROSTER_PAGE_SIZE, openRows: [] }));
    go("roster");
  };

  const plans = options.data?.plans || [];
  const canSettings = capabilities.includes("operations.manage");

  return (
    <div className="adm-plan-area">
      <div className="adm-plan-head">
        <h2>計畫</h2>
        <label className="adm-visually-hidden" htmlFor="adm-plan-pick">選擇計畫</label>
        <select
          id="adm-plan-pick"
          className="adm-select adm-plan-head__pick"
          value={planId || ""}
          disabled={plans.length === 0}
          onChange={(event) => {
            const view = doc.defaultView;
            if (view) view.location.hash = formatRoute({ view: "plans", tab: route.tab, planId: event.target.value });
          }}
        >
          {plans.length === 0 && <option value="">{options.loading ? "載入計畫…" : "沒有可選的計畫"}</option>}
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {text(plan.name, "未命名計畫")}{plan.start_date ? `（${formatDate(plan.start_date)} 起）` : ""}
            </option>
          ))}
        </select>
        {canSettings && (
          <a className="adm-button" href={formatRoute({ view: "legacy", area: "plans", section: "plans" })} title="新增計畫在「計畫設定」的全域計畫管理">
            <Plus className="adm-icon" aria-hidden="true" />新增計畫
          </a>
        )}
      </div>
      <AreaTabs area="plans" current={route.tab} capabilities={capabilities} />

      {options.error !== null && <ErrorNotice error={options.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />}
      {options.data && plans.length === 0 && <p className="adm-muted adm-empty">還沒有任何計畫。{canSettings ? "可以在「計畫設定」新增。" : ""}</p>}

      {planId && summary.error !== null && (
        <ErrorNotice error={summary.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />
      )}
      {planId && summary.loading && !summary.data && <Spinner label="載入計畫總覽…" />}
      {summary.data && (
        <>
          <StatusBar summary={summary.data} loading={summary.loading || roster.loading || quiz.loading} onReload={reload} />
          <Consistency meta={summary.data.meta} />
          {route.tab === "overview" && <Overview summary={summary.data} ui={ui} setUi={setUi} onDrill={drill} />}
          {route.tab === "roster" && (
            <Roster
              api={api}
              planId={planId as string}
              planName={summary.data.plan.name}
              roster={roster}
              capabilities={capabilities}
              ui={ui}
              setUi={setUi}
              doc={doc}
              onReload={reload}
            />
          )}
          {route.tab === "teams" && <Teams summary={summary.data} capabilities={capabilities} onDrill={drill} />}
          {route.tab === "quiz" && <Quiz quiz={quiz} capabilities={capabilities} onReload={reload} />}
        </>
      )}
    </div>
  );
}

// ── 狀態列 ───────────────────────────────────────────────────────────────
function StatusBar({ summary, loading, onReload }: { summary: PlanSummary; loading: boolean; onReload: () => void }) {
  const { day, reading } = scheduleLine(summary);
  const { meta } = summary;
  return (
    <div className="adm-plan-status">
      <span className="adm-plan-status__strong">{day}</span>
      {reading && <span>{reading}</span>}
      <span className={`adm-plan-status__check${meta.consistent ? "" : " adm-plan-status__check--bad"}`}
        title="伺服器另外數一次人數，和名單筆數相同才算對得起來">
        {meta.consistent
          ? <CircleCheck className="adm-icon adm-icon--small" aria-hidden="true" />
          : <TriangleAlert className="adm-icon adm-icon--small" aria-hidden="true" />}
        資料核對：{meta.rows}／{meta.inScope ?? "?"} 人
      </span>
      <span className="adm-muted">全教會範圍</span>
      <span className="adm-topbar__spacer" />
      <button type="button" className="adm-icon-button" onClick={onReload} disabled={loading} aria-label="重新整理" title="重新整理">
        <RefreshCw className={`adm-icon${loading ? " adm-spin" : ""}`} aria-hidden="true" />
      </button>
    </div>
  );
}

function Consistency({ meta }: { meta: PlanMeta }) {
  if (meta.consistent) return null;
  return (
    <div className="adm-notice adm-notice--danger" role="alert">
      <TriangleAlert className="adm-icon" aria-hidden="true" />
      <div className="adm-notice__body">
        <p>人數對不上：伺服器另外數的是 {meta.inScope ?? "?"} 人（報名 {meta.enrolled ?? "?"} 人），名單算出 {meta.rows} 人（報名 {meta.rowsEnrolled} 人）。下面的數字可能不完整。</p>
        <p className="adm-muted adm-small">請按右上的重新整理；一直對不上請回報開發者。</p>
      </div>
    </div>
  );
}

/** 長條：CSP 不允許行內 style，所以用 SVG 的屬性畫寬度 */
function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <svg className="adm-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} focusable="false">
      <rect className="adm-bar__track" x="0" y="0" width="100" height="8" />
      <rect className="adm-bar__fill" x="0" y="0" width={width} height="8" />
    </svg>
  );
}

// ── 總覽 ─────────────────────────────────────────────────────────────────
function Overview({ summary, ui, setUi, onDrill }: {
  summary: PlanSummary;
  ui: PlanUiState;
  setUi: Dispatch<SetStateAction<PlanUiState>>;
  onDrill: (filters: RosterFilters) => void;
}) {
  const { funnel, care, units } = summary;
  const drill = (key: DrillKey) => onDrill(drillFilters(key));
  const toggleUnit = (name: string) => setUi((prev) => ({
    ...prev,
    expandedUnits: prev.expandedUnits.includes(name) ? prev.expandedUnits.filter((item) => item !== name) : [...prev.expandedUnits, name]
  }));
  const levelLabel = UNIT_LEVEL_LABEL[units.level || ""] || "單位";
  const childLevelLabel = UNIT_LEVEL_LABEL[units.children.level || ""] || "";

  return (
    <div className="adm-plan-overview">
      <section className="adm-card">
        <header className="adm-card__header"><h3>進度漏斗</h3></header>
        <div className="adm-card__body">
          <p className="adm-muted adm-small">每一層都標了母體；點一層才調閱那群人的名單，人數一定一樣。</p>
          <div className="adm-funnel">
            {funnelLayers(funnel).map((layer) => (
              <button key={layer.key} type="button" className="adm-funnel__row" onClick={() => drill(layer.key)} title={`打開「${layer.label}」的 ${layer.value} 人名單`}>
                <span className="adm-funnel__label">{layer.label}</span>
                <Bar value={layer.value} max={funnel.inScope} />
                <span className="adm-funnel__value"><strong>{layer.value.toLocaleString("zh-TW")} 人</strong><small>{layer.note}</small></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="adm-plan-overview__pair">
        <section className="adm-card">
          <header className="adm-card__header"><HeartHandshake className="adm-icon" aria-hidden="true" /><h3>需要關心</h3></header>
          <div className="adm-card__body">
            <p className="adm-muted adm-small">和會友 App 同一份規則：落後教會原始日程 7 天以上，或最後打卡 3 天以上（報名後還沒開始讀也算）。</p>
            <div className="adm-chips adm-chips--flush">
              <button type="button" className="adm-chip adm-chip--warning" onClick={() => drill("careBehind")}>
                落後 7 天以上<span className="adm-chip__count">{care.behind} 人</span>
              </button>
              <button type="button" className="adm-chip adm-chip--danger" onClick={() => drill("careCheckin")}>
                最後打卡 3 天以上<span className="adm-chip__count">{care.noCheckin + care.neverRead} 人</span>
              </button>
              <button type="button" className="adm-chip" onClick={() => drill("care")}>
                不重複合計<span className="adm-chip__count">{care.total} 人</span>
              </button>
            </div>
            <p className="adm-muted adm-small">同一個人可能兩項都符合，所以前兩個加起來會比合計多。這裡只有人數；要看是誰、要提醒，再打開名單。</p>
            <div>
              <button type="button" className="adm-button" onClick={() => drill("care")} disabled={care.total === 0}>
                打開這 {care.total} 人的名單 →
              </button>
            </div>
          </div>
        </section>

        <section className="adm-card">
          <header className="adm-card__header"><h3>各{levelLabel}比較</h3></header>
          <div className="adm-card__body">
            {units.rows.length === 0
              ? <p className="adm-muted">範圍內只有一個單位，沒有可以比較的。</p>
              : (
                <>
                  <p className="adm-muted adm-small">
                    {childLevelLabel ? `點${levelLabel}展開${childLevelLabel}；` : ""}百分比的母體都是該單位的報名人數。
                  </p>
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th scope="col">{levelLabel}</th>
                          <th scope="col" className="adm-num">報名／註冊</th>
                          <th scope="col" className="adm-num">近 7 天有讀</th>
                          <th scope="col" className="adm-num">跟上進度</th>
                          <th scope="col" className="adm-num">有隊</th>
                          <th scope="col" className="adm-num">需要關心</th>
                        </tr>
                      </thead>
                      <tbody>
                        {units.rows.map((row) => {
                          const children = units.children.rows[row.name] || [];
                          const open = ui.expandedUnits.includes(row.name);
                          return [
                            <UnitTableRow key={row.name} row={row} expandable={children.length > 0} open={open} onToggle={() => toggleUnit(row.name)} />,
                            ...(open ? children.map((child) => <UnitTableRow key={`${row.name}/${child.name}`} row={child} child />) : [])
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
          </div>
        </section>
      </div>
    </div>
  );
}

function UnitTableRow({ row, expandable = false, open = false, child = false, onToggle }: {
  row: UnitRow; expandable?: boolean; open?: boolean; child?: boolean; onToggle?: () => void;
}) {
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <tr className={child ? "adm-table__child" : undefined}>
      <th scope="row">
        {expandable
          ? (
            <button type="button" className="adm-link-button adm-table__toggle" aria-expanded={open} onClick={onToggle}>
              <Caret className="adm-icon adm-icon--small" aria-hidden="true" />{row.name}
            </button>
          )
          : row.name}
      </th>
      <td className="adm-num">{row.enrolled}／{row.inScope}</td>
      <td className="adm-num"><span>{pct(row.active7, row.enrolled)}%</span><Bar value={row.active7} max={row.enrolled} /></td>
      <td className="adm-num"><span>{pct(row.onTrack, row.enrolled)}%</span><Bar value={row.onTrack} max={row.enrolled} /></td>
      <td className="adm-num">{pct(row.withTeam, row.enrolled)}%</td>
      <td className="adm-num">{row.care > 0 ? <Badge tone="warning">{row.care}</Badge> : "0"}</td>
    </tr>
  );
}

// ── 名單 ─────────────────────────────────────────────────────────────────
function Roster({ api, planId, planName, roster, capabilities, ui, setUi, doc, onReload }: {
  api: AdminApi;
  planId: string;
  planName: string;
  roster: Loaded<PlanRoster>;
  capabilities: readonly string[];
  ui: PlanUiState;
  setUi: Dispatch<SetStateAction<PlanUiState>>;
  doc: Document;
  onReload: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exportNote, setExportNote] = useState("");
  const phone = doc.defaultView?.matchMedia?.("(max-width: 767px)")?.matches ?? false;
  const filtersOpen = ui.filtersOpen ?? !phone;

  if (roster.error !== null) {
    return <ErrorNotice error={roster.error} action={<button type="button" className="adm-button" onClick={onReload}>重試</button>} />;
  }
  if (!roster.data) return <Spinner label="載入名單…" />;

  const people = roster.data.people;
  const { filters, sort } = ui;
  // 搜尋框可以有前後空白；篩選、句子、匯出都用去掉空白的（伺服器也是）
  const effective: RosterFilters = { ...filters, q: filters.q.trim() };
  const list = sortRoster(applyRosterFilters(people, effective), sort);
  const visible = list.slice(0, ui.shown);
  const preset = activePreset(filters);
  const count = filterCount(filters);

  const setFilters = (next: RosterFilters) => setUi((prev) => ({ ...prev, filters: next, shown: ROSTER_PAGE_SIZE }));
  // 捷徑（需要關心、近 7 天有讀）時點任何一格：回到一般篩選，只勾這一格
  const toggleBucket = (key: "progress" | "checkin", id: string) => {
    if (filters.shortcut) {
      const base = defaultFilters();
      return setFilters({ ...base, team: filters.team, q: filters.q, [key]: [id] });
    }
    const current = filters[key];
    setFilters({ ...filters, [key]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  };
  const toggleRow = (id: string) => setUi((prev) => ({
    ...prev, openRows: prev.openRows.includes(id) ? prev.openRows.filter((item) => item !== id) : [...prev.openRows, id]
  }));

  const exportCsv = () => {
    setExporting(true);
    setExportError(null);
    setExportNote("");
    api.call<CsvExport>("plan_roster_export", { global_plan_id: planId, filters: effective, sort })
      .then((file) => {
        downloadCsv(doc, file.filename, file.csv);
        setExportNote(`已匯出 ${file.rows} 人（不含 email；已記在稽核紀錄）。`);
      })
      .catch((err) => setExportError(err))
      .finally(() => setExporting(false));
  };

  const bucketChips = (key: "progress" | "checkin", options: readonly Bucket[], field: "progressBucket" | "checkinBucket") => options.map((option) => {
    const on = !filters.shortcut && filters[key].includes(option.id);
    const n = people.filter((row) => row[field] === option.id).length;
    return (
      <button key={option.id} type="button" className={`adm-chip${on ? " adm-chip--active" : ""}`} aria-pressed={on} onClick={() => toggleBucket(key, option.id)}>
        {option.label}<span className="adm-chip__count">{n}</span>
      </button>
    );
  });

  return (
    <div className="adm-roster">
      <Consistency meta={roster.data.meta} />
      <div className="adm-roster__toolbar">
        <div className="adm-segmented" role="group" aria-label="快速條件">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`adm-segmented__option${preset === option.value ? " adm-segmented__option--active" : ""}`}
              aria-pressed={preset === option.value}
              onClick={() => setFilters({ ...presetFilters(option.value), q: filters.q })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="adm-input-icon adm-roster__search">
          <Search className="adm-icon" aria-hidden="true" />
          <label className="adm-visually-hidden" htmlFor="adm-roster-q">搜尋姓名或單位</label>
          <input
            id="adm-roster-q"
            className="adm-input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="搜尋姓名或單位"
            maxLength={50}
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </div>
        <label className="adm-visually-hidden" htmlFor="adm-roster-sort">排序</label>
        <select id="adm-roster-sort" className="adm-select" value={sort} onChange={(event) => setUi((prev) => ({ ...prev, sort: event.target.value as RosterSort }))}>
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {capabilities.includes("export") && (
          <button type="button" className="adm-button" onClick={exportCsv} disabled={exporting} title="依目前的條件與排序匯出（伺服器重算、不含 email，會記在稽核紀錄）">
            <Download className="adm-icon" aria-hidden="true" />{exporting ? "匯出中…" : "匯出這份名單"}
          </button>
        )}
      </div>

      <details className="adm-filters" open={filtersOpen} onToggle={(event) => {
        const open = event.currentTarget.open;
        setUi((prev) => (prev.filtersOpen === open ? prev : { ...prev, filtersOpen: open }));
      }}>
        <summary className="adm-filters__summary">
          篩選條件<span className="adm-muted adm-small">{count > 0 ? `${count} 個條件` : "報名者"}</span>
        </summary>
        <div className="adm-filters__body">
          {filters.shortcut && (
            <p className="adm-roster__shortcut">現在是「{describeFilters({ ...filters, team: "any", q: "" })}」捷徑。點下面任何一格會回到一般篩選。</p>
          )}
          <div className="adm-roster__condition">
            <span className="adm-roster__condition-label">進度<small>勾幾個＝聯集</small></span>
            <div className="adm-chips adm-chips--flush">{bucketChips("progress", PROGRESS_OPTIONS, "progressBucket")}</div>
          </div>
          <div className="adm-roster__condition">
            <span className="adm-roster__condition-label">最後打卡<small>勾幾個＝聯集</small></span>
            <div className="adm-chips adm-chips--flush">{bucketChips("checkin", CHECKIN_OPTIONS, "checkinBucket")}</div>
          </div>
          <div className="adm-roster__condition">
            <span className="adm-roster__condition-label">團隊</span>
            <Segmented label="團隊" options={TEAM_OPTIONS} value={filters.team} onChange={(team) => setFilters({ ...filters, team })} />
          </div>
          <div className="adm-filters__footer">
            <p className="adm-muted adm-small">不同條件之間是「而且」；同一個條件裡各格的人數加起來就是總數，可以對帳。</p>
            {(count > 0 || filters.q) && (
              <button type="button" className="adm-link-button" onClick={() => setFilters(defaultFilters())}>
                <FilterX className="adm-icon adm-icon--small" aria-hidden="true" />回到「報名者」
              </button>
            )}
          </div>
        </div>
      </details>

      {exportError !== null && <ErrorNotice error={exportError} />}
      {exportNote && <p className="adm-muted adm-small" role="status">{exportNote}</p>}

      <p className="adm-roster__sentence" aria-live="polite">{describeFilters(effective)} → <strong>{list.length} 人</strong></p>

      {list.length === 0
        ? <p className="adm-muted adm-empty">沒有符合條件的人。</p>
        : (
          <div className="adm-roster__list">
            <div className="adm-roster__head" aria-hidden="true">
              <span />
              <span>姓名</span>
              <span className="adm-num" title="本計畫書卷內的章數，含各遍">累計章數</span>
              <span>進度</span>
            </div>
            <ul>
              {visible.map((row) => (
                <RosterItem
                  key={row.id}
                  api={api}
                  row={row}
                  planId={planId}
                  planName={planName}
                  open={ui.openRows.includes(row.id)}
                  onToggle={() => toggleRow(row.id)}
                  capabilities={capabilities}
                  sentMessage={ui.sent[`${planId}:${row.id}`] || ""}
                  onSent={(message) => setUi((prev) => ({ ...prev, sent: { ...prev.sent, [`${planId}:${row.id}`]: message } }))}
                />
              ))}
            </ul>
          </div>
        )}
      {list.length > visible.length && (
        <button type="button" className="adm-button adm-roster__more" onClick={() => setUi((prev) => ({ ...prev, shown: prev.shown + ROSTER_PAGE_SIZE }))}>
          再顯示 {Math.min(ROSTER_PAGE_SIZE, list.length - visible.length)} 人（還有 {list.length - visible.length} 人）
        </button>
      )}
    </div>
  );
}

function RosterItem({ api, row, planId, planName, open, onToggle, capabilities, sentMessage, onSent }: {
  api: AdminApi;
  row: RosterRow;
  planId: string;
  planName: string;
  open: boolean;
  onToggle: () => void;
  capabilities: readonly string[];
  sentMessage: string;
  onSent: (message: string) => void;
}) {
  const late = lateText(row);
  const unit = [row.greatRegion, row.pastoralZone, row.smallGroup].filter(Boolean).join("・") || "未設定";
  const Caret = open ? ChevronDown : ChevronRight;
  const detailId = `adm-roster-${row.id}`;
  return (
    <li className="adm-roster__row">
      <button type="button" className="adm-roster__summary" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <Caret className="adm-icon adm-icon--small adm-roster__caret" aria-hidden="true" />
        <span className="adm-roster__who">
          <span className="adm-roster__name">{text(row.name, "（未填姓名）")}{late && <span className="adm-roster__late">{late}</span>}</span>
          <span className="adm-roster__unit">{unit}</span>
        </span>
        <span className="adm-num adm-roster__chapters">{row.enrolled ? row.chapters.toLocaleString("zh-TW") : "—"}</span>
        <span className="adm-roster__status"><Badge tone={statusTone(row)}>{row.statusLabel}</Badge></span>
      </button>
      {open && (
        <div className="adm-roster__detail" id={detailId}>
          {row.enrolled
            ? (
              <>
                <Bar value={row.progress} max={100} label={`本遍進度 ${row.progress}%`} />
                <dl className="adm-fields adm-fields--compact">
                  <div className="adm-field"><dt>本遍</dt><dd>
                    第 {row.round} 遍・{row.progress}%
                    {row.behindDays > 0 ? `・落後教會原始日程 ${row.behindDays} 天` : row.round > 1 ? "・已讀完第 1 遍" : "・跟上教會原始日程"}
                  </dd></div>
                  <div className="adm-field"><dt>累計章數</dt><dd>{chaptersByRoundText(row)}</dd></div>
                  <div className="adm-field"><dt>最後打卡</dt><dd>
                    {row.lastReadAt
                      ? `${formatDateTime(row.lastReadAt)}（${row.daysSinceRead === 0 ? "今天" : `${row.daysSinceRead} 天前`}）`
                      : "還沒有打卡紀錄"}
                    ・近 7 天讀 {row.readDays7} 天
                  </dd></div>
                  {row.care && <div className="adm-field"><dt>需要關心</dt><dd>{row.careReasons.map(careReasonText).filter(Boolean).join("、")}</dd></div>}
                  <div className="adm-field"><dt>團隊</dt><dd>{row.teams.length > 0 ? row.teams.map(teamText).join("、") : "沒有隊"}</dd></div>
                  <div className="adm-field"><dt>小測驗</dt><dd>交卷 {row.quiz.submitted} 次／已發布 {row.quiz.published} 次</dd></div>
                </dl>
              </>
            )
            : <p className="adm-muted">已註冊、還沒報名這一期。</p>}
          <div className="adm-row">
            {row.enrolled && capabilities.includes("plans.remind") && (
              <CareReminder api={api} row={row} planId={planId} sentMessage={sentMessage} onSent={onSent} />
            )}
            {capabilities.includes("support.read") && (
              <a className="adm-link" href={formatRoute({ view: "user", userId: row.id, tab: "overview", reason: `從計畫名單查看（${planName}）` })}>
                完整個人資料 →
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function CareReminder({ api, row, planId, sentMessage, onSent }: {
  api: AdminApi; row: RosterRow; planId: string; sentMessage: string; onSent: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<CareReminderReason>(() => defaultCareReason(row));
  const [message, setMessage] = useState(() => defaultCareMessage(defaultCareReason(row), row.name));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (sentMessage) {
    return <p className="adm-small adm-roster__sent"><Send className="adm-icon adm-icon--small" aria-hidden="true" />今天已送出關心提醒：「{sentMessage}」（同一天只能送一則，送出後不能修改）</p>;
  }
  if (!editing) {
    return (
      <button type="button" className="adm-button" onClick={() => setEditing(true)}>
        <HeartHandshake className="adm-icon" aria-hidden="true" />關心提醒
      </button>
    );
  }
  const trimmed = message.trim();
  const send = () => {
    setSending(true);
    setError(null);
    api.call<{ message?: string }>("care_remind", { global_plan_id: planId, recipient_id: row.id, reason, message: trimmed })
      .then((result) => onSent(typeof result?.message === "string" ? result.message : trimmed))
      .catch((err) => setError(err))
      .finally(() => setSending(false));
  };
  return (
    <form className="adm-care-form" onSubmit={(event) => { event.preventDefault(); if (!sending && trimmed) send(); }}>
      <label className="adm-small adm-muted" htmlFor={`adm-care-reason-${row.id}`}>原因</label>
      <select
        id={`adm-care-reason-${row.id}`}
        className="adm-select"
        value={reason}
        onChange={(event) => {
          const next = event.target.value as CareReminderReason;
          // 還沒改過內容就換成這個原因的預設內容
          if (message === defaultCareMessage(reason, row.name)) setMessage(defaultCareMessage(next, row.name));
          setReason(next);
        }}
      >
        {CARE_REMINDER_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <label className="adm-small adm-muted" htmlFor={`adm-care-message-${row.id}`}>內容（對方會在 App 的通知看到，寄件人顯示「系統管理員」）</label>
      <textarea
        id={`adm-care-message-${row.id}`}
        className="adm-input adm-care-form__message"
        rows={3}
        maxLength={MAX_CARE_MESSAGE_CHARS}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <div className="adm-row">
        <span className="adm-muted adm-small">{trimmed.length}／{MAX_CARE_MESSAGE_CHARS}・同一天只能送一則，送出後不能修改</span>
        <span className="adm-topbar__spacer" />
        <button type="button" className="adm-button adm-button--ghost" onClick={() => setEditing(false)} disabled={sending}>取消</button>
        <button type="submit" className="adm-button adm-button--primary" disabled={sending || !trimmed}>
          <Send className="adm-icon" aria-hidden="true" />{sending ? "送出中…" : "送出"}
        </button>
      </div>
      {error !== null && <ErrorNotice error={error} />}
    </form>
  );
}

// ── 團隊（隊伍清單與除錯在 #566）────────────────────────────────────────────
function Teams({ summary, capabilities, onDrill }: { summary: PlanSummary; capabilities: readonly string[]; onDrill: (filters: RosterFilters) => void }) {
  const { teams } = summary;
  return (
    <div className="adm-grid">
      <section className="adm-card">
        <header className="adm-card__header"><h3>報名者組隊</h3></header>
        <div className="adm-card__body">
          <div className="adm-tiles">
            <button type="button" className="adm-tile" onClick={() => onDrill({ ...defaultFilters(), team: "yes" })}>
              <span>有隊</span><strong>{teams.withTeam}</strong><small>報名的 {pct(teams.withTeam, teams.enrolled)}%</small>
            </button>
            <button type="button" className="adm-tile" onClick={() => onDrill({ ...defaultFilters(), team: "no" })}>
              <span>沒有隊</span><strong>{teams.withoutTeam}</strong><small>點進名單可以逐一關心</small>
            </button>
          </div>
          <p className="adm-muted adm-small">母體是這期的報名者 {teams.enrolled} 人；點數字打開名單，人數一樣。</p>
        </div>
      </section>
      <section className="adm-card">
        <header className="adm-card__header"><h3>隊伍</h3></header>
        <div className="adm-card__body">
          <div className="adm-tiles">
            <div className="adm-tile adm-tile--static"><span>隊伍數</span><strong>{teams.teams}</strong><small>有報名者的隊</small></div>
            <div className="adm-tile adm-tile--static"><span>還沒滿</span><strong>{teams.unfilled}</strong><small>人數少於組別人數</small></div>
          </div>
          <p className="adm-muted adm-small">
            隊伍清單、每隊的檢查（狀態和人數對不上、邀請碼）之後會搬到這裡。
            {capabilities.includes("operations.manage") ? "在那之前請到 " : ""}
            {capabilities.includes("operations.manage") && <a className="adm-link" href="#/operations/teams">營運 → 組隊狀況</a>}
            {capabilities.includes("operations.manage") ? "。" : ""}
          </p>
        </div>
      </section>
    </div>
  );
}

// ── 測驗作答 ─────────────────────────────────────────────────────────────
const shortDate = (value: string) => {
  const [, m, d] = String(value || "").split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : value;
};

function Quiz({ quiz, capabilities, onReload }: { quiz: Loaded<PlanQuiz>; capabilities: readonly string[]; onReload: () => void }) {
  if (quiz.error !== null) {
    return <ErrorNotice error={quiz.error} action={<button type="button" className="adm-button" onClick={onReload}>重試</button>} />;
  }
  if (!quiz.data) return <Spinner label="載入測驗作答…" />;
  const { daily, exam, lightning, enrolled } = quiz.data;
  const showDaily = daily.configured && daily.enabled;
  const showExam = exam.papers.length > 0 && exam.enabled;
  const notes: string[] = [];
  if (daily.configured && !daily.enabled) notes.push("每日小測驗：功能開放設定目前關閉，會友看不到。");
  if (exam.papers.length > 0 && !exam.enabled) notes.push("大測驗：功能開放設定目前關閉，會友看不到。");
  const nothing = !daily.configured && exam.papers.length === 0 && !lightning;
  const days = daily.days.slice(-14);
  const weeks = lightning?.weeks.slice(-8) || [];

  return (
    <div className="adm-plan-quiz">
      {nothing && <p className="adm-muted adm-empty">這一期沒有設定任何測驗，期間也沒有雲柱題目。</p>}
      <div className="adm-grid">
        {showDaily && (
          <section className="adm-card">
            <header className="adm-card__header"><h3>每日小測驗作答率</h3></header>
            <div className="adm-card__body">
              <p className="adm-muted adm-small">近 {days.length} 次發布・母體＝那天發給的小組裡的報名者。交過至少一次：{daily.participants} 人（報名者 {enrolled} 人的 {pct(daily.participants, enrolled)}%）。</p>
              {days.length === 0
                ? <p className="adm-muted">還沒有發布過。</p>
                : (
                  <>
                    <svg className="adm-columns" viewBox={`0 0 ${days.length * 10} 100`} preserveAspectRatio="none" role="img"
                      aria-label={days.map((day) => `${shortDate(day.date)} ${pct(day.submitted, day.eligible)}%`).join("、")}>
                      {days.map((day, index) => {
                        const height = pct(day.submitted, day.eligible);
                        return <rect key={day.date} className="adm-columns__bar" x={index * 10 + 1.5} y={100 - height} width="7" height={height} />;
                      })}
                    </svg>
                    <div className="adm-columns__labels" aria-hidden="true">
                      {days.map((day, index) => <span key={day.date}>{index % 2 === 0 || days.length <= 7 ? shortDate(day.date) : ""}</span>)}
                    </div>
                    <ul className="adm-plain-list adm-small">
                      {days.slice(-3).reverse().map((day) => (
                        <li key={day.date}>{shortDate(day.date)}：{day.submitted}／{day.eligible} 人交卷（{pct(day.submitted, day.eligible)}%）</li>
                      ))}
                    </ul>
                  </>
                )}
            </div>
          </section>
        )}

        {showExam && exam.papers.map((paper) => (
          <section key={paper.id} className="adm-card">
            <header className="adm-card__header"><h3>大測驗・{text(paper.title, "未命名試卷")}</h3></header>
            <div className="adm-card__body">
              <p className="adm-muted adm-small">
                {paper.open_at ? `${formatDateTime(paper.open_at)} 開放` : "還沒設定開放時間"}
                {paper.close_at ? `・${formatDateTime(paper.close_at)} 截止` : ""}・只算正式作答、不含測試帳號
              </p>
              <div className="adm-tiles">
                <div className="adm-tile adm-tile--static"><span>開始作答</span><strong>{paper.started}</strong><small>其中報名者 {paper.enrolled_takers} 人</small></div>
                <div className="adm-tile adm-tile--static"><span>已交卷</span><strong>{paper.submitted}</strong></div>
                <div className="adm-tile adm-tile--static"><span>簡答待批改</span><strong>{paper.pending}</strong></div>
                <div className="adm-tile adm-tile--static"><span>平均（已批改）</span><strong>{paper.average ?? "—"}</strong></div>
              </div>
            </div>
          </section>
        ))}

        {lightning && (
          <section className="adm-card">
            <header className="adm-card__header"><h3>雲柱測驗（本期期間）</h3></header>
            <div className="adm-card__body">
              <p className="adm-muted adm-small">
                雲柱是全教會每週活動，題目按日期出、不屬於任何計畫。這裡只算 {formatDate(lightning.from)}–{formatDate(lightning.to)} 出的 {lightning.questions} 題、這期報名者的參加情況。
              </p>
              <div className="adm-tiles">
                <div className="adm-tile adm-tile--static">
                  <span>報名者參加過至少 1 題</span><strong>{lightning.participants}</strong><small>報名者 {enrolled} 人的 {pct(lightning.participants, enrolled)}%</small>
                </div>
              </div>
              {weeks.length > 0 && <p className="adm-muted adm-small">每週參加人數；長條滿格是報名者 {enrolled} 人。</p>}
              {weeks.length > 0 && (
                <ul className="adm-plain-list adm-weeks">
                  {weeks.map((week) => (
                    <li key={week.week_start}>
                      <span className="adm-weeks__label">{shortDate(week.week_start)} 那週</span>
                      <Bar value={week.participants} max={enrolled} />
                      <span className="adm-num">{week.participants} 人／{week.questions} 題</span>
                    </li>
                  ))}
                </ul>
              )}
              {capabilities.includes("content.manage") && (
                <a className="adm-link" href={formatRoute({ view: "legacy", area: "content", section: "lightning-quiz" })}>
                  前三名公布與兌換券在「內容 → 雲柱測驗」<ExternalLink className="adm-icon adm-icon--small" aria-hidden="true" />
                </a>
              )}
            </div>
          </section>
        )}
      </div>
      {notes.map((note) => <p key={note} className="adm-muted adm-small">{note}</p>)}
      <p className="adm-muted adm-small">打開這個分頁才調閱；這期沒設定的測驗不顯示。出題、審題在「內容」，這裡只看作答。</p>
    </div>
  );
}
