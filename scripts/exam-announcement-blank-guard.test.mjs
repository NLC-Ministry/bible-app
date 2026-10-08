import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const db = read("js/db.js");
const exam = read("js/modules/exam.js");
const admin = read("js/modules/admin.js");

// 真實發現的問題：exam_publish_announcement 第一次發佈時有擋空白內容，但
// exam_save_announcement（存檔）完全沒檢查——已發佈的公告事後被改空再存檔，
// 卡片還在顯示卻是空的。exam_push_to_live 同步時也會把空白內容覆蓋到「已經
// 發佈給會友看」的正式版公告上，沒有任何警告。

// 0201 的兩道空白防呆後來都拿掉了：#298 起首頁卡片文字沒填會自動產生、announcement_published
// 欄位在 #303 刪除，所以不再擋存空白；exam_push_to_live 在 #260 隨單一試卷刪除。
describe("exam_save_announcement：只有 admin/pastor、結束（closed）後鎖定", () => {
  const fn = latestFunctionDefinition("exam_save_announcement").text;

  it("權限與鎖定時機", () => {
    expect(fn).toContain("IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN");
    expect(fn).toContain("WHERE id = p_paper_id AND status <> 'closed'");
    expect(fn).toContain("RAISE EXCEPTION 'exam_announcement_locked'");
  });

  it("空白防呆已拿掉（卡片文字會自動產生），exam_push_to_live 已刪", () => {
    expect(fn).not.toContain("exam_announcement_would_blank_published");
    expect(() => latestFunctionDefinition("exam_push_to_live")).toThrow(/dropped/);
  });
});

describe("0201: 前端有對應的錯誤訊息", () => {
  it("首頁卡片文字沒填會自動產生（#298），空白防呆的錯誤訊息跟著拿掉（#300）；推上正式版的已隨功能移除（#258）", () => {
    expect(db).not.toContain("exam_announcement_would_blank_published:");
    expect(db).not.toContain("exam_push_would_blank_announcement:");
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
