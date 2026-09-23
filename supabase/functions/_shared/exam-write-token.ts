// 大測驗「作答專用寫入憑證」：nlc-data 簽發、exam-write 驗證。
//
// token = "v1." + base64url(HMAC-SHA256(EXAM_WRITE_SECRET, "exam-write:v1:<attemptId>:<userId>"))
//
// · 無狀態：不存 DB，驗證時用 attempt 的 user_id 重算比對。
// · 綁定「這一份作答 + 這個人」：拿去別份作答、或 attempt 換主都不會過。
// · 沒有自己的到期時間——有效範圍由 DB 函式本身把關：exam_save_progress 只收
//   in_progress 且未逾截止 + 120 秒；exam_submit_attempt 只在 in_progress 時才寫入。
//   送出後這張憑證就沒有任何可做的事。
// · 換密鑰（EXAM_WRITE_SECRET）＝所有已簽發的憑證立即失效，前端自動退回 nlc-data 路徑。

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signExamWriteToken(secret: string, attemptId: string, userId: string): Promise<string> {
  if (!secret || !attemptId || !userId) throw new Error("exam_write_token_args_missing");
  return "v1." + toBase64Url(await hmac(secret, `exam-write:v1:${attemptId}:${userId}`));
}

export async function verifyExamWriteToken(
  secret: string, attemptId: string, userId: string, token: unknown
): Promise<boolean> {
  if (!secret || !attemptId || !userId || typeof token !== "string" || !token.startsWith("v1.")) return false;
  const expected = await signExamWriteToken(secret, attemptId, userId);
  return timingSafeEqual(expected, token);
}
