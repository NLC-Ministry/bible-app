import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0199_exam_announcement_test_owned.sql");
const exam = read("js/modules/exam.js");

// 架構不變（測試版／正式版仍是兩份獨立的 exam_papers），但公告「內容編輯」
// 整個拉回測試版處理，正式版只保留「發佈/撤下」動作，內容一律由「同步到
// 正式版」帶過去（每次同步都覆蓋，不是只有第一次）。
describe("0199: exam_push_to_live 每次同步都覆蓋正式版的公告內容", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_push_to_live"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_push_to_live"));

  it("UPDATE 既有正式版那個分支現在會覆蓋 announcement", () => {
    const updateBranch = fn.slice(fn.indexOf("UPDATE public.exam_papers SET"), fn.indexOf("WHERE id = dst.id"));
    expect(updateBranch).toContain("announcement = src.announcement,");
  });

  it("announcement_published／announced_at／announced_by 不受同步影響，維持正式版自己的發佈狀態", () => {
    // 只檢查實際 SET 的欄位清單（到 published_by = NULL 為止），後面那句提到
    // 這幾個名字的只是解釋為什麼不動它們的註解，不是真的 SET 到它們。
    const updateBranch = fn.slice(fn.indexOf("UPDATE public.exam_papers SET"), fn.indexOf("published_by = NULL") + "published_by = NULL".length);
    expect(updateBranch).not.toContain("announcement_published");
    expect(updateBranch).not.toContain("announced_at");
    expect(updateBranch).not.toContain("announced_by");
  });

  it("既有防呆（有作答不能推／測驗進行中不能推）原封不動，連帶保護公告內容不能在正式測驗進行中被改", () => {
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_has_attempts'");
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_not_closed'");
  });

  it("第一次建立正式版時仍然照樣帶入測試版當下的公告內容（INSERT 分支不變）", () => {
    const insertBranch = fn.slice(fn.indexOf("INSERT INTO public.exam_papers"), fn.indexOf("did_create := TRUE;"));
    expect(insertBranch).toContain("src.announcement, FALSE, src.linked_plan_id, src.id, actor_id");
  });
});

describe("0199: 公告內容編輯併入測試版的「試卷設定」分頁，正式版不再能自己編輯", () => {
  it("renderExamMetaForm（只給測試版用）多了一個公告設定 fieldset，讀寫同一個 paper.announcement", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("// ── 題目已鎖定時"));
    expect(fn).toContain("<legend>公告設定${examInfoIcon(");
    expect(fn).toContain('data-n="headline"');
    expect(fn).toContain('data-n="body"');
    expect(fn).toContain('data-n="ctaLabel"');
    expect(fn).toContain("db.saveExamAnnouncement(p.id, {");
  });

  it("公告內容關閉後鎖定，跟試卷設定其他欄位的鎖定時機一致（status='closed'）", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("// ── 題目已鎖定時"));
    expect(fn).toContain("const annLocked = p.status === \"closed\";");
  });

  it("獨立的「預告文」分頁按鈕已經拿掉，兩個版本都不再顯示", () => {
    expect(exam).not.toContain('data-exam-sub="notice"');
  });

  it("正式版切換／建立後不再導到已經不存在的 notice 分頁", () => {
    expect(exam).not.toContain('examAdminSubview = "notice"');
  });

  it("正式版仍保留「發佈預告文」/「撤下預告文」動作按鈕（只是內容不能自己編）", () => {
    expect(exam).toContain('data-exam-act="announce"');
    expect(exam).toContain('data-exam-act="unannounce"');
    expect(exam).toContain("const hasNotice = true;");
  });
});
