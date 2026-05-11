/**
 * analytics/kassas.js — строки балансов касс (подстановка в ***REMOVED***analytics-kassas-mount)
 */

import { analyticsCtx as ctx } from './context.js';
import { fmtRub } from './utils.js';

export function renderKassas(dash) {
  const buildBal = (kassas, ops) => {
    const fromApi = new Map(
      (kassas || []).map(k => {
        const bal = Number(k.balanceCurrent ?? k['баланс_текущий'] ?? k.balance ?? NaN);
        return [String(k.kassaId || k['касса_id'] || '').trim(), Number.isNaN(bal) ? null : bal];
      }),
    );
    return id => {
      const v = fromApi.get(id);
      if (v !== null && v !== undefined) return v;
      return (ops || []).reduce((acc, op) => {
        if (String(op.kassaId ?? '').trim() !== id) return acc;
        const amt = Number(op.amount) || 0;
        return acc + (op.direction === 'приход' ? amt : -amt);
      }, 0);
    };
  };
  const getBal = buildBal(dash.kassas, ctx.ops);
  const map = new Map([
    ['K_AZAMAT', getBal('K_AZAMAT')],
    ['K_VLADIMIR', getBal('K_VLADIMIR')],
    ['K_YULIA', getBal('K_YULIA')],
  ]);
  const rows = [
    { id: 'K_AZAMAT', label: 'Azamat', cls: 'analytics-kassa-row--azamat' },
    { id: 'K_VLADIMIR', label: 'Vladimir', cls: 'analytics-kassa-row--vladimir' },
    { id: 'K_YULIA', label: 'Yulia', cls: 'analytics-kassa-row--yulia' },
  ];
  const body = rows
    .map(
      r => `
    <div class="analytics-kassa-row">
      <div class="analytics-kassa-row__name"><span class="analytics-kassa-dot ${r.cls}"></span>${r.label}</div>
      <div class="analytics-kassa-row__nums">
        <span class="analytics-kassa-row__inc">${fmtRub(map.get(r.id) || 0)}</span>
      </div>
    </div>`,
    )
    .join('');
  const activeDeposits = (dash.deposits || [])
    .filter(d => String(d.status || '').toLowerCase().includes('актив'))
    .reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
  const coverageBase = Number(dash.summary?.find(s => s.key === 'opex')?.current) || 0;
  const coveragePct = coverageBase > 0 ? (activeDeposits / coverageBase) * 100 : 0;
  const depositRow = `
    <div class="analytics-kassa-row analytics-kassa-row--deposits">
      <div class="analytics-kassa-row__name">Залоги (DP* АКТИВЕН)</div>
      <div class="analytics-kassa-row__nums">
        <span class="analytics-kassa-row__inc">${fmtRub(activeDeposits)}</span>
        <span class="analytics-kassa-row__cov">Покрытие: ${Math.round(coveragePct)}%</span>
      </div>
    </div>`;
  return `${body}${depositRow}`;
}
