# Issue report shadcn Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-styled Vaul in `ReportDrawer` with a stock Vaul shadcn `drawer` wrapper.

**Architecture:** Add `components/ui/drawer.tsx` (Vaul primitives + stock layout). Rewrite `ReportDrawer` to compose `Drawer` / `DrawerContent` / `DrawerHeader` / `DrawerFooter` / `DrawerClose` and plain `Button`s. Keep report pipeline and zod form logic unchanged.

**Tech Stack:** React 18, vaul, existing `Button` + Tailwind CDN token bridge.

## Global Constraints

- Stay on **Vaul** (no `@base-ui/react`).
- Do not enable Tailwind `preflight`.
- Use `z-overlay` / `z-sheet` (not raw `z-50`) so layering matches the Bible app.
- Do not change FAB behavior.
- Per-repo git only under `bible-app/`; no commit unless user asks.

---

### Task 1: Add shadcn Vaul `drawer.tsx`

**Files:**
- Create: `components/ui/drawer.tsx`
- Test: `scripts/issue-report-design-tokens.test.mjs` (extend)

- [x] Write failing assertion that `components/ui/drawer.tsx` exports `DrawerContent` / `DrawerClose` and uses `z-overlay`/`z-sheet`
- [x] Implement drawer wrapper (stock Vaul composition; title classes are plain Tailwind)
- [x] Run `npm test -- scripts/issue-report-design-tokens.test.mjs` — pass

### Task 2: Rewrite `ReportDrawer` to compose the wrapper

**Files:**
- Modify: `components/issue-report/ReportDrawer.tsx`
- Modify: `scripts/issue-report-design-tokens.test.mjs`
- Verify: `components/issue-report/__tests__/IssueReport.test.ts`

- [x] Update design-token tests for stock composition (no custom X / `issue-report-submit` / raw `from "vaul"`)
- [x] Rewrite `ReportDrawer` to use ui/drawer + Button footer (submit + 取消)
- [x] Run `npm test -- scripts/issue-report-design-tokens.test.mjs components/issue-report/__tests__/IssueReport.test.ts`
- [x] Run `npm run build`

### Task 3: Done check

- [ ] Hard-refresh local app; open FAB → drawer; dismiss via overlay / cancel / swipe
