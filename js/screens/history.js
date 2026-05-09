/**
 * history.js — история операций (две оси фильтров + сводка + поиск).
 *
 * mechanic: только K_AZAMAT, без фильтра/меты кассы.
 * operations / investor: все кассы, фильтр по кассе в bottomsheet.
 * Бесконечный скролл через IntersectionObserver (20 строк).
 */

import { getOperations, getFleet } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showBottomSheet, hideBottomSheet } from '../ui.js';
import { KASSA_ID, KASSA_NAMES, ROLES } from '../config.js';

/** DD.MM.YYYY или Excel serial из таблицы → Date */
export function parseRuDate(str) {
  if (str === undefined || str === null || str === '') return null;
  const s = typeof str === 'number' ? String(str) : String(str).trim();
  if (/^\d{5,}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + n * 86400000);
    }
  }
  const parts = String(str).split('.');
  if (parts.length === 3) {
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  return null;
}

export function formatGroupLabel(date) {
  if (!date) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d0 = new Date(date);
  d0.setHours(0, 0, 0, 0);

  if (d0.getTime() === today.getTime()) return 'СЕГОДНЯ';
  if (d0.getTime() === yesterday.getTime()) return 'ВЧЕРА';

  return date
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    .toUpperCase();
}

function _dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _opDate(op) {
  if (op.date instanceof Date && !Number.isNaN(op.date.getTime())) return op.date;
  return parseRuDate(op.dateRaw);
}

const _PAGE = 20;
const _now = new Date();
let _selMonth = _now.getMonth() + 1;
let _selYear = _now.getFullYear();

/** @type {{ type: string, carId: string|null, kassaId: string|null, search: string }} */
let _filters = {
  type: 'all',
  carId: null,
  kassaId: null,
  search: '',
};

let _searchMode = false;
let _filtered = [];
let _offset = 0;
let _observer = null;
let _saldoExpanded = false;

let _paintCtx = /** @type {{ rawOps: any[], fleet: any[], role: string, isMechanic: boolean, showKassa: boolean }} */ (null);

const TYPE_AXIS = [
  { id: 'all', label: 'Все' },
  { id: 'income', label: 'Доходы' },
  { id: 'expense', label: 'Расходы' },
  { id: 'transfer', label: 'Переводы' },
];

const SVG_RECEIPT =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3h14a1 1 0 011 1v16l-4-2-4 2-4-2-4 2V4a1 1 0 011-1z"/><path stroke-linecap="round" d="M8 10h8M8 14h8"/></svg>';
const SVG_SEARCH =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>';
const SVG_X =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>';
const SVG_CHEVRON_DOWN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_L =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_R =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ═══════════════════════════════════════════════════════════════════════════
function _normalizeType(raw) {
  return String(raw || '').trim().toLowerCase();
}

function _isTransferOp(op) {
  const t = _normalizeType(op.type);
  const d = String(op.direction || '').trim();
  return t === 'перевод_исходящий' || t === 'перевод_входящий' || d === 'перевод';
}

/** @returns {'in'|'out'|'transfer'} */
function _opUiKind(op) {
  if (_isTransferOp(op)) return 'transfer';
  if (String(op.direction || '').trim() === 'приход') return 'in';
  return 'out';
}

function _opsInMonth(ops) {
  return ops.filter(op => {
    const d = _opDate(op);
    if (!d || Number.isNaN(d.getTime())) return false;
    return d.getMonth() + 1 === _selMonth && d.getFullYear() === _selYear;
  });
}

/**
 * Фильтр по оси «тип» (для набора машин в bottomsheet).
 */
function _filterByAxisType(ops) {
  const t = _filters.type;
  if (t === 'income') {
    return ops.filter(o =>
      String(o.direction).trim() === 'приход' && _normalizeType(o.type) !== 'перевод_входящий');
  }
  if (t === 'expense') {
    return ops.filter(o =>
      String(o.direction).trim() === 'расход' && _normalizeType(o.type) !== 'перевод_исходящий');
  }
  if (t === 'transfer') return ops.filter(_isTransferOp);
  return [...ops];
}

function _applyFilters(opsMonthUnsorted, filters, role) {
  let result = _filterByAxisType(opsMonthUnsorted);

  if (filters.carId)
    result = result.filter(o => String(o.carId || '').trim() === String(filters.carId).trim());

  const mechanic = role === ROLES.MECHANIC;
  if (filters.kassaId && !mechanic)
    result = result.filter(o => String(o.kassaId || '').trim() === String(filters.kassaId).trim());

  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    if (q.length)
      result = result.filter(o => String(o.comment || '').toLowerCase().includes(q));
  }

  return result.sort((a, b) => _tsOp(b) - _tsOp(a));
}

function _tsOp(op) {
  const d = _opDate(op);
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

function _monthLabelCapital() {
  return new Date(_selYear, _selMonth - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase()) + ' г.';
}

function _monthLabelEmptyPhrase() {
  const m = new Date(_selYear, _selMonth - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
  return m.replace(/^./, c => c.toUpperCase()) + ' г.';
}

function _carLabel(fleet, carId) {
  const car = fleet.find(c => String(c.carId).trim() === String(carId).trim());
  return car?.carId || carId || '';
}

function _kassaTitle(id) {
  return KASSA_NAMES[id] || id || '';
}

function _roleFlags(user) {
  const role = user?.role || ROLES.MECHANIC;
  const isMechanic = role === ROLES.MECHANIC;
  const showKassa = role === ROLES.OPERATIONS || role === ROLES.INVESTOR;
  return { role, isMechanic, showKassa };
}

// ═══════════════════════════════════════════════════════════════════════════
export function initHistory() {
  document.addEventListener('history:filter', e => {
    const { kassaId } = e.detail ?? {};
    if (kassaId) _filters.kassaId = kassaId;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-history') void renderHistory();
  });
}

export async function renderHistory() {
  const shell = document.getElementById('history-body');
  if (!shell) return;

  const user = getCurrentUser();
  const { role, isMechanic, showKassa } = _roleFlags(user);
  _paintCtx = { rawOps: [], fleet: [], role, isMechanic, showKassa };

  _offset = 0;
  _destroyObserver();

  shell.innerHTML = '';
  let rawOpsAll = /** @type {any[]} */ (undefined);
  let fleet = /** @type {any[]} */ (undefined);
  let cacheHit = false;

  const paintHistoryShell = () => {
    if (rawOpsAll === undefined || fleet === undefined) return;

    let rawOps = isMechanic
      ? rawOpsAll.filter(op => String(op.kassaId ?? '').trim() === String(KASSA_ID.AZAMAT))
      : rawOpsAll;

    _paintCtx = { rawOps, fleet, role, isMechanic, showKassa };

    const monthSlice = _opsInMonth(rawOps);
    _filtered = _applyFilters(monthSlice, _filters, role);

    shell.innerHTML = _shellHTML(fleet);

    _bindHistShell(rawOps, fleet);
    _offset = 0;
    _renderPage(rawOps, fleet);
    _paintSaldo();
    _paintAxis2();
    _toggleSearchViews();
    _toggleNextDisabled();
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => {
      cacheHit = true;
      rawOpsAll = d;
      paintHistoryShell();
    },
    onFresh: d => {
      rawOpsAll = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) rawOpsAll = [];
      paintHistoryShell();
    },
  });

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      fleet = d;
      paintHistoryShell();
    },
    onFresh: d => {
      fleet = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) fleet = [];
      paintHistoryShell();
    },
  });

  setTimeout(() => {
    if (!cacheHit && (rawOpsAll === undefined || fleet === undefined)) {
      shell.innerHTML = _skeletonHTML();
    }
  }, 0);
}

function _shellHTML(fleet) {
  const n = _filtered.length;
  const axisPills = TYPE_AXIS.map(p => `
    <button type="button"
      class="hist-pill hist-chip ${_filters.type === p.id ? 'hist-pill--active hist-chip--active' : 'hist-pill--idle'}"
      data-hist-axis-type="${p.id}">
      ${p.label}
    </button>
  `).join('');

  return `
<div class="hist-page">
  <div class="hist-hdr">
    <div class="hist-hdr__top">
      <span class="app-logo">История</span>
      <span class="hist-count" id="hist-count">${n} операций</span>
    </div>

    <div class="hist-nav-row" id="hist-nav-normal">
      <button type="button" class="hist-month-btn hist-nav-btn hist-nav-btn--ghost" id="hist-prev" aria-label="Предыдущий месяц">${CHEV_L}</button>
      <div class="hist-month-sw">
        <button type="button" class="hist-nav-month hist-month-btn" id="hist-month-trigger" aria-label="Выбор месяца (скоро)">
          <span class="hist-month-label" id="hist-month-label">${_monthLabelCapital()}</span>
          ${SVG_CHEVRON_DOWN}
        </button>
      </div>
      <div class="hist-nav-actions">
        <button type="button" class="hist-nav-btn" id="hist-search-toggle" aria-label="Поиск">${SVG_SEARCH}</button>
        <button type="button" class="hist-month-btn hist-nav-btn hist-nav-btn--ghost" id="hist-next" aria-label="Следующий месяц">${CHEV_R}</button>
      </div>
    </div>

    <div class="hist-nav-row hist-nav-row--search hist-nav-row--hidden" id="hist-nav-search">
      <button type="button" class="hist-month-btn hist-nav-btn hist-nav-btn--ghost" id="hist-search-back" aria-label="Назад">${CHEV_L}</button>
      <div class="hist-search-field">
        <span class="hist-search-field__ico">${SVG_SEARCH}</span>
        <input type="search" id="hist-search-input" class="hist-search-field__inp" placeholder="Поиск по комментарию…" autocomplete="off" spellcheck="false" />
      </div>
      <button type="button" class="hist-nav-btn" id="hist-search-clear" aria-label="Очистить">${SVG_X}</button>
    </div>

    <div class="hist-axis1 hist-chips" id="hist-type-chips">
      ${axisPills}
      <button type="button" class="hist-add-filter" id="hist-add-filter">+ фильтр</button>
    </div>

    <div class="hist-axis2" id="hist-axis2"></div>

    <div class="hist-saldo${_saldoExpanded ? ' hist-saldo--expanded' : ''}" id="hist-saldo" tabindex="0" role="button" aria-expanded="${_saldoExpanded}">
      ${_saldoMainHTML()}
    </div>
  </div>

  <div class="hist-body">
    <div class="hist-list" id="hist-list"></div>
    <div id="hist-sentinel" style="height:1px"></div>
  </div>
</div>`;
}

function _saldoMainHTML() {
  const totals = _computeSaldoTotals();
  const cls = totals.net >= 0 ? 'hist-saldo__value hist-saldo__value--pos' : 'hist-saldo__value hist-saldo__value--neg';
  const sign = totals.net >= 0 ? '+' : '−';

  const gridHtml = `
    <div class="hist-saldo__grid-inner">
      <div>
        <div class="hist-saldo__sub-label">Приходы</div>
        <div class="hist-saldo__sub-val">${_fmt(totals.inTotal)}</div>
      </div>
      <div>
        <div class="hist-saldo__sub-label">Расходы</div>
        <div class="hist-saldo__sub-val">${_fmt(totals.outTotal)}</div>
      </div>
      <div>
        <div class="hist-saldo__sub-label">Переводы</div>
        <div class="hist-saldo__sub-val">${totals.transferCount} шт.</div>
      </div>
      <div>
        <div class="hist-saldo__sub-label">Операций</div>
        <div class="hist-saldo__sub-val">${_filtered.length}</div>
      </div>
    </div>`;

  return `
    <div class="hist-saldo__main">
      <div>
        <div class="hist-saldo__label">Сальдо за период</div>
      </div>
      <span class="${cls}">${sign}${_fmt(Math.abs(totals.net))}</span>
    </div>
    <div class="hist-saldo__grid">${gridHtml}</div>
  `;
}

function _computeSaldoTotals() {
  let inTotal = 0;
  let outTotal = 0;
  let transferCount = 0;
  _filtered.forEach(op => {
    const k = _opUiKind(op);
    const amt = Math.abs(Number(op.amount) || 0);
    if (k === 'transfer') transferCount++;
    else if (k === 'in') inTotal += amt;
    else outTotal += amt;
  });
  return { net: inTotal - outTotal, inTotal, outTotal, transferCount };
}

function _paintSaldo() {
  const el = document.getElementById('hist-saldo');
  if (!el) return;
  el.classList.toggle('hist-saldo--expanded', _saldoExpanded);
  el.innerHTML = _saldoMainHTML();
  el.setAttribute('aria-expanded', _saldoExpanded ? 'true' : 'false');
}

function _toggleNextDisabled() {
  const btn = document.getElementById('hist-next');
  if (!btn) return;
  const current =
    _selMonth === _now.getMonth() + 1 && _selYear === _now.getFullYear();
  btn.classList.toggle('hist-nav-btn--disabled', !!current);
  btn.style.opacity = current ? '0.35' : '';
  btn.style.pointerEvents = current ? 'none' : '';
}

function _toggleSearchViews() {
  const norm = document.getElementById('hist-nav-normal');
  const sea = document.getElementById('hist-nav-search');
  if (!norm || !sea) return;
  norm.classList.toggle('hist-nav-row--hidden', !!_searchMode);
  sea.classList.toggle('hist-nav-row--hidden', !_searchMode);
  const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
  if (inp && _searchMode) requestAnimationFrame(() => inp.focus());
}

/** Активны ли доп. фильтры оси 2 (машина / касса), без учёта поиска. */
function _hasExtraFilters() {
  return !!(_filters.carId || _filters.kassaId);
}

function _paintAxis2() {
  const row = document.getElementById('hist-axis2');
  if (!row) return;

  const { showKassa } = _paintCtx || {};

  const chips = [];

  if (_filters.carId) {
    const label = String(_filters.carId);
    chips.push(`
      <button type="button" class="hist-chip-active" data-chip-remove="car">
        <span>${label}</span>
        <span class="hist-chip-active__x">${SVG_X}</span>
      </button>`);
  }

  if (showKassa && _filters.kassaId) {
    chips.push(`
      <button type="button" class="hist-chip-active" data-chip-remove="kassa">
        <span>${_escapeHtml(_kassaTitle(_filters.kassaId))}</span>
        <span class="hist-chip-active__x">${SVG_X}</span>
      </button>`);
  }

  row.innerHTML = chips.join('');
  row.style.display = chips.length ? 'flex' : 'none';

  row.querySelectorAll('[data-chip-remove]').forEach(btn => {
    btn.addEventListener('click', ev => {
      const key = btn.getAttribute('data-chip-remove');
      if (key === 'car') _filters.carId = null;
      else if (key === 'kassa') _filters.kassaId = null;
      ev.stopPropagation();
      _refreshFromFilters();
    });
  });
}

function _bindHistShell(rawOps, fleet) {
  document.getElementById('hist-prev')?.addEventListener('click', () => {
    _selMonth--;
    if (_selMonth < 1) {
      _selMonth = 12;
      _selYear--;
    }
    _refreshMonth(rawOps, fleet);
  });

  document.getElementById('hist-next')?.addEventListener('click', () => {
    const next = _selMonth === 12 ? { m: 1, y: _selYear + 1 } : { m: _selMonth + 1, y: _selYear };
    if (
      next.y > _now.getFullYear()
      || (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)
    )
      return;
    _selMonth = next.m;
    _selYear = next.y;
    _refreshMonth(rawOps, fleet);
  });

  document.getElementById('hist-search-toggle')?.addEventListener('click', () => {
    _searchMode = true;
    _toggleSearchViews();
    const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
    if (inp) {
      inp.value = _filters.search;
      requestAnimationFrame(() => inp.focus());
    }
  });

  document.getElementById('hist-search-back')?.addEventListener('click', () => {
    _searchMode = false;
    _toggleSearchViews();
  });

  document.getElementById('hist-search-clear')?.addEventListener('click', () => {
    const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
    if (inp) inp.value = '';
    _filters.search = '';
    _refreshFromFilters();
  });

  document.getElementById('hist-search-input')?.addEventListener('input', e => {
    const inp = /** @type {HTMLInputElement} */ (e.target);
    _filters.search = inp.value || '';
    _refreshFromFilters();
  });

  document.getElementById('hist-type-chips')?.addEventListener('click', e => {
    const btn = /** @type {HTMLElement} */ (e.target.closest('[data-hist-axis-type]'));
    if (!btn) return;
    _filters.type = btn.getAttribute('data-hist-axis-type') || 'all';
    document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
      const act = /** @type {HTMLElement} */ (b);
      act.classList.toggle('hist-pill--active', act.dataset.histAxisType === _filters.type);
      act.classList.toggle('hist-chip--active', act.dataset.histAxisType === _filters.type);
      act.classList.toggle('hist-pill--idle', act.dataset.histAxisType !== _filters.type);
    });
    _refreshFromFilters();
  });

  document.getElementById('hist-saldo')?.addEventListener('click', () => {
    _saldoExpanded = !_saldoExpanded;
    _paintSaldo();
  });

  document.getElementById('hist-add-filter')?.addEventListener('click', () => _showFilterSheet());

  document.getElementById('hist-list')?.addEventListener('click', e => {
    if (/** @type {HTMLElement} */ (e.target).closest('***REMOVED***hist-reset')) {
      e.preventDefault();
      _filters = { type: 'all', carId: null, kassaId: null, search: '' };
      _searchMode = false;
      const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
      if (inp) inp.value = '';
      document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
        const act = /** @type {HTMLElement} */ (b);
        const isAll = act.dataset.histAxisType === 'all';
        act.classList.toggle('hist-pill--active', isAll);
        act.classList.toggle('hist-chip--active', isAll);
        act.classList.toggle('hist-pill--idle', !isAll);
      });
      _toggleSearchViews();
      _refreshFromFilters();
      return;
    }
    const row = /** @type {HTMLElement} */ (e.target.closest('[data-op-id]'));
    if (!row?.dataset.opId) return;
    const op =
      _filtered.find(o => o.opId === row.dataset.opId)
      ?? rawOps.find(o => o.opId === row.dataset.opId);
    if (op) _showOpDetail(op, fleet);
  });

  document.getElementById('hist-month-trigger')?.addEventListener('click', () => {});
}

function _refreshMonth(rawOps, fleet) {
  const ctx = _paintCtx;
  _filtered = _applyFilters(_opsInMonth(rawOps), _filters, ctx?.role ?? ROLES.MECHANIC);

  document.getElementById('hist-month-label')!.textContent = _monthLabelCapital();
  document.getElementById('hist-count')!.textContent = `${_filtered.length} операций`;

  _offset = 0;
  _destroyObserver();
  const list = document.getElementById('hist-list');
  if (list) list.innerHTML = '';
  _renderPage(rawOps, fleet);
  _paintSaldo();
  _paintAxis2();
  _toggleNextDisabled();

  document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
    const act = /** @type {HTMLElement} */ (b);
    act.classList.toggle('hist-pill--active', act.dataset.histAxisType === _filters.type);
    act.classList.toggle('hist-chip--active', act.dataset.histAxisType === _filters.type);
    act.classList.toggle('hist-pill--idle', act.dataset.histAxisType !== _filters.type);
  });
}

function _refreshFromFilters() {
  const { rawOps, fleet, role } = _paintCtx || {};
  if (!rawOps || !fleet) return;

  _filtered = _applyFilters(_opsInMonth(rawOps), _filters, role);

  document.getElementById('hist-count')!.textContent = `${_filtered.length} операций`;

  _offset = 0;
  _destroyObserver();
  document.getElementById('hist-list')!.innerHTML = '';
  _renderPage(rawOps, fleet);

  _paintSaldo();
  _paintAxis2();
}

function _renderPage(rawOps, fleet) {
  const list = document.getElementById('hist-list');
  if (!list) return;

  const page = _filtered.slice(_offset, _offset + _PAGE);
  const { showKassa } = _paintCtx || {};

  if (!page.length) {
    _destroyObserver();
    if (_offset === 0) list.innerHTML = _emptyOpsHTML(rawOps.length === 0, fleet);
    return;
  }

  const groups = _groupByDay(page);
  let html = '';
  groups.forEach(({ label, ops, groupKey }) => {
    if (!list.querySelector(`[data-day-key="${groupKey}"]`)) {
      html += `<div class="ops-day-label" data-day-key="${groupKey}" data-day="${_escapeHtml(label)}">${label}</div>`;
    }
    html += ops.map(op => _opRowHTML(op, fleet, !!showKassa)).join('');
  });

  list.insertAdjacentHTML('beforeend', html);
  _offset += page.length;

  if (_offset >= _filtered.length) {
    _destroyObserver();
    return;
  }
  _initObserver(rawOps, fleet);
}

function _emptyOpsHTML(isNoOpsAtAll, fleet) {
  const month = _monthLabelEmptyPhrase();
  let txt = '';
  if (isNoOpsAtAll && !_hasExtraFilters()) {
    txt = 'Ещё нет ни одной операции';
  } else if (_filters.carId) {
    txt = `По фильтру «${_filters.carId}» в ${month} ничего нет`;
  } else if (_filters.search.trim()) {
    txt = `По запросу в ${month} ничего не найдено`;
  } else if (_filters.type === 'income')
    txt = `Доходов в ${month} нет`;
  else if (_filters.type === 'expense')
    txt = `Расходов в ${month} нет`;
  else if (_filters.type === 'transfer')
    txt = `Переводов в ${month} нет`;
  else txt = `В ${month} операций нет`;

  void fleet;
  return `
    <div class="hist-empty" id="hist-empty-block">
      <div class="hist-empty__icon">${SVG_RECEIPT}</div>
      <div class="hist-empty__text">${_escapeHtml(txt)}</div>
      <div class="hist-empty__sub">Попробуй снять фильтр или сменить месяц</div>
      <button type="button" class="hist-empty__reset" id="hist-reset">Сбросить фильтры</button>
    </div>`;
}

function _opRowHTML(op, fleet, showKassaInMeta) {
  const kind = _opUiKind(op);
  let dotCls = 'op-row__dot op-row__dot--exp';
  let sign = '−';
  if (kind === 'in') {
    dotCls = 'op-row__dot op-row__dot--inc';
    sign = '+';
  } else if (kind === 'transfer') {
    dotCls = 'op-row__dot op-row__dot--xfer';
    sign = '⇄';
  }

  const cat = String(op.category || op.type || op.direction || '—');

  const car = fleet.find(c => String(c.carId).trim() === String(op.carId || '').trim());
  const carTxt = car ? car.carId : String(op.carId || '').trim();
  const provel = op.provel ? String(op.provel) : '';
  const kassaTit = showKassaInMeta && op.kassaId ? _kassaTitle(op.kassaId) : '';

  let metaParts = [];
  if (carTxt) metaParts.push(carTxt);
  if (provel) metaParts.push(provel);
  if (kassaTit) metaParts.push(kassaTit);
  const meta = metaParts.join(' · ');

  const colorCls =
    kind === 'in'
      ? 'op-row__amount op-row__amount--inc'
      : kind === 'transfer'
        ? 'op-row__amount op-row__amount--xfer'
        : 'op-row__amount op-row__amount--exp';

  const amtPrefix = kind === 'transfer' ? '' : sign;
  const amtDisp = amtPrefix !== '' ? amtPrefix + _fmtBare(op.amount) : _fmtBare(op.amount);

  return `
    <div class="op-row" data-op-id="${_escapeHtml(op.opId ?? '')}">
      <span class="${dotCls}">${kind === 'transfer' ? '⇄' : sign}</span>
      <div class="op-row__body">
        <div class="op-row__cat">${_escapeHtml(cat)}</div>
        ${meta ? `<div class="op-row__meta">${_escapeHtml(meta)}</div>` : ''}
      </div>
      <div class="op-row__right">
        <span class="${colorCls}">${amtDisp} ₽</span>
        ${op.dateRaw ? `<span class="op-row__time">${_escapeHtml(String(op.dateRaw))}</span>` : ''}
      </div>
    </div>`;
}

function _showFilterSheet() {
  const { rawOps, fleet, showKassa } = _paintCtx || {};
  if (!rawOps) return;

  const monthSlice = _opsInMonth(rawOps);
  const baseCars = _filterByAxisType(monthSlice);

  const uniq = new Set(
    baseCars
      .map(o => String(o.carId || '').trim())
      .filter(Boolean),
  );

  (fleet || []).forEach(car => uniq.add(String(car.carId)));

  const carOpts = Array.from(uniq)
    .sort((a, b) => String(a).localeCompare(String(b), 'ru'))
    .map(cid => `
      <button type="button" class="hist-filter-opt ${_filters.carId === cid ? 'hist-filter-opt--active' : ''}"
        data-filter-type="car" data-val="${_escapeHtml(cid)}">${_escapeHtml(cid)}</button>
    `)
    .join('');

  const kassaOpts = `
    ${[KASSA_ID.AZAMAT, KASSA_ID.VLADIMIR, KASSA_ID.YULIA]
      .map(
        kid => `
      <button type="button"
        class="hist-filter-opt ${_filters.kassaId === kid ? 'hist-filter-opt--active' : ''}"
        data-filter-type="kassa" data-val="${kid}">
        ${_escapeHtml(_kassaShort(kid))}
      </button>`,
      )
      .join('')}`;

  const kassaSection =
    showKassa
      ? `
    <div class="hist-filter-section" id="hist-filter-kassa-section">
      <div class="hist-filter-section__label">По кассе</div>
      <div class="hist-filter-options" id="hist-filter-kassa">
        ${kassaOpts}
      </div>
    </div>`
      : '';

  const html = `
    <div class="hist-filter-sheet">
      <div class="hist-filter-sheet__title">Добавить фильтр</div>
      <div class="hist-filter-section">
        <div class="hist-filter-section__label">По машине</div>
        <div class="hist-filter-options" id="hist-filter-cars">${carOpts || '<span class="hist-filter-empty">Нет данных</span>'}</div>
      </div>
      ${kassaSection}
    </div>`;

  showBottomSheet(html);

  const onPick = /** @type {EventListener} */ (ev => {
    const opt = /** @type {HTMLElement} */ (ev.target.closest('.hist-filter-opt'));
    if (!opt) return;
    ev.stopPropagation();
    const fType = opt.getAttribute('data-filter-type');
    const val = opt.getAttribute('data-val');
    if (fType === 'car' && val != null && val !== '') _filters.carId = val;
    if (fType === 'kassa' && val) _filters.kassaId = val;
    hideBottomSheet(() => {
      _refreshFromFilters();
    });
  });

  setTimeout(() => {
    document.getElementById('bs-content')?.addEventListener('click', onPick, { once: true });
  }, 0);
}

function _kassaShort(id) {
  if (id === KASSA_ID.AZAMAT) return 'Азамат';
  if (id === KASSA_ID.VLADIMIR) return 'Владимир';
  if (id === KASSA_ID.YULIA) return 'Юлия';
  return id;
}

function _showOpDetail(op, fleet) {
  const dir = String(op.direction || '');
  const kind = _opUiKind(op);
  const heroSign = kind === 'in' ? '+' : kind === 'transfer' ? '⇄' : '−';
  const heroCls =
    kind === 'in' ? 'bs-op-hero--in' : kind === 'transfer' ? 'bs-op-hero--xfer' : 'bs-op-hero--out';

  const car = fleet.find(c => String(c.carId).trim() === String(op.carId || '').trim());
  const carLbl = car ? `${car.carId}${car.name ? ' · ' + car.name : ''}` : (op.carId || '—');

  const field = (label, value) =>
    value
      ? `<div class="bs-op-field"><span class="bs-op-field__lbl">${label}</span><span class="bs-op-field__val">${_escapeHtml(value)}</span></div>`
      : '';

  showBottomSheet(`
    <div class="bs-op-hero ${heroCls}">
      <span class="bs-op-hero__sign">${heroSign}</span>
      <span class="bs-op-hero__amount">${_fmtBare(op.amount)} ₽</span>
      <span class="bs-op-hero__dir">${_escapeHtml(dir)}</span>
    </div>
    <div class="bs-op-fields">
      ${field('ID', op.opId)}
      ${field('Дата', op.dateRaw)}
      ${field('Категория', op.category || op.type)}
      ${field('Касса', op.kassaId ? _kassaTitle(op.kassaId) : '')}
      ${field('Машина', carLbl)}
      ${field('Провёл', op.provel)}
      ${field('Комментарий', op.comment)}
    </div>
  `);
}

function _initObserver(rawOps, fleet) {
  const sentinel = document.getElementById('hist-sentinel');
  if (!sentinel) return;
  _observer = new IntersectionObserver(
    ents => {
      if (ents[0].isIntersecting) void _renderPage(rawOps, fleet);
    },
    { rootMargin: '120px' },
  );
  _observer.observe(sentinel);
}

function _destroyObserver() {
  _observer?.disconnect();
  _observer = null;
}

function _groupByDay(ops) {
  const map = new Map();
  const order = [];
  ops.forEach(op => {
    const d = _opDate(op);
    const key =
      d && !Number.isNaN(d.getTime()) ? _dayKey(d) : '__nodate';
    const lbl = key === '__nodate' ? 'Без даты' : formatGroupLabel(d);
    if (!map.has(key)) {
      map.set(key, { groupKey: key, label: lbl, ops: [] });
      order.push(key);
    }
    map.get(key).ops.push(op);
  });
  return order.map(key => map.get(key));
}

function _fmt(n) {
  return `${Math.round(Math.abs(Number(n))).toLocaleString('ru-RU')} ₽`;
}

function _fmtBare(n) {
  return `${Math.round(Math.abs(Number(n))).toLocaleString('ru-RU')}`;
}

function _escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _skeletonHTML() {
  const ln = w =>
    `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:6px"></div>`;
  return `
<div class="hist-page">
    <div class="hist-hdr hist-hdr--skeleton">${ln(40)}${ln(65)}${ln(50)}
    </div>
    <div class="hist-body hist-body--loading">
      <div class="hist-list">
      ${[1, 2, 3, 4, 5, 6]
        .map(
          () => `
        <div class="op-row" style="pointer-events:none">
          <div class="skeleton op-row__dot" style="width:28px;height:28px;border-radius:50%;flex-shrink:0"></div>
          <div style="flex:1">${ln(55)}${ln(35)}</div>
          <div class="skeleton skeleton-line" style="width:64px"></div>
        </div>`,
        )
        .join('')}
      </div>
    </div>
</div>`;
}
