// Church Bible Speed Reading & Statistics Application Logic

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
    great_region: "第一大區",
    pastoral_zone: "約書亞牧區",
    small_group: "迦勒小組",
    role: "admin",
    chapters_read: 0,
    plan_progress: 0,
    streak: 0,
    last_read: null
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

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize Theme
  initTheme();
  
  // 2. Initialize Routing
  appRouter.init();

  // 3. Initialize Settings & Supabase Configuration
  loadLocalSettings();
  
  // 4. Initialize Database Integration
  await initSupabaseConnection();

  // 5. Initialize Bible Reader Controls & Selectors
  initReaderControls();

  // 6. Initialize Plan Creation Form & Checkboxes
  initPlanControls();

  // 7. Load Data & Render initial Dashboard
  await loadUserData();
  updateDashboardView();
});

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

  // Supabase URL/Key config is read directly from global config.js (SUPABASE_CONFIG)
}

// Initialize Supabase Connection
async function initSupabaseConnection() {
  const sbUrl = typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.url ? SUPABASE_CONFIG.url.trim() : "";
  const sbKey = typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.anonKey ? SUPABASE_CONFIG.anonKey.trim() : "";
  const statusBadge = document.getElementById("connection-status");
  const authSection = document.getElementById("sb-auth-section");
  const placeholder = document.getElementById("sb-disconnected-placeholder");
  const profileCardCol = document.getElementById("profile-card-col");
  const cloudSyncCardCol = document.getElementById("cloud-sync-card-col");

  if (sbUrl && sbKey) {
    try {
      // Initialize Supabase SDK
      state.supabase = supabase.createClient(sbUrl, sbKey);
      state.isSupabaseMode = true;
      
      // Update Status Badge
      statusBadge.className = "status-badge online";
      statusBadge.querySelector(".status-text").textContent = "線上模式";
      if (authSection) authSection.classList.remove("hidden");
      if (placeholder) placeholder.classList.add("hidden");
      
      // Show cloud sync panel and set split layout
      if (cloudSyncCardCol) cloudSyncCardCol.classList.remove("hidden");
      if (profileCardCol) {
        profileCardCol.className = "card-col span-6";
      }
      
      // Check Auth Session
      const { data: { session } } = await state.supabase.auth.getSession();
      updateAuthUI(session);
    } catch (e) {
      console.error("Supabase connection failed:", e);
      state.isSupabaseMode = false;
      statusBadge.className = "status-badge offline";
      statusBadge.querySelector(".status-text").textContent = "Demo 模式 (連線錯誤)";
      if (authSection) authSection.classList.add("hidden");
      if (placeholder) placeholder.classList.remove("hidden");
      
      // Hide cloud sync panel and set full width layout
      if (cloudSyncCardCol) cloudSyncCardCol.classList.add("hidden");
      if (profileCardCol) {
        profileCardCol.className = "card-col span-12";
      }
    }
  } else {
    state.isSupabaseMode = false;
    statusBadge.className = "status-badge offline";
    statusBadge.querySelector(".status-text").textContent = "Demo 模式";
    if (authSection) authSection.classList.add("hidden");
    if (placeholder) placeholder.classList.remove("hidden");
    
    // Hide cloud sync panel and set full width layout
    if (cloudSyncCardCol) cloudSyncCardCol.classList.add("hidden");
    if (profileCardCol) {
      profileCardCol.className = "card-col span-12";
    }
  }
}

// Handle Supabase Auth UI Switches
function updateAuthUI(session) {
  const loggedOutDiv = document.getElementById("auth-logged-out");
  const loggedInDiv = document.getElementById("auth-logged-in");
  const userEmailSpan = document.getElementById("auth-user-email");

  if (session && session.user) {
    if (loggedOutDiv) loggedOutDiv.classList.add("hidden");
    if (loggedInDiv) loggedInDiv.classList.remove("hidden");
    if (userEmailSpan) userEmailSpan.textContent = session.user.email;
  } else {
    if (loggedOutDiv) loggedOutDiv.classList.remove("hidden");
    if (loggedInDiv) loggedInDiv.classList.add("hidden");
    if (userEmailSpan) userEmailSpan.textContent = "";
  }
}

// Load User Data (either Supabase or LocalStorage fallbacks)
async function loadUserData() {
  if (state.isSupabaseMode && state.supabase) {
    const { data: { user } } = await state.supabase.auth.getUser();
    if (user) {
      // 1. Load Profile
      const { data: profile } = await state.supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profile) {
        state.currentUser.name = profile.name;
        state.currentUser.great_region = profile.great_region;
        state.currentUser.pastoral_zone = profile.pastoral_zone;
        state.currentUser.small_group = profile.small_group;
        state.currentUser.role = profile.role;
      } else {
        // First-time login: create profile automatically in Supabase
        state.currentUser.name = (user.user_metadata && user.user_metadata.full_name) || "新使用者";
        state.currentUser.great_region = "第一大區";
        state.currentUser.pastoral_zone = "約書亞牧區";
        state.currentUser.small_group = "迦勒小組";
        state.currentUser.role = "member";
        
        try {
          await state.supabase.from("profiles").insert({
            id: user.id,
            name: state.currentUser.name,
            great_region: state.currentUser.great_region,
            pastoral_zone: state.currentUser.pastoral_zone,
            small_group: state.currentUser.small_group,
            role: state.currentUser.role
          });
        } catch (dbErr) {
          console.error("Failed to auto-create user profile in Supabase:", dbErr);
        }
      }

      // 2. Load Reading Logs
      const { data: logs } = await state.supabase
        .from("reading_logs")
        .select("book, chapter, read_at, plan_id")
        .eq("user_id", user.id);
      
      state.readingLogs = logs || [];
      state.currentUser.chapters_read = state.readingLogs.length;

      // 3. Load Active Reading Plans
      const { data: plans } = await state.supabase
        .from("reading_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      state.activePlans = [];
      if (plans && plans.length > 0) {
        plans.forEach(dbPlan => {
          const key = getPresetKeyByName(dbPlan.name);
          const planObj = generatePlanObject(dbPlan.name, dbPlan.start_date, dbPlan.end_date, dbPlan.target_books, key);
          planObj.id = dbPlan.id;
          state.activePlans.push(planObj);
        });
        
        const selectedKey = localStorage.getItem("selected_plan_key");
        if (selectedKey) {
          state.activePlan = state.activePlans.find(p => p.presetKey === selectedKey) || state.activePlans[0];
        } else {
          state.activePlan = state.activePlans[0];
        }
        calculateAllPlansProgress();
      } else {
        state.activePlan = null;
        state.activePlans = [];
      }
      
      calculateStreak();
      return;
    }
  }

  // FALLBACK: LocalStorage mode
  const localProfile = localStorage.getItem("user_profile");
  if (localProfile) {
    state.currentUser = JSON.parse(localProfile);
    const localLogs = localStorage.getItem("reading_logs");
    state.readingLogs = localLogs ? JSON.parse(localLogs) : [];
    state.currentUser.chapters_read = state.readingLogs.length;

    const localPlans = localStorage.getItem("active_reading_plans");
    if (localPlans) {
      state.activePlans = JSON.parse(localPlans);
      state.activePlans.forEach(plan => {
        if (!plan.presetKey) {
          plan.presetKey = getPresetKeyByName(plan.name);
        }
      });
      calculateAllPlansProgress();
      
      const selectedKey = localStorage.getItem("selected_plan_key");
      if (selectedKey) {
        state.activePlan = state.activePlans.find(p => p.presetKey === selectedKey) || state.activePlans[0] || null;
      } else {
        state.activePlan = state.activePlans[0] || null;
      }
    } else {
      const localPlan = localStorage.getItem("active_reading_plan");
      if (localPlan) {
        const singlePlan = JSON.parse(localPlan);
        if (!singlePlan.presetKey) {
          singlePlan.presetKey = getPresetKeyByName(singlePlan.name);
        }
        state.activePlans = [singlePlan];
        state.activePlan = singlePlan;
        calculateAllPlansProgress();
        localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
        localStorage.removeItem("active_reading_plan");
      } else {
        state.activePlans = [];
        state.activePlan = null;
      }
    }
  } else {
    // First run in Demo mode: default to admin with mock logs/plan
    state.currentUser = {
      name: "系統管理員",
      great_region: "第一大區",
      pastoral_zone: "約書亞牧區",
      small_group: "迦勒小組",
      role: "admin",
      chapters_read: 80,
      plan_progress: 72,
      streak: 15,
      last_read: new Date().toISOString().split('T')[0]
    };
    localStorage.setItem("user_profile", JSON.stringify(state.currentUser));

    state.activePlan = generatePlanObject(CHURCH_PLAN_PRESETS.q1.name, CHURCH_PLAN_PRESETS.q1.startDate, CHURCH_PLAN_PRESETS.q1.endDate, CHURCH_PLAN_PRESETS.q1.books, "q1");
    state.activePlan.progress = 72;
    state.activePlan.completedChapters = Math.round((state.activePlan.totalChapters * 72) / 100);
    state.activePlans = [state.activePlan];
    
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
    localStorage.setItem("selected_plan_key", "q1");

    // Fill in simulated logs from the active plan's actual chapters
    const completedList = [];
    let count = 0;
    for (const day of state.activePlan.days) {
      for (const ch of day.chapters) {
        if (count < state.activePlan.completedChapters) {
          completedList.push({
            book: ch.book,
            chapter: ch.chapter,
            read_at: new Date(state.activePlan.startDate).toISOString(),
            presetKey: "q1"
          });
          count++;
        } else {
          break;
        }
      }
      if (count >= state.activePlan.completedChapters) break;
    }
    state.readingLogs = completedList;
    localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs));
    
    state.currentUser.chapters_read = state.readingLogs.length;
  }

  calculateStreak();
}

// Calculate streak based on reading logs
function calculateStreak() {
  if (state.readingLogs.length === 0) {
    state.currentUser.streak = 0;
    return;
  }

  // Extract unique dates of reading logs in YYYY-MM-DD
  const dates = [...new Set(state.readingLogs.map(log => {
    return log.read_at.substring(0, 10);
  }))].sort().reverse();

  if (dates.length === 0) {
    state.currentUser.streak = 0;
    return;
  }

  const todayStr = new Date().toISOString().substring(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().substring(0, 10);

  // If didn't read today or yesterday, streak is broken
  if (dates[0] !== todayStr && dates[0] !== yesterdayStr) {
    state.currentUser.streak = 0;
    state.currentUser.last_read = dates[0];
    saveLocalUserStats();
    return;
  }

  let streak = 1;
  let currentDate = new Date(dates[0]);

  for (let i = 1; i < dates.length; i++) {
    const nextDate = new Date(dates[i]);
    const diffTime = Math.abs(currentDate - nextDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      streak++;
      currentDate = nextDate;
    } else if (diffDays > 1) {
      break; // Streak broken
    }
  }

  state.currentUser.streak = streak;
  state.currentUser.last_read = dates[0];
  saveLocalUserStats();
}

function saveLocalUserStats() {
  state.currentUser.chapters_read = state.readingLogs.length;
  // Calculate average progress on active plan if exists
  if (state.activePlan) {
    state.currentUser.plan_progress = state.activePlan.progress || 0;
  } else {
    state.currentUser.plan_progress = 0;
  }
  
  if (!state.isSupabaseMode) {
    localStorage.setItem("user_profile", JSON.stringify(state.currentUser));
  }
}

// Save log to DB/LocalStorage
async function logChapterRead(book, chapter, isChecked) {
  const todayISO = new Date().toISOString();
  const planId = state.activePlan ? state.activePlan.id : null;
  const presetKey = state.activePlan ? state.activePlan.presetKey : null;
  
  if (isChecked) {
    // Add or Update Log
    const existingLog = state.readingLogs.find(l => l.book === book && l.chapter === chapter && (l.plan_id === planId || l.presetKey === presetKey));
    if (!existingLog) {
      state.readingLogs.push({ book, chapter, read_at: todayISO, plan_id: planId, presetKey: presetKey });
      
      if (state.isSupabaseMode && state.supabase) {
        const { data: { user } } = await state.supabase.auth.getUser();
        if (user) {
          await state.supabase.from("reading_logs").insert({
            user_id: user.id,
            plan_id: planId,
            book,
            chapter,
            read_at: todayISO
          }).select();
        }
      }
    } else {
      existingLog.read_at = todayISO;
      if (state.isSupabaseMode && state.supabase) {
        const { data: { user } } = await state.supabase.auth.getUser();
        if (user) {
          let query = state.supabase.from("reading_logs").update({ read_at: todayISO }).eq("user_id", user.id).eq("book", book).eq("chapter", chapter);
          if (planId) {
            query = query.eq("plan_id", planId);
          } else {
            query = query.is("plan_id", null);
          }
          await query;
        }
      }
    }
  } else {
    // Remove Log
    state.readingLogs = state.readingLogs.filter(l => !(l.book === book && l.chapter === chapter && (l.plan_id === planId || l.presetKey === presetKey)));
    
    if (state.isSupabaseMode && state.supabase) {
      const { data: { user } } = await state.supabase.auth.getUser();
      if (user) {
        let query = state.supabase.from("reading_logs").delete().eq("user_id", user.id).eq("book", book).eq("chapter", chapter);
        if (planId) {
          query = query.eq("plan_id", planId);
        } else {
          query = query.is("plan_id", null);
        }
        await query;
      }
    }
  }

  if (!state.isSupabaseMode) {
    localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs));
  }

  calculateStreak();
  saveLocalUserStats();

  // If logged in Supabase, update profile stats if necessary (trigger stats view rebuild)
  if (state.isSupabaseMode && state.supabase) {
    syncProfileStatsToSupabase();
  }
}

async function syncProfileStatsToSupabase() {
  const { data: { user } } = await state.supabase.auth.getUser();
  if (user) {
    await state.supabase.from("profiles").upsert({
      id: user.id,
      name: state.currentUser.name,
      great_region: state.currentUser.great_region,
      pastoral_zone: state.currentUser.pastoral_zone,
      small_group: state.currentUser.small_group,
      role: state.currentUser.role,
      updated_at: new Date().toISOString()
    });
  }
}

// ==========================================
// VIEW RENDERING: DASHBOARD
// ==========================================
function updateDashboardView() {
  document.getElementById("user-greeting").textContent = state.currentUser.name || "弟兄姊妹";
  document.getElementById("streak-days").textContent = state.currentUser.streak || "0";

  // Render active plan card
  const planSummaryDiv = document.getElementById("active-plan-summary");
  if (state.activePlan) {
    const progress = state.activePlan.progress || 0;
    const started = isPlanStarted(state.activePlan);
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
    const isPlanAvailable = started || isAdmin;
    const statusText = started 
      ? `進度: ${progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)`
      : `<span style="color: #3b82f6; font-weight: 700;">等待開始</span> (將於 ${state.activePlan.startDate} 開始)`;
      
    planSummaryDiv.innerHTML = `
      <div class="plan-progress-header">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
          <h4 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
          ${started 
            ? '<span style="font-size: 0.7rem; background: #10b981; color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
            : '<span style="font-size: 0.7rem; background: #3b82f6; color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
          }
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.2rem;">
          計畫週期: ${state.activePlan.startDate} ~ ${state.activePlan.endDate} (${state.activePlan.totalDays} 天)
        </p>
        <div class="plan-progress-wrapper" style="margin-top: 1rem;">
          <div class="plan-progress-bar" style="width: ${progress}%;"></div>
        </div>
        <p style="font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;">
          ${statusText}
        </p>
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
        <button class="primary-btn flex-btn" onclick="appRouter.switchTab('plan-view')">查看每日讀經表</button>
        <button class="secondary-btn flex-btn" onclick="appRouter.switchTab('reader-view')" ${isPlanAvailable ? '' : 'disabled style="opacity: 0.6; cursor: not-allowed;"'}>開始讀經</button>
      </div>
    `;
  } else {
    planSummaryDiv.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1rem;">目前沒有進行中的讀經計畫。</p>
        <button class="primary-btn" onclick="appRouter.switchTab('plan-view')">選擇計畫加入</button>
      </div>
    `;
  }

  // Render Pastoral ranking top 5 list
  renderPastoralZoneRankingList();
}

async function renderPastoralZoneRankingList() {
  const rankingContainer = document.getElementById("dashboard-pastoral-ranking");
  rankingContainer.innerHTML = `<div class="empty-state">載入排行中...</div>`;

  let pastoralStats = [];
  if (state.isSupabaseMode && state.supabase) {
    const { data } = await state.supabase.from("view_pastoral_zone_stats").select("*");
    if (data) {
      pastoralStats = data.map(item => ({
        name: item.pastoral_zone,
        total_chapters: item.total_chapters_read
      })).sort((a, b) => b.total_chapters - a.total_chapters);
    }
  } else {
    // Demo Mode
    const mockUser = {
      name: state.currentUser.name,
      great_region: state.currentUser.great_region || "第一大區",
      pastoral_zone: state.currentUser.pastoral_zone || "約書亞牧區",
      small_group: state.currentUser.small_group || "迦勒小組",
      role: state.currentUser.role || "member",
      chapters_read: state.currentUser.chapters_read,
      plan_progress: state.currentUser.plan_progress,
      last_read: state.currentUser.last_read
    };
    pastoralStats = MockStatsService.getPastoralZoneStats(mockUser);
  }

  rankingContainer.innerHTML = "";
  if (pastoralStats.length === 0) {
    rankingContainer.innerHTML = `<div class="empty-state">尚無速讀數據</div>`;
    return;
  }

  pastoralStats.slice(0, 5).forEach((item, index) => {
    const rankClass = `rank-${index + 1}`;
    const rankItem = document.createElement("div");
    rankItem.className = "ranking-item";
    rankItem.innerHTML = `
      <div class="rank-number ${rankClass}">${index + 1}</div>
      <div class="rank-details">
        <div class="rank-name">${item.name || item.pastoral_zone}</div>
      </div>
      <div class="rank-value">${item.total_chapters || 0} 章</div>
    `;
    rankingContainer.appendChild(rankItem);
  });
}

// ==========================================
// VIEW RENDERING: BIBLE READER
// ==========================================
function initReaderControls() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");

  // Load books list
  populateBookSelector("all");

  testamentSelect.addEventListener("change", (e) => {
    populateBookSelector(e.target.value);
    populateChapterSelector();
  });

  bookSelect.addEventListener("change", () => {
    populateChapterSelector();
    saveReaderPreferences();
    renderReaderText();
  });

  chapterSelect.addEventListener("change", () => {
    state.readerState.chapter = parseInt(chapterSelect.value);
    saveReaderPreferences();
    renderReaderText();
  });

  // Font adjustments
  document.getElementById("increase-font").addEventListener("click", () => {
    if (state.readerState.fontSize < 36) {
      state.readerState.fontSize += 2;
      updateReaderFontSize();
    }
  });

  document.getElementById("decrease-font").addEventListener("click", () => {
    if (state.readerState.fontSize > 12) {
      state.readerState.fontSize -= 2;
      updateReaderFontSize();
    }
  });

  // Prev / Next Chapter Buttons
  document.getElementById("prev-chapter-btn").addEventListener("click", () => {
    navigateToChapter(-1);
  });

  document.getElementById("next-chapter-btn").addEventListener("click", () => {
    navigateToChapter(1);
  });

  // Mark chapter read checkbox
  const markReadBtn = document.getElementById("mark-read-btn");
  markReadBtn.addEventListener("click", async () => {
    const isChecked = !markReadBtn.classList.contains("checked");
    const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
    
    loader.show(isChecked ? "標記已讀中..." : "取消標記中...");
    await logChapterRead(bookObj.name, state.readerState.chapter, isChecked);
    
    if (isChecked) {
      markReadBtn.classList.add("checked");
    } else {
      markReadBtn.classList.remove("checked");
    }
    
    // Auto update reading plan progress checkbox if exists
    if (state.activePlan) {
      const planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
      updatePlanCheckboxState(planDayChKey, isChecked);
    }
    loader.hide();
  });
}

function populateBookSelector(filter) {
  const bookSelect = document.getElementById("reader-book-select");
  bookSelect.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter === "all" || book.section === filter) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = `${book.name} (${book.abbrev})`;
      if (book.id === state.readerState.bookId) {
        option.selected = true;
      }
      bookSelect.appendChild(option);
    }
  });
}

function populateChapterSelector() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  
  const bookId = parseInt(bookSelect.value);
  state.readerState.bookId = bookId;
  
  const book = BIBLE_BOOKS.find(b => b.id === bookId);
  chapterSelect.innerHTML = "";

  for (let i = 1; i <= book.chapters; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `${i} 章`;
    if (i === state.readerState.chapter) {
      option.selected = true;
    }
    chapterSelect.appendChild(option);
  }

  // Ensure chapter fits within scope
  if (state.readerState.chapter > book.chapters) {
    state.readerState.chapter = 1;
    if (chapterSelect.options.length > 0) {
      chapterSelect.options[0].selected = true;
    }
  }
}

function saveReaderPreferences() {
  localStorage.setItem("reader_state", JSON.stringify({
    bookId: state.readerState.bookId,
    chapter: state.readerState.chapter
  }));
}

function updateReaderFontSize() {
  document.getElementById("bible-content").style.fontSize = state.readerState.fontSize + "px";
  document.getElementById("font-size-label").textContent = state.readerState.fontSize + "px";
  localStorage.setItem("reader_font_size", state.readerState.fontSize);
}

function navigateToChapter(direction) {
  const currentBook = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  let newChapter = state.readerState.chapter + direction;
  
  if (newChapter < 1) {
    // Go to previous book
    const prevBookId = state.readerState.bookId - 1;
    if (prevBookId >= 1) {
      const prevBook = BIBLE_BOOKS.find(b => b.id === prevBookId);
      state.readerState.bookId = prevBookId;
      state.readerState.chapter = prevBook.chapters;
      
      // Update testament selector filter if necessary
      document.getElementById("reader-testament-select").value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else if (newChapter > currentBook.chapters) {
    // Go to next book
    const nextBookId = state.readerState.bookId + 1;
    if (nextBookId <= 66) {
      state.readerState.bookId = nextBookId;
      state.readerState.chapter = 1;
      
      document.getElementById("reader-testament-select").value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else {
    // Stay in same book
    state.readerState.chapter = newChapter;
    document.getElementById("reader-chapter-select").value = newChapter;
    saveReaderPreferences();
    renderReaderText();
  }
}

async function renderReaderText() {
  const container = document.getElementById("bible-content");
  const heading = document.getElementById("bible-title");
  const markReadBtn = document.getElementById("mark-read-btn");
  
  const book = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  const chapter = state.readerState.chapter;

  heading.textContent = `${book.name} ${chapter}章`;
  container.innerHTML = `<div class="loader-inline">讀取經文中...</div>`;
  
  // Set checked button status
  const isRead = state.readingLogs.some(l => l.book === book.name && l.chapter === chapter);
  if (isRead) {
    markReadBtn.classList.add("checked");
  } else {
    markReadBtn.classList.remove("checked");
  }

  // Load Bible text
  const data = await fetchBibleChapter(book.eng, chapter);
  
  container.innerHTML = "";
  data.verses.forEach(v => {
    const verseDiv = document.createElement("div");
    verseDiv.className = "bible-verse";
    
    // Highlight if marked
    const highlightKey = `${book.name}_${chapter}_${v.verse}`;
    if (state.highlights[highlightKey]) {
      verseDiv.style.backgroundColor = state.highlights[highlightKey];
      verseDiv.classList.add("selected");
    }

    verseDiv.innerHTML = `<span class="verse-num">${v.verse}</span><span class="verse-text">${v.text}</span>`;
    
    // Add Click listeners for highlighting verses
    verseDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      showContextToolbar(verseDiv, highlightKey);
    });

    container.appendChild(verseDiv);
  });

  // Make sure we apply font size preference
  updateReaderFontSize();
}

// Highlight Menu Toolbars
function showContextToolbar(verseElement, highlightKey) {
  const toolbar = document.getElementById("context-toolbar");
  
  // Display floating menu near clicked element
  const rect = verseElement.getBoundingClientRect();
  toolbar.style.top = `${window.scrollY + rect.top}px`;
  toolbar.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
  toolbar.classList.add("active");

  // Attach button triggers
  const actionHandler = (e) => {
    e.stopPropagation();
    const action = e.target.getAttribute("data-action");
    const color = e.target.style.backgroundColor;

    if (action === "highlight") {
      verseElement.style.backgroundColor = color;
      verseElement.classList.add("selected");
      state.highlights[highlightKey] = color;
    } else if (action === "clear") {
      verseElement.style.backgroundColor = "";
      verseElement.classList.remove("selected");
      delete state.highlights[highlightKey];
    }
    
    localStorage.setItem("bible_highlights", JSON.stringify(state.highlights));
    
    // Remove floating menu
    toolbar.classList.remove("active");
    document.removeEventListener("click", documentClickHandler);
  };

  // Select all actions inside toolbar
  toolbar.querySelectorAll(".toolbar-action").forEach(btn => {
    btn.onclick = actionHandler;
  });

  const documentClickHandler = () => {
    toolbar.classList.remove("active");
    document.removeEventListener("click", documentClickHandler);
  };

  // Dismiss on next click outside
  setTimeout(() => {
    document.addEventListener("click", documentClickHandler);
  }, 10);
}

// ==========================================
// VIEW RENDERING: READING PLANS
// ==========================================
function initPlanControls() {
  // Render the pre-designed plans list
  renderPresetPlansList();

  // Delete plan
  const deleteBtn = document.getElementById("delete-plan-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("確定要放棄目前的讀經計畫嗎？已讀章節紀錄仍會保留。")) {
        return;
      }

      loader.show("刪除計畫中...");
      if (state.isSupabaseMode && state.supabase) {
        const { data: { user } } = await state.supabase.auth.getUser();
        if (user && state.activePlan && state.activePlan.id) {
          await state.supabase.from("reading_plans").delete().match({ id: state.activePlan.id });
        }
      }
      
      if (state.activePlan && state.activePlans) {
        state.activePlans = state.activePlans.filter(p => p.presetKey !== state.activePlan.presetKey);
      }
      
      if (!state.isSupabaseMode) {
        localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      }
      
      if (state.activePlans && state.activePlans.length > 0) {
        state.activePlan = state.activePlans[0];
        localStorage.setItem("selected_plan_key", state.activePlan.presetKey);
      } else {
        state.activePlan = null;
        localStorage.removeItem("selected_plan_key");
      }
      
      saveLocalUserStats();
      
      loader.hide();
      renderPlanView();
      updateDashboardView();
    });
  }
}

// Helper to find preset key by name
function getPresetKeyByName(name) {
  if (!name) return null;
  const found = Object.entries(CHURCH_PLAN_PRESETS).find(([key, preset]) => preset.name === name);
  return found ? found[0] : null;
}

// Global active plan switcher
window.changeActivePlan = function(key) {
  if (!state.activePlans) return;
  const plan = state.activePlans.find(p => p.presetKey === key);
  if (plan) {
    state.activePlan = plan;
    localStorage.setItem("selected_plan_key", key);
    renderPlanView();
    updateDashboardView();
  }
};

// Helper to calculate days between two dates inclusive
function calculateDaysBetween(start, end) {
  const sDate = new Date(start);
  const eDate = new Date(end);
  const diffTime = Math.abs(eDate - sDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

// Render pre-designed church plans in the right side panel
function renderPresetPlansList() {
  const container = document.getElementById("preset-plans-list");
  if (!container) return;

  container.innerHTML = "";

  Object.entries(CHURCH_PLAN_PRESETS).forEach(([key, preset]) => {
    // Check if this preset plan is already joined in our activePlans list
    const isJoined = state.activePlans && state.activePlans.some(p => p.presetKey === key || getPresetKeyByName(p.name) === key);

    const card = document.createElement("div");
    card.className = "preset-plan-item-card";
    card.style = `
      background: rgba(255, 255, 255, 0.45);
      border: 1px solid var(--border-card);
      border-radius: var(--radius-sm);
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      transition: all 0.2s ease;
      cursor: default;
    `;

    card.onmouseenter = () => {
      card.style.background = "rgba(99, 102, 241, 0.05)";
      card.style.borderColor = "var(--primary-color)";
    };
    card.onmouseleave = () => {
      card.style.background = "rgba(255, 255, 255, 0.45)";
      card.style.borderColor = "var(--border-card)";
    };

    const bookBadges = preset.books.map(b => `<span style="font-size: 0.72rem; background: var(--border-card); color: var(--text-primary); padding: 0.15rem 0.4rem; border-radius: 4px; display: inline-block;">${b}</span>`).join(" ");

    const started = isPlanStarted(preset);
    const badgeHtml = isJoined 
      ? (started 
          ? '<span style="font-size: 0.7rem; background: #10b981; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
          : '<span style="font-size: 0.7rem; background: #3b82f6; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
        )
      : '';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
        <h4 style="margin: 0; font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">${preset.name}</h4>
        ${badgeHtml}
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">
        📅 ${preset.startDate} ~ ${preset.endDate} (${calculateDaysBetween(preset.startDate, preset.endDate)} 天)
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.2rem 0;">
        ${bookBadges}
      </div>
      ${!isJoined ? `
        <button class="primary-btn join-preset-btn" data-key="${key}" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; margin-top: 0.3rem; align-self: flex-end;">
          加入挑戰
        </button>
      ` : `
        <button class="secondary-btn" disabled style="font-size: 0.78rem; padding: 0.35rem 0.75rem; margin-top: 0.3rem; align-self: flex-end; cursor: not-allowed;">
          已加入
        </button>
      `}
    `;

    container.appendChild(card);
  });

  // Attach button click events
  container.querySelectorAll(".join-preset-btn").forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-key");
      await joinPresetPlan(key);
    };
  });
}

// Join the specified pre-designed plan
async function joinPresetPlan(key) {
  if (!CHURCH_PLAN_PRESETS[key]) return;
  const preset = CHURCH_PLAN_PRESETS[key];

  loader.show("加入挑戰計畫中...");

  const planName = preset.name;
  const startDate = preset.startDate;
  const endDate = preset.endDate;
  const selectedBooks = preset.books;

  let newPlanObj = null;

  if (state.isSupabaseMode && state.supabase) {
    try {
      const { data: { user } } = await state.supabase.auth.getUser();
      if (user) {
        // Allow parallel plans (do not delete other plans)
        const { data: dbPlan, error } = await state.supabase.from("reading_plans").insert({
          user_id: user.id,
          name: planName,
          start_date: startDate,
          end_date: endDate,
          target_books: selectedBooks
        }).select().single();

        if (error) {
          console.error("Failed to insert plan in Supabase:", error);
        } else {
          newPlanObj = generatePlanObject(planName, startDate, endDate, selectedBooks, key);
          newPlanObj.id = dbPlan.id;
          if (!state.activePlans) state.activePlans = [];
          state.activePlans.push(newPlanObj);
          state.activePlan = newPlanObj;
          localStorage.setItem("selected_plan_key", key);
        }
      }
    } catch (e) {
      console.error("Error inserting plan in Supabase:", e);
    }
  } else {
    // Local mode
    newPlanObj = generatePlanObject(planName, startDate, endDate, selectedBooks, key);
    if (!state.activePlans) state.activePlans = [];
    state.activePlans.push(newPlanObj);
    state.activePlan = newPlanObj;
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
    localStorage.setItem("selected_plan_key", key);
  }

  calculatePlanProgress();
  saveLocalUserStats();

  loader.hide();
  renderPlanView();
  updateDashboardView();
  
  const started = isPlanStarted(newPlanObj);
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  if (started) {
    alert(`成功加入「${planName}」！計畫已開始。`);
  } else if (isAdmin) {
    alert(`成功預約加入「${planName}」！計畫將於 ${startDate} 開始。您目前為系統管理員，可提早進行測試。`);
  } else {
    alert(`成功預約加入「${planName}」！計畫將於 ${startDate} 開始。`);
  }
}

// Generate complete plan object containing daily schedules
function generatePlanObject(name, startDate, endDate, selectedBooks, presetKey = null) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  // Compile all chapters to read
  const allChapters = [];
  selectedBooks.forEach(bookName => {
    if (bookName === "詩篇 1-110") {
      for (let i = 1; i <= 110; i++) {
        allChapters.push({ book: "詩篇", chapter: i });
      }
    } else if (bookName === "詩篇 111-150") {
      for (let i = 111; i <= 150; i++) {
        allChapters.push({ book: "詩篇", chapter: i });
      }
    } else {
      const book = BIBLE_BOOKS.find(b => b.name === bookName);
      if (book) {
        for (let i = 1; i <= book.chapters; i++) {
          allChapters.push({ book: book.name, chapter: i });
        }
      }
    }
  });

  const totalChapters = allChapters.length;
  const dailyChapters = Array.from({ length: totalDays }, () => []);

  // Distribute chapters evenly across days
  // E.g., using round-robin or simple chunking
  const chsPerDay = Math.floor(totalChapters / totalDays);
  let remainder = totalChapters % totalDays;
  let chIdx = 0;

  for (let d = 0; d < totalDays; d++) {
    const todayCount = chsPerDay + (remainder > 0 ? 1 : 0);
    remainder--;
    
    for (let c = 0; c < todayCount; c++) {
      if (chIdx < totalChapters) {
        dailyChapters[d].push(allChapters[chIdx]);
        chIdx++;
      }
    }
  }

  // Format daily list
  const days = dailyChapters.map((chapters, index) => {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + index);
    const dateStr = dayDate.toISOString().substring(5, 10).replace("-", "/"); // MM/DD
    
    return {
      dayNum: index + 1,
      date: dateStr,
      chapters: chapters.map(ch => ({
        book: ch.book,
        chapter: ch.chapter,
        key: `${ch.book}_${ch.chapter}`
      }))
    };
  });

  return {
    name,
    startDate,
    endDate,
    totalDays,
    totalChapters,
    completedChapters: 0,
    progress: 0,
    days,
    presetKey
  };
}

// Recalculate complete reading plan stats based on current user reading logs
function calculatePlanProgress() {
  calculateAllPlansProgress();
  if (state.activePlan && state.activePlans) {
    const currentInList = state.activePlans.find(p => p.presetKey === state.activePlan.presetKey);
    if (currentInList) {
      state.activePlan = currentInList;
    }
  }
}

// Helper to check if plan has started relative to today's local date
function isPlanStarted(plan) {
  if (!plan) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return todayStr >= plan.startDate;
}

// Recalculate complete reading plan stats based on current user reading logs for ALL joined plans
function calculateAllPlansProgress() {
  if (!state.activePlans || state.activePlans.length === 0) {
    state.activePlan = null;
    return;
  }

  state.activePlans.forEach(plan => {
    let completed = 0;
    const started = isPlanStarted(plan);
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        // A chapter is read in this plan if there is a log for this book/chapter associated with this plan.
        // Fallback for older logs: if log has no presetKey/plan_id, it counts.
        const isRead = state.readingLogs.some(l => {
          const logDate = l.read_at.substring(0, 10);
          const isPlanMatch = !l.presetKey || (l.presetKey === plan.presetKey) || (plan.id && l.plan_id === plan.id);
          const isAdmin = state.currentUser && state.currentUser.role === 'admin';
          return l.book === ch.book && l.chapter === ch.chapter && isPlanMatch && (logDate >= plan.startDate || isAdmin);
        });
        ch.isRead = isRead;
        if (isRead) completed++;
      });
    });
    plan.completedChapters = completed;
    plan.progress = Math.round((completed / plan.totalChapters) * 100) || 0;
  });

  if (!state.isSupabaseMode) {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
  }
}

// Render Reading Plan View
function renderPlanView() {
  const container = document.getElementById("plan-tracker-container");
  const deleteBtn = document.getElementById("delete-plan-btn");

  if (!state.activePlan) {
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 3rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">您目前沒有進行中的讀經計畫。</p>
        <p style="font-size: 0.9rem; color: var(--text-muted);">請在右側欄位選擇欲加入的教會季度計畫！</p>
      </div>
    `;
    deleteBtn.classList.add("hidden");
    renderPresetPlansList();
    return;
  }

  deleteBtn.classList.remove("hidden");
  
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const started = isPlanStarted(state.activePlan) || isAdmin;
  const isActuallyStarted = isPlanStarted(state.activePlan);
  
  let selectHtml = "";
  if (state.activePlans && state.activePlans.length > 1) {
    selectHtml = `
      <div class="plan-selector-bar" style="margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.3); padding: 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); white-space: nowrap;">切換計畫：</label>
        <select id="active-plan-select" style="flex: 1; font-size: 0.85rem; padding: 0.35rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-card); background: var(--bg-card); color: var(--text-primary); cursor: pointer;" onchange="window.changeActivePlan(this.value)">
          ${state.activePlans.map(plan => {
            const planStarted = isPlanStarted(plan);
            const statusLabel = planStarted ? "進行中" : "等待開始";
            const selected = plan.presetKey === state.activePlan.presetKey ? "selected" : "";
            return `<option value="${plan.presetKey}" ${selected}>${plan.name} (${statusLabel})</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }

  let warningBanner = "";
  if (!isActuallyStarted) {
    if (isAdmin) {
      warningBanner = `
        <div class="not-started-banner" style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: var(--radius-sm); padding: 0.8rem; margin: 1rem 0; color: var(--text-primary); font-size: 0.85rem; font-weight: 600; line-height: 1.4;">
          💡 此計畫尚未開始 (開始日期：${state.activePlan.startDate})。您目前以<strong>系統管理員 (Admin)</strong> 身分進行測試，已為您解除限制。
        </div>
      `;
    } else {
      warningBanner = `
        <div class="not-started-banner" style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; border-radius: var(--radius-sm); padding: 0.8rem; margin: 1rem 0; color: var(--text-primary); font-size: 0.85rem; font-weight: 600; line-height: 1.4;">
          ⚠️ 此計畫尚未開始 (開始日期：${state.activePlan.startDate})。開始前無法標記讀經進度。
        </div>
      `;
    }
  }
  
  let html = selectHtml + `
    <div class="plan-progress-header">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
        <h4 style="font-size: 1.3rem; font-weight: 800; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
        ${isActuallyStarted
          ? '<span style="font-size: 0.75rem; background: #10b981; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
          : '<span style="font-size: 0.75rem; background: #3b82f6; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
        }
      </div>
      <div class="plan-progress-wrapper" style="margin-top: 1rem;">
        <div class="plan-progress-bar" style="width: ${state.activePlan.progress}%;"></div>
      </div>
      <p style="font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;">
        已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)
      </p>
    </div>
    
    ${warningBanner}
    
    <div class="days-scroll-list" style="max-height: 480px; overflow-y: auto; margin-top: 1.5rem; padding-right: 0.5rem;">
  `;

  state.activePlan.days.forEach(day => {
    const allDone = day.chapters.every(ch => ch.isRead);
    const badgeClass = allDone ? "day-badge complete" : "day-badge";
    const badgeText = allDone ? "已完成" : "未完";

    html += `
      <div class="day-section">
        <div class="day-title-flex" onclick="toggleDaySection(this)">
          <div class="day-title">Day ${day.dayNum} <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-left: 0.5rem;">(${day.date})</span></div>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <div class="day-chapters-list">
    `;

    day.chapters.forEach(ch => {
      const isChecked = ch.isRead ? "checked" : "";
      const labelClass = ch.isRead ? "chapter-checkbox-item checked" : "chapter-checkbox-item";
      const isDisabled = started ? "" : "disabled style='cursor: not-allowed; opacity: 0.6;'";
      
      html += `
        <label class="${labelClass}" data-key="${ch.key}" ${!started ? 'style="opacity: 0.6; cursor: not-allowed;"' : ''}>
          <input type="checkbox" value="${ch.key}" ${isChecked} ${isDisabled} onchange="togglePlanChapterCheckbox(this, '${ch.book}', ${ch.chapter})">
          <span>${ch.book} ${ch.chapter}章</span>
          <button class="text-link-btn" style="margin-left: auto; font-size: 0.75rem; font-weight: 600;" onclick="readChapterDirect('${ch.book}', ${ch.chapter})">閱讀</button>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
  renderPresetPlansList();
}

function toggleDaySection(headerEl) {
  const list = headerEl.nextElementSibling;
  list.classList.toggle("hidden");
}

// Handle checkbox triggers on Plan layout
async function togglePlanChapterCheckbox(cb, book, chapter) {
  const isChecked = cb.checked;
  const label = cb.parentElement;
  
  if (isChecked) {
    label.classList.add("checked");
  } else {
    label.classList.remove("checked");
  }

  // Save to db
  loader.show("記錄中...");
  await logChapterRead(book, chapter, isChecked);
  
  // Re-calc plan progress
  calculatePlanProgress();
  
  // Refresh stats
  saveLocalUserStats();
  
  // Update progress bar UI on screen instantly without redrawing entire list
  const bar = document.querySelector("#plan-tracker-container .plan-progress-bar");
  const percentText = document.querySelector("#plan-tracker-container p");
  
  if (bar && percentText) {
    bar.style.width = `${state.activePlan.progress}%`;
    percentText.innerHTML = `已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)`;
  }

  // Update day badges
  const daySection = label.closest(".day-section");
  if (daySection) {
    const checkboxes = daySection.querySelectorAll("input[type='checkbox']");
    const allChecked = Array.from(checkboxes).every(box => box.checked);
    const badge = daySection.querySelector(".day-badge");
    if (allChecked) {
      badge.className = "day-badge complete";
      badge.textContent = "已完成";
    } else {
      badge.className = "day-badge";
      badge.textContent = "未完";
    }
  }

  loader.hide();
}

function updatePlanCheckboxState(key, isChecked) {
  const checkbox = document.querySelector(`.chapter-checkbox-item[data-key="${key}"] input`);
  if (checkbox) {
    checkbox.checked = isChecked;
    const label = checkbox.parentElement;
    if (isChecked) {
      label.classList.add("checked");
    } else {
      label.classList.remove("checked");
    }
    // Re-evaluate day badge
    const daySection = label.closest(".day-section");
    if (daySection) {
      const checkboxes = daySection.querySelectorAll("input[type='checkbox']");
      const allChecked = Array.from(checkboxes).every(box => box.checked);
      const badge = daySection.querySelector(".day-badge");
      if (allChecked) {
        badge.className = "day-badge complete";
        badge.textContent = "已完成";
      } else {
        badge.className = "day-badge";
        badge.textContent = "未完";
      }
    }
  }
}

function readChapterDirect(bookName, chapter) {
  const book = BIBLE_BOOKS.find(b => b.name === bookName);
  if (book) {
    state.readerState.bookId = book.id;
    state.readerState.chapter = chapter;
    
    document.getElementById("reader-testament-select").value = "all";
    populateBookSelector("all");
    populateChapterSelector();
    saveReaderPreferences();
    
    appRouter.switchTab("reader-view");
  }
}

// ==========================================
// VIEW RENDERING: PASTORAL STATS & CHARTS
// ==========================================
// Helper to filter stats list based on the currentUser role and scope
function filterUsersByRole(users, currentUser) {
  if (!currentUser) return users;
  const role = currentUser.role || "member";
  
  if (role === "senior_pastor" || role === "admin") {
    return users; // Full access
  }
  
  if (role === "great_zone_leader") {
    return users.filter(u => u.great_region === currentUser.great_region);
  }
  
  if (role === "zone_leader") {
    return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone);
  }
  
  if (role === "group_leader") {
    return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone && u.small_group === currentUser.small_group);
  }
  
  // member
  return users.filter(u => u.name === currentUser.name);
}

// ==========================================
// VIEW RENDERING: PASTORAL STATS & CHARTS
// ==========================================
async function updateStatsView() {
  loader.show("載入統計數據中...");
  
  let pastoralStats = [];
  let rawAllUsers = [];

  const mockUser = {
    name: state.currentUser.name,
    great_region: state.currentUser.great_region || "第一大區",
    pastoral_zone: state.currentUser.pastoral_zone || "約書亞牧區",
    small_group: state.currentUser.small_group || "迦勒小組",
    role: state.currentUser.role || "member",
    chapters_read: state.currentUser.chapters_read,
    plan_progress: state.currentUser.plan_progress,
    last_read: state.currentUser.last_read
  };

  const role = mockUser.role;

  if (state.isSupabaseMode && state.supabase) {
    // 1. Fetch User Profiles, Plans & Logs from DB
    const { data: usersProfiles } = await state.supabase.from("profiles").select("*");
    const { data: allLogs } = await state.supabase.from("reading_logs").select("user_id, book, chapter");
    const { data: allPlans } = await state.supabase.from("reading_plans").select("user_id, target_books");

    if (usersProfiles) {
      rawAllUsers = usersProfiles.map(profile => {
        const uLogs = allLogs ? allLogs.filter(l => l.user_id === profile.id) : [];
        const uPlan = allPlans ? allPlans.find(p => p.user_id === profile.id) : null;
        
        let planProgress = 0;
        if (uPlan && uPlan.target_books && uPlan.target_books.length > 0) {
          let totalChapters = 0;
          uPlan.target_books.forEach(bName => {
            const b = BIBLE_BOOKS.find(book => book.name === bName);
            if (b) totalChapters += b.chapters;
          });
          
          if (totalChapters > 0) {
            planProgress = Math.round((uLogs.length / totalChapters) * 100) || 0;
          }
        }

        return {
          name: profile.name,
          great_region: profile.great_region,
          pastoral_zone: profile.pastoral_zone,
          small_group: profile.small_group,
          role: profile.role,
          chapters_read: uLogs.length,
          plan_progress: planProgress,
          streak: 0,
          last_read: uLogs.length > 0 ? new Date().toISOString() : null
        };
      });
    }

    // Apply RBAC filtering on the fetched dataset
    rawAllUsers = filterUsersByRole(rawAllUsers, mockUser);

    // Compute pastoral stats aggregation from raw filtered profiles
    const zoneMap = {};
    rawAllUsers.forEach(u => {
      const z = u.pastoral_zone;
      if (!z) return;
      if (!zoneMap[z]) {
        zoneMap[z] = {
          name: z,
          great_region: u.great_region,
          member_count: 0,
          total_chapters: 0,
          avg_progress: 0,
          active_count: 0,
          progress_sum: 0
        };
      }
      const stats = zoneMap[z];
      stats.member_count += 1;
      stats.total_chapters += u.chapters_read;
      stats.progress_sum += u.plan_progress;
      stats.active_count += 1;
    });

    Object.keys(zoneMap).forEach(k => {
      const stats = zoneMap[k];
      stats.avg_progress = Math.round(stats.progress_sum / stats.member_count) || 0;
    });

    pastoralStats = Object.values(zoneMap).sort((a, b) => b.total_chapters - a.total_chapters);

  } else {
    // Demo Mode
    rawAllUsers = MockStatsService.getAllUsers(mockUser);
    pastoralStats = MockStatsService.getPastoralZoneStats(mockUser);
  }

  // 1. Update Mini Card Labels based on User Role
  const miniCardLabels = document.querySelectorAll('.stats-overview-row .label');
  if (miniCardLabels.length === 3) {
    if (role === "senior_pastor" || role === "admin") {
      miniCardLabels[0].textContent = "全教會總閱讀章數";
      miniCardLabels[1].textContent = "全教會參與人數";
      miniCardLabels[2].textContent = "全教會本週活躍人數";
    } else if (role === "great_zone_leader") {
      miniCardLabels[0].textContent = "本大區總閱讀章數";
      miniCardLabels[1].textContent = "本大區參與人數";
      miniCardLabels[2].textContent = "本大區本週活躍人數";
    } else if (role === "zone_leader") {
      miniCardLabels[0].textContent = "本牧區總閱讀章數";
      miniCardLabels[1].textContent = "本牧區參與人數";
      miniCardLabels[2].textContent = "本牧區本週活躍人數";
    } else if (role === "group_leader") {
      miniCardLabels[0].textContent = "本小組總閱讀章數";
      miniCardLabels[1].textContent = "本小組參與人數";
      miniCardLabels[2].textContent = "本小組本週活躍人數";
    } else {
      miniCardLabels[0].textContent = "個人總閱讀章數";
      miniCardLabels[1].textContent = "個人速讀排名";
      miniCardLabels[2].textContent = "個人連續讀經天數";
    }
  }

  // 2. Render Mini Card values
  if (role === "member") {
    const allGlobalUsers = state.isSupabaseMode ? rawAllUsers : MockStatsService.getAllUsers(null);
    allGlobalUsers.sort((a, b) => b.chapters_read - a.chapters_read);
    const myIndex = allGlobalUsers.findIndex(u => u.name === mockUser.name);
    const myRank = myIndex !== -1 ? (myIndex + 1) : "無";

    document.getElementById("stats-total-read").textContent = mockUser.chapters_read + " 章";
    document.getElementById("stats-total-members").textContent = myRank + " / " + allGlobalUsers.length + " 名";
    document.getElementById("stats-active-members").textContent = (state.currentUser.streak || 0) + " 天";
  } else {
    const totalChaptersAll = pastoralStats.reduce((sum, item) => sum + (item.total_chapters || 0), 0);
    const totalMembers = rawAllUsers.length;
    const totalActive = rawAllUsers.filter(u => {
      if (!u.last_read) return false;
      const lastReadDate = new Date(u.last_read);
      const today = new Date();
      const diffTime = Math.abs(today - lastReadDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 2;
    }).length;

    document.getElementById("stats-total-read").textContent = totalChaptersAll + " 章";
    document.getElementById("stats-total-members").textContent = totalMembers + " 人";
    document.getElementById("stats-active-members").textContent = totalActive + " 人";
  }

  // 3. Render Roster Details Table
  renderRosterTable(rawAllUsers);

  // 4. Handle Chart visibility and rendering
  const chartsContainer = document.getElementById("pastoral-rank-chart").closest('.grid-layout');
  const groupChartContainer = document.getElementById("group-stats-chart").closest('.grid-layout');
  const zoneSelectGroup = document.getElementById("stats-zone-selector");

  if (role === "member") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.add("hidden");
  } else if (role === "group_leader") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;
    updateGroupChart(mockUser.pastoral_zone);
  } else if (role === "zone_leader") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;
    updateGroupChart(mockUser.pastoral_zone);
  } else if (role === "great_zone_leader") {
    chartsContainer.classList.remove("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.disabled = false;
    
    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  } else {
    // admin / senior pastor
    chartsContainer.classList.remove("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.disabled = false;
    
    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  }

  loader.hide();
}

function renderRosterTable(users) {
  const tbody = document.getElementById("stats-members-table-body");
  tbody.innerHTML = "";

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">尚無使用者資料</td></tr>`;
    return;
  }

  // Sort by chapters read descending
  users.sort((a, b) => b.chapters_read - a.chapters_read).forEach(user => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${user.name}</strong></td>
      <td>${user.pastoral_zone || "無"}</td>
      <td>${user.small_group || "無"}</td>
      <td><span style="font-weight:700; color: var(--primary-color);">${user.chapters_read}</span> 章</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.8rem; font-weight:700;">${user.plan_progress}%</span>
          <div style="flex:1; width:50px; height:6px; background:#e2e8f0; border-radius:5px; overflow:hidden;">
            <div style="width:${user.plan_progress}%; height:100%; background: var(--accent-gradient);"></div>
          </div>
        </div>
      </td>
      <td>🔥 ${user.streak || 0} 天</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateStatsZoneSelector(zones) {
  const selector = document.getElementById("stats-zone-selector");
  selector.innerHTML = "";

  zones.forEach(zone => {
    const option = document.createElement("option");
    option.value = zone.name;
    option.textContent = zone.name;
    selector.appendChild(option);
  });

  // Attach change listener for updating group charts
  selector.onchange = () => {
    updateGroupChart(selector.value);
  };

  if (zones.length > 0) {
    updateGroupChart(zones[0].name);
  }
}

function renderCharts(zoneStats) {
  const ctxRank = document.getElementById("pastoral-rank-chart").getContext("2d");
  const ctxProgress = document.getElementById("pastoral-progress-chart").getContext("2d");

  // Destory previous instances to avoid overlaps
  if (state.statsCharts.rank) state.statsCharts.rank.destroy();
  if (state.statsCharts.progress) state.statsCharts.progress.destroy();

  const labels = zoneStats.map(z => z.name);
  const chaptersData = zoneStats.map(z => z.total_chapters);
  const progressData = zoneStats.map(z => z.avg_progress);

  // Styling helpers
  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  // Chart 1: Ranking Chart
  state.statsCharts.rank = new Chart(ctxRank, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計速讀章數',
        data: chaptersData,
        backgroundColor: [
          'rgba(99, 102, 241, 0.85)',
          'rgba(16, 185, 129, 0.85)',
          'rgba(245, 158, 11, 0.85)',
          'rgba(239, 68, 68, 0.85)'
        ],
        borderRadius: 8,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor }, grid: { color: gridColor } }
      }
    }
  });

  // Chart 2: Average Progress Chart
  state.statsCharts.progress = new Chart(ctxProgress, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: '平均進度 (%)',
        data: progressData,
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        borderColor: 'rgba(99, 102, 241, 0.9)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        r: {
          angleLines: { color: gridColor },
          grid: { color: gridColor },
          pointLabels: { color: fontColor, font: { weight: 'bold' } },
          ticks: { backdropColor: 'transparent', color: fontColor, min: 0, max: 100 }
        }
      }
    }
  });
}

async function updateGroupChart(zoneName) {
  const ctxGroup = document.getElementById("group-stats-chart").getContext("2d");
  if (state.statsCharts.group) state.statsCharts.group.destroy();

  let groupStats = [];
  const mockUser = {
    name: state.currentUser.name,
    pastoral_zone: state.currentUser.pastoral_zone || "約書亞牧區",
    small_group: state.currentUser.small_group || "迦勒小組",
    chapters_read: state.currentUser.chapters_read,
    plan_progress: state.currentUser.plan_progress,
    last_read: state.currentUser.last_read
  };

  if (state.isSupabaseMode && state.supabase) {
    const { data } = await state.supabase
      .from("view_small_group_stats")
      .select("*")
      .eq("pastoral_zone", zoneName);

    if (data) {
      groupStats = data.map(item => ({
        name: item.small_group,
        total_chapters: item.total_chapters_read
      })).sort((a, b) => b.total_chapters - a.total_chapters);
    }
  } else {
    // Demo Mode
    groupStats = MockStatsService.getSmallGroupStats(zoneName, mockUser);
  }

  const labels = groupStats.map(g => g.name);
  const data = groupStats.map(g => g.total_chapters);

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  state.statsCharts.group = new Chart(ctxGroup, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計章數',
        data: data,
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { color: gridColor } },
        y: { ticks: { color: fontColor }, grid: { display: false } }
      }
    }
  });
}

// ==========================================
// VIEW RENDERING: PROFILE & SETTINGS
// ==========================================
// ==========================================
// VIEW RENDERING: PROFILE & SETTINGS
// ==========================================
function renderProfileView() {
  document.getElementById("profile-name").value = state.currentUser.name || "";
  
  const greatRegionSelect = document.getElementById("profile-great-region");
  const customGreatRegionInput = document.getElementById("profile-great-region-custom");
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const roleDisplay = document.getElementById("profile-role-display");

  // Set role display text
  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    senior_pastor: "主任牧師 (最高權限)",
    admin: "系統管理員"
  };
  roleDisplay.value = roleNames[state.currentUser.role] || "一般組員";

  // 1. Determine Great Region value
  const greatRegionsList = ["第一大區", "第二大區"];
  const userGreatRegion = state.currentUser.great_region;

  if (userGreatRegion) {
    if (greatRegionsList.includes(userGreatRegion)) {
      greatRegionSelect.value = userGreatRegion;
      customGreatRegionInput.classList.add("hidden");
    } else {
      greatRegionSelect.value = "custom";
      customGreatRegionInput.classList.remove("hidden");
      customGreatRegionInput.value = userGreatRegion;
    }
  } else {
    greatRegionSelect.value = "";
    customGreatRegionInput.classList.add("hidden");
  }

  // Populate zones dynamically based on Great Region
  populateProfileZones(greatRegionSelect.value);

  // Attach change listener to great region
  greatRegionSelect.onchange = () => {
    if (greatRegionSelect.value === "custom") {
      customGreatRegionInput.classList.remove("hidden");
    } else {
      customGreatRegionInput.classList.add("hidden");
    }
    populateProfileZones(greatRegionSelect.value);
    populateProfileGroupSelector();
  };

  customGreatRegionInput.oninput = () => {
    populateProfileZones("custom");
  };

  zoneSelect.onchange = () => {
    if (zoneSelect.value === "custom") {
      customZoneInput.classList.remove("hidden");
    } else {
      customZoneInput.classList.add("hidden");
    }
    populateProfileGroupSelector();
  };

  groupSelect.onchange = () => {
    if (groupSelect.value === "custom") {
      customGroupInput.classList.remove("hidden");
    } else {
      customGroupInput.classList.add("hidden");
    }
  };

  // Submit profile details
  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("profile-name").value.trim();
    
    let greatRegion = greatRegionSelect.value;
    if (greatRegion === "custom") {
      greatRegion = customGreatRegionInput.value.trim();
    }

    let zone = zoneSelect.value;
    if (zone === "custom") {
      zone = customZoneInput.value.trim();
    }

    let group = groupSelect.value;
    if (group === "custom") {
      group = customGroupInput.value.trim();
    }

    if (!greatRegion || !zone || !group) {
      alert("請完整填寫大區、牧區與小組資料！");
      return;
    }

    loader.show("儲存個人資料中...");
    
    state.currentUser.name = name;
    state.currentUser.great_region = greatRegion;
    state.currentUser.pastoral_zone = zone;
    state.currentUser.small_group = group;

    saveLocalUserStats();

    if (state.isSupabaseMode && state.supabase) {
      await syncProfileStatsToSupabase();
    }

    loader.hide();
    alert("個人資料儲存成功！");
    updateDashboardView();
  };

  // Supabase connection settings are configured by admin in backend config.js


  // Google OAuth Login
  const btnGoogle = document.getElementById("btn-google-login");
  if (btnGoogle) {
    btnGoogle.onclick = async (e) => {
      e.preventDefault();
      loader.show("開啟 Google 登入中...");
      try {
        const { error } = await state.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            queryParams: {
              prompt: 'select_account' // 強制顯示 Google 帳號選擇視窗，方便切換不同帳號
            }
          }
        });
        if (error) throw error;
      } catch (err) {
        alert(`Google 登入失敗: ${err.message}`);
        loader.hide();
      }
    };
  }

  // Demo Switcher Listener
  const demoRoleSelect = document.getElementById("demo-role-select");
  if (demoRoleSelect) {
    demoRoleSelect.value = state.currentUser.role || "member";
    demoRoleSelect.onchange = async (e) => {
      await switchDemoRole(e.target.value);
    };
  }

  // Auth Button triggers
  const btnSignin = document.getElementById("btn-signin");
  if (btnSignin) {
    btnSignin.onclick = async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;

      if (!email || !password) return;
      
      loader.show("登入中...");
      try {
        const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        await loadUserData();
        alert("登入成功！");
        renderProfileView();
      } catch (err) {
        alert(`登入失敗: ${err.message}`);
      } finally {
        loader.hide();
      }
    };
  }

  const btnSignup = document.getElementById("btn-signup");
  if (btnSignup) {
    btnSignup.onclick = async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;

      if (!email || !password) return;
      
      loader.show("註冊帳號中...");
      try {
        const { data, error } = await state.supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        alert("註冊成功！若您設定了 Email 驗證，請前往信箱點擊驗證連結。");
        renderProfileView();
      } catch (err) {
        alert(`註冊失敗: ${err.message}`);
      } finally {
        loader.hide();
      }
    };
  }

  const btnSignout = document.getElementById("btn-signout");
  if (btnSignout) {
    btnSignout.onclick = async (e) => {
      e.preventDefault();
      loader.show("登出中...");
      try {
        await state.supabase.auth.signOut();
        await loadUserData();
        alert("已成功登出。");
        renderProfileView();
      } catch (err) {
        alert(`登出失敗: ${err.message}`);
      } finally {
        loader.hide();
      }
    };
  }
}

function populateProfileZones(greatRegion) {
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const userZone = state.currentUser.pastoral_zone;

  zoneSelect.innerHTML = `<option value="">-- 請選擇牧區 --</option>`;
  customZoneInput.classList.add("hidden");

  if (!greatRegion) return;

  if (greatRegion === "custom") {
    zoneSelect.innerHTML += `<option value="custom">自訂裝區...</option>`;
    if (userZone) {
      zoneSelect.value = "custom";
      customZoneInput.classList.remove("hidden");
      customZoneInput.value = userZone;
    }
    return;
  }

  const predefinedZones = MOCK_PASTORAL_ZONES_BY_REGION[greatRegion] || [];
  predefinedZones.forEach(zName => {
    const option = document.createElement("option");
    option.value = zName;
    option.textContent = zName;
    if (userZone === zName) {
      option.selected = true;
    }
    zoneSelect.appendChild(option);
  });

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂牧區...";
  if (userZone && !predefinedZones.includes(userZone)) {
    customOpt.selected = true;
    customZoneInput.classList.remove("hidden");
    customZoneInput.value = userZone;
  }
  zoneSelect.appendChild(customOpt);
}

function populateProfileGroupSelector() {
  const zoneSelect = document.getElementById("profile-zone");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const userGroup = state.currentUser.small_group;

  groupSelect.innerHTML = `<option value="">-- 請選擇小組 --</option>`;
  customGroupInput.classList.add("hidden");

  const zone = zoneSelect.value;
  if (!zone) return;

  const predefinedGroups = MOCK_SMALL_GROUPS[zone] || [];

  predefinedGroups.forEach(groupName => {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    if (userGroup === groupName) {
      option.selected = true;
    }
    groupSelect.appendChild(option);
  });

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂小組...";
  if (userGroup && !predefinedGroups.includes(userGroup) && zone !== "custom") {
    customOpt.selected = true;
    customGroupInput.classList.remove("hidden");
    customGroupInput.value = userGroup;
  }
  groupSelect.appendChild(customOpt);

  if (zone === "custom") {
    groupSelect.value = "custom";
    customGroupInput.classList.remove("hidden");
    customGroupInput.value = userGroup || "";
  }
}

// Simulated Role Switcher Logic
async function switchDemoRole(role) {
  loader.show("切換模擬角色中...");
  
  let mockUser = MOCK_USERS_DATA.find(u => u.role === role);
  if (!mockUser) {
    mockUser = {
      name: "模擬組員",
      great_region: "第一大區",
      pastoral_zone: "約書亞牧區",
      small_group: "迦勒小組",
      role: "member",
      chapters_read: 50,
      plan_progress: 10,
      streak: 1,
      last_read: new Date().toISOString()
    };
  }

  // Override currentUser state
  state.currentUser = {
    name: mockUser.name,
    great_region: mockUser.great_region,
    pastoral_zone: mockUser.pastoral_zone,
    small_group: mockUser.small_group,
    role: mockUser.role,
    chapters_read: mockUser.chapters_read,
    plan_progress: mockUser.plan_progress,
    streak: mockUser.streak,
    last_read: mockUser.last_read
  };

  // Setup mock active plan to match their plan_progress
  if (role === "member") {
    state.activePlan = null;
    state.activePlans = [];
    state.readingLogs = [];
  } else {
    state.activePlan = generatePlanObject(CHURCH_PLAN_PRESETS.q1.name, CHURCH_PLAN_PRESETS.q1.startDate, CHURCH_PLAN_PRESETS.q1.endDate, CHURCH_PLAN_PRESETS.q1.books, "q1");
    state.activePlan.progress = mockUser.plan_progress;
    state.activePlan.completedChapters = Math.round((state.activePlan.totalChapters * mockUser.plan_progress) / 100);
    state.activePlans = [state.activePlan];
    localStorage.setItem("selected_plan_key", "q1");
    
    // Fill in simulated logs from actual chapters
    const completedList = [];
    let count = 0;
    for (const day of state.activePlan.days) {
      for (const ch of day.chapters) {
        if (count < state.activePlan.completedChapters) {
          completedList.push({
            book: ch.book,
            chapter: ch.chapter,
            read_at: new Date(state.activePlan.startDate).toISOString(),
            presetKey: "q1"
          });
          count++;
        } else {
          break;
        }
      }
      if (count >= state.activePlan.completedChapters) break;
    }
    state.readingLogs = completedList;
  }

  saveLocalUserStats();
  
  // Refresh views
  updateDashboardView();
  if (appRouter.currentTab === "stats-view") {
    await updateStatsView();
  } else if (appRouter.currentTab === "profile-view") {
    renderProfileView();
  }
  
  loader.hide();
}
