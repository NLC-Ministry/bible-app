// 舊管理畫面（#550）的匯出一律先記稽核：攔下所有 <a download> 下載，把檔案交給 onExport
// （legacy-entry.js → 後台外殼 → admin-api 記一筆 export → 成功才由外殼存檔）。
//
// 舊程式的匯出全部是「new Blob → URL.createObjectURL → <a download>.click()」，常常 click 完
// 馬上 revokeObjectURL。所以在 createObjectURL 時就記住 Blob，click 時直接拿 Blob 物件，
// 不用再去讀那個網址。認不得內容的下載一律不放行（fail closed）。

export function countCsvRecords(text) {
  let inQuotes = false;
  let records = 0;
  let hasContent = false;
  for (const ch of String(text || "")) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
    } else if (ch === "\n" && !inQuotes) {
      if (hasContent) records += 1;
      hasContent = false;
    } else if (ch !== "\r" && ch !== "﻿") {
      hasContent = true;
    }
  }
  if (hasContent) records += 1;
  // 第一列是標題
  return Math.max(0, records - 1);
}

export function dataUrlToBlob(win, href) {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(String(href || ""));
  if (!match) return null;
  try {
    const type = match[1] || "application/octet-stream";
    if (match[2]) {
      const binary = win.atob(match[3]);
      return new win.Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], { type });
    }
    return new win.Blob([decodeURIComponent(match[3])], { type });
  } catch (_err) {
    return null;
  }
}

export function installExportGuard(win, onExport) {
  const urlApi = win.URL;
  const blobs = new Map();
  const createObjectURL = urlApi.createObjectURL.bind(urlApi);
  const revokeObjectURL = urlApi.revokeObjectURL.bind(urlApi);
  urlApi.createObjectURL = (object) => {
    const url = createObjectURL(object);
    if (object instanceof win.Blob) blobs.set(url, object);
    return url;
  };
  urlApi.revokeObjectURL = (url) => {
    blobs.delete(url);
    revokeObjectURL(url);
  };

  const proto = win.HTMLAnchorElement.prototype;
  const nativeClick = proto.click;
  proto.click = function guardedClick() {
    if (!this.hasAttribute("download")) return nativeClick.call(this);
    const href = this.getAttribute("href") || "";
    const blob = blobs.get(this.href) || blobs.get(href) || dataUrlToBlob(win, href);
    onExport({ blob: blob || null, filename: this.getAttribute("download") || "" });
    return undefined;
  };

  // 使用者直接點到畫面上的 <a download>（不是程式呼叫 click()）也走同一條路
  const onDocumentClick = (event) => {
    const target = event.target;
    const anchor = target && typeof target.closest === "function" ? target.closest("a[download]") : null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    anchor.click();
  };
  win.document.addEventListener("click", onDocumentClick, true);

  return {
    restore() {
      urlApi.createObjectURL = createObjectURL;
      urlApi.revokeObjectURL = revokeObjectURL;
      proto.click = nativeClick;
      win.document.removeEventListener("click", onDocumentClick, true);
    }
  };
}
