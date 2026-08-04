import Swal from 'sweetalert2';

export interface CheckAndRedirectOptions {
  /**
   * 自訂 User-Agent 字串（預設自動讀取 window.navigator.userAgent）
   */
  userAgent?: string;
  /**
   * 自訂當前 URL（預設自動讀取 window.location.href）
   */
  currentUrl?: string;
  /**
   * 自訂導向處置函式（預設使用 window.location.replace 或 window.location.href）
   */
  onRedirect?: (targetUrl: string, method: 'replace' | 'assign') => void;
  /**
   * 自訂 SweetAlert2 實例（預設為 sweetalert2 的 Swal）
   */
  swal?: typeof Swal;
  /**
   * 是否在檢測到 iOS FB/IG 時自動彈出 Swal 提示 (預設為 true)
   */
  autoShowSwal?: boolean;
}

export interface CheckAndRedirectResult {
  /** 是否為 LINE 內建瀏覽器 */
  isLine: boolean;
  /** 是否為 Facebook 內建瀏覽器 */
  isFb: boolean;
  /** 是否為 Instagram 內建瀏覽器 */
  isIg: boolean;
  /** 是否為 Android 裝置 */
  isAndroid: boolean;
  /** 是否為 iOS 裝置 */
  isiOS: boolean;
  /** 是否已存在 openExternalBrowser=1 參數 */
  hasOpenExternalParam: boolean;
  /** 是否觸發了導頁重定向 */
  redirected: boolean;
  /** 是否觸發顯示了 Swal 提示彈窗 */
  shownModal: boolean;
  /** 最終採取的處置動作類別 */
  actionTaken: 'none' | 'line_redirect' | 'android_intent_redirect' | 'ios_swal_guide';
  /** 導向目標 URL (若有) */
  targetUrl?: string;
}

/**
 * 檢測當前瀏覽器環境是否為 App 內建 Webview (In-App Browser)
 * 並自動實施導外 (External Browser Bypass) 處置邏輯
 */
export function checkAndRedirect(options: CheckAndRedirectOptions = {}): CheckAndRedirectResult {
  // 1. 安全防禦：極致容錯處理，確保 SSR (Node.js) 或缺乏 window 物件時不崩潰
  const isServer = typeof window === 'undefined';
  const rawUa = options.userAgent ?? (isServer ? '' : (typeof navigator !== 'undefined' ? navigator.userAgent : ''));
  const currentUrlStr = options.currentUrl ?? (isServer ? 'http://localhost' : (typeof window !== 'undefined' && window.location?.href ? window.location.href : 'http://localhost'));

  // 轉小寫以利高相容性匹配
  const ua = rawUa.toLowerCase();

  // 精準 Regex 與字串匹配
  const isLine = /line\//i.test(rawUa) || ua.includes('line');
  const isFb = /fbav|fban/i.test(rawUa);
  const isIg = /instagram/i.test(rawUa);
  const isAndroid = /android/i.test(rawUa);
  const isiOS = /iphone|ipad|ipod/i.test(rawUa);

  // 安全解析 URL
  let urlObj: URL;
  try {
    urlObj = new URL(currentUrlStr);
  } catch {
    urlObj = new URL('http://localhost');
  }

  const hasOpenExternalParam = urlObj.searchParams.get('openExternalBrowser') === '1' ||
    /[?&]openExternalBrowser=1\b/i.test(currentUrlStr);

  const result: CheckAndRedirectResult = {
    isLine,
    isFb,
    isIg,
    isAndroid,
    isiOS,
    hasOpenExternalParam,
    redirected: false,
    shownModal: false,
    actionTaken: 'none',
  };

  // 預設跳轉邏輯
  const defaultRedirect = (target: string, method: 'replace' | 'assign') => {
    if (isServer || typeof window === 'undefined' || !window.location) return;
    if (method === 'replace') {
      window.location.replace(target);
    } else {
      window.location.href = target;
    }
  };

  const redirectFn = options.onRedirect ?? defaultRedirect;
  const swalInstance = options.swal ?? Swal;

  // ----------------------------------------------------
  // 處置分支 1：LINE 內建瀏覽器導頁繞過
  // ----------------------------------------------------
  if (isLine && !hasOpenExternalParam) {
    urlObj.searchParams.set('openExternalBrowser', '1');
    const targetUrl = urlObj.toString();

    result.redirected = true;
    result.actionTaken = 'line_redirect';
    result.targetUrl = targetUrl;

    redirectFn(targetUrl, 'replace');
    return result;
  }

  // ----------------------------------------------------
  // 處置分支 2：Android FB / IG 透過 intent:// 強制喚醒 Chrome
  // ----------------------------------------------------
  if ((isFb || isIg) && isAndroid) {
    const protocol = urlObj.protocol.replace(':', '') || 'https';
    const hostAndPathAndQuery = urlObj.href.replace(/^https?:\/\//i, '');
    const intentUrl = `intent://${hostAndPathAndQuery}#Intent;scheme=${protocol};package=com.android.chrome;end`;

    result.redirected = true;
    result.actionTaken = 'android_intent_redirect';
    result.targetUrl = intentUrl;

    redirectFn(intentUrl, 'assign');
    return result;
  }

  // ----------------------------------------------------
  // 處置分支 3：iOS FB / IG 使用 SweetAlert2 展示圖解引導
  // ----------------------------------------------------
  if ((isFb || isIg) && (isiOS || !isAndroid)) {
    result.shownModal = true;
    result.actionTaken = 'ios_swal_guide';

    const shouldShow = options.autoShowSwal ?? true;
    if (shouldShow && swalInstance && typeof swalInstance.fire === 'function') {
      const appName = isIg ? 'Instagram' : 'Facebook';
      swalInstance.fire({
        title: `您正在使用 ${appName} 內建瀏覽器`,
        html: `
          <div style="text-align: left; font-size: 0.95rem; line-height: 1.6; color: #334155;">
            <p style="margin-bottom: 12px; font-weight: 600; color: #0f172a;">
              建議使用外部瀏覽器（如 Safari）開啟，以獲得最佳體驗與完整功能。
            </p>
            <div style="background: #f8fafc; padding: 14px; border-radius: 10px; border: 1px solid #e2e8f0;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span style="background: #2563eb; color: #ffffff; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; margin-right: 10px; flex-shrink: 0;">1</span>
                <span>點擊畫面右上角（或右下角）的 <strong>「•••」</strong> 選單圖示</span>
              </div>
              <div style="display: flex; align-items: center;">
                <span style="background: #2563eb; color: #ffffff; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; margin-right: 10px; flex-shrink: 0;">2</span>
                <span>點選 <strong>「在 Safari 開啟」</strong> 或 <strong>「用預設瀏覽器開啟」</strong></span>
              </div>
            </div>
          </div>
        `,
        icon: 'info',
        confirmButtonText: '我知道了',
        confirmButtonColor: '#2563eb',
        customClass: {
          popup: 'in-app-redirect-swal-popup',
        },
      });
    }

    return result;
  }

  return result;
}

export default checkAndRedirect;
