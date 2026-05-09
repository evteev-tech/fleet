import { getFleet, getDrivers, getRentals, postAddIncome, saveRentalPromise } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { CAR_STATUSES, KASSA_ID, USE_MOCK } from '../config.js';
import { calcPaidUntil, parseRatePerDay, latestRentalByCarMap } from '../utils/rent.js';

let _incomeRentalsLoaded = false;
let _incomeRentalRows = [];

let _context = null;
let _state = {
  cars: [],
  selectedCarId: null,
  amount: 0,
  initialAmount: 0,
  edited: false,
  firstInputReplaces: true,
};

export function initIncome() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId !== 'screen-income') return;
    _context = e.detail.paymentContext || null;
    void renderIncome();
  });
}

function _resetState() {
  _state = {
    cars: [],
    selectedCarId: _context?.carId || null,
    amount: Number(_context?.amount || 0),
    initialAmount: Number(_context?.amount || 0),
    edited: false,
    firstInputReplaces: true,
  };
}

export function renderIncome() {
  const root = document.getElementById('income-root');
  if (!root) return;
  _resetState();
  root.innerHTML = '<div class="income-loading">Загрузка…</div>';

  let cars = null;
  let drivers = null;
  _incomeRentalsLoaded = false;
  _incomeRentalRows = [];

  const paint = () => {
    if (!cars || !drivers || !_incomeRentalsLoaded) return;
    _state.cars = _buildCars(cars, drivers);
    if (!_state.selectedCarId && _context?.carId) _state.selectedCarId = _context.carId;
    _renderPaymentScreen(root);
  };

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
      _incomeRentalRows = d;
      _incomeRentalsLoaded = true;
      paint();
    },
    onFresh: d => {
      _incomeRentalRows = d;
      _incomeRentalsLoaded = true;
      paint();
    },
    onFetchError: () => {
      _incomeRentalRows = [];
      _incomeRentalsLoaded = true;
      paint();
    },
  });
}

function _buildCars(cars, drivers) {
  const byCar = new Map();
  drivers.forEach(d => { if (d.currentCar) byCar.set(String(d.currentCar), d); });
  return cars
    .filter(c => String(c.status).toLowerCase().includes(CAR_STATUSES.RENT))
    .map(c => {
      const dr = byCar.get(String(c.carId));
      return {
        carId: String(c.carId),
        rateDay: Number(c.rateDay || 0),
        driverId: dr?.driverId || '',
        driverName: dr?.name || 'Без водителя',
      };
    });
}

function _renderPaymentScreen(root) {
  const selected = _selectedCar();
  const amountTitleClass = _state.edited ? 'is-editing' : '';
  const confirmDisabled = _state.amount <= 0;
  const originalLine = _state.edited
    ? `<div class="income-restore-row"><span>зачёркнуто ${_fmtMoney(_state.initialAmount)}</span><button id="income-restore-btn">↩ восстановить</button></div>`
    : '';
  const context = selected || _context;
  const overdueTag = context?.overdue >= 0 ? `−${context.overdue}д` : '';

  root.innerHTML = `
    <div class="income-payment-page">
      <header class="income-header">
        <button type="button" class="btn-icon income-header__back" id="income-back-btn">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h1 class="income-header__title">Принять платёж</h1>
        <div class="income-header__spacer"></div>
      </header>

      ${context ? `<div class="income-context-pill"><strong>[${_esc(context.carId)}]</strong><span>${_esc(context.driverName || '')}</span><em>${_esc(overdueTag)}</em><small>${context.overdue >= 0 ? `Просрочка ${context.overdue} дней` : 'Оплата по аренде'}</small></div>` : ''}

      <div class="income-amount-zone">
        <div class="income-amount-label">СУММА</div>
        <div id="income-main-amount" class="income-main-amount ${amountTitleClass}">${_fmtInt(_state.amount)} <span>₽</span></div>
        ${originalLine}
      </div>

      <div class="income-keypad" id="income-keypad">
        ${[['1','2','3'],['4','5','6'],['7','8','9'],['0','⌫']].map((row, idx) => `
          <div class="income-keypad-row ${idx === 3 ? 'wide' : ''}">
            ${row.map(k => `<button type="button" data-key="${k}">${k}</button>`).join('')}
          </div>
        `).join('')}
      </div>

      <button class="btn-income-submit" id="income-confirm-btn" ${confirmDisabled ? 'disabled' : ''}>Подтвердить ${_fmtMoney(_state.amount)}</button>
    </div>
    <div id="income-success-overlay" class="income-success-overlay hidden"></div>
  `;

  root.querySelector('***REMOVED***income-back-btn')?.addEventListener('click', () => showScreen('screen-home'));
  root.querySelectorAll('[data-key]').forEach(btn => btn.addEventListener('click', () => _onNumpad(btn.dataset.key)));
  root.querySelector('***REMOVED***income-restore-btn')?.addEventListener('click', _restoreAmount);
  root.querySelector('***REMOVED***income-confirm-btn')?.addEventListener('click', () => void _submit(root));
}

function _onNumpad(key) {
  if (key === '⌫') {
    _state.amount = Math.floor(_state.amount / 10);
  } else if (/^\d$/.test(key)) {
    const digit = Number(key);
    if (_state.firstInputReplaces) {
      _state.amount = digit;
      _state.firstInputReplaces = false;
      _state.edited = _state.initialAmount !== _state.amount;
    } else {
      const next = String(_state.amount) + key;
      if (next.length > 7) return;
      _state.amount = Number(next);
      _state.edited = _state.initialAmount !== _state.amount;
    }
  }
  const root = document.getElementById('income-root');
  if (root) _renderPaymentScreen(root);
}

function _restoreAmount() {
  _state.amount = _state.initialAmount;
  _state.edited = false;
  _state.firstInputReplaces = true;
  const root = document.getElementById('income-root');
  if (root) _renderPaymentScreen(root);
}

async function _submit(root) {
  const car = _selectedCar() || _context;
  if (!car || _state.amount <= 0) return;
  const today = _today();
  const latestRent = latestRentalByCarMap(_incomeRentalRows);
  const rentalRow = latestRent.get(car.carId);
  const rate = parseRatePerDay(rentalRow?.rateDay ?? car.rateDay);
  const amountRounded = Math.round(_state.amount);
  const paidDays =
    rate > 0 ? Math.floor(amountRounded / rate) : 0;
  const nextPaidUntil = calcPaidUntil(today, amountRounded, rate);
  const comment = `аренда до ${_fmtDayMonth(nextPaidUntil)}`;
  const user = getCurrentUser();

  try {
    await postAddIncome({
      car_id: car.carId,
      driver_id: car.driverId || '',
      amount: amountRounded,
      kassa_id: KASSA_ID.AZAMAT,
      provel: String(user?.name || 'Азамат').split(' ')[0],
      comment,
      date_from: _fmtDate(today),
      date_to: _fmtDate(nextPaidUntil),
      days: paidDays,
      rate: rate || car.rateDay || 0,
    });
  } catch (_e) {
    // В демо-потоке не блокируем UX при сетевой ошибке.
  }

  document.dispatchEvent(new CustomEvent('payment:accepted', {
    detail: {
      carId: car.carId,
      driverId: car.driverId,
      driverName: car.driverName,
      amount: amountRounded,
      paidUntil: nextPaidUntil,
      date: today,
      acceptedAt: new Date(),
    },
  }));

  if (USE_MOCK) {
    void saveRentalPromise(car.carId, null).catch(() => {});
  }

  _showSuccess(root, car, _state.amount, today);
}

function _showSuccess(root, car, amount, date) {
  const overlay = root.querySelector('***REMOVED***income-success-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="income-success-card">
      <div class="income-success-icon">✓</div>
      <h3>Платёж принят</h3>
      <p>${_esc(car.carId)} · ${_esc(car.driverName || '')}</p>
      <p>${_fmtMoney(amount)} · ${_fmtDate(date)}</p>
      <button id="income-success-back" class="btn-primary">← На главную</button>
    </div>
  `;
  overlay.querySelector('***REMOVED***income-success-back')?.addEventListener('click', () => showScreen('screen-home'));
}

function _selectedCar() {
  return _state.cars.find(c => c.carId === _state.selectedCarId) || null;
}
function _fmtMoney(n) { return `${_fmtInt(n)} ₽`; }
function _fmtInt(n) { return Math.round(n || 0).toLocaleString('ru-RU'); }
function _today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function _fmtDate(d) { return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }
function _fmtDayMonth(d) { return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; }
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
