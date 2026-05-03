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

// ─── SVG navbar (локальные файлы, GitHub Pages — относительные пути) ─────────

/** Все иконки navbar — только файлы из assets/icons/ (единый стиль) */
const ICON_ASSETS = {
  home:      'assets/icons/home.svg',
  history:   'assets/icons/history.svg',
  analytics: 'assets/icons/analytics.svg',
  settings:  'assets/icons/settings.svg',
  fleet:     'assets/icons/fleet.svg',
  driver:    'assets/icons/driver.svg',
  add:       'assets/icons/add.svg',
};

// ─── Конфиг navbar по ролям (только iconPath) ────────────────────────────────

const NAVBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    { id: 'screen-home',    label: 'Главная',  iconPath: ICON_ASSETS.home },
    { id: 'screen-history', label: 'Касса',    iconPath: ICON_ASSETS.history },
    { id: 'screen-fleet',   label: 'Парк',     iconPath: ICON_ASSETS.fleet },
    { id: 'screen-drivers', label: 'Водители', iconPath: ICON_ASSETS.driver },
  ],

  [ROLES.OPERATIONS]: [
    { id: 'screen-dashboard', label: 'Главная',   iconPath: ICON_ASSETS.home },
    { id: 'screen-add',       label: 'Операция',  iconPath: ICON_ASSETS.add },
    { id: 'screen-analytics', label: 'Аналитика', iconPath: ICON_ASSETS.analytics },
    { id: 'screen-fleet',     label: 'Парк',      iconPath: ICON_ASSETS.fleet },
    { id: 'screen-drivers',   label: 'Водители',  iconPath: ICON_ASSETS.driver },
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
 * Подгружает SVG из assets и вставляет в контейнер navbar.
 * @param {string} path
 * @param {HTMLElement} container
 */
async function loadNavIcon(path, container) {
  try {
    const res = await fetch(path);
    if (!res.ok) return;
    const svg = await res.text();
    container.innerHTML = svg;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
    }
  } catch (_) {}
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

  await Promise.all(
    items.map(async (item, i) => {
      const iconEl = buttons[i].querySelector('.nav-icon');
      if (!iconEl || !item.iconPath) return;
      await loadNavIcon(item.iconPath, iconEl);
    }),
  );

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
