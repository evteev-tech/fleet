/**
 * svodka.js — календарная «Сводка» по парку за месяц (точка входа инвестора).
 */

import { getSvodka } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { fmtRuInt } from '../utils/format.js';

const _now = new Date();
let _month = _now.getMonth() + 1;
let _year  = _now.getFullYear();

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const STATUS_CLASS = {
  'в аренде':  'rent',
  'простой':   'idle',
  'в ремонте': 'repair',
  'парк':      'park',
};

const CAR_PALETTE = [
  '#1AAE9F', '#E89B3C', '#D85A52', '#7FB3E0', '#B58BC2', '#E0C84E',
  '#EF8A92', '#5FB97A', '#C77DBB', '#6E8BD6', '#D9A05B', '#74C2C9',
];
function carColor(idx) { return CAR_PALETTE[idx % CAR_PALETTE.length]; }

function _svodkaScreen() { return document.getElementById('screen-svodka'); }

export function initSvodka() {
  const root = _svodkaScreen();
  if (root && !root.dataset.svClickBound) {
    root.dataset.svClickBound = '1';
    root.addEventListener('click', e => {
      if (e.target.closest('#svMonthPrev')) {
        _month--;
        if (_month < 1) { _month = 12; _year--; }
        renderSvodka();
        return;
      }
      if (e.target.closest('#svMonthNext')) {
        const next = _month === 12 ? { m: 1, y: _year + 1 } : { m: _month + 1, y: _year };
        if (next.y > _now.getFullYear() ||
            (next.y === _now.getFullYear() && next.m > _now.getMonth() + 1)) return;
        _month = next.m; _year = next.y;
        renderSvodka();
      }
    });
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-svodka') renderSvodka();
  });
}

export async function renderSvodka() {
  if (!_svodkaScreen()) return;

  _setMonthLabel();
  _updateNextBtn();
  _setSummarySkeleton();

  const cacheKey = `${CACHE_KEYS.SVODKA}:${_year}-${_month}`;
  let painted = false;

  const paint = (data) => {
    if (!data) { _showError(); return; }
    painted = true;
    _renderSummary(data.summary);
    _renderMatrix(data);
  };

  getWithSWR(cacheKey, () => getSvodka(_year, _month), {
    ttl: 120_000,
    onCached: paint,
    onFresh:  paint,
    onFetchError: (_e, meta) => { if (!meta?.hadCache && !painted) _showError(); },
  });
}

function _setSummarySkeleton() {
  ['svIncome', 'svExpense', 'svNet', 'svLoad'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const bar = document.getElementById('svLoadBar');
  if (bar) bar.innerHTML = '';
}

function _renderSummary(s) {
  if (!s) return;
  const inc = document.getElementById('svIncome');
  const exp = document.getElementById('svExpense');
  const net = document.getElementById('svNet');
  const load = document.getElementById('svLoad');
  if (inc)  inc.textContent  = '+' + _fmt(s.income);
  if (exp)  exp.textContent  = '−' + _fmt(s.expense);
  if (net)  net.textContent  = _fmtSigned(s.net);
  if (load) load.textContent = `${s.loadPct}%`;

  const bar = document.getElementById('svLoadBar');
  if (bar) {
    const rentPct = s.loadPct;
    bar.innerHTML =
      `<span style="width:${rentPct}%;background:var(--sv-rent)"></span>` +
      `<span style="width:${100 - rentPct}%;background:var(--sv-idle)"></span>`;
  }
}

function _renderMatrix(data) {
  const wrap = document.getElementById('svGridWrap');
  if (!wrap) return;
  const cars = data.matrix || [];
  const days = data.daysInMonth;

  let h1 = '<tr class="sv-h1"><th class="sv-corner sv-pin" rowspan="2"></th>';
  let h2 = '<tr class="sv-h2">';
  cars.forEach((c, i) => {
    const color = carColor(i);
    const label = c.nick || c.carId;
    if (c.isPark) {
      h1 += `<th class="sv-cargrp sv-park-h" style="--car:${color}">${_esc(label)}</th>`;
      h2 += `<th class="sv-cargrp-l sv-cargrp-r" style="--car:${color}">расх.</th>`;
    } else {
      h1 += `<th colspan="2" class="sv-cargrp" style="--car:${color}">${_esc(label)}</th>`;
      h2 += `<th class="sv-cargrp-l" style="--car:${color}">дох.</th><th class="sv-cargrp-r" style="--car:${color}">расх.</th>`;
    }
  });
  h1 += '</tr>'; h2 += '</tr>';

  let body = '';
  for (let d = 1; d <= days; d++) {
    const dowIdx = new Date(_year, _month - 1, d).getDay();
    const dow = WD[dowIdx];
    const isWeekend = dowIdx === 0 || dowIdx === 6;
    const trCls = isWeekend ? ' class="sv-weekend"' : '';
    body += `<tr${trCls}><td class="sv-date sv-pin">${String(d).padStart(2, '0')}.${String(_month).padStart(2, '0')}` +
            ` <span class="sv-dow">${dow}</span></td>`;
    cars.forEach((c, i) => {
      const color = carColor(i);
      const cell = c.days[d - 1] || {};
      const expCell = cell.expense > 0
        ? `<span class="sv-tag">${_esc(cell.expenseTag)}</span>${_fmtInt(cell.expense)}`
        : (cell.expenseTag ? `<span class="sv-tag">${_esc(cell.expenseTag)}</span>—` : null);

      if (c.isPark) {
        body += expCell
          ? `<td class="sv-out sv-out--has sv-cargrp-l sv-cargrp-r" style="--car:${color}">${expCell}</td>`
          : `<td class="sv-out sv-out--none sv-cargrp-l sv-cargrp-r" style="--car:${color}">·</td>`;
      } else {
        const cls = STATUS_CLASS[cell.status] || 'idle';
        const inTxt = cell.income > 0 ? _fmtInt(cell.income) : '';
        body += `<td class="sv-in sv-${cls} sv-cargrp-l" style="--car:${color}">${inTxt}</td>`;
        body += expCell
          ? `<td class="sv-out sv-out--has sv-cargrp-r" style="--car:${color}">${expCell}</td>`
          : `<td class="sv-out sv-out--none sv-cargrp-r" style="--car:${color}">·</td>`;
      }
    });
    body += '</tr>';
  }

  let foot = '<tr class="sv-foot"><td class="sv-foot-lbl sv-pin">Итог</td>';
  cars.forEach((c, i) => {
    const color = carColor(i);
    let gi = 0, ge = 0;
    c.days.forEach(x => { gi += x.income || 0; ge += x.expense || 0; });
    if (c.isPark) {
      foot += `<td class="sv-fr sv-cargrp-l sv-cargrp-r" style="--car:${color}">${ge ? _fmtInt(ge) : '0'}</td>`;
    } else {
      foot += `<td class="sv-fg sv-cargrp-l" style="--car:${color}">${gi ? _fmtInt(gi) : '0'}</td>` +
              `<td class="sv-fr sv-cargrp-r" style="--car:${color}">${ge ? _fmtInt(ge) : '0'}</td>`;
    }
  });
  foot += '</tr>';

  wrap.innerHTML =
    `<table class="sv-grid"><thead>${h1}${h2}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function _showError() {
  const wrap = document.getElementById('svGridWrap');
  if (wrap) {
    wrap.innerHTML =
      `<div class="home-offline">
        <div class="home-offline__icon">⚠️</div>
        <div class="home-offline__text">Не удалось загрузить сводку</div>
        <button class="btn-primary" id="sv-retry" style="margin-top:20px">Повторить</button>
      </div>`;
    document.getElementById('sv-retry')?.addEventListener('click', renderSvodka);
  }
}

function _setMonthLabel() {
  const el = document.getElementById('svMonthLabel');
  if (!el) return;
  let s = new Date(_year, _month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
  if (!/\sг\.?$/.test(s)) s += ' г.';
  el.textContent = s;
}

function _updateNextBtn() {
  const btn = document.getElementById('svMonthNext');
  if (!btn) return;
  const isCurrent = _month === _now.getMonth() + 1 && _year === _now.getFullYear();
  btn.disabled = isCurrent;
  btn.classList.toggle('period-switcher__btn--disabled', isCurrent);
}

function _fmt(n)       { return `${fmtRuInt(Math.round(Math.abs(n)))} ₽`; }
function _fmtSigned(n) { const r = Math.round(n); return `${r < 0 ? '−' : ''}${fmtRuInt(Math.abs(r))} ₽`; }
function _fmtInt(n)    { return fmtRuInt(Math.round(n)); }
function _esc(s)       { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
