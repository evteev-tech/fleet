/**
 * app.js — точка входа.
 * Инициализирует авторизацию и все экраны приложения.
 */

import { initRouter, showScreen, renderNavbar }
  from './router.js?v=7';

import { initAuth, getCurrentUser, clearCurrentUser } from './auth.js';

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

// ─── Старт ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Инициализируем все экраны (подписывают свои слушатели событий)
  initHome();
  initDashboard();
  initIncome();
  initExpense();
  initAdd();
  initHistory();
  initAnalytics();
  initFleet();
  initDrivers();
  initDriver();
  initSettings();

  // Проверяем сессию и показываем нужный экран
  initAuth();
});

// ─── Экспортируем clearCurrentUser для кнопки выхода (settings.js) ──────────
export { clearCurrentUser };
