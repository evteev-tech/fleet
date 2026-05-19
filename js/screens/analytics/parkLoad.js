/**
 * analytics/parkLoad.js — блок «📈 Загрузка парка» + упущенная выручка
 */

import { fmtRub, fmtRuInt } from '../../utils/format.js';
import { USE_MOCK } from '../../config.js';

const LS_EXPANDED = 'fleet_analytics_park_load_expanded';
const LS_DT_LOST_OPEN = 'analytics_lost_open_dt';
const REASON_LABEL = { repair: 'ремонт', idle: 'простой', bonus: 'бонус' };

/** @returns {object|null} */
export function getMockLostRevenue() {
  return {
    period: { from: '01.05.2026', to: '19.05.2026' },
    parkLoad: { totalCarDays: 372, rentDays: 21, rentPct: 5.6 },
    summary: {
      repair: { days: 151, rub: 128350 },
      idle: { days: 15, rub: 12750 },
      bonus: { days: 2, rub: 1700 },
      total: { days: 168, rub: 142800 },
    },
    previous: { summary: { total: { days: 160, rub: 130000 } } },
    byCarSorted: [
      { carId: 'Ларгус', days: 30, rub: 25500, reason: 'repair' },
      { carId: 'А982', days: 15, rub: 12750, reason: 'repair' },
      { carId: 'Н052', days: 13, rub: 11050, reason: 'repair' },
      { carId: 'М001', days: 5, rub: 3500, reason: 'idle' },
      { carId: 'К268', days: 2, rub: 1700, reason: 'bonus' },
    ],
  };
}

function normalizeLostRevenue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normBucket = b => ({
    days: Number(b?.days) || 0,
    rub: Number(b?.rub) || 0,
  });
  const summary = raw.summary || {};
  const byCar = Array.isArray(raw.byCarSorted)
    ? raw.byCarSorted.map(r => ({
        carId: String(r.carId || '').trim(),
        days: Number(r.days) || 0,
        rub: Number(r.rub) || 0,
        reason: String(r.reason || '').trim() || 'repair',
      }))
    : [];
  return {
    period: raw.period || { from: '', to: '' },
    parkLoad: {
      totalCarDays: Number(raw.parkLoad?.totalCarDays) || 0,
      rentDays: Number(raw.parkLoad?.rentDays) || 0,
      rentPct: Number(raw.parkLoad?.rentPct) || 0,
    },
    summary: {
      repair: normBucket(summary.repair),
      idle: normBucket(summary.idle),
      bonus: normBucket(summary.bonus),
      total: normBucket(summary.total),
    },
    byCarSorted: byCar.filter(r => r.carId && r.rub > 0),
    previous:
      raw.previous && typeof raw.previous === 'object'
        ? {
            summary: {
              total: normBucket(raw.previous.summary?.total),
            },
          }
        : null,
  };
}

/** @param {object} lr — normalized lost revenue */
export function prevLostTotalRub(lr) {
  const rub = lr?.previous?.summary?.total?.rub;
  return rub === null || rub === undefined ? null : Number(rub) || 0;
}

export function resolveLostRevenue(dash) {
  if (dash?.lostRevenue) return normalizeLostRevenue(dash.lostRevenue);
  if (USE_MOCK) return getMockLostRevenue();
  return null;
}

export function isParkLoadExpanded() {
  try {
    return localStorage.getItem(LS_EXPANDED) === '1';
  } catch {
    return false;
  }
}

export function setParkLoadExpanded(v) {
  try {
    localStorage.setItem(LS_EXPANDED, v ? '1' : '0');
  } catch {
    /* */
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function lossRowHtml(label, bucket) {
  const d = Number(bucket?.days) || 0;
  const r = Number(bucket?.rub) || 0;
  if (d <= 0 && r <= 0) return '';
  return `<div class="park-load__row">
    <span class="park-load__row-label">${esc(label)}</span>
    <span class="park-load__row-val">${fmtRuInt(d)} дн · ${fmtRub(r)}</span>
  </div>`;
}

/**
 * @param {object} dash
 */
export function renderParkLoadBlock(dash) {
  const lr = resolveLostRevenue(dash);
  if (!lr) return '';

  const pl = lr.parkLoad;
  const s = lr.summary;
  const expanded = isParkLoadExpanded();
  const list = lr.byCarSorted || [];
  const show = expanded ? list : list.slice(0, 10);
  const more = !expanded && list.length > 10 ? list.length - 10 : 0;

  const listHtml =
    expanded && list.length
      ? `<div class="park-load__cars park-load__cars--open">
        ${list
          .map(
            r => `<div class="park-load__car-row">
            <span class="park-load__car-id">${esc(r.carId)}</span>
            <span class="park-load__car-mid">${fmtRuInt(r.days)} дн · ${fmtRub(r.rub)}</span>
            <span class="park-load__car-tag park-load__car-tag--${esc(r.reason)}">${esc(REASON_LABEL[r.reason] || r.reason)}</span>
          </div>`,
          )
          .join('')}
      </div>`
      : '';

  return `
    <div class="white-card overview-tab__card park-load-card">
      <div class="park-load__title">📈 Загрузка парка</div>
      <div class="park-load__row park-load__row--head">
        <span class="park-load__row-label">Всего машино-дней</span>
        <span class="park-load__row-val">${fmtRuInt(pl.totalCarDays)}</span>
      </div>
      <div class="park-load__row">
        <span class="park-load__row-label">В аренде</span>
        <span class="park-load__row-val">${fmtRuInt(pl.rentDays)} <span class="park-load__pct">(${String(pl.rentPct).replace('.', ',')}%)</span></span>
      </div>
      <div class="park-load__divider"></div>
      ${lossRowHtml('В ремонте · упущено', s.repair)}
      ${lossRowHtml('Простой · упущено', s.idle)}
      ${lossRowHtml('Бонусы · упущено', s.bonus)}
      <div class="park-load__divider"></div>
      <div class="park-load__row park-load__row--total">
        <span class="park-load__row-label">Итого упущено</span>
        <span class="park-load__row-val">${fmtRuInt(s.total.days)} дн · ${fmtRub(s.total.rub)}</span>
      </div>
      <button type="button" class="park-load__toggle${expanded ? ' park-load__toggle--open' : ''}" data-park-load-toggle aria-expanded="${expanded ? 'true' : 'false'}">
        <span>Разобрать по машинам</span>
        <i class="ti ti-chevron-down park-load__chevron" aria-hidden="true"></i>
      </button>
      ${listHtml}
      ${more > 0 ? `<div class="park-load__cars-hint">… и ещё ${more} машин (раскройте список)</div>` : ''}
    </div>`;
}

export function bindParkLoadToggle(root) {
  root.querySelectorAll('[data-park-load-toggle]').forEach(btn => {
    if (btn.dataset.parkLoadBound === '1') return;
    btn.dataset.parkLoadBound = '1';
    btn.addEventListener('click', () => {
      setParkLoadExpanded(!isParkLoadExpanded());
      document.dispatchEvent(new CustomEvent('analytics:park-load-toggle'));
    });
  });
}

/** Десктоп: KPI «Упущено», карточка, раскрытие списка машин. */
export function bindDesktopLostInteractions(root) {
  if (!root) return;
  root.querySelectorAll('[data-lost-toggle]').forEach(btn => {
    if (btn.dataset.lostToggleBound === '1') return;
    btn.dataset.lostToggleBound = '1';
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      btn.setAttribute('aria-expanded', next ? 'true' : 'false');
      const list = btn.parentElement?.querySelector('[data-lost-bycar]');
      if (list) list.setAttribute('data-open', next ? '1' : '0');
      try {
        localStorage.setItem(LS_DT_LOST_OPEN, next ? '1' : '0');
      } catch {
        /* */
      }
    });
  });
  root.querySelectorAll('[data-scroll-to="lost"]').forEach(el => {
    if (el.dataset.scrollLostBound === '1') return;
    el.dataset.scrollLostBound = '1';
    el.addEventListener('click', () => {
      root.querySelector('.dt-card--loss')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
