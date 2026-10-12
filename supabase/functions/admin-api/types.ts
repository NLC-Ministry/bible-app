// admin-api 各檔共用的型別（#547、#550）。只有型別，沒有執行期程式。

export type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

/** Storage 的最小介面：index.ts 用 service role 的 supabase client 實作，測試用假的。 */
export type StorageDeps = {
  upload: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<{ error: string | null }>;
  remove: (bucket: string, paths: string[]) => Promise<{ error: string | null }>;
  /** path → 有時效的網址；簽不出來的 path 不放進結果。 */
  signedUrls: (bucket: string, paths: string[], expiresInSeconds: number) => Promise<Record<string, string>>;
};

export type ActionContext = { actorId: string; actorRole: string; requestId: string };

export type RunInput = {
  args: Record<string, unknown>;
  params: Record<string, unknown>;
  ctx: ActionContext;
  rpc: RpcFn;
  storage: StorageDeps | null;
  log?: (line: string) => void;
};

/**
 * 需要多個步驟（SQL＋Storage、產生 CSV）的 action 用。失敗時 status 決定回應：
 * 400／404 照 error 回給前端；500 只回 admin_api_failed，細節寫 log。
 */
export type RunOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: 400 | 404 | 500; error: string; stage?: string; detail?: { message?: string; code?: string } | null };

export type ActionRunner = (input: RunInput) => Promise<RunOutcome>;
