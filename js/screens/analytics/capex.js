/**
 * analytics/capex.js — вкладка CAPEX
 */

import { analyticsCtx as ctx } from './context.js';
import { fmtRub, CAPEX_MODE, monthLabelShort, opClass, toOpDate } from './utils.js';

function capexBucketName(cat) {
  const v = String(cat || '').toLowerCase().trim();
  if (!v) return 'Прочее';
  if (v.includes('покуп') || v.includes('приобрет')) return 'Покупки';
  if (v.includes('ремонт') || v.includes('сто')) return 'Ремонты';
  if (v.includes('запчаст') || v.includes('шина') || v.includes('масл') || v.includes('фильтр'))
    return 'Запчасти';
  return 'Прочее';
}

function capexPageMonthly(ops, year, month) {
  const rows = [];
  for (let d = -3; d <= 0; d++) {
    const t = new Date(year, month - 1 + d, 1);
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    const sum = (ops || []).reduce((acc, op) => {
      if (opClass(op) !== 'capex') return acc;
      const dt = toOpDate(op);
      if (!dt) return acc;
      if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return acc;
      return acc + (Number(op.amount) || 0);
    }, 0);
    rows.push({
      label: monthLabelShort(y, m),
      amount: sum,
    });
  }
  return rows;
}

export function renderCapex(dash, capexMode = CAPEX_MODE.PERIOD) {
  const s = dash.summary?.find(x => x.key === 'capex');
  if (!s) {
    return `<div class="white-card analytics-card-pad"><div class="analytics-muted">Нет данных</div></div>`;
  }
  const isAll = capexMode === CAPEX_MODE.ALL;
  const srcCats = isAll ? dash.capexByCategoryAll : dash.capexByCategoryPeriod;
  const grouped = new Map([
    ['Покупки', 0],
    ['Ремонты', 0],
    ['Запчасти', 0],
    ['Прочее', 0],
  ]);
  (srcCats || []).forEach(row => {
    const b = capexBucketName(row.name);
    grouped.set(b, (grouped.get(b) || 0) + (Number(row.amount) || 0));
  });
  const donutRows = [
    { key: 'Покупки', color: 'var(--c-bar-100)', amount: grouped.get('Покупки') || 0 },
    { key: 'Ремонты', color: 'var(--c-bar-75)', amount: grouped.get('Ремонты') || 0 },
    { key: 'Запчасти', color: 'var(--c-bar-50)', amount: grouped.get('Запчасти') || 0 },
    { key: 'Прочее', color: 'var(--c-bar-10)', amount: grouped.get('Прочее') || 0 },
  ];
  const total = Number(s.current) || 0;
  const CIRC = 87.96;
  let offset = 0;
  const rings = donutRows
    .map((row, i) => {
      const pct = total > 0 ? row.amount / total : 0;
      const arcDash = pct * CIRC;
      const seg = `<circle class="donut-ring ring-${i + 1}" cx="18" cy="18" r="14" fill="none"
        stroke="${row.color}" stroke-width="4.5"
        stroke-dasharray="${arcDash.toFixed(2)} ${(CIRC - arcDash).toFixed(2)}"
        stroke-dashoffset="-${offset.toFixed(2)}"
      />`;
      offset += arcDash;
      return seg;
    })
    .join('');
  const legend = donutRows
    .map(
      row => `
      <div class="analytics-leg-row">
        <span class="analytics-leg-dot" style="background:${row.color}"></span>
        <span class="analytics-leg-name">${row.key}</span>
        <span class="analytics-leg-amt">${fmtRub(row.amount)}</span>
      </div>`,
    )
    .join('');

  const timeline = capexPageMonthly(ctx.ops, dash.year, dash.month);
  const maxMonth = Math.max(1, ...timeline.map(x => Number(x.amount) || 0));
  const timelineHtml = timeline
    .map(row => {
      const width = ((Number(row.amount) || 0) / maxMonth) * 100;
      return `<div class="tl-row">
        <span class="tl-mo">${row.label}</span>
        <div class="tl-track"><div class="tl-fill" style="width:${width.toFixed(2)}%"></div></div>
        <span class="tl-val">${fmtRub(row.amount)}</span>
      </div>`;
    })
    .join('');

  const revenueAcc = (ctx.ops || []).reduce((acc, op) => {
    if (opClass(op) !== 'revenue') return acc;
    return acc + (Number(op.amount) || 0);
  }, 0);
  const revMonths = new Set(
    (ctx.ops || [])
      .filter(op => opClass(op) === 'revenue')
      .map(op => {
        const d = toOpDate(op);
        return d ? `${d.getFullYear()}-${d.getMonth() + 1}` : '';
      })
      .filter(Boolean),
  ).size;
  const avgMonthRev = revMonths > 0 ? revenueAcc / revMonths : 0;
  const needX = revenueAcc > 0 ? total / revenueAcc : 0;
  const paybackMonths = avgMonthRev > 0 ? total / avgMonthRev : 0;

  return `
    <div class="white-card analytics-card-pad">
      <div class="analytics-capex-hero__label">Структура инвестиций</div>
      <div class="analytics-donut-wrap">
        <div class="analytics-donut">
          <svg class="analytics-donut-svg" viewBox="0 0 36 36" style="transform:rotate(-90deg)">
            <circle cx="18" cy="18" r="14" fill="none" stroke='var(--c-bg-page)' stroke-width="4.5" />
            ${rings}
          </svg>
          <div class="analytics-donut-center">
            <div class="analytics-donut-val">${fmtRub(total)}</div>
            <div class="analytics-donut-lbl">CAPEX</div>
          </div>
        </div>
        <div class="analytics-legend">${legend}</div>
      </div>
      <div class="capex-divider"></div>
      <div class="sec">По месяцам</div>
      <div class="tl">${timelineHtml}</div>
    </div>

    <div class="analytics-seg" id="analytics-capex-seg">
      <button type="button" class="analytics-seg__btn${isAll ? ' analytics-seg__btn--active' : ''}" data-capex-mode="${CAPEX_MODE.ALL}">За всё время</button>
      <button type="button" class="analytics-seg__btn${!isAll ? ' analytics-seg__btn--active' : ''}" data-capex-mode="${CAPEX_MODE.PERIOD}">За период</button>
    </div>
    <div class="roi-card">
      <div class="roi-lbl">CAPEX в контексте P&amp;L</div>
      <div class="roi-val">${needX.toFixed(1)}x нужно заработать</div>
      <div class="roi-sub">при выручке ~${Math.round(avgMonthRev / 1000)}К/мес — окупаемость ~${Math.max(0, Math.round(paybackMonths))} мес</div>
      <div class="roi-grid">
        <div class="roi-cell">
          <div class="roi-c-lbl">Вложено</div>
          <div class="roi-c-val" style="color:var(--c-neutral)">${fmtRub(total)}</div>
        </div>
        <div class="roi-cell">
          <div class="roi-c-lbl">Заработано</div>
          <div class="roi-c-val" style="color:var(--c-profit)">${fmtRub(revenueAcc)}</div>
        </div>
      </div>
    </div>
    <p class="analytics-muted analytics-capex-hint">За период: ${fmtRub(dash.capexPeriod || 0)} · Всё время: ${fmtRub(dash.capexAll || 0)}</p>`;
}
