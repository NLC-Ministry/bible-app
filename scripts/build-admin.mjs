// scripts/build-admin.mjs — 後台（#555）建置：admin/admin.html + admin/admin-entry.tsx → dist-admin/
//
// 後台是另一個 Vercel 專案（設定檔 vercel.admin.json，CI 部署前換成 vercel.json），網域和會友 App 分開：
//   · dist-admin/ 只有後台：index.html、admin.<hash>.js、admin.<hash>.css、favicon.svg、robots.txt。
//     會友 App 的 dist/ 也不會有後台的任何檔案（scripts/admin-console.test.mjs 檢查兩邊）。
//   · 設定（Logto client、admin-api 網址）在建置時寫進 bundle（esbuild define），來源是環境變數：
//       ADMIN_LOGTO_CLIENT_ID   必填。後台專用的 Logto 應用程式（#554），正式站與 staging 各一
//       ADMIN_API_URL           admin-api 網址；沒設就用 SUPABASE_URL + /functions/v1/admin-api
//       ADMIN_LOGTO_ISSUER      預設 https://sso.newlife.org.tw/oidc
//       ADMIN_LOGTO_RESOURCE    預設 https://platform.newlife.org.tw（要 JWT access token）
//       ADMIN_LOGTO_SCOPES      預設 "openid profile email"；不可含 offline_access（不要 refresh token）
//       ADMIN_ENVIRONMENT       production / staging / local；沒設就看 admin-api 網址是哪個 Supabase 專案
//     本機建置時也會讀專案根目錄的 .env（環境變數優先）。
//   · 建置時檢查 vercel.admin.json 的 CSP 有放行 admin-api 和 Logto，不然上線後整頁連不出去。
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ADMIN_OUT_DIR = "dist-admin";
const PRODUCTION_REF = "ztozevcqkfrohgjmngcj";
const STAGING_REF = "dbtjsljrytzonjvclgrd";
const CSS_PLACEHOLDER = "<!-- build:admin-css -->";
const JS_PLACEHOLDER = "<!-- build:admin-js -->";

export function readDotEnv(root) {
  const path = join(root, ".env");
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const at = trimmed.indexOf("=");
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname));
  } catch (_err) {
    return false;
  }
}

export function resolveAdminConfig(env) {
  const get = (key) => String(env[key] ?? "").trim();
  const clientId = get("ADMIN_LOGTO_CLIENT_ID");
  if (!clientId) {
    throw new Error("build-admin: ADMIN_LOGTO_CLIENT_ID is required (the admin console's own Logto app, see docs/admin-console.md)");
  }
  const supabaseUrl = get("SUPABASE_URL").replace(/\/+$/, "");
  const apiUrl = get("ADMIN_API_URL") || (supabaseUrl ? `${supabaseUrl}/functions/v1/admin-api` : "");
  if (!apiUrl) throw new Error("build-admin: set ADMIN_API_URL (or SUPABASE_URL)");
  const issuer = (get("ADMIN_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc").replace(/\/+$/, "");
  const resource = get("ADMIN_LOGTO_RESOURCE") || "https://platform.newlife.org.tw";
  const scopes = get("ADMIN_LOGTO_SCOPES") || "openid profile email";
  for (const [name, value] of [["ADMIN_API_URL", apiUrl], ["ADMIN_LOGTO_ISSUER", issuer], ["ADMIN_LOGTO_RESOURCE", resource]]) {
    if (!isAllowedUrl(value)) throw new Error(`build-admin: ${name} must be an https URL (got ${JSON.stringify(value)})`);
  }
  if (/\boffline_access\b/.test(scopes)) {
    throw new Error("build-admin: ADMIN_LOGTO_SCOPES must not include offline_access (the admin console never holds a refresh token)");
  }
  const explicitEnv = get("ADMIN_ENVIRONMENT");
  if (explicitEnv && !["production", "staging", "local"].includes(explicitEnv)) {
    throw new Error(`build-admin: ADMIN_ENVIRONMENT must be production, staging or local (got ${JSON.stringify(explicitEnv)})`);
  }
  const environment = explicitEnv
    || (apiUrl.includes(PRODUCTION_REF) ? "production" : apiUrl.includes(STAGING_REF) ? "staging" : "local");
  return { issuer, clientId, resource, scopes, apiUrl, environment };
}

/** vercel.admin.json 的 CSP（強制，不是觀察模式）。 */
export function readAdminCsp(root) {
  const config = JSON.parse(readFileSync(join(root, "vercel.admin.json"), "utf8"));
  for (const rule of config.headers || []) {
    for (const header of rule.headers || []) {
      if (header.key === "Content-Security-Policy") return header.value;
    }
  }
  return "";
}

export function cspDirective(csp, name) {
  const part = csp.split(";").map((item) => item.trim()).find((item) => item === name || item.startsWith(`${name} `));
  return part ? part.split(/\s+/).slice(1) : null;
}

export function assertCspAllowsConfig(csp, config) {
  const connect = cspDirective(csp, "connect-src") || [];
  const missing = [new URL(config.apiUrl).origin, new URL(config.issuer).origin].filter((origin) => !connect.includes(origin));
  if (missing.length) {
    throw new Error(`build-admin: vercel.admin.json CSP connect-src does not allow ${missing.join(", ")}; the console could not reach it`);
  }
}

export async function buildAdmin({ root, outDir = join(root, ADMIN_OUT_DIR), env }) {
  const config = resolveAdminConfig(env);
  const csp = readAdminCsp(root);
  if (config.environment === "local") {
    try {
      assertCspAllowsConfig(csp, config);
    } catch (err) {
      console.warn(`[build-admin] ${err.message}（本機預覽不套用 vercel.admin.json，先繼續）`);
    }
  } else {
    assertCspAllowsConfig(csp, config);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const result = await build({
    absWorkingDir: root,
    entryPoints: { admin: join(root, "admin", "admin-entry.tsx") },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    outdir: outDir,
    entryNames: "[name].[hash]",
    assetNames: "[name].[hash]",
    charset: "utf8",
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    define: {
      __ADMIN_CONFIG__: JSON.stringify(config),
      "process.env.NODE_ENV": JSON.stringify("production")
    }
  });

  const outputs = Object.keys(result.metafile.outputs).map((file) => resolve(root, file));
  const jsPath = outputs.find((file) => /admin\.[A-Z0-9]+\.js$/i.test(file));
  const cssPath = outputs.find((file) => /admin\.[A-Z0-9]+\.css$/i.test(file));
  if (!jsPath || !cssPath) throw new Error(`build-admin: esbuild did not emit admin js/css (${outputs.join(", ")})`);
  const jsFile = jsPath.slice(jsPath.lastIndexOf("admin."));
  const cssFile = cssPath.slice(cssPath.lastIndexOf("admin."));

  const source = readFileSync(join(root, "admin", "admin.html"), "utf8");
  if (!source.includes(CSS_PLACEHOLDER) || !source.includes(JS_PLACEHOLDER)) {
    throw new Error("build-admin: admin/admin.html is missing its build placeholders");
  }
  const html = source
    .replace(CSS_PLACEHOLDER, `<link rel="stylesheet" href="/${cssFile}">`)
    .replace(JS_PLACEHOLDER, `<script type="module" src="/${jsFile}"></script>`);
  // CSP 不允許行內腳本與行內樣式：建置時就擋下來，不要等上線才整頁壞掉
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\sstyle\s*=/i.test(html) || /<style[\s>]/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    throw new Error("build-admin: admin.html must not contain inline scripts, styles or event handlers (CSP)");
  }
  writeFileSync(join(outDir, "index.html"), html, "utf8");
  copyFileSync(join(root, "assets", "bible-reading-icon.svg"), join(outDir, "favicon.svg"));
  writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");

  return { jsFile, cssFile, config };
}

const currentPath = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === currentPath) {
  const root = dirname(dirname(currentPath));
  const env = { ...readDotEnv(root), ...process.env };
  buildAdmin({ root, env })
    .then(({ jsFile, cssFile, config }) => {
      console.log(`build-admin: wrote ${ADMIN_OUT_DIR}/index.html, ${jsFile}, ${cssFile} (${config.environment}, api ${config.apiUrl})`);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
