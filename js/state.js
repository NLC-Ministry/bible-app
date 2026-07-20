// Global configuration presets, state object, router, loader, theme switcher, and local settings loader.

// 9 Categories of Bible Books
const BIBLE_CATEGORIES = {
  cat1: { name: "摩西五經", books: ["創世記", "出埃及記", "利未記", "民數記", "申命記"] },
  cat2: { name: "歷史書", books: ["約書亞記", "士師記", "路得記", "撒母耳記上", "撒母耳記下", "列王紀上", "列王紀下", "歷代志上", "歷代志下", "以斯拉記", "尼希米記", "以斯帖記"] },
  cat3: { name: "詩歌智慧書", books: ["約伯記", "詩篇 1-110", "詩篇 111-150", "箴言", "傳道書", "雅歌"] },
  cat4: { name: "大先知書", books: ["以賽亞書", "耶利米書", "耶利米哀歌", "以西結書", "但以理書"] },
  cat5: { name: "小先知書", books: ["何西阿書", "約珥書", "阿摩司書", "俄巴底亞書", "約拿書", "彌迦書", "那鴻書", "哈巴谷書", "西番雅書", "哈該書", "撒迦利亞書", "瑪拉基書"] },
  cat6: { name: "福音書+徒", books: ["馬太福音", "馬可福音", "路加福音", "約翰福音", "使徒行傳"] },
  cat7: { name: "保羅書信一", books: ["羅馬書", "哥林多前書", "哥林多後書", "加拉太書", "以弗所書", "腓立比書"] },
  cat8: { name: "保羅書信二", books: ["歌羅西書", "帖撒羅尼迦前書", "帖撒羅尼迦後書", "提摩太前書", "提摩太後書", "提多書", "腓利門書"] },
  cat9: { name: "普通書信+啟", books: ["希伯來書", "雅各書", "彼得前書", "彼得後書", "約翰一書", "約翰二書", "約翰三書", "猶大書", "啟示錄"] }
};

window.BIBLE_CATEGORIES = BIBLE_CATEGORIES;

const defaultChurchCampaign = window.cloneChurchCampaign();
const CHURCH_PLAN_PRESETS = {
  [window.CHURCH_CAMPAIGN_PRESET_KEY]: {
    id: defaultChurchCampaign.id,
    name: defaultChurchCampaign.name,
    description: defaultChurchCampaign.description,
    startDate: defaultChurchCampaign.startDate,
    endDate: defaultChurchCampaign.endDate,
    books: Array.from(new Set(defaultChurchCampaign.segments.flatMap(segment => segment.readings.map(reading => reading.book)))),
    planKind: "church_campaign",
    isFixed: true,
    campaignDefinition: defaultChurchCampaign
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

function getActivePlanContextId(plan = state.activePlan) {
  if (!plan) return null;
  return plan.id || plan.globalPlanId || plan.presetKey || null;
}

function syncActivePlanContext(plan = state.activePlan) {
  const planId = getActivePlanContextId(plan);
  window.currentActivePlanId = planId;
  window.currentActivePlanKey = planId ? (plan.presetKey || plan.globalPlanId || plan.id || null) : null;
  return planId;
}

function findPlanByContextId(planId) {
  if (!planId) return state.activePlan || null;
  return (state.activePlans || []).find(plan =>
    plan.id === planId ||
    plan.globalPlanId === planId ||
    plan.presetKey === planId
  ) || null;
}
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

    // top-bar-back-btn is handled via inline onclick; plan detail tabs are controlled by PlanPageController.

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
    const brandLogo = document.getElementById("brand-logo");
    const titleEl = document.querySelector(".brand-text");
    
    const topBarBackBtn = document.getElementById("top-bar-back-btn");
    const topBarGroupTrigger = document.getElementById("top-bar-group-trigger");
    const topBarPlanName = document.getElementById("top-bar-plan-name");
    const topBarSubMode = document.getElementById("top-bar-sub-mode");
    const planSettingsIcon = document.getElementById("plan-settings-icon");

    // ── 控制主題切換按鈕的顯示 (只在個人分頁顯示) ──
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
      themeToggle.classList.toggle("hidden", this.currentTab !== "profile-view");
    }

    const isPlanDetail = this.currentTab === "plan-view" && state.activePlan && state.planDetailOpen;

    if (isPlanDetail) {
      // Hide brand mark and normal back button
      if (brandLogo) brandLogo.style.display = "none";
      if (backBtn) backBtn.style.display = "none";
      if (titleEl) titleEl.style.display = "none";

      // Show plan specific navigation elements
      if (topBarBackBtn) {
        topBarBackBtn.style.display = "flex";
        topBarBackBtn.classList.remove("hidden");
      }
      if (topBarGroupTrigger) {
        topBarGroupTrigger.style.display = "none";
        topBarGroupTrigger.classList.add("hidden");
      }
      if (topBarPlanName && state.activePlan) {
        topBarPlanName.textContent = state.planActiveSubTab === "settings" ? "\u8abf\u6574\u9032\u5ea6\u8a2d\u5b9a" : state.activePlan.name;
        topBarPlanName.style.display = "block";
        topBarPlanName.classList.remove("hidden");
      }
      if (topBarSubMode) topBarSubMode.innerHTML = "";
      if (planSettingsIcon) {
        planSettingsIcon.style.display = "none";
        planSettingsIcon.classList.add("hidden");
      }
    } else {
      // Show brand mark and normal back button
      if (brandLogo) brandLogo.style.display = "";
      if (backBtn) backBtn.style.display = "";
      if (titleEl) {
        titleEl.style.display = "";
        titleEl.textContent = this.getTabLabel(this.currentTab);
      }

      // Hide plan specific navigation elements
      if (topBarBackBtn) {
        topBarBackBtn.style.display = "none";
        topBarBackBtn.classList.add("hidden");
      }
      if (topBarGroupTrigger) {
        topBarGroupTrigger.style.display = "none";
        topBarGroupTrigger.classList.add("hidden");
      }
      if (topBarPlanName) {
        topBarPlanName.style.display = "none";
        topBarPlanName.classList.add("hidden");
      }
      if (planSettingsIcon) {
        planSettingsIcon.style.display = "none";
        planSettingsIcon.classList.add("hidden");
      }
    }

    // Every joined plan detail exposes the same top-right options menu.
    const optionsContainer = document.getElementById("global-plan-options-container");
    if (optionsContainer) {
      optionsContainer.classList.toggle("hidden", !isPlanDetail);
      optionsContainer.hidden = !isPlanDetail;
      optionsContainer.style.display = isPlanDetail ? "flex" : "none";
      if (!isPlanDetail) {
        const dropdown = document.getElementById("plan-options-dropdown");
        if (dropdown) dropdown.classList.add("hidden");
      }
    }

    const isReaderPage = this.currentTab === "reader-view";
    document.body.classList.toggle("reader-page", isReaderPage);
    const appLayout = document.querySelector(".app-layout");
    if (appLayout) appLayout.classList.toggle("reader-mode", isReaderPage);
    
    // In reader-view: do NOT hard-hide the nav bar here.
    // bible.js scroll handler adds/removes body.reader-nav-hidden which controls
    // visibility via CSS (see .reader-nav-hidden .mobile-nav-bar rule).
    // On tap the nav bar reappears — that behaviour lives entirely in CSS+bible.js.
    const mobileNavBar = document.querySelector(".mobile-nav-bar");
    if (mobileNavBar) {
      mobileNavBar.setAttribute("aria-hidden", isReaderPage ? "true" : "false");
    }
    if (!backBtn || !backLabel) return;

    // Back button rules:
    // - reader-view: always show (returns to previous tab)
    // - plan-detail: hidden here (handled by topBarBackBtn above)
    // - all other tabs: HIDE — bottom nav handles all tab switching
    const showBackBtn = isReaderPage;
    backBtn.classList.toggle("is-home", !showBackBtn);
    backBtn.style.display = showBackBtn ? "" : "none";
    backLabel.textContent = "返回";
    backBtn.title = "返回上一層";
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

      const levelSubview = document.getElementById("subview-plan-level");
      if (levelSubview && !levelSubview.classList.contains("hidden")) {
        const scheduleSubview = document.getElementById("subview-plan-schedule");
        if (levelSubview) {
          levelSubview.classList.add("hidden");
          levelSubview.hidden = true;
        }
        if (scheduleSubview) {
          scheduleSubview.classList.remove("hidden");
          scheduleSubview.hidden = false;
          scheduleSubview.style.display = "";
        }
        if (typeof renderPlanScheduleTracker === "function") renderPlanScheduleTracker();
        this.updateNavigationChrome();
        return;
      }

      if (state.activePlan && state.planDetailOpen) {
        state.planDetailOpen = false;
        // Directly await renderPlanView so chrome update happens AFTER render.
        if (typeof window.renderPlanView === "function") {
          window.renderPlanView().then(() => {
            this.updateNavigationChrome();
          });
        } else {
          this.updateNavigationChrome();
        }
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
    // ── DELEGATE to the async switchTab override in app.js ──
    // The async version in app.js handles: module loading, full render await,
    // and the single authoritative updateNavigationChrome() call.
    // This sync stub exists only for backwards-compatibility with any legacy
    // code that calls appRouter.switchTab synchronously before app.js loads.
    if (typeof appRouter.switchTab === 'function' && appRouter.switchTab !== this.switchTab) {
      appRouter.switchTab(tabId, options);
      return;
    }

    // Fallback (should never be reached in production):
    this.currentTab = tabId;
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

    // ── Unified theme-change broadcast ──
    // All loaded modules subscribe to 'app:themeChanged' independently.
    // Do NOT call render functions directly here — modules may not be loaded yet.
    window.dispatchEvent(new CustomEvent("app:themeChanged", {
      detail: { theme: state.theme }
    }));
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

window.state = state;
window.currentActivePlanId = getActivePlanContextId();
window.currentActivePlanKey = null;
window.getActivePlanContextId = getActivePlanContextId;
window.syncActivePlanContext = syncActivePlanContext;
window.findPlanByContextId = findPlanByContextId;
window.CHURCH_PLAN_PRESETS = CHURCH_PLAN_PRESETS;
window.appRouter = appRouter;
window.initTheme = initTheme;
window.loadLocalSettings = loadLocalSettings;
window.setBodyThemeClass = setBodyThemeClass;
window.escapeHTML = escapeHTML;
window.loader = loader;
