import { getOperations, getFleet, getDrivers } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { CAR_STATUSES, KASSA_ID } from '../config.js';

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
    _sessionState.paidByCar.set(p.carId, { ...p, paidAt: _todayStart() });
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

  const paint = () => {
    if (!ops || !cars || !drivers) return;
    _render(body, ops, cars, drivers);
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
}

function _render(body, allOps, fleet, drivers) {
  const user = getCurrentUser();
  const firstName = String(user?.name || 'Азамат').split(' ')[0];
  const kassaId = KASSA_ID.AZAMAT;
  const kassaOps = allOps.filter(op => String(op.kassaId || '').trim() === kassaId);
  const balance = _calcBalance(kassaOps);
  const deltaToday = _calcDeltaToday(kassaOps);
  const rentCars = fleet.filter(c => _bucketStatus(c.status) === 'rent');
  const taskView = _buildTasks(allOps, rentCars, drivers);
  const dueSoon = _buildDueSoon(taskView.tasks);
  const park = _parkStats(fleet);

  const counters = {
    red: taskView.tasks.filter(t => t.status === 'overdue' || t.status === 'broke_promise').length,
    purple: taskView.tasks.filter(t => t.status === 'promised').length,
    orange: taskView.tasks.filter(t => t.status === 'warning').length,
  };

  body.innerHTML = `
    <div class="home-header">
      <div class="home-hdr__brand-row">
        <span class="home-hdr__logo">Матизы</span>
        <div class="home-hdr__avatar">${_esc(firstName[0] || 'А')}</div>
      </div>
      <div class="home-cash-card">
        <div class="home-cash-card__label">КАССА АЗАМАТА</div>
        <div class="home-cash-card__amount">${_fmtInt(balance)} ₽</div>
        <div class="home-cash-card__delta ${deltaToday >= 0 ? 'is-pos' : 'is-neg'}">${deltaToday >= 0 ? '+' : '−'}${_fmtInt(Math.abs(deltaToday))} ₽ сегодня</div>
      </div>
      <div class="home-action-row home-action-row--3">
        <button id="home-btn-income" class="btn-primary">＋ Платёж</button>
        <button id="home-btn-expense" class="btn-secondary">− Расход</button>
        <button id="home-btn-transfer" class="btn-secondary">⇄ Перевод</button>
      </div>
    </div>
    <div class="home-content-sheet">
      <div class="home-block-title">
        <span>ОПЛАТЫ</span>
        <div class="home-pill-counters"><span class="home-pill red">${counters.red}</span><span class="home-pill purple">${counters.purple}</span><span class="home-pill orange">${counters.orange}</span></div>
      </div>
      <div id="home-task-list">${taskView.tasks.map(_taskCardHtml).join('') || '<div class="empty-state"><div class="empty-state__text">Нет задач по оплатам</div></div>'}</div>

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
    el.addEventListener('click', ev => _onTaskClick(ev, body, taskView.tasks));
  });
  body.querySelectorAll('[data-promise]').forEach(el => {
    el.addEventListener('click', ev => _applyPromise(ev, body, taskView.tasks));
  });
}

function _onTaskClick(event, body, tasks) {
  const card = event.currentTarget;
  const carId = card?.dataset.taskId;
  if (!carId) return;
  const task = tasks.find(t => t.carId === carId);
  if (!task) return;

  if (event.target.closest('[data-open-payment]')) {
    showScreen('screen-income', { paymentContext: task });
    return;
  }
  if (task.status === 'paid') return;

  _sessionState.expandedCarId = _sessionState.expandedCarId === carId ? null : carId;
  void renderHome();
}

function _applyPromise(event, _body, _tasks) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const carId = btn?.dataset.carId;
  const days = Number(btn?.dataset.promise || 0);
  if (!carId) return;
  const promisedUntil = _addDays(_todayStart(), days);
  _sessionState.promisedByCar.set(carId, promisedUntil);
  _sessionState.expandedCarId = null;
  void renderHome();
}

function _buildTasks(ops, rentCars, drivers) {
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
    const paidUntil = _parsePaidUntil(op?.comment || '');
    const amount = Math.round(Number(car.rateDay || 0) * 7);
    const overdue = paidUntil ? _daysDiff(_todayStart(), paidUntil) : 0;
    const paid = _sessionState.paidByCar.get(carId);
    const promiseDate = _sessionState.promisedByCar.get(carId);

    let status = 'neutral';
    if (paid) status = 'paid';
    else if (promiseDate && overdue >= 0 && _daysDiff(_todayStart(), promiseDate) > 0) status = 'broke_promise';
    else if (promiseDate) status = 'promised';
    else if (overdue >= 2) status = 'overdue';
    else if (overdue < 0 && overdue >= -1) status = 'warning';

    return {
      carId,
      driverName: driver?.name || 'Без водителя',
      driverId: driver?.driverId || '',
      amount,
      paidUntil,
      overdue,
      status,
      promiseDate,
      expanded: _sessionState.expandedCarId === carId,
    };
  });

  tasks.sort((a, b) => _taskRank(a) - _taskRank(b) || b.overdue - a.overdue);
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

function _buildDueSoon(tasks) {
  const today = _todayStart();
  const max = _addDays(today, 3);
  return tasks
    .filter(t => t.status !== 'paid')
    .map(t => {
      const nextDate = t.paidUntil && t.paidUntil >= today ? t.paidUntil : null;
      return { ...t, nextDate };
    })
    .filter(t => t.nextDate && t.nextDate <= max)
    .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());
}

function _taskCardHtml(task) {
  const tint = task.status === 'promised' ? 'purple' : task.status === 'warning' ? 'orange' : (task.status === 'overdue' || task.status === 'broke_promise') ? 'red' : task.status === 'paid' ? 'green' : 'white';
  const left = task.status === 'paid' ? '***REMOVED***22c55e' : task.status === 'promised' ? '***REMOVED***7c3aed' : (task.status === 'warning' ? '***REMOVED***f97316' : (task.status === 'overdue' || task.status === 'broke_promise') ? '***REMOVED***ef4444' : '***REMOVED***d4d4d8');
  const meta = task.status === 'paid'
    ? 'оплачено'
    : task.status === 'broke_promise'
      ? `не сдержал · обещал ${_fmtDayMonth(task.promiseDate)}`
      : task.status === 'promised'
        ? `обещал · до ${_fmtDayMonth(task.promiseDate)}`
        : task.overdue >= 2
          ? `просрочка ${task.overdue}д`
          : task.overdue >= 0
            ? 'срок сегодня'
            : `срок ${_fmtDayMonth(task.paidUntil)}`;

  return `
    <article class="home-task-card home-task-card--${tint}" data-task-id="${_esc(task.carId)}">
      <div class="home-task-card__stripe" style="background:${left}"></div>
      <div class="home-task-card__main">
        <div class="home-task-top"><strong>${_esc(task.carId)}</strong><span>${_esc(task.driverName)}</span><b>${_fmtInt(task.amount)} ₽</b></div>
        <div class="home-task-meta">${_esc(meta)}</div>
        ${task.expanded ? `<div class="home-promise-box">${PROMISE_PRESETS.map(p => `<button type="button" data-promise="${p.days}" data-car-id="${_esc(task.carId)}">${p.label}</button>`).join('')}</div>` : ''}
      </div>
      <button class="home-pay-cta" data-open-payment="1">Платёж</button>
    </article>
  `;
}

function _dueRowHtml(t) {
  const today = _todayStart().getTime();
  const isToday = t.nextDate.getTime() === today;
  return `<div class="card-row home-due-row ${isToday ? 'is-today' : ''}">
    <div class="home-due-date">${t.nextDate.getDate()}<small>${_monthShort(t.nextDate)}</small></div>
    <div class="home-due-main"><strong>${_esc(t.carId)}</strong><span>${_esc(t.driverName)}</span></div>
    <div class="home-due-amount">${_fmtInt(t.amount)} ₽</div>
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

function _parsePaidUntil(comment) {
  const c = String(comment || '').toLowerCase();
  const m = c.match(/до\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!m) return null;
  const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date().getFullYear();
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
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
function _monthShort(d) {
  return ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()];
}
function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

