// Chart.js（#568）：只有報表區畫圖，第一次要畫的時候才載入（其他區不會下載）。
// 網址和會友 App 的 js/modules/chart-loader.mjs 是同一個鎖定版本；外殼的 CSP（vercel.admin.json）script-src 只多放行
// 這一個完整網址（scripts/admin-console.test.mjs 比對這三處）。後台不 import js/ 底下的檔，所以網址在這裡另寫一次。
// 同網域的 /legacy（照搬區塊）本來就放行同一個檔，而它和外殼同源、讀得到外殼——多放行到外殼不會擴大能碰到 token 的範圍。

export const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1";

export type ChartInstance = { destroy(): void };
export type ChartConstructor = new (canvas: HTMLCanvasElement, config: unknown) => ChartInstance;
export type ChartLoader = (doc: Document) => Promise<ChartConstructor>;

type ChartWindow = Window & { Chart?: ChartConstructor };

let pending: Promise<ChartConstructor> | null = null;

export const loadChart: ChartLoader = (doc) => {
  const view = doc.defaultView as ChartWindow | null;
  if (view?.Chart) return Promise.resolve(view.Chart);
  if (pending) return pending;
  pending = new Promise<ChartConstructor>((resolve, reject) => {
    const script = doc.createElement("script");
    const fail = () => {
      pending = null; // 下次再試（例如網路剛恢復）
      script.remove();
      reject(new Error("chart_load_failed"));
    };
    script.src = CHART_JS_URL;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.addEventListener("load", () => {
      const ctor = (doc.defaultView as ChartWindow | null)?.Chart;
      if (ctor) resolve(ctor);
      else fail();
    });
    script.addEventListener("error", fail);
    doc.head.appendChild(script);
  });
  return pending;
};

/** 主題色：data-theme 掛在 <html>（theme.ts），從那裡讀 token；讀不到用亮色主題的值，三條線仍分得出來。 */
export function chartColors(doc: Document) {
  const view = doc.defaultView;
  const style = view ? view.getComputedStyle(doc.documentElement) : null;
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    brand: read("--color-brand", "#04A9D2"),
    success: read("--color-success-foreground", "#1F8F52"),
    warning: read("--color-warning", "#FE7615"),
    muted: read("--text-muted", "#8A8A8A")
  };
}
