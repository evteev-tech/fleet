/**
 * analytics.js — сводная аналитика с листа «Дашборд» (investor / operations).
 *
 * GET_DASHBOARD / UPDATE_PERIOD через Apps Script (см. api.js).
 */

import { fetchDashboardAnalytics, updateAnalyticsPeriod } from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';

const fmtRub = n =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0))} ₽`;

function monthYearTitle(year, month) {
  let s = new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase());
  if (!/\sг\.?$/.test(s)) s += ' г.';
  return s;
}

function _shiftMonth(y, m, delta) {
  let nm = m + delta;
  let ny = y;
  while (nm < 1) {
    nm += 12;
    ny--;
  }
  while (nm > 12) {
    nm -= 12;
    ny++;
  }
  return { year: ny, month: nm };
}

function _canGoNext(year, month) {
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return year < cy || (year === cy && month < cm);
}

function _dashboardHasContent(d) {
  const sumOk = (d.summary ?? []).some(
    s =>
      (s.current !== null && s.current !== undefined) ||
      (s.previous !== null && s.previous !== undefined),
  );
  const n =
    (d.opex?.length ?? 0) + (d.pnl?.length ?? 0) + (d.utilization?.length ?? 0);
  return sumOk || n > 0;
}

/** Лучше = ↑ зел.: выручка/прибыль растут; OPEX/CAPEX падают */
function _deltaBlock(key, cur, prev) {
  if (prev === null || prev === undefined || Number.isNaN(Number(prev))) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  let better;
  if (key === 'revenue' || key === 'profit') better = c > p;
  else better = c < p;
  const diff = Math.abs(c - p);
  if (diff < 1e-6) {
    return `<span class="analytics-delta analytics-delta--na">—</span>`;
  }
  const arrow = better ? '↑' : '↓';
  const cls = better ? 'analytics-delta--good' : 'analytics-delta--bad';
  return `<span class="analytics-delta ${cls}">${arrow} ${fmtRub(diff)}</span>`;
}

function _tilesHtml(summary) {
  const order = ['revenue', 'opex', 'capex', 'profit'];
  const items = order.map(k => summary.find(s => s.key === k)).filter(Boolean);
  return `
    <div class="analytics-tiles">
      ${items
        .map(
          s => `
        <div class="analytics-tile white-card">
          <div class="analytics-tile__label">${s.label}</div>
          <div class="analytics-tile__amount">${s.current !== null && s.current !== undefined ? fmtRub(s.current) : '—'}</div>
          ${_deltaBlock(s.key, s.current, s.previous)}
        </div>`,
        )
        .join('')}
    </div>`;
}

function _opexHtml(opex) {
  const total = opex.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  const sorted = [...opex].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  return sorted
    .map(row => {
      let pct = row.share;
      if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
        pct = total > 0 ? (Number(row.amount) || 0) / total : 0;
      }
      const w = Math.min(100, Math.max(0, pct * 100));
      return `
      <div class="analytics-opex-row">
        <div class="analytics-opex-row__top">
          <span class="analytics-opex-row__name">${row.name}</span>
          <span class="analytics-opex-row__sum">${fmtRub(row.amount)}</span>
        </div>
        <div class="analytics-bar analytics-bar--accent"><span style="width:${w}%"></span></div>
      </div>`;
    })
    .join('');
}

function _pnlHtml(pnl) {
  const tr = pnl
    .map(
      r => `
    <tr>
      <td class="analytics-pnl-car">${r.car}</td>
      <td class="analytics-pnl-num">${fmtRub(r.revenue)}</td>
      <td class="analytics-pnl-num">${fmtRub(r.expense)}</td>
      <td class="analytics-pnl-num analytics-pnl-profit ${Number(r.profit) >= 0 ? 'analytics-pnl-profit--pos' : 'analytics-pnl-profit--neg'}">${fmtRub(r.profit)}</td>
    </tr>`,
    )
    .join('');
  const totRev = pnl.reduce((a, r) => a + (Number(r.revenue) || 0), 0);
  const totExp = pnl.reduce((a, r) => a + (Number(r.expense) || 0), 0);
  const totPr = pnl.reduce((a, r) => a + (Number(r.profit) || 0), 0);
  const foot = `
    <tr class="analytics-pnl-total">
      <td>Итого</td>
      <td class="analytics-pnl-num">${fmtRub(totRev)}</td>
      <td class="analytics-pnl-num">${fmtRub(totExp)}</td>
      <td class="analytics-pnl-num analytics-pnl-profit ${totPr >= 0 ? 'analytics-pnl-profit--pos' : 'analytics-pnl-profit--neg'}">${fmtRub(totPr)}</td>
    </tr>`;
  return `
    <div class="analytics-table-scroll">
      <table class="analytics-pnl-table">
        <thead><tr><th>Машина</th><th>Выручка</th><th>Расходы</th><th>Прибыль</th></tr></thead>
        <tbody>${tr}${foot}</tbody>
      </table>
    </div>`;
}

function _utilHtml(utilization) {
  return utilization
    .map(u => {
      let p = u.pct;
      if (p === null || p === undefined || Number.isNaN(Number(p))) p = 0;
      p = Number(p);
      const barClass =
        p >= 70 ? 'analytics-bar--accent' : p < 40 ? 'analytics-bar--danger' : 'analytics-bar--muted';
      return `
      <div class="analytics-util-row">
        <div class="analytics-util-row__top">
          <span>${u.car}</span>
          <span class="analytics-util-pct">${Math.round(p)}%</span>
        </div>
        <div class="analytics-bar ${barClass}"><span style="width:${Math.min(100, Math.max(0, p))}%"></span></div>
      </div>`;
    })
    .join('');
}

function _skeletonHTML() {
  const bar = `<div class="skeleton skeleton-line" style="height:8px;border-radius:4px;margin-top:8px"></div>`;
  return `
    <div class="analytics-header analytics-header--dark">
      <span class="analytics-title">Аналитика</span>
      <div class="analytics-month-sw">${bar}</div>
    </div>
    <div class="analytics-scroll">
      <div class="analytics-tiles">${[1, 2, 3, 4].map(() => `<div class="white-card skeleton" style="height:96px;border-radius:14px"></div>`).join('')}</div>
      <div class="section-label">Расходы по статьям</div>
      <div class="white-card" style="padding:16px">${bar}${bar}${bar}</div>
    </div>`;
}

function _errorHTML(noConn) {
  return `
    <div class="analytics-header analytics-header--dark">
      <span class="analytics-title">Аналитика</span>
    </div>
    <div class="analytics-scroll analytics-center-msg">
      <div class="white-card analytics-error-card">
        <div class="analytics-error-text">${noConn ? 'Нет соединения' : 'Не удалось загрузить данные'}</div>
        <button type="button" class="btn-primary" id="analytics-retry">Повторить</button>
      </div>
    </div>`;
}

function _fullHtml(dash, emptyMsg) {
  const nextOk = _canGoNext(dash.year, dash.month);
  const title = monthYearTitle(dash.year, dash.month);
  const bodyEmpty =
    emptyMsg &&
    `<div class="analytics-empty-banner">${emptyMsg}</div>`;
  return `
    <div class="analytics-header analytics-header--dark">
      <span class="analytics-title">Аналитика</span>
      <div class="analytics-month-sw">
        <button type="button" class="analytics-month-btn" id="analytics-prev" aria-label="Предыдущий месяц">‹</button>
        <span class="analytics-month-label">${title}</span>
        <button type="button" class="analytics-month-btn" id="analytics-next" aria-label="Следующий месяц"
          ${nextOk ? '' : 'disabled'} style="${nextOk ? '' : 'opacity:0.35;pointer-events:none'}">›</button>
      </div>
    </div>
    <div class="analytics-scroll">
      ${bodyEmpty || ''}
      ${_tilesHtml(dash.summary)}
      <div class="section-label">Расходы по статьям</div>
      <div class="white-card analytics-card-pad">
        ${dash.opex?.length ? _opexHtml(dash.opex) : '<div class="analytics-muted">Нет данных</div>'}
      </div>
      <div class="section-label">P&L по машинам</div>
      <div class="white-card analytics-card-pad">
        ${dash.pnl?.length ? _pnlHtml(dash.pnl) : '<div class="analytics-muted">Нет данных</div>'}
      </div>
      <div class="section-label">Загрузка парка</div>
      <div class="white-card analytics-card-pad">
        ${dash.utilization?.length ? _utilHtml(dash.utilization) : '<div class="analytics-muted">Нет данных</div>'}
      </div>
    </div>`;
}

let _loading = false;
let _pendingYear = null;
let _pendingMonth = null;

function _refreshViewOnly() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = '';
  let cacheHit = false;
  let filled = false;

  const apply = dash => {
    filled = true;
    if (!dash) {
      root.innerHTML = _errorHTML(false);
      return;
    }
    _pendingYear = dash.year;
    _pendingMonth = dash.month;
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _fullHtml(dash, empty ? 'Нет данных за выбранный период' : '');
  };

  getWithSWR(CACHE_KEYS.DASHBOARD, () => fetchDashboardAnalytics(), {
    onCached: d => {
      cacheHit = true;
      apply(d);
    },
    onFresh: d => {
      apply(d);
    },
    onFetchError: (err, meta) => {
      if (!meta?.hadCache) {
        console.error('Analytics _refreshViewOnly:', err);
        root.innerHTML = _errorHTML(err?.message === 'NO_CONNECTION');
      }
    },
  });

  setTimeout(() => {
    if (!cacheHit && !filled) {
      root.innerHTML = _skeletonHTML();
    }
  }, 0);
}

async function _applyPeriod(year, month) {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _skeletonHTML();
  try {
    await updateAnalyticsPeriod(year, month);
    const dash = await fetchDashboardAnalytics();
    if (!dash) throw new Error('EMPTY');
    _pendingYear = dash.year;
    _pendingMonth = dash.month;
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _fullHtml(dash, empty ? 'Нет данных за выбранный период' : '');
  } catch (err) {
    console.error('Analytics _applyPeriod:', err);
    root.innerHTML = _errorHTML(err.message === 'NO_CONNECTION');
  }
}

function _onRootClick(e) {
  const prev = e.target.closest('***REMOVED***analytics-prev');
  const next = e.target.closest('***REMOVED***analytics-next');
  const retry = e.target.closest('***REMOVED***analytics-retry');
  if (retry) {
    if (_loading) return;
    _loading = true;
    _refreshViewOnly();
    requestAnimationFrame(() => {
      _loading = false;
    });
    return;
  }
  if (_pendingYear === null || _pendingMonth === null) return;
  if (prev) {
    const { year, month } = _shiftMonth(_pendingYear, _pendingMonth, -1);
    if (_loading) return;
    _loading = true;
    _applyPeriod(year, month).finally(() => {
      _loading = false;
    });
    return;
  }
  if (next && _canGoNext(_pendingYear, _pendingMonth)) {
    const { year, month } = _shiftMonth(_pendingYear, _pendingMonth, 1);
    if (_loading) return;
    _loading = true;
    _applyPeriod(year, month).finally(() => {
      _loading = false;
    });
  }
}

export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (root && !root.dataset.analyticsBound) {
    root.dataset.analyticsBound = '1';
    root.addEventListener('click', _onRootClick);
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-analytics') _refreshViewOnly();
  });
}
