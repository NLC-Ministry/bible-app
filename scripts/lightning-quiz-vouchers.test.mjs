import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildVoucherCsv, summarizeVouchers } from "../js/modules/lightning-quiz-analytics.mjs";

// #445：雲柱測驗英雄榜得獎者的克勞斯 100 元抵用券——發券、本人確認兌換、個人頁得獎證明、後台清單

const vouchers = [
  { id: "v1", code: "ERAJP5", amount: 100, weekStart: "2026-09-28", riseDate: "2026-09-28", rank: 1, name: "甲", pastoralZone: "中永和", expiresOn: "2026-11-03", status: "available" },
  { id: "v2", code: "K7M2QX", amount: 100, weekStart: "2026-09-28", riseDate: "2026-09-30", rank: 2, name: "甲", pastoralZone: "中永和", expiresOn: "2026-10-20", status: "available" },
  { id: "v3", code: "HB3ZRT", amount: 100, weekStart: "2026-09-21", riseDate: "2026-09-22", rank: 3, name: "甲", pastoralZone: "中永和", expiresOn: "2026-10-21", status: "redeemed", redeemedAt: "2026-10-05T06:30:00Z", redeemedVia: "self" },
  { id: "v4", code: "PPQ9WN", amount: 100, weekStart: "2026-09-14", riseDate: "2026-09-15", rank: 1, name: "甲", pastoralZone: "中永和", expiresOn: "2026-10-01", status: "expired" }
];

let dom;

function setup(dbStub) {
  dom = new JSDOM(`<!doctype html><body>
    <div id="profile-tab-content-vouchers">
      <button id="profile-vouchers-refresh">重新整理</button>
      <div id="profile-vouchers-list"></div>
    </div></body>`, { url: "https://example.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("escapeHTML", value => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("db", dbStub);
  dom.window.showToast = vi.fn();
  dom.window.showConfirmDialog = vi.fn(async () => true);
}

beforeEach(() => vi.resetModules());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

describe("我的兌換券", () => {
  it("lists usable vouchers first (soonest expiry first), then used/expired, as proof of the award", async () => {
    setup({ getMyLightningQuizVouchers: vi.fn(async () => ({ success: true, data: { vouchers } })) });
    const { refreshMyLightningQuizVouchers } = await import("../js/modules/lightning-quiz-vouchers.mjs");
    await refreshMyLightningQuizVouchers();

    const groups = [...document.querySelectorAll(".profile-exams__group")];
    expect(groups.map(g => g.querySelector("h4").textContent.replace(/\s+/g, " ").trim())).toEqual(["可使用 2 張", "已使用／已過期 2 張"]);
    expect([...groups[0].querySelectorAll(".lq-voucher__code")].map(el => el.textContent)).toEqual(["K7M2QX", "ERAJP5"]);
    const first = groups[0].querySelector(".lq-voucher");
    expect(first.querySelector(".lq-voucher__title strong").textContent).toBe("克勞斯 100 元抵用券");
    expect(first.querySelector(".lq-voucher__title span").textContent).toBe("雲柱測驗英雄榜・9/30（三）第二名");
    expect(first.querySelector(".lq-voucher__meta").textContent).toBe("有效期限至 10/20（二）");
    expect(first.querySelector("[data-voucher-redeem]").textContent).toBe("確認兌換");

    const past = [...groups[1].querySelectorAll(".lq-voucher")];
    expect(past.map(card => card.querySelector(".stat-badge").textContent)).toEqual(["已兌換", "已過期"]);
    expect(past[0].querySelector(".lq-voucher__meta").textContent).toBe("已於 10/5 14:30 兌換");
    expect(groups[1].querySelector("[data-voucher-redeem]")).toBeNull();
  });

  it("escapes names and shows an empty state when there are no vouchers", async () => {
    const { voucherCardHtml, renderVoucherListHtml } = await (async () => {
      setup({});
      return import("../js/modules/lightning-quiz-vouchers.mjs");
    })();
    expect(voucherCardHtml({ ...vouchers[0], name: "<b>甲</b>" })).toContain("&lt;b&gt;甲&lt;/b&gt;");
    expect(renderVoucherListHtml([])).toContain("目前沒有兌換券");
    expect(renderVoucherListHtml([{ ...vouchers[0], status: "void" }])).toContain("目前沒有兌換券");
  });

  it("redeems only after the confirm dialog, then reloads so the clerk sees 已兌換", async () => {
    const redeemed = { ...vouchers[1], status: "redeemed", redeemedAt: "2026-10-05T07:00:00Z", redeemedVia: "self" };
    const getMy = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { vouchers } })
      .mockResolvedValueOnce({ success: true, data: { vouchers: [vouchers[0], redeemed, vouchers[2], vouchers[3]] } });
    const redeem = vi.fn(async () => ({ success: true, data: redeemed }));
    setup({ getMyLightningQuizVouchers: getMy, redeemMyLightningQuizVoucher: redeem });
    const { refreshMyLightningQuizVouchers, bindMyVouchersPage } = await import("../js/modules/lightning-quiz-vouchers.mjs");
    bindMyVouchersPage();
    await refreshMyLightningQuizVouchers();

    // 取消就不兌換
    dom.window.showConfirmDialog.mockResolvedValueOnce(false);
    document.querySelector('[data-voucher-redeem="v2"]').click();
    await vi.waitFor(() => expect(dom.window.showConfirmDialog).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(redeem).not.toHaveBeenCalled();

    document.querySelector('[data-voucher-redeem="v2"]').click();
    await vi.waitFor(() => expect(getMy).toHaveBeenCalledTimes(2));
    expect(redeem).toHaveBeenCalledWith("v2");
    expect(dom.window.showConfirmDialog.mock.calls[1][0].message).toContain("K7M2QX");
    expect(dom.window.showToast).toHaveBeenCalledWith("已兌換，請把畫面給店員看。");
    expect(document.querySelector('[data-voucher-redeem="v2"]')).toBeNull();
  });

  it("shows the server's message when redeeming fails", async () => {
    setup({
      getMyLightningQuizVouchers: vi.fn(async () => ({ success: true, data: { vouchers } })),
      redeemMyLightningQuizVoucher: vi.fn(async () => ({ success: false, message: "這張兌換券已經過期了。" }))
    });
    const { refreshMyLightningQuizVouchers, bindMyVouchersPage } = await import("../js/modules/lightning-quiz-vouchers.mjs");
    bindMyVouchersPage();
    await refreshMyLightningQuizVouchers();
    document.querySelector('[data-voucher-redeem="v1"]').click();
    await vi.waitFor(() => expect(dom.window.showToast).toHaveBeenCalledWith("這張兌換券已經過期了。"));
  });
});

describe("後台兌換清單", () => {
  const adminList = [
    ...vouchers,
    { id: "v5", code: "ZZZ222", amount: 100, riseDate: "2026-09-28", rank: 2, name: "乙", pastoralZone: "", expiresOn: "2026-11-03", status: "void" },
    { id: "v6", code: "AAA333", amount: 100, riseDate: "2026-09-28", rank: 3, name: "丙", pastoralZone: "文山", expiresOn: "2026-11-03", status: "redeemed", redeemedAt: "2026-10-05T08:00:00Z", redeemedVia: "admin", redeemedByName: "管理員" }
  ];

  it("summarizes without counting voided vouchers as issued", () => {
    expect(summarizeVouchers(adminList)).toEqual({ issued: 5, available: 2, redeemed: 2, expired: 1, void: 1 });
  });

  it("exports a CSV with status, redemption time and who marked it", () => {
    const csv = buildVoucherCsv(adminList, new Date("2026-10-05T08:00:00Z"));
    expect(csv).toContain('"日期","名次","姓名","牧區","兌換碼","面額","狀態","有效期限","兌換時間","兌換方式","標記者"');
    expect(csv).toContain('"2026-09-28","第一名","甲","中永和","ERAJP5","100","可使用","2026-11-03","","",""');
    expect(csv).toContain('"2026-09-28","第二名","乙","","ZZZ222","100","已作廢"');
    expect(csv).toMatch(/"AAA333","100","已兌換","2026-11-03","2026\/10\/05 16:00","管理員標記","管理員"/);
    expect(csv).toMatch(/"HB3ZRT","100","已兌換","2026-10-21","2026\/10\/05 14:30","本人確認",""/);
  });
});

// ── 後端與串接 ──────────────────────────────────────────────────────────────

describe("wiring", () => {
  const migration = readFileSync("supabase/migrations/20261005110447_lightning_quiz_vouchers.sql", "utf8").replace(/\r\n/g, "\n");
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
  const db = readFileSync("js/db.js", "utf8");
  const html = readFileSync("index.html", "utf8").replace(/\r\n/g, "\n");
  const profile = readFileSync("js/modules/profile.js", "utf8");
  const admin = readFileSync("js/modules/admin.js", "utf8");
  const ranking = readFileSync("js/modules/lightning-quiz-ranking.mjs", "utf8");
  const manifest = JSON.parse(readFileSync("js/design/icon-manifest.json", "utf8"));
  const fnBody = name => {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    return migration.slice(start, migration.indexOf("$$;", start));
  };

  it("every new function is revoked from PUBLIC/anon/authenticated before granting", () => {
    const grants = {
      "_lightning_quiz_voucher_code()": "service_role",
      "_lightning_quiz_voucher_json(public.lightning_quiz_vouchers, date)": "service_role",
      "_lightning_quiz_sync_week_vouchers(date)": "service_role",
      "_lightning_quiz_week_rankings_sync_vouchers()": "service_role",
      "get_my_lightning_quiz_vouchers(uuid)": "authenticated, service_role",
      "redeem_my_lightning_quiz_voucher(uuid, uuid)": "authenticated, service_role",
      "admin_list_lightning_quiz_vouchers(date, uuid)": "authenticated, service_role",
      "admin_set_lightning_quiz_voucher_redeemed(uuid, boolean, uuid)": "authenticated, service_role"
    };
    for (const [sig, to] of Object.entries(grants)) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO ${to};`);
    }
    expect(migration).toContain("ALTER TABLE public.lightning_quiz_vouchers ENABLE ROW LEVEL SECURITY;");
    expect(migration).toContain("REVOKE ALL ON TABLE public.lightning_quiz_vouchers FROM PUBLIC, anon, authenticated;");
  });

  it("vouchers are issued per day and rank on publish, valid 30 days, and revoking does not touch them", () => {
    expect(migration).toContain("UNIQUE (week_start, rise_date, user_id)");
    expect(migration).toContain("today_tw + 29");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF entries ON public.lightning_quiz_week_rankings");
    // 重新公布：不在名單上、還沒兌換的作廢
    expect(fnBody("_lightning_quiz_sync_week_vouchers")).toMatch(/SET voided_at = NOW\(\)[\s\S]*AND v\.redeemed_at IS NULL/);
    // 已經公布的週補發一次
    expect(migration).toContain("WHERE revoked_at IS NULL LOOP\n    PERFORM public._lightning_quiz_sync_week_vouchers(wk);");
  });

  it("member functions only touch the caller's own vouchers; admin functions are admin-gated", () => {
    expect(fnBody("get_my_lightning_quiz_vouchers")).toContain("WHERE v.user_id = actor_id AND v.voided_at IS NULL");
    const redeem = fnBody("redeem_my_lightning_quiz_voucher");
    expect(redeem).toContain("WHERE id = p_voucher_id AND user_id = actor_id\n  FOR UPDATE;");
    expect(redeem).toContain("RAISE EXCEPTION 'lightning_quiz_voucher_already_redeemed'");
    expect(redeem).toContain("RAISE EXCEPTION 'lightning_quiz_voucher_expired'");
    for (const name of ["admin_list_lightning_quiz_vouchers", "admin_set_lightning_quiz_voucher_redeemed"]) {
      expect(fnBody(name)).toContain("IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN");
    }
  });

  it("nlc-data, db.js, profile, admin and the home card are wired up", () => {
    for (const fn of [
      "get_my_lightning_quiz_vouchers",
      "redeem_my_lightning_quiz_voucher",
      "admin_list_lightning_quiz_vouchers",
      "admin_set_lightning_quiz_voucher_redeemed"
    ]) {
      expect(nlcData).toContain(`"${fn}"`);
      expect(db).toContain(`_callLightningQuizRpc("${fn}"`);
    }
    expect(html).toContain('data-profile-open="vouchers"');
    expect(html).toContain('<div id="profile-tab-content-vouchers" class="profile-subpage hidden" aria-hidden="true">');
    expect(html).toContain('id="profile-vouchers-list"');
    expect(profile).toContain('if (key === "vouchers") void refreshMyLightningQuizVouchers();');
    expect(profile).toContain("bindMyVouchersPage();");
    expect(admin).toContain("void refreshVouchers();");
    expect(ranking).toContain('<h3 class="card-title">英雄榜</h3>');
    expect(ranking).toContain('href="#/profile/vouchers"');
    expect(manifest.ticket).toBe("Ticket");
  });
});
