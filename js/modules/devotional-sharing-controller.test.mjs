import { describe, it, expect } from "vitest";
import { DevotionalSharingController } from "./devotional-sharing-controller.mjs";

describe("DevotionalSharingController (OOP Controller & Input Defense)", () => {
  
  // 1. 測試狀態管理與驗證
  describe("State Management & Validation", () => {
    it("should initialize with default states", () => {
      const controller = new DevotionalSharingController();
      expect(controller.tab).toBe("today");
      expect(controller.filter).toBe("all");
    });

    it("should allow successful tab switching", () => {
      const controller = new DevotionalSharingController();
      controller.tab = "history";
      expect(controller.tab).toBe("history");
      
      controller.tab = "today";
      expect(controller.tab).toBe("today");
    });

    it("should reject invalid tab values", () => {
      const controller = new DevotionalSharingController();
      expect(() => { controller.tab = "invalid_tab"; }).toThrow("無效的 Tab 狀態值: invalid_tab");
    });

    it("should allow successful filter switching", () => {
      const controller = new DevotionalSharingController();
      controller.filter = "mine";
      expect(controller.filter).toBe("mine");

      controller.filter = "all";
      expect(controller.filter).toBe("all");
    });

    it("should reject invalid filter values", () => {
      const controller = new DevotionalSharingController();
      expect(() => { controller.filter = "invalid_filter"; }).toThrow("無效的篩選器值: invalid_filter");
    });
  });

  // 2. 測試正常成功發布心得流程
  describe("Normal Devotional Note Validation", () => {
    it("should accept valid text and return trimmed result", () => {
      const controller = new DevotionalSharingController();
      const validText = " 這是今天的靈修金句與心得：主是我的牧者，我必不致缺乏。 ";
      const result = controller.validateContent(validText);
      expect(result).toBe("這是今天的靈修金句與心得：主是我的牧者，我必不致缺乏。");
    });

    it("should accept content at boundary length (300 characters)", () => {
      const controller = new DevotionalSharingController();
      const edgeText = "A".repeat(300);
      const result = controller.validateContent(edgeText);
      expect(result.length).toBe(300);
    });
  });

  // 3. 測試不安全/髒資料的防禦攔截 (Security First Defense)
  describe("Security Input Defense & Interception", () => {
    it("should reject null or undefined content", () => {
      const controller = new DevotionalSharingController();
      expect(() => controller.validateContent(null)).toThrow("內容不可為空值");
      expect(() => controller.validateContent(undefined)).toThrow("內容不可為空值");
    });

    it("should reject non-string content types", () => {
      const controller = new DevotionalSharingController();
      expect(() => controller.validateContent(12345)).toThrow("內容必須是字串型態");
      expect(() => controller.validateContent({ content: "test" })).toThrow("內容必須是字串型態");
      expect(() => controller.validateContent(["test"])).toThrow("內容必須是字串型態");
    });

    it("should reject empty strings or whitespace-only content", () => {
      const controller = new DevotionalSharingController();
      expect(() => controller.validateContent("")).toThrow("內容不可為空字串");
      expect(() => controller.validateContent("   ")).toThrow("內容不可為空字串");
      expect(() => controller.validateContent("\n\t")).toThrow("內容不可為空字串");
    });

    it("should reject content exceeding 300 characters", () => {
      const controller = new DevotionalSharingController();
      const tooLongText = "A".repeat(301);
      expect(() => controller.validateContent(tooLongText)).toThrow("發佈心得內容不可超過 300 個字");
    });

    it("should intercept basic <script> tag XSS injections", () => {
      const controller = new DevotionalSharingController();
      const xssInput1 = "<script>alert('hack');</script>";
      expect(() => controller.validateContent(xssInput1)).toThrow("內容包含疑似惡意指令或不安全 HTML 語法標籤");
    });

    it("should intercept inline HTML event handler XSS injections", () => {
      const controller = new DevotionalSharingController();
      const xssInput2 = "<img src='x' onerror='alert(1)'>";
      const xssInput3 = "<div onclick='javascript:malicious()'>點擊</div>";
      expect(() => controller.validateContent(xssInput2)).toThrow("內容包含疑似惡意指令或不安全 HTML 語法標籤");
      expect(() => controller.validateContent(xssInput3)).toThrow("內容包含疑似惡意指令或不安全 HTML 語法標籤");
    });

    it("should intercept javascript: protocol URLs", () => {
      const controller = new DevotionalSharingController();
      const xssInput4 = "<a href='javascript:alert(1)'>連結</a>";
      expect(() => controller.validateContent(xssInput4)).toThrow("內容包含疑似惡意指令或不安全 HTML 語法標籤");
    });

    it("should intercept generic HTML tags to enforce plain text safety", () => {
      const controller = new DevotionalSharingController();
      const htmlInput = "<b>主是我的力量</b>";
      expect(() => controller.validateContent(htmlInput)).toThrow("內容包含疑似惡意指令或不安全 HTML 語法標籤");
    });
  });
});
