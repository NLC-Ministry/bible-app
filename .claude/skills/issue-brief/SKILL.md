---
name: issue-brief
description: Write the 「給實作 session」 block at the end of a new issue, and run the pre-start check before implementing an issue that has one. Use when opening an issue after a discussion, and when starting work on an issue.
---

# Issue brief: hand an investigation to the implementing session

The investigating session already knows where the code is, what was verified, and what was ruled out. Writing that down costs a few hundred tokens; re-investigating costs the next session tens of thousands. The block only saves anything if the next session can tell which parts are still true — hence the recorded commit, the source tags, and the pre-start check.

## Writing the issue

Append this block to the end of the issue body. Use **only what you already found** — never investigate further just to fill a line; leave a line out instead. Aim for 8–15 lines.

```markdown
<details><summary>給實作 session（調查於 <short sha of origin/staging>（YYYY-MM-DD））</summary>

- 檔案：path/a.js, path/b.mjs
- 函式：fnA, fnB
- [實測] <fact> — <one-line way to re-check it>
- [推論] <fact read from code, not run>
- [定案] <decision>（維護者 YYYY-MM-DD）
- 已排除：<option> — <why>
- 照抄：<existing code/issue to copy the pattern from>
- 測試：<test file>；<fastest command, e.g. npx vitest run <file> --reporter=dot>
- Handoff：Migration: … ／Depends-on: … ／Verify: …
</details>
```

- `檔案` and `函式` are parsed by `scripts/issue-preflight.mjs`: comma-separated, `（無）` when empty. List the functions the change relies on, so edits elsewhere that touch them are caught.
- Only three tags: **[實測]** you ran it and saw the result; **[推論]** you read code and concluded; **[定案]** the maintainer decided.
- Don't write code snippets, exact line numbers (they drift — name the function), the investigation story, or rules already in CLAUDE.md.

## Starting work on an issue

1. `node scripts/issue-preflight.mjs <issue#>` — one call. `OK` means nothing moved; otherwise it prints only what needs a look (new comments, commits mentioning the issue, listed files/functions changed since the recorded commit, unmerged `task/*` branches touching them). It never runs commands from the issue.
2. Judge each flagged line yourself: read new comments for changed decisions; re-check only the facts tied to what changed.
3. Trust by tag:
   - **[定案]** follow it, unless a comment changed it.
   - **[實測] about code** — trust unless step 1 flagged its file or function.
   - **[實測] about external APIs or DB** — re-run its check only if the implementation depends on it.
   - **[推論]** — verify only if the implementation depends on it.
4. **Write the reproducing test first.** If it doesn't fail the way the issue describes, stop and report back instead of implementing the issue as written.
