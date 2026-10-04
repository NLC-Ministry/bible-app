// 後台「經文注釋」（#447）：一章一則，選書卷＋章、寫內容、勾主題圖片。
// admin.js 第一次打開這個區塊時呼叫 renderAdminCommentary()。

import { COMMENTARY_IMAGE_DIR, COMMENTARY_TOPICS, normalizeTopicTags, getCommentaryTopic } from "../data/passage-commentary.mjs";

const EXCERPT_LENGTH = 90;

export function sortCommentaryRows(rows, books) {
  const order = new Map((books || []).map((book, index) => [book.name, index]));
  return [...(rows || [])].sort((a, b) => {
    const bookDiff = (order.get(a.book) ?? 999) - (order.get(b.book) ?? 999);
    return bookDiff || Number(a.chapter) - Number(b.chapter);
  });
}

export function findCommentaryForChapter(rows, book, chapter, excludeId = null) {
  return (rows || []).find(row => row.book === book
    && Number(row.chapter) === Number(chapter)
    && String(row.id) !== String(excludeId)) || null;
}

function excerpt(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
}

export function renderAdminCommentary({ db, books, escapeHTML, showToast, confirm, hydrateIcons = null, getElement = id => document.getElementById(id) }) {
  const el = {
    create: getElement("admin-commentary-create"),
    editor: getElement("admin-commentary-editor"),
    formTitle: getElement("admin-commentary-form-title"),
    book: getElement("admin-commentary-book"),
    chapter: getElement("admin-commentary-chapter"),
    heading: getElement("admin-commentary-heading"),
    content: getElement("admin-commentary-content"),
    topics: getElement("admin-commentary-topic-list"),
    published: getElement("admin-commentary-published"),
    cancel: getElement("admin-commentary-cancel"),
    save: getElement("admin-commentary-save"),
    filter: getElement("admin-commentary-filter"),
    list: getElement("admin-commentary-list")
  };
  if (Object.values(el).some(node => !node) || !Array.isArray(books) || books.length === 0) return Promise.resolve(false);

  let rows = [];
  let editingId = null;

  el.book.innerHTML = books.map(book => `<option value="${escapeHTML(book.name)}">${escapeHTML(book.name)}</option>`).join("");
  el.filter.innerHTML = `<option value="">全部書卷</option>${el.book.innerHTML}`;
  el.topics.innerHTML = COMMENTARY_TOPICS.map(topic => {
    const image = topic.images[0];
    return `
      <label class="admin-commentary-topic">
        <input type="checkbox" value="${escapeHTML(topic.key)}">
        ${image ? `<img src="${escapeHTML(COMMENTARY_IMAGE_DIR + image.file)}" alt="" loading="lazy" decoding="async">` : ""}
        <span>${escapeHTML(topic.label)}</span>
      </label>`;
  }).join("");

  function fillChapters(selected = 1) {
    const book = books.find(item => item.name === el.book.value) || books[0];
    const count = Number(book.chapters) || 1;
    el.chapter.innerHTML = Array.from({ length: count }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("");
    el.chapter.value = String(Math.min(Math.max(1, Number(selected) || 1), count));
  }

  function selectedTopics() {
    return Array.from(el.topics.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
  }

  function closeEditor() {
    editingId = null;
    el.editor.classList.add("hidden");
    el.heading.value = "";
    el.content.value = "";
    el.published.checked = true;
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    el.book.disabled = false;
    el.chapter.disabled = false;
  }

  function openEditor(row = null) {
    editingId = row ? row.id : null;
    const filterBook = el.filter.value;
    el.book.value = row ? row.book : (filterBook || books[0].name);
    fillChapters(row ? row.chapter : 1);
    // 已存在的注釋不換章：要搬到別章請刪掉重建，避免撞到另一章的注釋。
    el.book.disabled = Boolean(row);
    el.chapter.disabled = Boolean(row);
    el.heading.value = row ? row.title || "" : "";
    el.content.value = row ? row.content || "" : "";
    el.published.checked = row ? row.is_published !== false : true;
    const tags = new Set(normalizeTopicTags(row ? row.topic_tags : []));
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = tags.has(input.value); });
    el.formTitle.textContent = row ? `編輯注釋：${row.book} ${row.chapter} 章` : "新增注釋";
    el.editor.classList.remove("hidden");
    (row ? el.content : el.book).focus();
  }

  function renderList() {
    const filterBook = el.filter.value;
    const visible = sortCommentaryRows(rows, books).filter(row => !filterBook || row.book === filterBook);
    if (!visible.length) {
      el.list.innerHTML = `<div class="admin-user-directory__empty">${rows.length ? "這卷書還沒有注釋。" : "目前還沒有經文注釋，請按「新增注釋」。"}</div>`;
      return;
    }
    el.list.innerHTML = visible.map(row => {
      const topicBadges = normalizeTopicTags(row.topic_tags)
        .map(key => `<span class="stat-badge stat-badge--neutral">${escapeHTML(getCommentaryTopic(key).label)}</span>`)
        .join("");
      const draft = row.is_published === false ? '<span class="stat-badge stat-badge--neutral">草稿</span>' : "";
      const title = row.title ? `・${escapeHTML(row.title)}` : "";
      return `
      <article class="announcement-item" data-admin-commentary-id="${escapeHTML(String(row.id))}">
        <div class="announcement-item__header">
          <div class="announcement-item__header-left">
            <div class="announcement-item__icon-avatar" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="lightbulb"></span></div>
            <div class="announcement-item__title-group">
              <div class="announcement-item__tags">${draft}${topicBadges}</div>
              <h4 class="announcement-item__title">${escapeHTML(row.book)} ${escapeHTML(String(row.chapter))} 章${title}</h4>
            </div>
          </div>
          <div class="announcement-item__meta">
            <button type="button" class="circular-action-btn announcement-item__edit" data-commentary-edit title="編輯注釋" aria-label="編輯注釋"><span class="nlc-icon nlc-icon--sm" data-icon="pencil" aria-hidden="true"></span></button>
            <button type="button" class="circular-action-btn btn-danger-soft announcement-item__delete" data-commentary-delete title="刪除注釋" aria-label="刪除注釋"><span class="nlc-icon nlc-icon--sm" data-icon="trash" aria-hidden="true"></span></button>
          </div>
        </div>
        <p class="announcement-item__body">${escapeHTML(excerpt(row.content))}</p>
      </article>`;
    }).join("");
    if (typeof hydrateIcons === "function") hydrateIcons(el.list);
  }

  async function reload() {
    const result = await db.fetchAllPassageCommentaryForAdmin();
    if (result === null) {
      el.list.innerHTML = '<div class="admin-user-directory__empty">注釋清單載入失敗，請重新整理後再試。</div>';
      return false;
    }
    rows = result;
    renderList();
    return true;
  }

  el.create.onclick = () => openEditor();
  el.cancel.onclick = closeEditor;
  el.book.onchange = () => fillChapters(1);
  el.filter.onchange = renderList;
  el.save.onclick = async () => {
    const content = el.content.value.trim();
    if (!content) {
      showToast("請輸入注釋內容。");
      return;
    }
    const book = el.book.value;
    const chapter = Number(el.chapter.value);
    if (!editingId && findCommentaryForChapter(rows, book, chapter)) {
      showToast("這一章已經有注釋了，請在清單中編輯它。");
      return;
    }
    const isEditing = Boolean(editingId);
    el.save.disabled = true;
    const ok = await db.savePassageCommentary({
      id: editingId,
      book,
      chapter,
      title: el.heading.value,
      content,
      topicTags: selectedTopics(),
      isPublished: el.published.checked
    });
    el.save.disabled = false;
    if (!ok) return;
    showToast(isEditing ? "注釋已更新。" : "注釋已新增。");
    closeEditor();
    await reload();
  };
  el.list.onclick = async event => {
    const card = event.target.closest?.("[data-admin-commentary-id]");
    if (!card) return;
    const row = rows.find(item => String(item.id) === card.dataset.adminCommentaryId);
    if (!row) return;
    if (event.target.closest("[data-commentary-edit]")) {
      openEditor(row);
      return;
    }
    if (!event.target.closest("[data-commentary-delete]")) return;
    const confirmed = await confirm({
      title: `確定要刪除「${row.book} ${row.chapter} 章」的注釋嗎？`,
      message: "刪除後會友就看不到這則注釋，而且無法復原。只想暫時隱藏的話，可以改成草稿。",
      confirmText: "確認刪除",
      cancelText: "取消",
      isDestructive: true
    });
    if (!confirmed) return;
    if (await db.deletePassageCommentary(row.id)) {
      showToast("注釋已刪除。");
      if (String(editingId) === String(row.id)) closeEditor();
      await reload();
    }
  };

  fillChapters(1);
  return reload();
}
