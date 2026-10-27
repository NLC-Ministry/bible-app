// 後台「報表」區（#568）：分兩頁——讀經使用率（含每日趨勢，跨計畫）、報名註冊（依大區／牧區）。
// 測驗作答（#581）#619 起是「測驗」區的總覽（QuizArea.tsx），仍和報名註冊共用選的計畫（ui.planId）。
//
// 請求預算：讀經使用率打開＝1 個 reading_usage（DAU／WAU／MAU、每天章數、一週讀幾天、讀經時段一次拿齊，伺服器彙總成
// 每天一列，原始打卡不進瀏覽器），換日期區間 1 個；時段的「全部／平日／週末」「人數／章數」切換不再發請求。
// 報名註冊打開＝1 個 registration_stats（順便帶計畫選單、沒選就用預設計畫），換計畫 1 個；匯出、同步試算表各 1 個
// （伺服器產生、記稽核）。
// 都走 api.ts 的 60 秒快取；條件放在 App 那一層（ui），切到別區再回來還在。
// Chart.js 只有這一區會載入（chart.ts），載不到時仍有表格。
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { CircleCheck, Download, RefreshCw, Sheet } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { chartColors, loadChart as defaultLoadChart, type ChartInstance, type ChartLoader } from "../chart.ts";
import { downloadCsv } from "../download.ts";
import { formatDate, formatDateTime, text } from "../format.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import {
  MAX_RANGE_DAYS,
  REGISTRATION_SUMMARY_ITEMS,
  addDays,
  defaultUsageRange,
  formatNumber,
  formatPct,
  rangeError,
  shortDate,
  taipeiToday,
  topHours,
  weekLabel,
  type HourDays,
  type HourMetric,
  type RegistrationData,
  type RegistrationRow,
  type Usage,
  type UsageDay
} from "../stats.ts";
import type { CsvExport } from "../types.ts";
import { ErrorNotice, Segmented, Spinner } from "../ui.tsx";
import { useAdminData } from "../use-admin-data.ts";
import { AreaTabs } from "./AreaTabs.tsx";

export type StatsUiState = {
  /** null：還沒動過，用「到今天為止的 30 天」 */
  from: string | null;
  to: string | null;
  hourDays: HourDays;
  hourMetric: HourMetric;
};

export const INITIAL_STATS_UI: StatsUiState = { from: null, to: null, hourDays: "all", hourMetric: "users" };

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "stats" }>;
  capabilities: readonly string[];
  ui: StatsUiState;
  setUi: Dispatch<SetStateAction<StatsUiState>>;
  /** 計畫、測驗、報表三區共用的「目前選的計畫」（App 那一層，#620）；null＝伺服器挑的預設計畫 */
  planId: string | null;
  onPlanChange: (planId: string) => void;
  doc: Document;
  /** 換主題時 App 會帶新的值進來、整區重新 render：圖的顏色從 token 重讀，設定變了就重畫 */
  theme: string;
  loadChart?: ChartLoader;
  now?: () => Date;
};

export function StatsArea({ api, route, capabilities, ui, setUi, planId, onPlanChange, doc, theme, loadChart = defaultLoadChart, now = () => new Date() }: Props) {
  return (
    <div className="adm-stats-area" data-theme-key={theme}>
      <div className="adm-plan-head"><h2>報表</h2></div>
      <AreaTabs area="stats" current={route.tab} capabilities={capabilities} />
      {route.tab === "usage" && <UsageTab api={api} ui={ui} setUi={setUi} doc={doc} loadChart={loadChart} today={taipeiToday(now())} />}
      {route.tab === "registrations" && <RegistrationTab api={api} route={route} capabilities={capabilities} chosenPlanId={planId} onPlanChange={onPlanChange} doc={doc} />}
    </div>
  );
}

// ── 圖表 ─────────────────────────────────────────────────────────────────
type Dataset = { label: string; data: number[]; color: string };

function lineConfig(labels: string[], datasets: Dataset[], unit: string) {
  return {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((set) => ({
        label: set.label, data: set.data, borderColor: set.color, backgroundColor: set.color,
        pointRadius: labels.length > 60 ? 0 : 2, tension: 0.25
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom" },
        tooltip: { callbacks: { label: (item: { dataset: { label: string }; formattedValue: string }) => `${item.dataset.label}：${item.formattedValue} ${unit}` } }
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  };
}

function barConfig(labels: string[], datasets: Dataset[], unit: string, xTitle?: string) {
  return {
    type: "bar",
    data: { labels, datasets: datasets.map((set) => ({ label: set.label, data: set.data, backgroundColor: set.color })) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom" },
        tooltip: { callbacks: { label: (item: { dataset: { label: string }; formattedValue: string }) => `${item.dataset.label}：${item.formattedValue} ${unit}` } }
      },
      scales: {
        x: xTitle ? { title: { display: true, text: xTitle } } : {},
        y: { beginAtZero: true }
      }
    }
  };
}

/** 一張圖：Chart.js 載入後才畫；設定（含顏色）變了就重畫。載不到就說一聲，數字看下面的表格。 */
function ChartFigure({ doc, loadChart, caption, label, config }: {
  doc: Document;
  loadChart: ChartLoader;
  caption?: string;
  label: string;
  config: unknown;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(config);

  useEffect(() => {
    let active = true;
    let chart: ChartInstance | null = null;
    loadChart(doc)
      .then((Chart) => {
        if (active && canvasRef.current) chart = new Chart(canvasRef.current, configRef.current);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      chart?.destroy();
    };
  }, [doc, loadChart, key]);

  if (failed) return <p className="adm-muted adm-small">圖表載不出來（Chart.js 下載失敗），下面的表格有同樣的數字。</p>;
  return (
    <figure className="adm-chart">
      {caption && <figcaption>{caption}</figcaption>}
      <div className="adm-chart__canvas"><canvas ref={canvasRef} role="img" aria-label={label} /></div>
    </figure>
  );
}

// ── 讀經使用率 ────────────────────────────────────────────────────────────
const QUICK_RANGES = [
  { value: "7", label: "近 7 天" },
  { value: "30", label: "近 30 天" },
  { value: "90", label: "近 90 天" }
] as const;

function UsageTab({ api, ui, setUi, doc, loadChart, today }: {
  api: AdminApi;
  ui: StatsUiState;
  setUi: Dispatch<SetStateAction<StatsUiState>>;
  doc: Document;
  loadChart: ChartLoader;
  today: string;
}) {
  const [refresh, setRefresh] = useState(0);
  const fallback = defaultUsageRange(today);
  const from = ui.from ?? fallback.from;
  const to = ui.to ?? fallback.to;
  const invalid = rangeError(from, to);
  const usage = useAdminData<Usage>(api, "reading_usage", invalid ? null : { from, to }, refresh);
  const quick = to === today ? QUICK_RANGES.find((option) => addDays(today, -(Number(option.value) - 1)) === from)?.value : undefined;

  const reload = () => {
    api.invalidate(["reading_usage"]);
    setRefresh((value) => value + 1);
  };
  const setRange = (next: { from?: string; to?: string }) => setUi((prev) => ({
    ...prev, from: next.from ?? prev.from ?? from, to: next.to ?? prev.to ?? to
  }));

  return (
    <div className="adm-stats">
      <div className="adm-stats__toolbar">
        <Segmented
          label="快速選擇區間"
          options={QUICK_RANGES}
          value={(quick ?? "custom") as typeof QUICK_RANGES[number]["value"]}
          onChange={(value) => setRange({ from: addDays(today, -(Number(value) - 1)), to: today })}
        />
        <label className="adm-stats__date">起<input type="date" className="adm-input" value={from} max={to < today ? to : today} onChange={(event) => setRange({ from: event.target.value })} /></label>
        <label className="adm-stats__date">迄<input type="date" className="adm-input" value={to} max={today} onChange={(event) => setRange({ to: event.target.value })} /></label>
        <span className="adm-topbar__spacer" />
        <button type="button" className="adm-icon-button" onClick={reload} disabled={usage.loading || !!invalid} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${usage.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <p className="adm-muted adm-small">
        有讀＝當天（台灣時間）打卡任何一章，<strong>不限計畫書卷</strong>（個人計畫的打卡不算）。
        和「計畫」總覽的「近 7 天有讀」不同：那個只算該計畫的書卷。區間最長 {MAX_RANGE_DAYS} 天。
      </p>

      {invalid && <p className="adm-danger-text" role="alert">{invalid}</p>}
      {!invalid && usage.error !== null && (
        <ErrorNotice error={usage.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />
      )}
      {!invalid && usage.loading && !usage.data && <Spinner label="載入讀經使用率…" />}
      {!invalid && usage.data && (
        <UsageBody usage={usage.data} ui={ui} setUi={setUi} doc={doc} loadChart={loadChart} />
      )}
    </div>
  );
}

function UsageBody({ usage, ui, setUi, doc, loadChart }: {
  usage: Usage;
  ui: StatsUiState;
  setUi: Dispatch<SetStateAction<StatsUiState>>;
  doc: Document;
  loadChart: ChartLoader;
}) {
  const colors = chartColors(doc);
  const { summary, days, l7 } = usage;
  const labels = days.map((day) => shortDate(day.date));
  const latest = summary.latestDate ? shortDate(summary.latestDate) : "";
  const chart = (props: { caption?: string; label: string; config: unknown }) => <ChartFigure doc={doc} loadChart={loadChart} {...props} />;
  const series = (key: keyof Omit<UsageDay, "date" | "stickiness">) => days.map((day) => day[key]);
  const empty = days.every((day) => day.dau === 0);

  return (
    <>
      <section className="adm-card">
        <header className="adm-card__header"><h3>每天讀經人數</h3></header>
        <div className="adm-card__body">
          {empty
            ? <p className="adm-muted">這段期間沒有讀經紀錄。</p>
            : (
              <>
                <div className="adm-tiles">
                  <div className="adm-tile adm-tile--static"><span>每天讀經人數（DAU）</span><strong>{formatNumber(summary.avgDau)}</strong><small>區間內平均每天有幾人讀經</small></div>
                  <div className="adm-tile adm-tile--static"><span>近 7 天讀過的人（WAU）</span><strong>{formatNumber(summary.wau)}</strong><small>到 {latest} 為止，7 天內至少讀過一天</small></div>
                  <div className="adm-tile adm-tile--static"><span>近 30 天讀過的人（MAU）</span><strong>{formatNumber(summary.mau)}</strong><small>到 {latest} 為止，30 天內至少讀過一天</small></div>
                  <div className="adm-tile adm-tile--static"><span>天天讀的比例（黏著度）</span><strong>{formatPct(summary.avgStickiness)}</strong><small>每天讀經人數 ÷ 近 30 天讀過的人，取平均</small></div>
                </div>
                {chart({
                  caption: "每天讀經人數（DAU）：看每天的起伏",
                  label: `每天讀經人數，平均 ${formatNumber(summary.avgDau)} 人`,
                  config: lineConfig(labels, [{ label: "每天讀經人數", data: series("dau"), color: colors.brand }], "人")
                })}
                {chart({
                  caption: "近 7 天／近 30 天讀過的人（WAU／MAU）：看整體規模有沒有成長",
                  label: `到 ${latest} 為止，近 7 天 ${formatNumber(summary.wau)} 人、近 30 天 ${formatNumber(summary.mau)} 人讀過`,
                  config: lineConfig(labels, [
                    { label: "近 7 天讀過的人", data: series("wau"), color: colors.success },
                    { label: "近 30 天讀過的人", data: series("mau"), color: colors.warning }
                  ], "人")
                })}
              </>
            )}
        </div>
      </section>

      <section className="adm-card">
        <header className="adm-card__header"><h3>每日趨勢</h3></header>
        <div className="adm-card__body">
          <p className="adm-muted adm-small">伺服器把打卡彙總成每天一列（人數、章數），原始打卡不會送到瀏覽器；同一章重讀只留最新一次的打卡。</p>
          <div className="adm-tiles">
            <div className="adm-tile adm-tile--static"><span>區間內讀了幾章</span><strong>{formatNumber(summary.totalChapters)}</strong><small>{formatDate(usage.from)}～{formatDate(usage.to)}</small></div>
            <div className="adm-tile adm-tile--static"><span>平均每天幾章</span><strong>{formatNumber(summary.avgChapters)}</strong></div>
          </div>
          {!empty && chart({
            caption: "每天讀經章數",
            label: `區間內共 ${formatNumber(summary.totalChapters)} 章，平均每天 ${formatNumber(summary.avgChapters)} 章`,
            config: barConfig(labels, [{ label: "讀經章數", data: series("chapters"), color: colors.brand }], "章")
          })}
          <details className="adm-stats__details">
            <summary>逐日數字</summary>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>日期</th><th>每天讀經人數</th><th>章數</th><th>近 7 天讀過</th><th>近 30 天讀過</th><th>天天讀的比例</th></tr></thead>
                <tbody>
                  {[...days].reverse().map((day) => (
                    <tr key={day.date}>
                      <td>{formatDate(day.date)}</td>
                      <td className="adm-num">{formatNumber(day.dau)}</td>
                      <td className="adm-num">{formatNumber(day.chapters)}</td>
                      <td className="adm-num">{formatNumber(day.wau)}</td>
                      <td className="adm-num">{formatNumber(day.mau)}</td>
                      <td className="adm-num">{formatPct(day.stickiness)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      <section className="adm-card">
        <header className="adm-card__header"><h3>一週讀經天數（L7）</h3></header>
        <div className="adm-card__body">
          <p className="adm-muted adm-small">
            本週 {weekLabel(l7.current)}
            {l7.current.dayCount < 7 ? `（算到 ${shortDate(l7.current.coveredEnd)}，共 ${l7.current.dayCount} 天，最多只會到 ${l7.current.dayCount} 天）` : ""}
            ，讀經 {formatNumber(l7.current.total)} 人；上週 {weekLabel(l7.previous)}，讀經 {formatNumber(l7.previous.total)} 人。週以迄日所在的那一週（週一～週日）算。
          </p>
          {chart({
            caption: "一週裡讀經幾天（人數）",
            label: `本週讀經 ${l7.current.total} 人、上週 ${l7.previous.total} 人`,
            config: barConfig(l7.current.rows.map((row) => `${row.days} 天`), [
              { label: `上週 ${weekLabel(l7.previous)}`, data: l7.previous.rows.map((row) => row.users), color: colors.muted },
              { label: `本週 ${weekLabel(l7.current)}`, data: l7.current.rows.map((row) => row.users), color: colors.brand }
            ], "人")
          })}
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>讀經天數</th><th>本週人數</th><th>本週佔比</th><th>上週人數</th><th>上週佔比</th></tr></thead>
              <tbody>
                {[...l7.current.rows].reverse().map((row) => {
                  const prev = l7.previous.rows[row.days - 1];
                  return (
                    <tr key={row.days}>
                      <td>{row.days} 天</td>
                      <td className="adm-num">{formatNumber(row.users)}</td>
                      <td className="adm-num">{formatPct(row.pct)}</td>
                      <td className="adm-num">{formatNumber(prev?.users ?? 0)}</td>
                      <td className="adm-num">{formatPct(prev?.pct ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <HoursCard usage={usage} ui={ui} setUi={setUi} chart={chart} color={colors.brand} />

      <p className="adm-muted adm-small">
        數字會偏低，適合看趨勢、不是精確的使用人數：重讀同一章會把原本的打卡時間改成最新一次，取消打卡會刪除紀錄，
        所以越早的日期越少、時段也會往後偏。今天（{formatDate(usage.today)}）的數字還在累積。
      </p>
    </>
  );
}

const HOUR_DAY_OPTIONS = [{ value: "all", label: "全部" }, { value: "weekday", label: "平日" }, { value: "weekend", label: "週末" }] as const;
const HOUR_METRIC_OPTIONS = [{ value: "users", label: "人數" }, { value: "chapters", label: "章數" }] as const;

function HoursCard({ usage, ui, setUi, chart, color }: {
  usage: Usage;
  ui: StatsUiState;
  setUi: Dispatch<SetStateAction<StatsUiState>>;
  chart: (props: { caption?: string; label: string; config: unknown }) => ReactNode;
  color: string;
}) {
  const profile = usage.hours[ui.hourDays];
  const values = ui.hourMetric === "chapters" ? profile.chapters : profile.users;
  const unit = ui.hourMetric === "chapters" ? "章" : "人";
  const metricText = ui.hourMetric === "chapters" ? "章數" : "人數";
  const top = topHours(values);
  const topText = top.length
    ? `最多${ui.hourMetric === "chapters" ? "章數" : "人讀"}的時段：${top.map((item) => `${item.hour} 時（平均每天 ${item.value} ${unit}）`).join("、")}`
    : "這段期間沒有讀經紀錄。";

  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>讀經時段（幾點讀經）</h3></header>
      <div className="adm-card__body">
        <div className="adm-stats__toolbar">
          <Segmented label="星期" options={HOUR_DAY_OPTIONS} value={ui.hourDays} onChange={(hourDays) => setUi((prev) => ({ ...prev, hourDays }))} />
          <Segmented label="數值" options={HOUR_METRIC_OPTIONS} value={ui.hourMetric} onChange={(hourMetric) => setUi((prev) => ({ ...prev, hourMetric }))} />
        </div>
        <p>{topText}</p>
        <p className="adm-muted adm-small">長條＝該小時平均每天讀經的{metricText}（共 {profile.dayCount} 天）。用長條長短表示多寡，不靠顏色深淺。</p>
        {top.length > 0 && chart({
          label: topText,
          config: barConfig(values.map((_value, hour) => String(hour)), [{ label: `平均每天${metricText}`, data: values, color }], unit, "時（0～23）")
        })}
        <details className="adm-stats__details">
          <summary>各時段數字</summary>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>時段</th><th>平均每天{metricText}</th></tr></thead>
              <tbody>
                {values.map((value, hour) => (
                  <tr key={hour}><td>{hour}:00–{hour}:59</td><td className="adm-num">{value}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

// ── 報名註冊 ──────────────────────────────────────────────────────────────
function RegistrationTab({ api, route, capabilities, chosenPlanId, onPlanChange, doc }: {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "stats" }>;
  capabilities: readonly string[];
  chosenPlanId: string | null;
  onPlanChange: (planId: string) => void;
  doc: Document;
}) {
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<"export" | "sheet" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [synced, setSynced] = useState<{ planId: string; at: string } | null>(null);
  const requested = route.planId || chosenPlanId || null;
  const data = useAdminData<RegistrationData>(api, "registration_stats", { global_plan_id: requested }, refresh);
  const plans = data.data?.plans || [];
  const planId = data.data?.planId || requested;
  const stats = data.data?.stats || null;
  const canExport = capabilities.includes("export");

  // 只記網址帶的計畫；伺服器挑的預設不寫回去（寫回去會換快取 key、多打一次）
  useEffect(() => {
    if (route.planId && route.planId !== chosenPlanId) onPlanChange(route.planId);
  }, [route.planId, chosenPlanId, onPlanChange]);

  const reload = () => {
    api.invalidate(["registration_stats"]);
    setRefresh((value) => value + 1);
  };
  const pick = (id: string) => {
    setActionError(null);
    onPlanChange(id);
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "stats", tab: "registrations", planId: id });
  };
  const run = async (kind: "export" | "sheet") => {
    if (!planId) return;
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "export") {
        const file = await api.call<CsvExport>("registration_export", { global_plan_id: planId });
        downloadCsv(doc, file.filename, file.csv);
      } else {
        await api.call("registration_sheet_sync", { global_plan_id: planId });
        setSynced({ planId, at: new Date().toISOString() });
      }
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="adm-stats">
      <div className="adm-stats__toolbar">
        <label className="adm-visually-hidden" htmlFor="adm-stats-plan">選擇計畫</label>
        <select id="adm-stats-plan" className="adm-select adm-plan-head__pick" value={planId || ""} disabled={plans.length === 0} onChange={(event) => pick(event.target.value)}>
          {plans.length === 0 && <option value="">{data.loading ? "載入計畫…" : "沒有可選的計畫"}</option>}
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {text(plan.name, "未命名計畫")}{plan.start_date ? `（${formatDate(plan.start_date)} 起）` : ""}
            </option>
          ))}
        </select>
        {canExport && (
          <>
            <button type="button" className="adm-button" onClick={() => { void run("export"); }} disabled={!stats || busy !== null}>
              <Download className="adm-icon" aria-hidden="true" />{busy === "export" ? "匯出中…" : "匯出 CSV"}
            </button>
            <button type="button" className="adm-button" onClick={() => { void run("sheet"); }} disabled={!stats || busy !== null}
              title="把這個計畫的數字覆寫到教會共用的「速讀報名統計」試算表">
              <Sheet className="adm-icon" aria-hidden="true" />{busy === "sheet" ? "更新中…" : "更新到 Google 試算表"}
            </button>
          </>
        )}
        <span className="adm-topbar__spacer" />
        <button type="button" className="adm-icon-button" onClick={reload} disabled={data.loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${data.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <p className="adm-muted adm-small">
        註冊＝啟用中的帳號，依個人資料的大區／牧區分；報名＝加入這個計畫；3 人隊／6 人隊＝這個計畫裡在該組別隊伍的人數。
        匯出與更新試算表都由伺服器產生，並記進稽核紀錄。
      </p>
      {synced && synced.planId === planId && (
        <p className="adm-status" role="status"><CircleCheck className="adm-icon" aria-hidden="true" />已更新到 Google 試算表（{formatDateTime(synced.at)}）。</p>
      )}
      {actionError !== null && <ErrorNotice error={actionError} />}

      {data.error !== null && <ErrorNotice error={data.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />}
      {data.loading && !data.data && <Spinner label="載入報名註冊統計…" />}
      {data.data && !stats && <p className="adm-muted adm-empty">還沒有任何計畫。</p>}
      {stats && (
        <>
          <section className="adm-card">
            <header className="adm-card__header"><h3>牧區資料與計畫參加總覽</h3></header>
            <div className="adm-card__body">
              <div className="adm-tiles">
                {REGISTRATION_SUMMARY_ITEMS.map(([key, label]) => (
                  <div key={key} className="adm-tile adm-tile--static"><span>{label}</span><strong>{formatNumber(stats.summary[key] ?? 0)}</strong></div>
                ))}
              </div>
            </div>
          </section>
          <RegistrationTable title="大區統計" unit="大區" rows={stats.greatRegions} />
          <RegistrationTable title="牧區統計" unit="牧區" rows={stats.pastoralZones} withLeader />
        </>
      )}
    </div>
  );
}

function RegistrationTable({ title, unit, rows, withLeader = false }: { title: string; unit: string; rows: RegistrationRow[]; withLeader?: boolean }) {
  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>{title}</h3></header>
      <div className="adm-card__body">
        {rows.length === 0
          ? <p className="adm-muted">目前沒有資料。</p>
          : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{unit}</th>
                    {withLeader && <th>牧區長</th>}
                    <th>報名人數</th><th>註冊人數</th><th>3 人團隊人數</th><th>6 人團隊人數</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td>{text(row.label, "未設定")}</td>
                      {withLeader && <td>{text(row.leaderName)}</td>}
                      <td className="adm-num">{formatNumber(row.signupCount)}</td>
                      <td className="adm-num">{formatNumber(row.registeredCount)}</td>
                      <td className="adm-num">{formatNumber(row.team3Count)}</td>
                      <td className="adm-num">{formatNumber(row.team6Count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </section>
  );
}
