# Issue Report FAB + Drawer Design-Token Alignment

**Date:** 2026-07-29  
**Status:** Approved for implementation planning  
**Project:** `bible-app`  
**Components:** `SupportFab`, `ReportDrawer` (mounted via `IssueReportFab`)

## Purpose

Align the floating issue-report button and its Vaul bottom drawer with the Bible app design system so colors, elevation, typography weight, and stacking follow existing CSS tokens instead of unbound shadcn-style Tailwind defaults and hardcoded emerald/z-index values.

## Product Decision

Use a **Tailwind theme bridge** plus a **light component restyle**:

1. Extend the CDN `tailwind.config` so shadcn utility names (`primary`, `card`, `muted`, `destructive`, etc.) resolve to existing CSS custom properties on `:root` / theme bodies.
2. Restyle only the issue-report FAB and drawer to match design-system recipes (flat brand chrome, solid sheet surfaces, semantic success/danger, token z-index and shadows).

This benefits other React islands that already use the same utility names, without rewriting them in this tranche.

## Current Problem

- `index.html` loads Tailwind CDN with `preflight: false` only — no theme color mapping.
- `SupportFab` / `ReportDrawer` use classes like `bg-primary`, `text-muted-foreground`, `bg-card/95`, `border-border`, `z-[9999]`.
- Success alerts hardcode `emerald-*` instead of `--color-success*`.
- Titles use `font-bold` while the system prefers `--type-weight-strong` (500).
- Design system docs require flat brand fills on UI chrome; the FAB/drawer should not rely on glass/frosted card chrome for the panel.

## Design System Sources of Truth

- `docs/design-system.md`
- CSS tokens in `index.css` (`--color-brand*`, `--bg-*`, `--text-*`, `--shadow-*`, `--z-*`, `--radius-*`, `--type-weight-*`)
- Existing bottom-sheet patterns (`.bottom-sheet-*`) as visual reference for the drawer

## Approach

### A. Tailwind CDN theme bridge (`index.html`)

Extend `tailwind.config.theme.extend.colors` (and related keys as needed) so utilities resolve via CSS variables:

| Tailwind key | CSS token / value |
|---|---|
| `primary` | `var(--color-brand)` |
| `primary-foreground` | `#FFFFFF` (on brand) |
| `background` | `var(--bg-app)` |
| `foreground` | `var(--text-primary)` |
| `card` | `var(--bg-card)` |
| `card-foreground` | `var(--text-primary)` |
| `muted` | `var(--bg-input)` |
| `muted-foreground` | `var(--text-muted)` |
| `accent` | `var(--color-brand-muted)` |
| `accent-foreground` | `var(--text-primary)` |
| `destructive` | `var(--color-danger)` |
| `destructive-foreground` | `var(--color-danger-foreground)` |
| `border` | `var(--border-default)` |
| `input` | `var(--border-card)` |
| `ring` | `var(--color-brand-ring)` |

Keep `corePlugins.preflight: false`. Do not invent new hex palettes in the Tailwind config — bridge only.

Optional: map `boxShadow`/`borderRadius` aliases to `--shadow-*` / `--radius-*` where it reduces raw utility drift; not required if components set shadow via CSS vars or token-backed classes.

### B. SupportFab restyle

- Flat brand fill using bridged `primary`; white icon (`primary-foreground`).
- No backdrop-blur / glass treatment on the FAB chrome.
- Elevation via design-system shadow scale (`--shadow-lg` or bridged equivalent), not brand-tinted glow.
- Hover uses brand hover semantics (prefer `--color-brand-hover` if expressible; otherwise bridged primary hover that stays flat).
- Focus-visible uses brand ring (`ring` / `--shadow-focus-ring` behavior).
- z-index from the app scale (`--z-sheet` / `--z-modal` family), not `z-[9999]`. FAB must sit above mobile nav and content, and not cover toasts incorrectly if avoidable.
- Icon size aligned to design-system size scale (touch/lg).

### C. ReportDrawer restyle (same surface family as FAB)

- Overlay: `--z-overlay` (or sheet overlay stack), dimmed backdrop consistent with `.bottom-sheet-backdrop` (~45% black). Light blur on overlay only is acceptable.
- Panel: solid `var(--bg-card)` (no `bg-card/95` frost), top radius ≈ `--radius-lg`, elevation `--shadow-up-lg`.
- Header title: weight 500 (`--type-weight-strong`), `text-foreground` / `--text-primary`.
- Description / helper: muted caption semantics.
- Close control: muted icon; hover/active via `accent` bridge (`--color-brand-muted`), not arbitrary gray chips.
- Form labels: label weight/size consistent with `.type-label` (avoid loud uppercase tracking unless already a shared pattern).
- Inputs/select/textarea: border `input`/`border`, focus ring brand (`ring` / focus shadow token).
- Submit button: flat brand primary, weight 500, no gradient chrome.
- Success alert: `--color-success-subtle`, `--color-success-foreground`, `--color-success-border` (drop `emerald-*`).
- Error alert: danger tokens (`destructive` bridge / `--color-danger*`).

### D. Tests

Add or extend focused tests that:

- Assert Tailwind config in `index.html` maps the required semantic color keys to CSS variables / brand tokens.
- Assert `SupportFab` / `ReportDrawer` source no longer uses hardcoded `emerald-*` or `z-[9999]` for stacking.
- Prefer string/source assertions consistent with existing bible-app Vitest style unless a React render harness is already standard for these components.

## Out of Scope

- Rewriting `AdminReportView` / `AdminReportTable` / `PlanActivityCard` / `ResponsiveDialog` beyond what the global Tailwind bridge already improves.
- Globally replacing legacy `.primary-btn` gradient styles in `index.css`.
- Replacing Vaul with the vanilla `.bottom-sheet-*` markup.
- Changing report submission / offline pipeline behavior.

## Success Criteria

1. In light, dark, and warm themes, FAB and drawer colors track CSS design tokens.
2. FAB and drawer read as the same product family as existing bottom sheets and brand actions (flat brand, solid card, neutral shadows).
3. No semantic emerald hardcoding; no unbounded `z-[9999]` for these surfaces.
4. Bridge remains additive: existing non-React CSS is unchanged except where shared token docs need a short note.

## Implementation Notes

- Repo: `bible-app` only.
- Primary files: `index.html`, `components/issue-report/SupportFab.tsx`, `components/issue-report/ReportDrawer.tsx`, plus a focused test under `scripts/` or `components/issue-report/__tests__/`.
- After implementation, verify visually on light/dark (and warm if easy) with FAB open/closed.
