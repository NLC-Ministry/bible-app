// 後台主題（#555）：和會友 App 一樣三種（淺色／深色／暖色），預設跟系統。
// localStorage 只存這一個介面偏好（不存任何個資或憑證）；讀寫失敗（無痕模式等）就當沒設定。

export const THEMES = ["system", "light", "dark", "warm"] as const;
export type ThemePreference = typeof THEMES[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: "跟隨系統",
  light: "淺色",
  dark: "深色",
  warm: "暖色"
};

export const THEME_STORAGE_KEY = "admin_theme";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readThemePreference(storage: StorageLike | null): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return (THEMES as readonly string[]).includes(String(value)) ? value as ThemePreference : "system";
  } catch (_err) {
    return "system";
  }
}

export function saveThemePreference(storage: StorageLike | null, value: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, value);
  } catch (_err) {
    // 存不了就只套用這一次
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

/** 套到 <html data-theme="…">；admin.css 依這個屬性切換色票。 */
export function applyTheme(root: { setAttribute(name: string, value: string): void }, theme: ResolvedTheme): void {
  root.setAttribute("data-theme", theme);
}
