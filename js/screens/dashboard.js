/**
 * dashboard.js — дашборд для ролей operations и investor.
 *
 * Данные: getOperations() + getFleet()
 * Финансовая сводка в тёмном хедере; тело — кассы и парк.
 */

import { getOperations, getFleet } from '../api.js';
import { getCurrentUser }          from '../auth.js';
import { parseRuDate }             from './history.js';
import { showScreen }              from '../router.js?v=6';
import { KASSA_ID, KASSA_NAMES, CAR_STATUSES } from '../config.js';

const _now = new Date();
let _month = _now.getMonth() + 1;
let _year  = _now.getFullYear();

let _allOps = [];
let _fleet  = [];

const KASSA_META = {
  [KASSA_ID.AZAMAT]:   { color: 'var(--color-yellow)' },
  [KASSA_ID.VLADIMIR]: { color: 'var(--color-blue)'   },
  [KASSA_ID.YULIA]:    { color: 'var(--color-orange)' },
};

const FLEET_META = [
  { status: CAR_STATUSES.RENT,   label: 'В аренде',   letter: 'А', bg: '***REMOVED***E3F9F0', color: '***REMOVED***00A86B' },
  { status: CAR_STATUSES.IDLE,   label: 'Простой',    letter: 'П', bg: '***REMOVED***F0F1F3', color: '***REMOVED***8A8A8E' },
  { status: CAR_STATUSES.REPAIR, label: 'На ремонте', letter: 'Р', bg: '***REMOVED***FFF3E0', color: '***REMOVED***E08000' },
];

const DASH_BODY_HTML = `
  <div class="section-label">Кассы</div>
  <div class="white-card" id="dashKassaList"></div>
  <div class="section-label" id="dashFleetLabel">Парк</div>
  <div class="white-card" id="dashFleetList"></div>
`;

function _dashboardBodyEl() {
  return document.querySelector('***REMOVED***screen-dashboard .dashboard-body');
}

function _restoreDashboardBody() {
  const b = _dashboardBodyEl();
  if (b && !document.getElementById('dashKassaList')) {
    b.innerHTML = DASH_BODY_HTML;
  }
}

export function initDashboard() {
  const root = document.getElementById('screen-dashboard');
  if (root && !root.dataset.dashClickBound) {
    root.dataset.dashClickBound = '1';
    root.addEventListener('click', e => {
      if (e.target.closest('***REMOVED***dashMonthPrev')) {
        _month--;
        if (_month < 1) { _month = 12; _year--; }
        _refreshMonthUI();
        return;
      }
      if (e.target.closest('***REMOVED***dashMonthNext')) {
        const next = _month === 12 ? { m: 1, y: _year + 1 } : { m: _month + 1, y: _year };
        if (next.y > _now.getFullYear() || (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)) return;
        _month = next.m;
        _year  = next.y;
        _refreshMonthUI();
        return;
      }
      const kRow = e.target.closest('***REMOVED***dashKassaList .dash-kassa');
      if (kRow) {
        document.dispatchEvent(new CustomEvent('history:filter', {
          detail: { kassaId: kRow.dataset.kassa },
        }));
        showScreen('screen-history');
        return;
      }
      const fRow = e.target.closest('***REMOVED***dashFleetList .dash-fleet-row');
      if (fRow) {
        document.dispatchEvent(new CustomEvent('fleet:filter', {
          detail: { status: fRow.dataset.status },
        }));
        showScreen('screen-fleet');
      }
    });
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-dashboard') renderDashboard();
  });
}

export async function renderDashboard() {
  if (!document.getElementById('screen-dashboard')) return;

  _restoreDashboardBody();

  _fillUserHeader();
  _setAmountSkeleton(true);
  const inc = document.getElementById('dashIncome');
  const exp = document.getElementById('dashExpense');
  const prf = document.getElementById('dashProfit');
  if (inc) inc.textContent = '—';
  if (exp) exp.textContent = '—';
  if (prf) prf.textContent = '—';

  const kList = document.getElementById('dashKassaList');
  const fList = document.getElementById('dashFleetList');
  const fLbl  = document.getElementById('dashFleetLabel');
  if (kList) kList.innerHTML = '';
  if (fList) fList.innerHTML = '';
  if (fLbl) fLbl.textContent = 'Парк';

  const monthEl = document.getElementById('dashMonthLabel');
  if (monthEl) monthEl.textContent = _monthLabel();

  const settled = await Promise.allSettled([getOperations(), getFleet()]);
  if (settled[0].status === 'rejected') {
    console.error('Dashboard: getOperations rejected:', settled[0].reason);
  }
  if (settled[1].status === 'rejected') {
    console.error('Dashboard: getFleet rejected:', settled[1].reason);
  }

  if (settled[0].status === 'rejected' || settled[1].status === 'rejected') {
    const firstErr =
      settled[0].status === 'rejected' ? settled[0].reason : settled[1].reason;
    console.error('Dashboard load error:', firstErr);
    _showDashboardError(firstErr?.message === 'NO_CONNECTION');
    return;
  }

  _allOps = settled[0].value;
  _fleet = settled[1].value;

  const data = {
    operationsCount: _allOps?.length,
    fleetCount: _fleet?.length,
  };

  try {
    _restoreDashboardBody();
    document.getElementById('dashKassaList').innerHTML = _kassasHTML();
    document.getElementById('dashFleetList').innerHTML = _fleetHTML();
    document.getElementById('dashFleetLabel').textContent = `Парк · ${_fleet.length} авто`;

    _refreshMonthUI();
  } catch (err) {
    console.error('Dashboard parse/render error:', err);
    console.error('Raw data:', { ...data, fleetSample: _fleet?.slice?.(0, 2) });
    _showDashboardError(false);
  }
}

function _showDashboardError(isNoConn) {
  _setAmountSkeleton(false);
  const ta = document.getElementById('dashTotalAmount');
  if (ta) ta.textContent = '—';
  const body = _dashboardBodyEl();
  if (body) body.innerHTML = _offlineHTML(isNoConn);
  document.getElementById('dash-retry')?.addEventListener('click', renderDashboard);
}

function _fillUserHeader() {
  const user = getCurrentUser();
  const av = document.getElementById('dashAvatar');
  if (av) av.textContent = (user?.name ?? '?')[0].toUpperCase();
}

function _setAmountSkeleton(on) {
  const el = document.getElementById('dashTotalAmount');
  if (!el) return;
  el.innerHTML = on
    ? '<span class="dash-total-skeleton skeleton"></span>'
    : '';
}

function _refreshMonthUI() {
  const ml = document.getElementById('dashMonthLabel');
  if (ml) ml.textContent = _monthLabel();
  _updateHeaderStats();
  _updateNextBtn();
}

function _updateHeaderStats() {
  _setAmountSkeleton(false);

  const monthOps = _allOps.filter(op => {
    const d =
      op.date instanceof Date && !isNaN(op.date.getTime())
        ? op.date
        : parseRuDate(op.dateRaw);
    return (
      d instanceof Date &&
      !isNaN(d.getTime()) &&
      d.getMonth() + 1 === _month &&
      d.getFullYear() === _year
    );
  });

  const kassaBalances = _calcKassaBalances(_allOps);
  const total = Object.values(kassaBalances).reduce((s, v) => s + v, 0);

  let monthIncome = 0;
  let monthExpense = 0;
  monthOps.forEach(op => {
    if (op.direction === 'приход')  monthIncome  += op.amount;
    if (op.direction === 'расход') monthExpense += op.amount;
  });
  const monthNet = monthIncome - monthExpense;

  const ta = document.getElementById('dashTotalAmount');
  if (ta) ta.textContent = formatAmount(total);
  const inc = document.getElementById('dashIncome');
  const exp = document.getElementById('dashExpense');
  const prf = document.getElementById('dashProfit');
  if (inc) inc.textContent = formatAmount(monthIncome);
  if (exp) exp.textContent = formatAmount(monthExpense);
  if (prf) prf.textContent = formatAmount(monthNet);
}

function _updateNextBtn() {
  const btn = document.getElementById('dashMonthNext');
  if (!btn) return;
  const isCurrentMonth = _month === _now.getMonth() + 1 && _year === _now.getFullYear();
  btn.style.opacity       = isCurrentMonth ? '0.35' : '1';
  btn.style.pointerEvents = isCurrentMonth ? 'none' : '';
}

export function formatAmount(n) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('ru-RU')} ₽`;
}

function _kassasHTML() {
  const balances = _calcKassaBalances(_allOps);
  return Object.entries(KASSA_META).map(([kassaId, meta]) => {
    const bal      = balances[kassaId] ?? 0;
    const balClass = bal >= 0 ? 'dash-kassa__bal--pos' : 'dash-kassa__bal--neg';
    const name     = KASSA_NAMES[kassaId] ?? kassaId;
    return `
      <div class="dash-kassa" data-kassa="${kassaId}">
        <span class="dash-kassa__dot" style="background:${meta.color}"></span>
        <span class="dash-kassa__name">${name}</span>
        <span class="dash-kassa__bal ${balClass}">${formatAmount(bal)}</span>
      </div>
    `;
  }).join('');
}

function _fleetHTML() {
  const counts = {};
  _fleet.forEach(c => { counts[c.status] = (counts[c.status] ?? 0) + 1; });

  return FLEET_META.map(m => `
    <div class="dash-fleet-row" data-status="${m.status}">
      <span class="dash-fleet-row__circle" style="background:${m.bg};color:${m.color}">${m.letter}</span>
      <span class="dash-fleet-row__label">${m.label}</span>
      <span class="dash-fleet-row__spacer"></span>
      <span class="dash-fleet-row__count">${counts[m.status] ?? 0}</span>
    </div>
  `).join('');
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="dash-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _calcKassaBalances(ops) {
  const result = {};
  Object.keys(KASSA_META).forEach(id => { result[id] = 0; });
  ops.forEach(op => {
    if (!(op.kassaId in result)) return;
    if (op.direction === 'приход')  result[op.kassaId] += op.amount;
    if (op.direction === 'расход') result[op.kassaId] -= op.amount;
  });
  return result;
}

function _monthLabel() {
  let s = new Date(_year, _month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
  if (!/\sг\.?$/.test(s)) s += ' г.';
  return s;
}
