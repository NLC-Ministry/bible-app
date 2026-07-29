# Issue report: Vaul shadcn Drawer

**Date:** 2026-07-29  
**Status:** Approved

## Problem

`ReportDrawer` styles Vaul primitives by hand (custom close chrome, header borders, submit motion). That fights global `button` rules and looks non-standard.

## Decision

Use the classic **Vaul-based** shadcn Drawer (not Base UI). Add `components/ui/drawer.tsx` and compose `ReportDrawer` from stock parts.

## Design

1. **`components/ui/drawer.tsx`** — Vaul wrapper matching stock shadcn composition (`Drawer`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription`, `DrawerClose`, …). Overlay/content use app z-tokens (`z-overlay` / `z-sheet`). Titles use plain Tailwind (`text-lg font-semibold`, `text-sm text-muted-foreground`), not mms-core `type-*` classes. `shouldScaleBackground` defaults to `false` for this SPA.
2. **`ReportDrawer`** — Compose only; keep form/validation/`ReportPipeline`. Drop custom X, absolute close, framer submit scale, and `issue-report-submit` special chrome. Footer: primary submit + outline `DrawerClose` (取消).
3. **Out of scope** — FAB, Base UI migration, enabling Tailwind preflight.

## Success

Drawer looks like stock shadcn; close/dismiss via handle, overlay, and footer cancel; tests + build pass.
