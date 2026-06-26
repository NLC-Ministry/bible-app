// Global configuration presets, state object, router, loader, theme switcher, and local settings loader.

// Predefined Church Quarterly Plan Presets (2026-2027)
const CHURCH_PLAN_PRESETS = {
  q1: {
    name: "第一季速讀：2026年7月~9月",
    startDate: "2026-07-01",
    endDate: "2026-09-30",
    books: ["創世記", "馬太福音", "列王紀下", "雅各書", "出埃及記", "馬可福音", "約伯記", "加拉太書", "哈巴谷書", "猶大書", "利未記", "路加福音", "歷代志下", "帖撒羅尼迦前書", "約拿書", "約翰二書", "彌迦書", "約翰三書"]
  },
  q2: {
    name: "第二季速讀：2026年10月~12月",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    books: ["民數記", "約翰福音", "以西結書", "約翰一書", "申命記", "使徒行傳", "箴言", "提摩太後書", "傳道書", "腓利門書", "約書亞記", "羅馬書", "耶利米書", "彼得後書", "西番雅書", "哈該書"]
  },
  q3: {
    name: "第三季速讀：2027年1月~3月",
    startDate: "2027-01-01",
    endDate: "2027-03-31",
    books: ["士師記", "哥林多前書", "以斯拉記", "以西結書", "約珥書", "阿摩司書", "路得記", "哥林多後書", "歷代志上", "提摩太前書", "俄巴底亞書", "那鴻書", "撒母耳記上", "以弗所書", "以賽亞書", "彼得前書"]
  },
  q4: {
    name: "第四季速讀：2027年4月~6月",
    startDate: "2027-04-01",
    endDate: "2027-06-30",
    books: ["撒母耳記下", "腓立比書", "以斯帖記", "提多書", "何西阿書", "瑪拉基書", "尼希米記", "帖撒羅尼迦後書", "列王紀上", "希伯來書", "詩篇 1-110", "詩篇 111-150", "歌羅西書", "耶利米哀歌", "但以理書", "雅歌", "啟示錄"]
  }
};

// Global Application State
const state = {
  theme: "light",
  isSupabaseMode: false,
  supabase: null,
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
  },

  switchTab(tabId) {
    this.currentTab = tabId;
    
    // Update Active Nav Buttons (both desktop and mobile)
    document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach(btn => {
      if (btn.getAttribute("data-target") === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
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
      updateDashboardView();
    } else if (tabId === "reader-view") {
      renderReaderText();
    } else if (tabId === "plan-view") {
      renderPlanView();
    } else if (tabId === "stats-view") {
      updateStatsView();
    } else if (tabId === "profile-view") {
      renderProfileView();
    }
  }
};

// Loader Overlay Helpers
const loader = {
  show(text = "載入中...") {
    const el = document.getElementById("loader-overlay");
    el.querySelector(".loader-text").textContent = text;
    el.classList.remove("hidden");
  },
  hide() {
    document.getElementById("loader-overlay").classList.add("hidden");
  }
};

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem("app_theme") || "light";
  state.theme = savedTheme;
  document.body.className = savedTheme + "-theme";

  document.getElementById("theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    document.body.className = state.theme + "-theme";
    localStorage.setItem("app_theme", state.theme);
  });
}

// Local Settings & State Loading
function loadLocalSettings() {
  // Load local reader preferences
  state.readerState.fontSize = parseInt(localStorage.getItem("reader_font_size")) || 18;
  document.getElementById("font-size-label").textContent = state.readerState.fontSize + "px";
  
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
