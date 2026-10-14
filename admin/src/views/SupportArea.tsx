// 客服區（#555、#550）：回報收件匣。電腦版左清單右對話、手機版一次只顯示一邊。
// 「查詢使用者」搬到「人」區（#567）；收件匣清單放在 App 那一層，從回報打開某人再回來不重抓。
import type { Dispatch, SetStateAction } from "react";
import { Inbox } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import { ReportInbox, type InboxState } from "./ReportInbox.tsx";

export type SupportRoute = Extract<AdminRoute, { view: "inbox" }>;

type Props = {
  api: AdminApi;
  route: SupportRoute;
  capabilities: readonly string[];
  inbox: InboxState;
  setInbox: Dispatch<SetStateAction<InboxState>>;
  doc: Document;
};

export function SupportArea({ api, route, capabilities, inbox, setInbox, doc }: Props) {
  const unread = inbox.counts?.unread ?? 0;
  return (
    <div className="adm-support-area">
      <nav className="adm-tabs adm-support-tabs" aria-label="客服">
        <a className="adm-tab adm-tab--active" href={formatRoute({ view: "inbox", reportId: null })} aria-current="page">
          <Inbox className="adm-icon" aria-hidden="true" />回報收件匣
          {unread > 0 && <span className="adm-tab__count" aria-label={`${unread} 張有新訊息`}>{unread}</span>}
        </a>
      </nav>
      <ReportInbox api={api} reportId={route.reportId} capabilities={capabilities} state={inbox} setState={setInbox} doc={doc} />
    </div>
  );
}
