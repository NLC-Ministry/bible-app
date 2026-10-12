// 回報截圖壓縮：會友 App 的回報抽屜和後台（#550）共用。純瀏覽器 API，不依賴 App 的全域。
/**
 * Shrink a picked screenshot in-browser to ≤ ~300 KB before upload: WebP where
 * the browser can encode it, else JPEG (iOS WebKit silently returns PNG for
 * image/webp — #444). Canvas re-encode also drops EXIF/GPS. Returns null on
 * unsupported files.
 */
export async function compressScreenshot(
  file: File
): Promise<{ base64: string; mime: string; w: number; h: number } | null> {
  if (!file || !/^image\/(png|jpe?g|webp)$/i.test(file.type)) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;

  const encode = (mime: string, maxSide: number, quality: number) => {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG has no alpha: paint white first so transparent PNGs don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL(mime, quality);
    return { dataUrl, w, h };
  };

  const CAP = 300 * 1024;
  const attempts: Array<[number, number]> = [[1600, 0.7], [1600, 0.55], [1400, 0.5], [1200, 0.42], [1000, 0.4]];
  let best: { dataUrl: string; mime: string; w: number; h: number } | null = null;
  for (const mime of ["image/webp", "image/jpeg"]) {
    for (const [side, q] of attempts) {
      const out = encode(mime, side, q);
      // Browser can't encode this type (returned PNG instead) — try the next one.
      if (!out || !out.dataUrl.startsWith(`data:${mime}`)) break;
      best = { ...out, mime };
      // rough byte size of a base64 payload
      const bytes = Math.ceil((out.dataUrl.length - out.dataUrl.indexOf(",") - 1) * 0.75);
      if (bytes <= CAP) break;
    }
    if (best) break;
  }
  bitmap.close?.();
  if (!best) return null;
  return {
    base64: best.dataUrl.replace(/^data:[^,]*,/, ""),
    mime: best.mime,
    w: best.w,
    h: best.h
  };
}
