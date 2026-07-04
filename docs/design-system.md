# Bible Speed Reading — Design System

Satellite app under [NewLife Member Hub](https://member.newlife.org.tw/). Shares UX principles with the hub (solid surfaces, clear typography, semantic colors) while using **#04A9D2** as the satellite brand color.

## Rules

1. **No gradient fills on UI chrome** — buttons, tabs, nav, cards, progress bars use flat colors.
2. **Content-first reader** — scripture area stays calm; brand accent on verse numbers and primary actions only.
3. **Three themes** — light (default), dark, warm (sepia reading mode).

## Brand tokens (CSS)

| Token | Value | Use |
|-------|-------|-----|
| `--color-brand` | `#04A9D2` | Primary actions, active nav, links |
| `--color-brand-hover` | `#0396BA` | Button hover |
| `--color-brand-active` | `#0284A3` | Button pressed |
| `--color-brand-subtle` | 12% brand mix | Selected pills, focus rings |
| `--color-brand-muted` | 8% brand mix | Hover backgrounds |
| `--color-brand-border` | 24% brand mix | Borders, selected states |

Legacy alias: `--primary-color` → `--color-brand`.

## Shadow scale (Member Hub / Tailwind aligned)

Neutral shadows only — no brand-tinted glows on buttons, tabs, or cards.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Cards, header, bento tiles |
| `--shadow-md` | Tailwind `shadow-md` | Floating controls, plan covers |
| `--shadow-lg` | Tailwind `shadow-lg` | Modals, dropdowns, login card |
| `--shadow-up-md` / `--shadow-up-lg` | Flipped md/lg | Bottom sheets |
| `--shadow-none` | none | Solid buttons, active tabs |
| `--shadow-focus-ring` | 3px brand ring | Input focus (not elevation) |
| `--shadow-card` | alias → `--shadow-sm` | Legacy |
| `--shadow-hover` | alias → `--shadow-sm` | Legacy (hover uses border, not lift) |

## Semantic tokens

| Token | Value |
|-------|-------|
| `--color-success` | `#66F78F` |
| `--color-warning` | `#FE7615` |
| `--color-danger` | `#FC365A` |
| `--color-white` | `#FAFAFA` |
| `--color-black` | `#0F0F0F` |

## Surfaces

| Token | Light |
|-------|-------|
| `--bg-app` | `#FAFAFA` |
| `--bg-card` | `#FFFFFF` |
| `--border-default` | `rgba(0,0,0,0.1)` |
| `--shadow-sm` | Card / header elevation (see Shadow scale) |

## Typography

Member Hub uses **medium (500)** for emphasis (titles, labels, buttons, nav) and **normal (400)** for body text. Avoid 600–900 weights on UI chrome.

| Token | Value |
|-------|-------|
| `--type-weight-strong` | `500` |
| `--type-weight-regular` | `400` |

| Class | Size / weight |
|-------|----------------|
| `.type-page-title` | 1.75rem / 500 |
| `.type-section-title` | 1.25rem / 500 |
| `.type-card-title` | 1.125rem / 500 |
| `.type-subsection-title` | 1rem / 500 |
| `.type-label` | 0.875rem / 500 |
| `.type-nav` | 0.875rem / 500 |
| `.type-brand-title` | 0.875rem / 500 (header brand) |
| `.type-lead` | 1rem / 400, muted |
| `.type-body` | 1rem / 400, line-height 1.625 |
| `.type-caption` | 0.875rem / 400, muted |

Body font: Inter + Noto Sans TC.

## Components

| Class | Role |
|-------|------|
| `.primary-btn` | Solid brand button |
| `.secondary-btn` | Outlined neutral |
| `.danger-btn` | Solid danger |
| `.glass-card` | Solid card (legacy name) |
| `.stat-card--primary` | Stats bento hero tile |
| `.stat-card--neutral` | Stats bento tile |

## Chart colors (JS)

Defined in `js/design-tokens.js`:

```js
NLC_CHART.brand      // #04A9D2
NLC_CHART.success    // #66F78F
NLC_CHART.warning    // #FE7615
NLC_PLAN_COVERS      // solid plan thumbnail fills
NLC_MEMBER_COLORS    // avatar / trail palette
```

## Themes

- **Light** — `body.light-theme` (default)
- **Dark** — `body.dark-theme`
- **Warm** — `body.warm-theme` (sepia paper `#F4ECD8`, brand accents for progress)

## Exceptions

- Achievement badges may use flat gold/amber (`#F59E0B`) for unlocked state semantics.
- Loading skeleton shimmer and progress-bar shine animations use neutral/white gradients (not brand chrome).
- Plan cover photo overlays use dark scrim gradients for text legibility.

## Satellite wayfinding

- Header brand: `assets/bible-reading-icon.svg`
- PWA `theme_color`: `#04A9D2`
- SSO via Logto; hub URL from `NLC_CONFIG.memberHubUrl`
