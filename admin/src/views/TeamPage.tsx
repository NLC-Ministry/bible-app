// 後台隊伍除錯（#566，第一階段只讀）：計畫 → 團隊分頁的隊伍清單，與隊伍頁。
//
// 請求預算（需要時才調閱）：
//   · 隊伍清單：打開團隊分頁才載 team_list（一次拿齊每隊＋除錯檢查，記稽核）；篩選、搜尋不再發請求。
//   · 隊伍頁：打開＝1 個 team_detail（基本資料、除錯檢查、成員、會友 App 應該顯示，記稽核）；
//     異動歷程（team_history）、跨階段對應（team_lineage）點開才載。全部走 api.ts 的 60 秒快取。
// 檢查與「會友 App 應該顯示」都是伺服器用和會友 App 同一份規則算的（_shared/progress/team-report.mjs）。
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  CircleX,
  Code,
  GitBranch,
  History,
  RefreshCw,
  Search
} from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatDate, formatDateTime, text } from "../format.ts";
import { formatRoute } from "../route.ts";
import {
  TEAM_FILTER_OPTIONS,
  filterTeams,
  teamRowNote,
  type CarryStage,
  type TeamCheck,
  type TeamDetail,
  type TeamHistory,
  type TeamLineage,
  type TeamList as TeamListData,
  type TeamListFilter
} from "../teams.ts";
import { Badge, Bar, ErrorNotice, Segmented, Spinner } from "../ui.tsx";
import { useAdminData, type Loaded } from "../use-admin-data.ts";

const teamHref = (teamId: string, planId: string | null) => formatRoute({ view: "plans", tab: "teams", planId, teamId });

// ── 隊伍清單 ────────────────────────────────────────────────────────────
export function TeamList({ list, planId, filter, query, onFilter, onQuery, onReload, legacyLink }: {
  list: Loaded<TeamListData>;
  planId: string;
  filter: TeamListFilter;
  query: string;
  onFilter: (filter: TeamListFilter) => void;
  onQuery: (query: string) => void;
  onReload: () => void;
  legacyLink: boolean;
}) {
  if (list.error !== null) {
    return <ErrorNotice error={list.error} action={<button type="button" className="adm-button" onClick={onReload}>重試</button>} />;
  }
  if (!list.data) return <Spinner label="載入隊伍清單…" />;
  const { counts } = list.data;
  const rows = filterTeams(list.data.teams, filter, query);
  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>隊伍</h3></header>
      <div className="adm-card__body">
        <div className="adm-tiles">
          <button type="button" className="adm-tile" onClick={() => onFilter("all")}>
            <span>隊伍</span><strong>{counts.teams}</strong><small>{counts.members} 位隊員</small>
          </button>
          <button type="button" className="adm-tile" onClick={() => onFilter("unfilled")}>
            <span>還沒滿</span><strong>{counts.unfilled}</strong><small>人數少於組別人數</small>
          </button>
          <button type="button" className="adm-tile" onClick={() => onFilter("issues")}>
            <span>有異常</span><strong className={counts.issues > 0 ? "adm-danger-text" : undefined}>{counts.issues}</strong><small>除錯檢查沒過</small>
          </button>
        </div>
        <div className="adm-team-toolbar">
          <Segmented label="篩選隊伍" options={TEAM_FILTER_OPTIONS} value={filter} onChange={onFilter} />
          <div className="adm-input-icon adm-team-toolbar__search">
            <Search className="adm-icon" aria-hidden="true" />
            <label className="adm-visually-hidden" htmlFor="adm-team-search">搜尋隊名或隊長</label>
            <input id="adm-team-search" className="adm-input" type="search" placeholder="隊名或隊長" value={query} maxLength={40}
              onChange={(event) => onQuery(event.target.value)} />
          </div>
        </div>
        {rows.length === 0
          ? <p className="adm-muted adm-empty">{counts.teams === 0 ? "這個計畫還沒有隊伍。" : "沒有符合條件的隊伍。"}</p>
          : (
            <ul className="adm-team-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <a className="adm-team-row" href={teamHref(row.id, planId)}>
                    <span className="adm-team-row__name">
                      {text(row.name, "未命名隊伍")}
                      <Badge>{row.division} 人組</Badge>
                      {row.carried && <Badge>帶隊帶入</Badge>}
                    </span>
                    <span className="adm-team-row__meta">隊長 {text(row.captainName, "（未填姓名）")}・{row.memberCount}／{row.division} 人・{row.statusLabel}</span>
                    <span className="adm-team-row__note">
                      {row.issues > 0 ? <Badge tone="danger">{teamRowNote(row)}</Badge> : <span className="adm-muted">{teamRowNote(row)}</span>}
                    </span>
                    {row.issues > 0 && <span className="adm-team-row__issues">{row.issueLabels.join("、")}沒過</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        <p className="adm-muted adm-small">
          點隊伍看除錯檢查、成員與異動歷程。隊伍名單與成員名單的 CSV 匯出仍在
          {legacyLink ? <> <a className="adm-link" href="#/operations/teams">營運 → 組隊狀況</a>。</> : "營運 → 組隊狀況（要營運權限）。"}
        </p>
      </div>
    </section>
  );
}

// ── 隊伍頁 ──────────────────────────────────────────────────────────────
export function TeamPage({ api, teamId, backPlanId, capabilities }: {
  api: AdminApi;
  teamId: string;
  backPlanId: string | null;
  capabilities: readonly string[];
}) {
  const [refresh, setRefresh] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showLineage, setShowLineage] = useState(false);
  const params = { team_id: teamId };
  const detail = useAdminData<TeamDetail>(api, "team_detail", params, refresh);
  const history = useAdminData<TeamHistory>(api, "team_history", showHistory ? params : null, refresh);
  const lineage = useAdminData<TeamLineage>(api, "team_lineage", showLineage ? params : null, refresh);

  const reload = () => {
    api.invalidate(["team_detail", "team_history", "team_lineage", "team_list"]);
    setRefresh((value) => value + 1);
  };
  const planId = detail.data?.plan.id || backPlanId;
  const canPerson = capabilities.includes("support.read");
  const personHref = (userId: string) => formatRoute({ view: "user", userId, reason: `從隊伍頁查看（${detail.data?.team.name || ""}）` });

  return (
    <div className="adm-plan-area adm-team-page">
      <a className="adm-link adm-team-page__back" href={formatRoute({ view: "plans", tab: "teams", planId })}>
        <ArrowLeft className="adm-icon adm-icon--small" aria-hidden="true" />
        {detail.data ? `${text(detail.data.plan.name, "計畫")} 的隊伍清單` : "隊伍清單"}
      </a>
      {detail.error !== null && <ErrorNotice error={detail.error} action={<button type="button" className="adm-button" onClick={reload}>重試</button>} />}
      {detail.loading && !detail.data && <Spinner label="載入隊伍…" />}
      {detail.data && (
        <>
          <TeamHeader detail={detail.data} loading={detail.loading} onReload={reload} canPerson={canPerson} personHref={personHref} />
          <div className="adm-grid">
            <Checks checks={detail.data.checks} issues={detail.data.issues} />
            <AppView detail={detail.data} />
          </div>
          <Members detail={detail.data} canPerson={canPerson} personHref={personHref} />
          <Collapsible
            icon={<History className="adm-icon" aria-hidden="true" />}
            title="異動歷程"
            open={showHistory}
            onToggle={() => setShowHistory((value) => !value)}
          >
            <HistoryView history={history} onReload={reload} />
          </Collapsible>
          <Collapsible
            icon={<GitBranch className="adm-icon" aria-hidden="true" />}
            title="跨階段對應"
            open={showLineage}
            onToggle={() => setShowLineage((value) => !value)}
          >
            <LineageView lineage={lineage} onReload={reload} />
          </Collapsible>
        </>
      )}
    </div>
  );
}

function TeamHeader({ detail, loading, onReload, canPerson, personHref }: {
  detail: TeamDetail;
  loading: boolean;
  onReload: () => void;
  canPerson: boolean;
  personHref: (userId: string) => string;
}) {
  const { team, plan } = detail;
  return (
    <section className="adm-card">
      <header className="adm-card__header">
        <h3>{text(team.name, "未命名隊伍")}</h3>
        <button type="button" className="adm-icon-button" onClick={onReload} disabled={loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
      </header>
      <div className="adm-card__body">
        <div className="adm-badges">
          <Badge tone="brand">{team.division} 人組</Badge>
          <Badge>{team.statusLabel}</Badge>
          {plan.stage && plan.ended && <Badge tone="warning">階段已結束・不能修改</Badge>}
          {detail.issues > 0 ? <Badge tone="danger">{detail.issues} 項異常</Badge> : <Badge>檢查都通過</Badge>}
        </div>
        <dl className="adm-fields">
          <div className="adm-field"><dt>計畫</dt><dd>
            {text(plan.name, "未命名計畫")}（{formatDate(plan.startDate)}–{formatDate(plan.endDate)}{plan.stage ? "，階段計畫" : ""}）
          </dd></div>
          <div className="adm-field"><dt>隊長</dt><dd>
            {canPerson && team.captain.id
              ? <a className="adm-link" href={personHref(team.captain.id)}>{text(team.captain.name, "（未填姓名）")}</a>
              : text(team.captain.name, "（未填姓名）")}
          </dd></div>
          <div className="adm-field"><dt>邀請碼</dt><dd><code>{text(team.inviteCode)}</code></dd></div>
          <div className="adm-field"><dt>人數</dt><dd>{team.memberCount}／{team.division} 人</dd></div>
          <div className="adm-field"><dt>建立</dt><dd>
            {formatDateTime(team.createdAt)}
            {team.carriedFromTeamId && <>・<a className="adm-link" href={teamHref(team.carriedFromTeamId, null)}>從上一階段的隊帶來</a></>}
          </dd></div>
          {team.lastEventAt && <div className="adm-field"><dt>最後異動</dt><dd>{formatDateTime(team.lastEventAt)}</dd></div>}
        </dl>
      </div>
    </section>
  );
}

function CheckIcon({ check }: { check: TeamCheck }) {
  if (!check.applicable) return <CircleMinus className="adm-icon adm-team-check__icon adm-team-check__icon--na" aria-label="不適用" />;
  return check.ok
    ? <CircleCheck className="adm-icon adm-team-check__icon adm-team-check__icon--ok" aria-label="通過" />
    : <CircleX className="adm-icon adm-team-check__icon adm-team-check__icon--bad" aria-label="沒過" />;
}

function Checks({ checks, issues }: { checks: TeamCheck[]; issues: number }) {
  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>除錯檢查</h3>{issues > 0 ? <Badge tone="danger">{issues} 項沒過</Badge> : <Badge>都通過</Badge>}</header>
      <div className="adm-card__body">
        <ul className="adm-team-checks">
          {checks.map((check) => (
            <li key={check.id} className={`adm-team-check${check.ok ? "" : " adm-team-check--bad"}`}>
              <CheckIcon check={check} />
              <div className="adm-team-check__body">
                <span className="adm-team-check__label">{check.label}{!check.applicable && <span className="adm-muted">（不適用：不是已結束的階段）</span>}</span>
                {!check.ok && (
                  <>
                    <ul className="adm-team-check__problems">{check.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                    <p className="adm-small"><span className="adm-muted">影響：</span>{check.impact}</p>
                    <p className="adm-small"><span className="adm-muted">怎麼修：</span>{check.fix}</p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CarryStageView({ stage }: { stage: CarryStage }) {
  return (
    <li className="adm-team-carry">
      <span className="adm-team-carry__head">
        {stage.shown
          ? <CircleCheck className="adm-icon adm-icon--small adm-team-check__icon--ok" aria-hidden="true" />
          : <CircleMinus className="adm-icon adm-icon--small adm-team-check__icon--na" aria-hidden="true" />}
        <span>{stage.shown ? "會出現帶隊按鈕" : "不會出現帶隊按鈕"}・{stage.planName}</span>
      </span>
      <span className="adm-small">
        {stage.reason}
        {stage.carriedTeam && <> <a className="adm-link" href={teamHref(stage.carriedTeam.id, stage.planId)}>打開那一隊</a></>}
      </span>
      {stage.warning && <span className="adm-small adm-danger-text">{stage.warning}</span>}
      {stage.skipped.length > 0 && (
        <span className="adm-small">帶隊時會略過：{stage.skipped.map((item) => `${item.name}（${item.reason}）`).join("、")}</span>
      )}
    </li>
  );
}

function AppView({ detail }: { detail: TeamDetail }) {
  const { app } = detail;
  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>會友 App 應該顯示</h3></header>
      <div className="adm-card__body">
        <p className="adm-small adm-muted">用和會友 App 同一份規則算的；會友說「畫面不一樣」時拿來對照。</p>
        <dl className="adm-fields">
          <div className="adm-field"><dt>隊伍進度</dt><dd>
            <Bar value={app.progress} max={100} label={`隊伍平均進度 ${app.progress}%`} />
            平均 {app.progress}%（每人本遍讀的章數）
          </dd></div>
          <div className="adm-field"><dt>邀請碼</dt><dd>
            {app.invite}
            {app.inviteNote && <span className="adm-danger-text">{app.inviteNote}</span>}
          </dd></div>
          <div className="adm-field"><dt>帶隊按鈕</dt><dd>
            {app.carry.message && <span>{app.carry.message}</span>}
            {app.carry.stages.length > 0 && <ul className="adm-plain-list adm-team-carries">{app.carry.stages.map((stage) => <CarryStageView key={stage.planId} stage={stage} />)}</ul>}
          </dd></div>
        </dl>
      </div>
    </section>
  );
}

function Members({ detail, canPerson, personHref }: { detail: TeamDetail; canPerson: boolean; personHref: (userId: string) => string }) {
  return (
    <section className="adm-card">
      <header className="adm-card__header"><h3>成員</h3><span className="adm-muted">{detail.members.length} 人</span></header>
      <div className="adm-card__body">
        {detail.members.length === 0
          ? <p className="adm-muted">這支隊沒有成員。</p>
          : (
            <ul className="adm-team-members">
              {detail.members.map((member) => (
                <li key={member.id} className="adm-team-member">
                  <span className="adm-team-member__name">
                    {canPerson
                      ? <a className="adm-link" href={personHref(member.id)}>{text(member.name, "（未填姓名）")}</a>
                      : text(member.name, "（未填姓名）")}
                    <Badge tone={member.role === "captain" ? "brand" : "neutral"}>{member.roleLabel}</Badge>
                    {!member.active && <Badge tone="warning">帳號已停用</Badge>}
                  </span>
                  <span className="adm-team-member__meta">{member.unit || "未填牧區"}</span>
                  <span className="adm-team-member__meta">{formatDate(member.joinedAt)} 加入・{member.joinMethod.label}</span>
                  <span className="adm-team-member__progress">
                    <Badge tone={!member.enrolled ? "warning" : member.behindDays >= 7 ? "danger" : "neutral"}>{member.statusLabel}</Badge>
                    {member.enrolled && <span className="adm-muted adm-small">第 {member.round} 遍 {member.progress}%・累計 {member.chapters} 章</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function Collapsible({ icon, title, open, onToggle, children }: {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <section className="adm-card">
      <header className="adm-card__header">
        <button type="button" className="adm-team-toggle" aria-expanded={open} onClick={onToggle}>
          <Caret className="adm-icon adm-icon--small" aria-hidden="true" />
          {icon}
          <h3>{title}</h3>
        </button>
      </header>
      {open && <div className="adm-card__body">{children}</div>}
    </section>
  );
}

function HistoryView({ history, onReload }: { history: Loaded<TeamHistory>; onReload: () => void }) {
  const [engineering, setEngineering] = useState(false);
  if (history.error !== null) return <ErrorNotice error={history.error} action={<button type="button" className="adm-button" onClick={onReload}>重試</button>} />;
  if (!history.data) return <Spinner label="載入異動歷程…" />;
  const { events, recordsSince } = history.data;
  return (
    <>
      <div className="adm-row">
        <p className="adm-small adm-muted adm-team-history__since">
          {recordsSince ? `異動紀錄從 ${formatDateTime(recordsSince)} 開始，之前的加入、移出沒有紀錄。` : "還沒有任何異動紀錄。"}
        </p>
        <button type="button" className="adm-button adm-button--ghost" aria-pressed={engineering} onClick={() => setEngineering((value) => !value)}>
          <Code className="adm-icon adm-icon--small" aria-hidden="true" />{engineering ? "隱藏工程細節" : "顯示工程細節"}
        </button>
      </div>
      {events.length === 0
        ? <p className="adm-muted">這支隊在紀錄期間沒有異動。</p>
        : (
          <ol className="adm-team-history">
            {events.map((event) => (
              <li key={event.id} className="adm-team-history__item">
                <span className="adm-team-history__time">{formatDateTime(event.at)}</span>
                <span className="adm-team-history__text">{event.text}</span>
                <span className="adm-small adm-muted">誰做的：{event.actor}</span>
                {engineering && (
                  <div className="adm-small">
                    <span className="adm-muted">函式：</span>{event.engineering.functions.length > 0 ? event.engineering.functions.join(" ← ") : "（沒有經過函式，直接下 SQL）"}
                    <span className="adm-muted">・交易 </span>{text(event.engineering.txid)}
                    <span className="adm-muted">・資料庫角色 </span>{text(event.engineering.dbUser)}
                    {event.engineering.appName && <><span className="adm-muted">・連線 </span>{event.engineering.appName}</>}
                    {event.engineering.callContext && <pre className="adm-pre">{event.engineering.callContext}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
    </>
  );
}

function LineageView({ lineage, onReload }: { lineage: Loaded<TeamLineage>; onReload: () => void }) {
  if (lineage.error !== null) return <ErrorNotice error={lineage.error} action={<button type="button" className="adm-button" onClick={onReload}>重試</button>} />;
  if (!lineage.data) return <Spinner label="載入跨階段對應…" />;
  const { stages } = lineage.data;
  if (stages.length <= 1) return <p className="adm-muted">這支隊沒有從別的階段帶來，也沒有帶到下一階段。</p>;
  return (
    <>
      <p className="adm-small adm-muted">同名的隊在每個階段是不同的隊；帶隊只複製一次，之後兩邊各改各的。被略過的人是推斷的（帶隊結果沒有存下來）。</p>
      <ol className="adm-team-lineage">
        {stages.map((stage) => (
          <li key={stage.team.id} className={`adm-team-lineage__stage${stage.current ? " adm-team-lineage__stage--current" : ""}`}>
            <span className="adm-team-lineage__plan">{text(stage.plan.name, "未命名計畫")}</span>
            <span className="adm-small adm-muted">{formatDate(stage.plan.startDate)}–{formatDate(stage.plan.endDate)}</span>
            <span className="adm-team-lineage__team">
              {stage.current ? <strong>{text(stage.team.name, "未命名隊伍")}（這一隊）</strong>
                : <a className="adm-link" href={teamHref(stage.team.id, stage.plan.id)}>{text(stage.team.name, "未命名隊伍")}</a>}
              <span className="adm-muted adm-small">{stage.team.division} 人組・{stage.members.length} 人・{stage.team.statusLabel}</span>
            </span>
            <ul className="adm-plain-list adm-team-lineage__members">
              {stage.members.map((member) => (
                <li key={member.id}>
                  {member.name}{member.role === "captain" && <Badge tone="brand">隊長</Badge>}
                  {stage.added.some((item) => item.id === member.id) && <Badge>這一階段才加入</Badge>}
                </li>
              ))}
            </ul>
            {stage.removed.length > 0 && (
              <ul className="adm-plain-list adm-team-lineage__removed">
                {stage.removed.map((item) => (
                  <li key={item.id}>
                    <span className="adm-danger-text">少了 {item.name}</span>
                    <Badge tone="warning">推斷</Badge>
                    <span className="adm-small adm-muted">{item.inferred}</span>
                    {item.elsewhere && <a className="adm-link adm-small" href={teamHref(item.elsewhere.id, stage.plan.id)}>打開「{text(item.elsewhere.name, "那一隊")}」</a>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
