// 後台（#555）：獨立網域的安全標頭、建置輸出、和會友 App 分開、色票與 index.css 同步、原始碼規則。
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { assertCspAllowsConfig, buildAdmin, cspDirective, listInlineHandlers, readAdminCsp, resolveAdminConfig } from "./build-admin.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const adminCfg = JSON.parse(readFileSync(join(root, "vercel.admin.json"), "utf8"));
const memberCfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const headersFor = (cfg, source) => Object.fromEntries(
  (cfg.headers.find((rule) => rule.source === source)?.headers || []).map((entry) => [entry.key, entry.value])
);
const directives = (policy) => Object.fromEntries(
  String(policy || "").split(";").map((part) => part.trim()).filter(Boolean)
    .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; })
);
const STAGING_API = "https://dbtjsljrytzonjvclgrd.supabase.co/functions/v1/admin-api";
const PRODUCTION_API = "https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/admin-api";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("admin console Vercel project (vercel.admin.json)", () => {
  const global = headersFor(adminCfg, "/(.*)");
  // CSP 與 X-Frame-Options 分兩份：外殼（/legacy 以外）與照搬的舊管理區塊 iframe（/legacy…，#550）
  const consoleOnly = headersFor(adminCfg, "/((?!legacy).*)");
  const legacyOnly = headersFor(adminCfg, "/legacy(.*)");

  it("builds only the admin console into its own output directory", () => {
    expect(adminCfg.buildCommand).toBe("node scripts/build-admin.mjs");
    expect(adminCfg.outputDirectory).toBe("dist-admin");
    expect(adminCfg.git).toEqual({ deploymentEnabled: false });
    expect(adminCfg.rewrites).toBeUndefined();
    expect(memberCfg.outputDirectory).toBe("dist");
  });

  it("splits the CSP between the console and the legacy iframe by path", () => {
    expect(global["Content-Security-Policy"]).toBeUndefined();
    const consoleRe = new RegExp(`^${"/((?!legacy).*)"}$`);
    const legacyRe = new RegExp(`^${"/legacy(.*)"}$`);
    for (const path of ["/", "/index.html", "/admin.ABC123.js", "/admin.ABC123.css", "/favicon.svg", "/robots.txt"]) {
      expect(consoleRe.test(path), path).toBe(true);
      expect(legacyRe.test(path), path).toBe(false);
    }
    for (const path of ["/legacy", "/legacy.html", "/legacy.ABC123.js", "/legacy.abc123.css"]) {
      expect(consoleRe.test(path), path).toBe(false);
      expect(legacyRe.test(path), path).toBe(true);
    }
  });

  it("enforces the CSP directly (no report-only phase)", () => {
    const csp = directives(consoleOnly["Content-Security-Policy"]);
    expect(global["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(consoleOnly["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(csp["default-src"]).toEqual(["'none'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual([
      "https://ztozevcqkfrohgjmngcj.supabase.co",
      "https://dbtjsljrytzonjvclgrd.supabase.co",
      "https://sso.newlife.org.tw"
    ]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "https://ztozevcqkfrohgjmngcj.supabase.co", "https://dbtjsljrytzonjvclgrd.supabase.co"]);
    // 只嵌自己網域的舊管理區塊（/legacy）；外殼本身不能被任何人嵌
    expect(csp["frame-src"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    for (const values of Object.values(csp)) {
      expect(values).not.toContain("'unsafe-inline'");
      expect(values).not.toContain("'unsafe-eval'");
      expect(values.some((value) => value.includes("*"))).toBe(false);
    }
    expect(consoleOnly["X-Frame-Options"]).toBe("DENY");
  });

  it("gives the legacy iframe its own CSP: no inline script, only the console may embed it", () => {
    const csp = directives(legacyOnly["Content-Security-Policy"]);
    expect(csp["default-src"]).toEqual(["'none'"]);
    // Chart.js 固定版本的完整網址（統計圖），其他腳本都只能來自自己網域
    expect(csp["script-src"]).toEqual(["'self'", "https://cdn.jsdelivr.net/npm/chart.js@4.5.1"]);
    // 舊畫面大量使用 style 屬性（照搬、程式不動）：只放寬樣式，腳本仍不允許行內
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["connect-src"]).toEqual(["'self'", "https://ztozevcqkfrohgjmngcj.supabase.co", "https://dbtjsljrytzonjvclgrd.supabase.co"]);
    expect(csp["frame-ancestors"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-src"]).toBeUndefined();
    for (const [name, values] of Object.entries(csp)) {
      expect(values, name).not.toContain("'unsafe-eval'");
      if (name !== "style-src") expect(values, name).not.toContain("'unsafe-inline'");
      expect(values.some((value) => value.includes("*")), name).toBe(false);
    }
    expect(legacyOnly["X-Frame-Options"]).toBe("SAMEORIGIN");
    for (const source of ["/legacy", "/legacy.html"]) {
      expect(headersFor(adminCfg, source)["Cache-Control"]).toMatch(/^no-store/);
    }
    expect(headersFor(adminCfg, "/legacy.(.*).js")["Cache-Control"]).toContain("immutable");
  });

  it("keeps it out of search engines and never caches the HTML", () => {
    expect(global["X-Robots-Tag"]).toBe("noindex, nofollow");
    for (const source of ["/", "/index", "/index.html"]) {
      expect(headersFor(adminCfg, source)["Cache-Control"]).toMatch(/^no-store/);
    }
    expect(headersFor(adminCfg, "/admin.(.*).js")["Cache-Control"]).toContain("immutable");
  });

  it("sets the same hardening headers as the member app, with a stricter referrer policy", () => {
    expect(global["X-Content-Type-Options"]).toBe("nosniff");
    expect(consoleOnly["X-Frame-Options"]).toBe("DENY");
    expect(global["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(global["Referrer-Policy"]).toBe("no-referrer");
    expect(global["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(global["Permissions-Policy"]).toBe(headersFor(memberCfg, "/(.*)")["Permissions-Policy"]);
  });

  it("the member app config does not serve or rewrite to the admin console", () => {
    const text = JSON.stringify(memberCfg);
    expect(text).not.toContain("dist-admin");
    expect(text).not.toContain("admin-entry");
    expect((memberCfg.rewrites || []).some((rule) => /admin/.test(rule.source) || /admin/.test(rule.destination))).toBe(false);
  });
});

describe("resolveAdminConfig", () => {
  it("requires the admin Logto client id", () => {
    expect(() => resolveAdminConfig({ ADMIN_API_URL: STAGING_API })).toThrow(/ADMIN_LOGTO_CLIENT_ID/);
  });

  it("derives the API URL from SUPABASE_URL and the environment from the Supabase project", () => {
    expect(resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", SUPABASE_URL: "https://dbtjsljrytzonjvclgrd.supabase.co/" }))
      .toEqual({
        issuer: "https://sso.newlife.org.tw/oidc",
        clientId: "c",
        resource: "https://platform.newlife.org.tw",
        scopes: "openid profile email member:read.basic",
        apiUrl: STAGING_API,
        environment: "staging"
      });
    expect(resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: PRODUCTION_API }).environment).toBe("production");
    expect(resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: "http://127.0.0.1:54321/functions/v1/admin-api" }).environment).toBe("local");
  });

  it("never asks for a refresh token", () => {
    expect(() => resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: STAGING_API, ADMIN_LOGTO_SCOPES: "openid offline_access" }))
      .toThrow(/offline_access/);
  });

  it("rejects non-https endpoints", () => {
    expect(() => resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: "http://evil.test/admin-api" })).toThrow(/https/);
  });

  it("checks the CSP lets the console reach admin-api and Logto", () => {
    const csp = readAdminCsp(root);
    expect(() => assertCspAllowsConfig(csp, resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: PRODUCTION_API }))).not.toThrow();
    expect(() => assertCspAllowsConfig(csp, resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: "https://other.supabase.co/functions/v1/admin-api" })))
      .toThrow(/connect-src/);
    expect(cspDirective(csp, "default-src")).toEqual(["'none'"]);
  });
});

describe("buildAdmin (real repo)", () => {
  it("emits the admin console and the legacy iframe page, with no inline script and the config baked in", async () => {
    const out = mkdtempSync(join(tmpdir(), "admin-build-"));
    try {
      const { jsFile, cssFile, legacy } = await buildAdmin({
        root,
        outDir: out,
        env: { ADMIN_LOGTO_CLIENT_ID: "test-admin-client", ADMIN_API_URL: STAGING_API, SUPABASE_ANON_KEY: "test-anon-key" }
      });
      expect(readdirSync(out).sort()).toEqual([
        cssFile, jsFile, "favicon.svg", "index.html", "robots.txt",
        legacy.jsFile, legacy.cssFile, "legacy.html", "assets"
      ].sort());
      const html = readFileSync(join(out, "index.html"), "utf8");
      expect(html).toContain(`<script type="module" src="/${jsFile}"></script>`);
      expect(html).toContain(`<link rel="stylesheet" href="/${cssFile}">`);
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html).not.toMatch(/\sstyle=|<style|\son[a-z]+=/i);
      expect(html).toContain('content="noindex, nofollow"');
      expect(readFileSync(join(out, "robots.txt"), "utf8")).toContain("Disallow: /");

      const js = readFileSync(join(out, jsFile), "utf8");
      expect(js).toContain("test-admin-client");
      expect(js).toContain(STAGING_API);
      // 不帶進會友 App 的核心鏈與全域設定，不註冊 Service Worker
      for (const marker of ["SUPABASE_CONFIG", "NLC_CONFIG", "serviceWorker", "nlc-data", "offline_access"]) {
        expect(js, marker).not.toContain(marker);
      }
      expect(js).not.toContain("__ADMIN_CONFIG__");

      // 照搬的舊管理區塊（#550）：App 管理分頁的畫面，但沒有任何行內腳本或事件處理器
      const legacyHtml = readFileSync(join(out, "legacy.html"), "utf8");
      expect(legacyHtml).toContain(`<script type="module" src="/${legacy.jsFile}"></script>`);
      expect(legacyHtml).toContain(`<link rel="stylesheet" href="/${legacy.cssFile}">`);
      expect(legacyHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(listInlineHandlers(legacyHtml)).toEqual([]);
      expect(legacyHtml).not.toMatch(/build:legacy-/);
      for (const id of ["admin-view", "admin-section-content", "admin-section-announcements", "admin-section-exam", "adm-legacy-status"]) {
        expect(legacyHtml, id).toContain(`id="${id}"`);
      }
      const legacyJs = readFileSync(join(out, legacy.jsFile), "utf8");
      expect(legacyJs).toContain("https://dbtjsljrytzonjvclgrd.supabase.co");
      expect(legacyJs).toContain("test-anon-key");
      expect(legacyJs).not.toContain("__ADMIN_LEGACY_CONFIG__");
      // 後台網域不註冊 Service Worker；離線聖經包不複製
      expect(legacyJs).not.toMatch(/serviceWorker\.register/);
      expect(readdirSync(join(out, "assets"))).not.toContain("bible-packs");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60000);
});

describe("admin console theme tokens stay in sync with index.css", () => {
  const blocks = (css, selectors) => {
    const result = {};
    const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, selector] of Object.entries(selectors)) {
      const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
      const values = {};
      let match;
      while ((match = re.exec(text))) {
        for (const decl of match[2].split(";")) {
          const m = decl.match(/^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/i);
          if (m) values[m[1]] = m[2].replace(/\s+/g, " ");
        }
      }
      result[name] = values;
    }
    return result;
  };
  const index = blocks(readFileSync(join(root, "index.css"), "utf8"), { light: ":root", dark: "body.dark-theme", warm: "body.warm-theme" });
  const admin = blocks(readFileSync(join(root, "admin", "admin.css"), "utf8"), {
    light: ":root",
    dark: ':root[data-theme="dark"]',
    warm: ':root[data-theme="warm"]'
  });

  it.each(["light", "dark", "warm"])("%s theme uses the member app's values", (theme) => {
    const indexValues = { ...index.light, ...index[theme] };
    const adminValues = { ...admin.light, ...admin[theme] };
    const shared = Object.keys(adminValues).filter((key) => !key.startsWith("--adm-") && key in indexValues);
    expect(shared.length).toBeGreaterThan(15);
    for (const key of shared) expect(adminValues[key], `${theme} ${key}`).toBe(indexValues[key]);
    expect(adminValues["--color-brand"]).toBe("#04A9D2");
  });

  it("only defines tokens the member app also has (besides its own --adm-*)", () => {
    const indexKeys = new Set(Object.keys({ ...index.light, ...index.dark, ...index.warm }));
    const extra = Object.keys({ ...admin.light, ...admin.dark, ...admin.warm }).filter((key) => !key.startsWith("--adm-") && !indexKeys.has(key));
    expect(extra).toEqual([]);
  });
});

describe("admin console source rules", () => {
  const files = walk(join(root, "admin"))
    .filter((file) => /\.(tsx?|css|html)$/.test(file) && !file.includes("__tests__"));
  // 註解拿掉再檢查（說明文字會提到 localStorage 之類的字）
  const read = (file) => readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const rel = (file) => relative(root, file).replace(/\\/g, "/");

  it("has no inline styles or raw HTML injection (CSP + XSS)", () => {
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const src = read(file);
      expect(src, rel(file)).not.toMatch(/\bstyle=\{/);
      expect(src, rel(file)).not.toContain("dangerouslySetInnerHTML");
      expect(src, rel(file)).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
      expect(src, rel(file)).not.toMatch(/\beval\(|new Function\(/);
    }
  });

  it("keeps tokens and personal data out of persistent storage", () => {
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const src = read(file);
      const name = rel(file);
      // localStorage 只給介面偏好（主題）；sessionStorage 只給登入流程的一次性資料；IndexedDB、cookie 都不用
      if (name !== "admin/src/theme.ts" && name !== "admin/src/App.tsx") expect(src, name).not.toContain("localStorage");
      if (name !== "admin/admin-entry.tsx") expect(src, name).not.toContain("sessionStorage");
      expect(src, name).not.toMatch(/indexedDB|document\.cookie|serviceWorker/);
    }
    const auth = read(join(root, "admin", "src", "auth.ts"));
    // 寫進 storage 的只有 PKCE 這一趟的資料與登出旗標
    const writes = [...auth.matchAll(/storage\.setItem\(([^,]+),/g)].map((m) => m[1].trim());
    expect(writes.sort()).toEqual(["FLOW_KEY", "SIGNED_OUT_KEY"]);
    expect(auth).not.toMatch(/offline_access|refresh_token/);
  });

  it("does not load the member app's core chain", () => {
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const imports = [...read(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, rel(file)).not.toMatch(/(^|\/)js\/|config\.js|components\/issue-report/);
      }
    }
  });

  it("shares only dependency-free rule files with admin-api, never its server code", () => {
    // policy.ts 一 import 就把整個 admin-api（runner、CSV、SQL 參數）打包進後台
    const allowed = new Set(["supabase/functions/admin-api/search-query.ts"]);
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const imports = [...read(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports.filter((s) => s.includes("supabase/functions/"))) {
        expect(allowed.has(spec.slice(spec.indexOf("supabase/functions/"))), `${rel(file)} → ${spec}`).toBe(true);
      }
    }
    expect(read(join(root, "supabase", "functions", "admin-api", "search-query.ts"))).not.toMatch(/^\s*import\s/m);
  });
});
