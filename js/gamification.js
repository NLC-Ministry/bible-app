// Bible Speed Reading Gamification: Achievements, Fireworks, and Honor Badges

const ACHIEVEMENTS = [
  {
    id: "subscribe_plan",
    title: "開啟新旅程",
    description: "成功加入一個讀經計畫",
    triggerText: "加入 1 個計畫點亮第一顆星，最多累積 5 顆星",
    iconKey: "calendarPlus"
  },
  {
    id: "streak_30",
    title: "持之以恆",
    description: "連續打卡 30 天",
    triggerText: "連續打卡 1 天點亮第一顆星，7、14、21、30 天逐級升星",
    iconKey: "calendarCheck"
  },
  {
    id: "complete_plan",
    title: "榮譽桂冠",
    description: "100% 完成任意一個讀經計畫",
    triggerText: "完成 1 個計畫點亮第一顆星，最多累積 5 顆星",
    iconKey: "award"
  },
  {
    id: "share_verse",
    title: "傳遞愛光芒",
    description: "分享一次今日經文",
    triggerText: "分享 1 次點亮第一顆星，5、10、25、50 次逐級升星",
    iconKey: "share"
  },
  {
    id: "read_all_bible",
    title: "展開厚聖經",
    description: "讀完全本聖經所有卷書與章節",
    triggerText: "讀完 10 章點亮第一顆星，100、500、800、1189 章逐級升星",
    iconKey: "bookOpen"
  }
];

const CAMPAIGN_STAGE_ACHIEVEMENTS = typeof window.createChurchCampaignStageDefinitions === "function"
  ? window.createChurchCampaignStageDefinitions().map(stage => ({
      id: "church_stage_award_" + stage.stageNo,
      title: stage.awardName,
      description: "完成「" + stage.name + "」讀經計畫",
      triggerText: "第一遍進行中先顯示一顆未亮星；每完成一遍點亮一顆星",
      iconKey: "award",
      campaignStageNo: stage.stageNo
    }))
  : [];
ACHIEVEMENTS.push(...CAMPAIGN_STAGE_ACHIEVEMENTS);
ACHIEVEMENTS.forEach(badge => {
  badge.designVersion = 2;
  badge.maxStars = 5;
});

const BADGE_UNLOCK_LEVELS = Object.fromEntries(ACHIEVEMENTS.map(badge => [badge.id, 1]));

function formatBadgeUnlockDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function recordBadgeUnlockDate(badgeId) {
  const level = BADGE_UNLOCK_LEVELS[badgeId];
  if (!level) return;
  const key = `date_unlocked_${badgeId}_lvl_${level}`;
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, formatBadgeUnlockDate());
  }
}

function refreshBadgeSurfaces() {
  if (typeof renderBadgeWall === "function") {
    renderBadgeWall("badges-grid");
  }
  if (typeof renderBadgeStrip === "function") {
    renderBadgeStrip("dashboard-badge-strip", { linkToProfile: true });
    renderBadgeStrip("plan-badge-strip");
  }
}

// Check achievements and trigger popup if newly unlocked
async function checkAchievements(silent = false) {
  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  const newlyUnlocked = [];

  ACHIEVEMENTS.forEach(badge => {
    const stateInfo = typeof window.getBadgeStarState === "function"
      ? window.getBadgeStarState(badge)
      : { level: unlocked.includes(badge.id) ? 1 : 0 };
    for (let star = 1; star <= stateInfo.level; star++) {
      const dateKey = `date_unlocked_${badge.id}_lvl_${star}`;
      if (!localStorage.getItem(dateKey)) localStorage.setItem(dateKey, formatBadgeUnlockDate());
    }
    if (stateInfo.level > 0 && !unlocked.includes(badge.id)) newlyUnlocked.push(badge.id);
  });

  if (newlyUnlocked.length === 0) {
    refreshBadgeSurfaces();
    return;
  }

  const updatedUnlocked = [...new Set([...unlocked, ...newlyUnlocked])];
  localStorage.setItem("unlocked_badges", JSON.stringify(updatedUnlocked));
  newlyUnlocked.forEach(function (badgeId, index) {
    if (silent) {
      localStorage.setItem(`notified_${badgeId}`, "true");
      localStorage.setItem(`${badgeId}_unlocked`, "true");
    } else {
      if (index === 0 && typeof window.triggerBadgeUnlockNotification === "function") {
        const badge = ACHIEVEMENTS.find(item => item.id === badgeId);
        if (badge) window.triggerBadgeUnlockNotification(badgeId, badge.title);
      } else {
        localStorage.setItem(`notified_${badgeId}`, "true");
      }
    }
  });
  refreshBadgeSurfaces();
}

// Particle system Canvas Fireworks
function launchFireworks() {
  const canvas = document.createElement("canvas");
  canvas.id = "fireworks-canvas";
  canvas.style = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 99999;";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  const resizeHandler = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  window.addEventListener("resize", resizeHandler);

  const particles = [];

  class Particle {
    constructor(x, y, color) {
      this.x = x;
      this.y = y;
      this.color = color;
      this.angle = Math.random() * Math.PI * 2;
      this.speed = Math.random() * 6 + 2;
      this.vx = Math.cos(this.angle) * this.speed;
      this.vy = Math.sin(this.angle) * this.speed;
      this.gravity = 0.06;
      this.alpha = 1;
      this.decay = Math.random() * 0.015 + 0.01;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.gravity;
      this.alpha -= this.decay;
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.random() * 2 + 2, 0, Math.PI * 2);
      ctx.shadowBlur = 10;
      ctx.shadowColor = this.color;
      ctx.fill();
      ctx.restore();
    }
  }

  function createExplosion(x, y) {
    const colors = ["#ff5252", "#ffeb3b", "#00e676", "#2979ff", "#e040fb", "#ff9100", "#18ffff"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 80; i++) {
      particles.push(new Particle(x, y, color));
    }
  }

  let frameCount = 0;
  function animate() {
    ctx.clearRect(0, 0, width, height);

    if (frameCount % 25 === 0) {
      createExplosion(
        Math.random() * width * 0.8 + width * 0.1,
        Math.random() * height * 0.5 + height * 0.15
      );
    }
    frameCount++;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      } else {
        p.draw();
      }
    }

    if (frameCount < 160) {
      requestAnimationFrame(animate);
    } else {
      canvas.style.transition = "opacity 0.8s ease";
      canvas.style.opacity = "0";
      setTimeout(() => {
        canvas.remove();
        window.removeEventListener("resize", resizeHandler);
      }, 800);
    }
  }

  animate();
}

function renderUnlockedBadgesWall() {
  if (typeof renderBadgeStrip === "function") {
    renderBadgeStrip("plan-badge-strip");
  }
}

window.triggerBadgeUnlockNotification = function(badgeId, badgeName) {
  const hasNotified = localStorage.getItem(`notified_${badgeId}`) === "true" ||
    localStorage.getItem("notified_badge-share") === "true";
  if (hasNotified) return;

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");

  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  if (!unlocked.includes(badgeId)) {
    unlocked.push(badgeId);
    localStorage.setItem("unlocked_badges", JSON.stringify(unlocked));
  }

  recordBadgeUnlockDate(badgeId);

  const badge = ACHIEVEMENTS.find(a => a.id === badgeId) || {
    id: badgeId,
    title: badgeName,
    description: `恭喜解鎖：${badgeName}`,
    triggerText: `完成條件後解鎖「${badgeName}」`,
    iconKey: "share"
  };

  const page = document.getElementById("badge-detail-page");
  if (page) {
    page.classList.remove("hidden");
  }
  if (typeof window.openBadgeDetailPage === "function") {
    window.openBadgeDetailPage(badge, true, isDark);
  }

  if (typeof launchFireworks === "function") {
    launchFireworks();
  }

  localStorage.setItem(`notified_${badgeId}`, "true");
  if (badgeId === "share_verse" || badgeId === "badge-share") {
    localStorage.setItem("notified_badge-share", "true");
  }
  localStorage.setItem(`${badgeId}_unlocked`, "true");

  refreshBadgeSurfaces();
};


window.refreshBadgeSurfaces = refreshBadgeSurfaces;
window.launchFireworks = launchFireworks;
window.renderUnlockedBadgesWall = renderUnlockedBadgesWall;
window.ACHIEVEMENTS = ACHIEVEMENTS;
window.BADGE_UNLOCK_LEVELS = BADGE_UNLOCK_LEVELS;
window.checkAchievements = checkAchievements;
window.recordBadgeUnlockDate = recordBadgeUnlockDate;

