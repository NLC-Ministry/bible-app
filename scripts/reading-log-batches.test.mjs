import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chunkUniqueValues, fetchReadingLogsByPlanIds } from "../js/data/reading-log-batches.mjs";

function createClient(rowsByPlanId) {
  const requests = [];
  return {
    requests,
    from(table) {
      const request = { table, ids: [], from: 0, to: 0 };
      const query = {
        select() { return query; },
        in(_column, ids) { request.ids = ids; return query; },
        order() { return query; },
        range(from, to) {
          request.from = from;
          request.to = to;
          requests.push({ ...request, ids: [...request.ids] });
          const rows = request.ids.flatMap(id => rowsByPlanId[id] || []);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }
      };
      return query;
    }
  };
}

describe("reading log batched loading", () => {
  it("deduplicates and splits plan ids into bounded chunks", () => {
    expect(chunkUniqueValues(["a", "b", "a", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });

  it("returns no rows and sends no request when there are no plans", async () => {
    const client = createClient({});
    await expect(fetchReadingLogsByPlanIds(client, [])).resolves.toEqual({ data: [], error: null });
    expect(client.requests).toHaveLength(0);
  });

  it("batches plan ids and paginates every batch", async () => {
    const client = createClient({
      a: [{ id: "1" }, { id: "2" }],
      b: [{ id: "3" }],
      c: [{ id: "4" }, { id: "5" }]
    });
    const result = await fetchReadingLogsByPlanIds(client, ["a", "b", "c"], { batchSize: 2, pageSize: 2 });

    expect(result.error).toBeNull();
    expect(result.data.map(row => row.id).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(client.requests.every(request => request.ids.length <= 2)).toBe(true);
    expect(client.requests.some(request => request.from === 2)).toBe(true);
  });

  it("is used by the merged-user loader instead of one unbounded IN query", () => {
    const db = readFileSync(new URL("../js/db.js", import.meta.url), "utf8");
    expect(db).toContain("fetchReadingLogsByPlanIds(");
    expect(db).toContain("const planIds = (allPlans || [])");
    expect(db).not.toContain('logsQuery = logsQuery.in("plan_id", planIds)');
  });
});
