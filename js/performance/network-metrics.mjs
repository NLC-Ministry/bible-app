const DEFAULT_CAPACITY = 80;

function normalizeMetricName(value) {
  return String(value || "unknown")
    .split(/[?#]/, 1)[0]
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 80);
}

export class NetworkMetricBuffer {
  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Number(capacity) || DEFAULT_CAPACITY);
    this.items = [];
  }

  record(metric = {}) {
    const entry = Object.freeze({
      name: normalizeMetricName(metric.name),
      status: Number(metric.status) || 0,
      ttfbMs: Math.max(0, Math.round(Number(metric.ttfbMs) || 0)),
      totalMs: Math.max(0, Math.round(Number(metric.totalMs) || 0)),
      payloadBytes: Math.max(0, Math.round(Number(metric.payloadBytes) || 0)),
      at: Number(metric.at) || Date.now()
    });
    this.items.push(entry);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
    return entry;
  }

  snapshot() {
    return this.items.slice();
  }

  summary() {
    const groups = new Map();
    for (const item of this.items) {
      const group = groups.get(item.name) || {
        name: item.name,
        requests: 0,
        errors: 0,
        payloadBytes: 0,
        ttfbTotal: 0,
        totalTotal: 0,
        maxTtfbMs: 0,
        maxTotalMs: 0
      };
      group.requests += 1;
      if (item.status >= 400 || item.status === 0) group.errors += 1;
      group.payloadBytes += item.payloadBytes;
      group.ttfbTotal += item.ttfbMs;
      group.totalTotal += item.totalMs;
      group.maxTtfbMs = Math.max(group.maxTtfbMs, item.ttfbMs);
      group.maxTotalMs = Math.max(group.maxTotalMs, item.totalMs);
      groups.set(item.name, group);
    }
    return Array.from(groups.values()).map(group => ({
      name: group.name,
      requests: group.requests,
      errors: group.errors,
      payloadBytes: group.payloadBytes,
      averageTtfbMs: Math.round(group.ttfbTotal / group.requests),
      averageTotalMs: Math.round(group.totalTotal / group.requests),
      maxTtfbMs: group.maxTtfbMs,
      maxTotalMs: group.maxTotalMs
    }));
  }
}

export const networkMetrics = new NetworkMetricBuffer();

export function getResponsePayloadBytes(response) {
  const headerValue = response?.headers?.get?.("content-length");
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

