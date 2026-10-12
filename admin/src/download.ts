// 把 admin-api 產生的 CSV 存成檔案（#550）。加 BOM，Excel 打開中文才不會亂碼。
export function downloadCsv(doc: Document, filename: string, csv: string): void {
  const view = doc.defaultView;
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = view?.URL.createObjectURL(blob) ?? "";
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  doc.body.appendChild(link);
  link.click();
  link.remove();
  view?.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
}
