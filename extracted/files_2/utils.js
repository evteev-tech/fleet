/**
 * analytics/utils.js — общие утилиты для аналитики
 */

// Реэкспорт утилит форматирования
export { fmtRub, fmtDate, parseDate, fmtShort } from '../../utils/format.js';

// Константы
export const PAGE_LABELS = ['Обзор', 'Расходы', 'CAPEX', 'По машинам', 'Кассы', 'Прогноз'];

export const CAPEX_MODE = {
  PERIOD: 'period',
  ALL: 'all',
};

export const OPEX_COLORS = {
  ремонт:    'var(--c-bar-100)',
  запчасти:  'var(--c-bar-75)',
  доставка:  'var(--c-bar-50)',
  зп:        'var(--c-bar-100)',
  страховка: 'var(--c-bar-50)',
  реклама:   'var(--c-bar-25)',
  прочее:    'var(--c-bar-10)',
  то:        'var(--c-bar-75)',
  штраф_гибдд: 'var(--c-bar-50)',
  дтп:       'var(--c-bar-100)',
  связь_глонасс: 'var(--c-muted)',
  покупка_машины: 'var(--c-bar-100)',
};

/**
 * Возвращает цвет для категории OPEX
 */
export function getOpexColor(category) {
  const key = String(category || '').toLowerCase().trim();
  return OPEX_COLORS[key] ?? 'var(--c-bar-10)';
}

/**
 * Генерирует HTML pills выбора месяца
 * СКОПИРОВАТЬ СЮДА: строки 48-56 из analytics.js
 */
export function pillMonths() {
  // TODO: вставить код функции _pillMonths
}

/**
 * Короткий лейбл месяца для pill
 * СКОПИРОВАТЬ СЮДА: строки 58-62 из analytics.js
 */
export function pillShortLabel(year, month) {
  // TODO: вставить код функции _pillShortLabel
}

/**
 * Тип операции: 'revenue' | 'opex' | 'capex'
 * СКОПИРОВАТЬ СЮДА: строки 75-84 из analytics.js
 */
export function opClass(op) {
  // TODO: вставить код функции _opClass
}

/**
 * Парсит дату операции
 * СКОПИРОВАТЬ СЮДА: строки 86-100 из analytics.js
 */
export function toOpDate(op) {
  // TODO: вставить код функции _toOpDate
}

/**
 * Генерирует блок дельты (↑ зелёный / ↓ красный)
 * СКОПИРОВАТЬ СЮДА: строки 265-281 из analytics.js
 */
export function deltaBlock(key, cur, prev) {
  // TODO: вставить код функции _deltaBlock
}

/**
 * Короткий лейбл месяца (Янв, Фев...)
 * СКОПИРОВАТЬ СЮДА: строки 672-676 из analytics.js
 */
export function monthLabelShort(year, month) {
  // TODO: вставить код функции _monthLabelShort
}

/**
 * Полный лейбл месяца (Январь 2024)
 * СКОПИРОВАТЬ СЮДА: строки 678-682 из analytics.js
 */
export function monthLabelFull(year, month) {
  // TODO: вставить код функции _monthLabelFull
}
