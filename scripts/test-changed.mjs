// npm run test:changed（#592）：task session 交接前只跑「這次改動會影響到」的測試，全套留給整合與 CI。
//
// vitest 的 --changed 只沿著 import 找測試；但這個 repo 很多測試是用 readFileSync 讀原始碼字串
//（例如讀 js/db.js、supabase/migrations/…），改了那些檔案 --changed 找不到。這裡另外把
// 「內容裡寫著被改檔案路徑」的測試檔加進來，兩份合起來跑。
// 改到測試設定或套件（FULL_RUN_TRIGGERS）就直接跑全套。
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_TESTS } from "../vitest.shared.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const VITEST = join(root, "node_modules", "vitest", "vitest.mjs");

export const FULL_RUN_TRIGGERS = ["package.json", "package-lock.json", "vitest.config.ts", "vitest.shared.mjs", "vitest.build.config.ts"];
// 這些資料夾的測試多半是讀整個資料夾（readdirSync），不會寫出單一檔名：改了裡面的檔案，就把提到資料夾的測試也算進來
export const DIRECTORY_REFERENCES = ["supabase/migrations", "supabase/functions"];
const TEST_FILE = /\.(test|spec)\.(m?[jt]sx?)$/;

export const toPosix = (path) => path.replace(/\\/g, "/");

// 內容裡寫著任一被改檔案路徑（或上面那些資料夾）的測試檔
export function selectTextReferencingTests(testSources, changedFiles) {
  const needles = new Set();
  for (const file of changedFiles) {
    if (TEST_FILE.test(file)) continue;
    needles.add(file);
    for (const dir of DIRECTORY_REFERENCES) if (file.startsWith(`${dir}/`)) needles.add(dir);
  }
  const selected = [];
  for (const [testFile, source] of testSources) {
    if ([...needles].some((needle) => source.includes(needle))) selected.push(testFile);
  }
  return selected;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map(toPosix);
}

function changedSince(base) {
  return [...new Set([
    ...git(["diff", "--name-only", `${base}...HEAD`]),
    ...git(["diff", "--name-only", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ])];
}

function importRelatedTests(base) {
  const out = execFileSync(process.execPath, [VITEST, "list", "--changed", base, "--filesOnly", "--json"], { cwd: root, encoding: "utf8" });
  const json = out.slice(out.indexOf("["));
  return JSON.parse(json).map(({ file }) => toPosix(relative(root, file)));
}

function runVitest(args) {
  const { status } = spawnSync(process.execPath, [VITEST, "run", ...args], { cwd: root, stdio: "inherit" });
  process.exit(status ?? 1);
}

function main() {
  const base = process.argv[2] || "origin/staging";
  const changed = changedSince(base);
  if (!changed.length) {
    console.log(`test:changed：和 ${base} 比沒有改動，不用跑測試`);
    return;
  }
  const trigger = changed.find((file) => FULL_RUN_TRIGGERS.includes(file));
  if (trigger) {
    console.log(`test:changed：改到 ${trigger}，跑全套`);
    runVitest([]);
  }

  const testFiles = [...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])]
    .filter((file) => TEST_FILE.test(file) && !BUILD_TESTS.includes(file) && !file.startsWith(".claude/") && !file.startsWith(".worktrees/"));
  const sources = testFiles.map((file) => {
    try { return [file, readFileSync(join(root, file), "utf8")]; } catch { return [file, ""]; }
  });

  const byImport = importRelatedTests(base);
  const byText = selectTextReferencingTests(sources, changed);
  const files = [...new Set([...byImport, ...byText])].filter((file) => !BUILD_TESTS.includes(file));
  if (!files.length) {
    console.log(`test:changed：${changed.length} 個改動的檔案沒有對應的測試`);
    return;
  }
  console.log(`test:changed：${files.length} 個測試檔（import 相關 ${byImport.length}、讀原始碼 ${byText.length}）`);
  runVitest(files);
}

if (process.argv[1] && toPosix(fileURLToPath(import.meta.url)) === toPosix(process.argv[1])) main();
