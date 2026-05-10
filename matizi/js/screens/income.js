/**
 * income.js — экран «Принять платёж» (аренда).
 * Данные: GET_FLEET + GET_DRIVERS + GET_INCOME_FORM (Apps Script).
 */

import {
  getFleet,
  getDrivers,
  fetchIncomeForm,
  postAddIncome,
  invalidateCache,
} from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { SHEETS } from '../config.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { showToast } from '../ui.js';
import { CAR_STATUSES, KASSA_ID, ROLES } from '../config.js';

/** @type {{ cars: object[], selectedId: string|null, amount: number, period: '1w'|'2w'|'1m'|null, numpadOpen: boolean, numpadBuf: string }} */
let _state = {
  cars: [],
  selectedId: null,
  amount: 0,
  period: null,
  numpadOpen: false,
  numpadBuf: '',
  comment: '',
};

const STATUS_RENT = CAR_STATUSES.RENT;

export function initIncome() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-income') void renderIncome();
  });
}

export function renderIncome() {
  const root = document.getElementById('income-root');
  if (!root) return;

  _state = {
    cars: [],
    selectedId: null,
    amount: 0,
    period: null,
    numpadOpen: false,
    numpadBuf: '',
    comment: '',
  };

  root.innerHTML = `
    <header class="income-header">
      <button type="button" class="btn-icon income-header__back" id="income-back-btn" aria-label="Назад">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h1 class="income-header__title">Принять платёж</h1>
      <div class="income-header__spacer"></div>
    </header>
    <div class="income-loading">Загрузка…</div>
  `;

  document.getElementById('income-back-btn')?.addEventListener('click', () => {
    _closeNumpad();
    const u = getCurrentUser();
    showScreen(u?.role === ROLES.INVESTOR ? 'screen-dashboard' : 'screen-home');
  });

  let fleet;
  let drivers;
  let incomeRows;
  let cacheHit = false;

  const buildCars = () => {
    if (fleet === undefined || drivers === undefined || incomeRows === undefined) return;

    const lastPaidMap = Object.fromEntries(
      incomeRows.map(r => [String(r.carId || '').trim(), r.lastPaidDate || '']),
    );

    const byDriverCar = new Map();
    drivers.forEach(d => {
      if (d.currentCar) byDriverCar.set(String(d.currentCar).trim(), d);
    });

    const cars = fleet
      .filter(c => c.status === STATUS_RENT)
      .map(c => {
        const cid = c.carId;
        const dr = byDriverCar.get(cid);
        const kmLeft = (c.toMileage || 0) - (c.mileage || 0);
        return {
          carId: cid,
          name: c.name,
          color: c.color,
          status: c.status,
          rate: c.rateDay || 0,
          mileage: c.mileage || 0,
          toMileage: c.toMileage || 0,
          kmLeft,
          lastPaidDate: lastPaidMap[cid] || '',
          driverName: dr?.name || '—',
          driverPhone: dr?.phone || '',
          driverId: dr?.driverId || '',
        };
      })
      .sort((a, b) => String(a.carId).localeCompare(String(b.carId), 'ru'));

    _state.cars = cars;
    _renderIncomeShell(root);
  };

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      fleet = d;
      buildCars();
    },
    onFresh: d => {
      fleet = d;
      buildCars();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) fleet = [];
      buildCars();
    },
  });

  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => {
      cacheHit = true;
      drivers = d;
      buildCars();
    },
    onFresh: d => {
      drivers = d;
      buildCars();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) drivers = [];
      buildCars();
    },
  });

  getWithSWR(CACHE_KEYS.INCOME_FORM, () => fetchIncomeForm(), {
    onCached: d => {
      cacheHit = true;
      incomeRows = d;
      buildCars();
    },
    onFresh: d => {
      incomeRows = d;
      buildCars();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) incomeRows = [];
      buildCars();
    },
  });
}

function _renderIncomeShell(root) {
  const cars = _state.cars;
  root.innerHTML = `
    <header class="income-header">
      <button type="button" class="btn-icon income-header__back" id="income-back-btn2">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h1 class="income-header__title">Принять платёж</h1>
      <div class="income-header__spacer"></div>
    </header>

    <div class="income-cards-wrap income-cards-wrap--scroll" id="income-cards-wrap">
      ${cars.length === 0
        ? `<div class="income-empty">Нет машин в аренде</div>`
        : cars.map(c => _cardHtml(c)).join('')}
    </div>

    <div class="income-bottom income-bottom--disabled" id="income-bottom">
      <p class="income-bottom__hint" id="income-bottom-hint">Выберите машину выше</p>

      <div class="income-bottom__active hidden" id="income-bottom-active">
        <div class="income-periods" id="income-periods"></div>
        <button type="button" class="income-sum-wrap" id="income-sum-btn" aria-label="Сумма">
          <span class="income-sum" id="income-sum-display">0 ₽</span>
        </button>
        <div class="income-numpad-inline hidden" id="income-numpad-inline">
          <div class="income-numpad__keys" id="income-numpad-keys"></div>
        </div>
        <div class="income-dates hidden" id="income-dates-row"></div>
        <div class="income-warn hidden" id="income-warn"></div>
        <div class="income-comment-wrap" id="income-comment-wrap">
          <textarea
            id="income-comment"
            class="income-comment"
            placeholder="Комментарий (необязательно)"
            maxlength="200"
            rows="2"
          ></textarea>
        </div>
        <button type="button" class="income-submit btn-income-submit" id="income-submit" disabled>Записать</button>
      </div>
    </div>
  `;

  document.getElementById('income-back-btn2')?.addEventListener('click', () => {
    _closeNumpad();
    const u = getCurrentUser();
    showScreen(u?.role === ROLES.INVESTOR ? 'screen-dashboard' : 'screen-home');
  });

  root.querySelectorAll('.income-card').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.carId;
      _state.selectedId = id;
      root.querySelectorAll('.income-card').forEach(c => {
        c.classList.toggle('income-card--selected', c.dataset.carId === id);
      });
      root.querySelector('.income-cards-wrap')?.classList.remove('income-cards--warn');
      _updateBottom(root);
    });
  });

  document.getElementById('income-sum-btn')?.addEventListener('click', () => _openNumpad(root));

  document.getElementById('income-submit')?.addEventListener('click', () => _submit(root));

  document.getElementById('income-comment')?.addEventListener('input', e => {
    _state.comment = e.target.value.trim();
  });

  _updateBottom(root);
}

function _cardHtml(c) {
  const meta = [c.name, c.color].filter(Boolean).join(' · ');
  const kmCls =
    c.kmLeft < 1000 ? 'income-km--bad' : c.kmLeft < 3000 ? 'income-km--mid' : '';
  const paid = c.lastPaidDate ? _fmtShortFromDdMmYyyy(c.lastPaidDate) : '—';
  const phoneDisp = _fmtPhone(c.driverPhone);
  const initials = _initials(c.driverName);

  return `
    <article class="income-card" data-car-id="${escapeAttr(c.carId)}">
      <div class="income-card__top">
        <div class="income-card__id-block">
          <div class="income-card__car-id">${escapeHtml(c.carId)}</div>
          <div class="income-card__meta">${escapeHtml(meta)}</div>
        </div>
        <span class="income-badge">В аренде</span>
      </div>
      <div class="income-card__rule"></div>
      <div class="income-card__grid">
        <div class="income-cell">
          <div class="income-cell__label">Ставка</div>
          <div class="income-cell__val">${Math.round(c.rate).toLocaleString('ru-RU')} ₽/день</div>
        </div>
        <div class="income-cell">
          <div class="income-cell__label">До ТО</div>
          <div class="income-cell__val ${kmCls}">${Math.round(c.kmLeft).toLocaleString('ru-RU')} км</div>
        </div>
        <div class="income-cell">
          <div class="income-cell__label">Пробег</div>
          <div class="income-cell__val">${Math.round(c.mileage).toLocaleString('ru-RU')} км</div>
        </div>
        <div class="income-cell">
          <div class="income-cell__label">Оплачено до</div>
          <div class="income-cell__val">${escapeHtml(paid)}</div>
        </div>
      </div>
      <div class="income-card__driver">
        <span class="income-avatar">${escapeHtml(initials)}</span>
        <span class="income-driver-text">${escapeHtml(c.driverName)} · ${escapeHtml(phoneDisp)}</span>
      </div>
    </article>
  `;
}

function _selectedCar() {
  return _state.cars.find(c => c.carId === _state.selectedId) || null;
}

function _updateBottom(root) {
  const car = _selectedCar();
  const bottom = root.querySelector('***REMOVED***income-bottom');
  const hint = root.querySelector('***REMOVED***income-bottom-hint');
  const active = root.querySelector('***REMOVED***income-bottom-active');

  if (!car) {
    bottom?.classList.add('income-bottom--disabled');
    hint?.classList.remove('hidden');
    active?.classList.add('hidden');
    return;
  }

  bottom?.classList.remove('income-bottom--disabled');
  hint?.classList.add('hidden');
  active?.classList.remove('hidden');

  const periods = root.querySelector('***REMOVED***income-periods');
  if (periods && car.rate > 0) {
    const p7 = Math.round(car.rate * 7);
    const p14 = Math.round(car.rate * 14);
    const p30 = Math.round(car.rate * 30);
    periods.innerHTML = `
      <button type="button" class="income-period ${_state.period === '1w' ? 'income-period--on' : ''}" data-period="1w">
        <span class="income-period__label">1 неделя</span>
        <span class="income-period__sum">${p7.toLocaleString('ru-RU')} ₽</span>
      </button>
      <button type="button" class="income-period ${_state.period === '2w' ? 'income-period--on' : ''}" data-period="2w">
        <span class="income-period__label">2 недели</span>
        <span class="income-period__sum">${p14.toLocaleString('ru-RU')} ₽</span>
      </button>
      <button type="button" class="income-period ${_state.period === '1m' ? 'income-period--on' : ''}" data-period="1m">
        <span class="income-period__label">1 месяц</span>
        <span class="income-period__sum">${p30.toLocaleString('ru-RU')} ₽</span>
      </button>
    `;
    periods.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mult = btn.dataset.period === '1w' ? 7 : btn.dataset.period === '2w' ? 14 : 30;
        _state.period = btn.dataset.period;
        _state.amount = Math.round(car.rate * mult);
        _updateSumDisplay(root);
        _updatePeriodButtons(root);
        _updateDatesRow(root);
        _updateSubmit(root);
      });
    });
  }

  _updateSumDisplay(root);
  _updatePeriodButtons(root);
  _updateDatesRow(root);
  _updateSubmit(root);
}

function _updatePeriodButtons(root) {
  root.querySelectorAll('.income-period').forEach(btn => {
    const on = btn.dataset.period === _state.period;
    btn.classList.toggle('income-period--on', on);
  });
}

function _updateSumDisplay(root) {
  const el = root.querySelector('***REMOVED***income-sum-display');
  if (el) {
    el.textContent = `${Math.round(_state.amount).toLocaleString('ru-RU')} ₽`;
    el.classList.toggle('income-sum--warn', _state.amount <= 0);
  }
}

function _parseStartDate(car) {
  const raw = car.lastPaidDate;
  if (raw && /^\d{2}\.\d{2}\.\d{4}$/.test(raw.trim())) {
    const d = _parseDdMmYyyy(raw.trim());
    if (d) return d;
  }
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function _updateDatesRow(root) {
  const car = _selectedCar();
  const row = root.querySelector('***REMOVED***income-dates-row');
  const warnEl = root.querySelector('***REMOVED***income-warn');
  if (!car || !row || !warnEl) return;

  const rate = car.rate;
  const amt = _state.amount;

  if (!rate || amt <= 0) {
    row.classList.add('hidden');
    warnEl.classList.add('hidden');
    return;
  }

  row.classList.remove('hidden');
  const fullDays = Math.floor(amt / rate);
  const start = _parseStartDate(car);
  const end = _addDays(start, fullDays);
  const startStr = _fmtDdMmYyyy(start);
  const endStr = _fmtDdMmYyyy(end);

  row.innerHTML = `
    <span>Начало: <strong>${startStr}</strong></span>
    <span class="income-dates__arrow">→</span>
    <span>Конец: <strong>${endStr}</strong></span>
    <span class="income-dates__days">${fullDays} дн.</span>
  `;

  const remainder = amt - fullDays * rate;
  if (remainder > 0.001 && fullDays >= 0) {
    warnEl.classList.remove('hidden');
    warnEl.innerHTML =
      `Неполная оплата: остаток ${Math.round(remainder).toLocaleString('ru-RU')} ₽ — дата по последнему полному дню`;
  } else {
    warnEl.classList.add('hidden');
  }
}

function _updateSubmit(root) {
  const btn = root.querySelector('***REMOVED***income-submit');
  const car = _selectedCar();
  const ok = car && _state.amount > 0;
  if (btn) btn.disabled = !ok;
}

function _openNumpad(root) {
  _state.numpadOpen = true;
  _state.numpadBuf = _state.amount > 0 ? String(Math.round(_state.amount)) : '';
  _state.period = null;
  _updatePeriodButtons(root);

  const inlinePad = root.querySelector('***REMOVED***income-numpad-inline');
  const bottom = root.querySelector('***REMOVED***income-bottom');
  const keys = root.querySelector('***REMOVED***income-numpad-keys');
  if (!inlinePad || !bottom || !keys) return;

  inlinePad.classList.remove('hidden');
  bottom.classList.add('income-numpad-inline--open');

  const layout = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['C', '0', 'OK'],
  ];
  keys.innerHTML = layout
    .map(
      row =>
        `<div class="income-numpad__row">${row
          .map(k => `<button type="button" class="income-numpad__key" data-k="${k}">${k}</button>`)
          .join('')}</div>`,
    )
    .join('');

  keys.querySelectorAll('[data-k]').forEach(b => {
    b.addEventListener('click', () => _numpadKey(root, b.dataset.k));
  });
}

function _numpadKey(root, k) {
  if (k === 'C') {
    _state.numpadBuf = '';
  } else if (k === 'OK') {
    const n = parseInt(_state.numpadBuf, 10);
    _state.amount = isNaN(n) ? 0 : n;
    _state.period = null;
    _closeNumpad(root);
    _updateSumDisplay(root);
    _updatePeriodButtons(root);
    _updateDatesRow(root);
    _updateSubmit(root);
    return;
  } else if (_state.numpadBuf.length < 9) {
    _state.numpadBuf += k;
  }
  // Показываем набираемые цифры прямо во время ввода
  const el = root.querySelector('***REMOVED***income-sum-display');
  if (el) {
    const preview = _state.numpadBuf
      ? `${parseInt(_state.numpadBuf, 10).toLocaleString('ru-RU')} ₽`
      : '0 ₽';
    el.textContent = preview;
    el.classList.toggle('income-sum--warn', !_state.numpadBuf);
  }
}

function _closeNumpad(root) {
  _state.numpadOpen = false;
  const scope = root ?? document.getElementById('income-root');
  if (!scope) return;
  const inlinePad = scope.querySelector('***REMOVED***income-numpad-inline');
  const bottom = scope.querySelector('***REMOVED***income-bottom');
  inlinePad?.classList.add('hidden');
  bottom?.classList.remove('income-numpad-inline--open');
}

async function _submit(root) {
  const car = _selectedCar();
  if (!car) {
    root.querySelector('.income-cards-wrap')?.classList.add('income-cards--warn');
    showToast('Выберите машину', 'warning');
    return;
  }
  if (!_state.amount || _state.amount <= 0) {
    root.querySelector('***REMOVED***income-sum-display')?.classList.add('income-sum--flash');
    setTimeout(() => root.querySelector('***REMOVED***income-sum-display')?.classList.remove('income-sum--flash'), 400);
    showToast('Введите сумму', 'warning');
    return;
  }
  const rate = car.rate;
  if (!rate || rate <= 0) {
    showToast('Не задана ставка за день', 'error');
    return;
  }
  if (_state.amount < rate) {
    showToast('Сумма меньше ставки за 1 день', 'warning');
    return;
  }
  if (!car.driverId) {
    showToast('Нет водителя для этой машины', 'error');
    return;
  }

  const fullDays = Math.floor(_state.amount / rate);
  const start = _parseStartDate(car);
  const end = _addDays(start, fullDays);
  const dateFrom = _fmtDdMmYyyy(start);
  const dateTo = _fmtDdMmYyyy(end);

  const user = getCurrentUser();
  const kassa =
    user?.role === ROLES.OPERATIONS ? KASSA_ID.VLADIMIR : KASSA_ID.AZAMAT;
  const provelShort = (user?.name || 'Азамат').trim().split(/\s+/)[0] || 'Азамат';

  const btn = root.querySelector('***REMOVED***income-submit');
  if (btn) btn.disabled = true;

  try {
    await postAddIncome({
      car_id: car.carId,
      driver_id: car.driverId,
      amount: Math.round(_state.amount),
      date_from: dateFrom,
      date_to: dateTo,
      days: fullDays,
      rate: rate,
      comment: _state.comment
        ? `оплатил до ${_fmtShortDate(end)} · ${_state.comment}`
        : `оплатил до ${_fmtShortDate(end)}`,
      kassa_id: kassa,
      provel: provelShort,
    });

    invalidateCache(SHEETS.CARS);
    invalidateCache(SHEETS.DRIVERS);
    invalidateCache(SHEETS.RENTALS);
    invalidateCache(SHEETS.OPERATIONS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    invalidateLocalCache(CACHE_KEYS.DRIVERS);
    invalidateLocalCache(CACHE_KEYS.RENTALS);
    invalidateLocalCache(CACHE_KEYS.CASH_OPS);
    invalidateLocalCache(CACHE_KEYS.KASSAS);
    invalidateLocalCache(CACHE_KEYS.DASHBOARD);
    invalidateLocalCache(CACHE_KEYS.INCOME_FORM);

    showToast('Операция записана', 'success', 2000);
    const u = getCurrentUser();
    showScreen(u?.role === ROLES.INVESTOR ? 'screen-dashboard' : 'screen-home');
  } catch (e) {
    console.error(e);
    showToast(`Ошибка записи: ${e.message || e}`, 'error', 3000);
    if (btn) btn.disabled = false;
  }
}

// ─── Утилиты дат / строк ─────────────────────────────────────────────────────

function _parseDdMmYyyy(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function _fmtDdMmYyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function _fmtShortDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function _fmtShortFromDdMmYyyy(s) {
  const d = _parseDdMmYyyy(s);
  return d ? _fmtShortDate(d) : s;
}

function _addDays(date, days) {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  x.setDate(x.getDate() + Number(days));
  return x;
}

function _fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '7') {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  if (d.length === 10) {
    return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  }
  return p || '—';
}

function _initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[1][0]).toUpperCase();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&***REMOVED***39;');
}
