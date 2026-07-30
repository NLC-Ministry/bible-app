/**
 * NlcQueryBuilder — ES-module characterization copy of the inline class in js/db.js.
 *
 * This module exists as a behavioral-spec copy that captures the current wire
 * format of the nlc-data Edge Function request object. It is NOT wired into
 * js/db.js in this phase; that rewire happens in Phase 2. Do not diverge the
 * serialization behavior from the original class without updating both files.
 */

class NlcQueryBuilder {
  constructor(table) {
    this.request = { table, action: null, filters: [] };
  }

  select(columns = "*") {
    if (!this.request.action) this.request.action = "select";
    this.request.select = columns;
    return this;
  }

  insert(payload) {
    this.request.action = "insert";
    this.request.payload = payload;
    return this;
  }

  update(payload) {
    this.request.action = "update";
    this.request.payload = payload;
    return this;
  }

  delete() {
    this.request.action = "delete";
    return this;
  }

  upsert(payload, options) {
    this.request.action = "upsert";
    this.request.payload = payload;
    this.request.options = options || null;
    return this;
  }

  eq(column, value) {
    this.request.filters.push({ type: "eq", column, value });
    return this;
  }

  is(column, value) {
    this.request.filters.push({ type: "is", column, value });
    return this;
  }

  in(column, value) {
    this.request.filters.push({ type: "in", column, value });
    return this;
  }

  or(expression) {
    this.request.or = expression;
    return this;
  }

  order(column, options = {}) {
    this.request.order = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(count) {
    this.request.limit = count;
    return this;
  }

  range(from, to) {
    this.request.range = { from, to };
    return this;
  }

  single() {
    this.request.returning = "single";
    return this;
  }

  maybeSingle() {
    this.request.returning = "maybeSingle";
    return this;
  }

  toRequest() {
    if (!this.request.action) this.request.action = "select";
    return this.request;
  }
}

/**
 * Factory function — creates a new builder for the given table.
 *
 * @param {string} table  The Supabase table name to target.
 * @returns {NlcQueryBuilder}
 */
export function buildRequest(table) {
  return new NlcQueryBuilder(table);
}
