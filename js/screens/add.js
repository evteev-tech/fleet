/**
 * add.js — экран добавления операции.
 *
 * Поддерживает три типа: ДОХОД / РАСХОД / ПЕРЕВОД.
 * Категории зависят от типа. Блок машины скрыт при ПЕРЕВОД.
 * Блок периода аренды показывается только при ДОХОД + аренда.
 * Касса: mechanic — фиксирована K_AZAMAT, operations — select.
 */

import { getFleet, postAction, invalidateCache } from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { getCurrentUser }                         from '../auth.js';
import { showScreen }                             from '../router.js?v=7';
import { showToast }                              from '../ui.js';
import { KASSA_ID, ROLES, CAR_STATUSES }          from '../config.js';

// ─── Категории по типу ────────────────────────────────────────────────────────
const CATEGORIES = {
  ДОХОД:    ['аренда', 'депозит_приём'],
  РАСХОД:   ['ремонт', 'ТО', 'запчасти', 'страховка', 'связь_глонасс',
             'ЗП', 'реклама', 'доставка', 'покупка_машины', 'штраф_ГИБДД', 'ДТП', 'прочее'],
  ПЕРЕВОД:  [],   // генерируется динамически
};

const TYPE_THEME = {
  ДОХОД:   { bg: 'var(--color-green-bg)',  text: 'var(--color-green)' },
  РАСХОД:  { bg: 'var(--color-red-bg)',    text: 'var(--color-red)'   },
  ПЕРЕВОД: { bg: 'var(--color-blue-bg)',   text: 'var(--color-blue)'  },
};

// ─── Состояние ────────────────────────────────────────────────────────────────
let _type    = 'ДОХОД';
let _fleet   = [];
let _submitting = false;

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initAdd() {
  // Слушаем prefill-событие от других экранов
  document.addEventListener('add:prefill', e => {
    const t = e.detail?.type;
    if (t === 'ДОХОД' || t === 'РАСХОД' || t === 'ПЕРЕВОД') _type = t;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId !== 'screen-add') return;
    const t = e.detail.addType;
    if (t === 'ДОХОД' || t === 'РАСХОД' || t === 'ПЕРЕВОД') _type = t;
    _openAdd();
  });

  // Кнопка «назад» в хедере
  document.getElementById('add-back')?.addEventListener('click', _goBack);
}

// ─── Открытие экрана ─────────────────────────────────────────────────────────
async function _openAdd() {
  const body = document.getElementById('add-body');
  if (!body) return;

  body.innerHTML = '';
  let filled = false;

  const applyFleet = raw => {
    filled = true;
    _fleet = raw.filter(c => c.status === CAR_STATUSES.RENT || c.status === CAR_STATUSES.IDLE);
    _renderForm(body);
  };

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => applyFleet(d),
    onFresh: d => applyFleet(d),
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) applyFleet([]);
    },
  });

  setTimeout(() => {
    if (!filled) {
      body.innerHTML = `<div class="loader-wrap"><div class="spinner"></div></div>`;
    }
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕНДЕР ФОРМЫ
// ═══════════════════════════════════════════════════════════════════════════

function _renderForm(body) {
  const user   = getCurrentUser();
  const isMech = user?.role === ROLES.MECHANIC;
  const today  = _todayISO();

  body.innerHTML = `
    <div class="add-form">

      <!-- Переключатель типа -->
      <div class="add-tabs" id="add-tabs">
        ${['ДОХОД','РАСХОД','ПЕРЕВОД'].map(t => `
          <button class="add-tab ${t === _type ? 'add-tab--active' : ''}"
                  data-type="${t}"
                  style="${t === _type ? `background:${TYPE_THEME[t].bg};color:${TYPE_THEME[t].text}` : ''}">
            ${t}
          </button>
        `).join('')}
      </div>

      <!-- Дата -->
      <div class="add-field" id="wrap-date">
        <label class="add-label">Дата</label>
        <input id="add-date" class="field-input" type="date" value="${today}" />
        <div class="add-field-err hidden" id="err-date"></div>
      </div>

      <!-- Категория -->
      <div class="add-field" id="wrap-cat">
        <label class="add-label">Категория</label>
        <select id="add-cat" class="field-input">
          ${_catOptions(user)}
        </select>
        <div class="add-field-err hidden" id="err-cat"></div>
      </div>

      <!-- Блок периода аренды (скрыт по умолчанию) -->
      <div class="add-rental-period" id="add-rental-period">
        <div class="add-field">
          <label class="add-label">С</label>
          <input id="add-rent-from" class="field-input" type="date" value="${today}" />
        </div>
        <div class="add-field">
          <label class="add-label">По</label>
          <input id="add-rent-to" class="field-input" type="date" value="${today}" />
          <div class="add-field-err hidden" id="err-period"></div>
        </div>
      </div>

      <!-- Сумма -->
      <div class="add-field" id="wrap-amount">
        <label class="add-label">Сумма, ₽</label>
        <input id="add-amount" class="field-input add-amount-input"
          type="number" inputmode="decimal" placeholder="0" min="0" />
        <div class="add-field-err hidden" id="err-amount"></div>
      </div>

      <!-- Касса -->
      <div class="add-field" id="wrap-kassa">
        <label class="add-label">Касса</label>
        ${isMech
          ? `<div class="add-kassa-fixed">Касса Азамата</div>`
          : `<select id="add-kassa" class="field-input">
               <option value="">— выбрать —</option>
               <option value="${KASSA_ID.AZAMAT}">K_AZAMAT</option>
               <option value="${KASSA_ID.VLADIMIR}">K_VLADIMIR</option>
               <option value="${KASSA_ID.YULIA}">K_YULIA</option>
             </select>`
        }
        <div class="add-field-err hidden" id="err-kassa"></div>
      </div>

      <!-- Машина (скрыта при ПЕРЕВОД) -->
      <div class="add-field" id="wrap-car">
        <label class="add-label">Машина</label>
        <select id="add-car" class="field-input">
          <option value="">— выбрать —</option>
          ${_fleet.map(c => `<option value="${c.carId}">${c.carId}${c.name ? ' · ' + c.name : ''}</option>`).join('')}
        </select>
        <div class="add-field-err hidden" id="err-car"></div>
      </div>

      <!-- Комментарий -->
      <div class="add-field">
        <label class="add-label">Комментарий</label>
        <textarea id="add-comment" class="field-input" rows="2"
          placeholder="Необязательно…"></textarea>
      </div>

      <!-- Кнопка -->
      <button class="btn-primary" id="add-submit">Записать</button>

    </div>
  `;

  _applyTypeUI();
  _bindFormEvents(user);
}

// ═══════════════════════════════════════════════════════════════════════════
// СОБЫТИЯ ФОРМЫ
// ═══════════════════════════════════════════════════════════════════════════

function _bindFormEvents(user) {
  // ── Переключатель типа ────────────────────────────────────────────────────
  document.getElementById('add-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-type]');
    if (!btn || btn.dataset.type === _type) return;
    _type = btn.dataset.type;

    // Перекраска табов
    document.querySelectorAll('.add-tab').forEach(b => {
      const active = b.dataset.type === _type;
      b.classList.toggle('add-tab--active', active);
      b.style.background = active ? TYPE_THEME[_type].bg : '';
      b.style.color      = active ? TYPE_THEME[_type].text : '';
    });

    // Обновить категории и видимость блоков
    const catSel = document.getElementById('add-cat');
    if (catSel) catSel.innerHTML = _catOptions(user);

    _applyTypeUI();
    _clearErrors();
  });

  // ── Автопоказ блока периода при смене категории ───────────────────────────
  document.getElementById('add-cat')?.addEventListener('change', _applyTypeUI);

  // ── Отправка ──────────────────────────────────────────────────────────────
  document.getElementById('add-submit')?.addEventListener('click', () => _submit(user));
}

// ─── Применить видимость блоков под текущий type + cat ─────────────────────
function _applyTypeUI() {
  const cat     = document.getElementById('add-cat')?.value ?? '';
  const isXfer  = _type === 'ПЕРЕВОД';
  const isRent  = _type === 'ДОХОД' && cat === 'аренда';

  // Машина — скрыть при ПЕРЕВОД
  const wrapCar = document.getElementById('wrap-car');
  if (wrapCar) wrapCar.style.display = isXfer ? 'none' : '';

  // Период аренды — показать только при аренда
  const period = document.getElementById('add-rental-period');
  if (period) {
    if (isRent) {
      period.classList.add('add-rental-period--open');
    } else {
      period.classList.remove('add-rental-period--open');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ВАЛИДАЦИЯ И ОТПРАВКА
// ═══════════════════════════════════════════════════════════════════════════

async function _submit(user) {
  if (_submitting) return;
  _clearErrors();

  const isMech   = user?.role === ROLES.MECHANIC;
  const isXfer   = _type === 'ПЕРЕВОД';
  const cat      = document.getElementById('add-cat')?.value ?? '';
  const isRent   = _type === 'ДОХОД' && cat === 'аренда';

  // ── Сбор значений ──────────────────────────────────────────────────────
  const dateISO  = document.getElementById('add-date')?.value ?? '';
  const amount   = parseFloat(document.getElementById('add-amount')?.value ?? '');
  const kassaId  = isMech
    ? KASSA_ID.AZAMAT
    : (document.getElementById('add-kassa')?.value ?? '');
  const carId    = document.getElementById('add-car')?.value ?? '';
  const comment  = document.getElementById('add-comment')?.value.trim() ?? '';
  const rentFrom = document.getElementById('add-rent-from')?.value ?? '';
  const rentTo   = document.getElementById('add-rent-to')?.value ?? '';

  // ── Валидация (строгий порядок) ────────────────────────────────────────
  let hasError = false;

  if (!dateISO)              { _fieldErr('err-date',   'wrap-date',   'Укажите дату');           hasError = true; }
  if (!cat)                  { _fieldErr('err-cat',    'wrap-cat',    'Выберите категорию');      hasError = true; }
  if (!amount || amount <= 0){ _fieldErr('err-amount', 'wrap-amount', 'Введите сумму');           hasError = true; }
  if (!kassaId && !isMech)   { _fieldErr('err-kassa',  'wrap-kassa',  'Выберите кассу');          hasError = true; }
  if (!isXfer && !carId)     { _fieldErr('err-car',    'wrap-car',    'Выберите машину');         hasError = true; }
  if (isRent) {
    if (!rentFrom || !rentTo) {
      _fieldErr('err-period', null, 'Укажите период');                                            hasError = true;
    } else if (rentFrom > rentTo) {
      _fieldErr('err-period', null, '«С» должна быть не позже «По»');                            hasError = true;
    }
  }

  if (hasError) return;

  // ── Отправка ─────────────────────────────────────────────────────────────
  const btn = document.getElementById('add-submit');
  _submitting = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

  const dateFormatted = _isoToDDMMYYYY(dateISO);
  const direction     = _type === 'ДОХОД' ? 'приход' : 'расход';

  try {
    await postAction('ADD_OPERATION', {
      date:      dateFormatted,
      kassa_id:  kassaId,
      direction: isXfer ? 'перевод' : direction,
      amount,
      type:      cat,
      category:  cat,
      car_id:    carId,
      driver_id: '',
      comment,
      provel:    user?.name ?? '',
    });

    // Дополнительно: если аренда — создаём запись в листе Аренда
    if (isRent && carId) {
      await postAction('ADD_RENTAL', {
        car_id:     carId,
        driver_id:  '',
        date_start: _isoToDDMMYYYY(rentFrom),
        date_end:   _isoToDDMMYYYY(rentTo),
        rate_day:   0,
        comment,
      }).catch(() => {}); // не блокируем если не удалось
    }

    invalidateCache('Касса_операции');
    invalidateLocalCache(CACHE_KEYS.CASH_OPS);
    invalidateLocalCache(CACHE_KEYS.KASSAS);
    invalidateLocalCache(CACHE_KEYS.DASHBOARD);
    if (isRent && carId) {
      invalidateLocalCache(CACHE_KEYS.RENTALS);
      invalidateLocalCache(CACHE_KEYS.INCOME_FORM);
    }
    showToast('Записано ✓', 'success');
    _resetForm(isMech, dateISO, kassaId);

  } catch (err) {
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка отправки', 'error');
  } finally {
    _submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Записать'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

/** Генерирует <option> для select категорий */
function _catOptions(user) {
  const isMech = user?.role === ROLES.MECHANIC;

  if (_type === 'ПЕРЕВОД') {
    const kassaFrom = isMech ? KASSA_ID.AZAMAT : null;
    const all = [
      { id: KASSA_ID.AZAMAT,   label: 'K_AZAMAT → ...' },
      { id: KASSA_ID.VLADIMIR, label: 'K_VLADIMIR → ...' },
      { id: KASSA_ID.YULIA,    label: 'K_YULIA → ...' },
    ];
    return `<option value="">— выбрать —</option>` +
      all.filter(k => k.id !== kassaFrom)
         .map(k => `<option value="${k.id}">${k.label}</option>`)
         .join('');
  }

  const cats = CATEGORIES[_type] ?? [];
  return `<option value="">— выбрать —</option>` +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

/** Показывает ошибку под полем */
function _fieldErr(errId, wrapId, msg) {
  const errEl  = document.getElementById(errId);
  const wrapEl = wrapId ? document.getElementById(wrapId) : null;
  if (errEl)  { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  if (wrapEl) {
    const input = wrapEl.querySelector('input, select, textarea');
    if (input) input.classList.add('field-input--error');
  }
}

function _clearErrors() {
  document.querySelectorAll('.add-field-err').forEach(el => {
    el.classList.add('hidden');
    el.textContent = '';
  });
  document.querySelectorAll('.field-input--error').forEach(el => {
    el.classList.remove('field-input--error');
  });
}

/** Сброс формы после успешной отправки */
function _resetForm(isMech, savedDate, savedKassa) {
  _type = 'ДОХОД';
  const body = document.getElementById('add-body');
  if (!body) return;

  // Перерендериваем форму
  const user = getCurrentUser();
  _renderForm(body);

  // operations: восстанавливаем дату и кассу
  if (!isMech) {
    const dateEl  = document.getElementById('add-date');
    const kassaEl = document.getElementById('add-kassa');
    if (dateEl)  dateEl.value  = savedDate;
    if (kassaEl) kassaEl.value = savedKassa;
  }
}

function _goBack() {
  const user = getCurrentUser();
  showScreen(user?.role === ROLES.MECHANIC ? 'screen-home' : 'screen-dashboard');
}

function _todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _isoToDDMMYYYY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
