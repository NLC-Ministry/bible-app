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
  const lockedFields = new Set(state.profileLockedFields || []);
  const profileNameInput = document.getElementById("profile-name");
  profileNameInput.value = state.currentUser.name || "";
  profileNameInput.readOnly = lockedFields.has("name");
  profileNameInput.classList.toggle("readonly-field", lockedFields.has("name"));
  profileNameInput.title = lockedFields.has("name") ? "\u6b64\u6b04\u4f4d\u7531\u6559\u6703\u7cfb\u7d71\u63d0\u4f9b\uff0c\u4e0d\u53ef\u7de8\u8f2f" : "";
  
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
  roleDisplay.textContent = roleNames[state.currentUser.role] || "一般組員";

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
          alert("個人資料已儲存 (Demo 模擬模式)。");
        } else {
          const savedId = (saveInfo?.profile?.id || saveInfo?.profile_id) ? "\nProfile ID: " + (saveInfo.profile?.id || saveInfo.profile_id) : "";
          const savedProject = saveInfo?.project_url ? "\nProject: " + saveInfo.project_url : "";
          alert("個人資料已確認寫入 Supabase。" + savedId + savedProject);
        }
      } else {
        alert("個人資料已儲存至本機 (離線模式)。");
      }
      updateDashboardView();
    } catch (err) {
      console.error("Failed to save profile:", err);
      state.currentUser = oldProfile;
      alert(`儲存個人資料失敗: ${err.message || err}`);
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

  // Initialize header avatar dropdown
  initAvatarDropdown();
}

// Render administrative User Permission Management table
async function renderAdminUserManagement() {
  const tableBody = document.getElementById("admin-users-table-body");
  if (!tableBody) return;

  const searchInput = document.getElementById("admin-search-user");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  // Show inline loading indicator
  tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">載入成員名單中...</td></tr>`;

  try {
    const users = await db.fetchMergedUsersList();
    
    // Sort users: current user first, then leaders, then members
    const roleOrder = { senior_pastor: 1, admin: 2, great_zone_leader: 3, zone_leader: 4, group_leader: 5, member: 6 };
    const sortedUsers = [...users].sort((a, b) => {
      if (a.name === state.currentUser.name) return -1;
      if (b.name === state.currentUser.name) return 1;
      return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
    });

    const filteredUsers = sortedUsers.filter(u => u.name.toLowerCase().includes(query));

    tableBody.innerHTML = "";

    if (filteredUsers.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">無相符成員</td></tr>`;
      return;
    }

    filteredUsers.forEach(user => {
      const tr = document.createElement("tr");
      const isDemo = !!user.is_demo;

      const roleOptions = [
        { value: "member", label: "一般組員" },
        { value: "group_leader", label: "小組長" },
        { value: "zone_leader", label: "區長" },
        { value: "great_zone_leader", label: "大區長" },
        { value: "senior_pastor", label: "主任牧師" },
        { value: "admin", label: "系統管理員" }
      ];

      let selectHtml = `<div style="display: flex; align-items: center; gap: 0.4rem;">`;
      selectHtml += `<select class="form-control" style="font-size: 0.82rem; padding: 0.25rem 0.5rem; height: auto; flex: 1;" ${isDemo ? "disabled title=\"示範帳號不可更改角色\"" : ""}>`;
      roleOptions.forEach(opt => {
        const selected = user.role === opt.value ? "selected" : "";
        selectHtml += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
      });
      selectHtml += `</select>`;

      const isLeader = ["great_zone_leader", "zone_leader", "group_leader"].includes(user.role);
      if (isLeader && !isDemo) {
        selectHtml += `
          <button class="pill-btn edit-scope-btn" data-userid="${user.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; white-space: nowrap;">
            ✏️ 範圍
          </button>
        `;
      }
      selectHtml += `</div>`;

      const demoBadge = isDemo
        ? `<span style="display:inline-block;margin-left:0.4rem;padding:0.1rem 0.45rem;border-radius:99px;font-size:0.65rem;font-weight:700;background:rgba(251,191,36,0.18);color:#d97706;border:1px solid rgba(251,191,36,0.4);">示範</span>`
        : "";

      tr.innerHTML = `
        <td><strong>${escapeHTML(user.name)}</strong>${demoBadge}</td>
        <td>${escapeHTML(user.great_region)} / ${escapeHTML(user.pastoral_zone)} / ${escapeHTML(user.small_group)}</td>
        <td>${selectHtml}</td>
        <td style="text-align: center; vertical-align: middle;" class="status-cell">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${isDemo ? "示範帳號" : "--"}</span>
        </td>
      `;

      if (!isDemo) {
        // Event listener for role selector (only for real accounts)
        const select = tr.querySelector("select");
        const statusCell = tr.querySelector(".status-cell");

        select.onchange = async (e) => {
          const newRole = e.target.value;
          let additionalFields = {};

          if (["great_zone_leader", "zone_leader", "group_leader"].includes(newRole)) {
            const resp = await showResponsibilityModal(newRole, user);
            if (!resp) {
              select.value = user.role;
              return;
            }
            additionalFields = resp;
          }

          statusCell.innerHTML = `<span style="font-size: 0.8rem; color: var(--primary-color); font-weight: bold;">更新中...</span>`;
          select.disabled = true;

          const success = await db.updateUserRole(user.id, newRole, user.name, additionalFields);

          select.disabled = false;
          if (success) {
            statusCell.innerHTML = `<span style="font-size: 0.8rem; color: #10b981; font-weight: bold;">✓ 已儲存</span>`;
            user.role = newRole;
            if (additionalFields.great_region !== undefined) user.great_region = additionalFields.great_region;
            if (additionalFields.pastoral_zone !== undefined) user.pastoral_zone = additionalFields.pastoral_zone;
            if (additionalFields.small_group !== undefined) user.small_group = additionalFields.small_group;

            if (user.name === state.currentUser.name) {
              state.currentUser.role = newRole;
              state.realRole = newRole;
              if (additionalFields.great_region !== undefined) state.currentUser.great_region = additionalFields.great_region;
              if (additionalFields.pastoral_zone !== undefined) state.currentUser.pastoral_zone = additionalFields.pastoral_zone;
              if (additionalFields.small_group !== undefined) state.currentUser.small_group = additionalFields.small_group;
              renderProfileView();
            }

            renderAdminUserManagement();

            setTimeout(() => {
              if (statusCell.textContent.includes("已儲存")) {
                statusCell.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">--</span>`;
              }
            }, 2000);
          } else {
            statusCell.innerHTML = `<span style="font-size: 0.8rem; color: #ef4444; font-weight: bold;">✕ 失敗</span>`;
            select.value = user.role;
          }
        };

        // Event listener for edit scope button (if exists)
        const editBtn = tr.querySelector(".edit-scope-btn");
        if (editBtn) {
          editBtn.onclick = async () => {
            const resp = await showResponsibilityModal(user.role, user);
            if (!resp) return;

            statusCell.innerHTML = `<span style="font-size: 0.8rem; color: var(--primary-color); font-weight: bold;">更新中...</span>`;
            
            const success = await db.updateUserRole(user.id, user.role, user.name, resp);
            
            if (success) {
              statusCell.innerHTML = `<span style="font-size: 0.8rem; color: #10b981; font-weight: bold;">✓ 已儲存</span>`;
              if (resp.great_region !== undefined) user.great_region = resp.great_region;
              if (resp.pastoral_zone !== undefined) user.pastoral_zone = resp.pastoral_zone;
              if (resp.small_group !== undefined) user.small_group = resp.small_group;

              if (user.name === state.currentUser.name) {
                if (resp.great_region !== undefined) state.currentUser.great_region = resp.great_region;
                if (resp.pastoral_zone !== undefined) state.currentUser.pastoral_zone = resp.pastoral_zone;
                if (resp.small_group !== undefined) state.currentUser.small_group = resp.small_group;
                renderProfileView();
              }

              renderAdminUserManagement();
            } else {
              statusCell.innerHTML = `<span style="font-size: 0.8rem; color: #ef4444; font-weight: bold;">✕ 失敗</span>`;
            }
          };
        }
      }

      tableBody.appendChild(tr);
    });

  } catch (err) {
    console.error("Failed to render admin user management:", err);
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444;">載入失敗: ${err.message || err}</td></tr>`;
  }
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
        if (emailEl) emailEl.textContent = "Demo \u96e2\u7dda\u6a21\u5f0f";
        setInitialAvatar();
      }
    }).catch(err => {
      console.error("Error in updateHeaderAvatar:", err);
      if (emailEl) emailEl.textContent = "Demo \u96e2\u7dda\u6a21\u5f0f";
      setInitialAvatar();
    });
  } else {
    if (emailEl) emailEl.textContent = "Demo \u96e2\u7dda\u6a21\u5f0f";
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
      box-shadow: 0 10px 30px rgba(0,0,0,0.15);
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
        <h3 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem; font-weight: 800; color: var(--text-primary);">
          設定 ${roleText} 的負責範圍
        </h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0; line-height: 1.4;">
          請勾選該成員所負責的區域或小組（支援複選）。系統將依此授權管理範圍。
        </p>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 0.8rem; max-height: 380px; overflow-y: auto; padding-right: 0.2rem;">
        <!-- Region selection (Always rendered to avoid null and enable cascading) -->
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.3rem;">負責大區 (可複選)</label>
          <div id="modal-regions-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 110px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
            <!-- Loaded dynamically -->
          </div>
        </div>
    `;
    
    // Pastoral Zone selection
    if (role === "zone_leader" || role === "group_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.3rem;">負責牧區 (可複選)</label>
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
          <label style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.3rem;">負責小組 (可複選)</label>
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
        <button id="modal-btn-confirm" class="primary-btn" style="padding: 0.5rem 1.2rem; font-size: 0.85rem; font-weight: 700;">確認變更</button>
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
        cb.onchange = updateGroups;
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
      cb.onchange = updateZones;
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
