// #606：nlc-data / nlc-session 最外層 catch 不把內部錯誤字串回給呼叫端。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildInternalErrorBody, INTERNAL_ERROR_MESSAGE } from "../supabase/functions/_shared/internal-error-body.mjs";

describe("buildInternalErrorBody", () => {
  it("回固定訊息與 request id，不含內部字串", () => {
    const internal = 'duplicate key value violates unique constraint "profiles_pkey"';
    const body = buildInternalErrorBody("nlc_data_failed", "req-12345678");
    const text = JSON.stringify(body);
    expect(text).not.toContain(internal);
    expect(body).toEqual({ error: "nlc_data_failed", message: INTERNAL_ERROR_MESSAGE, request_id: "req-12345678" });
  });
});

describe("兩支 Edge Function 的最外層 catch 走共用 helper", () => {
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
  const nlcSession = readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

  it("nlc-data：最後的 500 用 helper，不再回 errorDetails", () => {
    expect(nlcData).toContain('buildInternalErrorBody("nlc_data_failed", requestId)');
    expect(nlcData).not.toMatch(/error: "nlc_data_failed", message: errorDetails/);
  });

  it("nlc-session：500 用 helper，不再回 err.message", () => {
    expect(nlcSession).toContain('buildInternalErrorBody("nlc_session_failed", requestId)');
    expect(nlcSession).not.toMatch(/message: err instanceof Error \? err\.message : String\(err\)/);
  });

  it("錯誤代碼不變（前端／後台依賴 error 欄位）", () => {
    expect(nlcData).toContain("nlc_data_failed");
    expect(nlcSession).toContain("nlc_session_failed");
  });
});
