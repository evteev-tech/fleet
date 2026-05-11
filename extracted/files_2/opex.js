/**
 * analytics/opex.js — вкладка "Расходы" (OPEX)
 */

import { fmtRub, getOpexColor, monthLabelShort } from './utils.js';

/**
 * Лейбл предыдущего периода для сравнения
 * СКОПИРОВАТЬ СЮДА: строки 440-443 из analytics.js
 */
function prevPeriodLabel(year, month) {
  // TODO: вставить код функции _prevPeriodLabel
}

/**
 * HTML блока динамики OPEX (сравнение с прошлым)
 * СКОПИРОВАТЬ СЮДА: строки 445-520 из analytics.js
 */
function opexDynamicsHtml(dash, currentRows, currentTotal) {
  // TODO: вставить код функции _opexDynamicsHtml
}

/**
 * Генерирует HTML вкладки "Расходы"
 * СКОПИРОВАТЬ СЮДА: строки 522-584 из analytics.js
 * 
 * @param {Array} opex - массив категорий OPEX
 * @returns {string} HTML string
 */
export function renderOpex(opex) {
  // TODO: вставить код функции _opexHtml
  // Переименовать: _opexHtml → renderOpex
  // Внутри использует: opexDynamicsHtml, prevPeriodLabel
}
