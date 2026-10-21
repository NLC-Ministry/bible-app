// #606：CodeQL 首次掃描後的小加固（icon 屬性轉義、焦點還原選擇器）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

describe("renderIcon 找不到圖示時的屬性轉義", () => {
  it("惡意 key 不會跳出 data-missing-icon 屬性", () => {
    const context = { console };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(readFileSync("js/design/icons.js", "utf8"), context);
    const render = context.window.renderIcon;
    const html = render('x" onmouseover="alert(1)');
    expect(html).toContain('data-missing-icon="x&quot; onmouseover=&quot;alert(1)"');
    expect(html).not.toContain('" onmouseover=');
  });
});

describe("renderInto 還原焦點的選擇器", () => {
  // utils.js 有 import，不能整檔 eval；只切出 renderInto 這個函式來跑。
  const source = readFileSync("js/utils.js", "utf8");
  const start = source.indexOf("function renderInto(");
  const end = start + source.slice(start).search(/\r?\n\}\r?\n/);
  expect(start).toBeGreaterThan(-1);
  const renderIntoSource = `${source.slice(start, end)}\n}`;

  function load(attr, value) {
    const dom = new JSDOM("<!doctype html><body><div id=host><input></div></body>", { runScripts: "outside-only" });
    const { window } = dom;
    window.requestAnimationFrame = fn => fn();
    window.eval(`${renderIntoSource}\nwindow.renderInto = renderInto;`);
    const host = window.document.getElementById("host");
    host.firstElementChild.setAttribute(attr, value);
    host.firstElementChild.focus();
    return { window, host };
  }

  it.each([
    ["name", 'a"b]c'],
    ["name", "plain-name"],
    ["data-focus-key", 'k"]x'],
  ])("%s=%j 重繪後仍還原焦點", (attr, value) => {
    const { window, host } = load(attr, value);
    expect(window.document.activeElement).toBe(host.firstElementChild);
    const html = "<input " + attr + "=\"" + value.replace(/"/g, "&quot;") + "\">";
    expect(() => window.renderInto(host, html)).not.toThrow();
    expect(window.document.activeElement.getAttribute(attr)).toBe(value);
  });
});
