/**
 * driver.js — карточка водителя (Сводка / Данные / История).
 */

import {
  getDrivers, getFleet, getDeposits, getRentals, fetchIncomeForm,
  getOperations, postAction, invalidateCache,
} from '../api.js';
import { CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';
import { CAR_STATUSES, SHEETS } from '../config.js';
import { showScreen } from '../router.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { openDriverForm } from './drivers.js';
import { fmtRub, fmtRuInt } from '../utils/format.js';
import {
  isVacationStatus, isArchiveStatus,
  enrichDriver, driverDisplayName, payStateTitle, fmtDdMm,
  buildPaymentContext,
} from '../utils/driver-pay.js';

let _currentDriverId = null;
let _activeTab = 'summary';
/** @type {object|null} */
let _ctx = null;

export function initDriver() {
  document.addEventListener('driver:open', e => {
    _currentDriverId = e.detail?.driverId ?? null;
    _activeTab = 'summary';
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-driver') renderDriver(_currentDriverId);
  });

  document.getElementById('driver-back')?.addEventListener('click', () => {
    showScreen('screen-drivers');
  });
}

export async function renderDriver(driverId) {
  const body   = document.getElementById('driver-body');
  const nameEl = document.getElementById('driver-header-name');
  if (!body) return;

  if (!driverId) {
    if (nameEl) nameEl.textContent = 'Водитель';
    body.innerHTML = _errorHTML('Водитель не найден');
    return;
  }

  body.innerHTML = _skeletonHTML();

  try {
    const [drivers, fleet, deposits, rentals, incomeRows, ops] = await Promise.all([
      getDrivers(),
      getFleet(),
      getDeposits(),
      getRentals(),
      fetchIncomeForm(),
      getOperations(),
    ]);

    const raw = drivers.find(d => String(d.driverId) === String(driverId));
    if (!raw) {
      body.innerHTML = _errorHTML('Водитель не найден');
      return;
    }

    const aux = { fleet, incomeRows, deposits, rentals };
    const driver = enrichDriver(raw, aux);
    _ctx = { driver, fleet, drivers, deposits, rentals, ops, aux };

    const dn = driverDisplayName(driver);
    if (nameEl) nameEl.textContent = dn.muted ? dn.text : (driver.name || driver.driverId);

    body.innerHTML = _bodyHTML(driver);
    _bindTabs(body, driver);
    _bindActions(body, driver);
  } catch {
    body.innerHTML = _errorHTML('Не удалось загрузить данные');
  }
}

function _bodyHTML(driver) {
  const dn = driverDisplayName(driver);
  const statusLine = _statusLine(driver);
  const phoneBtn = driver.phone
    ? `<a class="drv-hero-call btn-icon btn-icon--light" href="tel:${_cleanPhone(driver.phone)}" aria-label="Позвонить">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor"/>
        </svg>
      </a>`
    : '';

  return `
    <div class="drv-hero">
      <div class="drv-hero__avatar">${_initials(driver)}</div>
      <div class="drv-hero__info">
        <div class="drv-hero__name">${_esc(dn.text)}</div>
        <div class="drv-hero__meta">${_esc(statusLine)}</div>
      </div>
      ${phoneBtn}
    </div>

    <div class="drv-content">
      <div class="segment-control drv-tabs" id="driver-tabs">
        <button type="button" class="segment-btn ${_activeTab === 'summary' ? 'segment-btn--active' : ''}" data-tab="summary">Сводка</button>
        <button type="button" class="segment-btn ${_activeTab === 'data' ? 'segment-btn--active' : ''}" data-tab="data">Данные</button>
        <button type="button" class="segment-btn ${_activeTab === 'history' ? 'segment-btn--active' : ''}" data-tab="history">История</button>
      </div>
      <div id="driver-tab-panel">${_tabPanelHTML(driver, _activeTab)}</div>
    </div>
  `;
}

function _tabPanelHTML(driver, tab) {
  if (tab === 'data') return _dataTabHTML(driver);
  if (tab === 'history') return _historyTabHTML(driver);
  return _summaryTabHTML(driver);
}

function _summaryTabHTML(driver) {
  const payMeta = driver.onRent && driver.payState
    ? `<div class="drv-pay-block__meta">до ${driver.paidUntil ? _esc(fmtDdMm(driver.paidUntil)) : '—'} · ${fmtRuInt(driver.rateDay)} ₽/день</div>`
    : '';

  const payState = driver.onRent && driver.payState ? driver.payState : 'neutral';
  const payTitle = driver.onRent && driver.payState
    ? payStateTitle(driver.payState)
    : (driver.carId ? 'Нет данных об оплате' : 'Машина не назначена');

  const payBtn = driver.onRent
    ? `<button type="button" class="btn-primary" id="driver-pay-btn">Принять платёж</button>`
    : '';

  const totalPaid = _totalRentPaid(driver);
  const deposit = driver.deposit;

  const secondaryBtns = isVacationStatus(driver.status)
    ? `<button type="button" class="drv-btn drv-btn--dark" id="driver-give-car">Выдать машину</button>`
    : `<button type="button" class="drv-btn drv-btn--dark" id="driver-return-car">Принять авто</button>
       <button type="button" class="drv-btn drv-btn--dark" id="driver-vacation">В отпуск</button>`;

  return `
    <div class="drv-tab-stack drv-tab-stack--summary">
      <div class="drv-card drv-pay-block drv-pay-block--${payState}">
        <div class="drv-pay-block__title">${_esc(payTitle)}</div>
        ${payMeta}
      </div>
      ${payBtn}
      <div class="summary-grid drv-summary-grid">
        <div class="summary-card drv-card">
          <div class="summary-card__label">Депозит</div>
          <div class="summary-card__value">${fmtRub(deposit)}</div>
          ${deposit > 0 ? `<button type="button" class="drv-deposit-return" id="driver-deposit-return">Вернуть</button>` : ''}
        </div>
        <div class="summary-card drv-card">
          <div class="summary-card__label">Оплачено всего</div>
          <div class="summary-card__value">${fmtRub(totalPaid.amount)}</div>
          <div class="summary-card__delta">${totalPaid.days} дн.</div>
        </div>
      </div>
      <div class="drv-secondary-actions">${secondaryBtns}</div>
    </div>
  `;
}

function _dataTabHTML(driver) {
  const missing = [];
  if (!String(driver.name || '').trim()) missing.push('ФИО');
  if (!String(driver.phone || '').trim()) missing.push('телефон');
  if (!String(driver.license || '').trim()) missing.push('ВУ');

  const banner = missing.length
    ? `<div class="drv-info-banner">
        <span>Не заполнено: ${missing.join(', ')}</span>
        <button type="button" class="drv-info-banner__btn" id="driver-fill-btn">Заполнить</button>
      </div>`
    : '';

  const field = (lbl, val, isLink = false) => {
    const empty = !String(val || '').trim();
    const content = empty
      ? `<span class="drv-field__empty">не указано</span>`
      : isLink
        ? `<a href="tel:${_cleanPhone(val)}" class="drv-field__link">${_esc(formatPhoneRu(val))}</a>`
        : `<span>${_esc(val)}</span>`;
    return `<div class="drv-field"><div class="drv-field__lbl">${lbl}</div><div class="drv-field__val">${content}</div></div>`;
  };

  return `
    <div class="drv-tab-stack drv-tab-stack--data">
      ${banner}
      <div class="drv-card drv-fields-card">
        <div class="drv-fields">
          ${field('ФИО', driver.name)}
          ${field('Телефон', driver.phone, true)}
          ${field('Машина', driver.carId || '')}
          ${field('ВУ', driver.license)}
          ${field('Комментарий', driver.note)}
        </div>
      </div>
      <button type="button" class="drv-btn drv-btn--blue drv-edit-btn" id="driver-edit">Редактировать</button>
    </div>
  `;
}

const _MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function _historyTabHTML(driver) {
  const events = _buildTimeline(driver);
  if (!events.length) {
    return `<div class="drv-tab-stack"><div class="drv-empty">Событий пока нет</div></div>`;
  }

  const groups = [];
  let currentKey = null;
  for (const ev of events) {
    const d = new Date(ev.ts);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== currentKey) {
      groups.push({ key, label: _MONTH_LABELS[d.getMonth()], items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(ev);
  }

  const groupsHtml = groups.map(g => `
    <div class="drv-history-group">
      <div class="section-label drv-history-label">${_esc(g.label)}</div>
      <div class="drv-card drv-timeline-card">
        <div class="drv-timeline">${g.items.map(ev => {
          const amtClass = ev.amountKind ? ` drv-timeline__amt--${ev.amountKind}` : '';
          return `
          <div class="drv-timeline__item">
            <div class="drv-timeline__dot drv-timeline__dot--${ev.kind}"></div>
            <div class="drv-timeline__body">
              <div class="drv-timeline__date">${_esc(ev.dateStr)}</div>
              <div class="drv-timeline__desc">${_esc(ev.desc)}</div>
              ${ev.amount != null ? `<div class="drv-timeline__amt${amtClass}">${fmtRub(ev.amount)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}</div>
      </div>
    </div>
  `).join('');

  return `<div class="drv-tab-stack drv-tab-stack--history">${groupsHtml}</div>`;
}

function _bindTabs(body, driver) {
  body.querySelectorAll('#driver-tabs [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (!tab || tab === _activeTab) return;
      _activeTab = tab;
      body.querySelectorAll('#driver-tabs .segment-btn').forEach(b =>
        b.classList.toggle('segment-btn--active', b.dataset.tab === tab));
      const panel = body.querySelector('#driver-tab-panel');
      if (panel) panel.innerHTML = _tabPanelHTML(driver, tab);
      _bindActions(body, driver);
    });
  });
}

function _bindActions(body, driver) {
  body.querySelector('#driver-pay-btn')?.addEventListener('click', () => {
    if (!driver.onRent || !driver.carId) return;
    showScreen('screen-income', {
      paymentContext: buildPaymentContext(driver),
      returnTo: 'screen-driver',
    });
  });

  body.querySelector('#driver-deposit-return')?.addEventListener('click', () => {
    _openReturnSheet(driver, driver.deposit);
  });

  body.querySelector('#driver-edit')?.addEventListener('click', () => _openForm(driver));
  body.querySelector('#driver-fill-btn')?.addEventListener('click', () => _openForm(driver));

  body.querySelector('#driver-return-car')?.addEventListener('click', () => {
    showToast('Скоро: приём авто', 'warning'); // TODO: связать с флоу возврата из аренды
  });
  body.querySelector('#driver-vacation')?.addEventListener('click', () => {
    showToast('Скоро: перевод в отпуск', 'warning'); // TODO: SAVE_DRIVER status=в отпуске
  });
  body.querySelector('#driver-give-car')?.addEventListener('click', () => {
    showToast('Скоро: выдача машины', 'warning'); // TODO: флоу выдачи
  });

  body.querySelector('#driver-archive')?.addEventListener('click', () => _archiveDriver(driver));
}

async function _openForm(driver) {
  const ctx = _ctx;
  if (!ctx) return;
  openDriverForm(driver, ctx.fleet, ctx.drivers);
  document.addEventListener('bottomsheet:closed', () => renderDriver(driver.driverId), { once: true });
}

async function _archiveDriver(driver) {
  if (!confirm('Перевести водителя в архив?')) return;
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
    invalidateCache(SHEETS.DRIVERS);
    invalidateLocalCache(CACHE_KEYS.DRIVERS);
    showToast('Водитель архивирован', 'success');
    showScreen('screen-drivers');
  } catch (err) {
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка', 'error');
  }
}

function _statusLine(driver) {
  const id = driver.driverId || '';
  if (isArchiveStatus(driver.status)) return `${id} · в архиве`;
  if (isVacationStatus(driver.status)) return `${id} · в отпуске`;
  if (driver.activeRental?.dateStart instanceof Date) {
    return `${id} · на аренде с ${fmtDdMm(driver.activeRental.dateStart)}`;
  }
  if (driver.carId) return `${id} · ${driver.carId}`;
  return `${id} · без машины`;
}

function _totalRentPaid(driver) {
  const ops = (_ctx?.ops || []).filter(op =>
    String(op.driverId || '') === String(driver.driverId) &&
    op.type === 'аренда' &&
    op.direction === 'приход'
  );
  const amount = ops.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  const rate = driver.rateDay || 1;
  const days = rate > 0 ? Math.round(amount / rate) : 0;
  return { amount, days };
}

function _buildTimeline(driver) {
  const events = [];
  const did = String(driver.driverId);

  (_ctx?.deposits || [])
    .filter(d => String(d.driverId) === did)
    .forEach(d => {
      const isIn = Number(d.amount) >= 0;
      events.push({
        ts: _parseDate(d.date),
        dateStr: _fmtDate(d.date),
        desc: isIn ? 'Пополнение депозита' : 'Возврат депозита',
        amount: d.amount,
        kind: isIn ? 'deposit-in' : 'deposit-out',
        amountKind: isIn ? 'in' : 'out',
      });
    });

  (_ctx?.rentals || [])
    .filter(r => String(r.driverId) === did)
    .forEach(r => {
      if (r.dateStart instanceof Date && !Number.isNaN(r.dateStart.getTime())) {
        events.push({
          ts: r.dateStart.getTime(),
          dateStr: fmtDdMm(r.dateStart),
          desc: `Выдача · ${r.carId || ''}`,
          amount: null,
          kind: 'neutral',
        });
      }
      if (r.dateEnd instanceof Date && !Number.isNaN(r.dateEnd.getTime())) {
        events.push({
          ts: r.dateEnd.getTime(),
          dateStr: fmtDdMm(r.dateEnd),
          desc: `Окончание аренды · ${r.carId || ''}`,
          amount: null,
          kind: 'neutral',
        });
      }
    });

  return events.sort((a, b) => b.ts - a.ts);
}

function formatPhoneRu(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  let n = d;
  if (n.length === 10 && n[0] === '9') n = '7' + n;
  if (n.length === 11 && n[0] === '8') n = '7' + n.slice(1);
  if (n.length !== 11 || n[0] !== '7') return String(raw || '').trim() || '—';
  return `+7 ${n.slice(1, 4)} ${n.slice(4, 7)}-${n.slice(7, 9)}-${n.slice(9, 11)}`;
}

function _openReturnSheet(driver, currentDeposit) {
  showBottomSheet(`
    <div class="drv-return-sheet">
      <div class="drv-return-title">Возврат депозита</div>
      <div class="drv-return-sub">${_esc(driver.name || driver.driverId)} · остаток ${fmtRub(currentDeposit)}</div>
      <div class="drv-return-field">
        <label class="drv-return-label">Сумма возврата, ₽</label>
        <input id="drv-return-amount" type="number" inputmode="numeric" class="drv-return-input" min="1" max="${currentDeposit}" />
        <div class="drv-return-err hidden" id="drv-return-err"></div>
      </div>
      <div class="drv-return-field">
        <label class="drv-return-label">Комментарий</label>
        <input id="drv-return-comment" type="text" class="drv-return-input" placeholder="Причина" />
      </div>
      <button type="button" class="drv-return-submit" id="drv-return-submit" disabled>Вернуть</button>
    </div>
  `);

  setTimeout(() => {
    const amountInput = document.getElementById('drv-return-amount');
    const errEl = document.getElementById('drv-return-err');
    const submitBtn = document.getElementById('drv-return-submit');

    amountInput?.addEventListener('input', () => {
      const val = parseFloat(amountInput.value) || 0;
      errEl?.classList.add('hidden');
      if (val <= 0 || val > currentDeposit) {
        submitBtn.disabled = true;
        if (val > currentDeposit) {
          errEl.textContent = `Максимум ${fmtRub(currentDeposit)}`;
          errEl.classList.remove('hidden');
        }
        return;
      }
      submitBtn.disabled = false;
      submitBtn.textContent = `Вернуть ${fmtRub(val)}`;
    });

    submitBtn?.addEventListener('click', async () => {
      const val = parseFloat(amountInput?.value) || 0;
      if (val <= 0 || val > currentDeposit) return;
      submitBtn.disabled = true;
      try {
        await postAction('ADD_DEPOSIT', {
          driver_id: driver.driverId,
          car_id:    driver.currentCar || driver.carId || '',
          amount:    -Math.round(val),
          comment:   document.getElementById('drv-return-comment')?.value.trim() || 'Возврат депозита',
        });
        invalidateCache(SHEETS.DRIVERS);
        invalidateCache(SHEETS.DEPOSITS);
        invalidateLocalCache(CACHE_KEYS.DRIVERS);
        invalidateLocalCache(CACHE_KEYS.DEPOSITS);
        showToast(`Возврат ${fmtRub(val)} записан ✓`, 'success');
        hideBottomSheet(() => renderDriver(driver.driverId));
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка', 'error');
      }
    });
  }, 0);
}

function _skeletonHTML() {
  return `<div class="drv-skeleton"><div class="skel skel--hero"></div><div class="skel skel--row"></div><div class="skel skel--row"></div></div>`;
}

function _errorHTML(msg) {
  return `<div class="drv-empty">${_esc(msg)}</div>`;
}

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _initials(d) {
  const name = String(d.name || '').trim();
  if (name) return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
  return String(d.carId || d.driverId || '?').slice(0, 2).toUpperCase();
}
function _cleanPhone(p) { return (p ?? '').replace(/[^\d+]/g, ''); }
function _parseDate(s) {
  if (!s) return 0;
  if (s instanceof Date) return s.getTime();
  const [d, m, y] = String(s).split('.');
  if (y) return new Date(+y, +m - 1, +d).getTime();
  return new Date(s).getTime() || 0;
}
function _fmtDate(val) {
  if (!val) return '—';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return fmtDdMm(d);
}
