// 後台「讀經使用率」：只給系統管理員（ADMIN_SECTIONS 的 panel: 'system'，SQL 端也檢查 role = admin）。
//   #452 DAU／WAU／MAU 逐日趨勢＋黏著度（DAU ÷ MAU）
//   #453 L7 分布：本週（週一～週日，還沒過完就算到迄日）vs 上週
//   #454 讀經時段：24 小時長條圖（全部／平日／週末，平均每天的人數／章數）
// 活躍＝當天（台灣時間）有 plan_id 不是 NULL 的打卡；定義與限制寫在各 migration 的檔頭。
// admin.js 第一次打開這個區段時呼叫 renderAdminReadingActivity()。

export const MAX_RANGE_DAYS = 180;
export const DEFAULT_RANGE_DAYS = 30;

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

// ── #454 讀經時段（24 小時長條圖）────────────────────────────────────────────
// 伺服器回傳每個「星期幾 × 小時」的加總和各星期幾的天數；這裡依「全部／平日／週末」
// 合併成 24 個小時，值＝加總 ÷ 選到的天數＝平均每天的人數（或章數）。
// 用長條長度表示多寡，不靠顏色深淺（維護者 2026-10-07：顏色對色弱不友善）。
export const HOUR_DAY_FILTERS = {
  all: [1, 2, 3, 4, 5, 6, 7],
  weekday: [1, 2, 3, 4, 5],
  weekend: [6, 7]
};

export function buildHourProfile(data, { metric = "users", days = "all" } = {}) {
  const dows = HOUR_DAY_FILTERS[days] || HOUR_DAY_FILTERS.all;
  const key = metric === "chapters" ? "sumChapters" : "sumUsers";
  const dayCount = dows.reduce((sum, dow) => sum + (Number(data?.dayCounts?.[String(dow)]) || 0), 0);
  const sums = new Array(24).fill(0);
  (data?.cells || []).forEach(cell => {
    if (dows.includes(Number(cell.dow))) sums[Number(cell.hour)] += Number(cell[key]) || 0;
  });
  const hours = sums.map((sum, hour) => ({
    hour,
    value: dayCount > 0 ? Math.round((sum / dayCount) * 10) / 10 : 0
  }));
  const top = [...hours].filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value || a.hour - b.hour)
    .slice(0, 3);
  return { dayCount, hours, top };
}

// ── 畫面 ─────────────────────────────────────────────────────────────────────
function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const brand = read("--color-brand", "#04A9D2");
  return {
    brand,
    // 備用色也要三種不同顏色，主題色讀不到時線才分得出來
    success: read("--color-success-foreground", "#1F8F52"),
    warning: read("--color-warning", "#FE7615"),
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
  let hourData = null;
  let hourMetric = "users";
  let hourDays = "all";
  let hourChart = null;

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
    if (!canvas.isConnected || typeof Chart === "undefined") return null; // 載入圖表期間又換了區間
    const chart = new Chart(canvas.getContext("2d"), config);
    charts.push(chart);
    return chart;
  }

  function renderTrend(series) {
    if (!series.length) {
      el.trend.innerHTML = empty("這段期間沒有讀經紀錄。");
      return;
    }
    const summary = summarizeActivity(series);
    const latest = escapeHTML(summary.latest.label);
    const metric = (title, value, note) => `<div>
        <dt>${title}</dt>
        <dd>${escapeHTML(String(value))}</dd>
        <dd class="admin-reading-activity__metric-note">${note}</dd>
      </div>`;
    el.trend.innerHTML = `
      <dl class="admin-reading-activity__metrics">
        ${metric("每天讀經人數（DAU）", summary.avgDau, "區間內平均每天有幾人讀經")}
        ${metric("近 7 天讀過的人（WAU）", summary.latest.wau, `到 ${latest} 為止，7 天內至少讀過一天`)}
        ${metric("近 30 天讀過的人（MAU）", summary.latest.mau, `到 ${latest} 為止，30 天內至少讀過一天`)}
        ${metric("天天讀的比例（黏著度）", formatPct(summary.avgStickiness), "每天讀經人數 ÷ 近 30 天讀過的人，取平均")}
      </dl>
      <figure class="admin-lightning-quiz-trend__chart">
        <figcaption>每天讀經人數（DAU）：看每天的起伏</figcaption>
        <div class="admin-lightning-quiz-trend__canvas admin-reading-activity__canvas"><canvas data-reading-activity-chart="daily"></canvas></div>
      </figure>
      <figure class="admin-lightning-quiz-trend__chart">
        <figcaption>近 7 天／近 30 天讀過的人（WAU／MAU）：看整體規模有沒有成長</figcaption>
        <div class="admin-lightning-quiz-trend__canvas admin-reading-activity__canvas"><canvas data-reading-activity-chart="reach"></canvas></div>
      </figure>
      <details class="admin-reading-activity__table">
        <summary>逐日數字</summary>
        <div class="admin-lightning-quiz-stats-table-wrap">
          <table class="admin-lightning-quiz-stats-table">
            <thead><tr><th>日期</th><th>每天讀經人數</th><th>近 7 天讀過</th><th>近 30 天讀過</th><th>天天讀的比例</th></tr></thead>
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
    const labels = series.map(point => point.label);
    const dataset = (label, key, color) => ({
      label,
      data: series.map(point => point[key]),
      borderColor: color,
      backgroundColor: color,
      pointRadius: series.length > 60 ? 0 : 2,
      tension: 0.25
    });
    const lineOptions = (showLegend, footer) => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: showLegend, position: "bottom" },
        tooltip: { callbacks: { label: context => `${context.dataset.label}：${context.formattedValue} 人`, footer } }
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    });
    return Promise.all([
      drawChart(el.trend.querySelector('[data-reading-activity-chart="daily"]'), {
        type: "line",
        data: { labels, datasets: [dataset("每天讀經人數", "dau", colors.brand)] },
        options: lineOptions(false, items => {
          const point = series[items[0]?.dataIndex];
          return point ? `天天讀的比例 ${formatPct(point.stickiness)}` : "";
        })
      }),
      drawChart(el.trend.querySelector('[data-reading-activity-chart="reach"]'), {
        type: "line",
        data: {
          labels,
          datasets: [
            dataset("近 7 天讀過的人", "wau", colors.success),
            dataset("近 30 天讀過的人", "mau", colors.warning)
          ]
        },
        options: lineOptions(true)
      })
    ]);
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

  function segmented(name, label, options, current) {
    return `<div class="capsule-segmented-control segment-track" role="tablist" aria-label="${label}">
      ${options.map(([value, text]) => `<button type="button" class="segment-toggle-btn${value === current ? " active" : ""}"
        role="tab" aria-selected="${value === current}" data-hour-${name}="${value}">${text}</button>`).join("")}
    </div>`;
  }

  function renderHours() {
    if (!hourData) return;
    if (hourChart) {
      try { hourChart.destroy(); } catch (_) {}
      charts = charts.filter(chart => chart !== hourChart);
      hourChart = null;
    }
    const { dayCount, hours, top } = buildHourProfile(hourData, { metric: hourMetric, days: hourDays });
    const unit = hourMetric === "chapters" ? "章" : "人";
    const hourLabel = hour => `${hour} 時`;
    const topText = top.length
      ? `最多${hourMetric === "chapters" ? "章數" : "人讀"}的時段：${top.map(item => `${hourLabel(item.hour)}（平均每天 ${item.value} ${unit}）`).join("、")}`
      : "這段期間沒有讀經紀錄。";
    el.heatmap.innerHTML = `
      <div class="admin-reading-activity__hour-toolbar">
        ${segmented("days", "星期", [["all", "全部"], ["weekday", "平日"], ["weekend", "週末"]], hourDays)}
        ${segmented("metric", "數值", [["users", "人數"], ["chapters", "章數"]], hourMetric)}
      </div>
      <p class="admin-reading-activity__top">${escapeHTML(topText)}</p>
      <p class="admin-reading-activity__hint">長條＝該小時平均每天讀經的${hourMetric === "chapters" ? "章數" : "人數"}（共 ${escapeHTML(String(dayCount))} 天）。</p>
      <figure class="admin-lightning-quiz-trend__chart">
        <div class="admin-lightning-quiz-trend__canvas admin-reading-activity__canvas"><canvas data-reading-activity-chart="hours" role="img"
          aria-label="${escapeHTML(topText)}"></canvas></div>
      </figure>
      <details class="admin-reading-activity__table">
        <summary>各時段數字</summary>
        <div class="admin-lightning-quiz-stats-table-wrap">
          <table class="admin-lightning-quiz-stats-table">
            <thead><tr><th>時段</th><th>平均每天${hourMetric === "chapters" ? "章數" : "人數"}</th></tr></thead>
            <tbody>${hours.map(item => `<tr><td>${item.hour}:00–${item.hour}:59</td><td>${escapeHTML(String(item.value))}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </details>`;
    el.heatmap.querySelectorAll("[data-hour-days]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.hourDays === hourDays) return;
        hourDays = button.dataset.hourDays;
        renderHours();
      });
    });
    el.heatmap.querySelectorAll("[data-hour-metric]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.hourMetric === hourMetric) return;
        hourMetric = button.dataset.hourMetric;
        renderHours();
      });
    });
    const colors = chartColors();
    return drawChart(el.heatmap.querySelector('[data-reading-activity-chart="hours"]'), {
      type: "bar",
      data: {
        labels: hours.map(item => String(item.hour)),
        datasets: [{
          label: `平均每天${hourMetric === "chapters" ? "章數" : "人數"}`,
          data: hours.map(item => item.value),
          backgroundColor: colors.brand
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => `${items[0]?.label}:00–${items[0]?.label}:59`,
              label: context => `平均每天 ${context.formattedValue} ${unit}`
            }
          }
        },
        scales: {
          x: { title: { display: true, text: "時（0～23）" } },
          y: { beginAtZero: true }
        }
      }
    }).then(chart => { if (chart) hourChart = chart; });
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
      hourData = heatmap.data;
      draws.push(renderHours());
    } else {
      hourData = null;
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
