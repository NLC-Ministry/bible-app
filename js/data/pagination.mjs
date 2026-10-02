// 分頁共用規則（#399）。
//
// nlc-data 每個請求最多回 1,000 筆（以前是 200）。前端要 1,000 筆，但 nlc-data
// 可能還是舊版、只給 200 筆——如果用「拿到的筆數 < 要求的筆數」判斷最後一頁，
// 前端會把 200 < 1,000 當成最後一頁，名單和打卡少一大截。所以：
//   - 下一頁從「實際拿到的筆數」接著抓（from += page.length），不是 from += pageSize；
//   - 只有拿到 0 筆，或少於舊伺服器上限 200 筆時才停。
// 新舊伺服器都完整、部署順序不拘。代價：最後一頁有 200 筆以上時（例如總共
// 1,000 筆或 300 筆），會多一次回 0 筆的請求才停。每頁至少前進 1 筆，不會無限迴圈。
// 每一頁仍要有唯一排序（#351），由呼叫端負責。

export const DEFAULT_PAGE_SIZE = 1000;
export const LEGACY_SERVER_PAGE_CAP = 200;

export function normalizePageSize(pageSize) {
  const size = Math.floor(Number(pageSize));
  return Number.isFinite(size) && size > 0 ? Math.min(size, DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
}

export function isLastPage(pageLength, pageSize) {
  if (!(pageLength > 0)) return true;
  return pageLength < Math.min(pageSize, LEGACY_SERVER_PAGE_CAP);
}
