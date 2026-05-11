/**
 * drivers.js — экран «Водители» (GET_DRIVERS): табы, карточки Т-Банка, просмотр.
 * Форма редактирования — openDriverForm (экран карточки водителя).
 */

import { getDrivers, getFleet, postAction, invalidateCache } from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { showScreen } from '../router.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { CAR_STATUSES, SHEETS } from '../config.js';
import { fmtRub, fmtRuInt } from '../utils/format.js';

const TABS = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'active', label: 'Активные', match: s => isActiveStatus(s) },
  { id: 'archive', label: 'Архив', match: s => isArchiveStatus(s) },
];

let _pendingTab = null;
let _lastDrivers = [];
let _activeTab = 'active';

function isActiveStatus(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('актив') && !s.includes('архив');
}

function isArchiveStatus(raw) {
  return String(raw || '').toLowerCase().includes('архив');
}


function formatPhoneRu(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  let n = d;
  if (n.length === 10 && n[0] === '9') n = '7' + n;
  if (n.length === 11 && n[0] === '8') n = '7' + n.slice(1);
  if (n.length !== 11 || n[0] !== '7') return String(raw || '').trim() || '—';
  const a = n.slice(1, 4);
  const b = n.slice(4, 7);
  const c = n.slice(7, 9);
  const e = n.slice(9, 11);
  return `+7 ${a} ${b}-${c}-${e}`;
}

function depositStyle(driver) {
  const x = Number(driver.deposit) || 0;
  if (x < 0) return '#C62828';
  if (x > 0 && isArchiveStatus(driver.status)) return '#757575';
  if (x > 0) return '#2E7D32';
  return '#757575';
}

function badgeFor(driver) {
  if (isArchiveStatus(driver.status)) {
    return { label: 'Архив', class: 'drivers-card__badge--archive' };
  }
  return { label: 'Активный', class: 'drivers-card__badge--active' };
}

export function initDrivers() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-drivers') renderDrivers();
  });
}

export async function renderDrivers() {
  const body = document.getElementById('drivers-body');
  if (!body) return;

  if (_pendingTab && TABS.some(t => t.id === _pendingTab)) {
    _activeTab = _pendingTab;
    _pendingTab = null;
  }

  body.innerHTML = '';
  let drivers;
  let cacheHit = false;

  getWithSWR(CACHE_KEYS.DRIVERS, () => getDrivers(), {
    onCached: d => {
      cacheHit = true;
      drivers = d;
      _lastDrivers = drivers;
      _paint(body, drivers, _activeTab);
    },
    onFresh: d => {
      drivers = d;
      _lastDrivers = drivers;
      _paint(body, drivers, _activeTab);
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) {
        body.innerHTML = _errorHTML();
        document.getElementById('drivers-retry')?.addEventListener('click', () => renderDrivers());
      }
    },
  });

  setTimeout(() => {
    if (!cacheHit && drivers === undefined) {
      body.innerHTML = _skeletonHTML();
    }
  }, 0);
}

function _paint(body, drivers, tabId) {
  const filtered = drivers.filter(c => {
    const tab = TABS.find(t => t.id === tabId) ?? TABS[0];
    return tab.match(c.status);
  });

  body.innerHTML = `
    <div class="drivers-page">
      <header class="drivers-page__header">
        <h1 class="drivers-page__title">Водители</h1>
        <button type="button" class="drivers-add-btn" id="drivers-add-btn">+ Добавить</button>
      </header>

      <div class="drivers-page__tabs">
        ${TABS.map(t => `
          <button type="button" class="drivers-tab ${t.id === tabId ? 'drivers-tab--active' : ''}"
            data-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>

      <div class="drivers-page__body" id="drivers-list-root">
        ${_listHTML(filtered, drivers.length === 0)}
      </div>
    </div>
  `;

  body.querySelectorAll('.drivers-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      if (!id || id === _activeTab) return;
      _activeTab = id;
      body.querySelectorAll('.drivers-tab').forEach(b =>
        b.classList.toggle('drivers-tab--active', b.dataset.tab === id));
      const root = document.getElementById('drivers-list-root');
      if (root) {
        const next = _lastDrivers.filter(c => {
          const t = TABS.find(x => x.id === id) ?? TABS[0];
          return t.match(c.status);
        });
        root.innerHTML = _listHTML(next, _lastDrivers.length === 0);
        _bindRows(body, next);
      }
    });
  });

  _bindRows(body, filtered);

  document.getElementById('drivers-add-btn')?.addEventListener('click', async () => {
    let fleet, drivers;
    try { [fleet, drivers] = await Promise.all([getFleet(), getDrivers()]); }
    catch { showToast('Ошибка загрузки', 'error'); return; }
    openDriverForm(null, fleet, drivers);
  });
}

function _listHTML(list, driversWasEmpty) {
  if (driversWasEmpty) {
    return `<div class="drivers-empty">Нет водителей</div>`;
  }
  if (!list.length) {
    return `<div class="drivers-empty">Нет водителей с таким статусом</div>`;
  }
  return list.map(d => _cardHTML(d)).join('');
}

function _cardHTML(d) {
  const badge = badgeFor(d);
  const dep = Number(d.deposit) || 0;
  const depStr = fmtRub(dep);
  const depCol = depositStyle(d);
  const car = d.currentCar;
  const carStr = car ? escapeHtml(String(car)) : '—';
  const carCol = car ? '#2E7D32' : '#757575';
  const note = String(d.note || '').trim();

  return `
    <article class="drivers-card" data-driver-id="${escapeAttr(d.driverId)}">
      <div class="drivers-card__top">
        <div class="drivers-card__id-block">
          <div class="drivers-card__name">${escapeHtml(d.name || '—')}</div>
          <div class="drivers-card__did">${escapeHtml(d.driverId)}</div>
        </div>
        <span class="drivers-card__badge ${badge.class}">${badge.label}</span>
      </div>
      <div class="drivers-card__rule"></div>
      <div class="drivers-card__grid">
        <div class="drivers-card__cell">
          <div class="drivers-card__lbl">Телефон</div>
          <div class="drivers-card__val">${escapeHtml(formatPhoneRu(d.phone))}</div>
        </div>
        <div class="drivers-card__cell">
          <div class="drivers-card__lbl">Депозит</div>
          <div class="drivers-card__val" style="color:${depCol}">${depStr}</div>
        </div>
        <div class="drivers-card__cell">
          <div class="drivers-card__lbl">Машина</div>
          <div class="drivers-card__val" style="color:${carCol}">${carStr}</div>
        </div>
      </div>
      ${note ? `
        <div class="drivers-card__note">
          <span class="drivers-card__note-text">${escapeHtml(note)}</span>
        </div>
      ` : ''}
    </article>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function _bindRows(body, list) {
  body.querySelectorAll('.drivers-card[data-driver-id]').forEach(el => {
    el.addEventListener('click', () => {
      const d = list.find(x => x.driverId === el.dataset.driverId);
      if (d) {
        document.dispatchEvent(new CustomEvent('driver:open', {
          detail: { driverId: d.driverId },
        }));
        showScreen('screen-driver');
      }
    });
  });
}

function _skeletonHTML() {
  const card = `
    <div class="drivers-card drivers-card--skeleton">
      <div class="drivers-card__top">
        <div>
          <div class="skeleton skeleton-line" style="width:70%;height:18px;margin-bottom:8px"></div>
          <div class="skeleton skeleton-line" style="width:40%;height:11px"></div>
        </div>
        <div class="skeleton" style="width:72px;height:26px;border-radius:8px"></div>
      </div>
      <div class="drivers-card__rule"></div>
      <div class="drivers-card__grid">
        ${[1, 2, 3].map(() => `
          <div class="drivers-card__cell">
            <div class="skeleton skeleton-line" style="width:50%;height:10px;margin-bottom:6px"></div>
            <div class="skeleton skeleton-line" style="width:85%;height:14px"></div>
          </div>
        `).join('')}
      </div>
    </div>`;
  return `
    <div class="drivers-page">
      <header class="drivers-page__header drivers-page__header--skel">
        <div class="skeleton skeleton-line" style="width:120px;height:24px"></div>
        <div class="skeleton skeleton-line" style="width:90px;height:14px"></div>
      </header>
      <div class="drivers-page__tabs drivers-page__tabs--skel">
        ${[1, 2, 3].map(() => `<div class="skeleton" style="height:36px;flex:1;border-radius:10px"></div>`).join('')}
      </div>
      <div class="drivers-page__body">${card}${card}${card}</div>
    </div>`;
}

function _errorHTML() {
  return `
    <div class="drivers-page drivers-page--center">
      <div class="drivers-error">
        <div class="drivers-error__text">Не удалось загрузить водителей</div>
        <button type="button" class="btn-primary" id="drivers-retry">Повторить</button>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Форма редактирования (вызывается с экрана карточки водителя)
// ═══════════════════════════════════════════════════════════════════════════

export function openDriverForm(driver, fleet, drivers) {
  const isEdit = !!driver;
  const title = isEdit ? 'Редактировать водителя' : 'Новый водитель';
  const phoneValue = isEdit ? (driver?.phone ?? '') : '+7';
  const vuValue = driver?.license ?? '';

  showBottomSheet(`
    <p class="bottomsheet-title">${title}</p>

    <div class="add-field">
      <label class="add-label">ФИО</label>
      <input id="drv-fio" class="field-input" type="text"
        placeholder="Иванов Иван Иванович" value="${_esc(driver?.name ?? '')}" />
      <div class="add-field-err hidden" id="err-drv-fio"></div>
    </div>

    <div class="add-field-row">
      <div class="add-field">
        <label class="add-label">Телефон</label>
        <input id="drv-phone" class="field-input" type="tel"
          placeholder="+7 777 000 00 00" value="${_esc(phoneValue)}" />
      </div>
      <div class="add-field">
        <label class="add-label">ВУ</label>
        <input id="drv-vu" class="field-input" type="text"
          placeholder="Номер ВУ" value="${_esc(vuValue)}" autocomplete="off" />
      </div>
    </div>

    <div class="add-field">
      <label class="add-label">Депозит, ₽</label>
      <input id="drv-deposit" class="field-input" type="number"
        inputmode="decimal" placeholder="0" value="${driver?.deposit ?? ''}" />
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

async function _saveDriver(existing, fleet, drivers) {
  const fio = document.getElementById('drv-fio')?.value.trim();
  const phone = document.getElementById('drv-phone')?.value.trim();
  const vu = document.getElementById('drv-vu')?.value.trim() ?? '';
  const deposit = parseFloat(document.getElementById('drv-deposit')?.value) || 0;
  const note = document.getElementById('drv-comment')?.value.trim();

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
      fio,
      phone,
      vu,
      car_id: '',
      status: existing?.status ?? 'активный',
      comment: note,
    });

    if (!existing && deposit > 0) {
      await postAction('ADD_DEPOSIT', {
        driver_id: res.driver_id,
        car_id: '',
        amount: deposit,
        comment: 'Начальный депозит',
      }).catch(() => {});
    }

    const newDriverId = res.driver_id || existing?.driverId;

    invalidateCache(SHEETS.DRIVERS);
    invalidateCache(SHEETS.CARS);
    invalidateLocalCache(CACHE_KEYS.DRIVERS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    if (!existing && deposit > 0) {
      invalidateLocalCache(CACHE_KEYS.DEPOSITS);
    }
    showToast(existing ? 'Изменения сохранены ✓' : 'Водитель добавлен ✓', 'success');

    if (!existing) {
      hideBottomSheet(() => _openAssignCarSheet(newDriverId, fio));
    } else {
      hideBottomSheet(() => renderDrivers());
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
  }
}

function _esc(s) {
  return String(s).replace(/"/g, '&quot;');
}

function _fmtDateForApi(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

async function _openAssignCarSheet(driverId, driverName) {
  let fleet;
  try { fleet = await getFleet(); }
  catch { renderDrivers(); return; }

  const freeCars = fleet.filter(c => c.status === CAR_STATUSES.IDLE);

  showBottomSheet(`
    <div class="drv-assign-sheet">
      <div class="drv-assign-title">Выдать машину?</div>
      <div class="drv-assign-sub">${escapeHtml(driverName)}</div>

      ${freeCars.length === 0 ? `
        <div class="drv-assign-empty">Нет свободных машин</div>
        <button type="button" class="drv-assign-skip" id="drv-assign-skip">Пропустить</button>
      ` : `
        <div class="drv-assign-cars" id="drv-assign-cars">
          ${freeCars.map(c => `
            <div class="drv-assign-car" data-car-id="${escapeAttr(c.carId)}">
              <div class="drv-assign-car-id">${escapeHtml(c.carId)}</div>
              <div class="drv-assign-car-meta">${escapeHtml([c.name, c.color].filter(Boolean).join(' · '))}</div>
              <div class="drv-assign-car-rate">${fmtRuInt(Math.round(c.rateDay || 0))} ₽/день</div>
            </div>
          `).join('')}
        </div>
        <button type="button" class="drv-assign-confirm" id="drv-assign-confirm" disabled>
          Выдать
        </button>
        <button type="button" class="drv-assign-skip" id="drv-assign-skip">Пропустить</button>
      `}
    </div>
  `);

  let selectedCarId = null;

  setTimeout(() => {
    document.getElementById('drv-assign-cars')?.addEventListener('click', e => {
      const item = e.target.closest('[data-car-id]');
      if (!item) return;
      selectedCarId = item.dataset.carId;
      document.querySelectorAll('.drv-assign-car').forEach(el => {
        el.classList.toggle('drv-assign-car--selected', el.dataset.carId === selectedCarId);
      });
      const confirmBtn = document.getElementById('drv-assign-confirm');
      if (confirmBtn) confirmBtn.disabled = false;
    });

    document.getElementById('drv-assign-confirm')?.addEventListener('click', async () => {
      if (!selectedCarId) return;
      const btn = document.getElementById('drv-assign-confirm');
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = 'Выдаём…';

      try {
        const today = _fmtDateForApi(new Date());

        await postAction('UPDATE_CAR_STATUS', {
          car_id: selectedCarId,
          new_status: CAR_STATUSES.RENT,
        });

        const car = freeCars.find(c => c.carId === selectedCarId);
        await postAction('ADD_RENTAL', {
          car_id:     selectedCarId,
          driver_id:  driverId,
          date_start: today,
          date_end:   '',
          rate_day:   car?.rateDay || 0,
          comment:    'выдача при регистрации водителя',
        });

        invalidateCache(SHEETS.CARS);
        invalidateCache(SHEETS.RENTALS);
        invalidateCache(SHEETS.DRIVERS);
        invalidateLocalCache(CACHE_KEYS.CARS);
        invalidateLocalCache(CACHE_KEYS.RENTALS);
        invalidateLocalCache(CACHE_KEYS.DRIVERS);
        invalidateLocalCache(CACHE_KEYS.INCOME_FORM);

        showToast('Машина выдана ✓', 'success');
        hideBottomSheet(() => renderDrivers());
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Выдать';
        showToast(
          err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка выдачи',
          'error',
        );
      }
    });

    document.getElementById('drv-assign-skip')?.addEventListener('click', () => {
      hideBottomSheet(() => renderDrivers());
    });
  }, 0);
}
