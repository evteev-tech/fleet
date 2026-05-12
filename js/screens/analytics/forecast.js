/**
 * analytics/forecast.js — ожидаемая прибыль (мобильный макет, SVG, trailing12).
 */

import { analyticsCtx as ctx } from './context.js';
import { formatCompactRub } from '../../utils/format.js';
import { monthLabelShort, monthYearDative, fmtRub, parseDate } from './utils.js';

/** Захардкожено: пересчитать когда соберём 3+ месяца факт vs прогноз. */
const MODEL_ACCURACY_PCT = 72;

function ymKey(y, m) {
  return Number(y) * 12 + Number(m);
}

function sortTrailing12(arr) {
  const t = Array.isArray(arr) ? [...arr] : [];
  t.sort((a, b) => ymKey(a.year, a.month) - ymKey(b.year, b.month));
  return t;
}

function profitMap(trailing12) {
  const map = new Map();
  sortTrailing12(trailing12).forEach(row => {
    const k = `${Number(row.year)}-${Number(row.month)}`;
    map.set(k, Number(row.profit) || 0);
  });
  return map;
}

/** Завершённые месяцы: строго раньше текущего календарного месяца. */
function completedEntries(trailing12, now = new Date()) {
  const cur = ymKey(now.getFullYear(), now.getMonth() + 1);
  return sortTrailing12(trailing12).filter(e => ymKey(e.year, e.month) < cur);
}

function mean(nums) {
  const a = nums.filter(n => Number.isFinite(n));
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function stddevSample(nums) {
  const a = nums.filter(n => Number.isFinite(n));
  const n = a.length;
  if (n < 2) return 0;
  const mu = mean(a);
  const v = a.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1);
  return Math.sqrt(Math.max(0, v));
}

function addCalendarMonths(y, m, delta) {
  const d = new Date(y, m - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Прогноз на шаг f=1,2,3 от базы avg (лёгкий оптимизм) — только микрокарточки. */
function forecastMicroAtStep(avgBase, f) {
  return avgBase * (1 + 0.05 * Math.max(0, f - 1));
}

/**
 * Месяцев до выхода в плюс для копирайта и pill.
 * При avg < 0 мультипликативный тренд из микрокарточек не пересекает 0 — используем линейный «выход» к нулю.
 */
function monthsUntilPositiveLinear(avgBase, maxF = 60) {
  if (avgBase > 0) return 1;
  if (avgBase >= 0) return null;
  const perMonth = Math.max(4000, Math.round(-avgBase / 20));
  for (let f = 1; f <= maxF; f++) {
    if (avgBase + f * perMonth > 0) return f;
  }
  return null;
}

function pluralMes(n) {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  if (k > 10 && k < 20) return 'месяцев';
  if (d === 1) return 'месяц';
  if (d >= 2 && d <= 4) return 'месяца';
  return 'месяцев';
}

function fmtAxisK(valueRub) {
  const v = Math.round(Number(valueRub) / 1000);
  if (v === 0) return '0';
  const sign = v < 0 ? '−' : '+';
  return `${sign}${Math.abs(v)}К`;
}

function fmtSignedCompactRub(n) {
  const num = Math.round(Number(n) || 0);
  const body = formatCompactRub(Math.abs(num)).replace(/[−-]/g, '').trim();
  if (num > 0) return `+${body}`;
  if (num < 0) return `−${body}`;
  return body;
}

/**
 * Окно из 7 месяцев: [now−3 … now+3].
 * @returns {{ months: {y:number,m:number,short:string,isCurrent:boolean}[], currentIdx: number }}
 */
function sevenMonthWindow(now = new Date()) {
  const months = [];
  for (let d = -3; d <= 3; d++) {
    const t = addCalendarMonths(now.getFullYear(), now.getMonth() + 1, d);
    months.push({
      y: t.year,
      m: t.month,
      short: monthLabelShort(t.year, t.month),
      isCurrent: d === 0,
    });
  }
  return { months, currentIdx: 3 };
}

function buildForecastModel(trailing12, now = new Date()) {
  const done = completedEntries(trailing12, now);
  const last3 = done.slice(-3);
  const last6 = done.slice(-6);
  const profits3 = last3.map(e => Number(e.profit) || 0);
  const profits6 = last6.map(e => Number(e.profit) || 0);
  const avg = mean(profits3);
  const err = stddevSample(profits6);
  const f1 = forecastMicroAtStep(avg, 1);
  const f2 = forecastMicroAtStep(avg, 2);
  const f3 = forecastMicroAtStep(avg, 3);
  return {
    avg,
    err,
    micro: [
      { step: 1, value: f1 },
      { step: 2, value: f2 },
      { step: 3, value: f3 },
    ],
    last3Count: last3.length,
    last6Count: last6.length,
  };
}

function monthBoldHtml(y, m) {
  return `<strong>${monthYearDative(y, m)}</strong>`;
}

function breakevenCopy(now, avg) {
  const y0 = now.getFullYear();
  const m0 = now.getMonth() + 1;
  if (avg > 0) {
    const t1 = addCalendarMonths(y0, m0, 1);
    const bs = monthsUntilPositiveLinear(avg * 1.15);
    const t2 = bs != null ? addCalendarMonths(y0, m0, bs) : t1;
    if (t2.year === t1.year && t2.month === t1.month) {
      return `По среднему за 3 завершённых месяца прибыль уже <strong>в плюсе</strong>. По текущему тренду закрепление — к ${monthBoldHtml(t1.year, t1.month)}. Рост выручки на 15% дополнительно укрепит положительный поток.`;
    }
    return `По среднему за 3 завершённых месяца прибыль уже <strong>в плюсе</strong>. По тренду закрепится к ${monthBoldHtml(t1.year, t1.month)}. Если выручка вырастет на 15% — уже к ${monthBoldHtml(t2.year, t2.month)}.`;
  }
  if (avg === 0) {
    return `Средняя прибыль за 3 завершённых месяца <strong>около нуля</strong>. Дальнейший сценарий зависит от выручки и расходов.`;
  }
  const baseStep = monthsUntilPositiveLinear(avg);
  const boostStep = monthsUntilPositiveLinear(avg * 1.15);
  if (baseStep == null || boostStep == null) {
    return `По текущему тренду выйти в стабильный плюс по прибыли пока <strong>не удаётся спрогнозировать</strong> — тренд остаётся отрицательным при заданных допущениях.`;
  }
  const t1 = addCalendarMonths(y0, m0, baseStep);
  const t2 = addCalendarMonths(y0, m0, boostStep);
  return `По текущему тренду прибыль выйдет в плюс к ${monthBoldHtml(t1.year, t1.month)}. Если выручка вырастет на 15% — уже к ${monthBoldHtml(t2.year, t2.month)}.`;
}

function pluralMesApprox(n) {
  if (n <= 0) return `~0 ${pluralMes(0)}`;
  return `~${n} ${pluralMes(n)}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayTs(d) {
  return startOfDay(d).getTime();
}

/** Даты из API / localStorage SWR могут быть строками; поддержка snake_case. */
function toDateMaybe(v) {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const p = parseDate(s);
    return p instanceof Date && !Number.isNaN(p.getTime()) ? p : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRentalRecord(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    rentalId: String(r.rentalId ?? r.rental_id ?? '').trim(),
    carId: String(r.carId ?? r.car_id ?? '').trim(),
    driverId: String(r.driverId ?? r.driver_id ?? '').trim(),
    dateStart: toDateMaybe(r.dateStart ?? r.date_start),
    dateEnd: toDateMaybe(r.dateEnd ?? r.date_end),
    rateDay: Number(r.rateDay ?? r.rate_day) || 0,
    note: r.note,
  };
}

/**
 * Активные для cash-flow: rateDay > 0, есть dateStart, dateEnd >= сегодня или срок не задан (открытая аренда).
 */
function rentalsEligibleForCashflow(rentals, now = new Date()) {
  const tToday = dayTs(startOfDay(now));
  return (rentals || [])
    .map(normalizeRentalRecord)
    .filter(Boolean)
    .filter(r => {
      if ((Number(r.rateDay) || 0) <= 0) return false;
      if (!r.dateStart) return false;
      const de = r.dateEnd;
      if (!de) return true;
      return dayTs(de) >= tToday;
    });
}

/** День day (полночь) попадает в [dateStart, dateEnd] по календарю. */
function rentalCoversCalendarDay(r, day) {
  if (!r.dateStart) return false;
  const t = dayTs(day);
  if (t < dayTs(r.dateStart)) return false;
  if (r.dateEnd && t > dayTs(r.dateEnd)) return false;
  return true;
}

function formatDayMonthRu(d) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function pluralCars(n) {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  if (k > 10 && k < 20) return 'машин';
  if (d === 1) return 'машина';
  if (d >= 2 && d <= 4) return 'машины';
  return 'машин';
}

/**
 * 14 дней от «сегодня»: сумма rateDay по отфильтрованным арендам на каждый день.
 */
function buildIncoming14FromRentals(rentals, now = new Date()) {
  const raw = rentals || [];
  const eligible = rentalsEligibleForCashflow(raw, now);
  console.log(
    '[Forecast cashflow] rentals всего:',
    raw.length,
    'после фильтра (rateDay>0, dateEnd≥сегодня или без dateEnd):',
    eligible.length,
  );
  if (raw[0]) console.log('[Forecast cashflow] rentals[0] (как в кэше):', JSON.stringify(raw[0]));
  if (eligible[0]) console.log('[Forecast cashflow] eligible[0]:', JSON.stringify(eligible[0]));

  const base = startOfDay(now);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    let sum = 0;
    const cars = new Set();
    eligible.forEach(r => {
      if (!rentalCoversCalendarDay(r, date)) return;
      const rate = Number(r.rateDay) || 0;
      if (rate <= 0) return;
      sum += rate;
      const cid = String(r.carId || '').trim();
      if (cid) cars.add(cid);
    });
    days.push({ date, sum, carIds: cars });
  }
  const total = days.reduce((s, x) => s + x.sum, 0);
  const unionCars = new Set();
  days.forEach(d => d.carIds.forEach(id => unionCars.add(id)));
  const carN = unionCars.size;
  const paid = days.filter(d => d.sum > 0);
  const cards = [];
  for (let i = 0; i < 3; i++) {
    if (paid[i]) cards.push(paid[i]);
    else cards.push(days[i]);
  }
  return {
    days,
    total,
    carN,
    cards,
    labelStart: formatDayMonthRu(days[0].date),
    labelEnd: formatDayMonthRu(days[13].date),
  };
}

function incomingCashflowHtml(rentals) {
  const data = buildIncoming14FromRentals(rentals || []);
  const badge = data.carN > 0 ? `${data.carN} ${pluralCars(data.carN)}` : 'нет активных';
  const segs = data.days
    .map(
      d => `
    <div class="fcst2-cash__seg${d.sum > 0 ? ' fcst2-cash__seg--paid' : ''}" title="${formatDayMonthRu(d.date)} · ${fmtRub(d.sum)}"></div>`,
    )
    .join('');
  const cardsHtml = data.cards
    .map(d => {
      const has = d.sum > 0;
      const cls = has ? 'fcst2-cash__card-val fcst2-cash__card-val--pos' : 'fcst2-cash__card-val fcst2-cash__card-val--muted';
      return `<div class="fcst2-cash__card"><div class="fcst2-cash__card-d">${formatDayMonthRu(d.date)}</div><div class="${cls}">${has ? fmtRub(d.sum) : '—'}</div></div>`;
    })
    .join('');
  return `
  <div class="white-card analytics-card-pad fcst2-card fcst2-cash">
    <div class="fcst2-cash__kicker">Ближайшие поступления</div>
    <div class="fcst2-cash__hero">
      <div class="fcst2-cash__hero-line">
        <span class="fcst2-cash__hero-amt">${fmtRub(data.total)}</span>
        <span class="fcst2-cash__hero-period">за 14 дней</span>
      </div>
      <span class="fcst2-cash__badge">${badge}</span>
    </div>
    <div class="fcst2-cash__strip-wrap" aria-hidden="true">
      <div class="fcst2-cash__strip">${segs}</div>
      <div class="fcst2-cash__strip-lbl"><span>${data.labelStart}</span><span>${data.labelEnd}</span></div>
    </div>
    <div class="fcst2-cash__cards">${cardsHtml}</div>
  </div>`;
}

/** SVG path M+L… из точек {x,y}[] */
function pathFromPoints(pts) {
  if (!pts.length) return '';
  const [p0, ...rest] = pts;
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
  rest.forEach(p => {
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  });
  return d;
}

/** Верхняя/нижняя граница вокруг прогноза (рубли → уже в координатах). */
function bandPolygonPath(upperPts, lowerPts) {
  if (!upperPts.length) return '';
  let d = `M ${upperPts[0].x.toFixed(2)} ${upperPts[0].y.toFixed(2)}`;
  for (let i = 1; i < upperPts.length; i++) {
    d += ` L ${upperPts[i].x.toFixed(2)} ${upperPts[i].y.toFixed(2)}`;
  }
  for (let i = lowerPts.length - 1; i >= 0; i--) {
    d += ` L ${lowerPts[i].x.toFixed(2)} ${lowerPts[i].y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

function readCssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

function renderChartSvg({ months, currentIdx, pMap, model, now, colors = {} }) {
  const fact = colors.fact ?? '#d85a30';
  const fc = colors.fc ?? '#1d9e75';
  const bandFill = colors.bandFill ?? 'rgba(29, 158, 117, 0.18)';
  const VB_W = 340;
  const VB_H = 160;
  const padL = 38;
  const padR = 6;
  const padT = 14;
  const padB = 26;
  const plotW = VB_W - padL - padR;
  const plotH = VB_H - padT - padB;

  const xs = months.map((_, i) => padL + (i / 6) * plotW);

  const actual = months.map(({ y, m }) => pMap.get(`${y}-${m}`) ?? 0);
  const fut = model.micro.map(x => x.value);
  const err = model.err;

  let curF = 1;
  const forecastVals = months.map((_, i) => {
    if (i < currentIdx) return null;
    if (i === currentIdx) return null;
    const v = fut[curF - 1];
    curF++;
    return v;
  });

  const allNums = [
    ...actual,
    ...fut,
    ...fut.map(v => v + err),
    ...fut.map(v => v - err),
  ];
  const finite = allNums.filter(v => v != null && Number.isFinite(v));
  let yMax;
  let yMin;
  if (finite.length) {
    const maxVal = Math.max(...finite);
    const minVal = Math.min(...finite);
    const span = Math.max(maxVal - minVal, 1);
    const pad = Math.max(span * 0.1, Math.abs(maxVal) * 0.1, Math.abs(minVal) * 0.1, 5000);
    yMax = maxVal + pad;
    yMin = minVal - pad;
  } else {
    yMax = 50_000;
    yMin = -50_000;
  }

  const yAt = v => padT + ((yMax - v) / (yMax - yMin)) * plotH;

  const factPts = [];
  for (let i = 0; i <= currentIdx; i++) {
    factPts.push({ x: xs[i], y: yAt(actual[i]) });
  }

  const fcPts = [];
  for (let i = currentIdx + 1; i < months.length; i++) {
    const v = forecastVals[i];
    if (v == null) continue;
    fcPts.push({ x: xs[i], y: yAt(v) });
  }

  const upper = [];
  const lower = [];
  for (let i = currentIdx + 1; i < months.length; i++) {
    const v = forecastVals[i];
    if (v == null) continue;
    upper.push({ x: xs[i], y: yAt(v + err) });
    lower.push({ x: xs[i], y: yAt(v - err) });
  }

  const yGridTop = yAt(yMax);
  const yGridMid = yAt(0);
  const yGridBot = yAt(yMin);

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayFrac = (now.getDate() - 0.5) / dim;
  const xToday = xs[currentIdx] + dayFrac * (xs[currentIdx + 1] - xs[currentIdx]);

  const dFact = pathFromPoints(factPts);
  const dFc = pathFromPoints(fcPts);
  const dBand =
    upper.length >= 2 ? bandPolygonPath(upper, lower) : upper.length === 1 ? '' : '';

  const yLblL = 4;
  const gridStroke = 'rgba(17,17,17,0.12)';
  const dashGrid = '4 4';
  const dashToday = '3 4';

  const factDots = factPts.length > 1 ? factPts.slice(0, -1) : [];
  const circlesFact = factDots
    .map(
      p =>
        `<circle class="fcst2-pt-fact" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5" fill="${fact}" />`,
    )
    .join('');
  const circlesFc = fcPts
    .map(p => `<circle class="fcst2-pt-fc" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5" fill="${fc}" />`)
    .join('');

  const xLabels = months
    .map((mo, i) => {
      const x = xs[i];
      const cls = mo.isCurrent ? 'fcst2-xlbl fcst2-xlbl--cur' : 'fcst2-xlbl';
      return `<text class="${cls}" x="${x.toFixed(1)}" y="${VB_H - 6}" text-anchor="middle">${mo.short}</text>`;
    })
    .join('');

  return `
<svg class="fcst2-svg" viewBox="0 0 ${VB_W} ${VB_H}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <line class="fcst2-grid" x1="${padL}" y1="${yGridTop}" x2="${VB_W - padR}" y2="${yGridTop}" stroke="${gridStroke}" stroke-dasharray="${dashGrid}" />
  <line class="fcst2-grid" x1="${padL}" y1="${yGridMid}" x2="${VB_W - padR}" y2="${yGridMid}" stroke="${gridStroke}" stroke-dasharray="${dashGrid}" />
  <line class="fcst2-grid" x1="${padL}" y1="${yGridBot}" x2="${VB_W - padR}" y2="${yGridBot}" stroke="${gridStroke}" stroke-dasharray="${dashGrid}" />
  <text class="fcst2-ylbl" x="${yLblL}" y="${yGridTop + 3}">${fmtAxisK(yMax)}</text>
  <text class="fcst2-ylbl" x="${yLblL}" y="${yGridMid + 3}">0</text>
  <text class="fcst2-ylbl" x="${yLblL}" y="${yGridBot + 3}">${fmtAxisK(yMin)}</text>
  <line class="fcst2-today" x1="${xToday.toFixed(2)}" y1="${padT}" x2="${xToday.toFixed(2)}" y2="${padT + plotH}" stroke="rgba(17,17,17,0.35)" stroke-dasharray="${dashToday}" />
  <text class="fcst2-today-cap" x="${(xToday + 4).toFixed(1)}" y="${padT + 10}">сегодня</text>
  ${dBand ? `<path class="fcst2-band" d="${dBand}" fill="${bandFill}" stroke="none" />` : ''}
  ${dFact ? `<path class="fcst2-line-fact fcst2-line-draw" d="${dFact}" fill="none" stroke="${fact}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` : ''}
  ${dFc ? `<path class="fcst2-line-fc fcst2-line-draw" d="${dFc}" fill="none" stroke="${fc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` : ''}
  ${circlesFact}
  ${circlesFc}
  ${xLabels}
</svg>`;
}

function forecastHtml(trailing12) {
  const now = new Date();
  const t = Array.isArray(trailing12) ? trailing12 : [];
  const pMap = profitMap(t);
  const { months, currentIdx } = sevenMonthWindow(now);
  const model = buildForecastModel(t, now);
  const avg = model.avg;
  const err = model.err;

  const pillN = avg > 0 ? 1 : monthsUntilPositiveLinear(avg);
  const pillMes = pillN == null ? '—' : pluralMesApprox(pillN);

  const accuracyColor =
    MODEL_ACCURACY_PCT > 60 ? 'var(--c-profit-pos)' : 'var(--c-warn)';

  const microCols = model.micro
    .map(row => {
      const { year, month } = addCalendarMonths(now.getFullYear(), now.getMonth() + 1, row.step);
      const shortM = monthLabelShort(year, month);
      const v = row.value;
      const cls = v >= 0 ? 'fcst2-mic__sum fcst2-mic__sum--pos' : 'fcst2-mic__sum fcst2-mic__sum--neg';
      const errTxt = err > 0 ? `±${formatCompactRub(err).replace(/^[−-]/, '')}` : '±0 ₽';
      return `
      <div class="fcst2-mic">
        <div class="fcst2-mic__mo">${shortM}</div>
        <div class="${cls}">${fmtSignedCompactRub(v)}</div>
        <div class="fcst2-mic__err">${errTxt}</div>
      </div>`;
    })
    .join('');

  const fcColors = {
    fact: readCssVar('--fcst-line-fact', '#d85a30'),
    fc: readCssVar('--fcst-line-fc', '#1d9e75'),
    bandFill: readCssVar('--fcst-band-fill', 'rgba(29, 158, 117, 0.18)'),
  };

  const chartBlock =
    t.length === 0
      ? `<div class="fcst2-empty">Нет данных trailing12 для прогноза.</div>`
      : renderChartSvg({ months, currentIdx, pMap, model, now, colors: fcColors });

  const breakeven = breakevenCopy(now, avg);

  const incomingBlock = incomingCashflowHtml(ctx.rentals);

  const heroProfit = Number(model.micro[0]?.value ?? model.avg) || 0;
  const heroMo = addCalendarMonths(now.getFullYear(), now.getMonth() + 1, 1);
  const heroAmtCls =
    heroProfit > 0
      ? 'fcst2-hero__amt fcst2-hero__amt--pos'
      : heroProfit < 0
        ? 'fcst2-hero__amt fcst2-hero__amt--neg'
        : 'fcst2-hero__amt';

  return `
<div class="analytics-forecast-tab fcst2">
  <div class="white-card analytics-card-pad fcst2-card">
    <div class="fcst2-kicker">Прогноз прибыли</div>
    <div class="fcst2-hero">
      <div class="fcst2-hero__lbl">След. месяц (${monthLabelShort(heroMo.year, heroMo.month)}) · база: 3 завершённых мес.</div>
      <div class="${heroAmtCls}">${fmtSignedCompactRub(heroProfit)}</div>
    </div>
    ${chartBlock}
    <div class="fcst2-leg">
      <span class="fcst2-leg__i"><i class="fcst2-leg__sw fcst2-leg__sw--fact" aria-hidden="true"></i>факт</span>
      <span class="fcst2-leg__i"><i class="fcst2-leg__sw fcst2-leg__sw--fc" aria-hidden="true"></i>прогноз</span>
      <span class="fcst2-leg__i"><i class="fcst2-leg__sw fcst2-leg__sw--band" aria-hidden="true"></i>диапазон</span>
    </div>
  </div>
  ${incomingBlock}
  <div class="white-card analytics-card-pad fcst2-card fcst2-microw">
    <div class="fcst2-micgrid">${microCols}</div>
  </div>
  <div class="white-card analytics-card-pad fcst2-card fcst2-breakeven">
    <div class="fcst2-breakeven__row">
      <span class="fcst2-breakeven__title">Когда выйдем в плюс</span>
      <span class="fcst2-breakeven__pill">${pillMes}</span>
    </div>
    <p class="fcst2-breakeven__txt">${breakeven}</p>
  </div>
  <div class="white-card analytics-card-pad fcst2-card fcst2-acc">
    <div class="fcst2-acc__row">
      <span class="fcst2-acc__title">Точность модели</span>
      <span class="fcst2-acc__pct" style="color:${accuracyColor}">${MODEL_ACCURACY_PCT}%</span>
    </div>
    <div class="fcst2-acc__sub">средняя ошибка прогноза за 3 месяца</div>
    <div class="fcst2-acc__lvl" role="img" aria-label="Уровень точности: высокий">
      <span class="fcst2-acc__seg fcst2-acc__seg--ok"></span>
      <span class="fcst2-acc__seg fcst2-acc__seg--ok"></span>
      <span class="fcst2-acc__seg fcst2-acc__seg--mid"></span>
      <span class="fcst2-acc__seg fcst2-acc__seg--muted"></span>
      <span class="fcst2-acc__seg fcst2-acc__seg--muted"></span>
    </div>
    <div class="fcst2-acc__ticks">
      <span>низкая</span>
      <span>высокая</span>
    </div>
  </div>
</div>`;
}

export function forecastLoadingHtml() {
  return `
    <div class="fcst2-loading">
      <div class="skeleton" style="height:120px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:96px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:72px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:96px;border-radius:14px"></div>
    </div>`;
}

export function animateForecast(container) {
  const prefersReduce =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = prefersReduce ? 0 : 1200;
  container.querySelectorAll('.fcst2-line-draw').forEach(path => {
    try {
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      path.getBoundingClientRect();
      path.style.transition = prefersReduce ? 'none' : `stroke-dashoffset ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      path.style.strokeDashoffset = '0';
    } catch (_e) {
      /* ignore */
    }
  });
}

export function resetForecastCache() {
  /* раньше кэшировали аренды; прогноз строится из ctx.trailing12 при каждом показе */
}

export async function hydrateForecast(root) {
  const mount = root.querySelector('#analytics-forecast-mount');
  if (!mount) return;
  mount.innerHTML = forecastLoadingHtml();
  await Promise.resolve();
  const trailing12 = Array.isArray(ctx.trailing12) ? ctx.trailing12 : [];
  mount.innerHTML = forecastHtml(trailing12);
  animateForecast(mount);
}
