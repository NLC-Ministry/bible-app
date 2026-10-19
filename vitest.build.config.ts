import { defineConfig } from "vitest/config"
import base from "./vitest.config"
import { BASE_EXCLUDE, BUILD_TESTS } from "./vitest.shared.mjs"

// npm run test:build：只跑真的建置的測試（#592），CI 會跑。
// 不用 mergeConfig：它會把兩邊的 exclude 接起來，BUILD_TESTS 反而被排除。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: BUILD_TESTS,
    exclude: BASE_EXCLUDE,
  },
})
