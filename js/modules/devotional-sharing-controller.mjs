/**
 * DevotionalSharingController
 * 
 * 牧區靈修分享牆的 OOP 狀態管理與輸入安全防禦控制器。
 * 負責 Tab 狀態、歷史篩選狀態管理，以及發布內容的安全淨化 (XSS 防禦)。
 */
export class DevotionalSharingController {
  constructor(initialTab = "today", initialFilter = "all") {
    this._tab = this._validateTab(initialTab);
    this._filter = this._validateFilter(initialFilter);
  }

  get tab() {
    return this._tab;
  }

  set tab(value) {
    this._tab = this._validateTab(value);
  }

  get filter() {
    return this._filter;
  }

  set filter(value) {
    this._filter = this._validateFilter(value);
  }

  /**
   * 驗證 Tab 狀態值是否正確
   */
  _validateTab(tab) {
    if (tab !== "today" && tab !== "history") {
      throw new Error(`無效的 Tab 狀態值: ${tab}`);
    }
    return tab;
  }

  /**
   * 驗證 Filter 狀態值是否正確
   */
  _validateFilter(filter) {
    if (filter !== "all" && filter !== "mine") {
      throw new Error(`無效的篩選器值: ${filter}`);
    }
    return filter;
  }

  /**
   * 靈修心得內容輸入驗證與防禦過濾 (Security First)
   * 1. 驗證資料型態
   * 2. 防止 XSS 注入攻擊 (過濾 script 標籤與 inline event handlers)
   * 3. 限制字數長度 (300字以內)
   */
  validateContent(content) {
    if (content === null || content === undefined) {
      throw new Error("內容不可為空值");
    }

    if (typeof content !== "string") {
      throw new Error("內容必須是字串型態");
    }

    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("內容不可為空字串");
    }

    if (trimmed.length > 300) {
      throw new Error("發佈心得內容不可超過 300 個字");
    }

    // 🔬 XSS 髒資料過濾與防禦
    // 檢查是否有常見惡意 HTML 腳本注入
    const lower = trimmed.toLowerCase();
    const hasScriptTag = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(lower);
    const hasOnEvent = /\bon[a-z]+\s*=/g.test(lower); // 如 onclick=, onerror=, onload=
    const hasJavascriptProtocol = /javascript:/g.test(lower); // 如 <a href="javascript:...">
    const hasHtmlTags = /<[^>]*>/g.test(trimmed); // 包含任何 html 標籤

    if (hasScriptTag || hasOnEvent || hasJavascriptProtocol || hasHtmlTags) {
      throw new Error("內容包含疑似惡意指令或不安全 HTML 語法標籤，已進行攔截阻擋！");
    }

    return trimmed;
  }
}
