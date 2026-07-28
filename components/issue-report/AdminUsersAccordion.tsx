// components/issue-report/AdminUsersAccordion.tsx
import React from "react";
import { Users, ChevronDown, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

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
    // The admin module can load before or after this React mount. Re-run its
    // initializer here so the restored host always receives data and handlers.
    const adminWindow = window as typeof window & {
      initAdminUserManagement?: () => void;
      renderAdminUserManagement?: () => Promise<void>;
    };
    adminWindow.initAdminUserManagement?.();
    void adminWindow.renderAdminUserManagement?.();

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
    <div 
      className="w-full border border-border/50 rounded-xl overflow-hidden shadow-sm bg-card text-card-foreground transition-all duration-300"
    >
      {/* Accordion Trigger Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors focus:outline-none"
        style={{ 
          borderBottom: isOpen ? "1px solid var(--border-card)" : "none"
        }}
        aria-expanded={isOpen}
        aria-controls="admin-users-permissions-panel"
        type="button"
      >
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <Users className="h-4.5 w-4.5 text-primary" />
          <span>使用者權限管理（管理角色 {selectedCount}/{totalCount} 人）</span>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedCount > 0 && <CheckCircle className="h-4 w-4 text-emerald-500" />}
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Accordion Content Wrapper (Framer Motion height animation) */}
      <motion.div 
        id="admin-users-permissions-panel"
        initial={false}
        animate={{ 
          height: isOpen ? "auto" : 0, 
          opacity: isOpen ? 1 : 0 
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="transition-all overflow-hidden bg-card border-t border-border/50"
      >
        <div className="p-4">
          <div className="flex flex-col gap-3 mb-4">
            <label htmlFor="admin-search-user" className="text-xs font-medium text-muted-foreground">
              搜尋使用者
            </label>
            <input
              id="admin-search-user"
              type="search"
              placeholder="輸入姓名或 Email"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2" aria-label="依組織篩選使用者">
              <button type="button" id="chip-filter-region" className="filter-chip">
                <span>篩選大區</span> <span className="chip-arrow">展開</span>
              </button>
              <button type="button" id="chip-filter-zone" className="filter-chip">
                <span>篩選牧區</span> <span className="chip-arrow">展開</span>
              </button>
              <button type="button" id="chip-filter-group" className="filter-chip">
                <span>篩選小組</span> <span className="chip-arrow">展開</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">點選使用者即可設定一般會友、小組長、牧區長、大區長或系統管理員權限。</p>
          </div>
          <div
            id="admin-users-list-scroll-area" 
            className="max-h-56 overflow-y-auto space-y-2 pr-1 scrollbar-thin"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {/* Target element populated by Vanilla JS modules/admin.js */}
            <div id="admin-users-list">
              <div className="text-center py-6 text-xs text-muted-foreground">
                載入中或名單為空...
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
