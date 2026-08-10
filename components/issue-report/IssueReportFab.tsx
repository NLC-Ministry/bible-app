// components/issue-report/IssueReportFab.tsx
import React from "react";
import { SupportFab } from "./SupportFab.tsx";
import { ReportDrawer } from "./ReportDrawer.tsx";
import { initOfflineReportSync, FetchMyReportsPipeline, countUnseenReplies } from "./IssueReportBlocks.ts";

export const IssueReportFab: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [defaultTab, setDefaultTab] = React.useState<"form" | "my-reports">("form");
  const [unreadReplyCount, setUnreadReplyCount] = React.useState(0);

  const refreshUnreadCount = React.useCallback(() => {
    FetchMyReportsPipeline.execute().then(result => {
      if (result.success && Array.isArray(result.data)) {
        setUnreadReplyCount(countUnseenReplies(result.data));
      }
    }).catch(() => {});
  }, []);

  // Initialize offline sync on component mount
  React.useEffect(() => {
    initOfflineReportSync();
  }, []);

  // Check for unread replies on mount, and again whenever the tab regains
  // focus — an admin's reply won't otherwise be noticed until the next full
  // page load.
  React.useEffect(() => {
    refreshUnreadCount();
    window.addEventListener("focus", refreshUnreadCount);
    return () => window.removeEventListener("focus", refreshUnreadCount);
  }, [refreshUnreadCount]);

  return (
    <>
      <SupportFab
        isOpen={isOpen}
        unreadReplyCount={unreadReplyCount}
        onClick={() => { setDefaultTab("form"); setIsOpen(true); }}
      />
      <ReportDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        defaultTab={defaultTab}
        onReportsViewed={refreshUnreadCount}
      />
    </>
  );
};
