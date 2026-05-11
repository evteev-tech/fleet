/**
 * analytics/desktop.js — Desktop layout
 */

import { fmtRub, deltaBlock, monthLabelShort } from './utils.js';

/**
 * Проверка desktop режима
 * СКОПИРОВАТЬ СЮДА: строка 1345 из analytics.js
 */
export const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 1024;

/**
 * SVG sparkline (мини-график)
 * СКОПИРОВАТЬ СЮДА: строки 1347-1370 из analytics.js
 */
function sparklineSvg(values, color, height) {
  // TODO: вставить код функции _sparklineSvg
}

/**
 * Горизонтальный бар
 * СКОПИРОВАТЬ СЮДА: строки 1372-1377 из analytics.js
 */
function hbar(pct, color) {
  // TODO: вставить код функции _hbar
}

/**
 * Мини-донат (pie chart)
 * СКОПИРОВАТЬ СЮДА: строки 1379-1396 из analytics.js
 */
function miniDonut(slices, size) {
  // TODO: вставить код функции _miniDonut
}

/**
 * Desktop дельта (стрелка + процент)
 * СКОПИРОВАТЬ СЮДА: строки 1398-1407 из analytics.js
 */
function dtDelta(key, cur, prev) {
  // TODO: вставить код функции _dtDelta
}

/**
 * Данные для месячного графика
 * СКОПИРОВАТЬ СЮДА: строки 1409-1424 из analytics.js
 */
function monthSeries(ops, key, year, month) {
  // TODO: вставить код функции _monthSeries
}

/**
 * HTML полного desktop shell
 * СКОПИРОВАТЬ СЮДА: строки 1426-1635 из analytics.js
 * 
 * @param {Object} dash - полный дашборд
 * @returns {string} HTML string
 */
export function renderDesktopShell(dash) {
  // TODO: вставить код функции _desktopShellHTML
  // Переименовать: _desktopShellHTML → renderDesktopShell
  // Внутри использует: sparklineSvg, hbar, miniDonut, dtDelta, monthSeries
}

/**
 * Desktop скелетон (loading state)
 * СКОПИРОВАТЬ СЮДА: строки 1637-1663 из analytics.js
 */
export function renderDesktopSkeleton() {
  // TODO: вставить код функции _desktopSkeletonHTML
}
