/**
 * analytics/overview.js — вкладка «Обзор»
 */

import { CAR_STATUSES } from '../../config.js';
import { fmtRub, monthLabelFull, toOpDate, opClass } from './utils.js';
import { analyticsCtx as ctx } from './context.js';

export function renderOverview(dash) {
  const byKey = key => dash.summary?.find(s => s.key === key) || {};
  const revenue = Number(byKey('revenue').current) || 0;
  const opex = Number(byKey('opex').current) || 0;
  const profit = Number(byKey('profit').current) || 0;
  const capex = Number(dash.capexAll) || 0;
  const periodLabel = dash.allTime ? 'ВСЁ ВРЕМЯ' : monthLabelFull(dash.year, dash.month).toUpperCase();

  const withSign = n => `${n >= 0 ? '+' : '−'}${fmtRub(Math.abs(n))}`;
  const prevMonthDelta = key => {
    const prev = byKey(key).previous;
    if (prev === null || prev === undefined || Number.isNaN(Number(prev))) return null;
    return (Number(byKey(key).current) || 0) - (Number(prev) || 0);
  };
  const yearTotals = y => {
    let rev = 0;
    let exp = 0;
    (ctx.ops || []).forEach(op => {
      const d = toOpDate(op);
      if (!d || d.getFullYear() !== y) return;
      const cls = opClass(op);
      const amt = Number(op.amount) || 0;
      if (cls === 'revenue') rev += amt;
      if (cls === 'opex') exp += amt;
    });
    return { revenue: rev, opex: exp, profit: rev - exp };
  };

  let incomeDelta = prevMonthDelta('revenue');
  let opexDelta = prevMonthDelta('opex');
  let profitDelta = prevMonthDelta('profit');
  if (dash.allTime) {
    const curY = Number(dash.year) || new Date().getFullYear();
    const cur = yearTotals(curY);
    const prev = yearTotals(curY - 1);
    const hasPrev = prev.revenue !== 0 || prev.opex !== 0 || prev.profit !== 0;
    incomeDelta = hasPrev ? cur.revenue - prev.revenue : null;
    opexDelta = hasPrev ? cur.opex - prev.opex : null;
    profitDelta = hasPrev ? cur.profit - prev.profit : null;
  }

  const incomeDeltaHtml =
    incomeDelta === null
      ? ''
      : `<div class="ovw-tile__delta ${incomeDelta >= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(incomeDelta)}</div>`;
  const opexDeltaHtml =
    opexDelta === null
      ? ''
      : `<div class="ovw-tile__delta ${opexDelta <= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(opexDelta)}</div>`;
  const profitDeltaHtml =
    profitDelta === null
      ? ''
      : `<div class="ovw-tile__delta ${profitDelta >= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(profitDelta)}</div>`;

  const fleetStatus = (ctx.cars || []).reduce(
    (acc, car) => {
      const st = String(car?.status || '').trim();
      if (st === CAR_STATUSES.RENT) acc.rent += 1;
      else if (st === CAR_STATUSES.IDLE) acc.idle += 1;
      else if (st === CAR_STATUSES.REPAIR) acc.repair += 1;
      return acc;
    },
    { rent: 0, idle: 0, repair: 0 },
  );
  const totalFleet = fleetStatus.rent + fleetStatus.idle + fleetStatus.repair;
  const rentPct = totalFleet > 0 ? Math.round((fleetStatus.rent / totalFleet) * 100) : 0;

  return `
    <div class="ovw-hero">
      <div class="ovw-hero__stripe" style="background:${profit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}"></div>
      <div class="ovw-hero__body">
      <div class="ovw-hero__label">ЧИСТАЯ ПРИБЫЛЬ · ${periodLabel}</div>
      <div class="ovw-hero__amount ovw-hero__amount--${profit >= 0 ? 'pos' : 'neg'}">${withSign(profit)}</div>
      <div class="ovw-hero__sub">Выручка ${fmtRub(revenue)} &nbsp;·&nbsp; Расходы ${fmtRub(opex)}</div>
      </div>
    </div>
    <div class="ovw-sheet">
      <div class="ovw-tiles">
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:var(--c-profit)"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">Выручка</div>
            <div class="ovw-tile__val">${fmtRub(revenue)}</div>
            ${incomeDeltaHtml}
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:var(--c-loss)"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">Опер. расходы</div>
            <div class="ovw-tile__val">${fmtRub(opex)}</div>
            ${opexDeltaHtml}
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:var(--c-muted)"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">CAPEX</div>
            <div class="ovw-tile__val">${fmtRub(capex)}</div>
            <div class="ovw-tile__delta ovw-delta--muted">Всё время</div>
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:${profit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">Прибыль</div>
            <div class="ovw-tile__val ${profit >= 0 ? 'ovw-val--pos' : 'ovw-val--neg'}">${withSign(profit)}</div>
            ${profitDeltaHtml}
          </div>
        </div>
      </div>
    </div>
    <div class="ovw-fleet">
      <div class="sec">Загрузка парка · ${totalFleet} машин</div>

      <div class="ovw-fleet__grid">
        <div class="ovw-fleet__cell ovw-fleet__cell--rent">
          <span class="ovw-fleet__num">${fleetStatus.rent}</span>
          <span class="ovw-fleet__lbl">Аренда</span>
        </div>
        <div class="ovw-fleet__cell ovw-fleet__cell--idle">
          <span class="ovw-fleet__num">${fleetStatus.idle}</span>
          <span class="ovw-fleet__lbl">Простой</span>
        </div>
        <div class="ovw-fleet__cell ovw-fleet__cell--repair">
          <span class="ovw-fleet__num">${fleetStatus.repair}</span>
          <span class="ovw-fleet__lbl">Ремонт</span>
        </div>
      </div>

      <div class="ovw-fleet__bar">
        <div class="ovw-fleet__seg ovw-fleet__seg--rent" style="flex:${fleetStatus.rent}"></div>
        <div class="ovw-fleet__seg ovw-fleet__seg--idle" style="flex:${fleetStatus.idle}"></div>
        <div class="ovw-fleet__seg ovw-fleet__seg--repair" style="flex:${fleetStatus.repair}"></div>
      </div>
      <div class="ovw-fleet__bar-footer">
        <span class="ovw-fleet__bar-lbl">Загрузка</span>
        <span class="ovw-fleet__bar-pct">${rentPct}%</span>
      </div>
    </div>`;
}
