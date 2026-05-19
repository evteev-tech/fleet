import { getOperations, getFleet, getDrivers, getRentals, saveRentalPromise, saveBonusDays } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js';
import { showToast } from '../ui.js';
import { CAR_STATUSES, KASSA_ID, ROLES, USE_MOCK } from '../config.js';
import { calcPaidUntil, parseRatePerDay, latestRentalByCarMap } from '../utils/rent.js';
import { parseRuDate } from './history.js';
import { fmtRuInt } from '../utils/format.js';
import { filterOpsForHistoryUI } from '../utils/ops.js';

const HOME_KASSA_ORDER = [KASSA_ID.AZAMAT, KASSA_ID.VLADIMIR, KASSA_ID.YULIA];

const PROMISE_PRESETS = [
  { id: 'today_evening', label: 'сегодня вечером', days: 0 },
  { id: 'tomorrow_morning', label: 'завтра утром', days: 1 },
  { id: 'in_2_days', label: 'через 2 дня', days: 2 },
  { id: 'in_3_days', label: 'через 3 дня', days: 3 },
];

const BONUS_PRESETS = [
  { label: '+1', days: 1 },
  { label: '+2', days: 2 },
  { label: '+3', days: 3 },
  { label: 'другое', days: 'custom' },
];

const BONUS_REASONS = [
  { value: 'ремонт', label: 'Причина: ремонт' },
  { value: 'ТО', label: 'Причина: ТО' },
  { value: 'прочее', label: 'Причина: прочее' },
];

/** Последний успешный paint главной — для точечного обновления после бонуса */
let _lastHomePaint = null;

const _sessionState = {
  promisedByCar: new Map(),
  paidByCar: new Map(),
  expandedCarId: null,
  /** @type {Map<string, { days: number, reason: string, customMode?: boolean }>} */
  bonusDraftByCar: new Map(),
  /** @type {Set<string>} */
  bonusExpandedByCar: new Set(),
  /** @type {Set<string>} */
  bonusSavingByCar: new Set(),
  /** @type {Map<string, number>} */
  bonusConfirmBlockUntil: new Map(),
};

export function initHome() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-home') void renderHome();
  });

  document.addEventListener('payment:accepted', e => {
    const p = e.detail || {};
    if (!p.carId) return;
    _sessionState.paidByCar.set(p.carId, {
      ...p,
      acceptedAt:
        p.acceptedAt instanceof Date ? p.acceptedAt : new Date(p.acceptedAt || Date.now()),
    });
    _sessionState.promisedByCar.delete(p.carId);
    _sessionState.expandedCarId = null;
  });
}

export function renderHome() {
  const body = document.getElementById('home-body');
  if (!body) return;
  body.innerHTML = '<div class="income-loading">Загрузка…</div>';

  let ops = null;
  let cars = null;
  let drivers = null;
  let rentalsLoaded = false;
  let rentalRows = [];

  const paint = () => {
    if (!ops || !cars || !drivers || !rentalsLoaded) return;
    _render(body, filterOpsForHistoryUI(ops), cars, drivers, rentalRows);
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => { ops = d; paint(); },
    onFresh: d => { ops = d; paint(); },
    onFetchError: () => { ops = []; paint(); },
  });
  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => { cars = d; paint(); },
    onFresh: d => { cars = d; paint(); },
    onFetchError: () => { cars = []; paint(); },
  });
  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => { drivers = d; paint(); },
    onFresh: d => { drivers = d; paint(); },
    onFetchError: () => { drivers = []; paint(); },
  });
  getWithSWR(CACHE_KEYS.RENTALS, () => getRentals(), {
    onCached: d => {
      rentalRows = d;
      rentalsLoaded = true;
      paint();
    },
    onFresh: d => {
      rentalRows = d;
      rentalsLoaded = true;
      paint();
    },
    onFetchError: () => {
      rentalRows = [];
      rentalsLoaded = true;
      paint();
    },
  });
}

/** Роль с бэка: без учёта регистра и пробелов */
function _roleNorm(role) {
  return String(role ?? '')
    .trim()
    .toLowerCase();
}

function _isPaymentsReadOnly(user) {
  const r = _roleNorm(user?.role);
  return r === ROLES.OPERATIONS || r === ROLES.INVESTOR;
}

/** Главная со сводкой как дашборд: operations / investor (если когда-либо попадут на home) */
function _isOpsFinanceHome(user) {
  const r = _roleNorm(user?.role);
  return r === ROLES.OPERATIONS || r === ROLES.INVESTOR;
}

function _calcKassaBalancesFromOps(ops) {
  const result = /** @type {Record<string, number>} */ ({});
  HOME_KASSA_ORDER.forEach(id => {
    result[id] = 0;
  });
  ops.forEach(op => {
    const kid = String(op.kassaId ?? '').trim();
    if (!(kid in result)) return;
    if (op.direction === 'приход') result[kid] += Number(op.amount) || 0;
    if (op.direction === 'расход') result[kid] -= Number(op.amount) || 0;
  });
  return result;
}

function _opDateResolved(op) {
  if (op.date instanceof Date && !Number.isNaN(op.date.getTime())) return op.date;
  return parseRuDate(op.dateRaw);
}

function _opsInCalendarMonth(ops, month, year) {
  return ops.filter(op => {
    const d = _opDateResolved(op);
    return (
      d instanceof Date &&
      !Number.isNaN(d.getTime()) &&
      d.getMonth() + 1 === month &&
      d.getFullYear() === year
    );
  });
}

function _formatSignedAmt(n) {
  const rounded = Math.round(Number(n) || 0);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${fmtRuInt(Math.abs(rounded))} ₽`;
}

/** То же, но ₽ как на кассе Азамата — <span class="rub">. */
function _formatSignedAmtHTML(n) {
  const rounded = Math.round(Number(n) || 0);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${fmtRuInt(Math.abs(rounded))}<span class="rub">₽</span>`;
}

function _operationsCashSummaryHtml(allOps) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthOps = _opsInCalendarMonth(allOps, month, year);
  let monthIncome = 0;
  let monthExpense = 0;
  monthOps.forEach(op => {
    if (op.direction === 'приход') monthIncome += Number(op.amount) || 0;
    if (op.direction === 'расход') monthExpense += Number(op.amount) || 0;
  });
  const monthNet = monthIncome - monthExpense;
  const bals = _calcKassaBalancesFromOps(allOps);
  const total = HOME_KASSA_ORDER.reduce((s, id) => s + (bals[id] ?? 0), 0);
  const monthTitle = new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long' })
    .replace(/^./, c => c.toUpperCase());

  return `
    <div class="home-cash-card home-cash-card--ops-overview">
      <div class="home-ops-fin__label">ИТОГО В КАССАХ</div>
      <div class="home-ops-fin__total">${_formatSignedAmtHTML(total)}</div>
      <div class="home-ops-fin__subtitle">За ${monthTitle} ${year} г.</div>
      <div class="home-ops-fin__tiles">
        <div class="home-ops-fin__tile">
          <div class="home-ops-fin__tile-val home-ops-fin__tile-val--inc">${_formatSignedAmt(monthIncome)}</div>
          <div class="home-ops-fin__tile-lbl">Доходы</div>
        </div>
        <div class="home-ops-fin__tile">
          <div class="home-ops-fin__tile-val home-ops-fin__tile-val--exp">${_formatSignedAmt(monthExpense)}</div>
          <div class="home-ops-fin__tile-lbl">Расходы</div>
        </div>
        <div class="home-ops-fin__tile">
          <div class="home-ops-fin__tile-val home-ops-fin__tile-val--net">${_formatSignedAmt(monthNet)}</div>
          <div class="home-ops-fin__tile-lbl">Чистыми</div>
        </div>
      </div>
    </div>
  `;
}

function _render(body, allOps, fleet, drivers, rentalRows) {
  _lastHomePaint = { body, allOps, fleet, drivers, rentalRows };
  const user = getCurrentUser();
  const firstName = String(user?.name || 'Азамат').split(' ')[0];
  const isOpsFinance = _isOpsFinanceHome(user);
  const isReadOnlyPayments = _isPaymentsReadOnly(user);

  const kassaId = _roleNorm(user?.role) === ROLES.OPERATIONS
    ? KASSA_ID.VLADIMIR
    : KASSA_ID.AZAMAT;
  const kassaOps = allOps.filter(op => String(op.kassaId || '').trim() === kassaId);
  const balance = _calcBalance(kassaOps);
  const deltaToday = _calcDeltaToday(kassaOps);

  const cashPrimaryHtml = isOpsFinance
    ? _operationsCashSummaryHtml(allOps)
    : `<div class="home-cash-card">
        <div class="home-cash-card__label">${_roleNorm(user?.role) === ROLES.OPERATIONS ? 'КАССА ВЛАДИМИРА' : 'КАССА АЗАМАТА'}</div>
        <div class="home-cash-card__amount">${_fmtInt(balance)}<span class="rub">₽</span></div>
        <div class="home-cash-card__delta ${deltaToday >= 0 ? 'is-pos' : 'is-neg'}">${deltaToday >= 0 ? '+' : '−'}${_fmtInt(Math.abs(deltaToday))}<span class="rub">₽</span> сегодня</div>
      </div>`;
  const rentCars = fleet.filter(c => _bucketStatus(c.status) === 'rent');
  const latestByCar = latestRentalByCarMap(rentalRows || []);
  const allTasks = _buildTasks(allOps, rentCars, drivers, latestByCar);
  const taskViewTasks = allTasks.tasks.filter(_isTaskVisibleInPayments);
  const dueSoon = _buildDueSoonRows(allOps, rentCars, drivers, rentalRows);
  const park = _parkStats(fleet);

  const counters = {
    red: taskViewTasks.filter(t => t.status === 'overdue' || t.status === 'broke_promise').length,
    purple: taskViewTasks.filter(t => t.status === 'promised').length,
    orange: taskViewTasks.filter(t => t.status === 'warning').length,
  };

  body.innerHTML = `
    ${USE_MOCK ? '<div class="mock-banner" role="status">🧪 Mock-режим · живые данные отключены</div>' : ''}
    <div class="home-header">
      <div class="home-hdr__brand-row">
        <span class="home-hdr__logo">Матизы</span>
        <div class="home-hdr__avatar">${_esc(firstName[0] || 'А')}</div>
      </div>
      ${cashPrimaryHtml}
      <div class="home-action-row home-action-row--3">
        <button id="home-btn-income" class="btn-primary">＋ Платёж</button>
        <button id="home-btn-expense" class="btn-secondary">− Расход</button>
        <button id="home-btn-transfer" class="btn-secondary">⇄&nbsp;Перевод</button>
      </div>
    </div>
    <div class="home-content-sheet">
      <div class="home-block-title">
        <span>ОПЛАТЫ</span>
        <div class="home-pill-counters">${_counterPillsHtml(counters)}</div>
      </div>
      <div id="home-task-list">${taskViewTasks.map(t => _paymentTaskCardHtml(t, isReadOnlyPayments)).join('') || '<div class="empty-state"><div class="empty-state__text">Нет задач по оплатам</div></div>'}</div>

      <div class="home-block-title"><span>БЛИЖАЙШИЕ 3 ДНЯ</span></div>
      <div class="white-card home-due-list">${dueSoon.map(_dueRowHtml).join('') || '<div class="card-row">Пусто</div>'}</div>

      <div class="home-block-title"><span>ПАРК</span></div>
      <div class="white-card home-park-card">
        <div class="home-park-head"><span>Здоровье парка</span><strong>${fleet.length} машин</strong></div>
        <div class="home-park-bar" id="home-park-bar" role="button" tabindex="0" aria-label="Открыть парк">
          <button type="button" class="home-park-seg" data-park-status="rent" aria-label="В аренде"
            style="width:${park.rentPct}%;background:var(--c-rent)"></button>
          <button type="button" class="home-park-seg" data-park-status="idle" aria-label="Простой"
            style="width:${park.idlePct}%;background:var(--c-idle)"></button>
          <button type="button" class="home-park-seg" data-park-status="repair" aria-label="В ремонте"
            style="width:${park.repairPct}%;background:var(--c-repair)"></button>
        </div>
        <div class="home-park-legend">
          <button type="button" class="home-park-legend-btn" data-park-status="rent" aria-label="Парк: в аренде">
            <strong style="color:var(--c-rent)">${park.rent}</strong><span>Аренда</span>
          </button>
          <button type="button" class="home-park-legend-btn" data-park-status="idle" aria-label="Парк: простой">
            <strong style="color:var(--c-idle)">${park.idle}</strong><span>Простой</span>
          </button>
          <button type="button" class="home-park-legend-btn" data-park-status="repair" aria-label="Парк: ремонт">
            <strong style="color:var(--c-repair)">${park.repair}</strong><span>Ремонт</span>
          </button>
        </div>
      </div>
    </div>
  `;

  body.querySelector('#home-btn-income')?.addEventListener('click', () => showScreen('screen-income'));
  body.querySelector('#home-btn-expense')?.addEventListener('click', () => showScreen('screen-expense'));
  body.querySelector('#home-btn-transfer')?.addEventListener('click', () => showScreen('screen-transfer'));

  const openPark = statusKey => {
    const st =
      statusKey === 'rent' ? CAR_STATUSES.RENT :
      statusKey === 'idle' ? CAR_STATUSES.IDLE :
      statusKey === 'repair' ? CAR_STATUSES.REPAIR :
      null;
    if (st) {
      document.dispatchEvent(new CustomEvent('fleet:filter', { detail: { status: st } }));
    }
    showScreen('screen-fleet');
  };

  body.querySelector('#home-park-bar')?.addEventListener('click', e => {
    const seg = /** @type {HTMLElement} */ (e.target).closest('[data-park-status]');
    openPark(seg?.dataset.parkStatus || 'all');
  });
  body.querySelector('#home-park-bar')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') openPark('all');
  });
  body.querySelectorAll('.home-park-legend-btn[data-park-status]').forEach(btn => {
    btn.addEventListener('click', () => openPark(btn.dataset.parkStatus));
  });

  body.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', ev => _onTaskClick(ev, taskViewTasks, isReadOnlyPayments));
  });
  body.querySelectorAll('[data-promise]').forEach(el => {
    el.addEventListener('click', ev => _applyPromise(ev, body, taskViewTasks));
  });
  body.querySelectorAll('[data-bonus-toggle]').forEach(el => {
    el.addEventListener('click', ev => _onBonusToggleClick(ev));
  });
  body.querySelectorAll('.payment-task-card__bonus-shortcut').forEach(el => {
    el.addEventListener('click', ev => _onBonusPresetClick(ev));
  });
  body.querySelectorAll('.payment-task-card__bonus-reason').forEach(el => {
    el.addEventListener('change', ev => _onBonusReasonChange(ev));
    el.addEventListener('click', ev => _onBonusReasonInteract(ev));
    el.addEventListener('mousedown', ev => _onBonusReasonInteract(ev));
  });
  body.querySelectorAll('.payment-task-card__bonus-custom-input').forEach(el => {
    el.addEventListener('input', ev => _onBonusCustomInput(ev));
    el.addEventListener('click', ev => ev.stopPropagation());
  });
  body.querySelectorAll('.payment-task-card__bonus-confirm').forEach(el => {
    el.addEventListener('mousedown', ev => ev.stopPropagation());
    el.addEventListener('click', ev => _confirmBonus(ev));
  });
}

async function _refreshHomeAfterBonusSave(carId) {
  const cid = String(carId || '').trim();
  _sessionState.expandedCarId = null;
  _sessionState.bonusExpandedByCar.delete(cid);
  _sessionState.bonusDraftByCar.delete(cid);

  const ctx = _lastHomePaint;
  if (!ctx?.body?.isConnected) {
    void renderHome();
    return;
  }

  try {
    const rentalRows = await getRentals();
    _lastHomePaint = { ...ctx, rentalRows };
    _render(ctx.body, ctx.allOps, ctx.fleet, ctx.drivers, rentalRows);
  } catch {
    void renderHome();
  }
}

function _onTaskClick(event, tasks, isReadOnlyPayments) {
  const card = event.currentTarget;
  const carId = card?.dataset.taskId;
  if (!carId) return;
  const task = tasks.find(t => t.carId === carId);
  if (!task) return;

  if (event.target.closest('[data-open-payment]')) {
    if (isReadOnlyPayments) return;
    showScreen('screen-income', { paymentContext: task });
    return;
  }
  if (event.target.closest('[data-bonus-toggle]')) return;
  if (event.target.closest('.payment-task-card__bonus-section')) {
    event.stopPropagation();
    return;
  }
  if (event.target.closest('.payment-task-card__promise-section')) {
    event.stopPropagation();
    return;
  }
  if (task.status === 'paid') return;

  _sessionState.expandedCarId = _sessionState.expandedCarId === carId ? null : carId;
  void renderHome();
}

function _applyPromise(event, _body, _tasks) {
  if (_isPaymentsReadOnly(getCurrentUser())) return;

  event.stopPropagation();
  const btn = event.currentTarget;
  const carId = btn?.dataset.carId;
  const days = Number(btn?.dataset.promise || 0);
  if (!carId) return;
  const promisedUntil = _addDays(_todayStart(), days);
  _sessionState.promisedByCar.set(carId, promisedUntil);
  _sessionState.expandedCarId = null;
  void renderHome();
  void saveRentalPromise(carId, promisedUntil).catch(e => {
    console.error('Не удалось сохранить обещание:', e);
  });
}

function _bonusDraftForCar(carId) {
  const cid = String(carId || '').trim();
  let d = _sessionState.bonusDraftByCar.get(cid);
  if (!d) {
    d = { days: 1, reason: BONUS_REASONS[0].value, customMode: false };
    _sessionState.bonusDraftByCar.set(cid, d);
  }
  return d;
}

function _isBonusPanelExpanded(carId) {
  return _sessionState.bonusExpandedByCar.has(String(carId || '').trim());
}

function _blockBonusConfirmMs(carId, ms = 450) {
  const cid = String(carId || '').trim();
  if (!cid) return;
  _sessionState.bonusConfirmBlockUntil.set(cid, Date.now() + ms);
}

function _isBonusConfirmBlocked(carId) {
  const until = _sessionState.bonusConfirmBlockUntil.get(String(carId || '').trim());
  return until != null && until > Date.now();
}

function _onBonusToggleClick(event) {
  if (_isPaymentsReadOnly(getCurrentUser())) return;
  event.stopPropagation();
  const btn = event.currentTarget;
  const carId = btn?.dataset.carId;
  if (!carId) return;
  const cid = String(carId).trim();
  if (_sessionState.bonusExpandedByCar.has(cid)) {
    _sessionState.bonusExpandedByCar.delete(cid);
  } else {
    _sessionState.bonusExpandedByCar.add(cid);
  }
  void renderHome();
}

function _onBonusPresetClick(event) {
  if (_isPaymentsReadOnly(getCurrentUser())) return;
  event.stopPropagation();
  const btn = event.currentTarget;
  const carId = btn?.dataset.carId;
  const raw = btn?.dataset.bonus;
  if (!carId || raw == null) return;
  const draft = _bonusDraftForCar(carId);
  if (raw === 'custom') {
    draft.customMode = true;
    if (!Number.isInteger(draft.days) || draft.days <= 0) draft.days = 5;
  } else {
    draft.customMode = false;
    draft.days = Number(raw) || 1;
  }
  void renderHome();
}

function _onBonusReasonInteract(event) {
  event.stopPropagation();
  const carId = event.currentTarget?.dataset.carId;
  if (carId) _blockBonusConfirmMs(carId);
}

function _onBonusReasonChange(event) {
  event.stopPropagation();
  const sel = event.currentTarget;
  const carId = sel?.dataset.carId;
  if (!carId) return;
  _bonusDraftForCar(carId).reason = String(sel.value || '');
  _blockBonusConfirmMs(carId);
}

function _onBonusCustomInput(event) {
  event.stopPropagation();
  const inp = event.currentTarget;
  const carId = inp?.dataset.carId;
  if (!carId) return;
  const n = parseInt(String(inp.value || ''), 10);
  const draft = _bonusDraftForCar(carId);
  if (Number.isInteger(n) && n > 0) draft.days = n;
}

function _confirmBonus(event) {
  if (_isPaymentsReadOnly(getCurrentUser())) return;
  event.preventDefault();
  event.stopPropagation();

  const btn = event.target.closest('.payment-task-card__bonus-confirm');
  if (!btn || btn.disabled) return;

  const carId = btn.dataset.carId;
  if (!carId) return;
  const cid = String(carId).trim();
  if (_isBonusConfirmBlocked(cid)) return;
  if (_sessionState.bonusSavingByCar.has(cid)) return;

  const draft = _bonusDraftForCar(cid);
  const days = Number(draft.days);
  if (!Number.isInteger(days) || days <= 0) return;
  const reason = String(draft.reason || BONUS_REASONS[0].value);

  _sessionState.bonusSavingByCar.add(cid);
  btn.disabled = true;

  void (async () => {
    try {
      await saveBonusDays(cid, days, reason);
    } catch (e) {
      const msg =
        e?.message === 'NO_CONNECTION'
          ? 'Нет соединения'
          : 'Не удалось сохранить бонусные дни';
      showToast(msg, 'error');
      console.error('Не удалось сохранить бонусные дни:', e);
      _sessionState.expandedCarId = cid;
      _sessionState.bonusExpandedByCar.add(cid);
      void renderHome();
      return;
    } finally {
      _sessionState.bonusSavingByCar.delete(cid);
    }

    try {
      await _refreshHomeAfterBonusSave(cid);
    } catch (e) {
      console.error('Не удалось обновить главную после бонуса:', e);
      void renderHome();
    }
  })();
}

function _bonusDaysLabel(n) {
  const x = Math.abs(Number(n) || 0);
  if (x % 10 === 1 && x % 100 !== 11) return 'день';
  if (x % 10 >= 2 && x % 10 <= 4 && (x % 100 < 10 || x % 100 >= 20)) return 'дня';
  return 'дней';
}

/** В секции «Оплаты»: срок сегодня/просрочка, завтра (warning), обещание или оплачено в сессии */
function _isTaskVisibleInPayments(t) {
  if (t.status === 'paid') return true;
  if (t.status === 'promised') return true;
  if (t.paidUntil == null || t.overdue === null) return false;
  if (t.overdue >= 0) return true;
  if (t.overdue === -1) return true;
  return false;
}

function _sameCalendarDay(d, refDayStart) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(x.getTime())) return false;
  x.setHours(0, 0, 0, 0);
  return x.getTime() === refDayStart.getTime();
}

function _paidAcceptedToday(paidInfo, todayStart) {
  if (!paidInfo?.acceptedAt) return false;
  const at =
    paidInfo.acceptedAt instanceof Date ? paidInfo.acceptedAt : new Date(paidInfo.acceptedAt);
  return _sameCalendarDay(at, todayStart);
}

/**
 * Статус задачи оплаты (как resolveTaskStatus для rental):
 * diffDays(today, paid_until): &gt; 0 — просрочка оплаты по аренде.
 */
function _resolveTaskStatus({ paidInfo, paidUntil, promiseDate }) {
  if (paidInfo) return 'paid';
  const today = _todayStart();
  const daysOverdue =
    paidUntil != null ? _daysDiff(today, paidUntil) : null;
  const hasPromise = !!promiseDate;
  const promiseBroke = hasPromise && _daysDiff(today, promiseDate) > 0;

  if (promiseBroke) return 'broke_promise';
  if (hasPromise) return 'promised';
  if (daysOverdue !== null && daysOverdue >= 0) return 'overdue';
  if (daysOverdue === -1) return 'warning';
  return 'neutral';
}

function _buildTasks(ops, rentCars, drivers, latestByCar) {
  const byCarDriver = new Map();
  drivers.forEach(d => {
    if (d.currentCar) byCarDriver.set(String(d.currentCar).trim(), d);
  });
  const rentOps = ops
    .filter(op => op.type === 'аренда' && op.direction === 'приход')
    .sort((a, b) => _toDate(b)?.getTime() - _toDate(a)?.getTime());

  const tasks = rentCars.map(car => {
    const carId = String(car.carId || '').trim();
    const driver = byCarDriver.get(carId);
    const op = rentOps.find(x => String(x.carId || '').trim() === carId);
    const latestRental = latestByCar.get(carId);
    const rate = parseRatePerDay(latestRental?.rateDay ?? car.rateDay);

    const amount = Math.round(Number(car.rateDay || 0) * 7);
    const paidInfo = _sessionState.paidByCar.get(carId);

    let paidUntil = null;
    if (paidInfo) {
      const paySrc =
        paidInfo.date instanceof Date
          ? paidInfo.date
          : (paidInfo.date != null
            ? new Date(paidInfo.date)
            : new Date(paidInfo.acceptedAt || Date.now()));
      if (!Number.isNaN(paySrc.getTime())) {
        const payDt = new Date(paySrc);
        payDt.setHours(0, 0, 0, 0);
        paidUntil = calcPaidUntil(payDt, Number(paidInfo.amount) || 0, rate);
      }
    } else if (op) {
      const opD = _toDate(op);
      if (opD && !Number.isNaN(opD.getTime())) {
        opD.setHours(0, 0, 0, 0);
        paidUntil = calcPaidUntil(opD, Number(op.amount) || 0, rate);
      }
    }

    const bonusDaysTotal = Number(latestRental?.bonusDays) || 0;
    if (paidUntil && bonusDaysTotal > 0) {
      paidUntil = new Date(paidUntil.getTime() + bonusDaysTotal * 86400000);
    }

    const overdue =
      paidUntil != null ? _daysDiff(_todayStart(), paidUntil) : null;

    let promisedSheet = latestRental?.promisedUntil ?? null;
    if (promisedSheet instanceof Date && !Number.isNaN(promisedSheet.getTime())) {
      promisedSheet = new Date(promisedSheet);
      promisedSheet.setHours(0, 0, 0, 0);
    } else {
      promisedSheet = null;
    }

    let promiseDate = _sessionState.promisedByCar.get(carId);
    if (!(promiseDate instanceof Date && !Number.isNaN(promiseDate.getTime()))) {
      promiseDate = promisedSheet ?? undefined;
    }

    const status = _resolveTaskStatus({ paidInfo, paidUntil, promiseDate });

    return {
      carId,
      driverName: driver?.name || 'Без водителя',
      driverId: driver?.driverId || '',
      rateDay: Number(car.rateDay || 0),
      amount,
      paidUntil,
      overdue,
      status,
      promiseDate,
      paidInfo,
      bonusDays: bonusDaysTotal,
      bonusReason: String(latestRental?.bonusReason || ''),
      expanded: _sessionState.expandedCarId === carId,
    };
  });

  tasks.sort((a, b) => _taskRank(a) - _taskRank(b) || (b.overdue ?? -999) - (a.overdue ?? -999));
  return { tasks };
}

function _taskRank(t) {
  if (t.status === 'broke_promise') return 0;
  if (t.status === 'overdue') return 1;
  if (t.status === 'neutral') return 2;
  if (t.status === 'promised') return 3;
  if (t.status === 'warning') return 4;
  if (t.status === 'paid') return 5;
  return 9;
}

/** Хвост rental_id как число (R0052 → 52) для сортировки «последняя аренда». */
function _rentalIdTailNum(id) {
  const m = String(id || '').match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Начало календарного дня из dateEnd строки аренды (лист «Аренда», кол. E). */
function _paidUntilDayFromRentalDateEnd(dateEnd) {
  if (dateEnd == null || dateEnd === '') return null;
  if (!(dateEnd instanceof Date) || Number.isNaN(dateEnd.getTime())) return null;
  return new Date(dateEnd.getFullYear(), dateEnd.getMonth(), dateEnd.getDate());
}

/**
 * «Оплачено до» для блока «Ближайшие 3 дня»: дата_окончания последней строки аренды
 * с непустым dateEnd (источник правды в таблице). Иначе null → fallback на calcPaidUntil.
 */
function _paidUntilDayFromLatestRentalEnd(rentalRows, carId) {
  const cid = String(carId || '').trim();
  const candidates = (rentalRows || []).filter(r => {
    if (String(r.carId || '').trim() !== cid) return false;
    return _paidUntilDayFromRentalDateEnd(r.dateEnd) != null;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const nb = _rentalIdTailNum(b.rentalId);
    const na = _rentalIdTailNum(a.rentalId);
    if (nb !== na) return nb - na;
    const sa = a.dateStart instanceof Date && !Number.isNaN(a.dateStart.getTime()) ? a.dateStart.getTime() : 0;
    const sb = b.dateStart instanceof Date && !Number.isNaN(b.dateStart.getTime()) ? b.dateStart.getTime() : 0;
    return sb - sa;
  });
  let pt = _paidUntilDayFromRentalDateEnd(candidates[0].dateEnd);
  const bonus = Number(candidates[0].bonusDays) || 0;
  if (pt && bonus > 0) pt = _addDays(pt, bonus);
  return pt;
}

function _buildDueSoonRows(allOps, rentCars, drivers, rentalRows) {
  const latestRent = latestRentalByCarMap(rentalRows || []);

  const byCarDriver = new Map();
  drivers.forEach(d => {
    if (d.currentCar) byCarDriver.set(String(d.currentCar).trim(), d);
  });
  const rentOps = allOps
    .filter(op => op.type === 'аренда' && op.direction === 'приход')
    .sort((a, b) => _toDate(b)?.getTime() - _toDate(a)?.getTime());

  const today = _todayStart();
  const windowStart = _addDays(today, -1);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = _addDays(today, 3);
  windowEnd.setHours(0, 0, 0, 0);
  const rows = [];

  rentCars.forEach(car => {
    const carId = String(car.carId || '').trim();

    let pt = _paidUntilDayFromLatestRentalEnd(rentalRows, carId);

    if (!pt) {
      const op = rentOps.find(x => String(x.carId || '').trim() === carId);
      if (!op) return;
      const opD = _toDate(op);
      if (!opD || Number.isNaN(opD.getTime())) return;
      opD.setHours(0, 0, 0, 0);
      const rate = parseRatePerDay(latestRent.get(carId)?.rateDay ?? car.rateDay);
      const rawPaidUntil = calcPaidUntil(opD, Number(op.amount) || 0, rate);
      if (!rawPaidUntil || Number.isNaN(rawPaidUntil.getTime())) return;
      pt = new Date(
        rawPaidUntil.getFullYear(),
        rawPaidUntil.getMonth(),
        rawPaidUntil.getDate(),
      );
      const bonusDays = Number(latestRent.get(carId)?.bonusDays) || 0;
      if (bonusDays > 0) pt = _addDays(pt, bonusDays);
    }

    if (!pt || pt.getTime() < windowStart.getTime() || pt.getTime() > windowEnd.getTime()) return;

    const driver = byCarDriver.get(carId);
    const amount = Math.round(Number(car.rateDay || 0) * 7);
    const paidInfo = _sessionState.paidByCar.get(carId);
    rows.push({
      carId,
      driverName: driver?.name || 'Без водителя',
      amount,
      paidUntil: pt,
      paidToday: _paidAcceptedToday(paidInfo, today),
    });
  });

  rows.sort((a, b) => a.paidUntil.getTime() - b.paidUntil.getTime());
  return rows;
}

/** Пилюли-счётчики в заголовке «ОПЛАТЫ» — только при count > 0 */
function _counterPillsHtml(c) {
  const parts = [];
  if (c.red > 0) parts.push(`<span class="home-pill--count home-pill--count-red">${c.red}</span>`);
  if (c.purple > 0) parts.push(`<span class="home-pill--count home-pill--count-purple">${c.purple}</span>`);
  if (c.orange > 0) parts.push(`<span class="home-pill--count home-pill--count-orange">${c.orange}</span>`);
  return parts.join('');
}

function _paymentBadgeHtml(task) {
  const o = task.overdue;

  const acceptedAt = task.paidInfo?.acceptedAt instanceof Date
    ? task.paidInfo.acceptedAt
    : (task.paidInfo?.acceptedAt ? new Date(task.paidInfo.acceptedAt) : null);

  if (task.status === 'paid') {
    const at = acceptedAt || new Date();
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    return `<span class="payment-task-card__badge payment-task-card__badge--green">${_esc(_fmtDayMonthRu(d))}</span>`;
  }
  if (task.status === 'warning') {
    return `<span class="payment-task-card__badge payment-task-card__badge--orange">завтра</span>`;
  }
  if (task.status === 'promised') {
    if (o === null) return '';
    if (o >= 1) return `<span class="payment-task-card__badge payment-task-card__badge--purple">просрочка ${_esc(String(o))}д</span>`;
    if (o === 0) return `<span class="payment-task-card__badge payment-task-card__badge--purple">сегодня</span>`;
    if (o === -1) return `<span class="payment-task-card__badge payment-task-card__badge--purple">завтра</span>`;
    return '';
  }
  if (task.status === 'broke_promise' || task.status === 'overdue') {
    if (o === null || o < 0) return '';
    if (o === 0) return `<span class="payment-task-card__badge payment-task-card__badge--dark">сегодня</span>`;
    if (o === 1) return `<span class="payment-task-card__badge payment-task-card__badge--red">просрочка 1д</span>`;
    return `<span class="payment-task-card__badge payment-task-card__badge--red">просрочка ${_esc(String(o))}д</span>`;
  }
  return '';
}

/** Текст ярлыка обещания (как пресеты «завтра утром», …), иначе дата */
function _promisePresetLabel(promiseDate) {
  if (!(promiseDate instanceof Date) || Number.isNaN(promiseDate.getTime())) return '';
  const pd = new Date(promiseDate);
  pd.setHours(0, 0, 0, 0);
  const diff = _daysDiff(pd, _todayStart());
  const preset = PROMISE_PRESETS.find(p => p.days === diff);
  if (preset) return preset.label;
  return `до ${_fmtDayMonth(pd)}`;
}

function _bonusBlockHtml(task, isReadOnly) {
  const cid = String(task.carId || '').trim();
  const panelOpen = _isBonusPanelExpanded(cid);
  const ariaExpanded = panelOpen ? 'true' : 'false';
  const hasBonus = Number(task.bonusDays) > 0;
  const toggleLabel = hasBonus
    ? `Уже подарено: +${task.bonusDays}д · изменить`
    : 'Подарить дни за простой';
  const toggleCls = [
    'payment-task-card__bonus-toggle',
    hasBonus ? 'payment-task-card__bonus-toggle--gifted' : '',
  ].join(' ');

  const draft = _bonusDraftForCar(cid);
  const saving = _sessionState.bonusSavingByCar.has(cid);
  const dis = isReadOnly ? ' disabled' : '';
  const selectedDays = Number(draft.days) || 0;
  const reason = String(draft.reason || BONUS_REASONS[0].value);
  const wasUntil = task.paidUntil;
  const willUntil =
    wasUntil instanceof Date && !Number.isNaN(wasUntil.getTime()) && selectedDays > 0
      ? _addDays(wasUntil, selectedDays)
      : null;
  const preview =
    wasUntil && willUntil
      ? `Было оплачено до: ${_fmtDayMonth(wasUntil)} → станет: ${_fmtDayMonth(willUntil)} (+${selectedDays} ${_bonusDaysLabel(selectedDays)})`
      : 'Выберите количество дней';
  const confirmLabel =
    selectedDays > 0 ? `Подарить ${selectedDays} ${_bonusDaysLabel(selectedDays)}` : 'Подарить';
  const confirmDisabled = isReadOnly || saving || selectedDays <= 0 ? ' disabled' : '';
  const confirmPe = selectedDays <= 0 && !isReadOnly ? ' style="pointer-events:none"' : '';

  const presetBtns = BONUS_PRESETS.map(p => {
    const isCustom = p.days === 'custom';
    const active = isCustom ? draft.customMode : !draft.customMode && selectedDays === p.days;
    const cls = active ? ' is-active' : '';
    const val = isCustom ? 'custom' : String(p.days);
    return `<button type="button" class="payment-task-card__bonus-shortcut${cls}" data-bonus="${val}" data-car-id="${_esc(cid)}"${dis}>${_esc(p.label)}</button>`;
  }).join('');

  const reasonOpts = BONUS_REASONS.map(r => {
    const sel = r.value === reason ? ' selected' : '';
    return `<option value="${_esc(r.value)}"${sel}>${_esc(r.label)}</option>`;
  }).join('');

  const customRow = draft.customMode
    ? `<label class="payment-task-card__bonus-custom">
        <span class="payment-task-card__bonus-custom-lbl">Дней</span>
        <input type="number" min="1" step="1" class="payment-task-card__bonus-custom-input" data-car-id="${_esc(cid)}" value="${selectedDays}"${dis} />
      </label>`
    : '';

  return `<button type="button" class="${toggleCls}" data-bonus-toggle data-car-id="${_esc(cid)}" aria-expanded="${ariaExpanded}"${dis}>
      <i class="ti ti-gift" aria-hidden="true"></i>
      <span class="payment-task-card__bonus-toggle-text">${_esc(toggleLabel)}</span>
      <i class="ti ti-chevron-down payment-task-card__bonus-chevron" aria-hidden="true"></i>
    </button>
    <div class="payment-task-card__bonus-section">
      <div class="payment-task-card__bonus-grid">${presetBtns}</div>
      ${customRow}
      <select class="payment-task-card__bonus-reason" data-car-id="${_esc(cid)}"${dis}>${reasonOpts}</select>
      <div class="payment-task-card__bonus-preview">${_esc(preview)}</div>
      <button type="button" class="payment-task-card__bonus-confirm" data-car-id="${_esc(cid)}"${confirmDisabled}${confirmPe}${saving ? ' aria-busy="true"' : ''}>${_esc(confirmLabel)}</button>
    </div>`;
}

/**
 * Карточка задачи оплаты (эквивалент PaymentTaskCard).
 * @param {boolean} [isReadOnly] — OPERATIONS / INVESTOR: кнопки неактивны
 */
function _paymentTaskCardHtml(task, isReadOnly = false) {
  const statusMod = task.status === 'broke_promise' ? 'broke-promise' : task.status;
  const showPay = task.status !== 'paid';
  const roClass = isReadOnly ? ' payment-task-card--readonly' : '';

  const acceptedAt = task.paidInfo?.acceptedAt instanceof Date
    ? task.paidInfo.acceptedAt
    : (task.paidInfo?.acceptedAt ? new Date(task.paidInfo.acceptedAt) : null);

  let metaLeft = '';
  if (task.status === 'paid') {
    const at = acceptedAt || new Date();
    const timeStr = at.toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
    const today0 = _todayStart().getTime();
    const paidDay0 = new Date(at);
    paidDay0.setHours(0, 0, 0, 0);
    const dayLabel = paidDay0.getTime() === today0 ? 'сегодня' : _fmtDayMonthRu(paidDay0);
    metaLeft = `<span class="payment-task-card__tag payment-task-card__tag--paid">оплачено</span><span class="payment-task-card__meta-rest">${_esc(dayLabel)}, ${_esc(timeStr)}</span>`;
  } else if (task.status === 'promised' && task.promiseDate) {
    metaLeft = `<span class="payment-task-card__tag payment-task-card__tag--promised">обещал</span><span class="payment-task-card__meta-rest">до ${_esc(_fmtDayMonth(task.promiseDate))}</span>`;
  } else if (task.status === 'broke_promise' && task.promiseDate) {
    metaLeft = `<span class="payment-task-card__tag payment-task-card__tag--broke">не сдержал</span><span class="payment-task-card__meta-rest">обещал ${_esc(_fmtDayMonth(task.promiseDate))}</span>`;
  } else if (task.paidUntil) {
    metaLeft = `<span class="payment-task-card__meta-rest">Срок ${_esc(_fmtDayMonth(task.paidUntil))}</span>`;
  } else {
    metaLeft = `<span class="payment-task-card__meta-rest">Без срока</span>`;
  }

  let badgeHtml = _paymentBadgeHtml(task);

  let promiseBlock = '';
  let bonusBlock = '';
  if (task.expanded && task.status !== 'paid') {
    const hasPromise =
      task.promiseDate instanceof Date && !Number.isNaN(task.promiseDate.getTime());
    if (isReadOnly && hasPromise) {
      const line = `Обещал заплатить: ${_promisePresetLabel(task.promiseDate)}`;
      promiseBlock = `<div class="payment-task-card__promise-section">
        <div class="payment-task-card__promise-readonly-line">${_esc(line)}</div>
      </div>`;
    } else {
      const dis = isReadOnly ? ' disabled' : '';
      promiseBlock = `<div class="payment-task-card__promise-section">
        <div class="payment-task-card__promise-title">Когда обещал заплатить?</div>
        <div class="payment-task-card__promise-grid">${PROMISE_PRESETS.map(p => `<button type="button" class="payment-task-card__promise-shortcut" data-promise="${p.days}" data-car-id="${_esc(task.carId)}"${dis}>${_esc(p.label)}</button>`).join('')}</div>
      </div>`;
    }
    bonusBlock = _bonusBlockHtml(task, isReadOnly);
  }

  const bonusBadge =
    Number(task.bonusDays) > 0
      ? `<span class="payment-task-card__bonus-badge" title="${_esc(task.bonusReason || 'бонус за простой')}"><i class="ti ti-gift" aria-hidden="true"></i> +${task.bonusDays}д</span>`
      : '';

  const payDis = isReadOnly ? ' disabled title="Только для механика"' : '';
  const payBtn = showPay
    ? `<button type="button" class="payment-task-card__pay-btn" data-open-payment="1"${payDis}>Платёж</button>`
    : '';

  return `
    <article class="payment-task-card payment-task-card--${_esc(statusMod)}${roClass}" data-task-id="${_esc(task.carId)}">
      <div class="payment-task-card__status-stripe" aria-hidden="true"></div>
      <div class="payment-task-card__inner">
        <div class="payment-task-card__top">
          <div class="payment-task-card__identity">
            <span class="payment-task-card__car">${_esc(task.carId)}${bonusBadge}</span>
            <span class="payment-task-card__driver">${_esc(task.driverName)}</span>
          </div>
          <div class="payment-task-card__sum-col">
            <div class="payment-task-card__amount-line">
              <span class="payment-task-card__sum">${_fmtInt(task.amount)} ₽</span>
              ${payBtn}
            </div>
            ${badgeHtml ? `<div class="payment-task-card__badge-wrap">${badgeHtml}</div>` : ''}
          </div>
        </div>
        <div class="payment-task-card__meta-line">${metaLeft}</div>
        ${promiseBlock}
        ${bonusBlock}
      </div>
    </article>
  `;
}

function _dueRowHtml(row) {
  const today = _todayStart();
  const isToday = row.paidUntil.getTime() === today.getTime();
  const check = row.paidToday
    ? ' <span class="home-due-check" aria-hidden="true">✓</span>'
    : '';
  const amtClass = row.paidToday ? 'home-due-amount home-due-amount--paid' : 'home-due-amount';
  return `<div class="card-row home-due-row ${isToday ? 'is-today' : ''}">
    <div class="home-due-date">${row.paidUntil.getDate()}<small>${_monthShort(row.paidUntil)}</small></div>
    <div class="home-due-main"><strong>${_esc(row.carId)}</strong><span class="home-due-driver">${_esc(row.driverName)}${check}</span></div>
    <div class="${amtClass}">${_fmtInt(row.amount)} ₽</div>
  </div>`;
}

function _parkStats(fleet) {
  const acc = { rent: 0, idle: 0, repair: 0 };
  fleet.forEach(c => acc[_bucketStatus(c.status)]++);
  const total = Math.max(1, fleet.length);
  return {
    ...acc,
    rentPct: (acc.rent / total) * 100,
    idlePct: (acc.idle / total) * 100,
    repairPct: (acc.repair / total) * 100,
  };
}

function _calcBalance(ops) {
  return ops.reduce((sum, op) => sum + (op.direction === 'приход' ? op.amount : -op.amount), 0);
}

function _calcDeltaToday(ops) {
  const today = _todayStart().getTime();
  return ops.filter(op => _toDate(op)?.setHours(0, 0, 0, 0) === today).reduce((sum, op) => sum + (op.direction === 'приход' ? op.amount : -op.amount), 0);
}

function _toDate(op) {
  if (op.date instanceof Date && !Number.isNaN(op.date.getTime())) return new Date(op.date);
  const raw = String(op.dateRaw || '');
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function _bucketStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('ремонт')) return 'repair';
  if (s.includes('арен')) return 'rent';
  return 'idle';
}

function _daysDiff(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}
function _todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function _addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function _fmtInt(n) {
  return fmtRuInt(n || 0);
}
function _fmtDayMonth(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** «8 мая» */
function _fmtDayMonthRu(d) {
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function _monthShort(d) {
  return ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()];
}
function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

