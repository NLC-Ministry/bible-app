import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

describe("Supabase migration versions", () => {
  it("uses each migration version only once", () => {
    const files = readdirSync(migrationsDirectory).filter(file => file.endsWith(".sql"));
    const versions = files.map(file => file.split("_")[0]);
    const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))];

    expect(duplicates, `Duplicate migration versions: ${duplicates.join(", ")}`).toEqual([]);
  });
});
