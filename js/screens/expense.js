/**
 * expense.js — экран «Расход» для mechanic (K_AZAMAT) и operations (выбор кассы / CAPEX).
 */

import { getFleet, postAction, invalidateCache } from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { KASSA_ID, ROLES, SHEETS } from '../config.js';
import { formatDate } from '../utils/date.js';

const EXPENSE_CATEGORIES = [
  { key: 'ремонт', label: 'Ремонт' },
  { key: 'запчасти', label: 'Запчасти' },
  { key: 'доставка', label: 'Доставка' },
  { key: 'реклама', label: 'Реклама' },
  { key: 'ЗП', label: 'ЗП' },
  { key: 'страховка', label: 'Страховка' },
  { key: 'связь_глонасс', label: 'Глонасс' },
  { key: 'ТО', label: 'ТО' },
  { key: 'штраф_ГИБДД', label: 'Штраф ГИБДД' },
  { key: 'ДТП', label: 'ДТП' },
  { key: 'прочее', label: 'Прочее' },
  { key: 'покупка_машины', label: 'Покупка авто' },
];

/** Первые четыре — чаще всего */
const EXPENSE_CAT_FREQUENT = new Set(['ремонт', 'запчасти', 'доставка', 'реклама']);

/** При выборе — автоматически раскрыть список машин */
const EXPENSE_AUTO_EXPAND_CARS = new Set([
  'ремонт',
  'запчасти',
  'доставка',
  'ТО',
  'страховка',
  'связь_глонасс',
  'штраф_ГИБДД',
  'ДТП',
]);

/** @type {{
 *   cars: object[],
 *   category: string|null,
 *   carId: string|null,
 *   amount: number,
 *   comment: string,
 *   numpadOpen: boolean,
 *   numpadBuf: string,
 *   carsExpanded: boolean,
 *   kassaId: string|null,
 *   isCapex: boolean,
 * }} */
let _state = {
  cars: [],
  category: null,
  carId: null,
  amount: 0,
  comment: '',
  numpadOpen: false,
  numpadBuf: '',
  carsExpanded: false,
  kassaId: null,
  isCapex: false,
};

export function initExpense() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-expense') void renderExpense();
  });
}

export async function renderExpense() {
  const root = document.getElementById('expense-root');
  if (!root) return;

  const user = getCurrentUser();
  const isOperations = user?.role === ROLES.OPERATIONS;
  const isMechanic = user?.role === ROLES.MECHANIC;
  if (!isMechanic && !isOperations) {
    showScreen('screen-home');
    return;
  }

  _state = {
    cars: [],
    category: null,
    carId: null,
    amount: 0,
    comment: '',
    numpadOpen: false,
    numpadBuf: '',
    carsExpanded: false,
    kassaId: isOperations ? KASSA_ID.VLADIMIR : KASSA_ID.AZAMAT,
    isCapex: false,
  };

  root.innerHTML = `
    <header class="expense-header">
      <button type="button" class="btn-icon expense-header__back" id="expense-back-btn" aria-label="Назад">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h1 class="expense-header__title">Расход</h1>
      <div class="expense-header__spacer"></div>
    </header>
    <div class="expense-loading">Загрузка…</div>
  `;

  document.getElementById('expense-back-btn')?.addEventListener('click', () => {
    _closeNumpad(root);
    showScreen('screen-home');
  });

  const loadingEl = root.querySelector('.expense-loading');
  let filled = false;

  const applyFleet = fleet => {
    filled = true;
    if (loadingEl) loadingEl.remove();
    _state.cars = [...fleet].sort((a, b) =>
      String(a.carId || '').localeCompare(String(b.carId || ''), 'ru'),
    );
    _renderExpenseShell(root);
  };

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => applyFleet(d),
    onFresh: d => applyFleet(d),
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) {
        console.error('expense load');
        root.innerHTML = `
      <header class="expense-header">
        <button type="button" class="btn-icon expense-header__back" id="expense-back-err">
          <svg width="20" height="20" viewBox="0 0 20 20"><path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
        </button>
        <h1 class="expense-header__title">Расход</h1>
        <div class="expense-header__spacer"></div>
      </header>
      <div class="expense-error">Не удалось загрузить данные</div>
    `;
        document.getElementById('expense-back-err')?.addEventListener('click', () => showScreen('screen-home'));
      }
    },
  });

  setTimeout(() => {
    if (!filled && loadingEl?.parentNode) {
      loadingEl.textContent = 'Загрузка…';
    }
  }, 0);
}

function _calcClass(category, amount) {
  if (category === 'покупка_машины') return 'capex';
  if ((category === 'запчасти' || category === 'ремонт') && amount >= 30000) return 'capex';
  if (category === 'связь_глонасс' && amount >= 4000) return 'capex';
  if (category === 'ДТП' && amount >= 50000) return 'capex';
  return 'opex';
}

function _renderExpenseShell(root) {
  const user = getCurrentUser();
  const isOperations = user?.role === ROLES.OPERATIONS;

  const catsHtml = EXPENSE_CATEGORIES.map(
    c => `
      <button type="button" class="expense-cat ${EXPENSE_CAT_FREQUENT.has(c.key) ? 'expense-cat--frequent' : ''}"
        data-cat="${escapeAttr(c.key)}">${escapeHtml(c.label)}</button>`,
  ).join('');

  const opsKassaCapexHtml = isOperations
    ? `
      <div class="expense-kassa-wrap" id="expense-kassa-wrap">
        <div class="expense-kassa-label">Касса</div>
        <div class="expense-kassa-btns" id="expense-kassa-btns">
          <button type="button" class="expense-kassa-btn expense-kassa-btn--active"
            data-kassa="${escapeAttr(KASSA_ID.VLADIMIR)}">Владимир</button>
          <button type="button" class="expense-kassa-btn"
            data-kassa="${escapeAttr(KASSA_ID.YULIA)}">Юлия</button>
        </div>
      </div>

      <label class="expense-capex-wrap" id="expense-capex-wrap">
        <input type="checkbox" id="expense-capex-check" />
        <span class="expense-capex-label">Капекс</span>
        <span class="expense-capex-hint">отметить если крупное вложение</span>
      </label>`
    : '';

  const carsRows = [
    `<button type="button" class="expense-car-item expense-car-item--selected" data-car-id="">Без машины</button>`,
    ..._state.cars.map(c => {
      const meta = [c.name, c.color].filter(Boolean).join(' · ');
      return `
        <button type="button" class="expense-car-item" data-car-id="${escapeAttr(c.carId)}">
          <span class="expense-car-item__id">${escapeHtml(c.carId)}</span>
          ${meta ? `<span class="expense-car-item__meta">${escapeHtml(meta)}</span>` : ''}
        </button>`;
    }),
  ].join('');

  root.innerHTML = `
    <header class="expense-header">
      <button type="button" class="btn-icon expense-header__back" id="expense-back-btn2">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h1 class="expense-header__title">Расход</h1>
      <div class="expense-header__spacer"></div>
    </header>

    <div class="expense-scroll">
      <button type="button" class="expense-sum-wrap" id="expense-sum-btn" aria-label="Сумма">
        <span class="expense-sum" id="expense-sum-display">0 ₽</span>
      </button>

      <div class="expense-cats" id="expense-cats">${catsHtml}</div>
${opsKassaCapexHtml}
      <div class="expense-cars-wrap">
        <button type="button" class="expense-cars-toggle" id="expense-cars-toggle" aria-expanded="${_state.carsExpanded}">
          <span class="expense-cars-toggle__label">Машина</span>
          <span class="expense-cars-toggle__val" id="expense-car-summary">${_carSummaryText()}</span>
          <span class="expense-cars-toggle__chev" aria-hidden="true"></span>
        </button>
        <div class="expense-cars-list ${_state.carsExpanded ? '' : 'hidden'}" id="expense-cars-list">${carsRows}</div>
      </div>

      <label class="expense-comment-label">
        <input type="text" class="expense-comment" id="expense-comment" placeholder="Комментарий (необязательно)" maxlength="500" />
      </label>
    </div>

    <div class="expense-bottom">
      <button type="button" class="expense-submit btn-expense-submit" id="expense-submit" disabled>Записать расход</button>
    </div>

    <div class="expense-numpad-overlay hidden" id="expense-numpad-overlay"></div>
    <div class="expense-numpad hidden" id="expense-numpad" aria-hidden="true">
      <div class="expense-numpad__display" id="expense-numpad-display">0 ₽</div>
      <div class="expense-numpad__keys" id="expense-numpad-keys"></div>
    </div>
  `;

  document.getElementById('expense-back-btn2')?.addEventListener('click', () => {
    _closeNumpad(root);
    showScreen('screen-home');
  });

  if (isOperations) {
    root.querySelectorAll('***REMOVED***expense-kassa-btns .expense-kassa-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kid = btn.dataset.kassa;
        if (!kid) return;
        _state.kassaId = kid;
        root.querySelectorAll('***REMOVED***expense-kassa-btns .expense-kassa-btn').forEach(b => {
          b.classList.toggle('expense-kassa-btn--active', b.dataset.kassa === kid);
        });
      });
    });

    document.getElementById('expense-capex-check')?.addEventListener('change', e => {
      _state.isCapex = e.target.checked;
    });
  }

  root.querySelectorAll('.expense-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.cat;
      _state.category = k || null;
      root.querySelectorAll('.expense-cat').forEach(b => {
        b.classList.toggle('expense-cat--selected', b.dataset.cat === k);
      });
      root.querySelector('***REMOVED***expense-cats')?.classList.remove('expense-cats--warn');
      if (k && EXPENSE_AUTO_EXPAND_CARS.has(k)) _state.carsExpanded = true;
      _syncCarsPanel(root);
      _updateSubmit(root);
    });
  });

  document.getElementById('expense-cars-toggle')?.addEventListener('click', () => {
    _state.carsExpanded = !_state.carsExpanded;
    _syncCarsPanel(root);
  });

  root.querySelectorAll('.expense-car-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.carId === '' || btn.dataset.carId === undefined ? null : btn.dataset.carId;
      _state.carId = id;
      root.querySelectorAll('.expense-car-item').forEach(b => {
        const bid = b.dataset.carId === '' || b.dataset.carId === undefined ? null : b.dataset.carId;
        b.classList.toggle('expense-car-item--selected', bid === id);
      });
      document.getElementById('expense-car-summary') &&
        (document.getElementById('expense-car-summary').textContent = _carSummaryText());
    });
  });

  document.getElementById('expense-sum-btn')?.addEventListener('click', () => _openNumpad(root));

  document.getElementById('expense-comment')?.addEventListener('input', e => {
    _state.comment = e.target.value ?? '';
  });

  document.getElementById('expense-submit')?.addEventListener('click', () => _submit(root));

  _updateSumDisplay(root);
  _syncCarsPanel(root);
  _updateSubmit(root);
}

function _carSummaryText() {
  if (!_state.carId) return 'Без машины';
  const c = _state.cars.find(x => x.carId === _state.carId);
  return c ? `${c.carId}${c.name ? ` · ${c.name}` : ''}` : String(_state.carId);
}

function _syncCarsPanel(root) {
  const list = root.querySelector('***REMOVED***expense-cars-list');
  const toggle = root.querySelector('***REMOVED***expense-cars-toggle');
  const summary = root.querySelector('***REMOVED***expense-car-summary');
  if (list) list.classList.toggle('hidden', !_state.carsExpanded);
  if (toggle) toggle.setAttribute('aria-expanded', _state.carsExpanded ? 'true' : 'false');
  toggle?.classList.toggle('expense-cars-toggle--open', _state.carsExpanded);
  if (summary) summary.textContent = _carSummaryText();
}

function _updateSumDisplay(root) {
  const el = root.querySelector('***REMOVED***expense-sum-display');
  if (el) {
    el.textContent = `${Math.round(_state.amount).toLocaleString('ru-RU')} ₽`;
    el.classList.toggle('expense-sum--warn', _state.amount <= 0);
  }
}

function _updateSubmit(root) {
  const btn = root.querySelector('***REMOVED***expense-submit');
  const ok = _state.category !== null && _state.amount > 0;
  if (btn) btn.disabled = !ok;
}

function _syncExpenseNumpadDisplay(root) {
  const scope = root ?? document.getElementById('expense-root');
  const disp = scope?.querySelector('***REMOVED***expense-numpad-display');
  if (disp) {
    const n = _state.numpadBuf || '0';
    disp.textContent = Number(n).toLocaleString('ru-RU') + ' ₽';
  }
}

function _openNumpad(root) {
  _state.numpadOpen = true;
  _state.numpadBuf = _state.amount > 0 ? String(Math.round(_state.amount)) : '';

  const overlay = root.querySelector('***REMOVED***expense-numpad-overlay');
  const pad = root.querySelector('***REMOVED***expense-numpad');
  const keys = root.querySelector('***REMOVED***expense-numpad-keys');
  if (!overlay || !pad || !keys) return;

  overlay.classList.remove('hidden');
  pad.classList.remove('hidden');

  const layout = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['C', '0', 'OK'],
  ];
  keys.innerHTML = layout
    .map(
      row =>
        `<div class="expense-numpad__row">${row
          .map(k => `<button type="button" class="expense-numpad__key" data-k="${k}">${k}</button>`)
          .join('')}</div>`,
    )
    .join('');

  keys.querySelectorAll('[data-k]').forEach(b => {
    b.addEventListener('click', () => _numpadKey(root, b.dataset.k));
  });

  _syncExpenseNumpadDisplay(root);

  pad.onclick = e => e.stopPropagation();
  overlay.onclick = () => _closeNumpad(root);
  requestAnimationFrame(() => pad?.classList.add('expense-numpad--visible'));
}

function _numpadKey(root, k) {
  if (k === 'C') {
    _state.numpadBuf = '';
    _syncExpenseNumpadDisplay(root);
  } else if (k === 'OK') {
    const n = parseInt(_state.numpadBuf, 10);
    _state.amount = isNaN(n) ? 0 : n;
    _closeNumpad(root);
    _updateSumDisplay(root);
    _updateSubmit(root);
    return;
  } else if (_state.numpadBuf.length < 9) {
    _state.numpadBuf += k;
    _syncExpenseNumpadDisplay(root);
  }
}

function _closeNumpad(root) {
  _state.numpadOpen = false;
  const scope = root ?? document.getElementById('expense-root');
  if (!scope) return;
  const overlay = scope.querySelector('***REMOVED***expense-numpad-overlay');
  const pad = scope.querySelector('***REMOVED***expense-numpad');
  if (!overlay && !pad) return;
  pad?.classList.remove('expense-numpad--visible');
  overlay?.classList.add('hidden');
  setTimeout(() => pad?.classList.add('hidden'), 280);
}

async function _submit(root) {
  if (_state.category === null) {
    root.querySelector('***REMOVED***expense-cats')?.classList.add('expense-cats--warn');
    showToast('Выберите категорию', 'warning');
    return;
  }
  if (_state.amount <= 0) {
    root.querySelector('***REMOVED***expense-sum-display')?.classList.add('expense-sum--flash');
    setTimeout(() => root.querySelector('***REMOVED***expense-sum-display')?.classList.remove('expense-sum--flash'), 400);
    showToast('Введите сумму', 'warning');
    return;
  }

  const btn = root.querySelector('***REMOVED***expense-submit');
  if (btn) btn.disabled = true;

  const amt = Math.round(_state.amount);
  const submitUser = getCurrentUser();
  const isOperations = submitUser?.role === ROLES.OPERATIONS;
  const cls =
    isOperations && _state.isCapex
      ? 'capex'
      : _calcClass(_state.category, amt);

  try {
    await postAction('ADD_OPERATION', {
      date: formatDate(new Date()),
      kassa_id: _state.kassaId,
      direction: 'расход',
      amount: amt,
      type: 'расход',
      category: _state.category,
      car_id: _state.carId ?? '',
      driver_id: '',
      comment: _state.comment.trim(),
      provel: isOperations ? 'Владимир' : 'Азамат',
      class_override: cls,
    });

    invalidateCache(SHEETS.OPERATIONS);
    invalidateLocalCache(CACHE_KEYS.CASH_OPS);
    invalidateLocalCache(CACHE_KEYS.KASSAS);
    invalidateLocalCache(CACHE_KEYS.DASHBOARD);
    showToast('Расход записан', 'success', 2000);
    const isTO = String(_state.category || '').toLowerCase() === 'то';
    const hasCar = !!_state.carId;

    if (isTO && hasCar) {
      const cars = _getCachedCars();
      const car = cars?.find(c => c.carId === _state.carId) ?? null;
      _openMileageSheet(car, _state.comment);
      return;
    }

    showScreen('screen-home');
  } catch (e) {
    console.error(e);
    showToast(`Ошибка: ${e.message || e}`, 'error', 3000);
    if (btn) btn.disabled = false;
  }
}

function _getCachedCars() {
  try {
    const raw = localStorage.getItem('fleet_cache_' + CACHE_KEYS.CARS);
    if (!raw) return [];
    const entry = JSON.parse(raw);
    return entry?.data ?? [];
  } catch {
    return [];
  }
}

function _openMileageSheet(car, prefillComment = '') {
  const carLabel = car
    ? `${car.carId}${car.name ? ' · ' + car.name : ''}`
    : 'машина';
  const currentMileage = car?.mileage ?? '';
  const commentSafe = escapeAttr(prefillComment ?? '');

  showBottomSheet(`
    <div class="mileage-sheet">
      <p class="mileage-sheet__title">Сбросить счётчик ТО?</p>
      <p class="mileage-sheet__sub">
        Вы записали ТО на ${escapeHtml(carLabel)} — зафиксируем пробег?
      </p>

      <div class="mileage-sheet__field">
        <label class="mileage-sheet__label">Пробег сейчас, км</label>
        <input
          id="ms-mileage"
          type="number"
          inputmode="numeric"
          class="mileage-sheet__input"
          placeholder="${currentMileage || '0'}"
          value="${currentMileage || ''}"
        />
      </div>

      <div class="mileage-sheet__field">
        <label class="mileage-sheet__label">Что сделали</label>
        <input
          id="ms-comment"
          type="text"
          class="mileage-sheet__input"
          placeholder="Замена масла, фильтры..."
          value="${commentSafe}"
        />
      </div>

      <div class="mileage-sheet__field">
        <label class="mileage-sheet__label">Следующее ТО через, км</label>
        <input
          id="ms-interval"
          type="number"
          inputmode="numeric"
          class="mileage-sheet__input"
          placeholder="5000"
          value="5000"
        />
      </div>

      <button type="button" class="btn-primary" id="ms-submit" style="margin-top:4px">
        Зафиксировать
      </button>
      <button type="button" class="btn-secondary" id="ms-skip" style="margin-top:8px">
        Пропустить
      </button>
    </div>
  `);

  setTimeout(() => {
    document.getElementById('ms-skip')?.addEventListener('click', () => {
      hideBottomSheet(() => showScreen('screen-home'));
    });

    document.getElementById('ms-submit')?.addEventListener('click', async () => {
      if (!car?.carId) {
        showToast('Машина не найдена', 'error');
        return;
      }

      const mileage = parseInt(document.getElementById('ms-mileage')?.value, 10);
      const comment = document.getElementById('ms-comment')?.value?.trim() || '';
      const interval = parseInt(document.getElementById('ms-interval')?.value, 10) || 5000;

      if (!mileage || mileage <= 0) {
        showToast('Введите пробег', 'error');
        return;
      }

      const btn = document.getElementById('ms-submit');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Сохраняем…';
      }

      try {
        await postAction('UPDATE_CAR_MILEAGE', {
          car_id: car.carId,
          mileage,
          next_to_mileage: mileage + interval,
          comment,
        });

        invalidateCache(SHEETS.CARS);
        invalidateLocalCache(CACHE_KEYS.CARS);

        showToast(`ТО зафиксировано · ${car.carId} ✓`, 'success');
        hideBottomSheet(() => showScreen('screen-home'));
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Зафиксировать';
        }
        showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
      }
    });
  }, 0);
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
