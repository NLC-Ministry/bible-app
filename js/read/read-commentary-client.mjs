// /read 讀經頁的經文注釋資料來源（#470）。
// /read 不載 auth.js／db.js（#416）：這裡只用 localStorage 裡「還沒過期」的登入 token
// 直接打 nlc-data 讀已發布的注釋。沒登入、token 過期或被拒，就當作沒有注釋——
// 絕不續期、不觸發登入（續期由 read-login-keepalive.mjs 在背景處理，下一次換章就讀得到）。
// 查詢只在經文顯示完之後才發（reader-commentary.mjs 排在閒置時間）。

import { createCommentaryRepository } from "../data/commentary-repository.mjs";

export const ACCESS_TOKEN_KEY = "nlc_access_token";
export const TOKEN_EXPIRES_AT_KEY = "nlc_token_expires_at";
const TOKEN_SKEW_MS = 2 * 60 * 1000; // 同 auth.js 的提前量，快過期的 token 不拿來用
const REQUEST_TIMEOUT_MS = 10000;

export function readUsableAccessToken(storage, now = Date.now()) {
  try {
    const token = storage.getItem(ACCESS_TOKEN_KEY);
    const expiresAt = Number(storage.getItem(TOKEN_EXPIRES_AT_KEY) || 0);
    if (!token || !Number.isFinite(expiresAt) || now > expiresAt - TOKEN_SKEW_MS) return null;
    return token;
  } catch {
    return null;
  }
}

// 只做讀取：select／eq／in／order／range，送出格式同 db.js 的 NlcQueryBuilder。
function createSelectBuilder(table, send) {
  const request = { table, action: "select", select: "*", filters: [] };
  const builder = {
    request,
    select(columns = "*") { request.select = columns; return builder; },
    eq(column, value) { request.filters.push({ type: "eq", column, value }); return builder; },
    in(column, value) { request.filters.push({ type: "in", column, value }); return builder; },
    order(column, options = {}) {
      const entry = { column, ascending: options.ascending !== false };
      request.orders = [...(request.orders || []), entry];
      if (!request.order) request.order = entry;
      return builder;
    },
    range(from, to) { request.range = { from, to }; return builder; },
    then(resolve, reject) { return send(request).then(resolve, reject); }
  };
  return builder;
}

export function createReadCommentaryDb({ storage, config, fetchImpl = (...args) => fetch(...args), now = () => Date.now() }) {
  const baseUrl = String(config?.url || "").replace(/\/+$/, "");
  const anonKey = String(config?.anonKey || "");

  async function send(request) {
    const token = readUsableAccessToken(storage, now());
    if (!baseUrl || !token) return { data: null, error: { message: "not_signed_in" } };
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetchImpl(`${baseUrl}/functions/v1/nlc-data`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller?.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { data: null, error: payload || { message: `http_${response.status}` } };
      return { data: payload.data ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: String(error?.message || error) } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const repository = createCommentaryRepository({ from: table => createSelectBuilder(table, send), storage, now });
  return {
    // 沒登入時不打 API，也不記成「查詢失敗」——登入後下一次換章就會查。
    fetchIndex: () => (readUsableAccessToken(storage, now()) ? repository.fetchIndex() : Promise.resolve(new Set())),
    fetchChapter: (book, chapter) => repository.fetchChapter(book, chapter),
    fetchTermDetails: ids => repository.fetchTermDetails(ids)
  };
}
