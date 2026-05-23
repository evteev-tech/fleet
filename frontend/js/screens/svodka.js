/**
 * svodka.js — экран «Сводка» (матрица машина × день месяца).
 * Точка входа для роли investor.
 */

import { getSvodka } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js';
import { KASSA_ID, ROLES } from '../config.js';
import { fmtRuInt } from '../utils/format.js';
import { formatAmount } from './dashboard.js';

const _now = new Date();
let _month = _now.getMonth() + 1;
let _year  = _now.getFullYear();

const ROLE_TO_KASSA = {
  [ROLES.MECHANIC]:   KASSA_ID.AZAMAT,
  [ROLES.OPERATIONS]: KASSA_ID.VLADIMIR,
  [ROLES.INVESTOR]:   KASSA_ID.YULIA,
};

const KASSA_COLORS = {
  [KASSA_ID.AZAMAT]:   'var(--color-yellow)',
  [KASSA_ID.VLADIMIR]: 'var(--color-blue)',
  [KASSA_ID.YULIA]:    'var(--color-orange)',
};

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const STATUS_LABEL = {
  idle: 'простой',
  repair: 'ремонт',
};

function _monthLabel() {
  let s = new Date(_year, _month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
  if (!/\sг\.?$/.test(s)) s += ' г.';
  return s;
}

function _cacheKey() {
  return `${CACHE_KEYS.SVODKA}_${_year}_${_month}`;
}

function _fillUserHeader() {
  const user = getCurrentUser();
  const av = document.getElementById('svodkaAvatar');
  if (!av) return;
  av.textContent = (user?.name ?? '?')[0].toUpperCase();
  const kassaId = ROLE_TO_KASSA[user?.role];
  const color = kassaId ? KASSA_COLORS[kassaId] : null;
  av.style.background = color || 'var(--color-yellow)';
  av.style.color = kassaId === KASSA_ID.AZAMAT ? 'var(--color-dark)' : '#fff';
}

function _updateNextBtn() {
  const btn = document.getElementById('svodkaMonthNext');
  if (!btn) return;
  const isCurrentMonth = _month === _now.getMonth() + 1 && _year === _now.getFullYear();
  btn.disabled = isCurrentMonth;
  btn.classList.toggle('period-switcher__btn--disabled', isCurrentMonth);
}

function _refreshMonthUI() {
  const ml = document.getElementById('svodkaMonthLabel');
  if (ml) ml.textContent = _monthLabel();
  _updateNextBtn();
}

function _setHeaderSkeleton(on) {
  ['svodkaIncome', 'svodkaExpense', 'svodkaNet', 'svodkaLoad'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (on) {
      el.innerHTML = '<span class="svodka-skeleton skeleton"></span>';
    }
  });
}

function _paintHeader(totals) {
  const inc = document.getElementById('svodkaIncome');
  const exp = document.getElementById('svodkaExpense');
  const net = document.getElementById('svodkaNet');
  const load = document.getElementById('svodkaLoad');
  if (inc) inc.textContent = `+${fmtRuInt(totals?.income ?? 0)} ₽`;
  if (exp) exp.textContent = `−${fmtRuInt(totals?.expense ?? 0)} ₽`;
  if (net) net.textContent = formatAmount(totals?.net ?? 0);
  if (load) load.textContent = `${totals?.loadPercent ?? 0}%`;
}

function _weekday(year, month, day) {
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
}

function _incomeCell(day) {
  if (day.income > 0) {
    return `<span class="in-val">${fmtRuInt(day.income)}</span>`;
  }
  if (day.status === 'rent') return '';
  const label = STATUS_LABEL[day.status];
  return label ? `<span class="in-lbl">${label}</span>` : '';
}

function _expenseCell(day) {
  if (day.expense > 0) {
    const tag = day.expenseTag
      ? `<span class="out-tag">${day.expenseTag}</span>`
      : '';
    return `${tag}<span class="out-val">${fmtRuInt(day.expense)}</span>`;
  }
  return '<span class="out-dot">·</span>';
}

function _matrixHTML(svodka) {
  const { year, month, daysInMonth, cars, park } = svodka;

  const carHeaders = cars.map(car => `
    <div class="mh-group pin" style="--car-color:${car.color || '#888'}">
      <div class="mh1">${car.carId}</div>
      <div class="mh2"><span>пост.</span><span>расх.</span></div>
    </div>
  `).join('');

  const parkHeader = `
    <div class="mh-group mh-group--park pin">
      <div class="mh1">Парк</div>
      <div class="mh2"><span>расх.</span></div>
    </div>
  `;

  const dayRows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const parkDay = park.find(x => x.day === d) || { expense: 0, expenseTag: '' };

    const cells = cars.map(car => {
      const day = car.days.find(x => x.day === d) || { status: 'idle', income: 0, expense: 0, expenseTag: '' };
      return `
        <div class="in ${day.status}" aria-label="поступление">${_incomeCell(day)}</div>
        <div class="out ${day.expense > 0 ? 'has' : 'none'}" aria-label="расход">${_expenseCell(day)}</div>
      `;
    }).join('');

    const parkCell = parkDay.expense > 0
      ? `<div class="out has park-col">${parkDay.expenseTag ? `<span class="out-tag">${parkDay.expenseTag}</span>` : ''}<span class="out-val">${fmtRuInt(parkDay.expense)}</span></div>`
      : `<div class="out none park-col"><span class="out-dot">·</span></div>`;

    dayRows.push(`
      <div class="grid-row">
        <div class="date-c pin">
          <span class="date-num">${d}</span>
          <span class="date-wd">${_weekday(year, month, d)}</span>
        </div>
        ${cells}
        ${parkCell}
      </div>
    `);
  }

  const footCells = cars.map(car => `
    <div class="foot in-foot g">${fmtRuInt(car.totalIncome)}</div>
    <div class="foot out-foot o">${fmtRuInt(car.totalExpense)}</div>
  `).join('');

  const parkTotal = park.reduce((s, p) => s + (p.expense || 0), 0);

  return `
    <div class="svodka-scroll scroll">
      <div class="grid">
        <div class="grid-head pin">
          <div class="date-c pin head-date">Дата</div>
          ${carHeaders}
          ${parkHeader}
        </div>
        ${dayRows.join('')}
        <div class="grid-row foot-row pin">
          <div class="date-c pin foot-label">Итого</div>
          ${footCells}
          <div class="foot out-foot o park-foot">${fmtRuInt(parkTotal)}</div>
        </div>
      </div>
    </div>
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="svodka-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

function _paintSvodka(data) {
  _paintHeader(data?.totals);
  const body = document.getElementById('svodkaBody');
  if (body) body.innerHTML = _matrixHTML(data);
}

function _showError() {
  _setHeaderSkeleton(false);
  const body = document.getElementById('svodkaBody');
  if (body) {
    body.innerHTML = _offlineHTML(false);
    document.getElementById('svodka-retry')?.addEventListener('click', renderSvodka);
  }
}

export function initSvodka() {
  const root = document.getElementById('screen-svodka');
  if (root && !root.dataset.svodkaBound) {
    root.dataset.svodkaBound = '1';

    root.addEventListener('click', e => {
      if (e.target.closest('#svodkaMonthPrev')) {
        _month--;
        if (_month < 1) { _month = 12; _year--; }
        _refreshMonthUI();
        renderSvodka();
        return;
      }
      if (e.target.closest('#svodkaMonthNext')) {
        const next = _month === 12 ? { m: 1, y: _year + 1 } : { m: _month + 1, y: _year };
        if (next.y > _now.getFullYear() || (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)) return;
        _month = next.m;
        _year  = next.y;
        _refreshMonthUI();
        renderSvodka();
        return;
      }
      if (e.target.closest('#svodkaAvatar')) {
        showScreen('screen-settings');
      }
    });

    root.addEventListener('keydown', e => {
      if (e.target.id !== 'svodkaAvatar') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showScreen('screen-settings');
      }
    });
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-svodka') renderSvodka();
  });
}

export async function renderSvodka() {
  if (!document.getElementById('screen-svodka')) return;

  _fillUserHeader();
  _refreshMonthUI();
  _setHeaderSkeleton(true);

  const body = document.getElementById('svodkaBody');
  if (body) body.innerHTML = '<div class="svodka-loading"><span class="skeleton" style="height:200px;display:block;border-radius:12px"></span></div>';

  let cacheHit = false;
  let painted = false;

  const finish = data => {
    if (!data) return;
    try {
      _paintSvodka(data);
      painted = true;
    } catch (err) {
      console.error('[SVODKA] render error:', err);
      _showError();
    }
  };

  getWithSWR(_cacheKey(), () => getSvodka(_year, _month), {
    onCached: d => {
      cacheHit = true;
      finish(d);
    },
    onFresh: d => finish(d),
    onFetchError: (_e, meta) => {
      if (!meta?.hadCache && !painted) _showError();
    },
  });

  if (!cacheHit) {
    setTimeout(() => {
      if (!painted) { /* skeleton stays */ }
    }, 0);
  }
}
