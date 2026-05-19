/**
 * analytics/overview.js — вкладка «Overview» (мобильная аналитика).
 */

import { fmtRub, fmtRuInt, formatCompactRub } from '../../utils/format.js';
import { analyticsCtx as ctx } from './context.js';
import { renderParkLoadBlock } from './parkLoad.js';

const MONTHS_DATIVE = [
  'январю',
  'февралю',
  'марту',
  'апрелю',
  'маю',
  'июню',
  'июлю',
  'августу',
  'сентябрю',
  'октябрю',
  'ноябрю',
  'декабрю',
];
const MONTHS_NOMINATIVE = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

const RUB_FMT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

function formatProfitMain(n) {
  const v = Math.round(Number(n) || 0);
  const body = RUB_FMT.format(Math.abs(v));
  if (v > 0) return `+${body} ₽`;
  if (v < 0) return `−${body} ₽`;
  return `${body} ₽`;
}

/** Классификация статуса машины для блока «Парк сегодня» */
function fleetBucket(statusRaw) {
  const s = String(statusRaw || '').toLowerCase();
  if (s.includes('ремонт')) return 'repair';
  if (s.includes('аренд')) return 'rent';
  if (s === 'простой' || s === 'свободна' || s.includes('простой') || s.includes('свобод')) return 'idle';
  return 'idle';
}

function countFleetSegments(cars) {
  const list = Array.isArray(cars) ? cars : [];
  let rent = 0;
  let idle = 0;
  let repair = 0;
  for (let i = 0; i < list.length; i++) {
    const b = fleetBucket(list[i]?.status);
    if (b === 'rent') rent += 1;
    else if (b === 'repair') repair += 1;
    else idle += 1;
  }
  return { rent, idle, repair, total: list.length };
}

function pluralCategories(n) {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  if (k > 10 && k < 20) return `${n} категорий`;
  if (d === 1) return `${n} категория`;
  if (d >= 2 && d <= 4) return `${n} категории`;
  return `${n} категорий`;
}

function nextMonthNominative() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return MONTHS_NOMINATIVE[d.getMonth()] || '';
}

function cumulativeSeries(trailing12) {
  const t = Array.isArray(trailing12) ? trailing12 : [];
  const acc = [];
  let sum = 0;
  for (let i = 0; i < t.length; i++) {
    sum += Number(t[i]?.profit) || 0;
    acc.push(sum);
  }
  return acc;
}

/**
 * Inline SVG спарклайн 80×36: накопительная прибыль.
 * @returns {{ html: string, isEmpty: boolean }}
 */
function sparklineMarkup(trailing12, finalCumulative) {
  const pts = cumulativeSeries(trailing12);
  if (!pts.length) {
    return { html: '<span class="overview-tab__spark-dash">—</span>', isEmpty: true };
  }

  const w = 80;
  const h = 36;
  const padX = 2;
  const padY = 4;
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 0);
  const range = max - min || 1;

  const coords = pts.map((v, i) => {
    const x = padX + (i / Math.max(1, pts.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (v - min) / range) * (h - padY * 2);
    return { x, y };
  });

  const linePts = coords.map(c => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const firstX = coords[0].x.toFixed(2);
  const lastX = coords[coords.length - 1].x.toFixed(2);
  const lastY = coords[coords.length - 1].y.toFixed(2);
  const bottomY = (h - padY).toFixed(2);
  const polygonPts = `${linePts} ${lastX},${bottomY} ${firstX},${bottomY}`;

  const positive = (Number(finalCumulative) || 0) >= 0;
  const stroke = positive ? 'var(--c-revenue)' : 'var(--cat-parts)';
  const gradId = `ovg-${positive ? 'p' : 'n'}-${pts.length}-${Math.random().toString(36).slice(2, 9)}`;

  const svg =
    `<svg class="overview-tab__spark-svg" width="80" height="36" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${stroke}" stop-opacity="0.22"/>` +
    `<stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<polygon points="${polygonPts}" fill="url(#${gradId})"/>` +
    `<polyline fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${linePts}"/>` +
    `<circle cx="${lastX}" cy="${lastY}" r="2.5" fill="#fff" stroke="${stroke}" stroke-width="1.2"/>` +
    `</svg>`;

  return { html: svg, isEmpty: false };
}

function deltaBadgeHtml(trailing12) {
  const t = Array.isArray(trailing12) ? trailing12 : [];
  if (t.length < 2) return { badge: '', suffix: '' };

  const last = t[t.length - 1];
  const prev = t[t.length - 2];
  const pc = Number(last?.profit) || 0;
  const pp = Number(prev?.profit) || 0;

  const prevMonthIdx = (Number(prev?.month) || 1) - 1;
  const prevName = MONTHS_DATIVE[prevMonthIdx] || '';
  const suffix = prevName ? ` к ${prevName}` : '';

  if (pc === pp) {
    return {
      badge: pc === 0
        ? `<span class="overview-tab__pill overview-tab__pill--neutral">—</span>`
        : `<span class="overview-tab__pill overview-tab__pill--neutral">0 ₽</span>`,
      suffix,
    };
  }
  // Случай pp === 0, pc !== 0 проваливается в общий расчёт ниже:
  // deltaRub = pc, знак и цвет корректные → бейдж «↗ +N» или «↘ −N».

  // Дельта в рублях устойчива к смене знака (prev < 0, curr > 0 и т.п.):
  // в отличие от %, такая разница всегда корректно отражает «лучше / хуже».
  const deltaRub = pc - pp;
  const improved = deltaRub > 0;
  const sign = improved ? '+' : '−';
  const body = formatCompactRub(Math.abs(deltaRub));
  const text = `${sign}${body}`;

  if (improved) {
    return {
      badge:
        `<span class="overview-tab__pill overview-tab__pill--up">` +
        `<i class="ti ti-arrow-up-right" aria-hidden="true"></i>${text}</span>`,
      suffix,
    };
  }
  return {
    badge:
      `<span class="overview-tab__pill overview-tab__pill--down">` +
      `<i class="ti ti-arrow-down-right" aria-hidden="true"></i>${text}</span>`,
    suffix,
  };
}

function stackedBarSegments(counts) {
  const segs = [
    { key: 'rent', n: counts.rent, color: 'var(--c-chart-fleet-rent)', label: 'Аренда' },
    { key: 'idle', n: counts.idle, color: 'var(--c-chart-fleet-idle)', label: 'Простой' },
    { key: 'repair', n: counts.repair, color: 'var(--c-chart-fleet-repair)', label: 'Ремонт' },
  ].filter(s => s.n > 0);
  if (!segs.length) {
    return { bar: '', legend: '' };
  }

  const total = segs.reduce((a, s) => a + s.n, 0);
  const only = segs.length === 1;

  const bar = segs
    .map((s, i) => {
      const flex = s.n;
      let rad = '0';
      if (only) rad = '4px';
      else if (i === 0) rad = '4px 0 0 4px';
      else if (i === segs.length - 1) rad = '0 4px 4px 0';
      return `<div class="overview-tab__stack-seg" style="flex:${flex};background:${s.color};border-radius:${rad}"></div>`;
    })
    .join('');

  const legend = segs
    .map(
      s =>
        `<span class="overview-tab__legend-item"><span class="overview-tab__legend-dot" style="background:${s.color}"></span>${s.label} · ${s.n}</span>`,
    )
    .join('');

  return { bar, legend };
}

/**
 * Скелетон первой страницы карусели (паттерн как fleet).
 */
export function renderOverviewSkeleton() {
  const sk = (h, mb = 10) =>
    `<div class="skeleton" style="height:${h}px;border-radius:12px;margin-bottom:${mb}px;width:100%"></div>`;
  return `
    <div class="overview-tab overview-tab--skeleton">
      <div class="white-card overview-tab__card">${sk(120)}${sk(72, 8)}</div>
      <div class="white-card overview-tab__card">${sk(140)}</div>
      <div class="white-card overview-tab__card">${sk(88)}</div>
      <div class="overview-tab__shortcuts-skel">
        ${[1, 2, 3, 4].map(() => `<div class="skeleton" style="height:92px;border-radius:12px"></div>`).join('')}
      </div>
    </div>`;
}

/**
 * @param {object} dash — объект дашборда (calcDash + поля с бэкенда)
 */
export function renderOverview(dash) {
  if (dash?.overviewExtrasError) {
    return `
      <div class="overview-tab">
        <div class="white-card overview-tab__card overview-tab__error-card">
          <p class="overview-tab__error-text">Не удалось загрузить данные. Потяните вниз для обновления.</p>
          <button type="button" class="btn-primary overview-tab__retry" data-overview-retry="1">Повторить</button>
        </div>
      </div>`;
  }

  const byKey = key => dash.summary?.find(s => s.key === key) || {};
  const revenue = Number(byKey('revenue').current) || 0;
  const opex = Number(byKey('opex').current) || 0;
  const capexPeriod = Number(byKey('capex').current) || 0;
  const profit = Number(byKey('profit').current) || 0;

  const trailing12 = Array.isArray(dash.trailing12) ? dash.trailing12 : [];
  const cumulativeProfit = Number(dash.cumulativeProfit) || 0;
  const capexTotal = Number(dash.capexTotal) || 0;
  const paybackMonths = dash.paybackMonths;
  const forecastNextMonth = Number(dash.forecastNextMonth) || 0;

  const spark = sparklineMarkup(trailing12, cumulativeProfit);
  const { badge, suffix } = deltaBadgeHtml(trailing12);

  const opexPctRev = revenue > 0 ? Math.min(100, Math.round((opex / revenue) * 100)) : 0;
  const capexPctRev = revenue > 0 ? Math.min(100, Math.round((capexPeriod / revenue) * 100)) : 0;

  const fleet = countFleetSegments(ctx.cars);
  const inWork = fleet.rent;
  const pctWork = fleet.total > 0 ? Math.round((inWork / fleet.total) * 100) : 0;
  const { bar: stackBar, legend: stackLegend } = stackedBarSegments(fleet);

  const pnlList = Array.isArray(dash.pnl) ? dash.pnl : [];
  const opexList = Array.isArray(dash.opex) ? dash.opex : [];
  const negPnl = pnlList.filter(p => Number(p.profit) < 0).length;

  // paybackMonths: null = не окупается / нет данных, 0 = уже окупилось, N>0 = месяцев до окупа.
  let capexCta = '';
  if (paybackMonths === null || paybackMonths === undefined) capexCta = 'не окупается';
  else if (Number(paybackMonths) === 0) capexCta = 'окупилось';
  else if (Number(paybackMonths) > 0) capexCta = `окуп. ${paybackMonths} мес`;
  const capexCtaLine = `${capexCta} →`;

  const nextMo = nextMonthNominative();
  // formatCompactRub сам подставляет «−» для отрицательных; добавляем «+» только если > 0.
  const fcBody = formatCompactRub(Math.abs(forecastNextMonth));
  let fcMain;
  if (forecastNextMonth > 0) fcMain = `+${fcBody}`;
  else if (forecastNextMonth < 0) fcMain = `−${fcBody}`;
  else fcMain = fcBody;

  return `
    <div class="overview-tab">
      <div class="white-card overview-tab__card overview-tab__hero-card">
        <div class="overview-tab__hero-top">
          <div class="overview-tab__hero-left">
            <div class="overview-tab__kicker">Прибыль за месяц</div>
            <div class="overview-tab__profit ${profit >= 0 ? 'overview-tab__profit--pos' : 'overview-tab__profit--neg'}">${formatProfitMain(profit)}</div>
            <div class="overview-tab__delta-row">
              ${badge}
              <span class="overview-tab__delta-suffix">${suffix}</span>
            </div>
          </div>
          <div class="overview-tab__hero-right">
            <div class="overview-tab__spark-wrap">${spark.html}</div>
            <div class="overview-tab__spark-caption">12 мес</div>
          </div>
        </div>
        <div class="overview-tab__divider"></div>
        <div class="overview-tab__bars">
          <div class="overview-tab__bar-row">
            <div class="overview-tab__bar-head">
              <div class="overview-tab__bar-left">
                <span class="overview-tab__swatch" style="background:var(--c-chart-revenue)"></span>
                <span class="overview-tab__bar-title">Выручка</span>
              </div>
              <span class="overview-tab__bar-sum">${fmtRub(revenue)}</span>
            </div>
            <div class="overview-tab__bar-track"><div class="overview-tab__bar-fill" style="width:100%;background:var(--c-chart-revenue)"></div></div>
          </div>
          <div class="overview-tab__bar-row">
            <div class="overview-tab__bar-head">
              <div class="overview-tab__bar-left">
                <span class="overview-tab__swatch" style="background:var(--c-chart-opex-agg)"></span>
                <span class="overview-tab__bar-title">OPEX</span>
                ${revenue > 0 ? `<span class="overview-tab__bar-pct">${opexPctRev}% от выручки</span>` : ''}
              </div>
              <span class="overview-tab__bar-sum">${fmtRub(opex)}</span>
            </div>
            <div class="overview-tab__bar-track"><div class="overview-tab__bar-fill" style="width:${opexPctRev}%;background:var(--c-chart-opex-agg)"></div></div>
          </div>
          <div class="overview-tab__bar-row">
            <div class="overview-tab__bar-head">
              <div class="overview-tab__bar-left">
                <span class="overview-tab__swatch" style="background:var(--c-chart-capex)"></span>
                <span class="overview-tab__bar-title">CAPEX</span>
                ${capexPeriod > 0 ? `<span class="overview-tab__bar-pct">за период</span>` : ''}
              </div>
              <span class="overview-tab__bar-sum">${fmtRub(capexPeriod)}</span>
            </div>
            <div class="overview-tab__bar-track">${capexPeriod > 0 ? `<div class="overview-tab__bar-fill" style="width:${capexPctRev}%;background:var(--c-chart-capex)"></div>` : ''}</div>
          </div>
        </div>
      </div>

      ${renderParkLoadBlock(dash)}

      <div class="white-card overview-tab__card overview-tab__fleet-card">
        <div class="overview-tab__fleet-head">
          <span class="overview-tab__fleet-title">Парк сегодня</span>
          <span class="overview-tab__fleet-meta">${inWork} из ${fleet.total} в работе · ${pctWork}%</span>
        </div>
        <div class="overview-tab__stack-bar">${stackBar || `<div class="overview-tab__stack-seg" style="flex:1;background:var(--color-background-secondary, #f0f1f3);border-radius:4px"></div>`}</div>
        <div class="overview-tab__legend-row">${stackLegend}</div>
      </div>

      <div class="overview-tab__shortcuts">
        <button type="button" class="overview-tab__sc-btn" data-action="open-tab" data-tab="opex">
          <div class="overview-tab__sc-top"><i class="ti ti-chart-pie" aria-hidden="true"></i><span>OPEX</span></div>
          <div class="overview-tab__sc-main">${formatCompactRub(opex)}</div>
          <div class="overview-tab__sc-cta">${pluralCategories(opexList.length)} →</div>
        </button>
        <button type="button" class="overview-tab__sc-btn" data-action="open-tab" data-tab="pnl">
          <div class="overview-tab__sc-top"><i class="ti ti-car" aria-hidden="true"></i><span>PnL по машинам</span></div>
          <div class="overview-tab__sc-main">${fmtRuInt(pnlList.length)} машин</div>
          <div class="overview-tab__sc-cta">${negPnl} в минусе →</div>
        </button>
        <button type="button" class="overview-tab__sc-btn" data-action="open-tab" data-tab="capex">
          <div class="overview-tab__sc-top"><i class="ti ti-coin" aria-hidden="true"></i><span>CAPEX</span></div>
          <div class="overview-tab__sc-main">${formatCompactRub(capexTotal)}</div>
          <div class="overview-tab__sc-cta">${capexCtaLine}</div>
        </button>
        <button type="button" class="overview-tab__sc-btn" data-action="open-tab" data-tab="forecast">
          <div class="overview-tab__sc-top"><i class="ti ti-trending-up" aria-hidden="true"></i><span>Прогноз</span></div>
          <div class="overview-tab__sc-main">${fcMain}</div>
          <div class="overview-tab__sc-cta">${nextMo} →</div>
        </button>
      </div>
    </div>`;
}
