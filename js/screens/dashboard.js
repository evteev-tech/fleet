/**
 * dashboard.js — дашборд для ролей operations и investor.
 *
 * Данные: getOperations() + getFleet()
 * Переключатель месяца хранится в переменных модуля.
 * Hero-карточка перерисовывается при смене месяца без перезагрузки кассовых данных.
 */

import { getOperations, getFleet } from '../api.js';
import { getCurrentUser }          from '../auth.js';
import { showScreen }              from '../router.js';
import { showToast }               from '../ui.js';
import { KASSA_ID, CAR_STATUSES }  from '../config.js';

// ─── Состояние переключателя месяца ──────────────────────────────────────────
const _now = new Date();
let _month = _now.getMonth() + 1;   // 1–12
let _year  = _now.getFullYear();

// ─── Кэш загруженных данных ───────────────────────────────────────────────────
let _allOps = [];
let _fleet  = [];

// ─── Конфиг касс ─────────────────────────────────────────────────────────────
const KASSA_META = {
  [KASSA_ID.AZAMAT]:   { label: 'K_AZAMAT',   color: 'var(--color-yellow)', textDark: true  },
  [KASSA_ID.VLADIMIR]: { label: 'K_VLADIMIR',  color: 'var(--color-blue)',   textDark: false },
  [KASSA_ID.YULIA]:    { label: 'K_YULIA',     color: 'var(--color-orange)', textDark: false },
};

// ─── Конфиг статусов парка ────────────────────────────────────────────────────
const FLEET_META = [
  { status: CAR_STATUSES.RENT,   label: 'В аренде',   icon: '🚗', pill: 'pill--green'  },
  { status: CAR_STATUSES.IDLE,   label: 'Простой',    icon: '🅿️', pill: 'pill--orange' },
  { status: CAR_STATUSES.REPAIR, label: 'На ремонте', icon: '🔧', pill: 'pill--red'    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

export function initDashboard() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-dashboard') renderDashboard();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНЫЙ РЕНДЕР
// ═══════════════════════════════════════════════════════════════════════════

export async function renderDashboard() {
  const body = document.getElementById('dashboard-body');
  if (!body) return;

  body.innerHTML = _skeletonHTML();

  try {
    [_allOps, _fleet] = await Promise.all([getOperations(), getFleet()]);
  } catch (err) {
    body.innerHTML = _offlineHTML(err.message === 'NO_CONNECTION');
    document.getElementById('dash-retry')?.addEventListener('click', renderDashboard);
    return;
  }

  _renderFull(body);
}

// ─── Полный рендер ────────────────────────────────────────────────────────────
function _renderFull(body) {
  const user  = getCurrentUser();
  const first = user?.name?.split(' ')[0] ?? '';
  const initial = (user?.name ?? '?')[0].toUpperCase();

  body.innerHTML = `
    <!-- ХЕДЕР -->
    <div class="dash-hdr">
      <div class="dash-hdr__top">
        <span class="app-logo">Матизы</span>
        <div class="dash-hdr__avatar">${initial}</div>
      </div>
      <div class="dash-hdr__greeting">Привет, ${first}</div>

      <!-- Переключатель месяца -->
      <div class="dash-month-sw">
        <button class="dash-month-sw__btn" id="dash-prev">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 13L7 9L11 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="dash-month-sw__label" id="dash-month-label">${_monthLabel()}</span>
        <button class="dash-month-sw__btn" id="dash-next">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M7 13L11 9L7 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- HERO -->
    <div class="dash-body">
      <div id="dash-hero">${_heroHTML()}</div>

      <!-- КАССЫ -->
      <div class="dash-section">
        <div class="dash-section__title">Кассы</div>
        <div class="dash-card" id="dash-kassas">
          ${_kassasHTML()}
        </div>
      </div>

      <!-- ПАРК -->
      <div class="dash-section">
        <div class="dash-section__title">Парк · ${_fleet.length} авто</div>
        <div class="dash-card" id="dash-fleet">
          ${_fleetHTML()}
        </div>
      </div>
    </div>
  `;

  _bindEvents();
}

// ─── Hero-блок (перерисовывается при смене месяца) ────────────────────────────
function _heroHTML() {
  const monthOps = _allOps.filter(op =>
    op.date instanceof Date &&
    op.date.getMonth() + 1 === _month &&
    op.date.getFullYear() === _year
  );

  // Остатки касс (всё время, не фильтруем по месяцу)
  const kassaBalances = _calcKassaBalances(_allOps);
  const total = Object.values(kassaBalances).reduce((s, v) => s + v, 0);

  // Доходы / расходы за выбранный месяц
  let monthIncome = 0, monthExpense = 0;
  monthOps.forEach(op => {
    if (op.direction === 'приход')  monthIncome  += op.amount;
    if (op.direction === 'расход') monthExpense += op.amount;
  });
  const monthNet = monthIncome - monthExpense;

  return `
    <div class="dash-hero">
      <div class="dash-hero__label">ИТОГО В КАССАХ</div>
      <div class="dash-hero__total">${_fmt(total)}</div>
      <div class="dash-hero__tiles">
        <div class="dash-hero__tile">
          <span class="dash-hero__tile-lbl">Доходы</span>
          <span class="dash-hero__tile-val dash-hero__tile-val--green">${_fmt(monthIncome)}</span>
        </div>
        <div class="dash-hero__tile">
          <span class="dash-hero__tile-lbl">Расходы</span>
          <span class="dash-hero__tile-val dash-hero__tile-val--red">${_fmt(monthExpense)}</span>
        </div>
        <div class="dash-hero__tile">
          <span class="dash-hero__tile-lbl">Чистыми</span>
          <span class="dash-hero__tile-val">${_fmt(monthNet)}</span>
        </div>
      </div>
    </div>
  `;
}

// ─── Строки касс ──────────────────────────────────────────────────────────────
function _kassasHTML() {
  const balances = _calcKassaBalances(_allOps);
  return Object.entries(KASSA_META).map(([kassaId, meta]) => {
    const bal = balances[kassaId] ?? 0;
    const balClass = bal >= 0 ? 'dash-kassa__bal--pos' : 'dash-kassa__bal--neg';
    return `
      <div class="dash-kassa" data-kassa="${kassaId}">
        <span class="dash-kassa__dot" style="background:${meta.color}"></span>
        <span class="dash-kassa__name">${meta.label}</span>
        <span class="dash-kassa__bal ${balClass}">${bal >= 0 ? '' : '−'}${_fmt(Math.abs(bal))}</span>
      </div>
    `;
  }).join('');
}

// ─── Строки парка ─────────────────────────────────────────────────────────────
function _fleetHTML() {
  const counts = {};
  _fleet.forEach(c => { counts[c.status] = (counts[c.status] ?? 0) + 1; });

  return FLEET_META.map(m => `
    <div class="dash-fleet-row" data-status="${m.status}">
      <span class="dash-fleet-row__icon">${m.icon}</span>
      <span class="dash-fleet-row__label">${m.label}</span>
      <span class="dash-fleet-row__spacer"></span>
      <span class="dash-fleet-row__count">${counts[m.status] ?? 0}</span>
      <span class="pill ${m.pill}">${counts[m.status] ?? 0}</span>
    </div>
  `).join('');
}

// ─── Скелетон ────────────────────────────────────────────────────────────────
function _skeletonHTML() {
  const ln = (w) => `<div class="skeleton skeleton-line" style="width:${w}%;margin-bottom:8px"></div>`;
  return `
    <div class="dash-hdr dash-hdr--skeleton">
      ${ln(30)} ${ln(50)} ${ln(40)}
    </div>
    <div class="dash-body">
      <div class="skeleton" style="height:160px;border-radius:16px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:120px;border-radius:16px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:100px;border-radius:16px"></div>
    </div>
  `;
}

function _offlineHTML(isNoConn) {
  return `
    <div class="home-offline">
      <div class="home-offline__icon">${isNoConn ? '📡' : '⚠️'}</div>
      <div class="home-offline__text">${isNoConn ? 'Нет соединения' : 'Ошибка загрузки'}</div>
      <div class="home-offline__sub">${isNoConn ? 'Проверьте интернет' : 'Что-то пошло не так'}</div>
      <button class="btn-primary" id="dash-retry" style="margin-top:20px">Повторить</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// СОБЫТИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _bindEvents() {
  // ── Переключатель месяца ─────────────────────────────────────────────────
  document.getElementById('dash-prev')?.addEventListener('click', () => {
    _month--;
    if (_month < 1) { _month = 12; _year--; }
    _updateHero();
  });

  document.getElementById('dash-next')?.addEventListener('click', () => {
    // Нельзя выбрать месяц в будущем
    const next = _month === 12 ? { m: 1, y: _year + 1 } : { m: _month + 1, y: _year };
    if (next.y > _now.getFullYear() || (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)) return;
    _month = next.m;
    _year  = next.y;
    _updateHero();
  });

  // ── Кассы → история ──────────────────────────────────────────────────────
  document.querySelectorAll('.dash-kassa').forEach(row => {
    row.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('history:filter', {
        detail: { kassaId: row.dataset.kassa },
      }));
      showScreen('screen-history');
      document.dispatchEvent(new CustomEvent('screen:activated', { detail: { screenId: 'screen-history' } }));
    });
  });

  // ── Парк → fleet с фильтром ───────────────────────────────────────────────
  document.querySelectorAll('.dash-fleet-row').forEach(row => {
    row.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('fleet:filter', {
        detail: { status: row.dataset.status },
      }));
      showScreen('screen-fleet');
      document.dispatchEvent(new CustomEvent('screen:activated', { detail: { screenId: 'screen-fleet' } }));
    });
  });

  // ── Обновление стрелки «вперёд» (неактивна если текущий месяц) ───────────
  _updateNextBtn();
}

function _updateHero() {
  const heroEl = document.getElementById('dash-hero');
  const label  = document.getElementById('dash-month-label');
  if (heroEl) heroEl.innerHTML = _heroHTML();
  if (label)  label.textContent = _monthLabel();
  _updateNextBtn();
}

function _updateNextBtn() {
  const btn = document.getElementById('dash-next');
  if (!btn) return;
  const isCurrentMonth = _month === _now.getMonth() + 1 && _year === _now.getFullYear();
  btn.style.opacity      = isCurrentMonth ? '0.3' : '1';
  btn.style.pointerEvents = isCurrentMonth ? 'none' : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// ВЫЧИСЛЕНИЯ
// ═══════════════════════════════════════════════════════════════════════════

function _calcKassaBalances(ops) {
  const result = {};
  Object.keys(KASSA_META).forEach(id => { result[id] = 0; });
  ops.forEach(op => {
    if (!(op.kassaId in result)) return;
    if (op.direction === 'приход')  result[op.kassaId] += op.amount;
    if (op.direction === 'расход') result[op.kassaId] -= op.amount;
  });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════════════════

function _fmt(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`;
}

function _monthLabel() {
  return new Date(_year, _month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());   // «Май 2026»
}
