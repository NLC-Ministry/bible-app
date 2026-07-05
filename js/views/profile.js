function isLocalhostGoogleLoginAllowed() {
  return window.location.hostname === "localhost" ||
         window.location.hostname === "127.0.0.1" ||
         window.location.hostname === "::1";
}

function updateGoogleLoginVisibility() {
  const allowGoogle = isLocalhostGoogleLoginAllowed();
  ["btn-google-login", "btn-gate-google-login"].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.display = allowGoogle ? "inline-flex" : "none";
    btn.disabled = !allowGoogle;
  });
}
// Profile & settings tab view controller

function renderProfileView() {
  if (typeof renderBadgeWall === "function") {
    renderBadgeWall("badges-grid");
  }
  const lockedFields = new Set(state.profileLockedFields || []);
  const profileNameInput = document.getElementById("profile-name");
  if (profileNameInput) {
    profileNameInput.value = state.currentUser.name || "";
    profileNameInput.readOnly = lockedFields.has("name");
    profileNameInput.classList.toggle("readonly-field", lockedFields.has("name"));
    profileNameInput.title = lockedFields.has("name") ? "此欄位由教會系統提供，不可編輯" : "";
  }
  
  const greatRegionSelect = document.getElementById("profile-great-region");
  const customGreatRegionInput = document.getElementById("profile-great-region-custom");
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const roleDisplay = document.getElementById("profile-role-display");

  // Keep custom inputs hidden as we are separating database structure management
  if (customGreatRegionInput) customGreatRegionInput.classList.add("hidden");
  if (customZoneInput) customZoneInput.classList.add("hidden");
  if (customGroupInput) customGroupInput.classList.add("hidden");

  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    senior_pastor: "主任牧師 (最高權限)",
    admin: "系統管理員"
  };

  if (roleDisplay) {
    roleDisplay.textContent = roleNames[state.currentUser.role] || "一般組員";
  }

  // Render User Summary Header elements
  const summaryName = document.getElementById("profile-summary-name");
  if (summaryName) summaryName.textContent = state.currentUser.name || "新使用者";

  const summaryOrg = document.getElementById("profile-summary-org");
  if (summaryOrg) {
    const region = state.currentUser.great_region || "";
    const zone = state.currentUser.pastoral_zone || "";
    const group = state.currentUser.small_group || "";
    summaryOrg.textContent = [region, zone, group].filter(Boolean).join(" / ") || "未設定所屬小組";
  }

  const summaryRole = document.getElementById("profile-summary-role");
  if (summaryRole) {
    summaryRole.textContent = roleNames[state.currentUser.role] || "一般組員";
  }

  const summaryInitial = document.getElementById("profile-summary-initial");
  if (summaryInitial) {
    summaryInitial.textContent = (state.currentUser.name || "新").substring(0, 1);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let greatRegionsList = (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0) 
    ? state.orgStructure.regions 
    : ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
  
  if (!showDemoData) {
    greatRegionsList = greatRegionsList.filter(r => !r.startsWith("示範"));
  }
  
  greatRegionSelect.innerHTML = `<option value="">-- 請選擇大區 --</option>`;
  greatRegionsList.forEach(rName => {
    const option = document.createElement("option");
    option.value = rName;
    option.textContent = rName;
    greatRegionSelect.appendChild(option);
  });
  
  const userGreatRegion = state.currentUser.great_region;

  // Append user's value if it's not in the database, without "(唯讀)"
  if (userGreatRegion && userGreatRegion !== "custom" && !greatRegionsList.includes(userGreatRegion)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userGreatRegion;
    tempOpt.textContent = userGreatRegion;
    greatRegionSelect.appendChild(tempOpt);
  }

  // Append custom option at the bottom
  const customRegionOpt = document.createElement("option");
  customRegionOpt.value = "custom";
  customRegionOpt.textContent = "自訂大區...";
  greatRegionSelect.appendChild(customRegionOpt);

  greatRegionSelect.value = userGreatRegion || "";

  populateProfileZones(greatRegionSelect.value, true);
  populateProfileGroupSelector(true);

  const applyProfileFieldLocks = () => {
    const lockTitle = "\u6b64\u6b04\u4f4d\u7531\u6559\u6703\u7cfb\u7d71\u63d0\u4f9b\uff0c\u4e0d\u53ef\u7de8\u8f2f";
    const controls = [
      [greatRegionSelect, customGreatRegionInput, "great_region"],
      [zoneSelect, customZoneInput, "pastoral_zone"],
      [groupSelect, customGroupInput, "small_group"]
    ];
    controls.forEach(([selectEl, customEl, field]) => {
      const locked = lockedFields.has(field);
      if (selectEl) {
        selectEl.disabled = locked;
        selectEl.title = locked ? lockTitle : "";
        selectEl.classList.toggle("readonly-field", locked);
      }
      if (customEl) {
        customEl.readOnly = locked;
        customEl.disabled = locked;
        customEl.title = locked ? lockTitle : "";
        customEl.classList.toggle("readonly-field", locked);
      }
    });
  };
  applyProfileFieldLocks();

  greatRegionSelect.onchange = () => {
    if (greatRegionSelect.value === "custom") {
      customGreatRegionInput.classList.remove("hidden");
    } else {
      customGreatRegionInput.classList.add("hidden");
      customGreatRegionInput.value = "";
    }
    populateProfileZones(greatRegionSelect.value, false);
    populateProfileGroupSelector(false);
  };

  zoneSelect.onchange = () => {
    if (zoneSelect.value === "custom") {
      customZoneInput.classList.remove("hidden");
    } else {
      customZoneInput.classList.add("hidden");
      customZoneInput.value = "";
    }
    populateProfileGroupSelector(false);
  };

  groupSelect.onchange = () => {
    if (groupSelect.value === "custom") {
      customGroupInput.classList.remove("hidden");
    } else {
      customGroupInput.classList.add("hidden");
      customGroupInput.value = "";
    }
  };

  // Submit profile details
  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = lockedFields.has("name") ? (state.currentUser.name || "") : document.getElementById("profile-name").value.trim();
    const greatRegion = lockedFields.has("great_region") ? (state.currentUser.great_region || "") : (greatRegionSelect.value === "custom" ? customGreatRegionInput.value.trim() : greatRegionSelect.value);
    const zone = lockedFields.has("pastoral_zone") ? (state.currentUser.pastoral_zone || "") : (zoneSelect.value === "custom" ? customZoneInput.value.trim() : zoneSelect.value);
    const group = lockedFields.has("small_group") ? (state.currentUser.small_group || "") : (groupSelect.value === "custom" ? customGroupInput.value.trim() : groupSelect.value);

    if (!greatRegion || !zone || !group) {
      alert("請完整填寫大區、牧區與小組資料！");
      return;
    }

    loader.show("儲存個人資料中...");
    
    const oldProfile = { ...state.currentUser };
    
    state.currentUser.name = name;
    state.currentUser.great_region = greatRegion;
    state.currentUser.pastoral_zone = zone;
    state.currentUser.small_group = group;

    try {
      let saveInfo = null;
      const isSupabase = !!(state.isSupabaseMode && state.supabase);
      if (isSupabase) {
        saveInfo = await db.syncProfileStatsToSupabase();
      }
      db.saveLocalUserStats();

      if (isSupabase) {
        if (saveInfo && saveInfo.aborted && saveInfo.reason === "demo") {
          showToast("個人資料已儲存 (Demo 模擬模式)");
        } else {
          showToast("個人基本資料已儲存成功！");
        }
      } else {
        showToast("個人資料已儲存至本機 (離線模式)");
      }
      updateDashboardView();
    } catch (err) {
      console.error("Failed to save profile:", err);
      state.currentUser = oldProfile;
      const isAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor");
      if (isAdmin) {
        showToast(`儲存個人資料失敗 (開發者除錯): ${err.message || err}`);
      } else {
        showToast("儲存個人資料失敗，請稍後再試。");
      }
    } finally {
      loader.hide();
    }
  };

  // Demo Switcher Listener
  const demoRoleCard = document.querySelector(".demo-role-card");
  if (demoRoleCard) {
    if (!state.isSupabaseMode || isLocalhost) {
      demoRoleCard.classList.remove("hidden");
    } else {
      demoRoleCard.classList.add("hidden");
    }
  }

  const demoRoleSelect = document.getElementById("demo-role-select");
  if (demoRoleSelect) {
    if (state.isSupabaseMode) {
      demoRoleSelect.value = "real_user";
    } else {
      demoRoleSelect.value = state.currentUser.role || "member";
    }
    demoRoleSelect.onchange = async (e) => {
      await db.switchDemoRole(e.target.value);
    };
  }

  // Admin User Management Section Visibility and Rendering
  if (typeof updateAdminNavVisibility === 'function') {
    updateAdminNavVisibility();
  }

}

// Initialize profile & auth page controls on page load
function initProfileControls() {
  updateGoogleLoginVisibility();
  const allowGoogleLogin = isLocalhostGoogleLoginAllowed();
  // Google OAuth Login
  const btnGoogle = document.getElementById("btn-google-login");
  if (btnGoogle && allowGoogleLogin) {
    btnGoogle.onclick = async (e) => {
      e.preventDefault();
      loader.show("開啟 Google 登入中...");
      try {
        if (!state.supabase) {
          throw new Error("Supabase 未初始化。請確認已設定連線資訊或檢查網路狀態！");
        }
        const { error } = await state.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            queryParams: {
              prompt: 'select_account'
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

  const btnGoogleGate = document.getElementById("btn-gate-google-login");
  if (btnGoogleGate && allowGoogleLogin) {
    btnGoogleGate.onclick = async (e) => {
      e.preventDefault();
      loader.show("開啟 Google 登入中...");
      try {
        if (!state.supabase) {
          throw new Error("Supabase 未初始化。請確認已設定連線資訊或檢查網路狀態！");
        }
        const { error } = await state.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            queryParams: {
              prompt: 'select_account'
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

  // Email Auth Button triggers
  const btnSignin = document.getElementById("btn-signin");
  if (btnSignin) {
    btnSignin.onclick = async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;

      if (!email || !password) return;
      
      loader.show("登入中...");
      try {
        const { error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        await db.loadUserData();
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
        const { error } = await state.supabase.auth.signUp({ email, password });
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
      loader.show("\u767b\u51fa\u4e2d...");
      try {
        if (typeof auth !== "undefined" && auth.logout) {
          await auth.logout();
          return;
        }
        if (state.isSupabaseMode && state.supabase?.auth?.signOut) {
          await state.supabase.auth.signOut();
        }
        state.realRole = null;
        db.updateAuthUI(null);
        await db.loadUserData();
        alert("\u5df2\u767b\u51fa\u3002");
        renderProfileView();
      } catch (err) {
        alert(`\u767b\u51fa\u5931\u6557: ${err.message}`);
      } finally {
        loader.hide();
      }
    };
  }

  const searchInput = document.getElementById("admin-search-user");
  if (searchInput) {
    let debounceTimer;
    searchInput.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderAdminUserManagement();
      }, 300);
    };
  }

  if (typeof initAdminOrgManagement === 'function') {
    initAdminOrgManagement();
  }

  // Toggle collapsible profile form
  const btnToggleForm = document.getElementById("btn-toggle-profile-form");
  const formWrapper = document.getElementById("profile-form-wrapper");
  if (btnToggleForm && formWrapper) {
    btnToggleForm.onclick = (e) => {
      e.preventDefault();
      const isHidden = formWrapper.classList.contains("hidden");
      if (isHidden) {
        formWrapper.classList.remove("hidden");
        btnToggleForm.innerHTML = iconLabel("chevronUp", "收起個人檔案編輯");
      } else {
        formWrapper.classList.add("hidden");
        btnToggleForm.innerHTML = iconLabel("edit", "編輯個人檔案");
      }
    };
  }

  // Initialize advanced search filters UI
  initAdminFiltersUI();

  // Initialize header avatar dropdown
  initAvatarDropdown();
}

// Initialize advanced search filters state and bottom sheet UI
function updateFilterChipsUI() {
  const chipRegion = document.getElementById("chip-filter-region");
  const chipZone = document.getElementById("chip-filter-zone");
  const chipGroup = document.getElementById("chip-filter-group");

  if (chipRegion) {
    if (state.adminFilters.region) {
      chipRegion.classList.add("active");
      chipRegion.innerHTML = `<span>${state.adminFilters.region}</span> <span class="chip-clear" data-clear="region">✕</span>`;
    } else {
      chipRegion.classList.remove("active");
      chipRegion.innerHTML = `<span>全部大區</span> <span class="chip-arrow">▾</span>`;
    }
  }

  if (chipZone) {
    if (state.adminFilters.zone) {
      chipZone.classList.add("active");
      chipZone.innerHTML = `<span>${state.adminFilters.zone}</span> <span class="chip-clear" data-clear="zone">✕</span>`;
    } else {
      chipZone.classList.remove("active");
      chipZone.innerHTML = `<span>全部牧區</span> <span class="chip-arrow">▾</span>`;
    }
  }

  if (chipGroup) {
    if (state.adminFilters.group) {
      chipGroup.classList.add("active");
      chipGroup.innerHTML = `<span>${state.adminFilters.group}</span> <span class="chip-clear" data-clear="group">✕</span>`;
    } else {
      chipGroup.classList.remove("active");
      chipGroup.innerHTML = `<span>全部小組</span> <span class="chip-arrow">▾</span>`;
    }
  }
}

function openAdminFilterBottomSheet(type) {
  const overlay = document.getElementById("global-bottom-sheet");
  const titleEl = document.getElementById("bottom-sheet-title");
  const listEl = document.getElementById("bottom-sheet-list");
  if (!overlay || !listEl) return;

  let title = "選擇篩選條件";
  let options = [];
  let selectedValue = state.adminFilters[type];

  // Helper to compile list items safely
  const getPredefinedRegions = () => {
    return (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0)
      ? state.orgStructure.regions
      : ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
  };

  const getPredefinedZones = () => {
    if (state.adminFilters.region) {
      return state.orgStructure.zones[state.adminFilters.region] || [];
    }
    // Combine all zones if no region selected
    const all = [];
    if (state.orgStructure && state.orgStructure.zones) {
      Object.values(state.orgStructure.zones).forEach(arr => {
        if (Array.isArray(arr)) all.push(...arr);
      });
    }
    return Array.from(new Set(all));
  };

  const getPredefinedGroups = () => {
    if (state.adminFilters.zone) {
      return state.orgStructure.groups[state.adminFilters.zone] || [];
    }
    // Combine all groups if no zone selected
    const all = [];
    if (state.orgStructure && state.orgStructure.groups) {
      Object.values(state.orgStructure.groups).forEach(arr => {
        if (Array.isArray(arr)) all.push(...arr);
      });
    }
    return Array.from(new Set(all));
  };

  if (type === "region") {
    title = "選擇大區";
    options = getPredefinedRegions();
  } else if (type === "zone") {
    title = "選擇牧區";
    options = getPredefinedZones();
  } else if (type === "group") {
    title = "選擇小組";
    options = getPredefinedGroups();
  }

  if (titleEl) titleEl.textContent = title;
  listEl.innerHTML = "";

  // Add "全部" (All) option
  const allBtn = document.createElement("button");
  allBtn.className = `bottom-sheet-item ${!selectedValue ? "selected" : ""}`;
  allBtn.type = "button";
  allBtn.textContent = `全部${type === "region" ? "大區" : (type === "zone" ? "牧區" : "小組")}`;
  allBtn.onclick = () => {
    console.log(`🔍 [Debug] Bottom Sheet 選擇清除篩選: 全部${type}`);
    state.adminFilters[type] = null;
    if (type === "region") {
      state.adminFilters.zone = null;
      state.adminFilters.group = null;
    } else if (type === "zone") {
      state.adminFilters.group = null;
    }
    updateFilterChipsUI();
    closeAdminFilterBottomSheet();
    renderAdminUserManagement();
  };
  listEl.appendChild(allBtn);

  // Add other options
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = `bottom-sheet-item ${selectedValue === opt ? "selected" : ""}`;
    btn.type = "button";
    btn.textContent = opt;
    btn.onclick = () => {
      console.log(`🔍 [Debug] Bottom Sheet 選擇篩選條件: ${type} = ${opt}`);
      state.adminFilters[type] = opt;
      if (type === "region") {
        state.adminFilters.zone = null;
        state.adminFilters.group = null;
      } else if (type === "zone") {
        state.adminFilters.group = null;
      }
      updateFilterChipsUI();
      closeAdminFilterBottomSheet();
      renderAdminUserManagement();
    };
    listEl.appendChild(btn);
  });

  // Open overlay
  overlay.classList.add("active");
}

function closeAdminFilterBottomSheet() {
  console.log("🔒 [Debug] 關閉管理篩選 Bottom Sheet");
  const overlay = document.getElementById("global-bottom-sheet");
  if (overlay) overlay.classList.remove("active");
}

function initAdminFiltersUI() {
  // Bind chips click events
  ["region", "zone", "group"].forEach(type => {
    const chip = document.getElementById(`chip-filter-${type}`);
    if (chip) {
      chip.onclick = (e) => {
        e.preventDefault();
        const clearBtn = e.target.closest(".chip-clear");
        if (clearBtn) {
          console.log(`❌ [Debug] 清除篩選標籤按鈕點擊: ${type}`);
          e.stopPropagation();
          state.adminFilters[type] = null;
          if (type === "region") {
            state.adminFilters.zone = null;
            state.adminFilters.group = null;
          } else if (type === "zone") {
            state.adminFilters.group = null;
          }
          updateFilterChipsUI();
          renderAdminUserManagement();
        } else {
          console.log(`🔍 [Debug] 篩選標籤膠囊點擊，開啟 Bottom Sheet: ${type}`);
          openAdminFilterBottomSheet(type);
        }
      };
    }
  });

  // Bind close buttons
  const closeBtn = document.getElementById("btn-close-bottom-sheet");
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      console.log("🔒 [Debug] 關閉 Bottom Sheet 按鈕點擊");
      e.preventDefault();
      closeAdminFilterBottomSheet();
    };
  }

  const overlay = document.getElementById("global-bottom-sheet");
  if (overlay) {
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        console.log("🔒 [Debug] 點擊 Bottom Sheet 外部遮罩關閉");
        closeAdminFilterBottomSheet();
      }
    };
  }

  updateFilterChipsUI();
}

// Render administrative User Permission Management table
// Render administrative User Permission Management list (Mobile Flexbox layout)
async function renderAdminUserManagement() {
  const listContainer = document.getElementById("admin-users-list");
  if (!listContainer) return;

  const searchInput = document.getElementById("admin-search-user");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  ComponentSkeletonLoader.show('members', listContainer);

  try {
    const users = await db.fetchMergedUsersList(null, true);
    
    // Sort users: current user first, then leaders, then members
    const roleOrder = { senior_pastor: 1, admin: 2, great_zone_leader: 3, zone_leader: 4, group_leader: 5, member: 6 };
    const sortedUsers = [...users].sort((a, b) => {
      if (a.name === state.currentUser.name) return -1;
      if (b.name === state.currentUser.name) return 1;
      return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
    });

    const filteredUsers = sortedUsers.filter(u => {
      // Exclude demo users in Supabase mode
      if (state.isSupabaseMode && u.is_demo) return false;

      // Check name query match
      const matchName = u.name.toLowerCase().includes(query);

      // Check Great Region match
      const matchRegion = !state.adminFilters.region || u.great_region === state.adminFilters.region;

      // Check Pastoral Zone match
      const matchZone = !state.adminFilters.zone || u.pastoral_zone === state.adminFilters.zone;

      // Check Small Group match
      const matchGroup = !state.adminFilters.group || u.small_group === state.adminFilters.group;

      return matchName && matchRegion && matchZone && matchGroup;
    });

    listContainer.innerHTML = "";

    if (filteredUsers.length === 0) {
      listContainer.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">無相符成員</div>`;
      return;
    }

    const roleLabels = {
      member: "一般組員",
      group_leader: "小組長",
      zone_leader: "區長",
      great_zone_leader: "大區長",
      senior_pastor: "主任牧師",
      admin: "系統管理員"
    };

    filteredUsers.forEach(user => {
      const isDemo = !!user.is_demo;
      const roleLabel = roleLabels[user.role] || user.role;
      
      const item = document.createElement("div");
      item.className = "member-list-item";
      
      const demoBadge = isDemo
        ? `<span class="stat-badge stat-badge--warning" style="display:inline-block;margin-left:0.4rem;font-size:0.65rem;">示範</span>`
        : "";

      item.innerHTML = `
        <div class="member-info-left">
          <div class="member-name-row">
            <span class="member-name-text">${escapeHTML(user.name)}</span>
            <span class="role-badge-pill">${escapeHTML(roleLabel)}</span>
            ${demoBadge}
          </div>
          <div class="member-sub-text">
            ${escapeHTML(user.great_region)} / ${escapeHTML(user.pastoral_zone)} / ${escapeHTML(user.small_group)}
          </div>
        </div>
        <div class="member-arrow-right">
          ${typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : ""}
        </div>
      `;

      item.onclick = (e) => {
        e.preventDefault();
        if (isDemo) {
          alert("示範帳號不可更改角色。");
          return;
        }
        openMemberEditBottomSheet(user);
      };

      listContainer.appendChild(item);
    });

  } catch (err) {
    console.error("Failed to render admin user management:", err);
    listContainer.innerHTML = `<div class="text-danger" style="text-align: center; padding: 2.5rem;">載入失敗: ${err.message || err}</div>`;
  }
}

// Open bottom sheet to edit member role or responsibility scope
function openMemberEditBottomSheet(user) {
  const overlay = document.getElementById("global-bottom-sheet");
  const titleEl = document.getElementById("bottom-sheet-title");
  const listEl = document.getElementById("bottom-sheet-list");
  if (!overlay || !listEl) return;

  if (titleEl) titleEl.textContent = `管理 ${user.name} 的權限`;
  listEl.innerHTML = "";

  const roleOptions = [
    { value: "member", label: "一般組員" },
    { value: "group_leader", label: "小組長" },
    { value: "zone_leader", label: "區長" },
    { value: "great_zone_leader", label: "大區長" },
    { value: "senior_pastor", label: "主任牧師" },
    { value: "admin", label: "系統管理員" }
  ];

  // If currently a leader, show option to edit responsibility scope first
  const isLeader = ["great_zone_leader", "zone_leader", "group_leader"].includes(user.role);
  if (isLeader) {
    const scopeBtn = document.createElement("button");
    scopeBtn.className = "bottom-sheet-item";
    scopeBtn.style.background = "var(--color-brand-subtle, rgba(4,169,210,0.12))";
    scopeBtn.style.borderColor = "var(--color-brand-border, rgba(4,169,210,0.24))";
    scopeBtn.style.color = "#a5b4fc";
    scopeBtn.style.marginBottom = "0.8rem";
    scopeBtn.type = "button";
    scopeBtn.innerHTML = iconLabel("edit", `修改管轄範圍 (${user.great_region}/${user.pastoral_zone}/${user.small_group})`);
    scopeBtn.onclick = async () => {
      console.log(`✏️ [Debug] 修改管轄範圍按鈕被點擊，成員：${user.name}`);
      closeAdminFilterBottomSheet();
      const resp = await showResponsibilityModal(user.role, user);
      if (!resp) return;

      loader.show();
      const success = await db.updateUserRole(user.id, user.role, user.name, resp);
      loader.hide();

      if (success) {
        if (resp.great_region !== undefined) user.great_region = resp.great_region;
        if (resp.pastoral_zone !== undefined) user.pastoral_zone = resp.pastoral_zone;
        if (resp.small_group !== undefined) user.small_group = resp.small_group;

        if (user.name === state.currentUser.name) {
          if (resp.great_region !== undefined) state.currentUser.great_region = resp.great_region;
          if (resp.pastoral_zone !== undefined) state.currentUser.pastoral_zone = resp.pastoral_zone;
          if (resp.small_group !== undefined) state.currentUser.small_group = resp.small_group;
          renderProfileView();
        }
        alert("已成功更新管轄範圍！");
        renderAdminUserManagement();
      } else {
        alert("更新管轄範圍失敗，請重試。");
      }
    };
    listEl.appendChild(scopeBtn);
  }

  // Add sub-header text for roles selection
  const headerText = document.createElement("div");
  headerText.style.fontSize = "0.75rem";
  headerText.style.color = "var(--text-secondary)";
  headerText.style.margin = "0.2rem 0 0.5rem 0.2rem";
  headerText.style.fontWeight = "bold";
  headerText.textContent = "變更角色身分：";
  listEl.appendChild(headerText);

  // Render all role options
  roleOptions.forEach(opt => {
    const btn = document.createElement("button");
    const isSelected = user.role === opt.value;
    btn.className = `bottom-sheet-item ${isSelected ? "selected" : ""}`;
    btn.type = "button";
    btn.textContent = opt.label;
    btn.onclick = async () => {
      console.log(`✏️ [Debug] 變更角色身分點擊: ${user.name} -> ${opt.label}`);
      closeAdminFilterBottomSheet();
      if (isSelected) return; // No change

      let additionalFields = {};
      if (["great_zone_leader", "zone_leader", "group_leader"].includes(opt.value)) {
        const resp = await showResponsibilityModal(opt.value, user);
        if (!resp) return;
        additionalFields = resp;
      }

      loader.show();
      const success = await db.updateUserRole(user.id, opt.value, user.name, additionalFields);
      loader.hide();

      if (success) {
        user.role = opt.value;
        if (additionalFields.great_region !== undefined) user.great_region = additionalFields.great_region;
        if (additionalFields.pastoral_zone !== undefined) user.pastoral_zone = additionalFields.pastoral_zone;
        if (additionalFields.small_group !== undefined) user.small_group = additionalFields.small_group;

        if (user.name === state.currentUser.name) {
          state.currentUser.role = opt.value;
          state.realRole = opt.value;
          if (additionalFields.great_region !== undefined) state.currentUser.great_region = additionalFields.great_region;
          if (additionalFields.pastoral_zone !== undefined) state.currentUser.pastoral_zone = additionalFields.pastoral_zone;
          if (additionalFields.small_group !== undefined) state.currentUser.small_group = additionalFields.small_group;
          renderProfileView();
        }
        alert("已成功變更成員權限角色！");
        renderAdminUserManagement();
      } else {
        alert("變更角色失敗，請重試。");
      }
    };
    listEl.appendChild(btn);
  });

  overlay.classList.add("active");
}

function populateProfileZones(greatRegion, autoSelect = true) {
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const userZone = state.currentUser.pastoral_zone;

  zoneSelect.innerHTML = `<option value="">-- 請選擇牧區 --</option>`;

  // Reset custom input box visibility when region selection changes
  if (!autoSelect) {
    customZoneInput.classList.add("hidden");
    customZoneInput.value = "";
  }

  if (!greatRegion || greatRegion === "custom") {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂牧區...";
    zoneSelect.appendChild(customOpt);
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let predefinedZones = (state.orgStructure && state.orgStructure.zones && state.orgStructure.zones[greatRegion] && state.orgStructure.zones[greatRegion].length > 0) 
    ? state.orgStructure.zones[greatRegion] 
    : ((typeof MOCK_PASTORAL_ZONES_BY_REGION !== "undefined" && MOCK_PASTORAL_ZONES_BY_REGION[greatRegion]) || []);
  
  if (!showDemoData) {
    predefinedZones = predefinedZones.filter(z => !z.startsWith("示範"));
  }
  
  predefinedZones.forEach(zName => {
    const option = document.createElement("option");
    option.value = zName;
    option.textContent = zName;
    // Only auto-select on initial load, not when user changes region
    if (autoSelect && userZone === zName) {
      option.selected = true;
    }
    zoneSelect.appendChild(option);
  });

  // Append user's custom value at the bottom if not in predefined list
  if (autoSelect && userZone && userZone !== "custom" && !predefinedZones.includes(userZone)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userZone;
    tempOpt.textContent = userZone;
    tempOpt.selected = true;
    zoneSelect.appendChild(tempOpt);
  }

  // Append custom option at the bottom
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂牧區...";
  zoneSelect.appendChild(customOpt);

  if (autoSelect) {
    zoneSelect.value = userZone || "";
  }
}

function populateProfileGroupSelector(autoSelect = true) {
  const zoneSelect = document.getElementById("profile-zone");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const userGroup = state.currentUser.small_group;

  groupSelect.innerHTML = `<option value="">-- 請選擇小組 --</option>`;

  // Reset custom input box visibility when zone selection changes
  if (!autoSelect) {
    customGroupInput.classList.add("hidden");
    customGroupInput.value = "";
  }

  const zone = zoneSelect.value;
  if (!zone || zone === "custom") {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂小組...";
    groupSelect.appendChild(customOpt);
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let predefinedGroups = (state.orgStructure && state.orgStructure.groups && state.orgStructure.groups[zone] && state.orgStructure.groups[zone].length > 0) 
    ? state.orgStructure.groups[zone] 
    : ((typeof MOCK_SMALL_GROUPS !== "undefined" && MOCK_SMALL_GROUPS[zone]) || []);

  if (!showDemoData) {
    predefinedGroups = predefinedGroups.filter(g => !g.startsWith("示範"));
  }

  predefinedGroups.forEach(groupName => {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    // Only auto-select on initial load
    if (autoSelect && userGroup === groupName) {
      option.selected = true;
    }
    groupSelect.appendChild(option);
  });

  // Append user's custom value at the bottom if not in predefined list
  if (autoSelect && userGroup && userGroup !== "custom" && !predefinedGroups.includes(userGroup)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userGroup;
    tempOpt.textContent = userGroup;
    tempOpt.selected = true;
    groupSelect.appendChild(tempOpt);
  }

  // Append custom option at the bottom
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂小組...";
  groupSelect.appendChild(customOpt);

  if (autoSelect) {
    groupSelect.value = userGroup || "";
  }
}

function updateAdminNavVisibility() {
  const isRealAdmin = !state.isSupabaseMode || (state.realRole === "admin" || state.realRole === "senior_pastor");
  
  const isSimulatedAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor");
  const shouldShowNav = isRealAdmin && isSimulatedAdmin;

  document.querySelectorAll(".admin-only-nav").forEach(btn => {
    if (shouldShowNav) {
      btn.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
    }
  });

  document.querySelectorAll(".admin-only-plan-card").forEach(card => {
    if (shouldShowNav) {
      card.classList.remove("hidden");
    } else {
      card.classList.add("hidden");
    }
  });
}



function initAdminOrgManagement() {
  const regionSelect = document.getElementById("admin-org-region");
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  if (!regionSelect || !zoneSelect || !groupSelect) return;

  // Bind change handlers
  regionSelect.onchange = () => {
    populateAdminZones();
  };

  zoneSelect.onchange = () => {
    populateAdminGroups();
  };

  // Bind click handlers for Great Region
  document.getElementById("admin-add-region-btn").onclick = async () => {
    const name = prompt("請輸入新大區名稱 (例如：東區)：");
    if (name && name.trim()) {
      loader.show("新增大區中...");
      const success = await db.createGreatRegion(name.trim());
      loader.hide();
      if (success) {
        alert("大區新增成功！");
        renderAdminOrgManagement();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-edit-region-btn").onclick = async () => {
    const val = regionSelect.value;
    if (!val) {
      alert("請選擇要修改的大區！");
      return;
    }
    const opt = regionSelect.options[regionSelect.selectedIndex];
    const oldName = opt.text;
    const newName = prompt(`請輸入大區 ${oldName} 的新名稱：`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      loader.show("更新大區中...");
      const success = await db.updateGreatRegion(val, newName.trim());
      loader.hide();
      if (success) {
        alert("大區更新成功！");
        renderAdminOrgManagement();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-delete-region-btn").onclick = async () => {
    const val = regionSelect.value;
    if (!val) {
      alert("請選擇要刪除的大區！");
      return;
    }
    const opt = regionSelect.options[regionSelect.selectedIndex];
    if (confirm(`您確定要刪除大區 ${opt.text} 嗎？這將連帶刪除此大區下所有的牧區與小組！`)) {
      loader.show("刪除大區中...");
      const success = await db.deleteGreatRegion(val);
      loader.hide();
      if (success) {
        alert("大區已成功刪除！");
        renderAdminOrgManagement();
        renderProfileView();
      }
    }
  };

  // Bind click handlers for Pastoral Zone
  document.getElementById("admin-add-zone-btn").onclick = async () => {
    const regionVal = regionSelect.value;
    if (!regionVal) {
      alert("請先選擇大區！牧區必須歸屬於某個大區下。");
      return;
    }
    const name = prompt("請輸入新牧區名稱 (例如：大安1)：");
    if (name && name.trim()) {
      loader.show("新增牧區中...");
      const success = await db.createPastoralZone(name.trim(), regionVal);
      loader.hide();
      if (success) {
        alert("牧區新增成功！");
        populateAdminZones();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-edit-zone-btn").onclick = async () => {
    const val = zoneSelect.value;
    if (!val) {
      alert("請選擇要修改的牧區！");
      return;
    }
    const opt = zoneSelect.options[zoneSelect.selectedIndex];
    const oldName = opt.text;
    const newName = prompt(`請輸入牧區 ${oldName} 的新名稱：`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      loader.show("更新牧區中...");
      const success = await db.updatePastoralZone(val, newName.trim());
      loader.hide();
      if (success) {
        alert("牧區更新成功！");
        populateAdminZones();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-delete-zone-btn").onclick = async () => {
    const val = zoneSelect.value;
    if (!val) {
      alert("請選擇要刪除的牧區！");
      return;
    }
    const opt = zoneSelect.options[zoneSelect.selectedIndex];
    if (confirm(`您確定要刪除牧區 ${opt.text} 嗎？這將連帶刪除此牧區下所有的小組！`)) {
      loader.show("刪除牧區中...");
      const success = await db.deletePastoralZone(val);
      loader.hide();
      if (success) {
        alert("牧區已成功刪除！");
        populateAdminZones();
        renderProfileView();
      }
    }
  };

  // Bind click handlers for Small Group
  document.getElementById("admin-add-group-btn").onclick = async () => {
    const zoneVal = zoneSelect.value;
    if (!zoneVal) {
      alert("請先選擇牧區！小組必須歸屬於某個牧區下。");
      return;
    }
    const name = prompt("請輸入新小組名稱 (例如：馬鈴)：");
    if (name && name.trim()) {
      loader.show("新增小組中...");
      const success = await db.createSmallGroup(name.trim(), zoneVal);
      loader.hide();
      if (success) {
        alert("小組新增成功！");
        populateAdminGroups();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-edit-group-btn").onclick = async () => {
    const val = groupSelect.value;
    if (!val) {
      alert("請選擇要修改的小組！");
      return;
    }
    const opt = groupSelect.options[groupSelect.selectedIndex];
    const oldName = opt.text;
    const newName = prompt(`請輸入小組 ${oldName} 的新名稱：`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      loader.show("更新小組中...");
      const success = await db.updateSmallGroup(val, newName.trim());
      loader.hide();
      if (success) {
        alert("小組更新成功！");
        populateAdminGroups();
        renderProfileView();
      }
    }
  };

  document.getElementById("admin-delete-group-btn").onclick = async () => {
    const val = groupSelect.value;
    if (!val) {
      alert("請選擇要刪除的小組！");
      return;
    }
    const opt = groupSelect.options[groupSelect.selectedIndex];
    if (confirm(`您確定要刪除小組 ${opt.text} 嗎？`)) {
      loader.show("刪除小組中...");
      const success = await db.deleteSmallGroup(val);
      loader.hide();
      if (success) {
        alert("小組已成功刪除！");
        populateAdminGroups();
        renderProfileView();
      }
    }
  };
}

function renderAdminOrgManagement() {
  const regionSelect = document.getElementById("admin-org-region");
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  if (!regionSelect || !zoneSelect || !groupSelect) return;

  // 1. Populate Regions
  regionSelect.innerHTML = `<option value="">-- 請選擇大區 --</option>`;
  if (state.isSupabaseMode && state.orgStructure.rawRegions) {
    state.orgStructure.rawRegions.forEach(r => {
      regionSelect.innerHTML += `<option value="${r.id}">${r.name}</option>`;
    });
  } else {
    state.orgStructure.regions.forEach(rName => {
      regionSelect.innerHTML += `<option value="${rName}">${rName}</option>`;
    });
  }

  zoneSelect.innerHTML = `<option value="">-- 請選擇大區後載入 --</option>`;
  groupSelect.innerHTML = `<option value="">-- 請選擇牧區後載入 --</option>`;
}

function populateAdminZones() {
  const regionSelect = document.getElementById("admin-org-region");
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  zoneSelect.innerHTML = `<option value="">-- 請選擇牧區 --</option>`;
  groupSelect.innerHTML = `<option value="">-- 請選擇牧區後載入 --</option>`;

  const regionVal = regionSelect.value;
  if (!regionVal) return;

  if (state.isSupabaseMode && state.orgStructure.rawZones) {
    const regionZones = state.orgStructure.rawZones.filter(z => z.great_region_id === regionVal);
    regionZones.forEach(z => {
      zoneSelect.innerHTML += `<option value="${z.id}">${z.name}</option>`;
    });
  } else {
    const regionZones = state.orgStructure.zones[regionVal] || [];
    regionZones.forEach(zName => {
      zoneSelect.innerHTML += `<option value="${zName}">${zName}</option>`;
    });
  }
}

function populateAdminGroups() {
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  groupSelect.innerHTML = `<option value="">-- 請選擇小組 --</option>`;

  const zoneVal = zoneSelect.value;
  if (!zoneVal) return;

  if (state.isSupabaseMode && state.orgStructure.rawGroups) {
    const zoneGroups = state.orgStructure.rawGroups.filter(g => g.pastoral_zone_id === zoneVal);
    zoneGroups.forEach(g => {
      groupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });
  } else {
    const zoneGroups = state.orgStructure.groups[zoneVal] || [];
    zoneGroups.forEach(gName => {
      groupSelect.innerHTML += `<option value="${gName}">${gName}</option>`;
    });
  }
}

// ─────────────────────────────────────────────
// Header Avatar Dropdown
// ─────────────────────────────────────────────

/**
 * Update the header avatar button and dropdown with current user info.
 * Called by db.updateAuthUI() whenever auth state changes.
 */
function updateHeaderAvatar() {
  const roleNames = {
    member: "\u6703\u53cb",
    small_group_leader: "\u5c0f\u7d44\u9577",
    group_leader: "\u5c0f\u7d44\u9577",
    zone_leader: "\u7267\u5340\u9577",
    great_zone_leader: "\u5927\u5340\u9577",
    admin: "\u7cfb\u7d71\u7ba1\u7406\u54e1",
    senior_pastor: "\u4e3b\u4efb\u7267\u5e2b"
  };

  const btn = document.getElementById("user-avatar-btn");
  const nameEl = document.getElementById("dropdown-user-name");
  const emailEl = document.getElementById("dropdown-user-email");
  const roleEl = document.getElementById("dropdown-user-role");

  const userName = state.currentUser.name || "NLC User";
  const userRole = state.currentUser.role || "member";
  const roleLabel = roleNames[userRole] || userRole;
  const initial = (userName || "N").trim().charAt(0) || "N";
  const setInitialAvatar = () => {
    if (btn) btn.innerHTML = `<span id="user-avatar-initial">${initial}</span>`;
  };

  if (nameEl) nameEl.textContent = userName;
  if (roleEl) roleEl.textContent = roleLabel;

  if (typeof auth !== "undefined" && auth.isLoggedIn()) {
    const payload = auth._parseJwt ? auth._parseJwt(localStorage.getItem(auth.keys.idToken) || "") : null;
    const email = payload?.email || payload?.preferred_username || payload?.sub || "\u6559\u6703\u7cfb\u7d71\u767b\u5165\u4e2d";
    if (emailEl) emailEl.textContent = email;
    if (payload?.picture && btn) {
      btn.innerHTML = `<img src="${payload.picture}" alt="avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;">`;
    } else {
      setInitialAvatar();
    }
    return;
  }

  if (state.isSupabaseMode && state.supabase && state.supabase.auth && state.supabase.auth.getUser) {
    state.supabase.auth.getUser().then(({ data }) => {
      const user = data && data.user;
      if (user) {
        if (emailEl) emailEl.textContent = user.email || "\u6559\u6703\u7cfb\u7d71\u767b\u5165\u4e2d";
        const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
        if (avatarUrl && btn) {
          btn.innerHTML = `<img src="${avatarUrl}" alt="avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;">`;
        } else {
          setInitialAvatar();
        }
      } else {
        if (emailEl) emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
        setInitialAvatar();
      }
    }).catch(err => {
      console.error("Error in updateHeaderAvatar:", err);
      if (emailEl) emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
      setInitialAvatar();
    });
  } else {
    if (emailEl) emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
    setInitialAvatar();
  }
}
/**
 * Wire up avatar dropdown toggle, click-outside-to-close, and logout.
 * Called once during initProfileControls().
 */
function initAvatarDropdown() {
  const container   = document.getElementById("user-avatar-container");
  const btn         = document.getElementById("user-avatar-btn");
  const dropdown    = document.getElementById("avatar-dropdown-menu");
  const btnLogout   = document.getElementById("btn-avatar-logout");
  const btnProfile  = document.getElementById("btn-avatar-profile");

  if (!btn || !dropdown) return;

  // Toggle dropdown on avatar click
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  // Close when clicking anywhere outside
  document.addEventListener("click", (e) => {
    if (container && !container.contains(e.target)) {
      dropdown.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  // Settings button
  if (btnProfile) {
    btnProfile.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.classList.add("hidden");
      if (typeof appRouter !== 'undefined' && appRouter.switchTab) {
        appRouter.switchTab("profile-view");
      }
    });
  }

  // Logout button
  if (btnLogout) {
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      dropdown.classList.add("hidden");
      loader.show("\u767b\u51fa\u4e2d...");
      try {
        if (typeof auth !== "undefined" && auth.logout) {
          await auth.logout();
          return;
        }
        if (state.isSupabaseMode && state.supabase?.auth?.signOut) {
          await state.supabase.auth.signOut();
        }
        state.realRole = null;
        db.updateAuthUI(null);
        await db.loadUserData();
        updateHeaderAvatar();
        alert("\u5df2\u767b\u51fa\u3002");
        appRouter.switchTab("dashboard-view");
      } catch (err) {
        alert(`\u767b\u51fa\u5931\u6557: ${err.message}`);
      } finally {
        loader.hide();
      }
    });
  }
}

// Responsibility selection modal helper (supporting multi-select checkboxes based on user's current hierarchy)
function showResponsibilityModal(role, user) {
  return new Promise((resolve) => {
    // Create the modal overlay
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    
    // Create the modal container
    const container = document.createElement("div");
    container.className = "glass-card";
    container.style = `
      width: 90%;
      max-width: 460px;
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: 16px;
      padding: 1.8rem;
      box-shadow: var(--shadow-lg);
      transform: translateY(20px);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    `;
    
    let roleText = "";
    if (role === "great_zone_leader") roleText = "大區長";
    else if (role === "zone_leader") roleText = "區長";
    else if (role === "group_leader") roleText = "小組長";
    
    let htmlContent = `
      <div style="margin-bottom: 0.2rem;">
        <h3 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem; font-weight: 500; color: var(--text-primary);">
          設定 ${roleText} 的負責範圍
        </h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0; line-height: 1.4;">
          請勾選該成員所負責的區域或小組（支援複選）。系統將依此授權管理範圍。
        </p>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 0.8rem; max-height: 380px; overflow-y: auto; padding-right: 0.2rem;">
        <!-- Region selection (Always rendered to avoid null and enable cascading) -->
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責大區 (可複選)</label>
          <div id="modal-regions-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 110px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
            <!-- Loaded dynamically -->
          </div>
        </div>
    `;
    
    // Pastoral Zone selection
    if (role === "zone_leader" || role === "group_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責牧區 (可複選)</label>
          <div id="modal-zones-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 110px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">請先勾選大區</span>
          </div>
        </div>
      `;
    }
    
    // Small Group selection
    if (role === "group_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責小組 (可複選)</label>
          <div id="modal-groups-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 110px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">請先勾選牧區</span>
          </div>
        </div>
      `;
    }
    
    htmlContent += `
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.6rem; border-top: 1px solid var(--border-card); padding-top: 0.8rem; margin-top: 0.2rem;">
        <button id="modal-btn-cancel" class="pill-btn" style="padding: 0.5rem 1.2rem; font-size: 0.85rem;">取消</button>
        <button id="modal-btn-confirm" class="primary-btn" style="padding: 0.5rem 1.2rem; font-size: 0.85rem; font-weight: 500;">確認變更</button>
      </div>
    `;
    
    container.innerHTML = htmlContent;
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    
    // Animate in
    setTimeout(() => {
      overlay.style.opacity = "1";
      container.style.transform = "translateY(0)";
    }, 10);
    
    // Parse current values for pre-checking
    const currentRegions = (user.great_region || "").split(",").map(s => s.trim()).filter(Boolean);
    const currentZones = (user.pastoral_zone || "").split(",").map(s => s.trim()).filter(Boolean);
    const currentGroups = (user.small_group || "").split(",").map(s => s.trim()).filter(Boolean);
    
    const regionContainer = overlay.querySelector("#modal-regions-container");
    const zoneContainer = overlay.querySelector("#modal-zones-container");
    const groupContainer = overlay.querySelector("#modal-groups-container");
    
    // Load Regions
    let regions = [];
    if (state.isSupabaseMode && state.orgStructure.rawRegions) {
      regions = state.orgStructure.rawRegions;
    } else if (state.orgStructure.regions) {
      regions = state.orgStructure.regions.map(rName => ({ id: rName, name: rName }));
    }
    
    let regionsHtml = "";
    regions.forEach(r => {
      const isChecked = currentRegions.includes(r.name) ? "checked" : "";
      regionsHtml += `
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
          <input type="checkbox" name="region-checkbox" value="${r.id}" data-name="${r.name}" ${isChecked} style="cursor: pointer;">
          <span>${r.name}</span>
        </label>
      `;
    });
    regionContainer.innerHTML = regionsHtml || `<span style="font-size: 0.8rem; color: var(--text-muted);">無大區資料</span>`;
    
    // Update Zones list based on checked regions
    const updateZones = () => {
      if (!zoneContainer) return;
      const checkedRegions = Array.from(regionContainer.querySelectorAll("input[name='region-checkbox']:checked")).map(cb => cb.value);
      
      if (checkedRegions.length === 0) {
        zoneContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">請先勾選大區</span>`;
        if (groupContainer) groupContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">請先勾選牧區</span>`;
        return;
      }
      
      let zones = [];
      if (state.isSupabaseMode && state.orgStructure.rawZones) {
        zones = state.orgStructure.rawZones.filter(z => checkedRegions.includes(z.great_region_id));
      } else if (state.orgStructure.zones) {
        checkedRegions.forEach(rName => {
          const regionZones = state.orgStructure.zones[rName] || [];
          regionZones.forEach(zName => {
            zones.push({ id: zName, name: zName });
          });
        });
      }
      
      let zonesHtml = "";
      zones.forEach(z => {
        const isChecked = currentZones.includes(z.name) ? "checked" : "";
        zonesHtml += `
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
            <input type="checkbox" name="zone-checkbox" value="${z.id}" data-name="${z.name}" ${isChecked} style="cursor: pointer;">
            <span>${z.name}</span>
          </label>
        `;
      });
      zoneContainer.innerHTML = zonesHtml || `<span style="font-size: 0.8rem; color: var(--text-muted);">無牧區資料</span>`;
      
      // Bind zone changes to update groups
      zoneContainer.querySelectorAll("input[name='zone-checkbox']").forEach(cb => {
        cb.onclick = updateGroups;
      });
      updateGroups();
    };
    
    // Update Groups list based on checked zones
    const updateGroups = () => {
      if (!groupContainer) return;
      const checkedZones = Array.from(zoneContainer.querySelectorAll("input[name='zone-checkbox']:checked")).map(cb => cb.value);
      
      if (checkedZones.length === 0) {
        groupContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">請先勾選牧區</span>`;
        return;
      }
      
      let groups = [];
      if (state.isSupabaseMode && state.orgStructure.rawGroups) {
        groups = state.orgStructure.rawGroups.filter(g => checkedZones.includes(g.pastoral_zone_id));
      } else if (state.orgStructure.groups) {
        checkedZones.forEach(zName => {
          const zoneGroups = state.orgStructure.groups[zName] || [];
          zoneGroups.forEach(gName => {
            groups.push({ id: gName, name: gName });
          });
        });
      }
      
      let groupsHtml = "";
      groups.forEach(g => {
        const isChecked = currentGroups.includes(g.name) ? "checked" : "";
        groupsHtml += `
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
            <input type="checkbox" name="group-checkbox" value="${g.id}" data-name="${g.name}" ${isChecked} style="cursor: pointer;">
            <span>${g.name}</span>
          </label>
        `;
      });
      groupContainer.innerHTML = groupsHtml || `<span style="font-size: 0.8rem; color: var(--text-muted);">無小組資料</span>`;
    };
    
    // Bind region check actions
    regionContainer.querySelectorAll("input[name='region-checkbox']").forEach(cb => {
      cb.onclick = updateZones;
    });
    
    // Initialize cascading trigger
    updateZones();
    
    // Close modal helper
    const closeModal = (result) => {
      overlay.style.opacity = "0";
      container.style.transform = "translateY(20px)";
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 300);
    };
    
    overlay.querySelector("#modal-btn-cancel").onclick = () => closeModal(null);
    
    overlay.querySelector("#modal-btn-confirm").onclick = () => {
      const checkedRegionCbs = Array.from(regionContainer.querySelectorAll("input[name='region-checkbox']:checked"));
      const checkedZoneCbs = zoneContainer ? Array.from(zoneContainer.querySelectorAll("input[name='zone-checkbox']:checked")) : [];
      const checkedGroupCbs = groupContainer ? Array.from(groupContainer.querySelectorAll("input[name='group-checkbox']:checked")) : [];
      
      if (checkedRegionCbs.length === 0) {
        alert("請至少選擇一個大區！");
        return;
      }
      if ((role === "zone_leader" || role === "group_leader") && checkedZoneCbs.length === 0) {
        alert("請至少選擇一個牧區！");
        return;
      }
      if (role === "group_leader" && checkedGroupCbs.length === 0) {
        alert("請至少選擇一個小組！");
        return;
      }
      
      const regionNames = checkedRegionCbs.map(cb => cb.dataset.name).join(",");
      const regionId = checkedRegionCbs.length === 1 && state.isSupabaseMode ? checkedRegionCbs[0].value : null;
      
      const zoneNames = checkedZoneCbs.map(cb => cb.dataset.name).join(",");
      const zoneId = checkedZoneCbs.length === 1 && state.isSupabaseMode ? checkedZoneCbs[0].value : null;
      
      const groupNames = checkedGroupCbs.map(cb => cb.dataset.name).join(",");
      const groupId = checkedGroupCbs.length === 1 && state.isSupabaseMode ? checkedGroupCbs[0].value : null;
      
      closeModal({
        great_region: regionNames,
        great_region_id: regionId,
        pastoral_zone: zoneNames,
        pastoral_zone_id: zoneId,
        small_group: groupNames,
        small_group_id: groupId
      });
    };
  });
}
