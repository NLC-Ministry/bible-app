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
      : `<span class="text-brand" style="font-weight: 500;">等待開始</span> (將於 ${state.activePlan.startDate} 開始)`;
      
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
          <h4 style="font-size: 1.15rem; font-weight: 500; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
          ${started 
            ? '<span class="stat-badge stat-badge--success">進行中</span>'
            : '<span class="stat-badge stat-badge--brand">等待開始</span>'
          }
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.2rem;">
          計畫週期: ${state.activePlan.startDate} ~ ${state.activePlan.endDate} (${state.activePlan.totalDays} 天)
        </p>
        <div class="plan-progress-wrapper plan-progress-wrapper--spaced">
          <div class="plan-progress-bar" style="width: ${progress}%;"></div>
        </div>
        <p style="font-size: 0.88rem; font-weight: 500; color: var(--text-secondary); margin-top: 0.5rem; text-align: right; margin-bottom: 1rem;">
          ${statusText}
        </p>

        <div class="dashboard-stat-strip"
             onclick="event.stopPropagation(); window.showPlanStatsModal ? window.showPlanStatsModal() : null;"
             title="點擊展開詳細統計">
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--warning">
              <span class="nlc-icon dashboard-stat-strip__icon" data-icon="fire" aria-hidden="true"></span>${streakDays} 天
            </span>
            <span class="dashboard-stat-strip__label">連續讀經</span>
          </div>
          <div class="dashboard-stat-strip__divider"></div>
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--brand">
              <span class="nlc-icon dashboard-stat-strip__icon" data-icon="bookOpen" aria-hidden="true"></span>${todayReadCount}/${todayTotalCount} 章
            </span>
            <span class="dashboard-stat-strip__label">今日進度</span>
          </div>
          <div class="dashboard-stat-strip__divider"></div>
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--success">
              <span class="nlc-icon dashboard-stat-strip__icon" data-icon="trendTwo" aria-hidden="true"></span>${totalCompletionRate}%
            </span>
            <span class="dashboard-stat-strip__label">計畫進度</span>
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
        <p style="color: var(--text-secondary); margin-bottom: 1rem;">${(window.APP_COPY && window.APP_COPY.plan.emptyBody) || "還沒加入讀經計畫"}</p>
        <button class="primary-btn" onclick="appRouter.switchTab('plan-view')">${(window.APP_COPY && window.APP_COPY.plan.emptyCta) || "去找計畫"}</button>
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

  if (typeof hydrateIcons === "function") {
    hydrateIcons(document.getElementById("dashboard-view"));
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
    const rankSkeleton = typeof ComponentSkeletonLoader !== "undefined"
      ? ComponentSkeletonLoader.getHtml("inline", { width: "5.5rem", height: "1.4rem" })
      : "—";
    rankGroupEl.innerHTML = rankSkeleton;
    rankZoneEl.innerHTML = rankSkeleton;
    rankRegionEl.innerHTML = rankSkeleton;
    rankChurchEl.innerHTML = rankSkeleton;

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

  rankingContainer.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("ranking", { count: 5 })
    : "";

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
      statusEl.classList.add("text-danger");
      statusEl.classList.remove("text-success-fg");
      statusEl.style.opacity = "1";
    }
  }
}

function showSaveSuccess(isAuto) {
  const statusEl = document.getElementById("devotional-save-status");
  if (!statusEl) return;
  
  statusEl.innerHTML = `
    <span style="width: 5px; height: 5px; background: var(--color-success-foreground); border-radius: 50%; display: inline-block;"></span>
    已自動儲存
  `;
  statusEl.classList.add("text-success-fg");
  statusEl.classList.remove("text-danger");
  statusEl.style.opacity = "1";
  
  if (!isAuto) {
    statusEl.innerHTML = `
      <span style="width: 5px; height: 5px; background: var(--color-success-foreground); border-radius: 50%; display: inline-block;"></span>
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
    listEl.innerHTML = `<div style="font-size: 0.88rem; color: var(--text-muted); text-align: center; padding: 2rem 0;">${(window.APP_COPY && window.APP_COPY.plan.joinProgressHint) || "請先至「計畫」加入計畫，以查看今日進度"}</div>`;
    return;
  }
  
  listEl.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("member-progress", { count: 4 })
    : "";
  
  // Adapt header and search box visibility based on role
  const cardEl = listEl.closest('.glass-card');
  if (cardEl) {
    const cardTitleEl = cardEl.querySelector('.card-title');
    const searchBoxEl = cardEl.querySelector('.search-box-wrapper');
    
    if (state.currentUser && state.currentUser.role === 'member') {
      if (cardTitleEl) {
        cardTitleEl.innerHTML = `
          <span style="color: var(--primary-color);">${typeof renderIcon === "function" ? renderIcon("user", { size: "20px", className: "nlc-icon" }) : ""}</span>
          我的今日讀經進度
        `;
      }
      if (searchBoxEl) {
        searchBoxEl.style.display = 'none';
      }
    } else {
      if (cardTitleEl) {
        cardTitleEl.innerHTML = `
          <span style="color: var(--primary-color);">${typeof renderIcon === "function" ? renderIcon("people", { size: "20px", className: "nlc-icon" }) : ""}</span>
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
        ${typeof renderIcon === "function" ? renderIcon("check", { size: "10px", className: "nlc-icon nlc-icon--inline" }) : ""}
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
  const spacingX = 72;
  const spacingY = 72;
  const startX = 40;
  const startY = 40;
  
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
  if (name === state.currentUser.name) return (window.NLC_DESIGN && NLC_DESIGN.brand) || "#04A9D2";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = window.NLC_MEMBER_COLORS || (window.NLC_DESIGN
    ? [window.NLC_DESIGN.brand, window.NLC_DESIGN.brandHover, window.NLC_DESIGN.success, window.NLC_DESIGN.warning, "#5BB8D4", window.NLC_DESIGN.brandActive, "#8ED4EA", window.NLC_DESIGN.danger]
    : ["#04A9D2", "#0396BA", "#FE7615", "#FC365A"]);
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
  const brand = window.NLC_DESIGN.brand;
  const brandActive = window.NLC_DESIGN.brandActive;
  const brandHover = window.NLC_DESIGN.brandHover;
  const success = window.NLC_DESIGN.success;
  const successFg = window.NLC_DESIGN.successForeground;
  const palette = {
    1: { myPath: brand, grpPath: "#8ED4EA", myFill: "rgba(4,169,210,0.15)", grpFill: "rgba(4,169,210,0.08)", myStroke: brand, grpStroke: brandHover, myText: brandActive, grpText: brandHover },
    2: { myPath: success, grpPath: "#A8F5C0", myFill: "rgba(102,247,143,0.15)", grpFill: "rgba(102,247,143,0.08)", myStroke: success, grpStroke: success, myText: successFg, grpText: successFg },
    3: { myPath: "#f59e0b", grpPath: "#fcd34d", myFill: "#fef3c7", grpFill: "#fffbeb", myStroke: "#d97706", grpStroke: "#ca8a04", myText: "#92400e", grpText: "#b45309" },
  };
  const pal = palette[Math.min(currentRound, 3)];

  // ── 5. Canvas sizing ──────────────────────────────────────────────────
  const cols = 8;
  const spacingX = 72;
  const spacingY = 72;
  const rowsCount = Math.ceil((maxDrawIndex + 1) / cols);
  canvas.width  = cols * spacingX + 15;
  canvas.height = rowsCount * spacingY + 15;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ── 6. Path line helper ───────────────────────────────────────────────
  function drawPathLine(startIndex, endIndex, color, width = 7) {
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
  drawPathLine(0, maxDrawIndex, "rgba(226, 232, 240, 0.8)", 7);
  // Round 1 footprint underlay (visible only on round 2+)
  if (currentRound >= 2 && myR1Count > 1) {
    drawPathLine(0, Math.min(myR1Count - 1, maxDrawIndex), "rgba(4, 169, 210, 0.2)", 5);
  }
  // Group path
  if (maxChaptersRead > 1) {
    drawPathLine(0, Math.min(maxChaptersRead - 1, maxDrawIndex), pal.grpPath, 6);
  }
  // My path
  if (myChaptersRead > 1) {
    drawPathLine(0, Math.min(myChaptersRead - 1, maxDrawIndex), pal.myPath, 8);
  }

  // ── 8. Draw tile nodes ────────────────────────────────────────────────
  for (let i = 0; i <= maxDrawIndex; i++) {
    const pos = getTileCoords(i);
    const ch = planChapters[i];
    if (!ch) continue;

    // Large circle for book start, small for regular chapters
    const isBookStart = ch.isBookStart;
    const r = isBookStart ? 22 : 13;

    let fillStyle  = NLC_DESIGN.white;
    let strokeStyle = NLC_DESIGN.muted;
    let textColor  = NLC_DESIGN.muted;
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
        ctx.shadowBlur  = isBookStart ? 15 : 8;
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
      ctx.arc(pos.x, pos.y, r - 3, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(4, 169, 210, 0.35)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Book-start: outer ring for emphasis
    if (isBookStart && isMineRead) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 3, 0, Math.PI * 2);
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
      ctx.font = `bold 10px sans-serif`;
      ctx.fillText(abbrev, pos.x, pos.y);
    } else {
      ctx.font = isBold ? "bold 8px sans-serif" : "7px sans-serif";
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
      const offset = count > 1 ? 15 : 0;
      const x = tilePos.x + Math.cos(angle) * offset;
      const y = tilePos.y + Math.sin(angle) * offset;
      const isMe = m.name === state.currentUser.name;

      // Draw outer glowing ring (equivalent to ring-2 ring-violet-400/30)
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 15.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(139, 92, 246, 0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.shadowColor   = "rgba(0, 0, 0, 0.15)";
      ctx.shadowBlur    = 4;
      ctx.shadowOffsetY = 1;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = getMemberColor(m.name);
      ctx.fill();
      ctx.lineWidth   = isMe ? 2 : 1;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle    = "#ffffff";
      ctx.font         = "bold 8px sans-serif";
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
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:${pal.myStroke};border-radius:50%;"></span>我</span>
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:${pal.grpStroke};border-radius:50%;"></span>組員</span>
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:var(--color-progress-track);border-radius:50%;"></span>後續</span>`;
    } else {
      legendEl.innerHTML = `
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:${pal.myStroke};border-radius:50%;"></span>R${currentRound}</span>
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:rgba(4,169,210,0.6);border-radius:50%;"></span>R1足跡</span>
        <span class="px-2 py-0.5 rounded-full bg-slate-100/80 dark:bg-zinc-900/50 flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:var(--color-progress-track);border-radius:50%;"></span>後續</span>`;
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
  
  const success = await db.saveAnnouncement(title, content);
  
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
  
  const success = await db.deleteAnnouncement(id);
  
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

  if (typeof ComponentSkeletonLoader !== "undefined") {
    ComponentSkeletonLoader.fill("announcement", listContainer, { count: 2 });
  }
  
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
        <h4 style="font-size: 0.95rem; font-weight: 500; color: var(--text-primary); margin: 0; line-height: 1.4;">${escapeHTML(ann.title)}</h4>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap;">${formattedTime}</span>
          ${isAdmin ? `<button class="circular-action-btn btn-danger-soft" onclick="window.deleteAnnouncement('${ann.id}')" title="刪除公告" aria-label="刪除公告"><span class="nlc-icon" data-icon="trash" aria-hidden="true"></span></button>` : ''}
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

const VERSE_CARD_FALLBACK_IMAGE = CURATED_IMAGE_POOL[0];

function setVerseCardLoading(loading) {
  const card = document.getElementById("verse-card");
  const skeleton = document.getElementById("verse-card-skeleton");
  const body = document.getElementById("verse-card-body");
  const bgImgEl = document.getElementById("card-bg");
  if (!card) return;

  card.classList.toggle("is-loading", loading);

  if (loading) {
    if (skeleton && typeof ComponentSkeletonLoader !== "undefined") {
      ComponentSkeletonLoader.fill("verse-card", skeleton);
    }
    if (body) body.setAttribute("aria-hidden", "true");
    if (bgImgEl) bgImgEl.style.opacity = "0";
  } else if (body) {
    body.removeAttribute("aria-hidden");
  }
}

function preloadVerseCardImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(VERSE_CARD_FALLBACK_IMAGE);
    img.src = url;
  });
}

function applyVerseCardContent(verseData, imageUrl) {
  const card = document.getElementById("verse-card");
  const textEl = document.getElementById("daily-verse-text");
  const sourceEl = document.getElementById("daily-verse-source");
  const bgImgEl = document.getElementById("card-bg");
  const content = document.getElementById("daily-verse-content");

  if (textEl) textEl.textContent = verseData.text;
  if (sourceEl) sourceEl.textContent = verseData.source;

  if (bgImgEl) {
    bgImgEl.src = imageUrl;
    bgImgEl.style.opacity = "1";
  }

  currentVerse = { ...verseData, imageUrl };
  if (typeof syncVerseLikes === "function") {
    syncVerseLikes(verseData.source);
  }

  setVerseCardLoading(false);
  isVerseLoading = false;
  isImgLoading = false;

  const toolbar = document.getElementById("verse-card-toolbar");
  if (toolbar && typeof hydrateIcons === "function") {
    hydrateIcons(toolbar);
  }

  card?.classList.remove("opacity-90");
  if (content) {
    content.classList.remove("opacity-40");
    content.style.opacity = "0";
    void content.offsetWidth;
    content.style.opacity = "1";
  }
}

async function fetchRandomVerse(event) {
  if (event) {
    if (event.target.closest(".social-toolbar") || event.target.closest("#share-card-btn")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
  
  if (isVerseLoading || isImgLoading) return;
  
  const card = document.getElementById("verse-card");
  if (!card) return;
  
  isVerseLoading = true;
  isImgLoading = true;
  
  // Set flag for sharing badge check
  localStorage.setItem("has_shared_verse", "true");
  if (typeof checkAchievements === "function") {
    checkAchievements();
  }
  
  setVerseCardLoading(true);
  
  const randomLocal = DAILY_VERSES[Math.floor(Math.random() * DAILY_VERSES.length)];
  const verseText = randomLocal.text;
  const verseSource = randomLocal.source;
  const randomImgUrl = CURATED_IMAGE_POOL[Math.floor(Math.random() * CURATED_IMAGE_POOL.length)];
  const imgPromise = preloadVerseCardImage(randomImgUrl);
  
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
  
  const [result, loadedUrl] = await Promise.all([fetchPromise, imgPromise]);
  applyVerseCardContent(result, loadedUrl);
}

async function shareAsImage(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  const shareBtn = document.getElementById("share-card-btn");
  const card = document.getElementById("verse-card");
  if (!card) return;
  
  if (shareBtn) {
    shareBtn.disabled = true;
    shareBtn.innerHTML = `<span class="nlc-icon" data-icon="refresh" data-icon-size="22px" aria-hidden="true"></span><span>分享中</span>`;
    if (typeof hydrateIcons === "function") hydrateIcons(shareBtn);
  }
  
  // 🛡️ 截圖前：將 toolbar 提升到 try 外層，保證 finally 能恢復
  const toolbar = document.getElementById("verse-card-toolbar");

  try {
    // 暫時隱藏工具列（避免按鈕截入圖片、Bootstrap icon 字型破圖）
    if (toolbar) toolbar.style.visibility = "hidden";

    // 1. 使用 html2canvas 將卡片轉為 Blob 圖片物件
    const canvas = await html2canvas(card, {
      useCORS: true,
      scale: 2,
      logging: false,
      ignoreElements: (el) => {
        // 物理過濾：工具列容器、所有按鈕
        return el.id === "verse-card-toolbar" || el.tagName === "BUTTON";
      }
    });

    canvas.toBlob(async (blob) => {
      if (!blob) return alert('圖片產生失敗');
      
      const file = new File([blob], 'daily-verse.png', { type: 'image/png' });
      
      // 2. 【核心防禦】：檢查瀏覽器是否支援 Web Share API 且支援分享檔案
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: (window.APP_COPY && window.APP_COPY.verse.shareTitle) || "今日經文",
            text: (window.APP_COPY && window.APP_COPY.verse.shareText) || "分享今日經文給你"
          });
          
          localStorage.setItem("has_shared_verse", "true");
          localStorage.setItem("badge_share_verse_unlocked", "true");
          if (typeof window.triggerBadgeUnlockNotification === "function") {
            window.triggerBadgeUnlockNotification("share_verse", "傳遞愛光芒");
          } else if (typeof checkAchievements === "function") {
            checkAchievements();
          }
        } catch (shareError) {
          // 如果使用者在中途取消分享，不報錯，安靜結束
          if (shareError.name !== 'AbortError') {
            fallbackDownload(canvas);
          }
        }
      } else {
        // 3. 【退路機制】：若在 localhost、非 HTTPS 環境或不支援的手機上，直接觸發下載
        fallbackDownload(canvas);
      }
    }, 'image/png');

  } catch (error) {
    console.error('產生分享圖片時發生錯誤:', error);
    alert((window.APP_COPY && window.APP_COPY.verse.shareFail) || '分享失敗，等一下再試試');
  } finally {
    // 🛡️ 無論成功或失敗，一律恢復工具列可見度
    if (toolbar) toolbar.style.visibility = "";
    if (shareBtn) {
      setTimeout(() => {
        shareBtn.disabled = false;
        shareBtn.innerHTML = `<span class="nlc-icon" data-icon="share" data-icon-size="22px" aria-hidden="true"></span><span>${(window.APP_COPY && window.APP_COPY.verse.share) || "分享"}</span>`;
        if (typeof hydrateIcons === "function") hydrateIcons(shareBtn);
      }, 1000);
    }
  }
}

// 輔助下載函式：確保在電腦版或非安全環境下也能拿到圖片
function fallbackDownload(canvas) {
  const link = document.createElement('a');
  link.download = 'daily-verse.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  
  localStorage.setItem("has_shared_verse", "true");
  localStorage.setItem("badge_share_verse_unlocked", "true");
  if (typeof window.triggerBadgeUnlockNotification === "function") {
    window.triggerBadgeUnlockNotification("share_verse", "傳遞愛光芒");
  } else if (typeof checkAchievements === "function") {
    checkAchievements();
  }
}

async function syncVerseLikes(verseSource) {
  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const likeBtn = document.getElementById("like-btn");
  const label = document.getElementById("like-count-text");
  if (!likeBtn || !label) return;

  // 1. Initial optimistic local UI state
  let count = parseInt(localStorage.getItem(`verse_like_count_${verseSource}`) || "0");
  let liked = localStorage.getItem(`verse_liked_${verseSource}`) === "true";
  
  const updateUI = () => {
    const iconEl = likeBtn.querySelector(".nlc-icon");
    if (iconEl) {
      iconEl.setAttribute("data-icon", liked ? "heartFill" : "heart");
      likeBtn.classList.toggle("is-liked", liked);
      iconEl.style.color = "";
      if (typeof hydrateIcons === "function") hydrateIcons(likeBtn);
    }
    if (label) {
      label.textContent = count >= 10000 ? `${(count / 10000).toFixed(1)}萬` : count;
    }
  };
  
  updateUI();

  // 2. Fetch fresh like_count from Supabase
  if (state.supabase && state.isSupabaseMode) {
    try {
      const { data, error } = await state.supabase.from("verse_likes").select("like_count").eq("source", verseSource).maybeSingle();
      if (!error) {
        if (data) {
          count = data.like_count || 0;
          localStorage.setItem(`verse_like_count_${verseSource}`, count.toString());
          updateUI();
        } else {
          // Row does not exist yet: insert default count 0
          const initialCount = 0;
          await state.supabase.from("verse_likes").insert({ source: verseSource, like_count: initialCount }).execute();
          count = initialCount;
          localStorage.setItem(`verse_like_count_${verseSource}`, count.toString());
          updateUI();
        }
      }
    } catch (e) {
      console.warn("Failed to sync like count from Supabase:", e);
    }
  }
}

async function toggleVerseLike(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  if (!currentVerse || !currentVerse.source) return;
  const verseSource = currentVerse.source;
  
  const likeBtn = document.getElementById("like-btn");
  const label = document.getElementById("like-count-text");
  if (!likeBtn || !label) return;

  let liked = localStorage.getItem(`verse_liked_${verseSource}`) === "true";
  let count = parseInt(localStorage.getItem(`verse_like_count_${verseSource}`) || "0");

  // Optimistic UI updates
  liked = !liked;
  count += liked ? 1 : -1;

  localStorage.setItem(`verse_liked_${verseSource}`, liked ? "true" : "false");
  localStorage.setItem(`verse_like_count_${verseSource}`, count.toString());

  // Renders optimistic state instantly
  const iconEl = likeBtn.querySelector(".nlc-icon");
  if (iconEl) {
    iconEl.setAttribute("data-icon", liked ? "heartFill" : "heart");
    likeBtn.classList.toggle("is-liked", liked);
    iconEl.style.color = "";
    if (typeof hydrateIcons === "function") hydrateIcons(likeBtn);
  }
  if (label) {
    label.textContent = count >= 10000 ? `${(count / 10000).toFixed(1)}萬` : count;
  }

  // Persists async Supabase request in background
  if (state.supabase && state.isSupabaseMode) {
    try {
      if (typeof state.supabase.rpc === "function") {
        const rpcName = liked ? "increment_likes" : "decrement_likes";
        const { data, error } = await state.supabase.rpc(rpcName, { verse_source: verseSource }).execute();
        if (!error && typeof data === "number") {
          localStorage.setItem(`verse_like_count_${verseSource}`, data.toString());
          if (label) {
            label.textContent = data >= 10000 ? `${(data / 10000).toFixed(1)}萬` : data;
          }
        }
      } else {
        const { data, error } = await state.supabase.from("verse_likes").select("like_count").eq("source", verseSource).maybeSingle();
        if (!error && data) {
          const latestDbCount = data.like_count || 0;
          const newDbCount = latestDbCount + (liked ? 1 : -1);
          await state.supabase.from("verse_likes").update({ like_count: newDbCount }).eq("source", verseSource).execute();
          
          localStorage.setItem(`verse_like_count_${verseSource}`, newDbCount.toString());
          if (label) {
            label.textContent = newDbCount >= 10000 ? `${(newDbCount / 10000).toFixed(1)}萬` : newDbCount;
          }
        }
      }
    } catch (dbErr) {
      console.warn("Failed to toggle like on Supabase:", dbErr);
    }
  }
}

function renderDailyVerse() {
  const card = document.getElementById("verse-card");
  // Clicking the card backdrop/overlay is disabled; drawing a new card is only allowed via draw-card-btn.

  const shareBtn = document.getElementById("share-card-btn");
  if (shareBtn && !shareBtn._hasShareListener) {
    shareBtn.addEventListener("click", shareAsImage);
    shareBtn._hasShareListener = true;
  }

  const drawBtn = document.getElementById("draw-card-btn");
  if (drawBtn && !drawBtn._hasDrawListener) {
    drawBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fetchRandomVerse();
    });
    drawBtn._hasDrawListener = true;
  }

  const likeBtn = document.getElementById("like-btn");
  if (likeBtn && !likeBtn._hasLikeListener) {
    likeBtn.addEventListener("click", toggleVerseLike);
    likeBtn._hasLikeListener = true;
  }

  if (!currentVerse) {
    setVerseCardLoading(true);
    fetchRandomVerse();
  } else {
    setVerseCardLoading(true);
    const imageUrl = currentVerse.imageUrl || CURATED_IMAGE_POOL[(new Date().getDate() - 1) % CURATED_IMAGE_POOL.length];
    preloadVerseCardImage(imageUrl).then((loadedUrl) => {
      applyVerseCardContent(
        { text: currentVerse.text, source: currentVerse.source },
        loadedUrl
      );
    });
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
