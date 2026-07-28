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

export function initAdminOrgManagement() {
  const exportBtn = document.getElementById("admin-export-org-btn");
  const fileInput = document.getElementById("admin-org-file-input");
  const fileNameDiv = document.getElementById("admin-org-file-name");
  const pasteInput = document.getElementById("admin-org-paste-input");
  const previewCard = document.getElementById("admin-org-preview-card");
  const cancelBtn = document.getElementById("admin-org-import-cancel");
  const confirmBtn = document.getElementById("admin-org-import-confirm");

  if (!exportBtn || !fileInput || !pasteInput || !previewCard || !cancelBtn || !confirmBtn) return;

  let pendingImportData = null;

  // 1. 下載範本
  exportBtn.onclick = () => {
    exportCurrentOrgCsv();
  };

  // 2. 解析處理器
  const handleParse = (text, sourceName) => {
    if (!text || !text.trim()) {
      showToast("請選擇或貼上有效的架構資料");
      return;
    }
    const parsed = parseOrgCsvData(text);
    if (parsed.length === 0) {
      showToast("無法解析出任何組織架構資料，請確認格式是否正確");
      return;
    }

    // 彙整為大區、牧區、小組
    const regions = [...new Set(parsed.map(item => item.region).filter(Boolean))];
    
    const zoneMap = new Map();
    parsed.forEach(item => {
      if (item.zone && item.region) {
        const key = `${item.zone}||${item.region}`;
        zoneMap.set(key, { name: item.zone, region_name: item.region });
      }
    });
    const zones = [...zoneMap.values()];

    const groupMap = new Map();
    parsed.forEach(item => {
      if (item.group && item.zone) {
        const key = `${item.group}||${item.zone}`;
        groupMap.set(key, { name: item.group, zone_name: item.zone });
      }
    });
    const groups = [...groupMap.values()];

    // 進行比對
    const comparison = compareOrgStructures(regions, zones, groups);
    
    // 更新 UI 預覽
    document.getElementById("preview-add-regions").textContent = comparison.add.regions;
    document.getElementById("preview-add-zones").textContent = comparison.add.zones;
    document.getElementById("preview-add-groups").textContent = comparison.add.groups;

    document.getElementById("preview-keep-regions").textContent = comparison.keep.regions;
    document.getElementById("preview-keep-zones").textContent = comparison.keep.zones;
    document.getElementById("preview-keep-groups").textContent = comparison.keep.groups;

    document.getElementById("preview-del-regions").textContent = comparison.del.regions;
    document.getElementById("preview-del-zones").textContent = comparison.del.zones;
    document.getElementById("preview-del-groups").textContent = comparison.del.groups;

    const delBadge = document.getElementById("preview-delete-badge");
    const totalDel = comparison.del.regions + comparison.del.zones + comparison.del.groups;
    if (totalDel > 0) {
      delBadge.style.display = "inline-flex";
    } else {
      delBadge.style.display = "none";
    }

    pendingImportData = { regions, zones, groups };
    previewCard.style.display = "flex";

    if (sourceName) {
      fileNameDiv.textContent = `已選擇檔案：${sourceName} (${parsed.length} 筆資料)`;
      fileNameDiv.style.display = "block";
    }
  };

  // 檔案選取事件
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      handleParse(evt.target.result, file.name);
      pasteInput.value = ""; // 清空文字框避免混淆
    };
    reader.readAsText(file, "UTF-8");
  };

  // 貼上文字框監聽
  pasteInput.oninput = () => {
    const val = pasteInput.value;
    if (val && val.trim()) {
      handleParse(val, null);
      fileInput.value = ""; // 清空檔案選擇器
      fileNameDiv.style.display = "none";
    } else {
      clearPending();
    }
  };

  // 取消匯入
  const clearPending = () => {
    pendingImportData = null;
    fileInput.value = "";
    pasteInput.value = "";
    fileNameDiv.style.display = "none";
    previewCard.style.display = "none";
  };
  cancelBtn.onclick = clearPending;

  // 確認執行更新
  confirmBtn.onclick = async () => {
    if (!pendingImportData) return;
    
    const confirmMsg = "警告：執行更新將會覆蓋全教會的組織架構，不在名單中的項目將被移除。確定要執行嗎？";
    const confirmed = await window.showConfirmDialog({
      title: "確認同步更新",
      message: confirmMsg,
      confirmText: "執行更新",
      cancelText: "取消",
      isDestructive: true
    });

    if (confirmed) {
      loader.show("正在執行同步更新，請稍候...");
      const result = await db.syncChurchOrganization(
        pendingImportData.regions,
        pendingImportData.zones,
        pendingImportData.groups
      );
      loader.hide();

      if (result && result.success) {
        showToast("組織架構同步更新成功！");
        clearPending();
        renderAdminOrgManagement();
        // 重新渲染個人設定選單與過濾器選項
        if (typeof renderProfileView === "function") renderProfileView();
      } else {
        alert("同步更新失敗：" + (result.error || "未知錯誤"));
      }
    }
  };
}

function parseOrgCsvData(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const result = [];
  
  lines.forEach((line, index) => {
    // 忽略第一列標頭
    if (index === 0 && (line.includes("大區") || line.toLowerCase().includes("region") || line.includes("牧區") || line.includes("小組"))) {
      return;
    }
    
    // 支援逗號或 Tab 鍵分隔
    const parts = line.split(/[,\t]/).map(p => p.trim());
    if (parts.length >= 1 && parts[0]) {
      const region = parts[0] || "";
      const zone = parts[1] || "";
      const group = parts[2] || "";
      result.push({ region, zone, group });
    }
  });
  
  return result;
}

function compareOrgStructures(regions, zones, groups) {
  const currentRegions = state.orgStructure.regions || [];
  
  let currentZones = [];
  if (state.orgStructure.rawZones) {
    currentZones = state.orgStructure.rawZones.map(z => {
      const parentReg = state.orgStructure.rawRegions.find(r => r.id === z.great_region_id);
      return { name: z.name, region_name: parentReg ? parentReg.name : "" };
    });
  } else if (state.orgStructure.zones) {
    Object.entries(state.orgStructure.zones).forEach(([rName, zNames]) => {
      zNames.forEach(zName => {
        currentZones.push({ name: zName, region_name: rName });
      });
    });
  }

  let currentGroups = [];
  if (state.orgStructure.rawGroups) {
    currentGroups = state.orgStructure.rawGroups.map(g => {
      const parentZone = state.orgStructure.rawZones.find(z => z.id === g.pastoral_zone_id);
      return { name: g.name, zone_name: parentZone ? parentZone.name : "" };
    });
  } else if (state.orgStructure.groups) {
    Object.entries(state.orgStructure.groups).forEach(([zName, gNames]) => {
      gNames.forEach(gName => {
        currentGroups.push({ name: gName, zone_name: zName });
      });
    });
  }

  // 大區比對
  const addRegions = regions.filter(r => !currentRegions.includes(r));
  const keepRegions = regions.filter(r => currentRegions.includes(r));
  const delRegions = currentRegions.filter(r => !regions.includes(r));

  // 牧區比對 (name + region_name)
  const addZones = zones.filter(z => !currentZones.some(cz => cz.name === z.name && cz.region_name === z.region_name));
  const keepZones = zones.filter(z => currentZones.some(cz => cz.name === z.name && cz.region_name === z.region_name));
  const delZones = currentZones.filter(cz => !zones.some(z => z.name === cz.name && z.region_name === cz.region_name));

  // 小組比對 (name + zone_name)
  const addGroups = groups.filter(g => !currentGroups.some(cg => cg.name === g.name && cg.zone_name === g.zone_name));
  const keepGroups = groups.filter(g => currentGroups.some(cg => cg.name === g.name && cg.zone_name === g.zone_name));
  const delGroups = currentGroups.filter(cg => !groups.some(g => g.name === cg.name && g.zone_name === cg.zone_name));

  return {
    add: { regions: addRegions.length, zones: addZones.length, groups: addGroups.length },
    keep: { regions: keepRegions.length, zones: keepZones.length, groups: keepGroups.length },
    del: { regions: delRegions.length, zones: delZones.length, groups: delGroups.length }
  };
}

function exportCurrentOrgCsv() {
  let rows = [["大區", "牧區", "小組"]];
  
  if (state.isSupabaseMode && state.orgStructure.rawRegions) {
    const regions = state.orgStructure.rawRegions || [];
    const zones = state.orgStructure.rawZones || [];
    const groups = state.orgStructure.rawGroups || [];
    
    if (groups.length > 0) {
      groups.forEach(g => {
        const zone = zones.find(z => z.id === g.pastoral_zone_id);
        const zoneName = zone ? zone.name : "";
        const region = zone ? regions.find(r => r.id === zone.great_region_id) : null;
        const regionName = region ? region.name : "";
        rows.push([regionName, zoneName, g.name]);
      });
      
      zones.forEach(z => {
        const hasGroups = groups.some(g => g.pastoral_zone_id === z.id);
        if (!hasGroups) {
          const region = regions.find(r => r.id === z.great_region_id);
          const regionName = region ? region.name : "";
          rows.push([regionName, z.name, ""]);
        }
      });
      
      regions.forEach(r => {
        const hasZones = zones.some(z => z.great_region_id === r.id);
        if (!hasZones) {
          rows.push([r.name, "", ""]);
        }
      });
    } else {
      if (zones.length > 0) {
        zones.forEach(z => {
          const region = regions.find(r => r.id === z.great_region_id);
          const regionName = region ? region.name : "";
          rows.push([regionName, z.name, ""]);
        });
        regions.forEach(r => {
          const hasZones = zones.some(z => z.great_region_id === r.id);
          if (!hasZones) {
            rows.push([r.name, "", ""]);
          }
        });
      } else {
        regions.forEach(r => {
          rows.push([r.name, "", ""]);
        });
      }
    }
  } else {
    const regions = state.orgStructure.regions || [];
    const zones = state.orgStructure.zones || {};
    const groups = state.orgStructure.groups || {};
    
    regions.forEach(r => {
      const rZones = zones[r] || [];
      if (rZones.length > 0) {
        rZones.forEach(z => {
          const zGroups = groups[z] || [];
          if (zGroups.length > 0) {
            zGroups.forEach(g => {
              rows.push([r, z, g]);
            });
          } else {
            rows.push([r, z, ""]);
          }
        });
      } else {
        rows.push([r, "", ""]);
      }
    });
  }
  
  const csvContent = "\uFEFF" + rows.map(r => r.map(cell => {
    const text = String(cell || "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }).join(",")).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `church_organization_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function renderAdminOrgManagement() {
  const statRegions = document.getElementById("admin-stat-regions");
  const statZones = document.getElementById("admin-stat-zones");
  const statGroups = document.getElementById("admin-stat-groups");

  if (!statRegions || !statZones || !statGroups) return;

  const regionsCount = state.orgStructure.regions ? state.orgStructure.regions.length : 0;
  
  let zonesCount = 0;
  if (state.orgStructure.rawZones) {
    zonesCount = state.orgStructure.rawZones.length;
  } else if (state.orgStructure.zones) {
    zonesCount = Object.values(state.orgStructure.zones).flat().length;
  }

  let groupsCount = 0;
  if (state.orgStructure.rawGroups) {
    groupsCount = state.orgStructure.rawGroups.length;
  } else if (state.orgStructure.groups) {
    groupsCount = Object.values(state.orgStructure.groups).flat().length;
  }

  statRegions.textContent = regionsCount;
  statZones.textContent = zonesCount;
  statGroups.textContent = groupsCount;
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

  initAdminOrgManagement();
  initAdminFiltersUI();
}

// Bind to window for global access compatibility
window.renderAdminUserManagement = renderAdminUserManagement;
window.renderAdminOrgManagement = renderAdminOrgManagement;
window.initAdminFiltersUI = initAdminFiltersUI;
window.renderAdminFeatureSettings = renderAdminFeatureSettings;
window.openAdminFilterBottomSheet = openAdminFilterBottomSheet;
window.closeAdminFilterBottomSheet = closeAdminFilterBottomSheet;
window.initAdminUserManagement = init;
