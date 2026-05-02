/**
 * settings.js — настройки приложения.
 *
 * Секция «Интеграция»: статус подключения к Таблице, редактирование Webhook URL.
 * Секция «Аккаунт»: имя, роль, выход.
 */

import { getCurrentUser, clearCurrentUser } from '../auth.js';
import { getApiStatus }                      from '../api.js';
import { showScreen }                        from '../router.js?v=3';
import { showToast, showBottomSheet, hideBottomSheet } from '../ui.js';
import { WEBHOOK_URL, ROLES }                from '../config.js';

const LS_WEBHOOK = 'matizi_webhook';

const ROLE_LABELS = {
  [ROLES.MECHANIC]:   'Механик',
  [ROLES.OPERATIONS]: 'Операции',
  [ROLES.INVESTOR]:   'Инвестор',
};

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initSettings() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-settings') renderSettings();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕНДЕР
// ═══════════════════════════════════════════════════════════════════════════

function renderSettings() {
  const body = document.getElementById('settings-body');
  if (!body) return;

  const user = getCurrentUser();
  if (!user) return;

  const initials = user.name.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('');

  const apiStatus = getApiStatus();
  const statusHTML = apiStatus === 'ok'
    ? `<span style="color:var(--color-green);font-weight:700;font-size:13px">подключена</span>`
    : apiStatus === 'error'
      ? `<span style="color:var(--color-red);font-weight:700;font-size:13px">ошибка</span>`
      : `<span style="color:var(--color-muted);font-size:13px">—</span>`;

  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  body.innerHTML = `
    <!-- ── Хедер ── -->
    <div class="drvs-hdr" style="padding-bottom:var(--space-md)">
      <span class="app-logo" style="color:var(--color-dark)">Настройки</span>
    </div>

    <!-- ── Секция: Интеграция ── -->
    <div class="settings-section">
      <div class="settings-section__title">Интеграция</div>

      <div class="settings-row">
        <div class="settings-row__icon" style="background:var(--color-green-bg)">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="3" width="16" height="12" rx="2" stroke="var(--color-green)" stroke-width="1.6"/>
            <path d="M1 7H17" stroke="var(--color-green)" stroke-width="1.6"/>
          </svg>
        </div>
        <div class="settings-row__body">
          <div class="settings-row__label">Google Таблица</div>
        </div>
        ${statusHTML}
      </div>

      <div class="settings-row" id="set-webhook">
        <div class="settings-row__icon" style="background:var(--color-blue-bg)">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9H15M10 4L15 9L10 14" stroke="***REMOVED***4A90E2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="settings-row__body">
          <div class="settings-row__label">Webhook URL</div>
          <div class="settings-row__sub" id="set-webhook-sub">${_webhookPreview()}</div>
        </div>
        <span class="settings-row__arrow">›</span>
      </div>
    </div>

    <!-- ── Секция: Аккаунт ── -->
    <div class="settings-section">
      <div class="settings-section__title">Аккаунт</div>

      <div class="settings-row settings-row--profile">
        <div class="drv-avatar" style="background:var(--color-yellow);width:44px;height:44px;font-size:17px">
          ${initials}
        </div>
        <div class="settings-row__body">
          <div class="settings-row__label">${_esc(user.name)}</div>
          <div class="settings-row__sub">${_esc(user.email)}</div>
        </div>
        <span class="pill pill--green" style="flex-shrink:0">${roleLabel}</span>
      </div>

      <div class="settings-row settings-row--danger" id="set-logout">
        <div class="settings-row__icon" style="background:var(--color-red-bg)">🚪</div>
        <div class="settings-row__label" style="color:var(--color-red)">Выйти</div>
      </div>
    </div>

    <div class="settings-footer">Матизы v1.0 · Vanilla JS</div>
  `;

  document.getElementById('set-webhook')?.addEventListener('click', _openWebhookSheet);
  document.getElementById('set-logout')?.addEventListener('click',  _logout);
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕДАКТИРОВАНИЕ WEBHOOK URL
// ═══════════════════════════════════════════════════════════════════════════

function _openWebhookSheet() {
  const current = localStorage.getItem(LS_WEBHOOK) || WEBHOOK_URL;

  showBottomSheet(`
    <p class="bottomsheet-title">Webhook URL</p>
    <p style="font-size:13px;color:var(--color-muted);margin-bottom:12px">
      URL веб-приложения Google Apps Script. Переопределяет значение из config.js.
    </p>
    <div class="add-field">
      <label class="add-label">URL</label>
      <input id="set-webhook-input" class="field-input" type="url"
        placeholder="https://script.google.com/…"
        value="${_esc(current)}" />
    </div>
    <button class="btn-primary" id="set-webhook-save" style="margin-top:8px">Сохранить</button>
    <button class="btn-secondary" id="set-webhook-reset" style="margin-top:8px">
      Сбросить к умолчанию
    </button>
  `);

  setTimeout(() => {
    document.getElementById('set-webhook-save')?.addEventListener('click', () => {
      const val = document.getElementById('set-webhook-input')?.value.trim();
      if (!val) return;
      localStorage.setItem(LS_WEBHOOK, val);
      showToast('URL обновлён ✓', 'success');
      hideBottomSheet(() => {
        const sub = document.getElementById('set-webhook-sub');
        if (sub) sub.textContent = _webhookPreview();
      });
    });

    document.getElementById('set-webhook-reset')?.addEventListener('click', () => {
      localStorage.removeItem(LS_WEBHOOK);
      showToast('Восстановлён URL из config.js', 'success');
      hideBottomSheet(() => {
        const sub = document.getElementById('set-webhook-sub');
        if (sub) sub.textContent = _webhookPreview();
      });
    });
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// ВЫХОД
// ═══════════════════════════════════════════════════════════════════════════

function _logout() {
  if (!confirm('Выйти из приложения?')) return;
  clearCurrentUser();
  document.getElementById('navbar')?.classList.add('hidden');
  showScreen('screen-login');
}

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

function _webhookPreview() {
  const url = localStorage.getItem(LS_WEBHOOK) || WEBHOOK_URL;
  return url.length > 40 ? url.slice(0, 38) + '…' : url;
}

function _esc(s) {
  return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
