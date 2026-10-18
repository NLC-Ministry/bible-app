// 雲柱測驗題目附圖上傳（#585）：admin-api 的 lightning_quiz_image_upload。
// 守住能力、格式／大小／檔頭檢查、隨機檔名、先上傳再記稽核（記不成要刪檔），以及 bucket migration。
import { describe, expect, it, vi } from "vitest";
import { migrationFiles, readMigration } from "./migration-sql.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { MAX_QUIZ_IMAGE_BYTES, QUIZ_IMAGES_BUCKET, sniffImageMime } from "../supabase/functions/admin-api/quiz-images.ts";
import { AUDIT_ACTION_LABEL } from "../supabase/functions/admin-api/audit.ts";
import { QUIZ_IMAGES_BUCKET as CLIENT_BUCKET } from "../js/modules/quiz-image.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_CLIENT = "admin-spa-client";
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|png|jpg)$/;

function setup({ role = "admin", audit = { data: 1, error: null }, upload = { error: null } } = {}) {
  const calls = [];
  const files = { uploaded: [], removed: [] };
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: role, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event" && args.p_action === "lightning_quiz.image_upload") return audit;
      return { data: 1, error: null };
    }),
    storage: {
      upload: vi.fn(async (bucket, path, bytes, type) => { files.uploaded.push({ bucket, path, size: bytes.length, type }); return upload; }),
      remove: vi.fn(async (bucket, paths) => { files.removed.push({ bucket, paths }); return { error: null }; }),
      signedUrls: vi.fn(async () => ({}))
    },
    log: () => {},
    randomId: () => "generated-request-id"
  };
  return { deps, calls, files };
}

function post(params) {
  return new Request("https://example.supabase.co/functions/v1/admin-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://bible-speed-reading-admin.vercel.app",
      Authorization: "Bearer token-abc"
    },
    body: JSON.stringify({ action: "lightning_quiz_image_upload", params })
  });
}
const json = async (response) => ({ status: response.status, body: await response.json() });
const image = (bytes, mime = "image/webp") => ({ image: { mime, base64: bytes.toString("base64"), w: 1600, h: 900 } });

describe("lightning_quiz_image_upload", () => {
  it("needs content.manage", () => {
    expect(ADMIN_ACTIONS.lightning_quiz_image_upload.capabilities).toEqual(["content.manage"]);
    expect(AUDIT_ACTION_LABEL["lightning_quiz.image_upload"]).toBe("上傳雲柱測驗附圖");
    expect(AUDIT_ACTION_LABEL.lightning_quiz_image_upload).toBe("上傳雲柱測驗附圖");
  });

  it("refuses roles without the capability", async () => {
    const { deps, files } = setup({ role: "pastor" });
    const res = await json(await handleAdminRequest(post(image(WEBP)), deps));
    expect(res.status).toBe(403);
    expect(files.uploaded).toEqual([]);
  });

  it("uploads under a random uuid name and records the audit after the upload", async () => {
    for (const [bytes, mime, ext] of [[WEBP, "image/webp", "webp"], [PNG, "image/png", "png"], [JPEG, "image/jpeg", "jpg"]]) {
      const { deps, calls, files } = setup();
      const res = await json(await handleAdminRequest(post(image(bytes, mime)), deps));
      expect(res.status, mime).toBe(200);
      expect(res.body.data.name).toMatch(UUID_NAME);
      expect(res.body.data.name.endsWith(`.${ext}`)).toBe(true);
      expect(files.uploaded).toEqual([{ bucket: "quiz-images", path: res.body.data.name, size: bytes.length, type: mime }]);
      const audit = calls.find((call) => call.args?.p_action === "lightning_quiz.image_upload");
      expect(audit.args).toMatchObject({
        p_actor_id: ADMIN_ID, p_actor_role: "admin", p_result: "ok",
        p_resource: `quiz-images/${res.body.data.name}`,
        p_detail: { kind: "lightning_quiz_image", name: res.body.data.name, mime, bytes: bytes.length, w: 1600, h: 900 }
      });
    }
  });

  it("gives every upload a different name", async () => {
    const names = new Set();
    for (let i = 0; i < 3; i++) {
      const { deps } = setup();
      names.add((await json(await handleAdminRequest(post(image(WEBP)), deps))).body.data.name);
    }
    expect(names.size).toBe(3);
  });

  it("rejects bad types, mismatched file headers and oversize files without uploading", async () => {
    const cases = [
      [{ image: { mime: "image/svg+xml", base64: WEBP.toString("base64") } }, "quiz_image_bad_type"],
      [image(PNG, "image/webp"), "quiz_image_bad_type"],
      [image(Buffer.from("<html>not an image</html>"), "image/png"), "quiz_image_bad_type"],
      [image(Buffer.alloc(MAX_QUIZ_IMAGE_BYTES + 1024)), "quiz_image_too_large"],
      [{}, "quiz_image_invalid"],
      [{ image: { mime: "image/webp", base64: "" } }, "quiz_image_invalid"]
    ];
    for (const [params, error] of cases) {
      const { deps, files } = setup();
      const res = await json(await handleAdminRequest(post(params), deps));
      expect(res.status, error).toBeGreaterThanOrEqual(400);
      expect(res.status, error).toBeLessThan(500);
      if (res.status === 400 && res.body.error !== "payload_too_large") expect(res.body.error).toBe(error);
      expect(files.uploaded, error).toEqual([]);
    }
  });

  it("removes the file when the audit cannot be recorded", async () => {
    const { deps, files } = setup({ audit: { data: null, error: { message: "boom", code: "XX000" } } });
    const res = await json(await handleAdminRequest(post(image(WEBP)), deps));
    expect(res.status).toBe(500);
    expect(files.removed).toEqual([{ bucket: "quiz-images", paths: [files.uploaded[0].path] }]);
  });

  it("fails without recording an audit when the upload fails", async () => {
    const { deps, calls } = setup({ upload: { error: "storage down" } });
    const res = await json(await handleAdminRequest(post(image(WEBP)), deps));
    expect(res).toMatchObject({ status: 500, body: { error: "admin_api_failed" } });
    expect(calls.some((call) => call.args?.p_action === "lightning_quiz.image_upload")).toBe(false);
  });

  it("sniffs file headers", () => {
    expect(sniffImageMime(new Uint8Array(WEBP))).toBe("image/webp");
    expect(sniffImageMime(new Uint8Array(PNG))).toBe("image/png");
    expect(sniffImageMime(new Uint8Array(JPEG))).toBe("image/jpeg");
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("quiz-images bucket migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_quiz_images_bucket.sql"));
  const sql = readMigration(file);

  it("creates a public bucket limited to webp/png/jpeg and the server's size cap", () => {
    expect(QUIZ_IMAGES_BUCKET).toBe(CLIENT_BUCKET);
    expect(sql).toMatch(/VALUES \('quiz-images', 'quiz-images', true, 716800,/);
    expect(MAX_QUIZ_IMAGE_BYTES).toBe(716800);
    expect(sql).toContain("ARRAY['image/webp','image/jpeg','image/png']");
  });

  it("adds no storage.objects policy, so clients cannot list or write", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
