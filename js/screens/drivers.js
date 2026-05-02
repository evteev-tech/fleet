/**
 * drivers.js — список водителей.
 *
 * Показывает всех кроме статус='архив'.
 * Кнопка «+ Добавить» → bottomsheet с формой.
 * Клик по строке → screen-driver.
 * Итоговая строка: сумма депозитов активных.
 */

import { getDrivers, getFleet, postAction, invalidateCache } from '../api.js';
import { showScreen }                                         from '../router.js?v=3';
import { showBottomSheet, hideBottomSheet, showToast }        from '../ui.js';
import { CAR_STATUSES }                                       from '../config.js';

// ── Конфиг аватаров по статусу ────────────────────────────────────────────────
const AVATAR_BG = {
  'активен':  'var(--color-yellow)',
  'активный': 'var(--color-yellow)',
  'пауза':    'var(--color-blue-bg)',
  'архив':    'var(--color-border)',
};

const STATUS_PILL = {
  'активен':  'pill--green',
  'активный': 'pill--green',
  'пауза':    'pill--blue',
  'архив':    'pill--muted',
};

let _pendingDriverId = null;   // для перехода к конкретному водителю

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initDrivers() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-drivers') renderDrivers();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export async function renderDrivers() {
  const body = document.getElementById('drivers-body');
  if (!body) return;

  body.innerHTML = _skeletonHTML();

  let drivers, fleet;
  try {
    [drivers, fleet] = await Promise.all([getDrivers(), getFleet()]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('drivers-retry')?.addEventListener('click', renderDrivers);
    return;
  }

  // Скрываем архив
  const visible = drivers.filter(d => d.status?.toLowerCase() !== 'архив');
  // Сумма депозитов активных
  const totalDeposit = drivers
    .filter(d => ['активен','активный'].includes(d.status?.toLowerCase()))
    .reduce((s, d) => s + (d.deposit || 0), 0);

  body.innerHTML = `
    <!-- ХЕДЕР -->
    <div class="drvs-hdr">
      <span class="app-logo" style="color:var(--color-dark)">Водители</span>
      <button class="drvs-add-btn" id="drvs-add">
        + Добавить
      </button>
    </div>

    <!-- СПИСОК -->
    ${visible.length ? `
      <div class="fleet-card" id="drvs-list">
        ${visible.map(d => _driverRowHTML(d, fleet)).join('')}
      </div>

      <!-- Итог депозитов -->
      <div class="drvs-total">
        Итого депозитов: <strong>${_fmt(totalDeposit)}</strong>
      </div>
    ` : `
      <div class="empty-state">
        <div class="empty-state__icon">👤</div>
        <div class="empty-state__text">Водителей нет</div>
        <div class="empty-state__sub">Нажмите «+ Добавить»</div>
      </div>
    `}
  `;

  // Клики по строкам
  body.querySelectorAll('[data-driver-id]').forEach(row => {
    row.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('driver:open', {
        detail: { driverId: row.dataset.driverId },
      }));
      showScreen('screen-driver');
    });
  });

  // Кнопка добавить
  document.getElementById('drvs-add')?.addEventListener('click', () => {
    openDriverForm(null, fleet, drivers);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ФОРМА ДОБАВЛЕНИЯ / РЕДАКТИРОВАНИЯ (bottomsheet)
// ═══════════════════════════════════════════════════════════════════════════

export function openDriverForm(driver, fleet, drivers) {
  const isEdit   = !!driver;
  const freeCars = fleet.filter(c => c.status === CAR_STATUSES.IDLE);
  const title    = isEdit ? 'Редактировать водителя' : 'Новый водитель';

  const todayISO = new Date().toISOString().slice(0, 10);

  showBottomSheet(`
    <p class="bottomsheet-title">${title}</p>

    <div class="add-field">
      <label class="add-label">ФИО</label>
      <input id="drv-fio" class="field-input" type="text"
        placeholder="Иванов Иван Иванович" value="${_esc(driver?.fio ?? '')}" />
      <div class="add-field-err hidden" id="err-drv-fio"></div>
    </div>

    <div class="add-field">
      <label class="add-label">Телефон</label>
      <input id="drv-phone" class="field-input" type="tel"
        placeholder="+7 777 000 00 00" value="${_esc(driver?.phone ?? '')}" />
    </div>

    <div class="add-field">
      <label class="add-label">Машина (только свободные)</label>
      <select id="drv-car" class="field-input">
        <option value="">— без машины —</option>
        ${freeCars.map(c => `
          <option value="${c.carId}" ${driver?.carId === c.carId ? 'selected' : ''}>
            ${c.carId}${c.name ? ' · ' + c.name : ''}
          </option>
        `).join('')}
      </select>
    </div>

    <div class="add-field">
      <label class="add-label">Депозит, ₽</label>
      <input id="drv-deposit" class="field-input" type="number"
        inputmode="decimal" placeholder="0" value="${driver?.deposit ?? ''}" />
    </div>

    <div class="add-field">
      <label class="add-label">Дата начала</label>
      <input id="drv-hired" class="field-input" type="date"
        value="${driver?.hired ? _ddmmyyyyToISO(driver.hired) : todayISO}" />
    </div>

    <div class="add-field">
      <label class="add-label">Комментарий</label>
      <textarea id="drv-comment" class="field-input" rows="2"
        placeholder="Необязательно…">${_esc(driver?.note ?? '')}</textarea>
    </div>

    <button class="btn-primary" id="drv-save" style="margin-top:8px">Сохранить</button>
  `);

  setTimeout(() => {
    document.getElementById('drv-save')?.addEventListener('click', () => {
      _saveDriver(driver, fleet, drivers);
    });
  }, 0);
}

// ─── Сохранение ──────────────────────────────────────────────────────────────
async function _saveDriver(existing, fleet, drivers) {
  const fio     = document.getElementById('drv-fio')?.value.trim();
  const phone   = document.getElementById('drv-phone')?.value.trim();
  const carId   = document.getElementById('drv-car')?.value;
  const deposit = parseFloat(document.getElementById('drv-deposit')?.value) || 0;
  const hiredISO = document.getElementById('drv-hired')?.value;
  const note    = document.getElementById('drv-comment')?.value.trim();

  const errFio = document.getElementById('err-drv-fio');
  if (!fio) {
    if (errFio) { errFio.textContent = 'Введите ФИО'; errFio.classList.remove('hidden'); }
    return;
  }
  if (errFio) errFio.classList.add('hidden');

  const btn = document.getElementById('drv-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

  try {
    const res = await postAction('SAVE_DRIVER', {
      driver_id: existing?.driverId ?? '',
      fio, phone,
      vu:      '',
      car_id:  carId,
      status:  existing?.status ?? 'активен',
      comment: note,
    });

    // Если назначена машина — обновляем статус
    if (carId) {
      await postAction('UPDATE_CAR_STATUS', {
        car_id: carId, new_status: CAR_STATUSES.RENT,
      }).catch(() => {});
    }

    // Если указан депозит при создании — добавляем депозит
    if (!existing && deposit > 0) {
      await postAction('ADD_DEPOSIT', {
        driver_id: res.driver_id,
        car_id:    carId,
        amount:    deposit,
        comment:   'Начальный депозит',
      }).catch(() => {});
    }

    invalidateCache('Водители');
    invalidateCache('Машины');
    showToast(existing ? 'Изменения сохранены ✓' : 'Водитель добавлен ✓', 'success');
    hideBottomSheet(() => renderDrivers());
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

function _driverRowHTML(d, fleet) {
  const statusLow = d.status?.toLowerCase() ?? '';
  const avatarBg  = AVATAR_BG[statusLow]    ?? 'var(--color-border)';
  const pillClass = STATUS_PILL[statusLow]  ?? 'pill--muted';
  const initials  = _initials(d.fio);
  const car       = fleet.find(c => c.carId === d.carId);
  const carLabel  = d.carId || (car?.carId ?? '—');
  const meta      = [carLabel, d.deposit ? `${_fmt(d.deposit)}` : null].filter(Boolean).join(' · ');

  return `
    <div class="fleet-row" data-driver-id="${d.driverId}">
      <div class="drv-avatar" style="background:${avatarBg}">${initials}</div>
      <div class="fleet-row__body">
        <div class="fleet-row__plate">${d.fio}</div>
        <div class="fleet-row__driver">${meta || '—'}</div>
      </div>
      <span class="pill ${pillClass}">${d.status || '—'}</span>
    </div>
  `;
}

function _skeletonHTML() {
  const ln = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:6px"></div>`;
  return `
    <div class="drvs-hdr" style="pointer-events:none">
      ${ln(40)} <div class="skeleton" style="width:90px;height:32px;border-radius:20px"></div>
    </div>
    <div class="fleet-card">
      ${[0,1,2,3,4].map(() => `
        <div class="fleet-row" style="pointer-events:none">
          <div class="skeleton drv-avatar"></div>
          <div style="flex:1">${ln(55)}${ln(40)}</div>
          <div class="skeleton skeleton-line" style="width:56px"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline" style="padding-top:100px">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <button class="btn-primary" id="drivers-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _fmt(n)       { return `${Math.round(n).toLocaleString('ru-RU')} ₽`; }
function _esc(s)       { return String(s).replace(/"/g, '&quot;'); }
function _initials(fio){ return (fio ?? '?').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join(''); }
function _ddmmyyyyToISO(s) {
  if (!s) return '';
  const [d,m,y] = s.split('.');
  return `${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}`;
}
