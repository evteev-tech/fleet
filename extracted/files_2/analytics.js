/**
 * analytics.js — главный оркестратор аналитики
 * 
 * Координирует работу 6 вкладок, загрузку данных, роутинг между страницами
 */

// Импорты зависимостей
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { mountNavbarInContainer } from '../router.js';
import { CAR_STATUSES, KASSA_NAMES } from '../config.js';

// Импорты модулей вкладок
import { renderOverview } from './analytics/overview.js';
import { renderOpex } from './analytics/opex.js';
import { renderCapex } from './analytics/capex.js';
import { renderPnL } from './analytics/pnl.js';
import { renderKassas } from './analytics/kassas.js';
import { renderForecast, afterForecastMounted } from './analytics/forecast.js';
import { renderDesktopShell, renderDesktopSkeleton, isDesktop } from './analytics/desktop.js';
import { 
  PAGE_LABELS, 
  CAPEX_MODE, 
  opClass, 
  toOpDate,
  pillMonths,
  pillShortLabel 
} from './analytics/utils.js';

// State
const state = {
  currentPage: 0,
  capexMode: CAPEX_MODE.PERIOD,
  rentalsLoaded: false,
  rentals: null,
};

/**
 * Проверяет что в дашборде есть данные
 * СКОПИРОВАТЬ СЮДА: строки 64-73 из analytics.js (оставить в главном файле)
 */
function dashboardHasContent(d) {
  // TODO: вставить код
}

/**
 * Главная функция расчёта метрик дашборда
 * СКОПИРОВАТЬ СЮДА: строки 102-263 из analytics.js (оставить в главном файле)
 * 
 * Эта функция остаётся в главном файле т.к. она используется всеми вкладками
 */
function calcDash({ ops, cars, kassas, deposits, allTime, year, month }) {
  // TODO: вставить весь код функции _calcDash
  // Это большая функция — основная бизнес-логика расчёта всех метрик
}

/**
 * HTML header pills (выбор месяца)
 * СКОПИРОВАТЬ СЮДА: строки 896-918 из analytics.js
 */
function headerPillsHtml(dash) {
  // TODO: вставить код
}

/**
 * Собирает HTML всех 6 вкладок
 * СКОПИРОВАТЬ СЮДА: строки 1087-1132 из analytics.js
 * 
 * НО ЗАМЕНИТЬ вызовы _overviewHtml → renderOverview и т.д.
 */
function pagesHtml(dash, emptyMsg, capexMode) {
  const pages = [];
  
  // Страница 0: Обзор
  pages.push(renderOverview(dash));
  
  // Страница 1: Расходы
  pages.push(renderOpex(dash.opex));
  
  // Страница 2: CAPEX
  pages.push(renderCapex(dash, capexMode));
  
  // Страница 3: По машинам
  pages.push(renderPnL(dash));
  
  // Страница 4: Кассы
  pages.push(renderKassas(dash));
  
  // Страница 5: Прогноз
  if (state.rentalsLoaded) {
    pages.push(renderForecast(state.rentals));
  } else {
    pages.push(renderForecast(null)); // loading state
  }
  
  return pages.join('');
}

/**
 * HTML dots навигации
 * СКОПИРОВАТЬ СЮДА: строки 1134-1139 из analytics.js
 */
function dotsHtml() {
  // TODO: вставить код
}

/**
 * Собирает shell из частей
 * СКОПИРОВАТЬ СЮДА: строки 1141-1157 из analytics.js
 */
function shellFromParts({ headerPills, carouselInner, bottomBar }) {
  // TODO: вставить код
}

/**
 * Скелетон загрузки (mobile)
 * СКОПИРОВАТЬ СЮДА: строки 1159-1175 из analytics.js
 */
function skeletonShellHTML() {
  // TODO: вставить код
}

/**
 * Shell ошибки
 * СКОПИРОВАТЬ СЮДА: строки 1177-1192 из analytics.js
 */
function errorShellHTML(noConn) {
  // TODO: вставить код
}

/**
 * Success shell (mobile)
 * СКОПИРОВАТЬ СЮДА: строки 1194-1200 из analytics.js
 */
function successShellHTML(dash, emptyMsg, capexMode) {
  // TODO: вставить код
}

/**
 * Обновление UI карусели (индикаторы)
 * СКОПИРОВАТЬ СЮДА: строки 1202-1211 из analytics.js
 */
function updateCarouselChrome(root, idx) {
  // TODO: вставить код
}

/**
 * Анимация перехода между страницами
 * СКОПИРОВАТЬ СЮДА: строки 1213-1279 из analytics.js
 */
function animatePage(root, idx) {
  // TODO: вставить код
}

/**
 * Биндинг скролла карусели
 * СКОПИРОВАТЬ СЮДА: строки 1281-1307 из analytics.js
 */
function bindCarouselScroll(root) {
  // TODO: вставить код
}

/**
 * Гидрация данных касс (после монтирования)
 * СКОПИРОВАТЬ СЮДА: строки 1309-1313 из analytics.js
 */
function hydrateKassas(root, dash) {
  // TODO: вставить код
}

/**
 * Хуки после монтирования shell
 * СКОПИРОВАТЬ СЮДА: строки 1315-1343 из analytics.js
 */
function afterShellMounted(root, dash) {
  // TODO: вставить код
}

/**
 * Применяет дашборд к state
 * СКОПИРОВАТЬ СЮДА: строки 1665-1669 из analytics.js
 */
function applyDashToState(dash) {
  // TODO: вставить код
}

/**
 * Обновление view без перезагрузки данных
 * СКОПИРОВАТЬ СЮДА: строки 1671-1858 из analytics.js
 */
function refreshViewOnly() {
  // TODO: вставить код — большая функция
}

/**
 * Обработчик кликов
 * СКОПИРОВАТЬ СЮДА: строки 1860-1931 из analytics.js
 */
function onRootClick(e) {
  // TODO: вставить код — большая функция обработки событий
}

/**
 * ТОЧКА ВХОДА
 * Инициализация аналитики
 */
export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  
  // TODO: вставить весь код из строк 1933-1946
  // Загрузка данных, рендер, биндинг событий
}
