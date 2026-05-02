// v=6
/**
 * router.js — управление экранами и navbar.
 *
 * Принцип: один активный экран в любой момент.
 * Все .screen скрыты, текущий получает .screen--active.
 * Navbar рендерится один раз при входе; активный пункт обновляется при смене экрана.
 */

import { getCurrentUser } from './auth.js';
import { ROLES }         from './config.js';

// ─── SVG navbar (локальные файлы, GitHub Pages — относительные пути) ─────────

const ICON_ASSETS = {
  home:      'assets/icons/home.svg',
  history:   'assets/icons/history.svg',
  analytics: 'assets/icons/analytics.svg',
  settings:  'assets/icons/settings.svg',
  fleet:     'assets/icons/fleet.svg',
};

// ─── Inline-иконки для экранов без отдельного asset ──────────────────────────

const ICON_ADD = `<svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M12 8v8M8 12h8" fill="none"/>
</svg>`;

const ICON_DRIVERS = `<svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="7" r="4" fill="none"/>
  <path d="M4 21v-1a8 8 0 0 1 16 0v1" fill="none"/>
</svg>`;

// ─── Конфиг navbar по ролям (iconPath | iconHtml) ───────────────────────────

const NAVBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    { id: 'screen-home',    label: 'Главная',  iconPath: ICON_ASSETS.home },
    { id: 'screen-history', label: 'Касса',    iconPath: ICON_ASSETS.history },
    { id: 'screen-fleet',   label: 'Парк',     iconPath: ICON_ASSETS.fleet },
    { id: 'screen-drivers', label: 'Водители', iconHtml: ICON_DRIVERS },
  ],

  [ROLES.OPERATIONS]: [
    { id: 'screen-dashboard', label: 'Главная',   iconPath: ICON_ASSETS.home },
    { id: 'screen-add',       label: 'Операция',  iconHtml: ICON_ADD },
    { id: 'screen-analytics', label: 'Аналитика', iconPath: ICON_ASSETS.analytics },
    { id: 'screen-fleet',     label: 'Парк',      iconPath: ICON_ASSETS.fleet },
    { id: 'screen-drivers',   label: 'Водители',  iconHtml: ICON_DRIVERS },
  ],

  [ROLES.INVESTOR]: [
    { id: 'screen-dashboard', label: 'Главная',   iconPath: ICON_ASSETS.home },
    { id: 'screen-history',   label: 'История',   iconPath: ICON_ASSETS.history },
    { id: 'screen-analytics', label: 'Аналитика', iconPath: ICON_ASSETS.analytics },
    { id: 'screen-settings',  label: 'Настройки', iconPath: ICON_ASSETS.settings },
  ],
};

// ─── Текущий активный экран ───────────────────────────────────────────────────
let _currentScreen = null;

/**
 * Вставляет SVG из файла и нормализует корневой svg.
 * @param {string} path
 * @param {HTMLElement} container
 */
async function loadIcon(path, container) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('ICON_FETCH_' + res.status);
  const svg = await res.text();
  container.innerHTML = svg;
  _stripSvgDimensions(container);
}

function _stripSvgDimensions(container) {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return;
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
}

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
export async function renderNavbar(role) {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  const items = NAVBAR_CONFIG[role] ?? [];

  navbar.innerHTML = items.map(item => {
    const iconClass = item.iconPath ? 'nav-icon nav-icon--asset' : 'nav-icon nav-icon--inline';
    return `
    <button type="button" class="nav-item" data-screen="${item.id}" aria-label="${item.label}">
      <div class="${iconClass}" aria-hidden="true"></div>
      <span class="nav-label">${item.label}</span>
      <span class="nav-item__dot"></span>
    </button>`;
  }).join('');

  const buttons = [...navbar.querySelectorAll('.nav-item')];

  await Promise.all(items.map(async (item, i) => {
    const iconEl = buttons[i].querySelector('.nav-icon');
    if (!iconEl) return;
    if (item.iconPath) {
      try {
        await loadIcon(item.iconPath, iconEl);
      } catch (e) {
        console.error('Navbar icon:', item.iconPath, e);
        iconEl.innerHTML = '';
      }
    } else if (item.iconHtml) {
      iconEl.innerHTML = item.iconHtml;
      _stripSvgDimensions(iconEl);
    }
  }));

  buttons.forEach(btn => {
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
