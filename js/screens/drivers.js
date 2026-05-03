/**
 * drivers.js — экран «Водители» (GET_DRIVERS): табы, карточки Т-Банка, просмотр.
 * Форма редактирования — openDriverForm (экран карточки водителя).
 */

import { getDrivers, getFleet, postAction, invalidateCache } from '../api.js';
import { showScreen } from '../router.js?v=7';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { CAR_STATUSES, SHEETS } from '../config.js';

const TABS = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'active', label: 'Активные', match: s => isActiveStatus(s) },
  { id: 'archive', label: 'Архив', match: s => isArchiveStatus(s) },
];

let _pendingTab = null;
let _lastDrivers = [];
let _activeTab = 'all';

function isActiveStatus(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('актив') && !s.includes('архив');
}

function isArchiveStatus(raw) {
  return String(raw || '').toLowerCase().includes('архив');
}

function activeCountLabel(n) {
  const k = Math.abs(n) % 100;
  const d = n % 10;
  if (k > 10 && k < 20) return `${n} активных`;
  if (d === 1) return `${n} активный`;
  return `${n} активных`;
}

const nfRub = new Intl.NumberFormat('ru-RU');

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

function depositStyle(deposit) {
  const x = Number(deposit) || 0;
  if (x > 0) return '***REMOVED***2E7D32';
  if (x < 0) return '***REMOVED***C62828';
  return '***REMOVED***757575';
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

  body.innerHTML = _skeletonHTML();

  let drivers;
  try {
    drivers = await getDrivers();
  } catch {
    body.innerHTML = _errorHTML();
    document.getElementById('drivers-retry')?.addEventListener('click', () => renderDrivers());
    return;
  }

  _lastDrivers = drivers;
  _paint(body, drivers, _activeTab);
}

function _paint(body, drivers, tabId) {
  const activeN = drivers.filter(d => isActiveStatus(d.status)).length;

  const filtered = drivers.filter(c => {
    const tab = TABS.find(t => t.id === tabId) ?? TABS[0];
    return tab.match(c.status);
  });

  body.innerHTML = `
    <div class="drivers-page">
      <header class="drivers-page__header">
        <h1 class="drivers-page__title">Водители</h1>
        <span class="drivers-page__count">${activeCountLabel(activeN)}</span>
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
  const depStr = `${nfRub.format(dep)} ₽`;
  const depCol = depositStyle(dep);
  const car = d.currentCar || d.carId;
  const carStr = car ? escapeHtml(String(car)) : '—';
  const carCol = car ? '***REMOVED***2E7D32' : '***REMOVED***757575';
  const note = String(d.note || '').trim();

  return `
    <article class="drivers-card" data-driver-id="${escapeAttr(d.driverId)}">
      <div class="drivers-card__top">
        <div class="drivers-card__id-block">
          <div class="drivers-card__name">${escapeHtml(d.fio || '—')}</div>
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
          <div class="drivers-card__lbl">ВУ</div>
          <div class="drivers-card__val">${escapeHtml(d.vu || '—')}</div>
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
  return escapeHtml(s).replace(/'/g, '&***REMOVED***39;');
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
        ${[1, 2, 3, 4].map(() => `
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
  const freeCars = fleet.filter(c => c.status === CAR_STATUSES.IDLE);
  const title = isEdit ? 'Редактировать водителя' : 'Новый водитель';
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

async function _saveDriver(existing, fleet, drivers) {
  const fio = document.getElementById('drv-fio')?.value.trim();
  const phone = document.getElementById('drv-phone')?.value.trim();
  const carId = document.getElementById('drv-car')?.value;
  const deposit = parseFloat(document.getElementById('drv-deposit')?.value) || 0;
  const hiredISO = document.getElementById('drv-hired')?.value;
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
      vu: '',
      car_id: carId,
      status: existing?.status ?? 'активен',
      comment: note,
    });

    if (carId) {
      await postAction('UPDATE_CAR_STATUS', {
        car_id: carId,
        new_status: CAR_STATUSES.RENT,
      }).catch(() => {});
    }

    if (!existing && deposit > 0) {
      await postAction('ADD_DEPOSIT', {
        driver_id: res.driver_id,
        car_id: carId,
        amount: deposit,
        comment: 'Начальный депозит',
      }).catch(() => {});
    }

    invalidateCache(SHEETS.DRIVERS);
    invalidateCache(SHEETS.CARS);
    showToast(existing ? 'Изменения сохранены ✓' : 'Водитель добавлен ✓', 'success');
    hideBottomSheet(() => renderDrivers());
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
  }
}

function _esc(s) {
  return String(s).replace(/"/g, '&quot;');
}

function _ddmmyyyyToISO(s) {
  if (!s) return '';
  const [d, m, y] = s.split('.');
  return `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`;
}
