// #677：久沒登入的會友回來時容易換一種登入方式，Logto 給新的 sub，App 就開出空帳號。
// 登入成功後在裝置記下這次的方式，登入卡顯示一行提醒。只存遮罩值，一般登出不清。
//
// 建立未滿 30 天又沒有計畫的帳號不記：分裂後開的空帳號如果記下來，提醒就會指向它，
// 不是原本有計畫的舊帳號。建立時間不明又沒有計畫時也不記。
import {
  ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS,
  currentLoginMethod,
  isGmailAccount
} from "./modules/account-switch-hint.mjs";
import { OFFLINE_IDENTITY_KEY, parseOfflineIdentity } from "./data/offline-identity.mjs";

export const LAST_LOGIN_METHOD_KEY = "nlc_last_login_method";
const DAY_MS = 24 * 60 * 60 * 1000;

function defaultStorage() {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function shouldRemember({ accountCreatedAt, hasAnyPlan, now }) {
  if (hasAnyPlan) return true;
  const createdAt = Date.parse(String(accountCreatedAt || ""));
  return Number.isFinite(createdAt) && now - createdAt > ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS * DAY_MS;
}

/** 記下這次的登入方式，回傳記下的內容；這個帳號不該記或存不了就回 null。 */
export function rememberLoginMethod({
  user,
  accountCreatedAt,
  hasAnyPlan,
  profileId,
  storage = defaultStorage(),
  now = Date.now()
} = {}) {
  if (!storage || !shouldRemember({ accountCreatedAt, hasAnyPlan, now })) return null;
  const record = currentLoginMethod(user);
  // 帳號 ID 只用來判斷「現在這個帳號是不是裝置記得的那個」（#664），不是憑證，伺服器完全不看。
  if (profileId) record.profileId = String(profileId);
  try {
    storage.setItem(LAST_LOGIN_METHOD_KEY, JSON.stringify(record));
  } catch (_) {
    return null;
  }
  return record;
}

function parseRecord(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.method === "phone" || parsed.method === "email") && parsed.masked) {
      const record = { method: parsed.method, masked: String(parsed.masked) };
      if (parsed.profileId) record.profileId = String(parsed.profileId);
      return record;
    }
    return parsed && parsed.method === "" ? { method: "", masked: "" } : null;
  } catch (_) {
    return null;
  }
}

function hasStoredPlans(storage) {
  try {
    const plans = JSON.parse(storage.getItem("active_reading_plans") || "[]");
    return Array.isArray(plans) && plans.length > 0;
  } catch (_) {
    return false;
  }
}

// 第一次升級的裝置還沒有紀錄：從身分快照帶入。這裡只取遮罩後的方式，不拿快照當身分，
// 所以過期的快照也可以讀。
function seedFromIdentitySnapshot(storage, now) {
  const profile = parseOfflineIdentity(storage.getItem(OFFLINE_IDENTITY_KEY))?.profile;
  if (!profile?.id) return null;
  return rememberLoginMethod({
    user: profile,
    accountCreatedAt: profile.created_at,
    hasAnyPlan: hasStoredPlans(storage),
    profileId: profile.id,
    storage,
    now
  });
}

/** 讀裝置上的紀錄（沒有就試著從快照帶入）；都沒有回 null。 */
export function readLastLoginMethod({ storage = defaultStorage(), now = Date.now() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_LOGIN_METHOD_KEY);
    return raw ? parseRecord(raw) : seedFromIdentitySnapshot(storage, now);
  } catch (_) {
    return null;
  }
}

export function loginMethodHintText(record) {
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.loginMethodHint) || {};
  const fill = template => template.replace("{account}", () => record.masked);
  // #682：紀錄只知道帳號有手機還是 Email，分不出密碼、Google、LINE，所以不斷定登入方式。
  // Gmail 例外：Logto 會把相同 Email 的 Google 連到同一個帳號，按 Google 不會開出新帳號。
  if (record && record.method === "phone") {
    return fill(copy.phone || "上次在這台裝置登入的帳號是 {account}。請用當時的方式才看得到你的計畫：按 LINE、按 Google，或輸入手機和密碼。");
  }
  if (record && record.method === "email") {
    if (isGmailAccount(record.masked)) {
      return fill(copy.gmail || "上次在這台裝置登入的帳號是 {account}。請按 Google 登入，才看得到你的計畫；如果你有設密碼，也可以輸入密碼。");
    }
    return fill(copy.email || "上次在這台裝置登入的帳號是 {account}。請用當時的方式才看得到你的計畫：按 Google、按 LINE，或輸入 Email 和密碼。");
  }
  return copy.unknown || "請用跟上次相同的方式（手機、Email、Google 或 LINE）登入，才看得到你的計畫。";
}

/** 畫在登入卡上；visible=false 用在不是要會友登入的畫面（沒註冊、資料讀不到等）。 */
export function renderLoginMethodHint(loginGate, { visible = true, storage = defaultStorage(), now = Date.now() } = {}) {
  const el = loginGate && typeof loginGate.querySelector === "function"
    ? loginGate.querySelector("[data-login-method-hint]")
    : null;
  if (!el) return;
  if (visible) el.textContent = loginMethodHintText(readLastLoginMethod({ storage, now }));
  el.classList.toggle("hidden", !visible);
}
