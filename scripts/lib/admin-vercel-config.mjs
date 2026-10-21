// vercel.admin.json（後台專案的 Vercel 設定）裡的 CSP 要列出兩個 Supabase 專案的網址，
// 但 project ref 不寫進 repo（#609），所以檔案裡放占位符，部署前／建置檢查時再換成真值。
import { REF_ENV_NAMES, loadProjectRefs } from "./project-refs.mjs";

export const ORIGIN_PLACEHOLDERS = Object.freeze({
  production: "__SUPABASE_PRODUCTION_ORIGIN__",
  staging: "__SUPABASE_STAGING_ORIGIN__"
});

export const isOriginPlaceholder = (value) => Object.values(ORIGIN_PLACEHOLDERS).includes(value);

/**
 * 把占位符換成 https://<ref>.supabase.co。
 * strict=true（部署用）：缺 ref 就丟錯；strict=false（建置檢查用）：沒有 ref 的占位符保持原樣。
 */
export function renderAdminVercelConfig(text, { refs = loadProjectRefs(), strict = false } = {}) {
  let out = String(text);
  for (const [environment, placeholder] of Object.entries(ORIGIN_PLACEHOLDERS)) {
    if (!out.includes(placeholder)) continue;
    const ref = refs[environment];
    if (!ref) {
      if (strict) throw new Error(`缺少 ${REF_ENV_NAMES[environment]}，無法產生後台的 vercel.json（設定方式見 docs/admin-console.md）`);
      continue;
    }
    out = out.split(placeholder).join(`https://${ref}.supabase.co`);
  }
  return out;
}
