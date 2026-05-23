/**
 * app.js — точка входа.
 * Инициализирует авторизацию и все экраны приложения.
 */

import { registerServiceWorker, monitorNetworkStatus } from './register-sw.js';
import { currentScreen } from './router.js';

import { initAuth, getCurrentUser, clearCurrentUser } from './auth.js';
import { renderSidebar, updateSidebarActive, removeSidebar } from './sidebar.js';

// Экраны
import { initHome }      from './screens/home.js';
import { initDashboard } from './screens/dashboard.js';
import { initSvodka }    from './screens/svodka.js';
import { initAdd }       from './screens/add.js';
import { initHistory }   from './screens/history.js';
import { initFleet }     from './screens/fleet.js';
import { initDrivers }   from './screens/drivers.js';
import { initDriver }    from './screens/driver.js';
import { initCar }       from './screens/car.js';
import { initSettings }  from './screens/settings.js';
import { initAnalytics } from './screens/analytics.js';
import { initIncome } from './screens/income.js';
import { initExpense } from './screens/expense.js';
import { initTransfer } from './screens/transfer.js';

registerServiceWorker();
monitorNetworkStatus();

// ─── Старт ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Инициализируем все экраны (подписывают свои слушатели событий)
  initHome();
  initDashboard();
  initSvodka();
  initIncome();
  initExpense();
  initTransfer();
  initAdd();
  initHistory();
  initAnalytics();
  initFleet();
  initDrivers();
  initDriver();
  initCar();
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
  let _lastBreakpoint = window.innerWidth >= 1024 ? 'desktop' : 'mobile';

  window.addEventListener('resize', () => {
    clearTimeout(_desktopResizeTimer);
    _desktopResizeTimer = setTimeout(() => {
      const user = getCurrentUser();
      const w = typeof window !== 'undefined' ? window.innerWidth : 0;
      if (!user) return;

      const breakpoint = w >= 1024 ? 'desktop' : 'mobile';
      const crossed = breakpoint !== _lastBreakpoint;
      _lastBreakpoint = breakpoint;

      const navbar = document.getElementById('navbar');

      if (breakpoint === 'desktop') {
        // Скрыть navbar при переходе на десктоп
        if (crossed && navbar) navbar.classList.add('hidden');

        if (!document.getElementById('sidebar')) {
          renderSidebar(user.role);
        }
        const sid =
          currentScreen() ||
          document.querySelector('#app-content .screen--active')?.id ||
          '';
        if (sid) updateSidebarActive(sid);
      } else {
        // Показать navbar при переходе на мобиле
        removeSidebar();
        if (crossed && navbar) {
          const currentSid =
            currentScreen() ||
            document.querySelector('#app-content .screen--active')?.id ||
            '';
          // Показываем navbar только не на экране логина и аналитики
          if (currentSid && currentSid !== 'screen-login' && currentSid !== 'screen-analytics') {
            navbar.classList.remove('hidden');
          }
        }
      }
    }, 150);
  });

  // Проверяем сессию и показываем нужный экран
  initAuth();
});

// ─── Экспортируем clearCurrentUser для кнопки выхода (settings.js) ──────────
export { clearCurrentUser };
