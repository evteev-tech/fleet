/**
 * fleet.js — экран «Парк»: данные GET_FLEET, фильтр по статусу, карточки Т-Банка.
 */

import { getFleet, getDrivers, postAction, invalidateCache } from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { showScreen } from '../router.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { CAR_STATUSES, SHEETS } from '../config.js';
import { fmtRuInt } from '../utils/format.js';
import { renderAppHeader } from '../ui-components.js?v=7';

const TABS = [
  { id: 'all', label: 'Все', match: () => true },
  {
    id: 'rent',
    label: 'В аренде',
    match: s => statusKey(s) === 'rent',
  },
  {
    id: 'idle',
    label: 'Простой',
    match: s => statusKey(s) === 'idle',
  },
  {
    id: 'repair',
    label: 'В ремонте',
    match: s => statusKey(s) === 'repair',
  },
];

const BADGE = {
  rent:   { label: 'В аренде',  class: 'fleet-car__badge--rent' },
  idle:   { label: 'Простой',   class: 'fleet-car__badge--idle' },
  repair: { label: 'В ремонте', class: 'fleet-car__badge--repair' },
};

let _pendingTab = null;
let _lastFleet = [];
let _activeTab = 'rent';
let _quickPopoverDocBound = false;

/** Нормализация статуса из таблицы → rent | idle | repair */
function statusKey(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.includes('аренд')) return 'rent';
  if (s.includes('ремонт')) return 'repair';
  if (s.includes('прост')) return 'idle';
  return 'idle';
}

function pluralCars(n) {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  if (k > 10 && k < 20) return `${n} машин`;
  if (d === 1) return `${n} машина`;
  if (d >= 2 && d <= 4) return `${n} машины`;
  return `${n} машин`;
}

function fmtKm(n) {
  return `${fmtRuInt(Math.max(0, Math.round(n)))} км`;
}

function fmtRate(n) {
  return `${fmtRuInt(Math.max(0, Number(n) || 0))} ₽/день`;
}

function fmtBuyDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU');
}

const TO_MILEAGE_COLOR_HEX = {
  red: '#C62828',
  yellow: '#F57F17',
  green: '#2E7D32',
  gray: '#9E9E9E',
};

/**
 * До ТО: остаток km до следующего ТО; при t===0 или t===m — «—» (ТО не запланировано).
 */
function formatToMileage(mileage, toMileage) {
  const m = Number(mileage) || 0;
  const t = Number(toMileage) || 0;

  if (t === 0 || t === m) {
    return { text: '—', color: 'gray' };
  }

  const diff = t - m;

  if (diff <= 0) {
    return { text: 'Просрочено', color: 'red' };
  }

  if (diff < 1000) {
    return { text: fmtRuInt(diff) + ' км', color: 'red' };
  }

  if (diff < 3000) {
    return { text: fmtRuInt(diff) + ' км', color: 'yellow' };
  }

  return { text: fmtRuInt(diff) + ' км', color: 'green' };
}

export function initFleet() {
  document.addEventListener('fleet:filter', e => {
    const st = e.detail?.status;
    _pendingTab =
      st === CAR_STATUSES.RENT ? 'rent' :
      st === CAR_STATUSES.REPAIR ? 'repair' :
      st === CAR_STATUSES.IDLE ? 'idle' : null;
  });

  document.addEventListener('car:action:rent', e => {
    if (e.detail?.car) void _openDriverSelectSheet(e.detail.car);
  });

  document.addEventListener('car:action:return', e => {
    const car = e.detail?.car;
    if (!car) return;
    if (!confirm(`Принять ${car.carId} из аренды → простой?`)) return;
    void (async () => {
      try {
        await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: CAR_STATUSES.IDLE });
        invalidateCache(SHEETS.CARS);
        invalidateLocalCache(CACHE_KEYS.CARS);
        invalidateLocalCache(CACHE_KEYS.INCOME_FORM);
        showToast('Машина принята ✓', 'success');
        showScreen('screen-fleet');
      } catch (err) {
        showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка', 'error');
      }
    })();
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-fleet') renderFleet();
  });
}

export async function renderFleet() {
  const body = document.getElementById('fleet-body');
  if (!body) return;

  if (_pendingTab && TABS.some(t => t.id === _pendingTab)) {
    _activeTab = _pendingTab;
    _pendingTab = null;
  }

  body.innerHTML = '';
  let fleet;
  let cacheHit = false;

  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      fleet = d;
      _lastFleet = fleet;
      _paint(body, fleet, _activeTab);
    },
    onFresh: d => {
      fleet = d;
      _lastFleet = fleet;
      _paint(body, fleet, _activeTab);
    },
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache) {
        body.innerHTML = _errorHTML();
        document.getElementById('fleet-retry')?.addEventListener('click', () => renderFleet());
      }
    },
  });

  setTimeout(() => {
    if (!cacheHit && fleet === undefined) {
      body.innerHTML = _skeletonHTML();
    }
  }, 0);
}

function _paint(body, fleet, tabId) {
  const filtered = fleet.filter(c => {
    const tab = TABS.find(t => t.id === tabId) ?? TABS[0];
    return tab.match(c.status);
  });

  body.innerHTML = `
    <div class="fleet-page">
      ${renderAppHeader({ title: 'Парк', subtitle: pluralCars(fleet.length) })}

      <div class="fleet-page__tabs">
        ${TABS.map(t => `
          <button type="button" class="pill pill--light pill--stretch ${t.id === tabId ? 'pill--active' : ''}"
            data-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>

      <div class="fleet-page__body" id="fleet-list-root">
        ${_listHTML(filtered, fleet.length === 0)}
      </div>
    </div>
  `;

  body.querySelectorAll('.pill[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      if (!id || id === _activeTab) return;
      _activeTab = id;
      body.querySelectorAll('.pill[data-tab]').forEach(b =>
        b.classList.toggle('pill--active', b.dataset.tab === id));
      const root = document.getElementById('fleet-list-root');
      if (root) {
        const next = _lastFleet.filter(c => {
          const t = TABS.find(x => x.id === id) ?? TABS[0];
          return t.match(c.status);
        });
        root.innerHTML = _listHTML(next, _lastFleet.length === 0);
        _bindCardClicks(body, next);
      }
    });
  });

  _bindCardClicks(body, filtered);
}

function _listHTML(cars, fleetWasEmpty) {
  if (fleetWasEmpty) {
    return `<div class="fleet-empty">В парке пока нет машин</div>`;
  }
  if (!cars.length) {
    return `<div class="fleet-empty">Нет машин с таким статусом</div>`;
  }
  return cars.map(c => _cardHTML(c)).join('');
}

function _cardHTML(car) {
  const sk = statusKey(car.status);
  const badge = BADGE[sk] ?? BADGE.idle;
  const opts = ['rent', 'idle', 'repair'].filter(k => k !== sk);
  const title = [car.name, car.color].filter(Boolean).join(' · ');
  const toInfo = formatToMileage(car.mileage, car.toMileage);
  const toHex = TO_MILEAGE_COLOR_HEX[toInfo.color] ?? '#9E9E9E';
  const note = String(car.note || '').trim();

  return `
    <article class="fleet-car" data-car-id="${escapeAttr(car.carId)}">
      <div class="fleet-car__top">
        <div class="fleet-car__id-block">
          <div class="fleet-car__plate">${escapeHtml(car.carId)}</div>
          ${title ? `<div class="fleet-car__subtitle">${escapeHtml(title)}</div>` : ''}
        </div>
        <div class="fleet-quick-wrap" data-quick-car="${escapeAttr(car.carId)}">
          <button type="button"
                  class="fleet-car__badge ${badge.class} fleet-quick-trigger"
                  data-car-id="${escapeAttr(car.carId)}"
                  aria-label="Изменить статус ${escapeAttr(car.carId)}">
            ${badge.label}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="margin-left:4px;opacity:0.6">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="fleet-quick-popover" id="popover-${escapeAttr(car.carId)}" hidden>
            ${opts.map(k => {
              const api = _statusApiFromKey(k);
              const lbl = BADGE[k].label;
              const dotCls =
                k === 'rent' ? 'fleet-quick-dot--green' :
                k === 'repair' ? 'fleet-quick-dot--red' :
                'fleet-quick-dot--amber';
              return `<button type="button"
                              class="fleet-quick-item"
                              data-new-status="${escapeAttr(api)}"
                              data-status-key="${k}">
                <span class="fleet-quick-dot ${dotCls}"></span>
                ${lbl}
              </button>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="fleet-car__rule"></div>
      <div class="fleet-car__grid">
        <div class="fleet-car__cell">
          <div class="fleet-car__lbl">Ставка</div>
          <div class="fleet-car__val">${fmtRate(car.rateDay)}</div>
        </div>
        <div class="fleet-car__cell">
          <div class="fleet-car__lbl">Куплена</div>
          <div class="fleet-car__val">${fmtBuyDate(car.dateBuy)}</div>
        </div>
        <div class="fleet-car__cell">
          <div class="fleet-car__lbl">Пробег</div>
          <div class="fleet-car__val">${fmtKm(car.mileage)}</div>
        </div>
        <div class="fleet-car__cell">
          <div class="fleet-car__lbl">До ТО</div>
          <div class="fleet-car__val" style="color:${toHex}">${escapeHtml(toInfo.text)}</div>
        </div>
      </div>
      ${note ? `
        <div class="fleet-car__note">
          <span class="fleet-car__note-icon" aria-hidden="true">⚠️</span>
          <span class="fleet-car__note-text">${escapeHtml(note)}</span>
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

function _initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[1][0]).toUpperCase();
}

function _fmtDateForApi(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function _bindCardClicks(body, cars) {
  body.querySelectorAll('.fleet-car[data-car-id]').forEach(el => {
    el.addEventListener('click', e => {

      /* ── Тап по триггеру попапа ── */
      const trigger = e.target.closest('.fleet-quick-trigger');
      if (trigger) {
        e.stopPropagation();
        const carId = trigger.dataset.carId;
        _toggleQuickPopover(carId);
        return;
      }

      /* ── Тап по пункту попапа ── */
      const item = e.target.closest('.fleet-quick-item');
      if (item) {
        e.stopPropagation();
        const popover = item.closest('.fleet-quick-popover');
        const carId = popover?.id?.replace('popover-', '');
        const car = cars.find(c => c.carId === carId);
        if (!car) return;
        _closeAllPopovers();
        const newStatus = item.dataset.newStatus;
        const statusKey_ = item.dataset.statusKey;
        if (statusKey_ === 'rent') {
          void _openDriverSelectSheet(car);
        } else {
          void _changeStatus(car, newStatus);
        }
        return;
      }

      /* ── Обычный тап по карточке → bottomsheet ── */
      const card = e.target.closest('.fleet-car[data-car-id]');
      if (card && !e.target.closest('.fleet-quick-wrap')) {
        const car = cars.find(c => c.carId === card.dataset.carId);
        if (car) {
          document.dispatchEvent(new CustomEvent('car:open', { detail: { carId: car.carId } }));
          showScreen('screen-car');
        }
      }
    });
  });

  /* Закрыть все попапы при клике вне */
  if (!_quickPopoverDocBound) {
    _quickPopoverDocBound = true;
    document.addEventListener('click', _closeAllPopovers, { once: false });
  }
}

function _toggleQuickPopover(carId) {
  const target = document.getElementById(`popover-${carId}`);
  if (!target) return;
  const isHidden = target.hidden;
  _closeAllPopovers();
  if (isHidden) target.hidden = false;
}

function _closeAllPopovers() {
  document.querySelectorAll('.fleet-quick-popover').forEach(p => {
    p.hidden = true;
  });
}

function _statusApiFromKey(key) {
  if (key === 'rent') return CAR_STATUSES.RENT;
  if (key === 'repair') return CAR_STATUSES.REPAIR;
  return CAR_STATUSES.IDLE;
}

async function _openCarSheet(car) {
  let drivers = [];
  invalidateCache(SHEETS.DRIVERS);
  try {
    drivers = await getDrivers();
  } catch {
    drivers = [];
  }

  const sk = statusKey(car.status);
  const opts = ['rent', 'idle', 'repair'].filter(k => k !== sk);

  const toInfo = formatToMileage(car.mileage, car.toMileage);
  const toHex = TO_MILEAGE_COLOR_HEX[toInfo.color] ?? '#9E9E9E';

  const cid = String(car.carId ?? '').trim();
  const assigned = drivers.find(d => String(d.currentCar ?? '').trim() === cid);
  const noteTrim = String(car.note || '').trim();

  const driverBlock = assigned
    ? `
    <div class="fleet-bs-section-label">Водитель</div>
    <div class="fleet-bs-driver">
      <div class="fleet-bs-avatar">${escapeHtml(_initials(assigned.name))}</div>
      <div>
        <div class="fleet-bs-driver-name">${escapeHtml(assigned.name)}</div>
        <div class="fleet-bs-driver-phone">${assigned.phone ? escapeHtml(String(assigned.phone)) : 'нет телефона'}</div>
      </div>
    </div>`
    : `
    <div class="fleet-bs-section-label">Водитель</div>
    <div class="fleet-bs-driver-empty">Водитель не назначен</div>`;

  const noteBlock = noteTrim
    ? `<div class="fleet-bs-note"><span>⚠</span><span>${escapeHtml(noteTrim)}</span></div>`
    : '';

  const badgeCls =
    sk === 'rent' ? 'fleet-bs-badge--rent' :
    sk === 'repair' ? 'fleet-bs-badge--repair' :
    'fleet-bs-badge--idle';

  const statusBtns = opts.map(k => {
    const api = _statusApiFromKey(k);
    const lbl = BADGE[k].label;
    const mod =
      k === 'rent' ? 'fleet-status-btn--rent' :
      k === 'repair' ? 'fleet-status-btn--repair' :
      'fleet-status-btn--idle';
    const labelHtml = k === 'rent' ? `${lbl} →` : lbl;
    return `<button type="button" class="fleet-status-btn ${mod}" data-new-status="${escapeAttr(api)}">${labelHtml}</button>`;
  }).join('');

  showBottomSheet(`
    <div class="fleet-bs-hero">
      <div class="fleet-bs-drag"></div>
      <div class="fleet-bs-top">
        <div>
          <div class="fleet-bs-plate">${escapeHtml(car.carId)}</div>
          ${car.name || car.color ? `
            <div class="fleet-bs-model">${escapeHtml([car.name, car.color].filter(Boolean).join(' · '))}</div>
          ` : ''}
        </div>
        <span class="fleet-bs-badge ${badgeCls}">${BADGE[sk].label}</span>
      </div>
    </div>
    <div class="fleet-bs-divider"></div>
    <div class="fleet-bs-grid">
      <div class="fleet-bs-cell">
        <div class="fleet-bs-lbl">Пробег</div>
        <div class="fleet-bs-val">${fmtKm(car.mileage)}</div>
      </div>
      <div class="fleet-bs-cell">
        <div class="fleet-bs-lbl">До ТО</div>
        <div class="fleet-bs-val" style="color:${toHex}">${escapeHtml(toInfo.text)}</div>
      </div>
    </div>
    <div class="fleet-bs-divider"></div>
    ${noteBlock}
    ${noteBlock ? '<div class="fleet-bs-divider"></div>' : ''}
    ${driverBlock}
    <div class="fleet-bs-divider"></div>
    <div class="fleet-bs-change-label">Изменить статус</div>
    <div class="fleet-status-btns" id="fleet-status-btns">${statusBtns}</div>
  `);

  setTimeout(() => {
    document.getElementById('fleet-status-btns')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-new-status]');
      if (!btn) return;
      if (btn.classList.contains('fleet-status-btn--rent')) {
        await _openDriverSelectSheet(car);
        return;
      }
      await _changeStatus(car, btn.dataset.newStatus);
    });
  }, 0);
}

async function _openDriverSelectSheet(car) {
  invalidateCache(SHEETS.DRIVERS);
  let drivers;
  try {
    drivers = await getDrivers();
  } catch {
    showToast('Ошибка загрузки водителей', 'error');
    return;
  }

  const active = drivers.filter(d =>
    (d.status === 'активный' || d.status === 'активен') && !d.currentCar
  );

  showBottomSheet(`
    <div class="fleet-bs-back" id="fleet-bs-back">
      <span>←</span><span>назад</span>
    </div>
    <div class="fleet-bs-title">Водитель для ${escapeHtml(car.carId)}</div>
    <div class="fleet-driver-list" id="fleet-driver-list">
      ${active.map(d => `
        <div class="fleet-driver-item" data-driver-id="${escapeAttr(d.driverId)}">
          <div class="fleet-driver-avatar">${escapeHtml(_initials(d.name))}</div>
          <div class="fleet-driver-info">
            <div class="fleet-driver-name">${escapeHtml(d.name)}</div>
            <div class="fleet-driver-car">${d.currentCar ? escapeHtml(d.currentCar) : 'без машины'}</div>
          </div>
          <div class="fleet-driver-check hidden">✓</div>
        </div>
      `).join('')}
    </div>
    <button class="fleet-bs-confirm" id="fleet-bs-confirm" disabled>Перевести в аренду</button>
  `);

  let selectedDriverId = null;

  setTimeout(() => {
    document.getElementById('fleet-bs-back')?.addEventListener('click', () => {
      hideBottomSheet(() => {
        void _openCarSheet(car);
      });
    });

    document.getElementById('fleet-driver-list')?.addEventListener('click', e => {
      const item = e.target.closest('[data-driver-id]');
      if (!item) return;
      selectedDriverId = item.dataset.driverId;
      document.querySelectorAll('.fleet-driver-item').forEach(el => {
        el.classList.toggle('fleet-driver-item--selected', el.dataset.driverId === selectedDriverId);
        el.querySelector('.fleet-driver-check')?.classList.toggle('hidden', el.dataset.driverId !== selectedDriverId);
      });
      const conf = document.getElementById('fleet-bs-confirm');
      if (conf) conf.disabled = false;
    });

    document.getElementById('fleet-bs-confirm')?.addEventListener('click', async () => {
      if (!selectedDriverId) return;
      await _changeStatusWithDriver(car, CAR_STATUSES.RENT, selectedDriverId);
    });
  }, 0);
}

async function _changeStatusWithDriver(car, newStatus, driverId) {
  const btn = document.getElementById('fleet-bs-confirm');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
  }

  try {
    await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: newStatus });

    const today = _fmtDateForApi(new Date());
    await postAction('ADD_RENTAL', {
      car_id: car.carId,
      driver_id: driverId,
      date_start: today,
      rate_day: car.rateDay,
      comment: 'выдача из Парка',
    });

    invalidateCache(SHEETS.CARS);
    invalidateCache(SHEETS.RENTALS);
    invalidateCache(SHEETS.DRIVERS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    invalidateLocalCache(CACHE_KEYS.RENTALS);
    invalidateLocalCache(CACHE_KEYS.DRIVERS);
    invalidateLocalCache(CACHE_KEYS.INCOME_FORM);

    showToast('Машина выдана ✓', 'success');
    hideBottomSheet(() => renderFleet());
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '';
    }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка', 'error');
  }
}

async function _changeStatus(car, newStatus) {
  const btns = document.querySelectorAll('#fleet-status-btns .fleet-status-btn');
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  try {
    await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: newStatus });
    invalidateCache(SHEETS.CARS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    invalidateLocalCache(CACHE_KEYS.INCOME_FORM);
    showToast('Статус обновлён ✓', 'success');
    hideBottomSheet(() => renderFleet());
  } catch (err) {
    btns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка обновления', 'error');
  }
}

function _skeletonHTML() {
  const card = `
    <div class="fleet-car fleet-car--skeleton">
      <div class="fleet-car__top">
        <div>
          <div class="skeleton skeleton-line" style="width:72px;height:20px;margin-bottom:8px"></div>
          <div class="skeleton skeleton-line" style="width:140px;height:12px"></div>
        </div>
        <div class="skeleton" style="width:72px;height:26px;border-radius:8px"></div>
      </div>
      <div class="fleet-car__rule"></div>
      <div class="fleet-car__grid">
        ${[1, 2, 3, 4].map(() => `
          <div class="fleet-car__cell">
            <div class="skeleton skeleton-line" style="width:50%;height:10px;margin-bottom:6px"></div>
            <div class="skeleton skeleton-line" style="width:80%;height:14px"></div>
          </div>
        `).join('')}
      </div>
    </div>`;
  return `
    <div class="fleet-page">
      ${renderAppHeader({ title: 'Парк' })}
      <div class="fleet-page__tabs fleet-page__tabs--skel">
        ${[1, 2, 3, 4].map(() => `<div class="skeleton" style="height:36px;flex:1;border-radius:10px"></div>`).join('')}
      </div>
      <div class="fleet-page__body">${card}${card}${card}</div>
    </div>`;
}

function _errorHTML() {
  return `
    <div class="fleet-page fleet-page--center">
      <div class="fleet-error">
        <div class="fleet-error__text">Не удалось загрузить парк</div>
        <button type="button" class="btn-primary" id="fleet-retry">Повторить</button>
      </div>
    </div>`;
}
