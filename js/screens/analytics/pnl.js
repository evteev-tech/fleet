/**
 * analytics/pnl.js — вкладка «По машинам» (P&L)
 */

import { fmtRub, monthLabelFull } from './utils.js';

function pnlShortK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}К`;
  return `${Math.round(v)}`;
}

/** Фон heatmap: зелёный / коралл / бледно-розовый при |profit| < 1000 */
function pnlHeatBg(revenue, result) {
  const rev = Number(revenue) || 0;
  const res = Number(result) || 0;
  if (Math.abs(res) < 1000) return 'var(--c-pnl-neutral-bg, #fce4e8)';
  if (res > 0) {
    const margin = rev > 0 ? (res / rev) * 100 : 0;
    if (margin > 60) return 'var(--c-pnl-profit-dark)';
    if (margin >= 30) return 'var(--c-pnl-profit-mid)';
    return 'var(--c-pnl-profit-light)';
  }
  if (res < 0) {
    const abs = Math.abs(res);
    if (abs > 30000) return 'var(--c-pnl-loss-dark)';
    if (abs > 10000) return 'var(--c-pnl-loss-mid)';
    return 'var(--c-pnl-loss-light)';
  }
  return 'var(--c-desktop-bg-2)';
}

/** Тёмная карточка → белый спарклайн / светлая полоса утилизации */
function pnlCardTone(revenue, profit) {
  const rev = Number(revenue) || 0;
  const res = Number(profit) || 0;
  if (Math.abs(res) < 1000) return 'light';
  if (res > 0) {
    const margin = rev > 0 ? (res / rev) * 100 : 0;
    return margin >= 30 ? 'dark' : 'light';
  }
  if (res < 0) return Math.abs(res) > 10000 ? 'dark' : 'light';
  return 'light';
}

function marginLabel(revenue, profit) {
  const rev = Number(revenue) || 0;
  const p = Number(profit) || 0;
  if (rev <= 0) return null;
  const pct = Math.round((p / rev) * 100);
  const sign = pct < 0 ? '−' : '';
  const body = String(Math.abs(pct));
  return `маржа ${sign}${body}%`;
}

function sparklineSvg(series, wide) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const vals = series.map(p => Number(p?.profit) || 0);
  const w = wide ? 80 : 40;
  const h = 14;
  const pad = 1.5;
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const innerH = h - pad * 2;
  const innerW = w - pad * 2;
  const n = vals.length;
  const pts = vals
    .map((v, i) => {
      const x = pad + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const t = (v - min) / (max - min);
      const y = pad + innerH * (1 - t);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return `<svg class="pnl-car__sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts}" /></svg>`;
}

function pnlHeatmapHtml(dash, pnl) {
  const rows = pnl
    .filter(r => r.car !== 'Общие' && r.car !== 'Итого')
    .sort((a, b) => (Number(b.profit) || 0) - (Number(a.profit) || 0));

  const byMonth = dash.pnlByCarMonthly && typeof dash.pnlByCarMonthly === 'object' ? dash.pnlByCarMonthly : {};
  const utilMap =
    dash.utilizationByCar && typeof dash.utilizationByCar === 'object' && !Array.isArray(dash.utilizationByCar)
      ? dash.utilizationByCar
      : {};
  const utilHasDataset =
    dash.allTime !== true &&
    utilMap &&
    typeof utilMap === 'object' &&
    Object.keys(utilMap).length > 0;

  const cards = rows
    .map(r => {
      const profit = Number(r.profit) || 0;
      const rev = Number(r.revenue) || 0;
      const exp = Number(r.expense) || 0;
      const bg = pnlHeatBg(rev, profit);
      const tone = pnlCardTone(rev, profit);
      const toneCls = tone === 'dark' ? 'pnl-car--dark' : 'pnl-car--light';
      const clsPos = profit > 0 ? 'pnl-car--pos' : profit < 0 ? 'pnl-car--neg' : 'pnl-car--zero';

      const isWideCard = profit < 0 && Math.abs(profit) >= 15000;
      const wideCls = isWideCard ? ' pnl-car--wide' : '';

      const series = byMonth[r.car];
      const spark = sparklineSvg(series, isWideCard);

      const marginStr = marginLabel(rev, profit);
      const detailsCore = `↑${pnlShortK(rev)} ↓${pnlShortK(exp)}`;
      const details = marginStr ? `${detailsCore} · ${marginStr}` : detailsCore;

      let utilPct = null;
      if (utilHasDataset) {
        const raw = utilMap[r.car];
        const n = Number(raw);
        utilPct = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
      }
      const utilBlock =
        utilPct !== null
          ? `<div class="pnl-car__util">
        <div class="pnl-car__util-bar"><div class="pnl-car__util-fill" style="width:${utilPct}%"></div></div>
        <span class="pnl-car__util-pct">${utilPct}%</span>
      </div>`
          : '';

      const profitStr = `${profit > 0 ? '+' : ''}${pnlShortK(profit)}`;

      return `<div class="pnl-car ${toneCls} ${clsPos}${wideCls}" style="background:${bg}">
    <div class="pnl-car__header">
      <span class="pnl-car__name">${r.car}</span>
      ${spark}
    </div>
    <div class="pnl-car__profit">${profitStr}</div>
    <div class="pnl-car__details">${details}</div>
    ${utilBlock}
  </div>`;
    })
    .join('');

  const total = pnl.find(x => x.car === 'Итого');
  const totalRow = total
    ? `
    <div class="pnl-heat3-total">
      <span>Итого по парку</span>
      <div>
        <div style="font-size:9px;color:var(--c-muted)">↑${fmtRub(total.revenue)} &nbsp; ↓${fmtRub(total.expense)}</div>
        <div class="pnl-heat3-total__val" style="color:${Number(total.profit) >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}">${Number(total.profit) >= 0 ? '+' : ''}${fmtRub(total.profit)}</div>
      </div>
    </div>`
    : '';

  return `
    <div class="pnl-grid">${cards}</div>
    ${totalRow}`;
}

function pnlRowsWithTotals(pnl, generalOpex) {
  const base = [...(pnl || [])];
  const totalRevenue = base.reduce((a, r) => a + (Number(r.revenue) || 0), 0);
  const totalExpenseCars = base.reduce((a, r) => a + (Number(r.expense) || 0), 0);
  const gen = Number(generalOpex) || 0;
  const totalExpense = totalExpenseCars + gen;
  const totalProfit = totalRevenue - totalExpense;
  return [
    ...base,
    { car: 'Общие', revenue: 0, expense: gen, profit: -gen },
    { car: 'Итого', revenue: totalRevenue, expense: totalExpense, profit: totalProfit },
  ];
}

export function renderPnL(dash) {
  const hasPnl =
    (dash.pnl && dash.pnl.length > 0) || (Number(dash.pnlGeneralOpex) || 0) > 0;
  const inner = hasPnl
    ? pnlHeatmapHtml(dash, pnlRowsWithTotals(dash.pnl, dash.pnlGeneralOpex))
    : '<div class="analytics-muted">Нет данных</div>';
  return `
    <div class="sec">P&amp;L по машинам — ${monthLabelFull(dash.year, dash.month)}</div>
    <div class="white-card analytics-card-pad">
      ${inner}
    </div>`;
}
