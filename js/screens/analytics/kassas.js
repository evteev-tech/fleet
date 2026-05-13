/**
 * analytics/kassas.js — балансы, оборот по кассам, ожидаемые поступления (14 дн.)
 */

import { analyticsCtx as ctx } from './context.js';
import { fmtRub, parseDate, monthLabelFull } from './utils.js';

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayTs(d) {
  return startOfDay(d).getTime();
}

function toDateMaybe(v) {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const p = parseDate(s);
    return p instanceof Date && !Number.isNaN(p.getTime()) ? p : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRentalRecord(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    rentalId: String(r.rentalId ?? r.rental_id ?? '').trim(),
    carId: String(r.carId ?? r.car_id ?? '').trim(),
    driverId: String(r.driverId ?? r.driver_id ?? '').trim(),
    dateStart: toDateMaybe(r.dateStart ?? r.date_start),
    dateEnd: toDateMaybe(r.dateEnd ?? r.date_end),
    rateDay: Number(r.rateDay ?? r.rate_day) || 0,
    note: r.note,
  };
}

function rentalsEligibleForCashflow(rentals, now = new Date()) {
  const tToday = dayTs(startOfDay(now));
  return (rentals || [])
    .map(normalizeRentalRecord)
    .filter(Boolean)
    .filter(r => {
      if ((Number(r.rateDay) || 0) <= 0) return false;
      if (!r.dateStart) return false;
      const de = r.dateEnd;
      if (!de) return true;
      return dayTs(de) >= tToday;
    });
}

function rentalCoversCalendarDay(r, day) {
  if (!r.dateStart) return false;
  const t = dayTs(day);
  if (t < dayTs(r.dateStart)) return false;
  if (r.dateEnd && t > dayTs(r.dateEnd)) return false;
  return true;
}

function formatDayMonthRu(d) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function pluralCars(n) {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  if (k > 10 && k < 20) return 'машин';
  if (d === 1) return 'машина';
  if (d >= 2 && d <= 4) return 'машины';
  return 'машин';
}

function buildIncoming14FromRentals(rentals, now = new Date()) {
  const raw = rentals || [];
  const eligible = rentalsEligibleForCashflow(raw, now);
  const base = startOfDay(now);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    let sum = 0;
    const cars = new Set();
    eligible.forEach(r => {
      if (!rentalCoversCalendarDay(r, date)) return;
      const rate = Number(r.rateDay) || 0;
      if (rate <= 0) return;
      sum += rate;
      const cid = String(r.carId || '').trim();
      if (cid) cars.add(cid);
    });
    days.push({ date, sum, carIds: cars });
  }
  const total = days.reduce((s, x) => s + x.sum, 0);
  const unionCars = new Set();
  days.forEach(d => d.carIds.forEach(id => unionCars.add(id)));
  const carN = unionCars.size;
  const paid = days.filter(d => d.sum > 0);
  const cards = [];
  for (let i = 0; i < 3; i++) {
    if (paid[i]) cards.push(paid[i]);
    else cards.push(days[i]);
  }
  return {
    days,
    total,
    carN,
    cards,
    labelStart: formatDayMonthRu(days[0].date),
    labelEnd: formatDayMonthRu(days[13].date),
  };
}

function incomingExpectedHtml(rentals) {
  const data = buildIncoming14FromRentals(rentals || []);
  const badge = data.carN > 0 ? `${data.carN} ${pluralCars(data.carN)}` : 'нет активных';
  const segs = data.days
    .map(
      d => `
    <div class="fcst2-cash__seg${d.sum > 0 ? ' fcst2-cash__seg--paid' : ''}" title="${formatDayMonthRu(d.date)} · ${fmtRub(d.sum)}"></div>`,
    )
    .join('');
  const cardsHtml = data.cards
    .map(d => {
      const has = d.sum > 0;
      const cls = has ? 'fcst2-cash__card-val fcst2-cash__card-val--pos' : 'fcst2-cash__card-val fcst2-cash__card-val--muted';
      return `<div class="fcst2-cash__card"><div class="fcst2-cash__card-d">${formatDayMonthRu(d.date)}</div><div class="${cls}">${has ? fmtRub(d.sum) : '—'}</div></div>`;
    })
    .join('');
  return `
  <div class="white-card analytics-card-pad fcst2-card fcst2-cash">
    <div class="fcst2-cash__kicker">Ожидаемые поступления</div>
    <div class="fcst2-cash__hero">
      <div class="fcst2-cash__hero-line">
        <span class="fcst2-cash__hero-amt">${fmtRub(data.total)}</span>
        <span class="fcst2-cash__hero-period">за 14 дней</span>
      </div>
      <span class="fcst2-cash__badge">${badge}</span>
    </div>
    <div class="fcst2-cash__strip-wrap" aria-hidden="true">
      <div class="fcst2-cash__strip">${segs}</div>
      <div class="fcst2-cash__strip-lbl"><span>${data.labelStart}</span><span>${data.labelEnd}</span></div>
    </div>
    <div class="fcst2-cash__cards">${cardsHtml}</div>
  </div>`;
}

const KASSA_TURNOVER_LABELS = {
  K_AZAMAT: 'Azamat',
  K_VLADIMIR: 'Vladimir',
  K_YULIA: 'Yulia',
};

function kassaTurnoverDisplayName(id) {
  const k = String(id || '').trim();
  if (KASSA_TURNOVER_LABELS[k]) return KASSA_TURNOVER_LABELS[k];
  return k.replace(/^K_/i, '') || k;
}

function kassaTurnoverDotStyle(id) {
  const k = String(id || '');
  if (k === 'K_AZAMAT') return 'background:#EAB308';
  if (k === 'K_VLADIMIR') return 'background:#378ADD';
  if (k === 'K_YULIA') return 'background:#1D9E75';
  return 'background:var(--color-text-secondary, #8a8a8e)';
}

function buildKassaTurnoverHtml(dash) {
  const rows = [...(dash.kassaTurnover || [])].sort(
    (a, b) => b.inflow + b.outflow - (a.inflow + a.outflow),
  );
  const sub =
    dash.allTime === true
      ? 'всё время'
      : `${monthLabelFull(Number(dash.year), Number(dash.month))} ${Number(dash.year)}`;

  const rowHtml = rows
    .map((r, idx) => {
      const inf = Number(r.inflow) || 0;
      const out = Number(r.outflow) || 0;
      const tot = inf + out;
      const delay = `${idx * 55}ms`;
      if (tot <= 0) {
        return `
    <div class="kassa-turnover__row">
      <div class="kassa-turnover__head">
        <span class="kassa-turnover__dot" style="${kassaTurnoverDotStyle(r.kassaId)}"></span>
        <span class="kassa-turnover__name">${kassaTurnoverDisplayName(r.kassaId)}</span>
        <span class="kassa-turnover__nums">+${fmtRub(inf)} \u2193${fmtRub(out)}</span>
      </div>
      <div class="kassa-turnover__empty">оборота не было</div>
    </div>`;
      }
      return `
    <div class="kassa-turnover__row">
      <div class="kassa-turnover__head">
        <span class="kassa-turnover__dot" style="${kassaTurnoverDotStyle(r.kassaId)}"></span>
        <span class="kassa-turnover__name">${kassaTurnoverDisplayName(r.kassaId)}</span>
        <span class="kassa-turnover__nums">+${fmtRub(inf)} \u2193${fmtRub(out)}</span>
      </div>
      <div class="kassa-turnover__track" aria-hidden="true">
        <span class="kassa-turnover__seg kassa-turnover__seg--in" style="flex:${inf};--kassa-turnover-delay:${delay}"></span>
        <span class="kassa-turnover__seg kassa-turnover__seg--out" style="flex:${out};--kassa-turnover-delay:${delay}"></span>
      </div>
    </div>`;
    })
    .join('');

  return `
  <div class="white-card analytics-card-pad kassa-turnover-card">
    <div class="kassa-turnover__kicker">Оборот по кассам</div>
    <div class="kassa-turnover__sub">${sub}</div>
    <div class="kassa-turnover__list">${rowHtml || '<div class="kassa-turnover__empty">Нет данных за период</div>'}</div>
  </div>`;
}

/**
 * После появления вкладки «Кассы» — анимация полос оборота.
 * @param {HTMLElement} pageEl — .analytics-page[data-page="4"]
 */
export function revealKassasAnimations(pageEl) {
  const root = pageEl?.querySelector?.('.analytics-kassas-tab');
  if (!root) return;
  requestAnimationFrame(() => {
    root.classList.add('analytics-kassas-tab--inview');
  });
}

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

  const balancesCard = `<div class="white-card analytics-card-pad">${body}${depositRow}</div>`;
  const turnoverCard = buildKassaTurnoverHtml(dash);
  const incomingCard = incomingExpectedHtml(ctx.rentals);

  return `<div class="analytics-kassas-tab">${balancesCard}${turnoverCard}${incomingCard}</div>`;
}
