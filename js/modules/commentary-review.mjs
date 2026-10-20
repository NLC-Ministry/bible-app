// 個人頁「我的審核」（#471）：被指派書卷的審核者（和系統管理員）審經文注釋的地方。
// 一則一則看：英文原文（可展開）對照中文譯文，譯文可以直接改，再按「通過」或「退回」
// （退回一定要寫意見）。通過的要等系統管理員在後台按「最終發布」，會友才看得到。
// 個人頁選單的「我的審核」只在有被指派（或是系統管理員）時出現。

import {
  REVIEW_QUEUE_STATUSES,
  REVIEW_STATUS_LABELS,
  filterReviewItems
} from "../data/commentary-review.mjs";
import { commentaryReferenceLabel, findRefLabelRanges } from "../data/passage-commentary.mjs";

const ENTRY_RECHECK_MS = 5 * 60 * 1000;

const STATUS_BADGE_CLASS = Object.freeze({
  pending: "stat-badge--neutral",
  returned: "stat-badge--warning",
  approved: "stat-badge--success"
});

// 閱讀器會把譯文裡的出處做成連結、把片語加粗（#542）；審核者改譯文時要保留這些寫法。
export function reviewStructureHint(item) {
  const unique = list => Array.from(new Set(list.map(value => String(value || "").trim()).filter(Boolean)));
  const content = String(item?.content || "");
  const labels = unique((Array.isArray(item?.cross_refs) ? item.cross_refs : []).map(ref => ref?.label))
    .filter(label => findRefLabelRanges(content, label).length);
  const phrases = unique((Array.isArray(item?.excerpts) ? item.excerpts : []).map(excerpt => excerpt?.zh));
  const parts = [];
  if (labels.length) parts.push(`出處（閱讀器裡可以點）：${labels.join("、")}`);
  if (phrases.length) parts.push(`加粗的經文片語：${phrases.map(phrase => `「${phrase}」`).join("、")}`);
  return parts.length ? `${parts.join("；")}。修改譯文時請保留這些寫法。` : "";
}

export function reviewCardHtml(item, escapeHTML, { returning = false } = {}) {
  const id = escapeHTML(String(item.id));
  const status = item.review_status;
  const reviewedBy = item.reviewed_by_name ? `・${escapeHTML(item.reviewed_by_name)}` : "";
  const note = status === "returned" && item.review_note
    ? `<p class="commentary-review-card__note"><strong>退回意見${reviewedBy}：</strong>${escapeHTML(item.review_note)}</p>` : "";
  const sourceText = String(item.source_text || "").trim();
  const structureHint = reviewStructureHint(item);
  const actions = returning
    ? `<label class="commentary-review-card__return">退回意見（必填，會給系統管理員看）
         <textarea class="form-control" rows="3" data-review-note></textarea>
       </label>
       <div class="commentary-review-card__actions">
         <button type="button" class="pill-btn" data-review-cancel>取消</button>
         <button type="button" class="danger-btn" data-review-confirm-return>確認退回</button>
       </div>`
    : `<div class="commentary-review-card__actions">
         <button type="button" class="pill-btn" data-review-return>退回</button>
         <button type="button" class="primary-btn" data-review-approve>${status === "approved" ? "更新並維持通過" : "通過"}</button>
       </div>`;
  return `
    <article class="commentary-review-card" data-review-id="${id}">
      <header class="commentary-review-card__head">
        <h4 class="commentary-review-card__ref">${escapeHTML(commentaryReferenceLabel(item))}</h4>
        <span class="stat-badge ${STATUS_BADGE_CLASS[status] || "stat-badge--neutral"}">${escapeHTML(REVIEW_STATUS_LABELS[status] || "")}</span>
      </header>
      ${note}
      ${sourceText ? `<details class="commentary-review-card__source">
        <summary>英文原文</summary>
        <p lang="en">${escapeHTML(sourceText)}</p>
      </details>` : ""}
      <label>小標題（選填）
        <input type="text" class="form-control" maxlength="60" data-review-title value="${escapeHTML(item.title || "")}">
      </label>
      <label>譯文
        <textarea class="form-control commentary-review-card__content" rows="6" data-review-content>${escapeHTML(item.content || "")}</textarea>
      </label>
      ${structureHint ? `<p class="commentary-review-card__hint">${escapeHTML(structureHint)}</p>` : ""}
      ${actions}
    </article>`;
}

export function createCommentaryReviewPage({
  db,
  escapeHTML,
  showToast,
  hydrateIcons = null,
  getElement = id => document.getElementById(id),
  now = () => Date.now()
}) {
  let data = { isAdmin: false, books: [], items: [] };
  let book = "";
  let status = "pending";
  let returningId = null;
  let entryCheckedAt = 0;
  let entryVisible = false;
  let bound = false;

  const el = () => ({
    entry: getElement("profile-commentary-review-entry"),
    book: getElement("profile-commentary-review-book"),
    tabs: getElement("profile-commentary-review-tabs"),
    list: getElement("profile-commentary-review-list"),
    refresh: getElement("profile-commentary-review-refresh")
  });

  function setEntryVisible(visible) {
    entryVisible = visible;
    const entry = el().entry;
    if (entry) entry.classList.toggle("hidden", !visible);
  }

  // 個人頁選單：有被指派（或是系統管理員）才顯示「我的審核」。5 分鐘內不重查。
  async function refreshEntry({ force = false } = {}) {
    if (!force && entryCheckedAt && now() - entryCheckedAt < ENTRY_RECHECK_MS) {
      setEntryVisible(entryVisible);
      return entryVisible;
    }
    entryCheckedAt = now();
    const result = await db.fetchMyCommentaryReviews();
    if (result.success) data = result;
    setEntryVisible(Boolean(result.success && (result.isAdmin || result.books.length)));
    return entryVisible;
  }

  function render() {
    const { book: bookSelect, tabs, list } = el();
    if (!list) return;
    const books = data.books || [];
    if (!books.includes(book)) book = books[0] || "";
    if (bookSelect) {
      bookSelect.innerHTML = books.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");
      bookSelect.value = book;
      bookSelect.closest("label")?.classList.toggle("hidden", books.length <= 1);
    }
    const { counts, items } = filterReviewItems(data.items, { book, status });
    if (tabs) {
      tabs.innerHTML = REVIEW_QUEUE_STATUSES.map(key => {
        const active = key === status;
        return `<button type="button" class="segment-toggle-btn${active ? " active" : ""}" data-review-status="${key}" aria-pressed="${active}">${escapeHTML(REVIEW_STATUS_LABELS[key])} ${counts[key]}</button>`;
      }).join("");
    }
    if (!books.length) {
      list.innerHTML = '<div class="profile-exams__empty">目前沒有指派給你的書卷。</div>';
      return;
    }
    if (!items.length) {
      const empty = { pending: "這一卷目前沒有待審的注釋。", returned: "沒有退回的注釋。", approved: "沒有等待發布的注釋。" };
      list.innerHTML = `<div class="profile-exams__empty">${empty[status]}</div>`;
      return;
    }
    list.innerHTML = items.map(item => reviewCardHtml(item, escapeHTML, { returning: String(item.id) === returningId })).join("");
    if (typeof hydrateIcons === "function") hydrateIcons(list);
  }

  async function refresh() {
    const { list } = el();
    if (list && !data.items.length) list.innerHTML = '<div class="profile-exams__empty">載入中…</div>';
    const result = await db.fetchMyCommentaryReviews();
    entryCheckedAt = now();
    if (!result.success) {
      if (list) list.innerHTML = `<div class="profile-exams__empty">${escapeHTML(result.message || "審核清單載入失敗，請稍後再試。")}</div>`;
      return false;
    }
    data = result;
    setEntryVisible(Boolean(result.isAdmin || result.books.length));
    render();
    return true;
  }

  function cardValues(card) {
    return {
      title: card.querySelector("[data-review-title]")?.value ?? null,
      content: card.querySelector("[data-review-content]")?.value ?? null,
      note: card.querySelector("[data-review-note]")?.value ?? ""
    };
  }

  // 把伺服器回傳的新狀態套回清單（已發布的會從審核頁消失）。
  function applyResult(updated) {
    if (!updated || !updated.id) return;
    data.items = data.items
      .map(item => (String(item.id) === String(updated.id) ? { ...item, ...updated } : item))
      .filter(item => REVIEW_QUEUE_STATUSES.includes(item.review_status));
  }

  async function decide(card, decision) {
    const id = card.dataset.reviewId;
    const values = cardValues(card);
    if (!String(values.content || "").trim()) {
      showToast("譯文不能是空的。");
      return;
    }
    if (decision === "return" && !values.note.trim()) {
      showToast("退回時請寫下審核意見。");
      return;
    }
    card.querySelectorAll("button").forEach(button => { button.disabled = true; });
    const result = await db.reviewCommentary({ id, decision, title: values.title, content: values.content, note: values.note });
    if (!result.success) {
      card.querySelectorAll("button").forEach(button => { button.disabled = false; });
      showToast(result.message || "操作失敗，請稍後再試。");
      return;
    }
    returningId = null;
    applyResult(result.data);
    showToast(decision === "approve" ? "已通過，等系統管理員最終發布。" : "已退回給系統管理員。");
    render();
  }

  function bind() {
    if (bound) return;
    const { book: bookSelect, tabs, list, refresh: refreshButton } = el();
    if (!list) return;
    bound = true;
    bookSelect?.addEventListener("change", () => {
      book = bookSelect.value;
      returningId = null;
      render();
    });
    tabs?.addEventListener("click", event => {
      const button = event.target.closest?.("[data-review-status]");
      if (!button) return;
      status = button.dataset.reviewStatus;
      returningId = null;
      render();
    });
    refreshButton?.addEventListener("click", () => { void refresh(); });
    list.addEventListener("click", event => {
      const card = event.target.closest?.("[data-review-id]");
      if (!card) return;
      if (event.target.closest("[data-review-approve]")) {
        void decide(card, "approve");
      } else if (event.target.closest("[data-review-return]")) {
        returningId = card.dataset.reviewId;
        // 保留目前改到一半的譯文，再切到退回模式。
        const values = cardValues(card);
        data.items = data.items.map(item => (String(item.id) === returningId ? { ...item, title: values.title, content: values.content } : item));
        render();
        Array.from(el().list.querySelectorAll("[data-review-id]"))
          .find(item => item.dataset.reviewId === returningId)
          ?.querySelector("[data-review-note]")?.focus();
      } else if (event.target.closest("[data-review-cancel]")) {
        returningId = null;
        render();
      } else if (event.target.closest("[data-review-confirm-return]")) {
        void decide(card, "return");
      }
    });
  }

  return { bind, refresh, refreshEntry, render, get state() { return { data, book, status, returningId }; } };
}
