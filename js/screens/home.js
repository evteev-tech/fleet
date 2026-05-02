/**
 * home.js — главный экран механика (Азамат).
 *
 * Данные: getOperations({ kassaId: KASSA_ID.AZAMAT }) + getFleet()
 * Расчёты: остаток, дельта сегодня, статистика парка.
 * Бесконечный скролл: клиентская пагинация по 20 записей через IntersectionObserver.
 */

import { getOperations, getFleet } from '../api.js';
import { getCurrentUser }          from '../auth.js';
import { parseRuDate, formatGroupLabel } from './history.js';
import { showScreen }              from '../router.js?v=5';
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

  // ── Вычисления ────────────────────────────────────────────────────────────
  _allOps = [...ops].sort((a, b) => _tsOp(b) - _tsOp(a));

  const balance = _calcBalance(ops);
  const delta   = _calcDelta(ops);
  const fleetStats = _calcFleet(fleet);

  // ── Рендер ───────────────────────────────────────────────────────────────
  const user    = getCurrentUser();
  const first   = user?.name?.split(' ')[0] ?? 'Азамат';
  const greeting = _greeting();

  body.innerHTML = `
    <!-- ХЕДЕР: баланс -->
    <div class="home-hdr">
      <div class="home-hdr__top">
        <span class="home-hdr__greeting">${greeting}, ${first}</span>
        <button class="home-hdr__refresh" id="home-refresh" aria-label="Обновить">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M1.5 9C1.5 4.858 4.858 1.5 9 1.5c2.8 0 5.25 1.6 6.5 4"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            <path d="M16.5 9C16.5 13.142 13.142 16.5 9 16.5c-2.8 0-5.25-1.6-6.5-4"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            <path d="M13 4H15.5V1.5" stroke="currentColor" stroke-width="1.7"
              stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 14H2.5V16.5" stroke="currentColor" stroke-width="1.7"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="home-hdr__balance">${_fmt(Math.abs(balance))}</div>
      <div class="home-hdr__delta ${delta >= 0 ? 'home-hdr__delta--pos' : 'home-hdr__delta--neg'}">
        ${delta >= 0 ? '+' : '−'}${_fmt(Math.abs(delta))} сегодня
      </div>
    </div>

    <!-- КНОПКИ ДЕЙСТВИЙ -->
    <div class="home-actions">
      <button class="home-action home-action--income" id="home-btn-income">
        <div class="home-action__row">
          <span class="home-action__arrow">↓</span>
          <span class="home-action__label">Принять платёж</span>
        </div>
        <span class="home-action__sub">Аренда, залог</span>
      </button>
      <button class="home-action home-action--expense" id="home-btn-expense">
        <div class="home-action__row">
          <span class="home-action__arrow">↑</span>
          <span class="home-action__label">Расход</span>
        </div>
        <span class="home-action__sub">Ремонт, страховка</span>
      </button>
    </div>

    <!-- ЗДОРОВЬЕ ПАРКА -->
    <div class="home-fleet card">
      <div class="home-fleet__header">
        <span class="home-fleet__title">Здоровье парка</span>
        <span class="home-fleet__total">Всего — ${fleet.length}</span>
      </div>
      <div class="home-fleet__grid">
        <div class="home-fleet__tile" data-filter="${CAR_STATUSES.RENT}">
          <span class="home-fleet__dot" style="background:var(--color-green)"></span>
          <span class="home-fleet__name">Аренда</span>
          <span class="home-fleet__num" style="color:var(--color-green)">${fleetStats.rent}</span>
        </div>
        <div class="home-fleet__tile" data-filter="${CAR_STATUSES.IDLE}">
          <span class="home-fleet__dot" style="background:var(--color-orange)"></span>
          <span class="home-fleet__name">Простой</span>
          <span class="home-fleet__num" style="color:var(--color-orange)">${fleetStats.idle}</span>
        </div>
        <div class="home-fleet__tile" data-filter="${CAR_STATUSES.REPAIR}">
          <span class="home-fleet__dot" style="background:var(--color-red)"></span>
          <span class="home-fleet__name">Ремонт</span>
          <span class="home-fleet__num" style="color:var(--color-red)">${fleetStats.repair}</span>
        </div>
      </div>
    </div>

    <!-- СПИСОК ОПЕРАЦИЙ -->
    <div class="home-ops">
      <div class="home-ops__header">
        <span class="home-ops__title">Операции</span>
        <button class="home-ops__all" id="home-ops-all">Все</button>
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
    document.dispatchEvent(new CustomEvent('add:prefill', { detail: { type: 'ДОХОД' } }));
    showScreen('screen-add');
  });

  document.getElementById('home-btn-expense')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('add:prefill', { detail: { type: 'РАСХОД' } }));
    showScreen('screen-add');
  });

  document.getElementById('home-ops-all')?.addEventListener('click', () => {
    showScreen('screen-history');
    document.dispatchEvent(new CustomEvent('screen:activated', { detail: { screenId: 'screen-history' } }));
  });

  body.querySelectorAll('.home-fleet__tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('fleet:filter', { detail: { status: tile.dataset.filter } }));
      showScreen('screen-fleet');
      document.dispatchEvent(new CustomEvent('screen:activated', { detail: { screenId: 'screen-fleet' } }));
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
  const dotColor = isIncome ? 'var(--color-green)' : 'var(--color-red)';
  const sign     = isIncome ? '+' : '−';
  const amtClass = isIncome ? 'op-row__amount--pos' : 'op-row__amount--neg';
  const meta     = [op.carId, op.provel].filter(Boolean).join(' · ');
  const time     = op.date ? _timeFromDate(op.date) : '';

  return `
    <div class="op-row">
      <span class="op-row__dot" style="background:${dotColor}"></span>
      <div class="op-row__body">
        <div class="op-row__cat">${op.category || op.type || op.direction}</div>
        ${meta ? `<div class="op-row__meta">${meta}</div>` : ''}
      </div>
      <div class="op-row__right">
        <span class="op-row__amount ${amtClass}">${sign}${_fmt(op.amount)}</span>
        ${time ? `<span class="op-row__time">${time}</span>` : ''}
      </div>
    </div>
  `;
}

function _skeletonHTML() {
  const skel = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:8px"></div>`;
  return `
    <div class="home-hdr home-hdr--skeleton">
      ${skel(40)}
      <div class="skeleton skeleton-line skeleton-line--xl" style="width:60%"></div>
      ${skel(30)}
    </div>
    <div class="home-actions" style="pointer-events:none">
      <div class="skeleton" style="height:80px;border-radius:16px"></div>
      <div class="skeleton" style="height:80px;border-radius:16px"></div>
    </div>
    <div class="skeleton" style="height:120px;border-radius:16px;margin-bottom:16px"></div>
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

function _calcFleet(fleet) {
  const r = { rent: 0, idle: 0, repair: 0 };
  fleet.forEach(c => {
    if (c.status === CAR_STATUSES.RENT)   r.rent++;
    if (c.status === CAR_STATUSES.IDLE)   r.idle++;
    if (c.status === CAR_STATUSES.REPAIR) r.repair++;
  });
  return r;
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

/** Группирует ops (уже отсортированных desc) по дням, возвращает массив { label, ops } */
function _groupByDay(ops) {
  const map = new Map();
  const order = [];
  ops.forEach(op => {
    const d = _opDate(op);
    const key = d && !isNaN(d.getTime()) ? _dayKey(d) : '__nodate';
    const lbl = key === '__nodate' ? 'Без даты' : formatGroupLabel(d);
    if (!map.has(key)) {
      map.set(key, { label: lbl, ops: [] });
      order.push(key);
    }
    map.get(key).ops.push(op);
  });
  return order.map(key => map.get(key));
}

function _tsOp(op) {
  const d = _opDate(op);
  return d && !isNaN(d.getTime()) ? d.getTime() : 0;
}

/** «14:32» из объекта Date (если есть время) */
function _timeFromDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const h = date.getHours(), m = date.getMinutes();
  if (h === 0 && m === 0) return '';
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/** «Доброе утро» / «Добрый день» / «Добрый вечер» */
function _greeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
