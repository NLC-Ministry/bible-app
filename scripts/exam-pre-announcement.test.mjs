import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0200_exam_pre_announcement.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const edge = read("supabase/functions/nlc-data/index.ts");

// 預告＝開考前的簡短通知（標題/內容，沒有入口按鈕），跟公告（測驗活動期間的
// 入口文字，必填）是兩個獨立欄位，都只能在測試版編輯、靠「同步到正式版」帶
// 過去。沒有新資料表，只在 exam_papers 加兩個欄位；顯示邏輯是「公告已發佈就
// 蓋過預告」的即時判斷，不是另一組發佈/撤下狀態機。

describe("0200: 新增欄位，不建新資料表", () => {
  it("exam_papers 加 pre_announcement JSONB + pre_announcement_enabled BOOLEAN", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS pre_announcement JSONB NOT NULL");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS pre_announcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;");
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});

describe("0200: exam_save_pre_announcement 一次存內容+開關，沒有獨立發佈/撤下 RPC", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_save_pre_announcement"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.exam_save_pre_announcement"));

  it("只有 admin/pastor，且跟公告一樣 status<>'closed' 才能存", () => {
    expect(fn).toContain("IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN");
    expect(fn).toContain("WHERE id = p_paper_id AND status <> 'closed'");
  });

  it("內容跟開關存在同一次 UPDATE 裡", () => {
    expect(fn).toContain("pre_announcement = jsonb_build_object(");
    expect(fn).toContain("pre_announcement_enabled = COALESCE(p_enabled, FALSE)");
  });

  it("REVOKE ALL FROM PUBLIC + 明確 GRANT，符合新函式的必要規矩", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.exam_save_pre_announcement(UUID, JSONB, BOOLEAN, UUID) FROM PUBLIC;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.exam_save_pre_announcement(UUID, JSONB, BOOLEAN, UUID) TO authenticated, service_role;");
  });

  it("沒有另外做 exam_publish_pre_announcement／exam_unpublish_pre_announcement 這種發佈狀態機", () => {
    expect(sql).not.toContain("exam_publish_pre_announcement");
    expect(sql).not.toContain("exam_unpublish_pre_announcement");
  });
});

describe("0200: 同步到正式版時，預告內容跟開關一併每次覆蓋（跟公告同待遇）", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_push_to_live"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_push_to_live"));

  it("INSERT 分支（第一次建立正式版）帶入預告內容跟開關", () => {
    const insertBranch = fn.slice(fn.indexOf("INSERT INTO public.exam_papers"), fn.indexOf("did_create := TRUE;"));
    expect(insertBranch).toContain("pre_announcement, pre_announcement_enabled");
    expect(insertBranch).toContain("src.pre_announcement, src.pre_announcement_enabled");
  });

  it("UPDATE 分支（後續同步）每次都覆蓋預告內容跟開關", () => {
    const updateBranch = fn.slice(fn.indexOf("UPDATE public.exam_papers SET"), fn.indexOf("WHERE id = dst.id"));
    expect(updateBranch).toContain("pre_announcement = src.pre_announcement,");
    expect(updateBranch).toContain("pre_announcement_enabled = src.pre_announcement_enabled,");
  });

  it("既有防呆（有作答／進行中不能推）沒被動過", () => {
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_has_attempts'");
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_not_closed'");
  });
});

describe("0200: 顯示邏輯——公告已發佈就優先顯示公告，否則預告開著且內容齊全才顯示預告", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public._exam_member_paper_summary"),
    sql.indexOf("-- ── 首頁清單"));

  it("show_pre 需要公告尚未發佈 + 開關開著 + 標題內容都非空", () => {
    expect(fn).toContain("show_pre:=(NOT pr.announcement_published) AND pr.pre_announcement_enabled");
    expect(fn).toContain("COALESCE(btrim(pr.pre_announcement->>'headline'),'')<>''");
    expect(fn).toContain("COALESCE(btrim(pr.pre_announcement->>'body'),'')<>''");
  });

  it("headline/body 依 show_pre 二選一，並多回傳 isPreAnnouncement 讓前端知道現在顯示的是哪一個", () => {
    expect(fn).toContain("disp_headline:=CASE WHEN show_pre THEN pr.pre_announcement->>'headline' ELSE pr.announcement->>'headline' END;");
    expect(fn).toContain("'isPreAnnouncement',show_pre");
  });

  it("公告一發佈（announcement_published=TRUE），show_pre 必為 false——不用另外呼叫撤下", () => {
    // NOT pr.announcement_published 這個條件本身就保證了這件事，這裡只是再次
    // 明確標註測試意圖：公告發佈是唯一觸發「蓋掉預告」的條件。
    expect(fn).toContain("(NOT pr.announcement_published)");
  });
});

describe("0200: 首頁清單／單卡 fallback 都要能撈到「只有預告、公告還沒發佈」的卷", () => {
  it("exam_home_exams 的 WHERE 加上預告的 OR 條件", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_home_exams"),
      sql.indexOf("-- ── 舊版單卡"));
    expect(fn).toContain("pr.announcement_published = TRUE");
    expect(fn).toContain("OR (pr.pre_announcement_enabled = TRUE");
  });

  it("exam_home_banner 的 WHERE 也加上同樣的 OR 條件", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_home_banner"));
    expect(fn).toContain("pr.announcement_published = TRUE");
    expect(fn).toContain("OR (pr.pre_announcement_enabled = TRUE");
  });
});

describe("0200: 前端串接", () => {
  it("db.js 新增 saveExamPreAnnouncement 呼叫 exam_save_pre_announcement", () => {
    expect(db).toContain("async saveExamPreAnnouncement(paperId, preAnnouncement, enabled) {");
    expect(db).toContain('this._callExamRpc("exam_save_pre_announcement"');
  });

  it("nlc-data 的兩個 allowlist（一般 + admin-only）都加了 exam_save_pre_announcement", () => {
    const occurrences = edge.split("exam_save_pre_announcement").length - 1;
    expect(occurrences).toBe(2);
  });

  it("renderExamNoticeForm 多了「預告」fieldset：開關 + 標題 + 內容，沒有入口按鈕欄位", () => {
    const fn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("// ── 試卷設定表單"));
    expect(fn).toContain("<legend>預告");
    expect(fn).toContain('id="exam-pre-enabled"');
    expect(fn).toContain('data-p="headline"');
    expect(fn).toContain('data-p="body"');
    expect(fn).not.toContain('data-p="ctaLabel"');
  });

  it("預告的儲存按鈕呼叫 db.saveExamPreAnnouncement，帶入開關勾選狀態", () => {
    const fn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("// ── 試卷設定表單"));
    expect(fn).toContain('db.saveExamPreAnnouncement(p.id, {');
    expect(fn).toContain('host.querySelector("#exam-pre-enabled").checked');
  });

  it("公告跟預告兩個儲存按鈕各自只監聽自己的欄位（data-n vs data-p + 開關），不會互相誤判待存", () => {
    const fn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("// ── 試卷設定表單"));
    expect(fn).toContain("host.querySelectorAll('[data-n]')");
    expect(fn).toContain("[...host.querySelectorAll('[data-p]'), host.querySelector(\"#exam-pre-enabled\")]");
  });
});
