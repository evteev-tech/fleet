/**
 * Форматирование сумм и вспомогательные строки для экрана «Касса».
 */

import { fmtRuInt } from '../utils/format.js';

const NBSP = '\u00A0';
const MINUS = '\u2212';

/** @param {number} n */
export function formatRubAmount(n) {
  return `${fmtRuInt(Math.abs(Number(n) || 0)).replace(/\s/g, NBSP)}${NBSP}₽`;
}

/**
 * @param {number} n
 * @param {'+'|'−'|''} sign
 */
export function formatRubWithSign(n, sign) {
  const abs = Math.round(Math.abs(Number(n) || 0));
  const body = fmtRuInt(abs).replace(/\s/g, NBSP);
  return `${sign}${body}${NBSP}₽`;
}

/** Склонение «операция» для русского. */
export function declOperations(n) {
  const k = Math.abs(Number(n)) % 100;
  const k1 = k % 10;
  if (k > 10 && k < 20) return 'операций';
  if (k1 === 1) return 'операция';
  if (k1 >= 2 && k1 <= 4) return 'операции';
  return 'операций';
}

const _MONTH_PREP = [
  '',
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

/** «в мае», «в январе» */
export function monthPrepositional(monthIndex1Based) {
  return _MONTH_PREP[monthIndex1Based] || '';
}

/** «Май 2026» без «г.» */
export function monthYearLabel(year, monthIndex1Based) {
  const d = new Date(year, monthIndex1Based - 1, 1);
  const m = d.toLocaleDateString('ru-RU', { month: 'long' });
  const cap = m.charAt(0).toUpperCase() + m.slice(1);
  return `${cap} ${year}`;
}

/** Короткая дата DD.MM для подзаголовка аренды */
export function formatShortDayMonth(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

export { MINUS, NBSP };
