import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0198_exam_test_announcement_preview.sql");
const exam = read("js/modules/exam.js");
const home = read("js/modules/home.js");

// 架構維持不變（測試版／正式版仍是兩份獨立的 exam_papers），但測試版現在也
// 能編輯並發佈自己的預告文，方便管理員在推上正式版之前，先在首頁預覽卡片
// 實際會長什麼樣子。可見性安全性靠既有的 exam_home_exams/exam_home_banner
// 的 (mode='live' OR is_staff) 判斷把關，不是這次改動的範圍。
describe("0198: exam_publish_announcement 不再限定 mode='live'", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_publish_announcement"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_publish_announcement"));

  it("拿掉了 0131 加的 mode<>'live' 擋板", () => {
    expect(fn).not.toContain("exam_announcement_live_only");
    expect(fn).not.toContain("pr.mode <> 'live'");
  });

  it("其他驗證（已關閉鎖定／已發佈過／標題內容必填／開放時間有效）維持不變", () => {
    expect(fn).toContain("IF pr.status = 'closed' THEN RAISE EXCEPTION 'exam_announcement_locked'; END IF;");
    expect(fn).toContain("IF pr.announcement_published THEN RAISE EXCEPTION 'exam_announcement_already_published'; END IF;");
    expect(fn).toContain("exam_announcement_incomplete");
    expect(fn).toContain("exam_window_invalid");
  });
});

describe("0198: 測試版的預告文只有 admin/pastor 自己看得到，不會外流", () => {
  it("exam_home_exams／exam_home_banner 的既有 (mode='live' OR is_staff) 判斷沒被動過", () => {
    // 這兩支不在這份 migration 裡改，直接檢查上一版定義還在（沒被覆寫成別的樣子）。
    const homeExams = readFileSync(new URL("../supabase/migrations/0123_exam_member_paper_lists.sql", import.meta.url), "utf8");
    expect(homeExams).toContain("AND (pr.mode = 'live' OR is_staff)");
    const homeBanner = readFileSync(new URL("../supabase/migrations/0124_exam_practice_grace_period.sql", import.meta.url), "utf8");
    expect(homeBanner).toContain("pr.announcement_published=TRUE AND(pr.mode='live' OR is_staff)");
  });

  it("exam_my_papers 維持 mode='live' 專用，測試版不進「我的測驗」歷史列表", () => {
    const homeExams = readFileSync(new URL("../supabase/migrations/0123_exam_member_paper_lists.sql", import.meta.url), "utf8");
    const myPapersFn = homeExams.slice(homeExams.indexOf("CREATE OR REPLACE FUNCTION public.exam_my_papers"));
    expect(myPapersFn).toContain("WHERE pr.mode = 'live'");
  });
});

describe("0198: 大測驗 admin UI 兩版都顯示「預告文」分頁，文案依 mode 區分受眾", () => {
  it("hasNotice 不再只給正式版", () => {
    expect(exam).toContain("const hasNotice = true;");
    expect(exam).not.toContain('const hasNotice = isLive;');
  });

  it("confirm 對話框、toast 講清楚受眾：預告文一發佈就是給全體會友（沒有測試版預覽了，#258）", () => {
    // 0200 精簡畫面：原本按鈕旁那句常駐提示文字拿掉了（badge 已經看得出發佈狀態，
    // 細節放進「說明」分頁），但點擊當下的 confirm／toast 還是要講清楚受眾，這兩個沒動。
    expect(exam).toContain('confirm("將把這份預告文發佈到全體會友的首頁。確定？")');
    expect(exam).toContain('"預告文已發佈到會友首頁"');
    expect(exam).not.toContain("只有你自己（管理員）看得到，用來預覽效果");
  });

  it("公告內容編輯是測試版限定的獨立分頁（renderExamNoticeForm），不跟試卷設定混在一起", () => {
    // 0199 先把公告內容編輯併進測試版的試卷設定分頁；後來使用者反饋不要跟試卷
    // 設定混在一起，改回獨立分頁——但只給測試版（跟 0199 的「正式版不能自己
    // 編內容」決定一致），詳見 exam-announcement-test-owned.test.mjs。
    expect(exam).toContain("function renderExamNoticeForm(host, paper, rerender)");
  });
});

describe("0198: 首頁卡片渲染已經支援標示「測試版」badge（既有邏輯，這次改動只是讓它真正被觸發）", () => {
  it("home.js 依 d.mode === 'test' 顯示測試版徽章", () => {
    expect(home).toContain('d.mode === "test" ? \'<span class="stat-badge stat-badge--neutral">測試版</span>\'');
  });
});
