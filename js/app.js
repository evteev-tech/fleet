/**
 * app.js — точка входа.
 * Инициализирует авторизацию и все экраны приложения.
 */

import { initAuth, getCurrentUser, clearCurrentUser } from './auth.js?v=navbar-icons-2';

// Экраны
import { initHome }      from './screens/home.js?v=navbar-icons-2';
import { initDashboard } from './screens/dashboard.js?v=navbar-icons-2';
import { initAdd }       from './screens/add.js?v=navbar-icons-2';
import { initHistory }   from './screens/history.js?v=navbar-icons-2';
import { initFleet }     from './screens/fleet.js?v=navbar-icons-2';
import { initDrivers }   from './screens/drivers.js?v=navbar-icons-2';
import { initDriver }    from './screens/driver.js?v=navbar-icons-2';
import { initSettings }  from './screens/settings.js?v=navbar-icons-2';

// ─── Старт ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Инициализируем все экраны (подписывают свои слушатели событий)
  initHome();
  initDashboard();
  initAdd();
  initHistory();
  initFleet();
  initDrivers();
  initDriver();
  initSettings();

  // Проверяем сессию и показываем нужный экран
  initAuth();
});

// ─── Экспортируем clearCurrentUser для кнопки выхода (settings.js) ──────────
export { clearCurrentUser };
