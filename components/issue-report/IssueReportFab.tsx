// components/issue-report/IssueReportFab.tsx
import React from "react";
import { SupportFab } from "./SupportFab.tsx";
import { ReportDrawer } from "./ReportDrawer.tsx";
import { initOfflineReportSync } from "./IssueReportBlocks.ts";

export const IssueReportFab: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [defaultTab, setDefaultTab] = React.useState<"form" | "my-reports">("form");

  // Initialize offline sync on component mount
  React.useEffect(() => {
    initOfflineReportSync();
  }, []);

  return (
    <>
      <SupportFab isOpen={isOpen} onClick={() => { setDefaultTab("form"); setIsOpen(true); }} />
      <ReportDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} defaultTab={defaultTab} />
    </>
  );
};
