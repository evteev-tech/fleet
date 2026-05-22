/**
 * analytics/utils.js — общие утилиты для аналитики
 */

import { fmtRub, fmtDate, parseDate, fmtShort, fmtRuInt } from '../../utils/format.js';

export { fmtRub, fmtDate, parseDate, fmtShort, fmtRuInt };

export const PAGE_LABELS = ['Overview', 'Расходы', 'CAPEX', 'По машинам', 'Кассы', 'Прогноз'];

export const CAPEX_MODE = {
  ALL: 'all',
  PERIOD: 'period',
};

/**
 * Цвет категории расхода по названию (includes, без регистра).
 * @param {string} name
 * @returns {string}
 */
export function getCategoryColor(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('зп') || s.includes('зарплат') || s.includes('салар')) return 'var(--cat-salary)';
  if (s.includes('страх')) return 'var(--cat-insurance)';
  if (s.includes('запчаст') || s.includes('ремонт') || s.includes('детал')) return 'var(--cat-parts)';
  if (s.includes('топлив') || s.includes('бензин') || s.includes('гсм') || s.includes('материал'))
    return 'var(--cat-fuel)';
  if (s.includes('штраф') || s.includes('гибдд') || s.includes('налог')) return 'var(--cat-fines)';
  return 'var(--cat-other)';
}

/** @deprecated используйте getCategoryColor — оставлено для совместимости */
export function getOpexColor(category) {
  return getCategoryColor(category);
}

/** 4 месяца: три предыдущих + текущий (от «сегодня»). */
export function pillMonths() {
  const now = new Date();
  const out = [];
  for (let d = -3; d <= 0; d++) {
    const t = new Date(now.getFullYear(), now.getMonth() + d, 1);
    out.push({ year: t.getFullYear(), month: t.getMonth() + 1 });
  }
  return out;
}

export function pillShortLabel(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'short' })
    .replace(/\.$/, '');
}

export function opClass(op) {
  const raw =
    op?.класс_final ??
    op?.classFinal ??
    op?.classItog ??
    op?.класс_итог ??
    op?.class_override ??
    '';
  return String(raw).trim().toLowerCase();
}

export function toOpDate(op) {
  if (op?.date instanceof Date && !Number.isNaN(op.date.getTime())) return op.date;
  const d = new Date(op?.date);
  if (!Number.isNaN(d.getTime())) return d;
  const raw = String(op?.dateRaw ?? '').trim();
  return raw ? parseDate(raw) : null;
}

export function monthLabelShort(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'short' })
    .replace(/\.$/, '');
}

export function monthLabelFull(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long' })
    .replace(/^./, ch => ch.toUpperCase());
}

/** «в январе», «в апреле» — предложный падеж (как в copy «было N ₽ в апреле»). */
const MONTHS_IN_PREPOSITIONAL = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
];

export function monthInPrepositional(_year, month) {
  const idx = Math.max(0, Math.min(11, (Number(month) || 1) - 1));
  return MONTHS_IN_PREPOSITIONAL[idx] || '';
}

/** Дательный падеж месяца + год: «апрелю 2027» (копирайт «к апрелю 2027»). */
const MONTHS_DATIVE = [
  'январю',
  'февралю',
  'марту',
  'апрелю',
  'маю',
  'июню',
  'июлю',
  'августу',
  'сентябрю',
  'октябрю',
  'ноябрю',
  'декабрю',
];

export function monthYearDative(year, month) {
  const idx = Math.max(0, Math.min(11, (Number(month) || 1) - 1));
  const m = MONTHS_DATIVE[idx] || '';
  const y = Number(year);
  return m ? `${m} ${Number.isFinite(y) ? y : ''}`.trim() : '';
}

/** Лучше = ↑ зел.: выручка/прибыль растут; OPEX/CAPEX падают */
export function deltaBlock(key, cur, prev) {
  if (prev === null || prev === undefined || Number.isNaN(Number(prev))) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  let better;
  if (key === 'revenue' || key === 'profit') better = c > p;
  else better = c < p;
  const diff = Math.abs(c - p);
  if (diff < 1e-6) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const arrow = better ? '↑' : '↓';
  const cls = better ? 'analytics-delta--good' : 'analytics-delta--bad';
  return `<span class="analytics-delta ${cls}">${arrow} ${fmtRub(diff)}</span>`;
}