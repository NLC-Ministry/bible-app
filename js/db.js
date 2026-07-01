// Unified Data Service (Supabase & LocalStorage integration)

/**
 * 依計畫名稱查找 CHURCH_PLAN_PRESETS 的 key（僅作舊資料 fallback 使用）
 * @param {string} name
 * @returns {string|null}
 */
function getPresetKeyByName(name) {
  if (!name) return null;
  for (const [key, preset] of Object.entries(CHURCH_PLAN_PRESETS)) {
    if (preset.name === name) return key;
  }
  return null;
}


function getPlanStorageKey(plan) {
  return String((plan && (plan.id || plan.presetKey || plan.globalPlanId || plan.name)) || "");
}

function getLocalPlanDowngradeLock(plan) {
  try {
    const key = getPlanStorageKey(plan);
    const locks = JSON.parse(localStorage.getItem("plan_downgrade_locks") || "{}");
    return key ? (locks[key] || null) : null;
  } catch (e) {
    return null;
  }
}

function setLocalPlanDowngradeLock(plan, lockedUntil) {
  try {
    const key = getPlanStorageKey(plan);
    if (!key) return;
    const locks = JSON.parse(localStorage.getItem("plan_downgrade_locks") || "{}");
    if (lockedUntil) locks[key] = lockedUntil;
    else delete locks[key];
    localStorage.setItem("plan_downgrade_locks", JSON.stringify(locks));
  } catch (e) {
    console.warn("Failed to persist downgrade lock locally", e);
  }
}

const db = {
  // Initialize Supabase Connection
  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");

    const sbUrl = forceOfflineDemo ? "" : (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.url ? SUPABASE_CONFIG.url.trim() : "");
    const sbKey = forceOfflineDemo ? "" : (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.anonKey ? SUPABASE_CONFIG.anonKey.trim() : "");
    const statusBadge = document.getElementById("connection-status");
    const authSection = document.getElementById("sb-auth-section");
    const placeholder = document.getElementById("sb-disconnected-placeholder");
    const allowGoogleLogin = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1";
    const btnGoogleGateEarly = document.getElementById("btn-gate-google-login");
    if (btnGoogleGateEarly) {
      btnGoogleGateEarly.style.display = allowGoogleLogin ? "inline-flex" : "none";
      btnGoogleGateEarly.disabled = !allowGoogleLogin;
    }

    // ── NLC SSO button wiring (always, even before Supabase) ──
    const btnNlcGate = document.getElementById("btn-gate-nlc-login");
    if (btnNlcGate) {
      btnNlcGate.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof auth !== "undefined") {
          auth.login();
        } else {
          alert("NLC SSO 模組尚未載入，請重新整理頁面。");
        }
      });
    }

    if (sbUrl && sbKey) {
      try {
        // Initialize Supabase SDK
        state.supabaseConfig = { url: sbUrl, anonKey: sbKey, allowGoogleLogin };
        state.supabase = this.createSupabaseClient();
        state.isSupabaseMode = true;

        // Update Status Badge
        statusBadge.className = "status-badge online";
        statusBadge.querySelector(".status-text").textContent = "線上模式";
        if (placeholder) placeholder.classList.add("hidden");

        // ── OIDC Callback: Handle Logto redirect ──
        if (typeof auth !== "undefined") {
          const callbackHandled = await auth.handleCallback();
          if (callbackHandled) {
            console.log("Logto OIDC callback handled successfully.");
          }

          // Sync Logto login through the Edge Function so Supabase RLS can resolve profiles.
          if (auth.isLoggedIn()) {
            await this.syncNlcSessionWithSupabase(true);
            this.updateAuthUI({ user: { id: state.currentProfileId || auth.getLogtoSubject() } });
            return; // loadUserData() will be called in main.js
          }
        }

        // Fallback: Standard Supabase email/Google session
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
        if (typeof auth !== "undefined" && auth.resetLocalLogin) {
          await auth.resetLocalLogin();
        }
        this.showConnectionError();
      }
    } else {
      if (forceOfflineDemo) {
        this.setDemoMode();
      } else {
        console.error("Supabase config is missing or invalid!");
        this.showConnectionError();
      }
    }
  },

  createSupabaseClient(externalJwt = null) {
    const cfg = state.supabaseConfig || {};
    const options = {
      auth: {
        detectSessionInUrl: !!cfg.allowGoogleLogin,
        persistSession: !!cfg.allowGoogleLogin,
        autoRefreshToken: !!cfg.allowGoogleLogin
      }
    };

    if (externalJwt) {
      options.accessToken = async () => externalJwt;
      options.global = {
        headers: {
          Authorization: "Bearer " + externalJwt
        }
      };
      options.auth.persistSession = false;
      options.auth.autoRefreshToken = false;
      options.auth.detectSessionInUrl = false;
      options.auth.storageKey = "nlc-external-supabase-session";
    }

    return supabase.createClient(cfg.url, cfg.anonKey, options);
  },

  applyNlcProfile(profile) {
    if (!profile) return;
    state.currentProfileId = profile.id;
    state.currentUser.id = profile.id;
    state.currentUser.name = profile.name || state.currentUser.name || "NLC User";
    state.currentUser.great_region = profile.great_region || "";
    state.currentUser.pastoral_zone = profile.pastoral_zone || "";
    state.currentUser.small_group = profile.small_group || "";
    state.currentUser.role = profile.role || "member";
    state.currentUser.is_demo = !!profile.is_demo;
    state.realRole = state.currentUser.role;
  },

  async syncNlcSessionWithSupabase(force = false) {
    if (typeof auth === "undefined" || !auth.isLoggedIn()) return null;

    const cachedToken = localStorage.getItem("nlc_supabase_access_token");
    const cachedExpiresAt = Number(localStorage.getItem("nlc_supabase_expires_at") || "0");
    const cachedProfile = localStorage.getItem("nlc_supabase_profile");
    if (!force && cachedToken && cachedExpiresAt > Date.now() + 60000) {
      state.supabase = this.createSupabaseClient(cachedToken);
      if (cachedProfile) this.applyNlcProfile(JSON.parse(cachedProfile));
      return { access_token: cachedToken, profile: cachedProfile ? JSON.parse(cachedProfile) : null };
    }

    const accessToken = localStorage.getItem(auth.keys.accessToken);
    if (!accessToken) throw new Error("NLC access token is missing.");

    const cfg = state.supabaseConfig || {};
    const functionUrl = cfg.url.replace(/\/+$/, "") + "/functions/v1/nlc-session";
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ access_token: accessToken })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.message || payload.error || "NLC session sync failed: " + response.status);
    }

    const expiresAt = Date.now() + ((payload.expires_in || 3600) * 1000);
    localStorage.setItem("nlc_supabase_access_token", payload.access_token);
    localStorage.setItem("nlc_supabase_expires_at", String(expiresAt));
    if (payload.profile) localStorage.setItem("nlc_supabase_profile", JSON.stringify(payload.profile));

    state.supabase = this.createSupabaseClient(payload.access_token);
    this.applyNlcProfile(payload.profile);
    return payload;
  },

  async getCurrentDbUser() {
    if (typeof auth !== "undefined" && auth.isLoggedIn()) {
      await this.syncNlcSessionWithSupabase();
      if (state.currentProfileId) return { id: state.currentProfileId, oidc: true };
    }

    const { data: { user } } = await state.supabase.auth.getUser();
    return user;
  },

  showConnectionError() {
    state.isSupabaseMode = true;

    const btnNlcGate = document.getElementById("btn-gate-nlc-login");
    if (btnNlcGate) {
      btnNlcGate.disabled = false;
      btnNlcGate.style.opacity = "1";
      btnNlcGate.style.cursor = "pointer";
      btnNlcGate.textContent = "\u91cd\u65b0\u767b\u5165\u6559\u6703\u7cfb\u7d71";
    }

    const btnGoogleGate = document.getElementById("btn-gate-google-login");
    if (btnGoogleGate) {
      btnGoogleGate.disabled = true;
      btnGoogleGate.style.opacity = "0.5";
      btnGoogleGate.style.cursor = "not-allowed";
    }

    const gateDot = document.getElementById("gate-status-dot");
    const gateText = document.getElementById("gate-status-text");
    if (gateDot && gateText) {
      gateDot.style.backgroundColor = "#ef4444";
      gateText.textContent = "\u767b\u5165\u72c0\u614b\u5df2\u5931\u6548\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002";
    }

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
      if (state.currentUser) {
        state.currentUser.is_demo = false;
      }

      let user = null;
      const isOidcMode = typeof auth !== "undefined" && auth.isLoggedIn();
      if (isOidcMode) {
        await this.syncNlcSessionWithSupabase(true);
        user = state.currentProfileId ? { id: state.currentProfileId, oidc: true } : null;
      }

      if (!user) {
        user = await this.getCurrentDbUser();
      }

      if (user) {
        // 1. Load / sync profile
        if (!user.oidc) {
          // Standard Supabase auth: load profile from our profiles table
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
        } else {
          // OIDC profiles are created and updated by the nlc-session Edge Function.
          const { data: profile } = await state.supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .maybeSingle();
          if (profile) this.applyNlcProfile(profile);
          state.currentUser.is_demo = false;
        }

        // 2. Load Reading Logs
        // 2. Load Reading Logs (fetch round to enable multi-round tracking)
        const { data: logs } = await state.supabase
          .from("reading_logs")
          .select("book, chapter, read_at, plan_id, round")
          .eq("user_id", user.id);

        const rawLogs = logs || [];
        const uniqueMap = {};
        rawLogs.forEach(l => {
          const r = l.round || 1;
          const planKey = l.plan_id || '';
          const key = `${l.book}_${l.chapter}_${planKey}_${r}`;
          if (!uniqueMap[key] || new Date(l.read_at) > new Date(uniqueMap[key].read_at)) {
            uniqueMap[key] = l;
          }
        });
        state.readingLogs = Object.values(uniqueMap);
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
            // 優先用 global_plan_id（UUID）連結 global_plans；其次用 preset_key；最後 fallback 到名稱查找（舊資料相容）
            const globalPlanId = dbPlan.global_plan_id || null;
            const key = dbPlan.preset_key
              || (globalPlanId ? globalPlanId : null)
              || getPresetKeyByName(dbPlan.name);

            const planObj = generatePlanObject(dbPlan.name, dbPlan.start_date, dbPlan.end_date, dbPlan.target_books, key);
            planObj.id = dbPlan.id;
            planObj.globalPlanId = globalPlanId;  // ?? UUID ??
            const linkedGlobalPlan = (state.globalPlans || []).find(p => p.id === globalPlanId || p.presetKey === key || p.name === dbPlan.name);
            planObj.isHidden = Boolean(linkedGlobalPlan && (linkedGlobalPlan.isHidden || linkedGlobalPlan.is_hidden));
            planObj.level = dbPlan.level || 'normal';
            planObj.currentRound = dbPlan.current_round || 1;
            planObj.wasDowngraded = dbPlan.was_downgraded || false;
            planObj.downgradeLockedUntil = dbPlan.downgrade_locked_until || getLocalPlanDowngradeLock(planObj);
            planObj.upgradePromptHandled = !!dbPlan.upgrade_prompt_handled;
            state.activePlans.push(planObj);
          });

          const selectedKey = localStorage.getItem("selected_plan_key");
          if (selectedKey) {
            state.activePlan = state.activePlans.find(p =>
              p.presetKey === selectedKey ||
              p.globalPlanId === selectedKey ||
              p.id === selectedKey
            ) || state.activePlans[0];
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
      const localLogsStr = localStorage.getItem("reading_logs");
      const rawLocalLogs = localLogsStr ? JSON.parse(localLogsStr) : [];
      const uniqueLocalMap = {};
      rawLocalLogs.forEach(l => {
        const r = l.round || 1;
        const planKey = l.plan_id || l.presetKey || '';
        const key = `${l.book}_${l.chapter}_${planKey}_${r}`;
        if (!uniqueLocalMap[key] || new Date(l.read_at) > new Date(uniqueLocalMap[key].read_at)) {
          uniqueLocalMap[key] = l;
        }
      });
      state.readingLogs = Object.values(uniqueLocalMap);
      state.currentUser.chapters_read = state.readingLogs.length;

      const localPlans = localStorage.getItem("active_reading_plans");
      if (localPlans) {
        state.activePlans = JSON.parse(localPlans);
        state.activePlans.forEach(plan => {
          if (!plan.presetKey) {
            plan.presetKey = getPresetKeyByName(plan.name);
          }
          // Self-heal legacy timezone-offsetted dates and missing year/month properties
          if (plan.presetKey && plan.days && plan.days.length > 0) {
            const isMissingProperties = !plan.days[0].year || !plan.days[0].month;
            const hasShiftBug = (plan.presetKey === 'q1' && plan.days[0].date === '06/30') || 
                               (plan.presetKey === 'q2' && plan.days[0].date === '09/30') || 
                               (plan.presetKey === 'q3' && plan.days[0].date === '12/31') || 
                               (plan.presetKey === 'q4' && plan.days[0].date === '03/31');
                               
            if ((hasShiftBug || isMissingProperties) && typeof generatePlanObject === 'function') {
              const preset = CHURCH_PLAN_PRESETS[plan.presetKey];
              if (preset) {
                const freshPlan = generatePlanObject(plan.name, plan.startDate, plan.endDate, plan.target_books || preset.books, plan.presetKey);
                const readKeys = new Set();
                plan.days.forEach(d => {
                  if (d.chapters) {
                    d.chapters.forEach(c => {
                      if (c.isRead) readKeys.add(c.key);
                    });
                  }
                });
                freshPlan.days.forEach(d => {
                  if (d.chapters) {
                    d.chapters.forEach(c => {
                      if (readKeys.has(c.key)) c.isRead = true;
                    });
                  }
                });
                freshPlan.id = plan.id;
                freshPlan.progress = plan.progress;
                freshPlan.completedChapters = plan.completedChapters;
                freshPlan.currentRound = plan.currentRound;
                freshPlan.level = plan.level;
                freshPlan.wasDowngraded = plan.wasDowngraded;
                freshPlan.downgradeLockedUntil = plan.downgradeLockedUntil || getLocalPlanDowngradeLock(plan);
                freshPlan.upgradePromptHandled = !!plan.upgradePromptHandled;
                Object.assign(plan, freshPlan);
              }
            }
          }
        });
        localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
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
        great_region: "南區",
        pastoral_zone: "新烏4",
        small_group: "秀枝",
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
  ensureCurrentUserOrgStructure() {
    const user = state.currentUser || {};
    const region = user.great_region || "";
    const zone = user.pastoral_zone || "";
    const group = user.small_group || "";

    if (!state.orgStructure.regions) state.orgStructure.regions = [];
    if (!state.orgStructure.zones) state.orgStructure.zones = {};
    if (!state.orgStructure.groups) state.orgStructure.groups = {};

    if (region && !state.orgStructure.regions.includes(region)) {
      state.orgStructure.regions.push(region);
    }
    if (region && zone) {
      if (!state.orgStructure.zones[region]) state.orgStructure.zones[region] = [];
      if (!state.orgStructure.zones[region].includes(zone)) state.orgStructure.zones[region].push(zone);
    }
    if (zone && group) {
      if (!state.orgStructure.groups[zone]) state.orgStructure.groups[zone] = [];
      if (!state.orgStructure.groups[zone].includes(group)) state.orgStructure.groups[zone].push(group);
    }
  },

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

        this.ensureCurrentUserOrgStructure();
        return;
      } catch (err) {
        console.error("Failed to load schema from Supabase:", err);
        state.orgStructure.regions = [];
        state.orgStructure.rawRegions = [];
        state.orgStructure.rawZones = [];
        state.orgStructure.rawGroups = [];
        state.orgStructure.zones = {};
        state.orgStructure.groups = {};
        this.ensureCurrentUserOrgStructure();
        return;
      }
    }
    this.loadMockOrgStructure();
  },

  loadMockOrgStructure() {
    // 優先從 mock_stats.js 動態讀取以避免重複定義
    if (typeof MOCK_GREAT_REGIONS !== 'undefined' && MOCK_GREAT_REGIONS.length > 0) {
      state.orgStructure.regions = [...MOCK_GREAT_REGIONS];
      const demoRegions = ["示範大區A", "示範大區B", "示範大區C", "示範大區D"];
      demoRegions.forEach(dr => {
        if (!state.orgStructure.regions.includes(dr)) {
          state.orgStructure.regions.push(dr);
        }
      });

      state.orgStructure.zones = {};
      if (typeof MOCK_PASTORAL_ZONES_BY_REGION !== 'undefined') {
        Object.assign(state.orgStructure.zones, MOCK_PASTORAL_ZONES_BY_REGION);
      }
      state.orgStructure.zones["示範大區A"] = ["示範牧區甲", "示範牧區乙", "示範牧區丙"];
      state.orgStructure.zones["示範大區B"] = ["示範牧區丁", "示範牧區戊", "示範牧區己"];
      state.orgStructure.zones["示範大區C"] = ["示範牧區庚", "示範牧區辛"];
      state.orgStructure.zones["示範大區D"] = ["示範牧區壬", "示範牧區癸"];

      state.orgStructure.groups = {};
      if (typeof MOCK_SMALL_GROUPS !== 'undefined') {
        Object.assign(state.orgStructure.groups, MOCK_SMALL_GROUPS);
      }
      Object.assign(state.orgStructure.groups, {
        "示範牧區甲": ["示範小組1", "示範小組2"],
        "示範牧區乙": ["示範小組3"],
        "示範牧區丙": ["示範小組4"],
        "示範牧區丁": ["示範小組5"],
        "示範牧區戊": ["示範小組6"],
        "示範牧區己": ["示範小組7"],
        "示範牧區庚": ["示範小組8"],
        "示範牧區辛": ["示範小組9"],
        "示範牧區壬": ["示範小組10"],
        "示範牧區癸": ["示範小組11"]
      });
      return;
    }

    // 當 mock_stats.js 載入失敗或不存在時的後備資料
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
  async logChapterRead(book, chapter, isChecked, roundOverride = null) {
    const todayISO = new Date().toISOString();
    const planId = state.activePlan ? state.activePlan.id : null;
    const presetKey = state.activePlan ? state.activePlan.presetKey : null;
    const round = roundOverride || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);
    const isSamePlanLog = (log) => {
      const logPlanId = log.plan_id || null;
      const logPresetKey = log.presetKey || log.preset_key || null;
      if (planId && logPlanId) return logPlanId === planId;
      if (presetKey && logPresetKey) return logPresetKey === presetKey;
      if (planId && !logPlanId && !logPresetKey) return true;
      if (presetKey && !logPlanId && !logPresetKey) return true;
      return !planId && !presetKey && !logPlanId && !logPresetKey;
    };
    const isSameChapterLog = (log) =>
      log.book === book &&
      Number(log.chapter) === Number(chapter) &&
      (log.round || 1) === round &&
      isSamePlanLog(log);

    if (isChecked) {
      const existingLog = state.readingLogs.find(isSameChapterLog);
      if (!existingLog) {
        state.readingLogs.push({ book, chapter, read_at: todayISO, plan_id: planId, presetKey: presetKey, round: round });

        if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
          const user = await this.getCurrentDbUser();
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
        if (!existingLog.plan_id && planId) existingLog.plan_id = planId;
        if (!existingLog.presetKey && presetKey) existingLog.presetKey = presetKey;
        if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
          const user = await this.getCurrentDbUser();
          if (user) {
            let query = state.supabase.from("reading_logs").update({ read_at: todayISO }).eq("user_id", user.id).eq("book", book).eq("chapter", chapter).eq("round", round);
            if (planId) query = query.eq("plan_id", planId);
            else query = query.is("plan_id", null);
            await query;
          }
        }
      }
    } else {
      state.readingLogs = state.readingLogs.filter(l => !isSameChapterLog(l));

      if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
        const user = await this.getCurrentDbUser();
        if (user) {
          let query = state.supabase.from("reading_logs").delete().eq("user_id", user.id).eq("book", book).eq("chapter", chapter).eq("round", round);
          if (planId) {
            query = query.or(`plan_id.eq.${planId},plan_id.is.null`);
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
    if (state.currentUser && state.currentUser.is_demo) {
      console.warn("syncProfileStatsToSupabase aborted: current user is demo user.");
      return;
    }
    const user = await this.getCurrentDbUser();
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

  async fetchMergedUsersList(filterPresetKey = null) {
    // If no filter is provided, default to the active global plan first.
    // Each participant has their own reading_plans.id, so group stats must match by global_plan_id/preset_key, not the current user's plan id.
    if (!filterPresetKey && state.activePlan) {
      filterPresetKey = state.activePlan.globalPlanId || state.activePlan.presetKey || state.activePlan.name || state.activePlan.id;
    }

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
        const { data: allLogs } = await state.supabase.from("reading_logs").select("user_id, book, chapter, read_at, plan_id, round");
        state.allLogsCache = allLogs || [];
        const { data: allPlans } = await state.supabase.from("reading_plans").select("id, user_id, name, preset_key, global_plan_id, target_books, current_round, level");

        window.userPlanIdCache = {};
        if (allPlans) {
          allPlans.forEach(p => {
            if (p.user_id && p.preset_key) {
              window.userPlanIdCache[p.user_id + '_' + p.preset_key] = p.id;
            }
            if (p.user_id && p.name) {
              window.userPlanIdCache[p.user_id + '_' + p.name] = p.id;
            }
          });
        }

        if (usersProfiles) {
          // Pre-group plans by user_id
          const plansByUser = {};
          if (allPlans) {
            allPlans.forEach(p => {
              if (p.user_id) {
                if (!plansByUser[p.user_id]) plansByUser[p.user_id] = [];
                plansByUser[p.user_id].push(p);
              }
            });
          }

          // Pre-group logs by user_id
          const logsByUser = {};
          if (allLogs) {
            allLogs.forEach(l => {
              if (l.user_id) {
                if (!logsByUser[l.user_id]) logsByUser[l.user_id] = [];
                logsByUser[l.user_id].push(l);
              }
            });
          }

          return usersProfiles.map(profile => {
            const userPlans = plansByUser[profile.id] || [];
            const uPlan = filterPresetKey
              ? userPlans.find(p => p.preset_key === filterPresetKey || p.global_plan_id === filterPresetKey || p.name === filterPresetKey || p.id === filterPresetKey)
              : userPlans[0] || null;

            if (filterPresetKey && !uPlan) return null;

            const uLogs = logsByUser[profile.id] || [];
            const filteredLogs = filterPresetKey
              ? uLogs.filter(l => uPlan ? l.plan_id === uPlan.id : false)
              : uLogs;

            // Group filteredLogs to ensure each (book, chapter, round) is counted at most once
            const uniqueLogsMap = {};
            filteredLogs.forEach(l => {
              const r = l.round || 1;
              const key = `${l.book}_${l.chapter}_${r}`;
              if (!uniqueLogsMap[key]) {
                uniqueLogsMap[key] = l;
              }
            });
            const uniqueLogs = Object.values(uniqueLogsMap);

            let planProgress = 0;
            if (uPlan && uPlan.target_books && uPlan.target_books.length > 0) {
              let totalChapters = 0;
              uPlan.target_books.forEach(bName => {
                const b = BIBLE_BOOKS.find(book => book.name === bName);
                if (b) totalChapters += b.chapters;
              });
              const levelRounds = uPlan.level === 'super' ? 3 : (uPlan.level === 'breakthrough' ? 2 : 1);
              totalChapters *= levelRounds;
              if (totalChapters > 0) {
                planProgress = Math.min(100, Math.round((uniqueLogs.length / totalChapters) * 100) || 0);
              }
            }

            let lastRead = null;
            if (uniqueLogs.length > 0) {
              const sortedLogs = [...uniqueLogs].sort((a, b) => new Date(b.read_at) - new Date(a.read_at));
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
              chapters_read: uniqueLogs.length,
              plan_progress: planProgress,
              streak: profile.streak || 0,
              last_read: lastRead,
              plan_id: uPlan ? uPlan.id : null,
              presetKey: uPlan ? uPlan.preset_key : null,
              globalPlanId: uPlan ? uPlan.global_plan_id : null,
              current_round: uPlan ? (uPlan.current_round || 1) : 1,
              level: uPlan ? (uPlan.level || 'normal') : 'normal'
            };
          }).filter(Boolean);
        }
      } catch (err) {
        console.error("Failed to fetch merged users:", err);
      }
      return [mockUser];
    }

    // Offline / Local Storage mode
    let localUsers = [];
    if (typeof MockStatsService !== 'undefined') {
      localUsers = MockStatsService.getAllUsers(mockUser);
    } else {
      localUsers = [mockUser];
    }

    if (filterPresetKey) {
      const plan = state.activePlans ? state.activePlans.find(p => p.presetKey === filterPresetKey) : null;
      if (plan) {
        mockUser.chapters_read = plan.completedChapters;
        mockUser.plan_progress = plan.progress;
      }
      localUsers = localUsers.map(u => {
        if (u.name === mockUser.name) {
          return {
            ...u,
            chapters_read: mockUser.chapters_read,
            plan_progress: mockUser.plan_progress
          };
        }
        const seed = u.name.charCodeAt(0) || 10;
        const totalCh = plan ? plan.totalChapters : 100;
        const mockChapters = Math.round(((seed * 7) % 50) / 50 * totalCh);
        const mockProgress = Math.round((mockChapters / totalCh) * 100);
        return {
          ...u,
          chapters_read: mockChapters,
          plan_progress: mockProgress
        };
      });
    }
    return localUsers;
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

    if (role === "real_user") {
      // 恢復線上連線狀態
      state.isSupabaseMode = true;
      const statusBadge = document.getElementById("connection-status");
      if (statusBadge) {
        statusBadge.className = "status-badge online";
        statusBadge.querySelector(".status-text").textContent = "線上模式";
      }
      const placeholder = document.getElementById("sb-disconnected-placeholder");

      if (placeholder) placeholder.classList.add("hidden");
      
      const authSection = document.getElementById("sb-auth-section");
      if (authSection) {
        authSection.classList.remove("hidden");
        authSection.className = "card-col span-12";
      }

      window._cachedAllUsersList = null;
      await this.loadUserData();
      await this.loadOrgStructure(); // Re-fetch org structure from Supabase
      
      loader.hide();
      return;
    }

    // 只要切換非 real_user 的模擬角色，就強制進入本機 Demo 模式沙盒
    state.isSupabaseMode = false;
    this.setDemoMode();

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

    window._cachedAllUsersList = null;
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
      const user = await this.getCurrentDbUser();
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
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const user = await this.getCurrentDbUser();
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

    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const user = await this.getCurrentDbUser();
        if (user) {
          // 判斷是否為 global_plans 的 UUID key（非 q1~q4 的固定 key）
          const presetKeys = Object.keys(CHURCH_PLAN_PRESETS);
          const isGlobalPlanUUID = !presetKeys.includes(key) && key && key.includes('-');

          const insertPayload = {
            user_id: user.id,
            name: planName,
            start_date: startDate,
            end_date: endDate,
            target_books: selectedBooks,
            preset_key: key,
            level: 'normal',
            current_round: 1,
            was_downgraded: false,
            downgrade_locked_until: null,
            upgrade_prompt_handled: false
          };

          // 若是來自 global_plans 的計畫，儲存 global_plan_id（UUID FK）
          if (isGlobalPlanUUID) {
            insertPayload.global_plan_id = key;
          }

          const { data: dbPlan, error } = await state.supabase
            .from("reading_plans")
            .insert(insertPayload)
            .select().single();

          if (error) {
            console.error("Failed to insert plan in Supabase:", error);
            loader.hide();
            showToast("加入讀經計畫失敗：" + (error.message || error));
            return null;
          } else {
            newPlanObj = generatePlanObject(planName, startDate, endDate, selectedBooks, key);
            newPlanObj.id = dbPlan.id;
            newPlanObj.globalPlanId = dbPlan.global_plan_id || null;
            if (!state.activePlans) state.activePlans = [];
            state.activePlans.push(newPlanObj);
            state.activePlan = newPlanObj;
            localStorage.setItem("selected_plan_key", key);
          }
        }
      } catch (e) {
        console.error("Error inserting plan in Supabase:", e);
        loader.hide();
        showToast("加入讀經計畫失敗：" + (e.message || e));
        return null;
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
      showToast(`成功加入 ${planName}！計畫已開始。`);
    } else if (isAdmin) {
      showToast(`成功預約加入 ${planName}！計畫將於 ${startDate} 開始。您目前為系統管理員，可提早進行測試。`);
    } else {
      showToast(`成功預約加入 ${planName}！計畫將於 ${startDate} 開始。`);
    }
  },

  async joinPlan(name, startDate, endDate, books, key) {
    return this.joinPresetPlan(key);
  },

  async leavePlan(planId, presetKey) {
    loader.show("退出計畫中...");

    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
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
    showToast("已成功退出該讀經計畫並清除相關計畫讀經打卡紀錄。");
  },

  async updateUserRole(userId, newRole, userName, additionalFields = {}) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const updateData = { role: newRole, ...additionalFields };
        const { error } = await state.supabase
          .from("profiles")
          .update(updateData)
          .eq("id", userId);
        if (error) throw error;
        return true;
      } catch (err) {
        console.error("Failed to update user role in Supabase:", err);
        showToast(`更新權限失敗: ${err.message || err}`);
        return false;
      }
    } else {
      // Demo mode: update local MOCK_USERS_DATA
      const userIndex = MOCK_USERS_DATA.findIndex(u => u.name === userName);
      if (userIndex !== -1) {
        MOCK_USERS_DATA[userIndex].role = newRole;
        Object.assign(MOCK_USERS_DATA[userIndex], additionalFields);
        return true;
      }
      return false;
    }
  },

  async loadGlobalPlans() {
    state.globalPlans = [];

    if (state.isSupabaseMode && state.supabase) {
      // ── Supabase 模式：資料完全來自資料庫，不混合硬寫的 CHURCH_PLAN_PRESETS ──
      try {
        const { data, error } = await state.supabase
          .from("global_plans")
          .select("*")
          .order("start_date", { ascending: true });

        if (error) {
          console.error("Failed to load global plans from Supabase:", error);
        } else {
          state.globalPlans = (data || []).map(dbPlan => ({
            id: dbPlan.id,
            name: dbPlan.name,
            startDate: dbPlan.start_date,
            endDate: dbPlan.end_date,
            books: dbPlan.target_books,
            presetKey: dbPlan.id,
            isHidden: Boolean(dbPlan.is_hidden)
          }));
          return;
        }
      } catch (e) {
        console.error("Error loading global plans from Supabase:", e);
      }
    }

    // ── localStorage / Demo 模式：從本機讀取，並補上硬寫的四季預設計畫 ──
    const mergeWithPresets = (loadedList) => {
      const presetKeys = Object.keys(CHURCH_PLAN_PRESETS);
      const presetPlans = Object.entries(CHURCH_PLAN_PRESETS).map(([key, p]) => ({
        id: key,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        books: p.books,
        presetKey: key,
        isHidden: Boolean(p.isHidden || p.is_hidden)
      }));
      // 自訂計畫：排除掉 presetKey 為 q1~q4 的項目避免重複
      const customPlans = loadedList.filter(p => !presetKeys.includes(p.presetKey) && !presetKeys.includes(p.id));
      return [...presetPlans, ...customPlans].map(plan => ({
        ...plan,
        isHidden: Boolean(plan.isHidden || plan.is_hidden)
      }));
    };

    const localGlobal = localStorage.getItem("global_plans_presets");
    if (localGlobal) {
      const localList = JSON.parse(localGlobal);
      state.globalPlans = mergeWithPresets(localList);
    } else {
      state.globalPlans = mergeWithPresets([]);
      localStorage.setItem("global_plans_presets", JSON.stringify(state.globalPlans));
    }
  },

  async saveGlobalPlan(plan) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
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
          showToast(`儲存計畫失敗: ${error.message || error}`);
          return false;
        }
      } catch (e) {
        console.error("Error saving global plan in Supabase:", e);
        showToast(`儲存計畫出錯: ${e.message || e}`);
        return false;
      }
    } else {
      // LocalStorage mode — only persist CUSTOM plans (presets are always injected by loadGlobalPlans)
      const presetKeys = Object.keys(CHURCH_PLAN_PRESETS);
      const localGlobal = localStorage.getItem("global_plans_presets");
      let list = localGlobal ? JSON.parse(localGlobal) : [];
      // Strip preset entries from the stored list so we only track custom plans
      list = list.filter(p => !presetKeys.includes(p.presetKey) && !presetKeys.includes(p.id));
      if (plan.id && !presetKeys.includes(plan.id)) {
        list = list.map(p => p.id === plan.id ? plan : p);
      } else if (!plan.id) {
        plan.id = "local_" + Date.now();
        plan.presetKey = plan.id;
        list.push(plan);
      }
      localStorage.setItem("global_plans_presets", JSON.stringify(list));
    }

    await this.loadGlobalPlans();
    return true;
  },

  async setGlobalPlanHidden(plan, isHidden) {
    const key = String(plan.id || plan.presetKey || plan.globalPlanId || plan.name || "");
    const saveLocalHiddenKey = () => {
      const keys = JSON.parse(localStorage.getItem("hidden_global_plan_keys") || "[]");
      const nextKeys = isHidden
        ? Array.from(new Set([...keys, key]))
        : keys.filter(item => item !== key);
      localStorage.setItem("hidden_global_plan_keys", JSON.stringify(nextKeys));
    };

    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo) && key && key.includes("-")) {
      try {
        const { error } = await state.supabase
          .from("global_plans")
          .update({ is_hidden: isHidden })
          .eq("id", key);

        if (error) {
          console.warn("Failed to update global plan hidden state in Supabase, falling back to local hidden list:", error);
          saveLocalHiddenKey();
        }
      } catch (e) {
        console.warn("Error updating global plan hidden state, falling back to local hidden list:", e);
        saveLocalHiddenKey();
      }
    } else {
      saveLocalHiddenKey();
    }

    if (state.globalPlans) {
      state.globalPlans = state.globalPlans.map(p => {
        const matches = [p.id, p.presetKey, p.globalPlanId, p.name].filter(Boolean).map(String).includes(key);
        return matches ? { ...p, isHidden } : p;
      });
    }

    const localGlobal = localStorage.getItem("global_plans_presets");
    if (localGlobal) {
      const list = JSON.parse(localGlobal).map(p => {
        const matches = [p.id, p.presetKey, p.globalPlanId, p.name].filter(Boolean).map(String).includes(key);
        return matches ? { ...p, isHidden } : p;
      });
      localStorage.setItem("global_plans_presets", JSON.stringify(list));
    }

    await this.loadGlobalPlans();
    return true;
  },

  async deleteGlobalPlan(planId) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const { error } = await state.supabase
          .from("global_plans")
          .delete()
          .eq("id", planId);

        if (error) {
          console.error("Failed to delete global plan in Supabase:", error);
          showToast(`刪除計畫失敗: ${error.message || error}`);
          return false;
        }
      } catch (e) {
        console.error("Error deleting global plan in Supabase:", e);
        showToast(`刪除計畫出錯: ${e.message || e}`);
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
  },

  async fetchAnnouncements() {
    if (state.isSupabaseMode && state.supabase) {
      try {
        const { data, error } = await state.supabase
          .from('church_announcements')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) {
          console.error("Error fetching announcements from Supabase:", error);
          return [];
        }
        return data || [];
      } catch (e) {
        console.error("Error fetching announcements:", e);
        return [];
      }
    } else {
      const local = localStorage.getItem("church_announcements");
      return local ? JSON.parse(local) : [
        { 
          id: 'default-welcome', 
          title: '📢 歡迎使用速讀挑戰系統！', 
          content: '親愛的弟兄姊妹平安，歡迎加入教會季度速讀挑戰。讓我們一起藉著每日讀經，更加認識神、親近神！如有任何問題，請洽詢教會管理員。', 
          created_at: new Date().toISOString() 
        }
      ];
    }
  },

  async saveAnnouncement(title, content) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const user = await this.getCurrentDbUser();
        const userId = user ? user.id : (state.currentUser ? state.currentUser.id : null);
        const { error } = await state.supabase
          .from('church_announcements')
          .insert([{ title, content, created_by: userId }]);
        if (error) {
          console.error("Error saving announcement in Supabase:", error);
          showToast(`發布公告失敗: ${error.message || error}`);
          return false;
        }
        return true;
      } catch (e) {
        console.error("Error saving announcement:", e);
        return false;
      }
    } else {
      const current = await this.fetchAnnouncements();
      const newAnn = {
        id: Date.now().toString(),
        title,
        content,
        created_at: new Date().toISOString()
      };
      current.unshift(newAnn);
      localStorage.setItem("church_announcements", JSON.stringify(current));
      return true;
    }
  },

  async deleteAnnouncement(id) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const { error } = await state.supabase
          .from('church_announcements')
          .delete()
          .eq('id', id);
        if (error) {
          console.error("Error deleting announcement in Supabase:", error);
          showToast(`刪除公告失敗: ${error.message || error}`);
          return false;
        }
        return true;
      } catch (e) {
        console.error("Error deleting announcement:", e);
        return false;
      }
    } else {
      let current = await this.fetchAnnouncements();
      current = current.filter(a => a.id !== id);
      localStorage.setItem("church_announcements", JSON.stringify(current));
      return true;
    }
  }
};
