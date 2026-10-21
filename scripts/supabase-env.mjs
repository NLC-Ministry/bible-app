// 用環境名稱代替 project ref 跑 Supabase CLI（ref 放 .env，不寫進指令與文件，#609）：
//   node scripts/supabase-env.mjs staging db push --linked --dry-run
//   node scripts/supabase-env.mjs production functions deploy nlc-data
// 等同 `npx supabase <args> --project-ref <該環境的 ref>`；ref 不會印出來。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requireProjectRef } from "./lib/project-refs.mjs";

/** 組出要交給 supabase CLI 的參數（純函式，測試用）。 */
export function buildSupabaseArgs(environment, args, ref) {
  if (!["staging", "production"].includes(environment)) {
    throw new Error("用法：node scripts/supabase-env.mjs <staging|production> <supabase 子指令…>");
  }
  if (!args.length) throw new Error("缺少 supabase 子指令，例如：db push --linked --dry-run");
  if (args.includes("--project-ref")) throw new Error("不要自己帶 --project-ref，環境名稱已經決定專案了");
  return ["supabase", ...args, "--project-ref", ref];
}

function main(argv) {
  const [environment, ...args] = argv;
  let ref;
  try {
    ref = requireProjectRef(environment);
    const command = buildSupabaseArgs(environment, args, ref);
    // Windows 的 npx 是 .cmd，需要 shell；ref 已驗證為 20 碼英數字，其餘參數原樣交給 CLI
    const result = spawnSync("npx", command, { stdio: "inherit", shell: process.platform === "win32" });
    process.exit(result.status ?? 1);
  } catch (err) {
    console.error(String(err.message || err).split(ref || "\u0000").join("<ref>"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
