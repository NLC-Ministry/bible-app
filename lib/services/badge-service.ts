/**
 * PWA App Badging API 服務
 * 用於設定與清除手機主畫面上的 PWA 應用程式通知角標 (App Badge)
 */

/**
 * 檢查瀏覽器環境是否支援 App Badging API
 */
export function isBadgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator && "clearAppBadge" in navigator;
}

/**
 * 設定主畫面 App 的通知角標數字
 * @param count 角標顯示數字，若小於或等於 0 則會自動清空角標
 * @returns 回傳設定是否成功
 */
export async function setBadgeCount(count: number): Promise<boolean> {
  if (!isBadgeSupported()) {
    return false;
  }

  try {
    if (count <= 0) {
      await navigator.clearAppBadge();
    } else {
      await navigator.setAppBadge(count);
    }
    return true;
  } catch (error) {
    console.error("設定 App Badge 失敗:", error);
    return false;
  }
}

/**
 * 清除主畫面 App 的通知角標
 * @returns 回傳清除是否成功
 */
export async function clearBadge(): Promise<boolean> {
  if (!isBadgeSupported()) {
    return false;
  }

  try {
    await navigator.clearAppBadge();
    return true;
  } catch (error) {
    console.error("清除 App Badge 失敗:", error);
    return false;
  }
}

/**
 * iOS 16.4+ 請求推播通知權限
 * 這是 iPhone 等 iOS 裝置上正常顯示主畫面 App 角標的必要步驟
 * @returns 回傳使用者的授權狀態
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") {
    return "default";
  }

  try {
    return await Notification.requestPermission();
  } catch (error) {
    console.error("請求通知權限時發生錯誤:", error);
    return "default";
  }
}
