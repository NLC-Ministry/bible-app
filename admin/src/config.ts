// 後台設定（#555）：建置時由 scripts/build-admin.mjs 用 esbuild define 注入 __ADMIN_CONFIG__，
// 來源是 Vercel 後台專案的環境變數（見 docs/admin-console.md）。測試直接傳設定物件，不經過這裡。

export type AdminEnvironment = "production" | "staging" | "local";

export type AdminConfig = {
  issuer: string;      // Logto 發行者，例如 https://sso.newlife.org.tw/oidc
  clientId: string;    // 後台專用的 Logto 應用程式（#554），正式站與 staging 各一
  resource: string;    // access token 的 resource（要 JWT 才能給 admin-api 驗）
  scopes: string;      // 不含 offline_access：不發 refresh token
  apiUrl: string;      // admin-api 的完整網址
  environment: AdminEnvironment;
};

declare const __ADMIN_CONFIG__: AdminConfig | undefined;

export function readAdminConfig(): AdminConfig {
  if (typeof __ADMIN_CONFIG__ === "undefined" || !__ADMIN_CONFIG__) {
    throw new Error("admin config missing: build with scripts/build-admin.mjs");
  }
  return __ADMIN_CONFIG__;
}

export const ENVIRONMENT_LABEL: Record<AdminEnvironment, string> = {
  production: "正式站",
  staging: "測試站",
  local: "本機"
};
