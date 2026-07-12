// js/modules/admin.js

export function updateFilterChipsUI() {
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

export function openAdminFilterBottomSheet(type) {
  const overlay = document.getElementById("global-bottom-sheet");
  const titleEl = document.getElementById("bottom-sheet-title");
  const listEl = document.getElementById("bottom-sheet-list");
  if (!overlay || !listEl) return;

  let title = "選擇篩選條件";
  let options = [];
  let selectedValue = state.adminFilters[type];

  const getPredefinedRegions = () => {
    return (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0)
      ? state.orgStructure.regions
      : ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
  };

  const getPredefinedZones = () => {
    if (state.adminFilters.region) {
      return state.orgStructure.zones[state.adminFilters.region] || [];
    }
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

  overlay.classList.add("active");
}

export function closeAdminFilterBottomSheet() {
  console.log("🔒 [Debug] 關閉管理篩選 Bottom Sheet");
  const overlay = document.getElementById("global-bottom-sheet");
  if (overlay) overlay.classList.remove("active");
}

export function initAdminFiltersUI() {
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

export async function renderAdminUserManagement() {
  const listContainer = document.getElementById("admin-users-list");
  if (!listContainer) return;

  const searchInput = document.getElementById("admin-search-user");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  ComponentSkeletonLoader.show('members', listContainer);

  try {
    const users = await db.fetchMergedUsersList(null, true);
    
    const roleOrder = { senior_pastor: 1, admin: 2, great_zone_leader: 3, zone_leader: 4, group_leader: 5, member: 6 };
    const sortedUsers = [...users].sort((a, b) => {
      if (a.name === state.currentUser.name) return -1;
      if (b.name === state.currentUser.name) return 1;
      return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
    });

    const filteredUsers = sortedUsers.filter(u => {
      if (state.isSupabaseMode && u.is_demo) return false;
      const matchName = u.name.toLowerCase().includes(query);
      const matchEmail = u.email ? u.email.toLowerCase().includes(query) : false;
      const matchRegion = !state.adminFilters.region || u.great_region === state.adminFilters.region;
      const matchZone = !state.adminFilters.zone || u.pastoral_zone === state.adminFilters.zone;
      const matchGroup = !state.adminFilters.group || u.small_group === state.adminFilters.group;
      return (matchName || matchEmail) && matchRegion && matchZone && matchGroup;
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
          ${user.email ? `<div class="member-email-text">${escapeHTML(user.email)}</div>` : ''}
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

export function openMemberEditBottomSheet(user) {
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



  const isLeader = ["great_zone_leader", "zone_leader", "group_leader"].includes(user.role);
  if (isLeader) {
    const scopeBtn = document.createElement("button");
    scopeBtn.className = "bottom-sheet-item";
    scopeBtn.style.background = "var(--color-brand-subtle, rgba(4,169,210,0.12))";
    scopeBtn.style.borderColor = "var(--color-brand-border, rgba(4,169,210,0.24))";
    scopeBtn.style.color = "#a5b4fc";
    scopeBtn.style.marginBottom = "0.8rem";
    scopeBtn.type = "button";

    let scopeDesc = "";
    if (user.role === "great_zone_leader") scopeDesc = user.managed_regions || user.great_region || "未設定";
    else if (user.role === "zone_leader") scopeDesc = user.managed_zones || user.pastoral_zone || "未設定";
    else if (user.role === "group_leader") scopeDesc = user.managed_groups || user.small_group || "未設定";

    scopeBtn.innerHTML = iconLabel("edit", `修改管轄範圍 (${scopeDesc})`);
    scopeBtn.onclick = async () => {
      console.log(`✏️ [Debug] 修改管轄範圍按鈕被點擊，成員：${user.name}`);
      closeAdminFilterBottomSheet();
      const resp = await showResponsibilityModal(user.role, user);
      if (!resp) return;

      loader.show();
      const success = await db.updateUserRole(user.id, user.role, user.name, resp);
      loader.hide();

      if (success) {
        user.managed_regions = resp.managed_regions;
        user.managed_zones = resp.managed_zones;
        user.managed_groups = resp.managed_groups;

        if (user.name === state.currentUser.name) {
          state.currentUser.managed_regions = resp.managed_regions;
          state.currentUser.managed_zones = resp.managed_zones;
          state.currentUser.managed_groups = resp.managed_groups;
          if (typeof renderProfileView === "function") renderProfileView();
        }
        alert("已成功更新管轄範圍！");
        renderAdminUserManagement();
      } else {
        alert("更新管轄範圍失敗，請重試。");
      }
    };
    listEl.appendChild(scopeBtn);
  }

  const headerText = document.createElement("div");
  headerText.style.fontSize = "0.75rem";
  headerText.style.color = "var(--text-secondary)";
  headerText.style.margin = "0.2rem 0 0.5rem 0.2rem";
  headerText.style.fontWeight = "bold";
  headerText.textContent = "變更角色身分：";
  listEl.appendChild(headerText);

  roleOptions.forEach(opt => {
    const btn = document.createElement("button");
    const isSelected = user.role === opt.value;
    btn.className = `bottom-sheet-item ${isSelected ? "selected" : ""}`;
    btn.type = "button";
    btn.textContent = opt.label;
    btn.onclick = async () => {
      console.log(`✏️ [Debug] 變更角色身分點擊: ${user.name} -> ${opt.label}`);
      closeAdminFilterBottomSheet();
      if (isSelected) return;

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
        if (additionalFields.managed_regions !== undefined) user.managed_regions = additionalFields.managed_regions;
        if (additionalFields.managed_zones !== undefined) user.managed_zones = additionalFields.managed_zones;
        if (additionalFields.managed_groups !== undefined) user.managed_groups = additionalFields.managed_groups;

        if (user.name === state.currentUser.name) {
          state.currentUser.role = opt.value;
          state.realRole = opt.value;
          if (additionalFields.managed_regions !== undefined) state.currentUser.managed_regions = additionalFields.managed_regions;
          if (additionalFields.managed_zones !== undefined) state.currentUser.managed_zones = additionalFields.managed_zones;
          if (additionalFields.managed_groups !== undefined) state.currentUser.managed_groups = additionalFields.managed_groups;
          if (typeof renderProfileView === "function") renderProfileView();
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

export function initAdminOrgManagement() {
  const regionSelect = document.getElementById("admin-org-region");
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  if (!regionSelect || !zoneSelect || !groupSelect) return;

  regionSelect.onchange = () => {
    populateAdminZones();
  };

  zoneSelect.onchange = () => {
    populateAdminGroups();
  };

  document.getElementById("admin-add-region-btn").onclick = async () => {
    const name = prompt("請輸入新大區名稱 (例如：東區)：");
    if (name && name.trim()) {
      loader.show("新增大區中...");
      const success = await db.createGreatRegion(name.trim());
      loader.hide();
      if (success) {
        alert("大區新增成功！");
        renderAdminOrgManagement();
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
      }
    }
  };

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
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
      }
    }
  };

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
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
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
        if (typeof renderProfileView === "function") renderProfileView();
      }
    }
  };
}

export function renderAdminOrgManagement() {
  const regionSelect = document.getElementById("admin-org-region");
  const zoneSelect = document.getElementById("admin-org-zone");
  const groupSelect = document.getElementById("admin-org-group");

  if (!regionSelect || !zoneSelect || !groupSelect) return;

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

export function populateAdminZones() {
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

export function populateAdminGroups() {
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

export function showResponsibilityModal(role, user) {
  return new Promise((resolve) => {
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
          請勾選該成員所管轄的範圍（支援複選）。系統將依此授權管理權限。
        </p>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 0.8rem; max-height: 380px; overflow-y: auto; padding-right: 0.2rem;">
    `;
    
    if (role === "great_zone_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責大區 (可複選)</label>
          <div id="modal-regions-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
          </div>
        </div>
      `;
    } else if (role === "zone_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責牧區 (可複選)</label>
          <div id="modal-zones-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
          </div>
        </div>
      `;
    } else if (role === "group_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">負責小組 (可複選)</label>
          <div id="modal-groups-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
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
    
    setTimeout(() => {
      overlay.style.opacity = "1";
      container.style.transform = "translateY(0)";
    }, 10);
    
    const currentRegions = (user.managed_regions || user.great_region || "").split(",").map(s => s.trim()).filter(Boolean);
    const currentZones = (user.managed_zones || user.pastoral_zone || "").split(",").map(s => s.trim()).filter(Boolean);
    const currentGroups = (user.managed_groups || user.small_group || "").split(",").map(s => s.trim()).filter(Boolean);
    
    const regionContainer = overlay.querySelector("#modal-regions-container");
    const zoneContainer = overlay.querySelector("#modal-zones-container");
    const groupContainer = overlay.querySelector("#modal-groups-container");
    
    if (role === "great_zone_leader" && regionContainer) {
      let regions = [];
      if (state.isSupabaseMode && state.orgStructure.rawRegions) {
        regions = state.orgStructure.rawRegions;
      } else if (state.orgStructure.regions) {
        regions = state.orgStructure.regions.map(rName => ({ id: rName, name: rName }));
      }
      let html = "";
      regions.forEach(r => {
        const isChecked = currentRegions.includes(r.name) ? "checked" : "";
        html += `
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
            <input type="checkbox" name="region-checkbox" value="${r.id}" data-name="${r.name}" ${isChecked} style="cursor: pointer;">
            <span>${r.name}</span>
          </label>
        `;
      });
      regionContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">無大區資料</span>`;
    }
    
    if (role === "zone_leader" && zoneContainer) {
      let zones = [];
      if (state.isSupabaseMode && state.orgStructure.rawZones) {
        state.orgStructure.rawZones.forEach(z => {
          const region = state.orgStructure.rawRegions?.find(r => r.id === z.great_region_id);
          const regionSuffix = region ? ` (${region.name})` : "";
          zones.push({ id: z.id, name: z.name, label: `${z.name}${regionSuffix}` });
        });
      } else if (state.orgStructure.zones) {
        for (const [rName, zList] of Object.entries(state.orgStructure.zones)) {
          zList.forEach(zName => {
            zones.push({ id: zName, name: zName, label: `${zName} (${rName})` });
          });
        }
      }
      let html = "";
      zones.forEach(z => {
        const isChecked = currentZones.includes(z.name) ? "checked" : "";
        html += `
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
            <input type="checkbox" name="zone-checkbox" value="${z.id}" data-name="${z.name}" ${isChecked} style="cursor: pointer;">
            <span>${z.label}</span>
          </label>
        `;
      });
      zoneContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">無牧區資料</span>`;
    }
    
    if (role === "group_leader" && groupContainer) {
      let groups = [];
      if (state.isSupabaseMode && state.orgStructure.rawGroups) {
        state.orgStructure.rawGroups.forEach(g => {
          const zone = state.orgStructure.rawZones?.find(z => z.id === g.pastoral_zone_id);
          const zoneSuffix = zone ? ` (${zone.name})` : "";
          groups.push({ id: g.id, name: g.name, label: `${g.name}${zoneSuffix}` });
        });
      } else if (state.orgStructure.groups) {
        for (const [zName, gList] of Object.entries(state.orgStructure.groups)) {
          gList.forEach(gName => {
            groups.push({ id: gName, name: gName, label: `${gName} (${zName})` });
          });
        }
      }
      let html = "";
      groups.forEach(g => {
        const isChecked = currentGroups.includes(g.name) ? "checked" : "";
        html += `
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; padding: 0.15rem 0;">
            <input type="checkbox" name="group-checkbox" value="${g.id}" data-name="${g.name}" ${isChecked} style="cursor: pointer;">
            <span>${g.label}</span>
          </label>
        `;
      });
      groupContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">無小組資料</span>`;
    }
    
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
      if (role === "great_zone_leader") {
        const checkedRegions = Array.from(regionContainer.querySelectorAll("input[name='region-checkbox']:checked")).map(cb => cb.dataset.name);
        if (checkedRegions.length === 0) {
          alert("請至少選擇一個大區！");
          return;
        }
        closeModal({
          managed_regions: checkedRegions.join(","),
          managed_zones: "",
          managed_groups: ""
        });
      } else if (role === "zone_leader") {
        const checkedZones = Array.from(zoneContainer.querySelectorAll("input[name='zone-checkbox']:checked")).map(cb => cb.dataset.name);
        if (checkedZones.length === 0) {
          alert("請至少選擇一個牧區！");
          return;
        }
        closeModal({
          managed_regions: "",
          managed_zones: checkedZones.join(","),
          managed_groups: ""
        });
      } else if (role === "group_leader") {
        const checkedGroups = Array.from(groupContainer.querySelectorAll("input[name='group-checkbox']:checked")).map(cb => cb.dataset.name);
        if (checkedGroups.length === 0) {
          alert("請至少選擇一個小組！");
          return;
        }
        closeModal({
          managed_regions: "",
          managed_zones: "",
          managed_groups: checkedGroups.join(",")
        });
      }
    };
  });
}

export function init() {
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

  initAdminOrgManagement();
  initAdminFiltersUI();
}

// Bind to window for global access compatibility
window.renderAdminUserManagement = renderAdminUserManagement;
window.renderAdminOrgManagement = renderAdminOrgManagement;
window.initAdminFiltersUI = initAdminFiltersUI;
window.openAdminFilterBottomSheet = openAdminFilterBottomSheet;
window.closeAdminFilterBottomSheet = closeAdminFilterBottomSheet;
window.initAdminUserManagement = init;
