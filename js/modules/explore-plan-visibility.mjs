// 探索計畫清單：一張卡要不要顯示、是不是「只有管理者看得到」（#372）。
//
// - 已結束（過了 endDate）的計畫：所有人都不顯示——加入不了，只會讓人以為壞了。
//   已加入的人仍在「我的計畫 → 已結束」看得到紀錄。
// - 隱藏中的計畫（含鎖住的教會階段，例如尚未開放的月度期末賽）：會友一律看不到，
//   等管理員開放（is_hidden 轉 false）才出現。以前月度期末賽帶 discoverWhenLocked
//   會以「尚未開放」卡片出現在會友端，會友點了加入不了 → 拿掉這個例外。
// - 管理者照舊可以預覽隱藏計畫（卡片標「會友看不到」）；第三階段之後那種沒帶
//   discoverWhenLocked 的鎖住階段，仍只有系統管理員看得到。
export function getExplorePlanVisibility({
  expired = false,
  hidden = false,
  lockedStage = false,
  discoverableWhileLocked = false,
  viewerRole = "member",
  canManageHidden = false
} = {}) {
  const HIDE = { visible: false, managerOnly: false };
  if (expired) return HIDE;
  if (!hidden && !lockedStage) return { visible: true, managerOnly: false };
  if (lockedStage && !discoverableWhileLocked) {
    return viewerRole === "admin" ? { visible: true, managerOnly: true } : HIDE;
  }
  return canManageHidden ? { visible: true, managerOnly: true } : HIDE;
}
