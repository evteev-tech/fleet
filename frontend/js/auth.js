/**
 * auth.js — авторизация по PIN через REST API (POST /api/login-pin).
 *
 * Вход: пользователь вводит 4-значный PIN → запрос к бэкенду →
 * сервер возвращает JWT + данные пользователя → сохраняем токен и сессию.
 */

import { clearAllCache } from './cache.js';
import { showScreen, renderNavbar } from './router.js';
import { showToast } from './ui.js';
import { ROLES, API_BASE, LS_TOKEN } from './config.js';

const LS_KEY = 'matizi_user';

// ═══════════════════════════════════════════════════════════════════════════
// ТОКЕН (JWT) — используется api.js для Bearer-авторизации
// ═══════════════════════════════════════════════════════════════════════════

/** @returns {string|null} */
export function getToken() {
  return localStorage.getItem(LS_TOKEN);
}

/** @param {string} token */
export function setToken(token) {
  localStorage.setItem(LS_TOKEN, token);
}

export function clearToken() {
  localStorage.removeItem(LS_TOKEN);
}

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
    if (user?.role == null || user.role === '') return null;
    return {
      name: user.name,
      email: user.email ?? '',
      role: String(user.role).trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Сохраняет пользователя в localStorage.
 * @param {{ name: string, role: string, email?: string }} user
 */
export function setCurrentUser(user) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      name: user.name,
      role: String(user.role ?? '').trim().toLowerCase(),
      email: user.email ?? '',
    }),
  );
}

/**
 * Удаляет сессию и токен, возвращает на экран логина.
 */
export function clearCurrentUser() {
  clearAllCache();
  clearToken();
  localStorage.removeItem(LS_KEY);
  document.getElementById('navbar')?.classList.add('hidden');
  showScreen('screen-login');
}

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ — вызывается при загрузке страницы
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяет сессию и направляет на нужный экран.
 * Сессия валидна только при наличии И токена, И сохранённого пользователя.
 */
export function initAuth() {
  const user = getCurrentUser();
  const token = getToken();

  if (user && token) {
    void renderNavbar(user.role).then(() => _goHome(user.role));
  } else {
    // частичная сессия (без токена) — чистим, чтобы не залипнуть
    if (user || token) {
      clearToken();
      localStorage.removeItem(LS_KEY);
    }
    showScreen('screen-login');
    handlePinInput();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN-ВВОД
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Инициализирует PIN-клавиатуру и управляет состоянием ввода.
 */
export function handlePinInput() {
  const keyboard = document.getElementById('pinKeyboard');
  const dotsEl   = document.getElementById('pinDots');
  if (!keyboard || !dotsEl) return;

  let digits = [];

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

function _updateDots(dotsEl, digits, state = 'normal') {
  dotsEl.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('pin-dot--filled', state === 'normal' && i < digits.length);
    dot.classList.toggle('pin-dot--loading', state === 'loading');
    dot.classList.toggle('pin-dot--error',   state === 'error');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОПЫТКА ВХОДА — через POST /api/login-pin
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Отправляет PIN на бэкенд, при успехе сохраняет токен и сессию.
 * @param {string} pin
 * @param {HTMLElement} dotsEl
 * @param {HTMLElement} keyboard
 */
async function tryLogin(pin, dotsEl, keyboard) {
  _setKeyboardDisabled(keyboard, true);
  _updateDots(dotsEl, [], 'loading');

  let res;
  try {
    res = await fetch(`${API_BASE}/login-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
  } catch {
    _setKeyboardDisabled(keyboard, false);
    _updateDots(dotsEl, [], 'normal');
    showToast('Нет соединения', 'error');
    return;
  }

  let body;
  try {
    body = await res.json();
  } catch {
    _setKeyboardDisabled(keyboard, false);
    _updateDots(dotsEl, [], 'normal');
    showToast('Ошибка авторизации', 'error');
    return;
  }

  if (res.ok && body?.status === 'ok' && body?.token && body?.user) {
    setToken(body.token);
    setCurrentUser({
      name: body.user.name,
      role: body.user.role,
      email: body.user.email,
    });
    await renderNavbar(String(body.user.role).trim().toLowerCase());
    _goHome(body.user.role);
  } else {
    // неверный PIN или иная ошибка авторизации
    _showError(dotsEl, keyboard);
  }
}

function _showError(dotsEl, keyboard) {
  _updateDots(dotsEl, [], 'error');
  dotsEl.classList.add('pin-dots--shake');

  setTimeout(() => {
    dotsEl.classList.remove('pin-dots--shake');
    _updateDots(dotsEl, [], 'normal');
    _setKeyboardDisabled(keyboard, false);
  }, 600);
}

function _setKeyboardDisabled(keyboard, disabled) {
  keyboard.querySelectorAll('button').forEach(b => {
    b.disabled = disabled;
  });
}

function _goHome(role) {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === ROLES.MECHANIC || r === ROLES.OPERATIONS) {
    showScreen('screen-home');
  } else {
    showScreen('screen-dashboard');
  }
}
