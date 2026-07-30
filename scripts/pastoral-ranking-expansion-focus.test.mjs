import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const plan = readFileSync("js/modules/plan.js", "utf8");
const focusSource = plan.match(
  /function focusPastoralRaceRanking\(container\) \{[\s\S]*?\n\}/
)?.[0] || "";
const bindSource = plan.match(
  /function bindPastoralRankingToggle\(container\) \{[\s\S]*?\n\}/
)?.[0] || "";

function createHarness() {
  const frames = [];
  const listeners = [];
  const row = {
    getBoundingClientRect: () => ({ top: 210, height: 40 })
  };
  const details = {
    open: false,
    dataset: {},
    addEventListener(type, listener) {
      if (type === "toggle") listeners.push(listener);
    }
  };
  const container = {
    hidden: false,
    scrollTop: 0,
    scrollHeight: 600,
    clientHeight: 200,
    closest: selector => selector === "[data-pastoral-ranking-details]" ? details : null,
    querySelector: selector => selector === ".pastoral-race-row--mine" ? row : null,
    getBoundingClientRect: () => ({ top: 10 })
  };
  const factory = new Function(
    "requestAnimationFrame",
    `${focusSource}\n${bindSource}\nreturn { bindPastoralRankingToggle };`
  );
  const api = factory(callback => frames.push(callback));
  return { api, container, details, listeners, frames };
}

describe("pastoral leaderboard expansion focus", () => {
  it("waits for expanded layout and then centers the current pastoral zone", () => {
    const harness = createHarness();
    harness.api.bindPastoralRankingToggle(harness.container);

    expect(harness.listeners).toHaveLength(1);
    harness.details.open = true;
    harness.listeners[0]();
    expect(harness.frames).toHaveLength(1);
    expect(harness.container.scrollTop).toBe(0);

    harness.frames.shift()();
    expect(harness.frames).toHaveLength(1);
    harness.frames.shift()();
    expect(harness.container.scrollTop).toBe(120);
  });

  it("does not reposition while collapsed and does not bind twice", () => {
    const harness = createHarness();
    harness.api.bindPastoralRankingToggle(harness.container);
    harness.api.bindPastoralRankingToggle(harness.container);

    expect(harness.listeners).toHaveLength(1);
    harness.details.open = false;
    harness.listeners[0]();
    expect(harness.frames).toHaveLength(0);
    expect(harness.container.scrollTop).toBe(0);
  });

  it("binds the pastoral details control during ranking render", () => {
    expect(plan).toContain("bindPastoralRankingToggle(container)");
    expect(plan).toContain('container.closest("[data-pastoral-ranking-details]")');
    expect(plan).toContain('details.addEventListener("toggle"');
  });
});

