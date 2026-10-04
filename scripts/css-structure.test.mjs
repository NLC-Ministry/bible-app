import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #438：#425 大段刪 CSS 時連 `.pill-btn {` 一起刪掉，留下一段沒有選擇器的屬性，
// 瀏覽器整段忽略，計畫頁篩選鈕變回系統預設的白色按鈕。這裡檢查每個 CSS 檔的
// 大括號成對、且頂層沒有孤立的「屬性: 值;」。
const CSS_FILES = ["index.css", "css/admin-registration-statistics.css", "css/team-registration.css"];

function stripCommentsAndStrings(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

function findStructureProblems(css) {
  const src = stripCommentsAndStrings(css);
  const problems = [];
  let depth = 0;
  let segmentStart = 0;
  const lineAt = (i) => src.slice(0, i).split("\n").length;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      depth += 1;
      segmentStart = i + 1;
    } else if (ch === "}") {
      if (depth === 0) {
        problems.push(`多出來的 } （第 ${lineAt(i)} 行附近）`);
      } else {
        depth -= 1;
      }
      segmentStart = i + 1;
    } else if (ch === ";" && depth === 0) {
      const statement = src.slice(segmentStart, i).trim();
      if (!statement.startsWith("@")) {
        problems.push(`頂層有沒有選擇器的屬性「${statement.split("\n")[0]}」（第 ${lineAt(i)} 行附近）`);
      }
      segmentStart = i + 1;
    }
  }
  if (depth !== 0) problems.push(`少了 ${depth} 個 }`);
  return problems;
}

describe("CSS structure (#438)", () => {
  it.each(CSS_FILES)("%s has balanced braces and no orphan declarations", (file) => {
    expect(findStructureProblems(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("detects a rule whose selector line was deleted", () => {
    expect(findStructureProblems(".a {\n  color: red;\n}\n\n  padding: 0;\n  color: blue;\n}\n")).not.toEqual([]);
  });

  it(".pill-btn has its base rule", () => {
    expect(readFileSync("index.css", "utf8")).toMatch(/^\.pill-btn \{\r?\n\s+padding: 0\.45rem 1\.1rem;/m);
  });
});
