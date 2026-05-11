/**
 * analytics/opex.js — вкладка «Расходы» (OPEX)
 */

import { analyticsCtx as ctx } from './context.js';
import { fmtRub, getOpexColor, monthLabelFull, opClass, toOpDate } from './utils.js';

function prevPeriodLabel(year, month) {
  const prev = new Date(year, month - 2, 1);
  return monthLabelFull(prev.getFullYear(), prev.getMonth() + 1);
}

function opexDynamicsHtml(dash, currentRows, currentTotal) {
  if (dash.allTime) return '';
  const prevDate = new Date(dash.year, dash.month - 2, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth() + 1;
  const prevMap = new Map();

  (ctx.ops || []).forEach(op => {
    if (opClass(op) !== 'opex') return;
    const d = toOpDate(op);
    if (!d) return;
    if (d.getFullYear() !== py || d.getMonth() + 1 !== pm) return;
    const cat = String(op.category || 'Прочее').trim() || 'Прочее';
    prevMap.set(cat, (prevMap.get(cat) || 0) + (Number(op.amount) || 0));
  });

  const prevTotal = [...prevMap.values()].reduce((acc, val) => acc + (Number(val) || 0), 0);
  if (prevTotal <= 0) return '';

  const currentMap = new Map(
    (currentRows || []).map(r => [String(r.name || '').trim() || 'Прочее', Number(r.amount) || 0]),
  );
  const delta = (Number(currentTotal) || 0) - prevTotal;
  const deltaPct = Math.round((Math.abs(delta) / prevTotal) * 100);
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendText =
    trend === 'up' ? 'расходы выросли' : trend === 'down' ? 'расходы снизились' : 'без изменений';
  const deltaSign = delta >= 0 ? '+' : '−';

  const allCats = new Set([...currentMap.keys(), ...prevMap.keys()]);
  let topChangedCategory = '';
  let topDelta = 0;
  allCats.forEach(cat => {
    const dlt = (currentMap.get(cat) || 0) - (prevMap.get(cat) || 0);
    if (dlt > topDelta) {
      topDelta = dlt;
      topChangedCategory = cat;
    }
  });

  return `
    <div class="analytics-card-pad opex-dynamics">
      <div class="sec">Динамика vs ${prevPeriodLabel(dash.year, dash.month)}</div>

      <div class="opex-dyn-hero">
        <div class="opex-dyn-hero__left">
          <div class="opex-dyn-hero__lbl">Этот период</div>
          <div class="opex-dyn-hero__val">${fmtRub(currentTotal)}</div>
        </div>
        <div class="opex-dyn-hero__arrow opex-dyn-hero__arrow--${trend}">${arrow}</div>
        <div class="opex-dyn-hero__right">
          <div class="opex-dyn-hero__lbl">Пред. период</div>
          <div class="opex-dyn-hero__val opex-dyn-hero__val--muted">${fmtRub(prevTotal)}</div>
        </div>
      </div>

      <div class="opex-dyn-delta opex-dyn-delta--${trend}">
        ${delta >= 0 ? '+' : ''}${fmtRub(delta)}
        (${deltaSign}${deltaPct}%)
        ${trendText}
      </div>

      ${
        topDelta > 0 && topChangedCategory
          ? `<div class="opex-dyn-top">
          <span class="opex-dyn-top__lbl">Главный рост:</span>
          <span class="opex-dyn-top__cat">${topChangedCategory}</span>
          <span class="opex-dyn-top__val" style="color:${getOpexColor(topChangedCategory)}">+${fmtRub(topDelta)}</span>
        </div>`
          : ''
      }
    </div>`;
}

function opexDonutSection(opex) {
  const total = opex.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const sorted = [...opex]
    .filter(r => (Number(r.amount) || 0) > 0)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

  const CIRC = 87.96;
  let accShare = 0;
  const segments = sorted.map((r, i) => {
    const share = total > 0 ? (Number(r.amount) || 0) / total : 0;
    const dash = share * CIRC;
    const dashOffset = -(accShare * CIRC);
    const seg = `<circle class="ring-${i + 1}" cx="18" cy="18" r="14" fill="none"
      stroke="${getOpexColor(r.name)}" stroke-width="5"
      stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}"
      stroke-dashoffset="${dashOffset.toFixed(1)}"
      stroke-linecap="butt"/>`;
    accShare += share;
    return seg;
  });

  const legend = sorted
    .map(r => {
      const pct = total > 0 ? (((Number(r.amount) || 0) / total) * 100).toFixed(1) : '0.0';
      return `
      <div class="analytics-leg-row">
        <span class="analytics-leg-dot" style="background:${getOpexColor(r.name)}"></span>
        <span class="analytics-leg-name">${r.name}</span>
        <span class="analytics-leg-pct">${pct}%</span>
        <span class="analytics-leg-amt">${fmtRub(r.amount)}</span>
      </div>`;
    })
    .join('');

  const top3 = sorted.slice(0, 3);
  const maxTop = Math.max(1, ...sorted.map(r => Number(r.amount) || 0));
  const top3Html = top3
    .map(r => {
      const pct = ((Number(r.amount) || 0) / maxTop) * 100;
      return `<div class="opex-top3__row" style="--pct:${pct.toFixed(2)}%">
        <span class="opex-top3__name">${r.name}</span>
        <div class="opex-top3__bar"><div class="opex-top3__fill" style="background:${getOpexColor(r.name)}"></div></div>
        <span class="opex-top3__val">${fmtRub(r.amount)}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="analytics-donut-wrap">
      <div class="analytics-donut" id="opex-donut-svg">
        <svg viewBox="0 0 36 36" style="transform:rotate(-90deg)">
          ${segments.join('')}
        </svg>
        <div class="analytics-donut-center">
          <div class="analytics-donut-val">${fmtRub(total)}</div>
          <div class="analytics-donut-lbl">OPEX</div>
        </div>
      </div>
      <div class="analytics-legend" id="opex-legend">${legend}</div>
    </div>
    <div class="opex-top3">${top3Html}</div>`;
}

/** Контент вкладки «Расходы»: донат + динамика (как в прежнем _pagesHtml). */
export function renderOpex(dash) {
  const opex = dash.opex || [];
  const total = opex.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const donutBlock = opex.length ? opexDonutSection(opex) : '<div class="analytics-muted">Нет данных</div>';
  const dynBlock = opex.length ? opexDynamicsHtml(dash, opex, total) : '';
  return `
    <div class="section-label">Расходы по статьям</div>
    <div class="white-card analytics-card-pad">
      ${donutBlock}
    </div>
    ${dynBlock}`;
}
