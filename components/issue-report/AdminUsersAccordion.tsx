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
        type="button"
      >
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <Users className="h-4.5 w-4.5 text-primary" />
          <span>人員名單 (已選取 {selectedCount}/{totalCount} 人) ── 點擊展開/修改</span>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedCount > 0 && <CheckCircle className="h-4 w-4 text-emerald-500" />}
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Accordion Content Wrapper (Framer Motion height animation) */}
      <motion.div 
        initial={false}
        animate={{ 
          height: isOpen ? "auto" : 0, 
          opacity: isOpen ? 1 : 0 
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="transition-all overflow-hidden bg-card border-t border-border/50"
      >
        <div className="p-4">
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
