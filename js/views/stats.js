// Statistics & charts tab view controller

function filterUsersByRole(users, currentUser) {
  if (!currentUser) return users;
  const role = currentUser.role || "member";
  
  if (role === "senior_pastor" || role === "admin") {
    return users; // Full access
  }
  
  if (role === "great_zone_leader") {
    return users.filter(u => u.great_region === currentUser.great_region);
  }
  
  if (role === "zone_leader") {
    return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone);
  }
  
  if (role === "group_leader") {
    return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone && u.small_group === currentUser.small_group);
  }
  
  // member
  return users.filter(u => u.name === currentUser.name);
}

async function updateStatsView() {
  loader.show("載入統計數據中...");
  
  let pastoralStats = [];
  let rawAllUsers = [];

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

  const role = mockUser.role;

  // Use the unified db service to get all merged users (eliminates redundant DB queries)
  const unfilteredAllUsers = await db.fetchMergedUsersList();
  window.unfilteredAllUsersCache = unfilteredAllUsers;
  window.mockUserCache = mockUser;
  rawAllUsers = [...unfilteredAllUsers];

  if (state.isSupabaseMode && state.supabase) {
    try {
      const { data } = await state.supabase.from("view_pastoral_zone_stats").select("*");
      if (data) {
        pastoralStats = data.map(item => ({
          name: item.pastoral_zone,
          great_region: item.great_region,
          member_count: item.member_count,
          total_chapters: item.total_chapters_read,
          avg_progress: item.avg_progress || 0,
          active_count: item.active_member_count
        })).sort((a, b) => b.total_chapters - a.total_chapters);
      }
    } catch (e) {
      console.error("Failed to load pastoral zone stats from views:", e);
    }
    // Apply RBAC filtering on the fetched roster dataset
    rawAllUsers = filterUsersByRole(rawAllUsers, mockUser);
  } else {
    // Demo Mode
    pastoralStats = MockStatsService.getPastoralZoneStats(mockUser);
    rawAllUsers = filterUsersByRole(rawAllUsers, mockUser);
  }

  // Filter pastoralStats based on Great Region for non-admin roles
  if (role !== "admin" && role !== "senior_pastor") {
    pastoralStats = pastoralStats.filter(z => z.great_region === mockUser.great_region);
  }

  // 1. Update Mini Card Labels based on User Role
  const miniCardLabels = document.querySelectorAll('.stats-overview-row .label');
  if (miniCardLabels.length === 3) {
    if (role === "senior_pastor" || role === "admin") {
      miniCardLabels[0].textContent = "全教會總閱讀章數";
      miniCardLabels[1].textContent = "全教會參與人數";
      miniCardLabels[2].textContent = "全教會本週活躍人數";
    } else if (role === "great_zone_leader") {
      miniCardLabels[0].textContent = "本大區總閱讀章數";
      miniCardLabels[1].textContent = "本大區參與人數";
      miniCardLabels[2].textContent = "本大區本週活躍人數";
    } else if (role === "zone_leader") {
      miniCardLabels[0].textContent = "本牧區總閱讀章數";
      miniCardLabels[1].textContent = "本牧區參與人數";
      miniCardLabels[2].textContent = "本牧區本週活躍人數";
    } else if (role === "group_leader") {
      miniCardLabels[0].textContent = "本小組總閱讀章數";
      miniCardLabels[1].textContent = "本小組參與人數";
      miniCardLabels[2].textContent = "本小組本週活躍人數";
    } else {
      miniCardLabels[0].textContent = "個人總閱讀章數";
      miniCardLabels[1].textContent = "個人全教會排名";
      miniCardLabels[2].textContent = "個人連續讀經天數";
    }
  }

  // 2. Render Mini Card values
  if (role === "member") {
    const rankings = await db.getUserRankings();
    const myRankStr = (rankings && rankings.churchRank > 0) ? `第 ${rankings.churchRank} / ${rankings.churchTotal} 名` : "尚無資料";

    document.getElementById("stats-total-read").textContent = (state.currentUser.chapters_read || 0) + " 章";
    document.getElementById("stats-total-members").textContent = myRankStr;
    document.getElementById("stats-active-members").textContent = (state.currentUser.streak || 0) + " 天";
  } else {
    const totalChaptersAll = pastoralStats.reduce((sum, item) => sum + (item.total_chapters || 0), 0);
    const totalMembers = rawAllUsers.length;
    const totalActive = rawAllUsers.filter(u => {
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
  }

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
  renderHeatmap();
  if (typeof renderUnlockedBadgesWall !== 'undefined') {
    renderUnlockedBadgesWall();
  }

  // Render Team Progress Status & Growth Trend Dashboard
  renderTeamStatsAnalysisDashboard(unfilteredAllUsers, mockUser);

  loader.hide();
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
      <td><span style="font-weight:700; color: var(--primary-color);">${user.chapters_read}</span> 章</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.8rem; font-weight:700;">${user.plan_progress}%</span>
          <div style="flex:1; width:50px; height:6px; background:#e2e8f0; border-radius:5px; overflow:hidden;">
            <div style="width:${user.plan_progress}%; height:100%; background: var(--accent-gradient);"></div>
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
          'rgba(99, 102, 241, 0.85)',
          'rgba(16, 185, 129, 0.85)',
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
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        borderColor: 'rgba(99, 102, 241, 0.9)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)'
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
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
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
  
  const winners = [
    {
      month: "2026年6月 (本月累計)",
      top3: [
        { rank: "gold", name: "楊俊傑", zone: "大安6", chapters: 980 },
        { rank: "silver", name: "蕭志平", zone: "中永和", chapters: 800 },
        { rank: "bronze", name: "東區大區長", zone: "大安1", chapters: 750 }
      ]
    },
    {
      month: "2026年5月 (結算前三)",
      top3: [
        { rank: "gold", name: "張明哲", zone: "大安2", chapters: 650 },
        { rank: "silver", name: "郭家豪", zone: "文山", chapters: 620 },
        { rank: "bronze", name: "東區區長", zone: "大安1", chapters: 600 }
      ]
    },
    {
      month: "2026年4月 (結算前三)",
      top3: [
        { rank: "gold", name: "許美惠", zone: "大安6", chapters: 540 },
        { rank: "silver", name: "吳志明", zone: "大安1", chapters: 520 },
        { rank: "bronze", name: "陳建國", zone: "大安1", chapters: 480 }
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
// PERSONAL BIBLE READING HEATMAP
// ==========================================

function renderHeatmap() {
  const container = document.getElementById("bible-heatmap-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  const grid = document.createElement("div");
  grid.className = "heatmap-grid";
  
  // Use UTC to prevent timezone offsets when converting to ISOString
  const startDate = new Date();
  startDate.setUTCHours(12, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - 365);
  const dayOfWeek = startDate.getUTCDay();
  startDate.setUTCDate(startDate.getUTCDate() - dayOfWeek);
  
  const today = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysDiff = Math.ceil((today.getTime() - startDate.getTime()) / oneDayMs);
  
  const logsByDate = {};
  state.readingLogs.forEach(log => {
    if (log.read_at) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });

  for (let i = 0; i <= daysDiff; i++) {
    const currentDate = new Date(startDate.getTime() + i * oneDayMs);
    const dateStr = currentDate.toISOString().substring(0, 10);
    const count = logsByDate[dateStr] || 0;
    
    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.setAttribute("data-date", dateStr);
    cell.setAttribute("data-count", count);
    
    let background = "var(--border-card)";
    let opacity = "0.4";
    if (count > 0) {
      opacity = "1";
      if (count <= 2) background = "rgba(99, 102, 241, 0.25)";
      else if (count <= 4) background = "rgba(99, 102, 241, 0.5)";
      else if (count <= 8) background = "rgba(99, 102, 241, 0.75)";
      else background = "rgba(99, 102, 241, 1)";
    }
    
    cell.style.backgroundColor = background;
    cell.style.opacity = opacity;
    
    cell.title = `${dateStr}: 已打卡 ${count} 章`;
    grid.appendChild(cell);
  }
  
  container.appendChild(grid);
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
        borderColor: 'rgba(99, 102, 241, 1)',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)'
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
}
