// 後台首頁（#569）：打開後台就看到「今天要處理什麼」。只放數字、不含任何人的名字、不記稽核。
//
// 請求預算：開後台＝bootstrap＋1 個 home_summary（60 秒快取，重新整理鈕先 invalidate）；每一格點了才進去，
// 由那一頁照自己的預算載入。每一格的數法都和點進去那頁相同（伺服器 home.ts＋admin_api_home_counts）：
// 需要關心、還沒滿的隊、本期進度只算預設計畫（和計畫區同一個預設），並標出計畫名稱。
// 點「需要關心」「還沒滿的隊」「未結案的回報」會先把那一頁的篩選設好（App 那一層的狀態），再換網址。
import { useEffect, useState } from "react";
import { BookOpen, ClipboardList, HeartHandshake, Inbox, RefreshCw, Settings, TriangleAlert, Users } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatDateTime, text } from "../format.ts";
import { QUIZ_STATUS_LABEL, quizNotReady, showQuiz, waitingDays, waitingText, type HomeSummary } from "../home.ts";
import { pct, scheduleLine } from "../plans.ts";
import { formatRoute } from "../route.ts";
import { ErrorNotice, Spinner } from "../ui.tsx";
import { useAdminData } from "../use-admin-data.ts";

export type HomeDrill = "care" | "unfilled_teams" | "overview";

type Props = {
  api: AdminApi;
  capabilities: readonly string[];
  /** 打開收件匣的「未結案」 */
  onOpenInbox: () => void;
  /** 打開預設計畫的某一頁（名單先篩好需要關心、隊伍清單先篩好還沒滿） */
  onOpenPlan: (planId: string, drill: HomeDrill) => void;
  now?: () => Date;
};

export function HomeArea({ api, capabilities, onOpenInbox, onOpenPlan, now = () => new Date() }: Props) {
  const [refresh, setRefresh] = useState(0);
  const home = useAdminData<HomeSummary>(api, "home_summary", {}, refresh);
  const reload = () => {
    api.invalidate(["home_summary"]);
    setRefresh((value) => value + 1);
  };
  // 人數對不上（同計畫總覽）：不要留在快取裡
  const inconsistent = home.data?.plan?.meta?.consistent === false;
  useEffect(() => {
    if (inconsistent) api.invalidate(["home_summary"]);
  }, [api, inconsistent]);

  const can = (capability: string) => capabilities.includes(capability);

  return (
    <div className="adm-home">
      <div className="adm-plan-head">
        <h2>首頁</h2>
        <span className="adm-muted adm-small">今天要處理的事；點一格才打開那一頁</span>
        <span className="adm-topbar__spacer" />
        <button type="button" className="adm-icon-button" onClick={reload} disabled={home.loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${home.loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {home.error !== null && <ErrorNotice error={home.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />}
      {home.loading && !home.data && <Spinner label="載入首頁…" />}
      {home.data && <HomeBody home={home.data} can={can} onOpenInbox={onOpenInbox} onOpenPlan={onOpenPlan} now={now()} />}
    </div>
  );
}

function HomeBody({ home, can, onOpenInbox, onOpenPlan, now }: {
  home: HomeSummary;
  can: (capability: string) => boolean;
  onOpenInbox: () => void;
  onOpenPlan: (planId: string, drill: HomeDrill) => void;
  now: Date;
}) {
  const { plan, reports, commentary, quiz, changes } = home;
  const planId = plan?.plan.id || "";
  const planName = plan ? text(plan.plan.name, "未命名計畫") : "";
  const wait = reports ? waitingText(waitingDays(reports.oldest_open_at, now)) : "";

  return (
    <>
      {can("plans.read") && (
        plan
          ? <PlanLine plan={plan} onOpen={() => onOpenPlan(planId, "overview")} />
          : <p className="adm-muted adm-empty">還沒有任何計畫。</p>
      )}
      {plan && plan.meta.consistent === false && (
        <div className="adm-notice adm-notice--danger" role="alert">
          <TriangleAlert className="adm-icon" aria-hidden="true" />
          <div className="adm-notice__body"><p>計畫的人數對不上，下面計畫相關的數字可能不完整。請按右上的重新整理；一直對不上請回報開發者。</p></div>
        </div>
      )}

      <div className="adm-home__grid">
        {reports && can("support.read") && (
          <a className={`adm-tile adm-home__tile${reports.open > 0 ? " adm-home__tile--todo" : ""}`} href={formatRoute({ view: "inbox", reportId: null })}
            onClick={onOpenInbox}>
            <span><Inbox className="adm-icon adm-icon--small" aria-hidden="true" />未結案的回報</span>
            <strong>{reports.open}</strong>
            <small>{reports.open > 0 ? [`有新訊息 ${reports.unread} 則`, wait].filter(Boolean).join("・") : "沒有未結案的回報"}</small>
          </a>
        )}

        {plan && can("plans.read") && (
          <a className={`adm-tile adm-home__tile${plan.care.total > 0 ? " adm-home__tile--todo" : ""}`}
            href={formatRoute({ view: "plans", tab: "roster", planId })}
            onClick={() => onOpenPlan(planId, "care")}>
            <span><HeartHandshake className="adm-icon adm-icon--small" aria-hidden="true" />需要關心</span>
            <strong>{plan.care.total} 人</strong>
            <small>落後 7 天以上 {plan.care.behind} 人・最後打卡 3 天以上 {plan.care.noCheckin + plan.care.neverRead} 人</small>
          </a>
        )}

        {plan && can("plans.read") && (
          <a className="adm-tile adm-home__tile" href={formatRoute({ view: "plans", tab: "teams", planId })}
            onClick={() => onOpenPlan(planId, "unfilled_teams")}>
            <span><Users className="adm-icon adm-icon--small" aria-hidden="true" />還沒滿的隊</span>
            <strong>{plan.teams.unfilled} 隊</strong>
            <small>報名者的隊伍共 {plan.teams.teams} 隊・還沒有隊 {plan.teams.withoutTeam} 人</small>
          </a>
        )}

        {commentary && can("content.manage") && (
          <a className={`adm-tile adm-home__tile${commentary.pending > 0 ? " adm-home__tile--todo" : ""}`}
            href={formatRoute({ view: "legacy", area: "content", section: "commentary" })}>
            <span><BookOpen className="adm-icon adm-icon--small" aria-hidden="true" />待審的經文注釋</span>
            <strong>{commentary.pending} 則</strong>
            <small>審核通過、還沒發布 {commentary.approved} 則</small>
          </a>
        )}

        {showQuiz(quiz) && can("content.manage") && (
          <a className={`adm-tile adm-home__tile${quizNotReady(quiz.status) ? " adm-home__tile--todo" : ""}`}
            href={formatRoute({ view: "legacy", area: "quiz", section: "quizzes" })}>
            <span><ClipboardList className="adm-icon adm-icon--small" aria-hidden="true" />明天的小測驗</span>
            <strong>{quiz.status ? QUIZ_STATUS_LABEL[quiz.status] : "—"}</strong>
            <small>{quiz.date.replace(/-/g, "/")}・{planName}</small>
          </a>
        )}
      </div>

      {can("audit.read") && (
        <section className="adm-card">
          <header className="adm-card__header"><Settings className="adm-icon" aria-hidden="true" /><h3>最近的設定變更</h3></header>
          <div className="adm-card__body">
            {changes.length === 0
              ? <p className="adm-muted">最近 30 天沒有設定變更。</p>
              : (
                <ul className="adm-plain-list adm-home__changes">
                  {changes.map((change, index) => (
                    <li key={`${change.occurredAt}-${index}`}><span>{change.label}</span><span className="adm-muted adm-small">{formatDateTime(change.occurredAt)}</span></li>
                  ))}
                </ul>
              )}
            <a className="adm-link" href={formatRoute({ view: "audit", actorId: null, targetId: null })}>是誰改的、改了什麼，看稽核紀錄 →</a>
          </div>
        </section>
      )}
    </>
  );
}

function PlanLine({ plan, onOpen }: { plan: NonNullable<HomeSummary["plan"]>; onOpen: () => void }) {
  const { day, reading } = scheduleLine(plan);
  const { funnel } = plan;
  return (
    <div className="adm-plan-status adm-home__plan">
      <a className="adm-link adm-plan-status__strong" href={formatRoute({ view: "plans", tab: "overview", planId: plan.plan.id })} onClick={onOpen}>
        {text(plan.plan.name, "未命名計畫")}
      </a>
      <span>{day}</span>
      {reading && <span>{reading}</span>}
      <span>報名 {funnel.enrolled} 人・近 7 天有讀 {funnel.active7} 人（{pct(funnel.active7, funnel.enrolled)}%）</span>
    </div>
  );
}
