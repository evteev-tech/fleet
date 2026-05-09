import { getOperations, getFleet, getDrivers, getRentals, saveRentalPromise } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { KASSA_ID, ROLES, USE_MOCK } from '../config.js';
import { calcPaidUntil, parseRatePerDay, latestRentalByCarMap } from '../utils/rent.js';
import { parseRuDate } from './history.js';

const HOME_KASSA_ORDER = [KASSA_ID.AZAMAT, KASSA_ID.VLADIMIR, KASSA_ID.YULIA];

const PROMISE_PRESETS = [
  { id: 'today_evening', label: 'сегодня вечером', days: 0 },
  { id: 'tomorrow_morning', label: 'завтра утром', days: 1 },
  { id: 'in_2_days', label: 'через 2 дня', days: 2 },
  { id: 'in_3_days', label: 'через 3 дня', days: 3 },
];

const _sessionState = {
  promisedByCar: new Map(),
  paidByCar: new Map(),
  expandedCarId: null,
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
    _render(body, ops, cars, drivers, rentalRows);
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
  return `${sign}${Math.abs(rounded).toLocaleString('ru-RU')} ₽`;
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
      <div class="home-ops-fin__total">${_formatSignedAmt(total)}</div>
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
  const user = getCurrentUser();
  const firstName = String(user?.name || 'Азамат').split(' ')[0];
  const isOpsFinance = _isOpsFinanceHome(user);
  const isReadOnlyPayments = _isPaymentsReadOnly(user);

  const kassaId = KASSA_ID.AZAMAT;
  const kassaOps = allOps.filter(op => String(op.kassaId || '').trim() === kassaId);
  const balance = _calcBalance(kassaOps);
  const deltaToday = _calcDeltaToday(kassaOps);

  const cashPrimaryHtml = isOpsFinance
    ? _operationsCashSummaryHtml(allOps)
    : `<div class="home-cash-card">
        <div class="home-cash-card__label">КАССА АЗАМАТА</div>
        <div class="home-cash-card__amount">${_fmtInt(balance)} ₽</div>
        <div class="home-cash-card__delta ${deltaToday >= 0 ? 'is-pos' : 'is-neg'}">${deltaToday >= 0 ? '+' : '−'}${_fmtInt(Math.abs(deltaToday))} ₽ сегодня</div>
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
        <button id="home-btn-transfer" class="btn-secondary">⇄ Перевод</button>
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
        <div class="home-park-bar">
          <span style="width:${park.rentPct}%;background:***REMOVED***22c55e"></span>
          <span style="width:${park.idlePct}%;background:***REMOVED***f97316"></span>
          <span style="width:${park.repairPct}%;background:***REMOVED***ef4444"></span>
        </div>
        <div class="home-park-legend">
          <div><strong style="color:***REMOVED***22c55e">${park.rent}</strong><span>Аренда</span></div>
          <div><strong style="color:***REMOVED***f97316">${park.idle}</strong><span>Простой</span></div>
          <div><strong style="color:***REMOVED***ef4444">${park.repair}</strong><span>Ремонт</span></div>
        </div>
      </div>
    </div>
  `;

  body.querySelector('***REMOVED***home-btn-income')?.addEventListener('click', () => showScreen('screen-income'));
  body.querySelector('***REMOVED***home-btn-expense')?.addEventListener('click', () => showScreen('screen-expense'));
  body.querySelector('***REMOVED***home-btn-transfer')?.addEventListener('click', () => showScreen('screen-transfer'));

  body.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', ev => _onTaskClick(ev, taskViewTasks, isReadOnlyPayments));
  });
  body.querySelectorAll('[data-promise]').forEach(el => {
    el.addEventListener('click', ev => _applyPromise(ev, body, taskViewTasks));
  });
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
  const windowEnd = _addDays(today, 3);
  const rows = [];

  rentCars.forEach(car => {
    const carId = String(car.carId || '').trim();
    const op = rentOps.find(x => String(x.carId || '').trim() === carId);
    if (!op) return;

    const opD = _toDate(op);
    if (!opD || Number.isNaN(opD.getTime())) return;

    opD.setHours(0, 0, 0, 0);
    const rate = parseRatePerDay(latestRent.get(carId)?.rateDay ?? car.rateDay);
    const rawPaidUntil = calcPaidUntil(opD, Number(op.amount) || 0, rate);
    if (!rawPaidUntil || Number.isNaN(rawPaidUntil.getTime())) return;

    const pt = new Date(
      rawPaidUntil.getFullYear(),
      rawPaidUntil.getMonth(),
      rawPaidUntil.getDate(),
    );
    if (pt.getTime() < today.getTime() || pt.getTime() > windowEnd.getTime()) return;

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
  }

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
            <span class="payment-task-card__car">${_esc(task.carId)}</span>
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
  return Math.round(n || 0).toLocaleString('ru-RU');
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

