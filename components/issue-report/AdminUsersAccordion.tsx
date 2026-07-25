// components/issue-report/AdminUsersAccordion.tsx
import React from "react";
import { Users, ChevronDown, CheckCircle } from "lucide-react";

export const AdminUsersAccordion: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [totalCount, setTotalCount] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const countUsers = () => {
      const list = document.getElementById("admin-users-list");
      if (list) {
        const items = list.querySelectorAll(".member-list-item");
        setTotalCount(items.length);
        
        // Count users that are selected or hold special roles (e.g., admin, leaders)
        const badges = list.querySelectorAll(".role-badge-pill");
        let activeAdminCount = 0;
        badges.forEach(badge => {
          const text = badge.textContent?.trim();
          if (text === "系統管理員" || text === "小組長" || text === "大區長" || text === "牧區長") {
            activeAdminCount++;
          }
        });
        setSelectedCount(activeAdminCount);
      }
    };

    // Initial count
    countUsers();

    // Observe changes inside the user list container
    const observer = new MutationObserver(countUsers);
    const list = document.getElementById("admin-users-list");
    if (list) {
      observer.observe(list, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm transition-all duration-300">
      {/* Accordion Trigger Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-850/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors focus:outline-none"
        aria-expanded={isOpen}
        type="button"
      >
        <div className="flex items-center gap-2.5 text-slate-800 dark:text-zinc-200 text-sm font-semibold">
          <Users className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
          <span>人員名單 (已選取 {selectedCount}/{totalCount} 人) ── 點擊展開/修改</span>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedCount > 0 && <CheckCircle className="h-4 w-4 text-emerald-500" />}
          <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Accordion Content Wrapper (Max Height Scrollable Area) */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          isOpen 
            ? "max-h-[320px] opacity-100 border-t border-zinc-200 dark:border-zinc-800" 
            : "max-h-0 opacity-0 overflow-hidden pointer-events-none"
        }`}
      >
        <div className="p-4 bg-white dark:bg-zinc-900">
          <div 
            id="admin-users-list-scroll-area" 
            className="max-h-56 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {/* Target element populated by Vanilla JS modules/admin.js */}
            <div id="admin-users-list">
              <div className="text-center py-6 text-xs text-zinc-400 dark:text-zinc-500">
                載入中或名單為空...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
