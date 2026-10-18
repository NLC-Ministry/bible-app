// 後台入口（#555）：admin/admin.html → 這支 → scripts/build-admin.mjs 打包成 dist-admin/。
// 不載入會友 App 的任何核心檔（state.js、db.js 等全域），只呼叫 admin-api。不註冊 Service Worker。
import "./admin.css";
import { createRoot } from "react-dom/client";
import { createAdminApi } from "./src/api.ts";
import { createAdminAuth } from "./src/auth.ts";
import { readAdminConfig } from "./src/config.ts";
import { AdminApp } from "./src/App.tsx";

const config = readAdminConfig();

const auth = createAdminAuth({
  config,
  location: window.location,
  history: window.history,
  storage: window.sessionStorage
});

// token 過期（或被拒）→ 帶著目前的頁面重新導向 SSO；同時多個請求失敗只導一次
let redirecting = false;
const api = createAdminApi({
  url: config.apiUrl,
  getToken: () => auth.getToken(),
  onUnauthorized: () => {
    if (redirecting) return;
    redirecting = true;
    auth.login(window.location.hash).catch(() => { redirecting = false; });
  }
});

const container = document.getElementById("admin-root");
if (container) {
  createRoot(container).render(<AdminApp auth={auth} api={api} environment={config.environment} win={window} />);
}
