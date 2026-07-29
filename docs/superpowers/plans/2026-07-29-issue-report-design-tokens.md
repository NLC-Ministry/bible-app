# Issue Report Design Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge Tailwind CDN semantic colors to Bible app CSS tokens and restyle the issue-report FAB + drawer to match the design system.

**Architecture:** Extend `tailwind.config` in `index.html` so shadcn utilities resolve via CSS variables; lightly restyle `SupportFab` and `ReportDrawer` for flat brand chrome, solid sheet surfaces, semantic alerts, and token z-index/shadows.

**Tech Stack:** Vanilla SPA + React islands, Tailwind CDN, Vaul, Vitest source assertions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-issue-report-design-tokens-design.md`
- Bridge only — no new hex palettes in Tailwind config
- Keep `preflight: false`
- Do not rewrite admin report views or replace Vaul
- Prefer weight 500 for UI chrome titles/buttons

---

### Task 1: Failing token/bridge tests

**Files:**
- Create: `scripts/issue-report-design-tokens.test.mjs`
- Test: `scripts/issue-report-design-tokens.test.mjs`

**Interfaces:**
- Consumes: `index.html`, `components/issue-report/SupportFab.tsx`, `components/issue-report/ReportDrawer.tsx`
- Produces: Vitest assertions for bridge keys and banned patterns

- [ ] **Step 1: Write failing tests** asserting Tailwind config maps `primary`, `card`, `muted`, `destructive`, `border`, `input`, `ring` to CSS vars; FAB/drawer lack `emerald-*` and `z-[9999]`
- [ ] **Step 2: Run tests — expect fail**
- [ ] **Step 3: Implement bridge + restyles (Tasks 2–3)**
- [ ] **Step 4: Run tests — expect pass**

### Task 2: Tailwind CDN theme bridge

**Files:**
- Modify: `index.html` (tailwind.config script)

- [ ] **Step 1: Extend `theme.extend.colors`** per spec mapping table
- [ ] **Step 2: Optionally extend boxShadow/zIndex** if needed for utilities used by components

### Task 3: Restyle SupportFab + ReportDrawer

**Files:**
- Modify: `components/issue-report/SupportFab.tsx`
- Modify: `components/issue-report/ReportDrawer.tsx`

- [ ] **Step 1: FAB** — flat primary, no glass, token shadow/z-index, brand hover/focus, icon size
- [ ] **Step 2: Drawer** — solid card, overlay z-index, success/danger tokens, weight 500, drop emerald/z-[9999]
- [ ] **Step 3: Re-run `npm test -- scripts/issue-report-design-tokens.test.mjs`**
