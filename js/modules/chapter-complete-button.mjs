// 章末「完成本章」按鈕（#357）：讀經頁（#reader-view）與計畫內嵌閱讀器共用。
//
// 用法：
//   const control = createChapterCompleteController({ getTarget, getBlock, submit, onChoose, getCopy });
//   container.appendChild(control.createElement("reader-chapter-complete"));  // 每次渲染經文後
//   control.render();          // 章節／計畫狀態變了就重畫
//   control.pulse();           // 讀到章末、朗讀唸完：只閃一下提醒，不寫入
//
// 按下 → 震動＋短動畫 → submit(task, willCheck)（呼叫端用 submitChapterCheckIn 走 db.logChapterRead）。
// 等待同步顯示「已完成（等待同步）」；outbox 的 rejected 事件（#356）把原因顯示在按鈕下方。
import {
  CHAPTER_COMPLETE_REASONS,
  describeCheckInError,
  formatChapterCompleteBlock,
  getChapterCompleteView,
  getPendingCheckIn,
  isChapterTaskRead,
  planIdOf
} from "../data/chapter-complete.mjs";
import { checkInReasonMessage } from "../data/check-in-reasons.mjs";

export function chapterTaskKey(task) {
  if (!task || !task.plan) return "";
  return [planIdOf(task.plan), Number(task.round) || 1, task.bookName, Number(task.chapterNum)].join("|");
}

function targetKey(target) {
  if (!target) return "";
  if (target.task) return chapterTaskKey(target.task);
  const first = target.choices && target.choices[0];
  return first ? `choose|${first.bookName}|${Number(first.chapterNum)}` : "";
}

export function prefersReducedMotion(win = globalThis.window) {
  try {
    return Boolean(win && typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

function restartClass(element, className, win) {
  element.classList.remove(className);
  void element.offsetWidth; // 重新觸發 CSS 動畫
  element.classList.add(className);
  const clear = () => element.classList.remove(className);
  element.addEventListener("animationend", clear, { once: true });
  (win && typeof win.setTimeout === "function" ? win : globalThis).setTimeout(clear, 1200);
}

// 讀到章末／朗讀唸完：按鈕閃一次。已完成、隱藏、或使用者要求減少動態時不閃。
export function pulseChapterComplete(root, { win = globalThis.window } = {}) {
  const button = root && root.querySelector(".chapter-complete__button");
  if (!button || root.hidden) return false;
  if (button.getAttribute("aria-pressed") === "true") return false;
  if (prefersReducedMotion(win)) return false;
  restartClass(button, "is-pulsing", win);
  return true;
}

// 按下去的回饋：短震動（支援的手機）＋勾勾彈一下。
export function playChapterCompleteFeedback(root, { win = globalThis.window, nav = globalThis.navigator } = {}) {
  try {
    if (nav && typeof nav.vibrate === "function") nav.vibrate(15);
  } catch {
    /* 有些瀏覽器在沒有使用者手勢時會丟例外；震動只是加分 */
  }
  const button = root && root.querySelector(".chapter-complete__button");
  if (!button || prefersReducedMotion(win)) return;
  restartClass(button, "is-just-completed", win);
}

function iconHtml(key) {
  const render = globalThis.renderIcon;
  return typeof render === "function" ? render(key, { size: "md", className: "nlc-icon" }) : "";
}

export function renderChapterCompleteView(root, view, { onChoose } = {}) {
  if (!root) return;
  if (!view || !view.visible) {
    root.hidden = true;
    root.dataset.state = "";
    return;
  }
  root.hidden = false;
  root.dataset.state = view.pressed ? "done" : (view.needsChoice ? "choose" : "idle");
  const doc = root.ownerDocument;

  const choicesEl = root.querySelector(".chapter-complete__choices");
  const choices = view.choices || [];
  choicesEl.hidden = choices.length === 0;
  const track = choicesEl.querySelector(".chapter-complete__choice-track");
  track.innerHTML = "";
  if (choices.length > 3) {
    // 四個以上用下拉選單；≤3 個一律並排（select 會藏住選項，長輩看不到第二個）。
    const select = doc.createElement("select");
    select.className = "chapter-complete__choice-select";
    select.setAttribute("aria-label", choicesEl.querySelector(".chapter-complete__choices-label").textContent);
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "—";
    select.appendChild(placeholder);
    choices.forEach(choice => {
      const option = doc.createElement("option");
      option.value = choice.id;
      option.textContent = choice.read ? `${choice.name} ✓` : choice.name;
      option.selected = choice.selected;
      select.appendChild(option);
    });
    select.addEventListener("change", () => { if (select.value && onChoose) onChoose(select.value); });
    track.appendChild(select);
  } else {
    choices.forEach(choice => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `segment-toggle-btn chapter-complete__choice${choice.selected ? " active" : ""}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", choice.selected ? "true" : "false");
      button.dataset.planId = choice.id;
      button.textContent = choice.name;
      if (choice.read) {
        const done = doc.createElement("span");
        done.className = "chapter-complete__choice-done";
        done.innerHTML = iconHtml("check");
        done.setAttribute("aria-label", "已記錄");
        button.appendChild(done);
      }
      button.addEventListener("click", event => {
        event.stopPropagation();
        if (onChoose) onChoose(choice.id);
      });
      track.appendChild(button);
    });
  }

  const button = root.querySelector(".chapter-complete__button");
  button.setAttribute("aria-pressed", view.pressed ? "true" : "false");
  button.classList.toggle("is-pressed", Boolean(view.pressed));
  if (view.needsChoice) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
  button.querySelector(".chapter-complete__label").textContent = view.label;

  const status = root.querySelector(".chapter-complete__status");
  status.textContent = view.status || "";
  status.dataset.kind = view.statusKind || "";
  status.hidden = !view.status;
}

export function createChapterCompleteController({
  getTarget,
  getBlock = () => null,
  submit,
  onChoose = () => {},
  getCopy = () => ((globalThis.window && globalThis.window.APP_COPY && globalThis.window.APP_COPY.plan) || {}),
  getOutbox = () => (globalThis.window ? globalThis.window.checkInOutbox : null),
  win = globalThis.window
} = {}) {
  let root = null;
  let notice = null; // { key, text }：只對同一章有效，換章就丟掉
  const busyKeys = new Set();
  let attachedOutbox = null;

  const currentTarget = () => {
    try {
      return getTarget() || null;
    } catch (error) {
      console.warn("[ChapterComplete] Could not resolve the chapter target", error);
      return null;
    }
  };

  const handleOutboxUpdate = () => render();
  const handleOutboxRejected = event => {
    const item = event && event.detail && event.detail.item;
    const target = currentTarget();
    if (!item || !target || !target.task) return render();
    const key = [item.planId, Number(item.round) || 1, item.book, Number(item.chapter)].join("|");
    if (key === chapterTaskKey(target.task)) {
      notice = { key, text: formatNotice(checkInReasonMessage(event.detail.reason)) };
    }
    render();
  };

  function attachOutbox() {
    const outbox = getOutbox();
    if (!outbox || outbox === attachedOutbox || typeof outbox.addEventListener !== "function") return outbox;
    if (attachedOutbox) {
      attachedOutbox.removeEventListener("change", handleOutboxUpdate);
      attachedOutbox.removeEventListener("sent", handleOutboxUpdate);
      attachedOutbox.removeEventListener("rejected", handleOutboxRejected);
    }
    outbox.addEventListener("change", handleOutboxUpdate);
    outbox.addEventListener("sent", handleOutboxUpdate);
    outbox.addEventListener("rejected", handleOutboxRejected);
    attachedOutbox = outbox;
    return outbox;
  }

  function formatNotice(reasonText) {
    const copy = getCopy();
    return String(copy.chapterCompleteNotRecorded || "未記錄：{reason}").split("{reason}").join(reasonText);
  }

  function render() {
    if (!root || !root.isConnected) return;
    const outbox = attachOutbox();
    const target = currentTarget();
    const key = targetKey(target);
    if (notice && notice.key !== key) notice = null;
    const task = target && target.task;
    const view = getChapterCompleteView({
      target,
      read: isChapterTaskRead(task),
      pending: getPendingCheckIn(task, outbox),
      notice,
      copy: getCopy()
    });
    renderChapterCompleteView(root, view, {
      onChoose: planId => {
        notice = null;
        onChoose(planId);
        render();
      }
    });
  }

  async function press() {
    const target = currentTarget();
    if (!target || target.mode === "none") return { ok: false, reason: CHAPTER_COMPLETE_REASONS.NO_PLAN };
    const copy = getCopy();
    const task = target.task;
    if (!task) {
      notice = { key: targetKey(target), text: formatChapterCompleteBlock(CHAPTER_COMPLETE_REASONS.CHOOSE_PLAN, copy) };
      render();
      const choices = root && root.querySelector(".chapter-complete__choices");
      if (choices && !prefersReducedMotion(win)) restartClass(choices, "is-pulsing", win);
      return { ok: false, reason: CHAPTER_COMPLETE_REASONS.CHOOSE_PLAN };
    }
    const key = chapterTaskKey(task);
    if (busyKeys.has(key)) return { ok: false, reason: "busy" };
    const willCheck = !isChapterTaskRead(task);
    const block = getBlock(task, willCheck);
    if (block) {
      notice = { key, text: formatChapterCompleteBlock(block, copy) };
      render();
      return { ok: false, reason: block };
    }
    notice = null;
    busyKeys.add(key);
    if (willCheck) playChapterCompleteFeedback(root, { win });
    let result;
    try {
      const pending = submit(task, willCheck);
      render(); // submit 在第一個 await 前就改好本機狀態 → 立即 ✓
      result = await pending;
    } catch (error) {
      result = { ok: false, error, message: error && error.message };
    } finally {
      busyKeys.delete(key);
    }
    if (!result || !result.ok) {
      if (result && result.reason) notice = { key, text: formatChapterCompleteBlock(result.reason, copy) };
      else notice = { key, text: formatNotice(describeCheckInError(result && result.error, copy)) };
    }
    render();
    return result;
  }

  function createElement(id = "") {
    const doc = (win && win.document) || globalThis.document;
    const element = doc.createElement("section");
    if (id) element.id = id;
    element.className = "chapter-complete";
    element.hidden = true;
    const copy = getCopy();
    element.setAttribute("aria-label", copy.chapterCompleteButton || "完成本章");
    element.innerHTML = `
      <div class="chapter-complete__choices" hidden>
        <p class="chapter-complete__choices-label"></p>
        <div class="segment-track chapter-complete__choice-track" role="radiogroup"></div>
      </div>
      <button type="button" class="chapter-complete__button" aria-pressed="false">
        <span class="chapter-complete__icon" aria-hidden="true">${iconHtml("check")}</span>
        <span class="chapter-complete__label"></span>
      </button>
      <p class="chapter-complete__status" role="status" aria-live="polite" hidden></p>`;
    const label = element.querySelector(".chapter-complete__choices-label");
    label.textContent = copy.chapterCompleteChoosePlan || "要記到哪個計畫？";
    element.querySelector(".chapter-complete__choice-track").setAttribute("aria-label", label.textContent);
    element.querySelector(".chapter-complete__button").addEventListener("click", event => {
      event.stopPropagation();
      void press();
    });
    root = element;
    return element;
  }

  return {
    createElement,
    render,
    press,
    pulse: () => pulseChapterComplete(root, { win }),
    get element() { return root; }
  };
}
