// 客服區（#555、#550）：上面兩個分頁「回報收件匣」「查詢使用者」；各自是電腦版左清單右內容、
// 手機版一次只顯示一邊。
// 收件匣清單與搜尋框的內容都放在這一層，切分頁、打開某人／某張回報再回來時都還在，不重抓。
import { useState } from "react";
import { Inbox, Search } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import { INITIAL_INBOX, ReportInbox, type InboxState } from "./ReportInbox.tsx";
import { UserDetail } from "./UserDetail.tsx";
import { UserSearch, type SearchState } from "./UserSearch.tsx";

export type SupportRoute = Extract<AdminRoute, { view: "inbox" } | { view: "search" } | { view: "user" }>;

type Props = {
  api: AdminApi;
  route: SupportRoute;
  capabilities: readonly string[];
  doc: Document;
};

export function SupportArea({ api, route, capabilities, doc }: Props) {
  const [search, setSearch] = useState<SearchState>(() => ({
    query: "",
    reason: route.view === "user" ? route.reason : ""
  }));
  const [inbox, setInbox] = useState<InboxState>(INITIAL_INBOX);
  const inboxView = route.view === "inbox";
  const unread = inbox.counts?.unread ?? 0;

  return (
    <div className="adm-support-area">
      <nav className="adm-tabs adm-support-tabs" aria-label="客服">
        <a
          className={`adm-tab${inboxView ? " adm-tab--active" : ""}`}
          href={formatRoute({ view: "inbox", reportId: null })}
          aria-current={inboxView ? "page" : undefined}
        >
          <Inbox className="adm-icon" aria-hidden="true" />回報收件匣
          {unread > 0 && <span className="adm-tab__count" aria-label={`${unread} 張有新訊息`}>{unread}</span>}
        </a>
        <a
          className={`adm-tab${inboxView ? "" : " adm-tab--active"}`}
          href={formatRoute({ view: "search" })}
          aria-current={inboxView ? undefined : "page"}
        >
          <Search className="adm-icon" aria-hidden="true" />查詢使用者
        </a>
      </nav>
      {route.view === "inbox"
        ? <ReportInbox api={api} reportId={route.reportId} capabilities={capabilities} state={inbox} setState={setInbox} doc={doc} />
        : (
          <div className={`adm-support${route.view === "user" ? " adm-support--user-open" : ""}`}>
            <div className="adm-support__search">
              <UserSearch api={api} state={search} onChange={setSearch} selectedUserId={route.view === "user" ? route.userId : null} canTeams={capabilities.includes("plans.read")} />
            </div>
            <div className="adm-support__detail">
              {route.view === "user"
                ? <UserDetail api={api} userId={route.userId} tab={route.tab} reason={route.reason} capabilities={capabilities} />
                : <p className="adm-muted adm-empty">搜尋姓名或 email，點選結果查看這個人的資料。</p>}
            </div>
          </div>
        )}
    </div>
  );
}
