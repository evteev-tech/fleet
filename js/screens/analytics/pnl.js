/**
 * analytics/pnl.js — вкладка «По машинам» (P&L)
 */

import { fmtRub, monthLabelFull } from './utils.js';

function pnlShortK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}К`;
  return `${Math.round(v)}`;
}

function pnlHeatBg(revenue, result) {
  const rev = Number(revenue) || 0;
  const res = Number(result) || 0;
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

function pnlHeatmapHtml(pnl) {
  const rows = pnl.filter(r => r.car !== 'Общие' && r.car !== 'Итого');
  const total = pnl.find(r => r.car === 'Итого');
  const cards = rows
    .map(r => {
      const profit = Number(r.profit) || 0;
      const cls = profit > 0 ? 'phc--pos' : profit < 0 ? 'phc--neg' : 'phc--zero';
      return `<div class="phc ${cls}" style="background:${pnlHeatBg(r.revenue, r.profit)}">
        <div class="phc__id">${r.car}</div>
        <div class="phc__rev">↑${pnlShortK(r.revenue)} ↓${pnlShortK(r.expense)}</div>
        <div class="phc__res">${profit > 0 ? '+' : ''}${pnlShortK(profit)}</div>
      </div>`;
    })
    .join('');
  const totalRow = total
    ? `
    <div class="pnl-heat3-total">
      <span>Итого</span>
      <div>
        <div style="font-size:9px;color:var(--c-muted)">↑${fmtRub(total.revenue)} &nbsp; ↓${fmtRub(total.expense)}</div>
        <div class="pnl-heat3-total__val" style="color:${Number(total.profit) >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}">${Number(total.profit) >= 0 ? '+' : ''}${fmtRub(total.profit)}</div>
      </div>
    </div>`
    : '';
  return `
    <div class="pnl-heat3">${cards}</div>
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
    ? pnlHeatmapHtml(pnlRowsWithTotals(dash.pnl, dash.pnlGeneralOpex))
    : '<div class="analytics-muted">Нет данных</div>';
  return `
    <div class="sec">P&amp;L по машинам — ${monthLabelFull(dash.year, dash.month)}</div>
    <div class="white-card analytics-card-pad">
      ${inner}
    </div>`;
}
