// #683：每日 Email 摘要的內容。只有數字和後台連結，不放會友姓名或回報內容；
// 寄信由 Google Apps Script 做（digest-apps-script.gs.txt），收件地址放在那邊，不進 repo。

export type DigestCounts = {
  new_24h: number;
  pending: number;
  processing: number;
  unread: number;
  oldest_pending_at: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const count = (value: unknown) => Number(value) || 0;

function waitingDays(oldest: string | null | undefined, now: Date): number | null {
  if (!oldest) return null;
  const at = Date.parse(oldest);
  return Number.isNaN(at) ? null : Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/** 有待回覆或新訊息才寄；只有等開發不用每天提醒。 */
export function shouldSendDigest(counts: DigestCounts): boolean {
  return count(counts.pending) > 0 || count(counts.unread) > 0;
}

export function buildDigestEmail(counts: DigestCounts, now: Date, adminUrl: string): { subject: string; text: string } {
  const pending = count(counts.pending);
  const unread = count(counts.unread);
  const days = waitingDays(counts.oldest_pending_at, now);
  const waiting = pending > 0 && days !== null ? `（最久已等 ${days} 天）` : "";
  return {
    subject: pending > 0 ? `回報摘要：待回覆 ${pending} 則` : `回報摘要：有新訊息 ${unread} 則`,
    text: [
      `過去 24 小時新回報：${count(counts.new_24h)} 則`,
      `待回覆：${pending} 則${waiting}`,
      `有新訊息：${unread} 則`,
      `等開發：${count(counts.processing)} 則`,
      "",
      `打開收件匣：${adminUrl}`
    ].join("\n")
  };
}
