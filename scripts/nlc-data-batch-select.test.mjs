import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
const db = readFileSync(join(root, "js", "db.js"), "utf8");

describe("nlc-data: batch action (Edge Function)", () => {
  it("accepts action:'batch' without requiring a top-level table", () => {
    const guard = edge.match(/if \(!\[[^\]]*\]\.includes\(action\) && \(!table/);
    expect(guard, "missing_table guard line").toBeTruthy();
    expect(guard[0]).toContain('"batch"');
  });

  it("reuses ONE resolved profile + one pipeline per query, in request order", () => {
    const branch = edge.slice(edge.indexOf('if (action === "batch")'), edge.indexOf('if (action === "send_care_reminder")'));
    expect(branch).toContain("Array.isArray(body.queries)");
    expect(branch).toContain("missing_queries");
    expect(branch).toContain("batch_too_large");
    expect(branch).toMatch(/queries\.length > 25/);
    // every slot runs through the shared pipeline at the same time (#631), results kept in request order
    expect(branch).toMatch(/await Promise\.all\(queries\.map\(/);
    expect(branch).toContain("await runSelectPipeline(spec || {}, profile, supabaseAdmin)");
    expect(branch).toContain("return jsonResponse({ data: results })");
    // resolveProfile / auth verification happens once, before the action dispatch
    expect(edge.indexOf("const profile = await resolveProfile")).toBeLessThan(edge.indexOf('if (action === "batch")'));
  });

  it("is read-only: a non-select spec is rejected in its own slot, others still run", () => {
    const branch = edge.slice(edge.indexOf('if (action === "batch")'), edge.indexOf('if (action === "send_care_reminder")'));
    expect(branch).toMatch(/spec\.action && spec\.action !== "select"/);
    expect(branch).toContain("batch_read_only");
    // one throwing query is caught per-slot, never aborts the batch
    expect(branch).toMatch(/catch \(queryErr\)[\s\S]*return \{ error: message \}/);
  });

  it("lets only the home page's read-only RPCs into a batch, through the same path as action:'rpc' (#631)", () => {
    const branch = edge.slice(edge.indexOf('if (action === "batch")'), edge.indexOf('if (action === "send_care_reminder")'));
    expect(branch).toContain('if (!BATCH_RPC_FUNCTIONS.has(String(spec.function || ""))) return { error: "batch_read_only" }');
    expect(branch).toContain("await runRpcRequest(spec, profile, supabaseAdmin, requestId)");
    // the single-request path checks retired plans before dispatch; every batch slot must too
    expect(branch).toContain("isRetiredPlanRequest(spec || {})");
    const single = edge.slice(edge.indexOf('    if (action === "rpc") {'), edge.indexOf('if (action === "batch")'));
    expect(single).toContain("await runRpcRequest(body, profile, supabaseAdmin, requestId)");
  });

  it("runSelectPipeline mirrors the single-query select pipeline (allowlist + forced scope + options)", () => {
    const fn = edge.slice(edge.indexOf("async function runSelectPipeline("), edge.indexOf("Deno.serve(async (req"));
    expect(fn).toContain('READ_TABLES.has(table) || canReportOwnSelect');
    expect(fn).toContain('return { error: "forbidden" }');
    expect(fn).toContain('isFeatureEnabled(supabaseAdmin, "pastoral_sharing_wall")');
    expect(fn).toContain('applyFilters(query, spec.filters || [])');
    expect(fn).toContain('await applyForcedScope(query, table, "select", profile, supabaseAdmin)');
    expect(fn).toContain("rangeFrom + MAX_ROWS_PER_REQUEST - 1");
    expect(fn).toContain("Math.min(MAX_ROWS_PER_REQUEST, Math.max(1, Number(spec.limit)");
    expect(fn).toMatch(/spec\.returning === "single"/);
    expect(fn).toMatch(/spec\.returning === "maybeSingle"/);
  });
});

describe("db.batchSelect (js/db.js)", () => {
  // Two definitions: the shim's (inside createNlcDataClient's return object) and
  // the top-level db method. Split the file at applyNlcProfile which sits between.
  const shimHalf = db.slice(db.indexOf("createNlcDataClient()"), db.indexOf("_batchSelectUnsupported: false"));
  const dbMethodHalf = db.slice(db.indexOf("_batchSelectUnsupported: false"), db.indexOf("applyNlcProfile(profile, lockedFields"));

  it("the NLC shim collapses select builders into one action:'batch' POST", () => {
    const method = shimHalf.slice(shimHalf.indexOf("async batchSelect(builders) {"));
    expect(method).toContain("builder && builder.request");
    expect(method).toContain('throw new Error("batchSelect is read-only")');
    expect(method).toContain('callEdge({ action: "batch", queries })');
    // maps results back in order; a per-row error becomes { data:null, error:{message,code} }
    expect(method).toContain("queries.map((_, index)");
    expect(method).toContain("{ data: null, error: { message: row.error, code: row.code || null } }");
    // a real whole-batch failure surfaces on every slot (like Promise.all rejecting)
    expect(method).toContain('queries.map(() => ({ data: null, error: error || { message: "batch_failed" } }))');
    // an nlc-data that doesn't know `batch` yet → signal the caller to fall back
    expect(method).toContain('code === "missing_table" || code === "unsupported_action"');
    expect(method).toContain("unsupported.batchUnsupported = true");
  });

  it("top-level db.batchSelect falls back to individual builders (real client OR EF without batch)", () => {
    expect(dbMethodHalf).toContain('typeof client.batchSelect !== "function"');
    expect(dbMethodHalf).toContain("return await client.batchSelect(list)");
    expect(dbMethodHalf).toContain("list.map(async (builder) =>");
    expect(dbMethodHalf).toContain("const runIndividually = () => Promise.all(");
    // deploy-order safety: once the EF proves it lacks batch, never try again this session
    expect(dbMethodHalf).toContain("this._batchSelectUnsupported = true");
    expect(dbMethodHalf).toMatch(/if \(err && err\.batchUnsupported\)[\s\S]*return runIndividually\(\)/);
  });

  it("batch requests are still retried on a transient 503 (read-only, idempotent)", () => {
    expect(db).toContain('request.action === "select" || request.action === "batch"');
  });

  it("records a batch POST as `batch:<n>` in the network metrics, not `batch:unknown`", () => {
    expect(db).toContain('request.action === "batch"');
    expect(db).toContain('`batch:${Array.isArray(request.queries) ? request.queries.length : "?"}`');
  });
});

describe("db.batchSelect — switched call sites (js/db.js)", () => {
  it("loadUserData batches global_plans + profiles + reading_plans (all under the 1000-row default)", () => {
    const fn = db.slice(db.indexOf("async loadUserData(force"), db.indexOf("async loadOrgStructure()"));
    expect(fn).toMatch(/const \[\[globalPlansResult, profileResult, firstPlansResult\], highlightsResult\]/);
    expect(fn).toMatch(/this\.batchSelect\(\[\s*[\s\S]*?from\("global_plans"\)[\s\S]*?from\("profiles"\)[\s\S]*?from\("reading_plans"\)[\s\S]*?\]\)/);
    // global_plans no longer wrapped in fetchAllRows here
    expect(fn).not.toContain("fetchAllRows(() => state.supabase.from(\"global_plans\")");
    // repository-backed / heavy-pagination reads stay out of the batch
    // （reading_logs 是第二段：要先有計畫清單才知道哪些計畫還能打卡，#474）
    expect(fn).toContain("await this.loadBootReadingLogs(");
    expect(fn).toContain("this.fetchAllHighlights()");
  });

  it("loadOrgStructure batches great_regions + pastoral_zones, but NOT the whole-church profiles scan", () => {
    const fn = db.slice(db.indexOf("async loadOrgStructure()"), db.indexOf("async loadOrgStructure()") + 3000);
    expect(fn).toMatch(/const \[regionSortResult, zoneSortResult\] = await this\.batchSelect\(\[\s*[\s\S]*?from\("great_regions"\)[\s\S]*?from\("pastoral_zones"\)[\s\S]*?\]\)/);
    // profiles keeps fetchAllRows — a >1000-member church would truncate at the
    // supabase-js 1000-row default and undercount the org tree.
    expect(fn).toMatch(/fetchAllRows\(\(\) => state\.supabase\s*\n?\s*\.from\("profiles"\)\s*\n?\s*\.select\("great_region, pastoral_zone, small_group"\)/);
  });
});

describe("db.batchSelect shim mapping — behaviour", () => {
  // Reconstruct the shim's batchSelect with a stubbed callEdge and exercise the
  // request-order mapping / per-row error / whole-batch error paths.
  function makeBatchSelect(callEdge) {
    return async function batchSelect(builders) {
      const list = Array.isArray(builders) ? builders : [];
      const queries = list.map((builder) => {
        const request = builder && builder.request;
        if (!request || !request.table) throw new Error("batchSelect expects NlcQueryBuilder select instances");
        if (request.action && request.action !== "select") throw new Error("batchSelect is read-only");
        return request;
      });
      if (!queries.length) return [];
      const { data, error } = await callEdge({ action: "batch", queries });
      if (Array.isArray(data)) {
        return queries.map((_, index) => {
          const row = data[index] || { error: "batch_result_missing" };
          if (row.error) return { data: null, error: { message: row.error, code: row.code || null } };
          return { data: row.data, error: null };
        });
      }
      const code = error && (error.error || error.message || error);
      if (code === "missing_table" || code === "unsupported_action") {
        const unsupported = new Error("nlc_data_batch_unsupported");
        unsupported.batchUnsupported = true;
        throw unsupported;
      }
      return queries.map(() => ({ data: null, error: error || { message: "batch_failed" } }));
    };
  }
  const b = (table, action) => ({ request: { table, action: action || "select" } });

  it("maps results back positionally, preserving per-row success/error", async () => {
    let sent = null;
    const batchSelect = makeBatchSelect(async (req) => {
      sent = req;
      return { data: [
        { data: [{ id: 1 }] },
        { error: "forbidden" },
        { data: null },
      ] };
    });
    const out = await batchSelect([b("global_plans"), b("secret_table"), b("reading_logs")]);
    expect(sent).toEqual({ action: "batch", queries: [
      { table: "global_plans", action: "select" },
      { table: "secret_table", action: "select" },
      { table: "reading_logs", action: "select" },
    ] });
    expect(out).toEqual([
      { data: [{ id: 1 }], error: null },
      { data: null, error: { message: "forbidden", code: null } },
      { data: null, error: null },
    ]);
  });

  it("propagates a real whole-batch failure (auth/503) onto every slot", async () => {
    const batchSelect = makeBatchSelect(async () => ({ error: { message: "登入狀態已失效" } }));
    const out = await batchSelect([b("global_plans"), b("profiles")]);
    expect(out).toEqual([
      { data: null, error: { message: "登入狀態已失效" } },
      { data: null, error: { message: "登入狀態已失效" } },
    ]);
  });

  it("throws batchUnsupported when the deployed nlc-data doesn't know action:'batch'", async () => {
    // undeployed EF answers a batch POST with missing_table (no top-level table)
    const batchSelect = makeBatchSelect(async () => ({ data: null, error: { error: "missing_table" } }));
    await expect(batchSelect([b("global_plans"), b("profiles")])).rejects.toMatchObject({ batchUnsupported: true });
  });

  it("rejects a write builder before any request is sent", async () => {
    let called = false;
    const batchSelect = makeBatchSelect(async () => { called = true; return { data: [] }; });
    await expect(batchSelect([b("reading_logs"), b("reading_logs", "insert")]))
      .rejects.toThrow("batchSelect is read-only");
    expect(called).toBe(false);
  });

  it("empty input short-circuits without a request", async () => {
    let called = false;
    const batchSelect = makeBatchSelect(async () => { called = true; return { data: [] }; });
    expect(await batchSelect([])).toEqual([]);
    expect(called).toBe(false);
  });
});
