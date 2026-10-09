// 後台「經文注釋」（#447、#470、#475）：注釋與詞條在同一頁管理，新增時先選類型。
// - 注釋（passage_commentary）：選書卷＋章，節留空＝整章注釋（一章一則，閱讀器工具列的燈泡），
//   填了節＝節注釋（同一章可以很多則，閱讀器那幾節右邊出現注釋 icon）。
// - 詞條（commentary_terms）：詞、其他寫法、短解釋，範圍三選一——整卷、整章（只套用在經文出現
//   這個詞的節）、指定節（直接掛在那幾節）。
// 兩種都可以勾主題圖片、寫出處、存成草稿。資料仍是兩張表，清單混在一起依經文位置排序。
// 匯入的注釋走審核流程（#471）：上方「審核進度」指派審核者、整卷發布；清單標出待審／退回／
// 通過待發布，通過的可以單則發布，退回的修改後「儲存並重新送審」。
// admin.js 第一次打開這個區塊時呼叫 renderAdminCommentary()。

import {
  COMMENTARY_IMAGE_DIR,
  COMMENTARY_TOPICS,
  commentaryReferenceLabel,
  formatVerseRange,
  getCommentaryTopic,
  normalizeTopicTags,
  normalizeVerseRange,
  parseTermAliases
} from "../data/passage-commentary.mjs";
import { REVIEW_STATUS_LABELS, isInReview } from "../data/commentary-review.mjs";
import { createAdminCommentaryReview } from "./admin-commentary-review.mjs";

const EXCERPT_LENGTH = 90;
export const COMMENTARY_KINDS = Object.freeze(["note", "term"]);
export const TERM_SCOPES = Object.freeze(["book", "chapter", "verses"]);
const KIND_LABELS = Object.freeze({ note: "注釋", term: "詞條" });

// 清單的狀態篩選：已發布、草稿，以及審核流程中的三種（只有注釋會有）。
export function commentaryItemStatus({ kind, row }) {
  if (kind === "note" && isInReview(row)) return row.review_status;
  return row.is_published === false ? "draft" : "published";
}

// 聖經順序 → 章 → 整章注釋在前 → 起始節 → 結束節。
export function sortCommentaryRows(rows, books) {
  const order = new Map((books || []).map((book, index) => [book.name, index]));
  return [...(rows || [])].sort((a, b) => {
    const bookDiff = (order.get(a.book) ?? 999) - (order.get(b.book) ?? 999);
    return bookDiff
      || Number(a.chapter) - Number(b.chapter)
      || (Number(a.verse_start) || 0) - (Number(b.verse_start) || 0)
      || (Number(a.verse_end) || 0) - (Number(b.verse_end) || 0);
  });
}

// 同一章、同一個範圍（整章或同樣的起訖節）已經有一則注釋時回傳它（資料庫也有唯一索引）。
// 匯入的研讀注釋（有 source_ref，#471）不算：同一節可以有多則。
export function findCommentaryForChapter(rows, book, chapter, excludeId = null, verseStart = null, verseEnd = null) {
  const range = normalizeVerseRange(verseStart, verseEnd);
  return (rows || []).find(row => {
    if (row.source_ref) return false;
    if (row.book !== book || Number(row.chapter) !== Number(chapter) || String(row.id) === String(excludeId)) return false;
    const rowRange = normalizeVerseRange(row.verse_start, row.verse_end);
    if (!range || !rowRange) return !range && !rowRange;
    return range.start === rowRange.start && range.end === rowRange.end;
  }) || null;
}

// 節數上限檢查：verseCounts 是 BIBLE_VERSE_COUNTS（英文書名 → 每章節數）；查不到就回 0（不擋）。
export function verseCountFor(verseCounts, books, bookName, chapter) {
  const book = (books || []).find(item => item.name === bookName);
  const counts = book && verseCounts && verseCounts[book.eng];
  return Array.isArray(counts) ? Number(counts[Number(chapter) - 1]) || 0 : 0;
}

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

// 注釋與詞條混在一起排：聖經順序 → 章（整卷詞條排在該卷最前）→ 整章在前 → 起始節 → 結束節
// → 同一位置注釋在前 → 詞。回傳 [{ kind, row }]。
export function sortCommentaryItems(notes, terms, books) {
  const order = new Map((books || []).map((book, index) => [book.name, index]));
  const items = [
    ...(notes || []).map(row => ({ kind: "note", row })),
    ...(terms || []).map(row => ({ kind: "term", row }))
  ];
  const num = value => Number(value) || 0;
  return items.sort((a, b) =>
    (order.get(a.row.book) ?? 999) - (order.get(b.row.book) ?? 999)
    || num(a.row.chapter) - num(b.row.chapter)
    || num(a.row.verse_start) - num(b.row.verse_start)
    || num(a.row.verse_end) - num(b.row.verse_end)
    || COMMENTARY_KINDS.indexOf(a.kind) - COMMENTARY_KINDS.indexOf(b.kind)
    || String(a.row.term || "").localeCompare(String(b.row.term || ""), "zh-Hant"));
}

function excerpt(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
}

function setSegment(container, attribute, value) {
  container.querySelectorAll(`[${attribute}]`).forEach(button => {
    const active = button.getAttribute(attribute) === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

export function renderAdminCommentary({ db, books, verseCounts = null, escapeHTML, showToast, confirm, hydrateIcons = null, getElement = id => document.getElementById(id) }) {
  const el = {
    create: getElement("admin-commentary-create"),
    editor: getElement("admin-commentary-editor"),
    formTitle: getElement("admin-commentary-form-title"),
    kind: getElement("admin-commentary-kind"),
    termFields: getElement("admin-commentary-term-fields"),
    termName: getElement("admin-commentary-term-name"),
    termAliases: getElement("admin-commentary-term-aliases"),
    scope: getElement("admin-commentary-scope"),
    book: getElement("admin-commentary-book"),
    chapterField: getElement("admin-commentary-chapter-field"),
    chapter: getElement("admin-commentary-chapter"),
    verseField: getElement("admin-commentary-verse-field"),
    verseStartLabel: getElement("admin-commentary-verse-start-label"),
    verseStart: getElement("admin-commentary-verse-start"),
    verseEnd: getElement("admin-commentary-verse-end"),
    headingField: getElement("admin-commentary-heading-field"),
    heading: getElement("admin-commentary-heading"),
    contentLabel: getElement("admin-commentary-content-label"),
    content: getElement("admin-commentary-content"),
    topics: getElement("admin-commentary-topic-list"),
    source: getElement("admin-commentary-source"),
    published: getElement("admin-commentary-published"),
    cancel: getElement("admin-commentary-cancel"),
    save: getElement("admin-commentary-save"),
    filter: getElement("admin-commentary-filter"),
    kindFilter: getElement("admin-commentary-kind-filter"),
    statusFilter: getElement("admin-commentary-status-filter"),
    publishField: getElement("admin-commentary-publish-field"),
    reviewHint: getElement("admin-commentary-review-hint"),
    list: getElement("admin-commentary-list")
  };
  if (Object.values(el).some(node => !node) || !Array.isArray(books) || books.length === 0) return Promise.resolve(false);

  let notes = [];
  let terms = [];
  let editing = null; // { kind, id } 編輯既有資料時
  let kind = "note";
  let scope = "book";
  let kindFilter = "all";
  let editingRow = null;

  const review = createAdminCommentaryReview({
    db, books, escapeHTML, showToast, confirm, hydrateIcons, getElement,
    onChanged: () => { void reload({ withReview: false }); }
  });
  review.bind();

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

  // 依類型與詞條範圍顯示需要的欄位。
  function applyFieldVisibility() {
    const isTerm = kind === "term";
    el.termFields.classList.toggle("hidden", !isTerm);
    el.headingField.classList.toggle("hidden", isTerm);
    el.chapterField.classList.toggle("hidden", isTerm && scope === "book");
    el.verseField.classList.toggle("hidden", isTerm && scope !== "verses");
    el.verseStartLabel.textContent = isTerm ? "起始節" : "起始節（選填）";
    el.verseStart.placeholder = isTerm ? "" : "整章";
    el.contentLabel.textContent = isTerm ? "解釋" : "注釋內容";
    el.content.placeholder = isTerm ? "寫給會友看的短解釋。空一行就是新的段落。" : "寫給會友看的經文解釋。空一行就是新的段落。";
  }

  function setKind(next) {
    kind = COMMENTARY_KINDS.includes(next) ? next : "note";
    setSegment(el.kind, "data-commentary-kind", kind);
    applyFieldVisibility();
  }

  function setScope(next) {
    scope = TERM_SCOPES.includes(next) ? next : "book";
    setSegment(el.scope, "data-term-scope", scope);
    applyFieldVisibility();
  }

  function setLocationLocked(locked) {
    el.book.disabled = locked;
    el.chapter.disabled = locked;
    el.verseStart.disabled = locked;
    el.verseEnd.disabled = locked;
  }

  function selectedTopics() {
    return Array.from(el.topics.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
  }

  // 審核流程中的注釋：發布由審核流程決定（隱藏發布勾選），退回／已通過的存檔＝重新送審。
  function applyReviewMode(row) {
    const inReview = kind === "note" && isInReview(row);
    el.publishField.classList.toggle("hidden", inReview);
    el.reviewHint.classList.toggle("hidden", !inReview);
    el.reviewHint.textContent = !inReview ? ""
      : row.review_status === "pending"
        ? "這則在等審核者審核，存檔不會發布。"
        : row.review_status === "returned"
          ? `審核者退回：${row.review_note || "（沒有意見）"}。修改後按「儲存並重新送審」。`
          : "這則已審核通過，等你在清單按「發布」。修改內容後會重新送審。";
    el.save.textContent = inReview && row.review_status !== "pending" ? "儲存並重新送審" : "儲存";
  }

  function closeEditor() {
    editing = null;
    editingRow = null;
    el.editor.classList.add("hidden");
    [el.termName, el.termAliases, el.heading, el.content, el.verseStart, el.verseEnd, el.source].forEach(input => { input.value = ""; });
    el.published.checked = true;
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    el.kind.querySelectorAll("button").forEach(button => { button.disabled = false; });
    setLocationLocked(false);
    setScope("book");
    setKind("note");
    applyReviewMode(null);
  }

  function openEditor(item = null) {
    const row = item ? item.row : null;
    editing = item ? { kind: item.kind, id: row.id } : null;
    editingRow = row;
    setKind(item ? item.kind : (kindFilter === "term" ? "term" : "note"));
    // 既有資料不換類型（底下是不同的表）。
    el.kind.querySelectorAll("button").forEach(button => { button.disabled = Boolean(item); });
    setScope(item && item.kind === "term" ? termScopeOf(row) : "book");
    el.book.value = row ? row.book : (el.filter.value || books[0].name);
    fillChapters(row && row.chapter ? row.chapter : 1);
    el.verseStart.value = row && row.verse_start ? String(row.verse_start) : "";
    el.verseEnd.value = row && row.verse_end && row.verse_end !== row.verse_start ? String(row.verse_end) : "";
    el.termName.value = item && item.kind === "term" ? row.term || "" : "";
    el.termAliases.value = item && item.kind === "term" ? parseTermAliases(row.aliases).join("、") : "";
    el.heading.value = item && item.kind === "note" ? row.title || "" : "";
    el.content.value = !row ? "" : (item.kind === "term" ? row.definition || "" : row.content || "");
    el.source.value = row ? row.source || "" : "";
    el.published.checked = row ? row.is_published !== false : true;
    const tags = new Set(normalizeTopicTags(row ? row.topic_tags : []));
    el.topics.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = tags.has(input.value); });
    // 已存在的注釋不換章、不換節：要搬到別處請刪掉重建，避免撞到另一則注釋。詞條可以改範圍。
    setLocationLocked(Boolean(item && item.kind === "note"));
    applyReviewMode(item && item.kind === "note" ? row : null);
    el.formTitle.textContent = !item ? "新增"
      : item.kind === "term" ? `編輯詞條：${row.term}` : `編輯注釋：${commentaryReferenceLabel(row)}`;
    el.editor.classList.remove("hidden");
    (item ? el.content : (kind === "term" ? el.termName : el.book)).focus();
  }

  function itemHTML({ kind: itemKind, row }) {
    const badge = text => `<span class="stat-badge stat-badge--neutral">${escapeHTML(text)}</span>`;
    const topicBadges = normalizeTopicTags(row.topic_tags).map(key => badge(getCommentaryTopic(key).label)).join("");
    const draft = row.is_published === false ? badge("草稿") : "";
    let tags;
    let titleHTML;
    let body;
    if (itemKind === "term") {
      const aliases = parseTermAliases(row.aliases);
      tags = `${draft}${badge("詞條")}${badge(termScopeLabel(row))}${topicBadges}`;
      titleHTML = `${escapeHTML(row.term)}${aliases.length ? `<span class="admin-commentary-aliases">（${escapeHTML(aliases.join("、"))}）</span>` : ""}`;
      body = row.definition;
    } else {
      const scopeText = normalizeVerseRange(row.verse_start, row.verse_end) ? "節注釋" : "整章";
      const reviewBadge = isInReview(row) ? `<span class="stat-badge stat-badge--warning">${escapeHTML(REVIEW_STATUS_LABELS[row.review_status])}</span>` : "";
      tags = `${isInReview(row) ? "" : draft}${reviewBadge}${badge("注釋")}${badge(scopeText)}${topicBadges}`;
      titleHTML = `${escapeHTML(commentaryReferenceLabel(row))}${row.title ? `・${escapeHTML(row.title)}` : ""}`;
      body = row.content;
    }
    const returnedNote = itemKind === "note" && row.review_status === "returned" && row.review_note
      ? `<p class="admin-commentary-review-note">退回意見：${escapeHTML(row.review_note)}</p>` : "";
    const publishButton = itemKind === "note" && row.review_status === "approved"
      ? '<button type="button" class="pill-btn admin-commentary-publish-btn" data-commentary-publish>發布</button>' : "";
    const noun = KIND_LABELS[itemKind];
    return `
      <article class="announcement-item" data-admin-commentary-id="${escapeHTML(String(row.id))}" data-admin-commentary-kind="${itemKind}">
        <div class="announcement-item__header">
          <div class="announcement-item__header-left">
            <div class="announcement-item__icon-avatar" aria-hidden="true">${itemKind === "term" ? '<span class="nlc-icon nlc-icon--sm" data-icon="bookOpen"></span>' : '<span class="nlc-icon nlc-icon--sm" data-icon="lightbulb"></span>'}</div>
            <div class="announcement-item__title-group">
              <div class="announcement-item__tags">${tags}</div>
              <h4 class="announcement-item__title">${titleHTML}</h4>
            </div>
          </div>
          <div class="announcement-item__meta">
            ${publishButton}
            <button type="button" class="circular-action-btn announcement-item__edit" data-commentary-edit title="編輯${noun}" aria-label="編輯${noun}"><span class="nlc-icon nlc-icon--sm" data-icon="pencil" aria-hidden="true"></span></button>
            <button type="button" class="circular-action-btn btn-danger-soft announcement-item__delete" data-commentary-delete title="刪除${noun}" aria-label="刪除${noun}"><span class="nlc-icon nlc-icon--sm" data-icon="trash" aria-hidden="true"></span></button>
          </div>
        </div>
        ${returnedNote}
        <p class="announcement-item__body">${escapeHTML(excerpt(body))}</p>
      </article>`;
  }

  function renderList() {
    const filterBook = el.filter.value;
    const statusFilter = el.statusFilter.value;
    const visible = sortCommentaryItems(notes, terms, books)
      .filter(item => (!filterBook || item.row.book === filterBook) && (kindFilter === "all" || item.kind === kindFilter))
      .filter(item => !statusFilter || commentaryItemStatus(item) === statusFilter);
    if (!visible.length) {
      const empty = notes.length + terms.length === 0
        ? "目前還沒有經文注釋或詞條，請按「新增」。"
        : "沒有符合篩選條件的項目。";
      el.list.innerHTML = `<div class="admin-user-directory__empty">${empty}</div>`;
      return;
    }
    el.list.innerHTML = visible.map(itemHTML).join("");
    if (typeof hydrateIcons === "function") hydrateIcons(el.list);
  }

  async function reload({ withReview = true } = {}) {
    if (withReview) void review.reload();
    const [noteRows, termRows] = await Promise.all([db.fetchAllPassageCommentaryForAdmin(), db.fetchAllCommentaryTermsForAdmin()]);
    if (noteRows === null || termRows === null) {
      el.list.innerHTML = '<div class="admin-user-directory__empty">清單載入失敗，請重新整理後再試。</div>';
      return false;
    }
    notes = noteRows;
    terms = termRows;
    renderList();
    return true;
  }

  // 注釋：節留空＝整章；同範圍已經有一則就擋下。
  async function saveNote(content) {
    const book = el.book.value;
    const chapter = Number(el.chapter.value);
    const verseStart = el.verseStart.value.trim();
    const verseEnd = el.verseEnd.value.trim();
    const range = normalizeVerseRange(verseStart, verseEnd);
    if ((verseStart || verseEnd) && !range) {
      showToast("請先填起始節（正整數）；整章注釋的話，兩格都留空。");
      return false;
    }
    const verseCount = verseCountFor(verseCounts, books, book, chapter);
    if (range && verseCount && range.end > verseCount) {
      showToast(`${book} ${chapter} 章只有 ${verseCount} 節。`);
      return false;
    }
    if (!editing && findCommentaryForChapter(notes, book, chapter, null, range?.start, range?.end)) {
      showToast(range ? "這幾節已經有一則同範圍的注釋了，請在清單中編輯它。" : "這一章已經有整章注釋了，請在清單中編輯它。");
      return false;
    }
    const inReview = Boolean(editing && isInReview(editingRow));
    const saved = await db.savePassageCommentary({
      id: editing ? editing.id : null,
      book,
      chapter,
      verseStart: range ? range.start : null,
      verseEnd: range ? range.end : null,
      title: el.heading.value,
      content,
      topicTags: selectedTopics(),
      source: el.source.value,
      isPublished: inReview ? null : el.published.checked
    });
    if (!saved || !inReview || editingRow.review_status === "pending") return saved;
    const resubmitted = await db.resubmitCommentary({ id: editing.id });
    if (!resubmitted.success) showToast(resubmitted.message || "已存檔，但重新送審失敗。");
    return resubmitted.success;
  }

  async function saveTerm(definition) {
    const term = el.termName.value.trim();
    if (!term) {
      showToast("請輸入詞。");
      return false;
    }
    const book = el.book.value;
    const chapter = Number(el.chapter.value);
    let range = null;
    if (scope === "verses") {
      range = normalizeVerseRange(el.verseStart.value.trim(), el.verseEnd.value.trim());
      if (!range) {
        showToast("指定節要填起始節（正整數）。");
        return false;
      }
      const verseCount = verseCountFor(verseCounts, books, book, chapter);
      if (verseCount && range.end > verseCount) {
        showToast(`${book} ${chapter} 章只有 ${verseCount} 節。`);
        return false;
      }
    }
    return db.saveCommentaryTerm({
      id: editing ? editing.id : null,
      term,
      aliases: parseTermAliases(el.termAliases.value),
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
  }

  el.create.onclick = () => openEditor();
  el.cancel.onclick = closeEditor;
  el.book.onchange = () => fillChapters(1);
  el.filter.onchange = renderList;
  el.statusFilter.onchange = renderList;
  el.kind.onclick = event => {
    const button = event.target.closest?.("[data-commentary-kind]");
    if (button && !button.disabled) setKind(button.dataset.commentaryKind);
  };
  el.scope.onclick = event => {
    const button = event.target.closest?.("[data-term-scope]");
    if (button) setScope(button.dataset.termScope);
  };
  el.kindFilter.onclick = event => {
    const button = event.target.closest?.("[data-kind-filter]");
    if (!button) return;
    kindFilter = button.dataset.kindFilter;
    setSegment(el.kindFilter, "data-kind-filter", kindFilter);
    renderList();
  };
  el.save.onclick = async () => {
    const content = el.content.value.trim();
    if (!content) {
      showToast(kind === "term" ? "請輸入解釋。" : "請輸入注釋內容。");
      return;
    }
    const savingKind = kind;
    const isEditing = Boolean(editing);
    el.save.disabled = true;
    const ok = savingKind === "term" ? await saveTerm(content) : await saveNote(content);
    el.save.disabled = false;
    if (!ok) return;
    showToast(`${KIND_LABELS[savingKind]}已${isEditing ? "更新" : "新增"}。`);
    closeEditor();
    await reload();
  };
  el.list.onclick = async event => {
    const card = event.target.closest?.("[data-admin-commentary-id]");
    if (!card) return;
    const itemKind = card.dataset.adminCommentaryKind === "term" ? "term" : "note";
    const row = (itemKind === "term" ? terms : notes).find(item => String(item.id) === card.dataset.adminCommentaryId);
    if (!row) return;
    if (event.target.closest("[data-commentary-edit]")) {
      openEditor({ kind: itemKind, row });
      return;
    }
    const publishButton = event.target.closest("[data-commentary-publish]");
    if (publishButton && itemKind === "note") {
      publishButton.disabled = true;
      const result = await db.publishApprovedCommentary({ ids: [row.id] });
      publishButton.disabled = false;
      if (!result.success) {
        showToast(result.message || "發布失敗。");
        return;
      }
      showToast(result.published ? "已發布，會友現在看得到這則注釋。" : "這則已經不是「通過待發布」，請重新整理。");
      await reload();
      return;
    }
    if (!event.target.closest("[data-commentary-delete]")) return;
    const noun = KIND_LABELS[itemKind];
    const confirmed = await confirm({
      title: itemKind === "term" ? `確定要刪除詞條「${row.term}」嗎？` : `確定要刪除「${commentaryReferenceLabel(row)}」的注釋嗎？`,
      message: `刪除後會友就看不到這個${noun}，而且無法復原。只想暫時隱藏的話，可以改成草稿。`,
      confirmText: "確認刪除",
      cancelText: "取消",
      isDestructive: true
    });
    if (!confirmed) return;
    const deleted = itemKind === "term" ? await db.deleteCommentaryTerm(row.id) : await db.deletePassageCommentary(row.id);
    if (!deleted) return;
    showToast(`${noun}已刪除。`);
    if (editing && editing.kind === itemKind && String(editing.id) === String(row.id)) closeEditor();
    await reload();
  };

  fillChapters(1);
  setScope("book");
  setKind("note");
  return reload();
}
