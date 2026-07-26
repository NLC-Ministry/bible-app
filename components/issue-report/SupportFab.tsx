// components/issue-report/SupportFab.tsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare } from "lucide-react";

interface SupportFabProps {
  onClick: () => void;
  isOpen: boolean;
}

export const SupportFab: React.FC<SupportFabProps> = ({ onClick, isOpen }) => {
  const [currentPath, setCurrentPath] = React.useState(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handleLocationChange);
    const interval = setInterval(handleLocationChange, 500);

    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      clearInterval(interval);
    };
  }, []);

  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let lastScrollY = window.scrollY;
    let throttleTimeout: any = null;
    let scrollStopTimeout: any = null;

    const handleScroll = (event: Event) => {
      if (throttleTimeout) return;

      throttleTimeout = setTimeout(() => {
        const target = event.target as HTMLElement;
        const currentScrollY = target.scrollTop !== undefined ? target.scrollTop : window.scrollY;

        if (scrollStopTimeout) clearTimeout(scrollStopTimeout);

        if (currentScrollY > lastScrollY && currentScrollY > 50) {
          setIsVisible(false);
        } else {
          setIsVisible(true);
        }

        lastScrollY = currentScrollY;
        throttleTimeout = null;

        scrollStopTimeout = setTimeout(() => {
          setIsVisible(true);
        }, 150);
      }, 50);
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (throttleTimeout) clearTimeout(throttleTimeout);
      if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
    };
  }, []);

  const isExcluded =
    (currentPath || "") === "/login" ||
    (currentPath || "").startsWith("/auth") ||
    (currentPath || "") === "/signup" ||
    (typeof document !== "undefined" && document.getElementById("login-gate") && !document.getElementById("login-gate")?.classList.contains("hidden"));

  if (isExcluded) return null;

  return (
    <AnimatePresence>
      {!isOpen && isVisible && (
        <motion.button
          onClick={onClick}
          initial={{ scale: 0, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0, opacity: 0, y: 50 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="fixed bottom-28 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          aria-label="打開問題回報與建議表單"
          type="button"
        >
          <MessageSquare className="h-6 w-6" />
        </motion.button>
      )}
    </AnimatePresence>
  );
};
