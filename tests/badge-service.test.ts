import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearBadge, isBadgeSupported, setBadgeCount } from "../lib/services/badge-service";

describe("PWA App Badging API 服務測試", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    // 每次測試前重設為乾淨的 navigator 物件
    vi.stubGlobal("navigator", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isBadgeSupported", () => {
    it("當環境不支援 App Badging API 時應回傳 false", () => {
      expect(isBadgeSupported()).toBe(false);
    });

    it("當環境支援 App Badging API 時應回傳 true", () => {
      vi.stubGlobal("navigator", {
        setAppBadge: vi.fn(),
        clearAppBadge: vi.fn(),
      });
      expect(isBadgeSupported()).toBe(true);
    });
  });

  describe("setBadgeCount", () => {
    it("測試 A：當傳入大於 0 的數字時，應呼叫 setAppBadge 並帶入正確的參數值", async () => {
      const setAppBadgeMock = vi.fn().mockResolvedValue(undefined);
      const clearAppBadgeMock = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal("navigator", {
        setAppBadge: setAppBadgeMock,
        clearAppBadge: clearAppBadgeMock,
      });

      const result = await setBadgeCount(5);
      expect(result).toBe(true);
      expect(setAppBadgeMock).toHaveBeenCalledWith(5);
      expect(clearAppBadgeMock).not.toHaveBeenCalled();
    });

    it("測試 B (1)：當傳入 0 時，應改為呼叫 clearAppBadge", async () => {
      const setAppBadgeMock = vi.fn().mockResolvedValue(undefined);
      const clearAppBadgeMock = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal("navigator", {
        setAppBadge: setAppBadgeMock,
        clearAppBadge: clearAppBadgeMock,
      });

      const result = await setBadgeCount(0);
      expect(result).toBe(true);
      expect(clearAppBadgeMock).toHaveBeenCalled();
      expect(setAppBadgeMock).not.toHaveBeenCalled();
    });

    it("測試 B (2)：當傳入小於 0 的數字時，應改為呼叫 clearAppBadge", async () => {
      const setAppBadgeMock = vi.fn().mockResolvedValue(undefined);
      const clearAppBadgeMock = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal("navigator", {
        setAppBadge: setAppBadgeMock,
        clearAppBadge: clearAppBadgeMock,
      });

      const result = await setBadgeCount(-3);
      expect(result).toBe(true);
      expect(clearAppBadgeMock).toHaveBeenCalled();
      expect(setAppBadgeMock).not.toHaveBeenCalled();
    });

    it("測試 C：當瀏覽器不支援 setAppBadge 時，應優雅降級不報錯且回傳 false", async () => {
      // 不 mock setAppBadge 與 clearAppBadge，代表不支援
      vi.stubGlobal("navigator", {});

      const result = await setBadgeCount(10);
      expect(result).toBe(false); // 降級不報錯
    });

    it("當 setAppBadge 執行拋出異常時應被 try-catch 攔截，不阻斷程式且回傳 false", async () => {
      const setAppBadgeMock = vi.fn().mockRejectedValue(new Error("Permission Denied"));
      vi.stubGlobal("navigator", {
        setAppBadge: setAppBadgeMock,
        clearAppBadge: vi.fn(),
      });

      const result = await setBadgeCount(8);
      expect(result).toBe(false);
      expect(setAppBadgeMock).toHaveBeenCalledWith(8);
    });
  });

  describe("clearBadge", () => {
    it("測試 B (3)：呼叫 clearBadge 時，應執行 clearAppBadge 並回傳 true", async () => {
      const clearAppBadgeMock = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        setAppBadge: vi.fn(),
        clearAppBadge: clearAppBadgeMock,
      });

      const result = await clearBadge();
      expect(result).toBe(true);
      expect(clearAppBadgeMock).toHaveBeenCalled();
    });

    it("當瀏覽器不支援 clearAppBadge 時，應優雅降級不報錯且回傳 false", async () => {
      vi.stubGlobal("navigator", {});

      const result = await clearBadge();
      expect(result).toBe(false);
    });

    it("當 clearAppBadge 執行拋出異常時應被 try-catch 攔截，不阻斷程式且回傳 false", async () => {
      const clearAppBadgeMock = vi.fn().mockRejectedValue(new Error("Storage Locked"));
      vi.stubGlobal("navigator", {
        setAppBadge: vi.fn(),
        clearAppBadge: clearAppBadgeMock,
      });

      const result = await clearBadge();
      expect(result).toBe(false);
      expect(clearAppBadgeMock).toHaveBeenCalled();
    });
  });
});
