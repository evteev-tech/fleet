/**
 * ui.js — переиспользуемые UI-функции:
 * toast, skeleton, bottomsheet, форматирование.
 */

// ─── TOAST ────────────────────────────────────────────────────────────────────

const TOAST_COLORS = {
  success: { bg: 'var(--color-green)',    text: '***REMOVED***fff' },
  error:   { bg: 'var(--color-red)',      text: '***REMOVED***fff' },
  warning: { bg: '***REMOVED***F5A623',              text: '***REMOVED***fff' },
  info:    { bg: 'var(--color-dark)',     text: '***REMOVED***fff' },
  default: { bg: 'var(--color-dark)',     text: '***REMOVED***fff' },
};

const TOAST_ICONS = {
  success: '✓', error: '✕', warning: '⚠', info: 'ℹ', default: '',
};

/**
 * Показывает уведомление внизу экрана.
 * Каждый toast создаётся динамически, удаляется из DOM после скрытия.
 * @param {string} message
 * @param {'default'|'success'|'error'|'warning'|'info'} type
 * @param {number} duration мс
 */
export function showToast(message, type = 'default', duration = 3000) {
  const { bg, text } = TOAST_COLORS[type] ?? TOAST_COLORS.default;
  const icon         = TOAST_ICONS[type] ?? '';

  const el = document.createElement('div');
  el.className = 'toast-dynamic';
  el.style.cssText = `
    position:fixed; bottom:88px; left:50%; transform:translateX(-50%) translateY(20px);
    background:${bg}; color:${text};
    padding:10px 18px; border-radius:24px;
    font-size:14px; font-weight:600;
    display:flex; align-items:center; gap:6px;
    white-space:nowrap; max-width:calc(100vw - 40px);
    box-shadow:0 4px 16px rgba(0,0,0,.18);
    z-index:9999; opacity:0;
    transition:opacity 200ms ease, transform 200ms ease;
    pointer-events:none;
  `;
  if (icon) {
    const ico = document.createElement('span');
    ico.textContent = icon;
    el.appendChild(ico);
  }
  const txt = document.createElement('span');
  txt.textContent = message;
  el.appendChild(txt);

  document.body.appendChild(el);

  // Появление
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // Исчезновение + удаление из DOM
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

// ─── SKELETON ─────────────────────────────────────────────────────────────────

/**
 * Вставляет skeleton-заглушки в контейнер.
 * @param {HTMLElement} container
 * @param {number} count — количество карточек
 */
export function showSkeleton(container, count = 3) {
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-line skeleton-line--lg" style="width:55%"></div>
      <div class="skeleton skeleton-line" style="width:80%"></div>
      <div class="skeleton skeleton-line skeleton-line--sm" style="width:40%"></div>
    </div>
  `).join('');
}

/**
 * Убирает все .skeleton-card из контейнера.
 * @param {HTMLElement} container
 */
export function hideSkeleton(container) {
  container.querySelectorAll('.skeleton-card').forEach(el => el.remove());
}

// ─── BOTTOMSHEET ──────────────────────────────────────────────────────────────

const _bs       = () => document.getElementById('bottomsheet');
const _bsOverlay = () => document.getElementById('bs-overlay');
const _bsContent = () => document.getElementById('bs-content');

/**
 * Открывает bottomsheet с произвольным HTML.
 * Поддерживает закрытие: клик на overlay, свайп вниз > 80px, Escape.
 * @param {string} html
 * @param {{ onClose?: Function }} opts
 */
export function showBottomSheet(html, opts = {}) {
  const bs      = _bs();
  const overlay = _bsOverlay();
  const content = _bsContent();
  if (!bs || !overlay) return;

  content.innerHTML = html;
  document.body.style.overflow = 'hidden';

  bs.classList.remove('hidden');
  overlay.classList.remove('hidden');

  // Принудительный reflow перед добавлением класса для CSS transition
  bs.offsetHeight;
  bs.classList.add('open');
  overlay.classList.add('visible');

  const close = () => hideBottomSheet(opts.onClose);

  overlay.addEventListener('click', close, { once: true });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
  });

  // ── Свайп вниз для закрытия ──────────────────────────────────────────────
  let _startY = null;
  function onTouchStart(e) { _startY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (_startY === null) return;
    const dy = e.touches[0].clientY - _startY;
    if (dy > 0) bs.style.transform = `translateY(${dy}px)`;
  }
  function onTouchEnd(e) {
    if (_startY === null) return;
    const dy = e.changedTouches[0].clientY - _startY;
    bs.style.transform = '';
    _startY = null;
    if (dy > 80) {
      bs.removeEventListener('touchstart', onTouchStart);
      bs.removeEventListener('touchmove',  onTouchMove);
      bs.removeEventListener('touchend',   onTouchEnd);
      close();
    }
  }
  bs.addEventListener('touchstart', onTouchStart, { passive: true });
  bs.addEventListener('touchmove',  onTouchMove,  { passive: true });
  bs.addEventListener('touchend',   onTouchEnd,   { passive: true });
}

/**
 * Закрывает bottomsheet.
 * @param {Function} [callback]
 */
export function hideBottomSheet(callback) {
  const bs      = _bs();
  const overlay = _bsOverlay();
  if (!bs) return;

  bs.classList.remove('open');
  overlay.classList.remove('visible');

  setTimeout(() => {
    bs.classList.add('hidden');
    overlay.classList.add('hidden');
    _bsContent().innerHTML = '';
    document.body.style.overflow = '';
    document.dispatchEvent(new CustomEvent('bottomsheet:closed'));
    callback?.();
  }, 260);
}

/** Псевдоним hideBottomSheet для удобства. */
export const closeBottomSheet = hideBottomSheet;

// ─── ДИАЛОГ ПОДТВЕРЖДЕНИЯ ─────────────────────────────────────────────────────

/**
 * Показывает bottomsheet с подтверждением.
 * @param {{ title: string, message: string, confirmLabel?: string, danger?: boolean }}
 * @returns {Promise<boolean>}
 */
export function showConfirm({ title, message, confirmLabel = 'Подтвердить', danger = false }) {
  return new Promise(resolve => {
    const html = `
      <p class="bottomsheet-title">${title}</p>
      <p style="font-size:14px;color:var(--color-muted);margin-bottom:20px">${message}</p>
      <button class="btn-primary ${danger ? 'btn-danger' : ''}" id="bs-confirm-ok">${confirmLabel}</button>
      <button class="btn-secondary" id="bs-confirm-cancel" style="margin-top:8px">Отмена</button>
    `;
    showBottomSheet(html, {
      onClose: () => resolve(false),
    });
    setTimeout(() => {
      document.getElementById('bs-confirm-ok')?.addEventListener('click', () => {
        hideBottomSheet(() => resolve(true));
      }, { once: true });
      document.getElementById('bs-confirm-cancel')?.addEventListener('click', () => {
        hideBottomSheet(() => resolve(false));
      }, { once: true });
    }, 0);
  });
}

// ─── ФОРМАТИРОВАНИЕ ───────────────────────────────────────────────────────────

/**
 * Форматирует число как денежную сумму: «12 500 ₸»
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatMoney(amount, currency = '₸') {
  return `${Math.abs(amount).toLocaleString('ru-RU')} ${currency}`;
}

/**
 * Форматирует дату из строки «DD.MM.YYYY» или timestamp в «15 марта».
 * @param {string|number} raw
 * @returns {string}
 */
export function formatDate(raw) {
  if (!raw) return '';
  let date;
  if (typeof raw === 'string' && raw.includes('.')) {
    const [d, m, y] = raw.split('.');
    date = new Date(+y, +m - 1, +d);
  } else {
    date = new Date(raw);
  }
  if (isNaN(date)) return raw.toString();
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/**
 * Группирует массив операций по дате.
 * @param {Array} ops
 * @returns {Map<string, Array>}  ключ — дата в исходном формате
 */
export function groupByDate(ops) {
  const map = new Map();
  for (const op of ops) {
    const key = op.date || 'Без даты';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(op);
  }
  return map;
}

/**
 * Возвращает иконку и pill-класс для типа операции.
 * @param {string} type
 * @returns {{ icon: string, pillClass: string, sign: string }}
 */
export function opTypeMeta(type) {
  const map = {
    income:   { icon: '↑', pillClass: 'pill--green',  sign: '+' },
    expense:  { icon: '↓', pillClass: 'pill--red',    sign: '−' },
    transfer: { icon: '⇄', pillClass: 'pill--blue',   sign: ''  },
    repair:   { icon: '🔧', pillClass: 'pill--orange', sign: '−' },
    fine:     { icon: '📋', pillClass: 'pill--red',    sign: '−' },
    salary:   { icon: '💳', pillClass: 'pill--blue',   sign: '−' },
  };
  return map[type] ?? { icon: '·', pillClass: 'pill--muted', sign: '' };
}

/**
 * Возвращает инициалы из имени (макс. 2 буквы).
 * @param {string} name
 * @returns {string}
 */
export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

// ─── ХЕЛПЕР: пустое состояние ────────────────────────────────────────────────

/**
 * Возвращает HTML пустого состояния.
 * @param {{ icon?: string, text: string, sub?: string }} opts
 */
export function emptyStateHTML({ icon = '📭', text, sub = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">${icon}</div>
      <div class="empty-state__text">${text}</div>
      ${sub ? `<div class="empty-state__sub">${sub}</div>` : ''}
    </div>
  `;
}
