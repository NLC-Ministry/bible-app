// 個人計畫（#473）的新增／編輯表單。欄位與書卷快選沿用管理員新增計畫表單
// （plan-admin.js initAdminPlanManagement），書卷格用 #469 的 .admin-book-option 樣式。
// 驗證規則在 js/data/personal-plans.mjs，這裡只負責畫面。
import {
  PERSONAL_PLAN_MAX_DAYS,
  PERSONAL_PLAN_NAME_MAX,
  buildPersonalPlanFields,
  taipeiTodayISO,
  validatePersonalPlanName
} from "../data/personal-plans.mjs";

const DIALOG_ID = "personal-plan-dialog";

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function inclusiveDays(startKey, endKey) {
  const toUtc = key => {
    const [year, month, day] = String(key).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const days = Math.round((toUtc(endKey) - toUtc(startKey)) / 86400000) + 1;
  return Number.isFinite(days) && days > 0 ? days : "";
}

function bookOptions(books, section, selected) {
  return books
    .filter(book => book.section === section)
    .map(book => `
      <label class="admin-book-option">
        <input type="checkbox" class="personal-plan-book" value="${escapeText(book.name)}" ${selected.has(book.name) ? "checked" : ""}>
        <span class="admin-book-option__name">${escapeText(book.name)}</span>
      </label>
    `).join("");
}

// plan：要編輯的個人計畫（新增時不傳）。
// scheduleLocked：已經開始打卡，書卷與日期鎖住，只能改名。
// 回傳 Promise：使用者送出的欄位（給 db.createPersonalPlan／updatePersonalPlan），取消則是 null。
export function openPersonalPlanDialog({ plan = null, scheduleLocked = false, bibleBooks = globalThis.BIBLE_BOOKS || [] } = {}) {
  return new Promise(resolve => {
    document.getElementById(DIALOG_ID)?.remove();

    const editing = Boolean(plan);
    const today = taipeiTodayISO();
    const isFixed = editing ? plan.isFixed !== false && plan.is_fixed !== false : true;
    const selected = new Set(editing ? (plan.target_books || plan.targetBooks || []) : []);
    const startDate = editing ? String(plan.startDate || "").slice(0, 10) : today;
    const endDate = editing ? String(plan.endDate || "").slice(0, 10) : "";
    const durationDays = editing && !isFixed ? inclusiveDays(startDate, endDate) : "";
    const lockedAttr = scheduleLocked ? "disabled" : "";

    const overlay = document.createElement("div");
    overlay.id = DIALOG_ID;
    overlay.className = "modal-overlay personal-plan-dialog";
    overlay.innerHTML = `
      <form class="personal-plan-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="personal-plan-dialog-title" novalidate>
        <h3 id="personal-plan-dialog-title" class="personal-plan-dialog__title">${editing ? "編輯個人計畫" : "新增個人計畫"}</h3>
        <p class="personal-plan-dialog__intro">個人計畫只有你自己看得到，不列入排行榜、團隊與教會統計。</p>

        <label class="personal-plan-dialog__field">
          <span>計畫名稱</span>
          <input type="text" id="personal-plan-name" class="form-control" maxlength="${PERSONAL_PLAN_NAME_MAX}"
            autocomplete="off" placeholder="例如：暑假讀完新約" value="${escapeText(editing ? plan.name : "")}">
        </label>

        ${scheduleLocked ? `
          <p class="personal-plan-dialog__locked">
            <span class="nlc-icon nlc-icon--sm" data-icon="lock" aria-hidden="true"></span>
            <span>已經開始打卡，書卷與日期不能再改；名稱仍可修改。</span>
          </p>` : ""}

        <fieldset class="personal-plan-dialog__fieldset" ${lockedAttr}>
          <legend>日期</legend>
          <div class="capsule-segmented-control segment-track personal-plan-dialog__segments" role="group" aria-label="日期方式">
            <button type="button" class="segment-toggle-btn ${isFixed ? "active" : ""}" data-personal-plan-time="fixed" aria-pressed="${isFixed}">固定日期</button>
            <button type="button" class="segment-toggle-btn ${isFixed ? "" : "active"}" data-personal-plan-time="flexible" aria-pressed="${!isFixed}">指定天數</button>
          </div>
          <div class="personal-plan-dialog__dates" data-personal-plan-panel="fixed" ${isFixed ? "" : "hidden"}>
            <label class="personal-plan-dialog__field">
              <span>開始日期</span>
              <input type="date" id="personal-plan-start" class="form-control" value="${escapeText(startDate)}">
            </label>
            <label class="personal-plan-dialog__field">
              <span>結束日期</span>
              <input type="date" id="personal-plan-end" class="form-control" value="${escapeText(isFixed ? endDate : "")}" min="${today}">
            </label>
          </div>
          <label class="personal-plan-dialog__field" data-personal-plan-panel="flexible" ${isFixed ? "hidden" : ""}>
            <span>計畫天數（從${editing ? " " + escapeText(startDate) + " " : "今天"}起算）</span>
            <input type="number" id="personal-plan-days" class="form-control" min="1" max="${PERSONAL_PLAN_MAX_DAYS}"
              inputmode="numeric" placeholder="例如：30" value="${escapeText(durationDays)}">
          </label>
        </fieldset>

        <fieldset class="personal-plan-dialog__fieldset" ${lockedAttr}>
          <legend>書卷</legend>
          <div class="personal-plan-dialog__quick">
            <button type="button" class="secondary-btn" data-personal-plan-books="all">全選</button>
            <button type="button" class="secondary-btn" data-personal-plan-books="old">舊約</button>
            <button type="button" class="secondary-btn" data-personal-plan-books="new">新約</button>
            <button type="button" class="secondary-btn" data-personal-plan-books="none">清除</button>
          </div>
          <p class="personal-plan-dialog__section-label">舊約</p>
          <div class="admin-book-grid">${bookOptions(bibleBooks, "old", selected)}</div>
          <p class="personal-plan-dialog__section-label">新約</p>
          <div class="admin-book-grid">${bookOptions(bibleBooks, "new", selected)}</div>
        </fieldset>

        <p id="personal-plan-error" class="personal-plan-dialog__error" role="alert" hidden></p>
        <div class="personal-plan-dialog__actions">
          <button type="button" class="secondary-btn" data-personal-plan-cancel>取消</button>
          <button type="submit" class="primary-btn">${editing ? "儲存" : "建立計畫"}</button>
        </div>
      </form>
    `;
    document.body.appendChild(overlay);
    if (typeof globalThis.hydrateIcons === "function") globalThis.hydrateIcons(overlay);

    const form = overlay.querySelector("form");
    const errorEl = overlay.querySelector("#personal-plan-error");
    let timeType = isFixed ? "fixed" : "flexible";

    const showError = message => {
      errorEl.textContent = message;
      errorEl.hidden = !message;
    };

    overlay.querySelectorAll("[data-personal-plan-time]").forEach(button => {
      button.addEventListener("click", () => {
        timeType = button.dataset.personalPlanTime;
        overlay.querySelectorAll("[data-personal-plan-time]").forEach(item => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        overlay.querySelectorAll("[data-personal-plan-panel]").forEach(panel => {
          panel.hidden = panel.dataset.personalPlanPanel !== timeType;
        });
        showError("");
      });
    });

    const bookSections = new Map((bibleBooks || []).map(book => [book.name, book.section]));
    overlay.querySelectorAll("[data-personal-plan-books]").forEach(button => {
      button.addEventListener("click", () => {
        const mode = button.dataset.personalPlanBooks;
        overlay.querySelectorAll(".personal-plan-book").forEach(input => {
          input.checked = mode === "all" || (mode !== "none" && bookSections.get(input.value) === mode);
        });
      });
    });

    let settled = false;
    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(value);
    };
    const onKeydown = event => {
      if (event.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKeydown);
    overlay.querySelector("[data-personal-plan-cancel]").addEventListener("click", () => close(null));
    overlay.addEventListener("click", event => {
      if (event.target === overlay) close(null);
    });

    form.addEventListener("submit", event => {
      event.preventDefault();
      const name = overlay.querySelector("#personal-plan-name").value;
      if (scheduleLocked) {
        const nameError = validatePersonalPlanName(name);
        if (nameError) return showError(nameError);
        return close({ name });
      }
      const input = {
        name,
        isFixed: timeType === "fixed",
        startDate: timeType === "fixed" ? overlay.querySelector("#personal-plan-start").value : (editing ? startDate : today),
        endDate: overlay.querySelector("#personal-plan-end").value,
        durationDays: overlay.querySelector("#personal-plan-days").value,
        books: [...overlay.querySelectorAll(".personal-plan-book:checked")].map(input => input.value)
      };
      const built = buildPersonalPlanFields(input, today);
      if (!built.ok) return showError(built.message);
      close(input);
    });

    overlay.querySelector("#personal-plan-name").focus();
  });
}
