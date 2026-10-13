// Edge Function 部署會帶上哪些檔案（#564）：照 Supabase CLI 收檔的規則（apps/cli-go/pkg/function/deno.go 的
// WalkImportPaths：從 index.ts 起，跟著有副檔名的相對路徑 import 一路走）模擬一次，確認
//   · 每個相對 import 都找得到檔案（找不到，部署端就是 Module not found）；
//   · 走到的檔案只在函式自己的資料夾或 supabase/functions/_shared/ 裡；
//   · admin-api 與 nlc-data 都帶上同一份進度規則（_shared/progress）。
// 部署一律用 CLI（npx supabase functions deploy）；只上傳函式自己資料夾的方式會缺 _shared。
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = fileURLToPath(new URL("../supabase/functions/", import.meta.url));
// 和 CLI 同一條 regex（https://regex101.com/r/DfBdJA/1）
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:{[^{}]+}|.*?)\s*(?:from)?\s*['"](.*?)['"]|import\(\s*['"](.*?)['"]\)/gi;

function walkDeployGraph(entry) {
  const files = new Set();
  const missing = [];
  const queue = [path.normalize(entry)];
  while (queue.length) {
    const current = queue.pop();
    if (files.has(current) || missing.includes(current)) continue;
    if (!existsSync(current)) {
      missing.push(current);
      continue;
    }
    files.add(current);
    for (const match of readFileSync(current, "utf8").matchAll(IMPORT_PATTERN)) {
      const spec = (match[1] || match[2] || "").trim();
      if (!path.posix.extname(spec)) continue;
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
      queue.push(path.normalize(path.join(path.dirname(current), spec)));
    }
  }
  return { files: [...files], missing };
}

const functionNames = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(FUNCTIONS_DIR, entry.name, "index.ts")))
  .map((entry) => entry.name);
const relative = (file) => path.relative(FUNCTIONS_DIR, file).split(path.sep).join("/");

describe("edge function deploy graph", () => {
  it.each(functionNames)("%s: every relative import resolves, and only within its folder or _shared/", (name) => {
    const { files, missing } = walkDeployGraph(path.join(FUNCTIONS_DIR, name, "index.ts"));
    expect(missing.map(relative)).toEqual([]);
    const outside = files.map(relative).filter((file) => !file.startsWith(`${name}/`) && !file.startsWith("_shared/"));
    expect(outside).toEqual([]);
  });

  it("admin-api and nlc-data ship the same progress rules from _shared/progress", () => {
    const shared = (name) => walkDeployGraph(path.join(FUNCTIONS_DIR, name, "index.ts")).files
      .map(relative)
      .filter((file) => file.startsWith("_shared/"))
      .sort();
    const adminApi = shared("admin-api");
    expect(adminApi).toContain("_shared/progress/plan-report.mjs");
    expect(adminApi).toContain("_shared/progress/plan-progress.mjs");
    expect(adminApi).toContain("_shared/progress/church-campaign.mjs");
    expect(shared("nlc-data")).toEqual(adminApi);
  });

  it("the shared progress modules import nothing but each other (no npm:, URLs or browser globals)", () => {
    const dir = path.join(FUNCTIONS_DIR, "_shared", "progress");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const match of src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gm)) {
        expect(match[1], `${file}: ${match[1]}`).toMatch(/^\.\/[\w-]+\.mjs$/);
      }
      // 註解可以提到 window；程式碼不行（伺服器沒有 window）
      const code = src.replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(?:window|document|localStorage)\b/);
    }
  });
});
