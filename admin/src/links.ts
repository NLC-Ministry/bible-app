// 後台 ↔ 會友 App 的固定網址（#555）。網址寫死，不從網頁內容推算：
// 後台網址看起來不像教會官方的，請管理員從書籤或這裡的連結進入。
import type { AdminEnvironment } from "./config.ts";

export const MEMBER_APP_URL: Record<AdminEnvironment, string> = {
  production: "https://bible.newlife.org.tw",
  staging: "https://bible-speed-reading-staging.vercel.app",
  local: "https://bible-speed-reading-staging.vercel.app"
};

/** 還沒搬進後台的管理功能（#550）先回 App 的管理分頁。 */
export function memberAppAdminUrl(environment: AdminEnvironment): string {
  return `${MEMBER_APP_URL[environment]}/#/admin`;
}
