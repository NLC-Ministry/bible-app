// @vitest-environment jsdom
// #471 經文注釋審核流程：依書卷指派審核者、審核者通過／退回、維護者最終發布、App 內通知。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  commentaryReviewErrorMessage,
  commentaryReviewNotificationMessage,
  commentaryReviewNotificationTarget,
  filterReviewItems,
  isInReview,
  toBellNotification
} from "../js/data/commentary-review.mjs";
import { createCommentaryReviewPage, reviewCardHtml } from "../js/modules/commentary-review.mjs";
import { createAdminCommentaryReview, reviewProgressText, searchMembers } from "../js/modules/admin-commentary-review.mjs";
import { commentaryItemStatus, renderAdminCommentary } from "../js/modules/admin-commentary.mjs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const escapeHTML = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = readLegacyIndexHtml();
const $ = id => document.getElementById(id);

const ITEMS = [
  { id: "a", book: "利未記", chapter: 1, verse_start: 1, verse_end: 2, title: "", content: "燔祭", source_text: "Burnt offering", review_status: "pending" },
  { id: "b", book: "利未記", chapter: 1, verse_start: 3, verse_end: 3, title: "", content: "第三節", review_status: "returned", review_note: "用字<改>", reviewed_by_name: "審核者乙" },
  { id: "c", book: "利未記", chapter: 2, verse_start: 1, verse_end: 1, title: "", content: "素祭", review_status: "approved" },
  { id: "d", book: "民數記", chapter: 1, verse_start: 1, verse_end: 1, title: "", content: "數點", review_status: "pending" }
];

describe("review helpers (#471)", () => {
  it("groups the queue by book and status", () => {
    const { counts, items } = filterReviewItems(ITEMS, { book: "利未記", status: "pending" });
    expect(counts).toEqual({ pending: 1, returned: 1, approved: 1 });
    expect(items.map(item => item.id)).toEqual(["a"]);
    expect(isInReview({ review_status: "published" })).toBe(false);
    expect(isInReview({ review_status: "returned" })).toBe(true);
  });

  it("writes notification text and sends reviewers and admins to different places", () => {
    expect(commentaryReviewNotificationMessage({ kind: "assigned", book: "利未記", item_count: 120 })).toBe("你被指派審核《利未記》的經文注釋，目前有 120 則待審。");
    expect(commentaryReviewNotificationMessage({ kind: "pending", book: "利未記", item_count: 3 })).toBe("《利未記》有 3 則經文注釋等你審核。");
    expect(commentaryReviewNotificationMessage({ kind: "approved", book: "利未記", item_count: 2 })).toContain("等你最終發布");
    expect(commentaryReviewNotificationTarget("pending")).toBe("review");
    expect(commentaryReviewNotificationTarget("assigned")).toBe("review");
    expect(commentaryReviewNotificationTarget("approved")).toBe("admin");
    expect(commentaryReviewNotificationTarget("returned")).toBe("admin");
    const bell = toBellNotification({ id: "n", kind: "returned", book: "利未記", item_count: 1, updated_at: "2026-10-09T02:00:00Z", read_at: null });
    expect(bell).toMatchObject({ id: "n", type: "commentary-review", status: "unread", kind: "returned" });
    expect(toBellNotification({ id: "n", kind: "pending", read_at: "2026-10-09T03:00:00Z" }).status).toBe("read");
  });

  it("maps server error codes to plain Chinese", () => {
    expect(commentaryReviewErrorMessage({ message: "commentary_review_forbidden" })).toBe("你沒有被指派審核這一卷。");
    expect(commentaryReviewErrorMessage(new Error("boom"))).toBe("操作失敗，請稍後再試。");
  });
});

function mountProfileReview() {
  const start = html.indexOf('<div id="profile-tab-content-commentary-review"');
  const end = html.indexOf('<div id="profile-tab-content-preferences"', start);
  const entryStart = html.indexOf("<!-- 我的審核（#471）");
  const entryEnd = html.indexOf("</button>", entryStart) + "</button>".length;
  document.body.innerHTML = html.slice(entryStart, entryEnd) + html.slice(start, end);
}

function reviewerDb(overrides = {}) {
  return {
    fetchMyCommentaryReviews: vi.fn(async () => ({ success: true, isAdmin: false, books: ["利未記", "民數記"], items: ITEMS.map(item => ({ ...item })) })),
    reviewCommentary: vi.fn(async ({ id, decision, content, note }) => ({
      success: true,
      data: { id, content, review_status: decision === "approve" ? "approved" : "returned", review_note: decision === "approve" ? "" : note }
    })),
    ...overrides
  };
}

describe("我的審核 page (#471)", () => {
  it("shows the profile entry only to assigned reviewers or admins", async () => {
    mountProfileReview();
    const entry = $("profile-commentary-review-entry");
    expect(entry.classList.contains("hidden")).toBe(true);
    const page = createCommentaryReviewPage({ db: reviewerDb(), escapeHTML, showToast: vi.fn() });
    expect(await page.refreshEntry()).toBe(true);
    expect(entry.classList.contains("hidden")).toBe(false);

    const none = createCommentaryReviewPage({
      db: reviewerDb({ fetchMyCommentaryReviews: vi.fn(async () => ({ success: true, isAdmin: false, books: [], items: [] })) }),
      escapeHTML, showToast: vi.fn()
    });
    expect(await none.refreshEntry()).toBe(false);
    expect(entry.classList.contains("hidden")).toBe(true);
  });

  it("lists the first book's pending items with counts, and switches book and status", async () => {
    mountProfileReview();
    const page = createCommentaryReviewPage({ db: reviewerDb(), escapeHTML, showToast: vi.fn() });
    page.bind();
    await page.refresh();
    expect([...$("profile-commentary-review-tabs").querySelectorAll("button")].map(button => button.textContent)).toEqual(["待審 1", "退回 1", "通過待發布 1"]);
    expect([...document.querySelectorAll("[data-review-id]")].map(card => card.dataset.reviewId)).toEqual(["a"]);
    expect(document.querySelector("[data-review-id='a'] details").textContent).toContain("Burnt offering");

    $("profile-commentary-review-tabs").querySelector('[data-review-status="returned"]').click();
    expect(document.querySelector(".commentary-review-card__note").innerHTML).toContain("用字&lt;改&gt;");

    $("profile-commentary-review-book").value = "民數記";
    $("profile-commentary-review-book").dispatchEvent(new Event("change"));
    $("profile-commentary-review-tabs").querySelector('[data-review-status="pending"]').click();
    expect([...document.querySelectorAll("[data-review-id]")].map(card => card.dataset.reviewId)).toEqual(["d"]);
  });

  it("approves with the reviewer's edited translation and moves the card out of 待審", async () => {
    mountProfileReview();
    const db = reviewerDb();
    const showToast = vi.fn();
    const page = createCommentaryReviewPage({ db, escapeHTML, showToast });
    page.bind();
    await page.refresh();
    document.querySelector("[data-review-id='a'] [data-review-content]").value = "燔祭（修訂）";
    document.querySelector("[data-review-id='a'] [data-review-approve]").click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("已通過，等系統管理員最終發布。"));
    expect(db.reviewCommentary).toHaveBeenCalledWith(expect.objectContaining({ id: "a", decision: "approve", content: "燔祭（修訂）" }));
    expect(document.querySelectorAll("[data-review-id]")).toHaveLength(0);
    expect($("profile-commentary-review-tabs").textContent).toContain("通過待發布 2");
  });

  it("asks for a note before returning, keeping the edits made so far", async () => {
    mountProfileReview();
    const db = reviewerDb();
    const showToast = vi.fn();
    const page = createCommentaryReviewPage({ db, escapeHTML, showToast });
    page.bind();
    await page.refresh();
    document.querySelector("[data-review-id='a'] [data-review-content]").value = "改到一半";
    document.querySelector("[data-review-id='a'] [data-review-return]").click();
    expect(document.querySelector("[data-review-id='a'] [data-review-content]").value).toBe("改到一半");

    document.querySelector("[data-review-confirm-return]").click();
    expect(showToast).toHaveBeenCalledWith("退回時請寫下審核意見。");
    expect(db.reviewCommentary).not.toHaveBeenCalled();

    document.querySelector("[data-review-note]").value = "「肘」要用和合本用字";
    document.querySelector("[data-review-confirm-return]").click();
    await vi.waitFor(() => expect(db.reviewCommentary).toHaveBeenCalledWith(expect.objectContaining({ decision: "return", note: "「肘」要用和合本用字", content: "改到一半" })));
  });

  it("escapes everything that comes from the database", () => {
    const card = reviewCardHtml({ id: 'x"', book: "利未記", chapter: 1, verse_start: 1, verse_end: 1, title: '"><b>', content: "</textarea><b>", source_text: "<i>", review_status: "pending" }, escapeHTML);
    expect(card).not.toContain("<b>");
    expect(card).not.toContain("<i>");
  });
});

function mountAdmin() {
  const start = html.indexOf('<div id="admin-section-commentary"');
  const end = html.indexOf("<!-- 首頁「雲柱測驗」後台", start);
  document.body.innerHTML = html.slice(start, end);
}

const BOOKS = [{ name: "利未記", eng: "Leviticus", chapters: 27 }, { name: "民數記", eng: "Numbers", chapters: 36 }];
const MEMBERS = [
  { id: "m1", name: "王小明", pastoral_zone: "第一牧區" },
  { id: "m2", name: "李大華", pastoral_zone: "第二牧區" },
  { id: "m3", name: "王美麗", pastoral_zone: "第二牧區" }
];

describe("admin review progress (#471)", () => {
  it("summarises counts and finds members by name or zone", () => {
    expect(reviewProgressText({ pending: 3, returned: 1, approved: 2, published: 10 })).toBe("待審 3・退回 1・通過待發布 2・已發布 10");
    expect(searchMembers(MEMBERS, "王").map(member => member.id)).toEqual(["m1", "m3"]);
    expect(searchMembers(MEMBERS, "第二", ["m2"]).map(member => member.id)).toEqual(["m3"]);
    expect(searchMembers(MEMBERS, "  ")).toEqual([]);
  });

  function adminReviewDb(overrides = {}) {
    return {
      fetchCommentaryReviewOverview: vi.fn(async () => ({ success: true, books: [
        { book: "利未記", pending: 3, returned: 1, approved: 2, published: 0, reviewers: [{ id: "m1", name: "王小明", pastoral_zone: "第一牧區" }] }
      ] })),
      fetchManagedScopeProfiles: vi.fn(async () => ({ data: MEMBERS, error: null })),
      setCommentaryReviewers: vi.fn(async (book, ids) => ({ success: true, books: [{ book, pending: 3, returned: 1, approved: 2, published: 0, reviewers: ids.map(id => MEMBERS.find(m => m.id === id)) }] })),
      publishApprovedCommentary: vi.fn(async () => ({ success: true, published: 2 })),
      ...overrides
    };
  }

  it("assigns reviewers by searching members, and publishes a book's approved notes after confirming", async () => {
    mountAdmin();
    const db = adminReviewDb();
    const confirm = vi.fn(async () => true);
    const onChanged = vi.fn();
    const review = createAdminCommentaryReview({ db, books: BOOKS, escapeHTML, showToast: vi.fn(), confirm, onChanged });
    review.bind();
    await review.reload();
    const root = $("admin-commentary-review");
    expect(root.textContent).toContain("待審 3・退回 1・通過待發布 2・已發布 0");
    expect(root.textContent).toContain("審核者：王小明");

    root.querySelector("[data-review-assign]").click();
    await vi.waitFor(() => expect(db.fetchManagedScopeProfiles).toHaveBeenCalled());
    const search = root.querySelector("[data-assign-search]");
    search.value = "第二";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...root.querySelectorAll("[data-assign-add]")].map(button => button.dataset.assignAdd)).toEqual(["m2", "m3"]);
    root.querySelector('[data-assign-add="m2"]').click();
    root.querySelector('[data-assign-remove="m1"]').click();
    root.querySelector("[data-assign-save]").click();
    await vi.waitFor(() => expect(db.setCommentaryReviewers).toHaveBeenCalledWith("利未記", ["m2"]));
    await vi.waitFor(() => expect(root.textContent).toContain("審核者：李大華"));

    root.querySelector("[data-review-publish]").click();
    await vi.waitFor(() => expect(db.publishApprovedCommentary).toHaveBeenCalledWith({ book: "利未記" }));
    expect(confirm.mock.calls[0][0].title).toBe("發布《利未記》已通過的 2 則注釋？");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("can assign reviewers to a book that has no imported notes yet", async () => {
    mountAdmin();
    const db = adminReviewDb({ fetchCommentaryReviewOverview: vi.fn(async () => ({ success: true, books: [] })) });
    const review = createAdminCommentaryReview({ db, books: BOOKS, escapeHTML, showToast: vi.fn(), confirm: vi.fn() });
    review.bind();
    await review.reload();
    const root = $("admin-commentary-review");
    root.querySelector("[data-review-add-book]").value = "民數記";
    root.querySelector("[data-review-add]").click();
    await vi.waitFor(() => expect(root.querySelector('[data-review-book="民數記"] [data-assign-search]')).not.toBeNull());
  });
});

describe("admin list shows the review state (#471)", () => {
  function listDb(overrides = {}) {
    return {
      fetchAllPassageCommentaryForAdmin: vi.fn(async () => [
        { id: "p", book: "利未記", chapter: 1, verse_start: 1, verse_end: 2, content: "待審內容", review_status: "pending", is_published: false },
        { id: "r", book: "利未記", chapter: 1, verse_start: 3, verse_end: 3, content: "退回內容", review_status: "returned", review_note: "請改用字", is_published: false },
        { id: "a", book: "利未記", chapter: 2, verse_start: 1, verse_end: 1, content: "通過內容", review_status: "approved", is_published: false },
        { id: "h", book: "利未記", chapter: 3, content: "手寫整章", review_status: null, is_published: true }
      ]),
      fetchAllCommentaryTermsForAdmin: vi.fn(async () => []),
      savePassageCommentary: vi.fn(async () => true),
      saveCommentaryTerm: vi.fn(async () => true),
      deletePassageCommentary: vi.fn(async () => true),
      deleteCommentaryTerm: vi.fn(async () => true),
      resubmitCommentary: vi.fn(async () => ({ success: true })),
      publishApprovedCommentary: vi.fn(async () => ({ success: true, published: 1 })),
      fetchCommentaryReviewOverview: vi.fn(async () => ({ success: true, books: [] })),
      ...overrides
    };
  }

  it("badges review items, shows the return note, filters by status and publishes one approved note", async () => {
    mountAdmin();
    const db = listDb();
    expect(await renderAdminCommentary({ db, books: BOOKS, escapeHTML, showToast: vi.fn(), confirm: vi.fn(async () => true) })).toBe(true);
    const list = $("admin-commentary-list");
    expect(list.querySelector('[data-admin-commentary-id="r"]').textContent).toContain("退回意見：請改用字");
    expect(list.querySelector('[data-admin-commentary-id="p"]').textContent).toContain("待審");
    expect(list.querySelectorAll("[data-commentary-publish]")).toHaveLength(1);

    $("admin-commentary-status-filter").value = "returned";
    $("admin-commentary-status-filter").onchange();
    expect([...list.querySelectorAll("[data-admin-commentary-id]")].map(card => card.dataset.adminCommentaryId)).toEqual(["r"]);
    $("admin-commentary-status-filter").value = "";
    $("admin-commentary-status-filter").onchange();

    list.querySelector('[data-admin-commentary-id="a"] [data-commentary-publish]').click();
    await vi.waitFor(() => expect(db.publishApprovedCommentary).toHaveBeenCalledWith({ ids: ["a"] }));
    expect(commentaryItemStatus({ kind: "note", row: { review_status: "published", is_published: false } })).toBe("draft");
  });

  it("editing a returned note hides 發布, saves without touching publication, then resubmits", async () => {
    mountAdmin();
    const db = listDb();
    await renderAdminCommentary({ db, books: BOOKS, escapeHTML, showToast: vi.fn(), confirm: vi.fn() });
    $("admin-commentary-list").querySelector('[data-admin-commentary-id="r"] [data-commentary-edit]').click();
    expect($("admin-commentary-publish-field").classList.contains("hidden")).toBe(true);
    expect($("admin-commentary-review-hint").textContent).toContain("請改用字");
    expect($("admin-commentary-save").textContent).toBe("儲存並重新送審");
    $("admin-commentary-content").value = "改好了";
    await $("admin-commentary-save").onclick();
    expect(db.savePassageCommentary).toHaveBeenCalledWith(expect.objectContaining({ id: "r", content: "改好了", isPublished: null }));
    expect(db.resubmitCommentary).toHaveBeenCalledWith({ id: "r" });

    // 一般（不在審核流程）的注釋照舊用發布勾選
    $("admin-commentary-list").querySelector('[data-admin-commentary-id="h"] [data-commentary-edit]').click();
    expect($("admin-commentary-publish-field").classList.contains("hidden")).toBe(false);
    expect($("admin-commentary-save").textContent).toBe("儲存");
  });
});

describe("review wiring (#471)", () => {
  const migration = read("supabase/migrations/20261009092820_commentary_review.sql");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const app = read("js/app.js");
  const profile = read("js/modules/profile.js");

  it("every new function revokes PUBLIC/anon/authenticated and grants explicitly", () => {
    const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(match => match[1]);
    expect(functions.length).toBeGreaterThanOrEqual(13);
    for (const name of functions) {
      expect(migration, name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(migration, name).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO`));
    }
    // 內部輔助只給 service_role
    for (const name of ["_commentary_actor_is_admin", "_commentary_actor_can_review", "_notify_commentary_review", "_passage_commentary_review_notify"]) {
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
    }
  });

  it("keeps review content unpublished and the new tables closed to clients", () => {
    expect(migration).toContain("CHECK (review_status IS NULL OR review_status = 'published' OR is_published = FALSE)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.commentary_reviewers FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("REVOKE ALL ON TABLE public.commentary_review_notifications FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_source_ref_key");
    expect(migration).toMatch(/IF NOT public\._commentary_actor_can_review\(actor_id, c\.book\) THEN\s+RAISE EXCEPTION 'commentary_review_forbidden';/);
  });

  it("lets nlc-data call the review RPCs with an injected p_actor_id", () => {
    const set = edge.match(/const COMMENTARY_REVIEW_RPC_FUNCTIONS = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const name of ["get_my_commentary_reviews", "review_commentary", "get_commentary_review_overview", "set_commentary_reviewers",
      "resubmit_commentary", "publish_approved_commentary", "get_commentary_review_notifications", "mark_commentary_review_notifications_read"]) {
      expect(set).toContain(`"${name}"`);
      expect(migration).toContain(`FUNCTION public.${name}(`);
    }
    expect(edge).toContain("...COMMENTARY_REVIEW_RPC_FUNCTIONS,");
    expect(edge).toContain("|| COMMENTARY_REVIEW_RPC_FUNCTIONS.has(functionName)");
  });

  it("merges review notifications into the bell and wires the profile page", () => {
    expect(app.match(/db\.fetchCommentaryReviewNotifications\(\)/g)).toHaveLength(2);
    expect(app).toContain("db.acknowledgeCommentaryReviewNotification(item.id)");
    expect(app).toContain('window.location.hash = "#/profile/commentary-review";');
    expect(profile).toContain('if (key === "commentary-review") void commentaryReviewPage.refresh();');
    expect(html).toContain('id="profile-commentary-review-entry" data-profile-open="commentary-review"');
  });
});
