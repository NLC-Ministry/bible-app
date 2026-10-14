// 個人頁（#555；#567 改成「需要時才調閱」）：會友回報問題時，在同一頁看到這個人的所有資料來除錯。
//
// 請求預算：打開只呼叫 1 次 user_summary（除錯檢查＋「會友 App 現在應該顯示」＋各區筆數，伺服器記一筆查看）；
// 各區摺疊、右邊先顯示筆數，點開才呼叫 user_section（第一頁伺服器記一筆 view_user_section），「載入更多」再往下抓；
// 時間軸點開才呼叫 user_timeline。筆數是 0 的區塊點開不打請求。
// 帳號、經文筆記（只有筆數與最後更新時間，內容屬於個人靈修，不顯示）、徽章（伺服器沒有資料）不打請求。
// 個資預設遮罩，按「顯示」才呼叫 reveal_pii（伺服器記稽核），換人或重新整理就消失。
// 查看理由：從回報、名單打開時帶在網址上；頁面上可以改，之後點開的區塊、顯示個資都用改過的理由。
// 第一階段只讀：修正動作（補發徽章、刪除沒有歸屬的打卡…）之後個別評估。
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, HelpCircle, RefreshCw, XCircle } from "lucide-react";
import type { AdminApi, AdminAction } from "../api.ts";
import { formatRoute } from "../route.ts";
import { PROVIDER_LABEL, SECTION_LABEL, formatDate, formatDateTime, label, text } from "../format.ts";
import { describeItem, usableCursor } from "../items.ts";
import type { AppPlanView, CheckLink, CheckStatus, Cursor, Page, PersonCheck, RevealedPii, SectionItem, SectionName, UserSummary } from "../types.ts";
import { Badge, Card, ErrorNotice, Field, Spinner } from "../ui.tsx";

// 各區「載入更多」一次幾筆
export const SECTION_PAGE_SIZE = 20;
export const TIMELINE_PAGE_SIZE = 30;

type ListKey = SectionName | "timeline";
type PanelKey = ListKey | "account" | "badges" | "notes";
type ListState = { items: SectionItem[]; cursor: Cursor | null; loading: boolean; error: unknown; loaded: boolean };

const EMPTY_LIST: ListState = { items: [], cursor: null, loading: false, error: null, loaded: false };

// 區塊順序同 #567 定案
const PANELS: readonly PanelKey[] = [
  "account", "plans", "badges", "vouchers", "reading_logs", "tests", "teams", "team_events", "notes", "reports", "notifications", "timeline"
];

const PANEL_LABEL: Record<PanelKey, string> = {
  ...(SECTION_LABEL as Record<SectionName, string>),
  account: "帳號",
  badges: "徽章",
  notes: "經文筆記",
  timeline: "時間軸"
};

const CHECK_STATUS: Record<CheckStatus, { label: string; tone: "neutral" | "brand" | "warning" | "danger"; Icon: typeof CheckCircle2 }> = {
  ok: { label: "正常", tone: "neutral", Icon: CheckCircle2 },
  warn: { label: "要注意", tone: "warning", Icon: AlertTriangle },
  fail: { label: "有問題", tone: "danger", Icon: XCircle },
  unknown: { label: "無法判斷", tone: "neutral", Icon: HelpCircle }
};

const PLAN_STATE_LABEL: Record<AppPlanView["plan"]["state"], string> = { upcoming: "還沒開始", running: "進行中", ended: "已結束" };

const isListKey = (key: PanelKey): key is ListKey => key !== "account" && key !== "badges" && key !== "notes";

type Props = {
  api: AdminApi;
  userId: string;
  reason: string;
  capabilities: readonly string[];
  /** 回名單的連結；沒有名單權限是 null */
  backHref: string | null;
};

export function UserDetail({ api, userId, reason: routeReason, capabilities, backHref }: Props) {
  const [summary, setSummary] = useState<UserSummary | null>(() => api.peek<UserSummary>("user_summary", { user_id: userId }) ?? null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reason, setReason] = useState(routeReason);
  const [open, setOpen] = useState<ReadonlySet<PanelKey>>(() => new Set());
  const [lists, setLists] = useState<Partial<Record<ListKey, ListState>>>({});
  const [revealed, setRevealed] = useState<RevealedPii | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<unknown>(null);

  // 換人：清掉上一個人的區塊、顯示中的個資，理由換成網址上的
  useEffect(() => {
    setOpen(new Set());
    setLists({});
    setRevealed(null);
    setRevealError(null);
    setReason(routeReason);
  }, [userId, routeReason]);

  useEffect(() => {
    let active = true;
    setError(null);
    const cached = reloadKey === 0 ? api.peek<UserSummary>("user_summary", { user_id: userId }) : undefined;
    if (cached) {
      setSummary(cached);
      return undefined;
    }
    setSummary(null);
    api.call<UserSummary>("user_summary", { user_id: userId, reason: routeReason }, { fresh: reloadKey > 0 })
      .then((data) => { if (active) setSummary(data); })
      .catch((err) => { if (active) setError(err); });
    return () => { active = false; };
    // 查看理由只在打開時送一次（記進稽核），之後改理由不重抓
  }, [api, userId, reloadKey]);

  const fetchList = useCallback((key: ListKey, cursor: Cursor | null) => {
    setLists((prev) => ({ ...prev, [key]: { ...(prev[key] || EMPTY_LIST), loading: true, error: null } }));
    const action: AdminAction = key === "timeline" ? "user_timeline" : "user_section";
    const params: Record<string, unknown> = { user_id: userId, limit: key === "timeline" ? TIMELINE_PAGE_SIZE : SECTION_PAGE_SIZE };
    if (key !== "timeline") params.section = key;
    if (cursor) params.cursor = cursor;
    if (reason.trim()) params.reason = reason.trim();
    api.call<Page>(action, params)
      .then((page) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        setLists((prev) => ({
          ...prev,
          [key]: { items: cursor ? [...(prev[key]?.items || []), ...items] : items, cursor: usableCursor(page?.next_cursor), loading: false, error: null, loaded: true }
        }));
      })
      .catch((err) => setLists((prev) => ({ ...prev, [key]: { ...(prev[key] || EMPTY_LIST), loading: false, error: err, loaded: true } })));
  }, [api, userId, reason]);

  const reload = () => {
    api.invalidate(["user_section", "user_timeline"]);
    setOpen(new Set());
    setLists({});
    setRevealed(null);
    setReloadKey((n) => n + 1);
  };

  const reveal = () => {
    setRevealing(true);
    setRevealError(null);
    api.call<RevealedPii>("reveal_pii", { user_id: userId, reason: reason.trim() })
      .then((data) => setRevealed(data))
      .catch((err) => setRevealError(err))
      .finally(() => setRevealing(false));
  };

  const back = backHref && (
    <a className="adm-back adm-back--always" href={backHref}>
      <ChevronLeft className="adm-icon" aria-hidden="true" />回到名單
    </a>
  );

  if (error) {
    return (
      <div className="adm-detail">
        {back}
        <ErrorNotice error={error} action={<button type="button" className="adm-button" onClick={() => setReloadKey((n) => n + 1)}>重試</button>} />
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="adm-detail">
        {back}
        <Spinner label="載入使用者資料…" />
      </div>
    );
  }

  const { account } = summary;
  const canTeams = capabilities.includes("plans.read");
  const canReveal = capabilities.includes("support.pii")
    && (account.has_email || account.has_phone || summary.identities.length > 0);
  const counts = summary.counts || ({} as UserSummary["counts"]);
  const countOf = (key: PanelKey): number | null => {
    if (key === "account" || key === "badges" || key === "timeline") return null;
    if (key === "notes") return (Number(summary.notes?.verse_notes) || 0) + (Number(summary.notes?.devotional_notes) || 0);
    return Number(counts[key]) || 0;
  };
  const toggle = (key: PanelKey) => {
    const opening = !open.has(key);
    setOpen((prev) => {
      const next = new Set(prev);
      if (opening) next.add(key); else next.delete(key);
      return next;
    });
    if (opening && isListKey(key) && !lists[key]?.loaded && !lists[key]?.loading && countOf(key) !== 0) fetchList(key, null);
  };
  const personName = text(account.name, "（未填姓名）");

  return (
    <div className="adm-detail adm-person">
      {back}
      <header className="adm-detail__header">
        <div className="adm-person__title">
          <h2>{personName}</h2>
          <button type="button" className="adm-icon-button" onClick={reload} aria-label="重新整理" title="重新整理（重新檢查、收起所有區塊）">
            <RefreshCw className="adm-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="adm-badges">
          <Badge tone={account.role_code === "member" ? "neutral" : "brand"}>{text(account.role_label, account.role_code)}</Badge>
          {account.is_active === false && <Badge tone="warning">已停用</Badge>}
        </div>
        <label className="adm-label" htmlFor="adm-person-reason">查看理由（會記在稽核紀錄；之後點開的區塊、顯示個資都用這個理由）</label>
        <input
          id="adm-person-reason"
          className="adm-input adm-person__reason"
          type="text"
          autoComplete="off"
          placeholder="例如：因回報 #123"
          value={reason}
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
        />
        {capabilities.includes("audit.read") && (
          <p className="adm-small">
            <a className="adm-link" href={formatRoute({ view: "audit", actorId: null, targetId: userId })}>管理員對這個人做過的操作（稽核紀錄）</a>
            {account.role_code !== "member" && (
              <> ・ <a className="adm-link" href={formatRoute({ view: "audit", actorId: userId, targetId: null })}>這個人做過的管理操作</a></>
            )}
          </p>
        )}
      </header>

      <div className="adm-grid">
        <ChecksCard checks={Array.isArray(summary.checks) ? summary.checks : []} canTeams={canTeams} personName={personName} />
        <AppPlansCard plans={Array.isArray(summary.app_plans) ? summary.app_plans : []} canTeams={canTeams} />
      </div>

      <div className="adm-panels">
        {PANELS.map((key) => {
          const count = countOf(key);
          const expanded = open.has(key);
          const bodyId = `adm-panel-${key}`;
          return (
            <section key={key} className={`adm-panel${expanded ? " adm-panel--open" : ""}`}>
              <h3 className="adm-panel__heading">
                <button type="button" className="adm-panel__toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => toggle(key)}>
                  {expanded ? <ChevronDown className="adm-icon" aria-hidden="true" /> : <ChevronRight className="adm-icon" aria-hidden="true" />}
                  <span className="adm-panel__label">{PANEL_LABEL[key]}</span>
                  <span className="adm-panel__count">{panelMeta(key, count, summary)}</span>
                </button>
              </h3>
              {expanded && (
                <div className="adm-panel__body" id={bodyId}>
                  {key === "account" && (
                    <AccountPanel
                      summary={summary}
                      revealed={revealed}
                      revealError={revealError}
                      revealControl={canReveal ? (
                        <button
                          type="button"
                          className="adm-button adm-button--ghost"
                          onClick={revealed ? () => setRevealed(null) : reveal}
                          disabled={revealing}
                          aria-pressed={revealed !== null}
                        >
                          {revealed ? <EyeOff className="adm-icon" aria-hidden="true" /> : <Eye className="adm-icon" aria-hidden="true" />}
                          {revealed ? "隱藏 email／電話" : revealing ? "顯示中…" : "顯示 email／電話"}
                        </button>
                      ) : null}
                    />
                  )}
                  {key === "badges" && (
                    <p className="adm-muted">
                      徽章只存在會友手機裡的 App（瀏覽器的儲存空間），伺服器沒有這份資料，後台看不到。需要時請會友截圖徽章頁。
                    </p>
                  )}
                  {key === "notes" && (
                    <dl className="adm-fields">
                      <Field name="經文筆記">{Number(summary.notes?.verse_notes) || 0} 則</Field>
                      <Field name="靈修筆記">{Number(summary.notes?.devotional_notes) || 0} 則</Field>
                      <Field name="最後更新">{formatDateTime(summary.notes?.last_updated_at)}</Field>
                      <Field name="內容">屬於個人靈修，後台不顯示。</Field>
                    </dl>
                  )}
                  {key === "reading_logs" && (
                    <p className="adm-muted adm-small">打卡紀錄沒有記下是手動打卡還是讀到底自動打卡，這裡分不出來。</p>
                  )}
                  {isListKey(key) && (
                    count === 0
                      ? <p className="adm-muted">沒有{PANEL_LABEL[key]}。</p>
                      : <ItemList
                          state={lists[key] || null}
                          total={count}
                          emptyText={key === "timeline" ? "沒有任何紀錄。" : `沒有${PANEL_LABEL[key]}。`}
                          onMore={() => fetchList(key, lists[key]?.cursor ?? null)}
                          showSection={key === "timeline"}
                          teamLinks={canTeams}
                          today={summary.today}
                        />
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 區塊標題右邊：筆數；兌換券多列各狀態；沒有筆數的區塊給一句說明 */
function panelMeta(key: PanelKey, count: number | null, summary: UserSummary): string {
  if (key === "account") return `${summary.identities.length} 種登入方式`;
  if (key === "badges") return "後台看不到";
  if (key === "timeline") return "全部紀錄依時間排";
  if (key === "notes") return `${count ?? 0} 則（不顯示內容）`;
  if (key === "vouchers" && count) {
    const states = summary.voucher_states;
    const parts = states
      ? [["未兌換", states.unredeemed], ["已兌換", states.redeemed], ["已過期", states.expired], ["已作廢", states.voided]]
        .filter(([, value]) => Number(value) > 0)
        .map(([name, value]) => `${name} ${value}`)
      : [];
    return parts.length ? `${count} 筆（${parts.join("・")}）` : `${count} 筆`;
  }
  return `${count ?? 0} 筆`;
}

function ChecksCard({ checks, canTeams, personName }: { checks: readonly PersonCheck[]; canTeams: boolean; personName: string }) {
  const problems = checks.filter((check) => check.status === "fail" || check.status === "warn").length;
  return (
    <Card title={problems ? `除錯檢查（${problems} 項要看）` : "除錯檢查"}>
      <ul className="adm-checks">
        {checks.map((check) => {
          const status = CHECK_STATUS[check.status] || CHECK_STATUS.unknown;
          const flagged = check.status === "fail" || check.status === "warn";
          return (
            <li key={check.id} className={`adm-check adm-check--${check.status}`}>
              <div className="adm-check__head">
                <status.Icon className="adm-icon adm-check__icon" aria-hidden="true" />
                <span className="adm-check__label">{check.label}</span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <p className="adm-small">{check.summary}</p>
              {check.details.length > 0 && (flagged || check.id === "app_version") && (
                <ul className="adm-check__details adm-small">
                  {check.details.map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              )}
              {flagged && check.impact && <p className="adm-small"><span className="adm-muted">影響：</span>{check.impact}</p>}
              {flagged && check.fix && <p className="adm-small"><span className="adm-muted">處理：</span>{check.fix}</p>}
              {Array.isArray(check.links) && check.links.length > 0 && (
                <p className="adm-small adm-check__links">
                  {check.links.map((link, index) => (
                    <span key={`${link.kind}-${link.id}`}>{index > 0 && "、"}<CheckLinkView link={link} canTeams={canTeams} personName={personName} /></span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CheckLinkView({ link, canTeams, personName }: { link: CheckLink; canTeams: boolean; personName: string }) {
  if (link.kind === "user") {
    return <a className="adm-link" href={formatRoute({ view: "user", userId: link.id, reason: `從${personName}的除錯檢查查看` })}>{link.label}</a>;
  }
  if (!canTeams) return <span>{link.label}</span>;
  return <a className="adm-link" href={formatRoute({ view: "plans", tab: "teams", planId: link.plan_id ?? null, teamId: link.id })}>{link.label}</a>;
}

function AppPlansCard({ plans, canTeams }: { plans: readonly AppPlanView[]; canTeams: boolean }) {
  return (
    <Card title="會友 App 現在應該顯示">
      <p className="adm-muted adm-small">用和 App、計畫名單同一份規則算出來的，拿來和會友的截圖對照。</p>
      {plans.length === 0
        ? <p className="adm-muted">沒有可以對照的教會計畫。</p>
        : (
          <ul className="adm-plan-list">
            {plans.map((row) => (
              <li key={row.plan.id} className="adm-plan">
                <div className="adm-plan__title">
                  {canTeams
                    ? <a className="adm-link" href={formatRoute({ view: "plans", tab: "roster", planId: row.plan.id })}>{text(row.plan.name, "（未命名計畫）")}</a>
                    : <span>{text(row.plan.name, "（未命名計畫）")}</span>}
                  <Badge>{PLAN_STATE_LABEL[row.plan.state] || row.plan.state}</Badge>
                </div>
                <p className="adm-muted adm-small">
                  {formatDate(row.plan.start_date)} – {formatDate(row.plan.end_date)}
                  {row.plan.state === "running" && row.plan.total_days > 0 ? `・第 ${row.plan.expected_days}／${row.plan.total_days} 天` : ""}
                </p>
                <AppPlanStatus row={row} />
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function AppPlanStatus({ row }: { row: AppPlanView }) {
  if (!row.account_active || !row.shown) {
    return <p className="adm-small"><Badge tone="warning">帳號已停用</Badge> App 進不去，計畫名單也不會列出這個人。</p>;
  }
  if (!row.enrolled) return <p className="adm-small"><Badge>未報名</Badge> App 會顯示報名畫面。</p>;
  const teams = row.teams.map((team) => `${text(team.name, "未命名隊伍")}${team.captain ? "（隊長）" : ""}`).join("、");
  return (
    <>
      <p className="adm-person__progress">第 {row.round} 遍・{row.progress}%・{text(row.status_label)}</p>
      <dl className="adm-fields adm-fields--compact">
        <Field name="已讀">{row.chapters} 章</Field>
        <Field name="最後打卡">
          {row.last_read_at ? `${formatDateTime(row.last_read_at)}${row.days_since_read !== null ? `（${row.days_since_read} 天前）` : ""}` : "還沒打卡"}
        </Field>
        <Field name="近 7 天">打卡 {row.read_days_7} 天</Field>
        {row.care && <Field name="需要關心">{row.care_reasons.join("、") || "是"}</Field>}
        <Field name="團隊">{teams || "未組隊（個人速讀中）"}</Field>
      </dl>
    </>
  );
}

function AccountPanel({ summary, revealed, revealControl, revealError }: {
  summary: UserSummary;
  revealed: RevealedPii | null;
  revealControl: React.ReactNode;
  revealError: unknown;
}) {
  const { account, org, member_hub: hub } = summary;
  const managed = [account.managed_regions, account.managed_zones, account.managed_groups].map((value) => text(value, "")).filter(Boolean);
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
          {managed.length > 0 && <Field name="管理範圍">{managed.join("／")}</Field>}
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
    </div>
  );
}

function ItemList({ state, total, emptyText, onMore, showSection = false, teamLinks = false, today = null }: {
  state: ListState | null;
  total: number | null;
  emptyText: string;
  onMore: () => void;
  showSection?: boolean;
  /** 有 plans.read：團隊、團隊異動可以點進隊伍頁（#566），計畫報名點進計畫名單 */
  teamLinks?: boolean;
  today?: string | null;
}) {
  if (!state || (!state.loaded && state.loading)) return <Spinner label="載入中…" />;
  return (
    <div className="adm-items">
      {total !== null && state.items.length > 0 && <p className="adm-muted adm-small">共 {total} 筆，已顯示 {state.items.length} 筆</p>}
      {state.items.length === 0 && !state.loading && state.error === null
        ? <p className="adm-muted">{emptyText}</p>
        : (
          <ol className="adm-item-list">
            {state.items.map((item) => {
              const view = describeItem(item, { teamLinks, today });
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
