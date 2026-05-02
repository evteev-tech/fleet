/**
 * history.js — история операций.
 *
 * Фильтры: месяц, тип, машина, касса.
 * mechanic — всегда K_AZAMAT, selectedKassa игнорируется.
 * Бесконечный скролл: 20 записей через IntersectionObserver.
 * Клик по строке — bottomsheet с деталями (read-only).
 */

import { getOperations, getFleet } from '../api.js';
import { getCurrentUser }          from '../auth.js';
import { showBottomSheet }         from '../ui.js';
import { KASSA_ID, ROLES }         from '../config.js';

// ─── Состояние фильтров ───────────────────────────────────────────────────────
const _now = new Date();
let _selMonth = _now.getMonth() + 1;
let _selYear  = _now.getFullYear();
let _selType  = 'все';      // 'все' | 'аренда' | 'расход' | 'перевод'
let _selCar   = null;       // car_id или null
let _selKassa = null;       // kassa_id или null

const _PAGE = 20;
let _filtered  = [];
let _offset    = 0;
let _observer  = null;

// ─── Конфиг типов-чипов ────────────────────────────────────────────────────────
const TYPE_CHIPS = [
  { id: 'все',     label: 'Все' },
  { id: 'аренда',  label: 'Доходы' },
  { id: 'расход',  label: 'Расходы' },
  { id: 'перевод', label: 'Переводы' },
];

// ─── Цвета и знаки для direction ──────────────────────────────────────────────
const DIR_META = {
  приход:  { color: 'var(--color-green)', sign: '+', bg: 'var(--color-green-bg)' },
  расход:  { color: 'var(--color-red)',   sign: '−', bg: 'var(--color-red-bg)'   },
  перевод: { color: 'var(--color-blue)',  sign: '⇄', bg: 'var(--color-blue-bg)'  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initHistory() {
  // Фильтр из dashboard (касса) или home (ничего)
  document.addEventListener('history:filter', e => {
    const { kassaId } = e.detail ?? {};
    if (kassaId) _selKassa = kassaId;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-history') renderHistory();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export async function renderHistory() {
  const body = document.getElementById('history-body');
  if (!body) return;

  const user    = getCurrentUser();
  const isMech  = user?.role === ROLES.MECHANIC;

  _offset = 0;
  _destroyObserver();

  // ── Скелетон ─────────────────────────────────────────────────────────────
  body.innerHTML = _skeletonHTML();

  // ── Загрузка ─────────────────────────────────────────────────────────────
  let rawOps, fleet;
  try {
    const kassaFilter = isMech ? KASSA_ID.AZAMAT : null;
    [rawOps, fleet] = await Promise.all([
      getOperations({ kassaId: kassaFilter }),
      getFleet(),
    ]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('hist-retry')?.addEventListener('click', renderHistory);
    return;
  }

  // ── Применить фильтры ─────────────────────────────────────────────────────
  _filtered = _applyFilters(rawOps, isMech);

  // ── Рендер оболочки ───────────────────────────────────────────────────────
  body.innerHTML = `
    <!-- ХЕДЕР С ФИЛЬТРАМИ -->
    <div class="hist-hdr">
      <div class="hist-hdr__top">
        <span class="app-logo">История</span>
        <span class="hist-count" id="hist-count">${_filtered.length} операций</span>
      </div>

      <!-- Переключатель месяца -->
      <div class="hist-month-sw">
        <button class="hist-month-btn" id="hist-prev">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="hist-month-label" id="hist-month-label">${_monthLabel()}</span>
        <button class="hist-month-btn" id="hist-next">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- Тип-чипы -->
      <div class="hist-chips" id="hist-type-chips">
        ${TYPE_CHIPS.map(c => `
          <button class="hist-chip ${_selType === c.id ? 'hist-chip--active' : ''}"
                  data-chip-type="${c.id}">
            ${c.label}
          </button>
        `).join('')}

        <!-- Машина -->
        <button class="hist-chip ${_selCar ? 'hist-chip--active' : ''}" id="hist-chip-car">
          ${_selCar ? (_carLabel(fleet, _selCar)) : 'Машина ↓'}
        </button>

        <!-- Касса (только не mechanic) -->
        ${!isMech ? `
          <button class="hist-chip ${_selKassa ? 'hist-chip--active' : ''}" id="hist-chip-kassa">
            ${_selKassa ? _selKassa : 'Касса ↓'}
          </button>
        ` : ''}
      </div>
    </div>

    <!-- СПИСОК -->
    <div class="hist-list" id="hist-list"></div>
    <div id="hist-sentinel" style="height:1px"></div>
  `;

  // ── Рендер первой страницы ────────────────────────────────────────────────
  _renderPage(rawOps, fleet);

  // ── Слушатели ─────────────────────────────────────────────────────────────
  _bindEvents(body, rawOps, fleet, isMech);
}

// ─── Страница списка ──────────────────────────────────────────────────────────
function _renderPage(rawOps, fleet) {
  const list = document.getElementById('hist-list');
  if (!list) return;

  const page = _filtered.slice(_offset, _offset + _PAGE);

  if (!page.length) {
    _destroyObserver();
    if (_offset === 0) {
      list.innerHTML = rawOps.length === 0 ? _emptyAllHTML() : _emptyFilterHTML();
    }
    return;
  }

  const groups = _groupByDay(page);
  let html = '';
  groups.forEach(({ label, ops }) => {
    // Не дублируем заголовок дня при подгрузке
    if (!list.querySelector(`[data-day="${label}"]`)) {
      html += `<div class="ops-day-label" data-day="${label}">${label}</div>`;
    }
    html += ops.map(op => _opRowHTML(op, fleet)).join('');
  });

  list.insertAdjacentHTML('beforeend', html);
  _offset += page.length;

  if (_offset >= _filtered.length) { _destroyObserver(); return; }
  _initObserver(rawOps, fleet);
}

// ═══════════════════════════════════════════════════════════════════════════
// СОБЫТИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _bindEvents(body, rawOps, fleet, isMech) {
  // ── Переключатель месяца ──────────────────────────────────────────────────
  document.getElementById('hist-prev')?.addEventListener('click', () => {
    _selMonth--;
    if (_selMonth < 1) { _selMonth = 12; _selYear--; }
    _refilter(rawOps, fleet);
  });

  document.getElementById('hist-next')?.addEventListener('click', () => {
    const next = _selMonth === 12
      ? { m: 1, y: _selYear + 1 } : { m: _selMonth + 1, y: _selYear };
    if (next.y > _now.getFullYear() ||
       (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)) return;
    _selMonth = next.m; _selYear = next.y;
    _refilter(rawOps, fleet);
  });

  // ── Тип-чипы ─────────────────────────────────────────────────────────────
  document.getElementById('hist-type-chips')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-chip-type]');
    if (btn) {
      _selType = btn.dataset.chipType;
      _refilter(rawOps, fleet);
      return;
    }

    // Машина
    if (e.target.closest('***REMOVED***hist-chip-car')) {
      _showCarSheet(fleet, rawOps);
      return;
    }

    // Касса
    if (e.target.closest('***REMOVED***hist-chip-kassa')) {
      _showKassaSheet(rawOps, fleet);
    }
  });

  // ── Клик по строке операции ───────────────────────────────────────────────
  document.getElementById('hist-list')?.addEventListener('click', e => {
    const row = e.target.closest('[data-op-id]');
    if (!row) return;
    const op = _filtered.find(o => o.opId === row.dataset.opId)
            ?? rawOps.find(o => o.opId === row.dataset.opId);
    if (op) _showOpDetail(op, fleet);
  });
}

// ─── Обновление после смены фильтра ──────────────────────────────────────────
function _refilter(rawOps, fleet) {
  _filtered = _applyFilters(rawOps, getCurrentUser()?.role === ROLES.MECHANIC);
  _offset   = 0;
  _destroyObserver();

  const list  = document.getElementById('hist-list');
  const count = document.getElementById('hist-count');
  const label = document.getElementById('hist-month-label');

  if (list)  list.innerHTML = '';
  if (count) count.textContent = `${_filtered.length} операций`;
  if (label) label.textContent = _monthLabel();

  // Обновить активный чип типа
  document.querySelectorAll('[data-chip-type]').forEach(b => {
    b.classList.toggle('hist-chip--active', b.dataset.chipType === _selType);
  });
  // Обновить чип машины
  const chipCar = document.getElementById('hist-chip-car');
  if (chipCar) {
    chipCar.textContent = _selCar ? _carLabel(fleet, _selCar) : 'Машина ↓';
    chipCar.classList.toggle('hist-chip--active', !!_selCar);
  }
  // Обновить чип кассы
  const chipKassa = document.getElementById('hist-chip-kassa');
  if (chipKassa) {
    chipKassa.textContent = _selKassa ? _selKassa : 'Касса ↓';
    chipKassa.classList.toggle('hist-chip--active', !!_selKassa);
  }
  // Обновить стрелку «вперёд»
  const btnNext = document.getElementById('hist-next');
  if (btnNext) {
    const atCurrent = _selMonth === _now.getMonth() + 1 && _selYear === _now.getFullYear();
    btnNext.style.opacity      = atCurrent ? '0.3' : '1';
    btnNext.style.pointerEvents = atCurrent ? 'none' : '';
  }

  _renderPage(rawOps, fleet);
}

// ─── Bottomsheet: выбор машины ────────────────────────────────────────────────
function _showCarSheet(fleet, rawOps) {
  const rows = [{ carId: null, name: 'Все машины' }, ...fleet].map(c => `
    <div class="list-item ${_selCar === c.carId ? 'hist-sheet-active' : ''}" data-car="${c.carId ?? ''}">
      ${c.carId ? `<span style="font-size:16px">🚗</span>` : `<span style="font-size:16px">📋</span>`}
      <div class="list-item__body">
        <div class="list-item__title">${c.name || c.carId}</div>
        ${c.carId ? `<div class="list-item__sub">${c.carId}</div>` : ''}
      </div>
      ${_selCar === c.carId ? `<span style="color:var(--color-dark);font-weight:700">✓</span>` : ''}
    </div>
  `).join('');

  showBottomSheet(`
    <p class="bottomsheet-title">Выберите машину</p>
    <div id="bs-car-list">${rows}</div>
  `);

  setTimeout(() => {
    document.getElementById('bs-car-list')?.addEventListener('click', e => {
      const row = e.target.closest('[data-car]');
      if (!row) return;
      _selCar = row.dataset.car || null;
      import('../ui.js').then(({ hideBottomSheet }) => {
        hideBottomSheet(() => _refilter(rawOps, fleet));
      });
    });
  }, 0);
}

// ─── Bottomsheet: выбор кассы ─────────────────────────────────────────────────
function _showKassaSheet(rawOps, fleet) {
  const kassas = [
    { id: null,               label: 'Все кассы' },
    { id: KASSA_ID.AZAMAT,    label: 'K_AZAMAT' },
    { id: KASSA_ID.VLADIMIR,  label: 'K_VLADIMIR' },
    { id: KASSA_ID.YULIA,     label: 'K_YULIA' },
  ];
  const rows = kassas.map(k => `
    <div class="list-item" data-kassa="${k.id ?? ''}">
      <div class="list-item__body">
        <div class="list-item__title">${k.label}</div>
      </div>
      ${_selKassa === k.id ? `<span style="color:var(--color-dark);font-weight:700">✓</span>` : ''}
    </div>
  `).join('');

  showBottomSheet(`
    <p class="bottomsheet-title">Выберите кассу</p>
    <div id="bs-kassa-list">${rows}</div>
  `);

  setTimeout(() => {
    document.getElementById('bs-kassa-list')?.addEventListener('click', e => {
      const row = e.target.closest('[data-kassa]');
      if (!row) return;
      _selKassa = row.dataset.kassa || null;
      import('../ui.js').then(({ hideBottomSheet }) => {
        hideBottomSheet(() => _refilter(rawOps, fleet));
      });
    });
  }, 0);
}

// ─── Bottomsheet: детали операции (read-only) ─────────────────────────────────
function _showOpDetail(op, fleet) {
  const dir    = DIR_META[op.direction] ?? DIR_META['расход'];
  const car    = fleet.find(c => c.carId === op.carId);
  const carLbl = car ? `${car.carId}${car.name ? ' · ' + car.name : ''}` : (op.carId || '—');

  const field = (label, value) => value
    ? `<div class="bs-op-field">
         <span class="bs-op-field__lbl">${label}</span>
         <span class="bs-op-field__val">${value}</span>
       </div>`
    : '';

  showBottomSheet(`
    <div class="bs-op-hero" style="background:${dir.bg}">
      <span class="bs-op-hero__sign" style="color:${dir.color}">${dir.sign}</span>
      <span class="bs-op-hero__amount" style="color:${dir.color}">${_fmt(op.amount)}</span>
      <span class="bs-op-hero__dir">${op.direction}</span>
    </div>
    <div class="bs-op-fields">
      ${field('ID',          op.opId)}
      ${field('Дата',        op.dateRaw)}
      ${field('Категория',   op.category || op.type)}
      ${field('Касса',       op.kassaId)}
      ${field('Машина',      carLbl)}
      ${field('Провёл',      op.provel)}
      ${field('Комментарий', op.comment)}
    </div>
  `);
}

// ═══════════════════════════════════════════════════════════════════════════
// ФИЛЬТРАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _applyFilters(ops, isMech) {
  return ops.filter(op => {
    // Месяц/год
    if (op.date instanceof Date) {
      if (op.date.getMonth() + 1 !== _selMonth) return false;
      if (op.date.getFullYear()   !== _selYear)  return false;
    }
    // Тип
    if (_selType !== 'все') {
      if (_selType === 'аренда'  && op.direction !== 'приход')  return false;
      if (_selType === 'расход'  && op.direction !== 'расход')  return false;
      if (_selType === 'перевод' && op.direction !== 'перевод') return false;
    }
    // Машина
    if (_selCar && op.carId !== _selCar) return false;
    // Касса (игнорируем для mechanic)
    if (!isMech && _selKassa && op.kassaId !== _selKassa) return false;
    return true;
  }).sort((a, b) => _ts(b) - _ts(a));
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕНДЕР-ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

function _opRowHTML(op, fleet) {
  const dir    = DIR_META[op.direction] ?? DIR_META['расход'];
  const car    = fleet.find(c => c.carId === op.carId);
  const carTxt = car ? car.carId : (op.carId || '');
  const meta   = [carTxt, op.provel].filter(Boolean).join(' · ');

  return `
    <div class="op-row" data-op-id="${op.opId ?? ''}">
      <span class="op-row__dot" style="background:${dir.bg};color:${dir.color};width:32px;height:32px;
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:14px;font-weight:700;flex-shrink:0">
        ${dir.sign}
      </span>
      <div class="op-row__body">
        <div class="op-row__cat">${op.category || op.type || op.direction}</div>
        ${meta ? `<div class="op-row__meta">${meta}</div>` : ''}
      </div>
      <div class="op-row__right">
        <span class="op-row__amount" style="color:${dir.color}">
          ${dir.sign !== '⇄' ? dir.sign : ''}${_fmt(op.amount)}
        </span>
        ${op.dateRaw ? `<span class="op-row__time">${op.dateRaw}</span>` : ''}
      </div>
    </div>
  `;
}

function _skeletonHTML() {
  const ln = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:6px"></div>`;
  return `
    <div class="hist-hdr hist-hdr--skeleton">
      ${ln(40)} ${ln(60)} ${ln(30)}
    </div>
    <div style="padding:16px">
      ${[1,2,3,4,5,6].map(() => `
        <div class="op-row" style="pointer-events:none">
          <div class="skeleton" style="width:32px;height:32px;border-radius:50%;flex-shrink:0"></div>
          <div style="flex:1">${ln(55)}${ln(35)}</div>
          <div class="skeleton skeleton-line" style="width:64px"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline" style="padding-top:100px">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="hist-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _emptyFilterHTML() {
  return `
    <div class="empty-state" style="padding-top:40px">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style="opacity:.25">
        <circle cx="40" cy="40" r="36" stroke="***REMOVED***1A1A1A" stroke-width="3"/>
        <path d="M26 40H54M26 30H54M26 50H42" stroke="***REMOVED***1A1A1A" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div class="empty-state__text">Операций не найдено</div>
      <div class="empty-state__sub">Попробуйте изменить фильтры</div>
    </div>
  `;
}

function _emptyAllHTML() {
  return `
    <div class="empty-state" style="padding-top:40px">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style="opacity:.2">
        <rect x="14" y="14" width="52" height="52" rx="12" stroke="***REMOVED***1A1A1A" stroke-width="3"/>
        <path d="M40 32V40M40 48H40.04" stroke="***REMOVED***1A1A1A" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div class="empty-state__text">Ещё нет ни одной операции</div>
      <div class="empty-state__sub">Добавьте первую запись</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// INFINITE SCROLL
// ═══════════════════════════════════════════════════════════════════════════

function _initObserver(rawOps, fleet) {
  const sentinel = document.getElementById('hist-sentinel');
  if (!sentinel) return;
  _observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) _renderPage(rawOps, fleet);
  }, { rootMargin: '120px' });
  _observer.observe(sentinel);
}

function _destroyObserver() {
  _observer?.disconnect();
  _observer = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════════════════

function _fmt(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`;
}

function _monthLabel() {
  return new Date(_selYear, _selMonth - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
}

function _carLabel(fleet, carId) {
  const car = fleet.find(c => c.carId === carId);
  return car ? car.carId : carId;
}

function _groupByDay(ops) {
  const map = new Map();
  const order = [];
  ops.forEach(op => {
    const lbl = _dayLabel(op.dateRaw);
    if (!map.has(lbl)) { map.set(lbl, []); order.push(lbl); }
    map.get(lbl).push(op);
  });
  return order.map(lbl => ({ label: lbl, ops: map.get(lbl) }));
}

function _dayLabel(ddmmyyyy) {
  if (!ddmmyyyy) return 'Без даты';
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  if (d === today.getDate() && m === today.getMonth() + 1 && y === today.getFullYear())
    return 'Сегодня';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (d === yest.getDate() && m === yest.getMonth() + 1 && y === yest.getFullYear())
    return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function _ts(op) {
  if (op.date instanceof Date && !isNaN(op.date)) return op.date.getTime();
  if (!op.dateRaw) return 0;
  const [d, m, y] = op.dateRaw.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}
