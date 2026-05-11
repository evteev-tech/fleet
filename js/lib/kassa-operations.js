/**
 * Маппинг операций: иконки плашек, заголовки/подзаголовки, расчёт сальдо.
 */

import { KASSA_NAMES } from '../config.js';
import { formatShortDayMonth } from './kassa-money.js';

const NBSP = '\u00A0';

export const EXPENSE_CATEGORY_PRESETS = [
  'ремонт',
  'ТО',
  'запчасти',
  'ЗП',
  'реклама',
  'страховка',
  'доставка',
  'штраф_ГИБДД',
  'ДТП',
  'связь_глонасс',
  'покупка_машины',
  'прочее',
];

export function normalizeType(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isTransferOp(op) {
  const t = normalizeType(op.type);
  const d = String(op.direction || '').trim();
  return t === 'перевод_исходящий' || t === 'перевод_входящий' || d === 'перевод';
}

/** @returns {'in'|'out'|'transfer'} */
export function opUiKind(op) {
  if (isTransferOp(op)) return 'transfer';
  if (String(op.direction || '').trim() === 'приход') return 'in';
  return 'out';
}

const INCOME_TYPES_SALDO = new Set(['аренда', 'депозит_приём', 'перевод_входящий', 'корректировка']);

/**
 * Сальдо по правилам ТЗ: с учётом фильтра типа и исключения переводов в режиме «Все».
 * @param {any[]} filtered — уже отфильтрованные операции месяца
 * @param {'all'|'income'|'expense'|'transfer'} typeFilter
 */
export function computeSaldoBreakdown(filtered, typeFilter) {
  let income = 0;
  let expense = 0;

  if (typeFilter === 'transfer') {
    for (const op of filtered) {
      const amt = Math.abs(Number(op.amount) || 0);
      const t = normalizeType(op.type);
      if (t === 'перевод_входящий') income += amt;
      else if (t === 'перевод_исходящий') expense += amt;
    }
    return { income, expense, net: income - expense };
  }

  if (typeFilter === 'income') {
    for (const op of filtered) income += Math.abs(Number(op.amount) || 0);
    return { income, expense: 0, net: income };
  }

  if (typeFilter === 'expense') {
    for (const op of filtered) expense += Math.abs(Number(op.amount) || 0);
    return { income: 0, expense, net: -expense };
  }

  // all
  for (const op of filtered) {
    if (isTransferOp(op)) continue;
    const dir = String(op.direction || '').trim();
    const t = normalizeType(op.type);
    const amt = Math.abs(Number(op.amount) || 0);
    if (dir === 'приход' && INCOME_TYPES_SALDO.has(t)) income += amt;
    else if (dir === 'расход') expense += amt;
  }
  return { income, expense, net: income - expense };
}

/** Tabler-стиль: обводка 1.5, viewBox 0 0 24 24 */
function iconSvg(pathD, stroke = 1.5) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pathD}</svg>`;
}

const ICONS = {
  key: iconSvg('<path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>'),
  shieldDollar: iconSvg(
    '<path d="M12 3a12 12 0 008.5 3a12 12 0 01-8.5 15a12 12 0 01-8.5-15a12 12 0 008.5-3"/><path d="M15 11h-2.5a1.5 1.5 0 000 3h1a1.5 1.5 0 010 3H12m0-6V9m0 8v.01"/>',
  ),
  arrowDownLeft: iconSvg('<path d="M17 7L7 17"/><path d="M17 17H7V7"/>'),
  arrowUpRight: iconSvg('<path d="M7 7h10v10"/><path d="M7 17L17 7"/>'),
  pencil: iconSvg('<path d="M4 20h4l10.5-10.5a2.121 2.121 0 000-3l-3-3a2.121 2.121 0 00-3 0L4 16v4z"/><path d="M13.5 6.5l3 3"/>'),
  tools: iconSvg('<path d="M3 21h4L20 8a2.83 2.83 0 000-4l-1-1a2.83 2.83 0 00-4 0L3 17v4z"/><path d="M14 6l4 4"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M9 18h6"/>'),
  settings: iconSvg(
    '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M9 12a3 3 0 106 0 3 3 0 00-6 0z"/>',
    1.25,
  ),
  clipboardCheck: iconSvg(
    '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 12l2 2l4-4"/>',
  ),
  shieldCheck: iconSvg('<path d="M12 3a12 12 0 008.5 3a12 12 0 01-8.5 15a12 12 0 01-8.5-15a12 12 0 008.5-3"/><path d="M9 12l2 2l4-4"/>'),
  broadcast: iconSvg('<path d="M18.364 5.636a9 9 0 010 12.728"/><path d="M15.536 8.464a5 5 0 010 7.072"/><path d="M12 12h.01"/><path d="M8.464 8.464a5 5 0 000 7.072"/><path d="M5.636 5.636a9 9 0 000 12.728"/>'),
  cash: iconSvg('<path d="M9 8h-3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-3"/><path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2"/><path d="M14 12h.01"/><path d="M14 14a2 2 0 10-2-2"/>'),
  speakerphone: iconSvg(
    '<path d="M18 8a3 3 0 100-6 3 3 0 000 6z"/><path d="M6 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M18 8v8a2 2 0 01-2 2h-2"/><path d="M6 15v1a2 2 0 002 2h2"/><path d="M15 11l-6 2"/>',
  ),
  truckDelivery: iconSvg(
    '<path d="M7 17m-2 0a2 2 0 104 0a2 2 0 10-4 0"/><path d="M17 17m-2 0a2 2 0 104 0a2 2 0 10-4 0"/><path d="M5 17H3V6h13v11"/><path d="M14 17h2l4-4V9h-6"/>',
  ),
  car: iconSvg('<path d="M7 17m-2 0a2 2 0 104 0a2 2 0 10-4 0"/><path d="M17 17m-2 0a2 2 0 104 0a2 2 0 10-4 0"/><path d="M5 17h-2v-6l2-5h9l2 5v6"/><path d="M9 7h6"/>'),
  alertTriangle: iconSvg('<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 001.636 2.871h16.214a1.914 1.914 0 001.636-2.87l-8.106-13.536a1.914 1.914 0 00-3.274 0z"/><path d="M12 16h.01"/>'),
  carCrash: iconSvg(
    '<path d="M10 17h4"/><path d="M12 6v4"/><path d="M7 17l-1-4l-3-2"/><path d="M17 17l1-4l3-2"/><path d="M7.2 7.2L5.5 5.5"/><path d="M18.5 5.5l-1.7 1.7"/><path d="M12 17v2"/><path d="M10 20h4"/>',
  ),
  dots: iconSvg('<path d="M5 12m-1 0a1 1 0 102 0a1 1 0 10-2 0"/><path d="M12 12m-1 0a1 1 0 102 0a1 1 0 10-2 0"/><path d="M19 12m-1 0a1 1 0 102 0a1 1 0 10-2 0"/>'),
  wallet: iconSvg('<path d="M17 8V6a2 2 0 00-2-2H8a2 2 0 00-2 2v12a2 2 0 002 2h9a2 2 0 002-2v-8"/><path d="M14 12h.01"/><path d="M17 8h3v4h-3"/>'),
};

const TILE_GREEN = { iconColor: '#2d8a3f', bg: '#e3f5e8' };
const TILE_RED = { iconColor: '#c43838', bg: '#fce8e8' };
const TILE_NEU = { iconColor: '#666', bg: '#ececea' };

/**
 * @returns {{ html: string, iconColor: string, bg: string }}
 */
export function getOperationTile(op) {
  const t = normalizeType(op.type);
  const cat = normalizeType(op.category);
  const kind = opUiKind(op);

  if (t === 'аренда' && kind === 'in')
    return { html: ICONS.key, ...TILE_GREEN };
  if (t === 'депозит_приём' || t === 'депозит_прием') return { html: ICONS.shieldDollar, ...TILE_GREEN };
  if (t === 'депозит_возврат') return { html: ICONS.shieldDollar, ...TILE_RED };
  if (t === 'перевод_входящий') return { html: ICONS.arrowDownLeft, ...TILE_NEU };
  if (t === 'перевод_исходящий') return { html: ICONS.arrowUpRight, ...TILE_NEU };
  if (t === 'корректировка') return { html: ICONS.pencil, ...TILE_NEU };
  if (t === 'инвестиция') return { html: ICONS.wallet, ...TILE_NEU };

  if (kind === 'out') {
    const catMap = {
      ремонт: ICONS.tools,
      запчасти: ICONS.settings,
      то: ICONS.clipboardCheck,
      страховка: ICONS.shieldCheck,
      связь_глонасс: ICONS.broadcast,
      зп: ICONS.cash,
      реклама: ICONS.speakerphone,
      доставка: ICONS.truckDelivery,
      покупка_машины: ICONS.car,
      штраф_гибдд: ICONS.alertTriangle,
      дтп: ICONS.carCrash,
      прочее: ICONS.dots,
    };
    const ico = catMap[cat] || ICONS.dots;
    return { html: ico, ...TILE_RED };
  }

  return { html: ICONS.dots, ...TILE_NEU };
}

function capitalizeRu(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function categoryTitle(catRaw) {
  const c = String(catRaw || '').trim();
  if (!c) return '';
  if (c.toLowerCase() === 'то') return 'ТО';
  if (c.toLowerCase() === 'зп') return 'ЗП';
  if (c.toLowerCase() === 'дтп') return 'ДТП';
  return capitalizeRu(c.replace(/_/g, ' '));
}

/** @param {string} kassaId */
export function kassaLineLabel(kassaId) {
  if (!kassaId) return '';
  return KASSA_NAMES[kassaId] || String(kassaId);
}

/**
 * @param {any} op
 * @param {any[]} fleet
 * @param {any[]} rentals
 */
export function getOperationTitle(op, fleet, rentals) {
  const t = normalizeType(op.type);
  const kind = opUiKind(op);
  const carId = String(op.carId || '').trim();
  const cat = String(op.category || '').trim();

  if (t === 'аренда' && carId) return `Аренда · ${carId}`;

  if (kind === 'out' && cat) {
    const ct = categoryTitle(cat);
    return carId ? `${ct} · ${carId}` : ct;
  }

  if (t === 'перевод_входящий') {
    const name = kassaLineLabel(op.kassaId);
    return name ? `Перевод в кассу ${name}` : 'Перевод';
  }
  if (t === 'перевод_исходящий') {
    const name = kassaLineLabel(op.kassaId);
    return name ? `Перевод из кассы ${name}` : 'Перевод';
  }

  if (normalizeType(cat) === 'зп' || t === 'зп') {
    const fromComment = extractZpName(op.comment);
    return fromComment ? `ЗП ${fromComment}` : 'ЗП';
  }

  if (normalizeType(cat) === 'штраф_гибдд')
    return carId ? `Штраф ГИБДД · ${carId}` : 'Штраф ГИБДД';

  if (cat) return categoryTitle(cat);
  if (t) return capitalizeRu(t.replace(/_/g, ' '));
  return 'Операция';
}

function extractZpName(comment) {
  const s = String(comment || '').trim();
  if (!s) return '';
  const m = s.match(/^(?:ЗП|зп)\s*[:\-–]?\s*(.+)$/i);
  if (m) return m[1].split(/\n/)[0].trim().slice(0, 40);
  return '';
}

/**
 * Дата окончания аренды для машины на дату операции.
 */
function rentalEndForOp(op, rentals) {
  const d = op.date instanceof Date && !Number.isNaN(op.date.getTime()) ? op.date : null;
  const cid = String(op.carId || '').trim();
  if (!d || !cid || !rentals?.length) return null;
  let bestEnd = null;
  let bestStart = null;
  for (const r of rentals) {
    if (String(r.carId || '').trim() !== cid) continue;
    const ds = r.dateStart instanceof Date ? r.dateStart : null;
    const de = r.dateEnd instanceof Date ? r.dateEnd : null;
    if (!ds || Number.isNaN(ds.getTime())) continue;
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const ds0 = new Date(ds.getFullYear(), ds.getMonth(), ds.getDate());
    if (d0 < ds0) continue;
    if (de && !Number.isNaN(de.getTime())) {
      const de0 = new Date(de.getFullYear(), de.getMonth(), de.getDate());
      if (d0 > de0) continue;
    }
    if (!bestStart || ds0 >= bestStart) {
      bestStart = ds0;
      bestEnd = de && !Number.isNaN(de.getTime()) ? de : null;
    }
  }
  return bestEnd;
}

function truncateComment(s, max = 25) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

/**
 * @param {any} op
 * @param {any[]} rentals
 * @param {boolean} showKassaInMeta
 */
export function getOperationSubtitle(op, rentals, showKassaInMeta) {
  const t = normalizeType(op.type);
  const kassa = showKassaInMeta && op.kassaId ? kassaLineLabel(op.kassaId) : '';

  if (t === 'аренда') {
    const end = rentalEndForOp(op, rentals);
    const until = end ? formatShortDayMonth(end) : '';
    if (until && kassa) return `до ${until} · ${kassa}`;
    if (until) return `до ${until}`;
    return kassa || '';
  }

  const com = String(op.comment || '').trim();
  const short = com ? truncateComment(com.split('\n')[0], 25) : '';
  if (short && kassa) return `${short} · ${kassa}`;
  if (short) return short;
  return kassa || '';
}

export function tsOp(op) {
  const d = op.date instanceof Date && !Number.isNaN(op.date.getTime()) ? op.date : null;
  const t = d ? d.getTime() : 0;
  const id = String(op.opId || '');
  return { t, id };
}

/** Сортировка: новее выше; при равном времени — op_id по убыванию */
export function compareOpsNewestFirst(a, b) {
  const ta = tsOp(a);
  const tb = tsOp(b);
  if (tb.t !== ta.t) return tb.t - ta.t;
  return tb.id.localeCompare(ta.id);
}
