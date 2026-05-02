/**
 * fleet.js — экран парка машин.
 *
 * Загружает getFleet() + getDrivers() + getRentals().
 * Три секции: В аренде / Ремонт / Простой.
 * Клик → bottomsheet с деталями + смена статуса.
 * При fleet:filter событии — скроллим к нужной секции.
 */

import { getFleet, getDrivers, getRentals, postAction, invalidateCache } from '../api.js';
import { showBottomSheet, hideBottomSheet, showToast }                    from '../ui.js';
import { CAR_STATUSES }                                                    from '../config.js';

// ─── Конфиг секций ────────────────────────────────────────────────────────────
const SECTIONS = [
  { status: CAR_STATUSES.RENT,   label: 'В аренде',   pill: 'pill--green',  id: 'fleet-sec-rent'   },
  { status: CAR_STATUSES.REPAIR, label: 'На ремонте', pill: 'pill--orange', id: 'fleet-sec-repair' },
  { status: CAR_STATUSES.IDLE,   label: 'Простой',    pill: 'pill--muted',  id: 'fleet-sec-idle'   },
];

// Отложенный скролл-фильтр из события fleet:filter
let _pendingFilter = null;

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initFleet() {
  document.addEventListener('fleet:filter', e => {
    _pendingFilter = e.detail?.status ?? null;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-fleet') renderFleet();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export async function renderFleet() {
  const body = document.getElementById('fleet-body');
  if (!body) return;

  body.innerHTML = _skeletonHTML();

  let fleet, drivers, rentals;
  try {
    [fleet, drivers, rentals] = await Promise.all([
      getFleet(), getDrivers(), getRentals(),
    ]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('fleet-retry')?.addEventListener('click', renderFleet);
    return;
  }

  // ── Обогащаем машины: имя водителя + дата аренды ──────────────────────────
  const enriched = fleet.map(car => {
    const driver  = drivers.find(d => d.carId === car.carId || d.fio === car.driver) ?? null;
    const rental  = _activeRental(rentals, car.carId);
    return { ...car, _driver: driver, _rental: rental };
  });

  // Считаем по статусам
  const counts = {};
  SECTIONS.forEach(s => { counts[s.status] = enriched.filter(c => c.status === s.status).length; });
  const total = enriched.length;

  body.innerHTML = `
    <!-- ХЕДЕР -->
    <div class="fleet-hdr">
      <div class="fleet-hdr__top">
        <span class="app-logo">Парк</span>
        <span class="fleet-hdr__total">${total} авто</span>
      </div>
      <div class="fleet-counters">
        <div class="fleet-counter fleet-counter--yellow">
          <span class="fleet-counter__num">${counts[CAR_STATUSES.RENT] ?? 0}</span>
          <span class="fleet-counter__lbl">В аренде</span>
        </div>
        <div class="fleet-counter fleet-counter--ghost">
          <span class="fleet-counter__num">${counts[CAR_STATUSES.REPAIR] ?? 0}</span>
          <span class="fleet-counter__lbl">Ремонт</span>
        </div>
        <div class="fleet-counter fleet-counter--ghost">
          <span class="fleet-counter__num">${counts[CAR_STATUSES.IDLE] ?? 0}</span>
          <span class="fleet-counter__lbl">Простой</span>
        </div>
      </div>
    </div>

    <!-- СЕКЦИИ -->
    <div class="fleet-sections">
      ${SECTIONS.map(sec => {
        const cars = enriched.filter(c => c.status === sec.status);
        if (!cars.length) return '';
        return `
          <div class="fleet-section-wrap" id="${sec.id}">
            <div class="fleet-sec-title">${sec.label} <span class="fleet-sec-count">${cars.length}</span></div>
            <div class="fleet-card">
              ${cars.map(car => _carRowHTML(car, sec)).join('')}
            </div>
          </div>
        `;
      }).join('')}

      ${enriched.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__icon">🚗</div>
          <div class="empty-state__text">Парк пуст</div>
        </div>
      ` : ''}
    </div>
  `;

  // ── Клики по строкам ──────────────────────────────────────────────────────
  body.querySelectorAll('[data-car-id]').forEach(row => {
    row.addEventListener('click', () => {
      const car = enriched.find(c => c.carId === row.dataset.carId);
      if (car) _showCarSheet(car, enriched);
    });
  });

  // ── Скролл к секции если был fleet:filter ────────────────────────────────
  if (_pendingFilter) {
    const sec = SECTIONS.find(s => s.status === _pendingFilter);
    if (sec) {
      setTimeout(() => {
        document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
    _pendingFilter = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTTOMSHEET: детали + смена статуса
// ═══════════════════════════════════════════════════════════════════════════

function _showCarSheet(car, enriched) {
  const sec      = SECTIONS.find(s => s.status === car.status) ?? SECTIONS[2];
  const drvName  = car._driver?.fio ?? '—';
  const rentEnd  = car._rental ? _formatRentDate(car._rental.dateEnd) : null;

  const statusBtns = SECTIONS
    .filter(s => s.status !== car.status)
    .map(s => `
      <button class="fleet-status-btn" data-new-status="${s.status}">
        <span class="pill ${s.pill}">${s.label}</span>
      </button>
    `).join('');

  showBottomSheet(`
    <div class="fleet-bs-hero">
      <div class="fleet-bs-plate">${car.carId}</div>
      ${car.name ? `<div class="fleet-bs-model">${car.name}${car.color ? ' · ' + car.color : ''}</div>` : ''}
      <span class="pill ${sec.pill} fleet-bs-status">${sec.label}</span>
    </div>

    <div class="bs-op-fields" style="margin-bottom:20px">
      <div class="bs-op-field">
        <span class="bs-op-field__lbl">Водитель</span>
        <span class="bs-op-field__val">${drvName}</span>
      </div>
      ${rentEnd ? `
        <div class="bs-op-field">
          <span class="bs-op-field__lbl">Аренда до</span>
          <span class="bs-op-field__val">${rentEnd}</span>
        </div>
      ` : ''}
      ${car.mileage ? `
        <div class="bs-op-field">
          <span class="bs-op-field__lbl">Пробег</span>
          <span class="bs-op-field__val">${car.mileage.toLocaleString('ru-RU')} км</span>
        </div>
      ` : ''}
      ${car.rateDay ? `
        <div class="bs-op-field">
          <span class="bs-op-field__lbl">Ставка/день</span>
          <span class="bs-op-field__val">${car.rateDay.toLocaleString('ru-RU')} ₸</span>
        </div>
      ` : ''}
    </div>

    <div class="fleet-bs-change-label">Изменить статус</div>
    <div class="fleet-status-btns" id="fleet-status-btns">
      ${statusBtns}
    </div>
  `);

  // Слушатель кнопок смены статуса
  setTimeout(() => {
    document.getElementById('fleet-status-btns')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-new-status]');
      if (!btn) return;
      await _changeStatus(car, btn.dataset.newStatus, enriched);
    });
  }, 0);
}

async function _changeStatus(car, newStatus, enriched) {
  const btns = document.querySelectorAll('.fleet-status-btn');
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  try {
    await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: newStatus });
    invalidateCache('Машины');
    showToast('Статус обновлён ✓', 'success');
    hideBottomSheet(() => renderFleet());
  } catch (err) {
    btns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка обновления', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕНДЕР-ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

function _carRowHTML(car, sec) {
  const drvName = car._driver?.fio ?? '—';
  return `
    <div class="fleet-row" data-car-id="${car.carId}">
      <div class="fleet-row__body">
        <div class="fleet-row__plate">${car.carId}</div>
        <div class="fleet-row__driver">${drvName}</div>
      </div>
      <span class="pill ${sec.pill}">${sec.label}</span>
    </div>
  `;
}

function _skeletonHTML() {
  const ln = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:6px"></div>`;
  return `
    <div class="fleet-hdr fleet-hdr--skeleton">
      ${ln(25)} ${ln(45)}
      <div style="display:flex;gap:8px;margin-top:8px">
        ${[0,1,2].map(() => `<div class="skeleton" style="height:60px;flex:1;border-radius:12px"></div>`).join('')}
      </div>
    </div>
    <div class="fleet-sections">
      ${[0,1,2].map(() => `
        <div style="margin-bottom:16px">
          ${ln(30)}
          <div class="fleet-card">
            ${[0,1,2,3].map(() => `
              <div class="fleet-row" style="pointer-events:none">
                <div style="flex:1">${ln(50)}${ln(35)}</div>
                <div class="skeleton skeleton-line" style="width:60px"></div>
              </div>
            `).join('')}
          </div>
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
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="fleet-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════════════════

/** Находит активную (или последнюю) аренду для машины */
function _activeRental(rentals, carId) {
  const today = new Date();
  const carRentals = rentals
    .filter(r => r.carId === carId)
    .sort((a, b) => _dateTs(b.dateEnd) - _dateTs(a.dateEnd));

  // Сначала ищем активную (dateEnd >= сегодня)
  const active = carRentals.find(r => r.dateEnd && _dateTs(r.dateEnd) >= today.getTime());
  return active ?? carRentals[0] ?? null;
}

function _dateTs(date) {
  if (!date) return 0;
  if (date instanceof Date) return isNaN(date) ? 0 : date.getTime();
  return 0;
}

function _formatRentDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return null;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
