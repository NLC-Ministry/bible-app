// Bible Speed Reading Gamification: Achievements, Fireworks, and Honor Badges

const ACHIEVEMENTS = [
  {
    id: "streak_7",
    title: "初嚐甘甜",
    description: "連續讀經打卡達到 7 天 (目前: {streak}天)",
    icon: "🔥",
    color: "linear-gradient(135deg, #f35f5f 0%, #fca468 100%)",
    shadow: "rgba(243, 95, 95, 0.4)"
  },
  {
    id: "pentateuch",
    title: "摩西五經大師",
    description: "讀完創世記、出埃及記、利未記、民數記、申命記的全部章節",
    icon: "📜",
    color: "linear-gradient(135deg, #0ba395 0%, #35e478 100%)",
    shadow: "rgba(11, 163, 149, 0.4)"
  },
  {
    id: "record_breaker",
    title: "讀經精兵",
    description: "單日讀經打卡數量達到 5 章或以上 (今日自我突破！)",
    icon: "⚡",
    color: "linear-gradient(135deg, #8815b3 0%, #e02874 50%, #f36417 100%)",
    shadow: "rgba(224, 40, 116, 0.4)"
  }
];

// Check achievements and trigger popup if newly unlocked
async function checkAchievements() {
  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  const newlyUnlocked = [];

  // 1. Check Streak 7
  const currentStreak = state.currentUser.streak || 0;
  if (currentStreak >= 7 && !unlocked.includes("streak_7")) {
    newlyUnlocked.push("streak_7");
  }

  // 2. Check Pentateuch Master
  const pentateuchBooks = ["創世記", "出埃及記", "利未記", "民數記", "申命記"];
  const isPentateuchDone = pentateuchBooks.every(bookName => {
    const book = BIBLE_BOOKS.find(b => b.name === bookName);
    if (!book) return false;
    const readChapters = state.readingLogs.filter(l => l.book === bookName);
    return readChapters.length >= book.chapters;
  });
  if (isPentateuchDone && !unlocked.includes("pentateuch")) {
    newlyUnlocked.push("pentateuch");
  }

  // 3. Check Record Breaker (Single day chapters read >= 5)
  const dateCounts = {};
  state.readingLogs.forEach(l => {
    if (l.read_at) {
      const dateStr = l.read_at.substring(0, 10);
      dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
    }
  });
  const maxChaptersInDay = Math.max(0, ...Object.values(dateCounts));
  if (maxChaptersInDay >= 5 && !unlocked.includes("record_breaker")) {
    newlyUnlocked.push("record_breaker");
  }

  if (newlyUnlocked.length > 0) {
    const updatedUnlocked = [...unlocked, ...newlyUnlocked];
    localStorage.setItem("unlocked_badges", JSON.stringify(updatedUnlocked));

    // Launch popups sequentially with minor delays
    newlyUnlocked.forEach((badgeId, index) => {
      setTimeout(() => {
        triggerBadgeUnlockEffect(badgeId);
      }, index * 4500);
    });
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
    <div class="badge-popup-avatar" style="--glow: ${badge.shadow}; font-size: 4.8rem; margin: 0 auto 1.5rem auto; display: flex; width: 110px; height: 110px; background: ${badge.color}; border-radius: 50%; justify-content: center; align-items: center;">
      ${badge.icon}
    </div>
    <h3 style="font-size: 1.6rem; font-weight: 800; color: var(--text-primary); margin-bottom: 0.5rem; letter-spacing: 2px;">🏆 榮譽成就解鎖 🏆</h3>
    <h4 style="font-size: 1.35rem; font-weight: 800; background: ${badge.color}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.2rem;">「${badge.title}」</h4>
    <p style="font-size: 0.92rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 2.2rem; padding: 0 1rem;">${descParsed}</p>
    <button class="primary-btn" style="width: 100%; padding: 0.8rem; font-weight: 700; font-size: 1rem; border-radius: var(--radius-sm);" onclick="closeBadgeModal('${badgeId}')">太棒了，繼續保持！</button>
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
        // Update stats wall if viewing stats tab
        if (appRouter.currentTab === "stats-view") {
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
