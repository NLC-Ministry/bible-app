import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 從 20260925071804_branch_baseline 開始改用 Supabase CLI 管理 migration（#255）。
// `supabase db push` 會拒絕推送版本號比遠端最新版本還舊的 migration，所以新的
// migration 一律用 `npx supabase migration new <名稱>` 產生的 14 位時間戳命名，
// 不能再用 0215_xxx 這種四位數編號。0001–0214 已經在兩個環境標記為已套用。
const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const BASELINE = "20260925071804";
const LAST_LEGACY = "0214";

const files = readdirSync(migrationsDirectory).filter(file => file.endsWith(".sql"));
const version = file => file.split("_")[0];

describe("migration naming", () => {
  it("keeps the CLI baseline placeholder", () => {
    expect(files).toContain(`${BASELINE}_branch_baseline.sql`);
  });

  it("adds no new four-digit migrations after the switch to the CLI", () => {
    const legacy = files.map(version).filter(v => /^\d{4}$/.test(v));
    const tooNew = legacy.filter(v => v > LAST_LEGACY);
    expect(tooNew, `用 \`npx supabase migration new <名稱>\` 建立時間戳命名的 migration：${tooNew.join(", ")}`).toEqual([]);
  });

  it("names every other migration with a 14-digit timestamp newer than the baseline", () => {
    const offenders = files
      .map(version)
      .filter(v => !/^\d{4}$/.test(v))
      .filter(v => !/^\d{14}$/.test(v) || v < BASELINE);
    expect(offenders).toEqual([]);
  });
});
