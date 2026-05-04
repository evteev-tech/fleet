// v=7
/**
 * router.js — управление экранами и navbar.
 *
 * Принцип: один активный экран в любой момент.
 * Все .screen скрыты, текущий получает .screen--active.
 * Navbar рендерится один раз при входе; активный пункт обновляется при смене экрана.
 */

import { getCurrentUser } from './auth.js';
import { ROLES }         from './config.js';

// ─── SVG navbar (inline outline, currentColor) ────────────────────────────────
const NAV_ICONS = {
  home: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M9 21V12h6v9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`,
  fleet: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/>
  <path d="M5 8V6a2 2 0 012-2h10a2 2 0 012 2v2" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="7" cy="18" r="1.5" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="17" cy="18" r="1.5" stroke="currentColor" stroke-width="1.6"/>
</svg>`,
  drivers: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6"/>
  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
  history: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
  <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
  analytics: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <path d="M4 20V14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M9 20V8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M14 20V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M19 20V4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
  settings: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>
  <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
  add: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
  <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
};

// ─── Конфиг navbar по ролям ───────────────────────────────────────────────────

const NAVBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    { id: 'screen-home',    label: 'Главная',  iconSvg: NAV_ICONS.home },
    { id: 'screen-history', label: 'Касса',    iconSvg: NAV_ICONS.history },
    { id: 'screen-fleet',   label: 'Парк',     iconSvg: NAV_ICONS.fleet },
    { id: 'screen-drivers', label: 'Водители', iconSvg: NAV_ICONS.drivers },
  ],

  [ROLES.OPERATIONS]: [
    { id: 'screen-dashboard', label: 'Главная',   iconSvg: NAV_ICONS.home },
    { id: 'screen-add',       label: 'Операция',  iconSvg: NAV_ICONS.add },
    { id: 'screen-analytics', label: 'Аналитика', iconSvg: NAV_ICONS.analytics },
    { id: 'screen-fleet',     label: 'Парк',      iconSvg: NAV_ICONS.fleet },
    { id: 'screen-drivers',   label: 'Водители',  iconSvg: NAV_ICONS.drivers },
  ],

  [ROLES.INVESTOR]: [
    { id: 'screen-dashboard', label: 'Главная',   iconSvg: NAV_ICONS.home },
    { id: 'screen-history',   label: 'История',   iconSvg: NAV_ICONS.history },
    { id: 'screen-analytics', label: 'Аналитика', iconSvg: NAV_ICONS.analytics },
    { id: 'screen-settings',  label: 'Настройки', iconSvg: NAV_ICONS.settings },
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

  const navbar = document.getElementById('navbar');
  if (navbar) {
    const u = getCurrentUser();
    navbar.classList.toggle('hidden', !!u && screenId === 'screen-analytics');
  }

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
/**
 * Ренерит те же пункты нижнего меню, что и глобальный navbar, в произвольный контейнер.
 * @param {HTMLElement} container
 * @param {string} role
 * @param {string|null} activeScreenId  — какой экран пометить .active (или null)
 */
export async function mountNavbarInContainer(container, role, activeScreenId = null) {
  if (!container) return;

  const items = NAVBAR_CONFIG[role] ?? [];

  container.innerHTML = items
    .map(
      item => `
    <button type="button" class="nav-item" data-screen="${item.id}" aria-label="${item.label}">
      <div class="nav-icon" aria-hidden="true"></div>
      <span class="nav-label">${item.label}</span>
      <span class="nav-item__dot"></span>
    </button>`,
    )
    .join('');

  const buttons = [...container.querySelectorAll('.nav-item')];

  items.forEach((item, i) => {
    const iconEl = buttons[i].querySelector('.nav-icon');
    if (!iconEl) return;
    iconEl.innerHTML = item.iconSvg || '';
  });

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      showScreen(btn.dataset.screen);
    });
    if (activeScreenId) {
      btn.classList.toggle('active', btn.dataset.screen === activeScreenId);
    }
  });
}

export async function renderNavbar(role) {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  await mountNavbarInContainer(navbar, role, null);

  navbar.classList.remove('hidden');
}

/**
 * Обновляет активный пункт navbar.
 * @param {string} screenId
 */
function _updateNavbar(screenId) {
  document
    .querySelectorAll('***REMOVED***navbar .nav-item, ***REMOVED***screen-analytics .analytics-navbar .nav-item')
    .forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
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

  void renderNavbar(session.role).then(() => {
    const startScreen = session.role === ROLES.MECHANIC ? 'screen-home' : 'screen-dashboard';
    showScreen(startScreen);
    onLoggedIn?.(session);
  });
}
