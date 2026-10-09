// 後台「經文詞條」（#470）：詞、其他寫法、短解釋、主題圖、出處，範圍三選一：
//   整卷：這卷書裡經文出現這個詞的節都看得到（閱讀器每章只在第一次出現的節放 icon）
//   整章：同上，只限這一章
//   指定節：直接掛在那幾節，不比對經文文字
// admin.js 第一次打開這個區塊時呼叫 renderAdminCommentaryTerms()。

import {
  COMMENTARY_IMAGE_DIR,
  COMMENTARY_TOPICS,
  formatVerseRange,
  getCommentaryTopic,
  normalizeTopicTags,
  normalizeVerseRange,
  parseTermAliases
} from "../data/passage-commentary.mjs";
import { verseCountFor } from "./admin-commentary.mjs";

const EXCERPT_LENGTH = 90;
export const TERM_SCOPES = Object.freeze(["book", "chapter", "verses"]);

export function termScopeOf(row) {
  if (!row || row.chapter === null || row.chapter === undefined || row.chapter === "") return "book";
  return normalizeVerseRange(row.verse_start, row.verse_end) ? "verses" : "chapter";
}

// 「出埃及記（整卷）」「出埃及記 26 章」「出埃及記 26:1-5」
export function termScopeLabel(row) {
  const scope = termScopeOf(row);
  if (scope === "book") return `${row.book}（整卷）`;
  if (scope === "chapter") return `${row.book} ${row.chapter} 章`;
  return `${row.book} ${row.chapter}:${formatVerseRange(row.verse_start, row.verse_end)}`;
}

// 聖經順序 → 整卷在前 → 章 → 節 → 詞（中文筆畫順序不重要，照字串）。
export function sortTermRows(rows, books) {
  const order = new Map((books || []).map((book, index) => [book.name, index]));
  return [...(rows || [])].sort((a, b) =>
    (order.get(a.book) ?? 999) - (order.get(b.book) ?? 999)
    || (Number(a.chapter) || 0) - (Number(b.chapter) || 0)
    || (Number(a.verse_start) || 0) - (Number(b.verse_start) || 0)
    || String(a.term || "").localeCompare(String(b.term || ""), "zh-Hant"));
}

function excerpt(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
}

export function renderAdminCommentaryTerms({ db, books, verseCounts = null, escapeHTML, showToast, confirm, hydrateIcons = null, getElement = id => document.getElementById(id) }) {
  const el = {
    create: getElement("admin-term-create"),
    editor: getElement("admin-term-editor"),
    formTitle: getElement("admin-term-form-title"),
    name: getElement("admin-term-name"),
    aliases: getElement("admin-term-aliases"),
    definition: getElement("admin-term-definition"),
    scope: getElement("admin-term-scope"),
    book: getElement("admin-term-book"),
    chapterField: getElement("admin-term-chapter-field"),
    chapter: getElement("admin-term-chapter"),
    verseField: getElement("admin-term-verse-field"),
    verseStart: getElement("admin-term-verse-start"),
    verseEnd: getElement("admin-term-verse-end"),
    topics: getElement("admin-term-topic-list"),
    source: getElement("admin-term-source"),
    published: getElement("admin-term-published"),
    cancel: getElement("admin-term-cancel"),
    save: getElement("admin-term-save"),
    filter: getElement("admin-term-filter"),
    list: getElement("admin-term-list")
  };
  if (Object.values(el).some(node => !node) || !Array.isArray(books) || books.length === 0) return Promise.resolve(false);

  let rows = [];
  let editingId = null;
  let scope = "book";

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

  function setScope(next) {
    scope = TERM_SCOPES.includes(next) ? next : "book";
    el.scope.querySelectorAll("[data-term-scope]").forEach(button => {
      const active = button.dataset.termScope === scope;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    el.chapterField.classList.toggle("hidden", scope === "book");
    el.verseField.classList.toggle("hidden", scope !== "verses");
  }

  function selectedTopics() {
    return Array.from(el.topics.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
  }

  function closeEditor() {
    editingId = null;
    el.editor.classList.add("hidden");
    el.name.value = "";
    el.aliases.value = "";
    el.definition.value = "";
    el.verseStart.value = "";
    el.verseEnd.value = "";
    el.source.value = "";
    el.published.checked = true;
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    setScope("book");
  }

  function openEditor(row = null) {
    editingId = row ? row.id : null;
    el.book.value = row ? row.book : (el.filter.value || books[0].name);
    fillChapters(row && row.chapter ? row.chapter : 1);
    setScope(row ? termScopeOf(row) : "book");
    el.name.value = row ? row.term || "" : "";
    el.aliases.value = row ? parseTermAliases(row.aliases).join("、") : "";
    el.definition.value = row ? row.definition || "" : "";
    el.verseStart.value = row && row.verse_start ? String(row.verse_start) : "";
    el.verseEnd.value = row && row.verse_end && row.verse_end !== row.verse_start ? String(row.verse_end) : "";
    el.source.value = row ? row.source || "" : "";
    el.published.checked = row ? row.is_published !== false : true;
    const tags = new Set(normalizeTopicTags(row ? row.topic_tags : []));
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = tags.has(input.value); });
    el.formTitle.textContent = row ? `編輯詞條：${row.term}` : "新增詞條";
    el.editor.classList.remove("hidden");
    el.name.focus();
  }

  function renderList() {
    const filterBook = el.filter.value;
    const visible = sortTermRows(rows, books).filter(row => !filterBook || row.book === filterBook);
    if (!visible.length) {
      el.list.innerHTML = `<div class="admin-user-directory__empty">${rows.length ? "這卷書還沒有詞條。" : "目前還沒有詞條，請按「新增詞條」。"}</div>`;
      return;
    }
    el.list.innerHTML = visible.map(row => {
      const topicBadges = normalizeTopicTags(row.topic_tags)
        .map(key => `<span class="stat-badge stat-badge--neutral">${escapeHTML(getCommentaryTopic(key).label)}</span>`)
        .join("");
      const draft = row.is_published === false ? '<span class="stat-badge stat-badge--neutral">草稿</span>' : "";
      const aliases = parseTermAliases(row.aliases);
      return `
      <article class="announcement-item" data-admin-term-id="${escapeHTML(String(row.id))}">
        <div class="announcement-item__header">
          <div class="announcement-item__header-left">
            <div class="announcement-item__icon-avatar" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="bookOpen"></span></div>
            <div class="announcement-item__title-group">
              <div class="announcement-item__tags">${draft}<span class="stat-badge stat-badge--neutral">${escapeHTML(termScopeLabel(row))}</span>${topicBadges}</div>
              <h4 class="announcement-item__title">${escapeHTML(row.term)}${aliases.length ? `<span class="admin-term-aliases">（${escapeHTML(aliases.join("、"))}）</span>` : ""}</h4>
            </div>
          </div>
          <div class="announcement-item__meta">
            <button type="button" class="circular-action-btn announcement-item__edit" data-term-edit title="編輯詞條" aria-label="編輯詞條"><span class="nlc-icon nlc-icon--sm" data-icon="pencil" aria-hidden="true"></span></button>
            <button type="button" class="circular-action-btn btn-danger-soft announcement-item__delete" data-term-delete title="刪除詞條" aria-label="刪除詞條"><span class="nlc-icon nlc-icon--sm" data-icon="trash" aria-hidden="true"></span></button>
          </div>
        </div>
        <p class="announcement-item__body">${escapeHTML(excerpt(row.definition))}</p>
      </article>`;
    }).join("");
    if (typeof hydrateIcons === "function") hydrateIcons(el.list);
  }

  async function reload() {
    const result = await db.fetchAllCommentaryTermsForAdmin();
    if (result === null) {
      el.list.innerHTML = '<div class="admin-user-directory__empty">詞條清單載入失敗，請重新整理後再試。</div>';
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
  el.scope.onclick = event => {
    const button = event.target.closest?.("[data-term-scope]");
    if (button) setScope(button.dataset.termScope);
  };
  el.save.onclick = async () => {
    const term = el.name.value.trim();
    const definition = el.definition.value.trim();
    if (!term) {
      showToast("請輸入詞。");
      return;
    }
    if (!definition) {
      showToast("請輸入解釋。");
      return;
    }
    const book = el.book.value;
    const chapter = Number(el.chapter.value);
    let range = null;
    if (scope === "verses") {
      range = normalizeVerseRange(el.verseStart.value.trim(), el.verseEnd.value.trim());
      if (!range) {
        showToast("指定節要填起始節（正整數）。");
        return;
      }
      const verseCount = verseCountFor(verseCounts, books, book, chapter);
      if (verseCount && range.end > verseCount) {
        showToast(`${book} ${chapter} 章只有 ${verseCount} 節。`);
        return;
      }
    }
    const isEditing = Boolean(editingId);
    el.save.disabled = true;
    const ok = await db.saveCommentaryTerm({
      id: editingId,
      term,
      aliases: parseTermAliases(el.aliases.value),
      definition,
      topicTags: selectedTopics(),
      book,
      scope,
      chapter: scope === "book" ? null : chapter,
      verseStart: range ? range.start : null,
      verseEnd: range ? range.end : null,
      source: el.source.value,
      isPublished: el.published.checked
    });
    el.save.disabled = false;
    if (!ok) return;
    showToast(isEditing ? "詞條已更新。" : "詞條已新增。");
    closeEditor();
    await reload();
  };
  el.list.onclick = async event => {
    const card = event.target.closest?.("[data-admin-term-id]");
    if (!card) return;
    const row = rows.find(item => String(item.id) === card.dataset.adminTermId);
    if (!row) return;
    if (event.target.closest("[data-term-edit]")) {
      openEditor(row);
      return;
    }
    if (!event.target.closest("[data-term-delete]")) return;
    const confirmed = await confirm({
      title: `確定要刪除詞條「${row.term}」嗎？`,
      message: "刪除後會友就看不到這個詞條，而且無法復原。只想暫時隱藏的話，可以改成草稿。",
      confirmText: "確認刪除",
      cancelText: "取消",
      isDestructive: true
    });
    if (!confirmed) return;
    if (await db.deleteCommentaryTerm(row.id)) {
      showToast("詞條已刪除。");
      if (String(editingId) === String(row.id)) closeEditor();
      await reload();
    }
  };

  fillChapters(1);
  setScope("book");
  return reload();
}
