// 後台「讀經使用率」：只給系統管理員（ADMIN_SECTIONS 的 panel: 'system'，SQL 端也檢查 role = admin）。
//   #452 DAU／WAU／MAU 逐日趨勢＋黏著度（DAU ÷ MAU）
//   #453 L7 分布：本週（週一～週日，還沒過完就算到迄日）vs 上週
//   #454 星期 × 小時熱度圖（平均每天的人數／章數）
// 活躍＝當天（台灣時間）有 plan_id 不是 NULL 的打卡；定義與限制寫在各 migration 的檔頭。
// admin.js 第一次打開這個區段時呼叫 renderAdminReadingActivity()。

export const MAX_RANGE_DAYS = 180;
export const DEFAULT_RANGE_DAYS = 30;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function taipeiDateString(date = new Date()) {
  return taipeiDateFormatter.format(date);
}

function parseIsoDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function addDays(iso, days) {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / 86400000);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function defaultRange(today) {
  return { from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), to: today };
}

// 回傳錯誤訊息；區間沒問題回傳 null
export function validateRange(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return "請選擇起訖日期。";
  if (from > to) return "起日不能晚於迄日。";
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return `日期區間最長 ${MAX_RANGE_DAYS} 天，請縮短後再試。`;
  return null;
}

export function formatShortDate(iso) {
  const date = parseIsoDate(iso);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function formatPct(ratio) {
  return ratio == null ? "—" : `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

// ── #452 DAU／WAU／MAU ──────────────────────────────────────────────────────
export function buildActivitySeries(days) {
  return (Array.isArray(days) ? days : []).map(day => {
    const dau = Number(day.dau) || 0;
    const wau = Number(day.wau) || 0;
    const mau = Number(day.mau) || 0;
    return {
      date: day.date,
      label: formatShortDate(day.date),
      dau,
      wau,
      mau,
      stickiness: mau > 0 ? dau / mau : null
    };
  });
}

export function summarizeActivity(series) {
  if (!series.length) return { avgDau: null, latest: null, avgStickiness: null };
  const avgDau = series.reduce((sum, point) => sum + point.dau, 0) / series.length;
  const ratios = series.map(point => point.stickiness).filter(value => value != null);
  return {
    avgDau: Math.round(avgDau * 10) / 10,
    latest: series[series.length - 1],
    avgStickiness: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null
  };
}

// ── #453 L7 分布 ─────────────────────────────────────────────────────────────
function buildL7Week(week) {
  const total = Number(week?.total) || 0;
  const byDays = new Map((week?.buckets || []).map(bucket => [Number(bucket.days), Number(bucket.users) || 0]));
  return {
    weekStart: week?.weekStart || "",
    weekEnd: week?.weekEnd || "",
    coveredEnd: week?.coveredEnd || "",
    dayCount: Number(week?.dayCount) || 0,
    total,
    label: week?.weekStart ? `${formatShortDate(week.weekStart)}～${formatShortDate(week.weekEnd)}` : "",
    rows: [1, 2, 3, 4, 5, 6, 7].map(days => {
      const users = byDays.get(days) || 0;
      return { days, users, pct: total > 0 ? users / total : null };
    })
  };
}

export function buildL7View(data) {
  return { current: buildL7Week(data?.current), previous: buildL7Week(data?.previous) };
}

// ── #454 星期 × 小時熱度圖 ───────────────────────────────────────────────────
// metric：'users'（平均每天不重複人數）或 'chapters'（平均每天章數）
export function buildHeatmap(data, metric = "users") {
  const dayCounts = data?.dayCounts || {};
  const key = metric === "chapters" ? "sumChapters" : "sumUsers";
  const sums = new Map((data?.cells || []).map(cell => [`${cell.dow}-${cell.hour}`, Number(cell[key]) || 0]));
  let max = 0;
  const rows = WEEKDAY_LABELS.map((label, index) => {
    const dow = index + 1;
    const dayCount = Number(dayCounts[String(dow)]) || 0;
    const cells = Array.from({ length: 24 }, (_, hour) => {
      const sum = sums.get(`${dow}-${hour}`) || 0;
      const value = dayCount > 0 ? Math.round((sum / dayCount) * 10) / 10 : 0;
      if (value > max) max = value;
      return { hour, value };
    });
    return { dow, label, dayCount, cells };
  });
  return { rows, max };
}

// 0 不上色；其他依比例 15%～100%，最淡的格子也看得出來
export function heatLevel(value, max) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.round((0.15 + 0.85 * (value / max)) * 100);
}

// ── 畫面 ─────────────────────────────────────────────────────────────────────
function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const brand = read("--color-brand", "#04A9D2");
  return {
    brand,
    success: read("--color-success-foreground", brand),
    warning: read("--color-warning", brand),
    muted: read("--text-secondary", "#8A8A8A")
  };
}

export function renderAdminReadingActivity({
  db,
  escapeHTML,
  ensureChartLib,
  getElement = id => document.getElementById(id),
  now = () => new Date()
}) {
  const el = {
    from: getElement("admin-reading-activity-from"),
    to: getElement("admin-reading-activity-to"),
    trend: getElement("admin-reading-activity-trend"),
    l7: getElement("admin-reading-activity-l7"),
    heatmap: getElement("admin-reading-activity-heatmap")
  };
  if (Object.values(el).some(node => !node)) return Promise.resolve(false);

  const range = defaultRange(taipeiDateString(now()));
  el.from.value = range.from;
  el.to.value = range.to;
  el.from.max = range.to;
  el.to.max = range.to;

  let charts = [];
  let requestId = 0;
  let heatmapData = null;
  let heatmapMetric = "users";

  const empty = text => `<div class="admin-user-directory__empty">${escapeHTML(text)}</div>`;
  const destroyCharts = () => {
    charts.forEach(chart => { try { chart.destroy(); } catch (_) {} });
    charts = [];
  };

  async function drawChart(canvas, config) {
    try {
      await ensureChartLib();
    } catch (_) {
      canvas.closest("figure")?.remove();
      return;
    }
    if (!canvas.isConnected || typeof Chart === "undefined") return; // 載入圖表期間又換了區間
    charts.push(new Chart(canvas.getContext("2d"), config));
  }

  function renderTrend(series) {
    if (!series.length) {
      el.trend.innerHTML = empty("這段期間沒有讀經紀錄。");
      return;
    }
    const summary = summarizeActivity(series);
    el.trend.innerHTML = `
      <dl class="admin-reading-activity__metrics">
        <div><dt>平均 DAU</dt><dd>${escapeHTML(String(summary.avgDau))}</dd></div>
        <div><dt>WAU（${escapeHTML(summary.latest.label)}）</dt><dd>${escapeHTML(String(summary.latest.wau))}</dd></div>
        <div><dt>MAU（${escapeHTML(summary.latest.label)}）</dt><dd>${escapeHTML(String(summary.latest.mau))}</dd></div>
        <div><dt>平均黏著度</dt><dd>${escapeHTML(formatPct(summary.avgStickiness))}</dd></div>
      </dl>
      <figure class="admin-lightning-quiz-trend__chart">
        <figcaption>每天讀經人數（DAU）、近 7 天（WAU）、近 30 天（MAU）</figcaption>
        <div class="admin-lightning-quiz-trend__canvas admin-reading-activity__canvas"><canvas data-reading-activity-chart="trend"></canvas></div>
      </figure>
      <details class="admin-reading-activity__table">
        <summary>逐日數字</summary>
        <div class="admin-lightning-quiz-stats-table-wrap">
          <table class="admin-lightning-quiz-stats-table">
            <thead><tr><th>日期</th><th>DAU</th><th>WAU</th><th>MAU</th><th>黏著度</th></tr></thead>
            <tbody>${[...series].reverse().map(point => `<tr>
              <td>${escapeHTML(point.date)}</td>
              <td>${escapeHTML(String(point.dau))}</td>
              <td>${escapeHTML(String(point.wau))}</td>
              <td>${escapeHTML(String(point.mau))}</td>
              <td>${escapeHTML(formatPct(point.stickiness))}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </details>`;
    const colors = chartColors();
    const dataset = (label, key, color) => ({
      label,
      data: series.map(point => point[key]),
      borderColor: color,
      backgroundColor: color,
      pointRadius: series.length > 60 ? 0 : 2,
      tension: 0.25
    });
    return drawChart(el.trend.querySelector('[data-reading-activity-chart="trend"]'), {
      type: "line",
      data: {
        labels: series.map(point => point.label),
        datasets: [
          dataset("DAU", "dau", colors.brand),
          dataset("WAU", "wau", colors.success),
          dataset("MAU", "mau", colors.warning)
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              footer: items => {
                const point = series[items[0]?.dataIndex];
                return point ? `黏著度 ${formatPct(point.stickiness)}` : "";
              }
            }
          }
        },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function renderL7(view) {
    const { current, previous } = view;
    const partial = current.dayCount < 7;
    el.l7.innerHTML = `
      <p class="admin-reading-activity__hint">
        本週 ${escapeHTML(current.label)}${partial ? `（算到 ${escapeHTML(formatShortDate(current.coveredEnd))}，共 ${escapeHTML(String(current.dayCount))} 天，最多只會到 ${escapeHTML(String(current.dayCount))} 天）` : ""}
        ，讀經 ${escapeHTML(String(current.total))} 人；上週 ${escapeHTML(previous.label)}，讀經 ${escapeHTML(String(previous.total))} 人。
      </p>
      <figure class="admin-lightning-quiz-trend__chart">
        <figcaption>一週裡讀經幾天（人數）</figcaption>
        <div class="admin-lightning-quiz-trend__canvas admin-reading-activity__canvas"><canvas data-reading-activity-chart="l7"></canvas></div>
      </figure>
      <div class="admin-lightning-quiz-stats-table-wrap">
        <table class="admin-lightning-quiz-stats-table">
          <thead><tr><th>讀經天數</th><th>本週人數</th><th>本週佔比</th><th>上週人數</th><th>上週佔比</th></tr></thead>
          <tbody>${[...current.rows].reverse().map(row => {
            const prev = previous.rows[row.days - 1];
            return `<tr>
              <td>${escapeHTML(String(row.days))} 天</td>
              <td>${escapeHTML(String(row.users))}</td>
              <td>${escapeHTML(formatPct(row.pct))}</td>
              <td>${escapeHTML(String(prev.users))}</td>
              <td>${escapeHTML(formatPct(prev.pct))}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
    const colors = chartColors();
    const pctLabel = (week, index) => formatPct(week.rows[index]?.pct);
    return drawChart(el.l7.querySelector('[data-reading-activity-chart="l7"]'), {
      type: "bar",
      data: {
        labels: current.rows.map(row => `${row.days} 天`),
        datasets: [
          { label: `上週 ${previous.label}`, data: previous.rows.map(row => row.users), backgroundColor: colors.muted },
          { label: `本週 ${current.label}`, data: current.rows.map(row => row.users), backgroundColor: colors.brand }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: context => {
                const week = context.datasetIndex === 0 ? previous : current;
                return `${context.dataset.label}：${context.formattedValue} 人（${pctLabel(week, context.dataIndex)}）`;
              }
            }
          }
        },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function renderHeatmap() {
    if (!heatmapData) return;
    const { rows, max } = buildHeatmap(heatmapData, heatmapMetric);
    const unit = heatmapMetric === "chapters" ? "章" : "人";
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    el.heatmap.innerHTML = `
      <div class="admin-reading-activity__heatmap-toolbar">
        <div class="capsule-segmented-control segment-track" role="tablist" aria-label="熱度圖數值">
          <button type="button" class="segment-toggle-btn${heatmapMetric === "users" ? " active" : ""}" role="tab" aria-selected="${heatmapMetric === "users"}" data-heatmap-metric="users">人數</button>
          <button type="button" class="segment-toggle-btn${heatmapMetric === "chapters" ? " active" : ""}" role="tab" aria-selected="${heatmapMetric === "chapters"}" data-heatmap-metric="chapters">章數</button>
        </div>
        <p class="admin-reading-activity__hint" data-heatmap-readout>點格子看數字。顏色越深＝平均每天越多${unit}（最深 ${escapeHTML(String(max))} ${unit}）。</p>
      </div>
      <div class="admin-reading-activity__heatmap-scroll">
        <table class="admin-reading-activity__heatmap">
          <thead><tr><th scope="col"></th>${hours.map(hour => `<th scope="col">${hour}</th>`).join("")}</tr></thead>
          <tbody>${rows.map(row => `<tr>
            <th scope="row">${escapeHTML(row.label)}</th>
            ${row.cells.map(cell => {
              const text = `星期${row.label} ${cell.hour}:00–${cell.hour}:59，平均每天 ${cell.value} ${unit}（${row.dayCount} 天）`;
              return `<td><button type="button" class="admin-reading-activity__cell" style="--heat:${heatLevel(cell.value, max)}%"
                data-heatmap-text="${escapeHTML(text)}" aria-label="${escapeHTML(text)}" title="${escapeHTML(text)}"></button></td>`;
            }).join("")}
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    el.heatmap.querySelectorAll("[data-heatmap-metric]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.heatmapMetric === heatmapMetric) return;
        heatmapMetric = button.dataset.heatmapMetric;
        renderHeatmap();
      });
    });
    const readout = el.heatmap.querySelector("[data-heatmap-readout]");
    el.heatmap.querySelectorAll("[data-heatmap-text]").forEach(cell => {
      cell.addEventListener("click", () => { readout.textContent = cell.dataset.heatmapText; });
    });
  }

  async function load() {
    const from = el.from.value;
    const to = el.to.value;
    const myRequest = ++requestId;
    destroyCharts();
    const rangeError = validateRange(from, to);
    if (rangeError) {
      [el.trend, el.l7, el.heatmap].forEach(slot => { slot.innerHTML = empty(rangeError); });
      return true;
    }
    [el.trend, el.l7, el.heatmap].forEach(slot => { slot.innerHTML = empty("讀取中…"); });

    const [trend, l7, heatmap] = await Promise.all([
      db.getReadingActivity(from, to),
      db.getReadingActivityL7(to),
      db.getReadingHourHeatmap(from, to)
    ]);
    if (myRequest !== requestId) return true; // 已經換了區間

    const draws = [];
    if (trend.success) draws.push(renderTrend(buildActivitySeries(trend.data?.days)));
    else el.trend.innerHTML = empty(trend.message);
    if (l7.success) draws.push(renderL7(buildL7View(l7.data)));
    else el.l7.innerHTML = empty(l7.message);
    if (heatmap.success) {
      heatmapData = heatmap.data;
      renderHeatmap();
    } else {
      heatmapData = null;
      el.heatmap.innerHTML = empty(heatmap.message);
    }
    await Promise.all(draws);
    return trend.success && l7.success && heatmap.success;
  }

  el.from.addEventListener("change", () => { void load(); });
  el.to.addEventListener("change", () => { void load(); });
  // 監聽已經綁好，就算這次載入失敗也回 true：不要讓 admin.js 下次重跑一遍又重複綁定，
  // 失敗訊息顯示在各區塊裡，換個日期就會重新載入。
  return load().then(() => true, () => true);
}
