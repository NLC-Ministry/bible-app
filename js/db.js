

/**
 * 依計畫名稱查找 CHURCH_PLAN_PRESETS 的 key（僅作舊資料 fallback 使用）
 * @param {string} name
 * @returns {string|null}
 */
function getPresetKeyByName(name) {
  if (!name) return null;
  const target = String(name).trim();
  const match = Object.entries(CHURCH_PLAN_PRESETS).find(([, preset]) =>
    String(preset.name || "").trim() === target
  );
  return match ? match[0] : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function quotePostgrestValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A plan can be referenced by a global UUID, a legacy preset key (for example
 * q1), or its display name. Keep all aliases together so older enrollments are
 * included in the same church-wide statistics as newer enrollments.
 */
function getPlanFilterAliases(filterValue) {
  if (!filterValue) return [];

  const aliases = new Set([String(filterValue)]);
  const activePlan = state.activePlan || null;
  const activeIdentifiers = activePlan
    ? [activePlan.id, activePlan.globalPlanId, activePlan.presetKey, activePlan.name].filter(Boolean).map(String)
    : [];

  const presetKey = CHURCH_PLAN_PRESETS[filterValue]
    ? String(filterValue)
    : getPresetKeyByName(filterValue);

  const activePresetKey = activePlan
    ? (CHURCH_PLAN_PRESETS[activePlan.presetKey] ? activePlan.presetKey : getPresetKeyByName(activePlan.name))
    : null;
  const matchesActivePlan = activeIdentifiers.includes(String(filterValue))
    || (presetKey && activePresetKey === presetKey);

  if (matchesActivePlan) {
    activeIdentifiers.forEach(value => aliases.add(value));
  }

  const resolvedPresetKey = presetKey || (matchesActivePlan ? activePresetKey : null);
  if (resolvedPresetKey && CHURCH_PLAN_PRESETS[resolvedPresetKey]) {
    aliases.add(resolvedPresetKey);
    aliases.add(CHURCH_PLAN_PRESETS[resolvedPresetKey].name);
  }

  (state.globalPlans || []).forEach(plan => {
    const planIdentifiers = [plan.id, plan.globalPlanId, plan.presetKey, plan.name].filter(Boolean).map(String);
    const planPresetKey = plan.presetKey && CHURCH_PLAN_PRESETS[plan.presetKey]
      ? plan.presetKey
      : getPresetKeyByName(plan.name);
    if (planIdentifiers.some(value => aliases.has(value)) || (resolvedPresetKey && planPresetKey === resolvedPresetKey)) {
      planIdentifiers.forEach(value => aliases.add(value));
    }
  });

  return Array.from(aliases);
}

function mapGlobalPlanRecord(dbPlan) {
  const isCampaignMaster = dbPlan.plan_kind === "church_campaign"
    || dbPlan.id === window.CHURCH_CAMPAIGN_ID;
  const isCampaignStage = dbPlan.plan_kind === "church_campaign_stage";
  let campaignDefinition = null;

  if (isCampaignMaster) {
    const stored = dbPlan.rules && Array.isArray(dbPlan.rules.stages) && Array.isArray(dbPlan.rules.segments)
      ? dbPlan.rules
      : window.CHURCH_CAMPAIGN;
    campaignDefinition = window.cloneChurchCampaign(stored);
  } else if (isCampaignStage) {
    const storedStageNo = Number(dbPlan.rules && dbPlan.rules.stageNo)
      || Number(String(dbPlan.id || "").slice(-12));
    const stored = dbPlan.rules && Array.isArray(dbPlan.rules.stages) && Array.isArray(dbPlan.rules.segments)
      ? dbPlan.rules
      : window.getChurchCampaignStageDefinition(storedStageNo);
    if (stored) campaignDefinition = window.cloneChurchCampaign(stored);
  }

  const campaignBooks = campaignDefinition
    ? Array.from(new Set(campaignDefinition.segments.flatMap(segment => segment.readings.map(reading => reading.book))))
    : [];
  return {
    id: dbPlan.id,
    globalPlanId: dbPlan.id,
    parentCampaignId: campaignDefinition && campaignDefinition.parentCampaignId,
    name: isCampaignMaster ? "教會階段規則設定" : (campaignDefinition ? campaignDefinition.name : dbPlan.name),
    description: campaignDefinition ? campaignDefinition.description : dbPlan.description,
    startDate: campaignDefinition ? campaignDefinition.startDate : dbPlan.start_date,
    endDate: campaignDefinition ? campaignDefinition.endDate : dbPlan.end_date,
    books: Array.isArray(dbPlan.target_books) && dbPlan.target_books.length > 0 ? dbPlan.target_books : campaignBooks,
    presetKey: campaignDefinition && campaignDefinition.presetKey ? campaignDefinition.presetKey : dbPlan.id,
    isHidden: Boolean(dbPlan.is_hidden),
    isFixed: dbPlan.is_fixed !== false,
    is_fixed: dbPlan.is_fixed !== false,
    planKind: isCampaignMaster ? "church_campaign" : (isCampaignStage ? "church_campaign_stage" : (dbPlan.plan_kind || "standard")),
    stageNo: campaignDefinition && Number(campaignDefinition.stageNo),
    roundNo: campaignDefinition && Number(campaignDefinition.roundNo),
    phase: campaignDefinition && campaignDefinition.phase,
    awardName: campaignDefinition && campaignDefinition.awardName,
    examDate: campaignDefinition && campaignDefinition.examDate,
    ruleVersion: Number(dbPlan.rule_version || campaignDefinition && campaignDefinition.version || 1),
    publishedAt: dbPlan.published_at || null,
    campaignDefinition
  };
}

function migrateLocalChurchCampaignToStages(plans, logs) {
  const list = Array.isArray(plans) ? plans : [];
  const legacyPlans = list.filter(plan =>
    plan && (plan.planKind === "church_campaign"
      || plan.presetKey === window.CHURCH_CAMPAIGN_PRESET_KEY
      || plan.id === window.CHURCH_CAMPAIGN_ID
      || plan.globalPlanId === window.CHURCH_CAMPAIGN_ID
      || String(plan.name || "").replace(/[–—]/g, "-").trim() === "2026-2029 新生生命聖經速讀計畫")
  );
  if (legacyPlans.length === 0) return { plans: list, logs: Array.isArray(logs) ? logs : [], migrated: false };

  const sourceDefinition = legacyPlans.find(plan => plan.campaignDefinition && Array.isArray(plan.campaignDefinition.stages));
  const masterDefinition = sourceDefinition ? sourceDefinition.campaignDefinition : window.CHURCH_CAMPAIGN;
  const stages = window.createChurchCampaignStageDefinitions(masterDefinition);
  const legacyIdentifiers = new Set(legacyPlans.flatMap(plan => [plan.id, plan.globalPlanId, plan.presetKey, plan.name]).filter(Boolean).map(String));
  const retainedPlans = list.filter(plan => !legacyPlans.includes(plan));
  const existingStageKeys = new Set(retainedPlans.flatMap(plan => [plan.id, plan.globalPlanId, plan.presetKey]).filter(Boolean).map(String));
  const scheduleSource = legacyPlans[0] || {};

  stages.forEach(stage => {
    if ([stage.id, stage.presetKey].some(key => existingStageKeys.has(String(key)))) return;
    const stagePlan = generatePlanObject(stage.name, stage.startDate, stage.endDate, stage.books, stage.presetKey, "normal", true, {
      readingDaysPerWeek: scheduleSource.readingDaysPerWeek || scheduleSource.reading_days_per_week,
      restWeekdays: scheduleSource.restWeekdays || scheduleSource.rest_weekdays
    });
    stagePlan.id = stage.id;
    stagePlan.globalPlanId = stage.id;
    stagePlan.presetKey = stage.presetKey;
    retainedPlans.push(stagePlan);
  });

  const migratedLogs = (Array.isArray(logs) ? logs : []).map(log => {
    const belongsToLegacy = [log.plan_id, log.presetKey].filter(Boolean).map(String).some(value => legacyIdentifiers.has(value));
    if (!belongsToLegacy) return log;
    const stage = stages.find(item => item.books.includes(log.book));
    return stage ? { ...log, plan_id: stage.id, presetKey: stage.presetKey } : log;
  });

  return { plans: retainedPlans, logs: migratedLogs, migrated: true };
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
  _mergedUsersCache: {},
  _mergedUsersPromise: {},

  // Initialize Supabase Connection
  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || 
                        hostname === '127.0.0.1' || 
                        hostname === '::1' || 
                        hostname.startsWith('192.168.') || 
                        hostname.startsWith('10.') || 
                        hostname.startsWith('172.') || 
                        hostname.endsWith('.local');
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
      btnGoogleGateEarly.addEventListener("click", async (e) => {
        e.preventDefault();
        if (state.supabase) {
          loader.show("引導至 Google 登入中...");
          try {
            const { error } = await state.supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo: window.location.origin
              }
            });
            if (error) throw error;
          } catch (err) {
            alert(`Google 登入失敗: ${err.message || err}`);
            loader.hide();
          }
        } else {
          alert("Supabase 尚未初始化！");
        }
      });
    }

    const btnDemoGateEarly = document.getElementById("btn-gate-demo-login");
    if (btnDemoGateEarly) {
      btnDemoGateEarly.style.display = allowGoogleLogin ? "inline-flex" : "none";
      btnDemoGateEarly.addEventListener("click", async (e) => {
        e.preventDefault();
        loader.show("進入 Demo 模式中...");
        try {
          db.setDemoMode();
          db.updateAuthUI(null);
          await db.loadUserData(true);
          // Trigger view update
          if (typeof updateDashboardView === 'function') updateDashboardView();
          if (typeof updateHeaderAvatar === 'function') updateHeaderAvatar();
        } catch (err) {
          console.error("Demo login failed:", err);
        } finally {
          loader.hide();
        }
      });
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
            this.refreshRoleDependentUI();
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
            if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();

            if (appRouter.currentTab === "dashboard-view") {
              if (typeof updateDashboardView === 'function') updateDashboardView();
            } else if (appRouter.currentTab === "plan-view") {
              if (typeof window.renderPlanView === 'function') window.renderPlanView();
            } else if (appRouter.currentTab === "profile-view") {
              if (typeof renderProfileView === 'function') renderProfileView();
            } else if (appRouter.currentTab === "stats-view") {
              if (typeof window.updateStatsView === 'function') window.updateStatsView();
            }
          } catch (err) {
            console.error("Error in onAuthStateChange callback:", err);
          }
        });
      } catch (e) {
        console.error("Supabase connection failed:", e);
        const message = "\u767b\u5165\u540c\u6b65\u5931\u6557\uFF08" + (e.message || e) + "\uFF09\uFF0C\u8acb\u91cd\u65b0\u767b\u5165\u3002";
        this.showConnectionError(message);
      }
    } else {
      if (forceOfflineDemo) {
        this.setDemoMode();
        this.updateAuthUI(null);
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

  createNlcDataClient() {
    const cfg = state.supabaseConfig || {};
    const callEdge = async (request) => {
      if (typeof auth === "undefined") throw new Error("NLC auth client is missing.");
      const send = async (forceRefresh = false) => {
        const accessToken = await auth.getValidAccessToken(forceRefresh);
        const response = await fetch(cfg.url.replace(/\/+$/, "") + "/functions/v1/nlc-data", {
          method: "POST",
          headers: {
            apikey: cfg.anonKey,
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(request)
        });
        const payload = await response.json().catch(() => ({}));
        return { response, payload };
      };

      let { response, payload } = await send(false);
      const tokenRejected = response.status === 401 || payload?.message?.includes("invalid_token") || payload?.message?.includes("Invalid token") || payload?.error === "invalid_token";
      if (tokenRejected) {
        ({ response, payload } = await send(true));
      }

      if (!response.ok) return { data: null, error: payload };
      if (payload.profile) this.applyNlcProfile(payload.profile, payload.locked_fields || null);
      return {
        data: payload.data,
        error: null,
        profile: payload.profile || null,
        profile_id: payload.profile_id || null,
        project_url: payload.project_url || null,
        locked_fields: payload.locked_fields || null
      };
    };

    class NlcQueryBuilder {
      constructor(table) {
        this.request = { table, action: null, filters: [] };
      }
      select(columns = "*") {
        if (!this.request.action) this.request.action = "select";
        this.request.select = columns;
        return this;
      }
      insert(payload) {
        this.request.action = "insert";
        this.request.payload = payload;
        return this;
      }
      update(payload) {
        this.request.action = "update";
        this.request.payload = payload;
        return this;
      }
      delete() {
        this.request.action = "delete";
        return this;
      }
      upsert(payload, options) {
        this.request.action = "upsert";
        this.request.payload = payload;
        this.request.options = options || null;
        return this;
      }
      eq(column, value) {
        this.request.filters.push({ type: "eq", column, value });
        return this;
      }
      is(column, value) {
        this.request.filters.push({ type: "is", column, value });
        return this;
      }
      in(column, value) {
        this.request.filters.push({ type: "in", column, value });
        return this;
      }
      or(expression) {
        this.request.or = expression;
        return this;
      }
      order(column, options = {}) {
        this.request.order = { column, ascending: options.ascending !== false };
        return this;
      }
      limit(count) {
        this.request.limit = count;
        return this;
      }
      single() {
        this.request.returning = "single";
        return this;
      }
      maybeSingle() {
        this.request.returning = "maybeSingle";
        return this;
      }
      async execute() {
        if (!this.request.action) this.request.action = "select";
        return callEdge(this.request);
      }
      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      }
    }

    return {
      async saveProfile(payload) {
        return callEdge({ action: "save_profile", payload });
      },
      from(table) {
        return new NlcQueryBuilder(table);
      },
      rpc(functionName, args = {}) {
        return {
          execute: () => callEdge({ action: "rpc", function: functionName, args }),
          then(resolve, reject) {
            return this.execute().then(resolve, reject);
          }
        };
      },
      auth: {
        async getUser() {
          return { data: { user: state.currentProfileId ? { id: state.currentProfileId, oidc: true } : null }, error: null };
        },
        async getSession() {
          return { data: { session: auth && auth.isLoggedIn() ? { user: { id: state.currentProfileId } } : null }, error: null };
        },
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } } };
        }
      }
    };
  },

  applyNlcProfile(profile, lockedFields = null) {
    if (!profile) return;
    state.currentProfileId = profile.id;
    state.currentUser.id = profile.id;
    state.currentUser.name = profile.name || state.currentUser.name || "NLC User";
    state.currentUser.great_region = profile.great_region || "";
    state.currentUser.pastoral_zone = profile.pastoral_zone || "";
    state.currentUser.small_group = profile.small_group || "";
    state.currentUser.role = profile.role || "member";
    state.currentUser.hasRequiredPlacement = profile.hasRequiredPlacement === true;
    if (profile.email) state.currentUser.email = profile.email;
    if (profile.membership_status) state.membershipStatus = profile.membership_status;
    if (profile.avatar_url) state.currentUser.avatar_url = profile.avatar_url;
    if (Array.isArray(lockedFields)) state.profileLockedFields = lockedFields;
    state.currentUser.is_demo = !!profile.is_demo;
    state.realRole = state.currentUser.role;
    this.refreshRoleDependentUI();
  },

  refreshRoleDependentUI() {
    if (typeof updateAdminNavVisibility === "function") {
      updateAdminNavVisibility();
    }
    if (typeof updateProfileDropdown === "function") {
      updateProfileDropdown();
    }
    if (typeof refreshUserAvatars === "function") {
      refreshUserAvatars();
    }
  },

  async syncNlcSessionWithSupabase(force = false) {
    if (typeof auth === "undefined" || !auth.isLoggedIn()) return null;

    const cachedExpiresAt = Number(localStorage.getItem("nlc_edge_session_expires_at") || "0");
    const cachedProfile = localStorage.getItem("nlc_supabase_profile");
    if (!force && cachedExpiresAt > Date.now() + 60000) {
      state.supabase = this.createNlcDataClient();
      const cachedLockedFields = JSON.parse(localStorage.getItem("nlc_profile_locked_fields") || "[]");
      if (cachedProfile) this.applyNlcProfile(JSON.parse(cachedProfile), cachedLockedFields);
      return { edge_session: true, profile: cachedProfile ? JSON.parse(cachedProfile) : null, locked_fields: cachedLockedFields };
    }

    const accessToken = await auth.getValidAccessToken();
    const idToken = localStorage.getItem(auth.keys.idToken);

    const cfg = state.supabaseConfig || {};
    const functionUrl = cfg.url.replace(/\/+$/, "") + "/functions/v1/nlc-session";
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        access_token: accessToken,
        id_token: idToken
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.edge_session) {
      console.error("❌ NLC Session Sync Failed Payload:", payload);
      throw new Error(payload.message || payload.error || "NLC session sync failed: " + response.status);
    }


    localStorage.removeItem("nlc_supabase_access_token");
    localStorage.removeItem("nlc_supabase_expires_at");
    localStorage.setItem("nlc_edge_session_expires_at", String(Date.now() + 10 * 60 * 1000));
    if (payload.profile) {
      if (payload.membership_status) {
        payload.profile.membership_status = payload.membership_status;
      }
      if (typeof payload.has_required_placement === "boolean") {
        payload.profile.hasRequiredPlacement = payload.has_required_placement;
      }
      localStorage.setItem("nlc_supabase_profile", JSON.stringify(payload.profile));
    }
    localStorage.setItem("nlc_profile_locked_fields", JSON.stringify(payload.locked_fields || []));

    state.supabase = this.createNlcDataClient();
    this.applyNlcProfile(payload.profile, payload.locked_fields || []);
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

  showConnectionError(message = "\u767b\u5165\u540c\u6b65\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002") {
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
      gateDot.style.backgroundColor = "var(--color-danger)";
      gateText.textContent = message;
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
  _userDataPromise: null,
  applyReadingLogsSnapshot(rawLogs, { notify = false, source = "initial" } = {}) {
    const uniqueMap = {};
    (rawLogs || []).forEach(log => {
      const round = log.round || 1;
      const planKey = log.plan_id || "";
      const key = `${log.book}_${log.chapter}_${planKey}_${round}`;
      if (!uniqueMap[key] || new Date(log.read_at) > new Date(uniqueMap[key].read_at)) uniqueMap[key] = log;
    });
    state.readingLogs = Object.values(uniqueMap);
    if (state.currentUser) state.currentUser.chapters_read = state.readingLogs.length;
    if (notify) {
      window.dispatchEvent(new CustomEvent("app:dataRefresh", {
        detail: { scope: "plan", source: `repository-${source}` }
      }));
    }
    return state.readingLogs;
  },

  async loadUserData(force = false) {
    if (force) {
      this._userDataPromise = null;
    }
    if (this._userDataPromise) {
      return this._userDataPromise;
    }
    this._userDataPromise = (async () => {
      try {
        if (state.isSupabaseMode && state.supabase) {
      if (state.currentUser) {
        state.currentUser.is_demo = false;
      }

      let user = null;
      const isOidcMode = typeof auth !== "undefined" && auth.isLoggedIn();
      if (isOidcMode) {
        // 💡 效能優化：不要重複強制同步（force=false），直接使用 db.init() 剛拿到的最新快取
        await this.syncNlcSessionWithSupabase(false);
        user = state.currentProfileId ? { id: state.currentProfileId, oidc: true } : null;
      }

      if (!user) {
        user = await this.getCurrentDbUser();
      }

      if (user) {
        // 💡 效能優化：平行化載入 global_plans, profiles, reading_logs, reading_plans
        // 避開多個 sequential 網路請求產生的累積延遲與 cold start 問題！
        const [globalPlansResult, profileResult, logsResult, plansResult] = await Promise.all([
          state.supabase.from("global_plans").select("*").order("start_date", { ascending: true }),
          state.supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
          window.readingLogRepository
            ? window.readingLogRepository.fetch({
              cacheKey: `reading_logs:${user.id}`,
              query: table => table.select("book, chapter, read_at, plan_id, round").eq("user_id", user.id),
              onData: (rows, meta) => this.applyReadingLogsSnapshot(rows, { notify: true, source: meta.source })
            })
            : state.supabase.from("reading_logs").select("book, chapter, read_at, plan_id, round").eq("user_id", user.id),
          state.supabase.from("reading_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
        ]);

        if (globalPlansResult.error) console.error("❌ global_plans load failed:", globalPlansResult.error);
        if (profileResult.error) console.error("❌ profile load failed:", profileResult.error);
        if (logsResult.error) console.error("❌ reading_logs load failed:", logsResult.error);
        if (plansResult.error) console.error("❌ reading_plans load failed:", plansResult.error);

        // 處理 global_plans
        if (globalPlansResult.data) {
          state.globalPlans = globalPlansResult.data.map(mapGlobalPlanRecord);
        } else {
          state.globalPlans = [];
        }

        // 1. Load / sync profile
        if (!user.oidc) {
          // Standard Supabase auth: load profile from our profiles table
          const profile = profileResult.data;
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
          const profile = profileResult.data;
          if (profile) this.applyNlcProfile(profile);
          state.currentUser.is_demo = false;
        }

        // 2. Load Reading Logs
        const rawLogs = logsResult.data || [];
        this.applyReadingLogsSnapshot(rawLogs);

        // 3. Load Active Reading Plans
        const plans = plansResult.data || [];
        state.activePlans = [];
        if (plans && plans.length > 0) {
          plans.forEach(dbPlan => {
            try {
              const globalPlanId = dbPlan.global_plan_id || null;
              const key = dbPlan.preset_key
                || (globalPlanId ? globalPlanId : null)
                || getPresetKeyByName(dbPlan.name);

              const isFixed = dbPlan.is_fixed !== false;
              const planObj = generatePlanObject(dbPlan.name, dbPlan.start_date, dbPlan.end_date, dbPlan.target_books, key, dbPlan.level || 'normal', isFixed, {
                readingDaysPerWeek: dbPlan.reading_days_per_week,
                restWeekdays: dbPlan.rest_weekdays
              });
              planObj.id = dbPlan.id;
              planObj.globalPlanId = globalPlanId;  // ⚠️ UUID 關聯
              planObj.isFixed = isFixed;
              planObj.is_fixed = isFixed;
              const linkedGlobalPlan = (state.globalPlans || []).find(p => p.id === globalPlanId || p.presetKey === key || p.name === dbPlan.name);
              planObj.isHidden = Boolean(linkedGlobalPlan && (linkedGlobalPlan.isHidden || linkedGlobalPlan.is_hidden));
              planObj.level = dbPlan.level || 'normal';
              planObj.currentRound = dbPlan.current_round || 1;
              planObj.wasDowngraded = dbPlan.was_downgraded || false;
              planObj.downgradeLockedUntil = dbPlan.downgrade_locked_until || getLocalPlanDowngradeLock(planObj);
              planObj.upgradePromptHandled = !!dbPlan.upgrade_prompt_handled;
              state.activePlans.push(planObj);
            } catch (err) {
              console.error("Failed to parse dbPlan:", dbPlan, err);
            }
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
          await checkAchievements(true);
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
        const localCampaignMigration = migrateLocalChurchCampaignToStages(state.activePlans, state.readingLogs);
        state.activePlans = localCampaignMigration.plans;
        if (localCampaignMigration.migrated) {
          state.readingLogs = localCampaignMigration.logs;
          localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs));
        }
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
                const freshPlan = generatePlanObject(plan.name, plan.startDate, plan.endDate, plan.target_books || preset.books, plan.presetKey, plan.level || 'normal');
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

      const defaultDemoPresetKey = Object.keys(CHURCH_PLAN_PRESETS)[0];
      const defaultDemoPreset = CHURCH_PLAN_PRESETS[defaultDemoPresetKey];


      state.activePlan = generatePlanObject(defaultDemoPreset.name, defaultDemoPreset.startDate, defaultDemoPreset.endDate, defaultDemoPreset.books, defaultDemoPresetKey);
      state.activePlan.progress = 72;
      state.activePlan.completedChapters = Math.round((state.activePlan.totalChapters * 72) / 100);
      state.activePlans = [state.activePlan];

      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      localStorage.setItem("selected_plan_key", defaultDemoPresetKey);

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
          await checkAchievements(true);
        }
        if (typeof updateAdminNavVisibility === 'function') {
          updateAdminNavVisibility();
        }
      } finally {
        this._userDataPromise = null;
      }
    })();
    return this._userDataPromise;
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
        // 💡 效能優化：平行化讀取組織結構，避免 3 次序列網路查詢
        const [regionsResult, zonesResult, groupsResult] = await Promise.all([
          state.supabase.from("great_regions").select("id, name"),
          state.supabase.from("pastoral_zones").select("id, name, great_region_id"),
          state.supabase.from("small_groups").select("id, name, pastoral_zone_id")
        ]);

        if (regionsResult.error) throw regionsResult.error;
        if (zonesResult.error) throw zonesResult.error;
        if (groupsResult.error) throw groupsResult.error;

        const regions = regionsResult.data || [];
        const zones = zonesResult.data || [];
        const groups = groupsResult.data || [];

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
    console.log('🏗️ [系統審計] 進入資料讀寫，當前操作類型：資料庫寫入進度', '資料版本:', state.dataVersion);
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
      } else {
        existingLog.read_at = todayISO;
        if (!existingLog.plan_id && planId) existingLog.plan_id = planId;
        if (!existingLog.presetKey && presetKey) existingLog.presetKey = presetKey;
      }

      // The plan UI updates state.readingLogs optimistically before this runs.
      // Always persist independently; local existence does not mean a DB row exists.
      if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
        const user = await this.getCurrentDbUser();
        if (!user || !user.id) {
          const authError = new Error("Unable to persist reading progress: authenticated profile unavailable");
          authError.status = 401;
          throw authError;
        }

        const row = {
          user_id: user.id,
          plan_id: planId,
          book,
          chapter: Number(chapter),
          read_at: todayISO,
          round: Number(round)
        };
        const cacheKey = `reading_logs:${user.id}`;
        const repository = window.readingLogRepository || null;
        let writeResult;
        if (planId) {
          writeResult = repository
            ? await repository.upsert(row, { onConflict: "user_id,plan_id,book,chapter,round" }, { invalidate: [cacheKey] })
            : await state.supabase.from("reading_logs").upsert(row, { onConflict: "user_id,plan_id,book,chapter,round" });
        } else {
          const deleteResult = repository
            ? await repository.delete(query => query.eq("user_id", user.id).eq("book", book)
              .eq("chapter", chapter).eq("round", round).is("plan_id", null), { invalidate: [cacheKey] })
            : await state.supabase.from("reading_logs").delete()
              .eq("user_id", user.id).eq("book", book).eq("chapter", chapter)
              .eq("round", round).is("plan_id", null);
          if (deleteResult && deleteResult.error) {
            throw new Error(deleteResult.error.message || deleteResult.error.error || String(deleteResult.error));
          }
          writeResult = repository
            ? await repository.insert(row, { invalidate: [cacheKey] })
            : await state.supabase.from("reading_logs").insert(row);
        }
        if (writeResult && writeResult.error) {
          throw new Error(writeResult.error.message || writeResult.error.error || String(writeResult.error));
        }
      }
    } else {
      state.readingLogs = state.readingLogs.filter(l => !isSameChapterLog(l));

      if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
        const user = await this.getCurrentDbUser();
        if (user) {
          const applyDeleteFilters = query => {
            query = query.eq("user_id", user.id).eq("book", book).eq("chapter", chapter).eq("round", round);
            return planId ? query.or(`plan_id.eq.${planId},plan_id.is.null`) : query.is("plan_id", null);
          };
          const cacheKey = `reading_logs:${user.id}`;
          const deleteResult = window.readingLogRepository
            ? await window.readingLogRepository.delete(applyDeleteFilters, { invalidate: [cacheKey] })
            : await applyDeleteFilters(state.supabase.from("reading_logs").delete());
          if (deleteResult && deleteResult.error) {
            throw new Error(deleteResult.error.message || deleteResult.error.error || String(deleteResult.error));
          }
        }
      }
    }

    if (!state.isSupabaseMode) {
      localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs));
    }

    this.calculateStreak();
    this.saveLocalUserStats();

    if (state.isSupabaseMode && state.supabase) {
      // 💡 效能與體驗優化：將個人資料統計同步改為非同步背景執行，不要阻塞使用者的勾選動作
      this.syncProfileStatsToSupabase().catch(err => {
        console.warn("Failed to sync profile stats in background:", err);
      });
    }
    if (typeof checkAchievements !== 'undefined') {
      await checkAchievements();
    }
  },

  async syncProfileStatsToSupabase() {
    if (state.currentUser && state.currentUser.is_demo) {
      console.warn("syncProfileStatsToSupabase aborted: current user is demo user.");
      return { aborted: true, reason: "demo" };
    }

    // 💡 關鍵修復：在呼叫 getCurrentDbUser() 之前，先備份使用者剛剛填寫的編輯資料
    // 因為 getCurrentDbUser() 會調用 syncNlcSessionWithSupabase()，這會從快取中載入舊資料並覆寫 state.currentUser！
    const editedName = state.currentUser.name || "";
    const editedRegion = state.currentUser.great_region || "";
    const editedZone = state.currentUser.pastoral_zone || "";
    const editedGroup = state.currentUser.small_group || "";

    const user = await this.getCurrentDbUser();
    if (!user) {
      throw new Error("Current login session is unavailable. Please sign in again.");
    }

    {
      const regionObj = state.orgStructure && state.orgStructure.rawRegions ? state.orgStructure.rawRegions.find(r => r.name === editedRegion) : null;
      const zoneObj = state.orgStructure && state.orgStructure.rawZones ? state.orgStructure.rawZones.find(z => z.name === editedZone) : null;
      const groupObj = state.orgStructure && state.orgStructure.rawGroups ? state.orgStructure.rawGroups.find(g => g.name === editedGroup) : null;

      const profilePayload = {
        id: user.id,
        name: editedName,
        great_region: editedRegion,
        pastoral_zone: editedZone,
        small_group: editedGroup,
        great_region_id: regionObj ? regionObj.id : null,
        pastoral_zone_id: zoneObj ? zoneObj.id : null,
        small_group_id: groupObj ? groupObj.id : null,
        updated_at: new Date().toISOString()
      };



      const saveResult = state.supabase.saveProfile
        ? await state.supabase.saveProfile(profilePayload)
        : await state.supabase.from("profiles").upsert(profilePayload, { onConflict: "id" }).select("*").single();
      const { data, error } = saveResult;
      if (error) throw new Error(error.message || error.error || error);
      if (state.supabase.saveProfile && !saveResult.project_url) {
        throw new Error("個人資料暫時無法儲存，請稍後再試。");
      }

      if (!state.supabase.saveProfile) {
        saveResult.project_url = state.supabaseConfig && state.supabaseConfig.url ? state.supabaseConfig.url : null;
        saveResult.profile = data || null;
      }

      let verifiedProfile = data || null;
      if (!verifiedProfile || verifiedProfile.id !== user.id) {
        const verifyResult = await state.supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (verifyResult.error) throw new Error(verifyResult.error.message || verifyResult.error.error || verifyResult.error);
        verifiedProfile = verifyResult.data || null;
      }

      if (!verifiedProfile || verifiedProfile.id !== user.id) {

        throw new Error("個人資料尚未成功儲存，請稍後再試。");
      }

      // 💡 關鍵修復：儲存成功後，立即更新 LocalStorage 快取檔案，防止重新整理或快取載入時再次被舊資料覆寫！
      localStorage.setItem("nlc_supabase_profile", JSON.stringify(verifiedProfile));
      this.applyNlcProfile(verifiedProfile);
      return saveResult;
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

  async fetchMergedUsersList(filterPresetKey = null, ignorePlanFilter = false) {
    if (ignorePlanFilter) {
      filterPresetKey = false;
    } else if (!filterPresetKey && state.activePlan) {
      filterPresetKey = state.activePlan.globalPlanId || state.activePlan.presetKey || state.activePlan.name || state.activePlan.id;
    }
    const cacheKey = filterPresetKey || 'all';

    // 1. Concurrent request deduplication
    if (this._mergedUsersPromise[cacheKey]) {
      return this._mergedUsersPromise[cacheKey];
    }

    // 2. Cache expiration validation (5-second TTL)
    const cachedEntry = this._mergedUsersCache[cacheKey];
    const now = Date.now();
    if (cachedEntry && (now - cachedEntry.timestamp < 5000)) {
      return cachedEntry.data;
    }

    // 3. Create the actual load promise
    const loadPromise = (async () => {
      try {
        const result = await this._executeFetchMergedUsersList(filterPresetKey);
        this._mergedUsersCache[cacheKey] = {
          data: result,
          timestamp: Date.now()
        };
        return result;
      } finally {
        delete this._mergedUsersPromise[cacheKey];
      }
    })();

    this._mergedUsersPromise[cacheKey] = loadPromise;
    return loadPromise;
  },

  async _executeFetchMergedUsersList(filterPresetKey) {
    const planFilterAliases = getPlanFilterAliases(filterPresetKey);
    const planFilterAliasSet = new Set(planFilterAliases);
    const currentPlanId = state.activePlan ? state.activePlan.id : null;
    const currentPresetKey = state.activePlan ? state.activePlan.presetKey : null;
    const currentPlanLogMap = new Map();
    (state.readingLogs || []).forEach(log => {
      const logPlanId = log.plan_id || null;
      const logPresetKey = log.presetKey || log.preset_key || null;
      const matchesPlan =
        (currentPlanId && logPlanId && logPlanId === currentPlanId) ||
        (currentPresetKey && logPresetKey && logPresetKey === currentPresetKey) ||
        ((currentPlanId || currentPresetKey) && !logPlanId && !logPresetKey) ||
        (!currentPlanId && !currentPresetKey && !logPlanId && !logPresetKey);
      if (!matchesPlan) return;
      const round = log.round || 1;
      currentPlanLogMap.set(`${log.book}_${log.chapter}_${round}`, log);
    });
    const currentPlanLogs = Array.from(currentPlanLogMap.values());
    const currentPlanLastRead = currentPlanLogs.length > 0
      ? currentPlanLogs.map(log => log.read_at).filter(Boolean).sort().reverse()[0]?.substring(0, 10)
      : null;

    const mockUser = {
      name: state.currentUser.name,
      great_region: state.currentUser.great_region || "",
      pastoral_zone: state.currentUser.pastoral_zone || "",
      small_group: state.currentUser.small_group || "",
      role: state.currentUser.role || "member",
      chapters_read: currentPlanLogs.length,
      plan_progress: state.activePlan ? (state.activePlan.progress || 0) : 0,
      last_read: currentPlanLastRead
    };

    if (state.isSupabaseMode && state.supabase) {
      try {
        const { data: usersProfiles, error: profilesError } = await state.supabase.from("profiles").select("id, name, email, great_region, pastoral_zone, small_group, role, managed_regions, managed_zones, managed_groups").eq("is_demo", false);
        console.log(`🔍 [AdminDebug] profiles 查詢結果: ${usersProfiles ? usersProfiles.length : 0} 筆`, profilesError ? `錯誤: ${profilesError.message}` : '');
        if (usersProfiles) console.log('🔍 [AdminDebug] profiles 名單:', usersProfiles.map(u => `${u.name}(${u.role})`));
        
        let plansQuery = state.supabase.from("reading_plans").select("id, user_id, name, preset_key, global_plan_id, target_books, current_round, level");
        if (filterPresetKey) {
          const textConditions = planFilterAliases.flatMap(alias => [
            `preset_key.eq.${quotePostgrestValue(alias)}`,
            `name.eq.${quotePostgrestValue(alias)}`
          ]);
          const uuidConditions = planFilterAliases
            .filter(isUuid)
            .flatMap(alias => [
              `global_plan_id.eq.${quotePostgrestValue(alias)}`,
              `id.eq.${quotePostgrestValue(alias)}`
            ]);
          plansQuery = plansQuery.or([...textConditions, ...uuidConditions].join(","));
        }
        const { data: allPlans, error: plansError } = await plansQuery;
        console.log(`🔍 [AdminDebug] reading_plans 查詢結果: ${allPlans ? allPlans.length : 0} 筆`, plansError ? `錯誤: ${plansError.message}` : '');

        let logsQuery = state.supabase.from("reading_logs").select("user_id, book, chapter, read_at, plan_id, round");
        if (allPlans && allPlans.length > 0) {
          const planIds = allPlans.map(p => p.id);
          logsQuery = logsQuery.in("plan_id", planIds);
        }
        const { data: allLogs, error: logsError } = await logsQuery;
        console.log(`🔍 [AdminDebug] reading_logs 查詢結果: ${allLogs ? allLogs.length : 0} 筆`, logsError ? `錯誤: ${logsError.message}` : '');
        state.allLogsCache = allLogs || [];

        // Fetch today's devotional notes (golden verses)
        const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
        const { data: todayNotes } = await state.supabase.from("devotional_notes").select("user_id, content").eq("note_date", todayStr);
        const notesByUser = {};
        if (todayNotes) {
          todayNotes.forEach(n => {
            notesByUser[n.user_id] = n.content;
          });
        }

        window.userPlanIdCache = {};
        if (allPlans) {
          allPlans.forEach(p => {
            if (p.user_id && p.preset_key) {
              window.userPlanIdCache[p.user_id + '_' + p.preset_key] = p.id;
            }
            if (p.user_id && p.name) {
              window.userPlanIdCache[p.user_id + '_' + p.name] = p.id;
            }
            if (p.user_id && p.global_plan_id) {
              window.userPlanIdCache[p.user_id + '_' + p.global_plan_id] = p.id;
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
              ? userPlans.find(p => [p.preset_key, p.global_plan_id, p.name, p.id].some(value => value && planFilterAliasSet.has(String(value))))
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
              level: uPlan ? (uPlan.level || 'normal') : 'normal',
              today_devotional: notesByUser[profile.id] || null
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

    const localNotesStr = localStorage.getItem("devotional_notes") || "{}";
    const localNotes = JSON.parse(localNotesStr);
    const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const myTodayNote = localNotes[todayStr] || null;

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
            plan_progress: mockUser.plan_progress,
            today_devotional: myTodayNote
          };
        }
        return {
          ...u,
          chapters_read: 0,
          plan_progress: 0,
          last_read: null,
          today_devotional: null
        };
      });
    } else {
      localUsers = localUsers.map(u => {
        let uNote = null;
        if (u.name === mockUser.name) {
          uNote = myTodayNote;
        } else {
          const mockVerses = [
            "起初，神創造天地。 (創 1:1)",
            "神愛世人，甚至將他的獨生子賜給他們... (約 3:16)",
            "耶和華是我的牧者，我必不致缺乏。 (詩 23:1)",
            "你要專心仰賴耶和華，不可倚靠自己的聰明 (箴 3:5)"
          ];
          const isRecentRead = u.last_read && (
            u.last_read === todayStr ||
            u.last_read === "2026-06-26" ||
            u.last_read === "2026-06-25"
          );
          if (isRecentRead) {
            const idx = Math.abs(u.name.charCodeAt(0)) % mockVerses.length;
            uNote = mockVerses[idx];
          }
        }
        return {
          ...u,
          today_devotional: uNote
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
    const defaultDemoPresetKey = Object.keys(CHURCH_PLAN_PRESETS)[0];
      const defaultDemoPreset = CHURCH_PLAN_PRESETS[defaultDemoPresetKey];

    state.activePlan = generatePlanObject(defaultDemoPreset.name, defaultDemoPreset.startDate, defaultDemoPreset.endDate, defaultDemoPreset.books, defaultDemoPresetKey);
    state.activePlan.progress = mockUser.plan_progress;
    state.activePlan.completedChapters = Math.round((state.activePlan.totalChapters * mockUser.plan_progress) / 100);
    state.activePlans = [state.activePlan];
    localStorage.setItem("selected_plan_key", defaultDemoPresetKey);

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
      await (window.renderProfileView || renderProfileView)();
    } else if (appRouter.currentTab === "admin-view") {
      const isSimulatedAdmin = state.currentUser.role === "admin";
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

  async saveDevotionalNote(date, content, noteId = null) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const user = await this.getCurrentDbUser();
      if (!user) return null;

      if (noteId) {
        // 如果有指定正在編輯的 noteId，則更新它（解決同一次輸入的自動存檔與點擊發佈衝突）
        const { error } = await state.supabase
          .from("devotional_notes")
          .update({ content: content })
          .eq("id", noteId);

        if (error) throw error;
        return noteId;
      } else {
        // 沒有指定 noteId，則新增一筆，並回傳新產生的 ID 以供後續自動存檔/發佈更新
        const { data, error } = await state.supabase
          .from("devotional_notes")
          .insert({
            user_id: user.id,
            note_date: date,
            content: content
          })
          .select("id")
          .single();

        if (error) throw error;
        return data ? data.id : null;
      }
    } else {
      const notesStr = localStorage.getItem("devotional_notes") || "[]";
      let notes = [];
      try {
        notes = JSON.parse(notesStr);
        if (!Array.isArray(notes)) notes = [];
      } catch (e) {
        notes = [];
      }

      if (noteId) {
        const existingIdx = notes.findIndex(n => n.id === noteId);
        if (existingIdx !== -1) {
          notes[existingIdx].content = content;
          localStorage.setItem("devotional_notes", JSON.stringify(notes));
          return noteId;
        }
      }

      // 新增一筆
      const newId = "mock_note_" + Date.now();
      notes.unshift({
        id: newId,
        user_id: "me",
        note_date: date,
        content: content,
        created_at: new Date().toISOString()
      });
      localStorage.setItem("devotional_notes", JSON.stringify(notes));
      return newId;
    }
  },

  async deleteDevotionalNote(noteId) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const { error } = await state.supabase
        .from("devotional_notes")
        .delete()
        .eq("id", noteId);

      if (error) throw error;
    } else {
      const notesStr = localStorage.getItem("devotional_notes") || "[]";
      let notes = [];
      try {
        notes = JSON.parse(notesStr);
        if (!Array.isArray(notes)) notes = [];
      } catch (e) {
        notes = [];
      }
      notes = notes.filter(n => n.id !== noteId);
      localStorage.setItem("devotional_notes", JSON.stringify(notes));
    }
  },

  async toggleDevotionalLike(noteId) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const user = await this.getCurrentDbUser();
      if (!user) return false;
      
      const { data: existing } = await state.supabase
        .from("devotional_likes")
        .select("id")
        .eq("note_id", noteId)
        .eq("user_id", user.id)
        .maybeSingle();
        
      if (existing) {
        await state.supabase
          .from("devotional_likes")
          .delete()
          .eq("id", existing.id);
        return false;
      } else {
        await state.supabase
          .from("devotional_likes")
          .insert([{ note_id: noteId, user_id: user.id }]);
        return true;
      }
    } else {
      const likedKey = `like_${noteId}`;
      const isLiked = localStorage.getItem(likedKey) === "true";
      if (isLiked) {
        localStorage.removeItem(likedKey);
        return false;
      } else {
        localStorage.setItem(likedKey, "true");
        return true;
      }
    }
  },

  async addDevotionalComment(noteId, content) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const user = await this.getCurrentDbUser();
      if (!user) return null;
      
      const { data, error } = await state.supabase
        .from("devotional_comments")
        .insert([{ note_id: noteId, user_id: user.id, content }])
        .select()
        .single();
        
      if (error) throw error;
      return data;
    } else {
      const commentsKey = `comments_${noteId}`;
      const list = JSON.parse(localStorage.getItem(commentsKey) || "[]");
      const newComment = {
        id: `comment_${Date.now()}`,
        note_id: noteId,
        user_id: state.currentUser ? state.currentUser.id || "me" : "me",
        content,
        created_at: new Date().toISOString()
      };
      list.push(newComment);
      localStorage.setItem(commentsKey, JSON.stringify(list));
      return newComment;
    }
  },

  _readingTeamPlanId(plan) {
    const value = plan && (plan.globalPlanId || plan.global_plan_id || plan.id);
    return isUuid(value) ? String(value) : null;
  },

  _readingTeamErrorMessage(error) {
    const raw = String(error && (error.message || error.error || error.details) || error || "");
    const messages = {
      profile_required: "目前找不到你的會員資料，請重新登入後再試。",
      profile_identity_not_found: "目前找不到你的會員資料，請重新登入後再試。",
      team_plan_not_found: "這個計畫目前未開放團隊報名。",
      team_statistics_admin_required: "目前無法查看這項團隊資料。",
      invalid_team_division: "團隊只能選擇 3 人組或 6 人組。",
      invalid_team_name: "請輸入 1 至 40 字的團隊名稱。",
      already_in_plan_team: "你已加入這個人數組別的團隊。",
      already_in_plan_division: "你已加入這個人數組別的團隊；仍可參加另一種人數的團隊。",
      team_invite_not_found: "找不到這組邀請碼，請向隊長確認。",
      reading_team_full: "這個團隊已額滿。",
      ready_team_roster_locked: "團隊已額滿，名單目前不能調整。",
      captain_must_disband_team: "隊長需解散尚未成隊的團隊，不能直接退出。",
      team_captain_required: "只有隊長可以解散團隊。",
      reading_team_not_found: "找不到這個團隊。",
      not_a_team_member: "你目前不在這個團隊中。",
      team_reminder_self_not_allowed: "不需要提醒自己，完成閱讀後直接打卡就可以了。",
      team_reminder_same_team_required: "只能提醒同一支團隊裡的夥伴。",
      team_reminder_daily_limit: "今天已提醒過這位夥伴，明天再為彼此加油。",
      invalid_reminder_reason: "請重新選擇提醒方式。",
      invalid_reminder_message: "提醒內容需為 1 至 300 字。",
      forbidden_rpc: "團隊功能暫時無法使用，請稍後再試。"
    };
    const key = Object.keys(messages).find(code => raw.includes(code));
    return key ? messages[key] : (raw || "團隊資料處理失敗，請稍後再試。");
  },

  async _callReadingTeamRpc(functionName, args) {
    if (!state.isSupabaseMode || !state.supabase || state.currentUser && state.currentUser.is_demo) {
      return { success: false, message: "團隊報名需登入正式帳號後使用。" };
    }
    try {
      const { data, error } = await state.supabase.rpc(functionName, args);
      if (error) return { success: false, error, message: this._readingTeamErrorMessage(error) };
      return { success: true, data };
    } catch (error) {
      return { success: false, error, message: this._readingTeamErrorMessage(error) };
    }
  },

  async getMyReadingTeam(plan) {
    const planId = this._readingTeamPlanId(plan);
    if (!planId) return { success: false, message: "這個計畫目前未開放團隊報名。" };
    const result = await this._callReadingTeamRpc("get_my_reading_team", { p_global_plan_id: planId });
    return result.success ? { success: true, context: result.data || { teams: [], team: null, members: [] } } : result;
  },

  async getReadingTeamStatistics(plan) {
    const planId = this._readingTeamPlanId(plan);
    if (!planId) return { success: false, message: "這個計畫目前未開放團隊統計。" };
    const result = await this._callReadingTeamRpc("get_reading_team_statistics", { p_global_plan_id: planId });
    return result.success ? { success: true, context: result.data || { summary: {}, teams: [] } } : result;
  },

  async createReadingTeam(plan, division, name) {
    const planId = this._readingTeamPlanId(plan);
    if (!planId) return { success: false, message: "這個計畫目前未開放團隊報名。" };
    return this._callReadingTeamRpc("create_reading_team", {
      p_global_plan_id: planId,
      p_division: Number(division),
      p_name: String(name || "").trim()
    });
  },

  async joinReadingTeam(plan, inviteCode) {
    const planId = this._readingTeamPlanId(plan);
    if (!planId) return { success: false, message: "這個計畫目前未開放團隊報名。" };
    return this._callReadingTeamRpc("join_reading_team_by_code", {
      p_global_plan_id: planId,
      p_invite_code: String(inviteCode || "").trim().toUpperCase()
    });
  },

  async leaveReadingTeam(teamId) {
    return this._callReadingTeamRpc("leave_reading_team", { p_team_id: teamId });
  },

  async disbandReadingTeam(teamId) {
    return this._callReadingTeamRpc("disband_reading_team", { p_team_id: teamId });
  },

  async sendReadingTeamReminder({ teamId, recipientId, globalPlanId, reason, message }) {
    const result = await this._callReadingTeamRpc("send_reading_team_reminder", {
      p_team_id: teamId,
      p_recipient_id: recipientId,
      p_global_plan_id: globalPlanId,
      p_reason: reason,
      p_message: String(message || "").trim()
    });
    return result.success ? { error: null } : { error: new Error(result.message || "提醒傳送失敗。") };
  },

  async joinPresetPlan(key, scheduleSettings = null) {
    let preset = (state.globalPlans || []).find(p => p.presetKey === key || p.id === key);
    if (!preset) {
      preset = CHURCH_PLAN_PRESETS[key];
    }
    if (!preset) return;

        loader.show("加入挑戰計畫中...");

    const getCleanDisplayName = (name) => String(name || "").trim();

    const planName = getCleanDisplayName(preset.name, key);
    let startDate = preset.startDate;
    let endDate = preset.endDate;
    const selectedBooks = preset.books;

    // 優先用 globalPlan 查詢，並確定是否為固定時間計畫
    const globalPlan = (state.globalPlans || []).find(gp => gp.id === key || gp.presetKey === key);
    const isFixed = globalPlan ? globalPlan.isFixed !== false : true;
    const weeklySchedule = normalizePlanScheduleSettings(
      isFixed,
      scheduleSettings && scheduleSettings.readingDaysPerWeek,
      scheduleSettings && scheduleSettings.restWeekdays
    );

    if (!isFixed) {
      const getLocalDateString = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const origStart = new Date(preset.startDate);
      const origEnd = new Date(preset.endDate);
      const durationDays = Math.max(1, Math.ceil((origEnd - origStart) / (1000 * 60 * 60 * 24)) + 1);

      const today = new Date();
      startDate = getLocalDateString(today);

      const end = new Date(today);
      end.setDate(today.getDate() + durationDays - 1);
      endDate = getLocalDateString(end);
    }

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
            upgrade_prompt_handled: false,
            is_fixed: isFixed,
            reading_days_per_week: weeklySchedule.readingDaysPerWeek,
            rest_weekdays: weeklySchedule.restWeekdays
          };

          // 若是來自月度預設計畫，自動關聯到 global_plans 中的 9 大分類模板 UUID
          if (isGlobalPlanUUID) {
            insertPayload.global_plan_id = key;
          }

          let existingQuery = state.supabase
            .from("reading_plans")
            .select("*")
            .eq("user_id", user.id);
          if (isGlobalPlanUUID) existingQuery = existingQuery.eq("global_plan_id", key);
          else existingQuery = existingQuery.eq("preset_key", key).eq("name", planName);

          const { data: existingPlan, error: existingError } = await existingQuery.maybeSingle();
          if (existingError) throw existingError;

          if (existingPlan) {
            const existingIsFixed = existingPlan.is_fixed !== false;
            newPlanObj = generatePlanObject(planName, existingPlan.start_date, existingPlan.end_date, selectedBooks, key, 'normal', existingIsFixed, {
              readingDaysPerWeek: existingPlan.reading_days_per_week,
              restWeekdays: existingPlan.rest_weekdays
            });
            newPlanObj.id = existingPlan.id;
            newPlanObj.globalPlanId = existingPlan.global_plan_id || null;
            newPlanObj.level = existingPlan.level || newPlanObj.level || "normal";
            newPlanObj.currentRound = existingPlan.current_round || 1;
            newPlanObj.isFixed = existingIsFixed;
            newPlanObj.is_fixed = existingIsFixed;
            if (!state.activePlans) state.activePlans = [];
            if (!state.activePlans.some(p => p.id === newPlanObj.id)) state.activePlans.push(newPlanObj);
            state.activePlan = newPlanObj;
            localStorage.setItem("selected_plan_key", key);
          } else {
            const { data: dbPlan, error } = await state.supabase
              .from("reading_plans")
              .insert(insertPayload)
              .select()
              .single();

            if (error) {
              console.error("Failed to insert plan in Supabase:", error);
              loader.hide();
              showToast("加入讀經計畫失敗：" + (error.message || error.error || error));
              return null;
            }

            if (!dbPlan) throw new Error("No plan returned after insert.");

            const dbIsFixed = dbPlan.is_fixed !== false;
            newPlanObj = generatePlanObject(planName, dbPlan.start_date, dbPlan.end_date, selectedBooks, key, 'normal', dbIsFixed, {
              readingDaysPerWeek: dbPlan.reading_days_per_week,
              restWeekdays: dbPlan.rest_weekdays
            });
            newPlanObj.id = dbPlan.id;
            newPlanObj.globalPlanId = dbPlan.global_plan_id || null;
            newPlanObj.isFixed = dbIsFixed;
            newPlanObj.is_fixed = dbIsFixed;
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
      newPlanObj = generatePlanObject(planName, startDate, endDate, selectedBooks, key, 'normal', isFixed, weeklySchedule);
      newPlanObj.isFixed = isFixed;
      newPlanObj.is_fixed = isFixed;
      if (!state.activePlans) state.activePlans = [];
      state.activePlans.push(newPlanObj);
      state.activePlan = newPlanObj;
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      localStorage.setItem("selected_plan_key", key);
    }

    if (newPlanObj && preset.planKind) {
      Object.assign(newPlanObj, {
        globalPlanId: newPlanObj.globalPlanId || preset.globalPlanId || preset.id || null,
        planKind: preset.planKind,
        stageNo: preset.stageNo || null,
        roundNo: preset.roundNo || null,
        awardName: preset.awardName || null,
        campaignDefinition: preset.campaignDefinition || null
      });
    }

    calculatePlanProgress();
    this.saveLocalUserStats();
    this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效

    loader.hide();
    renderPlanView();
    updateDashboardView();

    if (typeof appRouter !== "undefined" && typeof appRouter.switchTab === "function") {
      appRouter.switchTab("dashboard-view");
    }

    const started = isPlanStarted(newPlanObj);

    if (started) {
      showToast(`成功加入 ${planName}！計畫已開始。`);
    } else {
      showToast(`成功預約加入 ${planName}！計畫將於 ${startDate} 開始。`);
    }
    return newPlanObj;
  },

  async joinPlan(name, startDate, endDate, books, key, scheduleSettings = null) {
    return this.joinPresetPlan(key, scheduleSettings);
  },


  async updateFlexiblePlanSchedule(plan, scheduleSettings) {
    if (!plan) {
      return { success: false, error: new Error("A plan is required.") };
    }
    const isFixed = plan.isFixed !== false && plan.is_fixed !== false;

    const weeklySchedule = normalizePlanScheduleSettings(
      isFixed,
      scheduleSettings && scheduleSettings.readingDaysPerWeek,
      scheduleSettings && scheduleSettings.restWeekdays
    );

    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      const { error } = await state.supabase
        .from("reading_plans")
        .update({
          reading_days_per_week: weeklySchedule.readingDaysPerWeek,
          rest_weekdays: weeklySchedule.restWeekdays
        })
        .eq("id", plan.id);
      if (error) return { success: false, error };
    }

    const rebuilt = generatePlanObject(
      plan.name,
      plan.startDate,
      plan.endDate,
      plan.target_books || plan.targetBooks || [],
      plan.presetKey || plan.globalPlanId,
      plan.level || "normal",
      isFixed,
      weeklySchedule
    );
    const preserved = {
      id: plan.id,
      globalPlanId: plan.globalPlanId || null,
      presetKey: plan.presetKey,
      currentRound: plan.currentRound || 1,
      level: plan.level || "normal",
      wasDowngraded: Boolean(plan.wasDowngraded),
      isFixed,
      is_fixed: isFixed
    };
    Object.assign(plan, rebuilt, preserved);

    if (typeof checkPlanSchedule === "function") {
      await checkPlanSchedule(plan);
    }
    calculateAllPlansProgress();
    this.saveLocalUserStats();
    this._mergedUsersCache = {};
    this._mergedUsersPromise = {};

    if (!state.isSupabaseMode) {
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
    }
    return { success: true, plan };
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
    this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效

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
        this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效
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
        this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效
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
          state.globalPlans = (data || []).map(mapGlobalPlanRecord);
          return;
        }
      } catch (e) {
        console.error("Error loading global plans from Supabase:", e);
      }
    }

    // ── localStorage / Demo 模式：從本機讀取，並補上硬寫的四季預設計畫 ──
    const localCampaignOverride = (() => {
      try {
        const value = JSON.parse(localStorage.getItem("church_campaign_override") || "null");
        return value && Array.isArray(value.stages) && Array.isArray(value.segments) ? value : null;
      } catch (error) {
        return null;
      }
    })();
    const mergeWithPresets = (loadedList) => {
      const presetKeys = Object.keys(CHURCH_PLAN_PRESETS);
      const presetPlans = Object.entries(CHURCH_PLAN_PRESETS).map(([key, originalPreset]) => {
        const overrideStage = localCampaignOverride && originalPreset.planKind === "church_campaign_stage"
          ? window.getChurchCampaignStageDefinition(originalPreset.stageNo, localCampaignOverride)
          : null;
        const p = overrideStage ? { ...originalPreset, ...overrideStage, campaignDefinition: overrideStage, ruleVersion: localCampaignOverride.version } : originalPreset;
        return ({
        id: p.id || key,
        globalPlanId: p.id || key,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        books: p.books,
        presetKey: key,
        isHidden: Boolean(p.isHidden || p.is_hidden),
        isFixed: p.isFixed !== false,
        is_fixed: p.isFixed !== false,
        planKind: p.planKind || "standard",
        parentCampaignId: p.parentCampaignId || null,
        stageNo: p.stageNo || null,
        roundNo: p.roundNo || null,
        phase: p.phase || null,
        awardName: p.awardName || null,
        examDate: p.examDate || null,
        ruleVersion: Number(p.ruleVersion || 1),
        description: p.description || "",
        campaignDefinition: p.campaignDefinition ? window.cloneChurchCampaign(p.campaignDefinition) : null
      });
      });
      // 自訂計畫：排除掉 presetKey 為 q1~q4 的項目避免重複
      const customPlans = loadedList.filter(p => !presetKeys.includes(p.presetKey) && !presetKeys.includes(p.id));
      const masterDefinition = localCampaignOverride || window.CHURCH_CAMPAIGN;
      const masterPlan = {
        id: window.CHURCH_CAMPAIGN_ID, globalPlanId: window.CHURCH_CAMPAIGN_ID,
        presetKey: window.CHURCH_CAMPAIGN_PRESET_KEY, planKind: "church_campaign",
        name: "教會階段規則設定", description: "僅供管理員編輯階段規則，不是可加入的讀經計畫。",
        startDate: masterDefinition.startDate, endDate: masterDefinition.endDate,
        books: Array.from(new Set(masterDefinition.segments.flatMap(segment => segment.readings.map(reading => reading.book)))),
        isHidden: true, isFixed: true, is_fixed: true,
        ruleVersion: Number(masterDefinition.version || 1), campaignDefinition: window.cloneChurchCampaign(masterDefinition)
      };
      return [masterPlan, ...presetPlans, ...customPlans].map(plan => ({
        ...plan,
        isHidden: Boolean(plan.isHidden || plan.is_hidden),
        isFixed: plan.isFixed !== false,
        is_fixed: plan.isFixed !== false
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

  async publishCampaignRules(plan, definition) {
    const validation = window.validateChurchCampaign(definition, BIBLE_BOOKS);
    if (!validation.valid) {
      showToast(validation.errors[0] || "計畫規則不完整。");
      return { success: false, validation };
    }

    const nextDefinition = window.cloneChurchCampaign(definition);
    nextDefinition.id = plan.id || window.CHURCH_CAMPAIGN_ID;
    nextDefinition.presetKey = window.CHURCH_CAMPAIGN_PRESET_KEY;
    nextDefinition.planKind = "church_campaign";
    const campaignId = plan.id || window.CHURCH_CAMPAIGN_ID;
    let persistenceVerified = false;
    let persistenceVerificationError = null;
    let storage = "local";

    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      storage = "supabase";
      const { data, error } = await state.supabase.rpc("publish_global_plan_rules", {
        p_plan_id: campaignId,
        p_expected_version: Number(plan.ruleVersion || 1),
        p_definition: nextDefinition
      });
      if (error) {
        console.error("Failed to publish campaign rules:", error);
        showToast(error.message && error.message.includes("version_conflict")
          ? "計畫已被其他管理員更新，請重新載入後再修改。"
          : "發布失敗：" + (error.message || error));
        return { success: false, validation, error };
      }
      nextDefinition.version = Number(data || plan.ruleVersion + 1);

      const parseStoredRules = value => {
        if (!value || typeof value !== "string") return value || {};
        try { return JSON.parse(value); } catch (_) { return {}; }
      };
      const expectedStageNumbers = nextDefinition.stages.map(stage => Number(stage.stageNo)).sort((a, b) => a - b);
      const masterResult = await state.supabase
        .from("global_plans")
        .select("id, rules, rule_version")
        .eq("id", campaignId)
        .single();
      const stageResult = await state.supabase
        .from("global_plans")
        .select("id, rules, rule_version, plan_kind")
        .eq("plan_kind", "church_campaign_stage");

      const storedRules = parseStoredRules(masterResult.data && masterResult.data.rules);
      const storedStageNumbers = Array.isArray(storedRules.stages)
        ? storedRules.stages.map(stage => Number(stage.stageNo)).sort((a, b) => a - b)
        : [];
      const materializedStageNumbers = (stageResult.data || []).map(item => ({
        item,
        rules: parseStoredRules(item.rules)
      })).filter(entry => String(entry.rules.parentCampaignId || "") === String(campaignId))
        .map(entry => Number(entry.rules.stageNo))
        .sort((a, b) => a - b);
      const sameStageNumbers = list => list.length === expectedStageNumbers.length
        && list.every((stageNo, index) => stageNo === expectedStageNumbers[index]);

      persistenceVerified = !masterResult.error
        && !stageResult.error
        && Number(masterResult.data && masterResult.data.rule_version) === nextDefinition.version
        && sameStageNumbers(storedStageNumbers)
        && sameStageNumbers(materializedStageNumbers);
      if (!persistenceVerified) {
        persistenceVerificationError = masterResult.error || stageResult.error || new Error("campaign_persistence_verification_failed");
        console.error("Campaign rules were published but Supabase verification did not match:", {
          persistenceVerificationError,
          expectedStageNumbers,
          storedStageNumbers,
          materializedStageNumbers
        });
      }
    } else {
      nextDefinition.version = Number(plan.ruleVersion || 1) + 1;
      localStorage.setItem("church_campaign_override", JSON.stringify(nextDefinition));
      window.CHURCH_CAMPAIGN = window.cloneChurchCampaign(nextDefinition);
      window.createChurchCampaignStageDefinitions(nextDefinition).forEach(stage => {
        const preset = CHURCH_PLAN_PRESETS[stage.presetKey];
        if (preset) Object.assign(preset, stage, { campaignDefinition: window.cloneChurchCampaign(stage) });
      });
      persistenceVerified = true;
    }

    this._userDataPromise = null;
    await this.loadGlobalPlans();
    return { success: true, validation, version: nextDefinition.version, storage, persistenceVerified, persistenceVerificationError };
  },

  async saveGlobalPlan(plan) {
    if (state.isSupabaseMode && state.supabase && !(state.currentUser && state.currentUser.is_demo)) {
      try {
        const payload = {
          name: plan.name,
          start_date: plan.startDate,
          end_date: plan.endDate,
          target_books: plan.books,
          is_fixed: plan.isFixed !== false
        };

        let error;
        if (plan.id && plan.id.length > 5 && plan.id.includes('-')) {
          const res = await state.supabase
            .from("global_plans")
            .update(payload)
            .eq("id", plan.id);
          error = res.error;

          if (!error) {
            // 💡 同步更新所有使用者對應的全域計畫 copy
            const updatePayload = {
              name: payload.name,
              target_books: payload.target_books,
              is_fixed: payload.is_fixed
            };
            if (payload.is_fixed) {
              updatePayload.start_date = payload.start_date;
              updatePayload.end_date = payload.end_date;
            }
            const syncRes = await state.supabase
              .from("reading_plans")
              .update(updatePayload)
              .eq("global_plan_id", plan.id);
            if (syncRes.error) {
              console.error("Failed to sync updates to user reading_plans:", syncRes.error);
            }
          }
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

    this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效
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

    this._userDataPromise = null; // 💡 關鍵修復：清除資料加載快取以使快取失效
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
          title: '歡迎使用速讀挑戰系統！', 
          content: '親愛的弟兄姊妹平安，歡迎加入教會季度速讀挑戰。讓我們一起藉著每日讀經，更加認識神、親近神！如有任何問題，請洽詢教會同工。',
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
  },

  async fetchCareReminders() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' ||
                        hostname === '::1' || hostname.startsWith('192.168.') ||
                        hostname.startsWith('10.') || hostname.startsWith('172.') ||
                        hostname.endsWith('.local');

    // 🔒 安全防護：虛擬關心提醒資料僅限 localhost 測試環境
    if (state.currentUser && state.currentUser.is_demo) {
      if (!isLocalhost) {
        // Production demo mode: never expose mock care data
        return { data: [], error: null };
      }
      // localhost + demo: use getMockCareReminders() from mock_stats.js
      if (typeof window.getMockCareReminders === 'function') {
        return { data: window.getMockCareReminders(), error: null };
      }
      return { data: [], error: null };
    }

    // Real Supabase mode
    if (state.isSupabaseMode && state.supabase) {
      try {
        const profileId = state.currentProfileId;
        if (!profileId) return { data: [], error: null };
        const { data, error } = await state.supabase
          .from("care_reminders")
          .select(`
            id,
            reason,
            message,
            status,
            sent_on,
            plan_key,
            sender:profiles!sender_id (name, role)
          `)
          .eq("recipient_id", profileId)
          .eq("status", "unread")
          .order("created_at", { ascending: false });
        return { data: data || [], error };
      } catch (e) {
        return { data: [], error: e };
      }
    }
    return { data: [], error: null };
  },

  async acknowledgeCareReminder(reminderId) {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' ||
                        hostname === '::1' || hostname.startsWith('192.168.') ||
                        hostname.startsWith('10.') || hostname.startsWith('172.') ||
                        hostname.endsWith('.local');

    if (state.currentUser && state.currentUser.is_demo) {
      if (isLocalhost && typeof window.dismissMockCareReminder === 'function') {
        window.dismissMockCareReminder(reminderId);
      }
      return { error: null };
    } else if (state.isSupabaseMode && state.supabase) {
      try {
        const { error } = await state.supabase
          .from("care_reminders")
          .update({ status: "read", read_at: new Date().toISOString() })
          .eq("id", reminderId);
        return { error };
      } catch (e) {
        return { error: e };
      }
    }
    return { error: null };
  },

  // 💌 sendCareReminder – 領袖對組員傳送關心提醒
  // recipientId: 收件人 profile ID (UUID)
  // reason: 'behind' | 'inactive' | 'care' | 'encouragement'
  // message: 關心訊息文字 (最多 300 字)
  // planKey: 計畫識別碼 (presetKey 或 globalPlanId)
  async sendCareReminder({ recipientId, reason, message, planKey = "" }) {
    // 輸入驗證
    const validReasons = ["behind", "inactive", "care", "encouragement"];
    if (!recipientId || typeof recipientId !== "string" || !recipientId.trim()) {
      return { error: new Error("收件人 ID 不可為空") };
    }
    if (!validReasons.includes(reason)) {
      return { error: new Error(`無效的關心原因：${reason}`) };
    }
    const trimmedMsg = String(message || "").trim();
    if (!trimmedMsg) {
      return { error: new Error("關心訊息不可為空") };
    }
    if (trimmedMsg.length > 300) {
      return { error: new Error("訊息不能超過 300 字") };
    }

    // Demo 模式：僅模擬，不真正寫入
    if (state.currentUser && state.currentUser.is_demo) {
      console.info("[Demo] sendCareReminder (simulated):", { recipientId, reason, message: trimmedMsg });
      return { error: null };
    }

    // 生產模式：透過 nlc-data 的 send_care_reminder action 安全送出（server 端強制 sender_id）
    if (state.isSupabaseMode && state.supabase) {
      try {
        if (typeof auth === "undefined" || !auth.isLoggedIn()) {
          return { error: new Error("請先登入後再傳送關心提醒") };
        }
        const cfg = state.supabaseConfig || {};
        const accessToken = await auth.getValidAccessToken();
        const response = await fetch(
          cfg.url.replace(/\/+$/, "") + "/functions/v1/nlc-data",
          {
            method: "POST",
            headers: {
              apikey: cfg.anonKey,
              Authorization: "Bearer " + accessToken,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              action: "send_care_reminder",
              payload: {
                recipient_id: recipientId,
                reason: reason,
                message: trimmedMsg,
                plan_key: String(planKey || "")
              }
            })
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload.code === "23505" || response.status === 409) {
            return { error: new Error("今日已傳送過關心提醒給此成員，明日再試") };
          }
          if (response.status === 403 || payload.code === "42501" || (payload.error && payload.error.includes("policy"))) {
            return { error: new Error("此成員不在您的牧養範圍內") };
          }
          return { error: new Error(payload.error || "傳送失敗") };
        }
        return { error: null };
      } catch (e) {
        return { error: e };
      }
    }
    return { error: new Error("目前為離線模式，無法傳送關心提醒") };
  }
};

window.db = db;
