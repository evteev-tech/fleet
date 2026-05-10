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
  getActiveRentals,
} from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { mountNavbarInContainer } from '../router.js?v=7';
import { CAR_STATUSES, KASSA_NAMES } from '../config.js';

const PAGE_LABELS = ['Обзор', 'Расходы', 'CAPEX', 'По машинам', 'Кассы', 'Прогноз'];
const CAPEX_MODE = {
  ALL: 'all',
  PERIOD: 'period',
};
const OPEX_COLORS = {
  ремонт:    '***REMOVED***C2501A',
  запчасти:  '***REMOVED***8B5E3C',
  доставка:  '***REMOVED***A8845A',
  зп:        '***REMOVED***6B3F20',
  страховка: '***REMOVED***B83820',
  реклама:   '***REMOVED***C4AA8A',
  прочее:    '***REMOVED***DDD0BE',
  то:        '***REMOVED***A8845A',
  штраф_гибдд: '***REMOVED***B83820',
  дтп:       '***REMOVED***8B2200',
  связь_глонасс: '***REMOVED***7A6040',
  покупка_машины: '***REMOVED***1C1410',
};

const fmtRub = n =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0))} ₽`;

function getOpexColor(category) {
  const key = String(category || '').toLowerCase().trim();
  return OPEX_COLORS[key] ?? '***REMOVED***DDD0BE';
}

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
  const byKey = key => dash.summary?.find(s => s.key === key) || {};
  const revenue = Number(byKey('revenue').current) || 0;
  const opex = Number(byKey('opex').current) || 0;
  const profit = Number(byKey('profit').current) || 0;
  const capex = Number(dash.capexAll) || 0;
  const periodLabel = dash.allTime ? 'ВСЁ ВРЕМЯ' : _monthLabelFull(dash.year, dash.month).toUpperCase();

  const withSign = n => `${n >= 0 ? '+' : '−'}${fmtRub(Math.abs(n))}`;
  const prevMonthDelta = key => {
    const prev = byKey(key).previous;
    if (prev === null || prev === undefined || Number.isNaN(Number(prev))) return null;
    return (Number(byKey(key).current) || 0) - (Number(prev) || 0);
  };
  const yearTotals = y => {
    let rev = 0;
    let exp = 0;
    (_ops || []).forEach(op => {
      const d = _toOpDate(op);
      if (!d || d.getFullYear() !== y) return;
      const cls = _opClass(op);
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

  const incomeDeltaHtml = incomeDelta === null
    ? ''
    : `<div class="ovw-tile__delta ${incomeDelta >= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(incomeDelta)}</div>`;
  const opexDeltaHtml = opexDelta === null
    ? ''
    : `<div class="ovw-tile__delta ${opexDelta <= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(opexDelta)}</div>`;
  const profitDeltaHtml = profitDelta === null
    ? ''
    : `<div class="ovw-tile__delta ${profitDelta >= 0 ? 'ovw-delta--pos' : 'ovw-delta--neg'}">${withSign(profitDelta)}</div>`;

  const fleetStatus = (_cars || []).reduce(
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
      <div class="ovw-hero__stripe" style="background:${profit >= 0 ? '***REMOVED***C2501A' : '***REMOVED***B83820'}"></div>
      <div class="ovw-hero__body">
      <div class="ovw-hero__label">ЧИСТАЯ ПРИБЫЛЬ · ${periodLabel}</div>
      <div class="ovw-hero__amount ovw-hero__amount--${profit >= 0 ? 'pos' : 'neg'}">${withSign(profit)}</div>
      <div class="ovw-hero__sub">Выручка ${fmtRub(revenue)} &nbsp;·&nbsp; Расходы ${fmtRub(opex)}</div>
      </div>
    </div>
    <div class="ovw-sheet">
      <div class="ovw-tiles">
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:***REMOVED***C2501A"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">Выручка</div>
            <div class="ovw-tile__val">${fmtRub(revenue)}</div>
            ${incomeDeltaHtml}
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:***REMOVED***B83820"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">Опер. расходы</div>
            <div class="ovw-tile__val">${fmtRub(opex)}</div>
            ${opexDeltaHtml}
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:***REMOVED***A8845A"></div>
          <div class="ovw-tile__content">
            <div class="ovw-tile__lbl">CAPEX</div>
            <div class="ovw-tile__val">${fmtRub(capex)}</div>
            <div class="ovw-tile__delta ovw-delta--muted">Всё время</div>
          </div>
        </div>
        <div class="ovw-tile">
          <div class="ovw-tile__stripe" style="background:${profit >= 0 ? '***REMOVED***C2501A' : '***REMOVED***B83820'}"></div>
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

function _prevPeriodLabel(year, month) {
  const prev = new Date(year, month - 2, 1);
  return _monthLabelFull(prev.getFullYear(), prev.getMonth() + 1);
}

function _opexDynamicsHtml(dash, currentRows, currentTotal) {
  if (dash.allTime) return '';
  const prevDate = new Date(dash.year, dash.month - 2, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth() + 1;
  const prevMap = new Map();

  (_ops || []).forEach(op => {
    if (_opClass(op) !== 'opex') return;
    const d = _toOpDate(op);
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
    trend === 'up'
      ? 'расходы выросли'
      : trend === 'down'
        ? 'расходы снизились'
        : 'без изменений';
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
      <div class="sec">Динамика vs ${_prevPeriodLabel(dash.year, dash.month)}</div>

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

      ${topDelta > 0 && topChangedCategory
    ? `<div class="opex-dyn-top">
          <span class="opex-dyn-top__lbl">Главный рост:</span>
          <span class="opex-dyn-top__cat">${topChangedCategory}</span>
          <span class="opex-dyn-top__val" style="color:${getOpexColor(topChangedCategory)}">+${fmtRub(topDelta)}</span>
        </div>`
    : ''}
    </div>`;
}

function _opexHtml(opex) {
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
      const pct = total > 0 ? ((Number(r.amount) || 0) / total * 100).toFixed(1) : '0.0';
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
    if (margin > 60) return '***REMOVED***7A3D10';
    if (margin >= 30) return '***REMOVED***6B3218';
    return '***REMOVED***8B4520';
  }
  if (res < 0) {
    const abs = Math.abs(res);
    if (abs > 30000) return '***REMOVED***4A1505';
    if (abs > 10000) return '***REMOVED***6B2010';
    return '***REMOVED***8B2810';
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
        <div class="pnl-heat3-total__val" style="color:${Number(total.profit) >= 0 ? '***REMOVED***C2501A' : '***REMOVED***B83820'}">${Number(total.profit) >= 0 ? '+' : ''}${fmtRub(total.profit)}</div>
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
    { key: 'Ремонты', color: '***REMOVED***8B5E3C', amount: grouped.get('Ремонты') || 0 },
    { key: 'Запчасти', color: '***REMOVED***A8845A', amount: grouped.get('Запчасти') || 0 },
    { key: 'Прочее', color: '***REMOVED***DDD0BE', amount: grouped.get('Прочее') || 0 },
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
          <div class="roi-c-val" style="color:***REMOVED***A8845A">${fmtRub(total)}</div>
        </div>
        <div class="roi-cell">
          <div class="roi-c-lbl">Заработано</div>
          <div class="roi-c-val" style="color:***REMOVED***C2501A">${fmtRub(revenueAcc)}</div>
        </div>
      </div>
    </div>
    <p class="analytics-muted analytics-capex-hint">За период: ${fmtRub(dash.capexPeriod || 0)} · Всё время: ${fmtRub(dash.capexAll || 0)}</p>`;
}

function _kassasRowsHtml(dash) {
  // Приоритет: balanceCurrent из API → баланс_текущий → расчёт из операций
  const _buildBal = (kassas, ops) => {
    const fromApi = new Map((kassas || []).map(k => {
      const bal = Number(k.balanceCurrent ?? k['баланс_текущий'] ?? k.balance ?? NaN);
      return [String(k.kassaId || k['касса_id'] || '').trim(), isNaN(bal) ? null : bal];
    }));
    return (id) => {
      const v = fromApi.get(id);
      if (v !== null && v !== undefined) return v;
      return (ops || []).reduce((acc, op) => {
        if (String(op.kassaId ?? '').trim() !== id) return acc;
        const amt = Number(op.amount) || 0;
        return acc + (op.direction === 'приход' ? amt : -amt);
      }, 0);
    };
  };
  const _getBal = _buildBal(dash.kassas, _ops);
  const map = new Map([
    ['K_AZAMAT',   _getBal('K_AZAMAT')],
    ['K_VLADIMIR', _getBal('K_VLADIMIR')],
    ['K_YULIA',    _getBal('K_YULIA')],
  ]);
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

// -----------------------------------------------------------------------------
// ПРОГНОЗ ДЕНЕЖНОГО ПОТОКА — 14 дней
// -----------------------------------------------------------------------------

let _forecastRentals = null; // кэш активных аренд для текущей сессии

function _parseDDMMYYYY(str) {
  if (!str) return null;
  const s = String(str).trim();
  const parts = s.split('.');
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return isNaN(d.getTime()) ? null : d;
}

function _buildForecast(rentals) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    day.setHours(0, 0, 0, 0);
    let total = 0;
    const cars = [];
    (rentals || []).forEach(r => {
      const end = _parseDDMMYYYY(r.date_end);
      const start = _parseDDMMYYYY(r.date_start);
      if (!end || !start) return;
      if (day >= start && day <= end) {
        total += Number(r.rate_day) || 0;
        cars.push(r.car_id);
      }
    });
    days.push({ day, total, cars });
  }
  return days;
}

function _forecastHtml(rentals) {
  const days = _buildForecast(rentals || []);
  const totalPeriod = days.reduce((s, d) => s + d.total, 0);
  const activeCount = (rentals || []).length;
  const avgDay = totalPeriod > 0 ? Math.round(totalPeriod / 14) : 0;

  const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const week1 = days.slice(0, 7);
  const week2 = days.slice(7, 14);

  function _weekLabel(wDays) {
    const first = wDays[0].day;
    const last = wDays[wDays.length - 1].day;
    const f = `${first.getDate()} ${MON_SHORT[first.getMonth()]}`;
    const l = `${last.getDate()} ${MON_SHORT[last.getMonth()]}`;
    return `${f} — ${l}`;
  }

  function _weekBars(wDays, globalMax, weekIdx) {
    return wDays.map((d, i) => {
      const isToday = weekIdx === 0 && i === 0;
      const heightPx = globalMax > 0 ? Math.round((d.total / globalMax) * 44) : 3;
      const safeH = Math.max(3, heightPx);
      let color = '***REMOVED***7A6040';
      if (d.total >= globalMax * 0.9) color = '***REMOVED***C2501A';
      else if (d.total >= globalMax * 0.6) color = '***REMOVED***A8845A';
      else if (d.total >= globalMax * 0.3) color = '***REMOVED***8A6840';
      else if (d.total === 0) color = '***REMOVED***3A3A3A';
      return `
        <div class="fcst-wk__col${isToday ? ' fcst-wk__col--today' : ''}">
          <div class="fcst-wk__fill" style="height:${safeH}px;background:${color}"></div>
          <div class="fcst-wk__day">${DAY_NAMES[d.day.getDay()]}</div>
        </div>`;
    }).join('');
  }

  function _weekBlock(wDays, globalMax, weekIdx) {
    const total = wDays.reduce((s, d) => s + d.total, 0);
    const maxCars = Math.max(...wDays.map(d => d.cars.length));
    const metaText = maxCars > 0 ? `до ${maxCars} маш. в день` : 'нет аренд';
    const amtColor = total >= totalPeriod * 0.6 ? '***REMOVED***C2501A' : total > 0 ? '***REMOVED***A8845A' : '***REMOVED***666';
    return `
      <div class="white-card fcst-wk">
        <div class="fcst-wk__head">
          <div class="sec">${_weekLabel(wDays)}</div>
          <div class="fcst-wk__meta">${metaText}</div>
        </div>
        <div class="fcst-wk__amt" style="color:${amtColor}">${fmtRub(total)}</div>
        <div class="fcst-wk__bars">
          ${_weekBars(wDays, globalMax, weekIdx)}
        </div>
      </div>`;
  }

  const globalMax = Math.max(1, ...days.map(d => d.total));

  // Ближайшие 3 дня
  const nearest3 = days.slice(0, 3).map((d, i) => {
    const isToday = i === 0;
    const dateLabel = `${d.day.getDate()} ${DAY_NAMES[d.day.getDay()]}`;
    const carsLabel = d.cars.length > 0 ? `${d.cars.length} маш.` : '—';
    return `
      <div class="fcst-nd${isToday ? ' fcst-nd--today' : ''}">
        <div class="fcst-nd__date">${dateLabel}</div>
        <div class="fcst-nd__amt">${d.total > 0 ? new Intl.NumberFormat('ru-RU').format(d.total) : '—'}</div>
        <div class="fcst-nd__cur">${d.total > 0 ? '₽' : ''}</div>
        <div class="fcst-nd__cars">${carsLabel}</div>
      </div>`;
  }).join('');

  return `
    <div class="fcst-hero">
      <div class="fcst-hero__label">ПРОГНОЗ · 14 ДНЕЙ</div>
      <div class="fcst-hero__amount">${fmtRub(totalPeriod)}</div>
      <div class="fcst-hero__sub">${activeCount} активных аренд · ${fmtRub(avgDay)}/день в среднем</div>
    </div>
    ${_weekBlock(week1, globalMax, 0)}
    ${_weekBlock(week2, globalMax, 1)}
    <div class="white-card fcst-nearest">
      <div class="sec">Ближайшие 3 дня</div>
      <div class="fcst-nd__grid">${nearest3}</div>
    </div>`;
}

function _forecastLoadingHtml() {
  return `
    <div class="fcst-loading">
      <div class="skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:160px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:240px;border-radius:14px"></div>
    </div>`;
}

async function _hydrateForecast(root) {
  const mount = root.querySelector('***REMOVED***analytics-forecast-mount');
  if (!mount) return;
  if (_forecastRentals !== null) {
    mount.innerHTML = _forecastHtml(_forecastRentals);
    _animateForecast(mount);
    return;
  }
  mount.innerHTML = _forecastLoadingHtml();
  try {
    const res = await getActiveRentals();
    _forecastRentals = res?.rentals || [];
    mount.innerHTML = _forecastHtml(_forecastRentals);
    _animateForecast(mount);
  } catch (e) {
    mount.innerHTML = `<div class="white-card analytics-card-pad analytics-muted">Не удалось загрузить прогноз</div>`;
  }
}

function _animateForecast(container) {
  container.querySelectorAll('.fcst-wk__fill').forEach((fill, i) => {
    const finalH = fill.style.height;
    fill.style.height = '0px';
    fill.style.transition = 'none';
    fill.getBoundingClientRect();
    fill.style.transition = `height 0.45s cubic-bezier(.4,0,.2,1) ${(0.04 + i * 0.04).toFixed(2)}s`;
    fill.style.height = finalH;
  });
  container.querySelectorAll('.fcst-nd').forEach((nd, i) => {
    nd.style.opacity = '0';
    nd.style.transform = 'translateY(8px)';
    nd.style.transition = 'none';
    nd.getBoundingClientRect();
    nd.style.transition = `opacity 0.3s ${(0.3 + i * 0.08).toFixed(2)}s ease, transform 0.3s ${(0.3 + i * 0.08).toFixed(2)}s ease`;
    nd.style.opacity = '1';
    nd.style.transform = 'translateY(0)';
  });
}

function _pagesHtml(dash, emptyMsg, capexMode) {
  const banner =
    emptyMsg && `<div class="analytics-empty-banner">${emptyMsg}</div>`;
  return `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner">
        ${banner || ''}
        ${_overviewHtml(dash)}
      </div>
    </div>
    <div class="analytics-page" data-page="1">
      <div class="analytics-page-inner">
        <div class="section-label">Расходы по статьям</div>
        <div class="white-card analytics-card-pad">
          ${dash.opex?.length ? _opexHtml(dash.opex) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
        ${dash.opex?.length ? _opexDynamicsHtml(dash, dash.opex, dash.opex.reduce((s, r) => s + (Number(r.amount) || 0), 0)) : ''}
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
    </div>
    <div class="analytics-page" data-page="5">
      <div class="analytics-page-inner">
        <div class="section-label">Прогноз поступлений</div>
        <div id="analytics-forecast-mount">${_forecastLoadingHtml()}</div>
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
    const rings = page.querySelectorAll('***REMOVED***opex-donut-svg circle[class]');
    rings.forEach((ring, i) => {
      ring.style.animation = 'none';
      ring.getBoundingClientRect();
      ring.style.animation = '';
      const delay = (0.1 + i * 0.2).toFixed(1);
      ring.style.animation = `donut-draw 1.2s cubic-bezier(.4,0,.2,1) ${delay}s forwards`;
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
  } else if (idx === 5) {
    const root = document.getElementById('analytics-root');
    if (root) void _hydrateForecast(root);
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
    // Загружаем прогноз сразу если открыта вкладка 5, иначе по скроллу
    if (safe === 5) {
      void _hydrateForecast(root);
    } else {
      // Ленивая загрузка — при скролле к вкладке 5
      car.addEventListener('scroll', function _lazyForecast() {
        const w = car.offsetWidth || 1;
        const idx = Math.round(car.scrollLeft / w);
        if (idx === 5) {
          car.removeEventListener('scroll', _lazyForecast);
          void _hydrateForecast(root);
        }
      }, { passive: true });
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   ДЕСКТОП: Command Center layout (≥1024px)
═══════════════════════════════════════════════════════════════ */

const _isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 1024;

function _sparklineSvg(values, color, height) {
  height = height || 48;
  if (!values || !values.length) return '';
  const pts = values.filter(v => v !== null && v !== undefined);
  if (!pts.length) return '';
  const min = Math.min.apply(null, pts);
  const max = Math.max.apply(null, pts);
  const range = max - min || 1;
  const w = 200; const h = height; const pad = 4;
  const coords = pts.map(function(v, i) {
    const x = pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const polyline = coords.join(' ');
  const lx = coords[coords.length-1].split(',')[0];
  const ly = coords[coords.length-1].split(',')[1];
  const fx = coords[0].split(',')[0];
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:' + h + 'px;display:block">'
    + '<polyline points="' + polyline + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<polygon points="' + polyline + ' ' + lx + ',' + h + ' ' + fx + ',' + h + '" fill="' + color + '" opacity="0.10"/>'
    + '<circle cx="' + lx + '" cy="' + ly + '" r="3" fill="' + color + '"/>'
    + '</svg>';
}

function _hbar(pct, color) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  return '<div style="height:6px;background:rgba(0,0,0,.07);border-radius:3px;overflow:hidden;margin-top:5px">'
    + '<div class="dt-hbar-fill" style="width:' + p + '%;background:' + color + ';height:100%;border-radius:3px;transform:scaleX(0);transform-origin:left;animation:dt-hbar .7s cubic-bezier(.4,0,.2,1) forwards"></div>'
    + '</div>';
}

function _miniDonut(slices, size) {
  size = size || 56;
  const total = slices.reduce(function(s,x){ return s + (Number(x.amount)||0); }, 0);
  if (!total) return '<svg width="' + size + '" height="' + size + '"><circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + (size/2-4) + '" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="7"/></svg>';
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const rings = slices.map(function(sl) {
    const pct = (Number(sl.amount)||0) / total;
    const dash = pct * circ;
    const seg = '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="' + sl.color + '" stroke-width="7"'
      + ' stroke-dasharray="' + dash.toFixed(2) + ' ' + (circ-dash).toFixed(2) + '"'
      + ' stroke-dashoffset="' + (-offset).toFixed(2) + '" stroke-linecap="butt"/>';
    offset += dash;
    return seg;
  });
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="transform:rotate(-90deg)">' + rings.join('') + '</svg>';
}

function _dtDelta(key, cur, prev) {
  if (prev === null || prev === undefined) return '';
  const c = Number(cur) || 0; const p = Number(prev) || 0;
  const diff = c - p;
  if (Math.abs(diff) < 1) return '';
  let better = (key === 'revenue' || key === 'profit') ? diff > 0 : diff < 0;
  const color = better ? '***REMOVED***C2501A' : '***REMOVED***B83820';
  const sign = diff > 0 ? '+' : '−';
  return '<span style="font-size:12px;color:' + color + ';font-weight:500">' + sign + fmtRub(Math.abs(diff)) + '</span>';
}

function _monthSeries(ops, key, year, month) {
  const result = [];
  for (let d = -4; d <= 0; d++) {
    const t = new Date(year, month - 1 + d, 1);
    const y = t.getFullYear(); const m = t.getMonth() + 1;
    const sum = ops.reduce(function(acc, op) {
      if (_opClass(op) !== key) return acc;
      const dt = _toOpDate(op);
      if (!dt) return acc;
      if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return acc;
      return acc + (Number(op.amount) || 0);
    }, 0);
    result.push(sum);
  }
  return result;
}

function _desktopShellHTML(dash) {
  const byKey = function(k) { return dash.summary && dash.summary.find(function(s){ return s.key === k; }) || {}; };
  const revenue = Number(byKey('revenue').current) || 0;
  const opex    = Number(byKey('opex').current) || 0;
  const profit  = revenue - opex;
  const capexAll = Number(dash.capexAll) || 0;

  const pills = _pillMonths();
  const pillsHtml = pills.map(function(p) {
    const active = !dash.allTime && dash.year === p.year && dash.month === p.month;
    return '<button type="button" class="dt-pill' + (active ? ' dt-pill--on' : '') + '" data-analytics-pill="1" data-year="' + p.year + '" data-month="' + p.month + '">' + _pillShortLabel(p.year, p.month) + '</button>';
  }).join('');

  const revSeries = _monthSeries(_ops, 'revenue', dash.year, dash.month);

  const opexRows = (dash.opex || []).slice(0, 5);
  const opexTotal = opexRows.reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0) || 1;
  const opexBarsHtml = opexRows.map(function(r) {
    const pct = (Number(r.amount) / opexTotal) * 100;
    return '<div style="margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
      + '<span style="font-size:13px;color:var(--dt-text)">' + r.name + '</span>'
      + '<span style="font-size:13px;font-weight:500;color:var(--dt-text)">' + fmtRub(r.amount) + '</span>'
      + '</div>' + _hbar(pct, getOpexColor(r.name)) + '</div>';
  }).join('');

  const fleet = _cars || [];
  const fRent   = fleet.filter(function(c){ return String(c.status||'').trim() === 'в аренде'; }).length;
  const fRepair = fleet.filter(function(c){ return String(c.status||'').trim() === 'в ремонте'; }).length;
  const fIdle   = fleet.length - fRent - fRepair;
  const fTotal  = Math.max(1, fleet.length);
  const rentPct = Math.round((fRent / fTotal) * 100);

  const capexCatsAll = dash.capexByCategoryAll || [];
  const capexSlices = [
    { color:'***REMOVED***A8845A', amount: capexCatsAll.filter(function(r){ return r.name.toLowerCase().includes('запч'); }).reduce(function(s,r){ return s+(Number(r.amount)||0); }, 0) },
    { color:'***REMOVED***8B5E3C', amount: capexCatsAll.filter(function(r){ return r.name.toLowerCase().includes('ремонт'); }).reduce(function(s,r){ return s+(Number(r.amount)||0); }, 0) },
    { color:'***REMOVED***1A1A1A', amount: capexCatsAll.filter(function(r){ return r.name.toLowerCase().includes('покуп'); }).reduce(function(s,r){ return s+(Number(r.amount)||0); }, 0) },
  ];
  const capexKnown = capexSlices.reduce(function(s,x){ return s+x.amount; }, 0);
  capexSlices.push({ color:'***REMOVED***DDD0BE', amount: Math.max(0, capexAll - capexKnown) });
  const capexLabels = ['Запчасти','Ремонты','Покупки','Прочее'];

  const pnlRows = (dash.pnl || []).slice(0, 6);
  const pnlMax = Math.max(1, Math.max.apply(null, pnlRows.map(function(r){ return Math.abs(Number(r.profit)||0); })));
  const pnlHtml = pnlRows.map(function(r, i) {
    const p = Number(r.profit) || 0;
    const pct = (Math.abs(p) / pnlMax) * 100;
    const color = p > 0 ? '***REMOVED***C2501A' : p < 0 ? '***REMOVED***B83820' : '***REMOVED***8A8A8E';
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      + '<span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0;color:var(--dt-text)">' + r.car + '</span>'
      + '<div style="flex:1;height:18px;background:rgba(0,0,0,.05);border-radius:3px;overflow:hidden;position:relative">'
      + '<div class="dt-hbar-fill" style="position:absolute;top:0;left:0;height:100%;width:' + pct.toFixed(1) + '%;background:' + color + ';border-radius:3px;opacity:.85;transform:scaleX(0);transform-origin:left;animation:dt-hbar .6s cubic-bezier(.4,0,.2,1) ' + (0.05*i).toFixed(2) + 's forwards"></div>'
      + '</div>'
      + '<span style="font-size:12px;font-weight:500;width:72px;text-align:right;color:' + color + ';flex-shrink:0">' + (p>=0?'+':'') + fmtRub(Math.abs(p)) + '</span>'
      + '</div>';
  }).join('');

  // Балансы: сначала из объектов касс (balanceCurrent), фоллбэк — из операций
  const kassaObjMap = new Map((_kassas||[]).map(function(k){
    return [String(k.kassaId||k.касса_id||'').trim(), Number(k.balanceCurrent||k.баланс_текущий)||0];
  }));
  const _calcKassaBal = function(id) {
    if (kassaObjMap.has(id) && kassaObjMap.get(id) !== 0) return kassaObjMap.get(id);
    // fallback: считаем из операций
    return (_ops||[]).reduce(function(acc, op) {
      if (String(op.kassaId||'').trim() !== id) return acc;
      const amt = Number(op.amount)||0;
      return acc + (op.direction === 'приход' ? amt : -amt);
    }, 0);
  };
  const kassaDefs = [
    { id:'K_AZAMAT',   label:'Азамат',   color:'***REMOVED***FFDD2D' },
    { id:'K_VLADIMIR', label:'Владимир', color:'***REMOVED***A8845A' },
    { id:'K_YULIA',    label:'Юлия',     color:'***REMOVED***C2501A' },
  ];
  const kassaRowsHtml = kassaDefs.map(function(k) {
    const bal = _calcKassaBal(k.id);
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06)">'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + k.color + ';flex-shrink:0"></span>'
      + '<span style="font-size:13px;color:var(--dt-text)">' + k.label + '</span>'
      + '</div>'
      + '<span style="font-size:14px;font-weight:600;color:' + (bal>=0?'***REMOVED***C2501A':'***REMOVED***B83820') + '">' + (bal<0?'−':'') + fmtRub(Math.abs(bal)) + '</span>'
      + '</div>';
  }).join('');

  const activeDeposits = (_deposits||[]).filter(function(d){ return String(d.status||'').toLowerCase().includes('актив'); }).reduce(function(s,d){ return s+(Number(d.amount)||0); }, 0);

  return '<style>'
    + ':root{--dt-text:***REMOVED***1A1A1A;--dt-muted:***REMOVED***8A8A8E;--dt-card:***REMOVED***fff;--dt-bg:***REMOVED***F0F1F3;--dt-border:rgba(0,0,0,.08)}'
    + '@media(prefers-color-scheme:dark){:root{--dt-text:***REMOVED***F0F0F0;--dt-muted:***REMOVED***9A9A9E;--dt-card:***REMOVED***1E1E1E;--dt-bg:***REMOVED***111;--dt-border:rgba(255,255,255,.08)}}'
    + '@keyframes dt-hbar{to{transform:scaleX(1)}}'
    + '@keyframes dt-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
    + '@keyframes dt-kpi-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}'
    + '***REMOVED***analytics-root{height:100dvh!important;overflow:hidden!important;padding:0!important;display:flex;flex-direction:column}'+ '.dt-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dt-bg)}'
    + '.dt-hdr{background:***REMOVED***1A1A1A;padding:16px 28px 0;flex-shrink:0}'
    + '.dt-hdr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}'
    + '.dt-title{font-size:18px;font-weight:700;color:***REMOVED***fff;letter-spacing:-.02em}'
    + '.dt-pills{display:flex;gap:6px;align-items:center}'
    + '.dt-pill{font-size:12px;padding:5px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,.2);color:rgba(255,255,255,.55);background:transparent;cursor:pointer;transition:all .15s}'
    + '.dt-pill:hover{color:***REMOVED***fff;border-color:rgba(255,255,255,.4)}'
    + '.dt-pill--on{background:***REMOVED***FFDD2D;color:***REMOVED***1A1A1A!important;border-color:***REMOVED***FFDD2D!important;font-weight:600}'
    + '.dt-hero{display:flex;align-items:flex-end;gap:28px;padding:16px 0 20px;flex-wrap:wrap}'
    + '.dt-hero-main{flex:1;min-width:200px}'
    + '.dt-hero-lbl{font-size:11px;color:rgba(255,255,255,.4);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}'
    + '.dt-hero-num{font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1}'
    + '.dt-hero-sub{font-size:12px;color:rgba(255,255,255,.35);margin-top:5px}'
    + '.dt-kpis{display:flex;gap:10px;flex-wrap:wrap}'
    + '.dt-kpi{background:rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;min-width:110px;animation:dt-kpi-in .4s ease backwards}'
    + '.dt-kpi-lbl{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}'
    + '.dt-kpi-val{font-size:16px;font-weight:600;color:***REMOVED***fff}'
    + '.dt-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px 24px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-content:start}'
    + '.dt-card{background:var(--dt-card);border-radius:14px;padding:18px 20px;border:0.5px solid var(--dt-border);animation:dt-fade-up .4s ease backwards}'
    + '.dt-card-title{font-size:11px;font-weight:600;color:var(--dt-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px}'
    + '.dt-big{font-size:28px;font-weight:700;color:var(--dt-text);letter-spacing:-.02em;line-height:1.1}'
    + '.dt-fleet-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}'
    + '.dt-fleet-tile{border-radius:8px;padding:10px 8px;text-align:center}'
    + '.dt-fleet-tile-n{font-size:22px;font-weight:700}'
    + '.dt-fleet-tile-l{font-size:9px;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;opacity:.75}'
    + '.dt-fleet-bar{height:6px;border-radius:3px;overflow:hidden;display:flex;margin-bottom:6px}'
    + '.dt-fleet-seg{height:100%;transition:width .6s}'
    + '.dt-fleet-pct{font-size:11px;color:var(--dt-muted)}'
    + '@media(max-width:1279px){.dt-body{grid-template-columns:1fr 1fr}}'
    + '</style>'

    + '<div class="dt-root" id="dt-root">'
    + '<div class="dt-hdr">'
    + '<div class="dt-hdr-top"><span class="dt-title">Аналитика</span>'
    + '<div class="dt-pills">' + pillsHtml
    + '<button type="button" class="dt-pill' + (dash.allTime ? ' dt-pill--on' : '') + '" data-analytics-pill-all="1">Всё время</button>'
    + '</div></div>'
    + '<div class="dt-hero">'
    + '<div class="dt-hero-main">'
    + '<div class="dt-hero-lbl">Чистая прибыль · ' + (dash.allTime ? 'всё время' : _monthLabelFull(dash.year, dash.month)) + '</div>'
    + '<div class="dt-hero-num" style="color:' + (profit>=0?'***REMOVED***C2501A':'***REMOVED***B83820') + '">' + (profit>=0?'+':'') + fmtRub(profit) + '</div>'
    + '<div class="dt-hero-sub">Выручка ' + fmtRub(revenue) + ' · Расходы ' + fmtRub(opex) + '</div>'
    + '</div>'
    + '<div class="dt-kpis">'
    + '<div class="dt-kpi" style="animation-delay:.05s"><div class="dt-kpi-lbl">Выручка</div><div class="dt-kpi-val" style="color:***REMOVED***C2501A">' + fmtRub(revenue) + '</div>' + _dtDelta('revenue',revenue,byKey('revenue').previous) + '</div>'
    + '<div class="dt-kpi" style="animation-delay:.1s"><div class="dt-kpi-lbl">Расходы</div><div class="dt-kpi-val" style="color:***REMOVED***B83820">' + fmtRub(opex) + '</div>' + _dtDelta('opex',opex,byKey('opex').previous) + '</div>'
    + '<div class="dt-kpi" style="animation-delay:.15s"><div class="dt-kpi-lbl">CAPEX всего</div><div class="dt-kpi-val" style="color:***REMOVED***A8845A">' + fmtRub(capexAll) + '</div></div>'
    + '<div class="dt-kpi" style="animation-delay:.2s"><div class="dt-kpi-lbl">Загрузка</div><div class="dt-kpi-val" style="color:***REMOVED***60A5FA">' + rentPct + '%</div></div>'
    + '</div></div></div>'

    + '<div class="dt-body" id="dt-body">'

    + '<div class="dt-card" style="animation-delay:.08s">'
    + '<div class="dt-card-title">Расходы по статьям</div>'
    + (opexBarsHtml || '<span style="color:var(--dt-muted);font-size:13px">Нет данных</span>')
    + '<div style="border-top:0.5px solid var(--dt-border);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:baseline">'
    + '<span style="font-size:11px;color:var(--dt-muted)">Итого OPEX</span>'
    + '<span style="font-size:15px;font-weight:700;color:var(--dt-text)">' + fmtRub(opex) + '</span>'
    + '</div></div>'

    + '<div class="dt-card" style="animation-delay:.12s">'
    + '<div class="dt-card-title">Выручка · 5 месяцев</div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">'
    + '<span class="dt-big" style="color:***REMOVED***C2501A">' + fmtRub(revenue) + '</span>'
    + _dtDelta('revenue',revenue,byKey('revenue').previous)
    + '</div>'
    + '<div style="margin-top:10px">' + _sparklineSvg(revSeries,'***REMOVED***C2501A',52) + '</div>'
    + '</div>'

    + '<div class="dt-card" style="animation-delay:.16s">'
    + '<div class="dt-card-title">Парк · ' + fTotal + ' машин</div>'
    + '<div class="dt-fleet-grid">'
    + '<div class="dt-fleet-tile" style="background:***REMOVED***e3f9f0;color:***REMOVED***C2501A"><div class="dt-fleet-tile-n">' + fRent + '</div><div class="dt-fleet-tile-l">Аренда</div></div>'
    + '<div class="dt-fleet-tile" style="background:***REMOVED***fff3e0;color:***REMOVED***A8845A"><div class="dt-fleet-tile-n">' + fIdle + '</div><div class="dt-fleet-tile-l">Простой</div></div>'
    + '<div class="dt-fleet-tile" style="background:***REMOVED***fff0ee;color:***REMOVED***B83820"><div class="dt-fleet-tile-n">' + fRepair + '</div><div class="dt-fleet-tile-l">Ремонт</div></div>'
    + '</div>'
    + '<div class="dt-fleet-bar">'
    + '<div class="dt-fleet-seg" style="width:' + (fRent/fTotal*100).toFixed(1) + '%;background:***REMOVED***C2501A"></div>'
    + '<div class="dt-fleet-seg" style="width:' + (fIdle/fTotal*100).toFixed(1) + '%;background:***REMOVED***A8845A"></div>'
    + '<div class="dt-fleet-seg" style="width:' + (fRepair/fTotal*100).toFixed(1) + '%;background:***REMOVED***B83820"></div>'
    + '</div>'
    + '<div class="dt-fleet-pct">Загрузка ' + rentPct + '%</div>'
    + '</div>'

    + '<div class="dt-card" style="animation-delay:.20s">'
    + '<div class="dt-card-title">P&amp;L по машинам</div>'
    + (pnlHtml || '<span style="color:var(--dt-muted);font-size:13px">Нет данных</span>')
    + '</div>'

    + '<div class="dt-card" style="animation-delay:.24s">'
    + '<div class="dt-card-title">CAPEX</div>'
    + '<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">'
    + _miniDonut(capexSlices, 64)
    + '<div><div class="dt-big">' + fmtRub(capexAll) + '</div><div style="font-size:11px;color:var(--dt-muted);margin-top:3px">всё время</div></div>'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:5px">'
    + capexSlices.map(function(s, i) {
        return '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dt-muted)">'
          + '<span style="width:8px;height:8px;border-radius:2px;background:' + s.color + ';flex-shrink:0"></span>'
          + '<span style="flex:1">' + capexLabels[i] + '</span>'
          + '<span style="color:var(--dt-text);font-weight:500">' + fmtRub(s.amount) + '</span>'
          + '</div>';
      }).join('')
    + '</div></div>'

    + '<div class="dt-card" style="animation-delay:.28s">'
    + '<div class="dt-card-title">Кассы</div>'
    + kassaRowsHtml
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;margin-top:6px">'
    + '<span style="font-size:12px;color:var(--dt-muted)">Активные залоги</span>'
    + '<span style="font-size:14px;font-weight:600;color:***REMOVED***A8845A">' + fmtRub(activeDeposits) + '</span>'
    + '</div></div>'

    + '</div></div>';
}

function _desktopSkeletonHTML() {
  return '<style>'
    + '.dt-root{display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:***REMOVED***F0F1F3}'
    + '.dt-hdr{background:***REMOVED***1A1A1A;padding:16px 28px 20px;flex-shrink:0}'
    + '.dt-body{flex:1;overflow-y:auto;padding:20px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-content:start}'
    + '.dt-card{background:***REMOVED***fff;border-radius:14px;padding:18px 20px;border:0.5px solid rgba(0,0,0,.08)}'
    + '@media(max-width:1279px){.dt-body{grid-template-columns:1fr 1fr}}'
    + '</style>'
    + '<div class="dt-root"><div class="dt-hdr"><div class="skeleton" style="height:16px;border-radius:6px;margin-bottom:8px;width:120px"></div><div class="skeleton" style="height:40px;border-radius:6px;width:200px"></div></div>'
    + '<div class="dt-body">'
    + [0,.06,.12,.18,.24,.28].map(function(d){
        return '<div class="dt-card" style="animation-delay:'+d+'s"><div class="skeleton" style="height:14px;border-radius:4px;margin-bottom:8px;width:80%"></div><div class="skeleton" style="height:28px;border-radius:4px;margin-bottom:8px"></div><div class="skeleton" style="height:80px;border-radius:4px"></div></div>';
      }).join('')
    + '</div></div>';
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
    if (_isDesktop()) {
      root.innerHTML = _desktopShellHTML(dash);
    } else {
      const empty = !_dashboardHasContent(dash);
      root.innerHTML = _successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      _afterShellMounted(root, dash);
    }
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
      root.innerHTML = _isDesktop() ? _desktopSkeletonHTML() : _skeletonShellHTML();
      if (!_isDesktop()) {
        void _mountInlineNavbar(root);
        _bindCarouselScroll(root);
        const car = root.querySelector('***REMOVED***analytics-carousel');
        if (car) _updateCarouselChrome(root, 0);
      }
    }
  }, 0);
}

async function _applyPeriod(year, month) {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _isDesktop() ? _desktopSkeletonHTML() : _skeletonShellHTML();
  if (!_isDesktop()) { _bindCarouselScroll(root); void _mountInlineNavbar(root); }
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
    if (_isDesktop()) {
      root.innerHTML = _desktopShellHTML(dash);
    } else {
      const empty = !_dashboardHasContent(dash);
      root.innerHTML = _successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      _afterShellMounted(root, dash);
    }
  } catch (err) {
    console.error('Analytics _applyPeriod:', err);
    root.innerHTML = _errorShellHTML(err.message === 'NO_CONNECTION');
    await _mountInlineNavbar(root);
  }
}

async function _applyAllTime() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _isDesktop() ? _desktopSkeletonHTML() : _skeletonShellHTML();
  if (!_isDesktop()) { _bindCarouselScroll(root); void _mountInlineNavbar(root); }
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
    if (_isDesktop()) {
      root.innerHTML = _desktopShellHTML(dash);
    } else {
      const empty = !_dashboardHasContent(dash);
      root.innerHTML = _successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      _afterShellMounted(root, dash);
    }
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
    if (_isDesktop()) {
      root.innerHTML = _desktopShellHTML(dash);
    } else {
      root.innerHTML = _successShellHTML(dash, '', _capexMode);
      _afterShellMounted(root, dash);
    }
  }
}

export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (root && !root.dataset.analyticsBound) {
    root.dataset.analyticsBound = '1';
    root.addEventListener('click', _onRootClick);
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-analytics') {
      _forecastRentals = null; // сброс кэша — данные свежие при каждом открытии
      _refreshViewOnly();
    }
  });
}
