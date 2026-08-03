export interface HighlightRecord {
  id: string;
  user_id: string;
  chapter_id: string;
  selected_text: string;
  start_offset: number;
  end_offset: number;
  color: string;
  created_at?: string;
}

export const HIGHLIGHT_COLORS = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  pink: "#fbcfe8",
  blue: "#bfdbfe"
} as const;

export type HighlightColor = typeof HIGHLIGHT_COLORS[keyof typeof HIGHLIGHT_COLORS];

/**
 * XSS-Safe text fragment highlight wrapper
 * Uses DOM Range / createTextNode to prevent unsafe innerHTML injections.
 */
export function applySafeHighlightToRange(range: Range, color: string): boolean {
  try {
    if (!range || range.collapsed) return false;

    const span = document.createElement("span");
    span.style.backgroundColor = color;
    span.style.borderRadius = "3px";
    span.style.padding = "0 2px";
    span.className = "pwa-text-highlight";
    span.setAttribute("data-highlight-color", color);

    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
    return true;
  } catch (err) {
    console.error("[HighlightAPI] Apply safe highlight error:", err);
    return false;
  }
}

export class HighlightApiBlock {
  private static STORAGE_KEY = "bible_pwa_text_highlights";

  /**
   * Save a highlight record to Supabase with LocalStorage fallback
   */
  static async saveHighlight(record: Omit<HighlightRecord, "id">): Promise<{ success: boolean; data?: HighlightRecord; error?: string }> {
    const id = `hl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const fullRecord: HighlightRecord = { ...record, id, created_at: new Date().toISOString() };

    try {
      const state = (window as any).state;
      const supabase = state?.supabase;

      if (supabase && typeof supabase.from === "function") {
        const { data, error } = await supabase
          .from("highlights")
          .insert([fullRecord])
          .select()
          .maybeSingle();

        if (!error && data) {
          this.saveToLocal(data);
          return { success: true, data };
        }
      }
    } catch (err) {
      console.warn("[HighlightAPI] Remote save failed, falling back to local storage:", err);
    }

    this.saveToLocal(fullRecord);
    return { success: true, data: fullRecord };
  }

  /**
   * Delete a highlight record
   */
  static async deleteHighlight(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const state = (window as any).state;
      const supabase = state?.supabase;

      if (supabase && typeof supabase.from === "function") {
        await supabase.from("highlights").delete().eq("id", id);
      }
    } catch (err) {
      console.warn("[HighlightAPI] Remote delete failed:", err);
    }

    this.deleteFromLocal(id);
    return { success: true };
  }

  /**
   * Fetch highlights for a specific chapter
   */
  static async getHighlights(chapterId: string): Promise<HighlightRecord[]> {
    try {
      const state = (window as any).state;
      const supabase = state?.supabase;

      if (supabase && typeof supabase.from === "function") {
        const { data, error } = await supabase
          .from("highlights")
          .select("*")
          .eq("chapter_id", chapterId);

        if (!error && data) {
          return data;
        }
      }
    } catch (err) {
      console.warn("[HighlightAPI] Remote fetch failed, loading local:", err);
    }

    return this.getLocal().filter(h => h.chapter_id === chapterId);
  }

  private static getLocal(): HighlightRecord[] {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private static saveToLocal(record: HighlightRecord): void {
    if (typeof localStorage === "undefined") return;
    const records = this.getLocal().filter(r => r.id !== record.id);
    records.push(record);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records));
  }

  private static deleteFromLocal(id: string): void {
    if (typeof localStorage === "undefined") return;
    const records = this.getLocal().filter(r => r.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records));
  }
}
