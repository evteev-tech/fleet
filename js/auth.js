/**
 * auth.js — авторизация по PIN.
 *
 * Пользователи хранятся в Google Таблице, лист «Пользователи».
 * Аутентификация: ввод PIN → поиск совпадения в таблице → сохранение сессии.
 */

import { getUsers } from './api.js';
import { showScreen, renderNavbar } from './router.js?v=5';
import { showToast } from './ui.js';
import { ROLES } from './config.js';

const LS_KEY = 'matizi_user';

// ═══════════════════════════════════════════════════════════════════════════
// СЕССИЯ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Читает текущего пользователя из localStorage.
 * @returns {{ name: string, role: string, email: string } | null}
 */
export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user?.email || !user?.role) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Сохраняет пользователя в localStorage.
 * @param {{ name: string, role: string, email: string }} user
 */
export function setCurrentUser(user) {
  localStorage.setItem(LS_KEY, JSON.stringify({
    name:  user.name,
    role:  user.role,
    email: user.email,
  }));
}

/**
 * Удаляет сессию и возвращает на экран логина.
 */
export function clearCurrentUser() {
  localStorage.removeItem(LS_KEY);
  document.getElementById('navbar')?.classList.add('hidden');
  showScreen('screen-login');
}

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ — вызывается при загрузке страницы
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяет сессию и направляет на нужный экран.
 * При наличии сессии сразу рендерит navbar и переходит.
 * При отсутствии — показывает экран логина и инициализирует PIN-ввод.
 */
export function initAuth() {
  const user = getCurrentUser();

  if (user) {
    void renderNavbar(user.role).then(() => _goHome(user.role));
  } else {
    showScreen('screen-login');
    handlePinInput();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN-ВВОД
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Инициализирует PIN-клавиатуру и управляет состоянием ввода.
 * Клавиатура рендерится динамически в ***REMOVED***pinKeyboard.
 */
export function handlePinInput() {
  const keyboard = document.getElementById('pinKeyboard');
  const dotsEl   = document.getElementById('pinDots');
  if (!keyboard || !dotsEl) return;

  let digits = [];

  // ── Рендер клавиатуры ────────────────────────────────────────────────────
  keyboard.innerHTML = [1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => {
    if (k === '') {
      return `<div class="pin-key pin-key--empty"></div>`;
    }
    if (k === '⌫') {
      return `
        <button class="pin-key pin-key--del" data-del="1" aria-label="Удалить">
          <svg width="24" height="18" viewBox="0 0 24 18" fill="none">
            <path d="M9 1H21C21.5523 1 22 1.44772 22 2V16C22 16.5523 21.5523 17 21 17H9L2 9L9 1Z"
              stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M15 6L11 12M11 6L15 12"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>`;
    }
    return `<button class="pin-key" data-digit="${k}">${k}</button>`;
  }).join('');

  // ── Обработчик нажатий ───────────────────────────────────────────────────
  keyboard.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.del) {
      digits.pop();
      _updateDots(dotsEl, digits);
      return;
    }

    const d = btn.dataset.digit;
    if (d === undefined || digits.length >= 4) return;

    digits.push(d);
    _updateDots(dotsEl, digits);

    if (digits.length === 4) {
      const pin = digits.join('');
      digits = [];
      tryLogin(pin, dotsEl, keyboard);
    }
  });
}

// ─── Обновление индикаторов ──────────────────────────────────────────────────
function _updateDots(dotsEl, digits, state = 'normal') {
  dotsEl.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('pin-dot--filled', state === 'normal' && i < digits.length);
    dot.classList.toggle('pin-dot--loading', state === 'loading');
    dot.classList.toggle('pin-dot--error',   state === 'error');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОПЫТКА ВХОДА
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяет PIN по таблице пользователей.
 * @param {string} pin
 * @param {HTMLElement} dotsEl
 * @param {HTMLElement} keyboard
 */
async function tryLogin(pin, dotsEl, keyboard) {
  // Состояние загрузки
  _setKeyboardDisabled(keyboard, true);
  _updateDots(dotsEl, [], 'loading');

  try {
    const users = await getUsers();
    const user  = users.find(u =>
      u.pin === pin && u.status.toLowerCase() === 'активный'
    );

    if (user) {
      setCurrentUser({ name: user.name, role: user.role, email: user.email });
      await renderNavbar(user.role);
      _goHome(user.role);
    } else {
      _showError(dotsEl, keyboard);
    }

  } catch (err) {
    _setKeyboardDisabled(keyboard, false);
    _updateDots(dotsEl, [], 'normal');

    if (err.message === 'NO_CONNECTION') {
      showToast('Нет соединения', 'error');
    } else {
      showToast('Ошибка авторизации', 'error');
    }
  }
}

// ─── Анимация ошибки ────────────────────────────────────────────────────────
function _showError(dotsEl, keyboard) {
  _updateDots(dotsEl, [], 'error');
  dotsEl.classList.add('pin-dots--shake');

  setTimeout(() => {
    dotsEl.classList.remove('pin-dots--shake');
    _updateDots(dotsEl, [], 'normal');
    _setKeyboardDisabled(keyboard, false);
  }, 600);
}

// ─── Блокировка клавиатуры ──────────────────────────────────────────────────
function _setKeyboardDisabled(keyboard, disabled) {
  keyboard.querySelectorAll('button').forEach(b => {
    b.disabled = disabled;
  });
}

// ─── Роутинг после логина ───────────────────────────────────────────────────
function _goHome(role) {
  if (role === ROLES.MECHANIC) {
    showScreen('screen-home');
  } else {
    showScreen('screen-dashboard');
  }
}
