// 後台「得獎與兌換」的店家帳號（#679）：搜尋帳號後加入或移除。
// 資料都走 db 的 RPC，SQL 端檢查系統管理員、登入過才能指定，並在同一個交易寫稽核。

const SEARCH_DELAY_MS = 300;

// 同 admin_search_voucher_merchant_candidates：有中文，或至少兩個英文或數字才送出。
export function isSearchableQuery(query) {
  const text = String(query || "").trim();
  if (!text || text.length > 100) return false;
  return /[㐀-鿿豈-﫿]/.test(text) || text.replace(/[^A-Za-z0-9]/g, "").length >= 2;
}

function fill(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);
}

export function createAdminVoucherMerchants({
  db,
  escapeHTML,
  showToast,
  confirm,
  host,
  copy = () => window.APP_COPY.voucherMerchantAdmin,
  searchDelayMs = SEARCH_DELAY_MS
}) {
  let merchants = [];
  let candidates = [];
  let query = "";
  let searchState = "idle"; // idle | short | searching | done | failed
  let searchSeq = 0;
  let searchTimer = null;
  let bound = false;

  const who = person => {
    const details = [person.emailMasked, person.pastoralZone].filter(Boolean).join("・");
    return `<div class="admin-voucher-merchants__who">${escapeHTML(person.name || "（未命名）")}${details ? `<span>${escapeHTML(details)}</span>` : ""}</div>`;
  };

  function merchantsHtml() {
    const t = copy();
    if (!merchants.length) return `<p class="admin-voucher-merchants__note">${escapeHTML(t.empty)}</p>`;
    return `<ul class="admin-voucher-merchants__list">${merchants.map(person => `
      <li class="admin-voucher-merchants__row">
        ${who(person)}
        <button type="button" class="pill-btn" data-merchant-remove="${escapeHTML(String(person.profileId))}">${escapeHTML(t.remove)}</button>
      </li>`).join("")}</ul>`;
  }

  function resultsHtml() {
    const t = copy();
    if (searchState === "short") return `<p class="admin-voucher-merchants__note">${escapeHTML(t.searchHint)}</p>`;
    if (searchState === "searching") return `<p class="admin-voucher-merchants__note">${escapeHTML(t.searching)}</p>`;
    if (searchState === "failed") return `<p class="admin-voucher-merchants__note">${escapeHTML(t.searchFail)}</p>`;
    if (searchState !== "done") return "";
    if (!candidates.length) return `<p class="admin-voucher-merchants__note">${escapeHTML(t.noResult)}</p>`;
    return `<ul class="admin-voucher-merchants__list">${candidates.map(person => `
      <li class="admin-voucher-merchants__row">
        ${who(person)}
        ${person.isMerchant
          ? `<span class="stat-badge stat-badge--neutral">${escapeHTML(t.added)}</span>`
          : `<button type="button" class="pill-btn" data-merchant-add="${escapeHTML(String(person.profileId))}">${escapeHTML(t.add)}</button>`}
      </li>`).join("")}</ul>`;
  }

  const drawResults = () => {
    const results = host?.querySelector("[data-merchant-results]");
    if (results) results.innerHTML = resultsHtml();
  };
  const drawMerchants = () => {
    const list = host?.querySelector("[data-merchant-list]");
    if (list) list.innerHTML = merchantsHtml();
  };

  function shell() {
    const t = copy();
    return `
      <h4 class="admin-lq-awards__overview-title admin-voucher-merchants__title">${escapeHTML(t.title)}</h4>
      <p class="admin-voucher-merchants__hint">${escapeHTML(t.hint)}</p>
      <div data-merchant-list></div>
      <label class="admin-voucher-merchants__search">${escapeHTML(t.searchLabel)}
        <input type="search" class="form-control" data-merchant-search placeholder="${escapeHTML(t.searchPlaceholder)}" autocomplete="off">
      </label>
      <div data-merchant-results></div>`;
  }

  async function runSearch(text) {
    const seq = ++searchSeq;
    const result = await db.adminSearchVoucherMerchantCandidates(text);
    if (seq !== searchSeq) return;
    if (!result?.success) {
      candidates = [];
      searchState = "failed";
    } else {
      candidates = Array.isArray(result.data?.candidates) ? result.data.candidates : [];
      searchState = "done";
    }
    drawResults();
  }

  function onSearchInput(value) {
    query = value;
    clearTimeout(searchTimer);
    searchSeq += 1;
    const text = query.trim();
    if (!text) {
      candidates = [];
      searchState = "idle";
    } else if (!isSearchableQuery(text)) {
      candidates = [];
      searchState = "short";
    } else {
      searchState = "searching";
      searchTimer = setTimeout(() => { void runSearch(text); }, searchDelayMs);
    }
    drawResults();
  }

  async function setMerchant(button, profileId, enabled) {
    const t = copy();
    const person = (enabled ? candidates : merchants).find(item => String(item.profileId) === profileId);
    const name = person?.name || "這個帳號";
    const confirmed = await confirm({
      title: enabled ? t.addTitle : t.removeTitle,
      message: fill(enabled ? t.addMessage : t.removeMessage, { name }),
      confirmText: enabled ? t.addConfirm : t.removeConfirm,
      cancelText: t.cancel
    });
    if (!confirmed) return;
    button.disabled = true;
    const saved = await db.adminSetVoucherMerchant(profileId, enabled);
    if (!saved?.success) {
      button.disabled = false;
      showToast(saved?.message || t.saveFail);
      return;
    }
    merchants = Array.isArray(saved.data?.merchants) ? saved.data.merchants : merchants;
    candidates = candidates.map(item => (String(item.profileId) === profileId ? { ...item, isMerchant: enabled } : item));
    drawMerchants();
    drawResults();
    showToast(enabled ? t.addedToast : t.removedToast);
  }

  function bind() {
    if (bound || !host) return;
    bound = true;
    host.addEventListener("input", event => {
      if (event.target.matches("[data-merchant-search]")) onSearchInput(event.target.value);
    });
    host.addEventListener("click", event => {
      const add = event.target.closest("[data-merchant-add]");
      if (add) { void setMerchant(add, add.dataset.merchantAdd, true); return; }
      const remove = event.target.closest("[data-merchant-remove]");
      if (remove) void setMerchant(remove, remove.dataset.merchantRemove, false);
    });
  }

  async function load() {
    if (!host) return;
    const t = copy();
    host.innerHTML = shell();
    bind();
    const list = host.querySelector("[data-merchant-list]");
    list.innerHTML = `<p class="admin-voucher-merchants__note">${escapeHTML(t.loading)}</p>`;
    const result = await db.adminListVoucherMerchants();
    if (!result?.success) {
      list.innerHTML = `<p class="admin-voucher-merchants__note">${escapeHTML(t.loadFail)}</p>`;
      return;
    }
    merchants = Array.isArray(result.data?.merchants) ? result.data.merchants : [];
    drawMerchants();
  }

  return { load };
}
