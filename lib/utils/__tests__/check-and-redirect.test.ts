import { describe, expect, it, vi } from 'vitest';
import Swal from 'sweetalert2';
import { checkAndRedirect } from '../check-and-redirect';

describe('checkAndRedirect - In-App 導外自動檢測與繞過工具測試', () => {
  // 測試 User-Agent 範例資料庫
  const UA_SAMPLES = {
    lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.8.0',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.153 Mobile Safari/537.36 Line/13.4.1',
    fbAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/418.0.0.33.69;]',
    igAndroid: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36 Instagram 235.0.0.21.116 Android',
    fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/400.0.0.30.76;]',
    igIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 260.0.0.17.118',
    desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  it('應正確偵測 LINE 內建瀏覽器並附加 openExternalBrowser=1 進行 replace 重定向', () => {
    const onRedirectMock = vi.fn();

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.lineIos,
      currentUrl: 'https://example.com/reading-plan?day=5',
      onRedirect: onRedirectMock,
    });

    expect(result.isLine).toBe(true);
    expect(result.redirected).toBe(true);
    expect(result.actionTaken).toBe('line_redirect');
    expect(result.targetUrl).toContain('openExternalBrowser=1');
    expect(result.targetUrl).toBe('https://example.com/reading-plan?day=5&openExternalBrowser=1');

    expect(onRedirectMock).toHaveBeenCalledTimes(1);
    expect(onRedirectMock).toHaveBeenCalledWith('https://example.com/reading-plan?day=5&openExternalBrowser=1', 'replace');
  });

  it('若 LINE URL 已帶有 openExternalBrowser=1 參數，不應重複觸發導頁', () => {
    const onRedirectMock = vi.fn();

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.lineAndroid,
      currentUrl: 'https://example.com/reading-plan?day=5&openExternalBrowser=1',
      onRedirect: onRedirectMock,
    });

    expect(result.isLine).toBe(true);
    expect(result.hasOpenExternalParam).toBe(true);
    expect(result.redirected).toBe(false);
    expect(result.actionTaken).toBe('none');
    expect(onRedirectMock).not.toHaveBeenCalled();
  });

  it('應正確偵測 Android FB App，並觸發 intent:// Chrome 喚醒導航', () => {
    const onRedirectMock = vi.fn();

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.fbAndroid,
      currentUrl: 'https://example.com/share/post-123?ref=fb',
      onRedirect: onRedirectMock,
    });

    expect(result.isFb).toBe(true);
    expect(result.isAndroid).toBe(true);
    expect(result.redirected).toBe(true);
    expect(result.actionTaken).toBe('android_intent_redirect');

    const expectedIntent = 'intent://example.com/share/post-123?ref=fb#Intent;scheme=https;package=com.android.chrome;end';
    expect(result.targetUrl).toBe(expectedIntent);
    expect(onRedirectMock).toHaveBeenCalledWith(expectedIntent, 'assign');
  });

  it('應正確偵測 Android IG App，並觸發 intent:// Chrome 喚醒導航', () => {
    const onRedirectMock = vi.fn();

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.igAndroid,
      currentUrl: 'https://example.com/bible',
      onRedirect: onRedirectMock,
    });

    expect(result.isIg).toBe(true);
    expect(result.isAndroid).toBe(true);
    expect(result.redirected).toBe(true);
    expect(result.actionTaken).toBe('android_intent_redirect');

    const expectedIntent = 'intent://example.com/bible#Intent;scheme=https;package=com.android.chrome;end';
    expect(result.targetUrl).toBe(expectedIntent);
    expect(onRedirectMock).toHaveBeenCalledWith(expectedIntent, 'assign');
  });

  it('應正確偵測 iOS FB App，並呼叫 SweetAlert2 展示包含「在 Safari 開啟」圖解指引', () => {
    const swalFireSpy = vi.spyOn(Swal, 'fire').mockResolvedValue({} as any);

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.fbIos,
      currentUrl: 'https://example.com/dashboard',
      swal: Swal,
    });

    expect(result.isFb).toBe(true);
    expect(result.isiOS).toBe(true);
    expect(result.shownModal).toBe(true);
    expect(result.actionTaken).toBe('ios_swal_guide');

    expect(swalFireSpy).toHaveBeenCalledTimes(1);
    const swalArgs = swalFireSpy.mock.calls[0][0] as any;
    expect(swalArgs.title).toContain('Facebook 內建瀏覽器');
    expect(swalArgs.html).toContain('在 Safari 開啟');
    expect(swalArgs.html).toContain('•••');

    swalFireSpy.mockRestore();
  });

  it('應正確偵測 iOS IG App，並呼叫 SweetAlert2 展示包含 Instagram 標題', () => {
    const swalFireSpy = vi.spyOn(Swal, 'fire').mockResolvedValue({} as any);

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.igIos,
      currentUrl: 'https://example.com/dashboard',
      swal: Swal,
    });

    expect(result.isIg).toBe(true);
    expect(result.isiOS).toBe(true);
    expect(result.shownModal).toBe(true);
    expect(result.actionTaken).toBe('ios_swal_guide');

    expect(swalFireSpy).toHaveBeenCalledTimes(1);
    const swalArgs = swalFireSpy.mock.calls[0][0] as any;
    expect(swalArgs.title).toContain('Instagram 內建瀏覽器');
    expect(swalArgs.html).toContain('在 Safari 開啟');

    swalFireSpy.mockRestore();
  });

  it('一般 Desktop Chrome 瀏覽器不應觸發重定向或彈窗', () => {
    const onRedirectMock = vi.fn();
    const swalFireSpy = vi.spyOn(Swal, 'fire');

    const result = checkAndRedirect({
      userAgent: UA_SAMPLES.desktopChrome,
      currentUrl: 'https://example.com/',
      onRedirect: onRedirectMock,
      swal: Swal,
    });

    expect(result.isLine).toBe(false);
    expect(result.isFb).toBe(false);
    expect(result.isIg).toBe(false);
    expect(result.redirected).toBe(false);
    expect(result.shownModal).toBe(false);
    expect(result.actionTaken).toBe('none');

    expect(onRedirectMock).not.toHaveBeenCalled();
    expect(swalFireSpy).not.toHaveBeenCalled();

    swalFireSpy.mockRestore();
  });
});
