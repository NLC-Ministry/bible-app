// 「照搬」進後台的舊管理區塊（#550）：區塊清單，以及後台外殼這一端的 iframe 通道。
//
// 舊區塊在同網域的 /legacy（admin-legacy/，會友 App 管理分頁的同一份畫面與程式）。外殼負責：
//   · 握手：iframe 送 hello → 這裡開一條 MessageChannel，把一端連同 init（哪一區、主題）交過去
//   · token：iframe 要的時候才從記憶體給（過期就叫外殼重新登入），iframe 自己不登入、token 也只放記憶體
//     （id token 一起給：nlc-session 拿不到 Logto UserInfo 時靠它確認身分，同會友 App）
//   · 匯出：iframe 攔下所有下載交過來 → 先經 admin-api 記稽核 → 記成功才存檔（記不成就不下載）
//   · 換區、主題、iframe 裡的操作（延後閒置登出）
//
// 區塊 id 就是舊管理分頁（js/modules/admin.js ADMIN_SECTIONS）的 id；計畫管理（plans）是原本讀經計畫分頁
// 側欄的卡片（#551 起在 admin-legacy/admin-view.html），iframe 把它搬進一個區塊面板（LEGACY_HOSTED_CARDS）。
// #565 起它是「計畫」區的「計畫設定」分頁；加入計畫狀況、組員總覽、計畫統計由計畫區的總覽／名單取代，已移除。
// #568：讀經使用率、報名註冊統計改成「報表」區（views/StatsArea.tsx），已移除。同一份清單另外兩處：
// admin-legacy/sections.mjs（iframe）、admin-api policy.ts 的 LEGACY_EXPORT_SECTIONS；
// scripts/admin-legacy.test.mjs 檢查三邊一致。

import type { ResolvedTheme } from "./theme.ts";

export type LegacyArea = "plans" | "operations" | "content" | "system";

export type LegacySection = {
  id: string;
  area: LegacyArea;
  label: string;
  capability: string;
};

export const LEGACY_SECTIONS: readonly LegacySection[] = [
  { id: "announcements", area: "content", label: "公告", capability: "content.manage" },
  { id: "commentary", area: "content", label: "經文注釋", capability: "content.manage" },
  { id: "quizzes", area: "content", label: "小測驗", capability: "content.manage" },
  { id: "exam", area: "content", label: "大測驗", capability: "content.manage" },
  { id: "lightning-quiz", area: "content", label: "雲柱測驗", capability: "content.manage" },
  { id: "plans", area: "plans", label: "計畫設定", capability: "operations.manage" },
  // 隊伍清單與除錯搬進計畫區之前（#566）先留在營運區
  { id: "teams", area: "operations", label: "組隊狀況", capability: "operations.manage" },
  { id: "settings", area: "system", label: "功能開放設定", capability: "settings.manage" }
];

export const LEGACY_AREAS: readonly LegacyArea[] = ["plans", "operations", "content", "system"];

export function isLegacyArea(value: unknown): value is LegacyArea {
  return typeof value === "string" && (LEGACY_AREAS as readonly string[]).includes(value);
}

export function legacySectionsOf(area: LegacyArea): LegacySection[] {
  return LEGACY_SECTIONS.filter((section) => section.area === area);
}

export function findLegacySection(id: unknown): LegacySection | null {
  return LEGACY_SECTIONS.find((section) => section.id === id) || null;
}

/** iframe 回報這一區開不了的時候給的說明 */
export function unavailableHint(id: string): string {
  if (id === "quizzes" || id === "exam") return "小測驗、大測驗要先在「功能開放設定」打開；如果剛打開，請按重新載入。";
  return "這個帳號在會友 App 的角色看不到這一區；如果剛調整過角色，請按重新載入。";
}

// ── 通道 ──────────────────────────────────────────────────────────────────

// 和 admin-legacy/bridge.mjs 同名
export const LEGACY_HELLO = "adm-legacy-hello";
export const LEGACY_INIT = "adm-legacy-init";
export const LEGACY_PATH = "/legacy";
export const LEGACY_EXPORT_FORMATS = ["csv", "txt"] as const;
export type LegacyExportFormat = typeof LEGACY_EXPORT_FORMATS[number];
// 舊程式產生的檔案最大大概幾 MB（全教會名單、作答明細）；超過這個一定是不對勁
export const MAX_LEGACY_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_FILENAME_CHARS = 120;

export type LegacyExport = {
  section: string;
  filename: string;
  format: LegacyExportFormat;
  rows: number | null;
  bytes: number;
};

/** 檔名：拿掉路徑與 Windows 不允許的字元、控制字元；空的就用區塊名稱。 */
export function safeExportFilename(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, MAX_FILENAME_CHARS);
  return cleaned || fallback;
}

export function exportFormatOf(filename: string, declared: unknown): LegacyExportFormat {
  if (declared === "txt" || /\.txt$/i.test(filename)) return "txt";
  return "csv";
}

type PortLike = {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
type ChannelLike = { port1: PortLike; port2: unknown };

export type LegacyHostEvents = {
  onReady?: () => void;
  onSection?: (section: string, available: boolean) => void;
  /** iframe 開機失敗（boot_failed）或登入過期（session_expired） */
  onError?: (code: string) => void;
  onLoginRequired?: () => void;
  onActivity?: () => void;
};

export type LegacyHostOptions = LegacyHostEvents & {
  win: Window;
  frameWindow: () => Window | null;
  /** 握手時才讀：iframe 重新載入（舊程式 reload）時拿到的是當下的區塊與主題 */
  initial: () => { section: string; theme: ResolvedTheme };
  getToken: () => string | null;
  getIdToken: () => string | null;
  /** 記稽核；失敗就丟錯（不下載） */
  auditExport: (file: LegacyExport) => Promise<unknown>;
  saveFile: (blob: Blob, filename: string) => void;
  describeError: (err: unknown) => string;
  createChannel?: () => ChannelLike;
};

export type LegacyHost = {
  open(section: string): void;
  setTheme(theme: ResolvedTheme): void;
  stop(): void;
};

function isBlob(win: Window, value: unknown): value is Blob {
  const BlobCtor = (win as unknown as { Blob?: typeof Blob }).Blob || (typeof Blob === "function" ? Blob : undefined);
  return !!BlobCtor && value instanceof BlobCtor;
}

export function startLegacyHost(options: LegacyHostOptions): LegacyHost {
  const { win } = options;
  const origin = win.location.origin;
  const createChannel = options.createChannel || (() => new MessageChannel() as unknown as ChannelLike);
  let port: PortLike | null = null;
  let stopped = false;

  const reply = (target: PortLike, id: unknown, payload: Record<string, unknown>) => {
    if (typeof id !== "number") return;
    target.postMessage({ ...payload, replyTo: id });
  };

  async function handleExport(target: PortLike, message: Record<string, unknown>) {
    const blob = message.blob;
    const section = findLegacySection(message.section);
    if (!section || !isBlob(win, blob)) {
      reply(target, message.id, { ok: false, message: "認不得要下載的檔案內容。" });
      return;
    }
    if (blob.size > MAX_LEGACY_EXPORT_BYTES) {
      reply(target, message.id, { ok: false, message: "檔案太大，無法匯出。" });
      return;
    }
    const filename = safeExportFilename(message.filename, `${section.label}.csv`);
    const rows = Number.isInteger(message.rows) && (message.rows as number) >= 0 ? message.rows as number : null;
    const file: LegacyExport = {
      section: section.id,
      filename,
      format: exportFormatOf(filename, message.format),
      rows,
      bytes: blob.size
    };
    try {
      await options.auditExport(file);
    } catch (err) {
      reply(target, message.id, { ok: false, message: options.describeError(err) });
      return;
    }
    options.saveFile(blob, filename);
    reply(target, message.id, { ok: true });
  }

  function handleMessage(target: PortLike, message: Record<string, unknown>) {
    switch (message.type) {
      case "token": {
        const token = options.getToken();
        reply(target, message.id, token
          ? { ok: true, token, idToken: options.getIdToken() }
          : { ok: false, error: "session_expired" });
        return;
      }
      case "export":
        void handleExport(target, message);
        return;
      case "ready":
        options.onReady?.();
        return;
      case "section":
        if (typeof message.section === "string") options.onSection?.(message.section, message.available === true);
        return;
      case "error":
        options.onError?.(typeof message.code === "string" ? message.code : "boot_failed");
        return;
      case "login_required":
        options.onLoginRequired?.();
        return;
      case "activity":
        options.onActivity?.();
        return;
      default:
    }
  }

  const onWindowMessage = (event: MessageEvent) => {
    if (stopped) return;
    const frame = options.frameWindow();
    if (!frame || event.source !== frame || event.origin !== origin) return;
    if (!event.data || event.data.type !== LEGACY_HELLO) return;
    // iframe 重新載入就重新握手；舊的通道關掉
    port?.close();
    const channel = createChannel();
    const current = channel.port1;
    port = current;
    current.onmessage = (msg: MessageEvent) => {
      if (port !== current) return;
      const data = msg.data;
      if (data && typeof data === "object") handleMessage(current, data as Record<string, unknown>);
    };
    const init = options.initial();
    frame.postMessage({ type: LEGACY_INIT, section: init.section, theme: init.theme }, origin, [channel.port2 as Transferable]);
  };
  win.addEventListener("message", onWindowMessage);

  return {
    open(section: string) {
      port?.postMessage({ type: "open", section });
    },
    setTheme(theme: ResolvedTheme) {
      port?.postMessage({ type: "theme", theme });
    },
    stop() {
      stopped = true;
      win.removeEventListener("message", onWindowMessage);
      port?.close();
      port = null;
    }
  };
}
