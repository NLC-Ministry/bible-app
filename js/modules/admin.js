// js/modules/admin.js

export function updateFilterChipsUI() {
  const chipRegion = document.getElementById("chip-filter-region");
  const chipZone = document.getElementById("chip-filter-zone");
  const chipGroup = document.getElementById("chip-filter-group");

  if (chipRegion) {
    if (state.adminFilters.region) {
      chipRegion.classList.add("active");
      chipRegion.innerHTML = `<span>${state.adminFilters.region}</span> <span class="chip-clear" data-clear="region">清除</span>`;
    } else {
      chipRegion.classList.remove("active");
      chipRegion.innerHTML = `<span>篩選大區</span> <span class="chip-arrow">展開</span>`;
    }
  }

  if (chipZone) {
    if (state.adminFilters.zone) {
      chipZone.classList.add("active");
      chipZone.innerHTML = `<span>${state.adminFilters.zone}</span> <span class="chip-clear" data-clear="zone">清除</span>`;
    } else {
      chipZone.classList.remove("active");
      chipZone.innerHTML = `<span>篩選牧區</span> <span class="chip-arrow">展開</span>`;
    }
  }

  if (chipGroup) {
    if (state.adminFilters.group) {
      chipGroup.classList.add("active");
      chipGroup.innerHTML = `<span>${state.adminFilters.group}</span> <span class="chip-clear" data-clear="group">清除</span>`;
    } else {
      chipGroup.classList.remove("active");
      chipGroup.innerHTML = `<span>篩選小組</span> <span class="chip-arrow">展開</span>`;
    }
  }
}

export function openAdminFilterBottomSheet(type) {
  const overlay = document.getElementById("global-bottom-sheet");
  const titleEl = document.getElementById("bottom-sheet-title");
  const listEl = document.getElementById("bottom-sheet-list");
  if (!overlay || !listEl) return;

  let title = "請選擇篩選條件";
  let options = [];
  let selectedValue = state.adminFilters[type];

  const getPredefinedRegions = () => {
    return (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0)
      ? state.orgStructure.regions
      : ["第一大區", "第二大區", "第三大區", "第四大區", "第五大區", "第六大區", "第七大區"];
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
    console.log(`管理 [Debug] Bottom Sheet 選擇清除條件: ${type}`);
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
      console.log(`管理 [Debug] Bottom Sheet 選擇條件: ${type} = ${opt}`);
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
  console.log("管理 [Debug] 關閉篩選 Bottom Sheet");
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
          console.log(`管理 [Debug] 清除篩選條件: ${type}`);
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
          console.log(`管理 [Debug] 點擊篩選按鈕開啟 Bottom Sheet: ${type}`);
          openAdminFilterBottomSheet(type);
        }
      };
    }
  });

  const closeBtn = document.getElementById("btn-close-bottom-sheet");
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      console.log("管理 [Debug] 點擊關閉按鈕關閉 Bottom Sheet");
      e.preventDefault();
      closeAdminFilterBottomSheet();
    };
  }

  const overlay = document.getElementById("global-bottom-sheet");
  if (overlay) {
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        console.log("管理 [Debug] 點擊背景關閉 Bottom Sheet");
        e.preventDefault();
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
    
    const roleOrder = { admin: 1, great_zone_leader: 2, zone_leader: 3, group_leader: 4, member: 5 };
    const sortedUsers = [...users].sort((a, b) => {
      if (a.name === state.currentUser.name) return -1;
      if (b.name === state.currentUser.name) return 1;
      return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
    });

    const filteredUsers = sortedUsers.filter(u => {
      const matchName = u.name.toLowerCase().includes(query);
      const matchEmail = u.email ? u.email.toLowerCase().includes(query) : false;
      const matchRegion = !state.adminFilters.region || u.great_region === state.adminFilters.region;
      const matchZone = !state.adminFilters.zone || u.pastoral_zone === state.adminFilters.zone;
      const matchGroup = !state.adminFilters.group || u.small_group === state.adminFilters.group;
      return (matchName || matchEmail) && matchRegion && matchZone && matchGroup;
    });

    listContainer.innerHTML = "";

    if (filteredUsers.length === 0) {
      listContainer.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">無符合搜尋條件的成員</div>`;
      return;
    }

    const roleLabels = {
      member: "一般會友",
      group_leader: "小組長",
      zone_leader: "牧區長",
      great_zone_leader: "大區長",
      admin: "系統管理員"
    };

    filteredUsers.forEach(user => {
      const roleLabel = roleLabels[user.role] || user.role;
      
      const item = document.createElement("div");
      item.className = "member-list-item";
      
      item.innerHTML = `
        <div class="member-info-left">
          <div class="member-name-row">
            <span class="member-name-text">${escapeHTML(user.name)}</span>
            <span class="role-badge-pill">${escapeHTML(roleLabel)}</span>
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
        openMemberEditBottomSheet(user);
      };

      listContainer.appendChild(item);
    });

  } catch (err) {
    console.error("Failed to render admin user management:", err);
    listContainer.innerHTML = `<div class="text-danger" style="text-align: center; padding: 2.5rem;">渲染名單失敗: ${err.message || err}</div>`;
  }
}

export function openMemberEditBottomSheet(user) {
  const overlay = document.getElementById("global-bottom-sheet");
  const titleEl = document.getElementById("bottom-sheet-title");
  const listEl = document.getElementById("bottom-sheet-list");
  if (!overlay || !listEl) return;

  if (titleEl) titleEl.textContent = `變更 ${user.name} 的權限階級`;
  listEl.innerHTML = "";

  const roleOptions = [
    { value: "member", label: "一般會友" },
    { value: "group_leader", label: "小組長" },
    { value: "zone_leader", label: "牧區長" },
    { value: "great_zone_leader", label: "大區長" },
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

    scopeBtn.innerHTML = iconLabel("edit", `修改管理範圍 (${scopeDesc})`);
    scopeBtn.onclick = async () => {
            console.log(`管理 [Debug] 點擊修改管理範圍按鈕: ${user.name}`);
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
                alert("管理範圍修改成功");
        renderAdminUserManagement();
      } else {
                alert("伺服器連線失敗，請稍後再試或聯絡管理員");
      }
    };
    listEl.appendChild(scopeBtn);
  }

  const headerText = document.createElement("div");
  headerText.style.fontSize = "0.75rem";
  headerText.style.color = "var(--text-secondary)";
  headerText.style.margin = "0.2rem 0 0.5rem 0.2rem";
  headerText.style.fontWeight = "bold";
    headerText.textContent = "請選擇變更的權限階級";
  listEl.appendChild(headerText);

  roleOptions.forEach(opt => {
    const btn = document.createElement("button");
    const isSelected = user.role === opt.value;
    btn.className = `bottom-sheet-item ${isSelected ? "selected" : ""}`;
    btn.type = "button";
    btn.textContent = opt.label;
    btn.onclick = async () => {
            console.log(`管理 [Debug] 點擊變更權限階級: ${user.name} -> ${opt.label}`);
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
                alert("權限變更成功");
        renderAdminUserManagement();
      } else {
                alert("權限變更失敗，請重新整理頁面");
      }
    };
    listEl.appendChild(btn);
  });

  overlay.classList.add("active");
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
    else if (role === "zone_leader") roleText = "牧區長";
    else if (role === "group_leader") roleText = "小組長";
    
    let htmlContent = `
      <div style="margin-bottom: 0.2rem;">
        <h3 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem; font-weight: 500; color: var(--text-primary);">
          變更 ${roleText} 的管轄範圍
        </h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0; line-height: 1.4;">
          請在下方列表勾選此成員負責管轄的對象，完成後點擊下方按鈕以儲存。
        </p>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 0.8rem; max-height: 380px; overflow-y: auto; padding-right: 0.2rem;">
    `;
    
    if (role === "great_zone_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">勾選管轄大區 (可多選)</label>
          <div id="modal-regions-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
          </div>
        </div>
      `;
    } else if (role === "zone_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">勾選管轄牧區 (可多選)</label>
          <div id="modal-zones-container" style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 6px; padding: 0.6rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;">
          </div>
        </div>
      `;
    } else if (role === "group_leader") {
      htmlContent += `
        <div class="form-group" style="margin-bottom: 0;">
          <label style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.3rem;">勾選管轄小組 (可多選)</label>
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
            regionContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">暫無資料</span>`;
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
            zoneContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">暫無資料</span>`;
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
            groupContainer.innerHTML = html || `<span style="font-size: 0.8rem; color: var(--text-muted);">暫無資料</span>`;
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
                    alert("請選擇至少一個管轄大區！");
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
                    alert("請選擇至少一個管轄牧區！");
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
                    alert("請選擇至少一個管轄小組！");
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
function updatePastoralWallControl(enabled, options = {}) {
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const status = document.getElementById("admin-pastoral-wall-status");
  if (!toggle || !status) return;
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggle.setAttribute("aria-label", enabled ? "牧區分享牆功能已開啟" : "牧區分享牆功能已關閉");
  toggle.disabled = options.disabled === true;
  status.textContent = enabled ? "已開啟：所有堂會成員皆可在首頁看見「牧區分享牆」，進行靈修分享與互動。" : "已關閉：首頁將隱藏「牧區分享牆」，僅保留個人靈修進度紀錄與團隊功能。";
}

export async function renderAdminFeatureSettings() {
  const card = document.querySelector(".admin-feature-settings-card")?.closest(".card-col");
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const feedback = document.getElementById("admin-pastoral-wall-feedback");
  if (!card || !toggle || !feedback) return;

  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  card.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  feedback.classList.add("hidden");
  feedback.textContent = "";
  updatePastoralWallControl(false, { disabled: true });

  const result = await db.getFeatureSetting("pastoral_sharing_wall", false);
  if (result.error) {
    updatePastoralWallControl(false, { disabled: true });
    feedback.textContent = "無法載入設定：從伺服器獲取牧區分享牆設定失敗。";
    feedback.classList.remove("hidden");
    return;
  }

  updatePastoralWallControl(result.enabled === true);

  if (!toggle.dataset.featureSettingBound) {
    toggle.dataset.featureSettingBound = "true";
    toggle.addEventListener("click", async () => {
      const currentEnabled = toggle.getAttribute("aria-checked") === "true";
      const nextEnabled = !currentEnabled;
      updatePastoralWallControl(currentEnabled, { disabled: true });
      feedback.classList.add("hidden");

      const saveResult = await db.updateFeatureSetting("pastoral_sharing_wall", nextEnabled);
      if (saveResult.error) {
        updatePastoralWallControl(currentEnabled);
        feedback.textContent = "更新設定失敗：無法將設定儲存至伺服器。";
        feedback.classList.remove("hidden");
        return;
      }

      updatePastoralWallControl(nextEnabled);
      if (typeof showToast === "function") {
        showToast(nextEnabled ? "牧區分享牆功能已開啟！" : "牧區分享牆功能已關閉。");
      }
      window.dispatchEvent(new CustomEvent("pastoral-sharing-wall-changed", {
        detail: { enabled: nextEnabled }
      }));
    });
  }

  if (typeof hydrateIcons === "function") hydrateIcons(card);
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

  initAdminFiltersUI();
  initAdminTeamRegistration();
}

// Bind to window for global access compatibility
window.renderAdminUserManagement = renderAdminUserManagement;
window.initAdminFiltersUI = initAdminFiltersUI;
window.renderAdminFeatureSettings = renderAdminFeatureSettings;
window.openAdminFilterBottomSheet = openAdminFilterBottomSheet;
window.closeAdminFilterBottomSheet = closeAdminFilterBottomSheet;
window.initAdminUserManagement = init;

let activeTeamDivision = 3;
let cachedTeamsData = null;

export async function renderAdminTeamRegistrationStatus(forceRefresh = false) {
  const contentEl = document.getElementById("admin-team-status-content");
  if (!contentEl) return;

  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const cardWrap = document.getElementById("admin-team-status-card-wrap");
  if (cardWrap) {
    cardWrap.classList.toggle("hidden", !isAdmin);
  }
  if (!isAdmin) return;

  if (!cachedTeamsData || forceRefresh) {
    contentEl.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        讀取團隊報名資料中...
      </div>
    `;

    const result = await db.getReadingTeamRegistrationOverview();
    if (!result || !result.success) {
      const message = escapeHTML(result && result.message ? result.message : "團隊報名資料讀取失敗，請稍後再試。");
      contentEl.innerHTML = `
        <div class="admin-team-status-empty" role="status" style="padding:2rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center; color:var(--text-secondary);">
          <strong>目前無法載入團隊報名資料</strong>
          <span>${message}</span>
          <button type="button" class="secondary-btn" id="admin-team-status-retry">重新整理</button>
        </div>
      `;
      const retryButton = document.getElementById("admin-team-status-retry");
      if (retryButton) retryButton.onclick = () => renderAdminTeamRegistrationStatus(true);
      return;
    }
    cachedTeamsData = result.context || { summary: {}, plans: [] };
  }

  const overviewPlans = Array.isArray(cachedTeamsData.plans) ? cachedTeamsData.plans : [];
  const processedPlans = overviewPlans.map(item => {
    const allTeams = Array.isArray(item.teams) ? item.teams : [];
    const teams = allTeams.filter(team => Number(team.division) === Number(activeTeamDivision));
    return {
      ...item,
      plan: item,
      teams
    };
  });

  if (processedPlans.length === 0) {
    contentEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        目前尚無任何計畫的團隊報名資料。
      </div>
    `;
    return;
  }

  const formatPlanDate = value => {
    if (!value) return "";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  };

  let html = "";
  processedPlans.forEach(item => {
    const planName = escapeHTML(item.plan.name || "未命名計畫");
    const planStart = formatPlanDate(item.plan.startDate);
    const planEnd = formatPlanDate(item.plan.endDate);
    const planPeriod = planStart && planEnd ? `${planStart}－${planEnd}` : "";
    const signupCount = item.teams.filter(team => team.status === "forming").length;
    const readyCount = item.teams.filter(t => t.status === "ready").length;
    const totalMembers = item.teams.reduce((acc, t) => acc + (t.memberCount || 0), 0);

    html += `
      <div class="team-plan-section" style="margin-bottom: 2rem;">
        <h4 style="margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
          <span class="nlc-icon nlc-icon--sm" data-icon="layers" aria-hidden="true" style="color: var(--primary-color);"></span>
          計畫：${planName}
        </h4>
        ${planPeriod ? `<p style="margin: 0 0 0.65rem; color: var(--text-muted); font-size: 0.75rem;">計畫期間：${planPeriod}</p>` : ""}
        <div style="display: flex; gap: 1rem; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
          <span>招募中：<strong style="color: var(--primary-color);">${signupCount}</strong> 隊</span>
          <span>已成隊：<strong style="color: var(--color-success-foreground);">${readyCount}</strong> 隊</span>
          <span>總報名人數：<strong>${totalMembers}</strong> 人</span>
        </div>
    `;

    if (item.teams.length === 0) {
      html += `
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; background: var(--bg-input); border-radius: 8px; border: 1px dashed var(--border-card);">
          此計畫目前無 ${activeTeamDivision} 人團隊的報名資料。
        </div>
      </div>
      `;
    } else {
      html += `
        <div style="overflow-x: auto; background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border-card);">
          <table class="w-full" style="border-collapse: collapse; text-align: left; font-size: 0.8rem; min-width: 600px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-card); background: rgba(255,255,255,0.02);">
                ${Number(activeTeamDivision) === 3 ? `
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長所屬牧區</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊名</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員1 (隊長)</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員2</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員3</th>
                ` : `
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長所屬牧區</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊名</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員1 (隊長)</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員2</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員3</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員4</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員5</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員6</th>
                `}
              </tr>
            </thead>
            <tbody>
      `;

      item.teams.forEach(team => {
        const members = Array.isArray(team.members) ? team.members : [];
        const captain = members.find(member => member.role === "captain") || {};
        const captainZone = escapeHTML(team.captainPastoralZone || captain.pastoralZone || "未設定");
        const otherMembers = members.filter(member => member.role !== "captain");
        const teamName = escapeHTML(team.name || "未命名隊伍");
        const captainName = captain.name ? `${escapeHTML(captain.name)}（隊長）` : "-";
        const teamStatus = team.status === "ready" ? "已成隊" : "招募中";
        const memberCount = Number(team.memberCount || members.length || 0);

        let membersCells = "";
        for (let i = 0; i < Number(activeTeamDivision) - 1; i++) {
          const m = otherMembers[i];
          const memberName = m && m.name ? escapeHTML(m.name) : "-";
          const memberZone = m && m.pastoralZone ? `<small style="display:block; margin-top:0.2rem; color:var(--text-muted);">${escapeHTML(m.pastoralZone)}</small>` : "";
          membersCells += `<td style="padding: 0.75rem 0.8rem; color: var(--text-secondary);">${memberName}${memberZone}</td>`;
        }

        html += `
          <tr style="border-bottom: 1px solid var(--border-card); transition: background-color 0.2s;">
            <td style="padding: 0.75rem 0.8rem; font-weight: 500; color: var(--text-primary);">${captainZone}</td>
            <td style="padding: 0.75rem 0.8rem; font-weight: 500; color: var(--text-primary);">
              ${teamName}
              <small style="display:block; margin-top:0.2rem; color:var(--text-muted); font-weight:400;">${teamStatus} · ${memberCount}/${activeTeamDivision} 人</small>
            </td>
            <td style="padding: 0.75rem 0.8rem; color: var(--text-primary);">${captainName}</td>
            ${membersCells}
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </div>
      </div>
      `;
    }
  });

  contentEl.innerHTML = html;
  
  if (typeof hydrateIcons === "function") {
    hydrateIcons(contentEl);
  }
}

export function initAdminTeamRegistration() {
  const tab3 = document.getElementById("admin-team-tab-3");
  const tab6 = document.getElementById("admin-team-tab-6");
  const toggle = document.getElementById("admin-team-status-toggle");
  const panel = document.getElementById("admin-team-status-panel");
  const toggleLabel = document.getElementById("admin-team-status-toggle-label");
  const toggleIcon = document.getElementById("admin-team-status-toggle-icon");

  if (toggle && panel && !toggle.dataset.bound) {
    toggle.dataset.bound = "true";
    toggle.onclick = () => {
      const willExpand = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(willExpand));
      panel.hidden = !willExpand;
      if (toggleLabel) toggleLabel.textContent = willExpand ? "收起" : "展開";
      if (toggleIcon) toggleIcon.style.transform = willExpand ? "rotate(180deg)" : "rotate(0deg)";
    };
  }

  if (tab3 && tab6) {
    tab3.onclick = (e) => {
      e.preventDefault();
      if (activeTeamDivision === 3) return;
      activeTeamDivision = 3;
      tab3.classList.add("active");
      tab6.classList.remove("active");
      renderAdminTeamRegistrationStatus();
    };

    tab6.onclick = (e) => {
      e.preventDefault();
      if (activeTeamDivision === 6) return;
      activeTeamDivision = 6;
      tab6.classList.add("active");
      tab3.classList.remove("active");
      renderAdminTeamRegistrationStatus();
    };
  }
}

window.renderAdminTeamRegistrationStatus = renderAdminTeamRegistrationStatus;
window.initAdminTeamRegistration = initAdminTeamRegistration;
