// Dashboard tab view controller

const DAILY_VERSES = [
  { text: "「神的話是我腳前的燈，是我路上的光。」", source: "詩篇 119:105" },
  { text: "「但那等候耶和華的，必重新得力。他們必如鷹展翅上騰，他們奔跑卻不困倦，行走卻不疲乏。」", source: "以賽亞書 40:31" },
  { text: "「你要專心仰賴耶和華，不可倚靠自己的聰明，在你一切所行的事上都要認定他，他必指引你的路。」", source: "箴言 3:5-6" },
  { text: "「我將這些事告訴你們，是要叫你們在我裡面有平安。在世上你們有苦難，但你們可以放心，我已經勝了世界。」", source: "約約翰福音 16:33" },
  { text: "「耶和華是我的牧者，我必不致缺乏。」", source: "詩篇 23:1" },
  { text: "「應當一無掛慮，只要凡事藉著禱告、祈求和感謝，將你們所要的告訴神。神所賜出人意外的平安，必在基督耶穌裡保守你們的心懷意念。」", source: "腓立比書 4:6-7" },
  { text: "「我們曉得萬事都互相效力，叫愛神的人得益處，就是按他旨意被召的人。」", source: "羅馬書 8:28" },
  { text: "「所以，不要為明天憂慮，因為明天自有明天的憂慮；一天的難處一天當就夠了。」", source: "馬太福音 6:34" },
  { text: "「我靠著那加給我力量的，凡事都能做。」", source: "腓立比書 4:13" },
  { text: "「神愛世人，甚至將他的獨生子賜給他們，叫一切信他的不致滅亡，反得永生。」", source: "約翰福音 3:16" },
  { text: "「你不要害怕，因為我與你同在；不要驚惶，因為我是你的神。我必堅固你，我必幫助你，我必用我公義的右手扶持你。」", source: "以賽亞書 41:10" },
  { text: "「凡勞苦擔重擔的人，可以到我這裡來，我就使你們得安息。」", source: "馬太福音 11:28" }
];

function updateDashboardView() {
  const greetingEl = document.getElementById("user-greeting");
  if (greetingEl) {
    greetingEl.textContent = state.currentUser.name || "弟兄姊妹";
  }
  const streakEl = document.getElementById("streak-days");
  if (streakEl) {
    streakEl.textContent = state.currentUser.streak || "0";
  }
  
  // Render Daily Verse and Church Announcements
  renderDailyVerse();
  updateAnnouncementsList();

  // Render active plan card
  const planSummaryDiv = document.getElementById("active-plan-summary");
  if (state.activePlan) {
    const progress = state.activePlan.progress || 0;
    const started = isPlanStarted(state.activePlan);
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
    const isPlanAvailable = started || isAdmin;
    const statusText = started 
      ? `進度: ${progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)`
      : `<span style="color: #3b82f6; font-weight: 700;">等待開始</span> (將於 ${state.activePlan.startDate} 開始)`;
      
    // Calculate core statistics for dashboard summary card
    const streakDays = state.currentUser.streak || 0;
    const totalCompletionRate = progress;

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();
    const todayDayObj = state.activePlan.days.find(d => {
      if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
      const parts = d.date.split('/');
      return parts.length === 2 && Number(parts[1]) === todayDay;
    });

    let todayTotalCount = 0;
    let todayReadCount = 0;
    if (todayDayObj && todayDayObj.chapters) {
      todayTotalCount = todayDayObj.chapters.length;
      todayDayObj.chapters.forEach(ch => {
        const currentRound = state.activePlan.currentRound || 1;
        const taskRound = ch.round || currentRound;
        let isRead = false;
        if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
        else if (taskRound === 2) isRead = ch.isReadR2;
        else if (taskRound >= 3) isRead = ch.isReadR3;
        else isRead = ch.isRead;
        if (isRead) todayReadCount++;
      });
    }

    planSummaryDiv.innerHTML = `
      <div class="plan-progress-header">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
          <h4 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
          ${started 
            ? '<span style="font-size: 0.7rem; background: #10b981; color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
            : '<span style="font-size: 0.7rem; background: #3b82f6; color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
          }
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.2rem;">
          計畫週期: ${state.activePlan.startDate} ~ ${state.activePlan.endDate} (${state.activePlan.totalDays} 天)
        </p>
        <div class="plan-progress-wrapper" style="margin-top: 1rem;">
          <div class="plan-progress-bar" style="width: ${progress}%;"></div>
        </div>
        <p style="font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; text-align: right; margin-bottom: 1rem;">
          ${statusText}
        </p>

        <!-- 第一線首頁常駐卡片 (簡短核心，橫向 Flex 佈局) -->
        <div class="dashboard-stats-strip" 
             onclick="event.stopPropagation(); window.showPlanStatsModal ? window.showPlanStatsModal() : null;"
             style="display: flex; justify-content: space-around; background: rgba(99, 102, 241, 0.06); border: 1px solid var(--border-card); border-radius: 12px; padding: 0.8rem 0.5rem; cursor: pointer; transition: transform 0.2s, background-color 0.2s;"
             onmouseover="this.style.background='rgba(99, 102, 241, 0.1)'; this.style.transform='scale(1.01)';"
             onmouseout="this.style.background='rgba(99, 102, 241, 0.06)'; this.style.transform='scale(1)';"
             title="點擊展開詳細統計">
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 0;">
            <span style="font-size: 1.15rem; font-weight: 800; color: #ef4444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">🔥 ${streakDays} 天</span>
            <span style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">連續讀經</span>
          </div>
          <div style="width: 1px; background: var(--border-card); align-self: stretch;"></div>
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 0;">
            <span style="font-size: 1.15rem; font-weight: 800; color: var(--primary-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">📖 ${todayReadCount}/${todayTotalCount} 章</span>
            <span style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">今日進度</span>
          </div>
          <div style="width: 1px; background: var(--border-card); align-self: stretch;"></div>
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 0;">
            <span style="font-size: 1.15rem; font-weight: 800; color: #10b981; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">📈 ${totalCompletionRate}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">計畫進度</span>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.2rem;">
        <button class="secondary-btn flex-btn" onclick="event.stopPropagation(); window.openActivePlanFromDashboard()">讀經表</button>
        <button class="primary-btn flex-btn" onclick="event.stopPropagation(); window.startReadingCurrentChapter()" ${isPlanAvailable ? '' : 'disabled style="opacity: 0.6; cursor: not-allowed;"'}>開始閱讀</button>
      </div>
    `;
    planSummaryDiv.classList.add("route-plan-card");
    planSummaryDiv.setAttribute("role", "button");
    planSummaryDiv.setAttribute("tabindex", "0");
    planSummaryDiv.onclick = window.openActivePlanFromDashboard;
    planSummaryDiv.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.openActivePlanFromDashboard(event);
      }
    };
  } else {
    planSummaryDiv.classList.remove("route-plan-card");
    planSummaryDiv.removeAttribute("role");
    planSummaryDiv.removeAttribute("tabindex");
    planSummaryDiv.onclick = null;
    planSummaryDiv.onkeydown = null;
    planSummaryDiv.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1rem;">目前沒有進行中的讀經計畫。</p>
        <button class="primary-btn" onclick="appRouter.switchTab('plan-view')">選擇計畫加入</button>
      </div>
    `;
  }

  // Render personal rankings
  calculateAndRenderPersonalRankings();

  // Render Pastoral ranking top 5 list
  renderPastoralZoneRankingList();

  // Load Devotional Notes
  loadTodayDevotional();

  // Render Pilgrimage Trail & controls
  renderPilgrimageTrail();
  if (!state.pilgrimageControlsInit) {
    initPilgrimageControls();
    state.pilgrimageControlsInit = true;
  }

  // Render Honor Badges Wall
  if (typeof renderBadgeWall === "function") {
    renderBadgeWall("stats-badge-wall-container");
  }
}

async function calculateAndRenderPersonalRankings() {
  const rankGroupEl = document.getElementById("rank-group");
  const rankZoneEl = document.getElementById("rank-zone");
  const rankRegionEl = document.getElementById("rank-region");
  const rankChurchEl = document.getElementById("rank-church");

  if (!rankGroupEl || !rankZoneEl || !rankRegionEl || !rankChurchEl) return;

  const hasPlan = state.activePlans && state.activePlans.length > 0;
  if (!hasPlan) {
    rankGroupEl.textContent = "未加入計畫";
    rankZoneEl.textContent = "未加入計畫";
    rankRegionEl.textContent = "未加入計畫";
    rankChurchEl.textContent = "未加入計畫";
    return;
  }

  try {
    const rankings = await db.getUserRankings();
    if (rankings) {
      rankGroupEl.textContent = rankings.groupRank > 0 ? `第 ${rankings.groupRank} 名 / 共 ${rankings.groupTotal} 人` : "尚無資料";
      rankZoneEl.textContent = rankings.zoneRank > 0 ? `第 ${rankings.zoneRank} 名 / 共 ${rankings.zoneTotal} 人` : "尚無資料";
      rankRegionEl.textContent = rankings.regionRank > 0 ? `第 ${rankings.regionRank} 名 / 共 ${rankings.regionTotal} 人` : "尚無資料";
      rankChurchEl.textContent = rankings.churchRank > 0 ? `第 ${rankings.churchRank} 名 / 共 ${rankings.churchTotal} 人` : "尚無資料";
    } else {
      rankGroupEl.textContent = "無資料";
      rankZoneEl.textContent = "無資料";
      rankRegionEl.textContent = "無資料";
      rankChurchEl.textContent = "無資料";
    }
  } catch (err) {
    console.error("Error rendering personal rankings:", err);
    rankGroupEl.textContent = "載入失敗";
    rankZoneEl.textContent = "載入失敗";
    rankRegionEl.textContent = "載入失敗";
    rankChurchEl.textContent = "載入失敗";
  }
}

async function renderPastoralZoneRankingList() {
  const rankingContainer = document.getElementById("dashboard-pastoral-ranking");
  if (!rankingContainer) return;

  const hasPlan = state.activePlans && state.activePlans.length > 0;
  if (!hasPlan) {
    rankingContainer.innerHTML = `<div class="empty-state">請先加入計畫以查看排名</div>`;
    return;
  }

  rankingContainer.innerHTML = `<div class="empty-state">載入排行中...</div>`;

  let pastoralStats = [];
  if (state.isSupabaseMode && state.supabase) {
    try {
      const { data } = await state.supabase.from("view_pastoral_zone_stats").select("*");
      if (data) {
        pastoralStats = data.map(item => ({
          name: item.pastoral_zone,
          total_chapters: item.total_chapters_read
        })).sort((a, b) => b.total_chapters - a.total_chapters);
      }
    } catch (e) {
      console.error("Failed to load pastoral zone stats:", e);
    }
  } else {
    // Demo Mode
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
    pastoralStats = MockStatsService.getPastoralZoneStats(mockUser);
  }

  rankingContainer.innerHTML = "";
  if (pastoralStats.length === 0) {
    rankingContainer.innerHTML = `<div class="empty-state">尚無速讀數據</div>`;
    return;
  }

  pastoralStats.slice(0, 5).forEach((item, index) => {
    const rankClass = `rank-${index + 1}`;
    const rankItem = document.createElement("div");
    rankItem.className = "ranking-item";
    rankItem.innerHTML = `
      <div class="rank-number ${rankClass}">${index + 1}</div>
      <div class="rank-details">
        <div class="rank-name">${escapeHTML(item.name || item.pastoral_zone)}</div>
      </div>
      <div class="rank-value">${item.total_chapters || 0} 章</div>
    `;
    rankingContainer.appendChild(rankItem);
  });
}

// Devotional Notes View Handlers
async function loadTodayDevotional() {
  const textarea = document.getElementById("devotional-content");
  const countEl = document.getElementById("devotional-word-count");
  if (!textarea) return;
  
  textarea.value = "";
  if (countEl) countEl.textContent = "字數: 0 字";
  
  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  try {
    const content = await db.getDevotionalNote(todayStr);
    if (content) {
      textarea.value = content;
      if (countEl) countEl.textContent = `字數: ${content.length} 字`;
    }
  } catch (err) {
    console.error("Failed to load devotional note:", err);
  }
}

let devotionalDebounceTimer = null;

function initDevotionalControls() {
  const textarea = document.getElementById("devotional-content");
  const saveBtn = document.getElementById("btn-save-devotional");
  const countEl = document.getElementById("devotional-word-count");
  
  if (!textarea) return;
  
  textarea.addEventListener("input", () => {
    const text = textarea.value;
    if (countEl) countEl.textContent = `字數: ${text.length} 字`;
    
    clearTimeout(devotionalDebounceTimer);
    devotionalDebounceTimer = setTimeout(() => {
      saveDevotionalNote(true);
    }, 1000);
  });
  
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      clearTimeout(devotionalDebounceTimer);
      saveDevotionalNote(false);
    });
  }

  const searchInput = document.getElementById("member-today-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderProgressListFiltered(e.target.value);
    });
  }
}

async function saveDevotionalNote(isAuto) {
  const textarea = document.getElementById("devotional-content");
  const statusEl = document.getElementById("devotional-save-status");
  if (!textarea) return;
  
  const content = textarea.value.trim();
  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  if (statusEl && isAuto) {
    statusEl.textContent = "自動儲存中...";
    statusEl.style.opacity = "1";
  }
  
  try {
    await db.saveDevotionalNote(todayStr, content);
    showSaveSuccess(isAuto);
  } catch (err) {
    console.error("Failed to save devotional note:", err);
    if (statusEl) {
      statusEl.textContent = "儲存失敗";
      statusEl.style.color = "#ef4444";
      statusEl.style.opacity = "1";
    }
  }
}

function showSaveSuccess(isAuto) {
  const statusEl = document.getElementById("devotional-save-status");
  if (!statusEl) return;
  
  statusEl.innerHTML = `
    <span style="width: 5px; height: 5px; background: #10b981; border-radius: 50%; display: inline-block;"></span>
    已自動儲存
  `;
  statusEl.style.color = "#10b981";
  statusEl.style.opacity = "1";
  
  if (!isAuto) {
    statusEl.innerHTML = `
      <span style="width: 5px; height: 5px; background: #10b981; border-radius: 50%; display: inline-block;"></span>
      儲存成功
    `;
  }
  
  setTimeout(() => {
    statusEl.style.opacity = "0";
  }, 2000);
}

// Group Progress Handlers
async function renderTodayGroupProgress() {
  const listEl = document.getElementById("member-today-list");
  if (!listEl) return;
  
  const hasPlan = state.activePlans && state.activePlans.length > 0;
  if (!hasPlan) {
    listEl.innerHTML = '<div style="font-size: 0.88rem; color: var(--text-muted); text-align: center; padding: 2rem 0;">請先至 讀經計畫 加入計畫，以查看今日進度！</div>';
    return;
  }
  
  listEl.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1rem;">載入中...</div>';
  
  // Adapt header and search box visibility based on role
  const cardEl = listEl.closest('.glass-card');
  if (cardEl) {
    const cardTitleEl = cardEl.querySelector('.card-title');
    const searchBoxEl = cardEl.querySelector('.search-box-wrapper');
    
    if (state.currentUser && state.currentUser.role === 'member') {
      if (cardTitleEl) {
        cardTitleEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--primary-color)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          我的今日讀經進度
        `;
      }
      if (searchBoxEl) {
        searchBoxEl.style.display = 'none';
      }
    } else {
      if (cardTitleEl) {
        cardTitleEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--primary-color)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          小組今日讀經進度
        `;
      }
      if (searchBoxEl) {
        searchBoxEl.style.display = 'block';
      }
    }
  }

  let allUsers = await db.fetchMergedUsersList();
  
  const mockUser = {
    name: state.currentUser.name,
    great_region: state.currentUser.great_region || "東區",
    pastoral_zone: state.currentUser.pastoral_zone || "大安1",
    small_group: state.currentUser.small_group || "馬鈴",
    role: state.currentUser.role || "member"
  };
  
  let groupMembers = allUsers.filter(u => 
    u.pastoral_zone === mockUser.pastoral_zone && 
    u.small_group === mockUser.small_group
  );
  
  if (groupMembers.length === 0) {
    groupMembers = allUsers.slice(0, 10);
  }
  
  state.todayGroupMembers = groupMembers;
  
  renderProgressListFiltered("");
}

function renderProgressListFiltered(searchText) {
  const listEl = document.getElementById("member-today-list");
  if (!listEl || !state.todayGroupMembers) return;
  
  listEl.innerHTML = "";
  
  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  const query = searchText.trim().toLowerCase();
  const filtered = state.todayGroupMembers.filter(m => 
    m.name.toLowerCase().includes(query)
  );
  
  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1rem;">無相符成員</div>';
    return;
  }
  
  filtered.forEach(m => {
    const isRecentRead = m.last_read && (
      m.last_read === todayStr ||
      m.last_read === "2026-06-26" ||
      m.last_read === "2026-06-25"
    );

    const item = document.createElement("div");
    item.className = "member-progress-item";
    
    const nameInfo = document.createElement("div");
    nameInfo.className = "member-name-info";
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "member-name";
    nameSpan.textContent = m.name;
    nameInfo.appendChild(nameSpan);
    
    const metaSpan = document.createElement("span");
    metaSpan.className = "member-meta";
    metaSpan.textContent = `連續讀經: ${m.streak || 0}天 | 總章數: ${m.chapters_read || 0}章`;
    nameInfo.appendChild(metaSpan);
    
    item.appendChild(nameInfo);
    
    const badge = document.createElement("span");
    if (isRecentRead) {
      badge.className = "progress-badge completed";
      badge.innerHTML = `
        <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="3" fill="none" style="display:inline-block; vertical-align:middle; margin-right:2px;"><polyline points="20 6 9 17 4 12"/></svg>
        今日已讀
      `;
    } else {
      badge.className = "progress-badge pending";
      badge.textContent = "未打卡";
    }
    item.appendChild(badge);
    
    listEl.appendChild(item);
  });
}

// ==========================================
// PILGRIMAGE TRAIL BOARD RENDER LOGIC
// ==========================================

state.pilgrimageZoom = 1.0;
state.pilgrimageControlsInit = false;

function getTileCoords(index) {
  const cols = 8;
  const spacingX = 85;
  const spacingY = 85;
  const startX = 50;
  const startY = 50;
  
  const row = Math.floor(index / cols);
  const col = index % cols;
  const isReversed = row % 2 === 1;
  const actualCol = isReversed ? (cols - 1 - col) : col;
  
  return {
    x: startX + actualCol * spacingX,
    y: startY + row * spacingY
  };
}

function getMemberColor(name) {
  if (name === state.currentUser.name) return "#6366f1"; // Indigo for Me
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#3b82f6", // Blue
    "#ec4899", // Pink
    "#8b5cf6", // Purple
    "#14b8a6", // Teal
    "#f43f5e", // Rose
    "#06b6d4"  // Cyan
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

async function renderPilgrimageTrail() {
  const canvas = document.getElementById("pilgrimage-canvas");
  if (!canvas) return;

  // Must have an active plan to draw the plan-specific trail
  if (!state.activePlan || !state.activePlan.days || state.activePlan.days.length === 0) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const ctx = canvas.getContext("2d");
  const currentRound = state.activePlan.currentRound || 1;

  // ── 1. Build plan chapter list (in reading order) ──────────────────────
  const planChapters = [];
  let lastBook = null;
  state.activePlan.days.forEach(day => {
    if (!day.chapters) return;
    day.chapters.forEach(ch => {
      const isBookStart = ch.book !== lastBook;
      planChapters.push({
        bookName: ch.book,
        chapterNum: ch.chapter,
        isReadR1: ch.isReadR1 || false,
        isReadR2: ch.isReadR2 || false,
        isReadR3: ch.isReadR3 || false,
        isRead: ch.isRead || false,
        isBookStart
      });
      lastBook = ch.book;
    });
  });

  const TOTAL_PLAN_CHAPTERS = planChapters.length;
  if (TOTAL_PLAN_CHAPTERS === 0) return;

  // ── 2. Compute MY progress per round ──────────────────────────────────
  const myR1Count = planChapters.filter(c => c.isReadR1).length;
  const myR2Count = planChapters.filter(c => c.isReadR2).length;
  const myR3Count = planChapters.filter(c => c.isReadR3).length;
  const myChaptersRead = currentRound === 3 ? myR3Count : (currentRound === 2 ? myR2Count : myR1Count);

  // ── 3. Fetch group members (plan-scoped via fetchMergedUsersList) ──────
  let allUsers = await db.fetchMergedUsersList();
  const myZone = state.currentUser.pastoral_zone || "";
  let groupMembers = myZone ? allUsers.filter(u => u.pastoral_zone === myZone) : [];
  if (!groupMembers || groupMembers.length === 0) {
    groupMembers = [{ name: state.currentUser.name, chapters_read: myChaptersRead }];
  }
  // Override self with local round-specific count for accuracy
  groupMembers = groupMembers.map(m =>
    m.name === state.currentUser.name ? { ...m, chapters_read: myChaptersRead } : m
  );
  if (!groupMembers.some(m => m.name === state.currentUser.name)) {
    groupMembers = [{ name: state.currentUser.name, chapters_read: myChaptersRead }, ...groupMembers];
  }

  const maxChaptersRead = groupMembers.reduce((max, m) => Math.max(max, m.chapters_read || 0), 0);
  const maxDrawIndex = Math.min(Math.max(0, maxChaptersRead - 1) + 16, TOTAL_PLAN_CHAPTERS - 1);

  // ── 4. Round-based color palette ──────────────────────────────────────
  const palette = {
    1: { myPath: "#818cf8", grpPath: "#93c5fd", myFill: "#e0e7ff", grpFill: "#eff6ff", myStroke: "#6366f1", grpStroke: "#3b82f6", myText: "#4338ca", grpText: "#1d4ed8" },
    2: { myPath: "#a855f7", grpPath: "#c4b5fd", myFill: "#f3e8ff", grpFill: "#faf5ff", myStroke: "#9333ea", grpStroke: "#7c3aed", myText: "#7e22ce", grpText: "#6d28d9" },
    3: { myPath: "#f59e0b", grpPath: "#fcd34d", myFill: "#fef3c7", grpFill: "#fffbeb", myStroke: "#d97706", grpStroke: "#ca8a04", myText: "#92400e", grpText: "#b45309" },
  };
  const pal = palette[Math.min(currentRound, 3)];

  // ── 5. Canvas sizing ──────────────────────────────────────────────────
  const cols = 8;
  const spacingX = 90;
  const spacingY = 95;
  const rowsCount = Math.ceil((maxDrawIndex + 1) / cols);
  canvas.width  = cols * spacingX + 20;
  canvas.height = rowsCount * spacingY + 20;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ── 6. Path line helper ───────────────────────────────────────────────
  function drawPathLine(startIndex, endIndex, color, width = 8) {
    if (endIndex < startIndex) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const s = getTileCoords(startIndex);
    ctx.moveTo(s.x, s.y);
    for (let i = startIndex + 1; i <= endIndex; i++) {
      const p = getTileCoords(i);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // ── 7. Draw path lines ────────────────────────────────────────────────
  // Background grey path
  drawPathLine(0, maxDrawIndex, "rgba(226, 232, 240, 0.8)");
  // Round 1 footprint underlay (visible only on round 2+)
  if (currentRound >= 2 && myR1Count > 1) {
    drawPathLine(0, Math.min(myR1Count - 1, maxDrawIndex), "rgba(99, 102, 241, 0.2)", 6);
  }
  // Group path
  if (maxChaptersRead > 1) {
    drawPathLine(0, Math.min(maxChaptersRead - 1, maxDrawIndex), pal.grpPath, 7);
  }
  // My path
  if (myChaptersRead > 1) {
    drawPathLine(0, Math.min(myChaptersRead - 1, maxDrawIndex), pal.myPath, 9);
  }

  // ── 8. Draw tile nodes ────────────────────────────────────────────────
  for (let i = 0; i <= maxDrawIndex; i++) {
    const pos = getTileCoords(i);
    const ch = planChapters[i];
    if (!ch) continue;

    // Large circle for book start, small for regular chapters
    const isBookStart = ch.isBookStart;
    const r = isBookStart ? 26 : 15;

    let fillStyle  = "#f8fafc";
    let strokeStyle = "#cbd5e1";
    let textColor  = "#94a3b8";
    let isBold = false;
    let strokeW = isBookStart ? 2.5 : 1.5;

    const isMineRead = i < myChaptersRead;
    const isGrpRead  = !isMineRead && i < maxChaptersRead;

    if (isMineRead) {
      fillStyle   = pal.myFill;
      strokeStyle = pal.myStroke;
      textColor   = pal.myText;
      isBold = true;
      strokeW = isBookStart ? 3.5 : 2.5;
      // Glow for round 2+
      if (currentRound >= 2) {
        ctx.save();
        ctx.shadowColor = pal.myStroke;
        ctx.shadowBlur  = isBookStart ? 18 : 10;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.restore();
      }
    } else if (isGrpRead) {
      fillStyle   = pal.grpFill;
      strokeStyle = pal.grpStroke;
      textColor   = pal.grpText;
      strokeW = isBookStart ? 2.5 : 1.5;
    }

    // Draw main circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth   = strokeW;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();

    // Round 2+: draw dim R1 inner ring on tiles that were read in R1 but not yet in current round
    if (currentRound >= 2 && ch.isReadR1 && !isMineRead) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r - 4, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(99, 102, 241, 0.35)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Book-start: outer ring for emphasis
    if (isBookStart && isMineRead) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = strokeStyle + "55";
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Label text
    ctx.fillStyle     = textColor;
    ctx.textAlign     = "center";
    ctx.textBaseline  = "middle";

    const bookData = BIBLE_BOOKS ? BIBLE_BOOKS.find(b => b.name === ch.bookName) : null;
    if (isBookStart) {
      const abbrev = bookData ? bookData.abbrev : ch.bookName.substring(0, 2);
      ctx.font = `bold 11px sans-serif`;
      ctx.fillText(abbrev, pos.x, pos.y);
    } else {
      ctx.font = isBold ? "bold 9px sans-serif" : "8px sans-serif";
      ctx.fillText(ch.chapterNum, pos.x, pos.y);
    }
  }

  // ── 9. Member avatar badges ───────────────────────────────────────────
  const membersByPos = {};
  groupMembers.forEach(m => {
    const posIndex = Math.max(0, (m.chapters_read || 0) - 1);
    if (!membersByPos[posIndex]) membersByPos[posIndex] = [];
    membersByPos[posIndex].push(m);
  });

  Object.entries(membersByPos).forEach(([posStr, list]) => {
    const posIndex = parseInt(posStr, 10);
    if (posIndex > maxDrawIndex) return;
    const tilePos = getTileCoords(posIndex);
    const count = list.length;
    list.forEach((m, idx) => {
      const angle  = count > 1 ? (idx * 2 * Math.PI) / count : 0;
      const offset = count > 1 ? 18 : 0;
      const x = tilePos.x + Math.cos(angle) * offset;
      const y = tilePos.y + Math.sin(angle) * offset;
      const isMe = m.name === state.currentUser.name;

      ctx.save();
      ctx.shadowColor   = "rgba(0, 0, 0, 0.22)";
      ctx.shadowBlur    = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fillStyle = getMemberColor(m.name);
      ctx.fill();
      ctx.lineWidth   = isMe ? 2.5 : 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle    = "#ffffff";
      ctx.font         = "bold 9px sans-serif";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.name.substring(0, 2), x, y);
    });
  });

  // ── 10. Legend ────────────────────────────────────────────────────────
  const legendEl = document.getElementById("pilgrimage-legend");
  if (legendEl) {
    if (currentRound === 1) {
      legendEl.innerHTML = `
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;width:14px;height:14px;background:${pal.myFill};border:2px solid ${pal.myStroke};border-radius:50%;"></span>我已讀</span>
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;width:10px;height:10px;background:${pal.grpFill};border:1.5px solid ${pal.grpStroke};border-radius:50%;"></span>組員已讀</span>
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;width:18px;height:18px;background:${pal.myFill};border:2.5px solid ${pal.myStroke};border-radius:50%;font-size:9px;text-align:center;line-height:18px;"></span>大圈＝新書卷</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:50%;"></span>後續道路</span>`;
    } else {
      legendEl.innerHTML = `
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;width:14px;height:14px;background:${pal.myFill};border:2px solid ${pal.myStroke};border-radius:50%;box-shadow:0 0 6px ${pal.myStroke};"></span>第${currentRound}遍已讀</span>
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;width:10px;height:10px;background:transparent;border:1.5px solid rgba(99,102,241,0.4);border-radius:50%;"></span>第1遍足跡</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:50%;"></span>後續道路</span>`;
    }
  }

  // ── 11. Auto-scroll to my position ───────────────────────────────────
  const wrapper = canvas.closest(".trail-scroll-wrapper");
  if (wrapper) {
    const myTilePos = getTileCoords(Math.max(0, myChaptersRead - 1));
    setTimeout(() => {
      wrapper.scrollTo({
        top:  Math.max(0, myTilePos.y - wrapper.clientHeight / 2),
        left: Math.max(0, myTilePos.x - wrapper.clientWidth  / 2),
        behavior: "smooth"
      });
    }, 120);
  }
}

function initPilgrimageControls() {
  const board = document.getElementById("pilgrimage-trail-board");
  const zoomIn = document.getElementById("increase-trail-zoom");
  const zoomOut = document.getElementById("decrease-trail-zoom");
  const zoomReset = document.getElementById("reset-trail-zoom");
  
  if (!board) return;
  
  const updateZoom = () => {
    board.style.transform = `scale(${state.pilgrimageZoom})`;
  };
  
  if (zoomIn) {
    zoomIn.onclick = () => {
      if (state.pilgrimageZoom < 2.0) {
        state.pilgrimageZoom += 0.15;
        updateZoom();
      }
    };
  }
  
  if (zoomOut) {
    zoomOut.onclick = () => {
      if (state.pilgrimageZoom > 0.6) {
        state.pilgrimageZoom -= 0.15;
        updateZoom();
      }
    };
  }
  
  if (zoomReset) {
    zoomReset.onclick = () => {
      state.pilgrimageZoom = 1.0;
      updateZoom();
    };
  }
}



window.openAnnouncementForm = function() {
  const form = document.getElementById("admin-announcement-form-container");
  if (form) form.classList.remove("hidden");
};

window.closeAnnouncementForm = function() {
  const form = document.getElementById("admin-announcement-form-container");
  if (form) form.classList.add("hidden");
  
  const titleInput = document.getElementById("announcement-title-input");
  const contentInput = document.getElementById("announcement-content-input");
  if (titleInput) titleInput.value = "";
  if (contentInput) contentInput.value = "";
};

window.saveAnnouncement = async function() {
  const titleInput = document.getElementById("announcement-title-input");
  const contentInput = document.getElementById("announcement-content-input");
  if (!titleInput || !contentInput) return;
  
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title || !content) {
    alert("請輸入公告標題與內容！");
    return;
  }
  
  loader.show("發布公告中...");
  const success = await db.saveAnnouncement(title, content);
  loader.hide();
  
  if (success) {
    if (typeof showToast === "function") {
      showToast("公告已發布成功！");
    }
    window.closeAnnouncementForm();
    await updateAnnouncementsList();
  }
};

window.deleteAnnouncement = async function(id) {
  if (!confirm("確定要刪除此公告嗎？此動作將無法復原。")) return;
  
  loader.show("刪除公告中...");
  const success = await db.deleteAnnouncement(id);
  loader.hide();
  
  if (success) {
    if (typeof showToast === "function") {
      showToast("公告已成功刪除。");
    }
    await updateAnnouncementsList();
  }
};

async function updateAnnouncementsList() {
  const listContainer = document.getElementById("church-announcements-list");
  if (!listContainer) return;
  
  const isAdmin = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'senior_pastor');
  const publishBtn = document.getElementById("btn-show-announcement-form");
  if (publishBtn) {
    if (isAdmin) publishBtn.classList.remove("hidden");
    else publishBtn.classList.add("hidden");
  }
  
  const announcements = await db.fetchAnnouncements();
  listContainer.innerHTML = "";
  
  if (announcements.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem;">目前尚無教會公告。</div>`;
    return;
  }
  
  announcements.forEach(ann => {
    const item = document.createElement("div");
    item.style = `
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-card);
      border-radius: 12px;
      padding: 0.8rem 1rem;
      position: relative;
    `;
    
    const formattedTime = new Date(ann.created_at).toLocaleDateString('zh-TW', { 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.3rem;">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-primary); margin: 0; line-height: 1.4;">${escapeHTML(ann.title)}</h4>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap;">${formattedTime}</span>
          ${isAdmin ? `<button class="circular-action-btn" style="width: 22px; height: 22px; padding: 0; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); display: flex; align-items: center; justify-content: center; font-size: 0.65rem;" onclick="window.deleteAnnouncement('${ann.id}')" title="刪除公告">🗑️</button>` : ''}
        </div>
      </div>
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0; line-height: 1.5; white-space: pre-wrap;">${escapeHTML(ann.content)}</p>
    `;
    listContainer.appendChild(item);
  });
}

let currentVerse = null;
let isVerseLoading = false;
let isImgLoading = false;

// Map Chinese book names to English ones for Bible-API.com
const CHINESE_TO_ENGLISH_BOOKS = {
  "詩篇": "psalms",
  "以賽亞書": "isaiah",
  "箴言": "proverbs",
  "約翰福音": "john",
  "約約翰福音": "john",
  "腓立比書": "philippians",
  "羅馬書": "romans",
  "馬太福音": "matthew",
  "希伯來書": "hebrews",
  "提摩太前書": "1timothy",
  "約書亞記": "joshua",
  "申命記": "deuteronomy",
  "加拉太書": "galatians",
  "約翰一書": "1john",
  "馬可福音": "mark"
};

const CURATED_IMAGE_POOL = [
  "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=800&q=80", // Evening sky reflection
  "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80", // Misty green forest path
  "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=800&q=80", // Sunny field woodland
  "https://images.unsplash.com/photo-1470252649358-96f5e5047118?auto=format&fit=crop&w=800&q=80", // Soft morning sunrise
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80", // Calm sunset beach
  "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?auto=format&fit=crop&w=800&q=80", // Silent starry night
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80"  // Majestic clean mountain peaks
];

async function fetchRandomVerse(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  if (isVerseLoading || isImgLoading) return;
  
  const card = document.getElementById("verse-card");
  const content = document.getElementById("daily-verse-content");
  
  if (!card) return;
  
  isVerseLoading = true;
  isImgLoading = true;
  
  // Enter loading state
  card.classList.add("animate-pulse", "opacity-70");
  if (content) {
    content.classList.add("opacity-40");
  }
  
  // Pick a random local verse
  const randomLocal = DAILY_VERSES[Math.floor(Math.random() * DAILY_VERSES.length)];
  let verseText = randomLocal.text;
  let verseSource = randomLocal.source;
  
  const fetchPromise = (async () => {
    try {
      const match = randomLocal.source.match(/^([\u4e00-\u9fa5]+)\s*(\d+):(\d+)(?:-(\d+))?$/);
      if (match) {
        const chineseBook = match[1];
        const chapter = match[2];
        const verseStart = match[3];
        const verseEnd = match[4];
        const englishBook = CHINESE_TO_ENGLISH_BOOKS[chineseBook] || "john";
        const passage = `${englishBook} ${chapter}:${verseStart}` + (verseEnd ? `-${verseEnd}` : "");
        
        const url = `https://bible-api.com/${encodeURIComponent(passage)}?translation=cuv`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout fallback
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const data = await res.json();
          if (data && data.text) {
            return {
              text: `「${data.text.trim().replace(/\s+/g, " ").replace(/\n/g, "")}」`,
              source: randomLocal.source
            };
          }
        }
      }
    } catch (err) {
      console.warn("Fetch random verse from API failed, falling back to local dataset:", err);
    }
    return { text: verseText, source: verseSource };
  })();
  
  const result = await fetchPromise;
  
  // Pick a random image from the static curated pool
  const randomImgUrl = CURATED_IMAGE_POOL[Math.floor(Math.random() * CURATED_IMAGE_POOL.length)];
  
  // Preload image
  const img = new Image();
  img.onload = () => {
    applyVerseContent(result, randomImgUrl);
  };
  img.onerror = () => {
    console.warn("Failed to load curated image path");
    applyVerseContent(result, "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=800&q=80"); // fallback
  };
  img.src = randomImgUrl;
  
  function applyVerseContent(verseData, imageUrl) {
    const textEl = document.getElementById("daily-verse-text");
    const sourceEl = document.getElementById("daily-verse-source");
    const bgImgEl = document.getElementById("card-bg");
    
    if (textEl) textEl.textContent = verseData.text;
    if (sourceEl) sourceEl.textContent = `— ${verseData.source}`;
    
    if (bgImgEl) {
      bgImgEl.src = imageUrl;
      bgImgEl.style.opacity = "1";
    }
    
    currentVerse = { ...verseData, imageUrl };
    
    // Release loading states
    isVerseLoading = false;
    isImgLoading = false;
    
    card.classList.remove("animate-pulse", "opacity-70");
    if (content) {
      content.classList.remove("opacity-40");
      content.style.opacity = "0";
      void content.offsetWidth; // Force reflow
      content.style.opacity = "1";
    }
  }
}

function renderDailyVerse() {
  const card = document.getElementById("verse-card");
  if (card && !card._hasFlipListener) {
    card.addEventListener("click", fetchRandomVerse);
    card._hasFlipListener = true;
  }

  if (!currentVerse) {
    const dayOfMonth = new Date().getDate();
    currentVerse = DAILY_VERSES[(dayOfMonth - 1) % DAILY_VERSES.length];
    
    const textEl = document.getElementById("daily-verse-text");
    const sourceEl = document.getElementById("daily-verse-source");
    if (textEl) textEl.textContent = currentVerse.text;
    if (sourceEl) sourceEl.textContent = `— ${currentVerse.source}`;
    
    fetchRandomVerse();
  } else {
    const textEl = document.getElementById("daily-verse-text");
    const sourceEl = document.getElementById("daily-verse-source");
    if (textEl) textEl.textContent = currentVerse.text;
    if (sourceEl) sourceEl.textContent = `— ${currentVerse.source}`;
    
    const bgImgEl = document.getElementById("card-bg");
    if (bgImgEl && currentVerse.imageUrl) {
      bgImgEl.src = currentVerse.imageUrl;
      bgImgEl.style.opacity = "1";
    }
  }
}


window.openActivePlanFromDashboard = function(event) {
  console.log('📅 [Debug] 已點選讀經計畫，正在跳轉至計畫頁');
  if (!state.activePlan) return;
  state.planDetailOpen = true;
  state.selectedPlanDay = null;
  localStorage.setItem("selected_plan_key", state.activePlan.presetKey || state.activePlan.id || "");
  appRouter.switchTab('plan-view', { keepPlanDetail: true });
};

/**
 * Switch directly to the Bible Reader and navigate to the user's first unread chapter.
 */
window.startReadingCurrentChapter = function() {
  console.log('📖 [Debug] 已點選章節，進入全滿版沉浸閱讀模式');
  if (!state.activePlan) {
    appRouter.switchTab('reader-view');
    return;
  }

  let targetBook = null;
  let targetChapter = 1;
  let found = false;

  // Search through all days of the active plan for the first unread chapter
  if (state.activePlan.days) {
    for (const day of state.activePlan.days) {
      const unread = day.chapters.find(ch => !ch.isRead);
      if (unread) {
        targetBook = unread.book;
        targetChapter = Number(unread.chapter);
        found = true;
        break;
      }
    }
  }

  // Fallback to the first chapter of the first day if everything is read
  if (!found && state.activePlan.days && state.activePlan.days[0] && state.activePlan.days[0].chapters && state.activePlan.days[0].chapters[0]) {
    targetBook = state.activePlan.days[0].chapters[0].book;
    targetChapter = Number(state.activePlan.days[0].chapters[0].chapter);
  }

  if (targetBook && typeof BIBLE_BOOKS !== 'undefined') {
    const bookObj = BIBLE_BOOKS.find(b => b.name === targetBook);
    if (bookObj) {
      state.readerState.bookId = bookObj.id;
      state.readerState.chapter = targetChapter;
      state.readerState.fromPlan = true;

      // Save preferences to local storage
      if (typeof saveReaderPreferences === 'function') {
        saveReaderPreferences();
      } else {
        localStorage.setItem("reader_state", JSON.stringify({
          bookId: state.readerState.bookId,
          chapter: state.readerState.chapter
        }));
      }
    }
  }

  state.readerState.returnTab = "dashboard-view";

  // Navigate to reader
  appRouter.switchTab('reader-view', { fromPlan: true });
};
