// 舊管理畫面（#550）入口的第一個匯入：在會友 App 的核心鏈（state.js、db.js…）載入前，
// 先把它們依賴的全域準備好。順序重要：legacy-entry.js 一定要先 import 這支。
//
//   · localStorage／sessionStorage 換成記憶體版（後台網域不留個資）
//   · SUPABASE_CONFIG／NLC_CONFIG／APP_CONFIG：會友 App 由 config.js 產生，這裡由 build-admin.mjs
//     用 esbuild define 注入 __ADMIN_LEGACY_CONFIG__（Supabase 網址與 anon key 本來就是公開的）
//   · window.auth／window.authLaunch：向後台外殼要 token 的版本（legacy-auth.mjs）
//   · index.html 內嵌腳本原本會設的空白預設值（內嵌腳本在後台的 CSP 下不能跑）
import { installMemoryStorage } from "./memory-storage.mjs";
import { createLegacyAuth } from "./legacy-auth.mjs";

installMemoryStorage(window);

const config = __ADMIN_LEGACY_CONFIG__;

window.APP_CONFIG = { appVersion: "admin-legacy", onboardingVersion: "admin-legacy" };
window.APP_VERSION = window.APP_CONFIG.appVersion;
window.SUPABASE_CONFIG = { url: config.supabaseUrl, anonKey: config.anonKey };
window.NLC_CONFIG = {
  clientId: "",
  issuer: config.issuer,
  memberHubUrl: config.memberHubUrl,
  scopes: "",
  platformResource: config.resource
};

const { auth, authLaunch } = createLegacyAuth({
  memberHubUrl: config.memberHubUrl,
  storage: window.localStorage,
  openWindow: (url) => window.open(url, "_blank", "noopener,noreferrer")
});
window.auth = auth;
window.authLaunch = authLaunch;

window.__bootMark = () => {};
window.MOCK_USERS_DATA = [];
window.MockStatsService = null;
window.MOCK_GREAT_REGIONS = [];
window.MOCK_PASTORAL_ZONES = [];
window.MOCK_SMALL_GROUPS = {};
window.getMockCareReminders = () => [];
window.dismissMockCareReminder = () => {};
