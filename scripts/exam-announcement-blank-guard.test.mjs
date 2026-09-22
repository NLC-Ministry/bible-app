import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0201_exam_announcement_blank_guard.sql");
const db = read("js/db.js");
const exam = read("js/modules/exam.js");
const admin = read("js/modules/admin.js");

// 真實發現的問題：exam_publish_announcement 第一次發佈時有擋空白內容，但
// exam_save_announcement（存檔）完全沒檢查——已發佈的公告事後被改空再存檔，
// 卡片還在顯示卻是空的。exam_push_to_live 同步時也會把空白內容覆蓋到「已經
// 發佈給會友看」的正式版公告上，沒有任何警告。

describe("0201: exam_save_announcement 不准把已發佈的公告存成空白", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_save_announcement"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_save_announcement"));

  it("先查目前的 announcement_published，再决定要不要擋", () => {
    expect(fn).toContain("SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;");
    expect(fn).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;");
    expect(fn).toContain("IF pr.announcement_published AND (btrim(new_headline) = '' OR btrim(new_body) = '') THEN");
    expect(fn).toContain("RAISE EXCEPTION 'exam_announcement_would_blank_published';");
  });

  it("未發佈狀態下仍然可以自由存草稿（含空白），不受這個新檢查影響", () => {
    // 條件式本身就只在 pr.announcement_published 為真時才擋，這裡再次確認
    // 條件式沒有被寫成「一律擋空白」。
    expect(fn).not.toContain("IF (btrim(new_headline) = '' OR btrim(new_body) = '') THEN");
  });
});

describe("0201: exam_push_to_live 不准帶空白公告去覆蓋已發佈的正式版公告", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_push_to_live"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_push_to_live"));

  it("在既有的兩個防呆之後，多一個「會不會把正式版公告覆蓋成空白」的檢查", () => {
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_has_attempts'");
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_live_not_closed'");
    expect(fn).toContain("IF dst.announcement_published AND (");
    expect(fn).toContain("RAISE EXCEPTION 'exam_push_would_blank_announcement';");
  });

  it("檢查的是來源（測試版）內容是否空白，目標（正式版）是否已發佈", () => {
    const guard = fn.slice(fn.indexOf("IF dst.announcement_published AND ("), fn.indexOf("RAISE EXCEPTION 'exam_push_would_blank_announcement';"));
    expect(guard).toContain("src.announcement ->> 'headline'");
    expect(guard).toContain("src.announcement ->> 'body'");
  });
});

describe("0201: 前端有對應的錯誤訊息", () => {
  it("db.js 的錯誤訊息表有這兩個新錯誤碼", () => {
    expect(db).toContain("exam_announcement_would_blank_published:");
    expect(db).toContain("exam_push_would_blank_announcement:");
  });
});

describe("儲存按鈕：「沒有待存內容」跟「有改動待存」要能明顯分辨，不能兩個都長一樣", () => {
  const fn = exam.slice(exam.indexOf("function wireSaveButton"), exam.indexOf("// ── 建立新試卷"));

  it("clean 狀態改成 disabled（灰掉＝已經存好、沒有變動）", () => {
    expect(fn).toContain("else { btn.textContent = baseLabel; btn.disabled = true; }");
  });

  it("wireSaveButton 一開始就呼叫 setState(\"clean\")，因為剛渲染出來時表單跟伺服器資料一致", () => {
    expect(fn).toContain('setState("clean");');
  });

  it("dirty／saving／saved 三個狀態不受影響，維持原本的行為", () => {
    expect(fn).toContain('if (state === "dirty") { btn.classList.add("is-dirty"); btn.textContent = `${baseLabel}（有改動未儲存）`; btn.disabled = false; }');
    expect(fn).toContain('else if (state === "saving") { btn.classList.add("is-saving"); btn.textContent = "儲存中…"; btn.disabled = true; }');
    expect(fn).toContain('else if (state === "saved") { btn.classList.add("is-saved"); btn.textContent = "已儲存 ✓"; btn.disabled = false; }');
  });
});

describe("admin.js 動態載入 exam.js 的版本號要跟得上", () => {
  it("兩邊版本號一致", () => {
    const examEntry = read("js/exam-entry.js");
    const adminVersionMatch = admin.match(/from "\.\/exam\.js\?v=([^"]+)"/);
    const entryVersionMatch = examEntry.match(/from '\.\/modules\/exam\.js\?v=([^']+)'/);
    expect(adminVersionMatch[1]).toBe(entryVersionMatch[1]);
  });
});
