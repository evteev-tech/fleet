/**
 * history.js — вкладка «Касса»: журнал операций (новый визуал).
 * Данные: getOperations + getFleet + getDrivers, кэш SWR.
 */

import { getOperations, getFleet, getDrivers } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showBottomSheet, hideBottomSheet } from '../ui.js';
import { KASSA_ID, KASSA_NAMES, ROLES } from '../config.js';

const LS_SUMMARY = 'kassa.summary.expanded';

const INCOME_TYPES_FOR_SALDO = new Set([
  'аренда',
  'депозит_приём',
  'перевод_входящий',
  'корректировка',
]);

const EXPENSE_CATEGORY_PRESET = [
  'ремонт',
  'ТО',
  'запчасти',
  'страховка',
  'связь_глонасс',
  'ЗП',
  'реклама',
  'доставка',
  'покупка_машины',
  'штраф_ГИБДД',
  'ДТП',
  'прочее',
];

const KASSA_EXTRA = {
  K_INVEST_YULIA: 'Инвест. счёт Юлии',
  K_INVEST_VLAD: 'Инвест. счёт Владимира',
};

/** DD.MM.YYYY или Excel serial → Date */
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

const _now = new Date();
let _selMonth = _now.getMonth() + 1;
let _selYear = _now.getFullYear();

/** @type {{ type: string, cars: string[], kassas: string[], categories: string[], drivers: string[], search: string }} */
let _filters = {
  type: 'all',
  cars: [],
  kassas: [],
  categories: [],
  drivers: [],
  search: '',
};

let _searchMode = false;
let _filtered = [];
let _saldoExpanded = localStorage.getItem(LS_SUMMARY) === '1';

/** @type {{ rawOps: any[], fleet: any[], drivers: any[], role: string, isMechanic: boolean, showKassa: boolean } | null} */
let _ctx = null;

let _monthPickerYear = _selYear;

const TYPE_AXIS = [
  { id: 'all', label: 'Все' },
  { id: 'income', label: 'Доходы' },
  { id: 'expense', label: 'Расходы' },
  { id: 'transfer', label: 'Переводы' },
];

const CHEV_L =
  '<svg class="kassa-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_R =
  '<svg class="kassa-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_SEARCH =
  '<svg class="kassa-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>';
const SVG_X =
  '<svg class="kassa-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>';
const SVG_CHEVRON =
  '<svg class="kassa-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_RECEIPT =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="***REMOVED***888" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3h14a1 1 0 011 1v16l-4-2-4 2-4-2-4 2V4a1 1 0 011-1z"/><path stroke-linecap="round" d="M8 10h8M8 14h8"/></svg>';

// ─── helpers ────────────────────────────────────────────────────────────────

function _normalizeType(raw) {
  return String(raw || '').trim().toLowerCase();
}

function _isTransferOp(op) {
  const t = _normalizeType(op.type);
  const d = String(op.direction || '').trim();
  return t === 'перевод_исходящий' || t === 'перевод_входящий' || d === 'перевод';
}

function _opUiKind(op) {
  if (_isTransferOp(op)) return 'transfer';
  if (String(op.direction || '').trim() === 'приход') return 'in';
  return 'out';
}

function _splitCsv(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function _roleFlags(user) {
  const role = user?.role || ROLES.MECHANIC;
  const isMechanic = role === ROLES.MECHANIC;
  const showKassa = role === ROLES.OPERATIONS || role === ROLES.INVESTOR;
  return { role, isMechanic, showKassa };
}

function _nextMonthDisabled() {
  const m = _selMonth === 12 ? 1 : _selMonth + 1;
  const y = _selMonth === 12 ? _selYear + 1 : _selYear;
  return _isFutureMonth(y, m);
}

function _syncUrl() {
  const p = new URLSearchParams(window.location.search);
  p.set('month', `${_selYear}-${String(_selMonth).padStart(2, '0')}`);
  p.set('type', _filters.type);
  if (_filters.cars.length) p.set('car', _filters.cars.join(','));
  else p.delete('car');
  if (_filters.kassas.length) p.set('cassa', _filters.kassas.join(','));
  else p.delete('cassa');
  if (_filters.categories.length) p.set('category', _filters.categories.join(','));
  else p.delete('category');
  if (_filters.drivers.length) p.set('driver', _filters.drivers.join(','));
  else p.delete('driver');
  const q = p.toString();
  history.replaceState(null, '', q ? `${location.pathname}?${q}` : location.pathname);
}

function _hydrateFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const m = p.get('month');
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number);
    _selYear = y;
    _selMonth = mo;
  }
  const t = p.get('type');
  if (t && ['all', 'income', 'expense', 'transfer'].includes(t)) _filters.type = t;
  _filters.cars = _splitCsv(p.get('car'));
  _filters.kassas = _splitCsv(p.get('cassa'));
  _filters.categories = _splitCsv(p.get('category'));
  _filters.drivers = _splitCsv(p.get('driver'));
}

function _monthLabelPretty() {
  return new Date(_selYear, _selMonth - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
}

function _monthGenitiveSaldo() {
  const names = [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ];
  return `${names[_selMonth - 1]} ${_selYear}`;
}

function _monthEmptyPhrase() {
  return _monthGenitiveSaldo();
}

function _isFutureMonth(y, m) {
  return y > _now.getFullYear() || (y === _now.getFullYear() && m > _now.getMonth() + 1);
}

function _kassaLineTitle(id) {
  return KASSA_NAMES[id] || KASSA_EXTRA[id] || id || '';
}

function _driverLabel(drivers, driverId) {
  const d = (drivers || []).find(x => String(x.driverId) === String(driverId));
  return d ? `${d.name || driverId}`.trim() || driverId : driverId;
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
      o => String(o.direction).trim() === 'приход' && !_isTransferOp(o),
    );
  }
  if (t === 'expense') {
    return ops.filter(
      o => String(o.direction).trim() === 'расход' && !_isTransferOp(o),
    );
  }
  if (t === 'transfer') return ops.filter(_isTransferOp);
  return [...ops];
}

function _applyFilters(opsMonthUnsorted, role) {
  let result = _filterByAxisType(opsMonthUnsorted);
  const mechanic = role === ROLES.MECHANIC;

  if (_filters.cars.length) {
    result = result.filter(o => _filters.cars.includes(String(o.carId || '').trim()));
  }
  if (_filters.kassas.length && !mechanic) {
    result = result.filter(o => _filters.kassas.includes(String(o.kassaId || '').trim()));
  }
  if (_filters.categories.length) {
    const set = new Set(_filters.categories.map(c => String(c).toLowerCase()));
    result = result.filter(o => set.has(String(o.category || '').toLowerCase()));
  }
  if (_filters.drivers.length) {
    result = result.filter(o => _filters.drivers.includes(String(o.driverId || '').trim()));
  }
  if (_filters.search.trim()) {
    const q = _filters.search.trim().toLowerCase();
    result = result.filter(o => String(o.comment || '').toLowerCase().includes(q));
  }

  return result.sort((a, b) => {
    const ta = _opDate(a)?.getTime() ?? 0;
    const tb = _opDate(b)?.getTime() ?? 0;
    if (tb !== ta) return tb - ta;
    return String(b.opId || '').localeCompare(String(a.opId || ''));
  });
}

function _computeSaldo(ops) {
  const filterType = _filters.type;
  let income = 0;
  let expense = 0;

  if (filterType === 'transfer') {
    return { income: 0, expense: 0, net: 0 };
  }

  for (const op of ops) {
    const d = String(op.direction || '').trim();
    const t = _normalizeType(op.type);
    if (_isTransferOp(op)) {
      if (filterType === 'all') continue;
    }
    if (filterType === 'all' && _isTransferOp(op)) continue;

    if (d === 'приход' && INCOME_TYPES_FOR_SALDO.has(t)) {
      income += Number(op.amount) || 0;
    } else if (d === 'расход' && !_isTransferOp(op)) {
      expense += Math.abs(Number(op.amount) || 0);
    }
  }
  return { income, expense, net: income - expense };
}

function _fmtNbsp(n) {
  return `${Math.round(Math.abs(Number(n) || 0)).toLocaleString('ru-RU')}`.replace(/\s/g, '\u00A0');
}

function _fmtSigned(n) {
  const num = Number(n) || 0;
  const sign = num > 0 ? '+' : num < 0 ? '−' : '+';
  return `${sign}${_fmtNbsp(num)} ₽`;
}

function _dayHeaderLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDate();
  const monthNames = ['ЯНВ', 'ФЕВ', 'МАРТ', 'АПР', 'МАЯ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
  const week = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][d.getDay()];
  return `${day} ${monthNames[d.getMonth()]} · ${week}`;
}

function _pluralOps(n) {
  const last = Math.abs(n) % 100;
  const d = last % 10;
  let w = 'операций';
  if (last >= 11 && last <= 14) w = 'операций';
  else if (d === 1) w = 'операция';
  else if (d >= 2 && d <= 4) w = 'операции';
  return `${n} ${w}`;
}

function _escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _capitalize(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  return v[0].toUpperCase() + v.slice(1);
}

function _truncate(s, n) {
  const v = String(s || '');
  if (v.length <= n) return v;
  return `${v.slice(0, Math.max(0, n - 3)).trimEnd()}...`;
}

function _expenseIconName(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'ремонт') return 'tools';
  if (c === 'запчасти') return 'settings';
  if (c === 'то') return 'clipboardCheck';
  if (c === 'страховка') return 'shieldCheck';
  if (c === 'связь_глонасс') return 'broadcast';
  if (c === 'зп') return 'cash';
  if (c === 'реклама') return 'speaker';
  if (c === 'доставка') return 'truck';
  if (c === 'покупка_машины') return 'car';
  if (c === 'штраф_гибдд') return 'alertTriangle';
  if (c === 'дтп') return 'carCrash';
  if (c === 'прочее') return 'dots';
  return 'dots';
}

function _svgIcon(name) {
  const base = p =>
    `<svg class="kassa-ic kassa-ic--tile" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const paths = {
    key: '<path d="M21 2l-2 2"/><path d="M7 14a5 5 0 1 1 3.9 2H9l-2 2H5v-2l2-2h2"/><path d="M16 6l2 2"/>',
    shieldDollar:
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12h6"/><path d="M12 9v6"/>',
    arrowDownLeft: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
    arrowUpRight: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
    pencil:
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    tools:
      '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 0 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-3 3-2.8-2.8 3-3z"/>',
    settings:
      '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15l.1.1-1.6 2.8a2 2 0 0 0-2 .1l-3.2-1.8a2 2 0 0 0-1.4 0L8 20.8a2 2 0 0 0-2-.1L4.1 18l.1-.1a1.7 1.7 0 0 0 .3-1.9L6 12.7a2 2 0 0 0 0-1.4L4.4 8.2a1.7 1.7 0 0 0-.3-1.9L5.7 3.2a2 2 0 0 0 2-.1L11.2 1.3a2 2 0 0 0 1.4 0L16 3.1a2 2 0 0 0 2 .1l1.6 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9l1.4 2.8z"/>',
    clipboardCheck:
      '<path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 7h10v14H7z"/><path d="m9 14 2 2 4-4"/>',
    shieldCheck:
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    broadcast:
      '<path d="M4.9 19.1a5 5 0 0 1 0-14.2"/><path d="M7.8 16.2a2 2 0 0 1 0-8.4"/><path d="M12 12h.01"/>',
    cash: '<path d="M21 12H3"/><path d="M21 6H3"/><path d="M21 18H3"/><path d="M7 10h10"/><path d="M7 14h10"/>',
    speaker:
      '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M19 9a4 4 0 0 1 0 6"/><path d="M21 7a7 7 0 0 1 0 10"/>',
    truck:
      '<path d="M3 7h12v10H3z"/><path d="M15 10h4l2 2v5h-6z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    car: '<path d="M5 12 7.5 6h9L19 12"/><path d="M3 12h18v6H3z"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/>',
    alertTriangle: '<path d="M12 2 2 20h20z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    carCrash:
      '<path d="M5 16l-1 3h2l1-3"/><path d="M18 16l1 3h-2l-1-3"/><path d="M3 13l2-5h14l2 5"/><path d="M7 13h10"/>',
    wallet:
      '<path d="M20 12V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M20 12h-6a2 2 0 0 0 0 4h6"/>',
    dots: '<path d="M12 12h.01"/><path d="M19 12h.01"/><path d="M5 12h.01"/>',
  };
  return base(paths[name] || paths.dots);
}

function _mapOpVisual(op) {
  const type = _normalizeType(op.type);
  const cat = _normalizeType(op.category);
  const dir = String(op.direction || '').trim().toLowerCase();
  const isIn = dir === 'приход';
  const isOut = dir === 'расход';
  const incC = '***REMOVED***2d8a3f';
  const incBg = '***REMOVED***e3f5e8';
  const expC = '***REMOVED***c43838';
  const expBg = '***REMOVED***fce8e8';
  const neuC = '***REMOVED***666';
  const neuBg = '***REMOVED***ececea';

  if (type === 'аренда' && isIn)
    return { icon: _svgIcon('key'), color: incC, bg: incBg, amt: incC };
  if (type === 'депозит_приём' && isIn)
    return { icon: _svgIcon('shieldDollar'), color: incC, bg: incBg, amt: incC };
  if (type === 'депозит_возврат' && isOut)
    return { icon: _svgIcon('shieldDollar'), color: expC, bg: expBg, amt: expC };
  if (type.includes('перевод')) {
    const inward = type.includes('вход');
    return {
      icon: _svgIcon(inward ? 'arrowDownLeft' : 'arrowUpRight'),
      color: neuC,
      bg: neuBg,
      amt: neuC,
    };
  }
  if (type === 'корректировка')
    return { icon: _svgIcon('pencil'), color: neuC, bg: neuBg, amt: neuC };
  if (type === 'инвестиция')
    return { icon: _svgIcon('wallet'), color: neuC, bg: neuBg, amt: neuC };
  if (isOut) {
    return {
      icon: _svgIcon(_expenseIconName(cat)),
      color: expC,
      bg: expBg,
      amt: expC,
    };
  }
  if (isIn) {
    return { icon: _svgIcon('key'), color: incC, bg: incBg, amt: incC };
  }
  return { icon: _svgIcon('dots'), color: neuC, bg: neuBg, amt: neuC };
}

function _zpTitleFromComment(comment) {
  const m = String(comment || '').match(/(?:зп|ЗП)[\s:—-]+(.+)/);
  if (m && m[1]) return _truncate(m[1].trim(), 40);
  return 'ЗП';
}

function _opTitle(op) {
  const type = _normalizeType(op.type);
  const cat = String(op.category || '');
  const carId = String(op.carId || '').trim();
  const kid = String(op.kassaId || '').trim();

  if (type === 'аренда') return carId ? `Аренда · ${carId}` : 'Аренда';
  if (type.startsWith('депозит_'))
    return type === 'депозит_приём' ? 'Депозит · приём' : 'Депозит · возврат';
  if (type.includes('перевод')) {
    const name = _kassaLineTitle(kid);
    return type.includes('вход')
      ? `Перевод в кассу ${name}`
      : `Перевод из кассы ${name}`;
  }
  if (type === 'корректировка') return 'Корректировка';
  if (type === 'инвестиция') return 'Инвестиция';
  if (String(op.direction || '').trim() === 'расход') {
    if (_normalizeType(cat) === 'зп') return _zpTitleFromComment(op.comment);
    if (_normalizeType(cat) === 'штраф_гибдд' && carId) return `Штраф ГИБДД · ${carId}`;
    const base = _capitalize(cat || 'Расход');
    return carId ? `${base} · ${carId}` : base;
  }
  return _capitalize(op.type || op.category || 'Операция');
}

function _opSubtitle(op, drivers) {
  const type = _normalizeType(op.type);
  const kname = op.kassaId ? _kassaLineTitle(op.kassaId) : '';
  const kassaPart = kname ? `Касса ${kname}` : '';

  if (type === 'аренда') {
    return kassaPart || '—';
  }
  const com = String(op.comment || '').trim();
  const short = com ? _truncate(com, 25) : '';
  if (short && kassaPart) return `${short} · ${kassaPart}`;
  return kassaPart || short || '';
}

function _opAmountHtml(op) {
  const kind = _opUiKind(op);
  const amt = Number(op.amount) || 0;
  const isTr = kind === 'transfer';
  const sign = isTr ? '' : kind === 'in' ? '+' : '−';
  return `${sign}${_fmtNbsp(amt)} ₽`;
}

function _groupByDaySorted(ops) {
  const map = new Map();
  const order = [];
  for (const op of ops) {
    const d = _opDate(op);
    const key = d && !Number.isNaN(d.getTime()) ? _dayKey(d) : '__nodate';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(op);
  }
  order.sort((a, b) => {
    if (a === '__nodate') return 1;
    if (b === '__nodate') return -1;
    return b.localeCompare(a);
  });
  return order.map(k => ({ dayKey: k, ops: map.get(k) }));
}

function _hasExtraFilters() {
  return (
    _filters.cars.length +
      _filters.kassas.length +
      _filters.categories.length +
      _filters.drivers.length >
    0
  );
}

function _shouldShowReset() {
  return _filters.type !== 'all' || _hasExtraFilters() || !!_filters.search.trim();
}

// ─── shell & paint ───────────────────────────────────────────────────────────

function _shellHTML() {
  const chips = TYPE_AXIS.map(
    p => `
    <button type="button" class="kassa-type-chip ${_filters.type === p.id ? 'active' : ''}"
      data-hist-type="${p.id}" aria-pressed="${_filters.type === p.id}">${p.label}</button>`,
  ).join('');

  const extra = _extraChipsHtml();

  return `
<div class="kassa-page">
  <div class="kassa-header-dark">
    <div class="kassa-topbar">
      <button type="button" class="kassa-icon-btn" id="hist-prev" aria-label="Предыдущий месяц">${CHEV_L}</button>
      <button type="button" class="kassa-month-btn" id="hist-month-open" aria-label="Выбрать месяц">
        <span id="hist-month-label">${_escapeHtml(_monthLabelPretty())}</span>
        ${SVG_CHEVRON}
      </button>
      <div class="kassa-topbar-right">
        <button type="button" class="kassa-icon-btn" id="hist-search-toggle" aria-label="Поиск">${SVG_SEARCH}</button>
        <button type="button" class="kassa-icon-btn" id="hist-next" aria-label="Следующий месяц" ${_nextMonthDisabled() ? 'disabled' : ''}>${CHEV_R}</button>
      </div>
    </div>

    <div class="kassa-nav-search kassa-nav-search--hidden" id="hist-nav-search">
      <button type="button" class="kassa-icon-btn" id="hist-search-back" aria-label="Назад">${CHEV_L}</button>
      <div class="kassa-search-field">
        ${SVG_SEARCH}
        <input type="search" id="hist-search-input" placeholder="Поиск по комментарию…" autocomplete="off" />
      </div>
      <button type="button" class="kassa-icon-btn" id="hist-search-clear" aria-label="Очистить">${SVG_X}</button>
    </div>

    <div class="kassa-filters" id="kassa-filters">
      <div class="kassa-filter-bar">
        ${chips}
        <div class="kassa-filter-divider" aria-hidden="true"></div>
        <div class="kassa-extra-wrap">
          ${extra}
          <button type="button" class="kassa-plus-btn" id="hist-add-filter" aria-label="Добавить фильтр">
            <svg class="kassa-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="kassa-content">
    <div class="kassa-summary" id="kassa-summary">${_saldoBlockHtml()}</div>
    <div class="kassa-ops" id="kassa-ops"></div>
  </div>
</div>`;
}

function _extraChipsHtml() {
  let html = '';
  for (const cid of _filters.cars) {
    html += `<button type="button" class="kassa-extra-chip" data-remove="car:${_escapeHtml(cid)}"><span>${_escapeHtml(cid)}</span>${SVG_X}</button>`;
  }
  for (const kid of _filters.kassas) {
    html += `<button type="button" class="kassa-extra-chip" data-remove="kassa:${_escapeHtml(kid)}"><span>${_escapeHtml(_kassaLineTitle(kid))}</span>${SVG_X}</button>`;
  }
  for (const c of _filters.categories) {
    html += `<button type="button" class="kassa-extra-chip" data-remove="cat:${_escapeHtml(c)}"><span>${_escapeHtml(c)}</span>${SVG_X}</button>`;
  }
  for (const did of _filters.drivers) {
    const lbl = _ctx ? _driverLabel(_ctx.drivers, did) : did;
    html += `<button type="button" class="kassa-extra-chip" data-remove="drv:${_escapeHtml(did)}"><span>${_escapeHtml(lbl)}</span>${SVG_X}</button>`;
  }
  return html;
}

function _saldoBlockHtml() {
  const totals = _computeSaldo(_filtered);
  const exp = _saldoExpanded;
  const saldoStr = _fmtSigned(totals.net);
  const cls = totals.net >= 0 ? 'pos' : 'neg';
  return `
    <div class="kassa-summary-card ${exp ? 'expanded' : ''}" id="kassa-summary-card">
      <button type="button" class="kassa-summary-btn" id="hist-saldo-toggle" aria-expanded="${exp}">
        <span class="kassa-summary-left">Сальдо за ${_escapeHtml(_monthGenitiveSaldo())}</span>
        <span class="kassa-summary-right">
          <span class="kassa-summary-value ${cls}">${saldoStr}</span>
          <span class="kassa-summary-chevron">${SVG_CHEVRON}</span>
        </span>
      </button>
      <div class="kassa-summary-details">
        <span class="kassa-summary-row-label">Приход</span>
        <span class="kassa-summary-row-val in">${_fmtSigned(totals.income)}</span>
        <span class="kassa-summary-row-label">Расход</span>
        <span class="kassa-summary-row-val out">${_fmtSigned(-Math.abs(totals.expense))}</span>
      </div>
    </div>`;
}

function _renderOpsList(rawOps, fleet) {
  const root = document.getElementById('kassa-ops');
  if (!root) return;

  if (!_filtered.length) {
    const monthPh = _monthEmptyPhrase();
    let title = `В ${monthPh} операций ещё не было`;
    if (_hasExtraFilters() || _filters.search.trim()) {
      const parts = [
        ..._filters.cars,
        ..._filters.kassas.map(k => _kassaLineTitle(k)),
        ..._filters.categories,
        ..._filters.drivers.map(d => _driverLabel(_ctx?.drivers, d)),
      ];
      const j = parts.slice(0, 2).join(', ');
      if (j) title = `По фильтру «${j}» в ${monthPh} ничего нет`;
    }
    const showReset = _shouldShowReset();
    root.innerHTML = `
      <div class="kassa-empty">
        <div class="kassa-empty-icon">${SVG_RECEIPT}</div>
        <div class="kassa-empty-title">${_escapeHtml(title)}</div>
        <div class="kassa-empty-sub">Попробуй снять фильтр или сменить месяц</div>
        ${showReset ? '<button type="button" class="kassa-empty-reset" id="hist-reset-filters">Сбросить фильтры</button>' : ''}
      </div>`;
    root.querySelector('***REMOVED***hist-reset-filters')?.addEventListener('click', () => {
      _filters = { type: 'all', cars: [], kassas: [], categories: [], drivers: [], search: '' };
      _searchMode = false;
      _rebindSearchUi();
      _refresh(rawOps, fleet);
    });
    return;
  }

  const drivers = _ctx?.drivers || [];
  const groups = _groupByDaySorted(_filtered);
  root.innerHTML = groups
    .map(({ dayKey, ops }) => {
      const label = dayKey === '__nodate' ? 'Без даты' : _dayHeaderLabel(dayKey);
      return `
      <div class="kassa-day-head">
        <span class="kassa-day-left">${_escapeHtml(label)}</span>
        <span class="kassa-day-right">${_pluralOps(ops.length)}</span>
      </div>
      <div class="kassa-day-group">
        ${ops.map(op => _opCardHtml(op, fleet, drivers)).join('')}
      </div>`;
    })
    .join('');

  root.querySelectorAll('.op-card').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-op-id');
      const op = _filtered.find(o => o.opId === id) ?? rawOps.find(o => o.opId === id);
      if (op) _showOpDetail(op, fleet);
    });
  });
}

function _opCardHtml(op, fleet, drivers) {
  const v = _mapOpVisual(op);
  const title = _opTitle(op);
  const sub = _opSubtitle(op, drivers);
  const amt = _opAmountHtml(op);
  return `
    <div class="op-card" data-op-id="${_escapeHtml(op.opId)}">
      <div class="op-icon-tile" style="background:${v.bg};color:${v.color}">${v.icon}</div>
      <div class="op-body">
        <div class="op-title">${_escapeHtml(title)}</div>
        <div class="op-subtitle">${_escapeHtml(sub)}</div>
      </div>
      <div class="op-amount" style="color:${v.amt}">${amt}</div>
    </div>`;
}

function _showOpDetail(op, fleet) {
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
      <span class="bs-op-hero__amount">${_fmtNbsp(op.amount)} ₽</span>
      <span class="bs-op-hero__dir">${_escapeHtml(String(op.direction || ''))}</span>
    </div>
    <div class="bs-op-fields">
      ${field('ID', op.opId)}
      ${field('Дата', op.dateRaw)}
      ${field('Категория', op.category || op.type)}
      ${field('Касса', op.kassaId ? _kassaLineTitle(op.kassaId) : '')}
      ${field('Машина', carLbl)}
      ${field('Провёл', op.provel)}
      ${field('Комментарий', op.comment)}
    </div>
  `);
}

function _rebindSearchUi() {
  const norm = document.querySelector('.kassa-topbar');
  const sea = document.getElementById('hist-nav-search');
  if (!sea) return;
  sea.classList.toggle('kassa-nav-search--hidden', !_searchMode);
  if (norm) norm.classList.toggle('kassa-topbar--hidden', !!_searchMode);
  const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
  if (inp && _searchMode) {
    inp.value = _filters.search;
    requestAnimationFrame(() => inp.focus());
  }
}

function _bindShell(rawOps, fleet) {
  document.getElementById('hist-prev')?.addEventListener('click', () => {
    _selMonth -= 1;
    if (_selMonth < 1) {
      _selMonth = 12;
      _selYear -= 1;
    }
    _syncUrl();
    _refresh(rawOps, fleet);
  });

  document.getElementById('hist-next')?.addEventListener('click', () => {
    const next = _selMonth === 12 ? { m: 1, y: _selYear + 1 } : { m: _selMonth + 1, y: _selYear };
    if (_isFutureMonth(next.y, next.m)) return;
    _selMonth = next.m;
    _selYear = next.y;
    _syncUrl();
    _refresh(rawOps, fleet);
  });

  document.getElementById('hist-month-open')?.addEventListener('click', () =>
    _openMonthSheet(rawOps, fleet),
  );

  document.getElementById('hist-search-toggle')?.addEventListener('click', () => {
    _searchMode = true;
    _rebindSearchUi();
  });
  document.getElementById('hist-search-back')?.addEventListener('click', () => {
    _searchMode = false;
    _rebindSearchUi();
  });
  document.getElementById('hist-search-clear')?.addEventListener('click', () => {
    _filters.search = '';
    const inp = /** @type {HTMLInputElement} */ (document.getElementById('hist-search-input'));
    if (inp) inp.value = '';
    _syncUrl();
    _refresh(rawOps, fleet);
  });
  document.getElementById('hist-search-input')?.addEventListener('input', e => {
    const inp = /** @type {HTMLInputElement} */ (e.target);
    _filters.search = inp.value || '';
    _syncUrl();
    _refresh(rawOps, fleet);
  });

  document.getElementById('kassa-filters')?.addEventListener('click', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const chip = t.closest('[data-hist-type]');
    if (chip) {
      _filters.type = chip.getAttribute('data-hist-type') || 'all';
      _syncUrl();
      _refresh(rawOps, fleet);
      return;
    }
    const rm = t.closest('[data-remove]');
    if (rm) {
      const v = rm.getAttribute('data-remove') || '';
      const [axis, val] = v.split(':');
      if (axis === 'car') _filters.cars = _filters.cars.filter(x => x !== val);
      if (axis === 'kassa') _filters.kassas = _filters.kassas.filter(x => x !== val);
      if (axis === 'cat') _filters.categories = _filters.categories.filter(x => x !== val);
      if (axis === 'drv') _filters.drivers = _filters.drivers.filter(x => x !== val);
      _syncUrl();
      _refresh(rawOps, fleet);
    }
  });

  document.getElementById('hist-add-filter')?.addEventListener('click', () =>
    _openFilterSheet(rawOps, fleet),
  );
}

/** @type {{ step: number, axis?: string, temp?: Set<string> } | null} */
let _filterSheetDraft = null;

function _axisToLabel(axis) {
  if (axis === 'car') return 'Машина';
  if (axis === 'cassa') return 'Касса';
  if (axis === 'category') return 'Категория расхода';
  if (axis === 'driver') return 'Водитель';
  return 'Фильтр';
}

function _filtersKey(axis) {
  if (axis === 'car') return 'cars';
  if (axis === 'cassa') return 'kassas';
  if (axis === 'category') return 'categories';
  if (axis === 'driver') return 'drivers';
  return 'cars';
}

function _collectAxisValues(axis, rawOps, fleet) {
  const set = new Set();
  if (axis === 'car') {
    for (const c of fleet || []) {
      const id = String(c.carId || '').trim();
      if (id) set.add(id);
    }
    for (const op of rawOps || []) {
      const id = String(op.carId || '').trim();
      if (id) set.add(id);
    }
  } else if (axis === 'cassa') {
    for (const k of Object.keys(KASSA_NAMES)) set.add(k);
    for (const k of Object.keys(KASSA_EXTRA)) set.add(k);
    for (const op of rawOps || []) {
      const id = String(op.kassaId || '').trim();
      if (id) set.add(id);
    }
  } else if (axis === 'category') {
    for (const c of EXPENSE_CATEGORY_PRESET) set.add(c);
    for (const op of rawOps || []) {
      const c = String(op.category || '').trim();
      if (c) set.add(c);
    }
  } else if (axis === 'driver') {
    for (const d of _ctx?.drivers || []) {
      const id = String(d.driverId || '').trim();
      if (id) set.add(id);
    }
    for (const op of rawOps || []) {
      const id = String(op.driverId || '').trim();
      if (id) set.add(id);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}

function _axisValueLabel(axis, value) {
  if (axis === 'cassa') return _kassaLineTitle(value);
  if (axis === 'driver') return _driverLabel(_ctx?.drivers, value);
  if (axis === 'category') return _capitalize(value);
  if (axis === 'car') {
    const car = (_ctx?.fleet || []).find(c => String(c.carId).trim() === String(value).trim());
    return car ? `${car.carId}${car.name ? ' · ' + car.name : ''}` : value;
  }
  return value;
}

function _renderFilterSheet(rawOps, fleet) {
  const titleEl = document.getElementById('hist-filter-bs-title');
  const body = document.getElementById('hist-filter-bs-body');
  if (!body) return;

  const draft = _filterSheetDraft || { step: 1 };
  const showKassa = _ctx?.showKassa !== false;

  if (draft.step === 1) {
    if (titleEl) titleEl.textContent = 'Добавить фильтр';
    const axes = [
      { id: 'car', label: 'Машина' },
      ...(showKassa ? [{ id: 'cassa', label: 'Касса' }] : []),
      { id: 'category', label: 'Категория расхода' },
      { id: 'driver', label: 'Водитель' },
    ];
    const key = ax => _filtersKey(ax.id);
    body.innerHTML = axes
      .map(a => {
        const cnt = _filters[key(a)].length;
        return `
        <div class="kassa-sheet-list-item" data-hist-filter-axis="${_escapeHtml(a.id)}" role="button" tabindex="0">
          <div>${_escapeHtml(a.label)}</div>
          <div class="kassa-sheet-right">
            ${cnt ? `${cnt} ▸` : `<svg class="kassa-ic kassa-ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>`}
          </div>
        </div>`;
      })
      .join('');

    body.querySelectorAll('[data-hist-filter-axis]').forEach(row => {
      row.addEventListener('click', () => {
        const axis = row.getAttribute('data-hist-filter-axis');
        if (!axis) return;
        const fk = _filtersKey(axis);
        _filterSheetDraft = {
          step: 2,
          axis,
          temp: new Set(_filters[fk].map(String)),
        };
        _renderFilterSheet(rawOps, fleet);
      });
    });
    return;
  }

  const axis = draft.axis;
  if (!axis) return;
  if (titleEl) titleEl.textContent = _axisToLabel(axis);

  const values = _collectAxisValues(axis, rawOps, fleet);
  const temp = draft.temp instanceof Set ? draft.temp : new Set();
  const selectedCount = temp.size;

  body.innerHTML = `
    <div class="kassa-sheet-values-head">
      <button type="button" class="kassa-sheet-back" id="hist-filter-back">
        <svg class="kassa-ic kassa-ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        Назад
      </button>
      <button type="button" class="kassa-sheet-reset" id="hist-filter-reset" ${selectedCount ? '' : 'disabled'}>Сбросить</button>
    </div>
    <div>
      <div class="kassa-sheet-checkbox-row" data-hist-filter-val="__all">
        <input type="checkbox" ${selectedCount === 0 ? 'checked' : ''} aria-label="Все" />
        <div>Все</div>
      </div>
      ${values
        .map(v => {
          const checked = temp.has(v);
          const lbl = _axisValueLabel(axis, v);
          return `
        <div class="kassa-sheet-checkbox-row" data-hist-filter-val="${_escapeHtml(v)}">
          <input type="checkbox" ${checked ? 'checked' : ''} aria-label="${_escapeHtml(lbl)}" />
          <div>${_escapeHtml(lbl)}</div>
        </div>`;
        })
        .join('')}
    </div>
    <div class="kassa-sheet-apply">
      <button type="button" id="hist-filter-apply" ${selectedCount ? '' : 'disabled'}>Применить (${selectedCount})</button>
    </div>`;

  body.querySelector('***REMOVED***hist-filter-back')?.addEventListener('click', () => {
    _filterSheetDraft = { step: 1 };
    _renderFilterSheet(rawOps, fleet);
  });
  body.querySelector('***REMOVED***hist-filter-reset')?.addEventListener('click', () => {
    if (_filterSheetDraft) _filterSheetDraft.temp = new Set();
    _renderFilterSheet(rawOps, fleet);
  });
  body.querySelectorAll('[data-hist-filter-val]').forEach(row => {
    row.addEventListener('click', () => {
      const val = row.getAttribute('data-hist-filter-val');
      if (!val || !_filterSheetDraft) return;
      if (val === '__all') {
        _filterSheetDraft.temp = new Set();
        _renderFilterSheet(rawOps, fleet);
        return;
      }
      const next = new Set(_filterSheetDraft.temp || []);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      _filterSheetDraft.temp = next;
      _renderFilterSheet(rawOps, fleet);
    });
  });
  body.querySelector('***REMOVED***hist-filter-apply')?.addEventListener('click', () => {
    if (!_filterSheetDraft?.axis) return;
    const fk = _filtersKey(_filterSheetDraft.axis);
    const next = Array.from(_filterSheetDraft.temp || []);
    _filters[fk] = next;
    _filterSheetDraft = { step: 1 };
    _syncUrl();
    hideBottomSheet();
    _refresh(rawOps, fleet);
  });
}

function _openFilterSheet(rawOps, fleet) {
  _filterSheetDraft = { step: 1 };
  showBottomSheet(`
    <div class="kassa-bs-wrap">
      <p class="bottomsheet-title" id="hist-filter-bs-title">Добавить фильтр</p>
      <div id="hist-filter-bs-body"></div>
    </div>
  `);
  setTimeout(() => _renderFilterSheet(rawOps, fleet), 0);
}

function _renderMonthSheetBody(rawOps, fleet) {
  const body = document.getElementById('hist-month-bs-body');
  if (!body) return;

  const currentKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
  const selectedKey = `${_selYear}-${String(_selMonth).padStart(2, '0')}`;
  const year = _monthPickerYear;

  const months = ['Янв', 'Фев', 'Март', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const grid = months
    .map((m, idx) => {
      const key = `${year}-${String(idx + 1).padStart(2, '0')}`;
      const isActive = key === selectedKey;
      const isFuture = key > currentKey;
      return `<button type="button" class="kassa-month-cell ${isActive ? 'active' : ''}" data-hist-month="${key}" ${isFuture ? 'disabled' : ''}>${_escapeHtml(m)}</button>`;
    })
    .join('');

  body.innerHTML = `
    <div class="kassa-month-grid">${grid}</div>
    <div class="kassa-month-footer">
      <div class="kassa-year-switch">
        <button type="button" class="kassa-year-btn" id="hist-year-prev" aria-label="Предыдущий год">
          <svg class="kassa-ic kassa-ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div style="min-width:48px;text-align:center;font-weight:600;">${_escapeHtml(String(year))}</div>
        <button type="button" class="kassa-year-btn" id="hist-year-next" aria-label="Следующий год">
          <svg class="kassa-ic kassa-ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
        </button>
      </div>
      <button type="button" class="kassa-today-btn" id="hist-month-today">Сегодня</button>
    </div>`;

  body.querySelectorAll('[data-hist-month]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.getAttribute('data-hist-month');
      if (!key) return;
      const [y, mo] = key.split('-').map(Number);
      _selYear = y;
      _selMonth = mo;
      _syncUrl();
      hideBottomSheet();
      _refresh(rawOps, fleet);
    });
  });
  body.querySelector('***REMOVED***hist-year-prev')?.addEventListener('click', () => {
    _monthPickerYear -= 1;
    _renderMonthSheetBody(rawOps, fleet);
  });
  body.querySelector('***REMOVED***hist-year-next')?.addEventListener('click', () => {
    _monthPickerYear += 1;
    _renderMonthSheetBody(rawOps, fleet);
  });
  body.querySelector('***REMOVED***hist-month-today')?.addEventListener('click', () => {
    _selYear = _now.getFullYear();
    _selMonth = _now.getMonth() + 1;
    _monthPickerYear = _selYear;
    _syncUrl();
    hideBottomSheet();
    _refresh(rawOps, fleet);
  });
}

function _openMonthSheet(rawOps, fleet) {
  _monthPickerYear = _selYear;
  showBottomSheet(`
    <div class="kassa-bs-wrap">
      <p class="bottomsheet-title">Выбор месяца</p>
      <div id="hist-month-bs-body"></div>
    </div>
  `);
  setTimeout(() => _renderMonthSheetBody(rawOps, fleet), 0);
}

function _refresh(rawOps, fleet) {
  const user = getCurrentUser();
  const { role } = _roleFlags(user);
  const monthSlice = _opsInMonth(rawOps);
  _filtered = _applyFilters(monthSlice, role);
  const shell = document.getElementById('history-body');
  if (!shell) return;
  shell.innerHTML = _shellHTML();
  _bindShell(rawOps, fleet);
  _renderOpsList(rawOps, fleet);
  _rebindSearchUi();
}

function _skeletonHTML() {
  return `
<div class="kassa-page">
  <div class="kassa-topbar"><div class="skeleton skeleton-line skeleton-line--lg" style="width:90%;margin:0 auto"></div></div>
  <div class="kassa-content">
    <div class="skeleton-card" style="margin-top:12px"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  </div>
</div>`;
}

export function initHistory() {
  const histRoot = document.getElementById('history-body');
  if (histRoot && histRoot.dataset.kassaSaldoDeleg !== '1') {
    histRoot.dataset.kassaSaldoDeleg = '1';
    histRoot.addEventListener('click', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (!t.closest('***REMOVED***hist-saldo-toggle')) return;
      e.preventDefault();
      _saldoExpanded = !_saldoExpanded;
      localStorage.setItem(LS_SUMMARY, _saldoExpanded ? '1' : '0');
      const el = document.getElementById('kassa-summary');
      if (el) el.innerHTML = _saldoBlockHtml();
    });
  }

  document.addEventListener('history:filter', e => {
    const { kassaId } = e.detail ?? {};
    if (kassaId) {
      const id = String(kassaId).trim();
      if (!_filters.kassas.includes(id)) _filters.kassas.push(id);
      _syncUrl();
    }
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
  _ctx = { rawOps: [], fleet: [], drivers: [], role, isMechanic, showKassa };

  _hydrateFromUrl();
  _monthPickerYear = _selYear;

  shell.innerHTML = '';
  let rawOpsAll = /** @type {any[] | undefined} */ (undefined);
  let fleet = /** @type {any[] | undefined} */ (undefined);
  let drivers = /** @type {any[] | undefined} */ (undefined);
  let cacheHit = false;

  const paint = () => {
    if (rawOpsAll === undefined || fleet === undefined || drivers === undefined) return;
    let rawOps = isMechanic
      ? rawOpsAll.filter(op => String(op.kassaId ?? '').trim() === String(KASSA_ID.AZAMAT))
      : rawOpsAll;
    _ctx = { rawOps, fleet, drivers, role, isMechanic, showKassa };
    _refresh(rawOps, fleet);
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => {
      cacheHit = true;
      rawOpsAll = Array.isArray(d) ? d : [];
      paint();
    },
    onFresh: d => {
      rawOpsAll = Array.isArray(d) ? d : [];
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) rawOpsAll = [];
      paint();
    },
  });

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      fleet = Array.isArray(d) ? d : [];
      paint();
    },
    onFresh: d => {
      fleet = Array.isArray(d) ? d : [];
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) fleet = [];
      paint();
    },
  });

  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => {
      cacheHit = true;
      drivers = Array.isArray(d) ? d : [];
      paint();
    },
    onFresh: d => {
      drivers = Array.isArray(d) ? d : [];
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) drivers = [];
      paint();
    },
  });

  setTimeout(() => {
    if (!cacheHit && (rawOpsAll === undefined || fleet === undefined || drivers === undefined)) {
      shell.innerHTML = _skeletonHTML();
    }
  }, 0);
}