/**
 * analytics/capex.js — вкладка "CAPEX"
 */

import { fmtRub, CAPEX_MODE, monthLabelShort, monthLabelFull } from './utils.js';

/**
 * Имя категории CAPEX для отображения
 * СКОПИРОВАТЬ СЮДА: строки 684-697 из analytics.js
 */
function capexBucketName(cat) {
  // TODO: вставить код функции _capexBucketName
}

/**
 * Расчёт месячных данных CAPEX
 * СКОПИРОВАТЬ СЮДА: строки 699-718 из analytics.js
 */
function capexPageMonthly(ops, year, month) {
  // TODO: вставить код функции _capexPageMonthly
}

/**
 * Генерирует HTML вкладки CAPEX
 * СКОПИРОВАТЬ СЮДА: строки 720-842 из analytics.js
 * 
 * @param {Object} dash - дашборд
 * @param {string} capexMode - 'period' | 'all'
 * @returns {string} HTML string
 */
export function renderCapex(dash, capexMode = CAPEX_MODE.PERIOD) {
  // TODO: вставить код функции _capexPageHtml
  // Переименовать: _capexPageHtml → renderCapex
  // Включает: донат, timeline, ROI, toggle
}
