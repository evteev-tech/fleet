/**
 * history.js — Касса: журнал операций (шапка, фильтры, сводка, группировка по дням).
 */

import { getOperations, getFleet, getRentals, getKassas, getDrivers } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showBottomSheet, hideBottomSheet } from '../ui.js';
import { KASSA_ID, KASSA_NAMES, ROLES } from '../config.js';
import { currentScreen } from '../router.js';
import { openEditOperation } from './edit-operation.js';
import {
  declOperations,
  formatRubWithSign,
  monthPrepositional,
  monthYearLabel,
  MINUS,
} from '../lib/kassa-money.js';
import {
  EXPENSE_CATEGORY_PRESETS,
  normalizeType,
  isTransferOp,
  opUiKind,
  computeSaldoBreakdown,
  getOperationTile,
  getOperationTitle,
  getOperationSubtitle,
  compareOpsNewestFirst,
  kassaLineLabel,
} from '../lib/kassa-operations.js';

const LS_SUMMARY = 'kassa.summary.expanded';
const INV_KASSA = new Set([KASSA_ID.INVEST_YULIA, KASSA_ID.INVEST_VLAD]);

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

function _dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _opDate(op) {
  if (op.date instanceof Date && !Number.isNaN(op.date.getTime())) return op.date;
  return parseRuDate(op.dateRaw);
}

const _now = new Date();

/** @type {{ type: string, cars: string[], cassas: string[], categories: string[], drivers: string[], search: string }} */
let _filters = {
  type: 'all',
  cars: [],
  cassas: [],
  categories: [],
  drivers: [],
  search: '',
};

let _selMonth = _now.getMonth() + 1;
let _selYear = _now.getFullYear();

let _searchMode = false;
let _filtered = [];
let _saldoExpanded = false;

let _paintCtx =
  /** @type {{ rawOps: any[], fleet: any[], rentals: any[], kassas: any[], drivers: any[], role: string, isMechanic: boolean, showKassa: boolean }} */ (
    null
  );

let _rawOpsAll = /** @type {any[]|undefined} */ (undefined);
let _fleetCache = /** @type {any[]|undefined} */ (undefined);
let _rentalsCache = /** @type {any[]|undefined} */ (undefined);
let _kassasCache = /** @type {any[]|undefined} */ (undefined);
let _driversCache = /** @type {any[]|undefined} */ (undefined);

const TYPE_AXIS = [
  { id: 'all', label: 'Все' },
  { id: 'income', label: 'Доходы' },
  { id: 'expense', label: 'Расходы' },
  { id: 'transfer', label: 'Переводы' },
];

const SVG_SEARCH =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>';
const SVG_X =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>';
const SVG_X_LG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>';
const SVG_CHEVRON_DOWN =
  '<svg class="hist-saldo__chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_CHEVRON_MONTH =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_L =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_R =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_RECEIPT_IN_EMPTY =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3h14a1 1 0 011 1v16l-4-2-4 2-4-2-4 2V4a1 1 0 011-1z"/><path stroke-linecap="round" d="M8 10h8M8 14h8"/></svg>';
const SVG_PLUS =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>';

// ═══════════════════════════════════════════════════════════════════════════
function _roleFlags(user) {
  const role = user?.role || ROLES.MECHANIC;
  const isMechanic = role === ROLES.MECHANIC;
  const showKassa = role === ROLES.OPERATIONS || role === ROLES.INVESTOR;
  return { role, isMechanic, showKassa };
}

function _readSummaryExpanded() {
  try {
    return localStorage.getItem(LS_SUMMARY) === '1';
  } catch {
    return false;
  }
}

function _writeSummaryExpanded(v) {
  try {
    localStorage.setItem(LS_SUMMARY, v ? '1' : '0');
  } catch {
    /* */
  }
}

function _parseCsv(param) {
  if (param == null || param === '') return [];
  return String(param)
    .split(',')
    .map(s => decodeURIComponent(s.trim()))
    .filter(Boolean);
}

function _readFiltersFromURL() {
  const p = new URLSearchParams(window.location.search);
  const m = p.get('month');
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number);
    if (y >= 2000 && y < 2100 && mo >= 1 && mo <= 12) {
      _selYear = y;
      _selMonth = mo;
    }
  }
  const t = p.get('type');
  if (t === 'income' || t === 'expense' || t === 'transfer' || t === 'all') _filters.type = t;
  _filters.cars = _parseCsv(p.get('car'));
  _filters.cassas = _parseCsv(p.get('cassa'));
  _filters.categories = _parseCsv(p.get('category'));
  _filters.drivers = _parseCsv(p.get('driver'));
  _filters.search = p.get('search') || '';
}

function _writeFiltersToURL(push) {
  const u = new URL(window.location.href);
  u.searchParams.set('month', `${_selYear}-${String(_selMonth).padStart(2, '0')}`);
  u.searchParams.set('type', _filters.type);
  if (_filters.cars.length) u.searchParams.set('car', _filters.cars.join(','));
  else u.searchParams.delete('car');
  if (_filters.cassas.length) u.searchParams.set('cassa', _filters.cassas.join(','));
  else u.searchParams.delete('cassa');
  if (_filters.categories.length) u.searchParams.set('category', _filters.categories.join(','));
  else u.searchParams.delete('category');
  if (_filters.drivers.length) u.searchParams.set('driver', _filters.drivers.join(','));
  else u.searchParams.delete('driver');
  if (_filters.search.trim()) u.searchParams.set('search', _filters.search.trim());
  else u.searchParams.delete('search');

  const fn = push ? 'pushState' : 'replaceState';
  window.history[fn]({ kassa: 1 }, '', u.toString());
}

function _ensureURLDefaults(replaceOnly) {
  const p = new URLSearchParams(window.location.search);
  if (!p.get('month')) {
    _writeFiltersToURL(false);
    void replaceOnly;
  }
}

function _opsInMonth(ops) {
  return ops.filter(op => {
    const d = _opDate(op);
    if (!d || Number.isNaN(d.getTime())) return false;
    return d.getMonth() + 1 === _selMonth && d.getFullYear() === _selYear;
  });
}

function _filterByAxisType(ops) {
  const t = _filters.type;
  if (t === 'income') {
    return ops.filter(
      o => String(o.direction).trim() === 'приход' && normalizeType(o.type) !== 'перевод_входящий',
    );
  }
  if (t === 'expense') {
    return ops.filter(
      o => String(o.direction).trim() === 'расход' && normalizeType(o.type) !== 'перевод_исходящий',
    );
  }
  if (t === 'transfer') return ops.filter(isTransferOp);
  return [...ops];
}

function _applyFilters(opsMonthUnsorted, filters, role) {
  let result = _filterByAxisType(opsMonthUnsorted);

  if (filters.cars.length) {
    const set = new Set(filters.cars.map(String));
    result = result.filter(o => set.has(String(o.carId || '').trim()));
  }

  const mechanic = role === ROLES.MECHANIC;
  if (filters.cassas.length && !mechanic) {
    const set = new Set(filters.cassas.map(String));
    result = result.filter(o => set.has(String(o.kassaId || '').trim()));
  }

  if (filters.categories.length) {
    const set = new Set(filters.categories.map(c => normalizeType(c)));
    result = result.filter(o => set.has(normalizeType(o.category)));
  }

  if (filters.drivers.length) {
    const set = new Set(filters.drivers.map(String));
    result = result.filter(o => set.has(String(o.driverId || '').trim()));
  }

  // Поиск по всем значимым полям
  if (filters.search) {
    const q = filters.search.toLowerCase().trim();
    if (q) {
      result = result.filter(op => {
        const haystack = [
          op.comment,
          op.carId,
          op.category,
          op.type,
          op.direction,
          op.provel,
          op.kassaId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
  }

  return result.sort(compareOpsNewestFirst);
}

function _kassaTitle(id) {
  return KASSA_NAMES[id] || id || '';
}

function _monthLabelHeader() {
  return monthYearLabel(_selYear, _selMonth);
}

function _hasExtraFilters() {
  return (
    _filters.cars.length +
      _filters.cassas.length +
      _filters.categories.length +
      _filters.drivers.length >
    0
  );
}

function _axisCountsForSheet() {
  return {
    car: _filters.cars.length,
    cassa: _filters.cassas.length,
    category: _filters.categories.length,
    driver: _filters.drivers.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
export function initHistory() {
  _saldoExpanded = _readSummaryExpanded();

  document.addEventListener('history:filter', e => {
    const { kassaId } = e.detail ?? {};
    if (kassaId && !_filters.cassas.includes(String(kassaId))) {
      _filters.cassas = [..._filters.cassas, String(kassaId)];
      _writeFiltersToURL(true);
    }
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-history') void renderHistory();
  });

  window.addEventListener('popstate', () => {
    if (currentScreen() !== 'screen-history') return;
    _readFiltersFromURL();
    _searchMode = !!_filters.search.trim();
    _saldoExpanded = _readSummaryExpanded();
    if (_rawOpsAll !== undefined && _fleetCache !== undefined) {
      _rerenderFromCache();
    }
  });
}

function _rerenderFromCache() {
  const shell = document.getElementById('history-body');
  if (!shell || _rawOpsAll === undefined || _fleetCache === undefined) return;
  const user = getCurrentUser();
  const { role, isMechanic, showKassa } = _roleFlags(user);
  const rawOps = isMechanic
    ? _rawOpsAll.filter(op => String(op.kassaId ?? '').trim() === String(KASSA_ID.AZAMAT))
    : _rawOpsAll;
  _paintCtx = {
    rawOps,
    fleet: _fleetCache,
    rentals: _rentalsCache || [],
    kassas: _kassasCache || [],
    drivers: _driversCache || [],
    role,
    isMechanic,
    showKassa,
  };
  const monthSlice = _opsInMonth(rawOps);
  _filtered = _applyFilters(monthSlice, _filters, role);
  shell.innerHTML = _shellHTML();
  _bindHistShell(rawOps, _fleetCache);
  _renderFullList();
  _paintSaldo();
  _toggleSearchViews();
  _toggleNextDisabled();
}

export async function renderHistory() {
  const shell = document.getElementById('history-body');
  if (!shell) return;

  _saldoExpanded = _readSummaryExpanded();
  _readFiltersFromURL();
  _ensureURLDefaults(true);

  const user = getCurrentUser();
  const { role, isMechanic, showKassa } = _roleFlags(user);
  _paintCtx = {
    rawOps: [],
    fleet: [],
    rentals: [],
    kassas: [],
    drivers: [],
    role,
    isMechanic,
    showKassa,
  };

  let cacheHit = false;

  const paintHistoryShell = () => {
    if (
      _rawOpsAll === undefined ||
      _fleetCache === undefined ||
      _rentalsCache === undefined ||
      _kassasCache === undefined ||
      _driversCache === undefined
    )
      return;

    let rawOps = isMechanic
      ? _rawOpsAll.filter(op => String(op.kassaId ?? '').trim() === String(KASSA_ID.AZAMAT))
      : _rawOpsAll;

    _paintCtx = {
      rawOps,
      fleet: _fleetCache,
      rentals: _rentalsCache,
      kassas: _kassasCache,
      drivers: _driversCache,
      role,
      isMechanic,
      showKassa,
    };

    const monthSlice = _opsInMonth(rawOps);
    _filtered = _applyFilters(monthSlice, _filters, role);

    shell.innerHTML = _shellHTML();
    _bindHistShell(rawOps, _fleetCache);
    _renderFullList();
    _paintSaldo();
    _toggleSearchViews();
    _toggleNextDisabled();
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => {
      cacheHit = true;
      _rawOpsAll = d;
      paintHistoryShell();
    },
    onFresh: d => {
      _rawOpsAll = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) _rawOpsAll = [];
      paintHistoryShell();
    },
  });

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      _fleetCache = d;
      paintHistoryShell();
    },
    onFresh: d => {
      _fleetCache = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) _fleetCache = [];
      paintHistoryShell();
    },
  });

  getWithSWR(CACHE_KEYS.RENTALS, () => getRentals(), {
    onCached: d => {
      _rentalsCache = d;
      paintHistoryShell();
    },
    onFresh: d => {
      _rentalsCache = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) _rentalsCache = [];
      paintHistoryShell();
    },
  });

  getWithSWR(CACHE_KEYS.KASSAS, () => getKassas(), {
    onCached: d => {
      _kassasCache = d;
      paintHistoryShell();
    },
    onFresh: d => {
      _kassasCache = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) _kassasCache = [];
      paintHistoryShell();
    },
  });

  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => {
      _driversCache = d;
      paintHistoryShell();
    },
    onFresh: d => {
      _driversCache = d;
      paintHistoryShell();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) _driversCache = [];
      paintHistoryShell();
    },
  });

  setTimeout(() => {
    if (!cacheHit && _rawOpsAll === undefined) {
      shell.innerHTML = _skeletonHTML();
    }
  }, 0);
}

function _shellHTML() {
  const axisPills = TYPE_AXIS.map(
    p => `
    <button type="button"
      class="hist-type-chip ${_filters.type === p.id ? 'hist-type-chip--on' : ''}"
      data-hist-axis-type="${p.id}"
      aria-pressed="${_filters.type === p.id ? 'true' : 'false'}">
      ${p.label}
    </button>`,
  ).join('');

  const extraChips = _extraFilterChipsHTML();

  return `
<div class="hist-page">
  <div class="hist-hdr">
    <div class="hist-nav-row" id="hist-nav-normal">
      <button type="button" class="hist-round-btn" id="hist-prev" aria-label="Предыдущий месяц">${CHEV_L}</button>
      <button type="button" class="hist-month-center" id="hist-month-trigger" aria-label="Выбрать месяц">
        <span id="hist-month-label">${_escapeHtml(_monthLabelHeader())}</span>
        ${SVG_CHEVRON_MONTH}
      </button>
      <div class="hist-nav-actions">
        <button type="button" class="hist-round-btn" id="hist-search-toggle" aria-label="Поиск">${SVG_SEARCH}</button>
        <button type="button" class="hist-round-btn" id="hist-next" aria-label="Следующий месяц">${CHEV_R}</button>
      </div>
    </div>

    <div class="hist-nav-row hist-nav-row--search hist-nav-row--hidden" id="hist-nav-search">
      <button type="button" class="hist-round-btn" id="hist-search-back" aria-label="Назад из поиска">${CHEV_L}</button>
      <div class="hist-search-field">
        <span class="hist-search-field__ico">${SVG_SEARCH}</span>
        <input type="search" id="hist-search-input" class="hist-search-field__inp" placeholder="Поиск по комментарию…" autocomplete="off" spellcheck="false" />
      </div>
      <button type="button" class="hist-round-btn" id="hist-search-clear" aria-label="Очистить поиск">${SVG_X_LG}</button>
    </div>

    <div class="hist-filters-row" id="hist-filters-row">
      <div class="hist-filters-row__types">
        ${axisPills}
      </div>
      <div class="hist-filters-row__vsep" aria-hidden="true"></div>
      <div class="hist-filters-row__extra-wrap">
        <div class="hist-filters-row__extra" id="hist-extra-chips">
          ${extraChips}
        </div>
        <button type="button" class="hist-add-dot" id="hist-add-filter" aria-label="Добавить фильтр">${SVG_PLUS}</button>
      </div>
    </div>

    <div class="hist-saldo-wrap" id="hist-saldo-wrap"></div>
  </div>

  <div class="hist-body">
    <div class="hist-list" id="hist-list"></div>
  </div>
</div>`;
}

function _getMonthOverlay() {
  let el = document.getElementById('hist-month-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hist-month-overlay';
    el.className = 'hist-modal hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Выбор месяца');
    document.body.appendChild(el);
  }
  return el;
}

function _extraFilterChipsHTML() {
  const { showKassa } = _paintCtx || {};
  const parts = [];
  for (const c of _filters.cars) {
    parts.push(_chipHtml('car', c, c));
  }
  if (showKassa) {
    for (const k of _filters.cassas) {
      parts.push(_chipHtml('cassa', k, _kassaTitle(k)));
    }
  }
  for (const c of _filters.categories) {
    parts.push(_chipHtml('category', c, c));
  }
  for (const d of _filters.drivers) {
    const drv = (_driversCache || []).find(x => String(x.driverId).trim() === String(d));
    const lab = drv?.name ? String(drv.name) : d;
    parts.push(_chipHtml('driver', d, lab));
  }
  return parts.join('');
}

function _chipHtml(axis, val, label) {
  return `<button type="button" class="hist-filter-chip" data-rm-axis="${_escapeAttr(axis)}" data-rm-val="${_escapeAttr(val)}">
    <span>${_escapeHtml(label)}</span>
    <span class="hist-filter-chip__x" aria-hidden="true">${SVG_X}</span>
  </button>`;
}

function _saldoInnerHTML() {
  const br = computeSaldoBreakdown(_filtered, _filters.type);
  const net = br.net;
  const pos = net >= 0;
  const sign = pos ? '+' : MINUS;
  const valCls = pos ? 'hist-saldo2__val--pos' : 'hist-saldo2__val--neg';
  const monthNom = new Date(_selYear, _selMonth - 1, 1).toLocaleDateString('ru-RU', { month: 'long' });
  const incSign = '+';
  const expSign = MINUS;

  return `
    <button type="button" class="hist-saldo2__toggle" id="hist-saldo-toggle" aria-expanded="${_saldoExpanded}">
      <span class="hist-saldo2__lbl">Сальдо за ${_escapeHtml(monthNom)}</span>
      <span class="hist-saldo2__right">
        <span class="hist-saldo2__val ${valCls}">${formatRubWithSign(Math.abs(net), sign)}</span>
        <span class="hist-saldo2__chev-wrap" aria-hidden="true">${SVG_CHEVRON_DOWN}</span>
      </span>
    </button>
    <div class="hist-saldo2__detail" id="hist-saldo-detail">
      <div class="hist-saldo2__row">
        <span class="hist-saldo2__sub-lbl">Приход</span>
        <span class="hist-saldo2__sub-val hist-saldo2__sub-val--inc">${formatRubWithSign(br.income, incSign)}</span>
      </div>
      <div class="hist-saldo2__row">
        <span class="hist-saldo2__sub-lbl">Расход</span>
        <span class="hist-saldo2__sub-val hist-saldo2__sub-val--exp">${formatRubWithSign(br.expense, expSign)}</span>
      </div>
    </div>`;
}

function _paintSaldo() {
  const wrap = document.getElementById('hist-saldo-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="hist-saldo2${_saldoExpanded ? ' hist-saldo2--open' : ''}" id="hist-saldo">${_saldoInnerHTML()}</div>`;

  document.getElementById('hist-saldo-toggle')?.addEventListener('click', () => {
    _saldoExpanded = !_saldoExpanded;
    _writeSummaryExpanded(_saldoExpanded);
    _paintSaldo();
  });
}

function _toggleNextDisabled() {
  const btn = document.getElementById('hist-next');
  if (!btn) return;
  const cur = _selMonth === _now.getMonth() + 1 && _selYear === _now.getFullYear();
  btn.disabled = !!cur;
  btn.classList.toggle('hist-round-btn--disabled', !!cur);
  btn.style.opacity = cur ? '0.4' : '';
  btn.style.pointerEvents = cur ? 'none' : '';
}

function _toggleSearchViews() {
  const norm = document.getElementById('hist-nav-normal');
  const sea = document.getElementById('hist-nav-search');
  if (!norm || !sea) return;
  norm.classList.toggle('hist-nav-row--hidden', !!_searchMode);
  sea.classList.toggle('hist-nav-row--hidden', !_searchMode);
  const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
  if (inp && _searchMode) {
    inp.value = _filters.search;
    requestAnimationFrame(() => inp.focus());
  }
}

function _refreshAfterFilterChange(pushUrl) {
  const { rawOps, fleet, role } = _paintCtx || {};
  if (!rawOps || !fleet) return;
  _filtered = _applyFilters(_opsInMonth(rawOps), _filters, role);
  if (pushUrl) _writeFiltersToURL(true);
  _renderFullList();
  _paintSaldo();
  const ex = document.getElementById('hist-extra-chips');
  if (ex) ex.innerHTML = _extraFilterChipsHTML();
  _bindExtraChipClicks();
}

function _bindExtraChipClicks() {
  document.getElementById('hist-extra-chips')?.querySelectorAll('.hist-filter-chip').forEach(btn => {
    btn.addEventListener('click', ev => {
      const ax = btn.getAttribute('data-rm-axis');
      const v = btn.getAttribute('data-rm-val');
      if (ax === 'car') _filters.cars = _filters.cars.filter(x => x !== v);
      if (ax === 'cassa') _filters.cassas = _filters.cassas.filter(x => x !== v);
      if (ax === 'category') _filters.categories = _filters.categories.filter(x => x !== v);
      if (ax === 'driver') _filters.drivers = _filters.drivers.filter(x => x !== v);
      ev.stopPropagation();
      _refreshAfterFilterChange(true);
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
    _writeFiltersToURL(true);
    _refreshMonth(rawOps, fleet);
  });

  document.getElementById('hist-next')?.addEventListener('click', () => {
    if (document.getElementById('hist-next')?.disabled) return;
    const next = _selMonth === 12 ? { m: 1, y: _selYear + 1 } : { m: _selMonth + 1, y: _selYear };
    if (
      next.y > _now.getFullYear()
      || (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)
    )
      return;
    _selMonth = next.m;
    _selYear = next.y;
    _writeFiltersToURL(true);
    _refreshMonth(rawOps, fleet);
  });

  document.getElementById('hist-month-trigger')?.addEventListener('click', () => _openMonthPicker());

  document.getElementById('hist-search-toggle')?.addEventListener('click', () => {
    _searchMode = true;
    _toggleSearchViews();
  });

  document.getElementById('hist-search-back')?.addEventListener('click', () => {
    _searchMode = false;
    _toggleSearchViews();
  });

  document.getElementById('hist-search-clear')?.addEventListener('click', () => {
    const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
    if (inp) inp.value = '';
    _filters.search = '';
    _refreshAfterFilterChange(true);
  });

  document.getElementById('hist-search-input')?.addEventListener('input', e => {
    const inp = /** @type {HTMLInputElement} */ (e.target);
    _filters.search = inp.value || '';
    _refreshAfterFilterChange(true);
  });

  document.getElementById('hist-filters-row')?.addEventListener('click', e => {
    const btn = /** @type {HTMLElement} */ (e.target.closest('[data-hist-axis-type]'));
    if (!btn) return;
    _filters.type = btn.getAttribute('data-hist-axis-type') || 'all';
    document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
      const on = /** @type {HTMLElement} */ (b).dataset.histAxisType === _filters.type;
      b.classList.toggle('hist-type-chip--on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    _refreshAfterFilterChange(true);
  });

  document.getElementById('hist-add-filter')?.addEventListener('click', () => _showAddFilterSheet());

  document.getElementById('hist-list')?.addEventListener('click', e => {
    if (/** @type {HTMLElement} */ (e.target).closest('***REMOVED***hist-reset')) {
      e.preventDefault();
      _filters = {
        type: 'all',
        cars: [],
        cassas: [],
        categories: [],
        drivers: [],
        search: '',
      };
      _searchMode = false;
      const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
      if (inp) inp.value = '';
      _writeFiltersToURL(true);
      document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
        const on = /** @type {HTMLElement} */ (b).dataset.histAxisType === 'all';
        b.classList.toggle('hist-type-chip--on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      _toggleSearchViews();
      _refreshAfterFilterChange(false);
      return;
    }
    const row = /** @type {HTMLElement} */ (e.target.closest('[data-op-id]'));
    if (!row?.dataset.opId) return;
    const op =
      _filtered.find(o => o.opId === row.dataset.opId)
      ?? rawOps.find(o => o.opId === row.dataset.opId);
    if (op) _showOpDetail(op, fleet);
  });

  _bindExtraChipClicks();
}

function _refreshMonth(rawOps, fleet) {
  const ctx = _paintCtx;
  _filtered = _applyFilters(_opsInMonth(rawOps), _filters, ctx?.role ?? ROLES.MECHANIC);

  const monthLabel = document.getElementById('hist-month-label');
  if (monthLabel) monthLabel.textContent = _monthLabelHeader();

  _renderFullList();
  _paintSaldo();
  const ex = document.getElementById('hist-extra-chips');
  if (ex) ex.innerHTML = _extraFilterChipsHTML();
  _bindExtraChipClicks();
  _toggleNextDisabled();

  document.querySelectorAll('[data-hist-axis-type]').forEach(b => {
    const on = /** @type {HTMLElement} */ (b).dataset.histAxisType === _filters.type;
    b.classList.toggle('hist-type-chip--on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function _dayHeaderLine(date, count) {
  const d = date.getDate();
  const month = date.toLocaleDateString('ru-RU', { month: 'long' }).toUpperCase();
  let wd = date.toLocaleDateString('ru-RU', { weekday: 'short' }).toUpperCase();
  wd = wd.replace(/\.$/, '');
  const dc = declOperations(count);
  return `
    <div class="hist-day-hdr">
      <span class="hist-day-hdr__left">${d} ${month} · ${wd}</span>
      <span class="hist-day-hdr__cnt">${count} ${dc}</span>
    </div>`;
}

function _groupByDaySorted(ops) {
  const map = new Map();
  const order = [];
  for (const op of ops) {
    const d = _opDate(op);
    const key = d && !Number.isNaN(d.getTime()) ? _dayKey(d) : '__nodate';
    if (!map.has(key)) {
      const dt = d && !Number.isNaN(d.getTime()) ? d : null;
      map.set(key, { groupKey: key, date: dt, ops: [] });
      order.push(key);
    }
    map.get(key).ops.push(op);
  }
  order.sort((a, b) => {
    if (a === '__nodate') return 1;
    if (b === '__nodate') return -1;
    return b.localeCompare(a);
  });
  return order.map(k => map.get(k));
}

function _renderFullList() {
  const list = document.getElementById('hist-list');
  if (!list) return;

  const { fleet, rentals, showKassa } = _paintCtx || {};

  if (!_filtered.length) {
    list.innerHTML = _emptyOpsHTML(_rawOpsAll?.length === 0);
    return;
  }

  const dayGroupsFull = _groupByDaySorted(_filtered);
  const countByKey = new Map(dayGroupsFull.map(g => [g.groupKey, g.ops.length]));

  const rendered = _groupByDaySorted(_filtered);
  let html = '';
  for (const g of rendered) {
    const cnt = countByKey.get(g.groupKey) || g.ops.length;
    const hdr =
      g.groupKey === '__nodate'
        ? _dayHeaderLine(new Date(0), cnt)
        : _dayHeaderLine(/** @type {Date} */ (g.date), cnt);
    const cards = g.ops.map(op => _opCardHTML(op, fleet || [], rentals || [], !!showKassa)).join('');
    html += `<div class="hist-day-block" data-day-key="${_escapeAttr(g.groupKey)}">
      ${hdr}
      <div class="hist-day-cards">${cards}</div>
    </div>`;
  }
  list.innerHTML = html;
}

function _opCardHTML(op, fleet, rentals, showKassaInMeta) {
  const kind = opUiKind(op);
  const tile = getOperationTile(op);
  const title = getOperationTitle(op, fleet, rentals);
  const sub = getOperationSubtitle(op, rentals, !!showKassaInMeta);

  let sign = '+';
  let amtCls = 'op-card__amt--inc';
  if (kind === 'transfer') {
    amtCls = 'op-card__amt--xfer';
    sign = normalizeType(op.type) === 'перевод_входящий' ? '+' : MINUS;
  } else if (kind === 'out') {
    sign = MINUS;
    amtCls = 'op-card__amt--exp';
  }

  const amt = formatRubWithSign(Math.abs(Number(op.amount) || 0), sign);

  return `
    <div class="op-card" data-op-id="${_escapeHtml(op.opId ?? '')}">
      <div class="op-card__tile" style="background:${tile.bg};color:${tile.iconColor}">${tile.html}</div>
      <div class="op-card__body">
        <div class="op-card__title">${_escapeHtml(title)}</div>
        ${sub ? `<div class="op-card__sub">${_escapeHtml(sub)}</div>` : ''}
      </div>
      <div class="op-card__amt ${amtCls}">${amt}</div>
    </div>`;
}

function _emptyOpsHTML(isNoOpsAtAll) {
  const monthPrep = monthPrepositional(_selMonth);
  const extra = _hasExtraFilters();
  const names = [
    ..._filters.cars.map(c => `«${c}»`),
    ..._filters.cassas.map(k => `«${_kassaTitle(k)}»`),
    ..._filters.categories.map(c => `«${c}»`),
    ..._filters.drivers.map(d => {
      const drv = (_driversCache || []).find(x => String(x.driverId).trim() === String(d));
      return drv?.name ? `«${drv.name}»` : `«${d}»`;
    }),
  ];
  let txt1 = '';
  if (names.length) {
    txt1 = `По фильтру ${names.join(', ')} в ${monthPrep} ничего нет`;
  } else if (_filters.search.trim()) {
    txt1 = `По запросу в ${monthPrep} ничего не найдено`;
  } else if (_filters.type !== 'all') {
    txt1 = `В ${monthPrep} по выбранному типу ничего нет`;
  } else if (isNoOpsAtAll) {
    txt1 = `В ${monthPrep} операций ещё не было`;
  } else {
    txt1 = `В ${monthPrep} операций нет`;
  }

  const showReset = _hasExtraFilters() || _filters.type !== 'all';
  const resetBtn = showReset
    ? `<button type="button" class="hist-empty__reset" id="hist-reset">Сбросить фильтры</button>`
    : '';

  return `
    <div class="hist-empty" id="hist-empty-block">
      <div class="hist-empty__icon">${SVG_RECEIPT_IN_EMPTY}</div>
      <div class="hist-empty__text">${_escapeHtml(txt1)}</div>
      <div class="hist-empty__sub">Попробуй снять фильтр или сменить месяц</div>
      ${resetBtn}
    </div>`;
}

function _showAddFilterSheet() {
  const { showKassa, kassas, drivers, fleet } = _paintCtx || {};
  if (!fleet) return;

  const counts = _axisCountsForSheet();

  const row = (id, label, cnt) => `
    <button type="button" class="hist-fs-row" data-fs-axis="${id}">
      <span>${label}</span>
      <span class="hist-fs-row__meta">${cnt ? `${cnt} ▸` : '›'}</span>
    </button>`;

  let html = `
    <div class="hist-fs hist-fs--step1">
      <div class="hist-fs-handle"></div>
      <div class="hist-fs-head">
        <span class="hist-fs-title">Добавить фильтр</span>
        <button type="button" class="hist-fs-close" id="hist-fs-close" aria-label="Закрыть">${SVG_X_LG}</button>
      </div>
      ${row('car', 'Машина', counts.car)}
      ${showKassa ? row('cassa', 'Касса', counts.cassa) : ''}
      ${row('category', 'Категория расхода', counts.category)}
      ${row('driver', 'Водитель', counts.driver)}
    </div>`;

  showBottomSheet(html);
  setTimeout(() => {
    document.getElementById('hist-fs-close')?.addEventListener('click', () => hideBottomSheet());
    document.querySelectorAll('.hist-fs-row[data-fs-axis]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ax = btn.getAttribute('data-fs-axis');
        if (ax) _showFilterAxisSheet(ax);
      });
    });
  }, 0);
}

function _showFilterAxisSheet(axis) {
  const { showKassa, kassas, drivers, fleet, rawOps } = _paintCtx || {};
  const monthSlice = _opsInMonth(rawOps || []);

  let options = [];
  if (axis === 'car') {
    const uniq = new Set((fleet || []).map(c => String(c.carId).trim()).filter(Boolean));
    monthSlice.forEach(o => {
      const c = String(o.carId || '').trim();
      if (c) uniq.add(c);
    });
    options = Array.from(uniq).sort((a, b) => a.localeCompare(b, 'ru'));
  } else if (axis === 'cassa' && showKassa) {
    const base = (kassas || []).filter(k => k.kassaId && !INV_KASSA.has(k.kassaId));
    options = base.map(k => ({ id: k.kassaId, label: _kassaTitle(k.kassaId) }));
  } else if (axis === 'category') {
    options = EXPENSE_CATEGORY_PRESETS.slice();
  } else if (axis === 'driver') {
    options = (drivers || [])
      .filter(d => /актив/i.test(String(d.status || '')))
      .map(d => ({ id: d.driverId, label: String(d.name || d.driverId) }))
      .filter(d => d.id);
  }

  const curSet = new Set(
    axis === 'car'
      ? _filters.cars
      : axis === 'cassa'
        ? _filters.cassas
        : axis === 'category'
          ? _filters.categories
          : _filters.drivers,
  );

  const title =
    axis === 'car'
      ? 'Машина'
      : axis === 'cassa'
        ? 'Касса'
        : axis === 'category'
          ? 'Категория расхода'
          : 'Водитель';

  let draft = new Set(curSet);
  const renderList = () => {
    const allChecked = draft.size === 0;
    const lines = [];
    lines.push(`
      <label class="hist-fs-check-row">
        <input type="checkbox" class="hist-fs-cb" data-fs-all="1" ${allChecked ? 'checked' : ''} />
        <span>Все</span>
      </label>`);

    if (axis === 'car' || axis === 'category') {
      for (const id of /** @type {string[]} */ (options)) {
        const on = draft.has(id);
        lines.push(`
          <label class="hist-fs-check-row">
            <input type="checkbox" class="hist-fs-cb" data-fs-id="${_escapeAttr(id)}" ${on ? 'checked' : ''} />
            <span>${_escapeHtml(id)}</span>
          </label>`);
      }
    } else {
      for (const o of /** @type {{id:string,label:string}[]} */ (options)) {
        const on = draft.has(o.id);
        lines.push(`
          <label class="hist-fs-check-row">
            <input type="checkbox" class="hist-fs-cb" data-fs-id="${_escapeAttr(o.id)}" ${on ? 'checked' : ''} />
            <span>${_escapeHtml(o.label)}</span>
          </label>`);
      }
    }
    return lines.join('');
  };

  const html = `
    <div class="hist-fs hist-fs--step2">
      <div class="hist-fs-handle"></div>
      <div class="hist-fs-head2">
        <button type="button" class="hist-fs-back" id="hist-fs-back" aria-label="Назад">${CHEV_L}</button>
        <span class="hist-fs-title hist-fs-title--center">${_escapeHtml(title)}</span>
        <button type="button" class="hist-fs-reset" id="hist-fs-reset">${draft.size ? 'Сбросить' : ''}</button>
      </div>
      <div class="hist-fs-list" id="hist-fs-list">${renderList()}</div>
      <button type="button" class="hist-fs-apply" id="hist-fs-apply">Применить (${draft.size})</button>
    </div>`;

  const content = document.getElementById('bs-content');
  if (content) content.innerHTML = html;

  const applyBtn = () => document.getElementById('hist-fs-apply');
  const syncApply = () => {
    const b = applyBtn();
    if (b) b.textContent = `Применить (${draft.size})`;
    const r = document.getElementById('hist-fs-reset');
    if (r) {
      r.textContent = draft.size ? 'Сбросить' : '';
      r.style.visibility = draft.size ? 'visible' : 'hidden';
    }
  };

  document.getElementById('hist-fs-back')?.addEventListener('click', () => _showAddFilterSheet());
  document.getElementById('hist-fs-reset')?.addEventListener('click', () => {
    draft = new Set();
    const list = document.getElementById('hist-fs-list');
    if (list) list.innerHTML = renderList();
    _bindChecks();
    syncApply();
  });

  function _bindChecks() {
    document.querySelectorAll('.hist-fs-cb').forEach(el => {
      el.addEventListener('change', () => {
        const inp = /** @type {HTMLInputElement} */ (el);
        if (inp.dataset.fsAll) {
          draft = new Set();
          document.querySelectorAll('.hist-fs-cb[data-fs-id]').forEach(c => {
            /** @type {HTMLInputElement} */ (c).checked = false;
          });
          inp.checked = true;
        } else {
          document.querySelectorAll('.hist-fs-cb[data-fs-all]').forEach(c => {
            /** @type {HTMLInputElement} */ (c).checked = false;
          });
          const id = inp.dataset.fsId;
          if (!id) return;
          if (inp.checked) draft.add(id);
          else draft.delete(id);
          if (draft.size === 0) {
            const all = document.querySelector('.hist-fs-cb[data-fs-all]');
            if (all) /** @type {HTMLInputElement} */ (all).checked = true;
          }
        }
        syncApply();
      });
    });
  }
  _bindChecks();

  document.getElementById('hist-fs-apply')?.addEventListener('click', () => {
    const arr = Array.from(draft);
    if (axis === 'car') _filters.cars = arr;
    if (axis === 'cassa') _filters.cassas = arr;
    if (axis === 'category') _filters.categories = arr;
    if (axis === 'driver') _filters.drivers = arr;
    hideBottomSheet(() => {
      _refreshAfterFilterChange(true);
    });
  });

  syncApply();
}

function _openMonthPicker() {
  const overlay = _getMonthOverlay();

  let pickY = _selYear;
  let pickM = _selMonth;

  const close = () => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };

  const onKey = e => {
    if (e.key === 'Escape') close();
  };

  const render = () => {
    const nowY = _now.getFullYear();
    const nowM = _now.getMonth() + 1;
    const months = ['Янв', 'Фев', 'Март', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    const cells = months
      .map((lab, i) => {
        const idx = i + 1;
        const isOn = idx === pickM;
        const future = pickY > nowY || (pickY === nowY && idx > nowM);
        const dis = future ? ' hist-mp__cell--dis' : '';
        const on = isOn ? ' hist-mp__cell--on' : '';
        return `<button type="button" class="hist-mp__cell${dis}${on}" data-m="${idx}" ${future ? 'disabled' : ''}>${lab}</button>`;
      })
      .join('');

    overlay.innerHTML = `
      <div class="hist-mp-backdrop" id="hist-mp-close"></div>
      <div class="hist-mp-panel" role="document">
        <div class="hist-mp-handle"></div>
        <div class="hist-fs-head">
          <span class="hist-fs-title">Выбрать месяц</span>
          <button type="button" class="hist-fs-close" id="hist-mp-x" aria-label="Закрыть">${SVG_X_LG}</button>
        </div>
        <div class="hist-mp-year">${pickY}</div>
        <div class="hist-mp-grid">${cells}</div>
        <div class="hist-mp-foot">
          <div class="hist-mp-year-nav">
            <button type="button" class="hist-round-btn hist-round-btn--dark" id="hist-mp-py" aria-label="Год назад">‹</button>
            <span>${pickY}</span>
            <button type="button" class="hist-round-btn hist-round-btn--dark" id="hist-mp-ny" aria-label="Год вперёд">›</button>
          </div>
          <button type="button" class="hist-mp-today" id="hist-mp-today">Сегодня</button>
        </div>
      </div>`;

    document.getElementById('hist-mp-close')?.addEventListener('click', close);
    document.getElementById('hist-mp-x')?.addEventListener('click', close);
    document.getElementById('hist-mp-py')?.addEventListener('click', () => {
      pickY--;
      render();
    });
    document.getElementById('hist-mp-ny')?.addEventListener('click', () => {
      pickY++;
      render();
    });
    document.getElementById('hist-mp-today')?.addEventListener('click', () => {
      pickY = _now.getFullYear();
      pickM = _now.getMonth() + 1;
      _selYear = pickY;
      _selMonth = pickM;
      _writeFiltersToURL(true);
      const { rawOps, fleet } = _paintCtx || {};
      if (rawOps && fleet) _refreshMonth(rawOps, fleet);
      close();
    });
    overlay.querySelectorAll('.hist-mp__cell:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = Number(/** @type {HTMLElement} */ (btn).dataset.m);
        if (!m) return;
        pickM = m;
        _selYear = pickY;
        _selMonth = pickM;
        _writeFiltersToURL(true);
        const { rawOps, fleet } = _paintCtx || {};
        if (rawOps && fleet) _refreshMonth(rawOps, fleet);
        close();
      });
    });
  };

  render();
  overlay.classList.remove('hidden');
  document.addEventListener('keydown', onKey);
}

function _showOpDetail(op, fleet) {
  const kind = opUiKind(op);
  const heroSign = kind === 'in' ? '+' : kind === 'transfer' ? '⇄' : MINUS;
  const heroCls =
    kind === 'in' ? 'bs-op-hero--in' : kind === 'transfer' ? 'bs-op-hero--xfer' : 'bs-op-hero--out';

  const user = getCurrentUser();
  const provel = String(op.provel ?? '').trim().toLowerCase();
  const userName = String(user?.name ?? '').trim().toLowerCase();
  const canEdit = () => !!op?.opId && kind !== 'transfer' && (!provel || provel === userName);

  const car = fleet.find(c => String(c.carId).trim() === String(op.carId || '').trim());
  const carLbl = car ? `${car.carId}${car.name ? ' · ' + car.name : ''}` : op.carId || '—';

  const field = (label, value) =>
    value
      ? `<div class="bs-op-field"><span class="bs-op-field__lbl">${label}</span><span class="bs-op-field__val">${_escapeHtml(value)}</span></div>`
      : '';

  const amt = `${Math.round(Math.abs(Number(op.amount) || 0)).toLocaleString('ru-RU')} ₽`;

  showBottomSheet(`
    <div class="bs-op-hero ${heroCls}">
      <span class="bs-op-hero__sign">${heroSign}</span>
      <span class="bs-op-hero__amount">${amt}</span>
      <span class="bs-op-hero__dir">${_escapeHtml(String(op.direction || ''))}</span>
    </div>
    <div class="bs-op-fields">
      ${field('ID', op.opId)}
      ${field('Дата', op.dateRaw)}
      ${field('Категория', op.category || op.type)}
      ${field('Касса', op.kassaId ? kassaLineLabel(op.kassaId) : '')}
      ${field('Машина', carLbl)}
      ${field('Провёл', op.provel)}
      ${field('Комментарий', op.comment)}
    </div>
    ${canEdit() ? `
      <button class="btn-secondary" id="bs-op-edit" style="margin-top:12px">
        Редактировать
      </button>
    ` : ''}
  `);

  setTimeout(() => {
    document.getElementById('bs-op-edit')?.addEventListener('click', () => {
      hideBottomSheet(() => openEditOperation(op, fleet));
    });
  }, 0);
}

function _escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escapeAttr(s) {
  return _escapeHtml(s).replace(/'/g, '&***REMOVED***39;');
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
        <div class="op-card" style="pointer-events:none">
          <div class="skeleton" style="width:32px;height:32px;border-radius:50%;flex-shrink:0"></div>
          <div style="flex:1">${ln(55)}${ln(35)}</div>
          <div class="skeleton skeleton-line" style="width:64px"></div>
        </div>`,
        )
        .join('')}
      </div>
    </div>
</div>`;
}
