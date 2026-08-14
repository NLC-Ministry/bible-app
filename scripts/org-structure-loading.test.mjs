import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const db = read("js/db.js");
const auth = read("js/auth.js");
const plan = read("js/modules/plan.js");

describe("organization structure loading", () => {
  it("deduplicates concurrent requests for the same identity and scope", () => {
    expect(db).toContain("_orgStructurePromiseKey");
    expect(db).toContain("this._orgStructurePromiseKey === ownerKey");
    expect(db).toContain("return this._orgStructurePromise");
    expect(db).toContain("for (let attempt = 0; attempt < 2; attempt += 1)");
  });

  it("builds a complete candidate before atomically publishing it", () => {
    expect(db).toContain("const nextOrgStructure = createEmptyOrgStructure");
    expect(db).toContain("state.orgStructure = nextOrgStructure");
    expect(db.indexOf("const nextOrgStructure = createEmptyOrgStructure"))
      .toBeLessThan(db.indexOf("state.orgStructure = nextOrgStructure"));
  });

  it("keeps only a same-owner snapshot on refresh failure", () => {
    expect(db).toContain("this._orgStructureSnapshotKey !== ownerKey");
    expect(db).toContain("const preserved = this._orgStructureSnapshotKey === ownerKey");
    expect(db).toContain('this.notifyOrgStructureChanged("error", { preserved })');
    expect(db).toContain("ownerKey !== this.getOrgStructureOwnerKey()");
  });

  it("clears organization data on explicit authentication reset", () => {
    expect(auth).toContain('typeof db.resetOrgStructure === "function"');
    expect(auth).toContain("db.resetOrgStructure()");
  });

  it("repopulates cascading selectors after a new organization revision", () => {
    expect(plan).toContain('window.addEventListener("org-structure-updated"');
    expect(plan).toContain("Number(state.orgStructure?.revision || 0)");
    expect(plan).toContain("preservePreviousSelection");
    expect(plan).toContain("delete regionSelect.dataset.populatedFor");
  });
});
