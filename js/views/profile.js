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

  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    senior_pastor: "主任牧師 (最高權限)",
    admin: "系統管理員"
  };
  roleDisplay.value = roleNames[state.currentUser.role] || "一般組員";

  const greatRegionsList = (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0) 
    ? state.orgStructure.regions 
    : ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
  
  greatRegionSelect.innerHTML = `<option value="">-- 請選擇大區 --</option>`;
  greatRegionsList.forEach(rName => {
    const option = document.createElement("option");
    option.value = rName;
    option.textContent = rName;
    greatRegionSelect.appendChild(option);
  });
  
  const userGreatRegion = state.currentUser.great_region;
  const isAdmin = state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor";

  if (isAdmin) {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂大區...";
    greatRegionSelect.appendChild(customOpt);
  } else {
    if (userGreatRegion && !greatRegionsList.includes(userGreatRegion)) {
      const tempOpt = document.createElement("option");
      tempOpt.value = userGreatRegion;
      tempOpt.textContent = userGreatRegion + " (唯讀)";
      greatRegionSelect.appendChild(tempOpt);
    }
  }

  if (userGreatRegion) {
    if (greatRegionsList.includes(userGreatRegion)) {
      greatRegionSelect.value = userGreatRegion;
      customGreatRegionInput.classList.add("hidden");
    } else {
      if (isAdmin) {
        greatRegionSelect.value = "custom";
        customGreatRegionInput.classList.remove("hidden");
        customGreatRegionInput.value = userGreatRegion;
      } else {
        greatRegionSelect.value = userGreatRegion;
        customGreatRegionInput.classList.add("hidden");
      }
    }
  } else {
    greatRegionSelect.value = "";
    customGreatRegionInput.classList.add("hidden");
  }

  populateProfileZones(greatRegionSelect.value);

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

  // Demo Switcher Listener
  const demoRoleSelect = document.getElementById("demo-role-select");
  if (demoRoleSelect) {
    demoRoleSelect.value = state.currentUser.role || "member";
    demoRoleSelect.onchange = async (e) => {
      await db.switchDemoRole(e.target.value);
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
}

function populateProfileZones(greatRegion) {
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const userZone = state.currentUser.pastoral_zone;
  const isAdmin = state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor";

  zoneSelect.innerHTML = `<option value="">-- 請選擇牧區 --</option>`;
  customZoneInput.classList.add("hidden");

  if (!greatRegion) return;

  if (greatRegion === "custom") {
    if (isAdmin) {
      zoneSelect.innerHTML += `<option value="custom">自訂牧區...</option>`;
      if (userZone) {
        zoneSelect.value = "custom";
        customZoneInput.classList.remove("hidden");
        customZoneInput.value = userZone;
      }
    } else {
      if (userZone) {
        const tempOpt = document.createElement("option");
        tempOpt.value = userZone;
        tempOpt.textContent = userZone + " (唯讀)";
        tempOpt.selected = true;
        zoneSelect.appendChild(tempOpt);
      }
    }
    return;
  }

  const predefinedZones = (state.orgStructure && state.orgStructure.zones && state.orgStructure.zones[greatRegion]) 
    ? state.orgStructure.zones[greatRegion] 
    : (MOCK_PASTORAL_ZONES_BY_REGION[greatRegion] || []);
  predefinedZones.forEach(zName => {
    const option = document.createElement("option");
    option.value = zName;
    option.textContent = zName;
    if (userZone === zName) {
      option.selected = true;
    }
    zoneSelect.appendChild(option);
  });

  if (isAdmin) {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂牧區...";
    if (userZone && !predefinedZones.includes(userZone)) {
      customOpt.selected = true;
      customZoneInput.classList.remove("hidden");
      customZoneInput.value = userZone;
    }
    zoneSelect.appendChild(customOpt);
  } else {
    if (userZone && !predefinedZones.includes(userZone)) {
      const tempOpt = document.createElement("option");
      tempOpt.value = userZone;
      tempOpt.textContent = userZone + " (唯讀)";
      tempOpt.selected = true;
      zoneSelect.appendChild(tempOpt);
    }
  }
}

function populateProfileGroupSelector() {
  const zoneSelect = document.getElementById("profile-zone");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const userGroup = state.currentUser.small_group;
  const isAdmin = state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor";

  groupSelect.innerHTML = `<option value="">-- 請選擇小組 --</option>`;
  customGroupInput.classList.add("hidden");

  const zone = zoneSelect.value;
  if (!zone) return;

  const predefinedGroups = (state.orgStructure && state.orgStructure.groups && state.orgStructure.groups[zone]) 
    ? state.orgStructure.groups[zone] 
    : (MOCK_SMALL_GROUPS[zone] || []);

  predefinedGroups.forEach(groupName => {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    if (userGroup === groupName) {
      option.selected = true;
    }
    groupSelect.appendChild(option);
  });

  if (isAdmin) {
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
  } else {
    if (userGroup && !predefinedGroups.includes(userGroup) && zone !== "custom") {
      const tempOpt = document.createElement("option");
      tempOpt.value = userGroup;
      tempOpt.textContent = userGroup + " (唯讀)";
      tempOpt.selected = true;
      groupSelect.appendChild(tempOpt);
    }
    if (zone === "custom") {
      if (userGroup) {
        const tempOpt = document.createElement("option");
        tempOpt.value = userGroup;
        tempOpt.textContent = userGroup + " (唯讀)";
        tempOpt.selected = true;
        groupSelect.appendChild(tempOpt);
      }
    }
  }
}
