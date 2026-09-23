import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterLogsToPlanBooks } from "../js/data/current-round-progress.mjs";

const db = readFileSync(new URL("../js/db.js", import.meta.url), "utf8");

describe("filterLogsToPlanBooks", () => {
  const logs = [
    { book: "出埃及記", chapter: 1, round: 1 },
    { book: "出埃及記", chapter: 2, round: 1 },
    { book: "民數記", chapter: 16, round: 1 },
    { book: "民數記", chapter: 17, round: 1 }
  ];

  it("drops logs whose book is outside the plan's books (0142 stale-client case)", () => {
    const result = filterLogsToPlanBooks(logs, ["出埃及記"]);
    expect(result.map(l => `${l.book}_${l.chapter}`)).toEqual(["出埃及記_1", "出埃及記_2"]);
  });

  it("does not filter when the plan has no book list", () => {
    expect(filterLogsToPlanBooks(logs, [])).toHaveLength(4);
    expect(filterLogsToPlanBooks(logs, null)).toHaveLength(4);
  });

  it("tolerates non-array logs", () => {
    expect(filterLogsToPlanBooks(null, ["出埃及記"])).toEqual([]);
  });
});

describe("fetchMergedUsersList chapter scope", () => {
  it("scopes other members' chapters_read / plan_progress to the plan's books", () => {
    expect(db).toContain("filterLogsToPlanBooks(uLogs.filter(l => uPlan ? l.plan_id === uPlan.id : false), planScopeBooks)");
    expect(db).toContain(": (linkedGlobalPlan && linkedGlobalPlan.books) || [];");
  });
});
