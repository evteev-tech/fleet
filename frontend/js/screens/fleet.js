/**
 * fleet.js — экран «Парк»: данные GET_FLEET, фильтр по статусу, карточки Т-Банка.
 */

import { getFleet, getDrivers, getRentals, postAction, invalidateCache, updateCarRate, issueRental, closeRental } from '../api.js';
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
        await closeRental(car.carId);
        invalidateCache(SHEETS.CARS);
        invalidateCache(SHEETS.RENTALS);
        invalidateCache(SHEETS.DRIVERS);
        invalidateLocalCache(CACHE_KEYS.CARS);
        invalidateLocalCache(CACHE_KEYS.RENTALS);
        invalidateLocalCache(CACHE_KEYS.DRIVERS);
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

function _todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function _isoToDDMMYYYY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function _ddmmyyyyToISO(s) {
  if (!s) return '';
  const [d, m, y] = String(s).split('.');
  if (!d || !m || !y) return '';
  return `${y}-${m}-${d}`;
}

async function _getMinDateStartISO(carId) {
  try {
    const rentals = await getRentals();
    const cid = String(carId || '').trim();
    const closed = rentals
      .filter(r => String(r.carId || '').trim() === cid && r.dateEnd)
      .map(r => (r.dateEnd instanceof Date && !Number.isNaN(r.dateEnd.getTime()) ? r.dateEnd : null))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime());
    if (!closed.length) return null;
    const lastEnd = closed[0];
    const min = new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate() + 1);
    return min.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function _hasOpenRental(carId) {
  try {
    const rentals = await getRentals();
    const cid = String(carId || '').trim();
    return rentals.some(r =>
      String(r.carId || '').trim() === cid && !r.dateEnd,
    );
  } catch {
    return false;
  }
}

function _bindCardClicks(body, cars) {
  body.querySelectorAll('.fleet-car[data-car-id]').forEach(el => {
    el.addEventListener('touchstart', () => {
      const car = cars.find(c => c.carId === el.dataset.carId);
      if (!car) return;
      import('../api/car-files.js').then(m => m.listCarFiles(car.carId)).catch(() => {});
    }, { passive: true });

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

      /* ── Обычный тап по карточке → screen-car ── */
      const card = e.target.closest('.fleet-car[data-car-id]');
      if (card && !e.target.closest('.fleet-quick-wrap')) {
        const car = cars.find(c => c.carId === card.dataset.carId);
        if (!car) return;
        document.dispatchEvent(new CustomEvent('car:open', { detail: { carId: car.carId, car } }));
        showScreen('screen-car');
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
    <div class="fleet-bs-change-label">Стоимость аренды</div>
    <div class="fleet-rate-row">
      <div>
        <div class="fleet-rate-val">${fmtRate(car.rateDay)}</div>
        <div class="fleet-rate-sub">текущая ставка</div>
      </div>
      <button type="button" class="fleet-rate-edit" id="fleet-rate-edit">Изменить</button>
    </div>
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
      // Машина в аренде → Простой = приёмка: закрываем аренду через REST, не просто меняем статус
      if (statusKey(car.status) === 'rent' && btn.dataset.newStatus === CAR_STATUSES.IDLE) {
        const b = btn;
        b.disabled = true; b.style.opacity = '0.5';
        try {
          await closeRental(car.carId);
          invalidateCache(SHEETS.CARS);
          invalidateCache(SHEETS.RENTALS);
          invalidateCache(SHEETS.DRIVERS);
          invalidateLocalCache(CACHE_KEYS.CARS);
          invalidateLocalCache(CACHE_KEYS.RENTALS);
          invalidateLocalCache(CACHE_KEYS.DRIVERS);
          invalidateLocalCache(CACHE_KEYS.INCOME_FORM);
          showToast('Машина принята ✓', 'success');
          hideBottomSheet(() => renderFleet());
        } catch (err) {
          b.disabled = false; b.style.opacity = '';
          showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка', 'error');
        }
        return;
      }
      await _changeStatus(car, btn.dataset.newStatus);
    });

    document.getElementById('fleet-rate-edit')?.addEventListener('click', () => {
      _openRateSheet(car);
    });
  }, 0);
}

async function _openDriverSelectSheet(car) {
  invalidateCache(SHEETS.DRIVERS);
  invalidateCache(SHEETS.RENTALS);
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

  const minDateISO = await _getMinDateStartISO(car.carId);
  const maxDateISO = _todayISO();
  const todayISO   = _todayISO();

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
    <label class="add-label" for="fleet-rent-date" style="margin-top:12px;display:block">Дата выдачи</label>
    <input
      id="fleet-rent-date"
      class="field-input"
      type="date"
      value="${todayISO}"
      ${minDateISO ? `min="${minDateISO}"` : ''}
      max="${maxDateISO}"
    />
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

      const dateISO = document.getElementById('fleet-rent-date')?.value || todayISO;

      if (dateISO > maxDateISO) {
        showToast('Дата не может быть в будущем', 'error');
        return;
      }

      if (minDateISO && dateISO < minDateISO) {
        showToast(`Дата не может быть раньше ${_isoToDDMMYYYY(minDateISO)}`, 'error');
        return;
      }

      if (await _hasOpenRental(car.carId)) {
        showToast('Внимание: у машины есть незакрытая аренда', 'warning');
      }

      await _changeStatusWithDriver(car, CAR_STATUSES.RENT, selectedDriverId, dateISO);
    });
  }, 0);
}

async function _changeStatusWithDriver(car, newStatus, driverId, dateStartISO) {
  const btn = document.getElementById('fleet-bs-confirm');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

  try {
    await issueRental({
      car_id: car.carId,
      driver_id: driverId,
      rate_day: car.rateDay,
      date_start: dateStartISO ? _isoToDDMMYYYY(dateStartISO) : _fmtDateForApi(new Date()),
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
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
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

/** Bottom-sheet ввода новой ставки аренды. */
function _openRateSheet(car) {
  const cur = Math.max(0, Number(car.rateDay) || 0);

  showBottomSheet(`
    <div class="fleet-bs-back" id="fleet-rate-back">
      <span>←</span><span>назад</span>
    </div>
    <div class="fleet-bs-title">Новая стоимость аренды</div>
    <div class="fleet-bs-model" style="margin-bottom:16px">
      ${escapeHtml([car.carId, car.name].filter(Boolean).join(' · '))}
    </div>

    <label class="fleet-rate-label">Ставка, ₽ в день</label>
    <div class="fleet-rate-input-wrap">
      <input
        id="fleet-rate-input"
        type="number"
        inputmode="numeric"
        step="50"
        min="0"
        class="fleet-rate-input"
        value="${cur || ''}"
        placeholder="${cur || '0'}"
      />
      <span class="fleet-rate-unit">₽/день</span>
    </div>

    <div class="fleet-rate-delta" id="fleet-rate-delta"></div>

    <div class="fleet-rate-note" id="fleet-rate-active-note" style="display:none">
      <span>ⓘ</span>
      <span>Машина в аренде. Текущая аренда останется на старой ставке — новая применится со следующей сдачи.</span>
    </div>

    <label class="fleet-rate-label">Причина <span class="fleet-rate-opt">(необязательно)</span></label>
    <input
      id="fleet-rate-reason"
      type="text"
      class="fleet-rate-input fleet-rate-input--text"
      placeholder="Сезонный спрос, новый прайс…"
    />

    <button type="button" class="fleet-bs-confirm" id="fleet-rate-save">Сохранить</button>
  `);

  setTimeout(() => {
    const input = document.getElementById('fleet-rate-input');
    const deltaEl = document.getElementById('fleet-rate-delta');
    const activeNote = document.getElementById('fleet-rate-active-note');

    if (statusKey(car.status) === 'rent' && activeNote) {
      activeNote.style.display = 'flex';
    }

    const recalc = () => {
      const v = Math.max(0, parseInt(input.value, 10) || 0);
      if (!deltaEl) return;
      if (!v || v === cur) {
        deltaEl.textContent = cur ? `Текущая ставка: ${fmtRate(cur)}` : '';
        deltaEl.className = 'fleet-rate-delta';
        return;
      }
      const d = v - cur;
      const pct = cur > 0 ? Math.round((d / cur) * 100) : 0;
      const sign = d > 0 ? '+' : '−';
      const pctStr = cur > 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs(pct)}%)` : '';
      deltaEl.textContent =
        `${fmtRuInt(cur)} → ${fmtRuInt(v)} ₽ · ${sign}${fmtRuInt(Math.abs(d))} ₽${pctStr}`;
      deltaEl.className = 'fleet-rate-delta ' + (d > 0 ? 'fleet-rate-delta--up' : 'fleet-rate-delta--down');
    };

    input?.addEventListener('input', recalc);
    recalc();

    document.getElementById('fleet-rate-back')?.addEventListener('click', () => {
      hideBottomSheet(() => { void _openCarSheet(car); });
    });

    document.getElementById('fleet-rate-save')?.addEventListener('click', () => {
      void _saveRate(car, cur);
    });
  }, 0);
}

/** Отправка новой ставки. */
async function _saveRate(car, oldRate) {
  const input = document.getElementById('fleet-rate-input');
  const reasonEl = document.getElementById('fleet-rate-reason');
  const btn = document.getElementById('fleet-rate-save');

  const v = Math.max(0, parseInt(input?.value, 10) || 0);
  if (!v) {
    showToast('Введите ставку', 'error');
    return;
  }
  if (v === oldRate) {
    showToast('Ставка не изменилась', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.textContent = 'Сохраняем…';
  }

  try {
    await updateCarRate({
      car_id:   car.carId,
      new_rate: v,
      old_rate: oldRate,
      reason:   reasonEl?.value?.trim() || '',
    });

    invalidateCache(SHEETS.CARS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    invalidateLocalCache(CACHE_KEYS.INCOME_FORM);

    showToast(`Ставка обновлена · ${fmtRate(v)} ✓`, 'success');
    hideBottomSheet(() => renderFleet());
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.textContent = 'Сохранить';
    }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
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
