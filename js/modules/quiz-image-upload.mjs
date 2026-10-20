// 雲柱測驗題目附圖上傳（#585）：後台編輯題目時選一張圖 → 在瀏覽器縮成 webp → 交給上傳函式。
//
// 上傳函式由後台的照搬區塊入口（admin-legacy/legacy-entry.js）設定：經後台外殼呼叫 admin-api，
// 回傳伺服器產生的檔名（<uuid>.webp）。沒有設定（例如測試）時，表單不顯示「加入圖片」。
// 手機放大檢視需要至少 960px 寬（quiz-image.mjs），所以寬度上限抓 2000px、品質逐步往下降到放得進大小上限。

export const QUIZ_IMAGE_MAX_WIDTH = 2000;
// 和 admin-api 的 MAX_QUIZ_IMAGE_BYTES、quiz-images bucket 的 file_size_limit 同值
export const QUIZ_IMAGE_MAX_BYTES = 716800;
export const QUIZ_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5];

let uploader = null;

/** uploader: ({ mime, base64, w, h }) => Promise<{ ok: true, name } | { ok: false, message }> */
export function setQuizImageUploader(fn) {
  uploader = typeof fn === "function" ? fn : null;
}

export function canUploadQuizImage() {
  return !!uploader;
}

/** 等比縮到寬度不超過 maxWidth（只縮不放大）。 */
export function fitWithin(width, height, maxWidth = QUIZ_IMAGE_MAX_WIDTH) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  if (w <= maxWidth) return { w, h };
  return { w: maxWidth, h: Math.max(1, Math.round(h * maxWidth / w)) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error || new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 選到的檔案 → { mime, base64, w, h }；不是圖片或縮不到上限以內就丟錯（message 是給管理員看的中文）。 */
export async function prepareQuizImage(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type || "")) {
    throw new Error("圖片只接受 PNG、JPEG、WebP。");
  }
  let source;
  try {
    source = await loadImage(file);
  } catch (_) {
    throw new Error("這張圖片打不開，請換一張。");
  }
  const { w, h } = fitWithin(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(source, 0, 0, w, h);
  source.close?.();
  for (const quality of QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    // 不支援 webp 輸出的瀏覽器會改給 png，那就改用 jpeg
    const output = blob && blob.type === "image/webp" ? blob : await canvasToBlob(canvas, "image/jpeg", quality);
    if (output && output.size <= QUIZ_IMAGE_MAX_BYTES) {
      return { mime: output.type, base64: await blobToBase64(output), w, h };
    }
  }
  throw new Error("圖片太大，縮小後還是超過 700 KB，請換一張。");
}

/** 選檔 → 縮圖 → 上傳；成功回傳檔名，失敗丟錯。 */
export async function uploadQuizImageFile(file) {
  if (!uploader) throw new Error("這裡不能上傳圖片，請到系統管理後台操作。");
  const image = await prepareQuizImage(file);
  const reply = await uploader(image);
  if (!reply || reply.ok !== true || typeof reply.name !== "string") {
    throw new Error(reply?.message || "上傳失敗，請再試一次。");
  }
  return reply.name;
}
