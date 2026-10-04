// Tailwind 設定（#418）：原本內嵌在 index.html、交給 cdn.tailwindcss.com 在瀏覽器端即時產生 CSS；
// 現在由 scripts/bundle.mjs 在建置時用 Tailwind CLI（與 CDN 同為 v3.4.17）產生靜態 CSS，
// 只給 index.html 用（read/exam/grade 頁原本就沒載入 Tailwind）。
// content 要涵蓋所有會出現 class 字串的原始碼——CLI 只掃原始碼，不像 CDN 會看執行中的 DOM，
// 所以 class 一律寫完整字串，不要用字串拼接（例如 `bg-${color}`）。
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.{js,mjs,ts,tsx}",
    "./components/**/*.{js,ts,tsx}",
    "./lib/**/*.{js,ts,tsx}",
  ],
  // Without this, Tailwind v3 defaults to darkMode: 'media'
  // (prefers-color-scheme), so every dark: utility class in the app
  // ignores the in-app theme picker and follows the OS setting instead —
  // pick "dark" in-app on a light-OS device and every dark: style is
  // silently dropped (and vice versa; warm-sepia has no dark: story at
  // all, so it always fell to the light-mode value). js/state.js's
  // setBodyThemeClass() already adds a plain "dark" class to <body>
  // specifically for this.
  darkMode: ["class", ".dark"],
  corePlugins: {
    // No preflight: index.css owns the base styles.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        primary: "var(--color-brand)",
        /* Was #FFFFFF — measured 2.76:1 against --color-brand, fails AA.
           --color-solid-fill-foreground is fixed (not theme-flipping,
           see index.css) because --color-brand itself doesn't change
           across light/dark/warm — measures 6.95:1 in every theme. */
        "primary-foreground": "var(--color-solid-fill-foreground)",
        background: "var(--bg-app)",
        foreground: "var(--text-primary)",
        card: "var(--bg-card)",
        "card-foreground": "var(--text-primary)",
        muted: "var(--bg-input)",
        "muted-foreground": "var(--text-muted)",
        /* Neutral hover surface for ghost/outline — not brand cyan */
        accent: "color-mix(in srgb, var(--text-primary) 6%, var(--bg-card))",
        "accent-foreground": "var(--text-primary)",
        secondary: "color-mix(in srgb, var(--text-primary) 8%, var(--bg-card))",
        "secondary-foreground": "var(--text-primary)",
        destructive: "var(--color-danger)",
        /* Was var(--color-danger-foreground) — that token is designed for
           the *-subtle tint-background pattern (~4.45:1 there), not for
           sitting on the solid --color-danger fill, where it only measured
           1.47:1. --color-solid-fill-foreground is fixed (--color-danger
           doesn't change across themes either) — measures 5.31:1 in
           every theme. */
        "destructive-foreground": "var(--color-solid-fill-foreground)",
        border: "var(--border-default)",
        input: "var(--border-card)",
        ring: "var(--color-brand-ring)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        "up-md": "var(--shadow-up-md)",
        "up-lg": "var(--shadow-up-lg)",
      },
      zIndex: {
        overlay: "var(--z-overlay)",
        sheet: "var(--z-sheet)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
      },
    },
  },
};
