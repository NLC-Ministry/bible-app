// Integration lock + PreToolUse guard for parallel task sessions (see CLAUDE.md
// "Parallel tasks and integration", .claude/skills/integrate/SKILL.md).
//
//   node .claude/hooks/integration.mjs acquire "<note>"   take the lock (integrator)
//   node .claude/hooks/integration.mjs release            give it back
//   node .claude/hooks/integration.mjs status             who holds it
//   (no args, hook JSON on stdin)                         PreToolUse guard
//
// The lock is a directory in the git common dir, so every worktree of this repo
// sees the same one, and mkdir makes taking it atomic. It records the Claude
// session id, so only the session that took it gets past the guard.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK_DIR_NAME = "integration.lock";
export const STALE_AFTER_MS = 90 * 60 * 1000;

// Drop heredoc bodies and quoted strings so a commit message or doc that merely
// mentions "git push" doesn't trip the guard.
export function stripLiterals(command) {
  let text = String(command || "");
  text = text.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, " ");
  text = text.replace(/@'[\s\S]*?\n'@/g, " ").replace(/@"[\s\S]*?\n"@/g, " ");
  text = text.replace(/'[^'\n]*'/g, " ").replace(/"(?:[^"\\\n]|\\.)*"/g, " ");
  return text;
}

const GIT_PUSH = /\bgit(?:\s+-[Cc]\s+\S+)*\s+push\b/;
const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
const GH_PR_MERGE = /\bgh\s+pr\s+merge\b/;
const DB_PUSH = /\bsupabase\s+db\s+push\b/;

// Returns null (allow), { needsLock: reason } or { deny: reason }.
export function classify(command) {
  const raw = String(command || "");
  const text = stripLiterals(raw);
  if (GH_PR_MERGE.test(text)) {
    return { deny: "Release PRs are merged by the user, never by Claude (CLAUDE.md branch workflow)." };
  }
  const hotfix = /\bhotfix\//.test(raw);
  const dryRun = /--dry-run\b/.test(text);
  if (GIT_PUSH.test(text) && !hotfix && !dryRun) return { needsLock: "git push" };
  if (GH_PR_CREATE.test(text) && !hotfix) return { needsLock: "gh pr create" };
  if (DB_PUSH.test(text) && !dryRun) return { needsLock: "supabase db push" };
  return null;
}

export function gitCommonDir(cwd) {
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" }).trim();
  return isAbsolute(out) ? out : resolve(cwd, out);
}

export function readLock(lockDir) {
  const file = join(lockDir, "owner.json");
  if (!existsSync(lockDir)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { session: null, at: 0, note: "(unreadable owner.json)" }; }
}

export function isStale(lock, now = Date.now()) {
  return !lock || !Number.isFinite(Number(lock.at)) || now - Number(lock.at) > STALE_AFTER_MS;
}

// Allow when this session holds a fresh lock.
export function decide(verdict, lock, sessionIds, now = Date.now()) {
  if (!verdict) return { allow: true };
  if (verdict.deny) return { allow: false, reason: verdict.deny };
  const held = lock && !isStale(lock, now) && sessionIds.filter(Boolean).includes(lock.session);
  if (held) return { allow: true };
  const who = lock && !isStale(lock, now)
    ? ` The lock is held by another session (since ${new Date(Number(lock.at)).toISOString()}: ${lock.note || "no note"}).`
    : "";
  return {
    allow: false,
    reason: `\`${verdict.needsLock}\` is reserved for the integrator.${who} Task sessions hand off instead (skill: handoff). `
      + `To integrate, follow the integrate skill: node .claude/hooks/integration.mjs acquire "<what you are merging>".`
  };
}

function sessionId() {
  return process.env.CLAUDE_CODE_SESSION_ID || null;
}

function lockDirFor(cwd) {
  return join(gitCommonDir(cwd), LOCK_DIR_NAME);
}

function acquire(note) {
  const lockDir = lockDirFor(process.cwd());
  const me = sessionId();
  if (!me) { console.error("CLAUDE_CODE_SESSION_ID is not set; run this from a Claude Code session."); return 1; }
  const existing = readLock(lockDir);
  if (existing && existing.session !== me && !isStale(existing)) {
    console.error(`Integration lock is held by another session since ${new Date(Number(existing.at)).toISOString()}: ${existing.note || ""}`);
    console.error("Wait for it to finish (status: node .claude/hooks/integration.mjs status).");
    return 1;
  }
  if (existing && existing.session !== me) {
    console.log(`Taking over a stale lock (${existing.note || "no note"}).`);
    rmSync(lockDir, { recursive: true, force: true });
  }
  try { mkdirSync(lockDir); } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const again = readLock(lockDir);
    if (again && again.session !== me) { console.error("Another session took the lock just now."); return 1; }
  }
  writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ session: me, at: Date.now(), note: note || "" }, null, 2));
  console.log(`Integration lock acquired: ${lockDir}`);
  return 0;
}

function release(force) {
  const lockDir = lockDirFor(process.cwd());
  const existing = readLock(lockDir);
  if (!existing) { console.log("No integration lock."); return 0; }
  if (existing.session !== sessionId() && !force && !isStale(existing)) {
    console.error("The lock belongs to another session; not releasing (pass --force only if that session is gone).");
    return 1;
  }
  rmSync(lockDir, { recursive: true, force: true });
  console.log("Integration lock released.");
  return 0;
}

function status() {
  const existing = readLock(lockDirFor(process.cwd()));
  if (!existing) { console.log("free"); return 0; }
  const mine = existing.session === sessionId() ? " (this session)" : "";
  console.log(`held${mine}${isStale(existing) ? " [stale]" : ""} since ${new Date(Number(existing.at)).toISOString()}: ${existing.note || ""}`);
  return 0;
}

function guard() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return 0; }
  const command = input.tool_input && input.tool_input.command;
  const verdict = classify(command);
  if (!verdict) return 0;
  let lock = null;
  try { lock = readLock(lockDirFor(input.cwd || process.cwd())); } catch { /* not a git dir: no lock */ }
  const result = decide(verdict, lock, [input.session_id, sessionId()]);
  if (result.allow) return 0;
  console.error(result.reason);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const code = cmd === "acquire" ? acquire(rest.join(" "))
    : cmd === "release" ? release(rest.includes("--force"))
    : cmd === "status" ? status()
    : guard();
  process.exit(code);
}
