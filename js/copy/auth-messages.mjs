// #648：登入相關說法只留一套——動作說「登入／登出」，東西叫「帳號」，原因說「登入過期了」。
// 程式判斷登入過期一律看 code（或伺服器的錯誤代碼），不要比對這裡的文字：文字隨時可能再改。
export const AUTH_SESSION_EXPIRED_CODE = "AUTH_SESSION_EXPIRED";
export const SESSION_EXPIRED_MESSAGE = "登入過期了，請再登入一次。讀經進度不會不見。";

export function createSessionExpiredError() {
  const error = new Error(SESSION_EXPIRED_MESSAGE);
  error.code = AUTH_SESSION_EXPIRED_CODE;
  return error;
}

// 前端放棄續期（createSessionExpiredError），或伺服器拒絕 token／找不到這個登入對應的帳號。
export function isAuthExpiredError(error) {
  if (!error) return false;
  if (error.code === AUTH_SESSION_EXPIRED_CODE) return true;
  const raw = String(error.error || error.message || "").toLowerCase();
  return raw.includes("invalid_logto_token") || raw.includes("invalid_token") || raw.includes("profile_identity_not_found");
}
