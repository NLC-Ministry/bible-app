// 報表區的「測驗作答」分頁（#581，原本在計畫區，#565）：每日小測驗、大測驗、雲柱的作答數字，只有數字、不記稽核。
// 數字照計畫算（這一期設定的測驗、這一期報名者的作答），所以上面仍要選計畫——和「報名註冊」共用同一個選的計畫
// （App 那一層的 StatsUiState.planId），切分頁時不變。計畫選單用 plan_options（和計畫區同一個預設）。
// 請求預算：打開＝plan_options＋plan_quiz，換計畫 1 個 plan_quiz；都走 60 秒快取，重新整理鈕先 invalidate。
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatDate, formatDateTime, text } from "../format.ts";
import { pct, pickPlanId, type PlanOptions, type PlanQuiz } from "../plans.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import { shortDate } from "../stats.ts";
import { Bar, ErrorNotice, Spinner } from "../ui.tsx";
import { useAdminData, type Loaded } from "../use-admin-data.ts";
import type { StatsUiState } from "./StatsArea.tsx";

export function QuizTab({ api, route, capabilities, ui, setUi, doc }: {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "stats" }>;
  capabilities: readonly string[];
  ui: StatsUiState;
  setUi: Dispatch<SetStateAction<StatsUiState>>;
  doc: Document;
}) {
  const [refresh, setRefresh] = useState(0);
  const options = useAdminData<PlanOptions>(api, "plan_options", {}, refresh);
  const planId = options.data ? pickPlanId(options.data, [route.planId, ui.planId]) : null;
  const quiz = useAdminData<PlanQuiz>(api, "plan_quiz", planId ? { global_plan_id: planId } : null, refresh);
  const plans = options.data?.plans || [];

  useEffect(() => {
    if (planId && planId !== ui.planId) setUi((prev) => ({ ...prev, planId }));
  }, [planId, ui.planId, setUi]);

  const reload = () => {
    api.invalidate(["plan_options", "plan_quiz"]);
    setRefresh((value) => value + 1);
  };
  const pick = (id: string) => {
    setUi((prev) => ({ ...prev, planId: id }));
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "stats", tab: "quiz", planId: id });
  };

  return (
    <div className="adm-stats">
      <div className="adm-stats__toolbar">
        <label className="adm-visually-hidden" htmlFor="adm-quiz-plan">選擇計畫</label>
        <select id="adm-quiz-plan" className="adm-select adm-plan-head__pick" value={planId || ""} disabled={plans.length === 0} onChange={(event) => pick(event.target.value)}>
          {plans.length === 0 && <option value="">{options.loading ? "載入計畫…" : "沒有可選的計畫"}</option>}
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {text(plan.name, "未命名計畫")}{plan.start_date ? `（${formatDate(plan.start_date)} 起）` : ""}
            </option>
          ))}
        </select>
        <span className="adm-topbar__spacer" />
        <button type="button" className="adm-icon-button" onClick={reload} disabled={options.loading || quiz.loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${options.loading || quiz.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {options.error !== null && <ErrorNotice error={options.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />}
      {options.data && plans.length === 0 && <p className="adm-muted adm-empty">還沒有任何計畫。</p>}
      {planId && <QuizBody quiz={quiz} capabilities={capabilities} onReload={reload} />}
    </div>
  );
}

function QuizBody({ quiz, capabilities, onReload }: { quiz: Loaded<PlanQuiz>; capabilities: readonly string[]; onReload: () => void }) {
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
