// Unified Data Service (Supabase & LocalStorage integration)

const db = {
  // Initialize Supabase Connection
  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const forceOfflineDemo = urlParams.get("demo") === "true" || urlParams.get("offline") === "true";

    const sbUrl = forceOfflineDemo ? "" : (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.url ? SUPABASE_CONFIG.url.trim() : "");
    const sbKey = forceOfflineDemo ? "" : (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.anonKey ? SUPABASE_CONFIG.anonKey.trim() : "");
    const statusBadge = document.getElementById("connection-status");
    const authSection = document.getElementById("sb-auth-section");
    const placeholder = document.getElementById("sb-disconnected-placeholder");

    if (sbUrl && sbKey) {
      try {
        // Initialize Supabase SDK
        state.supabase = supabase.createClient(sbUrl, sbKey);
        state.isSupabaseMode = true;
        
        // Update Status Badge
        statusBadge.className = "status-badge online";
        statusBadge.querySelector(".status-text").textContent = "線上模式";
        if (placeholder) placeholder.classList.add("hidden");
        
        // Check Auth Session
        const { data: { session } } = await state.supabase.auth.getSession();
        this.updateAuthUI(session);

        // Setup session listener
        state.supabase.auth.onAuthStateChange(async (event, session) => {
          try {
            console.log("Auth state changed:", event, !!session);
            this.updateAuthUI(session);
            await this.loadUserData();
            
            if (appRouter.currentTab === "dashboard-view") {
              updateDashboardView();
            } else if (appRouter.currentTab === "profile-view") {
              renderProfileView();
            } else if (appRouter.currentTab === "stats-view") {
              updateStatsView();
            }
          } catch (err) {
            console.error("Error in onAuthStateChange callback:", err);
          }
        });
      } catch (e) {
        console.error("Supabase connection failed:", e);
        this.showConnectionError();
      }
    } else {
      this.setDemoMode();
    }
  },

  showConnectionError() {
    state.isSupabaseMode = true;
    
    // Disable Google login gate button
    const btnGoogleGate = document.getElementById("btn-gate-google-login");
    if (btnGoogleGate) {
      btnGoogleGate.disabled = true;
      btnGoogleGate.style.opacity = "0.5";
      btnGoogleGate.style.cursor = "not-allowed";
    }

    // Show red error status on login gate
    const gateDot = document.getElementById("gate-status-dot");
    const gateText = document.getElementById("gate-status-text");
    if (gateDot && gateText) {
      gateDot.style.backgroundColor = "#ef4444";
      gateText.textContent = "連線失敗，請檢查網路連線！";
    }

    // Keep app layout hidden and show login gate
    const loginGate = document.getElementById("login-gate");
    const appLayout = document.querySelector(".app-layout");
    if (loginGate) loginGate.classList.remove("hidden");
    if (appLayout) appLayout.classList.add("hidden");
  },

  setDemoMode() {
    state.isSupabaseMode = false;
    const statusBadge = document.getElementById("connection-status");
    const authSection = document.getElementById("sb-auth-section");
    const placeholder = document.getElementById("sb-disconnected-placeholder");
    const profileCardCol = document.getElementById("profile-card-col");

    statusBadge.className = "status-badge offline";
    statusBadge.querySelector(".status-text").textContent = "Demo 模式";
    if (authSection) {
      authSection.classList.add("hidden");
      authSection.className = "card-col span-12 hidden";
    }
    if (placeholder) placeholder.classList.remove("hidden");
    
    if (profileCardCol) {
      profileCardCol.className = "card-col span-12";
    }
  },

  // Handle Supabase Auth UI Switches
  updateAuthUI(session) {
    const loginGate = document.getElementById("login-gate");
    const appLayout = document.querySelector(".app-layout");

    const isLoggedIn = !!(session && session.user);

    if (isLoggedIn) {
      // Online mode: Hide login gate, show app container
      if (state.isSupabaseMode) {
        if (loginGate) loginGate.classList.add("hidden");
        if (appLayout) appLayout.classList.remove("hidden");
      }
    } else {
      // Online mode: Show login gate, hide app container
      if (state.isSupabaseMode) {
        if (loginGate) loginGate.classList.remove("hidden");
        if (appLayout) appLayout.classList.add("hidden");
      } else {
        // Demo mode: Ensure login gate is hidden and app is visible
        if (loginGate) loginGate.classList.add("hidden");
        if (appLayout) appLayout.classList.remove("hidden");
      }
    }

    if (typeof updateHeaderAvatar === 'function') {
      updateHeaderAvatar();
    }
  },

  // Load User Data (either Supabase or LocalStorage fallbacks)
  async loadUserData() {
    // 0. Load global preset plans first
    await this.loadGlobalPlans();

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
          state.currentUser.is_demo = !!profile.is_demo;
          state.realRole = profile.role;
        } else {
          // First-time login: create profile automatically in Supabase
          state.currentUser.name = (user.user_metadata && user.user_metadata.full_name) || "新使用者";
          state.currentUser.great_region = "東區";
          state.currentUser.pastoral_zone = "大安1";
          state.currentUser.small_group = "馬鈴";
          state.currentUser.role = "member";
          state.currentUser.is_demo = false;
          state.realRole = "member";
          
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
          // Collect rows that need preset_key backfill (legacy data)
          const legacyUpdates = [];

          plans.forEach(dbPlan => {
            // Prefer stored preset_key, fall back to name-based lookup
            const key = dbPlan.preset_key || getPresetKeyByName(dbPlan.name);

            const planObj = generatePlanObject(dbPlan.name, dbPlan.start_date, dbPlan.end_date, dbPlan.target_books, key);
            planObj.id = dbPlan.id;
            planObj.level = dbPlan.level || 'normal';
            planObj.currentRound = dbPlan.current_round || 1;
            planObj.wasDowngraded = dbPlan.was_downgraded || false;
            state.activePlans.push(planObj);

            // Queue a silent Supabase update if preset_key was missing
            if (!dbPlan.preset_key && key) {
              legacyUpdates.push({ id: dbPlan.id, preset_key: key });
            }
          });

          // Silently backfill preset_key for legacy records
          if (legacyUpdates.length > 0) {
            Promise.all(
              legacyUpdates.map(({ id, preset_key }) =>
                state.supabase
                  .from("reading_plans")
                  .update({ preset_key })
                  .eq("id", id)
                  .then(({ error }) => {
                    if (error) console.warn(`Failed to backfill preset_key for plan ${id}:`, error);
                    else console.log(`✅ Backfilled preset_key="${preset_key}" for plan ${id}`);
                  })
              )
            );
          }
          
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

        
        this.calculateStreak();
        if (typeof checkAchievements !== 'undefined') {
          await checkAchievements();
        }
        if (typeof updateAdminNavVisibility === 'function') {
          updateAdminNavVisibility();
        }
        return;
      } else {
        // Online mode but not logged in: clear state and return early
        state.currentUser = {
          name: "",
          great_region: "",
          pastoral_zone: "",
          small_group: "",
          role: "member",
          chapters_read: 0,
          plan_progress: 0,
          streak: 0,
          last_read: null
        };
        state.readingLogs = [];
        state.activePlans = [];
        state.activePlan = null;
        if (typeof updateAdminNavVisibility === 'function') {
          updateAdminNavVisibility();
        }
        return;
      }
    }

    // FALLBACK: LocalStorage mode
    const localProfile = localStorage.getItem("user_profile");
    if (localProfile) {
      state.currentUser = JSON.parse(localProfile);
      state.realRole = state.currentUser.role;
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
        state.activePlans = [];
        state.activePlan = null;
      }
    } else {
      // First run in Demo mode: default to admin with mock logs/plan
      state.currentUser = {
        name: "系統管理員",
        great_region: "東區",
        pastoral_zone: "大安1",
        small_group: "馬鈴",
        role: "admin",
        chapters_read: 80,
        plan_progress: 72,
        streak: 15,
        last_read: new Date().toISOString().split('T')[0]
      };
      localStorage.setItem("user_profile", JSON.stringify(state.currentUser));
      state.realRole = "admin";

      state.activePlan = generatePlanObject(CHURCH_PLAN_PRESETS.q1.name, CHURCH_PLAN_PRESETS.q1.startDate, CHURCH_PLAN_PRESETS.q1.endDate, CHURCH_PLAN_PRESETS.q1.books, "q1");
      state.activePlan.progress = 72;
      state.activePlan.completedChapters = Math.round((state.activePlan.totalChapters * 72) / 100);
      state.activePlans = [state.activePlan];
      
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      localStorage.setItem("selected_plan_key", "q1");

      // Fill in simulated logs
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

    this.calculateStreak();
    if (typeof checkAchievements !== 'undefined') {
      await checkAchievements();
    }
    if (typeof updateAdminNavVisibility === 'function') {
      updateAdminNavVisibility();
    }
  },

  // Load Church Organization Structure (from Supabase or Local Mock)
  async loadOrgStructure() {
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { data: regions, error: rErr } = await state.supabase.from("great_regions").select("id, name");
        if (rErr) throw rErr;
        const { data: zones, error: zErr } = await state.supabase.from("pastoral_zones").select("id, name, great_region_id");
        if (zErr) throw zErr;
        const { data: groups, error: gErr } = await state.supabase.from("small_groups").select("id, name, pastoral_zone_id");
        if (gErr) throw gErr;

        state.orgStructure.regions = regions.map(r => r.name);
        state.orgStructure.rawRegions = regions;
        state.orgStructure.rawZones = zones;
        state.orgStructure.rawGroups = groups;

        state.orgStructure.zones = {};
        regions.forEach(region => {
          const regionZones = zones.filter(z => z.great_region_id === region.id).map(z => z.name);
          state.orgStructure.zones[region.name] = regionZones;
        });

        state.orgStructure.groups = {};
        zones.forEach(zone => {
          const zoneGroups = groups.filter(g => g.pastoral_zone_id === zone.id).map(g => g.name);
          state.orgStructure.groups[zone.name] = zoneGroups;
        });

        return;
      } catch (err) {
        console.error("Failed to load schema from Supabase, loading mock structure:", err);
      }
    }
    this.loadMockOrgStructure();
  },

  loadMockOrgStructure() {
    state.orgStructure.regions = ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
    state.orgStructure.zones = {
      "東區": ["大安1", "大安2", "大安6", "信義", "內湖"],
      "南區": ["文山", "中永和", "新店"],
      "西區": ["萬華", "板橋", "新莊"],
      "北區": ["士林", "北投", "天母"]
    };
    state.orgStructure.groups = {
      "大安1": ["馬鈴", "大衛", "約書亞"],
      "大安2": ["雅各", "彼得"],
      "中永和": ["保羅", "提摩太"],
      "文山": ["西面", "路得"],
      "大安6": ["以利亞"]
    };
  },

  // Save log to DB/LocalStorage
  async logChapterRead(book, chapter, isChecked) {
    const todayISO = new Date().toISOString();
    const planId = state.activePlan ? state.activePlan.id : null;
    const presetKey = state.activePlan ? state.activePlan.presetKey : null;
    const round = state.activePlan ? (state.activePlan.currentRound || 1) : 1;
    
    if (isChecked) {
      const existingLog = state.readingLogs.find(l => 
        l.book === book && 
        l.chapter === chapter && 
        (l.plan_id === planId || l.presetKey === presetKey) &&
        (l.round || 1) === round
      );
      if (!existingLog) {
        state.readingLogs.push({ book, chapter, read_at: todayISO, plan_id: planId, presetKey: presetKey, round: round });
        
        if (state.isSupabaseMode && state.supabase) {
          const { data: { user } } = await state.supabase.auth.getUser();
          if (user) {
            await state.supabase.from("reading_logs").insert({
              user_id: user.id,
              plan_id: planId,
              book,
              chapter,
              read_at: todayISO,
              round: round
            });
          }
        }
      } else {
        existingLog.read_at = todayISO;
        if (state.isSupabaseMode && state.supabase) {
          const { data: { user } } = await state.supabase.auth.getUser();
          if (user) {
            let query = state.supabase.from("reading_logs").update({ read_at: todayISO }).eq("user_id", user.id).eq("book", book).eq("chapter", chapter).eq("round", round);
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
      state.readingLogs = state.readingLogs.filter(l => !(
        l.book === book && 
        l.chapter === chapter && 
        (l.plan_id === planId || l.presetKey === presetKey) &&
        (l.round || 1) === round
      ));
      
      if (state.isSupabaseMode && state.supabase) {
        const { data: { user } } = await state.supabase.auth.getUser();
        if (user) {
          let query = state.supabase.from("reading_logs").delete().eq("user_id", user.id).eq("book", book).eq("chapter", chapter).eq("round", round);
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

    this.calculateStreak();
    this.saveLocalUserStats();

    if (state.isSupabaseMode && state.supabase) {
      await this.syncProfileStatsToSupabase();
    }
    if (typeof checkAchievements !== 'undefined') {
      await checkAchievements();
    }
  },

  async syncProfileStatsToSupabase() {
    const { data: { user } } = await state.supabase.auth.getUser();
    if (user) {
      const regionObj = state.orgStructure && state.orgStructure.rawRegions ? state.orgStructure.rawRegions.find(r => r.name === state.currentUser.great_region) : null;
      const zoneObj = state.orgStructure && state.orgStructure.rawZones ? state.orgStructure.rawZones.find(z => z.name === state.currentUser.pastoral_zone) : null;
      const groupObj = state.orgStructure && state.orgStructure.rawGroups ? state.orgStructure.rawGroups.find(g => g.name === state.currentUser.small_group) : null;

      await state.supabase.from("profiles").upsert({
        id: user.id,
        name: state.currentUser.name,
        great_region: state.currentUser.great_region,
        pastoral_zone: state.currentUser.pastoral_zone,
        small_group: state.currentUser.small_group,
        great_region_id: regionObj ? regionObj.id : null,
        pastoral_zone_id: zoneObj ? zoneObj.id : null,
        small_group_id: groupObj ? groupObj.id : null,
        role: state.realRole || "member",
        updated_at: new Date().toISOString()
      });
    }
  },

  // Calculate streak based on reading logs
  calculateStreak() {
    if (state.readingLogs.length === 0) {
      state.currentUser.streak = 0;
      return;
    }

    const dates = [...new Set(state.readingLogs.map(log => log.read_at.substring(0, 10)))].sort().reverse();

    if (dates.length === 0) {
      state.currentUser.streak = 0;
      return;
    }

    const todayStr = new Date().toISOString().substring(0, 10);
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().substring(0, 10);

    if (dates[0] !== todayStr && dates[0] !== yesterdayStr) {
      state.currentUser.streak = 0;
      state.currentUser.last_read = dates[0];
      this.saveLocalUserStats();
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
        break;
      }
    }

    state.currentUser.streak = streak;
    state.currentUser.last_read = dates[0];
    this.saveLocalUserStats();
  },

  saveLocalUserStats() {
    state.currentUser.chapters_read = state.readingLogs.length;
    if (state.activePlan) {
      state.currentUser.plan_progress = state.activePlan.progress;
    }
    if (!state.isSupabaseMode) {
      localStorage.setItem("user_profile", JSON.stringify(state.currentUser));
    }
  },

  async fetchMergedUsersList() {
    const mockUser = {
      name: state.currentUser.name,
      great_region: state.currentUser.great_region || "東區",
      pastoral_zone: state.currentUser.pastoral_zone || "大安1",
      small_group: state.currentUser.small_group || "馬鈴",
      role: state.currentUser.role || "member",
      chapters_read: state.currentUser.chapters_read,
      plan_progress: state.currentUser.plan_progress,
      last_read: state.currentUser.last_read
    };

    if (state.isSupabaseMode && state.supabase) {
      try {
        const { data: usersProfiles } = await state.supabase.from("profiles").select("*").eq("is_demo", false);
        const { data: allLogs } = await state.supabase.from("reading_logs").select("user_id, book, chapter, read_at");
        state.allLogsCache = allLogs || [];
        const { data: allPlans } = await state.supabase.from("reading_plans").select("user_id, target_books, current_round, level");

        if (usersProfiles) {
          return usersProfiles.map(profile => {
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

            let lastRead = null;
            if (uLogs.length > 0) {
              const sortedLogs = [...uLogs].sort((a, b) => new Date(b.read_at) - new Date(a.read_at));
              if (sortedLogs[0] && sortedLogs[0].read_at) {
                lastRead = sortedLogs[0].read_at.substring(0, 10);
              }
            }

            return {
              id: profile.id,
              name: profile.name,
              great_region: profile.great_region,
              pastoral_zone: profile.pastoral_zone,
              small_group: profile.small_group,
              role: profile.role,
              chapters_read: uLogs.length,
              plan_progress: planProgress,
              streak: profile.streak || 0,
              last_read: lastRead,
              current_round: uPlan ? (uPlan.current_round || 1) : 1,
              level: uPlan ? (uPlan.level || 'normal') : 'normal'
            };
          });
        }
      } catch (err) {
        console.error("Failed to fetch merged users, falling back to mock:", err);
      }
    }

    return MockStatsService.getAllUsers(mockUser);
  },

  async getUserRankings() {
    if (state.isSupabaseMode && state.supabase && state.currentUser && state.currentUser.id) {
      try {
        const { data, error } = await state.supabase.rpc('get_user_rankings', { user_uuid: state.currentUser.id });
        if (error) throw error;
        if (data && data.length > 0) {
          return {
            groupRank: parseInt(data[0].group_rank, 10),
            groupTotal: parseInt(data[0].group_total, 10),
            zoneRank: parseInt(data[0].zone_rank, 10),
            zoneTotal: parseInt(data[0].zone_total, 10),
            regionRank: parseInt(data[0].region_rank, 10),
            regionTotal: parseInt(data[0].region_total, 10),
            churchRank: parseInt(data[0].church_rank, 10),
            churchTotal: parseInt(data[0].church_total, 10)
          };
        }
      } catch (err) {
        console.error("Failed to call get_user_rankings RPC:", err);
      }
    }

    // Offline / Demo fallback calculation
    const allMockUsers = [...MOCK_USERS_DATA];
    const currentMockIdx = allMockUsers.findIndex(u => u.name === state.currentUser.name);
    const updatedCurrentUser = {
      name: state.currentUser.name,
      great_region: state.currentUser.great_region || "東區",
      pastoral_zone: state.currentUser.pastoral_zone || "大安1",
      small_group: state.currentUser.small_group || "馬鈴",
      role: state.currentUser.role || "member",
      chapters_read: state.currentUser.chapters_read || 0,
      plan_progress: state.currentUser.plan_progress || 0,
      streak: state.currentUser.streak || 0,
      last_read: state.currentUser.last_read
    };
    if (currentMockIdx !== -1) {
      allMockUsers[currentMockIdx] = updatedCurrentUser;
    } else {
      allMockUsers.push(updatedCurrentUser);
    }

    const getRankAndTotal = (filteredList) => {
      const sorted = [...filteredList].sort((a, b) => {
        if (b.chapters_read !== a.chapters_read) {
          return b.chapters_read - a.chapters_read;
        }
        return a.name.localeCompare(b.name);
      });
      const myIdx = sorted.findIndex(u => u.name === state.currentUser.name);
      return {
        rank: myIdx !== -1 ? myIdx + 1 : 0,
        total: sorted.length
      };
    };

    const churchStats = getRankAndTotal(allMockUsers);
    const regionStats = getRankAndTotal(allMockUsers.filter(u => u.great_region === updatedCurrentUser.great_region));
    const zoneStats = getRankAndTotal(allMockUsers.filter(u => u.pastoral_zone === updatedCurrentUser.pastoral_zone));
    const groupStats = getRankAndTotal(allMockUsers.filter(u => u.pastoral_zone === updatedCurrentUser.pastoral_zone && u.small_group === updatedCurrentUser.small_group));

    return {
      groupRank: groupStats.rank,
      groupTotal: groupStats.total,
      zoneRank: zoneStats.rank,
      zoneTotal: zoneStats.total,
      regionRank: regionStats.rank,
      regionTotal: regionStats.total,
      churchRank: churchStats.rank,
      churchTotal: churchStats.total
    };
  },

  async switchDemoRole(role) {
    loader.show("切換模擬角色中...");
    
    let mockUser = MOCK_USERS_DATA.find(u => u.role === role);
    if (!mockUser) {
      mockUser = {
        name: "模擬組員",
        great_region: "東區",
        pastoral_zone: "大安1",
        small_group: "馬鈴",
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
      is_demo: true,
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

    this.saveLocalUserStats();
    
    if (typeof updateAdminNavVisibility === 'function') {
      updateAdminNavVisibility();
    }
    
    // Refresh views
    updateDashboardView();
    if (appRouter.currentTab === "stats-view") {
      await updateStatsView();
    } else if (appRouter.currentTab === "profile-view") {
      renderProfileView();
    } else if (appRouter.currentTab === "admin-view") {
      const isSimulatedAdmin = state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor";
      if (!isSimulatedAdmin) {
        appRouter.switchTab("profile-view");
      } else {
        renderAdminUserManagement();
      }
    }
    
    loader.hide();
  },

  async getDevotionalNote(date) {
    if (state.isSupabaseMode && state.supabase) {
      const { data: { user } } = await state.supabase.auth.getUser();
      if (user) {
        const { data } = await state.supabase
          .from("devotional_notes")
          .select("content")
          .eq("user_id", user.id)
          .eq("note_date", date)
          .maybeSingle();
        return data ? data.content : "";
      }
    } else {
      const notesStr = localStorage.getItem("devotional_notes");
      if (notesStr) {
        const notes = JSON.parse(notesStr);
        return notes[date] || "";
      }
    }
    return "";
  },

  async saveDevotionalNote(date, content) {
    if (state.isSupabaseMode && state.supabase) {
      const { data: { user } } = await state.supabase.auth.getUser();
      if (!user) return;
      
      const { error } = await state.supabase
        .from("devotional_notes")
        .upsert({
          user_id: user.id,
          note_date: date,
          content: content
        }, { onConflict: 'user_id,note_date' });
        
      if (error) throw error;
    } else {
      const notesStr = localStorage.getItem("devotional_notes") || "{}";
      const notes = JSON.parse(notesStr);
      notes[date] = content;
      localStorage.setItem("devotional_notes", JSON.stringify(notes));
    }
  },

  async joinPresetPlan(key) {
    let preset = (state.globalPlans || []).find(p => p.presetKey === key || p.id === key);
    if (!preset) {
      preset = CHURCH_PLAN_PRESETS[key];
    }
    if (!preset) return;

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
          const { data: dbPlan, error } = await state.supabase.from("reading_plans").insert({
            user_id: user.id,
            name: planName,
            start_date: startDate,
            end_date: endDate,
            target_books: selectedBooks,
            preset_key: key,
            level: 'normal',
            current_round: 1,
            was_downgraded: false
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
      newPlanObj = generatePlanObject(planName, startDate, endDate, selectedBooks, key);
      if (!state.activePlans) state.activePlans = [];
      state.activePlans.push(newPlanObj);
      state.activePlan = newPlanObj;
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      localStorage.setItem("selected_plan_key", key);
    }

    calculatePlanProgress();
    this.saveLocalUserStats();

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
  },

  async leavePlan(planId, presetKey) {
    loader.show("退出計畫中...");
    
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { error } = await state.supabase.from("reading_plans").delete().eq("id", planId);
        if (error) throw error;
      } catch (e) {
        console.error("Failed to delete plan from Supabase:", e);
      }
    }
    
    state.activePlans = state.activePlans.filter(p => p.id !== planId && p.presetKey !== presetKey);
    state.readingLogs = state.readingLogs.filter(l => l.plan_id !== planId && l.presetKey !== presetKey);
    
    if (!state.isSupabaseMode) {
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs));
    }
    
    if (state.activePlans.length > 0) {
      state.activePlan = state.activePlans[0];
      localStorage.setItem("selected_plan_key", state.activePlan.presetKey || "");
    } else {
      state.activePlan = null;
      localStorage.removeItem("selected_plan_key");
    }
    
    calculateAllPlansProgress();
    this.saveLocalUserStats();
    
    loader.hide();
    renderPlanView();
    updateDashboardView();
    alert("已成功退出該讀經計畫並清除相關計畫讀經打卡紀錄。");
  },

  async updateUserRole(userId, newRole, userName) {
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { error } = await state.supabase
          .from("profiles")
          .update({ role: newRole })
          .eq("id", userId);
        if (error) throw error;
        return true;
      } catch (err) {
        console.error("Failed to update user role in Supabase:", err);
        alert(`更新權限失敗: ${err.message || err}`);
        return false;
      }
    } else {
      // Demo mode: update local MOCK_USERS_DATA
      const userIndex = MOCK_USERS_DATA.findIndex(u => u.name === userName);
      if (userIndex !== -1) {
        MOCK_USERS_DATA[userIndex].role = newRole;
        return true;
      }
      return false;
    }
  },

  async loadGlobalPlans() {
    state.globalPlans = [];
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { data, error } = await state.supabase
          .from("global_plans")
          .select("*")
          .order("start_date", { ascending: true });
        
        if (error) {
          console.error("Failed to load global plans from Supabase:", error);
        } else if (data && data.length > 0) {
          state.globalPlans = data.map(dbPlan => ({
            id: dbPlan.id,
            name: dbPlan.name,
            startDate: dbPlan.start_date,
            endDate: dbPlan.end_date,
            books: dbPlan.target_books,
            presetKey: dbPlan.id
          }));
          return;
        }
      } catch (e) {
        console.error("Error loading global plans from Supabase:", e);
      }
    }
    
    // Fallback: load from local storage or default presets
    const localGlobal = localStorage.getItem("global_plans_presets");
    if (localGlobal) {
      state.globalPlans = JSON.parse(localGlobal);
    } else {
      state.globalPlans = Object.entries(CHURCH_PLAN_PRESETS).map(([key, p]) => ({
        id: key,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        books: p.books,
        presetKey: key
      }));
      localStorage.setItem("global_plans_presets", JSON.stringify(state.globalPlans));
    }
  },

  async saveGlobalPlan(plan) {
    if (state.isSupabaseMode && state.supabase) {
      try {
        const payload = {
          name: plan.name,
          start_date: plan.startDate,
          end_date: plan.endDate,
          target_books: plan.books
        };
        
        let error;
        if (plan.id && plan.id.length > 5 && plan.id.includes('-')) {
          const res = await state.supabase
            .from("global_plans")
            .update(payload)
            .eq("id", plan.id);
          error = res.error;
        } else {
          const res = await state.supabase
            .from("global_plans")
            .insert(payload);
          error = res.error;
        }
        
        if (error) {
          console.error("Failed to save global plan in Supabase:", error);
          alert(`儲存計畫失敗: ${error.message || error}`);
          return false;
        }
      } catch (e) {
        console.error("Error saving global plan in Supabase:", e);
        alert(`儲存計畫出錯: ${e.message || e}`);
        return false;
      }
    } else {
      // LocalStorage mode
      const localGlobal = localStorage.getItem("global_plans_presets");
      let list = localGlobal ? JSON.parse(localGlobal) : [];
      if (plan.id) {
        list = list.map(p => p.id === plan.id ? plan : p);
      } else {
        plan.id = "local_" + Date.now();
        plan.presetKey = plan.id;
        list.push(plan);
      }
      localStorage.setItem("global_plans_presets", JSON.stringify(list));
    }
    
    await this.loadGlobalPlans();
    return true;
  },

  async deleteGlobalPlan(planId) {
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { error } = await state.supabase
          .from("global_plans")
          .delete()
          .eq("id", planId);
        
        if (error) {
          console.error("Failed to delete global plan in Supabase:", error);
          alert(`刪除計畫失敗: ${error.message || error}`);
          return false;
        }
      } catch (e) {
        console.error("Error deleting global plan in Supabase:", e);
        alert(`刪除計畫出錯: ${e.message || e}`);
        return false;
      }
    } else {
      // LocalStorage mode
      const localGlobal = localStorage.getItem("global_plans_presets");
      if (localGlobal) {
        let list = JSON.parse(localGlobal);
        list = list.filter(p => p.id !== planId);
        localStorage.setItem("global_plans_presets", JSON.stringify(list));
      }
    }
    
    await this.loadGlobalPlans();
    return true;
  }
};
