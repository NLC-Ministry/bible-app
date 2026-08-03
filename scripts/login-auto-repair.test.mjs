import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const auth = readFileSync("js/auth.js", "utf8");
const db = readFileSync("js/db.js", "utf8");
const repair = readFileSync("repair.html", "utf8");
const app = readFileSync("js/app.js", "utf8");
const html = readFileSync("index.html", "utf8");

describe("automatic login repair", () => {
  it("turns the next login press into a repair redirect after a detected failure", () => {
    expect(auth).toContain('repairRequired: "nlc_login_repair_required"');
    expect(auth).toContain("this.markLoginFailure();");
    expect(auth).toContain('new URL("/repair", window.location.origin)');
    expect(auth).toContain('repairUrl.searchParams.set("resume_login", "1")');
    expect(db).toContain("auth.shouldRepairBeforeLogin?.()");
    expect(db).toContain("auth.startLoginRepair()");
    expect(db).toContain('btnNlcGate.textContent = "\\u4fee\\u5fa9\\u4e26\\u91cd\\u65b0\\u767b\\u5165"');
  });

  it("repairs only login and PWA state without deleting reading progress", () => {
    expect(repair).toContain('const resumeLogin = new URLSearchParams(window.location.search).get("resume_login") === "1"');
    expect(repair).toContain('"nlc_login_repair_required"');
    expect(repair).toContain('sessionStorage.setItem("nlc_login_repair_resume_ready", "1")');
    expect(repair).not.toContain('localStorage.removeItem("reading_logs")');
    expect(repair).not.toContain('localStorage.removeItem("active_reading_plans")');
  });

  it("automatically resumes login once and consumes the one-time marker", () => {
    expect(db).toContain('urlParams.get("resume_login") === "1"');
    expect(db).toContain('sessionStorage.getItem("nlc_login_repair_resume_ready") === "1"');
    expect(db).toContain('sessionStorage.removeItem("nlc_login_repair_resume_ready")');
    expect(db).toContain('await authLaunch.startInteractiveAuth({ intent: "login", returnTo: "/" })');
    expect(repair).toContain('resumeLogin ? "&resume_login=1" : ""');
  });

  it("clears the repair flag after a successful token exchange and cache-busts the entry modules", () => {
    expect(auth).toContain("this.clearLoginRepairState();");
    expect(app).toContain("./auth.js?v=20260802_login_auto_repair");
    expect(app).toContain("./db.js?v=20260802_login_auto_repair");
    expect(html).toContain("js/app.js?v=20260803_reader_selection_bar");
  });
});