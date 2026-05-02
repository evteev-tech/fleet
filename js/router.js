/**
 * router.js — управление экранами и navbar.
 *
 * Принцип: один активный экран в любой момент.
 * Все .screen скрыты, текущий получает .screen--active.
 * Navbar рендерится один раз при входе; активный пункт обновляется при смене экрана.
 */

import { getCurrentUser } from './auth.js';
import { ROLES }         from './config.js';

// ─── Конфиг navbar по ролям ──────────────────────────────────────────────────

const NAVBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    {
      id: 'screen-home',
      label: 'Главная',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <path d="M3 9.5L11 3L19 9.5V19C19 19.5523 18.5523 20 18 20H14V15H8V20H4C3.44772 20 3 19.5523 3 19V9.5Z"
                 stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
             </svg>`,
    },
    {
      id: 'screen-history',
      label: 'Касса',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <rect x="3" y="5" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <path d="M3 9H19" stroke="currentColor" stroke-width="1.7"/>
               <path d="M7 14H10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
    {
      id: 'screen-fleet',
      label: 'Гараж',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <path d="M4 14H18M4 14L5.5 9H16.5L18 14M4 14V17H18V14" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
               <circle cx="7" cy="17" r="1.5" stroke="currentColor" stroke-width="1.5"/>
               <circle cx="15" cy="17" r="1.5" stroke="currentColor" stroke-width="1.5"/>
             </svg>`,
    },
    {
      id: 'screen-drivers',
      label: 'Водители',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <circle cx="11" cy="8" r="3.5" stroke="currentColor" stroke-width="1.7"/>
               <path d="M4 19C4 15.6863 7.13401 13 11 13C14.866 13 18 15.6863 18 19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
  ],

  [ROLES.OPERATIONS]: [
    {
      id: 'screen-dashboard',
      label: 'Главная',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="12" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="3" y="12" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="12" y="12" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
             </svg>`,
    },
    {
      id: 'screen-add',
      label: 'Операция',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.7"/>
               <path d="M11 7V15M7 11H15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
    {
      id: 'screen-fleet',
      label: 'Парк',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <path d="M4 14H18M4 14L5.5 9H16.5L18 14M4 14V17H18V14" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
               <circle cx="7" cy="17" r="1.5" stroke="currentColor" stroke-width="1.5"/>
               <circle cx="15" cy="17" r="1.5" stroke="currentColor" stroke-width="1.5"/>
             </svg>`,
    },
    {
      id: 'screen-drivers',
      label: 'Водители',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <circle cx="11" cy="8" r="3.5" stroke="currentColor" stroke-width="1.7"/>
               <path d="M4 19C4 15.6863 7.13401 13 11 13C14.866 13 18 15.6863 18 19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
  ],

  [ROLES.INVESTOR]: [
    {
      id: 'screen-dashboard',
      label: 'Главная',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="12" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="3" y="12" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
               <rect x="12" y="12" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/>
             </svg>`,
    },
    {
      id: 'screen-history',
      label: 'История',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <path d="M11 5V11L14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
               <path d="M3.5 11C3.5 6.85786 6.85786 3.5 11 3.5C15.1421 3.5 18.5 6.85786 18.5 11C18.5 15.1421 15.1421 18.5 11 18.5C8.5 18.5 6.25 17.3 4.8 15.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
    {
      id: 'screen-settings',
      label: 'Настройки',
      icon: `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
               <circle cx="11" cy="11" r="2.5" stroke="currentColor" stroke-width="1.7"/>
               <path d="M11 3V5M11 17V19M3 11H5M17 11H19M5.22 5.22L6.64 6.64M15.36 15.36L16.78 16.78M5.22 16.78L6.64 15.36M15.36 6.64L16.78 5.22"
                 stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
             </svg>`,
    },
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
