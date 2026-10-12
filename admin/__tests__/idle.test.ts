// 閒置自動登出（#555）：30 分鐘、前 1 分鐘提醒、看實際經過時間。
import { describe, it, expect, vi } from "vitest";
import { IDLE_TIMEOUT_MS, startIdleWatch } from "../src/idle.ts";

function setup() {
  let clock = 0;
  let tick: () => void = () => {};
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const onIdle = vi.fn();
  const onWarn = vi.fn();
  const onActive = vi.fn();
  const clearIntervalImpl = vi.fn();
  const stop = startIdleWatch({
    target,
    doc,
    onIdle,
    onWarn,
    onActive,
    now: () => clock,
    setIntervalImpl: (fn) => { tick = fn; return 1; },
    clearIntervalImpl
  });
  return {
    stop, target, doc, onIdle, onWarn, onActive, clearIntervalImpl,
    at: (ms: number) => { clock = ms; },
    tick: () => tick(),
    act: (type = "keydown") => target.dispatchEvent(new Event(type))
  };
}

describe("startIdleWatch", () => {
  it("warns a minute before, then signs out after 30 minutes without activity", () => {
    const w = setup();
    w.at(28 * 60 * 1000); w.tick();
    expect(w.onWarn).not.toHaveBeenCalled();
    w.at(29 * 60 * 1000); w.tick();
    expect(w.onWarn).toHaveBeenCalledTimes(1);
    expect(w.onIdle).not.toHaveBeenCalled();
    w.at(IDLE_TIMEOUT_MS); w.tick();
    expect(w.onIdle).toHaveBeenCalledTimes(1);
    expect(w.clearIntervalImpl).toHaveBeenCalled();
    w.at(IDLE_TIMEOUT_MS * 2); w.tick();
    expect(w.onIdle).toHaveBeenCalledTimes(1);
  });

  it("activity resets the clock and clears the warning", () => {
    const w = setup();
    w.at(29 * 60 * 1000); w.tick();
    w.act("pointerdown");
    expect(w.onActive).toHaveBeenCalledTimes(1);
    w.at(IDLE_TIMEOUT_MS + 5 * 60 * 1000); w.tick();
    expect(w.onIdle).not.toHaveBeenCalled();
    w.at(29 * 60 * 1000 + IDLE_TIMEOUT_MS); w.tick();
    expect(w.onIdle).toHaveBeenCalledTimes(1);
  });

  it("coming back after the limit (laptop asleep) signs out instead of extending", () => {
    const w = setup();
    w.at(IDLE_TIMEOUT_MS + 1000);
    w.act("keydown");
    expect(w.onIdle).toHaveBeenCalledTimes(1);
  });

  it("checks right away when the tab becomes visible again", () => {
    const w = setup();
    w.at(IDLE_TIMEOUT_MS + 1000);
    w.doc.dispatchEvent(new Event("visibilitychange"));
    expect(w.onIdle).toHaveBeenCalledTimes(1);
  });

  it("stop() removes listeners", () => {
    const w = setup();
    w.stop();
    w.at(IDLE_TIMEOUT_MS * 3);
    w.act();
    w.tick();
    expect(w.onIdle).not.toHaveBeenCalled();
  });
});
