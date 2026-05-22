/**
 * CAPEX: Chart.js waterfall (накопительно по месяцам) + анимация окупаемости.
 */

import { loadChartJs } from './chartLoader.js';
import { analyticsCtx as ctx } from './context.js';
import { opClass, toOpDate, monthLabelShort } from './utils.js';
import { formatCompactRub } from '../../utils/format.js';

let _capexChart = null;

function readCssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

/**
 * Сумма CAPEX по операциям до первого числа (year, month).
 */
function capexSumBefore(ops, y, m) {
  const cutoff = new Date(y, m - 1, 1);
  let s = 0;
  (ops || []).forEach(op => {
    if (opClass(op) !== 'capex') return;
    const d = toOpDate(op);
    if (!d || d < cutoff) s += Number(op.amount) || 0;
  });
  return s;
}

/**
 * CAPEX за календарный месяц.
 */
function capexInMonth(ops, y, m) {
  let s = 0;
  (ops || []).forEach(op => {
    if (opClass(op) !== 'capex') return;
    const d = toOpDate(op);
    if (!d) return;
    if (d.getFullYear() === y && d.getMonth() + 1 === m) s += Number(op.amount) || 0;
  });
  return s;
}

/**
 * @returns {{ labels: string[], carry: number[], add: number[], finalCum: number }}
 */
export function buildCapexWaterfallModel(endYear, endMonth, count = 4) {
  const ops = ctx.ops || [];
  const months = [];
  for (let k = count - 1; k >= 0; k--) {
    const dt = new Date(endYear, endMonth - 1 - k, 1);
    months.push({ y: dt.getFullYear(), m: dt.getMonth() + 1 });
  }
  const labels = months.map(({ y, m }) => monthLabelShort(y, m));
  const carry = [];
  const add = [];
  let cum = 0;
  months.forEach(({ y, m }, i) => {
    const before = capexSumBefore(ops, y, m);
    const inM = capexInMonth(ops, y, m);
    carry.push(before);
    add.push(inM);
    cum = before + inM;
  });
  labels.push('итого');
  carry.push(0);
  add.push(cum);
  return { labels, carry, add, finalCum: cum };
}

export function destroyCapexChart() {
  if (_capexChart) {
    try {
      _capexChart.destroy();
    } catch {
      /* noop */
    }
    _capexChart = null;
  }
}

function readPayload(mount) {
  const raw = mount.dataset?.capexChart;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} root — #analytics-root
 */
export async function hydrateCapexChart(root) {
  const mount = root.querySelector('#capex-chart-mount');
  if (!mount) return;
  const canvas = mount.querySelector('canvas');
  if (!canvas) return;

  const payload = readPayload(mount);
  if (!payload) return;

  const ChartLib = await loadChartJs();
  const orphan = ChartLib.getChart(canvas);
  if (orphan) orphan.destroy();
  destroyCapexChart();

  const n = payload.labels.length - 1;
  const carryBg = readCssVar('--c-capex-light', 'rgba(55,138,221,0.25)');
  const addSolid = readCssVar('--c-capex', '#378add');
  const addDark = readCssVar('--c-capex-dark', '#0c447c');
  const borderLight = readCssVar('--c-capex', '#378add');

  const addColors = payload.labels.map((_, i) => (i === n ? addDark : addSolid));

  _capexChart = new ChartLib(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: payload.labels,
      datasets: [
        {
          label: 'Накоплено',
          data: payload.carry,
          backgroundColor: carryBg,
          borderColor: borderLight,
          borderWidth: 1,
          borderDash: [4, 3],
          borderSkipped: false,
          stack: 'w',
        },
        {
          label: 'В этом месяце',
          data: payload.add,
          backgroundColor: addColors,
          borderWidth: 0,
          stack: 'w',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, left: 4, right: 4, bottom: 4 } },
      animation: {
        duration: 1200,
        easing: 'easeOutQuart',
        delay: ctx => (ctx.type === 'data' && ctx.mode === 'default' && ctx.dataIndex != null ? ctx.dataIndex * 150 : 0),
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 0 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: 'rgba(17,17,17,0.06)' },
          ticks: {
            font: { size: 10 },
            callback(v) {
              const k = Number(v);
              if (k >= 1e6) return `${Math.round(k / 1e5) / 10}М`;
              if (k >= 1e3) return `${Math.round(k / 100) / 10}К`;
              return k;
            },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#1a1a1a',
          bodyColor: '#1a1a1a',
          borderColor: 'rgba(17,17,17,0.12)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            title(items) {
              const i = items[0]?.dataIndex ?? 0;
              return payload.labels[i] || '';
            },
            label: () => '',
            afterBody(items) {
              if (!items.length) return '';
              const i = items[0].dataIndex;
              const c = Number(payload.carry[i]) || 0;
              const a = Number(payload.add[i]) || 0;
              return [
                `Накоплено: ${formatCompactRub(c)} ₽`,
                `В этом месяце: ${formatCompactRub(a)} ₽`,
                `Итого к концу: ${formatCompactRub(c + a)} ₽`,
              ];
            },
          },
        },
      },
    },
  });
}

/**
 * Анимация ширины прогресса и счётчика процента окупаемости.
 */
export function animateCapexPayback(root) {
  const bar = root.querySelector('#capex-payback-fill');
  const pctEl = root.querySelector('#capex-payback-pct');
  if (!bar || !pctEl) return;

  const target = Math.min(100, Math.max(0, Number(bar.dataset.pct) || 0));
  const displayTarget = Number(bar.dataset.pctDisplay);
  const displayN = Number.isFinite(displayTarget) ? displayTarget : 0;
  const prefersReduce =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  pctEl.textContent = '0%';
  bar.style.width = '0%';

  if (prefersReduce) {
    bar.style.width = `${target}%`;
    pctEl.textContent = `${displayN}%`;
    return;
  }

  const dur = 1400;
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const ease = 1 - (1 - p) ** 3;
    const w = target * ease;
    bar.style.width = `${w}%`;
    pctEl.textContent = `${Math.round(displayN * ease)}%`;
    if (p < 1) requestAnimationFrame(tick);
    else {
      bar.style.width = `${target}%`;
      pctEl.textContent = `${displayN}%`;
    }
  };
  requestAnimationFrame(tick);
}
