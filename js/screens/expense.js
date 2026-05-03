/**
 * expense.js — экран «Расход» для механика (касса K_AZAMAT).
 */

import { getFleet, postAction, invalidateCache } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js?v=7';
import { showToast } from '../ui.js';
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
  if (user?.role !== ROLES.MECHANIC) {
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

  try {
    const fleet = await getFleet();
    _state.cars = [...fleet].sort((a, b) =>
      String(a.carId || '').localeCompare(String(b.carId || ''), 'ru'),
    );
    _renderExpenseShell(root);
  } catch (err) {
    console.error(err);
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
}

function _calcClass(category, amount) {
  if (category === 'покупка_машины') return 'capex';
  if ((category === 'запчасти' || category === 'ремонт') && amount >= 30000) return 'capex';
  if (category === 'связь_глонасс' && amount >= 4000) return 'capex';
  if (category === 'ДТП' && amount >= 50000) return 'capex';
  return 'opex';
}

function _renderExpenseShell(root) {
  const catsHtml = EXPENSE_CATEGORIES.map(
    c => `
      <button type="button" class="expense-cat ${EXPENSE_CAT_FREQUENT.has(c.key) ? 'expense-cat--frequent' : ''}"
        data-cat="${escapeAttr(c.key)}">${escapeHtml(c.label)}</button>`,
  ).join('');

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
      <div class="expense-cats" id="expense-cats">${catsHtml}</div>

      <div class="expense-cars-wrap">
        <button type="button" class="expense-cars-toggle" id="expense-cars-toggle" aria-expanded="${_state.carsExpanded}">
          <span class="expense-cars-toggle__label">Машина</span>
          <span class="expense-cars-toggle__val" id="expense-car-summary">${_carSummaryText()}</span>
          <span class="expense-cars-toggle__chev" aria-hidden="true"></span>
        </button>
        <div class="expense-cars-list ${_state.carsExpanded ? '' : 'hidden'}" id="expense-cars-list">${carsRows}</div>
      </div>

      <button type="button" class="expense-sum-wrap" id="expense-sum-btn" aria-label="Сумма">
        <span class="expense-sum" id="expense-sum-display">0 ₽</span>
      </button>

      <label class="expense-comment-label">
        <input type="text" class="expense-comment" id="expense-comment" placeholder="Комментарий (необязательно)" maxlength="500" />
      </label>
    </div>

    <div class="expense-bottom">
      <button type="button" class="expense-submit btn-expense-submit" id="expense-submit" disabled>Записать расход</button>
    </div>

    <div class="expense-numpad-overlay hidden" id="expense-numpad-overlay"></div>
    <div class="expense-numpad hidden" id="expense-numpad" aria-hidden="true">
      <div class="expense-numpad__keys" id="expense-numpad-keys"></div>
    </div>
  `;

  document.getElementById('expense-back-btn2')?.addEventListener('click', () => {
    _closeNumpad(root);
    showScreen('screen-home');
  });

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

  pad.onclick = e => e.stopPropagation();
  overlay.onclick = () => _closeNumpad(root);
  requestAnimationFrame(() => pad?.classList.add('expense-numpad--visible'));
}

function _numpadKey(root, k) {
  if (k === 'C') {
    _state.numpadBuf = '';
  } else if (k === 'OK') {
    const n = parseInt(_state.numpadBuf, 10);
    _state.amount = isNaN(n) ? 0 : n;
    _closeNumpad(root);
    _updateSumDisplay(root);
    _updateSubmit(root);
    return;
  } else if (_state.numpadBuf.length < 9) {
    _state.numpadBuf += k;
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
  const cls = _calcClass(_state.category, amt);

  try {
    await postAction('ADD_OPERATION', {
      date: formatDate(new Date()),
      kassa_id: KASSA_ID.AZAMAT,
      direction: 'расход',
      amount: amt,
      type: _state.category,
      category: _state.category,
      car_id: _state.carId ?? '',
      driver_id: '',
      comment: _state.comment.trim(),
      provel: 'Азамат',
      класс_итог: cls,
    });

    invalidateCache(SHEETS.OPERATIONS);
    showToast('Расход записан', 'success', 2000);
    showScreen('screen-home');
  } catch (e) {
    console.error(e);
    showToast(`Ошибка: ${e.message || e}`, 'error', 3000);
    if (btn) btn.disabled = false;
  }
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
