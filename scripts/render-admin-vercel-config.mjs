// 後台部署前：vercel.admin.json（含占位符）→ vercel.json（填入 Supabase 網址）。
// CI 的「Deploy admin console」步驟呼叫；ref 來自環境變數 SUPABASE_PRODUCTION_REF／SUPABASE_STAGING_REF。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAdminVercelConfig } from "./lib/admin-vercel-config.mjs";

export function renderToFile(source = "vercel.admin.json", target = "vercel.json") {
  const rendered = renderAdminVercelConfig(readFileSync(source, "utf8"), { strict: true });
  JSON.parse(rendered); // 換完仍是合法 JSON 才寫
  writeFileSync(target, rendered);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    renderToFile();
    console.log("wrote vercel.json from vercel.admin.json");
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
