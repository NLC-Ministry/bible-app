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
// 同 auth.js 的 keys.accessToken。
export const ACCESS_TOKEN_KEY = "nlc_access_token";
const DAY_MS = 24 * 60 * 60 * 1000;
// #693：Logto Custom JWT 只在速讀 App 的 access token 加 nlc_login：
// { pw: 帳號有沒有設密碼, social: 綁了哪些社群登入的連接器名稱 }。不含社群帳號 ID。
const LOGIN_CLAIM = "nlc_login";
const CONNECTOR_NAME = /^[a-z0-9_-]{1,20}$/;
// 顯示順序：LINE 註冊的人最多，排前面。不在表上的連接器不提。
const SOCIAL_LABELS = [["line", "LINE"], ["google", "Google"]];
// 中英文之間留空格：「輸入手機和密碼」「輸入 Email 和密碼」，所以 Email 自帶空格。
const CREDENTIAL_LABELS = { phone: "手機", email: " Email " };

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}

function normalizeLoginClaim(value) {
  if (!value || typeof value.pw !== "boolean" || !Array.isArray(value.social)) return null;
  return {
    pw: value.pw,
    social: value.social.filter(name => typeof name === "string" && CONNECTOR_NAME.test(name))
  };
}

/** 讀裝置上 access token 的 nlc_login；舊 token、其他 App 的 token、不透明 token 都回 null。 */
export function readLoginClaim(storage = defaultStorage()) {
  try {
    return normalizeLoginClaim(decodeJwtPayload(storage && storage.getItem(ACCESS_TOKEN_KEY))?.[LOGIN_CLAIM]);
  } catch (_) {
    return null;
  }
}

function defaultStorage() {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function shouldRemember({ accountCreatedAt, hasAnyPlan, now }) {
  if (hasAnyPlan) return true;
  const createdAt = Date.parse(String(accountCreatedAt || ""));
  return Number.isFinite(createdAt) && now - createdAt > ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS * DAY_MS;
}

/**
 * 記下這次的登入方式，回傳記下的內容；這個帳號不該記或存不了就回 null。
 * loginClaim 沒給就讀裝置上剛存的 access token（#693）；給 null 表示不讀。
 */
export function rememberLoginMethod({
  user,
  accountCreatedAt,
  hasAnyPlan,
  profileId,
  storage = defaultStorage(),
  now = Date.now(),
  loginClaim
} = {}) {
  if (!storage || !shouldRemember({ accountCreatedAt, hasAnyPlan, now })) return null;
  const record = currentLoginMethod(user);
  // 帳號 ID 只用來判斷「現在這個帳號是不是裝置記得的那個」（#664），不是憑證，伺服器完全不看。
  if (profileId) record.profileId = String(profileId);
  const claim = loginClaim === undefined ? readLoginClaim(storage) : normalizeLoginClaim(loginClaim);
  if (claim) Object.assign(record, claim);
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
    let record = null;
    if (parsed && (parsed.method === "phone" || parsed.method === "email") && parsed.masked) {
      record = { method: parsed.method, masked: String(parsed.masked) };
      if (parsed.profileId) record.profileId = String(parsed.profileId);
    } else if (parsed && parsed.method === "") {
      record = { method: "", masked: "" };
    }
    const claim = record && normalizeLoginClaim(parsed);
    if (claim) Object.assign(record, claim);
    return record;
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
    now,
    // 快照可能比裝置上的 token 舊（中間換過帳號），不拿 token 的登入方式配它（#693）。
    loginClaim: null
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

// #693：token 說得出帳號有沒有密碼、綁了哪些社群登入，就直接說該按哪個。說不準時回 null，走舊的文字。
function claimHintText(record, copy) {
  if (!record || !Array.isArray(record.social) || typeof record.pw !== "boolean") return null;
  const socials = SOCIAL_LABELS.filter(([name]) => record.social.includes(name)).map(([, label]) => label);
  const social = socials.join(" 或 ");
  const credential = CREDENTIAL_LABELS[record.method] || "";
  const fill = template => template
    .replace(/\{account\}/g, () => record.masked)
    .replace(/\{social\}/g, () => social)
    .replace(/\{credential\}/g, () => credential);
  if (!record.pw) {
    if (!social) return null;
    return record.masked
      ? fill(copy.socialOnly || "上次在這台裝置登入的帳號是 {account}，沒有設密碼。請按 {social} 登入，才看得到你的計畫。")
      : fill(copy.socialOnlyNoAccount || "上次在這台裝置登入的帳號沒有設密碼。請按 {social} 登入，才看得到你的計畫。");
  }
  if (!record.masked || !credential) return null;
  return social
    ? fill(copy.socialAndPassword || "上次在這台裝置登入的帳號是 {account}。請按 {social} 登入，或輸入{credential}和密碼，才看得到你的計畫。")
    : fill(copy.passwordOnly || "上次在這台裝置登入的帳號是 {account}。請輸入{credential}和密碼登入，才看得到你的計畫。");
}

export function loginMethodHintText(record) {
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.loginMethodHint) || {};
  const fromClaim = claimHintText(record, copy);
  if (fromClaim) return fromClaim;
  const fill = template => template.replace("{account}", () => record.masked);
  // #682：紀錄只知道帳號有手機還是 Email，分不出密碼、Google、LINE，所以不斷定登入方式。
  // #698：也不列出密碼和各個按鈕：多數人沒設過密碼，猜錯社群登入又會開出空帳號，所以請他先問同工。
  // Gmail 例外：Logto 會把相同 Email 的 Google 連到同一個帳號，按 Google 不會開出新帳號。
  if (record && record.method === "phone") {
    return fill(copy.phone || "上次在這台裝置登入的帳號是 {account}。請用當時的方式登入，才看得到你的計畫；不確定當時怎麼登入的，請先問小組或牧區同工，不要每種方式都試，以免開出另一個看不到計畫的新帳號。");
  }
  if (record && record.method === "email") {
    if (isGmailAccount(record.masked)) {
      return fill(copy.gmail || "上次在這台裝置登入的帳號是 {account}。請按 Google 登入，才看得到你的計畫。");
    }
    return fill(copy.email || "上次在這台裝置登入的帳號是 {account}。請用當時的方式登入，才看得到你的計畫；不確定當時怎麼登入的，請先問小組或牧區同工，不要每種方式都試，以免開出另一個看不到計畫的新帳號。");
  }
  return copy.unknown || "請用跟上次相同的方式登入，才看得到你的計畫；不確定上次怎麼登入的，請先問小組或牧區同工，不要每種方式都試，以免開出另一個看不到計畫的新帳號。";
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
