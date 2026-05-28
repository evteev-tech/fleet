/**
 * svodka.js — страница «Сводка» для инвестора (Юлия).
 * 3 вида: V1 Матрица (spreadsheet), V2 Лента (gantt), V3 P&L (дневной).
 * Данные: GET /api/svodka?year=&month= → { summary, matrix, daysInMonth }
 */

import { getSvodka }            from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { fmtRuInt }             from '../utils/format.js';

const _now = new Date();
let _month = _now.getMonth() + 1;
let _year  = _now.getFullYear();
let _view  = 'v1';          // 'v1' | 'v2' | 'v3'
let _lastData = null;

// Краткие дни недели (воскресенье = 0)
const WD = ['вс','пн','вт','ср','чт','пт','сб'];

// Палитра машин по индексу (совпадает с дизайном)
const CAR_PALETTE = [
  '#7dd3c0','#f4ad77','#d97a7a','#8ab4e8',
  '#b07ac4','#f0d97a','#e8a4b3','#5fb97a',
  '#c77dbb','#6e8bd6','#d9a05b','#74c2c9',
];
function carColor(i) { return CAR_PALETTE[i % CAR_PALETTE.length]; }

// Статус (русский текст) → CSS-класс
const STATUS_CLS = { 'в аренде':'rent', 'простой':'idle', 'в ремонте':'repair', 'парк':'park' };
function stCls(s) { return STATUS_CLS[s] || 'idle'; }
function stLabel(s) {
  return s === 'в аренде' ? 'аренда' : s === 'в ремонте' ? 'ремонт' : 'простой';
}

function fmt(n) { return fmtRuInt(n); }

// Экранирование HTML
function _e(s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

// ─── Точки входа ────────────────────────────────────────────────────────────

export function initSvodka() {
  const root = document.getElementById('screen-svodka');
  if (!root) return;

  // Рендерим статический каркас один раз
  root.innerHTML = _frameHtml();

  // Делегирование событий
  root.addEventListener('click', e => {
    // Переключение месяца
    if (e.target.closest('#svMonthPrev')) {
      _month--;
      if (_month < 1) { _month = 12; _year--; }
      renderSvodka();
      return;
    }
    if (e.target.closest('#svMonthNext')) {
      const next = _month === 12
        ? { m: 1, y: _year + 1 }
        : { m: _month + 1, y: _year };
      const isFuture = next.y > _now.getFullYear() ||
        (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1);
      if (isFuture) return;
      _month = next.m; _year = next.y;
      renderSvodka();
      return;
    }
    // Переключение вида
    const tab = e.target.closest('.sv-tab');
    if (tab && tab.dataset.view) {
      _view = tab.dataset.view;
      root.querySelectorAll('.sv-tab')
        .forEach(t => t.classList.toggle('active', t === tab));
      _renderView(_lastData);
    }
    // Повторить при ошибке
    if (e.target.closest('#sv-retry')) {
      renderSvodka();
    }
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-svodka') renderSvodka();
  });
}

export async function renderSvodka() {
  if (!document.getElementById('screen-svodka')) return;

  _setMonthLabel();
  _updateNextBtn();
  _setSkeleton();

  const cacheKey = `${CACHE_KEYS.SVODKA}:${_year}-${_month}`;
  let painted = false;

  const paint = data => {
    if (!data) { _showError(); return; }
    _lastData = data;
    painted = true;
    _renderSummary(data.summary);
    _renderView(data);
  };

  getWithSWR(cacheKey, () => getSvodka(_year, _month), {
    ttl: 120_000,
    onCached: paint,
    onFresh:  paint,
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache && !painted) _showError();
    },
  });
}

// ─── Каркас экрана ──────────────────────────────────────────────────────────

function _frameHtml() {
  const tabCfg = [
    { id: 'v1', label: 'Матрица' },
    { id: 'v2', label: 'Лента'   },
    { id: 'v3', label: 'P&amp;L' },
  ];
  const tabs = tabCfg.map(t =>
    `<button class="sv-tab${t.id === _view ? ' active' : ''}" data-view="${t.id}">${t.label}</button>`
  ).join('');

  return `
<div class="sv-frame">
  <header class="sv-head">
    <div class="sv-head-top">
      <div>
        <div class="sv-eyebrow">Сводка по парку</div>
        <div class="sv-month">
          <button type="button" class="sv-month-btn" id="svMonthPrev" aria-label="Предыдущий месяц">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="sv-month-label" id="svMonthLabel"></span>
          <button type="button" class="sv-month-btn" id="svMonthNext" aria-label="Следующий месяц">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="sv-head-stats">
        <div class="sv-stat">
          <div class="sv-stat-l">Поступления</div>
          <div class="sv-stat-v pos" id="svIncome">—</div>
        </div>
        <div class="sv-stat">
          <div class="sv-stat-l">Расходы</div>
          <div class="sv-stat-v neg" id="svExpense">—</div>
        </div>
        <div class="sv-stat">
          <div class="sv-stat-l">Чистыми</div>
          <div class="sv-stat-v" id="svNet">—</div>
        </div>
        <div class="sv-stat">
          <div class="sv-stat-l">Загрузка</div>
          <div class="sv-stat-v" id="svLoad">—</div>
        </div>
      </div>
    </div>
    <div class="sv-tabs">${tabs}</div>
  </header>
  <div class="sv-legend">
    <span><i class="sv-lg sv-lg--rent"></i>аренда</span>
    <span><i class="sv-lg sv-lg--idle"></i>простой</span>
    <span><i class="sv-lg sv-lg--repair"></i>ремонт</span>
    <span><i class="sv-lg sv-lg--exp"></i>расход</span>
  </div>
  <div class="sv-content" id="svContent"></div>
</div>`;
}

// ─── Обновление шапки ────────────────────────────────────────────────────────

function _setSkeleton() {
  ['svIncome','svExpense','svNet','svLoad'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '…';
  });
}

function _renderSummary(s) {
  if (!s) return;
  const $ = id => document.getElementById(id);
  const inc = $('svIncome'); if (inc) inc.textContent = `+${fmt(s.income)} ₽`;
  const exp = $('svExpense'); if (exp) exp.textContent = `−${fmt(s.expense)} ₽`;
  const net = $('svNet');
  if (net) {
    const n = Math.round(s.net);
    net.textContent = `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))} ₽`;
    net.className = `sv-stat-v ${n >= 0 ? 'pos' : 'neg'}`;
  }
  const load = $('svLoad'); if (load) load.textContent = `${s.loadPct ?? 0}%`;
}

function _setMonthLabel() {
  const el = document.getElementById('svMonthLabel');
  if (!el) return;
  const s = new Date(_year, _month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase())
    .replace(/\s?г\.?$/, '');
  el.textContent = s;
}

function _updateNextBtn() {
  const btn = document.getElementById('svMonthNext');
  if (!btn) return;
  const isCurrent = _month === _now.getMonth() + 1 && _year === _now.getFullYear();
  btn.disabled = isCurrent;
}

// ─── Рендер текущего вида ────────────────────────────────────────────────────

function _renderView(data) {
  const content = document.getElementById('svContent');
  if (!content || !data) return;
  if (_view === 'v1') content.innerHTML = _buildV1(data);
  else if (_view === 'v2') content.innerHTML = _buildV2(data);
  else content.innerHTML = _buildV3(data);
}

function _showError() {
  const content = document.getElementById('svContent');
  if (!content) return;
  content.innerHTML = `
    <div class="sv-error">
      <div class="sv-error-icon">⚠️</div>
      <div class="sv-error-text">Не удалось загрузить сводку</div>
      <button class="btn-primary" id="sv-retry" style="margin-top:16px;padding:8px 20px">Повторить</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// V1 — МАТРИЦА (Spreadsheet)
// ════════════════════════════════════════════════════════════════════════════

function _buildV1(data) {
  const allCars    = data.matrix || [];
  const realCars   = allCars.filter(c => !c.isPark);
  const parkCar    = allCars.find(c => c.isPark);
  const days       = data.daysInMonth || 30;
  const carsToShow = [...realCars, ...(parkCar ? [parkCar] : [])];

  // ── Шапка ──
  let h1 = `<tr><th class="ss-th-date" rowspan="2">Дата</th>`;
  carsToShow.forEach((c, i) => {
    const color = carColor(i);
    if (c.isPark) {
      h1 += `<th class="ss-th-car" style="--car:${color}">
        <div class="ss-car-plate">${_e(c.nick || c.carId)}</div>
        <div class="ss-car-note">общепарк.</div>
      </th>`;
    } else {
      h1 += `<th colspan="2" class="ss-th-car" style="--car:${color}">
        <div class="ss-car-plate">${_e(c.nick || c.carId)}</div>
      </th>`;
    }
  });
  h1 += `<th class="ss-th-tot" rowspan="2">Итого</th></tr>`;

  let h2 = '<tr>';
  carsToShow.forEach(c => {
    if (c.isPark) {
      h2 += `<th class="ss-sub-h out">расход</th>`;
    } else {
      h2 += `<th class="ss-sub-h in">поступ.</th><th class="ss-sub-h out">расход</th>`;
    }
  });
  h2 += '</tr>';

  // ── Тело ──
  let body = '';
  for (let d = 1; d <= days; d++) {
    const date    = new Date(_year, _month - 1, d);
    const dowIdx  = date.getDay();
    const dow     = WD[dowIdx];
    const weekend = dowIdx === 0 || dowIdx === 6;

    let dayIncome = 0, dayExpense = 0;
    let cells = '';

    carsToShow.forEach((c, i) => {
      const color = carColor(i);
      const cell  = c.days[d - 1] || {};
      const cls   = stCls(cell.status);

      dayIncome  += cell.income  || 0;
      dayExpense += cell.expense || 0;

      const expHtml = cell.expense > 0
        ? `<span class="ss-exp" title="${_e(cell.expenseTag || '')}">
             <span class="ss-exp-amt">${fmt(cell.expense)}</span>
             <span class="ss-exp-note">${_e(cell.expenseTag || 'расход')}</span>
           </span>`
        : '';

      if (c.isPark) {
        cells += `<td class="ss-cell ss-out" style="--car:${color}">${expHtml}</td>`;
      } else {
        cells += `<td class="ss-cell ss-in st-${cls}" style="--car:${color}">
          ${cell.income > 0 ? `<span class="ss-money">${fmt(cell.income)}</span>` : ''}
        </td>`;
        cells += `<td class="ss-cell ss-out" style="--car:${color}">${expHtml}</td>`;
      }
    });

    const net = dayIncome - dayExpense;
    const dStr = String(d).padStart(2,'0') + '.' + String(_month).padStart(2,'0');
    body += `<tr${weekend ? ' class="ss-weekend"' : ''}>
      <td class="ss-td-date">${dStr}<span class="ss-td-dow">${dow}</span></td>
      ${cells}
      <td class="ss-td-tot ${net >= 0 ? 'pos' : 'neg'}">
        <div class="ss-tot-net">${net >= 0 ? '+' : ''}${fmt(net)}</div>
        <div class="ss-tot-sub">${fmt(dayIncome)} − ${fmt(dayExpense)}</div>
      </td>
    </tr>`;
  }

  // ── Подвал ──
  let foot = `<tr class="ss-foot"><td class="ss-td-date">Итого</td>`;
  let totIn = 0, totOut = 0;
  carsToShow.forEach((c, i) => {
    const color  = carColor(i);
    let carIn  = 0, carOut = 0;
    c.days.forEach(d => { carIn += d.income || 0; carOut += d.expense || 0; });
    totIn  += carIn;
    totOut += carOut;
    if (c.isPark) {
      foot += `<td class="ss-cell ss-foot-out" style="--car:${color}">${carOut > 0 ? fmt(carOut) : '—'}</td>`;
    } else {
      foot += `<td class="ss-cell ss-foot-in"  style="--car:${color}">${fmt(carIn)}</td>`;
      foot += `<td class="ss-cell ss-foot-out" style="--car:${color}">${carOut > 0 ? fmt(carOut) : '—'}</td>`;
    }
  });
  foot += `<td class="ss-td-tot ${totIn - totOut >= 0 ? 'pos' : 'neg'}">
    <div class="ss-tot-net">${totIn - totOut >= 0 ? '+' : ''}${fmt(totIn - totOut)}</div>
    <div class="ss-tot-sub">net</div>
  </td></tr>`;

  return `<div class="ss-wrap">
    <div class="ss-scroll">
      <table class="ss-table">
        <thead>${h1}${h2}</thead>
        <tbody>${body}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// V2 — ЛЕНТА (Timeline / Gantt)
// ════════════════════════════════════════════════════════════════════════════

function _buildV2(data) {
  const cars = (data.matrix || []).filter(c => !c.isPark);
  const days = data.daysInMonth || 30;
  const colW = Math.max(36, Math.min(48, Math.floor(600 / days)));
  const gridCols = `repeat(${days}, minmax(${colW}px, 1fr))`;

  // Заголовок дней
  let dayHeads = '';
  for (let d = 1; d <= days; d++) {
    const dow = WD[new Date(_year, _month - 1, d).getDay()];
    dayHeads += `<div class="tl-day-head">
      <div class="tl-day-num">${d}</div>
      <div class="tl-day-dow">${dow}</div>
    </div>`;
  }

  const header = `
    <div class="tl-header">
      <div class="tl-car-col">Машина</div>
      <div class="tl-days" style="grid-template-columns:${gridCols}">${dayHeads}</div>
      <div class="tl-totals-head">
        <div>аренда</div><div>ремонт</div><div>net ₽</div>
      </div>
    </div>`;

  // Строки машин
  let rows = '';
  cars.forEach((c, ci) => {
    const color = carColor(ci);
    let rentD = 0, repD = 0;
    let carIncome = 0, carExpense = 0;

    let cellsHtml = '';
    for (let d = 1; d <= days; d++) {
      const cell   = c.days[d - 1] || {};
      const cls    = stCls(cell.status);
      const expAmt = cell.expense > 0 ? cell.expense : 0;
      if (cls === 'rent')   rentD++;
      if (cls === 'repair') repD++;
      carIncome  += cell.income  || 0;
      carExpense += cell.expense || 0;

      let inner = '';
      if (cls === 'rent')   inner = `<span class="tl-cell-amt">${cell.income > 0 ? fmt(cell.income) : ''}</span>`;
      if (cls === 'repair') inner = `<span class="tl-cell-glyph">рем</span>`;
      if (cls === 'idle')   inner = `<span class="tl-cell-glyph idle">—</span>`;
      const expChip = expAmt > 0
        ? `<div class="tl-cell-exp" title="${_e(cell.expenseTag || '')}">${fmt(expAmt)}</div>`
        : '';

      cellsHtml += `<div class="tl-cell st-${cls}">${inner}${expChip}</div>`;
    }

    const net = carIncome - carExpense;
    rows += `
      <div class="tl-row">
        <div class="tl-car-col">
          <div class="tl-car-plate" style="--car:${color}">${_e(c.nick || c.carId)}</div>
          <div class="tl-car-sub">${_month < 10 ? '0'+_month : _month}.${_year}</div>
        </div>
        <div class="tl-days" style="grid-template-columns:${gridCols}">${cellsHtml}</div>
        <div class="tl-totals">
          <div class="tl-tot-cell pos">${rentD}д</div>
          <div class="tl-tot-cell warn">${repD}д</div>
          <div class="tl-tot-cell net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net)}</div>
        </div>
      </div>`;
  });

  // Итоговая строка по дням
  let footCells = '';
  for (let d = 1; d <= days; d++) {
    let dInc = 0, dExp = 0;
    cars.forEach(c => {
      const cell = c.days[d - 1] || {};
      dInc += cell.income  || 0;
      dExp += cell.expense || 0;
    });
    const net = dInc - dExp;
    footCells += `<div class="tl-cell tl-cell-foot ${net >= 0 ? 'pos' : 'neg'}">
      <span class="tl-foot-net">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net / 1000)).replace('.', ',')}к</span>
    </div>`;
  }
  const totalNet = (data.summary?.net ?? 0);
  const footer = `
    <div class="tl-row tl-footer-row">
      <div class="tl-car-col" style="font-family:var(--sv-mono);font-size:10px;color:var(--sv-muted)">Итого день</div>
      <div class="tl-days" style="grid-template-columns:${gridCols}">${footCells}</div>
      <div class="tl-totals">
        <div class="tl-tot-cell" style="grid-column:1/span 3;font-weight:700;justify-content:center">
          ${totalNet >= 0 ? '+' : ''}${fmt(totalNet)} ₽
        </div>
      </div>
    </div>`;

  return `<div class="tl-wrap">${header}${rows}${footer}</div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// V3 — ДНЕВНОЙ P&L
// ════════════════════════════════════════════════════════════════════════════

function _buildV3(data) {
  const cars = (data.matrix || []).filter(c => !c.isPark);
  const days = data.daysInMonth || 30;
  const carCols = `repeat(${cars.length}, 1fr)`;

  // Заголовок колонок машин
  const carHeadCells = cars.map((c, i) =>
    `<div class="pl-h-plate" style="--car:${carColor(i)}">${_e(c.nick || c.carId)}</div>`
  ).join('');

  const head = `
    <div class="pl-head-row">
      <div>День</div>
      <div class="pl-h-cars" style="display:grid;grid-template-columns:${carCols};gap:4px">${carHeadCells}</div>
      <div class="pl-h-money">Поступления</div>
      <div class="pl-h-money">Расходы</div>
      <div class="pl-h-money">Net</div>
    </div>`;

  // Строки дней
  let rows = '';
  for (let d = 1; d <= days; d++) {
    const date   = new Date(_year, _month - 1, d);
    const dowIdx = date.getDay();
    const dow    = WD[dowIdx];

    let dayInc = 0, dayExp = 0;
    const pills = cars.map((c, ci) => {
      const cell = c.days[d - 1] || {};
      dayInc += cell.income  || 0;
      dayExp += cell.expense || 0;
      const cls = stCls(cell.status);
      const rate = cell.income > 0 ? fmt(cell.income) : '';
      return `<div class="pl-pill st-${cls}" title="${_e(c.nick || c.carId)}: ${stLabel(cell.status)}">${rate}</div>`;
    }).join('');

    const net     = dayInc - dayExp;
    const dStr    = String(d).padStart(2,'0') + '.' + String(_month).padStart(2,'0');

    // Список расходов для подсказки
    let expHtml = '';
    if (dayExp > 0) {
      // Собираем ярлыки расходов со всех машин за этот день
      const notes = [];
      cars.forEach(c => {
        const cell = c.days[d - 1] || {};
        if (cell.expense > 0 && cell.expenseTag) notes.push(cell.expenseTag);
      });
      const uniq = [...new Set(notes)];
      expHtml = `
        <div class="pl-money neg-stack">
          <span class="pl-exp-total">−${fmt(dayExp)}</span>
          ${uniq.length ? `<span class="pl-exp-notes">${uniq.slice(0,3).map(_e).join(', ')}${uniq.length > 3 ? '…' : ''}</span>` : ''}
        </div>`;
    } else {
      expHtml = `<span class="pl-money-muted">—</span>`;
    }

    rows += `
      <div class="pl-row">
        <div class="pl-date">
          <div class="pl-d-num">${dStr}</div>
          <div class="pl-d-dow">${dow}</div>
        </div>
        <div class="pl-cars" style="grid-template-columns:${carCols}">${pills}</div>
        <div class="pl-money pos">+${fmt(dayInc)}</div>
        ${expHtml}
        <div class="pl-money pl-net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net)}</div>
      </div>`;
  }

  return `<div class="pl-wrap">${head}${rows}</div>`;
}
