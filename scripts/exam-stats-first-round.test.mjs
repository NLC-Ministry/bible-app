import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentMigrationSql } from "./migration-sql.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// 原本規劃另一支 exam_stats_first_round_filter.sql，從未實際部署過就被
// 0170_exam_paper_linked_plan.sql 的 exam_get_stats 整個取代，拆兩支徒增
// 「先跑一支再跑另一支把它蓋掉」的困惑，所以刪掉、內容併過來這一支。
const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const sql = currentMigrationSql("0170_exam_paper_linked_plan.sql");
const ui = read("js", "modules", "exam.js");
const db = read("js", "db.js");

describe("0170: _user_read_book_once — 讀過該書卷一遍的判定", () => {
  it("current_round >= 2，或第 1 遍打卡相異章數 >= 該書卷章數", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public._user_read_book_once(p_user_id UUID, p_book TEXT, p_chapters INTEGER)");
    expect(sql).toContain("p_user_id IS NULL OR p_book IS NULL OR BTRIM(p_book) = '' OR EXISTS");
    expect(sql).toContain("p_book = ANY(rp.target_books)");
    expect(sql).toContain("rp.current_round >= 2");
    expect(sql).toContain("COUNT(DISTINCT l.chapter) FROM public.reading_logs l");
    expect(sql).toMatch(/COALESCE\(l\.round, 1\) = 1\s[\s\S]*?\) >= p_chapters/);
  });

  it("個人計畫（#473）的計畫與打卡都不算「讀過一遍」", () => {
    expect(sql).toContain("AND NOT rp.is_personal -- #473");
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.reading_plans own WHERE own.id = l.plan_id AND own.is_personal) -- #473");
  });

  it("SECURITY DEFINER、pinned search_path、只給 authenticated / service_role", () => {
    expect(sql).toContain("SECURITY DEFINER SET search_path = pg_catalog, public");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._user_read_book_once(UUID, TEXT, INTEGER) FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public._user_read_book_once(UUID, TEXT, INTEGER) TO authenticated, service_role");
  });
});

describe("0170: exam_get_stats — 5 參數簽章 + 過濾旗標", () => {
  it("DROP 舊 2 參數版、5 參數版用 CREATE OR REPLACE（本檔可重複執行、不撞 42723）", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.exam_get_stats(UUID, UUID);");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.exam_get_stats(");
    expect(sql).not.toMatch(/\nCREATE FUNCTION public\.exam_get_stats\(/);
    expect(sql).toMatch(/p_require_first_round BOOLEAN DEFAULT FALSE/i);
    expect(sql).toMatch(/p_reading_book TEXT DEFAULT NULL/i);
    expect(sql).toMatch(/p_book_chapters INTEGER DEFAULT NULL/i);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.exam_get_stats(UUID,UUID,BOOLEAN,TEXT,INTEGER) TO authenticated");
  });

  it("v_filter 需同時 p_require_first_round=true 且有帶書卷", () => {
    expect(sql).toContain("v_book:=NULLIF(BTRIM(COALESCE(p_reading_book,'')),'')");
    expect(sql).toContain("v_filter:=COALESCE(p_require_first_round,FALSE) AND v_book IS NOT NULL");
    expect(sql).toContain("'readingBook',v_book,'requireFirstRound',v_filter");
  });

  it("scoped_stats 只在 v_filter 時篩掉沒讀完的人，否則等於 scoped", () => {
    expect(sql).toContain("IF v_filter THEN");
    expect(sql).toContain("WHERE a.id=ANY(scoped) AND public._user_read_book_once(a.user_id,v_book,p_book_chapters)");
    expect(sql).toContain("scoped_stats:=scoped;");
  });

  it("彙整分數吃 scoped_stats（開關開＝只算讀完的人）；roster 吃 scoped（列出所有人）", () => {
    // 整體 / 各區表 / 逐題都用 scoped_stats
    expect(sql).toContain("FROM public.exam_attempts a WHERE a.id=ANY(scoped_stats))");
    expect(sql).toMatch(/byRegion[\s\S]*?WHERE a\.id=ANY\(scoped_stats\)/);
    // teamRanking 分數 FILTER 走 scoped_stats（JOIN 本身放寬成 scoped，見缺口拆類測試）
    expect(sql).toMatch(/'teamRanking'[\s\S]*?FILTER\(WHERE a\.id=ANY\(scoped_stats\)AND a\.status='graded'\)completed/);
    // roster 用 scoped（列出所有人，含被排除者）
    expect(sql).toMatch(/'roster',COALESCE\(\(SELECT jsonb_agg[\s\S]*?WHERE a\.id=ANY\(scoped\)AND a\.status IN\('submitted','graded'\)\),'\[\]'::jsonb\)/);
  });

  // 團隊排行「哪些隊算數」的邏輯（v_plans 書卷比對 → 改成直接跟著
  // pr.linked_plan_id 走，見 scripts/exam-paper-linked-plan.test.mjs）已經不
  // 在這支測驗，這裡只留跟「讀完一遍」過濾本身有關的斷言。

  it("roster 每列帶 firstRoundDone（沒帶書卷 → NULL）", () => {
    expect(sql).toContain("'firstRoundDone',CASE WHEN v_book IS NULL THEN NULL ELSE public._user_read_book_once(a.user_id,v_book,p_book_chapters)END");
  });

  it("overall.notReadCount = 已作答但沒讀完該書卷的人數（不受 toggle 影響、只要有帶書卷就算）", () => {
    expect(sql).toContain("'notReadCount',(SELECT COUNT(*)FROM public.exam_attempts a2 WHERE a2.id=ANY(scoped)AND a2.status IN('submitted','graded')");
    expect(sql).toContain("AND v_book IS NOT NULL AND NOT public._user_read_book_once(a2.user_id,v_book,p_book_chapters))");
  });

  it("PR 母體也排除沒讀完的人（v_filter 時）", () => {
    expect(sql).toContain("AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))");
    expect(sql).toContain("AND(NOT v_filter OR public._user_read_book_once(a2.user_id,v_book,p_book_chapters))");
  });
});

describe("db.js — getExamStats 帶新參數", () => {
  it("opts 對應 p_require_first_round / p_reading_book / p_book_chapters", () => {
    expect(db).toContain('return this._callExamRpc("exam_get_stats", {');
    expect(db).toContain("p_require_first_round: opts.requireFirstRound === true");
    expect(db).toContain("p_reading_book: opts.readingBook || null");
    expect(db).toContain("p_book_chapters: Number.isFinite(opts.bookChapters) ? opts.bookChapters : null");
  });
});

describe("exam.js — 統計頁「讀完一遍」欄 + 過濾開關", () => {
  it("parseExamReadingBook：紀→記 正規化、回傳 BIBLE_BOOKS 正式名 + 章數，長名優先", () => {
    const fn = ui.slice(ui.indexOf("function parseExamReadingBook"), ui.indexOf("function parseExamReadingBook") + 700);
    expect(fn).toContain('.replace(/紀/g, "記")');
    expect(fn).toContain("window.BIBLE_BOOKS");
    expect(fn).toContain('sort((a, b) => String(b.name || "").length - String(a.name || "").length)');
    expect(fn).toContain("return hit ? { name: hit.name, chapters: Number(hit.chapters) || null } : null;");
  });

  it("renderExamStats 收 paperTitle，帶 requireFirstRound / readingBook / bookChapters 去抓，沒帶標題就用回傳 title 重抓一次", () => {
    expect(ui).toContain("async function renderExamStats(host, paperId, hasShort = true, paperTitle = null)");
    expect(ui).toContain("requireFirstRound: examStatsRequireRead");
    expect(ui).toContain("if (res.success && !book) {");
    expect(ui).toContain("book = parseExamReadingBook(res.data && res.data.paper && res.data.paper.title);");
  });

  it("有對應書卷才顯示 toggle；勾了就 re-fetch 並重繪", () => {
    expect(ui).toContain('let examStatsRequireRead = false;');
    expect(ui).toContain('<input type="checkbox" id="exam-stats-readgate"');
    expect(ui).toContain("只統計「已讀完《${esc(readingBook)}》至少一遍」的人");
    expect(ui).toContain('host.querySelector("#exam-stats-readgate")?.addEventListener("change"');
    expect(ui).toContain("examStatsRequireRead = e.target.checked === true;");
    expect(ui).toContain("renderExamStats(host, paperId, hasShort, resolvedTitle);");
  });

  it("roster 多一欄「讀完《書》」，未讀完在 toggle 開啟時標「不計入」", () => {
    expect(ui).toContain("...(readingBook ? [{");
    expect(ui).toContain("h: `讀完《${readingBook}》`");
    expect(ui).toContain("r.firstRoundDone === true");
    expect(ui).toContain('未讀完${requireRead ? "・不計入" : ""}');
  });

  it("分數 CSV 也多一欄「讀完《書》」", () => {
    expect(ui).toContain('const readHead = readingBook ? [`讀完《${readingBook}》`] : [];');
    expect(ui).toContain(".concat(readHead, prHead)");
    expect(ui).toContain(".concat(readVal(r), prVals(r))");
  });

  it("後台統計呼叫端把 paper.title 傳進去", () => {
    expect(ui).toContain("renderExamStats(host, paper.id, hasShortSection, paper.title)");
  });

  it("團隊排行表拆「未讀完 / 未考試」欄（有對應書卷時），CSV 再多「缺額」", () => {
    expect(ui).toContain('{ h: "未讀完", f: (r) => (Number(r.notRead)');
    expect(ui).toContain('{ h: "未考試", f: (r) => num(Number(r.notTested) || 0) }');
    expect(ui).toContain('.concat(readingBook ? ["未讀完", "未考試", "缺額"] : [])');
    expect(ui).toContain("r.notRead ?? 0, r.notTested ?? 0, r.emptySlots ?? 0");
  });
});

describe("0170: teamRanking 缺口拆三類（notRead / notTested / emptySlots）", () => {
  const fn = sql.slice(sql.indexOf("'teamRanking',COALESCE(("), sql.indexOf("'byQuestion',"));

  it("JOIN 放寬到未過濾 scoped，才看得出誰只是沒考試", () => {
    // #302 起再排除試作（NOT a.is_test）
    expect(fn).toContain("LEFT JOIN public.exam_attempts a\n            ON a.user_id=m.user_id AND a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.id=ANY(scoped)");
  });

  it("分數/完成/submitted 仍只算 scoped_stats（開關開時＝有讀完）", () => {
    expect(fn).toContain("COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status='graded')completed");
    expect(fn).toContain("COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded'))submitted_cnt");
    expect(fn).toContain("SUM(a.total_score)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status='graded')");
    expect(fn).toContain("/lt.division,1)avg_total");
  });

  it("notRead = 有考試 − 有讀完；notTested = 隊員數 − 有考試；emptySlots = division − 隊員數；都 GREATEST(0,…)", () => {
    expect(fn).toContain("GREATEST(0,COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded'))\n              -COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')))not_read_cnt");
    expect(fn).toContain("GREATEST(0,COUNT(DISTINCT m.user_id)\n              -COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded')))not_tested_cnt");
    expect(fn).toContain("GREATEST(0,lt.division-COUNT(DISTINCT m.user_id))empty_slots");
  });

  it("三個欄位有進 jsonb_build_object", () => {
    expect(fn).toContain("'notRead',t.not_read_cnt,'notTested',t.not_tested_cnt,'emptySlots',t.empty_slots");
  });
});
