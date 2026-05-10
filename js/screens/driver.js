/**
 * driver.js — карточка водителя.
 *
 * Открывается через showScreen('screen-driver') + событие driver:open.
 * Отображает профиль водителя, текущий депозит, историю пополнений,
 * кнопки «Редактировать» и «В архив».
 */

import { getDrivers, getFleet, getDeposits, postAction, invalidateCache } from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { SHEETS }                                                         from '../config.js';
import { showScreen }                                                       from '../router.js';
import { showBottomSheet, hideBottomSheet, showToast }                     from '../ui.js';
import { openDriverForm }                                                   from './drivers.js';
import { fmtRub } from '../utils/format.js';

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

export function renderDriver(driverId) {
  const body   = document.getElementById('driver-body');
  const nameEl = document.getElementById('driver-header-name');
  if (!body) return;

  if (nameEl) nameEl.textContent = 'Водитель';

  if (!driverId) {
    body.innerHTML = _errorHTML('Водитель не найден');
    return;
  }

  body.innerHTML = '';
  let drivers;
  let fleet;
  let deposits;
  let cacheHit = false;

  const paint = () => {
    if (drivers === undefined || fleet === undefined || deposits === undefined) return;

    const driver = drivers.find(d => String(d.driverId) === String(driverId));
    if (!driver) {
      body.innerHTML = _errorHTML('Водитель не найден');
      return;
    }

    if (nameEl) nameEl.textContent = driver.name || 'Водитель';

    const car          = fleet.find(c => c.carId === driver.carId);
    const driverDeps   = deposits
      .filter(dep => String(dep.driverId) === String(driverId))
      .sort((a, b) => _parseDate(b.date) - _parseDate(a.date));
    const currentDeposit = driverDeps.reduce((s, d) => s + (d.amount || 0), 0);

    body.innerHTML = `

    <!-- Основные данные -->
    <div class="drv-profile-card">
      <div class="drv-profile-avatar">${_initials(driver.name)}</div>
      <div class="drv-profile-name">${_esc(driver.name)}</div>

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
        <div>
          <div class="drv-deposit-label">Депозит</div>
          <div class="drv-deposit-amount ${currentDeposit > 0 ? 'drv-deposit--pos' : currentDeposit < 0 ? 'drv-deposit--neg' : 'drv-deposit--zero'}">
            ${_fmt(currentDeposit)}
          </div>
        </div>
        ${currentDeposit > 0 ? `
          <button type="button" class="drv-deposit-return-btn" id="driver-deposit-return">
            Вернуть
          </button>
        ` : ''}
      </div>

      ${driverDeps.length ? `
        <div class="drv-dep-history">
          ${driverDeps.map(dep => `
            <div class="drv-dep-row">
              <span class="drv-dep-date">${_fmtDate(dep.date)}</span>
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

  document.getElementById('driver-deposit-return')?.addEventListener('click', () => {
    _openReturnSheet(driver, currentDeposit);
  });

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
        fio:       driver.name,
        phone:     driver.phone ?? '',
        vu:        driver.license ?? '',
        car_id:    driver.carId ?? '',
        status:    'архив',
        comment:   driver.note ?? '',
      });
      invalidateCache('Водители');
      invalidateLocalCache(CACHE_KEYS.DRIVERS);
      showToast('Водитель архивирован', 'success');
      showScreen('screen-drivers');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'В архив'; }
      showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка архивации', 'error');
    }
  });
  };

  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => {
      cacheHit = true;
      drivers = d;
      paint();
    },
    onFresh: d => {
      drivers = d;
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) drivers = [];
      paint();
    },
  });

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      fleet = d;
      paint();
    },
    onFresh: d => {
      fleet = d;
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) fleet = [];
      paint();
    },
  });

  getWithSWR(CACHE_KEYS.DEPOSITS, () => getDeposits(), {
    onCached: d => {
      cacheHit = true;
      deposits = d;
      paint();
    },
    onFresh: d => {
      deposits = d;
      paint();
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) deposits = [];
      paint();
    },
  });

  setTimeout(() => {
    if (!cacheHit && (drivers === undefined || fleet === undefined || deposits === undefined)) {
      body.innerHTML = _skeletonHTML();
    }
  }, 0);
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

function _fmt(n)        { return fmtRub(n); }
function _esc(s)        { return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _initials(fio) { return (fio ?? '?').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join(''); }
function _cleanPhone(p) { return (p ?? '').replace(/[^\d+]/g, ''); }
function _parseDate(s)  {
  if (!s) return 0;
  const [d, m, y] = String(s).split('.');
  if (y) return new Date(+y, +m - 1, +d).getTime();
  return new Date(s).getTime() || 0;
}

function _fmtDate(val) {
  if (!val) return '—';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function _openReturnSheet(driver, currentDeposit) {
  const driverName = driver.name || driver.fio || '—';

  showBottomSheet(`
    <div class="drv-return-sheet">
      <div class="drv-return-title">Возврат депозита</div>
      <div class="drv-return-sub">${_esc(driverName)} · остаток ${_fmt(currentDeposit)}</div>

      <div class="drv-return-field">
        <label class="drv-return-label">Сумма возврата, ₽</label>
        <input
          id="drv-return-amount"
          type="number"
          inputmode="numeric"
          class="drv-return-input"
          placeholder="0"
          min="1"
          max="${currentDeposit}"
        />
        <div class="drv-return-remain hidden" id="drv-return-remain"></div>
        <div class="drv-return-err hidden" id="drv-return-err"></div>
      </div>

      <div class="drv-return-field">
        <label class="drv-return-label">Комментарий (необязательно)</label>
        <input
          id="drv-return-comment"
          type="text"
          class="drv-return-input"
          placeholder="Причина возврата"
        />
      </div>

      <button type="button" class="drv-return-submit" id="drv-return-submit" disabled>
        Вернуть
      </button>
    </div>
  `);

  setTimeout(() => {
    const amountInput = document.getElementById('drv-return-amount');
    const remainEl    = document.getElementById('drv-return-remain');
    const errEl       = document.getElementById('drv-return-err');
    const submitBtn   = document.getElementById('drv-return-submit');

    amountInput?.addEventListener('input', () => {
      const val = parseFloat(amountInput.value) || 0;
      errEl.classList.add('hidden');

      if (val <= 0) {
        remainEl.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Вернуть';
        return;
      }

      if (val > currentDeposit) {
        errEl.textContent = `Максимум ${_fmt(currentDeposit)}`;
        errEl.classList.remove('hidden');
        remainEl.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Вернуть';
        return;
      }

      const remain = currentDeposit - val;
      remainEl.textContent = `После возврата остаток: ${_fmt(remain)}`;
      remainEl.classList.remove('hidden');
      submitBtn.textContent = `Вернуть ${_fmt(val)}`;
      submitBtn.disabled = false;
    });

    submitBtn?.addEventListener('click', async () => {
      const val     = parseFloat(amountInput.value) || 0;
      const comment = document.getElementById('drv-return-comment')?.value.trim() || '';

      if (val <= 0 || val > currentDeposit) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Сохраняем…';

      try {
        await postAction('ADD_DEPOSIT', {
          driver_id: driver.driverId,
          car_id:    driver.currentCar || driver.carId || '',
          amount:    -Math.round(val),
          comment:   comment || 'Возврат депозита',
        });

        invalidateCache(SHEETS.DRIVERS);
        invalidateCache(SHEETS.DEPOSITS);
        invalidateLocalCache(CACHE_KEYS.DRIVERS);
        invalidateLocalCache(CACHE_KEYS.DEPOSITS);

        showToast(`Возврат ${_fmt(val)} записан ✓`, 'success');
        hideBottomSheet(() => renderDriver(driver.driverId));
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = `Вернуть ${_fmt(val)}`;
        showToast(
          err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка записи',
          'error',
        );
      }
    });
  }, 0);
}
