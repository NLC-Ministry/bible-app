// 打開某個人（#555）：摘要＋各區塊分頁往下載＋時間軸。
//
// 請求預算：打開只呼叫 1 次 user_summary（摘要裡已經有各區塊最新 5 筆和總數）；
// 「載入更多」才呼叫 user_section，切到「時間軸」才呼叫 user_timeline。
// 個資預設遮罩，按「顯示」才呼叫 reveal_pii（伺服器記稽核），換人或重新整理就消失。
import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatRoute, isUuid, USER_TABS, type UserTab } from "../route.ts";
import { PROVIDER_LABEL, SECTION_LABEL, formatDate, formatDateTime, label, text } from "../format.ts";
import { cursorAfter, describeItem, usableCursor } from "../items.ts";
import type { Cursor, Page, PlanSummary, RevealedPii, SectionItem, SectionName, UserSummary } from "../types.ts";
import { Badge, Card, ErrorNotice, Field, Spinner } from "../ui.tsx";

// 讀經紀錄等區塊「載入更多」一次幾筆（待維護者確認預設筆數，見 #555）
export const SECTION_PAGE_SIZE = 20;
export const TIMELINE_PAGE_SIZE = 30;

const TAB_LABEL: Record<UserTab, string> = {
  overview: "概覽",
  reading_logs: SECTION_LABEL.reading_logs,
  team_events: SECTION_LABEL.team_events,
  tests: SECTION_LABEL.tests,
  vouchers: SECTION_LABEL.vouchers,
  reports: SECTION_LABEL.reports,
  timeline: "時間軸"
};

type ListState = { items: SectionItem[]; cursor: Cursor | null; loading: boolean; error: unknown };

type Props = {
  api: AdminApi;
  userId: string;
  tab: UserTab;
  reason: string;
  capabilities: readonly string[];
};

function initialSection(summary: UserSummary, section: SectionName): ListState {
  const items = Array.isArray(summary.latest?.[section]) ? summary.latest[section] : [];
  const total = Number(summary.counts?.[section]) || 0;
  return { items, cursor: items.length < total ? cursorAfter(items) : null, loading: false, error: null };
}

export function UserDetail({ api, userId, tab, reason, capabilities }: Props) {
  const [summary, setSummary] = useState<UserSummary | null>(() => api.peek<UserSummary>("user_summary", { user_id: userId }) ?? null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sections, setSections] = useState<Partial<Record<SectionName, ListState>>>({});
  const [timeline, setTimeline] = useState<ListState & { loaded: boolean }>({ items: [], cursor: null, loading: false, error: null, loaded: false });
  const [revealed, setRevealed] = useState<RevealedPii | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<unknown>(null);

  // 換人：清掉上一個人的分頁、時間軸、顯示中的個資
  useEffect(() => {
    setSections({});
    setTimeline({ items: [], cursor: null, loading: false, error: null, loaded: false });
    setRevealed(null);
    setRevealError(null);
  }, [userId]);

  useEffect(() => {
    let active = true;
    setError(null);
    const cached = reloadKey === 0 ? api.peek<UserSummary>("user_summary", { user_id: userId }) : undefined;
    if (cached) {
      setSummary(cached);
      return undefined;
    }
    setSummary(null);
    api.call<UserSummary>("user_summary", { user_id: userId, reason }, { fresh: reloadKey > 0 })
      .then((data) => { if (active) setSummary(data); })
      .catch((err) => { if (active) setError(err); });
    return () => { active = false; };
    // 查看理由只在打開時送一次（記進稽核），之後改網址上的理由不重抓
  }, [api, userId, reloadKey]);

  const sectionState = useCallback((section: SectionName): ListState | null => {
    if (!summary) return null;
    return sections[section] || initialSection(summary, section);
  }, [sections, summary]);

  const loadMore = useCallback((section: SectionName) => {
    const current = sectionState(section);
    if (!current || !current.cursor || current.loading) return;
    setSections((prev) => ({ ...prev, [section]: { ...current, loading: true, error: null } }));
    api.call<Page>("user_section", { user_id: userId, section, cursor: current.cursor, limit: SECTION_PAGE_SIZE })
      .then((page) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        setSections((prev) => ({
          ...prev,
          [section]: { items: [...current.items, ...items], cursor: usableCursor(page?.next_cursor), loading: false, error: null }
        }));
      })
      .catch((err) => {
        setSections((prev) => ({ ...prev, [section]: { ...current, loading: false, error: err } }));
      });
  }, [api, sectionState, userId]);

  const loadTimeline = useCallback((cursor: Cursor | null) => {
    setTimeline((prev) => ({ ...prev, loading: true, error: null }));
    const params: Record<string, unknown> = { user_id: userId, limit: TIMELINE_PAGE_SIZE };
    if (cursor) params.cursor = cursor;
    api.call<Page>("user_timeline", params)
      .then((page) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        setTimeline((prev) => ({
          items: cursor ? [...prev.items, ...items] : items,
          cursor: usableCursor(page?.next_cursor),
          loading: false,
          error: null,
          loaded: true
        }));
      })
      .catch((err) => setTimeline((prev) => ({ ...prev, loading: false, error: err, loaded: true })));
  }, [api, userId]);

  useEffect(() => {
    if (tab === "timeline" && summary && !timeline.loaded && !timeline.loading) loadTimeline(null);
  }, [tab, summary, timeline.loaded, timeline.loading, loadTimeline]);

  const reveal = () => {
    setRevealing(true);
    setRevealError(null);
    api.call<RevealedPii>("reveal_pii", { user_id: userId, reason })
      .then((data) => setRevealed(data))
      .catch((err) => setRevealError(err))
      .finally(() => setRevealing(false));
  };

  if (error) {
    return (
      <div className="adm-detail">
        <BackLink />
        <ErrorNotice
          error={error}
          action={<button type="button" className="adm-button" onClick={() => setReloadKey((n) => n + 1)}>重試</button>}
        />
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="adm-detail">
        <BackLink />
        <Spinner label="載入使用者資料…" />
      </div>
    );
  }

  const { account } = summary;
  const canTeams = capabilities.includes("plans.read");
  const canReveal = capabilities.includes("support.pii")
    && (account.has_email || account.has_phone || summary.identities.length > 0);

  return (
    <div className="adm-detail">
      <BackLink />
      <header className="adm-detail__header">
        <h2>{text(account.name, "（未填姓名）")}</h2>
        <div className="adm-badges">
          <Badge tone={account.role_code === "member" ? "neutral" : "brand"}>{text(account.role_label, account.role_code)}</Badge>
          {account.is_active === false && <Badge tone="warning">已停用</Badge>}
        </div>
        {reason && <p className="adm-muted adm-small">查看理由：{reason}</p>}
        {capabilities.includes("audit.read") && (
          <p className="adm-small">
            <a className="adm-link" href={formatRoute({ view: "audit", actorId: null, targetId: userId })}>管理員對這個人做過的操作（稽核紀錄）</a>
            {account.role_code !== "member" && (
              <> ・ <a className="adm-link" href={formatRoute({ view: "audit", actorId: userId, targetId: null })}>這個人做過的管理操作</a></>
            )}
          </p>
        )}
      </header>

      <nav className="adm-tabs" aria-label="使用者資料分頁">
        {USER_TABS.map((name) => {
          const count = name !== "overview" && name !== "timeline" ? Number(summary.counts?.[name as SectionName]) || 0 : null;
          return (
            <a
              key={name}
              className={`adm-tab${tab === name ? " adm-tab--active" : ""}`}
              href={formatRoute({ view: "user", userId, tab: name, reason })}
              aria-current={tab === name ? "page" : undefined}
            >
              {TAB_LABEL[name]}
              {count !== null && <span className="adm-tab__count">{count}</span>}
            </a>
          );
        })}
      </nav>

      {tab === "overview" && (
        <Overview
          summary={summary}
          revealed={revealed}
          revealControl={canReveal ? (
            <button
              type="button"
              className="adm-button adm-button--ghost"
              onClick={revealed ? () => setRevealed(null) : reveal}
              disabled={revealing}
              aria-pressed={revealed !== null}
            >
              {revealed ? <EyeOff className="adm-icon" aria-hidden="true" /> : <Eye className="adm-icon" aria-hidden="true" />}
              {revealed ? "隱藏" : revealing ? "顯示中…" : "顯示"}
            </button>
          ) : null}
          revealError={revealError}
          canTeams={canTeams}
        />
      )}

      {tab !== "overview" && tab !== "timeline" && (
        <ItemList
          state={sectionState(tab as SectionName)}
          total={Number(summary.counts?.[tab as SectionName]) || 0}
          emptyText={`沒有${TAB_LABEL[tab]}。`}
          onMore={() => loadMore(tab as SectionName)}
          teamLinks={canTeams}
        />
      )}

      {tab === "timeline" && (
        timeline.loaded || timeline.loading
          ? <ItemList
              state={timeline}
              total={null}
              emptyText="沒有任何紀錄。"
              showSection
              teamLinks={canTeams}
              onMore={() => loadTimeline(timeline.cursor)}
            />
          : <Spinner label="載入時間軸…" />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <a className="adm-back" href={formatRoute({ view: "search" })}>
      <ChevronLeft className="adm-icon" aria-hidden="true" />回到搜尋
    </a>
  );
}

function Overview({ summary, revealed, revealControl, revealError, canTeams }: {
  summary: UserSummary;
  revealed: RevealedPii | null;
  revealControl: React.ReactNode;
  revealError: unknown;
  canTeams: boolean;
}) {
  const { account, org, member_hub: hub } = summary;
  return (
    <div className="adm-grid">
      <Card title="帳號" actions={revealControl}>
        {revealError !== null && <ErrorNotice error={revealError} />}
        <dl className="adm-fields">
          <Field name="Email">{revealed ? text(revealed.email, "沒有 email") : text(account.email_masked, "沒有 email")}</Field>
          <Field name="電話">{revealed ? text(revealed.phone, "沒有電話") : text(account.phone_masked, "沒有電話")}</Field>
          <Field name="建立時間">{formatDateTime(account.created_at)}</Field>
          <Field name="最近使用">{formatDateTime(account.last_seen_at)}</Field>
          <Field name="Member Hub 會員">{account.has_member_hub_id ? "已連結" : "未連結"}</Field>
        </dl>
        <h4 className="adm-subheading">登入方式</h4>
        {summary.identities.length === 0
          ? <p className="adm-muted">沒有登入紀錄。</p>
          : (
            <ul className="adm-plain-list">
              {summary.identities.map((identity, index) => {
                const full = revealed?.identities?.[index];
                return (
                  <li key={`${identity.provider}-${index}`}>
                    <span>{label(PROVIDER_LABEL, identity.provider)}</span>
                    {identity.is_primary && <Badge>主要</Badge>}
                    <span className="adm-muted">{full ? text(full.email, "沒有 email") : text(identity.email_masked, "沒有 email")}</span>
                    <span className="adm-muted adm-small">最近：{formatDateTime(identity.last_seen_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      <Card title="牧養歸屬">
        <dl className="adm-fields">
          <Field name="大區">{text(org.great_region)}</Field>
          <Field name="牧區">{text(org.pastoral_zone)}</Field>
          <Field name="小組">{text(org.small_group)}</Field>
          <Field name="Member Hub 同步">{text(hub.sync_status)}（{formatDateTime(hub.synced_at)}）</Field>
          {hub.sync_error && <Field name="同步錯誤">{text(hub.sync_error)}</Field>}
          <Field name="會籍狀態">{text(hub.membership_lifecycle_state)}</Field>
          <Field name="歸屬狀態">{text(hub.placement_state)}</Field>
          {hub.required_action && <Field name="待處理">{text(hub.required_action)}</Field>}
          {hub.leadership_display_label && <Field name="職務">{text(hub.leadership_display_label)}</Field>}
        </dl>
      </Card>

      <Card title={`參加的計畫（${summary.plans.length}）`}>
        {summary.plans.length === 0
          ? <p className="adm-muted">沒有參加任何計畫。</p>
          : <ul className="adm-plan-list">{summary.plans.map((plan) => <PlanRow key={plan.plan_id} plan={plan} canTeams={canTeams} />)}</ul>}
      </Card>
    </div>
  );
}

function PlanRow({ plan, canTeams }: { plan: PlanSummary; canTeams: boolean }) {
  const start = plan.church_start_date || plan.start_date;
  const end = plan.church_end_date || plan.end_date;
  return (
    <li className="adm-plan">
      <div className="adm-plan__title">
        <span>{text(plan.name, "（未命名計畫）")}</span>
        {plan.is_personal && <Badge>個人計畫</Badge>}
      </div>
      <p className="adm-muted adm-small">{formatDate(start)} – {formatDate(end)}・目前第 {text(plan.current_round, "1")} 遍</p>
      <dl className="adm-fields adm-fields--compact">
        <Field name="第一遍已讀">{plan.round1_chapters} 章</Field>
        <Field name="本遍已讀">{plan.current_round_chapters} 章</Field>
        <Field name="全部紀錄">{plan.logged_chapters} 章</Field>
        <Field name="最後閱讀">{formatDateTime(plan.last_read_at)}</Field>
        {plan.grace_days ? <Field name="打卡寬限">{plan.grace_days} 天</Field> : null}
        {plan.teams.length > 0 && (
          <Field name="團隊">
            {plan.teams.map((team, index) => (
              <span key={team.team_id}>
                {index > 0 && "、"}
                {canTeams && isUuid(team.team_id)
                  ? <a className="adm-link" href={formatRoute({ view: "plans", tab: "teams", planId: plan.global_plan_id, teamId: team.team_id })}>{text(team.name)}</a>
                  : text(team.name)}
                {team.is_captain ? "（隊長）" : ""}
              </span>
            ))}
          </Field>
        )}
      </dl>
    </li>
  );
}

function ItemList({ state, total, emptyText, onMore, showSection = false, teamLinks = false }: {
  state: ListState | null;
  total: number | null;
  emptyText: string;
  onMore: () => void;
  showSection?: boolean;
  /** 有 plans.read：團隊異動可以點進隊伍頁（#566） */
  teamLinks?: boolean;
}) {
  if (!state) return null;
  return (
    <div className="adm-items">
      {total !== null && <p className="adm-muted adm-small">共 {total} 筆，已顯示 {state.items.length} 筆</p>}
      {state.items.length === 0 && !state.loading && state.error === null
        ? <p className="adm-muted">{emptyText}</p>
        : (
          <ol className="adm-item-list">
            {state.items.map((item) => {
              const view = describeItem(item, { teamLinks });
              return (
                <li key={`${item.section}-${item.id}`} className="adm-item">
                  <div className="adm-item__head">
                    {showSection && <Badge>{label(SECTION_LABEL, item.section)}</Badge>}
                    {view.href
                      ? <a className="adm-item__title adm-link" href={view.href}>{view.title}</a>
                      : <span className="adm-item__title">{view.title}</span>}
                    <time className="adm-muted adm-small">{view.when}</time>
                  </div>
                  {view.details.length > 0 && <p className="adm-muted adm-small">{view.details.join("・")}</p>}
                </li>
              );
            })}
          </ol>
        )}
      {state.error !== null && <ErrorNotice error={state.error} />}
      {state.loading && <Spinner label="載入中…" />}
      {!state.loading && state.cursor && (
        <button type="button" className="adm-button" onClick={onMore}>載入更多</button>
      )}
    </div>
  );
}
