import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { AUDIT_ACTION_LABEL } from "../supabase/functions/admin-api/audit.ts";
import { latestFunctionDefinition } from "./migration-sql.mjs";

// #679：店家帳號在個人頁查看克勞斯兌換紀錄、後台指定店家帳號。
// SQL 的權限、欄位白名單、防猜碼、稽核都實際跑在 scripts/db-behavior.test.mjs；這裡驗前端與接線。

const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const indexHtml = read("index.html");
const profileSource = read("js/modules/profile.js");
const moduleSource = read("js/modules/voucher-merchant.mjs");
const adminModuleSource = read("js/modules/admin-voucher-merchants.mjs");
const dbSource = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const available = { code: "K7M2QX", name: "得獎者甲", riseDate: "2026-10-05", rank: 1, amount: 100, status: "available", redeemedAt: null, redeemedVia: null, expiresOn: "2026-11-20" };
const redeemedSelf = { code: "HB3ZRT", name: "得獎者乙", riseDate: "2026-10-06", rank: 2, amount: 100, status: "redeemed", redeemedAt: "2026-11-02T06:30:00Z", redeemedVia: "self", expiresOn: "2026-11-21" };
const redeemedAdmin = { code: "ERAJP5", name: "得獎者丙", riseDate: "2026-10-07", rank: 3, amount: 100, status: "redeemed", redeemedAt: "2026-11-03T06:30:00Z", redeemedVia: "admin", expiresOn: "2026-11-22" };
const expired = { code: "PPQ9WN", name: "得獎者丁", riseDate: "2026-09-01", rank: 1, amount: 100, status: "expired", redeemedAt: null, redeemedVia: null, expiresOn: "2026-10-01" };
const pageData = {
  today: "2026-11-05",
  month: "2026-11",
  months: ["2026-11", "2026-10"],
  summary: { redeemedCount: 2, redeemedAmount: 200 },
  vouchers: [available, redeemedSelf, redeemedAdmin, expired],
  truncated: false
};

let dom;
const escapeHTML = value => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function setup(dbStub) {
  dom = new JSDOM(`<!doctype html><body>
    <button id="profile-voucher-merchant-entry" class="hidden"></button>
    <div id="profile-tab-content-voucher-merchant">
      <button id="profile-voucher-merchant-refresh">重新整理</button>
      <form id="voucher-merchant-lookup">
        <input id="voucher-merchant-code">
        <button type="submit" id="voucher-merchant-lookup-submit">查詢</button>
      </form>
      <div id="voucher-merchant-lookup-result"></div>
      <div id="voucher-merchant-summary"></div>
      <div id="voucher-merchant-filters"></div>
      <div id="voucher-merchant-list"></div>
    </div></body>`, { url: "https://example.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("escapeHTML", escapeHTML);
  vi.stubGlobal("hydrateIcons", () => {});
  if (dbStub) vi.stubGlobal("db", dbStub);
  dom.window.showToast = vi.fn();
  await import("../js/copy/zh-Hant.js");
  return import("../js/modules/voucher-merchant.mjs");
}

const entry = () => dom.window.document.getElementById("profile-voucher-merchant-entry");
const byId = id => dom.window.document.getElementById(id);
const submitLookup = code => {
  byId("voucher-merchant-code").value = code;
  byId("voucher-merchant-lookup").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
};

beforeEach(() => vi.resetModules());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

describe("個人頁入口", () => {
  it("一般會友看不到入口", async () => {
    const getVoucherMerchantAccess = vi.fn(async () => ({ success: true, isMerchant: false }));
    const { refreshVoucherMerchantEntry } = await setup({ getVoucherMerchantAccess });
    expect(await refreshVoucherMerchantEntry()).toBe(false);
    expect(entry().classList.contains("hidden")).toBe(true);
    expect(getVoucherMerchantAccess).toHaveBeenCalledTimes(1);
  });

  it("被指定的帳號看得到入口", async () => {
    const { refreshVoucherMerchantEntry } = await setup({ getVoucherMerchantAccess: async () => ({ success: true, isMerchant: true }) });
    expect(await refreshVoucherMerchantEntry()).toBe(true);
    expect(entry().classList.contains("hidden")).toBe(false);
  });

  it("migration／nlc-data 還沒部署：沒有入口、不跳錯", async () => {
    const { refreshVoucherMerchantEntry } = await setup({ getVoucherMerchantAccess: async () => ({ success: false, isMerchant: false }) });
    expect(await refreshVoucherMerchantEntry()).toBe(false);
    expect(entry().classList.contains("hidden")).toBe(true);
    expect(dom.window.showToast).not.toHaveBeenCalled();
  });

  it("舊版 db 沒有這支函式也不會壞", async () => {
    const { refreshVoucherMerchantEntry } = await setup({});
    await expect(refreshVoucherMerchantEntry()).resolves.toBe(false);
  });

  it("5 分鐘內不重查；暫時查不到不會收掉店家的入口", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T02:00:00Z") });
    const getVoucherMerchantAccess = vi.fn()
      .mockResolvedValueOnce({ success: true, isMerchant: true })
      .mockResolvedValueOnce({ success: false, isMerchant: false })
      .mockResolvedValueOnce({ success: true, isMerchant: false });
    const { refreshVoucherMerchantEntry } = await setup({ getVoucherMerchantAccess });
    await refreshVoucherMerchantEntry();
    await refreshVoucherMerchantEntry();
    await refreshVoucherMerchantEntry();
    expect(getVoucherMerchantAccess).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-05T02:06:00Z"));
    expect(await refreshVoucherMerchantEntry()).toBe(true);
    expect(getVoucherMerchantAccess).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-11-05T02:12:00Z"));
    expect(await refreshVoucherMerchantEntry()).toBe(false);
    expect(entry().classList.contains("hidden")).toBe(true);
  });

  it("db 的入口判斷：伺服器拒絕或連不上都安靜地回沒有入口，不印警告", async () => {
    const start = dbSource.indexOf("db.getVoucherMerchantAccess = async function()");
    const end = dbSource.indexOf("db.getVoucherMerchantVouchers", start);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = async rpc => {
      const fakeDb = {};
      new Function("db", "state", dbSource.slice(start, end))(fakeDb, { isSupabaseMode: true, supabase: { rpc } });
      return fakeDb.getVoucherMerchantAccess();
    };
    expect(await run(async () => ({ data: null, error: { message: "forbidden_rpc" } }))).toEqual({ success: false, isMerchant: false });
    expect(await run(async () => { throw new Error("network"); })).toEqual({ success: false, isMerchant: false });
    expect(await run(async () => ({ data: { isMerchant: true }, error: null }))).toEqual({ success: true, isMerchant: true });
    expect(await run(async () => ({ data: { isMerchant: "yes" }, error: null }))).toEqual({ success: true, isMerchant: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it("開機不查：只有 renderProfileView 判斷入口，子頁是打開才載", () => {
    for (const file of ["js/app.js", "js/modules/home.js"]) {
      expect(read(file), file).not.toContain("voucher-merchant");
      expect(read(file), file).not.toContain("get_my_voucher_merchant_access");
    }
    const render = profileSource.slice(profileSource.indexOf("export async function renderProfileView()"), profileSource.indexOf("function formatExamDateRange"));
    expect(render).toContain("void refreshVoucherMerchantEntry();");
    expect(profileSource.match(/refreshVoucherMerchantEntry\(/g)).toHaveLength(1);
    expect(profileSource).toContain('if (key === "voucher-merchant") void refreshVoucherMerchantPage();');
    expect(profileSource).toContain("bindVoucherMerchantPage();");
  });

  it("入口預設藏起來，子頁放在 .view-pane 外（和我的兌換券同一層）", () => {
    expect(indexHtml).toContain('class="app-settings-item w-full text-left hidden" id="profile-voucher-merchant-entry" data-profile-open="voucher-merchant"');
    expect(indexHtml).toContain('<div id="profile-tab-content-voucher-merchant" class="profile-subpage hidden" aria-hidden="true">');
    expect(indexHtml.indexOf('id="profile-tab-content-vouchers"')).toBeLessThan(indexHtml.indexOf('id="profile-tab-content-voucher-merchant"'));
    expect(indexHtml.indexOf('id="profile-tab-content-voucher-merchant"')).toBeLessThan(indexHtml.indexOf('id="profile-tab-content-commentary-review"'));
  });
});

describe("兌換紀錄子頁", () => {
  const loaded = async (overrides = {}) => {
    const dbStub = {
      getVoucherMerchantVouchers: vi.fn(async () => ({ success: true, data: pageData })),
      lookupVoucherMerchantCode: vi.fn(async () => ({ success: true, data: { found: false, rateLimited: false, voucher: null } })),
      ...overrides
    };
    const mod = await setup(dbStub);
    mod.bindVoucherMerchantPage();
    await mod.refreshVoucherMerchantPage();
    return { mod, dbStub };
  };
  const cards = () => [...dom.window.document.querySelectorAll("#voucher-merchant-list [data-merchant-voucher]")].map(card => card.dataset.merchantVoucher);

  it("顯示當月對帳、月份與狀態篩選、每張券的欄位", async () => {
    await loaded();
    const summary = byId("voucher-merchant-summary").textContent;
    expect(summary).toContain("2026 年 11 月對帳");
    expect(summary).toContain("已兌換 2 張，共 200 元");
    expect([...dom.window.document.querySelectorAll("[data-merchant-month] option")].map(option => option.textContent)).toEqual(["2026 年 11 月", "2026 年 10 月"]);
    expect([...dom.window.document.querySelectorAll("[data-merchant-status]")].map(button => button.textContent)).toEqual(["全部 4", "可使用 1", "已兌換 2", "已過期 1"]);
    expect(cards()).toEqual(["K7M2QX", "HB3ZRT", "ERAJP5", "PPQ9WN"]);
    const text = byId("voucher-merchant-list").textContent;
    for (const expected of ["得獎者甲", "第一名", "100 元", "可使用", "已過期", "11/20", "本人確認", "教會補記"]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("不畫白名單外的欄位，就算伺服器多回也一樣；已作廢不畫；沒有核銷按鈕", async () => {
    const leaky = { ...redeemedAdmin, pastoralZone: "中永和牧區", elapsedMs: 4567, userId: "member-id-1", redeemedByName: "管理員某某", id: "voucher-id-1" };
    const voided = { ...available, code: "ZZZZZZ", status: "void" };
    await loaded({ getVoucherMerchantVouchers: async () => ({ success: true, data: { ...pageData, vouchers: [leaky, voided] } }) });
    const html = byId("voucher-merchant-list").innerHTML;
    for (const forbidden of ["中永和牧區", "4567", "member-id-1", "管理員某某", "voucher-id-1", "ZZZZZZ", "已作廢", "data-voucher-redeem", "確認兌換"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
    expect(cards()).toEqual(["ERAJP5"]);
  });

  it("會友輸入的姓名要跳脫", async () => {
    await loaded({ getVoucherMerchantVouchers: async () => ({ success: true, data: { ...pageData, vouchers: [{ ...available, name: "<img src=x onerror=1>" }] } }) });
    expect(byId("voucher-merchant-list").innerHTML).not.toContain("<img");
    expect(byId("voucher-merchant-list").textContent).toContain("<img src=x onerror=1>");
  });

  it("換狀態不發請求；換月份 1 個請求", async () => {
    const { dbStub } = await loaded();
    expect(dbStub.getVoucherMerchantVouchers).toHaveBeenCalledTimes(1);
    dom.window.document.querySelector('[data-merchant-status="redeemed"]').click();
    expect(cards()).toEqual(["HB3ZRT", "ERAJP5"]);
    expect(dom.window.document.querySelector('[data-merchant-status="redeemed"]').getAttribute("aria-pressed")).toBe("true");
    expect(dbStub.getVoucherMerchantVouchers).toHaveBeenCalledTimes(1);

    const select = dom.window.document.querySelector("[data-merchant-month]");
    select.value = "2026-10";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(dbStub.getVoucherMerchantVouchers).toHaveBeenCalledTimes(2));
    expect(dbStub.getVoucherMerchantVouchers).toHaveBeenLastCalledWith("2026-10");
  });

  it("被移除的帳號：收掉入口、清掉已載入的資料、寫沒有權限", async () => {
    const getVoucherMerchantVouchers = vi.fn()
      .mockResolvedValueOnce({ success: true, data: pageData })
      .mockResolvedValueOnce({ success: false, error: { message: "voucher_merchant_required" }, message: "你的帳號目前沒有查看權限。" });
    const { mod } = await loaded({ getVoucherMerchantVouchers, getVoucherMerchantAccess: async () => ({ success: true, isMerchant: true }) });
    await mod.refreshVoucherMerchantEntry();
    expect(entry().classList.contains("hidden")).toBe(false);
    await mod.refreshVoucherMerchantPage();
    expect(entry().classList.contains("hidden")).toBe(true);
    expect(cards()).toEqual([]);
    expect(byId("voucher-merchant-summary").innerHTML).toBe("");
    expect(byId("voucher-merchant-list").textContent).toContain("沒有查看權限");
    expect(byId("voucher-merchant-list").textContent).not.toContain("得獎者甲");
  });

  it("nlc-data 還沒部署時直接打開網址：寫沒有權限，不跳提示", async () => {
    await loaded({ getVoucherMerchantVouchers: async () => ({ success: false, error: { message: "forbidden_rpc" }, message: "雲柱測驗資料處理失敗，請稍後再試。" }) });
    expect(byId("voucher-merchant-list").textContent).toContain("沒有查看權限");
    expect(dom.window.showToast).not.toHaveBeenCalled();
  });

  it("其他錯誤寫一句話，不把入口收掉", async () => {
    const { mod } = await loaded({
      getVoucherMerchantVouchers: async () => ({ success: false, error: { message: "timeout" }, message: "雲柱測驗資料處理失敗，請稍後再試。" }),
      getVoucherMerchantAccess: async () => ({ success: true, isMerchant: true })
    });
    await mod.refreshVoucherMerchantEntry();
    await mod.refreshVoucherMerchantPage();
    expect(entry().classList.contains("hidden")).toBe(false);
    expect(byId("voucher-merchant-list").textContent).toContain("雲柱測驗資料處理失敗");
  });

  describe("查兌換碼", () => {
    it("小寫、空白、連字號先整理；查到顯示那張券", async () => {
      const lookupVoucherMerchantCode = vi.fn(async () => ({ success: true, data: { found: true, rateLimited: false, voucher: redeemedSelf } }));
      const { dbStub } = await loaded({ lookupVoucherMerchantCode });
      submitLookup(" hb3-zrt ");
      await vi.waitFor(() => expect(byId("voucher-merchant-lookup-result").querySelector("[data-merchant-voucher]")).not.toBeNull());
      expect(dbStub.lookupVoucherMerchantCode).toHaveBeenCalledWith("HB3ZRT");
      expect(byId("voucher-merchant-lookup-result").textContent).toContain("得獎者乙");
      expect(byId("voucher-merchant-lookup-submit").disabled).toBe(false);
    });

    it("格式不對不發請求（含字元集外的 0、O、1、I、L）", async () => {
      const { dbStub } = await loaded();
      for (const code of ["", "ABC", "ABCDEFG", "ABCDE0", "ABCDEO", "ABCDE1", "ABCDEI", "ABCDEL", "%_%_%_"]) {
        submitLookup(code);
        expect(byId("voucher-merchant-lookup-result").textContent, code).toContain("6 碼英文和數字");
      }
      expect(dbStub.lookupVoucherMerchantCode).not.toHaveBeenCalled();
    });

    it("查不到只有一種說法，看不出作廢與否；被鎖另外說明", async () => {
      const lookupVoucherMerchantCode = vi.fn()
        .mockResolvedValueOnce({ success: true, data: { found: false, rateLimited: false, voucher: null } })
        .mockResolvedValueOnce({ success: true, data: { found: false, rateLimited: true, voucher: null } })
        .mockResolvedValueOnce({ success: false, error: { message: "voucher_merchant_required" } });
      await loaded({ lookupVoucherMerchantCode, getVoucherMerchantAccess: async () => ({ success: true, isMerchant: true }) });
      submitLookup("ZZZZZZ");
      await vi.waitFor(() => expect(byId("voucher-merchant-lookup-result").textContent).toContain("查不到這組兌換碼"));
      expect(byId("voucher-merchant-lookup-result").textContent).not.toContain("作廢");
      submitLookup("ZZZZZY");
      await vi.waitFor(() => expect(byId("voucher-merchant-lookup-result").textContent).toContain("一小時後再試"));
      submitLookup("ZZZZZX");
      await vi.waitFor(() => expect(byId("voucher-merchant-list").textContent).toContain("沒有查看權限"));
      expect(entry().classList.contains("hidden")).toBe(true);
      expect(byId("voucher-merchant-lookup-result").innerHTML).toBe("");
    });
  });
});

describe("後台：店家帳號", () => {
  const shop = { profileId: "shop-1", name: "克勞斯店員", emailMasked: "k***@example.invalid", pastoralZone: "", isMerchant: false };
  const setupAdmin = async dbOverrides => {
    dom = new JSDOM(`<!doctype html><body><div id="host"></div></body>`, { url: "https://example.test" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    await import("../js/copy/zh-Hant.js");
    const { createAdminVoucherMerchants } = await import("../js/modules/admin-voucher-merchants.mjs");
    const dbStub = {
      adminListVoucherMerchants: vi.fn(async () => ({ success: true, data: { merchants: [] } })),
      adminSearchVoucherMerchantCandidates: vi.fn(async () => ({ success: true, data: { candidates: [shop] } })),
      adminSetVoucherMerchant: vi.fn(async (_id, enabled) => ({ success: true, data: { changed: true, merchants: enabled ? [{ ...shop, addedAt: "2026-11-05T02:00:00Z" }] : [] } })),
      ...dbOverrides
    };
    const host = dom.window.document.getElementById("host");
    const showToast = vi.fn();
    const confirm = vi.fn(async () => true);
    const panel = createAdminVoucherMerchants({ db: dbStub, escapeHTML, showToast, confirm, host, searchDelayMs: 0 });
    await panel.load();
    const search = value => {
      const input = host.querySelector("[data-merchant-search]");
      input.value = value;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    };
    return { dbStub, host, showToast, confirm, search };
  };

  it("打開只發 1 個請求，顯示目前名單", async () => {
    const { dbStub, host } = await setupAdmin({
      adminListVoucherMerchants: vi.fn(async () => ({ success: true, data: { merchants: [{ ...shop, name: "<b>店員</b>" }] } }))
    });
    expect(dbStub.adminListVoucherMerchants).toHaveBeenCalledTimes(1);
    expect(dbStub.adminSearchVoucherMerchantCandidates).not.toHaveBeenCalled();
    expect(host.querySelector("[data-merchant-remove]").dataset.merchantRemove).toBe("shop-1");
    expect(host.innerHTML).not.toContain("<b>店員</b>");
  });

  it("載入失敗只影響這一塊", async () => {
    const { host } = await setupAdmin({ adminListVoucherMerchants: async () => ({ success: false, message: "forbidden_rpc" }) });
    expect(host.textContent).toContain("載入店家帳號失敗");
    expect(host.querySelector("[data-merchant-search]")).not.toBeNull();
  });

  it("太短不查；搜尋後加入要確認，成功後名單更新、搜尋結果標已是店家", async () => {
    const { dbStub, host, confirm, search, showToast } = await setupAdmin();
    search("k");
    expect(host.textContent).toContain("至少兩個英文或數字");
    search("克");
    await vi.waitFor(() => expect(host.querySelector("[data-merchant-add]")).not.toBeNull());
    expect(dbStub.adminSearchVoucherMerchantCandidates).toHaveBeenCalledTimes(1);
    expect(dbStub.adminSearchVoucherMerchantCandidates).toHaveBeenCalledWith("克");

    host.querySelector("[data-merchant-add]").click();
    await vi.waitFor(() => expect(dbStub.adminSetVoucherMerchant).toHaveBeenCalledWith("shop-1", true));
    await vi.waitFor(() => expect(host.querySelector("[data-merchant-remove]")).not.toBeNull());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].message).toContain("克勞斯店員");
    expect(host.querySelector("[data-merchant-add]")).toBeNull();
    expect(host.querySelector("[data-merchant-results]").textContent).toContain("已是店家");
    expect(showToast).toHaveBeenCalledWith("已加入店家帳號。");
  });

  it("取消確認不送；儲存失敗顯示伺服器訊息、按鈕恢復", async () => {
    const { dbStub, host, confirm, search, showToast } = await setupAdmin({
      adminSetVoucherMerchant: vi.fn(async () => ({ success: false, message: "這個帳號還不能指定" }))
    });
    search("克勞斯");
    await vi.waitFor(() => expect(host.querySelector("[data-merchant-add]")).not.toBeNull());
    confirm.mockResolvedValueOnce(false);
    host.querySelector("[data-merchant-add]").click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(dbStub.adminSetVoucherMerchant).not.toHaveBeenCalled();

    const button = host.querySelector("[data-merchant-add]");
    button.click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("這個帳號還不能指定"));
    expect(button.disabled).toBe(false);
  });

  it("移除要確認，成功後從名單消失", async () => {
    const { dbStub, host } = await setupAdmin({
      adminListVoucherMerchants: vi.fn(async () => ({ success: true, data: { merchants: [shop] } }))
    });
    host.querySelector("[data-merchant-remove]").click();
    await vi.waitFor(() => expect(dbStub.adminSetVoucherMerchant).toHaveBeenCalledWith("shop-1", false));
    await vi.waitFor(() => expect(host.querySelector("[data-merchant-remove]")).toBeNull());
    expect(host.textContent).toContain("還沒有指定店家帳號");
  });

  it("放在得獎與兌換分頁，只在第一次整頁畫時載入", () => {
    const admin = read("js/modules/admin.js");
    const awards = admin.slice(admin.indexOf("export async function renderAdminLightningQuizAwards("), admin.indexOf("async function openAdminLightningQuizAwardsTab("));
    expect(awards).toContain("data-lq-voucher-merchants");
    expect(awards).toContain("createAdminVoucherMerchants({");
  });
});

describe("nlc-data 接線", () => {
  const rpcSet = name => {
    const match = nlcData.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
    return [...match[1].matchAll(/^\s*"(\w+)"/gm)].map(item => item[1]);
  };
  const MERCHANT = ["get_my_voucher_merchant_access", "get_voucher_merchant_vouchers", "lookup_voucher_merchant_code"];
  const ADMIN = ["admin_list_voucher_merchants", "admin_search_voucher_merchant_candidates", "admin_set_voucher_merchant"];

  it("店家與管理員函式都在會注入 p_actor_id 的清單，前端傳的 id 會被覆寫", () => {
    const lightning = rpcSet("LIGHTNING_QUIZ_RPC_FUNCTIONS");
    for (const name of [...MERCHANT, ...ADMIN]) expect(lightning, name).toContain(name);
    expect(nlcData).toMatch(/\|\| LIGHTNING_QUIZ_RPC_FUNCTIONS\.has\(functionName\)[\s\S]*?rpcArgs = \{ \.\.\.\(body\.args \|\| \{\}\), p_actor_id: profile\.id \};/);
  });

  it("管理員三支在 nlc-data 先擋非 admin（記 denied），店家函式不擋角色（授權名單在 SQL）", () => {
    const admin = rpcSet("ADMIN_RPC_FUNCTIONS");
    for (const name of ADMIN) expect(admin, name).toContain(name);
    for (const name of MERCHANT) expect(admin, name).not.toContain(name);
  });

  it("會寫稽核的函式不進批次讀取；新表不開放泛用 select", () => {
    const batch = rpcSet("BATCH_RPC_FUNCTIONS");
    for (const name of [...MERCHANT, ...ADMIN]) expect(batch, name).not.toContain(name);
    expect(nlcData).not.toContain("lightning_quiz_voucher_merchants");
    expect(nlcData).not.toContain("lightning_quiz_voucher_lookup_limits");
  });

  it("稽核動作都有中文名稱，SQL 寫的名字和標籤一致", () => {
    const sql = ["get_voucher_merchant_vouchers", "lookup_voucher_merchant_code", "admin_set_voucher_merchant"]
      .map(name => latestFunctionDefinition(name).text).join("\n");
    for (const name of ["voucher_merchant.view_list", "voucher_merchant.lookup", "voucher_merchant.add", "voucher_merchant.remove"]) {
      expect(sql, name).toContain(`'${name}'`);
      expect(AUDIT_ACTION_LABEL[name], name).toBeTruthy();
    }
  });
});

describe("文案與設計規則", () => {
  it("程式用到的文案 key 都存在 zh-Hant.js", async () => {
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test" });
    vi.stubGlobal("window", dom.window);
    await import("../js/copy/zh-Hant.js");
    const used = source => [...source.matchAll(/\bt\.(\w+)/g)].map(match => match[1]);
    const merchant = dom.window.APP_COPY.voucherMerchant;
    const admin = dom.window.APP_COPY.voucherMerchantAdmin;
    expect(used(moduleSource).length).toBeGreaterThan(10);
    for (const key of used(moduleSource)) expect(merchant[key], key).toBeTruthy();
    for (const key of used(adminModuleSource)) expect(admin[key], key).toBeTruthy();
  });

  it("不用 emoji、不寫行內樣式；用到的圖示都在 manifest", () => {
    const start = indexHtml.indexOf('<div id="profile-tab-content-voucher-merchant"');
    const page = indexHtml.slice(start, indexHtml.indexOf('<div id="profile-tab-content-commentary-review"', start));
    for (const source of [moduleSource, adminModuleSource, page]) {
      expect(source).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(source).not.toMatch(/style=/);
    }
    const manifest = JSON.parse(read("js/design/icon-manifest.json"));
    for (const match of page.matchAll(/data-icon="(\w+)"/g)) expect(manifest[match[1]], match[1]).toBeTruthy();
    expect(manifest.ticket).toBeTruthy();
  });

  it("新樣式只用 token，不寫死顏色", () => {
    const css = read("index.css");
    const start = css.indexOf("/* 克勞斯兌換紀錄：店家帳號查看（#679） */");
    const block = css.slice(start, css.indexOf("/* 後台週統計「英雄榜兌換券」（#445） */", start)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient/);
    expect(block).not.toMatch(/font-weight:\s*[6-9]00/);
  });

  it("店家端沒有匯出", () => {
    expect(moduleSource).not.toMatch(/csv|download|Blob/i);
    expect(indexHtml.slice(indexHtml.indexOf('<div id="profile-tab-content-voucher-merchant"'), indexHtml.indexOf('<div id="profile-tab-content-commentary-review"'))).not.toMatch(/匯出|CSV/);
  });
});
