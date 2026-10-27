// 後台「測驗」區（#619）的總覽：原本報表區的「測驗作答」分頁（#581，更早在計畫區，#565）。
// 上面是這一區的地圖——三種測驗（照搬的區塊，要 content.manage）各有哪些頁，免得忘記有什麼；下面是這一期的作答數字
// （每日小測驗、大測驗、雲柱），只有數字、不記稽核。數字照計畫算（這一期設定的測驗、這一期報名者的作答），所以要選計畫——
// 和計畫區、報表區的「報名註冊」、照搬的小測驗共用同一個選的計畫（App 那一層，#620），切分頁時不變。計畫選單用 plan_options（和計畫區同一個預設）。
// 請求預算：打開＝plan_options＋plan_quiz，換計畫 1 個 plan_quiz；都走 60 秒快取，重新整理鈕先 invalidate。地圖不發請求。
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatDate, formatDateTime, text } from "../format.ts";
import { legacySectionsOf } from "../legacy.ts";
import { pct, pickPlanId, type PlanOptions, type PlanQuiz } from "../plans.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import { shortDate } from "../stats.ts";
import { Bar, ErrorNotice, Spinner } from "../ui.tsx";
import { useAdminData, type Loaded } from "../use-admin-data.ts";
import { AreaTabs } from "./AreaTabs.tsx";

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "quiz" }>;
  capabilities: readonly string[];
  /** 計畫、測驗、報表三區共用的「目前選的計畫」（#620）；null＝用預設計畫 */
  planId: string | null;
  onPlanChange: (planId: string) => void;
  doc: Document;
};

const sectionHref = (section: string) => formatRoute({ view: "legacy", area: "quiz", section });

export function QuizArea(props: Props) {
  const { capabilities } = props;
  return (
    <div className="adm-quiz-area">
      <div className="adm-plan-head"><h2>測驗</h2></div>
      <AreaTabs area="quiz" current="overview" capabilities={capabilities} />
      <QuizMap capabilities={capabilities} />
      {capabilities.includes("plans.read")
        ? <QuizOverview {...props} />
        : <p className="adm-muted adm-empty">你的帳號沒有看測驗作答數字的權限。</p>}
    </div>
  );
}

/** 三種測驗各有哪些頁（舊畫面自己的分頁，名稱在 legacy.ts）；點名稱進那一種測驗 */
function QuizMap({ capabilities }: { capabilities: readonly string[] }) {
  const sections = legacySectionsOf("quiz").filter((section) => capabilities.includes(section.capability));
  if (sections.length === 0) return null;
  return (
    <section className="adm-card adm-quiz-map" aria-label="測驗區有哪些頁">
      <div className="adm-card__body">
        <ul className="adm-plain-list">
          {sections.map((section) => (
            <li key={section.id} className="adm-quiz-map__item">
              <a className="adm-link adm-quiz-map__name" href={sectionHref(section.id)}>{section.label}</a>
              {section.pages && <span className="adm-muted adm-small">{section.pages}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function QuizOverview({ api, route, capabilities, planId: chosenPlanId, onPlanChange, doc }: Props) {
  const [refresh, setRefresh] = useState(0);
  const options = useAdminData<PlanOptions>(api, "plan_options", {}, refresh);
  const planId = options.data ? pickPlanId(options.data, [route.planId, chosenPlanId]) : null;
  const quiz = useAdminData<PlanQuiz>(api, "plan_quiz", planId ? { global_plan_id: planId } : null, refresh);
  const plans = options.data?.plans || [];

  useEffect(() => {
    if (planId && planId !== chosenPlanId) onPlanChange(planId);
  }, [planId, chosenPlanId, onPlanChange]);

  const reload = () => {
    api.invalidate(["plan_options", "plan_quiz"]);
    setRefresh((value) => value + 1);
  };
  const pick = (id: string) => {
    onPlanChange(id);
    const view = doc.defaultView;
    if (view) view.location.hash = formatRoute({ view: "quiz", planId: id });
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
              <DetailLink capabilities={capabilities} section="quizzes">每天的題目、規則與完整統計在「小測驗」</DetailLink>
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
              <DetailLink capabilities={capabilities} section="exam">批改與各單位成績在「大測驗」</DetailLink>
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
              <DetailLink capabilities={capabilities} section="lightning-quiz">所有人的統計、前三名公布與兌換券在「雲柱測驗」</DetailLink>
            </div>
          </section>
        )}
      </div>
      {notes.map((note) => <p key={note} className="adm-muted adm-small">{note}</p>)}
      <p className="adm-muted adm-small">打開這個分頁才調閱；這期沒設定的測驗不顯示。出題、審題、完整統計在上面各測驗的分頁，這裡只看這一期的作答。</p>
    </div>
  );
}

/** 卡片底下連到那一種測驗（照搬區塊，要 content.manage） */
function DetailLink({ capabilities, section, children }: { capabilities: readonly string[]; section: string; children: string }) {
  if (!capabilities.includes("content.manage")) return null;
  return (
    <a className="adm-link" href={sectionHref(section)}>
      {children}<ExternalLink className="adm-icon adm-icon--small" aria-hidden="true" />
    </a>
  );
}
