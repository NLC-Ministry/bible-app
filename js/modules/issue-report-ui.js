import React from 'react';
import { createRoot } from 'react-dom/client';
import { IssueReportFab } from '../../components/issue-report/IssueReportFab.tsx';

// 會友的回報按鈕。回報管理在管理後台的收件匣（#550、#551），會友 App 不再掛管理畫面。
let issueReportMounted = false;

function mountReactComponent(rootEl, Component) {
  const root = createRoot(rootEl);
  root.render(React.createElement(Component));
  return root;
}

export function mountIssueReportUi() {
  if (!issueReportMounted) {
    const reportRoot = document.getElementById("issue-report-root") || document.createElement("div");
    reportRoot.id = "issue-report-root";
    if (!reportRoot.parentNode) document.body.appendChild(reportRoot);
    mountReactComponent(reportRoot, IssueReportFab);
    issueReportMounted = true;
  }
}
