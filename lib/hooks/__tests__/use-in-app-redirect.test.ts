// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInAppRedirect } from '../use-in-app-redirect';
import * as checkModule from '../../utils/check-and-redirect';

// 設定 React 測試環境 act 支持，消除主機環境 act(...) Warning
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('useInAppRedirect Hook 測試', () => {
  it('在組件 Mount 時應自動呼叫 checkAndRedirect 並回傳結果', () => {
    const checkSpy = vi.spyOn(checkModule, 'checkAndRedirect').mockReturnValue({
      isLine: true,
      isFb: false,
      isIg: false,
      isAndroid: false,
      isiOS: true,
      hasOpenExternalParam: false,
      redirected: true,
      shownModal: false,
      actionTaken: 'line_redirect',
      targetUrl: 'https://example.com/?openExternalBrowser=1',
    });

    let hookResult: ReturnType<typeof useInAppRedirect> = null;

    function TestComponent() {
      hookResult = useInAppRedirect({ userAgent: 'Line/13.8.0' });
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(checkSpy).toHaveBeenCalledWith({ userAgent: 'Line/13.8.0' });
    expect(hookResult).toEqual({
      isLine: true,
      isFb: false,
      isIg: false,
      isAndroid: false,
      isiOS: true,
      hasOpenExternalParam: false,
      redirected: true,
      shownModal: false,
      actionTaken: 'line_redirect',
      targetUrl: 'https://example.com/?openExternalBrowser=1',
    });

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
    checkSpy.mockRestore();
  });
});
