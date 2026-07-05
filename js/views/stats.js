// Statistics & charts tab view controller


async function updateStatsView(filterPresetKey = null) {
  // If no filter is provided, fallback to the current active plan's global key.
  if (!filterPresetKey && state.activePlan) {
    filterPresetKey = state.activePlan.globalPlanId || state.activePlan.presetKey || state.activePlan.name || state.activePlan.id;
  }
  window.currentStatsFilterPresetKey = filterPresetKey;

  const statsTableBody = document.getElementById("stats-members-table-body");
  const statsValueIds = ["stats-total-read", "stats-total-members", "stats-active-members"];
  if (typeof ComponentSkeletonLoader !== "undefined") {
    if (statsTableBody) ComponentSkeletonLoader.fill("table-rows", statsTableBody, { count: 5, cols: 6 });
    statsValueIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.dataset.statsOriginalHtml = el.innerHTML;
        el.innerHTML = ComponentSkeletonLoader.getHtml("inline", { width: "3.5rem", height: "1.1rem" });
      }
    });
  }
  
  let pastoralStats = [];
  let rawAllUsers = [];

  // Pass filterPresetKey to fetchMergedUsersList so stats are plan-specific!
  const unfilteredAllUsers = await db.fetchMergedUsersList(filterPresetKey);
  window.unfilteredAllUsersCache = unfilteredAllUsers;

  const mockUser = unfilteredAllUsers.find(u => u.name === state.currentUser.name) || {
    name: state.currentUser.name,
    great_region: state.currentUser.great_region || "東區",
    pastoral_zone: state.currentUser.pastoral_zone || "大安1",
    small_group: state.currentUser.small_group || "馬鈴",
    role: state.currentUser.role || "member",
    chapters_read: 0,
    plan_progress: 0,
    last_read: null
  };
  window.mockUserCache = mockUser;
  rawAllUsers = [...unfilteredAllUsers];

  const role = mockUser.role;

  // Dynamically calculate pastoralStats in frontend from the filtered users list!
  const zoneMap = {};
  unfilteredAllUsers.forEach(u => {
    const zone = u.pastoral_zone || "未知";
    const region = u.great_region || "未知";
    if (!zoneMap[zone]) {
      zoneMap[zone] = {
        name: zone,
        great_region: region,
        member_count: 0,
        total_chapters: 0,
        total_progress: 0,
        active_count: 0
      };
    }
    zoneMap[zone].member_count++;
    zoneMap[zone].total_chapters += u.chapters_read || 0;
    zoneMap[zone].total_progress += u.plan_progress || 0;
    if (u.chapters_read > 0) {
      zoneMap[zone].active_count++;
    }
  });

  pastoralStats = Object.values(zoneMap).map(item => ({
    name: item.name,
    great_region: item.great_region,
    member_count: item.member_count,
    total_chapters: item.total_chapters,
    avg_progress: Math.round(item.total_progress / item.member_count) || 0,
    active_count: item.active_count
  })).sort((a, b) => b.total_chapters - a.total_chapters);

  rawAllUsers = getScopedUsers(rawAllUsers, mockUser);

  // Filter pastoralStats based on Great Region for non-admin roles
  if (role !== "admin" && role !== "senior_pastor") {
    pastoralStats = pastoralStats.filter(z => z.great_region === mockUser.great_region);
  }

  // 1. Determine Stats Scoped Users
  let statsUsers = [];
  if (role === "senior_pastor" || role === "admin") {
    const zoneSelectGroup = document.getElementById("stats-zone-selector");
    const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
    if (selectedZone) {
      statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === selectedZone);
    } else {
      statsUsers = unfilteredAllUsers;
    }
  } else if (role === "great_zone_leader") {
    statsUsers = unfilteredAllUsers.filter(u => u.great_region === mockUser.great_region);
  } else if (role === "zone_leader") {
    statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone);
  } else { // group_leader or member
    statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone && u.small_group === mockUser.small_group);
  }

  if (statsUsers.length === 0) {
    statsUsers = [mockUser];
  }

  // 2. Update Mini Card Labels based on Scoped Team
  const miniCardLabels = document.querySelectorAll('.stats-overview-row .label');
  if (miniCardLabels.length === 3) {
    if (role === "senior_pastor" || role === "admin") {
      const zoneSelectGroup = document.getElementById("stats-zone-selector");
      const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
      miniCardLabels[0].textContent = selectedZone ? `${selectedZone} 總閱讀章數` : "全教會總閱讀章數";
      miniCardLabels[1].textContent = selectedZone ? `${selectedZone} 參與人數` : "全教會參與人數";
      miniCardLabels[2].textContent = selectedZone ? `${selectedZone} 本週活躍人數` : "全教會本週活躍人數";
    } else if (role === "great_zone_leader") {
      miniCardLabels[0].textContent = "本大區總閱讀章數";
      miniCardLabels[1].textContent = "本大區參與人數";
      miniCardLabels[2].textContent = "本大區本週活躍人數";
    } else if (role === "zone_leader") {
      miniCardLabels[0].textContent = "本牧區總閱讀章數";
      miniCardLabels[1].textContent = "本牧區參與人數";
      miniCardLabels[2].textContent = "本牧區本週活躍人數";
    } else { // group_leader or member
      miniCardLabels[0].textContent = "本小組總閱讀章數";
      miniCardLabels[1].textContent = "本小組參與人數";
      miniCardLabels[2].textContent = "本小組本週活躍人數";
    }
  }

  // 3. Render Mini Card values
  const totalChaptersAll = statsUsers.reduce((sum, item) => sum + (item.chapters_read || 0), 0);
  const totalMembers = statsUsers.length;
  const totalActive = statsUsers.filter(u => {
    if (!u.last_read) return false;
    const lastReadDate = new Date(u.last_read);
    const today = new Date();
    const diffTime = Math.abs(today - lastReadDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 2;
  }).length;

  document.getElementById("stats-total-read").textContent = totalChaptersAll + " 章";
  document.getElementById("stats-total-members").textContent = totalMembers + " 人";
  document.getElementById("stats-active-members").textContent = totalActive + " 人";

  // 3. Render Roster Details Table
  renderRosterTable(rawAllUsers);

  // 4. Handle Chart visibility and rendering
  const chartsContainer = document.getElementById("pastoral-rank-chart").closest('.grid-layout');
  const groupChartContainer = document.getElementById("group-stats-chart").closest('.grid-layout');
  const zoneSelectGroup = document.getElementById("stats-zone-selector");

  // Show both charts to everyone, but apply filters/locks by role
  chartsContainer.classList.remove("hidden");
  groupChartContainer.classList.remove("hidden");

  if (role === "member" || role === "group_leader" || role === "zone_leader") {
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;
    
    renderCharts(pastoralStats);
    updateGroupChart(mockUser.pastoral_zone);
  } else {
    zoneSelectGroup.disabled = false;
    
    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  }

  // Render Monthly Hall of Fame
  renderMonthlyHallOfFame();

  // Render Heatmap and Badges Wall
  renderHeatmap(statsUsers);
  if (typeof renderUnlockedBadgesWall !== 'undefined') {
    renderUnlockedBadgesWall();
  }

  // Render Team Progress Status & Growth Trend Dashboard
  renderTeamStatsAnalysisDashboard(unfilteredAllUsers, mockUser);

  if (typeof ComponentSkeletonLoader !== "undefined") {
    statsValueIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.dataset.statsOriginalHtml !== undefined) {
        delete el.dataset.statsOriginalHtml;
      }
    });
  }
}

function renderRosterTable(users) {
  const tbody = document.getElementById("stats-members-table-body");
  tbody.innerHTML = "";

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">尚無使用者資料</td></tr>`;
    return;
  }

  // Sort by chapters read descending
  const sorted = [...users].sort((a, b) => b.chapters_read - a.chapters_read);
  sorted.forEach(user => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHTML(user.name)}</strong></td>
      <td>${escapeHTML(user.pastoral_zone || "無")}</td>
      <td>${escapeHTML(user.small_group || "無")}</td>
      <td><span style="font-weight: 500; color: var(--primary-color);">${user.chapters_read}</span> 章</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.8rem; font-weight: 500;">${user.plan_progress}%</span>
          <div style="flex:1; width:50px; height:6px; background:#e2e8f0; border-radius:5px; overflow:hidden;">
            <div style="width:${user.plan_progress}%; height:100%; background: var(--color-success);"></div>
          </div>
        </div>
      </td>
      <td>🔥 ${user.streak || 0} 天</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateStatsZoneSelector(zones) {
  const selector = document.getElementById("stats-zone-selector");
  selector.innerHTML = "";

  zones.forEach(zone => {
    const option = document.createElement("option");
    option.value = zone.name;
    option.textContent = zone.name;
    selector.appendChild(option);
  });

  selector.onchange = () => {
    updateGroupChart(selector.value);
    if (typeof renderTeamStatsAnalysisDashboard === 'function') {
      renderTeamStatsAnalysisDashboard(window.unfilteredAllUsersCache, window.mockUserCache);
    }
  };

  if (zones.length > 0) {
    updateGroupChart(zones[0].name);
  }
}

function renderCharts(zoneStats) {
  const ctxRank = document.getElementById("pastoral-rank-chart").getContext("2d");
  const ctxProgress = document.getElementById("pastoral-progress-chart").getContext("2d");

  if (state.statsCharts.rank) state.statsCharts.rank.destroy();
  if (state.statsCharts.progress) state.statsCharts.progress.destroy();

  const labels = zoneStats.map(z => z.name);
  const chaptersData = zoneStats.map(z => z.total_chapters);
  const progressData = zoneStats.map(z => z.avg_progress);

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  // Chart 1: Ranking Chart
  state.statsCharts.rank = new Chart(ctxRank, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計速讀章數',
        data: chaptersData,
        backgroundColor: [
          'rgba(4, 169, 210, 0.85)',
          'color-mix(in srgb, var(--color-success) 85%, transparent)',
          'rgba(245, 158, 11, 0.85)',
          'rgba(239, 68, 68, 0.85)'
        ],
        borderRadius: 8,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor }, grid: { color: gridColor } }
      }
    }
  });

  // Chart 2: Average Progress Chart
  state.statsCharts.progress = new Chart(ctxProgress, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: '平均進度 (%)',
        data: progressData,
        backgroundColor: 'rgba(4, 169, 210, 0.2)',
        borderColor: 'rgba(4, 169, 210, 0.9)',
        borderWidth: 2,
        pointBackgroundColor: '#04A9D2'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        r: {
          angleLines: { color: gridColor },
          grid: { color: gridColor },
          pointLabels: { color: fontColor, font: { weight: 'bold' } },
          ticks: { backdropColor: 'transparent', color: fontColor, min: 0, max: 100 }
        }
      }
    }
  });
}

async function updateGroupChart(zoneName) {
  const ctxGroup = document.getElementById("group-stats-chart").getContext("2d");
  if (state.statsCharts.group) state.statsCharts.group.destroy();

  let groupStats = [];
  const mockUser = {
    name: state.currentUser.name,
    pastoral_zone: state.currentUser.pastoral_zone || "大安1",
    small_group: state.currentUser.small_group || "馬鈴",
    chapters_read: state.currentUser.chapters_read,
    plan_progress: state.currentUser.plan_progress,
    last_read: state.currentUser.last_read
  };

  if (state.isSupabaseMode && state.supabase) {
    try {
      const { data } = await state.supabase
        .from("view_small_group_stats")
        .select("*")
        .eq("pastoral_zone", zoneName);

      if (data) {
        groupStats = data.map(item => ({
          name: item.small_group,
          total_chapters: item.total_chapters_read
        })).sort((a, b) => b.total_chapters - a.total_chapters);
      }
    } catch (e) {
      console.error("Failed to load small group stats from Supabase:", e);
    }
  } else {
    // Demo Mode
    groupStats = MockStatsService.getSmallGroupStats(zoneName, mockUser);
  }

  const labels = groupStats.map(g => g.name);
  const data = groupStats.map(g => g.total_chapters);

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  state.statsCharts.group = new Chart(ctxGroup, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計章數',
        data: data,
        backgroundColor: 'color-mix(in srgb, var(--color-success) 80%, transparent)',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { color: gridColor } },
        y: { ticks: { color: fontColor }, grid: { display: false } }
      }
    }
  });
}

function renderMonthlyHallOfFame() {
  const fameList = document.getElementById("monthly-fame-list");
  if (!fameList) return;
  
  fameList.innerHTML = "";
  
  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);
  if (!showDemoData) {
    const placeholder = document.createElement("div");
    placeholder.style.cssText = "grid-column: span 3; text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.9rem;";
    placeholder.textContent = "正式計畫尚未結算，月度名人堂虛位以待！";
    fameList.appendChild(placeholder);
    return;
  }
  
  const winners = [
    {
      month: "2026年6月 (本月累計)",
      top3: [
        { rank: "gold", name: "示範組長丁", zone: "大安6", chapters: 980 },
        { rank: "silver", name: "示範組長戊", zone: "中永和", chapters: 800 },
        { rank: "bronze", name: "東區大區長", zone: "大安1", chapters: 750 }
      ]
    },
    {
      month: "2026年5月 (結算前三)",
      top3: [
        { rank: "gold", name: "示範組長乙", zone: "大安2", chapters: 650 },
        { rank: "silver", name: "示範組員八", zone: "文山", chapters: 620 },
        { rank: "bronze", name: "東區區長", zone: "大安1", chapters: 600 }
      ]
    },
    {
      month: "2026年4月 (結算前三)",
      top3: [
        { rank: "gold", name: "示範組員五", zone: "大安6", chapters: 540 },
        { rank: "silver", name: "示範組員二", zone: "大安1", chapters: 520 },
        { rank: "bronze", name: "示範組長甲", zone: "大安1", chapters: 480 }
      ]
    }
  ];
  
  winners.forEach(w => {
    const item = document.createElement("div");
    item.className = "monthly-fame-item";
    
    const title = document.createElement("div");
    title.className = "monthly-fame-month";
    title.textContent = w.month;
    item.appendChild(title);
    
    w.top3.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "fame-row";
      
      const rankSpan = document.createElement("span");
      rankSpan.className = `fame-rank ${t.rank}`;
      rankSpan.textContent = i + 1;
      row.appendChild(rankSpan);
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "fame-name";
      nameSpan.textContent = `${t.name} (${t.zone})`;
      row.appendChild(nameSpan);
      
      const valSpan = document.createElement("span");
      valSpan.className = "fame-value";
      valSpan.textContent = `${t.chapters} 章`;
      row.appendChild(valSpan);
      
      item.appendChild(row);
    });
    
    fameList.appendChild(item);
  });
}

// ==========================================
// TEAM BIBLE READING HEATMAP
// ==========================================

function getTeamLogs(teamUsers) {
  const filterPresetKey = window.currentStatsFilterPresetKey;
  if (state.isSupabaseMode && state.allLogsCache) {
    const userIds = new Set(teamUsers.map(u => u.id));
    return state.allLogsCache.filter(l => {
      if (!userIds.has(l.user_id)) return false;
      if (filterPresetKey) {
        const cacheKey = l.user_id + '_' + filterPresetKey;
        if (window.userPlanIdCache && window.userPlanIdCache[cacheKey]) {
          return l.plan_id === window.userPlanIdCache[cacheKey];
        }
        if (l.user_id === state.currentUser.id && state.activePlan) {
          return l.plan_id === state.activePlan.id;
        }
        return false;
      }
      return true;
    });
  } else {
    // Generate mock logs for team users based on their chapters_read and last_read
    const logs = [];
    
    // Include current user's real logs
    const currentUserRealLogs = state.readingLogs.filter(l => {
      if (filterPresetKey) {
        return l.presetKey === filterPresetKey || (state.activePlan && l.plan_id === state.activePlan.id);
      }
      return true;
    }).map(l => ({
      user_id: state.currentUser.id || state.currentUser.name,
      read_at: l.read_at
    }));
    logs.push(...currentUserRealLogs);

    const otherUsers = teamUsers.filter(u => u.name !== state.currentUser.name);
    otherUsers.forEach(u => {
      if (!u.chapters_read) return;
      
      const lastReadDateStr = u.last_read || new Date().toISOString().substring(0, 10);
      const lastReadDate = new Date(lastReadDateStr);
      lastReadDate.setHours(12, 0, 0, 0);

      let chaptersRemaining = u.chapters_read;
      // We will distribute the check-ins backwards from lastReadDate
      let currentDate = new Date(lastReadDate);
      
      // Let's generate daily check-ins
      for (let i = 0; i < 365 && chaptersRemaining > 0; i++) {
        const seed = Math.sin(u.name.charCodeAt(0) + i) * 10000;
        const rand = seed - Math.floor(seed);
        
        if (rand < 0.35) {
          const count = Math.min(chaptersRemaining, Math.floor(rand * 5) + 1);
          const dateStr = currentDate.toISOString().substring(0, 10);
          for (let c = 0; c < count; c++) {
            logs.push({
              user_id: u.id || u.name,
              read_at: dateStr
            });
          }
          chaptersRemaining -= count;
        }
        currentDate.setDate(currentDate.getDate() - 1);
      }
    });
    return logs;
  }
}

function renderHeatmap(teamUsers = []) {
  const container = document.getElementById("bible-heatmap-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  // Title update based on scope
  const titleEl = document.getElementById("heatmap-card-title");
  if (titleEl) {
    const role = state.currentUser.role || "member";
    if (role === "senior_pastor" || role === "admin") {
      const zoneSelectGroup = document.getElementById("stats-zone-selector");
      const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
      titleEl.textContent = selectedZone 
        ? `${selectedZone} 團隊讀經活躍度 (近4個月打卡活躍度)`
        : "全教會團隊讀經活躍度 (近4個月打卡活躍度)";
    } else if (role === "great_zone_leader") {
      titleEl.textContent = `${state.currentUser.great_region} 團隊讀經活躍度 (近4個月打卡活躍度)`;
    } else if (role === "zone_leader") {
      titleEl.textContent = `${state.currentUser.pastoral_zone} 團隊讀經活躍度 (近4個月打卡活躍度)`;
    } else {
      titleEl.textContent = `${state.currentUser.small_group} 小組讀經活躍度 (近4個月打卡活躍度)`;
    }
  }

  // Build logs-by-date map from team logs
  const teamLogs = getTeamLogs(teamUsers);
  const logsByDate = {};
  teamLogs.forEach(log => {
    if (log.read_at) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });

  const planStart = state.activePlan ? state.activePlan.startDate : null;
  const planEnd = state.activePlan ? state.activePlan.endDate : null;
  buildHeatmapGrid("bible-heatmap-container", logsByDate, teamUsers.length, "章", planStart, planEnd);
}

// ==========================================
// TEAM STATISTICS ANALYSIS & GROWTH TREND
// ==========================================

function renderTeamStatsAnalysisDashboard(unfilteredAllUsers, mockUser) {
  let teamUsers = [];
  const role = mockUser.role || 'member';

  if (role === 'admin' || role === 'senior_pastor') {
    const zoneSelectGroup = document.getElementById("stats-zone-selector");
    const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
    if (selectedZone) {
      teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === selectedZone);
    } else {
      teamUsers = unfilteredAllUsers;
    }
  } else if (role === 'great_zone_leader') {
    teamUsers = unfilteredAllUsers.filter(u => u.great_region === mockUser.great_region);
  } else if (role === 'zone_leader') {
    teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone);
  } else {
    // member or group_leader
    teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone && u.small_group === mockUser.small_group);
  }

  if (teamUsers.length === 0) {
    teamUsers = [mockUser];
  }

  const totalTeamCount = teamUsers.length;

  // 1. Completion Rate Today
  const todayStr = new Date().toISOString().substring(0, 10);
  const completedTodayCount = teamUsers.filter(u => u.last_read === todayStr).length;
  const todayCompletionRate = totalTeamCount > 0 ? Math.round((completedTodayCount / totalTeamCount) * 100) : 0;
  
  document.getElementById("team-today-completion-rate").textContent = todayCompletionRate + "%";

  // 2. Expected progress percentage
  let expectedPercentage = 0;
  if (state.activePlan) {
    const start = new Date(state.activePlan.startDate);
    const end = new Date(state.activePlan.endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const today = new Date();
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((today - start) / (1000 * 60 * 60 * 24)) + 1));
    expectedPercentage = Math.round((elapsedDays / totalDays) * 100) || 0;
  } else {
    expectedPercentage = 50;
  }

  let aheadCount = 0;
  let onScheduleCount = 0;
  let behindCount = 0;
  let round2PlusCount = 0;

  teamUsers.forEach(u => {
    // Determine round proxy if round field is undefined (e.g. mock data)
    const round = u.current_round !== undefined 
      ? u.current_round 
      : (u.chapters_read > 500 ? (u.chapters_read > 850 ? 3 : 2) : 1);
    
    if (round >= 2) {
      round2PlusCount++;
    }

    if (u.plan_progress === 0) {
      behindCount++;
    } else if (u.plan_progress > expectedPercentage + 5) {
      aheadCount++;
    } else if (u.plan_progress < expectedPercentage - 5) {
      behindCount++;
    } else {
      onScheduleCount++;
    }
  });

  const aheadRate = totalTeamCount > 0 ? Math.round((aheadCount / totalTeamCount) * 100) : 0;
  const onScheduleRate = totalTeamCount > 0 ? Math.round((onScheduleCount / totalTeamCount) * 100) : 0;
  const behindRate = totalTeamCount > 0 ? Math.round((behindCount / totalTeamCount) * 100) : 0;
  const round2PlusRate = totalTeamCount > 0 ? Math.round((round2PlusCount / totalTeamCount) * 100) : 0;

  document.getElementById("team-stat-ahead-label").textContent = `${aheadCount} 人 (${aheadRate}%)`;
  document.getElementById("team-stat-on-schedule-label").textContent = `${onScheduleCount} 人 (${onScheduleRate}%)`;
  document.getElementById("team-stat-behind-label").textContent = `${behindCount} 人 (${behindRate}%)`;
  document.getElementById("team-stat-round2-label").textContent = `${round2PlusCount} 人 (${round2PlusRate}%)`;

  document.getElementById("team-stat-ahead-bar").style.width = aheadRate + "%";
  document.getElementById("team-stat-on-schedule-bar").style.width = onScheduleRate + "%";
  document.getElementById("team-stat-behind-bar").style.width = behindRate + "%";
  document.getElementById("team-stat-round2-bar").style.width = round2PlusRate + "%";

  // 3. Render Growth Trend Chart
  const ctxGrowth = document.getElementById("team-growth-chart").getContext("2d");
  if (state.statsCharts.growth) state.statsCharts.growth.destroy();

  const totalActiveMembers = teamUsers.filter(u => u.chapters_read > 0).length;
  const trendData = [];
  const trendLabels = [];
  const todayDateObj = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDateObj);
    d.setDate(todayDateObj.getDate() - i);
    trendLabels.push(d.toISOString().substring(5, 10).replace('-', '/'));
    
    const factor = 0.8 + (6 - i) * 0.033;
    trendData.push(Math.round(totalActiveMembers * factor));
  }

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  state.statsCharts.growth = new Chart(ctxGrowth, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: '參與人數',
        data: trendData,
        borderColor: '#04A9D2',
        backgroundColor: 'var(--color-brand-subtle, rgba(4,169,210,0.12))',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#04A9D2'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }
      }
    }
  });

  // Render personal stats card
  renderProfileReadingStats();

  // Render team heatmap
  renderHeatmap(teamUsers);
}

// ─────────────────────────────────────────────
// Personal Reading Stats Calculation & Rendering (Migrated from profile.js)
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
        <p style="font-size: 0.9rem; font-weight: 500; margin-bottom: 0.5rem; color: var(--text-primary);">${(window.APP_COPY && window.APP_COPY.stats.noPlan) || "還沒加入讀經計畫"}</p>
        <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.5rem;">
          請至「計畫」頁面選擇並加入，即可在此查看進度統計。
        </p>
        
        <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 0.8rem 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; text-align: left;">
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <div class="stat-icon-wrapper" style="background: rgba(239, 68, 68, 0.1); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ef4444;">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
            </div>
            <div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">連續讀經</div>
            </div>
          </div>
          <div style="font-size: 1.25rem; font-weight: 500; color: #ef4444; display: flex; align-items: baseline; gap: 0.1rem;">
            ${streakDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>
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
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">尚未開始 (開始於 ${stats.startDateStr})</span>`;
  } else if (today > end) {
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">已結束 (共 ${stats.totalDays} 天)</span>`;
  } else {
    todayProgressText = `<span style="font-size: 1.25rem; font-weight: 500; color: var(--primary-color);">${stats.elapsedDays}</span> <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">/ ${stats.totalDays} 天</span>`;
  }

  const lagDisplay = stats.lagDays > 0 
    ? `${stats.lagDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  const leadDisplay = stats.leadDays > 0
    ? `${stats.leadDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  const makeupDisplay = stats.makeupDays > 0
    ? `${stats.makeupDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  container.innerHTML = `
    <div class="profile-stats-grid" style="display: grid; grid-template-columns: 1fr; gap: 1rem;">
      
      <!-- Today's Day -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: var(--color-brand-subtle, rgba(4,169,210,0.12)); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--primary-color);">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">今天計畫進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">目前已進行的計畫天數</div>
          </div>
        </div>
        <div style="font-weight: 500; display: flex; align-items: baseline; gap: 0.1rem;">
          ${todayProgressText}
        </div>
      </div>

      <!-- Consecutive Streak -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: rgba(239, 68, 68, 0.1); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ef4444;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">連續讀經</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">每日穩定靈修天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 500; color: #ef4444; display: flex; align-items: baseline; gap: 0.1rem;">
          ${streakDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>
        </div>
      </div>

      <!-- Behind Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.lagDays > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.lagDays > 0 ? '#ef4444' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">落後進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">落後預計進度天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 500; color: ${stats.lagDays > 0 ? '#ef4444' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${lagDisplay}
        </div>
      </div>

      <!-- Ahead Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.leadDays > 0 ? 'var(--color-success-subtle)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.leadDays > 0 ? 'var(--color-success-foreground)' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">超前進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">超前預計進度天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 500; color: ${stats.leadDays > 0 ? 'var(--color-success-foreground)' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${leadDisplay}
        </div>
      </div>

      <!-- Makeup Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper" style="background: ${stats.makeupDays > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(229, 231, 235, 0.2)'}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${stats.makeupDays > 0 ? '#3b82f6' : 'var(--text-muted)'};">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">補讀天數</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">事後補讀完畢天數</div>
          </div>
        </div>
        <div style="font-size: 1.5rem; font-weight: 500; color: ${stats.makeupDays > 0 ? '#3b82f6' : 'var(--text-secondary)'}; display: flex; align-items: baseline; gap: 0.1rem;">
          ${makeupDisplay}
        </div>
      </div>

    </div>
  `;
}
