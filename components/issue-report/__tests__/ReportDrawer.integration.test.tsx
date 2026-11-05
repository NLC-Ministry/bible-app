// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useForm } from "react-hook-form";
import { NativeSelect, NativeSelectOption } from "../../ui/native-select.tsx";
import { ReportDrawer, reportFormResolver, validateReport } from "../ReportDrawer.tsx";
import { ReportPipeline } from "../IssueReportBlocks.ts";

vi.mock("../IssueReportBlocks.ts", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ReportPipeline: {
      execute: vi.fn(async () => ({ success: true, source: "online", reportId: "report-1" })),
    },
    ThreadPipeline: {
      ...actual.ThreadPipeline,
      myReports: vi.fn(async () => ({ success: true, rows: [] })),
      get: vi.fn(async () => ({ success: true, data: { report: null, messages: [] } })),
    },
  };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function MiniForm({ onValid }: { onValid: (data: any) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: reportFormResolver,
    defaultValues: { category: "bug", description: "" },
  });
  return (
    <form onSubmit={handleSubmit(onValid)}>
      <NativeSelect id="category" {...register("category")}>
        <NativeSelectOption value="bug">Bug</NativeSelectOption>
        <NativeSelectOption value="ui">UI</NativeSelectOption>
        <NativeSelectOption value="data">Data</NativeSelectOption>
        <NativeSelectOption value="other">Other</NativeSelectOption>
      </NativeSelect>
      <textarea {...register("description")} />
      {errors.category && <span id="cat-err">{String(errors.category.message)}</span>}
      <button type="submit">submit</button>
    </form>
  );
}

async function setValue(el: HTMLElement, proto: any, value: string, evt: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(evt, { bubbles: true }));
  });
}

describe("ReportDrawer: category select + RHF integration", () => {
  it("submits with the user-chosen category (regression: NativeSelect must forward ref)", async () => {
    const onValid = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<MiniForm onValid={onValid} />); });

    const select = container.querySelector("select")!;
    const textarea = container.querySelector("textarea")!;
    await setValue(textarea, HTMLTextAreaElement.prototype, "a valid description", "input");
    await setValue(select, HTMLSelectElement.prototype, "ui", "change");

    const form = container.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });

    expect(container.querySelector("#cat-err")?.textContent ?? null).toBeNull();
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid.mock.calls[0][0].category).toBe("ui");
  });

  it("shows the localized Chinese message for an invalid category", () => {
    const result = validateReport({ category: "hacker", description: "some text" });
    expect(result.errors.category).toBe("請選擇有效的問題分類");
  });
});

// 真的把 ReportDrawer 畫出來：會友看到的錯誤訊息與送出內容（#669 換掉 zod 前後都跑過這組）。
describe("ReportDrawer: form validation as members see it", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => { roots.splice(0).forEach((r) => r.unmount()); });
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderDrawer() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => { root.render(<ReportDrawer isOpen onClose={() => {}} />); });
    return {
      container,
      textarea: container.querySelector("textarea")!,
      select: container.querySelector("select")!,
      async submit() {
        const form = container.querySelector("form")!;
        await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      },
    };
  }

  it.each([
    ["空白", ""],
    ["只有空白字元", "   \n  "],
  ])("描述%s：顯示「請填寫問題描述」且不送出", async (_label, value) => {
    const { container, textarea, submit } = await renderDrawer();
    await setValue(textarea, HTMLTextAreaElement.prototype, value, "input");
    await submit();
    expect(container.textContent).toContain("請填寫問題描述");
    expect(ReportPipeline.execute).not.toHaveBeenCalled();
  });

  it("描述超過 500 字：顯示「問題描述最多限制 500 字」且不送出", async () => {
    const { container, textarea, submit } = await renderDrawer();
    await setValue(textarea, HTMLTextAreaElement.prototype, "a".repeat(501), "input");
    await submit();
    expect(container.textContent).toContain("問題描述最多限制 500 字");
    expect(ReportPipeline.execute).not.toHaveBeenCalled();
  });

  it("沒選到有效分類：顯示「請選擇有效的問題分類」且不送出", async () => {
    const { container, textarea, select, submit } = await renderDrawer();
    await setValue(textarea, HTMLTextAreaElement.prototype, "合法內容", "input");
    await setValue(select, HTMLSelectElement.prototype, "hacker", "change");
    await submit();
    expect(container.textContent).toContain("請選擇有效的問題分類");
    expect(ReportPipeline.execute).not.toHaveBeenCalled();
  });

  it("修掉內容後錯誤訊息會消失，並能正常送出", async () => {
    const { container, textarea, submit } = await renderDrawer();
    await submit();
    expect(container.textContent).toContain("請填寫問題描述");

    await setValue(textarea, HTMLTextAreaElement.prototype, "後來補上內容", "input");
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container.textContent).not.toContain("請填寫問題描述");

    await submit();
    expect(ReportPipeline.execute).toHaveBeenCalledTimes(1);
  });

  it("正常送出：帶所選分類與去掉頭尾空白的描述", async () => {
    const { textarea, select, submit } = await renderDrawer();
    await setValue(textarea, HTMLTextAreaElement.prototype, "  頭尾有空白的描述  ", "input");
    await setValue(select, HTMLSelectElement.prototype, "data", "change");
    await submit();
    expect(ReportPipeline.execute).toHaveBeenCalledWith("data", "頭尾有空白的描述");
  });

  it("剛好 500 字可以送出；頭尾空白不算進上限", async () => {
    const { textarea, submit } = await renderDrawer();
    await setValue(textarea, HTMLTextAreaElement.prototype, ` ${"a".repeat(500)} `, "input");
    await submit();
    expect(ReportPipeline.execute).toHaveBeenCalledWith("bug", "a".repeat(500));
  });
});
