/**
 * driver.js — карточка водителя.
 *
 * Открывается через showScreen('screen-driver') + событие driver:open.
 * Отображает профиль водителя, текущий депозит, историю пополнений,
 * кнопки «Редактировать» и «В архив».
 */

import { getDrivers, getFleet, getDeposits, postAction, invalidateCache } from '../api.js';
import { showScreen }                                                       from '../router.js?v=6';
import { showToast }                                                        from '../ui.js';
import { openDriverForm }                                                   from './drivers.js';

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

let _currentDriverId = null;

export function initDriver() {
  // Принимаем id от drivers.js
  document.addEventListener('driver:open', e => {
    _currentDriverId = e.detail?.driverId ?? null;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-driver') renderDriver(_currentDriverId);
  });

  // Кнопка «← назад» в статическом хедере
  document.getElementById('driver-back')?.addEventListener('click', () => {
    showScreen('screen-drivers');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export async function renderDriver(driverId) {
  const body   = document.getElementById('driver-body');
  const nameEl = document.getElementById('driver-header-name');
  if (!body) return;

  body.innerHTML = _skeletonHTML();
  if (nameEl) nameEl.textContent = 'Водитель';

  if (!driverId) {
    body.innerHTML = _errorHTML('Водитель не найден');
    return;
  }

  let drivers, fleet, deposits;
  try {
    [drivers, fleet, deposits] = await Promise.all([getDrivers(), getFleet(), getDeposits()]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('driver-retry')?.addEventListener('click', () => renderDriver(driverId));
    return;
  }

  const driver = drivers.find(d => String(d.driverId) === String(driverId));
  if (!driver) {
    body.innerHTML = _errorHTML('Водитель не найден');
    return;
  }

  if (nameEl) nameEl.textContent = driver.fio || 'Водитель';

  const car          = fleet.find(c => c.carId === driver.carId);
  const driverDeps   = deposits
    .filter(dep => String(dep.driverId) === String(driverId))
    .sort((a, b) => _parseDate(b.date) - _parseDate(a.date));
  const currentDeposit = driverDeps.reduce((s, d) => s + (d.amount || 0), 0);

  body.innerHTML = `

    <!-- Основные данные -->
    <div class="drv-profile-card">
      <div class="drv-profile-avatar">${_initials(driver.fio)}</div>
      <div class="drv-profile-name">${_esc(driver.fio)}</div>

      ${driver.phone ? `
        <a class="drv-profile-phone" href="tel:${_cleanPhone(driver.phone)}">
          ${_esc(driver.phone)}
        </a>
      ` : ''}

      <div class="drv-profile-meta">
        ${car ? `<div class="drv-meta-row">
          <span class="drv-meta-lbl">Машина</span>
          <span class="drv-meta-val">${car.carId}${car.name ? ' · ' + car.name : ''}</span>
        </div>` : ''}
        ${driver.hired ? `<div class="drv-meta-row">
          <span class="drv-meta-lbl">Дата начала</span>
          <span class="drv-meta-val">${driver.hired}</span>
        </div>` : ''}
        ${driver.note ? `<div class="drv-meta-row">
          <span class="drv-meta-lbl">Комментарий</span>
          <span class="drv-meta-val">${_esc(driver.note)}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Депозит -->
    <div class="fleet-card" style="margin:0 0 12px">
      <div class="drv-deposit-row">
        <span class="drv-deposit-label">Текущий депозит</span>
        <span class="drv-deposit-amount">${_fmt(currentDeposit)}</span>
      </div>

      ${driverDeps.length ? `
        <div class="drv-dep-history">
          ${driverDeps.map(dep => `
            <div class="drv-dep-row">
              <span class="drv-dep-date">${dep.date || '—'}</span>
              <span class="drv-dep-type ${dep.amount >= 0 ? 'drv-dep--income' : 'drv-dep--return'}">
                ${dep.amount >= 0 ? 'Поступление' : 'Возврат'}
              </span>
              <span class="drv-dep-sum">${_fmt(dep.amount)}</span>
            </div>
          `).join('')}
        </div>
      ` : '<div class="drv-dep-empty">Движений по депозиту нет</div>'}
    </div>

    <!-- Кнопки -->
    <div class="drv-actions">
      <button class="btn-primary btn-primary--outline" id="driver-edit">Редактировать</button>
      <button class="btn-danger" id="driver-archive">В архив</button>
    </div>
  `;

  // Редактировать
  document.getElementById('driver-edit')?.addEventListener('click', async () => {
    let fl, drv;
    try { [drv, fl] = await Promise.all([getDrivers(), getFleet()]); }
    catch { showToast('Ошибка загрузки', 'error'); return; }
    const fresh = drv.find(d => String(d.driverId) === String(driverId));
    openDriverForm(fresh ?? driver, fl, drv);
    // После закрытия bottomsheet — перерендер
    document.addEventListener('bottomsheet:closed', () => renderDriver(driverId), { once: true });
  });

  // В архив
  document.getElementById('driver-archive')?.addEventListener('click', async () => {
    if (!confirm('Перевести водителя в архив?')) return;
    const btn = document.getElementById('driver-archive');
    if (btn) { btn.disabled = true; btn.textContent = 'Архивирую…'; }
    try {
      await postAction('SAVE_DRIVER', {
        driver_id: driver.driverId,
        fio:       driver.fio,
        phone:     driver.phone ?? '',
        vu:        '',
        car_id:    driver.carId ?? '',
        status:    'архив',
        comment:   driver.note ?? '',
      });
      invalidateCache('Водители');
      showToast('Водитель архивирован', 'success');
      showScreen('screen-drivers');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'В архив'; }
      showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка архивации', 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

function _skeletonHTML() {
  const ln = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:8px"></div>`;
  return `
    <div class="drv-profile-card" style="pointer-events:none">
      <div class="skeleton drv-profile-avatar"></div>
      <div style="align-self:stretch">${ln(60)}${ln(40)}${ln(50)}</div>
    </div>
    <div class="fleet-card" style="margin:0 0 12px">
      ${ln(70)}${ln(50)}${ln(60)}${ln(45)}
    </div>
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline" style="padding-top:80px">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <button class="btn-primary" id="driver-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _errorHTML(msg) {
  return `<div class="home-offline" style="padding-top:80px">
    <div class="home-offline__icon">⚠️</div>
    <div class="home-offline__text">${msg}</div>
  </div>`;
}

function _fmt(n)        { return `${Math.round(n).toLocaleString('ru-RU')} ₽`; }
function _esc(s)        { return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _initials(fio) { return (fio ?? '?').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join(''); }
function _cleanPhone(p) { return (p ?? '').replace(/[^\d+]/g, ''); }
function _parseDate(s)  {
  if (!s) return 0;
  const [d, m, y] = String(s).split('.');
  if (y) return new Date(+y, +m - 1, +d).getTime();
  return new Date(s).getTime() || 0;
}
