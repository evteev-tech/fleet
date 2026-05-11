/**
 * Десктопный sidebar: те же пункты, что и navbar, сгруппированные по секциям.
 */
import { getCurrentUser } from './auth.js';
import { ROLES } from './config.js';
import { currentScreen, showScreen } from './router.js';

/**
 * @typedef {{ screen: string, label: string, icon: string }} SidebarItem
 * @typedef {{ section: string, items: SidebarItem[] }} SidebarSection
 */

/** @type {Record<string, SidebarSection[]>} */
const SIDEBAR_CONFIG = {
  [ROLES.MECHANIC]: [
    {
      section: 'Основное',
      items: [
        { screen: 'screen-home', label: 'Главная', icon: 'ti-home' },
        { screen: 'screen-history', label: 'Касса', icon: 'ti-history' },
      ],
    },
    {
      section: 'Управление',
      items: [
        { screen: 'screen-fleet', label: 'Парк', icon: 'ti-car' },
        { screen: 'screen-drivers', label: 'Водители', icon: 'ti-users' },
      ],
    },
  ],

  [ROLES.OPERATIONS]: [
    {
      section: 'Основное',
      items: [
        { screen: 'screen-home',      label: 'Главная',   icon: 'ti-home' },
        { screen: 'screen-history',   label: 'Касса',     icon: 'ti-history' },
        { screen: 'screen-analytics', label: 'Аналитика', icon: 'ti-chart-bar' },
      ],
    },
    {
      section: 'Управление',
      items: [
        { screen: 'screen-fleet',   label: 'Парк',      icon: 'ti-car' },
        { screen: 'screen-drivers', label: 'Водители',  icon: 'ti-users' },
      ],
    },
  ],

  [ROLES.INVESTOR]: [
    {
      section: 'Основное',
      items: [
        { screen: 'screen-dashboard', label: 'Главная', icon: 'ti-layout-dashboard' },
        { screen: 'screen-history', label: 'История', icon: 'ti-history' },
        { screen: 'screen-analytics', label: 'Аналитика', icon: 'ti-chart-bar' },
      ],
    },
    {
      section: 'Управление',
      items: [{ screen: 'screen-settings', label: 'Настройки', icon: 'ti-settings' }],
    },
  ],
};

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} role
 */
export function renderSidebar(role) {
  if (typeof window === 'undefined' || window.innerWidth < 1024) return;

  const r = String(role ?? '')
    .trim()
    .toLowerCase();
  const sections = SIDEBAR_CONFIG[r];
  if (!sections?.length) return;

  removeSidebar();

  const user = getCurrentUser();
  const firstName = String(user?.name || 'Азамат').trim();
  const initial = firstName ? firstName[0].toUpperCase() : 'А';

  const aside = document.createElement('aside');
  aside.id = 'sidebar';

  const sectionsHtml = sections
    .map(
      sec => `
    <div class="sidebar-section">
      <div class="sidebar-section-label">${_esc(sec.section)}</div>
      ${sec.items
        .map(
          item => `
        <button type="button" class="sidebar-item" data-screen="${_esc(item.screen)}">
          <i class="ti ${item.icon}" aria-hidden="true"></i>
          <span class="sidebar-label">${_esc(item.label)}</span>
          <span class="sidebar-tooltip">${_esc(item.label)}</span>
        </button>`,
        )
        .join('')}
    </div>`,
    )
    .join('');

  aside.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo-icon">М</div>
      <span class="sidebar-logo-text">Матизы</span>
    </div>
    ${sectionsHtml}
    <div class="sidebar-spacer"></div>
    <div class="sidebar-user">
      <div class="sidebar-avatar">${_esc(initial)}</div>
      <span class="sidebar-user-name">${_esc(firstName || 'Азамат')}</span>
    </div>
  `;

  document.body.insertBefore(aside, document.body.firstChild);

  aside.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.screen;
      if (id) showScreen(id);
    });
  });

  const active =
    currentScreen() ||
    document.querySelector('#app-content .screen--active')?.id ||
    null;
  if (active) updateSidebarActive(active);
}

/**
 * @param {string} screenId
 */
export function updateSidebarActive(screenId) {
  document.querySelectorAll('#sidebar .sidebar-item').forEach(el => {
    el.classList.toggle('sidebar-item--active', el.dataset.screen === screenId);
  });
}

export function removeSidebar() {
  document.getElementById('sidebar')?.remove();
}
