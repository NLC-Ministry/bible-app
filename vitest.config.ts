import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [...configDefaults.exclude, "dist/**", "dist-admin/**", ".worktrees/**", ".claude/**"],
  },
  resolve: {
    alias: {
      // Absolute path so the alias resolves under both node and jsdom
      // environments (a relative "./" fails to resolve in jsdom transforms).
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
})
