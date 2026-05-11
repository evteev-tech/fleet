/**
 * analytics/utils.js — общие утилиты для аналитики
 */

import { fmtRub, fmtDate, parseDate, fmtShort, fmtRuInt } from '../../utils/format.js';

export { fmtRub, fmtDate, parseDate, fmtShort, fmtRuInt };

export const PAGE_LABELS = ['Обзор', 'Расходы', 'CAPEX', 'По машинам', 'Кассы', 'Прогноз'];

export const CAPEX_MODE = {
  ALL: 'all',
  PERIOD: 'period',
};

export const OPEX_COLORS = {
  ремонт: 'var(--c-bar-100)',
  запчасти: 'var(--c-bar-75)',
  доставка: 'var(--c-bar-50)',
  зп: 'var(--c-bar-100)',
  страховка: 'var(--c-bar-50)',
  реклама: 'var(--c-bar-25)',
  прочее: 'var(--c-bar-10)',
  то: 'var(--c-bar-75)',
  штраф_гибдд: 'var(--c-bar-50)',
  дтп: 'var(--c-bar-100)',
  связь_глонасс: 'var(--c-muted)',
  покупка_машины: 'var(--c-bar-100)',
};

export function getOpexColor(category) {
  const key = String(category || '').toLowerCase().trim();
  return OPEX_COLORS[key] ?? 'var(--c-bar-10)';
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