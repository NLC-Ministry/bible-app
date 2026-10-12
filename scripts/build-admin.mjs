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
//       ADMIN_LOGTO_SCOPES      預設 "openid profile email member:read.basic"；不可含 offline_access（不要 refresh token）
//                               member:read.basic：照搬的舊管理區塊（#550）照舊經 nlc-session 同步會員中心資料
//       ADMIN_ENVIRONMENT       production / staging / local；沒設就看 admin-api 網址是哪個 Supabase 專案
//     本機建置時也會讀專案根目錄的 .env（環境變數優先）。
//   · 建置時檢查 vercel.admin.json 的 CSP 有放行 admin-api 和 Logto，不然上線後整頁連不出去。
//
// 「照搬」的舊管理區塊（#550）是同網域的另一頁 dist-admin/legacy（後台外殼用 iframe 開）：
//   · admin-legacy/legacy-entry.js 打包成 legacy.<hash>.js：會友 App 管理分頁的同一份程式
//   · 畫面是建置時從 index.html 抽出的 <body>（拿掉 <script> 與行內事件處理器），保留所有 DOM id
//   · 樣式：index.css 與另外兩支管理樣式、Tailwind、admin-legacy/legacy.css 合成 legacy.<hash>.css
//   · 需要的環境變數：SUPABASE_ANON_KEY（必填；本機可省略）、SUPABASE_URL（沒設就從 admin-api 網址推）、
//     NLC_MEMBER_HUB_URL（選填）
//   · CSP 另一套（vercel.admin.json 的 /legacy(.*)）：樣式允許行內（舊程式大量用 style=""），腳本仍只有自家
//     ＋鎖版本的 Chart.js；建置時檢查放行了 Supabase 與 Chart.js。
import { build, transform } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTailwindCss, contentHash, cpDirRecursive, resolveLocalAssets } from "./bundle.mjs";
import { LEGACY_SECTION_IDS } from "../admin-legacy/sections.mjs";

export const ADMIN_OUT_DIR = "dist-admin";
const PRODUCTION_REF = "ztozevcqkfrohgjmngcj";
const STAGING_REF = "dbtjsljrytzonjvclgrd";
const CSS_PLACEHOLDER = "<!-- build:admin-css -->";
const JS_PLACEHOLDER = "<!-- build:admin-js -->";
const LEGACY_CSS_PLACEHOLDER = "<!-- build:legacy-css -->";
const LEGACY_MARKUP_PLACEHOLDER = "<!-- build:legacy-markup -->";
const LEGACY_JS_PLACEHOLDER = "<!-- build:legacy-js -->";

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
  const scopes = get("ADMIN_LOGTO_SCOPES") || "openid profile email member:read.basic";
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

// vercel.admin.json 的兩套 CSP：後台外殼（/legacy 以外）與舊管理畫面（/legacy…）
export const CONSOLE_HEADER_SOURCE = "/((?!legacy).*)";
export const LEGACY_HEADER_SOURCE = "/legacy(.*)";
// js/modules/chart-loader.mjs 載入的 Chart.js（鎖版本）；舊管理畫面的 CSP 只放行這一個檔
export const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1";

export function readHeader(root, source, key) {
  const config = JSON.parse(readFileSync(join(root, "vercel.admin.json"), "utf8"));
  const rule = (config.headers || []).find((item) => item.source === source);
  const header = (rule?.headers || []).find((item) => item.key === key);
  return header ? header.value : "";
}

/** 後台外殼的 CSP（強制，不是觀察模式）。 */
export function readAdminCsp(root) {
  return readHeader(root, CONSOLE_HEADER_SOURCE, "Content-Security-Policy");
}

/** 舊管理畫面（/legacy）的 CSP。 */
export function readLegacyCsp(root) {
  return readHeader(root, LEGACY_HEADER_SOURCE, "Content-Security-Policy");
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

// ── 舊管理畫面（#550）────────────────────────────────────────────────────────

function deriveSupabaseUrl(apiUrl) {
  const match = /^(https?:\/\/[^/]+)\/functions\/v1\/admin-api\/?$/.exec(String(apiUrl || ""));
  return match ? match[1] : "";
}

export function resolveLegacyConfig(env, config) {
  const get = (key) => String(env[key] ?? "").trim();
  const derived = deriveSupabaseUrl(config.apiUrl);
  const supabaseUrl = (get("SUPABASE_URL") || derived).replace(/\/+$/, "");
  if (!supabaseUrl) throw new Error("build-admin: set SUPABASE_URL (the legacy management pages call nlc-session/nlc-data there)");
  if (!isAllowedUrl(supabaseUrl)) throw new Error(`build-admin: SUPABASE_URL must be an https URL (got ${JSON.stringify(supabaseUrl)})`);
  if (derived && derived !== supabaseUrl) {
    throw new Error(`build-admin: SUPABASE_URL (${supabaseUrl}) and ADMIN_API_URL (${config.apiUrl}) point at different Supabase projects`);
  }
  const anonKey = get("SUPABASE_ANON_KEY");
  if (!anonKey && config.environment !== "local") {
    throw new Error("build-admin: SUPABASE_ANON_KEY is required (the legacy management pages send it to nlc-session/nlc-data, see docs/admin-console.md)");
  }
  const memberHubUrl = (get("NLC_MEMBER_HUB_URL") || "https://member.newlife.org.tw").replace(/\/+$/, "");
  if (!isAllowedUrl(memberHubUrl)) throw new Error(`build-admin: NLC_MEMBER_HUB_URL must be an https URL (got ${JSON.stringify(memberHubUrl)})`);
  return { supabaseUrl, anonKey, memberHubUrl, issuer: config.issuer, resource: config.resource };
}

export function assertLegacyCspAllows(csp, legacyConfig) {
  const connect = cspDirective(csp, "connect-src") || [];
  const script = cspDirective(csp, "script-src") || [];
  const origin = new URL(legacyConfig.supabaseUrl).origin;
  const missing = [];
  if (!connect.includes(origin)) missing.push(`connect-src ${origin}`);
  if (!script.includes(CHART_JS_URL)) missing.push(`script-src ${CHART_JS_URL}`);
  if (missing.length) {
    throw new Error(`build-admin: vercel.admin.json legacy CSP (${LEGACY_HEADER_SOURCE}) does not allow ${missing.join(", ")}`);
  }
}

/** 一個 HTML 起始標籤：屬性名稱與位置（引號內的 > 不算結束）。 */
function scanTag(html, start) {
  let i = start + 1;
  while (i < html.length && /[A-Za-z0-9-]/.test(html[i])) i += 1;
  const attrs = [];
  while (i < html.length && html[i] !== ">") {
    if (/[\s/]/.test(html[i])) {
      i += 1;
      continue;
    }
    const nameStart = i;
    while (i < html.length && !/[\s=>/]/.test(html[i])) i += 1;
    const name = html.slice(nameStart, i);
    let j = i;
    while (j < html.length && /\s/.test(html[j])) j += 1;
    if (html[j] === "=") {
      j += 1;
      while (j < html.length && /\s/.test(html[j])) j += 1;
      const quote = html[j];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, j + 1);
        j = close === -1 ? html.length : close + 1;
      } else {
        while (j < html.length && !/[\s>]/.test(html[j])) j += 1;
      }
      i = j;
    }
    if (name) attrs.push({ name, start: nameStart, end: i });
  }
  return { end: Math.min(i + 1, html.length), attrs };
}

function forEachStartTag(html, visit) {
  let i = 0;
  while ((i = html.indexOf("<", i)) !== -1) {
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (!/[A-Za-z]/.test(html[i + 1] || "")) {
      i += 1;
      continue;
    }
    const tag = scanTag(html, i);
    visit(tag);
    i = tag.end;
  }
}

/** 行內事件處理器（onclick= 等）的屬性名稱：CSP 不讓它們執行，舊管理畫面一個都不能有。 */
export function listInlineHandlers(html) {
  const found = [];
  forEachStartTag(html, (tag) => {
    for (const attr of tag.attrs) if (/^on[a-z]+$/i.test(attr.name)) found.push(attr.name);
  });
  return found;
}

export function stripInlineHandlers(html) {
  const cuts = [];
  forEachStartTag(html, (tag) => {
    for (const attr of tag.attrs) if (/^on[a-z]+$/i.test(attr.name)) cuts.push(attr);
  });
  let out = html;
  for (const cut of cuts.reverse()) out = out.slice(0, cut.start) + out.slice(cut.end);
  return out;
}

/** index.html 的 <body>：拿掉 <script> 與行內事件處理器，其他（DOM id、class、style）原樣保留。 */
export function extractLegacyMarkup(indexHtml) {
  const match = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(indexHtml);
  if (!match) throw new Error("build-admin: index.html has no <body>");
  return stripInlineHandlers(match[1].replace(/<script\b[\s\S]*?<\/script>/gi, ""));
}

export const LEGACY_REQUIRED_IDS = ["admin-view", "admin-section-nav", "admin-section-content", "admin-plan-context"];

async function minifyCss(css) {
  try {
    const result = await transform(css, { loader: "css", minify: true, charset: "utf8", logLevel: "silent" });
    return result.code && result.code.length > css.length * 0.3 ? result.code : css;
  } catch (_err) {
    return css;
  }
}

export async function buildLegacy({ root, outDir, legacyConfig, sectionIds }) {
  const indexHtml = readFileSync(join(root, "index.html"), "utf8");

  const result = await build({
    absWorkingDir: root,
    entryPoints: { legacy: join(root, "admin-legacy", "legacy-entry.js") },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    outdir: outDir,
    entryNames: "[name].[hash]",
    charset: "utf8",
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    define: {
      __ADMIN_LEGACY_CONFIG__: JSON.stringify(legacyConfig),
      "process.env.NODE_ENV": JSON.stringify("production")
    }
  });
  const outputs = Object.keys(result.metafile.outputs).map((file) => resolve(root, file));
  const jsPath = outputs.find((file) => /legacy\.[A-Z0-9]+\.js$/i.test(file));
  if (!jsPath) throw new Error(`build-admin: esbuild did not emit the legacy bundle (${outputs.join(", ")})`);
  if (outputs.some((file) => /\.css$/i.test(file))) throw new Error("build-admin: the legacy entry must not import CSS (styles come from index.css)");
  const jsFile = jsPath.slice(jsPath.lastIndexOf("legacy."));

  const { stylesheets } = resolveLocalAssets(indexHtml);
  if (!stylesheets.length) throw new Error("build-admin: index.html has no local stylesheet");
  const css = await minifyCss([
    ...stylesheets.map((sheet) => readFileSync(join(root, sheet), "utf8")),
    buildTailwindCss(root),
    readFileSync(join(root, "admin-legacy", "legacy.css"), "utf8")
  ].join("\n\n"));
  const cssFile = `legacy.${contentHash(css)}.css`;
  writeFileSync(join(outDir, cssFile), css, "utf8");

  const markup = extractLegacyMarkup(indexHtml);
  const missing = [...LEGACY_REQUIRED_IDS, ...sectionIds.map((id) => `admin-section-${id}`)]
    .filter((id) => !markup.includes(`id="${id}"`));
  if (missing.length) throw new Error(`build-admin: index.html is missing ${missing.join(", ")} (the legacy management pages need them)`);
  const template = readFileSync(join(root, "admin-legacy", "legacy.html"), "utf8");
  for (const placeholder of [LEGACY_CSS_PLACEHOLDER, LEGACY_MARKUP_PLACEHOLDER, LEGACY_JS_PLACEHOLDER]) {
    if (!template.includes(placeholder)) throw new Error(`build-admin: admin-legacy/legacy.html is missing ${placeholder}`);
  }
  const html = template
    .replace(LEGACY_CSS_PLACEHOLDER, `<link rel="stylesheet" href="/${cssFile}">`)
    .replace(LEGACY_MARKUP_PLACEHOLDER, () => markup)
    .replace(LEGACY_JS_PLACEHOLDER, `<script type="module" src="/${jsFile}"></script>`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || listInlineHandlers(html).length) {
    throw new Error("build-admin: legacy.html must not contain inline scripts or event handlers (CSP)");
  }
  writeFileSync(join(outDir, "legacy.html"), html, "utf8");

  // 圖示、徽章、題目圖片（離線聖經包很大又用不到，不複製）
  const assetsOut = join(outDir, "assets");
  mkdirSync(assetsOut, { recursive: true });
  for (const name of readdirSync(join(root, "assets"))) {
    if (name === "bible-packs") continue;
    cpDirRecursive(join(root, "assets", name), join(assetsOut, name));
  }
  return { jsFile, cssFile };
}

export async function buildAdmin({ root, outDir = join(root, ADMIN_OUT_DIR), env }) {
  const config = resolveAdminConfig(env);
  const legacyConfig = resolveLegacyConfig(env, config);
  const checks = [
    () => assertCspAllowsConfig(readAdminCsp(root), config),
    () => assertLegacyCspAllows(readLegacyCsp(root), legacyConfig)
  ];
  for (const check of checks) {
    if (config.environment !== "local") {
      check();
      continue;
    }
    try {
      check();
    } catch (err) {
      console.warn(`[build-admin] ${err.message}（本機預覽不套用 vercel.admin.json，先繼續）`);
    }
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

  const legacy = await buildLegacy({ root, outDir, legacyConfig, sectionIds: LEGACY_SECTION_IDS });

  return { jsFile, cssFile, config, legacy };
}

const currentPath = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === currentPath) {
  const root = dirname(dirname(currentPath));
  const env = { ...readDotEnv(root), ...process.env };
  buildAdmin({ root, env })
    .then(({ jsFile, cssFile, config, legacy }) => {
      console.log(`build-admin: wrote ${ADMIN_OUT_DIR}/index.html, ${jsFile}, ${cssFile} (${config.environment}, api ${config.apiUrl})`);
      console.log(`build-admin: wrote ${ADMIN_OUT_DIR}/legacy.html, ${legacy.jsFile}, ${legacy.cssFile}`);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
