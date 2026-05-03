/**
 * home.js — главный экран механика (Азамат).
 *
 * Данные: getOperations({ kassaId: KASSA_ID.AZAMAT }) + getFleet();
 *   список и баланс — только строки с kassaId === K_AZAMAT.
 * Расчёты: остаток, дельта сегодня, статистика парка.
 * Бесконечный скролл: клиентская пагинация по 20 записей через IntersectionObserver.
 */

import { getOperations, getFleet } from '../api.js';
import { getCurrentUser }          from '../auth.js';
import { parseRuDate } from './history.js';
import { showScreen }              from '../router.js?v=7';
import { showToast }               from '../ui.js';
import { KASSA_ID, CAR_STATUSES }  from '../config.js';

// ─── Константы ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

// ─── Состояние ───────────────────────────────────────────────────────────────
let _allOps     = [];   // все операции кассы, отсортированные desc
let _offset     = 0;    // сколько уже отрендерено
let _observer   = null; // IntersectionObserver для бесконечного скролла

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ (вызывается из app.js один раз)
// ═══════════════════════════════════════════════════════════════════════════

export function initHome() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-home') renderHome();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export async function renderHome() {
  const body = document.getElementById('home-body');
  if (!body) return;

  _offset = 0;
  _destroyObserver();

  // ── Скелетоны ────────────────────────────────────────────────────────────
  body.innerHTML = _skeletonHTML();

  // ── Загрузка ─────────────────────────────────────────────────────────────
  let ops, fleet;
  try {
    [ops, fleet] = await Promise.all([
      getOperations({ kassaId: KASSA_ID.AZAMAT }),
      getFleet(),
    ]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('home-retry')?.addEventListener('click', renderHome);
    return;
  }

  // ── Только K_AZAMAT до рендера ───────────────────────────────────────────
  const azamatOps = ops.filter(
    op => String(op.kassaId ?? '').trim() === String(KASSA_ID.AZAMAT),
  );
  _allOps = [...azamatOps].sort((a, b) => _tsOp(b) - _tsOp(a));

  const balance = _calcBalance(azamatOps);
  const delta   = _calcDelta(azamatOps);
  const fleetStats = _calcFleet(fleet);

  const user = getCurrentUser();
  const firstName = user?.name?.split(' ')[0] ?? 'Азамат';
  const avatarLetter = firstName.charAt(0).toUpperCase() || 'А';

  const deltaClass =
    delta > 0 ? 'home-hdr__delta--pos' : delta < 0 ? 'home-hdr__delta--neg' : 'home-hdr__delta--zero';
  const deltaText =
    delta === 0
      ? '0 ₽ сегодня'
      : `${delta > 0 ? '+' : '−'}${_fmt(Math.abs(delta))} сегодня`;

  body.innerHTML = `
    <!-- Блок 1 — хедер -->
    <div class="home-hdr">
      <div class="home-hdr__brand-row">
        <span class="home-hdr__logo">Матизы</span>
        <div class="home-hdr__avatar" aria-hidden="true">${avatarLetter}</div>
      </div>
      <div class="home-hdr__subtitle">КАССА АЗАМАТА</div>
      <div class="home-hdr__balance-row">
        <div class="home-hdr__balance">${_fmt(Math.abs(balance))}</div>
        <button type="button" class="home-hdr__refresh" id="home-refresh" aria-label="Обновить">↻</button>
      </div>
      <div class="home-hdr__delta ${deltaClass}">${deltaText}</div>
    </div>

    <!-- Блок 2 — одна кнопка -->
    <div class="home-action-wrap">
      <button type="button" class="home-action home-action--income" id="home-btn-income">
        <span class="home-action__arrow">↓</span>
        <span class="home-action__label">Принять платёж</span>
      </button>
    </div>

    <!-- Блок 3 — парк -->
    <div class="home-fleet">
      <div class="home-fleet__header">
        <span class="home-fleet__title">Здоровье парка</span>
        <span class="home-fleet__total">Всего — ${fleet.length}</span>
      </div>
      <div class="home-fleet__legend">
        <button type="button" class="home-fleet__legend-col" data-filter="${CAR_STATUSES.RENT}" aria-label="Аренда, ${fleetStats.rent}">
          <div class="home-fleet__legend-line">
            <span class="home-fleet__legend-dot" style="background:***REMOVED***4CAF50"></span>
            <span class="home-fleet__legend-label">Аренда</span>
          </div>
          <span class="home-fleet__legend-num home-fleet__legend-num--rent">${fleetStats.rent}</span>
        </button>
        <button type="button" class="home-fleet__legend-col" data-filter="${CAR_STATUSES.IDLE}" aria-label="Простой, ${fleetStats.idle}">
          <div class="home-fleet__legend-line">
            <span class="home-fleet__legend-dot" style="background:***REMOVED***FFC107"></span>
            <span class="home-fleet__legend-label">Простой</span>
          </div>
          <span class="home-fleet__legend-num home-fleet__legend-num--idle">${fleetStats.idle}</span>
        </button>
        <button type="button" class="home-fleet__legend-col" data-filter="${CAR_STATUSES.REPAIR}" aria-label="Ремонт, ${fleetStats.repair}">
          <div class="home-fleet__legend-line">
            <span class="home-fleet__legend-dot" style="background:***REMOVED***F44336"></span>
            <span class="home-fleet__legend-label">Ремонт</span>
          </div>
          <span class="home-fleet__legend-num home-fleet__legend-num--repair">${fleetStats.repair}</span>
        </button>
      </div>
      <div class="home-fleet__bar" role="group" aria-label="Распределение парка по статусам">
        ${_fleetBarSegmentsHTML(fleetStats)}
      </div>
    </div>

    <!-- Блок 4 — операции -->
    <div class="home-ops">
      <div class="home-ops__header">
        <span class="home-ops__title">Операции</span>
        <button type="button" class="home-ops__expense" id="home-ops-expense">+ Расход</button>
      </div>
      <div id="home-ops-list"></div>
      <div id="home-ops-sentinel" style="height:1px"></div>
    </div>
  `;

  // Рендерим первую страницу
  _renderPage();

  // ── Навешиваем слушатели ───────────────────────────────────────────────
  document.getElementById('home-refresh')?.addEventListener('click', renderHome);

  document.getElementById('home-btn-income')?.addEventListener('click', () => {
    showScreen('screen-income');
  });

  document.getElementById('home-ops-expense')?.addEventListener('click', () => {
    showScreen('screen-add', { addType: 'РАСХОД' });
  });

  const _goFleetFilter = (status) => {
    document.dispatchEvent(new CustomEvent('fleet:filter', { detail: { status } }));
    showScreen('screen-fleet');
  };

  body.querySelectorAll('.home-fleet__legend-col, .home-fleet__bar-seg').forEach(el => {
    el.addEventListener('click', () => {
      const st = el.dataset.filter;
      if (st) _goFleetFilter(st);
    });
  });

  // ── Бесконечный скролл ────────────────────────────────────────────────
  _initObserver();
}

// ═══════════════════════════════════════════════════════════════════════════
// ПАГИНАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _renderPage() {
  const list = document.getElementById('home-ops-list');
  if (!list) return;

  const page = _allOps.slice(_offset, _offset + PAGE_SIZE);
  if (!page.length) {
    _destroyObserver();
    if (_offset === 0) list.innerHTML = _emptyOpsHTML();
    return;
  }

  // Группируем по дням
  const groups = _groupByDay(page);
  let html = '';

  groups.forEach(({ label, ops }) => {
    // Не дублируем заголовок дня если уже добавлен предыдущей страницей
    const existingLabel = list.querySelector(`[data-day-label="${label}"]`);
    if (!existingLabel) {
      html += `<div class="ops-day-label" data-day-label="${label}">${label}</div>`;
    }
    html += ops.map(_renderOpRow).join('');
  });

  list.insertAdjacentHTML('beforeend', html);
  _offset += page.length;

  // Если загрузили всё — убираем наблюдатель
  if (_offset >= _allOps.length) _destroyObserver();
}

function _initObserver() {
  const sentinel = document.getElementById('home-ops-sentinel');
  if (!sentinel || _offset >= _allOps.length) return;

  _observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) _renderPage();
  }, { rootMargin: '120px' });

  _observer.observe(sentinel);
}

function _destroyObserver() {
  _observer?.disconnect();
  _observer = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЙ РЕНДЕР
// ═══════════════════════════════════════════════════════════════════════════

function _renderOpRow(op) {
  const isIncome = op.direction === 'приход';
  const dotColor = isIncome ? '***REMOVED***4CAF50' : '***REMOVED***FF5252';
  const sign     = isIncome ? '+' : '−';
  const amtClass = isIncome ? 'op-row__amount--pos' : 'op-row__amount--neg';
  const meta     = [op.carId, op.provel].filter(Boolean).join(' · ');
  const cat      = _capitalizeCategory(op.category || op.type || op.direction);

  return `
    <div class="op-row">
      <span class="op-row__dot" style="background:${dotColor}"></span>
      <div class="op-row__body">
        <div class="op-row__cat">${cat}</div>
        ${meta ? `<div class="op-row__meta">${meta}</div>` : ''}
      </div>
      <div class="op-row__right">
        <span class="op-row__amount ${amtClass}">${sign}${_fmt(op.amount)}</span>
      </div>
    </div>
  `;
}

function _skeletonHTML() {
  const skel = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:8px"></div>`;
  return `
    <div class="home-hdr home-hdr--skeleton">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        ${skel(28)}
        <div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div>
      </div>
      ${skel(35)}
      <div class="skeleton skeleton-line skeleton-line--xl" style="width:55%;margin-bottom:8px"></div>
      ${skel(45)}
    </div>
    <div class="home-action-wrap" style="pointer-events:none">
      <div class="skeleton" style="height:56px;border-radius:14px"></div>
    </div>
    <div class="skeleton" style="height:140px;border-radius:12px;margin:16px"></div>
    ${[1,2,3,4,5].map(() => `
      <div class="op-row">
        <span class="skeleton" style="width:10px;height:10px;border-radius:50%;flex-shrink:0"></span>
        <div style="flex:1">
          ${skel(55)}
          ${skel(35)}
        </div>
        <div class="skeleton skeleton-line" style="width:70px"></div>
      </div>
    `).join('')}
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет и попробуйте снова' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="home-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _emptyOpsHTML() {
  return `<div class="empty-state"><div class="empty-state__text">Операций ещё нет</div></div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ВЫЧИСЛЕНИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _calcBalance(ops) {
  return ops.reduce((acc, op) => {
    if (op.direction === 'приход')  return acc + op.amount;
    if (op.direction === 'расход') return acc - op.amount;
    return acc;
  }, 0);
}

function _calcDelta(ops) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return ops
    .filter(op => {
      const d =
        op.date instanceof Date && !isNaN(op.date.getTime())
          ? op.date
          : parseRuDate(op.dateRaw);
      if (!d || isNaN(d.getTime())) return false;
      const dd = new Date(d);
      dd.setHours(0, 0, 0, 0);
      return dd.getTime() === today.getTime();
    })
    .reduce((acc, op) => {
      if (op.direction === 'приход')  return acc + op.amount;
      if (op.direction === 'расход') return acc - op.amount;
      return acc;
    }, 0);
}

/** Как в fleet.js — для строк статуса с отличиями в регистре/формулировке */
function _fleetStatusBucket(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.includes('аренд')) return 'rent';
  if (s.includes('ремонт')) return 'repair';
  if (s.includes('прост')) return 'idle';
  return 'idle';
}

function _calcFleet(fleet) {
  const r = { rent: 0, idle: 0, repair: 0 };
  fleet.forEach(c => {
    const st = String(c.status || '').trim();
    if (st === CAR_STATUSES.RENT) r.rent++;
    else if (st === CAR_STATUSES.IDLE) r.idle++;
    else if (st === CAR_STATUSES.REPAIR) r.repair++;
    else {
      const b = _fleetStatusBucket(c.status);
      if (b === 'rent') r.rent++;
      else if (b === 'repair') r.repair++;
      else r.idle++;
    }
  });
  return r;
}

/** Сегменты прогресс-бара парка (flex-пропорции, min 8% для тапа) */
function _fleetBarSegmentsHTML(stats) {
  const rows = [
    { status: CAR_STATUSES.RENT, color: '***REMOVED***4CAF50', n: stats.rent },
    { status: CAR_STATUSES.IDLE, color: '***REMOVED***FFC107', n: stats.idle },
    { status: CAR_STATUSES.REPAIR, color: '***REMOVED***F44336', n: stats.repair },
  ];
  return rows
    .filter(row => row.n > 0)
    .map(row => `
      <button type="button" class="home-fleet__bar-seg"
        data-filter="${row.status}"
        style="flex:${row.n} 1 0;min-width:8%;background:${row.color}"
        aria-label="${row.n} маш."></button>
    `)
    .join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════════════════

/** Форматирует число: «12 500 ₽» */
function _fmt(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

/** Ключ календарного дня для группировки */
function _dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Единый разбор даты операции */
function _opDate(op) {
  if (op.date instanceof Date && !isNaN(op.date.getTime())) return op.date;
  return parseRuDate(op.dateRaw);
}

/** Группировка дней: СЕГОДНЯ / ВЧЕРА / дата */
function _homeDayLabel(d) {
  if (!d || isNaN(d.getTime())) return 'Без даты';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'СЕГОДНЯ';
  if (d.toDateString() === yesterday.toDateString()) return 'ВЧЕРА';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Группирует ops (уже отсортированных desc) по дням, возвращает массив { label, ops } */
function _groupByDay(ops) {
  const map = new Map();
  const order = [];
  ops.forEach(op => {
    const d = _opDate(op);
    const key = d && !isNaN(d.getTime()) ? _dayKey(d) : '__nodate';
    const lbl = key === '__nodate' ? 'Без даты' : _homeDayLabel(d);
    if (!map.has(key)) {
      map.set(key, { label: lbl, ops: [] });
      order.push(key);
    }
    map.get(key).ops.push(op);
  });
  return order.map(key => map.get(key));
}

function _capitalizeCategory(raw) {
  const s = String(raw || '').replace(/_/g, ' ').trim();
  if (!s) return '';
  return s
    .split(/\s+/)
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

function _tsOp(op) {
  const d = _opDate(op);
  return d && !isNaN(d.getTime()) ? d.getTime() : 0;
}

