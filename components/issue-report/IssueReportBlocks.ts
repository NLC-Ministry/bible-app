// components/issue-report/IssueReportBlocks.ts

/**
 * ValidateReportBlock: Handles sanitization and basic check constraints for inputs
 */
export class ValidateReportBlock {
  /**
   * Sanitizes text inputs by escaping/removing script tags for XSS protection
   */
  static sanitize(text: string): string {
    if (!text) return "";
    // Filter out script tags and inline javascript event handlers
    let sanitized = text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+\s*=\s*"(?:[^"]*)"/gi, "")
      .replace(/on\w+\s*=\s*'(?:[^']*)'/gi, "")
      .replace(/javascript\s*:\s*/gi, "");
    
    // Escape HTML entities to prevent rendering arbitrary HTML
    return sanitized
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  /**
   * Validates Category and Description criteria
   */
  static validate(category: string, description: string): { success: boolean; error?: string; sanitizedDescription?: string } {
    const validCategories = ["bug", "ui", "data", "other"];
    if (!validCategories.includes(category)) {
      return { success: false, error: "無效的分類項目" };
    }

    if (!description || description.trim().length === 0) {
      return { success: false, error: "回報內容不能為空" };
    }

    const trimmed = description.trim();
    if (trimmed.length < 1) {
      return { success: false, error: "回報內容太短（最少 1 個字）" };
    }
    if (trimmed.length > 500) {
      return { success: false, error: "回報內容太長（最多 500 個字）" };
    }

    return { 
      success: true, 
      sanitizedDescription: this.sanitize(trimmed) 
    };
  }
}

/**
 * OfflineQueue: Simple self-contained IndexedDB store for offline storage
 */
export class OfflineQueue {
  private dbName = "issue_reports_offline_db";
  private storeName = "reports_queue";
  private dbVersion = 1;

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not supported"));
        return;
      }
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(data: any): Promise<string> {
    const db = await this.openDb();
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    const record = { 
      ...data, 
      id, 
      created_at: new Date().toISOString() 
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.add(record);
      transaction.oncomplete = () => resolve(id);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAll(): Promise<any[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

/**
 * SubmitReportBlock: Decides whether to send online or store offline
 */
export class SubmitReportBlock {
  private static queue = new OfflineQueue();

  /**
   * Helper to check online status (can be mocked in tests)
   */
  static isOnline(): boolean {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }

  static async submit(reportData: {
    category: string;
    description: string;
    url?: string;
    user_agent?: string;
    user_id?: string;
  }): Promise<{ success: boolean; source: "online" | "offline"; error?: string }> {
    if (this.isOnline()) {
      try {
        const state = (window as any).state;
        const supabase = state?.supabase;
        if (!supabase) {
          throw new Error("Supabase client is not initialized");
        }

        const { error } = await supabase
          .from("issue_reports")
          .insert([reportData]);

        if (error) throw error;
        return { success: true, source: "online" };
      } catch (err: any) {
        console.warn("[IssueReport] Online submission failed, caching to offline queue:", err);
        // Fallback to offline queue if online request fails
        await this.queue.add(reportData);
        return { success: true, source: "offline" };
      }
    } else {
      // Offline mode
      await this.queue.add(reportData);
      return { success: true, source: "offline" };
    }
  }
}

/**
 * ReportPipeline: Coordinates validation, concurrency lock, and submission
 */
export class ReportPipeline {
  private static isLocked = false;

  static async execute(category: string, description: string): Promise<{ success: boolean; source?: "online" | "offline"; error?: string }> {
    // Concurrency Lock / Debounce check
    if (this.isLocked) {
      return { success: false, error: "提交處理中，請勿重複連點" };
    }

    this.isLocked = true;

    try {
      // 1. Validation & Sanitization
      const validation = ValidateReportBlock.validate(category, description);
      if (!validation.success) {
        return { success: false, error: validation.error };
      }

      // 2. Fetch context details
      const state = (window as any).state;
      const url = typeof window !== "undefined" ? window.location.href : "";
      const user_agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const user_id = state?.currentUser?.id || null;

      // 3. Submit
      const result = await SubmitReportBlock.submit({
        category,
        description: validation.sanitizedDescription || description,
        url,
        user_agent,
        user_id
      });

      return result;
    } catch (err: any) {
      return { success: false, error: err.message || "提交失敗，請稍後再試" };
    } finally {
      this.isLocked = false;
    }
  }
}

export class FetchMyReportsPipeline {
  static async execute(): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const state = (window as any).state;
      const currentUser = state?.currentUser;
      if (!currentUser?.id) {
        return { success: true, data: [] };
      }

      const supabase = state?.supabase;
      const cfg = state?.supabaseConfig || {};
      const supabaseUrl = cfg.url || "";
      const supabaseAnonKey = cfg.anonKey || "";

      let accessToken = "";
      if (supabase && typeof supabase.auth?.getSession === "function") {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) accessToken = session.access_token;
      }
      if (!accessToken && (window as any).auth && typeof (window as any).auth.getValidAccessToken === "function") {
        accessToken = await (window as any).auth.getValidAccessToken();
      }

      if (accessToken && supabaseUrl) {
        const functionUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/nlc-data`;
        const response = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "apikey": supabaseAnonKey,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            table: "issue_reports",
            action: "select",
            select: "id, created_at, category, description, status, metadata",
            filters: [{ type: "eq", column: "user_id", value: currentUser.id }],
            order: { column: "created_at", ascending: false }
          })
        });

        if (response.ok) {
          const payload = await response.json().catch(() => ({}));
          return { success: true, data: payload.data || [] };
        }
      }

      if (supabase && typeof supabase.from === "function") {
        const { data, error } = await supabase
          .from("issue_reports")
          .select("id, created_at, category, description, status, metadata")
          .eq("user_id", currentUser.id)
          .order("created_at", { ascending: false });

        if (!error) {
          return { success: true, data: data || [] };
        }
      }

      return { success: true, data: [] };
    } catch (err: any) {
      console.error("[IssueReport] Fetch my reports error:", err);
      return { success: false, error: err.message || "讀取歷史回報失敗" };
    }
  }
}

/**
 * How many of a member's own reports have an admin reply they haven't
 * viewed yet — drives the numbered badge on the floating report button.
 */
export function countUnseenReplies(reports: any[]): number {
  if (!Array.isArray(reports)) return 0;
  return reports.filter(r => r?.metadata?.reply && !r?.metadata?.reply_seen_at).length;
}

/**
 * MarkReplySeenPipeline: clears the unread-reply badge for one report.
 * Deliberately does NOT send arbitrary metadata — the server
 * (mark_issue_report_reply_seen in nlc-data) recomputes the merged metadata
 * itself from the current row, so this call can only ever touch
 * reply_seen_at, never the reply text/status/etc. on the caller's own report.
 */
export class MarkReplySeenPipeline {
  static async execute(reportId: string): Promise<{ success: boolean; error?: string }> {
    if (!reportId) return { success: false, error: "missing_report_id" };
    try {
      const state = (window as any).state;
      const currentUser = state?.currentUser;
      if (!currentUser?.id) return { success: false, error: "not_logged_in" };

      const supabase = state?.supabase;
      const cfg = state?.supabaseConfig || {};
      const supabaseUrl = cfg.url || "";
      const supabaseAnonKey = cfg.anonKey || "";

      let accessToken = "";
      if (supabase && typeof supabase.auth?.getSession === "function") {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) accessToken = session.access_token;
      }
      if (!accessToken && (window as any).auth && typeof (window as any).auth.getValidAccessToken === "function") {
        accessToken = await (window as any).auth.getValidAccessToken();
      }

      if (accessToken && supabaseUrl) {
        const functionUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/nlc-data`;
        const response = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "apikey": supabaseAnonKey,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ action: "mark_issue_report_reply_seen", report_id: reportId })
        });
        return { success: response.ok };
      }

      // Dev-mode (real Supabase client) fallback: same read-then-merge
      // pattern the server uses, so this path also never overwrites any
      // metadata key besides reply_seen_at.
      if (supabase && typeof supabase.from === "function") {
        const { data: existing } = await supabase
          .from("issue_reports")
          .select("metadata")
          .eq("id", reportId)
          .eq("user_id", currentUser.id)
          .maybeSingle();
        const existingMetadata = existing?.metadata || {};
        const { error } = await supabase
          .from("issue_reports")
          .update({ metadata: { ...existingMetadata, reply_seen_at: new Date().toISOString() } })
          .eq("id", reportId)
          .eq("user_id", currentUser.id);
        return { success: !error };
      }

      return { success: false, error: "no_client" };
    } catch (err: any) {
      console.error("[IssueReport] Mark reply seen error:", err);
      return { success: false, error: err.message || "標記已讀失敗" };
    }
  }
}

/**
 * Initialize offline sync trigger when network goes online
 */
export function initOfflineReportSync() {
  if (typeof window === "undefined") return;

  window.addEventListener("online", async () => {
    console.log("[IssueReport] Connection restored. Synchronizing offline queue...");
    const queue = new OfflineQueue();
    try {
      const reports = await queue.getAll();
      if (reports.length === 0) return;

      const state = (window as any).state;
      const supabase = state?.supabase;
      if (!supabase) return;

      for (const report of reports) {
        const { id, ...data } = report;
        const { error } = await supabase.from("issue_reports").insert([data]);
        if (!error) {
          await queue.delete(id);
          console.log(`[IssueReport] Sync success: ${id}`);
        } else {
          console.warn(`[IssueReport] Sync failed for ${id}:`, error);
        }
      }
    } catch (err) {
      console.error("[IssueReport] Offline sync error:", err);
    }
  });
}
