import { useEffect, useState } from 'react';
import { checkAndRedirect, CheckAndRedirectOptions, CheckAndRedirectResult } from '../utils/check-and-redirect';

/**
 * 在組件初次 Mount 時自動執行 In-App 導外檢測與處置的 React Hook
 *
 * @param options 檢測參數（如自訂 UA、URL、Swal 或回調函式）
 * @returns 檢測處置結果狀態 CheckAndRedirectResult | null
 */
export function useInAppRedirect(options?: CheckAndRedirectOptions): CheckAndRedirectResult | null {
  const [result, setResult] = useState<CheckAndRedirectResult | null>(null);

  useEffect(() => {
    const res = checkAndRedirect(options);
    setResult(res);
  }, []);

  return result;
}

export default useInAppRedirect;
