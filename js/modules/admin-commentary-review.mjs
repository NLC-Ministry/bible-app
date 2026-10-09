// 後台「經文注釋」頁上方的「審核進度」（#471）：
// - 每卷的待審／退回／通過待發布／已發布數量與審核者名單；
// - 依書卷指派審核者（任何會友都可以，不新增角色）；
// - 最終發布：把這一卷「通過待發布」的注釋一次發布（單則發布在下方清單）。
// 資料都走 db 的審核 RPC，SQL 端檢查系統管理員。

const MAX_SEARCH_RESULTS = 8;

export function reviewProgressText(book) {
  const parts = [
    ["待審", book.pending],
    ["退回", book.returned],
    ["通過待發布", book.approved],
    ["已發布", book.published]
  ].map(([label, count]) => `${label} ${Number(count) || 0}`);
  return parts.join("・");
}

// 名字或牧區包含關鍵字（不分大小寫），排除已選的人，最多 8 筆。
export function searchMembers(members, query, excludeIds = []) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];
  const excluded = new Set((excludeIds || []).map(String));
  return (members || [])
    .filter(member => member && member.id && !excluded.has(String(member.id)))
    .filter(member => `${member.name || ""} ${member.pastoral_zone || ""}`.toLowerCase().includes(text))
    .slice(0, MAX_SEARCH_RESULTS);
}

function memberLabel(member, escapeHTML) {
  const zone = String(member.pastoral_zone || "").trim();
  return `${escapeHTML(member.name || "（未命名）")}${zone ? `<span class="admin-commentary-assign__zone">${escapeHTML(zone)}</span>` : ""}`;
}

export function createAdminCommentaryReview({
  db,
  books,
  escapeHTML,
  showToast,
  confirm,
  hydrateIcons = null,
  onChanged = () => {},
  getElement = id => document.getElementById(id)
}) {
  let overview = [];
  let members = null;
  let assigning = null; // { book, selected: [{ id, name, pastoral_zone }], query }
  let bound = false;

  const container = () => getElement("admin-commentary-review");
  const bookOrder = new Map((books || []).map((book, index) => [book.name, index]));

  function sortedOverview() {
    return [...overview].sort((a, b) => (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999));
  }

  function assignEditorHtml() {
    const results = searchMembers(members || [], assigning.query, assigning.selected.map(member => member.id));
    const chips = assigning.selected.map(member => `
      <button type="button" class="yv-chip admin-commentary-assign__chip" data-assign-remove="${escapeHTML(String(member.id))}" aria-label="移除 ${escapeHTML(member.name || "")}">
        <span>${escapeHTML(member.name || "")}</span>
        <span class="nlc-icon" data-icon="close" aria-hidden="true"></span>
      </button>`).join("");
    let resultHtml = "";
    if (members === null) resultHtml = '<p class="admin-commentary-assign__hint">正在載入會友名單…</p>';
    else if (assigning.query.trim() && !results.length) resultHtml = '<p class="admin-commentary-assign__hint">找不到符合的會友。</p>';
    else resultHtml = results.map(member => `
      <button type="button" class="admin-commentary-assign__result" data-assign-add="${escapeHTML(String(member.id))}">${memberLabel(member, escapeHTML)}</button>`).join("");
    return `
      <div class="admin-commentary-assign">
        <label>搜尋會友（姓名或牧區）
          <input type="search" class="form-control announcement-form-panel__input" data-assign-search value="${escapeHTML(assigning.query)}" placeholder="例如：王" autocomplete="off">
        </label>
        <div class="admin-commentary-assign__results">${resultHtml}</div>
        <div class="admin-commentary-assign__chips" aria-label="已選的審核者">${chips || '<p class="admin-commentary-assign__hint">還沒有選審核者。</p>'}</div>
        <div class="announcement-form-panel__actions">
          <button type="button" class="pill-btn" data-assign-cancel>取消</button>
          <button type="button" class="primary-btn" data-assign-save>儲存審核者</button>
        </div>
      </div>`;
  }

  function bookCardHtml(book) {
    const reviewers = Array.isArray(book.reviewers) ? book.reviewers : [];
    const names = reviewers.length
      ? reviewers.map(member => escapeHTML(member.name || "")).join("、")
      : "尚未指派審核者";
    const approved = Number(book.approved) || 0;
    const editing = assigning && assigning.book === book.book;
    return `
      <article class="admin-commentary-review__book" data-review-book="${escapeHTML(book.book)}">
        <header class="admin-commentary-review__book-head">
          <strong>${escapeHTML(book.book)}</strong>
          <span class="admin-commentary-review__counts">${escapeHTML(reviewProgressText(book))}</span>
        </header>
        <p class="admin-commentary-review__reviewers">審核者：${names}</p>
        ${editing ? assignEditorHtml() : `
        <div class="admin-commentary-review__actions">
          <button type="button" class="pill-btn" data-review-assign>指派審核者</button>
          ${approved ? `<button type="button" class="primary-btn" data-review-publish>發布已通過的 ${approved} 則</button>` : ""}
        </div>`}
      </article>`;
  }

  function render() {
    const root = container();
    if (!root) return;
    const list = sortedOverview();
    const newBookEditing = assigning && !overview.some(book => book.book === assigning.book);
    const bookOptions = (books || [])
      .filter(book => !overview.some(item => item.book === book.name))
      .map(book => `<option value="${escapeHTML(book.name)}">${escapeHTML(book.name)}</option>`).join("");
    root.innerHTML = `
      <div class="admin-commentary-review__head">
        <h4 class="admin-commentary-review__title">審核進度</h4>
        <p>匯入的注釋要經過審核者通過、再由你按「發布」，會友才看得到。審核者只能審被指派的書卷。</p>
      </div>
      <div class="admin-commentary-review__books">
        ${list.length ? list.map(bookCardHtml).join("") : '<div class="admin-user-directory__empty">目前沒有需要審核的書卷。</div>'}
        ${newBookEditing ? bookCardHtml({ book: assigning.book, reviewers: [] }) : ""}
      </div>
      ${bookOptions && !newBookEditing ? `
      <div class="admin-commentary-review__add">
        <label>替其他書卷指派審核者
          <select class="form-control announcement-form-panel__input" data-review-add-book>${bookOptions}</select>
        </label>
        <button type="button" class="pill-btn" data-review-add>指派</button>
      </div>` : ""}`;
    if (typeof hydrateIcons === "function") hydrateIcons(root);
  }

  // 只重畫搜尋結果，輸入框不重建（不會打斷輸入）。
  function renderSearchResults() {
    const root = container();
    const results = root?.querySelector(".admin-commentary-assign__results");
    if (!results || !assigning) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = assignEditorHtml();
    results.innerHTML = wrapper.querySelector(".admin-commentary-assign__results").innerHTML;
  }

  async function reload() {
    const result = await db.fetchCommentaryReviewOverview();
    if (!result.success) {
      const root = container();
      if (root) root.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || "審核進度載入失敗。")}</div>`;
      return false;
    }
    overview = result.books;
    render();
    return true;
  }

  async function openAssign(bookName) {
    const current = overview.find(book => book.book === bookName);
    assigning = { book: bookName, selected: [...(current?.reviewers || [])], query: "" };
    render();
    container()?.querySelector("[data-assign-search]")?.focus();
    if (members === null) {
      const result = await db.fetchManagedScopeProfiles();
      members = (result && Array.isArray(result.data) ? result.data : [])
        .filter(member => member && member.id && member.is_active !== false)
        .map(member => ({ id: member.id, name: member.name || "", pastoral_zone: member.pastoral_zone || "" }));
      if (result?.error) showToast("會友名單載入失敗，請重新整理後再試。");
      renderSearchResults();
    }
  }

  async function saveAssign(button) {
    if (!assigning) return;
    button.disabled = true;
    const result = await db.setCommentaryReviewers(assigning.book, assigning.selected.map(member => member.id));
    button.disabled = false;
    if (!result.success) {
      showToast(result.message || "儲存審核者失敗。");
      return;
    }
    showToast(`已更新《${assigning.book}》的審核者。`);
    assigning = null;
    overview = result.books;
    render();
  }

  async function publishBook(bookName, button) {
    const book = overview.find(item => item.book === bookName);
    const count = Number(book?.approved) || 0;
    if (!count) return;
    const confirmed = await confirm({
      title: `發布《${bookName}》已通過的 ${count} 則注釋？`,
      message: "發布後會友在閱讀器就看得到。之後要撤下，可以在下方清單把那一則改成草稿。",
      confirmText: "確認發布",
      cancelText: "取消"
    });
    if (!confirmed) return;
    button.disabled = true;
    const result = await db.publishApprovedCommentary({ book: bookName });
    button.disabled = false;
    if (!result.success) {
      showToast(result.message || "發布失敗。");
      return;
    }
    showToast(`已發布 ${result.published} 則注釋。`);
    await reload();
    onChanged();
  }

  function bind() {
    const root = container();
    if (bound || !root) return;
    bound = true;
    root.addEventListener("click", event => {
      const target = event.target;
      const card = target.closest?.("[data-review-book]");
      const bookName = card?.dataset.reviewBook;
      if (target.closest("[data-review-assign]") && bookName) {
        void openAssign(bookName);
      } else if (target.closest("[data-review-publish]") && bookName) {
        void publishBook(bookName, target.closest("[data-review-publish]"));
      } else if (target.closest("[data-review-add]")) {
        const select = root.querySelector("[data-review-add-book]");
        if (select?.value) void openAssign(select.value);
      } else if (target.closest("[data-assign-add]") && assigning) {
        const id = target.closest("[data-assign-add]").dataset.assignAdd;
        const member = (members || []).find(item => String(item.id) === id);
        if (member) assigning.selected.push(member);
        assigning.query = "";
        render();
        root.querySelector("[data-assign-search]")?.focus();
      } else if (target.closest("[data-assign-remove]") && assigning) {
        const id = target.closest("[data-assign-remove]").dataset.assignRemove;
        assigning.selected = assigning.selected.filter(member => String(member.id) !== id);
        render();
      } else if (target.closest("[data-assign-cancel]")) {
        assigning = null;
        render();
      } else if (target.closest("[data-assign-save]")) {
        void saveAssign(target.closest("[data-assign-save]"));
      }
    });
    root.addEventListener("input", event => {
      if (!event.target.matches?.("[data-assign-search]") || !assigning) return;
      assigning.query = event.target.value;
      renderSearchResults();
    });
  }

  return { bind, reload, render, get overview() { return overview; } };
}
