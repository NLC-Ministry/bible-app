import React from 'react';
import { createRoot } from 'react-dom/client';
import { IssueReportFab } from '../../components/issue-report/IssueReportFab.tsx';
import { AdminReportView } from '../../components/issue-report/AdminReportView.tsx';
import { AdminUsersAccordion } from '../../components/issue-report/AdminUsersAccordion.tsx';

let issueReportMounted = false;
let adminReportsMounted = false;
let adminUsersMounted = false;

function mountReactComponent(rootEl, Component) {
  const root = createRoot(rootEl);
  root.render(React.createElement(Component));
  return root;
}

export function mountIssueReportUi({ includeAdmin = false } = {}) {
  if (!issueReportMounted) {
    const reportRoot = document.getElementById("issue-report-root") || document.createElement("div");
    reportRoot.id = "issue-report-root";
    if (!reportRoot.parentNode) document.body.appendChild(reportRoot);
    mountReactComponent(reportRoot, IssueReportFab);
    issueReportMounted = true;
  }

  if (!includeAdmin) return;

  if (!adminReportsMounted) {
    const adminReportsRoot = document.getElementById("admin-reports-root");
    if (adminReportsRoot) {
      mountReactComponent(adminReportsRoot, AdminReportView);
      adminReportsMounted = true;
    }
  }

  if (!adminUsersMounted) {
    const adminUsersAccordionRoot = document.getElementById("admin-users-accordion-root");
    if (adminUsersAccordionRoot) {
      mountReactComponent(adminUsersAccordionRoot, AdminUsersAccordion);
      adminUsersMounted = true;
    }
  }
}
