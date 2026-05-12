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
  getRentals,
  fetchDashboardAnalytics,
} from '../api.js';
import { getWithSWR, CACHE_KEYS, invalidateCache as invalidateLocalCache } from '../cache.js';

/**
 * Увеличивайте при изменении формы ответа API / calcDash, чтобы после F5 SWR
 * заново подтянул операции и дашборд (иначе возможен устаревший JSON в localStorage).
 */
const ANALYTICS_DATA_CACHE_REVISION = 4;
const ANALYTICS_CACHE_REV_KEY = 'fleet_analytics_model_rev';

function invalidateStaleAnalyticsCachesIfNeeded() {
  try {
    const stored = localStorage.getItem(ANALYTICS_CACHE_REV_KEY);
    if (stored === String(ANALYTICS_DATA_CACHE_REVISION)) return;
    [
      CACHE_KEYS.CASH_OPS,
      CACHE_KEYS.CARS,
      CACHE_KEYS.KASSAS,
      CACHE_KEYS.DEPOSITS,
      CACHE_KEYS.RENTALS,
      CACHE_KEYS.DASHBOARD,
    ].forEach(k => invalidateLocalCache(k));
    localStorage.setItem(ANALYTICS_CACHE_REV_KEY, String(ANALYTICS_DATA_CACHE_REVISION));
  } catch {
    /* quota / private mode */
  }
}
import { getCurrentUser } from '../auth.js';
import { mountNavbarInContainer } from '../router.js';
import { renderOverview, renderOverviewSkeleton } from './analytics/overview.js';
import { renderOpex, revealOpexAnimations } from './analytics/opex.js';
import { renderCapex, revealCapexAnimations } from './analytics/capex.js';
import { renderPnL } from './analytics/pnl.js';
import { renderKassas } from './analytics/kassas.js';
import {
  hydrateForecast,
  forecastLoadingHtml,
  resetForecastCache,
} from './analytics/forecast.js';
import {
  hydrateCapexChart,
  destroyCapexChart,
  animateCapexPayback,
} from './analytics/capexCharts.js';
import { renderDesktopShell, renderDesktopSkeleton, isDesktop } from './analytics/desktop.js';
import {
  PAGE_LABELS,
  CAPEX_MODE,
  opClass,
  toOpDate,
  pillMonths,
  pillShortLabel,
} from './analytics/utils.js';
import { setAnalyticsContext } from './analytics/context.js';

function calcDash({ ops, cars, kassas, deposits, allTime, year, month }) {
  const inPeriod = op => {
    const d = toOpDate(op);
    if (!d) return false;
    if (allTime) return true;
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  };

  const sumBy = pred =>
    ops
      .filter(pred)
      .reduce((acc, op) => acc + (Number(op.amount) || 0), 0);

  const revenue = sumBy(op => opClass(op) === 'revenue' && inPeriod(op));
  const opex = sumBy(op => opClass(op) === 'opex' && inPeriod(op));
  const capexPeriod = sumBy(op => opClass(op) === 'capex' && inPeriod(op));
  const capexAll = sumBy(op => opClass(op) === 'capex');
  const profit = revenue - opex;

  let prev = null;
  if (!allTime) {
    const pmDate = new Date(year, month - 2, 1);
    const py = pmDate.getFullYear();
    const pm = pmDate.getMonth() + 1;
    const inPrev = op => {
      const d = toOpDate(op);
      return !!d && d.getFullYear() === py && d.getMonth() + 1 === pm;
    };
    const prevRevenue = sumBy(op => opClass(op) === 'revenue' && inPrev(op));
    const prevOpex = sumBy(op => opClass(op) === 'opex' && inPrev(op));
    const prevCapex = sumBy(op => opClass(op) === 'capex' && inPrev(op));
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
    if (opClass(op) !== 'opex' || !inPeriod(op)) return;
    const k = String(op.category || 'Прочее').trim() || 'Прочее';
    opexMap.set(k, (opexMap.get(k) || 0) + (Number(op.amount) || 0));
  });
  [...opexMap.entries()]
    .filter(([, sum]) => Number(sum) > 0)
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .forEach(([name, amount]) => {
      opexRows.push({
        name,
        amount,
        share: opex > 0 ? amount / opex : 0,
      });
    });

  const pnlMap = new Map();
  let pnlGeneralOpex = 0;
  ops.forEach(op => {
    if (!inPeriod(op)) return;
    const cls = opClass(op);
    if (cls !== 'revenue' && cls !== 'opex') return;
    const car = String(op.carId || '').trim();
    if (!car) {
      if (cls === 'opex') pnlGeneralOpex += Number(op.amount) || 0;
      return;
    }
    if (!pnlMap.has(car)) {
      pnlMap.set(car, { car, revenue: 0, expense: 0, profit: 0 });
    }
    const row = pnlMap.get(car);
    if (cls === 'revenue') row.revenue += Number(op.amount) || 0;
    if (cls === 'opex') row.expense += Number(op.amount) || 0;
    row.profit = row.revenue - row.expense;
  });

  const capexCatsPeriod = new Map();
  const capexCatsAll = new Map();
  /** Только колонка G (категория), lowerCase + `_` → пробел: структура инвестиций за всё время. */
  const capexStructureByNormCat = new Map();
  const capexCarsPeriod = new Map();
  const capexCarsAll = new Map();
  /**
   * CAPEX: opClass === 'capex' (classItog / класс_итог … → lowerCase).
   * Категории периода/«всё время» для сегмента и машин — ключ capexOpDetailKey (G с заменой `_`).
   * «Структура инвестиций» — только capexStructureByCategory (нормализация как в ТЗ).
   */
  function capexOpDetailKey(op) {
    const category = String(op.category ?? '')
      .replace(/_/g, ' ')
      .trim();
    return category || 'Прочее';
  }
  ops.forEach(op => {
    const cls = opClass(op);
    if (cls !== 'capex') return;
    const amt = Number(op.amount) || 0;
    const cat = capexOpDetailKey(op);
    const normG = String(op.category ?? '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .trim();
    const structKey = normG || 'прочее';
    capexStructureByNormCat.set(structKey, (capexStructureByNormCat.get(structKey) || 0) + amt);
    const car = String(op.carId || '').trim() || 'Без машины';
    capexCatsAll.set(cat, (capexCatsAll.get(cat) || 0) + amt);
    capexCarsAll.set(car, (capexCarsAll.get(car) || 0) + amt);
    if (inPeriod(op)) {
      capexCatsPeriod.set(cat, (capexCatsPeriod.get(cat) || 0) + amt);
      capexCarsPeriod.set(car, (capexCarsPeriod.get(car) || 0) + amt);
    }
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
    pnlGeneralOpex,
    utilization: [
      {
        car: `В аренде ${rented} из ${totalActive}`,
        pct: utilizationPct,
      },
    ],
    kassas: kassas,
    deposits: deposits || [],
    capexByCategoryPeriod: [...capexCatsPeriod.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([name, amount]) => ({ name, amount })),
    capexByCategoryAll: [...capexCatsAll.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([name, amount]) => ({ name, amount })),
    capexStructureByCategory: [...capexStructureByNormCat.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([name, amount]) => ({ name, amount })),
    capexByCarsPeriod: [...capexCarsPeriod.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([car, amount]) => ({ car, amount })),
    capexByCarsAll: [...capexCarsAll.entries()]
      .filter(([, sum]) => Number(sum) > 0)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .map(([car, amount]) => ({ car, amount })),
    capexAll,
    capexPeriod,
  };
}

function dashboardHasContent(d) {
  const sumOk = (d.summary ?? []).some(
    s =>
      (s.current !== null && s.current !== undefined) ||
      (s.previous !== null && s.previous !== undefined),
  );
  const n =
    (d.opex?.length ?? 0) + (d.pnl?.length ?? 0) + (d.utilization?.length ?? 0);
  return sumOk || n > 0;
}

function headerPillsHtml(dash) {
  const pills = pillMonths();
  const allTime = !!dash.allTime;
  const py = dash.year;
  const pm = dash.month;
  const monthBtns = pills
    .map(({ year, month }) => {
      const active = !allTime && py === year && pm === month;
      return `<button type="button" class="analytics-pill${active ? ' analytics-pill--active' : ''}" data-analytics-pill="1" data-year="${year}" data-month="${month}">${pillShortLabel(year, month)}</button>`;
    })
    .join('');
  return `
    <div class="analytics-header__pills">
      <div class="analytics-header__pills-m">${monthBtns}</div>
      <button type="button" class="analytics-pill analytics-pill--ghost${allTime ? ' analytics-pill--active' : ''}" data-analytics-pill-all="1">Всё время</button>
    </div>`;
}

function pagesHtml(dash, emptyMsg, capexMode) {
  const banner = emptyMsg && `<div class="analytics-empty-banner">${emptyMsg}</div>`;
  return `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner">
        ${banner || ''}
        ${renderOverview(dash)}
      </div>
    </div>
    <div class="analytics-page" data-page="1">
      <div class="analytics-page-inner">
        ${renderOpex(dash)}
      </div>
    </div>
    <div class="analytics-page" data-page="2">
      <div class="analytics-page-inner">
        ${renderCapex(dash, capexMode)}
      </div>
    </div>
    <div class="analytics-page" data-page="3">
      <div class="analytics-page-inner">
        ${renderPnL(dash)}
      </div>
    </div>
    <div class="analytics-page" data-page="4">
      <div class="analytics-page-inner">
        <div class="section-label">Балансы касс</div>
        <div class="white-card analytics-card-pad" id="analytics-kassas-mount">Загрузка…</div>
      </div>
    </div>
    <div class="analytics-page" data-page="5">
      <div class="analytics-page-inner">
        <div class="section-label">Прогноз прибыли</div>
        <div id="analytics-forecast-mount">${forecastLoadingHtml()}</div>
      </div>
    </div>`;
}

function dotsHtml() {
  return PAGE_LABELS.map(
    (_, i) =>
      `<button type="button" class="analytics-dot${i === 0 ? ' is-active' : ''}" data-analytics-dot="${i}" aria-label="${PAGE_LABELS[i]}"></button>`,
  ).join('');
}

function shellFromParts({ headerPills, carouselInner, bottomBar }) {
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
      <div class="analytics-dots" id="analytics-dots">${bottomBar ? dotsHtml() : ''}</div>
      <div class="analytics-navbar" id="analytics-inline-navbar"></div>
    </div>`;
}

function skeletonShellHTML() {
  const sk = `<div class="white-card skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>`;
  const carouselInner = PAGE_LABELS.map(
    (_, i) => `
    <div class="analytics-page" data-page="${i}">
      <div class="analytics-page-inner">${i === 0 ? renderOverviewSkeleton() : `${sk}${sk}`}</div>
    </div>`,
  ).join('');
  return shellFromParts({
    headerPills: `<div class="analytics-header__pills"><div class="analytics-header__pills-m">
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
      <span class="skeleton skeleton-line" style="width:36px;height:28px;border-radius:14px;display:inline-block"></span>
    </div></div>`,
    carouselInner,
    bottomBar: true,
  });
}

function errorShellHTML(noConn) {
  const inner = `
    <div class="analytics-page" data-page="0">
      <div class="analytics-page-inner analytics-center-msg">
        <div class="white-card analytics-error-card">
          <div class="analytics-error-text">${noConn ? 'Нет соединения' : 'Не удалось загрузить данные'}</div>
          <button type="button" class="btn-primary" id="analytics-retry">Повторить</button>
        </div>
      </div>
    </div>`;
  return shellFromParts({
    headerPills: '',
    carouselInner: inner,
    bottomBar: false,
  });
}

function successShellHTML(dash, emptyMsg, capexMode) {
  return shellFromParts({
    headerPills: headerPillsHtml(dash),
    carouselInner: pagesHtml(dash, emptyMsg, capexMode),
    bottomBar: true,
  });
}

function updateCarouselChrome(root, idx) {
  const car = root.querySelector('#analytics-carousel');
  const label = root.querySelector('#analytics-page-label');
  const dots = root.querySelectorAll('[data-analytics-dot]');
  const safe = Math.max(0, Math.min(PAGE_LABELS.length - 1, idx));
  if (label) label.textContent = PAGE_LABELS[safe] ?? '';
  dots.forEach((d, i) => d.classList.toggle('is-active', i === safe));
  _currentPage = safe;
  animatePage(root, safe);
}

function animatePage(root, idx) {
  const page = root.querySelector(`.analytics-page[data-page="${idx}"]`);
  if (!page) return;
  if (idx === 1) {
    revealOpexAnimations(page);
  } else if (idx === 2) {
    revealCapexAnimations(page);
    void hydrateCapexChart(root).then(() => animateCapexPayback(root));
  } else if (idx === 3) {
    const cards = page.querySelectorAll('.phc');
    cards.forEach((card, i) => {
      card.style.animation = 'none';
      card.getBoundingClientRect();
      card.style.animation = `heat-in 0.4s cubic-bezier(.34,1.56,.64,1) ${(0.05 + i * 0.07).toFixed(2)}s forwards`;
    });
  } else if (idx === 5) {
    void hydrateForecast(root);
  }
}

function bindCarouselScroll(root) {
  const car = root.querySelector('#analytics-carousel');
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
        updateCarouselChrome(root, idx);
      });
    },
    { passive: true },
  );
}

async function mountInlineNavbar(root) {
  const slot = root.querySelector('#analytics-inline-navbar');
  const u = getCurrentUser();
  if (!slot || !u?.role) return;
  await mountNavbarInContainer(slot, u.role, 'screen-analytics');
}

function hydrateKassas(root, dash) {
  const mount = root.querySelector('#analytics-kassas-mount');
  if (!mount) return;
  mount.innerHTML = renderKassas(dash);
}

function afterShellMounted(root, dash) {
  bindCarouselScroll(root);
  void mountInlineNavbar(root);
  hydrateKassas(root, dash);
  const car = root.querySelector('#analytics-carousel');
  if (car) {
    const safe = Math.max(0, Math.min(PAGE_LABELS.length - 1, _currentPage));
    car.scrollLeft = safe * (car.offsetWidth || 1);
    updateCarouselChrome(root, safe);
    if (safe === 5) {
      void hydrateForecast(root);
    } else {
      car.addEventListener(
        'scroll',
        function lazyForecast() {
          const w = car.offsetWidth || 1;
          const idx = Math.round(car.scrollLeft / w);
          if (idx === 5) {
            car.removeEventListener('scroll', lazyForecast);
            void hydrateForecast(root);
          }
        },
        { passive: true },
      );
    }
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
let _rentals = [];
let _capexMode = CAPEX_MODE.PERIOD;
let _currentPage = 0;

/** Поля GET_DASHBOARD (trailing12, capexTotal, …); null — ещё не было успешного ответа. */
let _dashApiExtras = null;
let _dashApiExtrasError = false;

function normalizeDashboardApi_(d) {
  if (!d || typeof d !== 'object') {
    return {
      trailing12: [],
      cumulativeProfit: 0,
      capexTotal: 0,
      paybackMonths: null,
      forecastNextMonth: 0,
    };
  }
  const pm = d.paybackMonths;
  const paybackMonths =
    pm === null || pm === undefined || Number.isNaN(Number(pm)) ? null : Number(pm);
  return {
    trailing12: Array.isArray(d.trailing12) ? d.trailing12 : [],
    cumulativeProfit: Number(d.cumulativeProfit) || 0,
    capexTotal: Number(d.capexTotal) || 0,
    paybackMonths,
    forecastNextMonth: Number(d.forecastNextMonth) || 0,
  };
}

function mergeDashboardApiIntoDash_(dash) {
  const pack = _dashApiExtras === null ? normalizeDashboardApi_(null) : _dashApiExtras;
  dash.trailing12 = pack.trailing12;
  dash.cumulativeProfit = pack.cumulativeProfit;
  dash.capexTotal = pack.capexTotal;
  dash.paybackMonths = pack.paybackMonths;
  dash.forecastNextMonth = pack.forecastNextMonth;
  dash.overviewExtrasError = _dashApiExtrasError;
}

function applyDashToState(dash) {
  _pendingYear = dash.year;
  _pendingMonth = dash.month;
  _pendingAllTime = !!dash.allTime;
}

function refreshViewOnly() {
  invalidateStaleAnalyticsCachesIfNeeded();
  const root = document.getElementById('analytics-root');
  if (!root) return;
  let cacheHit = false;
  let filled = false;
  let ops;
  let cars;
  let kassas;
  let deposits;
  let rentals;

  const paintIfReady = () => {
    if (
      ops === undefined ||
      cars === undefined ||
      kassas === undefined ||
      deposits === undefined ||
      rentals === undefined
    )
      return;
    _ops = ops;
    _cars = cars;
    _kassas = kassas;
    _deposits = deposits;
    _rentals = rentals;
    setAnalyticsContext({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      rentals: _rentals,
    });
    const now = new Date();
    const y = _pendingYear || now.getFullYear();
    const m = _pendingMonth || now.getMonth() + 1;
    const dash = calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: _pendingAllTime,
      year: y,
      month: m,
    });
    mergeDashboardApiIntoDash_(dash);
    setAnalyticsContext({ trailing12: dash.trailing12 });
    filled = true;
    applyDashToState(dash);
    if (isDesktop()) {
      root.innerHTML = renderDesktopShell(dash);
    } else {
      const empty = !dashboardHasContent(dash);
      destroyCapexChart();
      root.innerHTML = successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      afterShellMounted(root, dash);
    }
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
        console.error('Analytics ops refreshViewOnly:', err);
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

  getWithSWR(CACHE_KEYS.RENTALS, () => getRentals(), {
    onCached: d => {
      cacheHit = true;
      rentals = d || [];
      paintIfReady();
    },
    onFresh: d => {
      rentals = d || [];
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) rentals = [];
      paintIfReady();
    },
  });

  getWithSWR(CACHE_KEYS.DASHBOARD, () => fetchDashboardAnalytics(), {
    onCached: d => {
      _dashApiExtras = normalizeDashboardApi_(d);
      _dashApiExtrasError = false;
      paintIfReady();
    },
    onFresh: d => {
      _dashApiExtras = normalizeDashboardApi_(d);
      _dashApiExtrasError = false;
      paintIfReady();
    },
    onFetchError: (_err, meta) => {
      if (!meta?.hadCache) {
        _dashApiExtrasError = true;
        _dashApiExtras = normalizeDashboardApi_(null);
      }
      paintIfReady();
    },
  });

  setTimeout(() => {
    if (!cacheHit && !filled) {
      root.innerHTML = isDesktop() ? renderDesktopSkeleton() : skeletonShellHTML();
      if (!isDesktop()) {
        void mountInlineNavbar(root);
        bindCarouselScroll(root);
        const car = root.querySelector('#analytics-carousel');
        if (car) updateCarouselChrome(root, 0);
      }
    }
  }, 0);
}

async function applyPeriod(year, month) {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = isDesktop() ? renderDesktopSkeleton() : skeletonShellHTML();
  if (!isDesktop()) {
    bindCarouselScroll(root);
    void mountInlineNavbar(root);
  }
  try {
    const dash = calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: false,
      year,
      month,
    });
    setAnalyticsContext({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      rentals: _rentals,
    });
    mergeDashboardApiIntoDash_(dash);
    setAnalyticsContext({ trailing12: dash.trailing12 });
    applyDashToState(dash);
    if (isDesktop()) {
      root.innerHTML = renderDesktopShell(dash);
    } else {
      const empty = !dashboardHasContent(dash);
      destroyCapexChart();
      root.innerHTML = successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      afterShellMounted(root, dash);
    }
  } catch (err) {
    console.error('Analytics applyPeriod:', err);
    root.innerHTML = errorShellHTML(err.message === 'NO_CONNECTION');
    await mountInlineNavbar(root);
  }
}

async function applyAllTime() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  root.innerHTML = isDesktop() ? renderDesktopSkeleton() : skeletonShellHTML();
  if (!isDesktop()) {
    bindCarouselScroll(root);
    void mountInlineNavbar(root);
  }
  try {
    const now = new Date();
    const dash = calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: true,
      year: _pendingYear || now.getFullYear(),
      month: _pendingMonth || now.getMonth() + 1,
    });
    setAnalyticsContext({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      rentals: _rentals,
    });
    mergeDashboardApiIntoDash_(dash);
    setAnalyticsContext({ trailing12: dash.trailing12 });
    applyDashToState(dash);
    if (isDesktop()) {
      root.innerHTML = renderDesktopShell(dash);
    } else {
      const empty = !dashboardHasContent(dash);
      destroyCapexChart();
      root.innerHTML = successShellHTML(
        dash,
        empty ? 'Нет данных за выбранный период' : '',
        _capexMode,
      );
      afterShellMounted(root, dash);
    }
  } catch (err) {
    console.error('Analytics applyAllTime:', err);
    root.innerHTML = errorShellHTML(err.message === 'NO_CONNECTION');
    await mountInlineNavbar(root);
  }
}

function onRootClick(e) {
  const retry = e.target.closest('#analytics-retry');
  if (retry) {
    if (_loading) return;
    _loading = true;
    refreshViewOnly();
    requestAnimationFrame(() => {
      _loading = false;
    });
    return;
  }

  const dot = e.target.closest('[data-analytics-dot]');
  if (dot && dot.dataset.analyticsDot != null) {
    const root = document.getElementById('analytics-root');
    const car = root?.querySelector('#analytics-carousel');
    if (!car) return;
    const idx = Number(dot.dataset.analyticsDot) || 0;
    _currentPage = idx;
    car.scrollTo({ left: idx * car.offsetWidth, behavior: 'smooth' });
    updateCarouselChrome(root, idx);
    if (idx === 5) void hydrateForecast(root);
    return;
  }

  const pillAll = e.target.closest('[data-analytics-pill-all]');
  if (pillAll) {
    if (_loading) return;
    _loading = true;
    applyAllTime().finally(() => {
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
    applyPeriod(y, m).finally(() => {
      _loading = false;
    });
    return;
  }

  const openTabBtn = e.target.closest('[data-action="open-tab"]');
  if (openTabBtn && openTabBtn.dataset.tab) {
    const map = { opex: 1, capex: 2, pnl: 3, forecast: 5 };
    const idx = map[openTabBtn.dataset.tab];
    if (idx != null) {
      const rootEl = document.getElementById('analytics-root');
      const car = rootEl?.querySelector('#analytics-carousel');
      if (car) {
        _currentPage = idx;
        car.scrollTo({ left: idx * (car.offsetWidth || 1), behavior: 'smooth' });
        updateCarouselChrome(rootEl, idx);
        if (idx === 5) void hydrateForecast(rootEl);
      }
    }
    return;
  }

  const overviewRetry = e.target.closest('[data-overview-retry]');
  if (overviewRetry) {
    invalidateLocalCache(CACHE_KEYS.DASHBOARD);
    _dashApiExtrasError = false;
    _dashApiExtras = null;
    if (_loading) return;
    _loading = true;
    refreshViewOnly();
    requestAnimationFrame(() => {
      _loading = false;
    });
    return;
  }

  const capexModeBtn = e.target.closest('[data-capex-mode]');
  if (capexModeBtn) {
    const nextMode = String(capexModeBtn.dataset.capexMode || '');
    if (nextMode !== CAPEX_MODE.ALL && nextMode !== CAPEX_MODE.PERIOD) return;
    if (_capexMode === nextMode) return;
    _capexMode = nextMode;
    const root = document.getElementById('analytics-root');
    if (!root) return;
    const now = new Date();
    const dash = calcDash({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      allTime: _pendingAllTime,
      year: _pendingYear || now.getFullYear(),
      month: _pendingMonth || now.getMonth() + 1,
    });
    mergeDashboardApiIntoDash_(dash);
    setAnalyticsContext({
      ops: _ops,
      cars: _cars,
      kassas: _kassas,
      deposits: _deposits,
      rentals: _rentals,
      trailing12: dash.trailing12,
    });
    if (isDesktop()) {
      root.innerHTML = renderDesktopShell(dash);
    } else {
      destroyCapexChart();
    root.innerHTML = successShellHTML(dash, '', _capexMode);
      afterShellMounted(root, dash);
    }
  }
}

export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (root && !root.dataset.analyticsBound) {
    root.dataset.analyticsBound = '1';
    root.addEventListener('click', onRootClick);
  }

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-analytics') {
      resetForecastCache();
      destroyCapexChart();
      refreshViewOnly();
    }
  });
}
