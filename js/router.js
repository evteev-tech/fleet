/**
 * router.js — управление экранами и navbar.
 *
 * Принцип: один активный экран в любой момент.
 * Все .screen скрыты, текущий получает .screen--active.
 * Navbar рендерится один раз при входе; активный пункт обновляется при смене экрана.
 */

import { getCurrentUser } from './auth.js';
import { ROLES }         from './config.js';

// ─── Иконки navbar (пути и атрибуты — строго по макету) ─────────────────────

const ICON_HOME = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H15v-5h-6v5H4a1 1 0 0 1-1-1V9.5z"/>
</svg>`;

const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="3" width="16" height="18" rx="2"/>
  <path d="M8 8h8M8 12h8M8 16h5"/>
</svg>`;

const ICON_ADD = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <path d="M12 8v8M8 12h8"/>
</svg>`;

const ICON_FLEET = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 17H3v-5l2-5h14l2 5v5h-2"/>
  <path d="M5 17h14"/>
  <circle cx="7.5" cy="17" r="1.5"/>
  <circle cx="16.5" cy="17" r="1.5"/>
</svg>`;

const ICON_DRIVERS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="7" r="4"/>
  <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
</svg>`;

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6h16M4 12h16M4 18h16"/>
  <circle cx="8" cy="6" r="2" fill="white"/>
  <circle cx="16" cy="12" r="2" fill="white"/>
  <circle cx="10" cy="18" r="2" fill="white"/>
</svg>`;

// ─── Конфиг navbar по ролям ──────────────────────────────────────────────────

const NAVBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    { id: 'screen-home',    label: 'Главная',  icon: ICON_HOME },
    { id: 'screen-history', label: 'Касса',    icon: ICON_HISTORY },
    { id: 'screen-fleet',   label: 'Гараж',    icon: ICON_FLEET },
    { id: 'screen-drivers', label: 'Водители', icon: ICON_DRIVERS },
  ],

  [ROLES.OPERATIONS]: [
    { id: 'screen-dashboard', label: 'Главная',  icon: ICON_HOME },
    { id: 'screen-add',       label: 'Операция', icon: ICON_ADD },
    { id: 'screen-fleet',     label: 'Парк',     icon: ICON_FLEET },
    { id: 'screen-drivers',   label: 'Водители', icon: ICON_DRIVERS },
  ],

  [ROLES.INVESTOR]: [
    { id: 'screen-dashboard', label: 'Главная',   icon: ICON_HOME },
    { id: 'screen-history',   label: 'История',   icon: ICON_HISTORY },
    { id: 'screen-settings',  label: 'Настройки', icon: ICON_SETTINGS },
  ],
};

// ─── Текущий активный экран ───────────────────────────────────────────────────
let _currentScreen = null;

/**
 * Показывает экран с указанным id, скрывает остальные.
 * Обновляет активный пункт navbar.
 * Диспатчит screen:activated — экраны слушают его для ленивой загрузки данных.
 * @param {string} screenId  — id без '***REMOVED***' (напр. 'screen-home')
 * @param {object} [params]  — произвольные параметры, передаются в detail события
 */
export function showScreen(screenId, params = {}) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('screen--active', s.id === screenId);
  });
  _currentScreen = screenId;
  _updateNavbar(screenId);

  // Скрол в начало
  window.scrollTo(0, 0);

  // Уведомляем экран — он должен отрендерить себя заново
  document.dispatchEvent(new CustomEvent('screen:activated', {
    detail: { screenId, ...params },
  }));
}

/** Возвращает id текущего активного экрана. */
export function currentScreen() {
  return _currentScreen;
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

/**
 * Рендерит navbar для данной роли.
 * Вызывается один раз сразу после успешного входа.
 * @param {string} role
 */
export function renderNavbar(role) {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  const items = NAVBAR_CONFIG[role] ?? [];

  navbar.innerHTML = items.map(item => `
    <button class="nav-item" data-screen="${item.id}" aria-label="${item.label}">
      <span class="nav-item__icon">${item.icon}</span>
      <span class="nav-item__label">${item.label}</span>
      <span class="nav-item__dot"></span>
    </button>
  `).join('');

  navbar.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      showScreen(btn.dataset.screen);
    });
  });

  navbar.classList.remove('hidden');
}

/**
 * Обновляет активный пункт navbar.
 * @param {string} screenId
 */
function _updateNavbar(screenId) {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  navbar.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('nav-item--active', btn.dataset.screen === screenId);
  });
}

// ─── Инициализация ────────────────────────────────────────────────────────────

/**
 * Вызывается при загрузке страницы.
 * Проверяет сессию и показывает нужный начальный экран.
 * @param {{ onNeedLogin: Function, onLoggedIn: Function }} callbacks
 */
export function initRouter({ onNeedLogin, onLoggedIn }) {
  const session = getCurrentUser();

  if (!session) {
    showScreen('screen-login');
    document.getElementById('navbar')?.classList.add('hidden');
    onNeedLogin?.();
    return;
  }

  renderNavbar(session.role);

  const startScreen = session.role === ROLES.MECHANIC ? 'screen-home' : 'screen-dashboard';
  showScreen(startScreen);

  onLoggedIn?.(session);
}
