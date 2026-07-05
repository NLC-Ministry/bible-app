// Global configuration presets, state object, router, loader, theme switcher, and local settings loader.

// Predefined Church Quarterly Plan Presets (2026-2027)
const CHURCH_PLAN_PRESETS = {
  q1: {
    name: "第一季速讀：2026年7月~9月",
    startDate: "2026-07-01",
    endDate: "2026-09-30",
    books: ["創世記", "馬太福音", "列王紀下", "雅各書", "出埃及記", "馬可福音", "約伯記", "加拉太書", "哈巴谷書", "猶大書", "利未記", "路加福音", "歷代志下", "帖撒羅尼迦前書", "約拿書", "約翰二書", "彌迦書", "約翰三書"],
    months: [
      { name: "第一個月：2026年7月", year: 2026, month: 7, readingDays: 27, books: ["創世記", "馬太福音", "列王紀下", "雅各書"] },
      { name: "第二個月：2026年8月", year: 2026, month: 8, readingDays: 27, books: ["出埃及記", "馬可福音", "約伯記", "加拉太書", "哈巴谷書", "猶大書"] },
      { name: "第三個月：2026年9月", year: 2026, month: 9, readingDays: 27, books: ["利未記", "路加福音", "歷代志下", "帖撒羅尼迦前書", "約拿書", "約翰二書", "彌迦書", "約翰三書"] }
    ]
  },
  q2: {
    name: "第二季速讀：2026年10月~12月",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    books: ["民數記", "約翰福音", "以西結書", "約翰一書", "申命記", "使徒行傳", "箴言", "提摩太後書", "傳道書", "腓利門書", "約書亞記", "羅馬書", "耶利米書", "彼得後書", "西番雅書", "哈該書"],
    months: [
      { name: "第四個月：2026年10月", year: 2026, month: 10, readingDays: 28, books: ["民數記", "約翰福音", "以西結書", "約翰一書"] },
      { name: "第五個月：2026年11月", year: 2026, month: 11, readingDays: 28, books: ["申命記", "使徒行傳", "箴言", "提摩太後書", "傳道書", "腓利門書"] },
      { name: "第六個月：2026年12月", year: 2026, month: 12, readingDays: 25, books: ["約書亞記", "羅馬書", "耶利米書", "彼得後書", "西番雅書", "哈該書"] }
    ]
  },
  q3: {
    name: "第三季速讀：2027年1月~3月",
    startDate: "2027-01-01",
    endDate: "2027-03-31",
    books: ["士師記", "哥林多前書", "以斯拉記", "以西結書", "約珥書", "阿摩司書", "路得記", "哥林多後書", "歷代志上", "提摩太前書", "俄巴底亞書", "那鴻書", "撒母耳記上", "以弗所書", "以賽亞書", "彼得前書"],
    months: [
      { name: "第七個月：2027年1月", year: 2027, month: 1, readingDays: 27, books: ["士師記", "哥林多前書", "以斯拉記", "以西結書", "約珥書", "阿摩司書"] },
      { name: "第八個月：2027年2月", year: 2027, month: 2, readingDays: 14, books: ["路得記", "哥林多後書", "歷代志上", "提摩太前書", "俄巴底亞書", "那鴻書"] },
      { name: "第九個月：2027年3月", year: 2027, month: 3, readingDays: 27, books: ["撒母耳記上", "以弗所書", "以賽亞書", "彼得前書"] }
    ]
  },
  q4: {
    name: "第四季速讀：2027年4月~6月",
    startDate: "2027-04-01",
    endDate: "2027-06-30",
    books: ["撒母耳記下", "腓立比書", "以斯帖記", "提多書", "何西阿書", "瑪拉基書", "尼希米記", "帖撒羅尼迦後書", "列王紀上", "希伯來書", "詩篇 1-110", "詩篇 111-150", "歌羅西書", "耶利米哀歌", "但以理書", "雅歌", "啟示錄"],
    months: [
      { name: "第十個月：2027年4月", year: 2027, month: 4, readingDays: 28, books: ["撒母耳記下", "腓立比書", "以斯帖記", "提多書", "何西阿書", "瑪拉基書", "尼希米記", "帖撒羅尼迦後書", "列王紀上", "希伯來書"] },
      { name: "第十一個月：2027年5月", year: 2027, month: 5, readingDays: 28, books: ["詩篇 1-110"] },
      { name: "第十二個月：2027年6月", year: 2027, month: 6, readingDays: 23, books: ["詩篇 111-150", "歌羅西書", "耶利米哀歌", "但以理書", "雅歌", "啟示錄"] }
    ]
  }
};

// Global Application State
const state = {
  theme: "light",
  isSupabaseMode: false,
  supabase: null,
  realRole: null, // Authentic user role from DB
  currentUser: {
    name: "系統管理員",
    great_region: "東區",
    pastoral_zone: "大安1",
    small_group: "馬鈴",
    role: "admin",
    chapters_read: 0,
    plan_progress: 0,
    streak: 0,
    last_read: null
  },
  orgStructure: {
    regions: [],
    zones: {},  // regionName -> array of zoneNames
    groups: {}  // zoneName -> array of groupNames
  },
  activePlan: null,
  planDetailOpen: false,
  activePlans: [], // Array of multiple joined plans
  readingLogs: [], // Array of { book: string, chapter: number, read_at: string, plan_id?: string, presetKey?: string }
  readerState: {
    bookId: 1, // Genesis
    chapter: 1,
    fontSize: 18
  },
  highlights: {}, // Mapping of "Book_Chapter_Verse" to color hex
  statsCharts: {
    rank: null,
    progress: null,
    group: null,
    growth: null
  },
  adminFilters: {
    region: null,
    zone: null,
    group: null
  }
};

// Router for Switching Views
const appRouter = {
  currentTab: "dashboard-view",

  init() {
    const tabs = document.querySelectorAll(".tab-btn, .mobile-nav-btn");
    tabs.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const target = btn.getAttribute("data-target");
        if (target) {
          this.switchTab(target);
        }
      });
    });

    const backBtn = document.getElementById("global-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.goBack();
      });
    }

    const brandLogo = document.getElementById("brand-logo");
    if (brandLogo) {
      brandLogo.addEventListener("click", (e) => {
        e.preventDefault();
        this.switchTab("dashboard-view");
      });
    }
    this.updateNavigationChrome();
  },

  getTabLabel(tabId) {
    const labels = {
      "dashboard-view": "首頁",
      "reader-view": "讀經",
      "plan-view": "計畫",
      "stats-view": "統計",
      "profile-view": "個人",
      "admin-view": "管理"
    };
    return labels[tabId] || "首頁";
  },

  updateNavigationChrome() {
    const backBtn = document.getElementById("global-back-btn");
    const backLabel = document.getElementById("global-back-label");
    const titleEl = document.querySelector(".brand-text");
    
    // Dynamic page title: show active plan name if viewing a plan
    if (titleEl) {
      if (this.currentTab === "plan-view" && state.activePlan && state.planDetailOpen) {
        titleEl.textContent = state.activePlan.name;
      } else {
        titleEl.textContent = this.getTabLabel(this.currentTab);
      }
    }

    // Toggle global plan options menu visibility
    const optionsContainer = document.getElementById("global-plan-options-container");
    if (optionsContainer) {
      const showOptions = this.currentTab === "plan-view" && state.activePlan && state.planDetailOpen;
      optionsContainer.classList.toggle("hidden", !showOptions);
    }

    const isReaderPage = this.currentTab === "reader-view";
    document.body.classList.toggle("reader-page", isReaderPage);
    const appLayout = document.querySelector(".app-layout");
    if (appLayout) appLayout.classList.toggle("reader-mode", isReaderPage);
    
    // Explicitly hide the mobile bottom navigation bar in immersive reading mode
    const mobileNavBar = document.querySelector(".mobile-nav-bar");
    if (mobileNavBar) {
      mobileNavBar.classList.toggle("hidden", isReaderPage);
      mobileNavBar.setAttribute("aria-hidden", isReaderPage ? "true" : "false");
    }
    if (!backBtn || !backLabel) return;

    const isHome = this.currentTab === "dashboard-view" && !(state.activePlan && state.planDetailOpen);
    backBtn.classList.toggle("is-home", isHome);
    backLabel.textContent = isHome ? "首頁" : "返回";
    backBtn.title = isHome ? "回到首頁" : "返回上一層";
  },

  goBack() {
    if (this.currentTab === "reader-view") {
      if (state.readerState && state.readerState.returnTab === "plan-view") {
        state.readerState.returnTab = null;
        this.switchTab("plan-view", { keepPlanDetail: true });
        return;
      }
    }

    if (this.currentTab === "plan-view") {
      if (state.inlineReader && state.inlineReader.active && typeof window.closePlanInlineReader === "function") {
        window.closePlanInlineReader();
        this.updateNavigationChrome();
        return;
      }

      // If in calendar view mode, return to card mode via decoupled Custom Event
      if (state.planViewMode === 'calendar') {
        document.dispatchEvent(new CustomEvent("plan-view-back-to-card"));
        this.updateNavigationChrome();
        return;
      }

      const levelSubview = document.getElementById("subview-plan-level");
      if (levelSubview && !levelSubview.classList.contains("hidden")) {
        const scheduleSubview = document.getElementById("subview-plan-schedule");
        if (levelSubview) levelSubview.classList.add("hidden");
        if (scheduleSubview) scheduleSubview.classList.remove("hidden");
        if (typeof renderPlanScheduleTracker === "function") renderPlanScheduleTracker();
        this.updateNavigationChrome();
        return;
      }

      if (state.activePlan && state.planDetailOpen) {
        state.activePlan = null;
        state.planDetailOpen = false;
        localStorage.removeItem("selected_plan_key");
        if (typeof renderPlanView === "function") renderPlanView();
        this.updateNavigationChrome();
        return;
      }
    }

    if (this.currentTab !== "dashboard-view") {
      this.switchTab("dashboard-view");
      return;
    }

    if (typeof updateDashboardView === "function") updateDashboardView();
    this.updateNavigationChrome();
  },

  switchTab(tabId, options = {}) {
    if (tabId !== "reader-view" || !options.fromPlan) {
      if (state.readerState) {
        state.readerState.fromPlan = false;
      }
    }

    // Stop reading audio if switching away from reader-view
    if (tabId !== "reader-view" && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
      const audioBtn = document.getElementById("reader-audio-btn");
      if (audioBtn) audioBtn.classList.remove("active");
    }

    this.currentTab = tabId;
    this.updateNavigationChrome();
    
    // Update Active Nav Buttons (both desktop and mobile)
    document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach(btn => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      const isActive = target === tabId;
      btn.classList.toggle("active", isActive);
      if (btn.classList.contains("mobile-nav-btn") || btn.closest(".nav-tabs")) {
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
        if (isActive) {
          btn.setAttribute("aria-current", "page");
        } else {
          btn.removeAttribute("aria-current");
        }
      }
    });

    // Update Views
    document.querySelectorAll(".view-pane").forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.add("active");
      } else {
        pane.classList.remove("active");
      }
    });

    // Trigger tab-specific activation logic
    if (tabId === "dashboard-view") {
      if (typeof updateDashboardView === "function") updateDashboardView();
    } else if (tabId === "reader-view") {
      if (typeof renderReaderText === "function") renderReaderText();
    } else if (tabId === "plan-view") {
      if (!options.keepPlanDetail) {
        state.planDetailOpen = false;
      }
      if (typeof renderPlanView === "function") renderPlanView();
    } else if (tabId === "stats-view") {
      if (typeof updateStatsView === "function") updateStatsView();
    } else if (tabId === "profile-view") {
      if (typeof renderProfileView === "function") renderProfileView();
    } else if (tabId === "admin-view") {
      if (typeof renderAdminUserManagement === 'function') {
        renderAdminUserManagement();
      }
      if (typeof renderAdminOrgManagement === 'function') {
        renderAdminOrgManagement();
      }
    }
    this.updateNavigationChrome();
  }
};

// Loader helpers — full-screen overlay removed; use in-place skeletons instead.
const loader = {
  show() {},
  hide() {}
};

// Theme Management
function setBodyThemeClass(themeName) {
  document.body.classList.remove("light-theme", "warm-theme", "dark-theme");
  document.body.classList.add(themeName + "-theme");
}

function initTheme() {
  const savedTheme = localStorage.getItem("app_theme") || "light";
  state.theme = savedTheme;
  setBodyThemeClass(savedTheme);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    setBodyThemeClass(state.theme);
    localStorage.setItem("app_theme", state.theme);
    
    // Refresh badge UI for theme change
    if (typeof renderBadgeWall === "function") {
      renderBadgeWall("badges-grid");
    }
    if (typeof renderBadgeStrip === "function") {
      renderBadgeStrip("dashboard-badge-strip", { linkToProfile: true });
      renderBadgeStrip("plan-badge-strip");
    }
  });
}

// Local Settings & State Loading
function loadLocalSettings() {
  // Load local reader preferences
  state.readerState.fontSize = parseInt(localStorage.getItem("reader_font_size")) || 18;
  const sizeLabel = document.getElementById("font-size-label");
  if (sizeLabel) sizeLabel.textContent = state.readerState.fontSize + "px";
  
  // Load local Bible translation version preference
  state.readerState.version = localStorage.getItem("reader_bible_version") || "CUNP";
  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const label = state.readerState.version === "CUNP" ? "CUNP-神" : (state.readerState.version === "RCUVTS" ? "RCUV-神" : "CUV-神");
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
  }
  
  const savedReader = localStorage.getItem("reader_state");
  if (savedReader) {
    state.readerState = { ...state.readerState, ...JSON.parse(savedReader) };
  }

  // Load highlights
  const savedHighlights = localStorage.getItem("bible_highlights");
  if (savedHighlights) {
    state.highlights = JSON.parse(savedHighlights);
  }
}

// HTML Sanitization / Escaping to prevent XSS (Script Injection) attacks
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  if (typeof str !== 'string') str = String(str);
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// React state simulator for compatibility and audit compliance
state.dataVersion = 0;
const [dataVersion, setDataVersion] = (function() {
  return [
    () => state.dataVersion || 0,
    (updater) => {
      const oldVal = state.dataVersion || 0;
      const newVal = typeof updater === 'function' ? updater(oldVal) : Number(updater);
      state.dataVersion = newVal;
      console.log('🏗️ [系統審計] 資料版本已更新，當前版本:', state.dataVersion);
      // Dispatch CustomEvent to notify all components
      const event = new CustomEvent("planDataChanged", { detail: { dataVersion: state.dataVersion } });
      window.dispatchEvent(event);
    }
  ];
})();
window.dataVersion = dataVersion;
window.setDataVersion = setDataVersion;
