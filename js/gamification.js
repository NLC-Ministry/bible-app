// Bible Speed Reading Gamification: Achievements, Fireworks, and Honor Badges

const ACHIEVEMENTS = [
  {
    id: "subscribe_plan",
    title: "開啟新旅程",
    description: "開啟新旅程：解鎖條件為成功訂閱一個讀經計畫",
    iconClass: "bi bi-calendar-plus",
    color: "#F59E0B",
    shadow: "rgba(245, 158, 11, 0.4)"
  },
  {
    id: "streak_30",
    title: "持之以恆",
    description: "持之以恆：解鎖條件為連續打卡 30 天",
    iconClass: "bi bi-calendar-check",
    color: "#F59E0B",
    shadow: "rgba(245, 158, 11, 0.4)"
  },
  {
    id: "complete_plan",
    title: "榮譽桂冠",
    description: "榮譽桂冠：解鎖條件為 100% 完成任意一個讀經計畫",
    iconClass: "bi bi-award",
    color: "#F59E0B",
    shadow: "rgba(245, 158, 11, 0.4)"
  },
  {
    id: "share_verse",
    title: "傳遞愛光芒",
    description: "傳遞愛光芒：解鎖條件為成功分享每日金句或讀經內容",
    iconClass: "bi bi-share",
    color: "#F59E0B",
    shadow: "rgba(245, 158, 11, 0.4)"
  },
  {
    id: "read_all_bible",
    title: "展開厚聖經",
    description: "展開厚聖經：解鎖條件為讀完全本聖經所有卷書與章節",
    iconClass: "bi bi-book-half",
    color: "#F59E0B",
    shadow: "rgba(245, 158, 11, 0.4)"
  }
];

// Check achievements and trigger popup if newly unlocked
async function checkAchievements() {
  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  const newlyUnlocked = [];

  // 1. Check Subscribe Plan
  if (state.activePlan && !unlocked.includes("subscribe_plan")) {
    newlyUnlocked.push("subscribe_plan");
  }

  // 2. Check Streak 30
  const currentStreak = (state.currentUser && state.currentUser.streak) || 0;
  if (currentStreak >= 30 && !unlocked.includes("streak_30")) {
    newlyUnlocked.push("streak_30");
  }

  // 3. Check Complete Plan
  if (state.activePlan && state.activePlan.days) {
    const allDone = state.activePlan.days.every(d => d.chapters.every(ch => ch.isRead));
    if (allDone && !unlocked.includes("complete_plan")) {
      newlyUnlocked.push("complete_plan");
    }
  }

  // 4. Check Share Verse
  const isShared = localStorage.getItem("has_shared_verse") === "true" || localStorage.getItem("badge_share_verse_unlocked") === "true";
  if (isShared && !unlocked.includes("share_verse")) {
    newlyUnlocked.push("share_verse");
  }

  // 5. Check Read All Bible (1189 total chapters)
  if (state.readingLogs) {
    const uniqueChapters = new Set();
    state.readingLogs.forEach(l => {
      uniqueChapters.add(`${l.book}_${l.chapter}`);
    });
    if (uniqueChapters.size >= 1189 && !unlocked.includes("read_all_bible")) {
      newlyUnlocked.push("read_all_bible");
    }
  }

  if (newlyUnlocked.length > 0) {
    const updatedUnlocked = [...unlocked, ...newlyUnlocked];
    localStorage.setItem("unlocked_badges", JSON.stringify(updatedUnlocked));
  }
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

    // Rocket launch trigger
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
      // Fade out
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

// Popup glassmorphic honor modal
function triggerBadgeUnlockEffect(badgeId) {
  const badge = ACHIEVEMENTS.find(a => a.id === badgeId);
  if (!badge) return;

  // Fire the fireworks!
  launchFireworks();

  // Create full-screen overlay
  const overlay = document.createElement("div");
  overlay.id = `badge-overlay-${badgeId}`;
  overlay.className = "achievement-unlock-overlay";
  overlay.style = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 99998;
    opacity: 0;
    transition: opacity 0.4s ease;
  `;

  // Pulse glow keyframes injected dynamically if not present
  if (!document.getElementById("gamification-keyframes")) {
    const style = document.createElement("style");
    style.id = "gamification-keyframes";
    style.innerHTML = `
      @keyframes pulseGlow {
        0% { transform: scale(1); box-shadow: 0 0 15px var(--glow); }
        50% { transform: scale(1.05); box-shadow: 0 0 35px var(--glow); }
        100% { transform: scale(1); box-shadow: 0 0 15px var(--glow); }
      }
      .badge-popup-avatar {
        animation: pulseGlow 2.5s infinite ease-in-out;
      }
    `;
    document.head.appendChild(style);
  }

  const descParsed = badge.description.replace("{streak}", state.currentUser.streak);

  const card = document.createElement("div");
  card.style = `
    background: var(--bg-card);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    padding: 2.5rem;
    max-width: 420px;
    width: 90%;
    text-align: center;
    box-shadow: var(--shadow-card);
    transform: scale(0.75);
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;

  card.innerHTML = `
    <div class="badge-popup-avatar" style="--glow: ${badge.shadow}; margin: 0 auto 1.5rem auto; display: flex; width: 110px; height: 110px; background: ${badge.color}; border-radius: 50%; justify-content: center; align-items: center;">
      <i class="${badge.iconClass}" style="color: white; font-size: 3.5rem;"></i>
    </div>
    <h3 style="font-size: 1.6rem; font-weight: 500; color: var(--text-primary); margin-bottom: 0.5rem; letter-spacing: 2px;">🏆 榮譽成就解鎖 🏆</h3>
    <h4 style="font-size: 1.35rem; font-weight: 500; background: ${badge.color}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.2rem;">${badge.title}</h4>
    <p style="font-size: 0.92rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 2.2rem; padding: 0 1rem;">${descParsed}</p>
    <button class="primary-btn" style="width: 100%; padding: 0.8rem; font-weight: 500; font-size: 1rem; border-radius: var(--radius-sm);" onclick="closeBadgeModal('${badgeId}')">太棒了，繼續保持！</button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Trigger browser paint to activate transition
  overlay.offsetHeight;
  overlay.style.opacity = "1";
  card.style.transform = "scale(1)";

  window.closeBadgeModal = function(id) {
    const el = document.getElementById(`badge-overlay-${id}`);
    if (el) {
      el.style.opacity = "0";
      el.querySelector("div").style.transform = "scale(0.75)";
      setTimeout(() => {
        el.remove();
        // Update stats wall if container is present
        if (document.getElementById("stats-badge-wall-container")) {
          renderUnlockedBadgesWall();
        }
      }, 400);
    }
  };
}

// Render achievement badge wall — delegates to shared renderBadgeWall in utils.js
function renderUnlockedBadgesWall() {
  renderBadgeWall("stats-badge-wall-container");
}

// YouVersion One-Time congratulatory unlock dialog trigger
window.triggerBadgeUnlockNotification = function(badgeId, badgeName) {
  const hasNotified = localStorage.getItem(`notified_${badgeId}`) === 'true' || localStorage.getItem(`notified_badge-share`) === 'true';
  if (hasNotified) return;

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");

  // Ensure unlock state is saved to the badge wall array
  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  if (!unlocked.includes(badgeId)) {
    unlocked.push(badgeId);
    localStorage.setItem("unlocked_badges", JSON.stringify(unlocked));
  }

  // Look up the badge object
  const badge = ACHIEVEMENTS.find(a => a.id === badgeId) || {
    id: badgeId,
    title: badgeName,
    description: `恭喜解鎖：${badgeName}`,
    iconClass: "bi-share"
  };

  // Open the detail page subpanel to congratulate the user
  const page = document.getElementById("badge-detail-page");
  if (page) {
    page.classList.remove("hidden");
  }
  if (typeof window.openBadgeDetailPage === "function") {
    window.openBadgeDetailPage(badge, true, isDark);
  }

  // In addition, trigger the fireworks animation!
  if (typeof launchFireworks === "function") {
    launchFireworks();
  }

  // Persist lock state so this alert will never show up on page refreshes or re-logins
  localStorage.setItem(`notified_${badgeId}`, 'true');
  if (badgeId === "share_verse" || badgeId === "badge-share") {
    localStorage.setItem(`notified_badge-share`, 'true');
  }
  localStorage.setItem(`${badgeId}_unlocked`, 'true');
};
