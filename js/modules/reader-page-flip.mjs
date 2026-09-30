// js/modules/reader-page-flip.mjs
//
// 讀經頁翻頁動畫（#347）：「兩張輕量紙片」。
// 真正的經文頁（.reader-reading-surface）從頭到尾都不移動——整章可能好幾萬 px 高，拿來做
// 3D 變形會吃爆手機 GPU，也會拖著選取工具列一起跑、干擾章末自動打卡的捲動偵測。
// 改成在閱讀區上方疊一層「舞台」，裡面只有：
//   · 目前畫面的快照（只複製螢幕上看得到的那幾節）
//   · 目標章開頭的預覽（從預載快取做）
// 動畫只動這兩張紙片；取消就收掉，真正的頁面完全沒變。確認翻頁時，真正的換章在紙片底下
// 進行，動畫結束再把舞台拿掉（預覽＝換完的頁面開頭，看不出切換）。
//
// 放開手指之後的動畫交給 Web Animations（只動 transform / opacity，由合成器執行），
// 主執行緒在底下重畫整章也不會讓動畫卡住。

export const FLIP_LITE_STORAGE_KEY = "bible_reader_flip_lite";

// 輕 3D：頁面以左側書脊為軸最多傾斜幾度。
export const FLIP_MAX_TILT_DEG = 10;
// 底下那一頁被蓋住時最暗到多少（0–1 的黑色遮罩透明度）。
export const FLIP_MAX_DIM = 0.16;

const RELEASE_EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";
// 換章若遲遲沒畫完（沒快取、網路慢），最多等這麼久就收掉舞台，底下會是載入中的骨架畫面。
const COMMIT_RENDER_WAIT_MS = 1500;

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// 翻頁進度 progress（0＝還沒翻、1＝翻完）→ 會動的那張紙片要擺在哪。
// direction  1（下一章）：會動的是「目前這頁」，往左拉走，露出底下的下一章。
// direction -1（上一章）：會動的是「上一章」，從左邊蓋回來，蓋住目前這頁。
// x 是以舞台寬度為單位的位移比例；dim 是被蓋住那一頁的遮罩透明度。
export function computeFlipFrame(direction, progress, { lite = false } = {}) {
  const p = clamp01(progress);
  const covered = direction > 0 ? 1 - p : p; // 底下那頁「被蓋住」的程度
  const offset = direction > 0 ? -p : -(1 - p);
  return {
    x: offset,
    rotate: lite ? 0 : -FLIP_MAX_TILT_DEG * Math.abs(offset),
    dim: lite ? 0 : FLIP_MAX_DIM * covered
  };
}

// 剩下的距離用多久走完：跟著放手的速度，但限制在 160–320ms。
export function computeFlipDuration(remainingFraction, velocity, width) {
  const remainingPx = clamp01(remainingFraction) * (Number(width) || 0);
  const speed = Math.abs(Number(velocity) || 0);
  const byVelocity = speed > 0.2 ? remainingPx / speed : Infinity;
  const byDistance = 320 * clamp01(remainingFraction);
  const ms = Math.min(byVelocity, byDistance);
  return Math.round(Math.max(160, Math.min(320, ms)));
}

function stripIds(node) {
  if (!node || node.nodeType !== 1) return node;
  node.removeAttribute("id");
  node.querySelectorAll?.("[id]").forEach(el => el.removeAttribute("id"));
  return node;
}

function placeAbsolutely(clone, rect, originRect) {
  clone.style.position = "absolute";
  clone.style.left = `${rect.left - originRect.left}px`;
  clone.style.top = `${rect.top - originRect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.margin = "0";
  clone.style.boxSizing = "border-box";
  return clone;
}

// 目前畫面的快照：只複製跟舞台有交集的區塊（標題、經文節、章末那幾列），
// 每塊依量到的位置絕對定位。經文放在一個淺層複製的容器裡，保住內聯的字級設定。
export function buildViewportSnapshot({ header, container, stageRect, doc = document }) {
  const page = doc.createElement("div");
  page.className = "reader-flip-page";
  const visible = rect => rect.bottom > stageRect.top && rect.top < stageRect.bottom && rect.height > 0;

  if (header) {
    const rect = header.getBoundingClientRect();
    if (visible(rect)) page.appendChild(placeAbsolutely(stripIds(header.cloneNode(true)), rect, stageRect));
  }
  if (container) {
    const shell = stripIds(container.cloneNode(false));
    shell.classList.add("reader-flip-shell");
    shell.style.position = "absolute";
    shell.style.inset = "0";
    shell.style.padding = "0";
    let started = false;
    for (const child of Array.from(container.children)) {
      const rect = child.getBoundingClientRect();
      if (visible(rect)) {
        started = true;
        shell.appendChild(placeAbsolutely(stripIds(child.cloneNode(true)), rect, stageRect));
      } else if (started && rect.top >= stageRect.bottom) {
        break; // 後面的都在螢幕下方
      }
    }
    page.appendChild(shell);
  }
  return page;
}

// 目標章開頭的預覽：標題＋經文照正常排版，擺在「捲到最上面時」標題會在的位置，
// 這樣換完章、舞台拿掉的那一刻畫面完全一樣。
export function buildChapterPreview({ header, container, surface, stageRect, headingText, fillContent, doc = document }) {
  const page = doc.createElement("div");
  page.className = "reader-flip-page";
  const headerRect = header ? header.getBoundingClientRect() : null;
  const anchorRect = headerRect || container.getBoundingClientRect();
  const scrollTop = Number(surface?.scrollTop) || 0;
  const flow = doc.createElement("div");
  flow.className = "reader-flip-flow";
  flow.style.position = "absolute";
  flow.style.left = `${anchorRect.left - stageRect.left}px`;
  flow.style.top = `${anchorRect.top + scrollTop - stageRect.top}px`;
  flow.style.width = `${anchorRect.width}px`;
  if (header) {
    const headerClone = stripIds(header.cloneNode(true));
    const heading = headerClone.querySelector(".bible-heading, h2");
    if (heading) heading.textContent = headingText;
    flow.appendChild(headerClone);
  }
  const shell = stripIds(container.cloneNode(false));
  fillContent(shell);
  flow.appendChild(shell);
  page.appendChild(flow);
  return page;
}

function readLiteFlag(storage) {
  try { return storage?.getItem(FLIP_LITE_STORAGE_KEY) === "1"; } catch { return false; }
}

function writeLiteFlag(storage) {
  try { storage?.setItem(FLIP_LITE_STORAGE_KEY, "1"); } catch { /* 無痕模式等：這次就好 */ }
}

/**
 * 翻頁控制器。
 * - host: 放舞台的元素（#reader-view；要是定位容器）
 * - getStageRect(): 舞台該蓋住的範圍（閱讀區扣掉底部分頁列）
 * - buildCurrentPage(stageRect) / buildTargetPage(direction, stageRect): 做紙片（見上面兩個 build 函式）
 * - onCommit(direction): 真正換章，回傳 Promise
 */
export function createReaderPageFlip({
  host,
  getStageRect,
  buildCurrentPage,
  buildTargetPage,
  onCommit,
  win = typeof window !== "undefined" ? window : null,
  doc = typeof document !== "undefined" ? document : null,
  storage = (() => { try { return win?.localStorage; } catch { return null; } })()
} = {}) {
  let session = null;
  let lite = readLiteFlag(storage);

  const reducedMotion = () => Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const raf = cb => (win?.requestAnimationFrame ? win.requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16));
  const cancelRaf = id => (win?.cancelAnimationFrame ? win.cancelAnimationFrame(id) : clearTimeout(id));

  function frameStyles(direction, progress) {
    const frame = computeFlipFrame(direction, progress, { lite: lite || reducedMotion() });
    return {
      transform: `translate3d(${Math.round(frame.x * session.width * 10) / 10}px, 0, 0) rotateY(${Math.round(frame.rotate * 100) / 100}deg)`,
      dim: String(Math.round(frame.dim * 1000) / 1000)
    };
  }

  function applyProgress(progress) {
    if (!session) return;
    session.progress = clamp01(progress);
    const { transform, dim } = frameStyles(session.direction, session.progress);
    session.mover.style.transform = transform;
    session.dim.style.opacity = dim;
  }

  function teardown() {
    if (!session) return;
    const current = session;
    session = null;
    if (current.rafId) cancelRaf(current.rafId);
    current.animations.forEach(animation => { try { animation.cancel(); } catch { /* 已結束 */ } });
    current.stage.remove();
  }

  function begin(direction) {
    finishNow();
    if (!host || !doc || !direction) return false;
    const stageRect = getStageRect?.();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) return false;

    const moverIsCurrent = direction > 0;
    let mover;
    let under = null;
    try {
      mover = moverIsCurrent ? buildCurrentPage(stageRect) : buildTargetPage(direction, stageRect);
      if (moverIsCurrent) under = buildTargetPage(direction, stageRect);
    } catch (error) {
      console.warn("[PageFlip] 無法建立翻頁紙片，改成直接換章", error);
      return false;
    }
    if (!mover) return false;

    const hostRect = host.getBoundingClientRect();
    const stage = doc.createElement("div");
    stage.className = "reader-flip-stage";
    stage.setAttribute("aria-hidden", "true");
    stage.style.left = `${stageRect.left - hostRect.left}px`;
    stage.style.top = `${stageRect.top - hostRect.top}px`;
    stage.style.width = `${stageRect.width}px`;
    stage.style.height = `${stageRect.height}px`;
    // 紙片裡的內容都是以 stageRect 左上角為原點排的；紙片本身（.reader-flip-page）蓋滿舞台。
    if (under) {
      under.classList.add("reader-flip-under");
      stage.appendChild(under);
    }
    const dim = doc.createElement("div");
    dim.className = "reader-flip-dim";
    stage.appendChild(dim);
    mover.classList.add("reader-flip-mover");
    if (lite || reducedMotion()) mover.classList.add("is-lite");
    stage.appendChild(mover);
    host.appendChild(stage);

    session = {
      direction,
      stage,
      mover,
      dim,
      width: stageRect.width,
      progress: 0,
      pending: null,
      rafId: 0,
      animations: [],
      frameTimes: []
    };
    applyProgress(0);
    return true;
  }

  // 拖動中：同一格畫面只寫一次 transform。順便量每格間隔，太慢的裝置之後改用精簡版。
  function update(progress) {
    if (!session) return;
    session.pending = progress;
    if (session.rafId) return;
    const current = session;
    current.rafId = -1; // 已排程（回呼若同步執行會把它清回 0）
    const id = raf(time => {
      if (session !== current) return;
      current.rafId = 0;
      current.frameTimes.push(Number(time) || Date.now());
      applyProgress(current.pending);
    });
    if (current.rafId === -1) current.rafId = id;
  }

  function detectSlowDevice(current) {
    if (lite) return;
    const times = current.frameTimes;
    if (times.length < 8) return;
    const gaps = [];
    for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
    const slow = gaps.filter(gap => gap > 34).length;
    if (slow / gaps.length > 0.3) {
      lite = true;
      writeLiteFlag(storage);
    }
  }

  function animateTo(target, { duration }) {
    const current = session;
    const from = frameStyles(current.direction, current.progress);
    const to = frameStyles(current.direction, target);
    current.progress = target;
    if (!duration || typeof current.mover.animate !== "function") {
      current.mover.style.transform = to.transform;
      current.dim.style.opacity = to.dim;
      return Promise.resolve();
    }
    const options = { duration, easing: RELEASE_EASING, fill: "forwards" };
    const moverAnimation = current.mover.animate([{ transform: from.transform }, { transform: to.transform }], options);
    const dimAnimation = current.dim.animate([{ opacity: from.dim }, { opacity: to.dim }], options);
    current.animations.push(moverAnimation, dimAnimation);
    return Promise.all([moverAnimation.finished, dimAnimation.finished]).catch(() => {});
  }

  function waitAtMost(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, ms))
    ]);
  }

  // 放開手指（或按鈕／鍵盤觸發）：翻過去或彈回來。
  function release({ direction = 0, commit, velocity = 0, immediate = false } = {}) {
    const current = session;
    if (!current) {
      // 紙片沒建起來（例如版面量不到）：照樣換章，只是沒有動畫。
      return commit && direction ? Promise.resolve(onCommit?.(direction)) : Promise.resolve();
    }
    if (current.rafId) { cancelRaf(current.rafId); current.rafId = 0; }
    if (current.pending !== null) applyProgress(current.pending);
    detectSlowDevice(current);

    const target = commit ? 1 : 0;
    const remaining = Math.abs(target - current.progress);
    const duration = immediate || reducedMotion()
      ? 0
      : computeFlipDuration(remaining, velocity, current.width);
    const animation = animateTo(target, { duration });
    // 換章跟動畫同時跑：動畫在合成器上，不會被重畫整章卡住。
    const committed = commit ? Promise.resolve().then(() => onCommit?.(current.direction)) : null;
    const settled = Promise.all([animation, committed ? waitAtMost(committed, COMMIT_RENDER_WAIT_MS) : null])
      .then(() => { if (session === current) teardown(); });
    return committed ? committed.then(result => settled.then(() => result)) : settled;
  }

  // 按鈕、鍵盤、章末連結：直接播完整個翻頁。
  function play(direction) {
    if (reducedMotion() || !begin(direction)) {
      return Promise.resolve(onCommit?.(direction));
    }
    return release({ direction, commit: true });
  }

  // 滑動教學：頁面自己掀一下再放回（不換章）。
  async function peek(direction, amount = 0.18) {
    if (reducedMotion() || !begin(direction)) return false;
    const current = session;
    await animateTo(amount, { duration: 420 });
    if (session !== current) return false;
    await animateTo(0, { duration: 360 });
    if (session === current) teardown();
    return true;
  }

  // 新的手勢開始：進行中的翻頁／示範直接收掉（換章本身不受影響，會照常在底下完成）。
  function finishNow() {
    if (!session) return;
    teardown();
  }

  return {
    begin,
    update,
    release,
    play,
    peek,
    finishNow,
    isActive: () => Boolean(session),
    isLite: () => lite
  };
}
