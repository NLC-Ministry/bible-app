// 後台回報收件匣（#550 第一組）：需要 SQL 以外步驟的 action。
//
// 稽核一律在 SQL 函式裡、和資料變動同一個交易（20261012045233_admin_api_reports.sql）；這裡只補
// Storage（截圖上傳、簽名網址、刪檔）和 CSV。Storage 失敗的處理比照 nlc-data 的 issue_thread_*：
// 上傳失敗就把佔位訊息清掉（不記稽核，那不是管理員的操作），刪檔失敗只寫 log（資料列已經刪了）。
import { reportsCsv, taipeiDate, type ReportExportRow } from "./exports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner } from "./types.ts";

export const ISSUE_SHOTS_BUCKET = "issue-report-shots";
export const SIGNED_URL_SECONDS = 300;
export const IMAGE_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;
export const MAX_IMAGE_BYTES = 512000;

const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export type ReportImage = { mime: string; base64: string; w: number | null; h: number | null };

/** 前端送來的截圖：格式、大小在這裡先擋，解碼留給 run。 */
export function validateReportImage(value: unknown): { ok: true; image: ReportImage | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, image: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "bad_image" };
  const { mime, base64, w, h } = value as Record<string, unknown>;
  if (typeof mime !== "string" || !(IMAGE_MIMES as readonly string[]).includes(mime)) return { ok: false, error: "bad_mime" };
  if (typeof base64 !== "string" || !base64) return { ok: false, error: "bad_image" };
  // base64 每 4 個字元 3 個位元組；先用長度擋掉明顯太大的，解碼後再精算
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) return { ok: false, error: "too_large" };
  const size = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10000 ? n as number : null);
  return { ok: true, image: { mime, base64, w: size(w), h: size(h) } };
}

export function decodeBase64(value: string): Uint8Array | null {
  try {
    const clean = value.replace(/^data:[^,]*,/, "");
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch (_err) {
    return null;
  }
}

/** 對話：SQL 回附件路徑 → 換成 5 分鐘有效的簽名網址，路徑本身不回給前端。 */
export const runReportThread: ActionRunner = async ({ args, rpc, storage, log }) => {
  const result = await rpc("admin_api_report_thread", args);
  if (result.error) return sqlFailure("admin_api_report_thread", result.error);
  if (!result.data) return { ok: false, status: 404, error: "report_not_found" };
  const thread = result.data as { report: unknown; messages?: Array<Record<string, unknown>> };
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const paths = messages
    .map((message) => message.attachment_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0 && path !== "pending");
  let urls: Record<string, string> = {};
  if (paths.length && storage) {
    try {
      urls = await storage.signedUrls(ISSUE_SHOTS_BUCKET, paths, SIGNED_URL_SECONDS);
    } catch (err) {
      log?.(JSON.stringify({ event: "admin_api_sign_failed", message: String(err) }));
    }
  }
  const cleaned = messages.map(({ attachment_path: path, ...rest }) => ({
    ...rest,
    has_attachment: typeof path === "string" && path.length > 0,
    attachment_url: typeof path === "string" ? urls[path] || null : null
  }));
  return { ok: true, data: { ...thread, messages: cleaned } };
};

/** 回覆：先建訊息（同交易記稽核），有截圖再上傳、回填；上傳失敗就把佔位訊息清掉。 */
export const runReportPost: ActionRunner = async ({ args, params, ctx, rpc, storage, log }) => {
  const checked = validateReportImage(params.image);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const image = checked.image;
  let bytes: Uint8Array | null = null;
  if (image) {
    if (!storage) return { ok: false, status: 500, error: "admin_api_failed", stage: "storage_unavailable" };
    bytes = decodeBase64(image.base64);
    if (!bytes || bytes.length === 0) return { ok: false, status: 400, error: "bad_image" };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, status: 400, error: "too_large" };
  }

  const posted = await rpc("admin_api_report_post", args);
  if (posted.error) return sqlFailure("admin_api_report_post", posted.error);
  if (!posted.data) return { ok: false, status: 404, error: "report_not_found" };
  const message = posted.data as { id: string; report_id: string };
  if (!image || !bytes || !storage) return { ok: true, data: message };

  const dropPlaceholder = async () => {
    const dropped = await rpc("admin_api_report_drop_attachment", {
      p_actor_id: ctx.actorId, p_actor_role: ctx.actorRole, p_message_id: message.id, p_audit: false, p_request_id: ctx.requestId
    });
    if (dropped.error) log?.(JSON.stringify({ event: "admin_api_drop_placeholder_failed", message_id: message.id, message: dropped.error.message || null }));
  };

  const path = `${message.report_id}/${message.id}.${EXT[image.mime]}`;
  const uploaded = await storage.upload(ISSUE_SHOTS_BUCKET, path, bytes, image.mime).catch((err: unknown) => ({ error: String(err) }));
  if (uploaded.error) {
    log?.(JSON.stringify({ event: "admin_api_upload_failed", message_id: message.id, message: uploaded.error }));
    await dropPlaceholder();
    return { ok: false, status: 500, error: "admin_api_failed", stage: "upload" };
  }
  const filled = await rpc("admin_api_report_set_attachment", {
    p_message_id: message.id, p_path: path, p_mime: image.mime, p_bytes: bytes.length, p_w: image.w, p_h: image.h
  });
  if (filled.error) {
    await storage.remove(ISSUE_SHOTS_BUCKET, [path]).catch(() => ({ error: null }));
    await dropPlaceholder();
    return sqlFailure("admin_api_report_set_attachment", filled.error);
  }
  return { ok: true, data: { ...message, has_attachment: true } };
};

async function removeFiles(storage: RunInputStorage, paths: string[], log?: (line: string) => void) {
  if (!paths.length || !storage) return;
  const removed = await storage.remove(ISSUE_SHOTS_BUCKET, paths).catch((err: unknown) => ({ error: String(err) }));
  if (removed.error) log?.(JSON.stringify({ event: "admin_api_remove_files_failed", count: paths.length, message: removed.error }));
}
type RunInputStorage = Parameters<ActionRunner>[0]["storage"];

export const runReportDropAttachment: ActionRunner = async ({ args, rpc, storage, log }) => {
  const result = await rpc("admin_api_report_drop_attachment", args);
  if (result.error) return sqlFailure("admin_api_report_drop_attachment", result.error);
  if (!result.data) return { ok: false, status: 404, error: "message_not_found" };
  const data = result.data as { report_id: string; old_path: string | null };
  if (data.old_path) await removeFiles(storage, [data.old_path], log);
  return { ok: true, data: { report_id: data.report_id } };
};

export const runReportDelete: ActionRunner = async ({ args, rpc, storage, log }) => {
  const result = await rpc("admin_api_report_delete", args);
  if (result.error) return sqlFailure("admin_api_report_delete", result.error);
  if (!result.data) return { ok: false, status: 404, error: "report_not_found" };
  const data = result.data as { id: string; paths?: unknown };
  const paths = Array.isArray(data.paths) ? data.paths.filter((path): path is string => typeof path === "string" && !!path) : [];
  await removeFiles(storage, paths, log);
  return { ok: true, data: { id: data.id } };
};

export const runReportExport: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_report_export", args);
  if (result.error) return sqlFailure("admin_api_report_export", result.error);
  const data = (result.data || {}) as { rows?: ReportExportRow[]; total?: number; truncated?: boolean };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return {
    ok: true,
    data: {
      filename: `回報匯出_${taipeiDate(new Date())}.csv`,
      csv: reportsCsv(rows),
      rows: rows.length,
      total: typeof data.total === "number" ? data.total : rows.length,
      truncated: data.truncated === true
    }
  };
};
