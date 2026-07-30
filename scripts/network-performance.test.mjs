import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import {
  NetworkMetricBuffer,
  getResponsePayloadBytes
} from "../js/performance/network-metrics.mjs";

describe("privacy-safe network performance metrics", () => {
  it("keeps a bounded, sanitized in-memory buffer without request data", () => {
    const metrics = new NetworkMetricBuffer(2);
    metrics.record({
      name: "select:profiles?token=secret",
      status: 200,
      ttfbMs: 12.4,
      totalMs: 18.8,
      payloadBytes: 512,
      authorization: "Bearer secret",
      body: { email: "person@example.com" }
    });
    metrics.record({ name: "select:reading_logs", status: 500 });
    metrics.record({ name: "rpc:get_personal_plan_ranking_summary", status: 200 });

    const snapshot = metrics.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).not.toHaveProperty("authorization");
    expect(snapshot[0]).not.toHaveProperty("body");
    expect(JSON.stringify(snapshot)).not.toContain("person@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("summarizes TTFB, total time, errors and payload size", () => {
    const metrics = new NetworkMetricBuffer();
    metrics.record({ name: "select:global_plans", status: 200, ttfbMs: 10, totalMs: 20, payloadBytes: 100 });
    metrics.record({ name: "select:global_plans", status: 503, ttfbMs: 30, totalMs: 50, payloadBytes: 20 });

    expect(metrics.summary()).toEqual([{
      name: "select:global_plans",
      requests: 2,
      errors: 1,
      payloadBytes: 120,
      averageTtfbMs: 20,
      averageTotalMs: 35,
      maxTtfbMs: 30,
      maxTotalMs: 50
    }]);
  });

  it("reads Content-Length without serializing sensitive response bodies", () => {
    const response = { headers: new Headers({ "content-length": "2048" }) };
    expect(getResponsePayloadBytes(response)).toBe(2048);
  });

  it("records 10,000 samples with bounded memory", () => {
    const metrics = new NetworkMetricBuffer(80);
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      metrics.record({ name: "select:reading_logs", status: 200, ttfbMs: index % 20 });
    }
    const durationMs = performance.now() - started;

    expect(metrics.snapshot()).toHaveLength(80);
    expect(Number.isFinite(durationMs)).toBe(true);
  });
});
