/**
 * analytics/forecast.js — прогноз поступлений (14 дней)
 */

import { getActiveRentals } from '../../api.js';
import { fmtRub, fmtRuInt } from './utils.js';

let forecastRentalsCache = null;

export function resetForecastCache() {
  forecastRentalsCache = null;
}

function parseDDMMYYYY(str) {
  if (!str) return null;
  const s = String(str).trim();
  const parts = s.split('.');
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildForecast(rentals) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    day.setHours(0, 0, 0, 0);
    let total = 0;
    const cars = [];
    (rentals || []).forEach(r => {
      const end = parseDDMMYYYY(r.date_end);
      const start = parseDDMMYYYY(r.date_start);
      if (!end || !start) return;
      if (day >= start && day <= end) {
        total += Number(r.rate_day) || 0;
        cars.push(r.car_id);
      }
    });
    days.push({ day, total, cars });
  }
  return days;
}

function forecastHtml(rentals) {
  const days = buildForecast(rentals || []);
  const totalPeriod = days.reduce((s, d) => s + d.total, 0);
  const activeCount = (rentals || []).length;
  const avgDay = totalPeriod > 0 ? Math.round(totalPeriod / 14) : 0;

  const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function weekLabel(wDays) {
    const first = wDays[0].day;
    const last = wDays[wDays.length - 1].day;
    const f = `${first.getDate()} ${MON_SHORT[first.getMonth()]}`;
    const l = `${last.getDate()} ${MON_SHORT[last.getMonth()]}`;
    return `${f} — ${l}`;
  }

  function weekBars(wDays, globalMax, weekIdx) {
    return wDays
      .map((d, i) => {
        const isToday = weekIdx === 0 && i === 0;
        const heightPx = globalMax > 0 ? Math.round((d.total / globalMax) * 44) : 3;
        const safeH = Math.max(3, heightPx);
        let color = 'var(--c-muted)';
        if (d.total >= globalMax * 0.9) color = 'var(--c-bar-100)';
        else if (d.total >= globalMax * 0.6) color = 'var(--c-bar-75)';
        else if (d.total >= globalMax * 0.3) color = 'var(--c-bar-50)';
        else if (d.total === 0) color = 'var(--c-bar-empty)';
        return `
        <div class="fcst-wk__col${isToday ? ' fcst-wk__col--today' : ''}">
          <div class="fcst-wk__fill" style="height:${safeH}px;background:${color}"></div>
          <div class="fcst-wk__day">${DAY_NAMES[d.day.getDay()]}</div>
        </div>`;
      })
      .join('');
  }

  function weekBlock(wDays, globalMax, weekIdx) {
    const total = wDays.reduce((s, d) => s + d.total, 0);
    const maxCars = Math.max(...wDays.map(d => d.cars.length));
    const metaText = maxCars > 0 ? `до ${maxCars} маш. в день` : 'нет аренд';
    const amtColor =
      total >= totalPeriod * 0.6 ? 'var(--c-profit)' : total > 0 ? 'var(--c-bar-75)' : 'var(--c-muted)';
    return `
      <div class="white-card fcst-wk">
        <div class="fcst-wk__head">
          <div class="sec">${weekLabel(wDays)}</div>
          <div class="fcst-wk__meta">${metaText}</div>
        </div>
        <div class="fcst-wk__amt" style="color:${amtColor}">${fmtRub(total)}</div>
        <div class="fcst-wk__bars">
          ${weekBars(wDays, globalMax, weekIdx)}
        </div>
      </div>`;
  }

  const globalMax = Math.max(1, ...days.map(d => d.total));

  const nearest3 = days
    .slice(0, 3)
    .map((d, i) => {
      const isToday = i === 0;
      const dateLabel = `${d.day.getDate()} ${DAY_NAMES[d.day.getDay()]}`;
      const carsLabel = d.cars.length > 0 ? `${d.cars.length} маш.` : '—';
      return `
      <div class="fcst-nd${isToday ? ' fcst-nd--today' : ''}">
        <div class="fcst-nd__date">${dateLabel}</div>
        <div class="fcst-nd__amt">${d.total > 0 ? fmtRuInt(d.total) : '—'}</div>
        <div class="fcst-nd__cur">${d.total > 0 ? '₽' : ''}</div>
        <div class="fcst-nd__cars">${carsLabel}</div>
      </div>`;
    })
    .join('');

  return `
    <div class="fcst-hero">
      <div class="fcst-hero__label">ПРОГНОЗ · 14 ДНЕЙ</div>
      <div class="fcst-hero__amount">${fmtRub(totalPeriod)}</div>
      <div class="fcst-hero__sub">${activeCount} активных аренд · ${fmtRub(avgDay)}/день в среднем</div>
    </div>
    ${weekBlock(days.slice(0, 7), globalMax, 0)}
    ${weekBlock(days.slice(7, 14), globalMax, 1)}
    <div class="white-card fcst-nearest">
      <div class="sec">Ближайшие 3 дня</div>
      <div class="fcst-nd__grid">${nearest3}</div>
    </div>`;
}

export function forecastLoadingHtml() {
  return `
    <div class="fcst-loading">
      <div class="skeleton" style="height:88px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:160px;border-radius:14px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:240px;border-radius:14px"></div>
    </div>`;
}

export function animateForecast(container) {
  container.querySelectorAll('.fcst-wk__fill').forEach((fill, i) => {
    const finalH = fill.style.height;
    fill.style.height = '0px';
    fill.style.transition = 'none';
    fill.getBoundingClientRect();
    fill.style.transition = `height 0.45s cubic-bezier(.4,0,.2,1) ${(0.04 + i * 0.04).toFixed(2)}s`;
    fill.style.height = finalH;
  });
  container.querySelectorAll('.fcst-nd').forEach((nd, i) => {
    nd.style.opacity = '0';
    nd.style.transform = 'translateY(8px)';
    nd.style.transition = 'none';
    nd.getBoundingClientRect();
    nd.style.transition = `opacity 0.3s ${(0.3 + i * 0.08).toFixed(2)}s ease, transform 0.3s ${(0.3 + i * 0.08).toFixed(2)}s ease`;
    nd.style.opacity = '1';
    nd.style.transform = 'translateY(0)';
  });
}

export async function hydrateForecast(root) {
  const mount = root.querySelector('***REMOVED***analytics-forecast-mount');
  if (!mount) return;
  if (forecastRentalsCache !== null) {
    mount.innerHTML = forecastHtml(forecastRentalsCache);
    animateForecast(mount);
    return;
  }
  mount.innerHTML = forecastLoadingHtml();
  try {
    const res = await getActiveRentals();
    forecastRentalsCache = res?.rentals || [];
    mount.innerHTML = forecastHtml(forecastRentalsCache);
    animateForecast(mount);
  } catch (_e) {
    mount.innerHTML = `<div class="white-card analytics-card-pad analytics-muted">Не удалось загрузить прогноз</div>`;
  }
}
