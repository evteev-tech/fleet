/**
 * analytics.js — сводная аналитика с листа «Дашборд» (investor / operations).
 *
 * GET_DASHBOARD / UPDATE_PERIOD через Apps Script (см. api.js).
 */

import {
  getFleet,
  getOperations,
  getKassas,
  getDeposits,
} from '../api.js';
import { getWithSWR, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { mountNavbarInContainer } from '../router.js?v=7';
import { KASSA_NAMES } from '../config.js';

const PAGE_LABELS = ['Обзор', 'Расходы', 'CAPEX', 'По машинам', 'Кассы'];

const fmtRub = n =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0))} ₽`;

/** 4 месяца: три предыдущих + текущий (от «сегодня»). */
function _pillMonths() {
  const now = new Date();
  const out = [];
  for (let d = -3; d <= 0; d++) {
    const t = new Date(now.getFullYear(), now.getMonth() + d, 1);
    out.push({ year: t.getFullYear(), month: t.getMonth() + 1 });
  }
  return out;
}

function _pillShortLabel(year, month) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'short' })
    .replace(/\.$/, '');
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

function _opClass(op) {
  const raw =
    op?.класс_final ??
    op?.classFinal ??
    op?.classItog ??
    op?.класс_итог ??
    op?.class_override ??
    '';
  return String(raw).trim().toLowerCase();
}

function _toOpDate(op) {
  const d = new Date(op?.date);
  if (!Number.isNaN(d.getTime())) return d;
  const raw = String(op?.dateRaw ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length === 3) {
    const dd = Number(parts[0]);
    const mm = Number(parts[1]) - 1;
    const yyyy = Number(parts[2]);
    const fromRu = new Date(yyyy, mm, dd);
    if (!Number.isNaN(fromRu.getTime())) return fromRu;
  }
  return null;
}

function _calcDash({ ops, cars, kassas, allTime, year, month }) {
  const inPeriod = op => {
    const d = _toOpDate(op);
    if (!d) return false;
    if (allTime) return true;
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  };

  const sumBy = pred =>
    ops
      .filter(pred)
      .reduce((acc, op) => acc + (Number(op.amount) || 0), 0);

  const revenue = sumBy(op => _opClass(op) === 'revenue' && inPeriod(op));
  const opex = sumBy(op => _opClass(op) === 'opex' && inPeriod(op));
  const capexPeriod = sumBy(op => _opClass(op) === 'capex' && inPeriod(op));
  const capexAll = sumBy(op => _opClass(op) === 'capex');
  const profit = revenue - opex;

  let prev = null;
  if (!allTime) {
    const pmDate = new Date(year, month - 2, 1);
    const py = pmDate.getFullYear();
    const pm = pmDate.getMonth() + 1;
    const inPrev = op => {
      const d = _toOpDate(op);
      return !!d && d.getFullYear() === py && d.getMonth() + 1 === pm;
    };
    const prevRevenue = sumBy(op => _opClass(op) === 'revenue' && inPrev(op));
    const prevOpex = sumBy(op => _opClass(op) === 'opex' && inPrev(op));
    const prevCapex = sumBy(op => _opClass(op) === 'capex' && inPrev(op));
    prev = {
      revenue: prevRevenue,
      opex: prevOpex,
      capex: prevCapex,
      profit: prevRevenue - prevOpex,
    };
  }

  const opexRows = [];
  const opexMap = new Map();
  ops.forEach(op => {
    if (_opClass(op) !== 'opex' || !inPeriod(op)) return;
    const k = String(op.category || 'Прочее').trim() || 'Прочее';
    opexMap.set(k, (opexMap.get(k) || 0) + (Number(op.amount) || 0));
  });
  [...opexMap.entries()].forEach(([name, amount]) => {
    if (!amount) return;
    opexRows.push({
      name,
      amount,
      share: opex > 0 ? amount / opex : 0,
    });
  });

  const pnlMap = new Map();
  ops.forEach(op => {
    if (!inPeriod(op)) return;
    const cls = _opClass(op);
    if (cls !== 'revenue' && cls !== 'opex') return;
    const car = String(op.carId || '').trim() || 'Без машины';
    if (!pnlMap.has(car)) {
      pnlMap.set(car, { car, revenue: 0, expense: 0, profit: 0 });
    }
    const row = pnlMap.get(car);
    if (cls === 'revenue') row.revenue += Number(op.amount) || 0;
    if (cls === 'opex') row.expense += Number(op.amount) || 0;
    row.profit = row.revenue - row.expense;
  });

  const inactive = new Set(['в ремонте', 'продана', 'списана']);
  const totalActive = cars.filter(c => !inactive.has(String(c.status || '').toLowerCase().trim())).length;
  const rented = cars.filter(c => String(c.status || '').toLowerCase().trim() === 'в аренде').length;
  const utilizationPct = totalActive > 0 ? (rented / totalActive) * 100 : 0;

  return {
    allTime,
    year,
    month,
    summary: [
      {
        key: 'revenue',
        label: 'Выручка',
        current: revenue,
        previous: prev?.revenue ?? null,
      },
      {
        key: 'opex',
        label: 'Операционные расходы',
        current: opex,
        previous: prev?.opex ?? null,
      },
      {
        key: 'capex',
        label: allTime ? 'CAPEX (всё время)' : 'CAPEX',
        current: allTime ? capexAll : capexPeriod,
        previous: allTime ? null : prev?.capex ?? null,
      },
      {
        key: 'profit',
        label: 'Прибыль',
        current: profit,
        previous: prev?.profit ?? null,
      },
    ],
    opex: opexRows,
    pnl: [...pnlMap.values()].sort((a, b) => b.profit - a.profit),
    utilization: [
      {
        car: `В аренде ${rented} из ${totalActive}`,
        pct: utilizationPct,
      },
    ],
    kassas: kassas,
    capexAll,
    capexPeriod,
  };
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

function _capexPageHtml(dash) {
  const s = dash.summary?.find(x => x.key === 'capex');
  if (!s) {
    return `<div class="white-card analytics-card-pad"><div class="analytics-muted">Нет данных</div></div>`;
  }
  return `
    <div class="white-card analytics-card-pad analytics-capex-hero">
      <div class="analytics-capex-hero__label">${s.label}</div>
      <div class="analytics-capex-hero__amount">${s.current !== null && s.current !== undefined ? fmtRub(s.current) : '—'}</div>
      ${_deltaBlock(s.key, s.current, s.previous)}
    </div>
    <p class="analytics-muted analytics-capex-hint">За период: ${fmtRub(dash.capexPeriod || 0)} · Всё время: ${fmtRub(dash.capexAll || 0)}</p>`;
}

function _kassasRowsHtml(kassas) {
  const rows = [...(kassas || [])]
    .map(k => ({
      label: k.name || KASSA_NAMES[k.kassaId] || k.kassaId || '—',
      bal: Number(k.balanceCurrent) || 0,
    }))
    .sort((a, b) => b.bal - a.bal);
  if (!rows.length) {
    return '<div class="analytics-muted">Нет касс</div>';
  }
  return rows
    .map(
      r => `
    <div class="analytics-kassa-row">
      <div class="analytics-kassa-row__name">${r.label}</div>
      <div class="analytics-kassa-row__nums">
        <span class="analytics-kassa-row__inc">${fmtRub(r.bal)}</span>
      </div>
    </div>`,
    )
    .join('');
}

function _headerPillsHtml(dash) {
  const pills = _pillMonths();
  const allTime = !!dash.allTime;
  const py = dash.year;
  const pm = dash.month;
  const monthBtns = pills
    .map(({ year, month }) => {
      const active = !allTime && py === year && pm === month;
      return `<button type="button" class="analytics-pill${active ? ' analytics-pill--active' : ''}" data-analytics-pill="1" data-year="${year}" data-month="${month}">${_pillShortLabel(year, month)}</button>`;
    })
    .join('');
  return `
    <div class="analytics-header__pills">
      <div class="analytics-header__pills-m">${monthBtns}</div>
      <button type="button" class="analytics-pill analytics-pill--ghost${allTime ? ' analytics-pill--active' : ''}" data-analytics-pill-all="1">Всё время</button>
    </div>`;
}

function _pagesHtml(dash, emptyMsg) {
  const banner =
    emptyMsg && `<div class="analytics-empty-banner">${emptyMsg}</div>`;
  return `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner">
        ${banner || ''}
        ${_tilesHtml(dash.summary)}
        <div class="section-label">Загрузка парка</div>
        <div class="white-card analytics-card-pad">
          ${dash.utilization?.length ? _utilHtml(dash.utilization) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="1">
      <div class="analytics-page-inner">
        <div class="section-label">Расходы по статьям</div>
        <div class="white-card analytics-card-pad">
          ${dash.opex?.length ? _opexHtml(dash.opex) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="2">
      <div class="analytics-page-inner">
        <div class="section-label">CAPEX</div>
        ${_capexPageHtml(dash)}
      </div>
    </div>
    <div class="analytics-page" data-page="3">
      <div class="analytics-page-inner">
        <div class="section-label">P&amp;L по машинам</div>
        <div class="white-card analytics-card-pad">
          ${dash.pnl?.length ? _pnlHtml(dash.pnl) : '<div class="analytics-muted">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="analytics-page" data-page="4">
      <div class="analytics-page-inner">
        <div class="section-label">Оборот по кассам</div>
        <div class="white-card analytics-card-pad" id="analytics-kassas-mount">Загрузка…</div>
      </div>
    </div>`;
}

function _dotsHtml() {
  return PAGE_LABELS.map(
    (_, i) =>
      `<button type="button" class="analytics-dot${i === 0 ? ' is-active' : ''}" data-analytics-dot="${i}" aria-label="${PAGE_LABELS[i]}"></button>`,
  ).join('');
}

function _shellFromParts({ headerPills, carouselInner, bottomBar }) {
  return `
    <header class="analytics-header">
      <div class="analytics-header__top">
        <span class="analytics-title">Аналитика</span>
        <span class="analytics-header__page-label" id="analytics-page-label">${PAGE_LABELS[0]}</span>
      </div>
      ${headerPills}
    </header>
    <div class="analytics-carousel" id="analytics-carousel">
      ${carouselInner}
    </div>
    <div class="analytics-bottom-bar">
      <div class="analytics-dots" id="analytics-dots">${bottomBar ? _dotsHtml() : ''}</div>
      <div class="analytics-navbar" id="analytics-inline-navbar"></div>
    </div>`;
}

function _skeletonShellHTML() {
  const sk = `<div class="white-card skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>`;
  const carouselInner = PAGE_LABELS.map(
    (_, i) => `
    <div class="analytics-page" data-page="${i}">
      <div class="analytics-page-inner">${sk}${sk}</div>
    </div>`,
  ).join('');
  return _shellFromParts({
    headerPills: `<div class="analytics-header__pills"><div class="analytics-header__pills-m">
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
    </div></div>`,
    carouselInner,
    bottomBar: true,
  });
}

function _errorShellHTML(noConn) {
  const inner = `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner analytics-center-msg">
        <div class="white-card analytics-error-card">
          <div class="analytics-error-text">${noConn ? 'Нет соединения' : 'Не удалось загрузить данные'}</div>
          <button type="button" class="btn-primary" id="analytics-retry">Повторить</button>
        </div>
      </div>
    </div>`;
  return _shellFromParts({
    headerPills: '',
    carouselInner: inner,
    bottomBar: false,
  });
}

function _successShellHTML(dash, emptyMsg) {
  return _shellFromParts({
    headerPills: _headerPillsHtml(dash),
    carouselInner: _pagesHtml(dash, emptyMsg),
    bottomBar: true,
  });
}

function _updateCarouselChrome(root, idx) {
  const car = root.querySelector('***REMOVED***analytics-carousel');
  const label = root.querySelector('***REMOVED***analytics-page-label');
  const dots = root.querySelectorAll('[data-analytics-dot]');
  const safe = Math.max(0, Math.min(PAGE_LABELS.length - 1, idx));
  if (label) label.textContent = PAGE_LABELS[safe] ?? '';
  dots.forEach((d, i) => d.classList.toggle('is-active', i === safe));
}

function _bindCarouselScroll(root) {
  const car = root.querySelector('***REMOVED***analytics-carousel');
  if (!car || car.dataset.analyticsScrollBound === '1') return;
  car.dataset.analyticsScrollBound = '1';
  let ticking = false;
  car.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const w = car.offsetWidth || 1;
        const idx = Math.round(car.scrollLeft / w);
        _updateCarouselChrome(root, idx);
      });
    },
    { passive: true },
  );
}

async function _mountInlineNavbar(root) {
  const slot = root.querySelector('***REMOVED***analytics-inline-navbar');
  const u = getCurrentUser();
  if (!slot || !u?.role) return;
  await mountNavbarInContainer(slot, u.role, 'screen-analytics');
}

function _hydrateKassas(root, dash) {
  const mount = root.querySelector('***REMOVED***analytics-kassas-mount');
  if (!mount) return;
  mount.innerHTML = _kassasRowsHtml(dash.kassas);
}

function _afterShellMounted(root, dash) {
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  _hydrateKassas(root, dash);
  const car = root.querySelector('***REMOVED***analytics-carousel');
  if (car) {
    car.scrollLeft = 0;
    _updateCarouselChrome(root, 0);
  }
}

let _loading = false;
let _pendingYear = null;
let _pendingMonth = null;
let _pendingAllTime = false;
let _ops = [];
let _cars = [];
let _kassas = [];
let _deposits = [];

function _applyDashToState(dash) {
  _pendingYear = dash.year;
  _pendingMonth = dash.month;
  _pendingAllTime = !!dash.allTime;
}

function _refreshViewOnly() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  let cacheHit = false;
  let filled = false;
  let ops;
  let cars;
  let kassas;
  let deposits;

  const paintIfReady = () => {
    if (ops === undefined || cars === undefined || kassas === undefined || deposits === undefined) return;
    _ops = ops;
    _cars = cars;
    _kassas = kassas;
    _deposits = deposits;
    const now = new Date();
    const y = _pendingYear || now.getFullYear();
    const m = _pendingMonth || now.getMonth() + 1;
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      allTime: _pendingAllTime,
      year: y,
      month: m,
    });
    filled = true;
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
    );
    _afterShellMounted(root, dash);
  };

  getWithSWR(CACHE_KEYS.CASH_OPS, () => getOperations(), {
    onCached: d => {
      cacheHit = true;
      ops = d || [];
      paintIfReady();
    },
    onFresh: d => {
      ops = d || [];
      paintIfReady();
    },
    onFetchError: (err, meta) => {
      if (!meta?.hadCache) {
        ops = [];
        console.error('Analytics ops _refreshViewOnly:', err);
        paintIfReady();
      }
    },
  });
  getWithSWR(CACHE_KEYS.CARS, () => getFleet(), {
    onCached: d => {
      cacheHit = true;
      cars = d || [];
      paintIfReady();
    },
    onFresh: d => {
      cars = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) cars = [];
      paintIfReady();
    },
  });
  getWithSWR(CACHE_KEYS.KASSAS, () => getKassas(), {
    onCached: d => {
      cacheHit = true;
      kassas = d || [];
      paintIfReady();
    },
    onFresh: d => {
      kassas = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) kassas = [];
      paintIfReady();
    },
  });
  getWithSWR(CACHE_KEYS.DEPOSITS, () => getDeposits(), {
    onCached: d => {
      cacheHit = true;
      deposits = d || [];
      paintIfReady();
    },
    onFresh: d => {
      deposits = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) deposits = [];
      paintIfReady();
    },
  });

  setTimeout(() => {
    if (!cacheHit && !filled) {
      root.innerHTML = _skeletonShellHTML();
      void _mountInlineNavbar(root);
      _bindCarouselScroll(root);
      const car = root.querySelector('***REMOVED***analytics-carousel');
      if (car) _updateCarouselChrome(root, 0);
    }
  }, 0);
}

async function _applyPeriod(year, month) {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _skeletonShellHTML();
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  try {
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      allTime: false,
      year,
      month,
    });
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
    );
    _afterShellMounted(root, dash);
  } catch (err) {
    console.error('Analytics _applyPeriod:', err);
    root.innerHTML = _errorShellHTML(err.message === 'NO_CONNECTION');
    await _mountInlineNavbar(root);
  }
}

async function _applyAllTime() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = _skeletonShellHTML();
  _bindCarouselScroll(root);
  void _mountInlineNavbar(root);
  try {
    const now = new Date();
    const dash = _calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      allTime: true,
      year: _pendingYear || now.getFullYear(),
      month: _pendingMonth || now.getMonth() + 1,
    });
    _applyDashToState(dash);
    const empty = !_dashboardHasContent(dash);
    root.innerHTML = _successShellHTML(
      dash,
      empty ? 'Нет данных за выбранный период' : '',
    );
    _afterShellMounted(root, dash);
  } catch (err) {
    console.error('Analytics _applyAllTime:', err);
    root.innerHTML = _errorShellHTML(err.message === 'NO_CONNECTION');
    await _mountInlineNavbar(root);
  }
}

function _onRootClick(e) {
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

  const dot = e.target.closest('[data-analytics-dot]');
  if (dot && dot.dataset.analyticsDot != null) {
    const root = document.getElementById('analytics-root');
    const car = root?.querySelector('***REMOVED***analytics-carousel');
    if (!car) return;
    const idx = Number(dot.dataset.analyticsDot) || 0;
    car.scrollTo({ left: idx * car.offsetWidth, behavior: 'smooth' });
    return;
  }

  const pillAll = e.target.closest('[data-analytics-pill-all]');
  if (pillAll) {
    if (_loading) return;
    _loading = true;
    _applyAllTime().finally(() => {
      _loading = false;
    });
    return;
  }

  const pill = e.target.closest('[data-analytics-pill]');
  if (pill) {
    const y = Number(pill.dataset.year);
    const m = Number(pill.dataset.month);
    if (!y || m < 1 || m > 12) return;
    if (_loading) return;
    _loading = true;
    _applyPeriod(y, m).finally(() => {
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
