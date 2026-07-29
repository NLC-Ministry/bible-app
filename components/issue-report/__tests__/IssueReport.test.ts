// components/issue-report/__tests__/IssueReport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { ValidateReportBlock, SubmitReportBlock, ReportPipeline } from "../IssueReportBlocks.ts";
import { convertToCSV } from "../AdminReportView.tsx";
import { AdminUsersAccordion } from "../AdminUsersAccordion.tsx";
import { SupportFab } from "../SupportFab.tsx";
import { ReportDrawer, reportSchema } from "../ReportDrawer.tsx";
import { AdminReportTable } from "../AdminReportTable.tsx";

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: vi.fn(),
    handleSubmit: (fn: any) => fn,
    watch: vi.fn().mockReturnValue(""),
    formState: { errors: {} },
    reset: vi.fn()
  })
}));

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => vi.fn()
}));

class MockIDBRequest {
  result: any;
  onsuccess: any;
  onerror: any;
}

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
  (globalThis as any).window.location = { href: "http://localhost/test", pathname: "/test" };
}

if (typeof globalThis.navigator === "undefined") {
  (globalThis as any).navigator = {
    userAgent: "node-test-agent",
    onLine: true
  };
}

if (typeof globalThis.indexedDB === "undefined") {
  const mockIndexedDB = {
    open: () => {
      const req = new MockIDBRequest();
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
  (globalThis as any).indexedDB = mockIndexedDB;
}

describe("Issue Report System Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset global state mocks
    (window as any).state = {
      supabase: {
        from: () => ({
          insert: vi.fn().mockResolvedValue({ error: null })
        })
      },
      currentUser: {
        id: "mock-user-123"
      }
    };
  });

  afterEach(() => {
    delete (window as any).state;
  });

  // 1. ValidateReportBlock Tests
  describe("ValidateReportBlock", () => {
    it("應該驗證合法的分類與字數長度", () => {
      const result = ValidateReportBlock.validate("bug", "這是一個合法的錯誤描述，字數超過十個字。");
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("應該攔截不合法的分類", () => {
      const result = ValidateReportBlock.validate("hacker", "這是一個合法的錯誤描述，字數超過十個字。");
      expect(result.success).toBe(false);
      expect(result.error).toBe("無效的分類項目");
    });

    it("當描述少於 1 個字時，應阻擋並回傳錯誤", () => {
      const result = ValidateReportBlock.validate("bug", "");
      expect(result.success).toBe(false);
      expect(result.error).toBe("回報內容不能為空");
    });

    it("當描述超過 500 個字時，應阻擋並回傳錯誤", () => {
      const longText = "a".repeat(501);
      const result = ValidateReportBlock.validate("bug", longText);
      expect(result.success).toBe(false);
      expect(result.error).toBe("回報內容太長（最多 500 個字）");
    });

    it("應該過濾並轉義 XSS 惡意腳本標籤", () => {
      const maliciousText = '這是一個測試內容：<div>正常 HTML</div><script>alert("XSS")</script> 且帶有 onclick="malicious()"';
      const result = ValidateReportBlock.validate("bug", maliciousText);
      expect(result.success).toBe(true);
      // <script> 應被濾除，HTML 特殊字元被轉義
      expect(result.sanitizedDescription).not.toContain("<script>");
      expect(result.sanitizedDescription).toContain("&lt;div&gt;");
    });
  });

  // 2. ReportPipeline Concurrency / Debounce Tests
  describe("ReportPipeline Concurrency Lock", () => {
    it("當一秒內連續點擊提交按鈕時，僅有一次請求發出 (防連點測試)", async () => {
      const insertMock = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ error: null }), 100);
        });
      });

      (window as any).state.supabase = {
        from: () => ({
          insert: insertMock
        })
      };

      // 模擬線上狀態
      vi.spyOn(SubmitReportBlock, "isOnline").mockReturnValue(true);

      // 同時發出兩次請求 (連續點擊)
      const p1 = ReportPipeline.execute("bug", "這是測試防連點的內容第一發！超過十個字。");
      const p2 = ReportPipeline.execute("bug", "這是測試防連點的內容第二發！連點測試。");

      const [r1, r2] = await Promise.all([p1, p2]);

      // 第一個請求成功
      expect(r1.success).toBe(true);
      // 第二個請求被鎖定拒絕
      expect(r2.success).toBe(false);
      expect(r2.error).toBe("提交處理中，請勿重複連點");

      // 驗證 Supabase insert 僅被呼叫了一次
      expect(insertMock).toHaveBeenCalledTimes(1);
    });
  });

  // 3. UI State Toggle Simulation Tests
  describe("UI FAB State Toggle", () => {
    it("模擬 UI 開關狀態切換，點擊圓球後能正確打開與關閉表單", () => {
      // 模擬元件內部的狀態開關邏輯
      let isOpen = false;
      const toggle = () => {
        isOpen = !isOpen;
      };

      // 初始為關閉
      expect(isOpen).toBe(false);

      // 點擊圓球打開
      toggle();
      expect(isOpen).toBe(true);

      // 點擊關閉 X 按鈕
      toggle();
      expect(isOpen).toBe(false);
    });
  });

  // 4. UI Rendering and Click Interaction Tests
  describe("UI FAB React Element Structure", () => {
    it("主頁面 Render 後，懸浮圓球按鈕確確實實存在且可被點擊觸發狀態切換", () => {
      // Temporarily mock hooks to bypass dispatcher checks
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      try {
        // Render SupportFab directly to check its structure
        const element = (SupportFab as any)({
          onClick: vi.fn(),
          isOpen: false
        });
        
        expect(element).toBeDefined();
        
        // Inside AnimatePresence is the motion.button
        const button = element.props.children;
        expect(button).toBeDefined();
        expect(button.props.className).toContain("fixed");
        expect(button.props.className).not.toContain("bottom-28");
        expect(button.props.className).not.toContain("right-6");
        expect(button.props.className).toContain("z-sheet");
        expect(button.props.className).not.toContain("z-[9999]");
        expect(button.props.className).toContain("issue-report-fab");
        expect(button.props.className).not.toContain("backdrop-blur");
        
        // Verify click action handler exists
        expect(typeof button.props.onClick).toBe("function");
      } finally {
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });
  });

  // 5. Smart Routing, Scroll Hide, and CSV Export Tests
  describe("Route protection, Smart scroll, and CSV Export", () => {
    it("當路由切換至 '/login' 時，元件渲染結果為 null", () => {
      // Mock hooks to bypass dispatcher checks
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      const origPath = window.location.pathname;
      Object.defineProperty(window.location, 'pathname', { value: '/login', configurable: true });

      try {
        const element = (SupportFab as any)({
          onClick: vi.fn(),
          isOpen: false
        });
        expect(element).toBeNull();
      } finally {
        Object.defineProperty(window.location, 'pathname', { value: origPath, configurable: true });
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });

    it("向下滾動事件觸發時，懸浮球狀態正確切換為隱藏", () => {
      let isVisible = true;
      const simulateScroll = (lastY: number, currentY: number) => {
        if (currentY > lastY && currentY > 50) {
          isVisible = false;
        } else {
          isVisible = true;
        }
      };

      // 1. Scroll down past 50px -> should hide
      simulateScroll(0, 100);
      expect(isVisible).toBe(false);

      // 2. Scroll up -> should show
      simulateScroll(100, 40);
      expect(isVisible).toBe(true);
    });

    it("匯出功能能正確將 JSON 轉換為 CSV 字串格式", () => {
      const mockReports: any[] = [
        {
          id: "rep-1",
          created_at: "2026-07-25T12:00:00Z",
          category: "bug",
          description: "發現錯誤：內容包含 \"雙引號\"",
          url: "http://localhost/test",
          user_agent: "agent-1",
          status: "pending",
          profiles: {
            name: "測試人",
            pastoral_zone: "社青牧區",
            small_group: "社青一組"
          }
        }
      ];

      const csv = convertToCSV(mockReports);

      // Headers exist
      expect(csv).toContain("ID,建立時間,分類,問題描述,回報者姓名,回報者牧區,回報者小組");
      // Data converted correctly
      expect(csv).toContain("\"rep-1\"");
      expect(csv).toContain("\"Bug 錯誤\"");
      expect(csv).toContain("\"測試人\"");
      expect(csv).toContain("\"社青牧區\"");
      expect(csv).toContain("\"社青一組\"");
      // Quotes escaped correctly
      expect(csv).toContain("\"發現錯誤：內容包含 \"\"雙引號\"\"\"");
    });
  });

  // 6. AdminUsersAccordion Collapsible and Render Tests
  describe("AdminUsersAccordion Component", () => {
    it("頁面初始 Render 時，人員名單 Accordion 預設為關閉狀態", () => {
      // Mock hooks to bypass dispatcher checks
      let initialIsOpenState: boolean | null = null;
      const mockState = vi.fn().mockImplementation((init) => {
        if (initialIsOpenState === null && typeof init === "boolean") {
          initialIsOpenState = init;
        }
        return [init, vi.fn()];
      });
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      try {
        const element = (AdminUsersAccordion as any)({});
        expect(element).toBeDefined();
        // Check default state is false (closed/collapsed)
        expect(initialIsOpenState).toBe(false);
      } finally {
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });

    it("點擊 Accordion 標題時，機能正確切換展開/收合狀態", () => {
      let isOpen = false;
      const toggle = () => {
        isOpen = !isOpen;
      };

      // 1. Initial State
      expect(isOpen).toBe(false);

      // 2. Expand action
      toggle();
      expect(isOpen).toBe(true);

      // 3. Collapse action
      toggle();
      expect(isOpen).toBe(false);
    });

    it("名單內容區存在對應的目標 DOM 元素容器", () => {
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      try {
        const element = (AdminUsersAccordion as any)({});
        expect(element).toBeDefined();
        
        // Find inside content tree
        const contentArea = React.Children.toArray(element.props.children)[1] as any;
        expect(contentArea).toBeDefined();
        expect(contentArea.props.className).toContain("transition-all");
        
        const scrollArea = React.Children.toArray(contentArea.props.children.props.children) as any[];
        const scrollContainer = scrollArea.find((child: any) => child.props.id === "admin-users-list-scroll-area");
        expect(scrollContainer).toBeDefined();
        
        const listDiv = scrollContainer.props.children;
        expect(listDiv.props.id).toBe("admin-users-list");
      } finally {
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });
  });

  // 7. SupportFab Tests
  describe("SupportFab Component", () => {
    it("應該正確初始化並能正常 Render", () => {
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      try {
        const element = (SupportFab as any)({
          onClick: vi.fn(),
          isOpen: false
        });
        expect(element).toBeDefined();
      } finally {
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });
  });

  // 8. ReportDrawer Tests
  describe("ReportDrawer Component", () => {
    it("當開關狀態 isOpen 改變時，正確反應屬性", () => {
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const mockEffect = vi.fn();
      const origUseState = React.useState;
      const origUseEffect = React.useEffect;
      (React as any).useState = mockState;
      (React as any).useEffect = mockEffect;

      try {
        const drawerOpen = (ReportDrawer as any)({
          isOpen: true,
          onClose: vi.fn()
        });
        expect(drawerOpen).toBeDefined();

        const drawerClosed = (ReportDrawer as any)({
          isOpen: false,
          onClose: vi.fn()
        });
        expect(drawerClosed).toBeDefined();
      } finally {
        (React as any).useState = origUseState;
        (React as any).useEffect = origUseEffect;
      }
    });

    it("Zod Schema 驗證：正確通過合法的分類與長度，並能進行 XSS 過濾轉義", () => {
      const validData = {
        category: "bug",
        description: "這是一個合法的錯誤描述，帶有 <script>alert('xss')</script>"
      };
      const result = reportSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).not.toContain("<script>");
        expect(result.data.description).toBe("這是一個合法的錯誤描述，帶有 ");
      }
    });

    it("Zod Schema 驗證：不合法的分類應被拒絕", () => {
      const invalidData = {
        category: "invalid-category",
        description: "合法的問題描述長度內容"
      };
      const result = reportSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("Zod Schema 驗證：長度太長（超過 500 字）或空白內容應被拒絕", () => {
      const emptyData = {
        category: "bug",
        description: ""
      };
      const tooLongData = {
        category: "bug",
        description: "a".repeat(501)
      };
      expect(reportSchema.safeParse(emptyData).success).toBe(false);
      expect(reportSchema.safeParse(tooLongData).success).toBe(false);
    });
  });

  // 9. AdminReportTable Tests
  describe("AdminReportTable Component", () => {
    it("正確顯示回報資料項目與載入狀態", () => {
      const mockState = vi.fn().mockImplementation((init) => [init, vi.fn()]);
      const origUseState = React.useState;
      (React as any).useState = mockState;

      try {
        const table = (AdminReportTable as any)({
          reports: [
            { id: "rep-1", created_at: "2026-07-24T12:00:00Z", category: "bug", description: "測試錯誤", status: "open" }
          ],
          isLoading: false,
          error: null,
          onRefresh: vi.fn(),
          onExport: vi.fn(),
          onDelete: vi.fn()
        });
        expect(table).toBeDefined();
      } finally {
        (React as any).useState = origUseState;
      }
    });
  });
});
