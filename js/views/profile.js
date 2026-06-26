// Profile & settings tab view controller

function renderProfileView() {
  document.getElementById("profile-name").value = state.currentUser.name || "";
  
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

  const showDemoData = !state.isSupabaseMode || !!state.currentUser.is_demo;

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
    const name = document.getElementById("profile-name").value.trim();
    const greatRegion = greatRegionSelect.value === "custom" ? customGreatRegionInput.value.trim() : greatRegionSelect.value;
    const zone = zoneSelect.value === "custom" ? customZoneInput.value.trim() : zoneSelect.value;
    const group = groupSelect.value === "custom" ? customGroupInput.value.trim() : groupSelect.value;

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
      if (state.isSupabaseMode && state.supabase) {
        await db.syncProfileStatsToSupabase();
      }
      db.saveLocalUserStats();
      alert("個人資料儲存成功！");
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
  const isRealAdmin = !state.isSupabaseMode || (state.realRole === "admin" || state.realRole === "senior_pastor");
  
  const demoRoleCard = document.querySelector(".demo-role-card");
  if (demoRoleCard) {
    if (isRealAdmin) {
      demoRoleCard.classList.remove("hidden");
    } else {
      demoRoleCard.classList.add("hidden");
    }
  }

  const demoRoleSelect = document.getElementById("demo-role-select");
  if (demoRoleSelect) {
    demoRoleSelect.value = state.currentUser.role || "member";
    demoRoleSelect.onchange = async (e) => {
      await db.switchDemoRole(e.target.value);
    };
  }

  // Admin User Management Section Visibility and Rendering
  if (typeof updateAdminNavVisibility === 'function') {
    updateAdminNavVisibility();
  }

  // Render reading stats card
  renderProfileReadingStats();
}

// Initialize profile & auth page controls on page load
function initProfileControls() {
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
  if (btnGoogleGate) {
    btnGoogleGate.onclick = async (e) => {
      e.preventDefault();
      loader.show("開啟 Google 登入中...");
      try {
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
      loader.show("登出中...");
      try {
        await state.supabase.auth.signOut();
        state.realRole = null;
        db.updateAuthUI(null);
        await db.loadUserData();
        alert("已成功登出。");
        renderProfileView();
      } catch (err) {
        alert(`登出失敗: ${err.message}`);
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

      let selectHtml = `<select class="form-control" style="font-size: 0.82rem; padding: 0.25rem 0.5rem; height: auto; width: 100%;" ${isDemo ? "disabled title=\"示範帳號不可更改角色\"" : ""}>`;
      roleOptions.forEach(opt => {
        const selected = user.role === opt.value ? "selected" : "";
        selectHtml += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
      });
      selectHtml += `</select>`;

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
          statusCell.innerHTML = `<span style="font-size: 0.8rem; color: var(--primary-color); font-weight: bold;">更新中...</span>`;
          select.disabled = true;

          const success = await db.updateUserRole(user.id, newRole, user.name);

          select.disabled = false;
          if (success) {
            statusCell.innerHTML = `<span style="font-size: 0.8rem; color: #10b981; font-weight: bold;">✓ 已儲存</span>`;
            if (user.name === state.currentUser.name) {
              state.currentUser.role = newRole;
              renderProfileView();
            }
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

  const showDemoData = !state.isSupabaseMode || !!state.currentUser.is_demo;

  let predefinedZones = (state.orgStructure && state.orgStructure.zones && state.orgStructure.zones[greatRegion] && state.orgStructure.zones[greatRegion].length > 0) 
    ? state.orgStructure.zones[greatRegion] 
    : (MOCK_PASTORAL_ZONES_BY_REGION[greatRegion] || []);
  
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

  const showDemoData = !state.isSupabaseMode || !!state.currentUser.is_demo;

  let predefinedGroups = (state.orgStructure && state.orgStructure.groups && state.orgStructure.groups[zone] && state.orgStructure.groups[zone].length > 0) 
    ? state.orgStructure.groups[zone] 
    : (MOCK_SMALL_GROUPS[zone] || []);

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
    const newName = prompt(`請輸入大區「${oldName}」的新名稱：`, oldName);
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
    if (confirm(`您確定要刪除大區「${opt.text}」嗎？這將連帶刪除此大區下所有的牧區與小組！`)) {
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
    const newName = prompt(`請輸入牧區「${oldName}」的新名稱：`, oldName);
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
    if (confirm(`您確定要刪除牧區「${opt.text}」嗎？這將連帶刪除此牧區下所有的小組！`)) {
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
    const newName = prompt(`請輸入小組「${oldName}」的新名稱：`, oldName);
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
    if (confirm(`您確定要刪除小組「${opt.text}」嗎？`)) {
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
    member:            "一般組員",
    group_leader:      "小組長",
    zone_leader:       "區長",
    great_zone_leader: "大區長",
    senior_pastor:     "主任牧師",
    admin:             "系統管理員"
  };

  const initial   = document.getElementById("user-avatar-initial");
  const nameEl    = document.getElementById("dropdown-user-name");
  const emailEl   = document.getElementById("dropdown-user-email");
  const roleEl    = document.getElementById("dropdown-user-role");

  if (!initial) return;

  const userName  = state.currentUser.name || "用戶";
  const userRole  = state.currentUser.role || "member";
  const roleLabel = roleNames[userRole] || userRole;

  // Avatar initial character
  initial.textContent = userName.charAt(0) || "用";

  // Name
  if (nameEl) nameEl.textContent = userName;

  // Email: show real email in Supabase mode, otherwise show offline label
  if (emailEl) {
    if (state.isSupabaseMode && state.supabase) {
      state.supabase.auth.getUser().then(({ data }) => {
        emailEl.textContent = (data && data.user && data.user.email) ? data.user.email : "Demo 離線模式";
      });
    } else {
      emailEl.textContent = "Demo 離線模式";
    }
  }

  // Role badge
  if (roleEl) roleEl.textContent = roleLabel;
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

  // Logout button
  if (btnLogout) {
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      dropdown.classList.add("hidden");
      loader.show("登出中...");
      try {
        if (state.isSupabaseMode && state.supabase) {
          await state.supabase.auth.signOut();
        }
        state.realRole = null;
        db.updateAuthUI(null);
        await db.loadUserData();
        updateHeaderAvatar();
        alert("已成功登出。");
        appRouter.switchTab("dashboard-view");
      } catch (err) {
        alert(`登出失敗: ${err.message}`);
      } finally {
        loader.hide();
      }
    });
  }
}

// ─────────────────────────────────────────────
// Personal Reading Stats Calculation & Rendering
// ─────────────────────────────────────────────

/**
 * Calculate reading statistics for the active plan.
 */
function calculateProfileStats(plan) {
  if (!plan) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(plan.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(plan.endDate);
  end.setHours(0, 0, 0, 0);

  const totalDays = plan.totalDays || (Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1));

  const level = plan.level || 'normal';
  let targetRounds = 1;
  if (level === 'breakthrough') targetRounds = 2;
  else if (level === 'super') targetRounds = 3;

  // 1. Calculate actual completed chapters across all relevant rounds
  let actualCompletedChapters = 0;
  for (let r = 1; r <= targetRounds; r++) {
    const roundLogs = state.readingLogs.filter(l => 
      (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
      (l.round || 1) === r
    );
    const uniqueChapters = new Set(roundLogs.map(l => `${l.book}_${l.chapter}`));
    
    let planChaptersCount = 0;
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        if (uniqueChapters.has(`${ch.book}_${ch.chapter}`)) {
          planChaptersCount++;
        }
      });
    });
    actualCompletedChapters += planChaptersCount;
  }

  // 2. Build cumulative scheduled chapters list
  const cumulativeScheduled = [];
  let sum = 0;
  for (let i = 0; i < totalDays; i++) {
    sum += plan.days[i].chapters.length;
    cumulativeScheduled.push(sum * targetRounds);
  }

  // 3. Find equivalent day completed
  let equivalentDay = 0;
  for (let d = 1; d <= totalDays; d++) {
    if (actualCompletedChapters >= cumulativeScheduled[d - 1]) {
      equivalentDay = d;
    } else {
      break;
    }
  }

  // 4. Calculate lag and lead days
  let lagDays = 0;
  let leadDays = 0;

  const currentRound = plan.currentRound || 1;
  // If currentRound >= 4, the user is in self-managed phase, no lag/lead scheduling checks
  if (currentRound < 4 && elapsedDays > 0) {
    const diff = equivalentDay - elapsedDays;
    if (diff > 0) {
      leadDays = diff;
    } else if (diff < 0) {
      lagDays = -diff;
    }
  }

  // 5. Calculate makeup days
  let makeupDays = 0;
  for (let r = 1; r <= targetRounds; r++) {
    plan.days.forEach((day, index) => {
      const d = index + 1;
      
      const scheduledDate = new Date(start);
      scheduledDate.setDate(start.getDate() + (d - 1));
      const scheduledDateStr = scheduledDate.toISOString().substring(0, 10);
      
      const roundLogs = state.readingLogs.filter(l => 
        (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
        (l.round || 1) === r
      );
      
      let allChaptersCompleted = true;
      let maxReadDateStr = "";
      
      for (const ch of day.chapters) {
        const log = roundLogs.find(l => l.book === ch.book && l.chapter === ch.chapter);
        if (!log) {
          allChaptersCompleted = false;
          break;
        }
        const logDateStr = log.read_at.substring(0, 10);
        if (!maxReadDateStr || logDateStr > maxReadDateStr) {
          maxReadDateStr = logDateStr;
        }
      }
      
      if (allChaptersCompleted && maxReadDateStr) {
        if (maxReadDateStr > scheduledDateStr) {
          makeupDays++;
        }
      }
    });
  }

  return {
    elapsedDays,
    totalDays,
    lagDays,
    leadDays,
    makeupDays,
    startDateStr: plan.startDate,
    endDateStr: plan.endDate,
    currentRound
  };
}

/**
 * Render personal reading stats card.
 */
function renderProfileReadingStats() {
  const container = document.getElementById("profile-reading-stats-container");
  if (!container) return;

  const streakDays = state.currentUser.streak || 0;
  const plan = state.activePlan;
  const stats = calculateProfileStats(plan);

  if (!plan || !stats) {
    // Empty state
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 1rem; opacity: 0.6; display: block;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="9" y1="15" x2="15" y2="15"></line>
          <line x1="9" y1="19" x2="15" y2="19"></line>
          <line x1="9" y1="11" x2="10" y2="11"></line>
        </svg>
        <p style="font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">尚未加入讀經計畫</p>
        <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.5rem;">
          請至「讀經計畫」頁面選擇並加入任一計畫，即可在此查看詳細的進度統計。
        </p>
        
        <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.2); border: 1px solid var(--border-card); padding: 0.8rem 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; text-align: left;">
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <div class="stat-icon-wrapper" style="background: rgba(239, 68, 68, 0.1); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ef4444;">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
            </div>
            <div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">連續讀經</div>
            </div>
          </div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #ef4444; display: flex; align-items: baseline; gap: 0.1rem;">
            ${streakDays} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">天</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Determine Today's Progress display string
  let todayProgressText = "";
  const start = new Date(stats.startDateStr);
  const end = new Date(stats.endDateStr);
  const today = new Date();
  today.setHours(0,0,0,0);
  start.setHours(0,0,0,0);
  end.setHours(0,0,0,0);

  if (today < start) {
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">尚未開始 (開始於 ${stats.startDateStr})</span>`;
  } else if (today > end) {
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">已結束 (共 ${stats.totalDays} 天)</span>`;
  } else {
    todayProgressText = `<span style="font-size: 1.25rem; font-weight: 800; color: var(--primary-color);">${stats.elapsedDays}</span> <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">/ ${stats.totalDays} 天</span>`;
  }

  const lagDisplay = stats.lagDays > 0 
    ? `${stats.lagDays} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 600; color: var(--text-muted);">0 天</span>`;

  const leadDisplay = stats.leadDays > 0
    ? `${stats.leadDays} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 600; color: var(--text-muted);">0 天</span>`;

  const makeupDisplay = stats.makeupDays > 0
    ? `${stats.makeupDays} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 600; color: var(--text-muted);">0 天</span>`;

  container.innerHTML = `
    <div class="profile-stats-grid" style="display: grid; grid-template-columns: 1fr; gap: 1rem;">
      
      <!-- Today's Day -->
      <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.18); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: rgba(99, 102, 241, 0.1); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--primary-color);">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">今天計畫進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">目前已進行的計畫天數</div>
          </div>
        </div>
        <div style="font-weight: 800; display: flex; align-items: baseline; gap: 0.1rem;">
          ${todayProgressText}
        </div>
      </div>

      <!-- Consecutive Streak -->
      <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.18); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: rgba(239, 68, 68, 0.1); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ef4444;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">連續讀經</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">每日穩定靈修天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #ef4444; display: flex; align-items: baseline; gap: 0.1rem;">
          ${streakDays} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">天</span>
        </div>
      </div>

      <!-- Behind Days -->
      <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.18); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.lagDays > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.lagDays > 0 ? '#ef4444' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">落後進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">落後預計進度天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: ${stats.lagDays > 0 ? '#ef4444' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${lagDisplay}
        </div>
      </div>

      <!-- Ahead Days -->
      <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.18); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.leadDays > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.leadDays > 0 ? '#10b981' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">超前進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">超前預計進度天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: ${stats.leadDays > 0 ? '#10b981' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${leadDisplay}
        </div>
      </div>

      <!-- Makeup Days -->
      <div class="stat-item-card" style="background: rgba(255, 255, 255, 0.18); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.makeupDays > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.makeupDays > 0 ? '#3b82f6' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">補讀天數</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">事後補讀完畢天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: ${stats.makeupDays > 0 ? '#3b82f6' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${makeupDisplay}
        </div>
      </div>

    </div>
  `;
}


