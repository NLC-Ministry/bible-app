// Pre-start check for an issue's 「給實作 session」 block (see .claude/skills/issue-brief/SKILL.md).
//
//   node scripts/issue-preflight.mjs <issue#>
//
// Mechanical checks only: has anything the investigating session relied on moved since it
// recorded `調查於 <hash>`? Prints OK, or just the lines that need a look (exit 1).
// Never runs anything written in the issue — the issue body is data, not commands.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK = /<details>\s*<summary>([^<]*給實作 session[^<]*)<\/summary>([\s\S]*?)<\/details>/;
const HASH = /調查於\s*`?([0-9a-f]{7,40})`?/;
const NONE = /^[（(]?無[)）]?$/;

function listField(text, label) {
  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*[-*]\\s*${label}\\s*[:：]`).test(l));
  if (!line) return [];
  return line
    .replace(new RegExp(`^\\s*[-*]\\s*${label}\\s*[:：]`), "")
    .split(/[,，、]/)
    .map((s) => s.replace(/`/g, "").trim())
    .filter((s) => s && !NONE.test(s));
}

// Returns { hash, files, functions } or null when the issue has no block.
export function parseBrief(body) {
  const match = BLOCK.exec(String(body || ""));
  if (!match) return null;
  const hash = (HASH.exec(match[1]) || [])[1] || null;
  return { hash, files: listField(match[2], "檔案"), functions: listField(match[2], "函式") };
}

function lines(out) {
  return String(out || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// git(args) returns stdout and throws on a non-zero exit. Returns the lines to report;
// an empty array means nothing moved.
export function collectFindings({ issue, brief, comments = [], git, base = "origin/staging" }) {
  const found = [];

  if (comments.length) {
    const last = comments[comments.length - 1];
    const who = (last.author && last.author.login) || "?";
    found.push(`留言：${comments.length} 則（最新 ${String(last.createdAt || "").slice(0, 10)} ${who}）→ 讀 gh issue view ${issue} --comments，確認定案沒被改`);
  }

  const done = lines(git(["log", base, "--oneline", "-E", `--grep=#${issue}([^0-9]|$)`]));
  if (done.length) found.push(`已有 commit 提到 #${issue}（可能已修過）：${done.slice(0, 3).join("；")}`);

  let hashOk = Boolean(brief.hash);
  if (hashOk) {
    try { git(["cat-file", "-e", `${brief.hash}^{commit}`]); } catch { hashOk = false; }
  }
  if (!hashOk) {
    found.push(`找不到調查時的 commit（${brief.hash || "未記錄"}）→ 所有 [實測] 視為未驗證`);
  } else {
    const range = `${brief.hash}..${base}`;
    if (brief.files.length) {
      const changed = lines(git(["diff", "--name-only", range, "--", ...brief.files]));
      if (changed.length) found.push(`檔案在 ${brief.hash} 之後有變：${changed.join(", ")} → 重驗與這些檔案有關的 [實測]`);
    }
    for (const fn of brief.functions) {
      const commits = lines(git(["log", range, "--oneline", `-G${escapeRegex(fn)}`]));
      if (commits.length) found.push(`函式 ${fn} 相關行在 ${brief.hash} 之後有改：${commits.slice(0, 3).join("；")}`);
    }
  }

  const current = lines(git(["branch", "--show-current"]))[0] || "";
  const branches = lines(git(["for-each-ref", "--format=%(refname:short)", "refs/heads/task/"]));
  for (const branch of branches) {
    if (branch === current) continue;
    try { git(["merge-base", "--is-ancestor", branch, base]); continue; } catch { /* not merged yet */ }
    const hits = [];
    if (brief.files.length) hits.push(...lines(git(["diff", "--name-only", `${base}...${branch}`, "--", ...brief.files])));
    for (const fn of brief.functions) {
      if (lines(git(["log", `${base}..${branch}`, "--oneline", `-G${escapeRegex(fn)}`])).length) hits.push(fn);
    }
    if (hits.length) found.push(`平行分支 ${branch} 也動到：${hits.join(", ")} → 先看它的改動，避免衝突`);
  }

  return found;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function main(arg) {
  const issue = Number.parseInt(String(arg || "").replace(/^#/, ""), 10);
  if (!Number.isInteger(issue) || issue <= 0) {
    console.error("用法：node scripts/issue-preflight.mjs <issue#>");
    return 2;
  }
  let data;
  try { data = JSON.parse(run("gh", ["issue", "view", String(issue), "--json", "body,comments"])); } catch (error) {
    console.error(`讀不到 #${issue}：${error.message.split("\n")[0]}`);
    return 2;
  }
  const brief = parseBrief(data.body);
  if (!brief) {
    console.log(`#${issue} 無實作區塊，照一般流程調查`);
    return 0;
  }
  try { run("git", ["fetch", "-q", "origin"]); } catch { console.log("（git fetch 失敗，以下用本機的 origin/staging 比對）"); }
  const found = collectFindings({ issue, brief, comments: data.comments || [], git: (args) => run("git", args) });
  if (!found.length) {
    console.log(`OK（#${issue} 調查於 ${brief.hash} 之後無相關變動）`);
    return 0;
  }
  for (const line of found) console.log(`- ${line}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv[2]));
}
