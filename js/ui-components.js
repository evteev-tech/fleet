/**
 * ui-components.js — переиспользуемые UI-компоненты.
 *
 * Все функции возвращают HTML-строку.
 * Никакой логики/привязки событий внутри — компоненты только рендерят.
 * События навешивает вызывающий код через делегирование или querySelector.
 */

// ─── ICONS ────────────────────────────────────────────────────────────────────

const ICON_BACK = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ─── APP HEADER ───────────────────────────────────────────────────────────────

/**
 * Универсальный хедер экрана.
 *
 * @param {object} opts
 * @param {string} opts.title              Заголовок в центре.
 * @param {string} [opts.subtitle]         Подзаголовок справа (счётчик, статус и т.п.).
 * @param {'dark'|'light'} [opts.variant='dark']  Тема: тёмный фон или светлый.
 * @param {object} [opts.back]             Кнопка «назад» слева. Если не задана — спейсер.
 * @param {string} opts.back.id            id кнопки (чтобы навесить onclick).
 * @param {string} [opts.back.label]       aria-label, по умолчанию "Назад".
 * @param {string} [opts.rightHtml]        Произвольный HTML справа (кнопка «+ Добавить» и т.п.).
 *                                          Если не задан и нет subtitle — спейсер 44px.
 * @returns {string}
 */
export function renderAppHeader({
  title,
  subtitle = '',
  variant = 'dark',
  back = null,
  rightHtml = '',
} = {}) {
  const leftHtml = back
    ? `<button type="button" class="app-header__btn" id="${back.id}" aria-label="${back.label ?? 'Назад'}">${ICON_BACK}</button>`
    : `<div class="app-header__spacer"></div>`;

  const rightContentHtml = rightHtml
    || (subtitle ? `<span class="app-header__subtitle">${subtitle}</span>` : `<div class="app-header__spacer"></div>`);

  return `
    <header class="app-header app-header--${variant}">
      ${leftHtml}
      <div class="app-header__center">
        <span class="app-header__title">${title}</span>
      </div>
      ${rightContentHtml}
    </header>
  `;
}