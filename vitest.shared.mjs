import { configDefaults } from "vitest/config"

// 真的跑 esbuild 建置的測試（#592）：預設 npm test 不跑，CI 用 npm run test:build 跑
export const BUILD_TESTS = [
  "scripts/bundle.test.mjs",
  "scripts/admin-console.test.mjs",
  "scripts/admin-legacy-boot.test.mjs",
]

export const BASE_EXCLUDE = [...configDefaults.exclude, "dist/**", "dist-admin/**", ".worktrees/**", ".claude/**"]
