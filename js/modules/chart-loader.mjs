// js/modules/chart-loader.mjs
// 效能重構 A2：Chart.js（~200KB）以前是 index.html <head> 的 render-blocking
// <script>，但只有計畫分頁的統計 / 排名子分頁與後台雲柱測驗趨勢圖會畫圖。
// 改成第一次要畫圖時才動態載入 CDN bundle（鎖版），把它移出首屏關鍵路徑。
let _chartLibPromise = null;
export function ensureChartLib() {
  if (typeof Chart !== "undefined") return Promise.resolve();
  if (_chartLibPromise) return _chartLibPromise;
  _chartLibPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-chartjs-lib="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Chart.js 載入失敗")));
      return;
    }
    const el = document.createElement("script");
    el.src = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1";
    el.crossOrigin = "anonymous";
    el.dataset.chartjsLib = "1";
    el.onload = () => resolve();
    el.onerror = () => {
      _chartLibPromise = null;
      reject(new Error("Chart.js 載入失敗"));
    };
    document.head.appendChild(el);
  });
  return _chartLibPromise;
}
