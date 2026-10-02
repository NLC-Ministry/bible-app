// 每日靈修與小組聚會週計畫的會友端畫面（#370 從 plan.js 拆出的 lazy chunk）。
// plan.js 裡同名的 renderDevotionViewer / renderGroupMeetingViewer 先把容器與「載入中」
// 顯示出來，第一次用到時才下載這個檔再轉呼叫；沒有點進這兩種計畫的人不會載入。

import {
  openReaderPassage,
  parsePassageLabel,
  showDevotionViewerRoot,
  showGroupMeetingViewerRoot
} from "./plan.js";

// 靈修影片連結只存网址，縮圖用 YouTube 自家公開的縮圖 CDN 現拼現算
// （img.youtube.com/vi/<id>/...），不用呼叫任何 API、不用金鑰——只是把網址
// 裡的 video id 抽出來組另一個網址而已。抽不出 id（例如貼的不是 YouTube 連結）
// 就沒有縮圖，退回純文字連結。
function extractYoutubeVideoId(url) {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const match = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
      if (match) return match[1];
    }
  } catch (_) { /* not a valid URL */ }
  return null;
}

// 靈修「經文進度」點下去：先在靈修畫面內「只顯示該段經文」（風格沿用讀經系統的
// .bible-verse / .verse-num / .verse-text），再按「查看完整章節」才切到聖經讀經系統。
async function renderDevotionPassageInline(host, ref, label, onBack) {
  if (!host || !ref || !ref.book) { if (typeof onBack === "function") onBack(); return; }
  const version = String((state.readerState && state.readerState.version) || "CUNP").toUpperCase();
  const book = (window.BIBLE_BOOKS || []).find(b => b.name === ref.book);
  const chapFrom = Number(ref.chapterFrom) || 1;
  const chapTo = Math.max(chapFrom, Number(ref.chapterTo) || chapFrom);
  const vFrom = Number(ref.verseFrom) || 1;
  const vTo = Number(ref.verseTo) || 9999;
  const refLabel = label || `${ref.book} ${chapFrom}:${vFrom}`;
  const chevL = typeof renderIcon === "function" ? renderIcon("chevronLeft", { size: "sm", className: "nlc-icon" }) : "‹";

  host.innerHTML = `
    <div class="devotion-view">
      <section class="devotion-passage">
        <div class="devotion-passage__bar">
          <button type="button" class="devotion-passage__back" data-devo-passage-back>${chevL}<span>返回靈修</span></button>
          <span class="devotion-passage__ref">${escapeHTML(refLabel)}</span>
          <span class="devotion-passage__ver">${escapeHTML(version)}</span>
        </div>
        <div class="devotion-passage__text"><p class="devotion-view__muted">正在載入經文…</p></div>
        <button type="button" class="secondary-btn devotion-passage__full" data-devo-passage-full>查看完整章節</button>
      </section>
    </div>`;

  host.querySelector("[data-devo-passage-back]")?.addEventListener("click", () => { if (typeof onBack === "function") onBack(); });
  host.querySelector("[data-devo-passage-full]")?.addEventListener("click", () => {
    if (typeof openReaderPassage === "function") openReaderPassage(ref);
  });
  if (typeof hydrateIcons === "function") hydrateIcons(host);

  const textEl = host.querySelector(".devotion-passage__text");
  if (!book) {
    if (textEl) textEl.innerHTML = `<p class="devotion-view__muted">找不到「${escapeHTML(ref.book)}」這卷書，請直接看完整章節。</p>`;
    return;
  }

  try {
    const rows = [];
    const lastChap = Math.min(chapTo, chapFrom + 3); // 保險：最多跨 4 章
    for (let c = chapFrom; c <= lastChap; c++) {
      const data = await fetchBibleChapter(book.eng, c, version);
      const verses = (data && Array.isArray(data.verses)) ? data.verses : [];
      const lo = c === chapFrom ? vFrom : 1;
      const hi = c === chapTo ? vTo : 9999;
      const picked = verses.filter(v => Number(v.verse) >= lo && Number(v.verse) <= hi);
      if (lastChap > chapFrom && picked.length) rows.push(`<div class="devotion-passage__chap">${escapeHTML(book.name)} ${c}章</div>`);
      picked.forEach(v => {
        rows.push(`<div class="bible-verse" data-verse="${v.verse}"><span class="verse-num">${v.verse}</span><span class="verse-text">${v.text}</span></div>`);
      });
    }
    if (textEl) textEl.innerHTML = rows.length
      ? rows.join("")
      : `<p class="devotion-view__muted">這段經文暫時載入不到，請點「查看完整章節」。</p>`;
  } catch (_) {
    if (textEl) textEl.innerHTML = `<p class="devotion-view__muted">經文載入失敗，請點「查看完整章節」。</p>`;
  }
}
window.renderDevotionPassageInline = renderDevotionPassageInline;

// 分享用：把靈修某段經文抓成純文字（「1 經文內容\n2 …」，跨章加「書名 N章」標題）。
// 沿用 renderDevotionPassageInline 同一套抓法，只是輸出純文字（v.text 去標籤）。
async function fetchDevotionPassagePlainText(ref) {
  if (!ref || !ref.book || typeof fetchBibleChapter !== "function") return "";
  const version = String((state.readerState && state.readerState.version) || "CUNP").toUpperCase();
  const book = (window.BIBLE_BOOKS || []).find(b => b.name === ref.book);
  if (!book) return "";
  const chapFrom = Number(ref.chapterFrom) || 1;
  const chapTo = Math.max(chapFrom, Number(ref.chapterTo) || chapFrom);
  const vFrom = Number(ref.verseFrom) || 1;
  const vTo = Number(ref.verseTo) || 9999;
  const strip = (html) => {
    try {
      const d = document.createElement("div");
      d.innerHTML = String(html || "");
      return (d.textContent || "").replace(/\s+/g, " ").trim();
    } catch (_) {
      return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
  };
  const out = [];
  const lastChap = Math.min(chapTo, chapFrom + 3); // 保險：最多跨 4 章
  for (let c = chapFrom; c <= lastChap; c++) {
    let data = null;
    try { data = await fetchBibleChapter(book.eng, c, version); } catch (_) { data = null; }
    const verses = (data && Array.isArray(data.verses)) ? data.verses : [];
    const lo = c === chapFrom ? vFrom : 1;
    const hi = c === chapTo ? vTo : 9999;
    const picked = verses.filter(v => Number(v.verse) >= lo && Number(v.verse) <= hi);
    if (lastChap > chapFrom && picked.length) out.push(`${book.name} ${c}章`);
    picked.forEach(v => { const t = strip(v.text); if (t) out.push(`${v.verse} ${t}`); });
  }
  return out.join("\n");
}
window.fetchDevotionPassagePlainText = fetchDevotionPassagePlainText;

// ── 每日靈修 viewer（會友端；plan_kind='devotional'）─────────────────────────
let devotionViewerDayIndex = null;
let devotionViewerPlanId = null;

export function resetDevotionViewerDay() {
  devotionViewerDayIndex = null;
}

export function renderDevotionViewer(plan) {
  const host = showDevotionViewerRoot();
  if (!host) return Promise.resolve();
  host.innerHTML = '<div class="devotion-view"><p class="devotion-view__loading">正在載入每日靈修…</p></div>';

  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  if (devotionViewerPlanId !== planId) { devotionViewerPlanId = planId; devotionViewerDayIndex = null; }
  return db.getDevotionalPlan(planId).then(async res => {
    if (!res.success) {
      host.innerHTML = `<div class="devotion-view"><p class="devotion-view__loading">${escapeHTML(res.message || "無法載入每日靈修。")}</p></div>`;
      return;
    }
    const d = res.data || {};
    const days = (Array.isArray(d.days) ? d.days : []).slice().sort((a, b) => a.dayIndex - b.dayIndex);
    if (!days.length) {
      host.innerHTML = '<div class="devotion-view"><p class="devotion-view__loading">內容準備中，敬請期待。</p></div>';
      return;
    }
    const total = days[days.length - 1].dayIndex;
    // 預設落在「今天對應的那天」，夾在有內容的範圍
    if (devotionViewerDayIndex == null) {
      const todayRow = days.find(x => x.displayDate === d.today);
      if (todayRow) devotionViewerDayIndex = todayRow.dayIndex;
      else {
        const past = days.filter(x => x.displayDate <= d.today);
        devotionViewerDayIndex = past.length ? past[past.length - 1].dayIndex : days[0].dayIndex;
      }
    }
    const clampToAvailable = (idx) => {
      const exact = days.find(x => x.dayIndex === idx);
      if (exact) return exact;
      const le = days.filter(x => x.dayIndex <= idx);
      return le.length ? le[le.length - 1] : days[0];
    };
    let cur = clampToAvailable(devotionViewerDayIndex);
    devotionViewerDayIndex = cur.dayIndex;

    // ── 個人打勾 + 思想經文心得 ──
    // 本機 localStorage 為底；心得一律同步到 Supabase（migration 0158），
    // 「最近一週」內的打勾也同步，更早的打勾只留本機。換裝置 / 清快取時心得
    // 不會弄丟。雲端載入失敗（示範模式 / 離線 / localhost）就純本機運作。
    const readKey = (di) => `devotion_read_${planId}_${di}`;
    const thinkKey = (di, i) => `devotion_thought_${planId}_${di}_${i}`;
    const noteMirrorKey = (di, i) => `devotion_think_note_${planId}_${di}_${i}`;
    const lsGet = (k) => { try { return localStorage.getItem(k) === "1"; } catch (_) { return false; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch (_) {} };
    const lsGetRaw = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
    const lsSetRaw = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) {} };

    const cloud = new Map(); // "di|kind|idx" -> { done, note }
    const cloudKey = (di, kind, i) => `${di}|${kind}|${i}`;
    try {
      const pr = await db.listDevotionProgress(planId);
      const items = pr && pr.success && pr.data && Array.isArray(pr.data.items) ? pr.data.items : [];
      items.forEach(it => {
        cloud.set(cloudKey(it.dayIndex, it.itemKind, it.itemIndex == null ? 0 : it.itemIndex), {
          done: it.done === true, note: String(it.note || "")
        });
      });
    } catch (_) { /* 純本機 */ }

    const parseISO = (s) => { const t = new Date(`${s}T00:00:00Z`); return Number.isNaN(t.getTime()) ? null : t; };
    const daysApart = (a, b) => {
      const da = parseISO(a), db2 = parseISO(b);
      if (!da || !db2) return Infinity;
      return Math.round((da - db2) / 86400000);
    };
    const todayISO = d.today || "";
    // 「最近一週」= 今天往前推 7 天（含今天）。範圍外的打勾只存本機。
    const withinSyncWindow = (displayDate) => {
      const diff = daysApart(todayISO, displayDate);
      return diff >= 0 && diff <= 7;
    };

    const isPassageDone = (row) => {
      const c = cloud.get(cloudKey(row.dayIndex, "passage", 0));
      return (c && c.done) || lsGet(readKey(row.dayIndex));
    };
    const isThinkDone = (di, i) => {
      const c = cloud.get(cloudKey(di, "think", i));
      return (c && c.done) || lsGet(thinkKey(di, i));
    };
    const thinkNote = (di, i) => {
      const c = cloud.get(cloudKey(di, "think", i));
      if (c && c.note) return c.note;
      return lsGetRaw(noteMirrorKey(di, i));
    };

    // 本機一定寫；符合「最近一週」視窗、或這一筆帶心得，才推雲端。
    const persistProgress = (di, displayDate, kind, i, done, note) => {
      lsSet(kind === "passage" ? readKey(di) : thinkKey(di, i), done);
      if (kind === "think") lsSetRaw(noteMirrorKey(di, i), note);
      cloud.set(cloudKey(di, kind, i), { done: !!done, note: String(note || "") });
      if (String(note || "").trim() || withinSyncWindow(displayDate)) {
        db.upsertDevotionProgress({
          globalPlanId: planId, dayIndex: di, itemKind: kind, itemIndex: i,
          done: !!done, note: String(note || "")
        }).catch(() => {});
      }
    };

    const dayDone = (row) => {
      if (row.locked) return false;
      if (!isPassageDone(row)) return false;
      const rs = Array.isArray(row.reflections) ? row.reflections : [];
      return rs.every((_, i) => isThinkDone(row.dayIndex, i));
    };

    const todayStr = d.today || "";
    const checkIcon = typeof renderIcon === "function" ? renderIcon("check", { size: "sm", className: "nlc-icon" }) : "✓";

    // ── 日曆（與一般計畫日曆完全一致：同樣的滑動視窗、淡色鄰月格、5 列高度上限）──
    const buildCalendar = () => {
      const dts = days.map(x => new Date(`${x.displayDate}T00:00:00`)).filter(x => !Number.isNaN(x.getTime()));
      if (!dts.length) return "";
      // 起訖：優先用計畫 start/end，否則退回第一 / 最後一個靈修日
      let planStart = d.startDate ? new Date(`${d.startDate}T00:00:00`) : null;
      let planEnd = d.endDate ? new Date(`${d.endDate}T00:00:00`) : null;
      if (!planStart || Number.isNaN(planStart.getTime())) planStart = new Date(Math.min(...dts));
      if (!planEnd || Number.isNaN(planEnd.getTime())) planEnd = new Date(Math.max(...dts));
      // 滑動視窗：start −14 天回到週日、end +21 天前進到週六（與 renderHorizontalDateStrip 同一套規則）
      const start = new Date(planStart);
      start.setDate(start.getDate() - 14);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(planEnd);
      end.setDate(end.getDate() + 21);
      end.setDate(end.getDate() + (6 - end.getDay()));
      const byDate = new Map(days.map(x => [x.displayDate, x]));
      let cells = "";
      for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
        const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        const row = byDate.get(iso);
        const label = t.getDate() === 1 ? `${t.getMonth() + 1}/1` : `${t.getDate()}`;
        if (!row) {
          // 非靈修日：沿用一般計畫日曆的淡色 other-month 格（保留日期數字＋灰點）
          const isToday = iso === todayStr;
          cells += `<span class="plan-day-cell plan-day-cell--muted other-month${isToday ? " today" : ""}" aria-hidden="true"><span class="day-number">${label}</span>${isToday ? "" : '<span class="day-status-dot dot-grey"></span>'}</span>`;
          continue;
        }
        const cls = ["plan-day-cell"];
        if (row.dayIndex === cur.dayIndex) cls.push("active");
        if (iso === todayStr) cls.push("today");
        if (dayDone(row)) cls.push("completed");
        // 每日靈修不標「過期未完成」的紅色——沒打勾只是還沒做，不施壓。
        cells += `<button type="button" class="${cls.join(" ")}" data-devo-day="${row.dayIndex}"${iso === todayStr ? ' aria-current="date"' : ""}><span class="day-number">${label}</span></button>`;
      }
      return `<div class="calendar-component plan-calendar devotion-view__calendar">
        <div class="calendar-weekdays">${["週日","週一","週二","週三","週四","週五","週六"].map(w => `<div>${w}</div>`).join("")}</div>
        <div class="calendar-scroll-container scrollbar-none"><div class="calendar-grid">${cells}</div></div>
      </div>`;
    };

    // 與一般計畫日曆一致：把捲動區高度壓到 5 列，並在首次繪製時把選取日置中
    let calendarCentered = false;
    const tuneCalendar = () => {
      const sc = host.querySelector(".calendar-scroll-container");
      const grid = host.querySelector(".calendar-grid");
      const firstCell = grid && grid.querySelector(".plan-day-cell");
      if (!sc || !grid || !firstCell) return;
      const gs = getComputedStyle(grid);
      const rowGap = parseFloat(gs.rowGap) || 0;
      const padY = (parseFloat(gs.paddingTop) || 0) + (parseFloat(gs.paddingBottom) || 0);
      const rowH = firstCell.getBoundingClientRect().height;
      if (rowH > 0) {
        const rows = 5;
        sc.style.maxHeight = Math.ceil(rowH * rows + rowGap * (rows - 1) + padY) + "px";
      }
      if (!calendarCentered) {
        const activeCell = grid.querySelector(".plan-day-cell.active");
        if (activeCell && sc.clientHeight > 0) {
          sc.scrollTop = Math.max(0, activeCell.offsetTop - sc.clientHeight / 2 + activeCell.offsetHeight / 2);
        }
        calendarCentered = true;
      }
    };

    let devotionPassageView = null; // { ref, label } —非 null 時，靈修畫面內只顯示該段經文

    // ── 思想經文「寫心得」全螢幕編輯視窗（有返回鍵；掛 document.body，不受計畫詳情捲動容器限制）──
    let devotionNoteOverlay = null;
    function onDevotionNoteKey(e) { if (e.key === "Escape") closeDevotionNoteEditor(); }
    const closeDevotionNoteEditor = () => {
      if (devotionNoteOverlay) { devotionNoteOverlay.remove(); devotionNoteOverlay = null; }
      document.removeEventListener("keydown", onDevotionNoteKey);
    };
    const openDevotionNoteEditor = (row, idx, promptText) => {
      closeDevotionNoteEditor();
      const existing = thinkNote(row.dayIndex, idx);
      const overlay = document.createElement("div");
      overlay.className = "tts-guide-modal-overlay devotion-note-modal";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDevotionNoteEditor(); });
      overlay.innerHTML = `
        <div class="modal-panel devotion-note-modal__panel">
          <div class="devotion-note-modal__head">
            <button type="button" class="pill-btn" data-note-back>← 返回</button>
            <h4>寫下心得</h4>
            <button type="button" class="devotion-note-modal__x" data-note-x aria-label="關閉">&times;</button>
          </div>
          <div class="devotion-note-modal__body">
            ${promptText ? `<p class="devotion-note-modal__prompt">${escapeHTML(promptText)}</p>` : ""}
            <textarea class="form-control devotion-note-modal__text" rows="8" placeholder="把今天默想到的、想跟主說的話寫下來…">${escapeHTML(existing)}</textarea>
            <p class="devotion-note-modal__hint">只有你自己看得到，會存到雲端，換手機也還在。</p>
            <p class="devotion-note-modal__msg" data-note-msg></p>
          </div>
          <div class="devotion-note-modal__foot">
            <button type="button" class="primary-btn" data-note-save>儲存</button>
            <button type="button" class="pill-btn" data-note-cancel>取消</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      devotionNoteOverlay = overlay;
      document.addEventListener("keydown", onDevotionNoteKey);
      if (typeof hydrateIcons === "function") hydrateIcons(overlay);
      const ta = overlay.querySelector(".devotion-note-modal__text");
      setTimeout(() => { try { ta.focus(); } catch (_) {} }, 30);
      overlay.querySelector("[data-note-back]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-x]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-cancel]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-save]").addEventListener("click", async () => {
        const val = ta.value.trim();
        const msg = overlay.querySelector("[data-note-msg]");
        const btn = overlay.querySelector("[data-note-save]");
        btn.disabled = true;
        if (msg) { msg.textContent = "儲存中…"; msg.style.color = "var(--text-secondary)"; }
        const doneNow = isThinkDone(row.dayIndex, idx);
        const r = await db.upsertDevotionProgress({
          globalPlanId: planId, dayIndex: row.dayIndex, itemKind: "think", itemIndex: idx,
          done: doneNow, note: val
        });
        btn.disabled = false;
        if (!r || !r.success) {
          if (msg) { msg.textContent = (r && r.message) || "儲存失敗，請稍後再試。"; msg.style.color = "var(--color-danger)"; }
          return;
        }
        lsSetRaw(noteMirrorKey(row.dayIndex, idx), val);
        cloud.set(cloudKey(row.dayIndex, "think", idx), { done: doneNow, note: val });
        closeDevotionNoteEditor();
        paint();
      });
    };

    // ── 分享 / 複製內文：勾選要帶哪些段落（經文 / 思想經文 / 影片連結），組成純文字 ──
    let devotionShareOverlay = null;
    function onDevotionShareKey(e) { if (e.key === "Escape") closeDevotionShareModal(); }
    const closeDevotionShareModal = () => {
      if (devotionShareOverlay) { devotionShareOverlay.remove(); devotionShareOverlay = null; }
      document.removeEventListener("keydown", onDevotionShareKey);
    };
    const SHARE_OPTS_KEY = "devotion_share_opts";
    const readShareOpts = () => {
      try {
        const o = JSON.parse(localStorage.getItem(SHARE_OPTS_KEY) || "{}") || {};
        return { passage: o.passage !== false, reflections: o.reflections !== false, video: o.video !== false };
      } catch (_) { return { passage: true, reflections: true, video: true }; }
    };
    const openDevotionShareModal = (day) => {
      closeDevotionShareModal();
      const opts = readShareOpts();
      const dateLabel = day.displayDate || "";
      const refl = Array.isArray(day.reflections) ? day.reflections.filter(Boolean) : [];
      const hasVideo = !!(day.videoUrl && String(day.videoUrl).trim());

      let passageFetching = false;
      const buildText = (o) => {
        const lines = [`【每日靈修】${dateLabel}`.trim()];
        if (day.title) lines.push(`主題：${day.title}`);
        if (o.passage && day.passageLabel) {
          lines.push("", `經文：${day.passageLabel}`);
          if (day._sharePassageText) lines.push(day._sharePassageText);
          else if (passageFetching) lines.push("（讀取經文內文中…）");
        }
        if (o.reflections && refl.length) {
          lines.push("", "思想經文：");
          refl.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
        }
        if (o.video && hasVideo) {
          lines.push("", day.videoTitle ? `靈修影片：${day.videoTitle}` : "靈修影片：", String(day.videoUrl).trim());
        }
        return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      };

      const overlay = document.createElement("div");
      overlay.className = "tts-guide-modal-overlay devotion-note-modal devotion-share-modal";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDevotionShareModal(); });
      const optRow = (key, label, disabled) => `
        <label class="devotion-share-opt${disabled ? " is-disabled" : ""}">
          <input type="checkbox" data-share-opt="${key}" ${opts[key] && !disabled ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span>${escapeHTML(label)}</span>
        </label>`;
      const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
      overlay.innerHTML = `
        <div class="modal-panel devotion-note-modal__panel">
          <div class="devotion-note-modal__head">
            <button type="button" class="pill-btn" data-share-back>← 返回</button>
            <h4>分享 / 複製</h4>
            <button type="button" class="devotion-note-modal__x" data-share-x aria-label="關閉">&times;</button>
          </div>
          <div class="devotion-note-modal__body">
            <p class="devotion-note-modal__hint">選要帶哪些內容，下面會即時組成文字，可以複製或直接分享到別的地方。</p>
            <div class="devotion-share-opts">
              ${optRow("passage", "經文（含內文）", !day.passageLabel)}
              ${optRow("reflections", `思想經文（${refl.length} 題）`, !refl.length)}
              ${optRow("video", "靈修影片連結", !hasVideo)}
            </div>
            <textarea class="form-control devotion-note-modal__text devotion-share-preview" rows="9" readonly></textarea>
            <p class="devotion-note-modal__msg" data-share-msg></p>
          </div>
          <div class="devotion-note-modal__foot">
            <button type="button" class="primary-btn" data-share-copy>複製文字</button>
            ${canNativeShare ? '<button type="button" class="secondary-btn" data-share-native>分享…</button>' : ""}
            <button type="button" class="pill-btn" data-share-cancel>關閉</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      devotionShareOverlay = overlay;
      document.addEventListener("keydown", onDevotionShareKey);
      if (typeof hydrateIcons === "function") hydrateIcons(overlay);

      const preview = overlay.querySelector(".devotion-share-preview");
      const msgEl = overlay.querySelector("[data-share-msg]");
      const setMsg = (m, err) => { if (msgEl) { msgEl.textContent = m || ""; msgEl.style.color = err ? "var(--color-danger)" : "var(--text-secondary)"; } };
      const currentOpts = () => {
        const o = {};
        overlay.querySelectorAll("[data-share-opt]").forEach(cb => { o[cb.dataset.shareOpt] = cb.checked; });
        return o;
      };
      const refresh = () => {
        const o = currentOpts();
        preview.value = buildText(o);
        try { localStorage.setItem(SHARE_OPTS_KEY, JSON.stringify(o)); } catch (_) {}
      };
      overlay.querySelectorAll("[data-share-opt]").forEach(cb => cb.addEventListener("change", refresh));
      refresh();

      // 「經文」要附上經文內文：抓一次（快取在 day 上），回來重刷預覽
      const passageRef = (Array.isArray(day.passageRefs) && day.passageRefs[0] && day.passageRefs[0].book)
        ? day.passageRefs[0]
        : (typeof parsePassageLabel === "function" ? parsePassageLabel(day.passageLabel) : null);
      if (day.passageLabel && !day._sharePassageText && passageRef && passageRef.book
          && typeof fetchDevotionPassagePlainText === "function") {
        passageFetching = true;
        refresh();
        fetchDevotionPassagePlainText(passageRef).then(txt => {
          if (txt) day._sharePassageText = txt;
        }).catch(() => {}).finally(() => {
          passageFetching = false;
          if (devotionShareOverlay === overlay) refresh();
        });
      }

      overlay.querySelector("[data-share-back]").addEventListener("click", closeDevotionShareModal);
      overlay.querySelector("[data-share-x]").addEventListener("click", closeDevotionShareModal);
      overlay.querySelector("[data-share-cancel]").addEventListener("click", closeDevotionShareModal);

      overlay.querySelector("[data-share-copy]").addEventListener("click", async () => {
        const text = preview.value;
        if (!text) { setMsg("沒有可複製的內容，請至少勾一項。", true); return; }
        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
        } catch (_) { ok = false; }
        if (!ok) {
          try {
            preview.removeAttribute("readonly");
            preview.focus(); preview.select(); preview.setSelectionRange(0, text.length);
            ok = document.execCommand("copy");
            preview.setAttribute("readonly", "");
          } catch (_) { ok = false; }
        }
        if (ok) { if (typeof showToast === "function") showToast("已複製，可以貼到別的地方了"); setMsg("已複製。"); }
        else setMsg("這個瀏覽器不允許自動複製，請手動選取上面文字。", true);
      });

      const nativeBtn = overlay.querySelector("[data-share-native]");
      if (nativeBtn) nativeBtn.addEventListener("click", async () => {
        const text = preview.value;
        if (!text) { setMsg("沒有可分享的內容，請至少勾一項。", true); return; }
        try { await navigator.share({ text }); } catch (_) { /* 使用者取消或不支援 */ }
      });
    };

    const paint = () => {
      if (devotionPassageView) {
        renderDevotionPassageInline(host, devotionPassageView.ref, devotionPassageView.label, () => {
          devotionPassageView = null;
          paint();
        });
        return;
      }
      cur = days.find(x => x.dayIndex === devotionViewerDayIndex) || cur;
      const locked = cur.locked === true;
      const reflections = Array.isArray(cur.reflections) ? cur.reflections : [];
      const refs = Array.isArray(cur.passageRefs) ? cur.passageRefs : [];
      const firstRef = refs[0] || (typeof parsePassageLabel === "function" ? parsePassageLabel(cur.passageLabel) : null);
      const passageRead = isPassageDone(cur);
      const devotionVideoId = cur.videoUrl ? extractYoutubeVideoId(cur.videoUrl) : null;
      const devotionVideoThumbUrl = devotionVideoId ? `https://img.youtube.com/vi/${devotionVideoId}/hqdefault.jpg` : "";

      const taskRow = ({ checked, title, opens, arrow, dataAttr, trailing }) => `
        <div class="plan-task-item" ${dataAttr || ""}>
          <button type="button" class="task-read-toggle" data-devo-toggle
            aria-pressed="${checked ? "true" : "false"}" aria-label="${checked ? "取消已讀" : "標記已讀"}">
            <span class="task-checkbox ${checked ? "checked" : ""}" aria-hidden="true">${checked ? checkIcon : ""}</span>
          </button>
          ${opens
            ? `<button type="button" class="task-open-button" data-devo-open>
                 <span class="task-title">${title}</span>
                 ${arrow ? `<span class="task-arrow" aria-hidden="true">${typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : "›"}</span>` : ""}
               </button>`
            : `<div class="task-open-button task-open-button--static"><span class="task-title">${title}</span></div>`}
          ${trailing || ""}
        </div>`;

      // 思想經文：點整條問題就進入心得編輯；寫過的加一個「已寫心得」淡標記。
      const thinkTitle = (t, i) => escapeHTML(t)
        + (thinkNote(cur.dayIndex, i).trim() ? ' <span class="devotion-think-note-flag">已寫心得</span>' : "");

      host.innerHTML = `
        <div class="devotion-view">
          ${buildCalendar()}
          <div class="devotion-view__daylabel">
            <strong>第 ${cur.dayIndex} 天</strong> / 共 ${total} 天　<span class="devotion-view__date">${escapeHTML(cur.displayDate || "")}</span>
          </div>
          ${(!locked && cur.title) ? `<h3 class="devotion-view__theme">${escapeHTML(cur.title)}</h3>` : ""}
          ${!locked ? `<div class="devotion-view__actions">
            <button type="button" class="devotion-view__share" data-devo-share>
              ${typeof renderIcon === "function" ? renderIcon("share", { size: "sm", className: "nlc-icon" }) : ""}分享 / 複製
            </button>
          </div>` : ""}
          ${locked ? `
            <div class="devotion-view__locked">
              <span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span>
              <p>這一天 ${escapeHTML(cur.displayDate || "")} 開放</p>
            </div>` : `
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">經文進度</h4>
              <div class="plan-task-list">
                ${taskRow({ checked: passageRead, title: escapeHTML(cur.passageLabel || "（未設定）"),
                  opens: !!(firstRef && firstRef.book), arrow: true, dataAttr: 'data-devo-kind="passage"' })}
              </div>
            </section>
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">思想經文</h4>
              ${reflections.length ? `<div class="plan-task-list">${reflections.map((t, i) =>
                taskRow({ checked: isThinkDone(cur.dayIndex, i), title: thinkTitle(t, i),
                  opens: true, arrow: true, dataAttr: `data-devo-kind="think" data-devo-i="${i}"` })).join("")}</div>`
                : `<p class="devotion-view__muted">（本日無思想題）</p>`}
            </section>
            ${cur.videoUrl ? `
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">靈修影片</h4>
              <a class="devotion-video-link" href="${escapeHTML(cur.videoUrl)}" target="_blank" rel="noopener noreferrer"
                 aria-label="${escapeHTML(cur.videoTitle || '觀看影片')}">
                ${devotionVideoThumbUrl ? `
                <span class="devotion-video-link__thumb-wrap">
                  <img class="devotion-video-link__thumb" src="${escapeHTML(devotionVideoThumbUrl)}" alt="" loading="lazy">
                  <span class="devotion-video-link__play nlc-icon" data-icon="circlePlay" aria-hidden="true"></span>
                </span>` : ""}
                <span class="devotion-video-link__title">${escapeHTML(cur.videoTitle || "觀看影片")} ↗</span>
              </a>
            </section>` : ""}
          `}
        </div>`;

      if (typeof hydrateIcons === "function") hydrateIcons(host);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(tuneCalendar);
      else tuneCalendar();

      host.querySelector("[data-devo-share]")?.addEventListener("click", () => openDevotionShareModal(cur));

      host.querySelectorAll("[data-devo-day]").forEach(btn => btn.addEventListener("click", () => {
        devotionViewerDayIndex = Number(btn.dataset.devoDay);
        const sc = host.querySelector(".calendar-scroll-container");
        const st = sc ? sc.scrollTop : 0;
        paint();
        const sc2 = host.querySelector(".calendar-scroll-container");
        if (sc2) sc2.scrollTop = st;
      }));

      host.querySelectorAll(".plan-task-item").forEach(item => {
        const kind = item.dataset.devoKind;
        const i = item.dataset.devoI;
        item.querySelector("[data-devo-toggle]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (kind === "think") {
            const idx = Number(i);
            persistProgress(cur.dayIndex, cur.displayDate, "think", idx,
              !isThinkDone(cur.dayIndex, idx), thinkNote(cur.dayIndex, idx));
          } else {
            persistProgress(cur.dayIndex, cur.displayDate, "passage", 0, !isPassageDone(cur), "");
          }
          paint();
        });
        item.querySelector("[data-devo-open]")?.addEventListener("click", () => {
          if (kind === "think") {
            const idx = Number(i);
            openDevotionNoteEditor(cur, idx, reflections[idx] || "");
          } else if (firstRef && firstRef.book) {
            devotionPassageView = { ref: firstRef, label: cur.passageLabel || "" };
            paint();
          }
        });
      });
    };
    paint();
  });
}

// ── 小組聚會週計畫 viewer（會友端；plan_kind='group_meeting'）──────────────────
let groupMeetingViewerWeekIndex = null;
let groupMeetingViewerPlanId = null;
export function resetGroupMeetingViewerWeek() {
  groupMeetingViewerWeekIndex = null;
}

export function renderGroupMeetingViewer(plan) {
  const host = showGroupMeetingViewerRoot();
  if (!host) return Promise.resolve();
  host.innerHTML = '<div class="group-meeting-view"><p class="group-meeting-view__loading">正在載入小組聚會計畫…</p></div>';

  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  if (groupMeetingViewerPlanId !== planId) { groupMeetingViewerPlanId = planId; groupMeetingViewerWeekIndex = null; }

  return db.getGroupMeetingPlan(planId).then(res => {
    if (!res.success) {
      host.innerHTML = `<div class="group-meeting-view"><p class="group-meeting-view__loading">${escapeHTML(res.message || "無法載入小組聚會計畫。")}</p></div>`;
      return;
    }
    const d = res.data || {};
    const weeks = (Array.isArray(d.weeks) ? d.weeks : []).slice().sort((a, b) => a.weekIndex - b.weekIndex);
    if (!weeks.length) {
      host.innerHTML = '<div class="group-meeting-view"><p class="group-meeting-view__loading">內容準備中，敬請期待。</p></div>';
      return;
    }
    // 預設落在「本週」，否則最後一個已過的週，否則第 1 週
    if (groupMeetingViewerWeekIndex == null) {
      const thisW = weeks.find(w => w.isThisWeek);
      if (thisW) groupMeetingViewerWeekIndex = thisW.weekIndex;
      else {
        const past = weeks.filter(w => w.isPast);
        groupMeetingViewerWeekIndex = past.length ? past[past.length - 1].weekIndex : weeks[0].weekIndex;
      }
    }
    const clamp = (idx) => weeks.find(w => w.weekIndex === idx)
      || weeks.filter(w => w.weekIndex <= idx).slice(-1)[0] || weeks[0];
    let cur = clamp(groupMeetingViewerWeekIndex);
    groupMeetingViewerWeekIndex = cur.weekIndex;

    let passageView = null; // { ref, label }

    const chevron = typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : "›";

    const passageRow = (topic, label, refs, kind) => {
      const t = String(topic || "").trim();
      const l = String(label || "").trim() || "（未設定）";
      const titleHtml = t
        ? `<span class="gm-passage-topic">${escapeHTML(t)}</span><span class="gm-passage-sep" aria-hidden="true">｜</span><span class="gm-passage-ref">${escapeHTML(l)}</span>`
        : `<span class="gm-passage-ref">${escapeHTML(l)}</span>`;
      const first = Array.isArray(refs) && refs[0] && refs[0].book ? refs[0] : null;
      if (first) {
        return `<div class="plan-task-item" data-gm-open data-gm-kind="${kind}">
          <button type="button" class="task-open-button">
            <span class="task-title">${titleHtml}</span>
            <span class="task-arrow" aria-hidden="true">${chevron}</span>
          </button>
        </div>`;
      }
      return `<div class="plan-task-item"><div class="task-open-button task-open-button--static"><span class="task-title">${titleHtml}</span></div></div>`;
    };

    const buildStrip = () => {
      const chips = weeks.map(w => {
        const cls = ["gm-week-chip"];
        if (w.weekIndex === cur.weekIndex) cls.push("active");
        if (w.isThisWeek) cls.push("this-week");
        else if (w.isPast) cls.push("past");
        if (w.locked) cls.push("locked");
        return `<button type="button" class="${cls.join(" ")}" data-gm-week="${w.weekIndex}">
          <span class="gm-week-chip__n">${escapeHTML(w.dateLabel || "")}</span>
        </button>`;
      }).join("");
      return `<div class="group-meeting-view__strip scrollbar-none">${chips}</div>`;
    };

    const paint = () => {
      cur = weeks.find(w => w.weekIndex === groupMeetingViewerWeekIndex) || cur;

      if (passageView) {
        renderDevotionPassageInline(host, passageView.ref, passageView.label, () => { passageView = null; paint(); });
        return;
      }

      const songs = Array.isArray(cur.songs) ? cur.songs : [];
      const hasOffering = (cur.offeringPassageLabel && cur.offeringPassageLabel.trim())
        || (Array.isArray(cur.offeringPassageRefs) && cur.offeringPassageRefs.length);
      // 只有備註、沒有經文也沒有詩歌（例：Pastor Greg 特會週）→ 只顯示備註
      const noteOnly = !cur.locked && !songs.length
        && !(cur.messagePassageLabel && cur.messagePassageLabel.trim()) && !hasOffering
        && cur.note;

      host.innerHTML = `
        <div class="group-meeting-view">
          ${buildStrip()}
          ${cur.monthTheme ? `<p class="group-meeting-view__theme">月主題　${escapeHTML(cur.monthTheme)}</p>` : ""}
          <div class="group-meeting-view__weeklabel">
            <strong>${escapeHTML(cur.dateLabel || "")}</strong>
          </div>
          ${cur.locked ? `
            <div class="group-meeting-view__locked">
              <span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span>
              <p>${escapeHTML(cur.dateLabel || "")} 開放</p>
            </div>` : noteOnly ? `
            <div class="group-meeting-view__note">${escapeHTML(cur.note)}</div>` : `
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">信息經文</h4>
              <div class="plan-task-list">${passageRow(cur.messageTopic, cur.messagePassageLabel, cur.messagePassageRefs, "message")}</div>
            </section>
            ${hasOffering ? `
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">奉獻經文</h4>
              <div class="plan-task-list">${passageRow(cur.offeringTopic, cur.offeringPassageLabel, cur.offeringPassageRefs, "offering")}</div>
            </section>` : ""}
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">敬拜讚美詩歌</h4>
              ${songs.length
                ? `<ul class="group-meeting-view__songs">${songs.map(s => `<li><span class="group-meeting-view__songcode">${escapeHTML(String(s.code || ""))}</span>${escapeHTML(String(s.title || ""))}</li>`).join("")}</ul>`
                : `<p class="group-meeting-view__muted">（無詩歌單）</p>`}
            </section>
            ${cur.note ? `<div class="group-meeting-view__note">${escapeHTML(cur.note)}</div>` : ""}
          `}
        </div>`;

      if (typeof hydrateIcons === "function") hydrateIcons(host);

      // 週切換：保留 strip 捲動位置
      host.querySelectorAll("[data-gm-week]").forEach(btn => btn.addEventListener("click", () => {
        const strip = host.querySelector(".group-meeting-view__strip");
        const sl = strip ? strip.scrollLeft : 0;
        groupMeetingViewerWeekIndex = Number(btn.dataset.gmWeek);
        paint();
        const s2 = host.querySelector(".group-meeting-view__strip");
        if (s2) s2.scrollLeft = sl;
      }));

      // 進入某週後把選中的 chip 捲進可視範圍
      const activeChip = host.querySelector(".gm-week-chip.active");
      if (activeChip && typeof activeChip.scrollIntoView === "function") {
        try { activeChip.scrollIntoView({ block: "nearest", inline: "center" }); } catch (_) {}
      }

      host.querySelectorAll("[data-gm-open]").forEach(item => {
        item.addEventListener("click", () => {
          const kind = item.dataset.gmKind;
          const refs = kind === "offering" ? cur.offeringPassageRefs : cur.messagePassageRefs;
          const label = kind === "offering" ? cur.offeringPassageLabel : cur.messagePassageLabel;
          const first = Array.isArray(refs) && refs[0] && refs[0].book ? refs[0] : null;
          if (first) { passageView = { ref: first, label }; paint(); }
        });
      });
    };

    paint();
  });
}
