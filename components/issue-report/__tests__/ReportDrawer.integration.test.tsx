// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { NativeSelect, NativeSelectOption } from "../../ui/native-select.tsx";
import { reportSchema } from "../ReportDrawer.tsx";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function MiniForm({ onValid }: { onValid: (data: any) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(reportSchema as any),
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

  it("shows the localized Chinese message for an invalid category (Zod v4 `error` API)", () => {
    const result = reportSchema.safeParse({ category: "hacker", description: "some text" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const catIssue = result.error.issues.find((i) => i.path[0] === "category");
      expect(catIssue?.message).toBe("請選擇有效的問題分類");
    }
  });
});
