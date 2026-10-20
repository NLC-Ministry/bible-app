// 雲柱測驗題目附圖上傳（#585）：照搬的雲柱測驗區塊（舊管理畫面）經後台外殼呼叫這支。
//
// 圖片放公開 bucket quiz-images（20261018030714_quiz_images_bucket.sql），檔名是伺服器產生的
// 隨機 UUID；前端只拿回檔名，自己組公開網址（js/modules/quiz-image.mjs 的 quizImagePublicUrl）。
// 題目本身仍由舊畫面經 nlc-data 存檔（那邊記「編輯雲柱測驗題目」稽核），這裡只記「上傳附圖」。
// 先上傳再記稽核；稽核記不成就把檔案刪掉、回失敗，不留沒有紀錄的檔案。
import { decodeBase64, IMAGE_MIMES } from "./reports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner } from "./types.ts";

export const QUIZ_IMAGES_BUCKET = "quiz-images";
// 請求本體上限 1 MB（handler.ts），base64 後 700 KB 剛好放得下；bucket 的 file_size_limit 同值
export const MAX_QUIZ_IMAGE_BYTES = 716800;

const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export type QuizImage = { mime: string; base64: string; w: number | null; h: number | null };

export function validateQuizImage(value: unknown): { ok: true; image: QuizImage } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "quiz_image_invalid" };
  const { mime, base64, w, h } = value as Record<string, unknown>;
  if (typeof mime !== "string" || !(IMAGE_MIMES as readonly string[]).includes(mime)) return { ok: false, error: "quiz_image_bad_type" };
  if (typeof base64 !== "string" || !base64) return { ok: false, error: "quiz_image_invalid" };
  if (base64.length > Math.ceil(MAX_QUIZ_IMAGE_BYTES / 3) * 4 + 8) return { ok: false, error: "quiz_image_too_large" };
  const size = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10000 ? n as number : null);
  return { ok: true, image: { mime, base64, w: size(w), h: size(h) } };
}

/** 檔頭要和宣告的格式一致，不讓別的檔案冒充圖片放進公開 bucket。 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46
    && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

export const runQuizImageUpload: ActionRunner = async ({ args, params, rpc, storage, log }) => {
  const checked = validateQuizImage(params.image);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const image = checked.image;
  if (!storage) return { ok: false, status: 500, error: "admin_api_failed", stage: "storage_unavailable" };
  const bytes = decodeBase64(image.base64);
  if (!bytes || bytes.length === 0) return { ok: false, status: 400, error: "quiz_image_invalid" };
  if (bytes.length > MAX_QUIZ_IMAGE_BYTES) return { ok: false, status: 400, error: "quiz_image_too_large" };
  if (sniffImageMime(bytes) !== image.mime) return { ok: false, status: 400, error: "quiz_image_bad_type" };

  const name = `${crypto.randomUUID()}.${EXT[image.mime]}`;
  const uploaded = await storage.upload(QUIZ_IMAGES_BUCKET, name, bytes, image.mime).catch((err: unknown) => ({ error: String(err) }));
  if (uploaded.error) {
    log?.(JSON.stringify({ event: "admin_api_upload_failed", bucket: QUIZ_IMAGES_BUCKET, message: uploaded.error }));
    return { ok: false, status: 500, error: "admin_api_failed", stage: "upload" };
  }
  const audited = await rpc("admin_api_record_event", {
    ...args,
    p_resource: `${QUIZ_IMAGES_BUCKET}/${name}`,
    p_detail: { kind: "lightning_quiz_image", name, mime: image.mime, bytes: bytes.length, w: image.w, h: image.h }
  });
  if (audited.error) {
    await storage.remove(QUIZ_IMAGES_BUCKET, [name]).catch(() => ({ error: null }));
    return sqlFailure("admin_api_record_event", audited.error);
  }
  return { ok: true, data: { name, w: image.w, h: image.h } };
};
