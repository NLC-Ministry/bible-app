// js/modules/bible.js

import { createReaderBottomDwellController, observeReaderEndSentinel } from "./reader-bottom-dwell.mjs";
import { getReaderSpeechRate, resolveReaderStartIndex, selectPreferredChineseVoice, selectPreferredVoice } from "./reader-speech.mjs";
import { rankBibleSearchResults } from "./bible-search-ranker.mjs";
import {
  buildFhlSearchUrl,
  FHL_SEARCH_LIMIT,
  getFhlSearchQueries,
  isShortBibleQuery,
  mapFhlSearchRecords,
  readFhlSearchPayload
} from "./fhl-bible-search.mjs";
import {
  BIBLE_SEARCH_ERROR,
  buildOfflineSearchCorpus,
  createBibleSearchError,
  getBibleSearchErrorMessage,
  getBibleSearchPlan
} from "./bible-search-sources.mjs";
import { isPlanProgressLocked } from "../data/plan-progress-availability.mjs";
import { isPlanCheckInClosed, isPlanCheckInClosedError } from "../data/plan-checkin-window.mjs";
import { getPlanEndedNotice } from "../data/plan-ended-copy.mjs";
import { isLogInOpenScope } from "../data/reading-log-scope.mjs";
import {
  AUTO_RECORD_REASONS,
  getAutoRecordDecision,
  planIdOf,
  readPlanLastOpened,
  selectAutoRecordPlanTask
} from "../data/reader-auto-record.mjs";
import { createReaderSwipeController, readerArrowKeyDirection, resolveAdjacentChapter, resolvePrefetchChapters } from "./reader-chapter-nav.mjs";
import { buildChapterPreview, buildViewportSnapshot, createReaderPageFlip } from "./reader-page-flip.mjs";
import { formatVerseSelectionText, groupVerseSelectionRuns } from "./verse-selection-format.mjs";
import { buildChapterEndNav as buildSharedChapterEndNav, createVerseElement, revealVerses } from "./reader-verse-dom.mjs";
import { createReaderCommentaryController } from "./reader-commentary.mjs";
import { refRevealTarget } from "../data/passage-commentary.mjs";
import {
  createBibleNavDirectory,
  isReaderReferenceResult,
  parseReaderReferenceQuery,
  readerBookAbbreviation,
  readerBookLabel
} from "./bible-nav-directory.mjs";

// db / escapeHTML / hydrateIcons 是核心檔掛在 window 上的全域，呼叫時才取用。
// 整章注釋（工具列燈泡）、節旁 icon、點選經文後工具列的「注釋」都由它管（#447、#470）。
const readerCommentary = createReaderCommentaryController({
  db: {
    fetchIndex: () => db.fetchCommentaryIndex(),
    fetchChapter: (bookName, chapter) => db.fetchChapterCommentary(bookName, chapter),
    fetchTermDetails: ids => db.fetchCommentaryTermDetails(ids)
  },
  openLayer: element => openReaderLayer(element),
  closeLayer: element => closeReaderLayer(element),
  escapeHTML: value => escapeHTML(value),
  hydrateIcons: element => { if (typeof hydrateIcons === "function") hydrateIcons(element); },
  getVerseContainer: () => document.getElementById("bible-content"),
  // 注釋比選取晚到：已經有選取時重建工具列，「注釋」才會出現。
  onChange: () => { if (verseSelection.size > 0) renderUnifiedSelectionBar(); },
  // 注釋裡的「見出27:21」（#542）：跳到那一章、捲到那一節並閃底色。
  onNavigateRef: async target => {
    const book = BIBLE_BOOKS.find(item => item.name === target.book);
    if (!book) return;
    const { verse, highlightVerses } = refRevealTarget(target);
    await goToReaderVerse({ bookId: book.id, chapter: target.chapter, verse, highlightVerses });
  }
});

export function openReaderLayer(element) {
  if (!element) return;
  element.classList.remove("hidden");
  element.style.pointerEvents = "auto";
  element.setAttribute("aria-hidden", "false");
  document.body.classList.add("reader-modal-open");
}

export function closeReaderLayer(element) {
  if (!element) return;
  element.classList.add("hidden");
  element.style.pointerEvents = "none";
  element.setAttribute("aria-hidden", "true");
  const stillOpen = document.querySelector(".full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden)");
  document.body.classList.toggle("reader-modal-open", Boolean(stillOpen));
}

export function releaseClosedReaderLayers() {
  document.querySelectorAll(
    ".full-page-overlay.hidden, .bottom-sheet-backdrop.hidden, .reader-search-panel.hidden, " +
    ".full-page-overlay[aria-hidden='true'], .bottom-sheet-backdrop[aria-hidden='true'], .reader-search-panel[aria-hidden='true']"
  ).forEach((layer) => {
    layer.style.pointerEvents = "none";
  });
}

function initSmartFloatingReaderNav() {
  const readerView = document.getElementById("reader-view");
  const floatPrev = document.getElementById("floating-prev-btn");
  const floatNext = document.getElementById("floating-next-btn");
  if (!readerView || (!floatPrev && !floatNext) || readerView.dataset.smartFloatingNavBound === "true") return;

  readerView.dataset.smartFloatingNavBound = "true";
  let idleTimer = null;

  const setNavVisible = (visible, awake = false) => {
    document.body.classList.toggle("reader-nav-hidden", !visible);
    document.body.classList.toggle("reader-nav-awake", visible && awake);
  };

  const wakeFloatingNav = (duration = 1600) => {
    clearTimeout(idleTimer);
    setNavVisible(true, true);
    idleTimer = setTimeout(() => setNavVisible(true, false), duration);
  };

  const hideFloatingNavDuringScroll = () => {
    clearTimeout(idleTimer);
    setNavVisible(false, false);
    idleTimer = setTimeout(() => wakeFloatingNav(1400), 500);
    // One-way: unlike the floating prev/next buttons above, the mobile tab
    // bar must not flicker back in on every scroll pause while reading —
    // it only comes back the next time the reader renders (see the reset
    // in renderReaderText()).
    document.body.classList.add("reader-navbar-hidden");
  };

  const bindFloatingButton = (button, direction) => {
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      flipToReaderChapter(direction);
      wakeFloatingNav(900);
    });
  };

  bindFloatingButton(floatPrev, -1);
  bindFloatingButton(floatNext, 1);

  const scrollSurface = readerView.querySelector(".reader-reading-surface") || document.querySelector(".main-content");
  if (scrollSurface) {
    scrollSurface.addEventListener("scroll", hideFloatingNavDuringScroll, { passive: true });
  }

  // Deliberately no tap-to-reveal listener here: a tap/long-press on scripture
  // text is the verse-selection gesture (single tap and long-press range
  // select). Waking the nav chrome on every such tap made it slide in over
  // the selection UI mid-gesture. Scrolling is the only thing that hides it
  // (hideFloatingNavDuringScroll above); the floating prev/next buttons
  // reappear on their own once scrolling pauses, but the mobile tab bar
  // (reader-navbar-hidden) stays out of the way until the next render.
  setNavVisible(true, false);
  document.body.classList.remove("reader-navbar-hidden");
}
let readerBottomDwellController = null;
let readerEndObserver = null;
let readerEndVisible = false;
let readerRenderRequestId = 0;
let readerAutoReadNoticeKey = "";
let selectionBottomBarCleanup = null;
let selectionBottomBarBindTimer = null;
// 統一「點選多節經文」：一律點一下切換選取，跨章保留。
// key = `${bookId}_${chapter}_${verse}` → { bookId, bookName, chapter, verse, text }
// 刻意不進 state.js（Map 不能序列化）；生命週期＝此模組載入期間。
const verseSelection = new Map();
const ENGLISH_BIBLE_VERSIONS = new Set(["ESV", "NIV", "NLT", "WEB"]);

function usesEnglishReaderLabels(version = state.readerState?.version) {
  return ENGLISH_BIBLE_VERSIONS.has(String(version || "").toUpperCase());
}

// 書名標籤規則和目錄／ /read 共用（bible-nav-directory.mjs，#423）。
function getReaderBookLabel(book) {
  return readerBookLabel(book, usesEnglishReaderLabels());
}

function getReaderBookAbbreviation(book) {
  return readerBookAbbreviation(book, usesEnglishReaderLabels());
}

function getCurrentPlanReaderTask() {
  const plan = window.findPlanByContextId?.(state.readerState?.planContextId) || state.activePlan;
  if (!plan || !state.readerState || !state.readerState.fromPlan) return null;

  const book = BIBLE_BOOKS.find(item => Number(item.id) === Number(state.readerState.bookId));
  const round = Number(state.readerState.planRound || plan.currentRound || 1);
  if (!book || !Array.isArray(plan.days)) return null;

  const findChapter = day => Array.isArray(day?.chapters)
    ? day.chapters.find(item =>
      item.book === book.name &&
      Number(item.chapter) === Number(state.readerState.chapter) &&
      Number(item.round || round) === round
    )
    : null;

  let day = plan.days.find(item => Number(item.dayNum) === Number(state.readerState.planDayNum));
  let chapter = findChapter(day);
  if (!chapter) {
    day = plan.days.find(item => Boolean(findChapter(item))) || null;
    chapter = findChapter(day);
  }

  return chapter ? { book, chapter, day, round, plan } : null;
}

function isCurrentPlanReaderTaskRead(taskContext) {
  if (!taskContext) return false;
  const { chapter, round } = taskContext;
  return Boolean(chapter[`isReadR${round}`] || (round === 1 && chapter.isRead));
}

// 讀到底自動打卡（#349）用的任務解析：
//   1. 從計畫進來（fromPlan）且該計畫含這章 → 用那個計畫（情境計畫優先）。
//   2. 否則（從底部分頁列進讀經、切分頁再回來、情境計畫不含這章）→ 在所有進行中計畫裡
//      找「目前這一遍」含這章的；多個時取最近開啟的計畫。
// 手動勾選（mark-read-btn）刻意仍走 state.activePlan，不吃這個 fallback。
function resolveReaderAutoRecordTask() {
  const contextTask = getCurrentPlanReaderTask();
  if (contextTask) return contextTask;
  const book = BIBLE_BOOKS.find(item => Number(item.id) === Number(state.readerState?.bookId));
  if (!book || !Array.isArray(state.activePlans) || state.activePlans.length === 0) return null;
  const found = selectAutoRecordPlanTask({
    plans: state.activePlans,
    bookName: book.name,
    chapterNum: state.readerState.chapter,
    activePlanId: planIdOf(state.activePlan),
    lastOpened: readPlanLastOpened(),
    isUsable: plan => !isPlanCheckInClosed(plan)
      && !isPlanProgressLocked(plan, { hidden: window.isPlanHidden?.(plan) })
  });
  return found ? { book, chapter: found.chapter, day: found.day, round: found.round, plan: found.plan } : null;
}

function getReaderTaskTargetKey(taskContext, chapterNum = state.readerState.chapter) {
  if (!taskContext) return "";
  const { book, day, round, plan } = taskContext;
  return [plan.id || plan.globalPlanId || plan.presetKey || "plan", day.dayNum, round, book.name, chapterNum].join("|");
}

function getCurrentPlanReaderTargetKey() {
  return getReaderTaskTargetKey(resolveReaderAutoRecordTask());
}

function getReaderTaskDecision(taskContext) {
  if (!taskContext) return getAutoRecordDecision({ hasTask: false });
  const { plan, round } = taskContext;
  return getAutoRecordDecision({
    hasTask: true,
    alreadyRead: isCurrentPlanReaderTaskRead(taskContext),
    offline: Boolean(state.offlineMode),
    expired: Boolean(plan && isPlanCheckInClosed(plan)),
    locked: isPlanProgressLocked(taskContext.plan, { hidden: window.isPlanHidden?.(taskContext.plan) }),
    isOldRound: round < Number(plan.currentRound || 1)
  });
}

// ── 章末打卡狀態列 ──
// 只在這章解析得到計畫任務時顯示；自由閱讀計畫外的章不顯示任何東西。
let readerRecordFailedKey = "";
const readerAutoRecordInFlightKeys = new Set();
// 這一章的章末是否已到過（捲到底／sentinel 可見）。換章時用來判斷「到底後直接換章」也算讀完。
let reachedEndTargetKey = "";

function formatReaderRecordCopy(template, values) {
  return Object.keys(values).reduce((text, key) => text.split(`{${key}}`).join(values[key]), template);
}

function getReaderRecordStatusText(taskContext) {
  const copy = (window.APP_COPY && window.APP_COPY.plan) || {};
  const decision = getReaderTaskDecision(taskContext);
  if (decision.reason === AUTO_RECORD_REASONS.ALREADY_READ) {
    return { kind: "done", text: formatReaderRecordCopy(copy.autoRecordDone || "✓ 已記錄到〈{plan}〉", { plan: taskContext.plan.name || taskContext.plan.title || "" }) };
  }
  const failed = readerRecordFailedKey && readerRecordFailedKey === getReaderTaskTargetKey(taskContext);
  if (decision.ok && !failed) return { kind: "pending", text: copy.autoRecordPending || "讀到這裡停一下就會記錄" };
  const reasonText = {
    [AUTO_RECORD_REASONS.OFFLINE]: copy.autoRecordReasonOffline || "離線中",
    [AUTO_RECORD_REASONS.EXPIRED]: copy.autoRecordReasonExpired || "計畫已結束",
    [AUTO_RECORD_REASONS.LOCKED]: copy.autoRecordReasonLocked || "這個階段尚未開放",
    [AUTO_RECORD_REASONS.OLD_ROUND]: copy.autoRecordReasonOldRound || "這是已完成的舊一遍，不能再修改"
  }[decision.reason] || copy.autoRecordReasonSyncFailed || "同步失敗，請稍後再試";
  return { kind: "blocked", text: formatReaderRecordCopy(copy.autoRecordNotRecorded || "未記錄：{reason}", { reason: reasonText }) };
}

function updateReaderRecordStatus() {
  const el = document.getElementById("reader-record-status");
  if (!el) return;
  const taskContext = resolveReaderAutoRecordTask();
  if (!taskContext) {
    el.textContent = "";
    el.dataset.state = "";
    el.hidden = true;
    return;
  }
  const status = getReaderRecordStatusText(taskContext);
  el.textContent = status.text;
  el.dataset.state = status.kind;
  el.hidden = false;
}

// 換章／朗讀唸完之前呼叫：如果這章的章末已到過（或 force），先用「離開前」的章節快照送出記錄，
// 再讓呼叫端去改 readerState。不等網路；失敗照樣跳同步失敗 toast。
function recordLeavingReaderChapter({ force = false } = {}) {
  const taskContext = resolveReaderAutoRecordTask();
  if (!taskContext) return;
  const chapterNum = state.readerState.chapter;
  const targetKey = getReaderTaskTargetKey(taskContext, chapterNum);
  if (!force && reachedEndTargetKey !== targetKey) return;
  void autoMarkCurrentPlanReaderTaskRead(targetKey, { taskContext, chapterNum, targetKey });
}

// snapshot（換章／朗讀時傳入）＝離開前抓好的 { taskContext, chapterNum, targetKey }，
// 寫入一律用它，不再讀 state.readerState.chapter（那時可能已經是新的一章）。
async function autoMarkCurrentPlanReaderTaskRead(expectedTargetKey, snapshot = null) {
  const taskContext = snapshot ? snapshot.taskContext : resolveReaderAutoRecordTask();
  const chapterNum = snapshot ? snapshot.chapterNum : state.readerState.chapter;
  const targetKey = snapshot ? snapshot.targetKey : getReaderTaskTargetKey(taskContext);
  if (!taskContext || targetKey !== expectedTargetKey) return false;
  const decision = getReaderTaskDecision(taskContext);
  if (decision.reason === AUTO_RECORD_REASONS.ALREADY_READ) return true;
  if (!decision.ok) {
    if (targetKey === getCurrentPlanReaderTargetKey()) updateReaderRecordStatus();
    return false;
  }
  if (readerAutoRecordInFlightKeys.has(targetKey)) return false;
  const isCurrentTarget = () => targetKey === getCurrentPlanReaderTargetKey();

  const readKey = `isReadR${taskContext.round}`;
  const previousRoundRead = Boolean(taskContext.chapter[readKey]);
  const previousRead = Boolean(taskContext.chapter.isRead);
  readerAutoRecordInFlightKeys.add(targetKey);
  if (isCurrentTarget()) {
    state.readerState.autoMarked = true;
    state.readerState.autoMarkInFlight = true;
  }
  readerRecordFailedKey = readerRecordFailedKey === targetKey ? "" : readerRecordFailedKey;
  taskContext.chapter[readKey] = true;
  if (taskContext.round === 1) taskContext.chapter.isRead = true;
  try {
    window.renderPlanScheduleTracker?.();
    calculatePlanProgress();
    if (typeof updateDashboardView === "function") updateDashboardView();
    await db.logChapterRead(taskContext.book.name, chapterNum, true, taskContext.round, taskContext.plan);

    const shouldHandleR1 = taskContext.plan.isPlanCompleted && !taskContext.plan.upgradePromptHandled;
    const shouldHandleR2 = taskContext.plan.isRound2Completed && !taskContext.plan.round2UpgradePromptHandled;
    if ((shouldHandleR1 || shouldHandleR2) && typeof window.handleRoundCompletion === "function") {
      await window.handleRoundCompletion(taskContext.plan);
    }
    console.info("[AutoRead] Reading log persisted", { targetKey: expectedTargetKey });
    updateReaderRecordStatus();
    return true;
  } catch (error) {
    console.error("Failed to auto-mark reader progress", error);
    if (isCurrentTarget()) state.readerState.autoMarked = false;
    taskContext.chapter[readKey] = previousRoundRead;
    taskContext.chapter.isRead = previousRead;
    readerRecordFailedKey = targetKey;
    window.renderPlanScheduleTracker?.();
    calculatePlanProgress();
    if (typeof updateDashboardView === "function") updateDashboardView();
    updateReaderRecordStatus();
    if (typeof showToast === "function") {
      showToast((window.APP_COPY && window.APP_COPY.plan.syncFail) || "閱讀進度同步失敗，請稍後再試");
    }
    return false;
  } finally {
    readerAutoRecordInFlightKeys.delete(targetKey);
    if (isCurrentTarget()) state.readerState.autoMarkInFlight = false;
  }
}

function initImmersivePlanReader() {
  const readerView = document.getElementById("reader-view");
  const scrollSurface = readerView && readerView.querySelector(".reader-reading-surface");
  if (!readerView || !scrollSurface || readerView.dataset.immersivePlanReaderBound === "true") return;

  readerView.dataset.immersivePlanReaderBound = "true";
  readerBottomDwellController = createReaderBottomDwellController({
    dwellMs: 1000,
    bottomThreshold: 96,
    onComplete: autoMarkCurrentPlanReaderTaskRead
  });
  scrollSurface.addEventListener("scroll", handleReaderScroll, { passive: true });
  scrollSurface.addEventListener("scrollend", handleReaderScroll, { passive: true });
  const mainSurface = document.querySelector(".main-content");
  if (mainSurface && mainSurface !== scrollSurface && mainSurface.dataset.planReaderBottomDwellBound !== "true") {
    mainSurface.dataset.planReaderBottomDwellBound = "true";
    mainSurface.addEventListener("scroll", handleReaderScroll, { passive: true });
    mainSurface.addEventListener("scrollend", handleReaderScroll, { passive: true });
  }
}

// ── 換章：左右滑動／鍵盤 ← →／章末連結／電腦版兩側按鈕，全部播同一個翻頁動畫（#314、#347） ──
// 往左滑＝下一章、往右滑＝上一章；頁面跟著手指走，放手時拖得夠遠或撥得夠快才換章。
// 換章一律走 navigateToChapter，跟按鈕完全同一條路（停止朗讀、跨書卷）；翻頁本身不做任何打卡判斷（#363）。
// 滑動教學：舊版存 "1"＝看過一次；現在存「看過幾次」。滑過一次（READER_SWIPED_STORAGE_KEY）就永久不再出現。
const READER_SWIPE_TIP_STORAGE_KEY = "bible_reader_swipe_tip_seen";
const READER_SWIPED_STORAGE_KEY = "bible_reader_swiped";
const READER_SWIPE_TIP_MAX_SHOWS = 3;
// 預覽紙片只做開頭這幾節（夠蓋滿一個螢幕），不用整章。
const READER_FLIP_PREVIEW_VERSES = 40;
let readerSwipeTipShownThisSession = false;
let readerPageFlip = null;
let readerFadeNextRender = false;
let readerAnnounceNextRender = false;
let readerFlipStartScrollTop = null;
let readerFlipScrollLockSurface = null;

// 左右翻頁期間暫停閱讀區的上下捲動；結束時恢復，回傳手勢開始時的捲動位置。
function lockReaderScrollForFlip() {
  const surface = getReaderScrollSurface();
  readerFlipStartScrollTop = surface ? surface.scrollTop : null;
  readerFlipScrollLockSurface = surface || null;
  surface?.classList.add("reader-flip-scroll-locked");
}

function unlockReaderScrollForFlip() {
  readerFlipScrollLockSurface?.classList.remove("reader-flip-scroll-locked");
  readerFlipScrollLockSurface = null;
  const startScrollTop = readerFlipStartScrollTop;
  readerFlipStartScrollTop = null;
  return startScrollTop;
}

// 目錄、搜尋、文字設定、版本選單、筆記編輯器開著時都不換章。
const READER_BLOCKING_LAYER_SELECTOR =
  "#bible-version-picker-modal:not(.hidden), .full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden)";

function isReaderChapterNavAvailable() {
  const body = document.body;
  return Boolean(
    window.appRouter && window.appRouter.currentTab === "reader-view" &&
    !body.classList.contains("reader-modal-open") &&
    !body.classList.contains("verse-note-editor-open") &&
    !document.querySelector(READER_BLOCKING_LAYER_SELECTOR)
  );
}

function canNavigateReaderChapter(direction) {
  return Boolean(resolveAdjacentChapter(BIBLE_BOOKS, state.readerState?.bookId, state.readerState?.chapter, direction));
}

function getReaderHeadingText(book, chapter) {
  return usesEnglishReaderLabels() ? `${book.eng} Chapter ${chapter}` : `${book.name} ${chapter}章`;
}

function getReaderChapterCacheKey(bookEngName, chapter, version) {
  return window.getBibleChapterCacheKey
    ? window.getBibleChapterCacheKey(bookEngName, chapter, version)
    : `${version}_${bookEngName}_${chapter}`;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// 翻頁舞台蓋住的範圍＝閱讀區，扣掉底部分頁列和經文選取工具列：
// 紙片不從毛玻璃底下滑過（省掉每格重算模糊），選取工具列也不會被蓋住或跟著閃。
const READER_STAGE_BOTTOM_CHROME = [".mobile-nav-bar", ".youversion-action-bar"];

function getReaderStageRect() {
  const surface = document.querySelector("#reader-view .reader-reading-surface");
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  const top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight || rect.bottom);
  READER_STAGE_BOTTOM_CHROME.forEach(selector => {
    const chrome = document.querySelector(selector);
    if (!chrome) return;
    const chromeRect = chrome.getBoundingClientRect();
    if (chromeRect.height > 0 && chromeRect.top > top && chromeRect.top < bottom) bottom = chromeRect.top;
  });
  return { left: rect.left, right: rect.right, width: rect.width, top, bottom, height: bottom - top };
}

function getReaderFlipParts() {
  const surface = document.querySelector("#reader-view .reader-reading-surface");
  return {
    surface,
    header: surface ? surface.querySelector(".reader-header") : null,
    container: document.getElementById("bible-content")
  };
}

function buildReaderCurrentPage(stageRect) {
  const { header, container } = getReaderFlipParts();
  if (!container) return null;
  return buildViewportSnapshot({ header, container, stageRect });
}

function buildReaderTargetPage(direction, stageRect) {
  const { surface, header, container } = getReaderFlipParts();
  const target = resolveAdjacentChapter(BIBLE_BOOKS, state.readerState?.bookId, state.readerState?.chapter, direction);
  if (!container || !target) return null;
  const version = String(state.readerState?.version || "CUNP").toUpperCase();
  const cached = window._bibleChapterCache && window._bibleChapterCache[getReaderChapterCacheKey(target.book.eng, target.chapter, version)];
  const verses = cached && !cached.isPlaceholder && Array.isArray(cached.verses) && cached.verses.length ? cached.verses : null;
  return buildChapterPreview({
    header,
    container,
    surface,
    stageRect,
    headingText: getReaderHeadingText(target.book, target.chapter),
    fillContent: shell => {
      if (!verses) {
        // 還沒預載到：先放骨架，照樣翻過去，之後沿用一般的載入／重試畫面。
        if (typeof ComponentSkeletonLoader !== "undefined") ComponentSkeletonLoader.show("reader", shell);
        return;
      }
      verses.slice(0, READER_FLIP_PREVIEW_VERSES).forEach(v => {
        shell.appendChild(buildVerseElement(v, target.book.name, target.chapter));
      });
      if (verses.length <= READER_FLIP_PREVIEW_VERSES) shell.appendChild(buildChapterEndNav(target.book.id, target.chapter));
    }
  });
}

function getReaderPageFlip() {
  if (readerPageFlip) return readerPageFlip;
  const readerView = document.getElementById("reader-view");
  if (!readerView) return null;
  readerPageFlip = createReaderPageFlip({
    host: readerView,
    getStageRect: getReaderStageRect,
    buildCurrentPage: buildReaderCurrentPage,
    buildTargetPage: buildReaderTargetPage,
    onCommit: direction => navigateToChapter(direction)
  });
  return readerPageFlip;
}

// 按鈕、鍵盤、章末連結共用：播完整個翻頁並換章。
export function flipToReaderChapter(direction) {
  if (!direction || !canNavigateReaderChapter(direction)) return Promise.resolve(false);
  const flip = getReaderPageFlip();
  if (!flip || prefersReducedMotion()) {
    readerFadeNextRender = true;
    return navigateToChapter(direction);
  }
  return flip.play(direction);
}

function markReaderSwiped() {
  try { localStorage.setItem(READER_SWIPED_STORAGE_KEY, "1"); } catch { /* 無痕模式：這次就好 */ }
}

function initReaderChapterGestures() {
  const readerView = document.getElementById("reader-view");
  if (!readerView || readerView.dataset.chapterGesturesBound === "true") return;
  readerView.dataset.chapterGesturesBound = "true";

  createReaderSwipeController({
    surface: readerView,
    isEnabled: isReaderChapterNavAvailable,
    canNavigate: canNavigateReaderChapter,
    // 手指一放上去：上一個還在播的翻頁（或滑動教學）直接收尾
    onGestureStart: () => { readerPageFlip?.finishNow(); },
    onDragStart: direction => {
      // 確定是左右翻頁：記住捲動位置，並暫停上下捲動（#380）。
      // 斜著拖時瀏覽器會同時上下捲，放手後還有慣性；慣性會蓋掉換章時「捲回開頭」，
      // 新的一章就停在跟舊的一章差不多的節數。一開始就不讓它捲，就沒有慣性。
      lockReaderScrollForFlip();
      getReaderPageFlip()?.begin(direction);
    },
    onDrag: (direction, { progress }) => { readerPageFlip?.update(progress); },
    onDragEnd: ({ direction, commit, velocity, immediate }) => {
      const startScrollTop = unlockReaderScrollForFlip();
      if (commit) {
        markReaderSwiped();
      } else if (startScrollTop !== null) {
        // 放棄翻頁：回到原來的位置
        const surface = getReaderScrollSurface();
        if (surface) surface.scrollTop = startScrollTop;
      }
      const flip = getReaderPageFlip();
      const done = flip
        ? flip.release({ direction, commit, velocity, immediate })
        : (commit ? navigateToChapter(direction) : null);
      // 換章：翻頁動畫結束後再確認一次停在新的一章開頭（保險）
      if (commit) Promise.resolve(done).then(moved => { if (moved !== false) setReaderScrollTop(0, "auto"); });
    }
  });

  document.addEventListener("keydown", event => {
    if (!isReaderChapterNavAvailable()) return;
    const direction = readerArrowKeyDirection(event);
    if (!direction || !canNavigateReaderChapter(direction)) return;
    event.preventDefault();
    flipToReaderChapter(direction);
  });
}

function readSwipeTipShowCount() {
  const raw = localStorage.getItem(READER_SWIPE_TIP_STORAGE_KEY);
  if (!raw) return 0;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

// 手機上還沒滑過換章的人：頁面自己往左、往右各掀一下＋提示文字。每次開 App 最多一次、
// 總共最多 3 次；滑過一次就永久不再出現。只是介面偏好，存不了就算了。
function maybeShowReaderSwipeTip() {
  if (readerSwipeTipShownThisSession) return;
  if (!isReaderChapterNavAvailable()) return;
  try {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    if (localStorage.getItem(READER_SWIPED_STORAGE_KEY)) return;
    const count = readSwipeTipShowCount();
    if (count >= READER_SWIPE_TIP_MAX_SHOWS) return;
    localStorage.setItem(READER_SWIPE_TIP_STORAGE_KEY, String(count + 1));
  } catch {
    return;
  }
  readerSwipeTipShownThisSession = true;
  if (typeof showToast === "function") {
    showToast((window.APP_COPY && window.APP_COPY.reader && window.APP_COPY.reader.swipeTip) || "左右滑動可以換章", 3500);
  }
  setTimeout(() => { void playReaderSwipeDemo(); }, 700);
}

async function playReaderSwipeDemo() {
  const flip = getReaderPageFlip();
  if (!flip || !isReaderChapterNavAvailable()) return;
  if (canNavigateReaderChapter(1)) {
    const played = await flip.peek(1);
    if (!played) return; // 被使用者的手勢打斷，就不再繼續示範
  }
  if (canNavigateReaderChapter(-1) && isReaderChapterNavAvailable()) await flip.peek(-1);
}

function announceReaderChapter(text) {
  const announcer = document.getElementById("reader-chapter-announcer");
  if (!announcer || !text) return;
  const copy = (window.APP_COPY && window.APP_COPY.reader) || {};
  announcer.textContent = String(copy.chapterChanged || "已切換到 {chapter}").replace("{chapter}", text);
}

export function initReaderControls() {
  releaseClosedReaderLayers();
  readerCommentary.bind();
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  const bookBadge = document.getElementById("reader-book-badge");
  const chapterBadge = document.getElementById("reader-chapter-badge");
  const readerBackBtn = document.getElementById("reader-back-btn");

  if (readerBackBtn) {
    readerBackBtn.addEventListener("click", () => {
      const globalBackBtn = document.getElementById("global-back-btn");
      if (globalBackBtn) globalBackBtn.click();
    });
  }

  populateBookSelector("all");
  populateChapterSelector();
  updatePillLabels();
  renderReaderPicker();

  function openReaderCatalog() {
    if (typeof window.openBibleNavOverlay === "function") window.openBibleNavOverlay();
  }

  if (bookBadge) bookBadge.addEventListener("click", openReaderCatalog);
  if (chapterBadge) chapterBadge.addEventListener("click", openReaderCatalog);

  const navDirectoryBtn = document.getElementById("reader-nav-directory-btn");
  if (navDirectoryBtn) {
    navDirectoryBtn.addEventListener("click", () => {
      if (typeof window.openBibleNavOverlay === "function") {
        window.openBibleNavOverlay();
      }
    });
  }

  setupVersionPickerEvents();

  const navVersionBtn = document.getElementById("reader-nav-version-btn");
  if (navVersionBtn && navVersionBtn.dataset.versionPickerBound !== "true") {
    navVersionBtn.dataset.versionPickerBound = "true";
    navVersionBtn.addEventListener("click", () => {
      if (typeof window.toggleBibleVersion === "function") {
        window.toggleBibleVersion();
      }
    });
  }

  const audioBtn = document.getElementById("reader-audio-btn");
  if (audioBtn) {
    audioBtn.addEventListener("click", () => {
      if (typeof window.toggleReaderAudio === "function") {
        window.toggleReaderAudio();
      }
    });
  }

  const searchBtn = document.getElementById("reader-search-btn");
  const searchOverlay = document.getElementById("global-search-overlay");
  const searchInput = document.getElementById("global-search-input");
  const searchCancelBtn = document.getElementById("global-search-cancel-btn");
  const searchClearBtn = document.getElementById("global-search-clear-btn");
  const searchResultsContainer = document.getElementById("global-search-results");
  const searchResultsCountEl = document.getElementById("search-results-count");
  const searchReferenceHintEl = document.getElementById("global-search-reference-hint");
  let searchRequestId = 0;

  // #362：🔍 只找經文內容；輸入看起來像出處時，只多一行指路提示（不可點、不跳轉）。
  function updateSearchReferenceHint(query) {
    if (!searchReferenceHintEl) return;
    const parsed = query ? parseReaderReference(query) : null;
    const show = isReaderReferenceResult(parsed);
    searchReferenceHintEl.textContent = show
      ? (usesEnglishReaderLabels() ? "To jump to a passage, use the table of contents" : "要跳到章節，請從目錄輸入")
      : "";
    searchReferenceHintEl.classList.toggle("hidden", !show);
  }

  function resetSearchResults() {
    searchRequestId += 1;
    if (searchResultsContainer) searchResultsContainer.innerHTML = "";
    updateSearchReferenceHint("");
    if (searchResultsCountEl) searchResultsCountEl.textContent = "請輸入關鍵字進行搜尋";
  }

  if (searchBtn && searchOverlay) {
    searchBtn.addEventListener("click", () => {
      openReaderLayer(searchOverlay);
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      if (searchClearBtn) searchClearBtn.classList.add("hidden");
      resetSearchResults();
    });
  }

  if (searchCancelBtn && searchOverlay) {
    searchCancelBtn.addEventListener("click", () => {
      closeReaderLayer(searchOverlay);
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchClearBtn.classList.add("hidden");
      resetSearchResults();
      searchInput.focus();
    });
  }

  let searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      if (searchClearBtn) {
        searchClearBtn.classList.toggle("hidden", !query);
      }
      
      clearTimeout(searchTimeout);
      if (!query) {
        resetSearchResults();
        return;
      }
      const requestId = ++searchRequestId;
      updateSearchReferenceHint(query);

      // #378：英文版本仍由 bolls.life 搜尋，它規定至少 3 個字，不必等 debounce 就能提示。
      const searchVersion = state.readerState.version || "CUNP";
      if (getBibleSearchPlan(searchVersion).source === "bolls" && isShortBibleQuery(query)) {
        if (searchResultsContainer) searchResultsContainer.innerHTML = "";
        if (searchResultsCountEl) {
          searchResultsCountEl.textContent = getBibleSearchErrorMessage(createBibleSearchError(BIBLE_SEARCH_ERROR.QUERY_TOO_SHORT));
        }
        return;
      }

      if (searchResultsCountEl) searchResultsCountEl.textContent = "正在搜尋中...";
      
      searchTimeout = setTimeout(async () => {
        try {
          const results = await window.searchBibleText(query, searchVersion);
          if (requestId !== searchRequestId) return;
          renderSearchResults(results, query);
        } catch (err) {
          if (requestId !== searchRequestId) return;
          if (!err || !err.code) console.error("Search error:", err);
          // 不留上一次的結果，避免「搜尋失敗」底下還列著別的關鍵字的經文。
          if (searchResultsContainer) searchResultsContainer.innerHTML = "";
          if (searchResultsCountEl) searchResultsCountEl.textContent = getBibleSearchErrorMessage(err);
        }
      }, 400);
    });
  }

  function renderSearchResults(results, query) {
    if (!searchResultsContainer) return;
    searchResultsContainer.innerHTML = "";
    
    if (!results || results.length === 0) {
      if (searchResultsCountEl) searchResultsCountEl.textContent = "找不到符合的經文";
      return;
    }
    
    if (searchResultsCountEl) {
      const truncated = Number(results.totalCount) > results.length;
      searchResultsCountEl.textContent = truncated
        ? `結果太多，只顯示前 ${results.length} 筆`
        : `共找到 ${results.length} 筆符合的結果`;
    }
    
    // 經文來自外部 API：先去標籤再 escape，最後才加 <mark>，不把 API 內容直接放進 innerHTML。
    // 信望愛查詢會轉換「裏／裡」與新標點譯名（#378），標示時這些寫法都要對得上。
    const highlightTerms = [...new Set([query, ...(Array.isArray(results.highlightTerms) ? results.highlightTerms : [])])]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    const highlightPattern = new RegExp(`(${highlightTerms.map(term => escapeRegExp(escapeHTML(term))).join("|")})`, "gi");
    results.forEach(item => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      
      const safeText = escapeHTML(String(item.text || "").replace(/<[^>]*>/g, ""));
      const highlightedText = safeText.replace(highlightPattern, "<mark>$1</mark>");
      
      div.innerHTML = `
        <div class="search-result-ref">${escapeHTML(item.bookName)} ${Number(item.chapter)}章:${Number(item.verse)}節</div>
        <div class="search-result-text">${highlightedText}</div>
      `;
      
      div.addEventListener("click", () => {
        if (searchOverlay) closeReaderLayer(searchOverlay);
        
        const book = BIBLE_BOOKS.find(b => b.name === item.bookName || b.eng.toLowerCase() === item.bookEng.toLowerCase());
        if (book) {
          goToReaderVerse({ bookId: book.id, chapter: item.chapter, verse: item.verse });
        }
      });
      
      searchResultsContainer.appendChild(div);
    });
  }

  const settingsTrigger = document.getElementById("reader-settings-trigger-btn");
  const settingsBackdrop = document.getElementById("typography-settings-backdrop");
  const settingsCloseBtn = document.getElementById("typography-sheet-close-btn");
  const settingsApplyBtn = document.getElementById("typography-sheet-apply-btn");

  if (settingsTrigger && settingsBackdrop) {
    settingsTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      openReaderLayer(settingsBackdrop);
      updateSheetActiveStates();
      if (typeof window.initSpeechPreferencesControls === "function") {
        window.initSpeechPreferencesControls();
      }
    });
  }

  if (settingsCloseBtn && settingsBackdrop) {
    settingsCloseBtn.addEventListener("click", () => {
      closeReaderLayer(settingsBackdrop);
    });
  }

  if (settingsApplyBtn && settingsBackdrop && settingsApplyBtn.dataset.bound !== "true") {
    settingsApplyBtn.dataset.bound = "true";
    settingsApplyBtn.addEventListener("click", () => {
      const slider = document.getElementById("reader-font-size-slider");
      if (slider) state.readerState.fontSize = normalizeReaderFontSize(slider.value);
      updateReaderFontSize();
      try {
        if (state.speechSettings) {
          localStorage.setItem("nlc_speech_settings", JSON.stringify(state.speechSettings));
        }
      } catch (_error) {}
      closeReaderLayer(settingsBackdrop);
      showToast("閱讀與朗讀設定已套用");
    });
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === settingsBackdrop) {
        closeReaderLayer(settingsBackdrop);
      }
    });
  }

  const readerFontSizeSlider = document.getElementById("reader-font-size-slider");
  if (readerFontSizeSlider && readerFontSizeSlider.dataset.bound !== "true") {
    readerFontSizeSlider.dataset.bound = "true";
    readerFontSizeSlider.addEventListener("input", () => {
      updateFontSizeDraftDisplay(readerFontSizeSlider.value);
    });
  }

  document.querySelectorAll(".reader-font-size-tick").forEach(btn => {
    if (btn.dataset.bound === "true") return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      updateFontSizeDraftDisplay(btn.dataset.readerFontSize);
    });
  });

  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      if (typeof window.applyAppTheme === "function") {
        window.applyAppTheme(theme);
        updateSheetActiveStates();
      }
    });
  });

  function updateSheetActiveStates() {
    const fontSize = normalizeReaderFontSize(state.readerState.fontSize);
    updateFontSizeDraftDisplay(fontSize);
    document.querySelectorAll(".theme-option").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === state.theme);
    });
  }

  function updateFontSizeDraftDisplay(value) {
    const fontSize = normalizeReaderFontSize(value);
    const slider = document.getElementById("reader-font-size-slider");
    const output = document.getElementById("reader-font-size-value");
    if (slider) {
      slider.value = String(fontSize);
      slider.setAttribute("aria-valuenow", String(fontSize));
      slider.setAttribute("aria-valuetext", `${fontSize}px`);
    }
    if (output) output.textContent = `${fontSize}px`;
    document.querySelectorAll(".reader-font-size-tick").forEach(btn => {
      const isActive = Number(btn.dataset.readerFontSize) === fontSize;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  // Removed 2026-09-16: event-listener registration for the legacy
  // <select>-based reader picker (#reader-testament-buttons/-select,
  // #reader-book-select, #reader-chapter-select). None of those elements
  // exist anymore (the picker moved to the #bible-nav-content overlay), so
  // every one of these `if (x)` guards was always false and nothing ever
  // attached. NOTE: renderReaderPicker() and its three sub-functions
  // (renderReaderTestamentTabs/BookGrid/ChapterGrid) are left in place —
  // they're still called from several other live sites in this file
  // (initReaderControls itself, plus a couple of others) and are 100%
  // harmless no-ops there (same missing-DOM guards), but removing the
  // function definitions safely means finding and removing every call site
  // too, which is a bigger, separate pass, not bundled into this cleanup.

  const incFont = document.getElementById("reader-font-increase");
  const decFont = document.getElementById("reader-font-decrease");
  if (incFont) incFont.addEventListener("click", () => {
    if (state.readerState.fontSize < 24) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (decFont) decFont.addEventListener("click", () => {
    if (state.readerState.fontSize > 16) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });

  const legacyInc = document.getElementById("increase-font");
  const legacyDec = document.getElementById("decrease-font");
  if (legacyInc) legacyInc.addEventListener("click", () => {
    if (state.readerState.fontSize < 24) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (legacyDec) legacyDec.addEventListener("click", () => {
    if (state.readerState.fontSize > 16) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });

  const prevChapterBtn = document.getElementById("prev-chapter-btn");
  const nextChapterBtn = document.getElementById("next-chapter-btn");
  if (prevChapterBtn) prevChapterBtn.addEventListener("click", () => {
    flipToReaderChapter(-1);
  });
  if (nextChapterBtn) nextChapterBtn.addEventListener("click", () => {
    flipToReaderChapter(1);
  });

  initSmartFloatingReaderNav();
  initImmersivePlanReader();
  initReaderChapterGestures();

  const markReadBtn = document.getElementById("mark-read-btn");
  if (markReadBtn) {
    markReadBtn.addEventListener("click", () => {
      const wasChecked = markReadBtn.classList.contains("checked");
      const isChecked = !wasChecked;
      const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
      if (!bookObj) return;

      // 💡 關鍵修復：唯讀歷史鎖定，防止從讀經頁面誤觸修改歷史遍數打卡紀錄
      const planRound = state.readerState.planRound || (state.activePlan ? state.activePlan.currentRound || 1 : 1);
      const taskPlan = getCurrentPlanReaderTask()?.plan || state.activePlan;
      if (isChecked && isPlanProgressLocked(taskPlan, { hidden: window.isPlanHidden?.(taskPlan) })) {
        showToast("此階段尚未正式開放，目前僅供預覽，無法記錄已讀。");
        return;
      }
      if (state.activePlan && planRound < (state.activePlan.currentRound || 1)) {
        showToast("此遍進度已完成存檔，無法修改以前的打卡紀錄。");
        return;
      }

      if (state.activePlan && isPlanCheckInClosed(state.activePlan)) {
        showToast(getPlanEndedNotice(state.activePlan.endDate));
        return;
      }

      if (state.offlineMode) {
        showToast("離線閱讀模式無法記錄進度，恢復連線後再試");
        return;
      }

      markReadBtn.classList.toggle("checked", isChecked);

      let planDayChKey = null;
      if (state.activePlan) {
        planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
        window.renderPlanScheduleTracker?.();
        calculatePlanProgress();
        if (typeof updateDashboardView === "function") {
          updateDashboardView();
        }
      }

      updateReaderRecordStatus();
      db.logChapterRead(bookObj.name, state.readerState.chapter, isChecked, planRound, state.activePlan)
        .then(async () => {
          updateReaderRecordStatus();
          if (state.activePlan) {
            const plan = state.activePlan;
            const shouldHandleR1 = plan.isPlanCompleted && !plan.upgradePromptHandled;
            const shouldHandleR2 = plan.isRound2Completed && !plan.round2UpgradePromptHandled;
            if (shouldHandleR1 || shouldHandleR2) {
              if (typeof window.handleRoundCompletion === "function") {
                await window.handleRoundCompletion(plan);
              }
            }
            if (isChecked && typeof window.checkAndPromptTodayCompletion === "function") {
              await window.checkAndPromptTodayCompletion();
            }
          }
        })
        .catch(error => {
          console.error("Failed to update reader progress in background", error);
          markReadBtn.classList.toggle("checked", wasChecked);
          updateReaderRecordStatus();
          if (state.activePlan && planDayChKey) {
            window.renderPlanScheduleTracker?.();
            calculatePlanProgress();
            if (typeof updateDashboardView === "function") {
              updateDashboardView();
            }
          }
          showToast(isPlanCheckInClosedError(error) && state.activePlan
            ? getPlanEndedNotice(state.activePlan.endDate)
            : ((window.APP_COPY && window.APP_COPY.plan.syncFail) || "進度沒同步成功，等一下再試試"));
        });
    });
  }
}

export function renderReaderPicker() {
  renderReaderTestamentTabs();
  renderReaderBookGrid();
  renderReaderChapterGrid();
}

function renderReaderTestamentTabs() {
  const testamentSelect = document.getElementById("reader-testament-select");
  const currentFilter = testamentSelect ? testamentSelect.value : "all";
  document.querySelectorAll("#reader-testament-buttons .reader-picker-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.testament === currentFilter);
  });
}

function renderReaderBookGrid() {
  const grid = document.getElementById("reader-book-grid");
  const bookSelect = document.getElementById("reader-book-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  if (!grid || !bookSelect) return;

  const filter = testamentSelect ? testamentSelect.value : "all";
  grid.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter !== "all" && book.section !== filter) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-book-choice";
    btn.classList.toggle("active", Number(book.id) === Number(state.readerState.bookId));
    btn.textContent = getReaderBookLabel(book);
    btn.addEventListener("click", () => {
      state.readerState.bookId = book.id;
      state.readerState.chapter = 1;
      bookSelect.value = String(book.id);
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderPicker();
      updatePillLabels();
    });
    grid.appendChild(btn);
  });
}

function renderReaderChapterGrid() {
  const grid = document.getElementById("reader-chapter-grid");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const book = BIBLE_BOOKS.find(b => Number(b.id) === Number(state.readerState.bookId));
  if (!grid || !chapterSelect || !book) return;

  grid.innerHTML = "";
  for (let chapter = 1; chapter <= book.chapters; chapter++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-chapter-choice";
    btn.classList.toggle("active", Number(chapter) === Number(state.readerState.chapter));
    btn.textContent = chapter;
    btn.addEventListener("click", () => {
      state.readerState.chapter = chapter;
      chapterSelect.value = String(chapter);
      saveReaderPreferences();
      renderReaderText();
      renderReaderPicker();
      updatePillLabels();
    });
    grid.appendChild(btn);
  }
}

export function populateBookSelector(filter) {
  const bookSelect = document.getElementById("reader-book-select");
  if (!bookSelect) return;

  bookSelect.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter === "all" || book.section === filter) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = getReaderBookLabel(book) + " (" + getReaderBookAbbreviation(book) + ")";
      if (book.id === state.readerState.bookId) {
        option.selected = true;
      }
      bookSelect.appendChild(option);
    }
  });
}

export function populateChapterSelector() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const bookId = bookSelect ? parseInt(bookSelect.value || state.readerState.bookId, 10) : Number(state.readerState.bookId || 1);
  state.readerState.bookId = bookId;

  const book = BIBLE_BOOKS.find(b => b.id === bookId);
  if (!book) {
    console.error("Book not found for ID:", bookId);
    return;
  }

  if (state.readerState.chapter > book.chapters) {
    state.readerState.chapter = 1;
  }

  if (!chapterSelect) return;
  chapterSelect.innerHTML = "";

  for (let i = 1; i <= book.chapters; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = usesEnglishReaderLabels() ? `Chapter ${i}` : `${i} 章`;
    if (i === state.readerState.chapter) {
      option.selected = true;
    }
    chapterSelect.appendChild(option);
  }
}

export function saveReaderPreferences() {
  localStorage.setItem("reader_state", JSON.stringify({
    bookId: state.readerState.bookId,
    chapter: state.readerState.chapter
  }));
}

export function updatePillLabels() {
  const book = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  const refLabel = document.getElementById("reader-nav-ref-label");
  if (refLabel && book) {
    refLabel.textContent = usesEnglishReaderLabels()
      ? `${book.eng} ${state.readerState.chapter}`
      : `${book.name} ${state.readerState.chapter}`;
  }

  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const version = state.readerState.version || "CUNP";
    const label = version === "RCUVTS" ? "RCUV" : version;
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
    const inlineVersion = document.getElementById("reader-version-inline");
    if (inlineVersion) inlineVersion.textContent = label;
    const navBadge = document.getElementById("bible-nav-version-badge");
    if (navBadge) navBadge.textContent = label;
  }
}

const READER_FONT_SIZES = [16, 18, 20, 22, 24];

function normalizeReaderFontSize(value) {
  const requestedSize = Number(value);
  if (!Number.isFinite(requestedSize)) return 20;
  return READER_FONT_SIZES.reduce((closest, size) =>
    Math.abs(size - requestedSize) < Math.abs(closest - requestedSize) ? size : closest, 20);
}

export function updateReaderFontSize() {
  const size = normalizeReaderFontSize(state.readerState.fontSize);
  state.readerState.fontSize = size;
  document.documentElement.style.setProperty("--reader-font-size", size + "px");
  const readerView = document.getElementById("reader-view");
  if (readerView) readerView.style.setProperty("--reader-font-size", size + "px");
  const bibleContent = document.getElementById("bible-content");
  if (bibleContent) {
    bibleContent.style.setProperty("font-size", size + "px", "important");
    bibleContent.querySelectorAll(".verse-text, .verse-num").forEach(element => {
      element.style.setProperty("font-size", size + "px", "important");
    });
  }

  localStorage.setItem("reader_font_size", size);

  const slider = document.getElementById("reader-font-size-slider");
  const output = document.getElementById("reader-font-size-value");
  if (slider) {
    slider.value = String(size);
    slider.setAttribute("aria-valuenow", String(size));
    slider.setAttribute("aria-valuetext", `${size}px`);
  }
  if (output) output.textContent = `${size}px`;

  document.querySelectorAll("#reader-settings-dropdown .font-btn, .reader-font-size-tick").forEach(b => {
    const buttonSize = Number(b.dataset.readerFontSize ?? b.dataset.size);
    const isActive = buttonSize === state.readerState.fontSize;
    b.classList.toggle("active", isActive);
    if (b.classList.contains("reader-font-size-tick")) b.setAttribute("aria-pressed", String(isActive));
  });

  document.querySelectorAll("#reader-settings-dropdown .theme-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === state.theme);
  });
}

function getReaderScrollSurface() {
  const readerSurface = document.querySelector(".reader-reading-surface");
  const mainSurface = document.querySelector(".main-content");
  if (readerSurface && Number(readerSurface.scrollHeight) > Number(readerSurface.clientHeight) + 1) return readerSurface;
  if (mainSurface && Number(mainSurface.scrollHeight) > Number(mainSurface.clientHeight) + 1) return mainSurface;
  return readerSurface || mainSurface;
}

function setReaderScrollTop(top = 0, behavior = "auto") {
  const scrollSurface = getReaderScrollSurface();
  if (!scrollSurface) return false;
  const safeTop = Math.max(0, Number(top) || 0);
  if (behavior === "auto") {
    scrollSurface.scrollTop = safeTop;
    return true;
  }
  try {
    scrollSurface.scrollTo({ top: safeTop, behavior });
  } catch (_error) {
    scrollSurface.scrollTop = safeTop;
  }
  return true;
}

function scrollReaderVerseIntoView(verseElement, behavior = "smooth") {
  const scrollSurface = getReaderScrollSurface();
  if (!scrollSurface || !verseElement) return false;

  const surfaceRect = scrollSurface.getBoundingClientRect();
  const verseRect = verseElement.getBoundingClientRect();
  const centerOffset = Math.max(0, (scrollSurface.clientHeight - verseRect.height) / 2);
  const targetTop = scrollSurface.scrollTop + verseRect.top - surfaceRect.top - centerOffset;
  return setReaderScrollTop(targetTop, behavior);
}

function nextReaderLayoutFrame() {
  return new Promise(resolve => {
    const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    schedule(() => schedule(resolve));
  });
}

async function resetReaderScrollAfterChapterRender(sessionId) {
  // Wait for the new verses and their final font metrics to affect layout.
  // Reset twice (before and after the layout frames) to defeat mobile browser
  // scroll anchoring, which can otherwise keep the old chapter's bottom edge.
  setReaderScrollTop(0, "auto");
  await nextReaderLayoutFrame();
  if (sessionId !== currentAudioSessionId || !isSpeaking) return false;
  setReaderScrollTop(0, "auto");
  return true;
}

export async function navigateToChapter(direction, options = {}) {
  const autoContinue = options.autoContinue === true;
  // 統一已讀規則（#349）：章末到過之後，手動換章（按鈕／滑動／鍵盤）也算讀完。
  // 朗讀自動接章的情況由 continueReaderAudioToNextChapter 先處理。
  // 必須在下面改動 readerState 之前呼叫，這樣記錄的是「離開的這一章」。
  if (!autoContinue) recordLeavingReaderChapter();
  // 手動換章：換好後幫螢幕報讀器播報新的章名（#347）。朗讀自動接章不播，免得蓋過朗讀。
  if (!autoContinue) readerAnnounceNextRender = true;
  const hadAudioPosition = isSpeaking || !document.getElementById("reader-audio-timeline")?.classList.contains("hidden");
  if (!autoContinue) stopReaderAudio(true);
  const currentBook = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);

  // "Next"/"prev" is always purely sequential from whatever chapter is currently
  // on screen — one chapter at a time, rolling over book boundaries. It is
  // deliberately NOT tied to the plan's day list: wherever the reader is, that
  // chapter gets recorded, and the next chapter is simply the one after it.
  let newChapter = state.readerState.chapter + direction;
  
  if (newChapter < 1) {
    const prevBookId = state.readerState.bookId - 1;
    if (prevBookId >= 1) {
      const prevBook = BIBLE_BOOKS.find(b => b.id === prevBookId);
      state.readerState.bookId = prevBookId;
      state.readerState.chapter = prevBook.chapters;
      
      const testamentSelect = document.getElementById("reader-testament-select");
      if (testamentSelect) testamentSelect.value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      const rendered = await renderReaderText({ preserveAudio: autoContinue, autoContinue });
      if (autoContinue && rendered !== true) return false;
      if (!autoContinue) resetReaderAudioAfterManualChapterChange(hadAudioPosition);
      return true;
    }
  } else if (newChapter > currentBook.chapters) {
    const nextBookId = state.readerState.bookId + 1;
    if (nextBookId <= 66) {
      state.readerState.bookId = nextBookId;
      state.readerState.chapter = 1;
      
      const testamentSelect = document.getElementById("reader-testament-select");
      if (testamentSelect) testamentSelect.value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      const rendered = await renderReaderText({ preserveAudio: autoContinue, autoContinue });
      if (autoContinue && rendered !== true) return false;
      if (!autoContinue) resetReaderAudioAfterManualChapterChange(hadAudioPosition);
      return true;
    }
  } else {
    state.readerState.chapter = newChapter;
    const chapterSelect = document.getElementById("reader-chapter-select");
    if (chapterSelect) chapterSelect.value = newChapter;
    saveReaderPreferences();
    const rendered = await renderReaderText({ preserveAudio: autoContinue, autoContinue });
    if (autoContinue && rendered !== true) return false;
    if (!autoContinue) resetReaderAudioAfterManualChapterChange(hadAudioPosition);
    return true;
  }
  return false;
}

export async function renderReaderText(options = {}) {
  const container = document.getElementById("bible-content");
  if (!container) return;

  const renderRequestId = ++readerRenderRequestId;
  const requestedVersion = String(state.readerState?.version || "CUNP").toUpperCase();

  let verses = null;
  let isLoading = true;

  if (isSpeaking && options.preserveAudio !== true) {
    stopReaderAudio(true);
  }
  document.body.classList.remove("reader-navbar-hidden");
  // 選取集合跨章保留（B 案）；只拆掉舊工具列 DOM，換章渲染後由 refreshVerseSelectionUI 重建
  closeSelectionBottomBar({ clearSelection: false });
  state.readerState.autoMarked = false;
  state.readerState.autoMarkInFlight = false;
  reachedEndTargetKey = "";
  if (readerBottomDwellController) readerBottomDwellController.reset();
  readerEndObserver?.disconnect();
  readerEndObserver = null;
  readerEndVisible = false;
  const heading = document.getElementById("bible-title");
  const markReadBtn = document.getElementById("mark-read-btn");
  
  const bookId = Number(state.readerState && state.readerState.bookId) || 1;
  const book = BIBLE_BOOKS.find(b => b.id === bookId) || BIBLE_BOOKS[0];
  const chapter = Number(state.readerState && state.readerState.chapter) || 1;

  if (heading) heading.textContent = getReaderHeadingText(book, chapter);
  updatePillLabels();
  renderReaderPicker();
  loadVerseNotesForChapter(book.name, chapter);
  readerCommentary.resetForChapter();

  setReaderScrollTop(0, "auto");

  const bar = document.getElementById("reader-bottom-action-bar");
  if (bar) {
    bar.style.display = "none";
    bar.classList.add("hidden");
  }

  const cacheKey = window.getBibleChapterCacheKey
    ? window.getBibleChapterCacheKey(book.eng, chapter, requestedVersion)
    : `${requestedVersion}_${book.eng}_${chapter}`;
  const cachedData = window._bibleChapterCache && window._bibleChapterCache[cacheKey];
  if (cachedData && !cachedData.isPlaceholder && cachedData.verses && cachedData.verses.length > 0) {
    verses = cachedData.verses;
    isLoading = false;
  }

  if (isLoading || !verses) {
    ComponentSkeletonLoader.show('reader', container);
  } else {
    renderVersesList(container, verses, book.name, chapter);
  }
  
  if (markReadBtn) {
    // #474：只看還能打卡的計畫＋無歸屬紀錄（點進已結束計畫按需載入的紀錄不算）。
    const isRead = state.readingLogs.some(l => l.book === book.name && l.chapter === chapter
      && isLogInOpenScope(state.readingLogScope, l));
    markReadBtn.classList.toggle("checked", isRead);
  }

  try {
    isLoading = true;
    const data = await fetchBibleChapter(book.eng, chapter, requestedVersion);
    const requestIsStale = renderRequestId !== readerRenderRequestId
      || String(state.readerState?.version || "CUNP").toUpperCase() !== requestedVersion
      || Number(state.readerState?.bookId) !== bookId
      || Number(state.readerState?.chapter) !== chapter;
    if (requestIsStale) return false;
    verses = data ? data.verses : null;
    isLoading = false;

    if (!verses || verses.length === 0) {
      throw new Error("經文正在稍微休息中，別擔心，我們一起重新點亮畫面試試看！");
    }

    if (data.isPlaceholder) {
      if (options.autoContinue === true && options.autoRetryAttempted !== true) {
        await new Promise(resolve => window.setTimeout(resolve, 450));
        const retryIsStale = renderRequestId !== readerRenderRequestId
          || String(state.readerState?.version || "CUNP").toUpperCase() !== requestedVersion
          || Number(state.readerState?.bookId) !== bookId
          || Number(state.readerState?.chapter) !== chapter;
        if (retryIsStale) return false;
        return renderReaderText({
          preserveAudio: true,
          autoContinue: true,
          autoRetryAttempted: true
        });
      }
      renderReaderLoadRetryState(container, {
        bookEngName: book.eng,
        chapter,
        version: requestedVersion
      });
      updateReaderFontSize();
      return false;
    }

    // 快取命中時上面已經畫過同一份經文，不用再整章重畫一次（#347：換章更快）。
    if (data !== cachedData) renderVersesList(container, verses, book.name, chapter);
    triggerPredictivePrefetch();
    if (readerFadeNextRender || options.autoContinue === true) {
      // 朗讀自動接章、或系統開了「減少動態效果」：不翻頁，只淡入。
      readerFadeNextRender = false;
      container.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    }
    if (readerAnnounceNextRender) {
      readerAnnounceNextRender = false;
      announceReaderChapter(getReaderHeadingText(book, chapter));
    }
    maybeShowReaderSwipeTip();
  } catch (error) {
    if (renderRequestId !== readerRenderRequestId
      || String(state.readerState?.version || "CUNP").toUpperCase() !== requestedVersion) return false;
    console.error("Failed to load complete Bible chapter:", error);
    isLoading = false;
    renderReaderLoadRetryState(container, {
      bookEngName: book.eng,
      chapter,
      version: requestedVersion
    });
    updateReaderFontSize();
    return false;
  }

  updateReaderFontSize();
  // 靈修「打開閱讀器」：跳到指定的起始節（不是捲到頂），並短暫標示。
  const jumpVerse = Number(state.readerState && state.readerState.pendingScrollVerse) || 0;
  if (jumpVerse > 0) {
    state.readerState.pendingScrollVerse = null;
    setTimeout(() => {
      const el = container.querySelector(`.bible-verse[data-verse="${jumpVerse}"]`)
        || container.querySelector(`#reader-verse-${jumpVerse}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        const prevBg = el.style.backgroundColor;
        el.style.backgroundColor = "var(--color-brand-subtle, rgba(4,169,210,0.22))";
        setTimeout(() => { el.style.backgroundColor = prevBg; }, 1500);
      } else {
        setReaderScrollTop(0, "auto");
      }
    }, 120);
  } else {
    setReaderScrollTop(0, "auto");
  }
  updateReaderBottomActionBar();
  updateReaderRecordStatus();
  bindReaderEndObserver();
  scheduleReaderBottomDwellCheck();
  refreshVerseSelectionUI();   // 跨章：把仍在選取集合裡、屬於這一章的節重新標記並重建工具列
  // 經文畫完才查注釋（#447、#470），不跟經文搶網路。經文文字用來比對整卷／整章詞條。
  void readerCommentary.refreshForChapter(book.name, chapter, `${book.name} ${chapter}章`, renderedReaderChapter.textByVerse);
  return true;
}

function renderReaderLoadRetryState(container, { bookEngName, chapter, version }) {
  if (!container) return;
  container.innerHTML = `
    <div class="reader-load-retry-state" role="alert" aria-live="polite">
      <span class="reader-load-retry-state__icon" aria-hidden="true">
        <span class="nlc-icon nlc-icon--md" data-icon="refresh"></span>
      </span>
      <strong>經文尚未載入</strong>
      <p>請確認網路連線後，再重新讀取本章經文。</p>
      <button type="button" class="primary-btn reader-load-retry-state__button" data-reader-load-retry>
        <span class="nlc-icon nlc-icon--sm" data-icon="refresh" aria-hidden="true"></span>
        <span>重新讀取</span>
      </button>
    </div>
  `;
  if (typeof hydrateIcons === "function") hydrateIcons(container);

  container.querySelector("[data-reader-load-retry]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = "重新讀取中…";

    const cacheKey = window.getBibleChapterCacheKey
      ? window.getBibleChapterCacheKey(bookEngName, chapter, version)
      : `${version}_${bookEngName}_${chapter}`;
    if (window._bibleChapterCache) delete window._bibleChapterCache[cacheKey];
    await renderReaderText();
  });
}

function clearReaderStartSelection() {
  const container = document.getElementById("bible-content");
  if (container) {
    container.querySelectorAll(".bible-verse.reader-start-selected").forEach(item => {
      item.classList.remove("reader-start-selected");
      item.setAttribute("aria-pressed", "false");
    });
  }
  if (state.readerState) {
    state.readerState.selectedVerseNum = null;
  }
}

function closeSelectionBottomBar({ clearSelection = true } = {}) {
  if (selectionBottomBarBindTimer) {
    clearTimeout(selectionBottomBarBindTimer);
    selectionBottomBarBindTimer = null;
  }
  if (typeof selectionBottomBarCleanup === "function") {
    selectionBottomBarCleanup();
    selectionBottomBarCleanup = null;
  }
  const rootElement = document.getElementById("selection-bottom-bar-root");
  if (rootElement) rootElement.innerHTML = "";
  if (clearSelection) clearReaderStartSelection();
}

// ── 統一「點選多節經文」選取集合的操作 ──────────────────────────────
function verseSelKey(bookId, chapter, verse) {
  return `${bookId}_${chapter}_${verse}`;
}

function currentReaderBookId() {
  return Number(state.readerState && state.readerState.bookId) || 1;
}

function currentReaderChapter() {
  return Number(state.readerState && state.readerState.chapter) || 1;
}

function getSelectedVersesSorted() {
  const order = new Map(BIBLE_BOOKS.map((b, i) => [b.id, i]));
  return Array.from(verseSelection.values()).sort((a, b) =>
    (order.get(a.bookId) ?? 999) - (order.get(b.bookId) ?? 999)
    || a.chapter - b.chapter
    || a.verse - b.verse);
}

// 本章、已貼在 DOM 的節套 .verse-selected；恰好選一節且在本章 → 也套 .reader-start-selected（朗讀起點）
function applySelectionClassesToDom() {
  const container = document.getElementById("bible-content");
  if (!container) return;
  const bookId = currentReaderBookId();
  const chapter = currentReaderChapter();
  const sorted = getSelectedVersesSorted();
  const solo = (sorted.length === 1 && sorted[0].bookId === bookId && sorted[0].chapter === chapter)
    ? sorted[0].verse : null;
  container.querySelectorAll(".bible-verse[data-verse]").forEach(el => {
    const v = Number(el.dataset.verse);
    const on = verseSelection.has(verseSelKey(bookId, chapter, v));
    el.classList.toggle("verse-selected", on);
    el.classList.toggle("reader-start-selected", v === solo);
    el.setAttribute("aria-pressed", String(on));
  });
}

// TTS 起點：恰好一節、且在目前這一章 → 那一節；否則（0、2+、或在別章）→ null（＝從第 1 節）
function syncReaderStartVerse() {
  if (!state.readerState) return;
  const sorted = getSelectedVersesSorted();
  state.readerState.selectedVerseNum =
    (sorted.length === 1 && sorted[0].bookId === currentReaderBookId() && sorted[0].chapter === currentReaderChapter())
      ? sorted[0].verse : null;
}

function refreshVerseSelectionUI() {
  applySelectionClassesToDom();
  syncReaderStartVerse();
  if (verseSelection.size === 0) {
    closeSelectionBottomBar({ clearSelection: false });
  } else {
    renderUnifiedSelectionBar();
  }
}

function clearAllVerseSelection() {
  verseSelection.clear();
  const container = document.getElementById("bible-content");
  container?.querySelectorAll(".bible-verse.verse-selected, .bible-verse.reader-start-selected").forEach(el => {
    el.classList.remove("verse-selected", "reader-start-selected");
    el.setAttribute("aria-pressed", "false");
  });
  syncReaderStartVerse();
  closeSelectionBottomBar({ clearSelection: false });
}

function removeVersesFromSelection(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || "").split(",");
  let changed = false;
  list.forEach(k => { if (k && verseSelection.delete(k)) changed = true; });
  if (changed) refreshVerseSelectionUI();
}

function toggleVerseSelection(entry) {
  const key = verseSelKey(entry.bookId, entry.chapter, entry.verse);
  if (verseSelection.has(key)) verseSelection.delete(key);
  else verseSelection.set(key, entry);
  refreshVerseSelectionUI();
}

// 複製／分享文字：依「書→章」分段；同章連續節壓成 a-b、非連續用逗號。
// 不同章或不同卷 → 每段自己一個【參照】標題 + 該段經文，段與段直接換行相接。
// 格式和 /read 讀經頁共用（js/modules/verse-selection-format.mjs，#423）。
function formatSelectionText() {
  return formatVerseSelectionText(getSelectedVersesSorted());
}

function copySelectionText() {
  const text = formatSelectionText();
  if (!text) return;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(() => showToast("經文已複製到剪貼簿！"));
  } else {
    showToast(text);
  }
}

function shareSelectionText() {
  const text = formatSelectionText();
  if (!text) return;
  if (navigator.share) {
    navigator.share({ title: "經文分享", text, url: window.location.href }).catch(() => {});
  } else if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(() => showToast("經文已複製，可直接貼上分享！"));
  }
}

// 一個顏色套用到所有選取節；color 為 falsy → 清除所有選取節的標註
function applyHighlightToSelection(color) {
  const entries = Array.from(verseSelection.values());
  if (entries.length === 0) return;
  const clearing = !color;
  const normalizedColor = clearing ? "" : String(color).toLowerCase();
  if (!clearing && !/^#[0-9a-f]{6}$/i.test(normalizedColor)) return;
  const container = document.getElementById("bible-content");
  const curBook = currentReaderBookId();
  const curChap = currentReaderChapter();
  entries.forEach(({ bookName, bookId, chapter, verse }) => {
    const hk = `${bookName}_${chapter}_${verse}`;
    if (clearing) {
      delete state.highlights[hk];
      delete state.highlightTimestamps[hk];
    } else {
      state.highlights[hk] = normalizedColor;
      state.highlightTimestamps[hk] = new Date().toISOString();
    }
    if (bookId === curBook && chapter === curChap && container) {
      const el = container.querySelector(`.bible-verse[data-verse="${verse}"]`);
      if (el) {
        if (clearing) {
          el.style.removeProperty("--verse-highlight-color");
          el.removeAttribute("data-highlight");
        } else {
          el.style.setProperty("--verse-highlight-color", normalizedColor);
          el.setAttribute("data-highlight", normalizedColor);
        }
      }
    }
    if (clearing) {
      if (typeof db.deleteHighlight === "function") {
        db.deleteHighlight(bookName, chapter, verse).catch(err => console.warn("[bible] deleteHighlight failed:", err));
      }
    } else if (typeof db.saveHighlight === "function") {
      db.saveHighlight(bookName, chapter, verse, normalizedColor).catch(err => console.warn("[bible] saveHighlight failed:", err));
    }
  });
  localStorage.setItem("bible_highlights", JSON.stringify(state.highlights));
  localStorage.setItem("bible_highlight_timestamps", JSON.stringify(state.highlightTimestamps));
  showToast(clearing ? `已清除 ${entries.length} 節的標註` : `已為 ${entries.length} 節加上標註`);
}
function setVerseNoteBadge(verseDiv, hasNote) {
  if (!verseDiv) return;
  let badge = verseDiv.querySelector(".verse-note-badge");
  if (hasNote) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "verse-note-badge";
      badge.setAttribute("data-icon", "pencil");
      badge.setAttribute("aria-hidden", "true");
      verseDiv.appendChild(badge);
      // hydrateIcons scans the given root's DESCENDANTS for [data-icon] — it
      // never processes the root element itself, so this must be the badge's
      // container, not the badge (which IS the [data-icon] element).
      if (typeof hydrateIcons === "function") hydrateIcons(verseDiv);
    }
  } else if (badge) {
    badge.remove();
  }
}

/**
 * 統一「點選多節經文」工具列：上方顯示已選經文 chip（可跨章、可逐節移除），
 * 下方動作列（全清 ✕／複製／標記／筆記（僅單節）／注釋（選到有注釋的節才有，#470）／分享）。
 * 點經文區外面不關閉、不清選取（B 案）；只有全清 ✕、chip ✕、或把節全部取消才關閉。
 */
function renderUnifiedSelectionBar() {
  const rootElement = document.getElementById("selection-bottom-bar-root");
  if (!rootElement) return;
  if (selectionBottomBarBindTimer) { clearTimeout(selectionBottomBarBindTimer); selectionBottomBarBindTimer = null; }
  if (typeof selectionBottomBarCleanup === "function") { selectionBottomBarCleanup(); selectionBottomBarCleanup = null; }

  const sorted = getSelectedVersesSorted();
  if (sorted.length === 0) { rootElement.innerHTML = ""; return; }
  const single = sorted.length === 1;
  const crossChapter = new Set(sorted.map(v => `${v.bookId}_${v.chapter}`)).size > 1;

  // 連續節（同卷同章、號碼相鄰）合併成一顆 chip：25:23-28；一顆 ✕ 移除整段
  const chipRuns = groupVerseSelectionRuns(sorted, v => verseSelKey(v.bookId, v.chapter, v.verse));
  const chipsHtml = chipRuns.map(r => {
    const vpart = r.startVerse === r.endVerse ? `${r.startVerse}` : `${r.startVerse}-${r.endVerse}`;
    // chip 空間小：跨章用縮寫書名、不留空格（出25:30、太7:6-7）；複製文字仍是完整書名。
    const abbrev = (typeof BIBLE_BOOKS !== "undefined" && BIBLE_BOOKS.find(b => b.id === r.bookId)?.abbrev) || r.bookName;
    const ref = crossChapter ? `${abbrev}${r.chapter}:${vpart}` : `${r.chapter}:${vpart}`;
    return `<button type="button" class="yv-chip" role="listitem" data-remove-keys="${escapeHTML(r.keys.join(","))}" aria-label="移除 ${escapeHTML(r.bookName)} ${r.chapter}:${vpart}">
      <span class="yv-chip-ref">${escapeHTML(ref)}</span>
      <span class="nlc-icon" data-icon="close" aria-hidden="true"></span>
    </button>`;
  }).join("");

  // 「注釋」只在選取的節（目前這一章）裡有注釋或詞彙時才出現（#470）。
  const commentaryVerses = readerCommentary.versesWithCommentary(sorted
    .filter(v => v.bookId === currentReaderBookId() && v.chapter === currentReaderChapter())
    .map(v => v.verse));

  const colorSet = new Set(sorted.map(v => state.highlights?.[`${v.bookName}_${v.chapter}_${v.verse}`] || ""));
  const commonColor = colorSet.size === 1 ? [...colorSet][0] : "";
  const dotDefs = [
    ["#fef08a", "yv-dot-yellow", "柔黃標註"],
    ["#a5f3fc", "yv-dot-cyan", "柔藍標註"],
    ["#bbf7d0", "yv-dot-green", "柔綠標註"],
    ["#fed7aa", "yv-dot-dual", "柔橘標註"],
    ["#fecdd3", "yv-dot-pink", "柔粉標註"],
    ["#ddd6fe", "yv-dot-purple", "柔紫標註"]
  ];

  rootElement.innerHTML = `
    <div id="pwa-selection-bottom-bar" class="youversion-action-bar active${single ? "" : " youversion-action-bar--multi"}">
      <div class="yv-bar-top-row">
        <div class="yv-selection-strip" role="list" aria-label="已選取的經文（共 ${sorted.length} 節）">${chipsHtml}</div>
        <button type="button" class="yv-multi-cancel-button" data-action="clear-all" aria-label="全部取消" title="全部取消">
          <span class="nlc-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
      <div class="yv-content-row">
        <div class="yv-action-group" data-yv-panel="actions">
          <button type="button" class="yv-tile" data-action="copy">
            <span class="nlc-icon" data-icon="copy" aria-hidden="true"></span>
            <span class="yv-tile-label">複製</span>
          </button>
          <button type="button" class="yv-tile${commonColor ? " is-active" : ""}" data-action="toggle-highlight" aria-expanded="false" aria-controls="yv-highlight-palette">
            <span class="nlc-icon" data-icon="pencil" aria-hidden="true"></span>
            <span class="yv-tile-label">標記</span>
          </button>
          <button type="button" class="yv-tile" data-action="note"${single ? "" : ' disabled aria-disabled="true"'}>
            <span class="nlc-icon" data-icon="journalText" aria-hidden="true"></span>
            <span class="yv-tile-label">筆記</span>
          </button>
          ${commentaryVerses.length ? `<button type="button" class="yv-tile" data-action="commentary" aria-haspopup="dialog">
            <span class="nlc-icon" data-icon="lightbulb" aria-hidden="true"></span>
            <span class="yv-tile-label">注釋</span>
          </button>` : ""}
          <button type="button" class="yv-tile" data-action="share">
            <span class="nlc-icon" data-icon="share" aria-hidden="true"></span>
            <span class="yv-tile-label">分享</span>
          </button>
        </div>
        <div id="yv-highlight-palette" class="yv-color-row hidden" data-highlight-palette role="group" aria-label="標記色盤">
          <button type="button" class="yv-color-back" data-action="close-palette" aria-label="返回">
            <span class="nlc-icon" data-icon="chevronLeft" aria-hidden="true"></span>
          </button>
          <div class="yv-color-capsule" role="group" aria-label="選擇標記顏色">
            <button type="button" class="yv-dot-clear" data-action="clear" title="取消標記" aria-label="取消標記">
              <span class="nlc-icon" data-icon="noColor" aria-hidden="true"></span>
            </button>
            <span class="yv-section-divider" aria-hidden="true"></span>
            ${dotDefs.map(([c, cls, label]) => {
              const a = commonColor === c;
              return `<button type="button" class="yv-dot ${cls}${a ? " is-active" : ""}" data-color="${c}" title="${label}" aria-label="${label}" aria-pressed="${a}"></button>`;
            }).join("")}
            <label class="yv-custom-color" title="自訂顏色">
              <input type="color" data-custom-highlight-color value="${/^#[0-9a-f]{6}$/i.test(commonColor) ? commonColor : "#fef08a"}" aria-label="自訂標記顏色">
              <span aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;

  const barDiv = document.getElementById("pwa-selection-bottom-bar");
  if (!barDiv) return;
  if (typeof hydrateIcons === "function") hydrateIcons(barDiv);

  const highlightPalette = barDiv.querySelector("[data-highlight-palette]");
  const highlightToggle = barDiv.querySelector('[data-action="toggle-highlight"]');
  const actionPanel = barDiv.querySelector('[data-yv-panel="actions"]');

  // 色盤不疊加成獨立浮層，直接取代動作列的內容（同一張卡片、同一個高度）。
  const setHighlightPaletteOpen = open => {
    highlightPalette?.classList.toggle("hidden", !open);
    actionPanel?.classList.toggle("hidden", open);
    highlightToggle?.setAttribute("aria-expanded", String(open));
  };
  const refreshHighlightDots = () => {
    const cs = new Set(getSelectedVersesSorted().map(v => state.highlights?.[`${v.bookName}_${v.chapter}_${v.verse}`] || ""));
    const common = cs.size === 1 ? [...cs][0] : "";
    barDiv.querySelectorAll("[data-color]").forEach(b => {
      const on = b.getAttribute("data-color") === common;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    highlightToggle?.classList.toggle("is-active", Boolean(common));
  };

  // 點外面：只收合色盤；工具列與選取一律保留
  const onDocClick = e => {
    if (barDiv.contains(e.target)) return;
    if (highlightPalette && !highlightPalette.classList.contains("hidden")) setHighlightPaletteOpen(false);
  };
  selectionBottomBarCleanup = () => {
    document.removeEventListener("click", onDocClick);
  };

  barDiv.querySelectorAll("[data-remove-keys]").forEach(chip => {
    chip.addEventListener("click", e => { e.stopPropagation(); removeVersesFromSelection(chip.getAttribute("data-remove-keys")); });
  });
  barDiv.querySelector('[data-action="clear-all"]')?.addEventListener("click", e => { e.stopPropagation(); clearAllVerseSelection(); });
  barDiv.querySelector('[data-action="copy"]')?.addEventListener("click", e => { e.stopPropagation(); copySelectionText(); });
  barDiv.querySelector('[data-action="share"]')?.addEventListener("click", e => { e.stopPropagation(); shareSelectionText(); });
  barDiv.querySelector('[data-action="commentary"]')?.addEventListener("click", e => {
    e.stopPropagation();
    void readerCommentary.openVerses(commentaryVerses);
  });
  highlightToggle?.addEventListener("click", e => {
    e.stopPropagation();
    setHighlightPaletteOpen(highlightPalette?.classList.contains("hidden"));
  });
  barDiv.querySelector('[data-action="close-palette"]')?.addEventListener("click", e => {
    e.stopPropagation(); setHighlightPaletteOpen(false);
  });
  barDiv.querySelectorAll("[data-color]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); applyHighlightToSelection(btn.getAttribute("data-color")); refreshHighlightDots(); });
  });
  barDiv.querySelector("[data-custom-highlight-color]")?.addEventListener("input", e => {
    e.stopPropagation(); applyHighlightToSelection(e.target.value); refreshHighlightDots();
  });
  barDiv.querySelector('[data-action="clear"]')?.addEventListener("click", e => {
    e.stopPropagation(); applyHighlightToSelection(null); refreshHighlightDots();
  });
  barDiv.querySelector('[data-action="note"]')?.addEventListener("click", e => {
    e.stopPropagation();
    if (!single) return;
    const v = sorted[0];
    const hk = `${v.bookName}_${v.chapter}_${v.verse}`;
    const container = document.getElementById("bible-content");
    const verseDiv = (v.bookId === currentReaderBookId() && v.chapter === currentReaderChapter() && container)
      ? container.querySelector(`.bible-verse[data-verse="${v.verse}"]`) : null;
    openVerseNoteEditor({
      bookName: v.bookName, chapter: v.chapter, verse: v.verse,
      verseDiv, highlightKey: hk, verseText: v.text || "",
      referenceLabel: `${v.bookName} ${v.chapter}:${v.verse}`
    });
  });

  selectionBottomBarBindTimer = setTimeout(() => {
    document.addEventListener("click", onDocClick);
    selectionBottomBarBindTimer = null;
  }, 100);
}

// 一節經文的 DOM（沒有事件監聽）。閱讀器本身和翻頁動畫的預覽（#347）共用，兩邊版面才會一模一樣。
// 經文元素與章末連結和 /read 讀經頁共用（js/modules/reader-verse-dom.mjs，#423）。
function buildVerseElement(v, bookName, chapter) {
  return createVerseElement(document, v, { highlightColor: state.highlights[`${bookName}_${chapter}_${v.verse}`] || "" });
}

// 章末換章連結（#347）：「‹ 上一章｜下一章 ›」，跟在經文後面、不浮動。
function buildChapterEndNav(bookId, chapter) {
  return buildSharedChapterEndNav({
    doc: document,
    books: BIBLE_BOOKS,
    bookId,
    chapter,
    copy: (window.APP_COPY && window.APP_COPY.reader) || {},
    hydrateIcons: typeof hydrateIcons === "function" ? hydrateIcons : null
  });
}

// 目前畫面上這一章的經文（點選經文時查文字用）。
let renderedReaderChapter = { bookId: 0, bookName: "", chapter: 0, textByVerse: new Map() };

// 經文點選、章末連結都用容器上的一組監聽（事件委派），不再每節各掛兩個——長章節換章更快。
function bindReaderContentEvents(container) {
  if (!container || container.dataset.readerEventsBound === "true") return;
  container.dataset.readerEventsBound = "true";

  const toggleVerseFromElement = verseDiv => {
    const verse = Number(verseDiv.dataset.verse);
    const { bookId, bookName, chapter, textByVerse } = renderedReaderChapter;
    if (!verse || !textByVerse.has(verse)) return;
    // 點一下 = 切換該節在選取集合裡的有無（跨章保留）。不再有長按 / 兩套模式。
    toggleVerseSelection({ bookId, bookName, chapter, verse, text: textByVerse.get(verse) });
  };

  container.addEventListener("click", event => {
    const navButton = event.target.closest?.("[data-chapter-nav]");
    if (navButton && container.contains(navButton)) {
      event.preventDefault();
      event.stopPropagation();
      flipToReaderChapter(Number(navButton.dataset.chapterNav));
      return;
    }
    const verseDiv = event.target.closest?.(".bible-verse[data-verse]");
    if (!verseDiv || !container.contains(verseDiv)) return;
    event.stopPropagation();
    toggleVerseFromElement(verseDiv);
  });
  container.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const verseDiv = event.target.closest?.(".bible-verse[data-verse]");
    if (!verseDiv || event.target !== verseDiv) return;
    event.preventDefault();
    event.stopPropagation();
    toggleVerseFromElement(verseDiv);
  });
}

function renderVersesList(container, verses, bookName, chapter) {
  bindReaderContentEvents(container);
  container.innerHTML = "";
  const bookId = currentReaderBookId();
  renderedReaderChapter = {
    bookId,
    bookName,
    chapter,
    textByVerse: new Map(verses.map(v => [Number(v.verse), v.text]))
  };
  const fragment = document.createDocumentFragment();
  verses.forEach(v => {
    const verseDiv = buildVerseElement(v, bookName, chapter);
    setVerseNoteBadge(verseDiv, Boolean(state.verseNotes[`${bookName}_${chapter}_${v.verse}`]));
    fragment.appendChild(verseDiv);
  });
  container.appendChild(fragment);

  applySelectionClassesToDom();

  // 章末打卡狀態列（#349）：內容由 updateReaderRecordStatus 依計畫任務決定，沒有任務就隱藏。
  const recordStatus = document.createElement("div");
  recordStatus.id = "reader-record-status";
  recordStatus.className = "reader-record-status";
  recordStatus.setAttribute("role", "status");
  recordStatus.setAttribute("aria-live", "polite");
  recordStatus.hidden = true;
  container.appendChild(recordStatus);

  const sentinel = document.createElement("div");
  sentinel.id = "reader-end-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.style.cssText = "height:1px;width:100%;pointer-events:none;";
  container.appendChild(sentinel);

  container.appendChild(buildChapterEndNav(bookId, chapter));
}

let verseNotesLoadToken = 0;

async function loadVerseNotesForChapter(bookName, chapter) {
  const requestToken = ++verseNotesLoadToken;
  const notes = await db.getVerseNotesForChapter(bookName, chapter);
  if (requestToken !== verseNotesLoadToken) return; // a newer chapter load superseded this request

  state.verseNotes = {};
  Object.keys(notes).forEach(verse => {
    state.verseNotes[`${bookName}_${chapter}_${verse}`] = notes[verse];
  });

  const container = document.getElementById("bible-content");
  if (!container) return;
  container.querySelectorAll(".bible-verse[data-verse]").forEach(verseDiv => {
    const key = `${bookName}_${chapter}_${verseDiv.dataset.verse}`;
    setVerseNoteBadge(verseDiv, Boolean(state.verseNotes[key]));
  });
}

/**
 * 逐節筆記全螢幕編輯框
 */
function closeVerseNoteEditor() {
  const rootElement = document.getElementById("verse-note-editor-root");
  if (rootElement) rootElement.innerHTML = "";
  document.body.classList.remove("verse-note-editor-open");
  // 筆記編輯框關掉後，若選取集合還在 → 把選取工具列叫回來
  if (verseSelection.size > 0) refreshVerseSelectionUI();
}

function openVerseNoteEditor(options) {
  const { bookName, chapter, verse, verseDiv, highlightKey, referenceLabel, verseText } = options;
  const rootElement = document.getElementById("verse-note-editor-root");
  if (!rootElement || !bookName || !chapter || !verse) return;

  const existingContent = state.verseNotes?.[highlightKey] || "";

  rootElement.innerHTML = `
    <div id="verse-note-editor-overlay" class="full-page-overlay verse-note-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="verse-note-editor-title">
      <header class="overlay-header bible-native-overlay-header">
        <button type="button" class="overlay-back-btn" id="verse-note-editor-close" aria-label="返回">
          <span class="nlc-icon nlc-icon--md nav-back-chevron" data-icon="chevronLeft" aria-hidden="true"></span>
          <span>返回</span>
        </button>
        <div class="overlay-title" id="verse-note-editor-title">經文筆記</div>
        <button type="button" class="verse-note-editor-save" id="verse-note-editor-save">儲存</button>
      </header>
      <div class="verse-note-editor-quote">
        <span class="verse-note-editor-reference">${escapeHTML(referenceLabel || "")}</span>
        <p class="verse-note-editor-verse-text">${escapeHTML(verseText || "")}</p>
      </div>
      <textarea id="verse-note-editor-textarea" class="verse-note-editor-textarea" placeholder="寫下你的註解、心得或禱告…">${escapeHTML(existingContent)}</textarea>
      <footer class="verse-note-editor-footer">
        <button type="button" class="reading-team-danger-link verse-note-editor-delete" id="verse-note-editor-delete"${existingContent ? "" : " hidden"}>刪除筆記</button>
      </footer>
    </div>
  `;

  document.body.classList.add("verse-note-editor-open");
  const overlay = document.getElementById("verse-note-editor-overlay");
  if (!overlay) return;
  if (typeof hydrateIcons === "function") hydrateIcons(overlay);

  const textarea = document.getElementById("verse-note-editor-textarea");
  const deleteBtn = document.getElementById("verse-note-editor-delete");

  const applyBadgeState = hasNote => {
    if (verseDiv) setVerseNoteBadge(verseDiv, hasNote);
  };

  document.getElementById("verse-note-editor-close")?.addEventListener("click", closeVerseNoteEditor);

  document.getElementById("verse-note-editor-save")?.addEventListener("click", async () => {
    const saveBtn = document.getElementById("verse-note-editor-save");
    const content = textarea ? textarea.value : "";
    if (saveBtn) saveBtn.disabled = true;
    try {
      const saved = await db.saveVerseNote(bookName, chapter, verse, content);
      if (saved) {
        state.verseNotes[highlightKey] = saved;
      } else {
        delete state.verseNotes[highlightKey];
      }
      applyBadgeState(Boolean(saved));
      showToast(saved ? "筆記已儲存" : "筆記已清空");
      closeVerseNoteEditor();
    } catch (error) {
      console.error("Failed to save verse note:", error);
      showToast("筆記儲存失敗，請稍後再試。");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    try {
      await db.deleteVerseNote(bookName, chapter, verse);
      delete state.verseNotes[highlightKey];
      applyBadgeState(false);
      showToast("筆記已刪除");
      closeVerseNoteEditor();
    } catch (error) {
      console.error("Failed to delete verse note:", error);
      showToast("刪除失敗，請稍後再試。");
      deleteBtn.disabled = false;
    }
  });
}

window.openBibleVersionPicker = function() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal) {
    return window.toggleBibleVersionNext?.();
  }

  const current = state.readerState.version || "CUNP";

  modal.querySelectorAll(".version-option-btn").forEach(btn => {
    const v = btn.getAttribute("data-version");
    btn.classList.toggle("active", v === current);
  });

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
};

window.closeBibleVersionPicker = function() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
};

window.selectBibleVersion = function(newVersion) {
  if (!newVersion) return;
  const current = state.readerState.version || "CUNP";
  window.closeBibleVersionPicker();

  if (current === newVersion) return;

  state.readerState.version = newVersion;
  localStorage.setItem("reader_bible_version", newVersion);

  populateBookSelector(document.getElementById("reader-testament-select")?.value || "all");
  populateChapterSelector();
  renderReaderPicker();
  updatePillLabels();

  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const label = newVersion === "RCUVTS" ? "RCUV" : newVersion;
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
    const inlineVersion = document.getElementById("reader-version-inline");
    if (inlineVersion) inlineVersion.textContent = label;
    const navBadge = document.getElementById("bible-nav-version-badge");
    if (navBadge) navBadge.textContent = label;
  }

  const versionLabels = {
    CUNP: "新標點和合本",
    RCUVTS: "和合本修訂版",
    CUV: "官話和合本",
    OCCB: "當代譯本開放資源（繁體）",
    WEB: "World English Bible",
    ESV: "ESV (English Standard Version)",
    NIV: "NIV (New International Version)",
    NLT: "NLT (New Living Translation)"
  };

  showToast(`已切換譯本至 ${versionLabels[newVersion] || newVersion}`);
  renderReaderText();
};

window.toggleBibleVersionNext = function() {
  const current = state.readerState.version || "CUNP";
  let next = "CUNP";
  if (current === "CUNP") next = "RCUVTS";
  else if (current === "RCUVTS") next = "CUV";
  else if (current === "CUV") next = "OCCB";
  else if (current === "OCCB") next = "ESV";
  else if (current === "ESV") next = "NIV";
  else if (current === "NIV") next = "NLT";
  else if (current === "NLT") next = "WEB";
  else next = "CUNP";
  window.selectBibleVersion(next);
};

window.toggleBibleVersion = function() {
  window.openBibleVersionPicker();
};

// 綁定 Version Picker Modal 內部事件
function setupVersionPickerEvents() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal || modal.dataset.eventsBound === "true") return;
  modal.dataset.eventsBound = "true";

  const closeBtn = document.getElementById("version-picker-close");
  const backdrop = document.getElementById("version-picker-backdrop");
  closeBtn?.addEventListener("click", window.closeBibleVersionPicker);
  backdrop?.addEventListener("click", window.closeBibleVersionPicker);

  modal.querySelectorAll(".version-option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-version");
      if (v) window.selectBibleVersion(v);
    });
  });
}

let isSpeaking = false;
let isReaderAudioPaused = false;
let speechUtterance = null;
let currentSpeakingVerseIndex = -1;
let verseListForSpeaking = [];
let currentAudioSessionId = 0;
let preferredReaderVoice = null;
let pendingReaderVoicePromise = null;

function updateReaderAudioTimeline(verseIndex, totalVerses, status = "speaking", verseNum = null) {
  const timeline = document.getElementById("reader-audio-timeline");
  const label = document.getElementById("reader-audio-progress-label");
  const track = document.getElementById("reader-audio-progress-track");
  const fill = document.getElementById("reader-audio-progress-fill");
  if (!timeline || !label || !track || !fill || totalVerses <= 0) return;
  const safeIndex = Math.min(Math.max(Number(verseIndex) || 0, 0), totalVerses - 1);
  const currentVerse = verseNum ?? verseListForSpeaking[safeIndex]?.verseNum ?? safeIndex + 1;
  const prefix = status === "paused" ? "已暫停・" : status === "completed" ? "已完成・" : "朗讀中・";
  label.textContent = `${prefix}第 ${currentVerse} 節／共 ${totalVerses} 節`;
  track.setAttribute("aria-valuemax", String(totalVerses));
  track.setAttribute("aria-valuenow", String(safeIndex + 1));
  fill.style.width = `${((safeIndex + 1) / totalVerses) * 100}%`;
  timeline.classList.remove("hidden");
}

function hideReaderAudioTimeline() {
  document.getElementById("reader-audio-timeline")?.classList.add("hidden");
}

function setReaderAudioStartMarker(verseNum = 1) {
  clearSpeakingHighlight();
  clearReaderStartSelection();
  const verseEl = document.getElementById(`reader-verse-${verseNum}`);
  if (!verseEl) return;
  verseEl.classList.add("reader-start-selected");
  verseEl.setAttribute("aria-pressed", "true");
  state.readerState.selectedVerseNum = Number(verseNum) || 1;
}

function resetReaderAudioAfterManualChapterChange(showTimeline) {
  setReaderAudioStartMarker(1);
  if (!showTimeline) return;
  const totalVerses = document.querySelectorAll("#bible-content .bible-verse").length;
  if (totalVerses > 0) updateReaderAudioTimeline(0, totalVerses, "paused", 1);
}
function updateReaderAudioButton(speaking) {
  const btn = document.getElementById("reader-audio-btn");
  if (!btn) return;
  const paused = isReaderAudioPaused;
  const label = speaking ? "暫停朗讀" : paused ? "繼續朗讀" : "朗讀經文";
  btn.classList.toggle("active", speaking);
  btn.classList.toggle("paused", paused);
  btn.setAttribute("aria-pressed", speaking ? "true" : "false");
  btn.setAttribute("aria-label", label);
  btn.title = label;
  const icon = btn.querySelector("[data-icon]");
  if (icon) {
    icon.setAttribute("data-icon", speaking ? "pause" : "volumeNotice");
    icon.replaceChildren();
    if (typeof hydrateIcons === "function") hydrateIcons(btn);
  }
}

function clearSpeakingHighlight() {
  document.querySelectorAll(".bible-verse.speaking-highlight").forEach(el => {
    el.classList.remove("speaking-highlight");
  });
}

function stopReaderAudio(quiet = false, options = {}) {
  const wasActive = isSpeaking || Boolean(window.speechSynthesis?.speaking) || Boolean(window.speechSynthesis?.pending);
  const lastVerseIndex = currentSpeakingVerseIndex;
  const lastVerseTotal = verseListForSpeaking.length;
  const lastVerse = verseListForSpeaking[lastVerseIndex]?.verseNum || lastVerseIndex + 1;
  currentAudioSessionId++;
  if (typeof window.speechSynthesis !== "undefined") {
    try { window.speechSynthesis.cancel(); } catch (_e) {}
  }
  isSpeaking = false;
  isReaderAudioPaused = false;
  currentSpeakingVerseIndex = -1;
  verseListForSpeaking = [];
  speechUtterance = null;
  clearSpeakingHighlight();
  if (options.preservePosition && lastVerseIndex >= 0 && lastVerseTotal > 0) {
    const verseEl = document.getElementById(`reader-verse-${lastVerse}`);
    verseEl?.classList.add("speaking-highlight");
    updateReaderAudioTimeline(lastVerseIndex, lastVerseTotal, options.status || "paused", lastVerse);
  } else {
    hideReaderAudioTimeline();
  }
  updateReaderAudioButton(false);
  if (!quiet && wasActive && typeof showToast === "function") showToast("已停止朗讀");
}

function resetReaderAudioState() {
  isSpeaking = false;
  isReaderAudioPaused = false;
  currentSpeakingVerseIndex = -1;
  verseListForSpeaking = [];
  speechUtterance = null;
  clearSpeakingHighlight();
  hideReaderAudioTimeline();
  updateReaderAudioButton(false);
}

window.clearReaderAudioOnPageExit = function () {
  stopReaderAudio(true);
  clearReaderStartSelection();
};

// Not a true speechSynthesis.pause() — that suspends mid-utterance and, on
// resume, ignores any verse the user marks in the meantime (speechSynthesis
// has no way to "resume from a different position"). Instead this fully
// cancels the utterance and just marks the current verse as the start point,
// so the next 朗讀 press below always restarts from that verse's beginning —
// whichever verse ends up marked, including one the user taps while paused.
function pauseReaderAudio() {
  if (!isSpeaking || typeof window.speechSynthesis === "undefined") return false;
  const currentItem = verseListForSpeaking[currentSpeakingVerseIndex];
  currentAudioSessionId++;
  try {
    window.speechSynthesis.cancel();
  } catch (_e) {}

  isSpeaking = false;
  isReaderAudioPaused = true;
  if (currentItem) {
    clearReaderStartSelection();
    const verseEl = document.getElementById(`reader-verse-${currentItem.verseNum}`);
    verseEl?.classList.add("reader-start-selected", "speaking-highlight");
    verseEl?.setAttribute("aria-pressed", "true");
    state.readerState.selectedVerseNum = currentItem.verseNum;
    updateReaderAudioTimeline(currentSpeakingVerseIndex, verseListForSpeaking.length, "paused", currentItem.verseNum);
  }
  updateReaderAudioButton(false);
  if (typeof showToast === "function") showToast("朗讀已暫停，再按一次會從標記的那一節開頭朗讀");
  return true;
}

function getInstalledReaderVoice(targetLang = "zh-TW") {
  if (typeof window.speechSynthesis === "undefined") return Promise.resolve(null);
  const immediate = window.speechSynthesis.getVoices?.() || [];
  preferredReaderVoice = selectPreferredVoice(immediate, targetLang) || preferredReaderVoice;
  if (preferredReaderVoice && preferredReaderVoice.lang?.toLowerCase().startsWith(targetLang.slice(0, 2).toLowerCase())) {
    return Promise.resolve(preferredReaderVoice);
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      preferredReaderVoice = selectPreferredVoice(window.speechSynthesis.getVoices?.() || [], targetLang);
      resolve(preferredReaderVoice);
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 400);
  });
}

function warmReaderVoice(targetLang = "zh-TW") {
  if (typeof window.speechSynthesis === "undefined") return Promise.resolve(null);
  if (pendingReaderVoicePromise) return pendingReaderVoicePromise;
  pendingReaderVoicePromise = getInstalledReaderVoice(targetLang)
    .catch(() => null)
    .finally(() => {
      pendingReaderVoicePromise = null;
    });
  return pendingReaderVoicePromise;
}

function speakNextVerseInQueue(sessionId) {
  if (sessionId !== currentAudioSessionId || !isSpeaking) return;
  if (currentSpeakingVerseIndex < 0 || currentSpeakingVerseIndex >= verseListForSpeaking.length) {
    void continueReaderAudioToNextChapter(sessionId);
    return;
  }
  const currentItem = verseListForSpeaking[currentSpeakingVerseIndex];
  if (!currentItem) {
    stopReaderAudio(true);
    return;
  }

  clearSpeakingHighlight();
  updateReaderAudioTimeline(currentSpeakingVerseIndex, verseListForSpeaking.length, "speaking");
  const verseEl = document.getElementById(`reader-verse-${currentItem.verseNum}`);
  if (verseEl) {
    verseEl.classList.add("speaking-highlight");
    scrollReaderVerseIntoView(verseEl, "smooth");
  }

  const currentVersion = state.readerState?.version || "CUNP";
  const isEnglish = ["ESV", "NIV", "NLT", "WEB"].includes(currentVersion);
  const fallbackLang = isEnglish ? "en-US" : "zh-TW";
  const settings = state.speechSettings || {};

  speechUtterance = new SpeechSynthesisUtterance(currentItem.text);

  const voices = window.speechSynthesis.getVoices?.() || [];
  let voiceToUse = null;

  if (isEnglish) {
    // 💡 英文聖經防護：綁定英文 Voice，但完全響應使用者設定的自訂語速 (settings.rate)！
    if (typeof selectPreferredVoice === "function") {
      voiceToUse = selectPreferredVoice(voices, "en-US");
    }
    speechUtterance.lang = voiceToUse?.lang || "en-US";
    if (voiceToUse) speechUtterance.voice = voiceToUse;
    speechUtterance.rate = getReaderSpeechRate("en-US", settings.rate);
    speechUtterance.pitch = 1.0;
  } else {
    // 中文聖經：正常套用使用者偏好的中文語音與語速設定
    if (settings.voiceURI) {
      const matched = voices.find(v => v.voiceURI === settings.voiceURI || v.name === settings.voiceURI);
      if (matched) voiceToUse = matched;
    }
    if (!voiceToUse && typeof selectPreferredVoice === "function") {
      voiceToUse = selectPreferredVoice(voices, fallbackLang);
    }

    speechUtterance.lang = voiceToUse?.lang || fallbackLang;
    if (voiceToUse) speechUtterance.voice = voiceToUse;

    speechUtterance.rate = getReaderSpeechRate(speechUtterance.lang || fallbackLang, settings.rate);

    speechUtterance.pitch = 1.0;
  }
  speechUtterance.volume = 1;
  speechUtterance.onend = () => {
    if (sessionId !== currentAudioSessionId || !isSpeaking) return;
    currentSpeakingVerseIndex++;
    speakNextVerseInQueue(sessionId);
  };
  speechUtterance.onerror = error => {
    if (sessionId !== currentAudioSessionId || !isSpeaking) return;
    console.warn("[ReaderAudio] Speech synthesis interrupted", error);
    stopReaderAudio(true);
    if (typeof showToast === "function") showToast("朗讀暫時中斷，請再試一次");
  };
  window.speechSynthesis.speak(speechUtterance);
}

async function continueReaderAudioToNextChapter(sessionId) {
  if (sessionId !== currentAudioSessionId || !isSpeaking) return;
  // 朗讀把最後一節唸完＝這章讀完（即使頁面沒捲到底；最後一章沒有下一章也一樣）。
  recordLeavingReaderChapter({ force: true });
  const moved = await navigateToChapter(1, { autoContinue: true });
  if (!moved || sessionId !== currentAudioSessionId || !isSpeaking) {
    if (verseListForSpeaking.length > 0) {
      updateReaderAudioTimeline(verseListForSpeaking.length - 1, verseListForSpeaking.length, "completed");
    }
    stopReaderAudio(true, { preservePosition: true, status: "completed" });
    return;
  }
  const scrollReset = await resetReaderScrollAfterChapterRender(sessionId);
  if (!scrollReset || sessionId !== currentAudioSessionId || !isSpeaking) return;
  const container = document.getElementById("bible-content");
  verseListForSpeaking = Array.from(container?.querySelectorAll(".bible-verse") || []).map(el => ({
    verseNum: Number(el.dataset.verse || 0),
    text: el.querySelector(".verse-text")?.textContent.trim() || ""
  })).filter(item => item.text.length > 0);
  if (verseListForSpeaking.length === 0) {
    stopReaderAudio(true);
    return;
  }
  currentSpeakingVerseIndex = 0;
  speakNextVerseInQueue(sessionId);
}

window.toggleReaderAudio = async function(startVerseNum = null) {
  if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    if (typeof showToast === "function") showToast("您的瀏覽器不支援語音朗讀功能");
    return;
  }
  if (isSpeaking) {
    if (pauseReaderAudio()) return;
    stopReaderAudio(false, { preservePosition: true });
    return;
  }
  // Paused (or genuinely idle): always (re)start fresh from whichever verse
  // is currently marked — state.readerState.selectedVerseNum below — rather
  // than resuming mid-utterance. stopReaderAudio() only cancels playback; it
  // does not clear the verse marker, so a verse tapped while paused sticks.
  if (isReaderAudioPaused || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    stopReaderAudio(true);
  }

  resetReaderAudioState();
  const container = document.getElementById("bible-content");
  if (!container) return;
  verseListForSpeaking = Array.from(container.querySelectorAll(".bible-verse")).map(el => ({
    verseNum: Number(el.dataset.verse || 0),
    text: el.querySelector(".verse-text")?.textContent.trim() || ""
  })).filter(item => item.text.length > 0);
  if (verseListForSpeaking.length === 0) return;

  const selectedVerseNum = startVerseNum ?? state.readerState?.selectedVerseNum ?? null;
  const startIndex = resolveReaderStartIndex(verseListForSpeaking, selectedVerseNum);
  if (startIndex < 0) return;

  currentAudioSessionId++;
  const sessionId = currentAudioSessionId;
  isSpeaking = true;
  currentSpeakingVerseIndex = startIndex;
  updateReaderAudioButton(true);
  const currentVersion = state.readerState?.version || "CUNP";
  const isEnglish = ["ESV", "NIV", "NLT", "WEB"].includes(currentVersion);
  const targetLang = isEnglish ? "en-US" : "zh-TW";
  const immediateVoices = window.speechSynthesis.getVoices?.() || [];
  preferredReaderVoice = selectPreferredVoice(immediateVoices, targetLang) || preferredReaderVoice;
  warmReaderVoice(targetLang).then(voice => {
    if (voice && sessionId === currentAudioSessionId && isSpeaking) preferredReaderVoice = voice;
  });

  const startVerse = verseListForSpeaking[startIndex];
  console.info("[ReaderAudio] Playback started", {
    verse: startVerse?.verseNum || 1,
    voice: preferredReaderVoice?.name || "browser default",
    lang: preferredReaderVoice?.lang || "zh-TW"
  });
  if (typeof showToast === "function") showToast(`從第 ${startVerse?.verseNum || 1} 節開始朗讀`);
  speakNextVerseInQueue(sessionId);
};
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 聖經目錄：和 /read 讀經頁共用 js/modules/bible-nav-directory.mjs（#423）──
let bibleNavDirectory = null;

function getBibleNavDirectory() {
  if (bibleNavDirectory) return bibleNavDirectory;
  bibleNavDirectory = createBibleNavDirectory({
    doc: document,
    books: BIBLE_BOOKS,
    getVerseCounts: () => (typeof BIBLE_VERSE_COUNTS !== "undefined" ? BIBLE_VERSE_COUNTS : null),
    getVersion: () => state.readerState?.version,
    getPosition: () => ({ bookId: state.readerState.bookId, chapter: state.readerState.chapter }),
    onSelect: goToReaderVerse,
    openLayer: openReaderLayer,
    closeLayer: closeReaderLayer,
    // .reader-version-btn (the top navbar's own version pill) is hidden on
    // narrow phones (@media max-width:420px) for space — the badge inside the
    // directory overlay is the mobile replacement entry point into the version
    // picker, so it must open the same modal rather than sit dead/unbound.
    onVersionBadge: () => {
      if (typeof window.openBibleVersionPicker === "function") window.openBibleVersionPicker();
    },
    hydrateIcons: typeof hydrateIcons === "function" ? hydrateIcons : null
  });
  return bibleNavDirectory;
}

window.openBibleNavOverlay = function() {
  getBibleNavDirectory().open();
};

window.switchNavTab = function(tabName) {
  getBibleNavDirectory().switchTab(tabName);
};

// 跳到某一章（某一節）：目錄選好、輸入出處、搜尋結果都走這裡。
// verse 為 null 時只換章（renderReaderText 會捲回章首）；highlightVerses 為要一起閃底色的節（#362 範圍／頓號）。
async function goToReaderVerse({ bookId, chapter, verse = null, highlightVerses = null }) {
  state.readerState.bookId = bookId;
  state.readerState.chapter = chapter;

  const bookSelect = document.getElementById("reader-book-select");
  if (bookSelect) {
    bookSelect.value = String(bookId);
    populateChapterSelector();
  }
  const chapterSelect = document.getElementById("reader-chapter-select");
  if (chapterSelect) {
    chapterSelect.value = String(chapter);
  }

  saveReaderPreferences();
  updatePillLabels();

  try {
    await renderReaderText();
    revealVerses(document.getElementById("bible-content"), verse, highlightVerses);
  } catch (err) {
    console.error(err);
  }
}

// ── 輸入出處直接跳轉（#362）：搜尋框提示與目錄篩選共用同一個解析器 ──
function parseReaderReference(query) {
  return parseReaderReferenceQuery(query, {
    books: BIBLE_BOOKS,
    verseCounts: typeof BIBLE_VERSE_COUNTS !== "undefined" ? BIBLE_VERSE_COUNTS : null,
    english: usesEnglishReaderLabels()
  });
}

window.__BIBLE_SEARCH_CORPUS = window.__BIBLE_SEARCH_CORPUS || null;

window.setBibleSearchCorpus = function(corpus) {
  window.__BIBLE_SEARCH_CORPUS = Array.isArray(corpus) ? corpus : null;
};

function searchLocalBibleCorpus(query) {
  const corpus = window.__BIBLE_SEARCH_CORPUS;
  if (!Array.isArray(corpus) || !query) return null;
  return rankBibleSearchResults(corpus, query, { includeFuzzy: true, limit: 120 })
    .map(item => ({
      bookName: item.bookName || item.book || "",
      bookEng: item.bookEng || "",
      chapter: Number(item.chapter || 1),
      verse: Number(item.verse || 1),
      text: String(item.text || "")
    }));
}

const BIBLE_SEARCH_RESULT_LIMIT = 120;

function withTotalCount(results, totalCount) {
  results.totalCount = totalCount;
  return results;
}

async function fetchBollsSearch(query, translation) {
  const url = `https://bolls.life/search/${encodeURIComponent(translation)}/?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search request failed");
  const data = await res.json();
  const mapped = data.map(item => {
    const book = BIBLE_BOOKS.find(b => b.id === item.book);
    return {
      book: item.book,
      bookName: book ? book.name : String(item.book),
      bookEng: book ? book.eng : "",
      chapter: item.chapter,
      verse: item.verse,
      text: item.text
    };
  });
  // bolls.life 是模糊比對、固定回傳上千筆；總筆數要算真正符合的，不然只有 14 筆也會顯示「結果太多」。
  const matches = rankBibleSearchResults(mapped, query, { includeFuzzy: true, limit: Math.max(mapped.length, 1) });
  return withTotalCount(matches.slice(0, BIBLE_SEARCH_RESULT_LIMIT), matches.length);
}

function mergeSearchResults(resultLists) {
  const seen = new Set();
  const merged = [];
  for (const list of resultLists) {
    for (const item of list) {
      const key = `${item.book}_${item.chapter}_${item.verse}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

// #378：新標點和合本、和合本、修訂版一律由信望愛搜尋（不分字數）。查詢會依版本統一「裏／裡」「毗／毘」，
// 新標點和合本另外連舊譯名一起搜（尼哥德慕 → 尼哥底母），結果合併去重。
async function fetchFhlSearch(query, translation) {
  const { fhlVersion, queries } = getFhlSearchQueries(query, translation);
  const responses = await Promise.all(queries.map(async fhlQuery => {
    const res = await fetch(buildFhlSearchUrl(fhlQuery, fhlVersion));
    if (!res.ok) throw new Error("Search request failed");
    const { records, totalCount } = readFhlSearchPayload(await res.json());
    const mapped = mapFhlSearchRecords(records, BIBLE_BOOKS);
    // 信望愛已經是精確比對，這裡只排序，不再做模糊比對。
    return { totalCount, ranked: rankBibleSearchResults(mapped, fhlQuery, { includeFuzzy: false, limit: FHL_SEARCH_LIMIT }) };
  }));
  const merged = mergeSearchResults(responses.map(response => response.ranked));
  const results = merged.slice(0, BIBLE_SEARCH_RESULT_LIMIT);
  results.highlightTerms = queries;
  return withTotalCount(results, Math.max(merged.length, ...responses.map(response => response.totalCount)));
}

// #378：當代譯本 bolls.life 沒有，改在本機搜已下載的「離線聖經」資料；沒下載就請會友先去下載。
const offlineSearchCorpusCache = new Map();

async function loadOfflineSearchCorpus(translation) {
  const repository = window.offlineBibleRepository;
  const pack = repository && typeof repository.getInstalledPack === "function"
    ? await repository.getInstalledPack(translation)
    : null;
  if (!pack) throw createBibleSearchError(BIBLE_SEARCH_ERROR.OFFLINE_PACK_REQUIRED);
  const cacheKey = `${translation}:${pack.downloadedAt || ""}`;
  if (!offlineSearchCorpusCache.has(cacheKey)) {
    const rows = await repository.getAllChapters(translation);
    const corpus = buildOfflineSearchCorpus(rows, BIBLE_BOOKS);
    if (!corpus.length) throw createBibleSearchError(BIBLE_SEARCH_ERROR.OFFLINE_PACK_REQUIRED);
    offlineSearchCorpusCache.clear();
    offlineSearchCorpusCache.set(cacheKey, corpus);
  }
  return offlineSearchCorpusCache.get(cacheKey);
}

async function searchOfflinePack(query, translation) {
  const corpus = await loadOfflineSearchCorpus(translation);
  const matches = rankBibleSearchResults(corpus, query, { includeFuzzy: false, limit: corpus.length });
  return withTotalCount(matches.slice(0, BIBLE_SEARCH_RESULT_LIMIT), matches.length);
}

window.searchBibleText = async function(query, translation = "CUNP") {
  const trimmed = String(query ?? "").trim();
  const localResults = searchLocalBibleCorpus(trimmed);
  if (localResults) return localResults;

  const plan = getBibleSearchPlan(translation);
  if (plan.source === "offline") return searchOfflinePack(trimmed, plan.version);
  if (plan.source === "bolls" && isShortBibleQuery(trimmed)) {
    throw createBibleSearchError(BIBLE_SEARCH_ERROR.QUERY_TOO_SHORT);
  }

  window.__BIBLE_SEARCH_REQUEST_CACHE = window.__BIBLE_SEARCH_REQUEST_CACHE || new Map();
  const source = plan.source === "fhl" ? `fhl-${plan.fhlVersion}` : "bolls";
  const cacheKey = `${source}:${plan.version}:${trimmed.toLocaleLowerCase()}`;
  if (window.__BIBLE_SEARCH_REQUEST_CACHE.has(cacheKey)) {
    return window.__BIBLE_SEARCH_REQUEST_CACHE.get(cacheKey);
  }

  const request = (plan.source === "fhl" ? fetchFhlSearch(trimmed, plan.version) : fetchBollsSearch(trimmed, plan.version))
    .catch(error => {
      window.__BIBLE_SEARCH_REQUEST_CACHE.delete(cacheKey);
      throw error;
    });
  window.__BIBLE_SEARCH_REQUEST_CACHE.set(cacheKey, request);
  return request;
};

export function updateReaderBottomActionBar() {
  const bar = document.getElementById("reader-bottom-action-bar");
  if (!bar) return;
  bar.style.display = "none";
  bar.classList.add("hidden");
}

// 背景預載下一章與上一章，往左或往右滑都能馬上出現（#314）。
// 預抓的章數和方向照共用規則（#440，同 /read）。fetchBibleChapter 自己會查記憶體快取、
// 合併同章請求、先讀離線經文包，並把結果寫進翻頁預覽用的 window._bibleChapterCache。
function triggerPredictivePrefetch() {
  const requestedVersion = String(state.readerState?.version || "CUNP").toUpperCase();
  resolvePrefetchChapters(BIBLE_BOOKS, state.readerState.bookId, state.readerState.chapter).forEach(target => {
    fetchBibleChapter(target.book.eng, target.chapter, requestedVersion).catch(err => {
      console.warn(`⚠️ [背景預載失敗] ${requestedVersion} ${target.book.eng} ${target.chapter}`, err);
    });
  });
}

function checkReaderBottomDwell(surface = getReaderScrollSurface(), isAtBottom = null) {
  if (!readerBottomDwellController || !surface) return;
  const taskContext = resolveReaderAutoRecordTask();
  readerBottomDwellController.check(surface, {
    eligible: Boolean(
      taskContext &&
      window.appRouter && window.appRouter.currentTab === "reader-view" &&
      getReaderTaskDecision(taskContext).ok &&
      !state.readerState.autoMarked &&
      !state.readerState.autoMarkInFlight
    ),
    targetKey: getReaderTaskTargetKey(taskContext),
    isAtBottom
  });
}

function bindReaderEndObserver() {
  readerEndObserver?.disconnect();
  readerEndObserver = null;
  readerEndVisible = false;
  const root = getReaderScrollSurface();
  const sentinel = document.getElementById("reader-end-sentinel");
  if (!root || !sentinel) return;
  readerEndObserver = observeReaderEndSentinel({
    root,
    sentinel,
    onChange: isVisible => {
      readerEndVisible = isVisible;
      if (isVisible) {
        const targetKey = getCurrentPlanReaderTargetKey();
        if (targetKey) reachedEndTargetKey = targetKey;
        const noticeKey = targetKey || `missing|${state.readerState?.bookId}|${state.readerState?.chapter}`;
        if (state.readerState?.fromPlan && readerAutoReadNoticeKey !== noticeKey) {
          readerAutoReadNoticeKey = noticeKey;
          console.info("[AutoRead] Reader bottom detected", {
            targetKey: targetKey || null,
            planContextId: state.readerState?.planContextId || null,
            bookId: state.readerState?.bookId || null,
            chapter: state.readerState?.chapter || null
          });
        }
        checkReaderBottomDwell(root, () => readerEndVisible);
      } else readerBottomDwellController?.cancel();
    }
  });
}
function scheduleReaderBottomDwellCheck() {
  requestAnimationFrame(() => requestAnimationFrame(() => checkReaderBottomDwell()));
}

function handleReaderScroll(event) {
  const bar = document.getElementById("reader-bottom-action-bar");
  if (bar) {
    bar.style.display = "none";
    bar.classList.add("hidden");
  }

  checkReaderBottomDwell(getReaderScrollSurface() || event.currentTarget || event.target);
}

// showPlanNavigationPrompt removed 2026-09-16: zero callers anywhere in
// js/ — the "finished today, catch up or read ahead?" modal it built
// (#plan-nav-prompt-overlay) was never wired to any real completion event.
export function init() {
  initReaderControls();
}

window.renderReaderText = renderReaderText;
window.closeReaderCommentarySheet = () => readerCommentary.close();
window.saveReaderPreferences = saveReaderPreferences;
window.populateBookSelector = populateBookSelector;
window.populateChapterSelector = populateChapterSelector;
window.updatePillLabels = updatePillLabels;
window.updateReaderFontSize = updateReaderFontSize;
window.navigateToChapter = navigateToChapter;
window.initReaderControls = init;
