/**
 * analytics/pnl.js — вкладка "По машинам" (P&L)
 */

import { fmtRub } from './utils.js';

/**
 * Форматирует число сокращённо (для PnL)
 * СКОПИРОВАТЬ СЮДА: строки 585-589 из analytics.js
 */
function pnlShortK(n) {
  // TODO: вставить код функции _pnlShortK
}

/**
 * Возвращает цвет фона ячейки PnL heatmap
 * СКОПИРОВАТЬ СЮДА: строки 591-607 из analytics.js
 */
function pnlHeatBg(revenue, result) {
  // TODO: вставить код функции _pnlHeatBg
}

/**
 * HTML heatmap карточек машин
 * СКОПИРОВАТЬ СЮДА: строки 609-636 из analytics.js
 */
function pnlHtml(pnl) {
  // TODO: вставить код функции _pnlHtml
}

/**
 * Добавляет строки итогов к PnL
 * СКОПИРОВАТЬ СЮДА: строки 638-650 из analytics.js
 */
function pnlRowsWithTotals(pnl, generalOpex) {
  // TODO: вставить код функции _pnlRowsWithTotals
}

/**
 * HTML блока утилизации парка
 * СКОПИРОВАТЬ СЮДА: строки 652-670 из analytics.js
 */
function utilHtml(utilization) {
  // TODO: вставить код функции _utilHtml
}

/**
 * Генерирует HTML вкладки "По машинам"
 * 
 * @param {Object} dash - дашборд с PnL данными
 * @returns {string} HTML string
 */
export function renderPnL(dash) {
  // TODO: собрать HTML из pnlHtml + utilHtml
  // Использовать данные: dash.pnl, dash.generalOpex, dash.utilizationPct
  const pnlData = pnlRowsWithTotals(dash.pnl, dash.generalOpex);
  const pnlSection = pnlHtml(pnlData);
  const utilSection = utilHtml(dash.utilizationPct);
  
  return `
    <div class="analytics-page" data-page="3">
      ${pnlSection}
      ${utilSection}
    </div>
  `;
}
