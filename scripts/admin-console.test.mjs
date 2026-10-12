// 後台（#555）：獨立網域的安全標頭、建置輸出、和會友 App 分開、色票與 index.css 同步、原始碼規則。
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { assertCspAllowsConfig, buildAdmin, cspDirective, readAdminCsp, resolveAdminConfig } from "./build-admin.mjs";

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

  it("builds only the admin console into its own output directory", () => {
    expect(adminCfg.buildCommand).toBe("node scripts/build-admin.mjs");
    expect(adminCfg.outputDirectory).toBe("dist-admin");
    expect(adminCfg.git).toEqual({ deploymentEnabled: false });
    expect(adminCfg.rewrites).toBeUndefined();
    expect(memberCfg.outputDirectory).toBe("dist");
  });

  it("enforces the CSP directly (no report-only phase)", () => {
    const csp = directives(global["Content-Security-Policy"]);
    expect(global["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(csp["default-src"]).toEqual(["'none'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual([
      "https://ztozevcqkfrohgjmngcj.supabase.co",
      "https://dbtjsljrytzonjvclgrd.supabase.co",
      "https://sso.newlife.org.tw"
    ]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "https://ztozevcqkfrohgjmngcj.supabase.co", "https://dbtjsljrytzonjvclgrd.supabase.co"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    for (const values of Object.values(csp)) {
      expect(values).not.toContain("'unsafe-inline'");
      expect(values).not.toContain("'unsafe-eval'");
      expect(values.some((value) => value.includes("*"))).toBe(false);
    }
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
    expect(global["X-Frame-Options"]).toBe("DENY");
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
        scopes: "openid profile email",
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
  it("emits only the admin console, with no inline script or style and the config baked in", async () => {
    const out = mkdtempSync(join(tmpdir(), "admin-build-"));
    try {
      const { jsFile, cssFile } = await buildAdmin({
        root,
        outDir: out,
        env: { ADMIN_LOGTO_CLIENT_ID: "test-admin-client", ADMIN_API_URL: STAGING_API }
      });
      expect(readdirSync(out).sort()).toEqual([cssFile, jsFile, "favicon.svg", "index.html", "robots.txt"].sort());
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
});
