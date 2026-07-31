import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { installPullToRefresh } from "./pull-to-refresh.mjs";

function touchEvent(window, type, y, x = 0) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    configurable: true,
    value: type === "touchend" ? [] : [{ clientY: y, clientX: x }]
  });
  Object.defineProperty(event, "changedTouches", {
    configurable: true,
    value: [{ clientY: y, clientX: x }]
  });
  return event;
}

describe("installPullToRefresh", () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bible.test/"
    });
    window = dom.window;
    document = window.document;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  afterEach(() => {
    dom.window.close();
  });

  it("calls the registered refresh handler after a top-of-page downward pull", async () => {
    const refresh = vi.fn();
    installPullToRefresh({ window, document, fallbackRefresh: vi.fn() });
    window.registerPullToRefresh(refresh);

    window.dispatchEvent(touchEvent(window, "touchstart", 0));
    window.dispatchEvent(touchEvent(window, "touchmove", 96));
    window.dispatchEvent(touchEvent(window, "touchend", 96));
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".pull-to-refresh-status").textContent).toContain("已更新");
  });

  it("ignores short pulls below the refresh threshold", async () => {
    const refresh = vi.fn();
    const fallbackRefresh = vi.fn();
    installPullToRefresh({ window, document, fallbackRefresh });
    window.registerPullToRefresh(refresh);

    window.dispatchEvent(touchEvent(window, "touchstart", 0));
    window.dispatchEvent(touchEvent(window, "touchmove", 24));
    window.dispatchEvent(touchEvent(window, "touchend", 24));
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(fallbackRefresh).not.toHaveBeenCalled();
  });

  it("falls back when no app refresh handler is registered", async () => {
    const fallbackRefresh = vi.fn();
    installPullToRefresh({ window, document, fallbackRefresh });

    window.dispatchEvent(touchEvent(window, "touchstart", 0));
    window.dispatchEvent(touchEvent(window, "touchmove", 96));
    window.dispatchEvent(touchEvent(window, "touchend", 96));
    await Promise.resolve();

    expect(fallbackRefresh).toHaveBeenCalledTimes(1);
  });
});
