// 後台的舊管理畫面（#550）：localStorage／sessionStorage 換成只在記憶體裡的版本。
//
// 舊程式會把個人資料快照（nlc_supabase_profile）、離線身分、名單快取寫進 localStorage；
// 後台網域不能在瀏覽器裡留下這些（docs/admin-console.md「token 與個資不落地」）。
// 換掉之後舊程式照常讀寫，關掉分頁就沒了。IndexedDB 舊管理畫面用不到，一併拿掉。

export function createMemoryStorage() {
  const items = new Map();
  return {
    get length() {
      return items.size;
    },
    key(index) {
      const keys = [...items.keys()];
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    getItem(key) {
      const name = String(key);
      return items.has(name) ? items.get(name) : null;
    },
    setItem(key, value) {
      items.set(String(key), String(value));
    },
    removeItem(key) {
      items.delete(String(key));
    },
    clear() {
      items.clear();
    }
  };
}

export function installMemoryStorage(win) {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(win, name, { value: createMemoryStorage(), configurable: true, enumerable: true, writable: false });
  }
  try {
    Object.defineProperty(win, "indexedDB", { value: undefined, configurable: true, enumerable: true, writable: false });
  } catch (_err) {
    // 換不掉就算了：舊管理畫面本來就不開 IndexedDB（只有會友 App 的 app.js 會）
  }
}
