import { describe, expect, it } from "vitest";
import { collectFindings, parseBrief } from "./issue-preflight.mjs";

const BODY = `## 背景
…

<details><summary>給實作 session（調查於 9bd8b7f（2026-10-01））</summary>

- 檔案：\`js/data/bible_data.js\`, scripts/a.mjs
- 函式：fetchBibleChapter、assertCompleteEnough
- [實測] bolls 無 RCUVTS：\`rm -rf /\`
</details>
`;

// Fake git: answers by the first matching rule, "" otherwise; a rule value of Error throws.
function fakeGit(rules = []) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    const hit = rules.find(([pattern]) => pattern.test(args.join(" ")));
    if (!hit) return "";
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  return { git, calls };
}

const clean = () => fakeGit([
  [/^branch --show-current$/, "task/379-rcuv\n"],
  [/^for-each-ref/, "task/379-rcuv\n"],
]);

describe("parseBrief", () => {
  it("reads hash, files and functions from the block", () => {
    expect(parseBrief(BODY)).toEqual({
      hash: "9bd8b7f",
      files: ["js/data/bible_data.js", "scripts/a.mjs"],
      functions: ["fetchBibleChapter", "assertCompleteEnough"],
    });
  });

  it("returns null when the issue has no block", () => {
    expect(parseBrief("## 背景\n沒有區塊")).toBeNull();
    expect(parseBrief(undefined)).toBeNull();
  });

  it("treats （無） as an empty list and tolerates a missing hash", () => {
    const brief = parseBrief("<details><summary>給實作 session</summary>\n- 檔案：CLAUDE.md\n- 函式：（無）\n</details>");
    expect(brief).toEqual({ hash: null, files: ["CLAUDE.md"], functions: [] });
  });
});

describe("collectFindings", () => {
  const brief = parseBrief(BODY);

  it("reports nothing when nothing moved", () => {
    const { git } = clean();
    expect(collectFindings({ issue: 379, brief, git })).toEqual([]);
  });

  it("flags comments posted on the issue", () => {
    const { git } = clean();
    const found = collectFindings({ issue: 379, brief, git, comments: [{ author: { login: "heryiyu" }, createdAt: "2026-10-02T01:00:00Z" }] });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("1 則");
    expect(found[0]).toContain("heryiyu");
  });

  it("flags commits that already mention the issue", () => {
    const { git } = fakeGit([[/^log origin\/staging --oneline -E --grep=#379/, "abc1234 fix RCUV (#379)\n"]]);
    expect(collectFindings({ issue: 379, brief, git }).join()).toContain("abc1234 fix RCUV (#379)");
  });

  it("flags listed files changed since the investigation", () => {
    const { git, calls } = fakeGit([[/^diff --name-only 9bd8b7f\.\.origin\/staging/, "js/data/bible_data.js\n"]]);
    const found = collectFindings({ issue: 379, brief, git });
    expect(found.join()).toContain("js/data/bible_data.js");
    expect(calls).toContain("diff --name-only 9bd8b7f..origin/staging -- js/data/bible_data.js scripts/a.mjs");
  });

  it("flags indirect changes through a listed function", () => {
    const { git } = fakeGit([[/^log 9bd8b7f\.\.origin\/staging --oneline -GfetchBibleChapter$/, "def5678 refactor loader\n"]]);
    const found = collectFindings({ issue: 379, brief, git });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("fetchBibleChapter");
  });

  it("treats every fact as unverified when the recorded commit is missing", () => {
    const { git, calls } = fakeGit([[/^cat-file/, new Error("bad object")]]);
    const found = collectFindings({ issue: 379, brief, git });
    expect(found.join()).toContain("視為未驗證");
    expect(calls.some((c) => c.startsWith("diff"))).toBe(false);
  });

  it("flags an unmerged parallel task branch touching the same files or functions", () => {
    const { git } = fakeGit([
      [/^branch --show-current$/, "task/379-rcuv\n"],
      [/^for-each-ref/, "task/379-rcuv\ntask/390-other\ntask/388-merged\n"],
      [/^merge-base --is-ancestor task\/390-other/, new Error("not ancestor")],
      [/^diff --name-only origin\/staging\.\.\.task\/390-other/, "js/data/bible_data.js\n"],
      [/^log origin\/staging\.\.task\/390-other --oneline -GassertCompleteEnough$/, "aaa1111 x\n"],
    ]);
    const found = collectFindings({ issue: 379, brief, git });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("task/390-other");
    expect(found[0]).toContain("js/data/bible_data.js, assertCompleteEnough");
    expect(found[0]).not.toContain("388");
  });

  it("never runs anything written in the issue body", () => {
    const { git, calls } = clean();
    collectFindings({ issue: 379, brief, git });
    expect(calls.some((c) => c.includes("rm -rf"))).toBe(false);
  });
});
