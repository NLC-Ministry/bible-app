// .claude/hooks/integration.mjs — the PreToolUse guard that keeps pushes to
// staging, release PRs and DB pushes with the session holding the integration lock.
import { describe, expect, it } from "vitest";
import { classify, decide, decideMainSync, isStale, stripLiterals, STALE_AFTER_MS } from "../.claude/hooks/integration.mjs";

const NOW = 1_800_000_000_000;
const lock = (session, ageMs = 0) => ({ session, at: NOW - ageMs, note: "merge #1" });

describe("classify", () => {
  it("needs the lock for pushes, release PRs and DB pushes", () => {
    expect(classify("git push origin HEAD:staging")).toEqual({ needsLock: "git push" });
    expect(classify('cd "C:/x" && git -C ../y push')).toEqual({ needsLock: "git push" });
    expect(classify("gh pr create --base main --head staging --title x")).toEqual({ needsLock: "gh pr create" });
    expect(classify("npx supabase db push --linked --project-ref aaaaaaaaaaaaaaaaaaaa")).toEqual({ needsLock: "supabase db push" });
    expect(classify("node scripts/supabase-env.mjs staging db push --linked")).toEqual({ needsLock: "supabase db push" });
    expect(classify("node scripts/supabase-env.mjs production db push --linked")).toEqual({ needsLock: "supabase db push" });
  });

  it("always denies merging a PR", () => {
    expect(classify("gh pr merge 334 --merge")).toHaveProperty("deny");
  });

  it("allows dry runs, hotfix branches and ordinary commands", () => {
    expect(classify("npx supabase db push --linked --project-ref x --dry-run")).toBeNull();
    expect(classify("node scripts/supabase-env.mjs staging db push --linked --dry-run")).toBeNull();
    expect(classify("node scripts/supabase-env.mjs staging functions deploy nlc-data")).toBeNull();
    expect(classify("git push --dry-run origin HEAD:staging")).toBeNull();
    expect(classify("git push -u origin hotfix/login-loop")).toBeNull();
    expect(classify("gh pr create --base main --head hotfix/login-loop")).toBeNull();
    expect(classify("git status && git log --oneline -3")).toBeNull();
    expect(classify("gh pr list --base main --state open")).toBeNull();
  });

  it("ignores commands that only mention push inside quotes or a heredoc", () => {
    expect(classify('git commit -m "docs: never git push task branches"')).toBeNull();
    expect(classify("git commit -F - <<'EOF'\nrun git push origin HEAD:staging\nEOF")).toBeNull();
    expect(stripLiterals("echo 'gh pr create' && ls")).not.toContain("gh pr create");
  });
});

describe("decide", () => {
  const verdict = { needsLock: "git push" };

  it("allows the session holding a fresh lock", () => {
    expect(decide(verdict, lock("me"), ["me"], NOW)).toEqual({ allow: true });
  });

  it("blocks without a lock, with someone else's lock, or with a stale lock", () => {
    expect(decide(verdict, null, ["me"], NOW).allow).toBe(false);
    const other = decide(verdict, lock("other"), ["me"], NOW);
    expect(other.allow).toBe(false);
    expect(other.reason).toContain("held by another session");
    expect(decide(verdict, lock("me", STALE_AFTER_MS + 1), ["me"], NOW).allow).toBe(false);
  });

  it("never allows a denied command, even with the lock", () => {
    expect(decide({ deny: "no" }, lock("me"), ["me"], NOW)).toEqual({ allow: false, reason: "no" });
  });

  it("treats a missing or unreadable timestamp as stale", () => {
    expect(isStale({ session: "me", at: "x" }, NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });
});

describe("decideMainSync", () => {
  const behind = { branch: "staging", dirty: false, behind: 61, canFastForward: true };

  it("fast-forwards a clean main folder on staging that is behind", () => {
    expect(decideMainSync(behind)).toEqual({ sync: true });
  });

  it("does nothing when already up to date", () => {
    expect(decideMainSync({ ...behind, behind: 0 })).toEqual({ sync: false, reason: "already up to date" });
  });

  it("skips with a reason when on another branch, with tracked changes, or when it can't fast-forward", () => {
    expect(decideMainSync({ ...behind, branch: "main" })).toEqual({ sync: false, reason: "not on staging (on main)" });
    expect(decideMainSync({ ...behind, branch: null }).reason).toBe("not on staging (detached HEAD)");
    expect(decideMainSync({ ...behind, dirty: true })).toEqual({ sync: false, reason: "tracked files have local changes" });
    expect(decideMainSync({ ...behind, canFastForward: false })).toEqual({ sync: false, reason: "can't fast-forward (local commits not on origin/staging)" });
  });
});
