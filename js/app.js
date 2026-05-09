/**
 * app.js — точка входа.
 * Инициализирует авторизацию и все экраны приложения.
 */

import { currentScreen } from './router.js?v=7';

import { initAuth, getCurrentUser, clearCurrentUser } from './auth.js';
import { renderSidebar, updateSidebarActive, removeSidebar } from './sidebar.js';

// Экраны
import { initHome }      from './screens/home.js';
import { initDashboard } from './screens/dashboard.js';
import { initAdd }       from './screens/add.js';
import { initHistory }   from './screens/history.js';
import { initFleet }     from './screens/fleet.js';
import { initDrivers }   from './screens/drivers.js';
import { initDriver }    from './screens/driver.js';
import { initSettings }  from './screens/settings.js';
import { initAnalytics } from './screens/analytics.js';
import { initIncome } from './screens/income.js';
import { initExpense } from './screens/expense.js';
import { initTransfer } from './screens/transfer.js';

// ─── Старт ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Инициализируем все экраны (подписывают свои слушатели событий)
  initHome();
  initDashboard();
  initIncome();
  initExpense();
  initTransfer();
  initAdd();
  initHistory();
  initAnalytics();
  initFleet();
  initDrivers();
  initDriver();
  initSettings();

  document.addEventListener('screen:activated', e => {
    const screenId = e.detail?.screenId;
    if (screenId === 'screen-login') {
      removeSidebar();
      return;
    }
    const user = getCurrentUser();
    if (user && typeof window !== 'undefined' && window.innerWidth >= 1024) {
      if (!document.getElementById('sidebar')) {
        renderSidebar(user.role);
      }
      updateSidebarActive(screenId);
    }
  });

  let _desktopResizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(_desktopResizeTimer);
    _desktopResizeTimer = setTimeout(() => {
      const user = getCurrentUser();
      const w = typeof window !== 'undefined' ? window.innerWidth : 0;
      if (!user) return;
      if (w >= 1024) {
        if (!document.getElementById('sidebar')) {
          renderSidebar(user.role);
        }
        const sid =
          currentScreen() ||
          document.querySelector('***REMOVED***app-content .screen--active')?.id ||
          '';
        if (sid) updateSidebarActive(sid);
      } else {
        removeSidebar();
      }
    }, 150);
  });

  // Проверяем сессию и показываем нужный экран
  initAuth();
});

// ─── Экспортируем clearCurrentUser для кнопки выхода (settings.js) ──────────
export { clearCurrentUser };
