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
  rawAllUsers = await db.fetchMergedUsersList();

  if (state.isSupabaseMode && state.supabase) {
    // Apply RBAC filtering on the fetched dataset
    rawAllUsers = filterUsersByRole(rawAllUsers, mockUser);

    // Compute pastoral stats aggregation from raw filtered profiles
    const zoneMap = {};
    rawAllUsers.forEach(u => {
      const z = u.pastoral_zone;
      if (!z) return;
      if (!zoneMap[z]) {
        zoneMap[z] = {
          name: z,
          great_region: u.great_region,
          member_count: 0,
          total_chapters: 0,
          avg_progress: 0,
          active_count: 0,
          progress_sum: 0
        };
      }
      const stats = zoneMap[z];
      stats.member_count += 1;
      stats.total_chapters += u.chapters_read;
      stats.progress_sum += u.plan_progress;
      stats.active_count += 1;
    });

    Object.keys(zoneMap).forEach(k => {
      const stats = zoneMap[k];
      stats.avg_progress = Math.round(stats.progress_sum / stats.member_count) || 0;
    });

    pastoralStats = Object.values(zoneMap).sort((a, b) => b.total_chapters - a.total_chapters);

  } else {
    // Demo Mode
    rawAllUsers = filterUsersByRole(rawAllUsers, mockUser);
    pastoralStats = MockStatsService.getPastoralZoneStats(mockUser);
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
      miniCardLabels[1].textContent = "個人速讀排名";
      miniCardLabels[2].textContent = "個人連續讀經天數";
    }
  }

  // 2. Render Mini Card values
  if (role === "member") {
    const allGlobalUsers = await db.fetchMergedUsersList();
    allGlobalUsers.sort((a, b) => b.chapters_read - a.chapters_read);
    const myIndex = allGlobalUsers.findIndex(u => u.name === mockUser.name);
    const myRank = myIndex !== -1 ? (myIndex + 1) : "無";

    document.getElementById("stats-total-read").textContent = mockUser.chapters_read + " 章";
    document.getElementById("stats-total-members").textContent = myRank + " / " + allGlobalUsers.length + " 名";
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

  if (role === "member") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.add("hidden");
  } else if (role === "group_leader") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;
    updateGroupChart(mockUser.pastoral_zone);
  } else if (role === "zone_leader") {
    chartsContainer.classList.add("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;
    updateGroupChart(mockUser.pastoral_zone);
  } else if (role === "great_zone_leader") {
    chartsContainer.classList.remove("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.disabled = false;
    
    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  } else {
    // admin / senior pastor
    chartsContainer.classList.remove("hidden");
    groupChartContainer.classList.remove("hidden");
    zoneSelectGroup.disabled = false;
    
    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  }

  // Render Monthly Hall of Fame
  renderMonthlyHallOfFame();

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
