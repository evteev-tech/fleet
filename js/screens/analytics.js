/**
 * analytics.js — сводная аналитика с листа «Дашборд» (investor / operations).
 *
 * GET_DASHBOARD / UPDATE_PERIOD через Apps Script (см. api.js).
 */

import {
  getFleet,
  getOperations,
  getKassas,
  getDeposits,
} from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { mountNavbarInContainer } from '../router.js?v=7';
import { KASSA_NAMES } from '../config.js';

const PAGE_LABELS = ['Обзор', 'Расходы', 'CAPEX', 'По машинам', 'Кассы'];
const CAPEX_MODE = {
  ALL: 'all',
  PERIOD: 'period',
};

const fmtRub = n =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0))} ₽`;

/** 4 месяца: три предыдущих + текущий (от «сегодня»). */
function _pillMonths() {
  const now = new Date();
  const out = [];
  for (let d = -3; d <= 0; d++) {
    const t = new Date(now.getFullYear(), now.getMonth() + d, 1);
    out.push({ year: t.getFullYear(), month: t.getMonth() + 1 });
  }
  return out;
}

function _pillShortLabel(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'short' })
    .replace(/\.$/, '');
}

function _dashboardHasContent(d) {
  const sumOk = (d.summary ?? []).some(
    s =>
      (s.current !== null && s.current !== undefined) ||
      (s.previous !== null && s.previous !== undefined),
  );
  const n =
    (d.opex?.length ?? 0) + (d.pnl?.length ?? 0) + (d.utilization?.length ?? 0);
  return sumOk || n > 0;
}

function _opClass(op) {
  const raw =
    op?.класс_final ??
    op?.classFinal ??
    op?.classItog ??
    op?.класс_итог ??
    op?.class_override ??
    '';
  return String(raw).trim().toLowerCase();
}

function _toOpDate(op) {
  const d = new Date(op?.date);
  if (!Number.isNaN(d.getTime())) return d;
  const raw = String(op?.dateRaw ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length === 3) {
    const dd = Number(parts[0]);
    const mm = Number(parts[1]) - 1;
    const yyyy = Number(parts[2]);
    const fromRu = new Date(yyyy, mm, dd);
    if (!Number.isNaN(fromRu.getTime())) return fromRu;
  }
  return null;
}

function _calcDash({ ops, cars, kassas, deposits, allTime, year, month }) {
  const inPeriod = op => {
    const d = _toOpDate(op);
    if (!d) return false;
    if (allTime) return true;
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  };

  const sumBy = pred =>
    ops
      .filter(pred)
      .reduce((acc, op) => acc + (Number(op.amount) || 0), 0);

  const revenue = sumBy(op => _opClass(op) === 'revenue' && inPeriod(op));
  const opex = sumBy(op => _opClass(op) === 'opex' && inPeriod(op));
  const capexPeriod = sumBy(op => _opClass(op) === 'capex' && inPeriod(op));
  const capexAll = sumBy(op => _opClass(op) === 'capex');
  const profit = revenue - opex;

  let prev = null;
  if (!allTime) {
    const pmDate = new Date(year, month - 2, 1);
    const py = pmDate.getFullYear();
    const pm = pmDate.getMonth() + 1;
    const inPrev = op => {
      const d = _toOpDate(op);
      return !!d && d.getFullYear() === py && d.getMonth() + 1 === pm;
    };
    const prevRevenue = sumBy(op => _opClass(op) === 'revenue' && inPrev(op));
    const prevOpex = sumBy(op => _opClass(op) === 'opex' && inPrev(op));
    const prevCapex = sumBy(op => _opClass(op) === 'capex' && inPrev(op));
    prev = {
      revenue: prevRevenue,
      opex: prevOpex,
      capex: prevCapex,
      profit: prevRevenue - prevOpex,
    };
  }

  const opexRows = [];
  const opexMap = new Map();
  ops.forEach(op => {
    if (_opClass(op) !== 'opex' || !inPeriod(op)) return;
    const k = String(op.category || 'Прочее').trim() || 'Прочее';
    opexMap.set(k, (opexMap.get(k) || 0) + (Number(op.amount) || 0));
  });
  [...opexMap.entries()]
    .filter(([, sum]) => Number(sum) > 0)
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .forEach(([name, amount]) => {
      opexRows.push({
        name,
        amount,
        share: opex > 0 ? amount / opex : 0,
      });
    });

  const pnlMap = new Map();
  let pnlGeneralOpex = 0;
  ops.forEach(op => {
    if (!inPeriod(op)) return;
    const cls = _opClass(op);
    if (cls !== 'revenue' && cls !== 'opex') return;
    const car = String(op.carId || '').trim();
    if (!car) {
      if (cls === 'opex') pnlGeneralOpex += Number(op.amount) || 0;
      return;
    }
    if (!pnlMap.has(car)) {
      pnlMap.set(car, { car, revenue: 0, expense: 0, profit: 0 });
    }
    const row = pnlMap.get(car);
    if (cls === 'revenue') row.revenue += Number(op.amount) || 0;
    if (cls === 'opex') row.expense += Number(op.amount) || 0;
    row.profit = row.revenue - row.expense;
  });

  const capexCatsPeriod = new Map();
  const capexCatsAll = new Map();
  const capexCarsPeriod = new Map();
  const capexCarsAll = new Map();
  ops.forEach(op => {
    const cls = _opClass(op);
    if (cls !== 'capex') return;
    const amt = Number(op.amount) || 0;
    const cat = String(op.category || 'Прочее').trim() || 'Прочее';
    const car = String(op.carId || '').trim() || 'Без машины';
    capexCatsAll.set(cat, (capexCatsAll.get(cat) || 0) + amt);
    capexCarsAll.set(car, (capexCarsAll.get(car) || 0) + amt);
    if (inPeriod(op)) {
      capexCatsPeriod.set(cat, (capexCatsPeriod.get(cat) || 0) + amt);
      capexCarsPeriod.set(car, (capexCarsPeriod.get(car) || 0) + amt);
    }
  });

  const inactive = new Set(['в ремонте', 'продана', 'списана']);
  const totalActive = cars.filter(c => !inactive.has(String(c.status || '').toLowerCase().trim())).length;
  const rented = cars.filter(c => String(c.status || '').toLowerCase().trim() === 'в аренде').length;
  const utilizationPct = totalActive > 0 ? (rented / totalActive) * 100 : 0;

  return {
    allTime,
    year,
    month,
    summary: [
      {
        key: 'revenue',
        label: 'Выручка',
        current: revenue,
        previous: prev?.revenue ?? null,
      },
      {
        key: 'opex',
        label: 'Операционные расходы',
        current: opex,
        previous: prev?.opex ?? null,
      },
      {
        key: 'capex',
        label: allTime ? 'CAPEX (всё время)' : 'CAPEX',
        current: allTime ? capexAll : capexPeriod,
        previous: allTime ? null : prev?.capex ?? null,
      },
      {
        key: 'profit',
        label: 'Прибыль',
        current: profit,
        previous: prev?.profit ?? null,
      },
    ],
    opex: opexRows,
    pnl: [...pnlMap.values()].sort((a, b) => b.profit - a.profit),
    pnlGeneralOpex,
    utilization: [
      {
        car: `В аренде ${rented} из ${totalActive}`,
        pct: utilizationPct,
      },
    ],
    kassas: kassas,
    deposits: deposits || [],
    capexByCategoryPeriod: [...capexCatsPeriod.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([name, amount]) => ({ name, amount })),
    capexByCategoryAll: [...capexCatsAll.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([name, amount]) => ({ name, amount })),
    capexByCarsPeriod: [...capexCarsPeriod.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([car, amount]) => ({ car, amount })),
    capexByCarsAll: [...capexCarsAll.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([car, amount]) => ({ car, amount })),
    capexAll,
    capexPeriod,
  };
}

/** Лучше = ↑ зел.: выручка/прибыль растут; OPEX/CAPEX падают */
function _deltaBlock(key, cur, prev) {
  if (prev === null || prev === undefined || Number.isNaN(Number(prev))) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  let better;
  if (key === 'revenue' || key === 'profit') better = c > p;
  else better = c < p;
  const diff = Math.abs(c - p);
  if (diff < 1e-6) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const arrow = better ? '↑' : '↓';
  const cls = better ? 'analytics-delta--good' : 'analytics-delta--bad';
  return `<span class="analytics-delta ${cls}">${arrow} ${fmtRub(diff)}</span>`;
}

function _tilesHtml(summary) {
  const order = ['revenue', 'opex', 'capex', 'profit'];
  const items = order.map(k => summary.find(s => s.key === k)).filter(Boolean);
  return `
    <div class="analytics-tiles">
      ${items
        .map(
          s => `
        <div class="analytics-tile white-card">
          <div class="analytics-tile__label">${s.label}</div>
          <div class="analytics-tile__amount">${s.current !== null && s.current !== undefined ? fmtRub(s.current) : '—'}</div>
          ${_deltaBlock(s.key, s.current, s.previous)}
        </div>`,
        )
        .join('')}
    </div>`;
}

function _overviewHtml(dash) {
  const byKey = key => dash.summary?.find(s => s.key === key);
  const revenue = Number(byKey('revenue')?.current) || 0;
  const opex = Number(byKey('opex')?.current) || 0;
  const profit = Number(byKey('profit')?.current) || 0;
  const periodLabel = dash.allTime ? 'Всё время' : _monthLabelFull(dash.year, dash.month);
  const amountCls = profit >= 0 ? 'ovw-hero__amount--pos' : 'ovw-hero__amount--neg';
  const tileOrder = [
    { key: 'revenue', label: 'ВЫРУЧКА' },
    { key: 'opex', label: 'ОПЕРАЦИОННЫЕ РАСХОДЫ' },
    { key: 'capex', label: 'CAPEX (ВCЁ ВРЕМЯ)' },
    { key: 'profit', label: 'ПРИБЫЛЬ' },
  ];
  const tiles = tileOrder
    .map(item => {
      const s = byKey(item.key);
      const cur = item.key === 'capex' ? Number(dash.capexAll) || 0 : Number(s?.current) || 0;
      const prev = item.key === 'capex' ? null : s?.previous;
      let deltaText = '—';
      let deltaCls = 'ovw-tile__delta--zero';
      if (prev !== null && prev !== undefined && !Number.isNaN(Number(prev))) {
        const diff = cur - (Number(prev) || 0);
        if (Math.abs(diff) > 1e-6) {
          deltaCls = diff > 0 ? 'ovw-tile__delta--pos' : 'ovw-tile__delta--neg';
          deltaText = `${diff > 0 ? '+' : '−'}${fmtRub(Math.abs(diff))}`;
        }
      }
      return `<div class="ovw-tile">
        <div class="ovw-tile__label">${item.label}</div>
        <div class="ovw-tile__value">${fmtRub(cur)}</div>
        <div class="ovw-tile__delta ${deltaCls}">${deltaText}</div>
      </div>`;
    })
    .join('');
  return `
    <div class="ovw-hero">
      <div class="ovw-hero__label">ЧИСТАЯ ПРИБЫЛЬ · ${periodLabel}</div>
      <div class="ovw-hero__amount ${amountCls}">${profit > 0 ? '+' : ''}${fmtRub(profit)}</div>
      <div class="ovw-hero__sub">Выручка ${fmtRub(revenue)} &nbsp;·&nbsp; Расходы ${fmtRub(opex)}</div>
    </div>
    <div class="ovw-tiles">${tiles}</div>`;
}

function _opexHtml(opex) {
  const total = opex.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const sorted = [...opex]
    .filter(r => (Number(r.amount) || 0) > 0)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

  const COLORS = ['***REMOVED***1A1A1A', '***REMOVED***FFDD2D', '***REMOVED***8A8A8E', '***REMOVED***E34234', '***REMOVED***0066FF', '***REMOVED***E08000'];

  const CIRC = 87.96;
  let offset = 0;
  const segments = sorted.map((r, i) => {
    const pct = total > 0 ? (Number(r.amount) || 0) / total : 0;
    const dash = pct * CIRC;
    const seg = `<circle class="ring-${i + 1}" cx="18" cy="18" r="14" fill="none"
      stroke="${COLORS[i] || '***REMOVED***ccc'}" stroke-width="5"
      stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}"
      stroke-dashoffset="-${offset.toFixed(1)}"
      stroke-linecap="butt"/>`;
    offset += dash + 1.5;
    return seg;
  });

  const legend = sorted
    .map((r, i) => {
      const pct = total > 0 ? ((Number(r.amount) || 0) / total * 100).toFixed(1) : '0.0';
      return `
      <div class="analytics-leg-row">
        <span class="analytics-leg-dot" style="background:${COLORS[i] || '***REMOVED***ccc'}"></span>
        <span class="analytics-leg-name">${r.name}</span>
        <span class="analytics-leg-pct">${pct}%</span>
        <span class="analytics-leg-amt">${fmtRub(r.amount)}</span>
      </div>`;
    })
    .join('');

  const top3 = sorted.slice(0, 3);
  const maxTop = Math.max(1, ...top3.map(r => Number(r.amount) || 0));
  const top3Html = top3
    .map(r => {
      const pct = ((Number(r.amount) || 0) / maxTop) * 100;
      return `<div class="opex-top3__row" style="--pct:${pct.toFixed(2)}%">
        <span class="opex-top3__name">${r.name}</span>
        <div class="opex-top3__bar"><div class="opex-top3__fill"></div></div>
        <span class="opex-top3__val">${fmtRub(r.amount)}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="analytics-donut-wrap">
      <div class="analytics-donut">
        <svg viewBox="0 0 36 36" style="transform:rotate(-90deg)">
          ${segments.join('')}
        </svg>
        <div class="analytics-donut-center">
          <div class="analytics-donut-val">${fmtRub(total)}</div>
          <div class="analytics-donut-lbl">OPEX</div>
        </div>
      </div>
      <div class="analytics-legend">${legend}</div>
    </div>
    <div class="opex-top3">${top3Html}</div>`;
}

function _pnlShortK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}К`;
  return `${Math.round(v)}`;
}

function _pnlHeatBg(revenue, result) {
  const rev = Number(revenue) || 0;
  const res = Number(result) || 0;
  if (res > 0) {
    const margin = rev > 0 ? (res / rev) * 100 : 0;
    if (margin > 60) return '***REMOVED***1B6B47';
    if (margin >= 30) return '***REMOVED***1A5C3A';
    return '***REMOVED***2A7A50';
  }
  if (res < 0) {
    const abs = Math.abs(res);
    if (abs > 30000) return '***REMOVED***3D0A0A';
    if (abs > 10000) return '***REMOVED***5C1010';
    return '***REMOVED***7A2020';
  }
  return '***REMOVED***2A2A2A';
}

function _pnlHtml(pnl) {
  const rows = pnl.filter(r => r.car !== 'Общие' && r.car !== 'Итого');
  const total = pnl.find(r => r.car === 'Итого');
  const cards = rows
    .map(r => {
      const profit = Number(r.profit) || 0;
      const cls = profit > 0 ? 'phc--pos' : profit < 0 ? 'phc--neg' : 'phc--zero';
      return `<div class="phc ${cls}" style="background:${_pnlHeatBg(r.revenue, r.profit)}">
        <div class="phc__id">${r.car}</div>
        <div class="phc__rev">↑${_pnlShortK(r.revenue)} ↓${_pnlShortK(r.expense)}</div>
        <div class="phc__res">${profit > 0 ? '+' : ''}${_pnlShortK(profit)}</div>
      </div>`;
    })
    .join('');
  const totalRow = total
    ? `
    <div class="pnl-heat3-total">
      <span>Итого</span>
      <div>
        <div style="font-size:9px;color:***REMOVED***8a8a8e">↑${fmtRub(total.revenue)} &nbsp; ↓${fmtRub(total.expense)}</div>
        <div class="pnl-heat3-total__val" style="color:${Number(total.profit) >= 0 ? '***REMOVED***00A86B' : '***REMOVED***E34234'}">${Number(total.profit) >= 0 ? '+' : ''}${fmtRub(total.profit)}</div>
      </div>
    </div>`
    : '';
  return `
    <div class="pnl-heat3">${cards}</div>
    ${totalRow}`;
}

function _pnlRowsWithTotals(pnl, generalOpex) {
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

function _utilHtml(utilization) {
  return utilization
    .map(u => {
      let p = u.pct;
      if (p === null || p === undefined || Number.isNaN(Number(p))) p = 0;
      p = Number(p);
      const barClass =
        p >= 70 ? 'analytics-bar--accent' : p < 40 ? 'analytics-bar--danger' : 'analytics-bar--muted';
      return `
      <div class="analytics-util-row">
        <div class="analytics-util-row__top">
          <span>${u.car}</span>
          <span class="analytics-util-pct">${Math.round(p)}%</span>
        </div>
        <div class="analytics-bar ${barClass}"><span style="width:${Math.min(100, Math.max(0, p))}%"></span></div>
      </div>`;
    })
    .join('');
}

function _monthLabelShort(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'short' })
    .replace(/\.$/, '');
}

function _monthLabelFull(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long' })
    .replace(/^./, ch => ch.toUpperCase());
}

function _capexBucketName(cat) {
  const v = String(cat || '').toLowerCase().trim();
  if (!v) return 'Прочее';
  if (v.includes('покуп') || v.includes('приобрет')) return 'Покупки';
  if (v.includes('ремонт') || v.includes('сто')) return 'Ремонты';
  if (
    v.includes('запчаст') ||
    v.includes('шина') ||
    v.includes('масл') ||
    v.includes('фильтр')
  )
    return 'Запчасти';
  return 'Прочее';
}

function _capexPageMonthly(ops, year, month) {
  const rows = [];
  for (let d = -3; d <= 0; d++) {
    const t = new Date(year, month - 1 + d, 1);
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    const sum = (ops || []).reduce((acc, op) => {
      if (_opClass(op) !== 'capex') return acc;
      const dt = _toOpDate(op);
      if (!dt) return acc;
      if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return acc;
      return acc + (Number(op.amount) || 0);
    }, 0);
    rows.push({
      label: _monthLabelShort(y, m),
      amount: sum,
    });
  }
  return rows;
}

function _capexPageHtml(dash, capexMode) {
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
    const b = _capexBucketName(row.name);
    grouped.set(b, (grouped.get(b) || 0) + (Number(row.amount) || 0));
  });
  const donutRows = [
    { key: 'Покупки', color: '***REMOVED***1A1A1A', amount: grouped.get('Покупки') || 0 },
    { key: 'Ремонты', color: '***REMOVED***6366F1', amount: grouped.get('Ремонты') || 0 },
    { key: 'Запчасти', color: '***REMOVED***E08000', amount: grouped.get('Запчасти') || 0 },
    { key: 'Прочее', color: '***REMOVED***CCCCD8', amount: grouped.get('Прочее') || 0 },
  ];
  const total = Number(s.current) || 0;
  const CIRC = 87.96;
  let offset = 0;
  const rings = donutRows
    .map((row, i) => {
      const pct = total > 0 ? row.amount / total : 0;
      const dash = pct * CIRC;
      const seg = `<circle class="donut-ring ring-${i + 1}" cx="18" cy="18" r="14" fill="none"
        stroke="${row.color}" stroke-width="4.5"
        stroke-dasharray="${dash.toFixed(2)} ${(CIRC - dash).toFixed(2)}"
        stroke-dashoffset="-${offset.toFixed(2)}"
      />`;
      offset += dash;
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

  const timeline = _capexPageMonthly(_ops, dash.year, dash.month);
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

  const revenueAcc = (_ops || []).reduce((acc, op) => {
    if (_opClass(op) !== 'revenue') return acc;
    return acc + (Number(op.amount) || 0);
  }, 0);
  const revMonths = new Set(
    (_ops || [])
      .filter(op => _opClass(op) === 'revenue')
      .map(op => {
        const d = _toOpDate(op);
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
            <circle cx="18" cy="18" r="14" fill="none" stroke="***REMOVED***F0F1F3" stroke-width="4.5" />
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
          <div class="roi-c-val" style="color:***REMOVED***E08000">${fmtRub(total)}</div>
        </div>
        <div class="roi-cell">
          <div class="roi-c-lbl">Заработано</div>
          <div class="roi-c-val" style="color:***REMOVED***00A86B">${fmtRub(revenueAcc)}</div>
        </div>
      </div>
    </div>
    <p class="analytics-muted analytics-capex-hint">За период: ${fmtRub(dash.capexPeriod || 0)} · Всё время: ${fmtRub(dash.capexAll || 0)}</p>`;
}

function _kassasRowsHtml(dash) {
  const map = new Map((dash.kassas || []).map(k => [String(k.kassaId || '').trim(), Number(k.balanceCurrent) || 0]));
  const rows = [
    { id: 'K_AZAMAT', label: 'Azamat', cls: 'analytics-kassa-row--azamat' },
    { id: 'K_VLADIMIR', label: 'Vladimir', cls: 'analytics-kassa-row--vladimir' },
    { id: 'K_YULIA', label: 'Yulia', cls: 'analytics-kassa-row--yulia' },
  ];
  const body = rows
    .map(r => `
    <div class="analytics-kassa-row">
      <div class="analytics-kassa-row__name"><span class="analytics-kassa-dot ${r.cls}"></span>${r.label}</div>
      <div class="analytics-kassa-row__nums">
        <span class="analytics-kassa-row__inc">${fmtRub(map.get(r.id) || 0)}</span>
      </div>
    </div>`)
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

function _headerPillsHtml(dash) {
  const pills = _pillMonths();
  const allTime = !!dash.allTime;
  const py = dash.year;
  const pm = dash.month;
  const monthBtns = pills
    .map(({ year, month }) => {
      const active = !allTime && py === year && pm === month;
      return `<button type="button" class="analytics-pill${active ? ' analytics-pill--active' : ''}" data-analytics-pill="1" data-year="${year}" data-month="${month}">${_pillShortLabel(year, month)}</button>`;
    })
    .join('');
  return `
    <div class="analytics-header__pills">
      <div class="analytics-header__pills-m">${monthBtns}</div>
      <button type="button" class="analytics-pill analytics-pill--ghost${allTime ? ' analytics-pill--active' : ''}" data-analytics-pill-all="1">Всё время</button>
    </div>`;
}

function _pagesHtml(dash, emptyMsg, capexMode) {
  const banner =
    emptyMsg && `<div class="analytics-empty-banner">${emptyMsg}</div>`;
  return `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner">
        ${banner || ''}
        ${_overviewHtml(dash)}
        <div class="section-label">Загрузка парка</div>
        <div class="white-card analytics-card-pad">
          ${dash.utilization?.length ? _utilHtml(dash.utilization) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="1">
      <div class="analytics-page-inner">
        <div class="section-label">Расходы по статьям</div>
        <div class="white-card analytics-card-pad">
          ${dash.opex?.length ? _opexHtml(dash.opex) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="2">
      <div class="analytics-page-inner">
        <div class="section-label">CAPEX</div>
        ${_capexPageHtml(dash, capexMode)}
      </div>
    </div>
    <div class="analytics-page" data-page="3">
      <div class="analytics-page-inner">
        <div class="sec">P&amp;L по машинам — ${_monthLabelFull(dash.year, dash.month)}</div>
        <div class="white-card analytics-card-pad">
          ${dash.pnl?.length || (Number(dash.pnlGeneralOpex) || 0) > 0 ? _pnlHtml(_pnlRowsWithTotals(dash.pnl, dash.pnlGeneralOpex)) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="4">
      <div class="analytics-page-inner">
        <div class="section-label">Балансы касс</div>
        <div class="white-card analytics-card-pad" id="analytics-kassas-mount">Загрузка…</div>
      </div>
    </div>`;
}

function _dotsHtml() {
  return PAGE_LABELS.map(
    (_, i) =>
      `<button type="button" class="analytics-dot${i === 0 ? ' is-active' : ''}" data-analytics-dot="${i}" aria-label="${PAGE_LABELS[i]}"></button>`,
  ).join('');
}

function _shellFromParts({ headerPills, carouselInner, bottomBar }) {
  return `
    <header class="analytics-header">
      <div class="analytics-header__top">
        <span class="analytics-title">Аналитика</span>
        <span class="analytics-header__page-label" id="analytics-page-label">${PAGE_LABELS[0]}</span>
      </div>
      ${headerPills}
    </header>
    <div class="analytics-carousel" id="analytics-carousel">
      ${carouselInner}
    </div>
    <div class="analytics-bottom-bar">
      <div class="analytics-dots" id="analytics-dots">${bottomBar ? _dotsHtml() : ''}</div>
      <div class="analytics-navbar" id="analytics-inline-navbar"></div>
    </div>`;
}

function _skeletonShellHTML() {
  const sk = `<div class="white-card skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>`;
  const carouselInner = PAGE_LABELS.map(
    (_, i) => `
    <div class="analytics-page" data-page="${i}">
      <div class="analytics-page-inner">${sk}${sk}</div>
    </div>`,
  ).join('');
  return _shellFromParts({
    headerPills: `<div class="analytics-header__pills"><div class="analytics-header__pills-m">
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
    </div></div>`,
    carouselInner,
    bottomBar: true,
  });
}

function _errorShellHTML(noConn) {
  const inner = `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner analytics-center-msg">
        <div class="white-card analytics-error-card">
          <div class="analytics-error-text">${noConn ? 'Нет соединения' : 'Не удалось загрузить данные'}</div>
          <button type="button" class="btn-primary" id="analytics-retry">Повторить</button>
        </div>
      </div>
    </div>`;
  return _shellFromParts({
    headerPills: '',
    carouselInner: inner,
    bottomBar: false,
  });
}

function _successShellHTML(dash, emptyMsg, capexMode) {
  return _shellFromParts({
    headerPills: _headerPillsHtml(dash),
    carouselInner: _pagesHtml(dash, emptyMsg, capexMode),
    bottomBar: true,
  });
}

function _updateCarouselChrome(root, idx) {
  const car = root.querySelector('***REMOVED***analytics-carousel');
  const label = root.querySelector('***REMOVED***analytics-page-label');
  const dots = root.querySelectorAll('[data-analytics-dot]');
  const safe = Math.max(0, Math.min(PAGE_LABELS.length - 1, idx));
  if (label) label.textContent = PAGE_LABELS[safe] ?? '';
  dots.forEach((d, i) => d.classList.toggle('is-active', i === safe));
  _currentPage = safe;
  _animatePage(root, safe);
}

function _animatePage(root, idx) {
  const page = root.querySelector(`.analytics-page[data-page="${idx}"]`);
  if (!page) return;
  if (idx === 1) {
    const rings = page.querySelectorAll('.analytics-donut circle[class]');
    const delays = [0.1, 0.3, 0.5, 0.7];
    rings.forEach((ring, i) => {
      ring.style.animation = 'none';
      ring.getBoundingClientRect();
      ring.style.animation = `donut-draw 1.2s cubic-bezier(.4,0,.2,1) ${delays[i] || 0.1}s forwards`;
    });
  } else if (idx === 2) {
    const rings = page.querySelectorAll('.donut-ring');
    const delays = [0.1, 0.3, 0.5, 0.7];
    rings.forEach((ring, i) => {
      ring.style.animation = 'none';
      ring.getBoundingClientRect();
      ring.style.animation = `donut-draw 1.2s cubic-bezier(.4,0,.2,1) ${delays[i] || 0.1}s forwards`;
    });
    const center = page.querySelector('.analytics-donut-center');
    if (center) {
      center.style.opacity = '0';
      center.style.animation = 'none';
      center.getBoundingClientRect();
      center.style.animation = 'fade-in 0.35s 0.9s ease forwards';
    }
    page.querySelectorAll('.analytics-legend .analytics-leg-row').forEach((row, i) => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(8px)';
      row.style.animation = 'none';
      row.getBoundingClientRect();
      row.style.animation = `leg-in 0.35s ${(0.4 + i * 0.15).toFixed(2)}s ease forwards`;
    });
    page.querySelectorAll('.tl-row').forEach((row, i) => {
      const fill = row.querySelector('.tl-fill');
      const val = row.querySelector('.tl-val');
      if (fill) {
        fill.style.animation = 'none';
        fill.getBoundingClientRect();
        fill.style.animation = `hbar-grow 0.7s ${(0.1 + i * 0.1).toFixed(2)}s cubic-bezier(.4,0,.2,1) forwards`;
      }
      if (val) {
        val.style.opacity = '0';
        val.style.animation = 'none';
        val.getBoundingClientRect();
        val.style.animation = `fade-in 0.3s ${(0.5 + i * 0.1).toFixed(2)}s forwards`;
      }
    });
    const roi = page.querySelector('.roi-card');
    if (roi) {
      roi.style.animation = 'none';
      roi.getBoundingClientRect();
      roi.style.animation = 'roi-in 0.5s 0.8s cubic-bezier(.4,0,.2,1) forwards';
    }
  } else if (idx === 3) {
    const cards = page.querySelectorAll('.phc');
    cards.forEach((card, i) => {
      card.style.animation = 'none';
      card.getBoundingClientRect();
      card.style.animation = `heat-in 0.4s cubic-bezier(.34,1.56,.64,1) ${(0.05 + i * 0.07).toFixed(2)}s forwards`;
    });
  }
}

function _bindCarouselScroll(root) {
  const car = root.querySelector('***REMOVED***analytics-carousel');
  if (!car || car.dataset.analyticsScrollBound === '1') return;
  car.dataset.analyticsScrollBound = '1';
  let ticking = false;
  car.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const w = car.offsetWidth || 1;
        const idx = Math.round(car.scrollLeft / w);
        _updateCarouselChrome(root, idx);
      });
    },
    { passive: true },
  );
}

async function _mountInlineNavbar(root) {
  const slot = root.querySelector('***REMOVED***analytics-inline-navbar');
  const u = getCurrentUser();
  if (!slot || !u?.role) return;
  await mountNavbarInContainer(slot, u.role, 'screen-analytics');
}

function _hydrateKassas(root, dash) {
  const mount = root.querySelector('***REMOVED***analytics-kassas-mount');
  if (!mount) return;
  mount.innerHTML = _kassasRowsHtml(dash);
}

function _afterShellMounted(root, dash) {
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  _hydrateKassas(root, dash);
  const car = root.querySelector('***REMOVED***analytics-carousel');
  if (car) {
    const safe = Math.max(0, Math.min(PAGE_LABELS.length - 1, _currentPage));
    car.scrollLeft = safe * (car.offsetWidth || 1);
    _updateCarouselChrome(root, safe);
  }
}

let _loading = false;
let _pendingYear = null;
let _pendingMonth = null;
let _pendingAllTime = false;
let _ops = [];
let _cars = [];
let _kassas = [];
let _deposits = [];
let _capexMode = CAPEX_MODE.PERIOD;
let _currentPage = 0;

function _applyDashToState(dash) {
  _pendingYear = dash.year;
  _pendingMonth = dash.month;
  _pendingAllTime = !!dash.allTime;
}

function _refreshViewOnly() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  let cacheHit = false;
  let filled = false;
  let ops;
  let cars;
  let kassas;
  let deposits;

  const paintIfReady = () => {
    if (ops === undefined || cars === undefined || kassas === undefined || deposits === undefined) return;
    _ops = ops;
    _cars = cars;
    _kassas = kassas;
    _deposits = deposits;
    const now = new Date();
    const y = _pendingYear || now.getFullYear();
    const m = _pendingMonth || now.getMonth() + 1;
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: _pendingAllTime,
      year: y,
      month: m,
    });
    filled = true;
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
      _capexMode,
    );
    _afterShellMounted(root, dash);
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => {
      cacheHit = true;
      ops = d || [];
      paintIfReady();
    },
    onFresh: d => {
      ops = d || [];
      paintIfReady();
    },
    onFetchError: (err, meta) => {
      if (!meta?.hadCache) {
        ops = [];
        console.error('Analytics ops _refreshViewOnly:', err);
        paintIfReady();
      }
    },
  });
  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      cars = d || [];
      paintIfReady();
    },
    onFresh: d => {
      cars = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) cars = [];
      paintIfReady();
    },
  });
  getWithSWR(CACHE_KEYS.KASSAS, () => getKassas(), {
    onCached: d => {
      cacheHit = true;
      kassas = d || [];
      paintIfReady();
    },
    onFresh: d => {
      kassas = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) kassas = [];
      paintIfReady();
    },
  });
  getWithSWR(CACHE_KEYS.DEPOSITS, () => getDeposits(), {
    onCached: d => {
      cacheHit = true;
      deposits = d || [];
      paintIfReady();
    },
    onFresh: d => {
      deposits = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) deposits = [];
      paintIfReady();
    },
  });

  setTimeout(() => {
    if (!cacheHit && !filled) {
      root.innerHTML = _skeletonShellHTML();
      void _mountInlineNavbar(root);
      _bindCarouselScroll(root);
      const car = root.querySelector('***REMOVED***analytics-carousel');
      if (car) _updateCarouselChrome(root, 0);
    }
  }, 0);
}

async function _applyPeriod(year, month) {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _skeletonShellHTML();
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  try {
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: false,
      year,
      month,
    });
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
      _capexMode,
    );
    _afterShellMounted(root, dash);
  } catch (err) {
    console.error('Analytics _applyPeriod:', err);
    root.innerHTML = _errorShellHTML(err.message === 'NO_CONNECTION');
    await _mountInlineNavbar(root);
  }
}

async function _applyAllTime() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _skeletonShellHTML();
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  try {
    const now = new Date();
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: true,
      year: _pendingYear || now.getFullYear(),
      month: _pendingMonth || now.getMonth() + 1,
    });
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
      _capexMode,
    );
    _afterShellMounted(root, dash);
  } catch (err) {
    console.error('Analytics _applyAllTime:', err);
    root.innerHTML = _errorShellHTML(err.message === 'NO_CONNECTION');
    await _mountInlineNavbar(root);
  }
}

function _onRootClick(e) {
  const retry = e.target.closest('***REMOVED***analytics-retry');
  if (retry) {
    if (_loading) return;
    _loading = true;
    _refreshViewOnly();
    requestAnimationFrame(() => {
      _loading = false;
    });
    return;
  }

  const dot = e.target.closest('[data-analytics-dot]');
  if (dot && dot.dataset.analyticsDot != null) {
    const root = document.getElementById('analytics-root');
    const car = root?.querySelector('***REMOVED***analytics-carousel');
    if (!car) return;
    const idx = Number(dot.dataset.analyticsDot) || 0;
    _currentPage = idx;
    car.scrollTo({ left: idx * car.offsetWidth, behavior: 'smooth' });
    return;
  }

  const pillAll = e.target.closest('[data-analytics-pill-all]');
  if (pillAll) {
    if (_loading) return;
    _loading = true;
    _applyAllTime().finally(() => {
      _loading = false;
    });
    return;
  }

  const pill = e.target.closest('[data-analytics-pill]');
  if (pill) {
    const y = Number(pill.dataset.year);
    const m = Number(pill.dataset.month);
    if (!y || m < 1 || m > 12) return;
    if (_loading) return;
    _loading = true;
    _applyPeriod(y, m).finally(() => {
      _loading = false;
    });
    return;
  }

  const capexModeBtn = e.target.closest('[data-capex-mode]');
  if (capexModeBtn) {
    const nextMode = String(capexModeBtn.dataset.capexMode || '');
    if (nextMode !== CAPEX_MODE.ALL && nextMode !== CAPEX_MODE.PERIOD) return;
    if (_capexMode === nextMode) return;
    _capexMode = nextMode;
    const root = document.getElementById('analytics-root');
    if (!root) return;
    const now = new Date();
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: _pendingAllTime,
      year: _pendingYear || now.getFullYear(),
      month: _pendingMonth || now.getMonth() + 1,
    });
    root.innerHTML = _successShellHTML(dash, '', _capexMode);
    _afterShellMounted(root, dash);
  }
}

export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (root && !root.dataset.analyticsBound) {
    root.dataset.analyticsBound = '1';
    root.addEventListener('click', _onRootClick);
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-analytics') _refreshViewOnly();
  });
}
