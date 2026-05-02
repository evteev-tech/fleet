/**
 * fleet.js — экран «Парк»: данные GET_FLEET, фильтр по статусу, карточки Т-Банка.
 */

import { getFleet, postAction, invalidateCache } from '../api.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { CAR_STATUSES, SHEETS } from '../config.js';

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
let _activeTab = 'all';

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

const nfInt = new Intl.NumberFormat('ru-RU');
const nfMoney = new Intl.NumberFormat('ru-RU');

function fmtKm(n) {
  return `${nfInt.format(Math.max(0, Math.round(n)))} км`;
}

function fmtRate(n) {
  return `${nfMoney.format(Math.max(0, Number(n) || 0))} ₽/день`;
}

function fmtBuyDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU');
}

const TO_MILEAGE_COLOR_HEX = {
  red: '***REMOVED***C62828',
  yellow: '***REMOVED***F57F17',
  green: '***REMOVED***2E7D32',
  gray: '***REMOVED***9E9E9E',
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
    return { text: new Intl.NumberFormat('ru-RU').format(diff) + ' км', color: 'red' };
  }

  if (diff < 3000) {
    return { text: new Intl.NumberFormat('ru-RU').format(diff) + ' км', color: 'yellow' };
  }

  return { text: new Intl.NumberFormat('ru-RU').format(diff) + ' км', color: 'green' };
}

export function initFleet() {
  document.addEventListener('fleet:filter', e => {
    const st = e.detail?.status;
    _pendingTab =
      st === CAR_STATUSES.RENT ? 'rent' :
      st === CAR_STATUSES.REPAIR ? 'repair' :
      st === CAR_STATUSES.IDLE ? 'idle' : null;
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

  body.innerHTML = _skeletonHTML();

  let fleet;
  try {
    fleet = await getFleet();
  } catch {
    body.innerHTML = _errorHTML();
    document.getElementById('fleet-retry')?.addEventListener('click', () => renderFleet());
    return;
  }

  _lastFleet = fleet;
  _paint(body, fleet, _activeTab);
}

function _paint(body, fleet, tabId) {
  const filtered = fleet.filter(c => {
    const tab = TABS.find(t => t.id === tabId) ?? TABS[0];
    return tab.match(c.status);
  });

  body.innerHTML = `
    <div class="fleet-page">
      <header class="fleet-page__header">
        <h1 class="fleet-page__title">Парк</h1>
        <span class="fleet-page__count">${pluralCars(fleet.length)}</span>
      </header>

      <div class="fleet-page__tabs">
        ${TABS.map(t => `
          <button type="button" class="fleet-tab ${t.id === tabId ? 'fleet-tab--active' : ''}"
            data-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>

      <div class="fleet-page__body" id="fleet-list-root">
        ${_listHTML(filtered, fleet.length === 0)}
      </div>
    </div>
  `;

  body.querySelectorAll('.fleet-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      if (!id || id === _activeTab) return;
      _activeTab = id;
      body.querySelectorAll('.fleet-tab').forEach(b =>
        b.classList.toggle('fleet-tab--active', b.dataset.tab === id));
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
  const title = [car.name, car.color].filter(Boolean).join(' · ');
  const toInfo = formatToMileage(car.mileage, car.toMileage);
  const toHex = TO_MILEAGE_COLOR_HEX[toInfo.color] ?? '***REMOVED***9E9E9E';
  const note = String(car.note || '').trim();

  return `
    <article class="fleet-car" data-car-id="${escapeAttr(car.carId)}">
      <div class="fleet-car__top">
        <div class="fleet-car__id-block">
          <div class="fleet-car__plate">${escapeHtml(car.carId)}</div>
          ${title ? `<div class="fleet-car__subtitle">${escapeHtml(title)}</div>` : ''}
        </div>
        <span class="fleet-car__badge ${badge.class}">${badge.label}</span>
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
  return escapeHtml(s).replace(/'/g, '&***REMOVED***39;');
}

function _bindCardClicks(body, cars) {
  body.querySelectorAll('.fleet-car[data-car-id]').forEach(el => {
    el.addEventListener('click', () => {
      const car = cars.find(c => c.carId === el.dataset.carId);
      if (car) _openCarSheet(car);
    });
  });
}

function _statusApiFromKey(key) {
  if (key === 'rent') return CAR_STATUSES.RENT;
  if (key === 'repair') return CAR_STATUSES.REPAIR;
  return CAR_STATUSES.IDLE;
}

function _pillClass(sk) {
  if (sk === 'rent') return 'pill--green';
  if (sk === 'repair') return 'pill--red';
  return 'pill--yellow';
}

function _openCarSheet(car) {
  const sk = statusKey(car.status);
  const opts = ['rent', 'idle', 'repair'].filter(k => k !== sk);

  const statusBtns = opts.map(k => {
    const api = _statusApiFromKey(k);
    const lbl = BADGE[k].label;
    return `<button type="button" class="fleet-status-btn" data-new-status="${escapeAttr(api)}">${lbl}</button>`;
  }).join('');

  showBottomSheet(`
    <div class="fleet-bs-hero">
      <div class="fleet-bs-plate">${escapeHtml(car.carId)}</div>
      ${car.name || car.color ? `
        <div class="fleet-bs-model">${escapeHtml([car.name, car.color].filter(Boolean).join(' · '))}</div>
      ` : ''}
      <span class="pill ${_pillClass(sk)}">${BADGE[sk].label}</span>
    </div>
    <div class="fleet-bs-change-label">Изменить статус</div>
    <div class="fleet-status-btns" id="fleet-status-btns">${statusBtns}</div>
  `);

  setTimeout(() => {
    document.getElementById('fleet-status-btns')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-new-status]');
      if (!btn) return;
      await _changeStatus(car, btn.dataset.newStatus);
    });
  }, 0);
}

async function _changeStatus(car, newStatus) {
  const btns = document.querySelectorAll('***REMOVED***fleet-status-btns .fleet-status-btn');
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  try {
    await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: newStatus });
    invalidateCache(SHEETS.CARS);
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
      <header class="fleet-page__header fleet-page__header--skel">
        <div class="skeleton skeleton-line" style="width:100px;height:24px"></div>
        <div class="skeleton skeleton-line" style="width:90px;height:14px"></div>
      </header>
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
