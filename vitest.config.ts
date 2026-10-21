import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import { BASE_EXCLUDE, BUILD_TESTS, TEST_ENV } from "./vitest.shared.mjs"

export default defineConfig({
  test: {
    globals: true,
    env: TEST_ENV,
    environment: "node",
    exclude: [...BASE_EXCLUDE, ...BUILD_TESTS],
    // 通過的測試不印 console 輸出，只有失敗的才印（#592）
    silent: "passed-only",
    // 本機用 agent：通過的不印，只印失敗與摘要（給 Claude session 省 token，#592）；
    // CI 用 dot＋github-actions，失敗會標在 PR 的檔案上
    reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["agent"],
  },
  resolve: {
    alias: {
      // Absolute path so the alias resolves under both node and jsdom
      // environments (a relative "./" fails to resolve in jsdom transforms).
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
})
