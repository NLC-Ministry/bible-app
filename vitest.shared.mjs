import { configDefaults } from "vitest/config"

// 真的跑 esbuild 建置的測試（#592）：預設 npm test 不跑，CI 用 npm run test:build 跑
export const BUILD_TESTS = [
  "scripts/bundle.test.mjs",
  "scripts/admin-console.test.mjs",
  "scripts/admin-legacy-boot.test.mjs",
]

// 測試用的假 project ref（#609）：scripts/lib/project-refs.mjs 先讀環境變數，所以測試不會碰到本機 .env 的真值。
// scripts/no-project-ref.test.mjs 的白名單也認這兩個。
export const FAKE_STAGING_REF = "aaaaaaaaaaaaaaaaaaaa"
export const FAKE_PRODUCTION_REF = "bbbbbbbbbbbbbbbbbbbb"
export const TEST_ENV = { SUPABASE_STAGING_REF: FAKE_STAGING_REF, SUPABASE_PRODUCTION_REF: FAKE_PRODUCTION_REF }

export const BASE_EXCLUDE = [...configDefaults.exclude, "dist/**", "dist-admin/**", ".worktrees/**", ".claude/**"]
