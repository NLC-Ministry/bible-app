// 整站安全標頭（#553）：所有頁面都要有的標頭，以及 CSP（觀察模式）放行的行內腳本雜湊和 HTML 同步。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectInlineScriptHashes, inlineScriptHashes } from "./security-headers.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const globalRule = cfg.headers.find((rule) => rule.source === "/(.*)");
const header = (key) => globalRule?.headers.find((entry) => entry.key === key)?.value;
const directives = (policy) => Object.fromEntries(
  String(policy || "").split(";").map((part) => part.trim()).filter(Boolean)
    .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; })
);

describe("site-wide security headers", () => {
  it("applies one rule to every path", () => {
    expect(globalRule).toBeTruthy();
  });

  it("sets the static hardening headers", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
  });

  it("turns off device permissions the app never uses (but keeps sharing and clipboard)", () => {
    const policy = header("Permissions-Policy");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(policy).not.toMatch(/web-share|clipboard/);
  });

  it("enforces frame-ancestors 'none' (anti-clickjacking) without enforcing the script policy", () => {
    expect(directives(header("Content-Security-Policy"))).toEqual({ "frame-ancestors": ["'none'"] });
  });

  it("observes the full policy in report-only mode", () => {
    const csp = directives(header("Content-Security-Policy-Report-Only"));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    // frame-ancestors 在 Report-Only 裡會被瀏覽器忽略並在 Console 警告，只放在強制的那一條
    expect(csp["frame-ancestors"]).toBeUndefined();
    // 腳本：不允許任意行內（只有雜湊），也不允許 eval
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    for (const host of ["https://*.supabase.co", "https://sso.newlife.org.tw", "https://bible-api.com", "https://bolls.life", "https://bible.fhl.net"]) {
      expect(csp["connect-src"]).toContain(host);
    }
  });

  it("lists exactly the hashes of the inline scripts in the HTML entry points", () => {
    const listed = directives(header("Content-Security-Policy-Report-Only"))["script-src"]
      .filter((value) => value.startsWith("'sha256-"));
    const expected = collectInlineScriptHashes(root);
    // 失敗時：node scripts/security-headers.mjs，把輸出換進 vercel.json 的 script-src
    expect([...listed].sort()).toEqual([...expected].sort());
  });
});

describe("inlineScriptHashes", () => {
  it("hashes inline bodies only, skips src scripts, and ignores CRLF vs LF", () => {
    const lf = '<script src="/a.js"></script><script>\n  run();\n</script><script id="x">go()</script>';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(inlineScriptHashes(lf)).toHaveLength(2);
    expect(inlineScriptHashes(crlf)).toEqual(inlineScriptHashes(lf));
    // 已知值：sha256("go()")
    expect(inlineScriptHashes("<script>go()</script>")).toEqual(["'sha256-5KYv+PUboo5h+0+YAtGRPbwv5d/QxzHslP4YGnUaxRw='"]);
  });
});
