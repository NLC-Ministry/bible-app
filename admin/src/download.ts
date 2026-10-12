// 下載檔案（#550）：admin-api 產生的 CSV，以及照搬區塊（iframe）交過來、已經記過稽核的檔案。

/** 把 Blob 存成檔案。 */
export function downloadBlob(doc: Document, filename: string, blob: Blob): void {
  const view = doc.defaultView;
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

/** admin-api 產生的 CSV：加 BOM，Excel 打開中文才不會亂碼。 */
export function downloadCsv(doc: Document, filename: string, csv: string): void {
  downloadBlob(doc, filename, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
}
