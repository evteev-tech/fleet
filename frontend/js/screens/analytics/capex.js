/**
 * analytics/capex.js — вкладка CAPEX (мобильный макет + данные для Chart.js).
 *
 * Структура инвестиций: `dash.capexStructureByCategory` — только klass_itog=capex, колонка G,
 * за всё время; нормализация как в `normalizeCapexCategoryG`. Сегмент «За период / всё время» на структуру не влияет.
 */

import { formatCompactRub } from '../../utils/format.js';
import { buildCapexWaterfallModel } from './capexCharts.js';
import { fmtRub, CAPEX_MODE } from './utils.js';

/** Нормализация колонки G (категория): lowerCase, `_` → пробел, trim. */
export function normalizeCapexCategoryG(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();
}

/**
 * Бакет «Структура инвестиций» по нормализованной категории (см. analytics.js capexStructureByCategory).
 * Порядок: Покупки → Запчасти → Ремонты → Прочее.
 */
export function capexStructureBucket(detailText) {
  const v = normalizeCapexCategoryG(detailText);
  if (!v) return 'Прочее';
  if (v.includes('покупк') || v.includes('машин') || v.includes('авто') || v.includes('доставк')) return 'Покупки';
  if (v.includes('запчаст') || v.includes('детал')) return 'Запчасти';
  if (v.includes('ремонт')) return 'Ремонты';
  return 'Прочее';
}

function avgProfitLast6(dash) {
  const t = Array.isArray(dash.trailing12) ? dash.trailing12 : [];
  const last6 = t.slice(-6);
  if (!last6.length) return 0;
  const sum = last6.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  return sum / last6.length;
}

function structureRows(grouped) {
  const rows = [
    { key: 'Покупки', color: 'var(--capex-bucket-buy)', amount: grouped.get('Покупки') || 0 },
    { key: 'Запчасти', color: 'var(--capex-bucket-parts)', amount: grouped.get('Запчасти') || 0 },
    { key: 'Ремонты', color: 'var(--capex-bucket-repair)', amount: grouped.get('Ремонты') || 0 },
    { key: 'Прочее', color: 'var(--capex-bucket-other)', amount: grouped.get('Прочее') || 0 },
  ];
  const max = Math.max(1, ...rows.map(r => r.amount));
  return rows
    .map(r => {
      const w = max > 0 ? (r.amount / max) * 100 : 0;
      return `
      <div class="capex2-str__row">
        <div class="capex2-str__track">
          <div class="capex2-str__fill" style="width:${w.toFixed(2)}%;background:${r.color}"></div>
        </div>
        <div class="capex2-str__meta">
          <span class="capex2-str__name">${r.key}</span>
          <span class="capex2-str__amt">${fmtRub(r.amount)}</span>
        </div>
      </div>`;
    })
    .join('');
}

export function revealCapexAnimations(pageEl) {
  const root = pageEl?.querySelector?.('.analytics-capex-tab');
  if (!root) return;
  requestAnimationFrame(() => root.classList.add('analytics-capex-tab--inview'));
}

export function renderCapex(dash, capexMode = CAPEX_MODE.PERIOD) {
  const s = dash.summary?.find(x => x.key === 'capex');
  if (!s) {
    return `<div class="white-card analytics-card-pad"><div class="analytics-muted">Нет данных</div></div>`;
  }
  const isAll = capexMode === CAPEX_MODE.ALL;
  const structureSource =
    Array.isArray(dash.capexStructureByCategory) && dash.capexStructureByCategory.length
      ? dash.capexStructureByCategory
      : dash.capexByCategoryAll || [];

  const grouped = new Map([
    ['Покупки', 0],
    ['Запчасти', 0],
    ['Ремонты', 0],
    ['Прочее', 0],
  ]);
  structureSource.forEach(row => {
    const b = capexStructureBucket(row.name);
    grouped.set(b, (grouped.get(b) || 0) + (Number(row.amount) || 0));
  });

  const catTotals = Object.fromEntries(structureSource.map(r => [r.name, Number(r.amount) || 0]));
  console.log('[CAPEX structure] уникальные категории (G, нормализовано) → ₽', catTotals);
  console.log('[CAPEX structure] бакеты:', Object.fromEntries(grouped));

  const capexTotal = Number(dash.capexAll) || 0;
  const cumulativeProfit = Number(dash.cumulativeProfit) || 0;

  const wf = buildCapexWaterfallModel(dash.year, dash.month, 4);
  const chartEnc = encodeURIComponent(JSON.stringify(wf));

  const earned = Math.max(0, cumulativeProfit);
  const pctDisplay = capexTotal > 0 ? Math.round((earned / capexTotal) * 100) : 0;
  const pctBar = Math.min(100, Math.max(0, pctDisplay));

  const pm = dash.paybackMonths;
  const paybackKnown = pm !== null && pm !== undefined && !Number.isNaN(Number(pm));
  const paybackLine = paybackKnown
    ? `${Number(pm) === 0 ? 'окупилось' : `${Math.ceil(Number(pm))} мес`}`
    : 'не окупается';

  const avg6 = avgProfitLast6(dash);
  const paybackFootLeft = (() => {
    const c = Number(cumulativeProfit) || 0;
    if (c > 0) return `${fmtRub(c)} заработано`;
    if (c < 0) return `${fmtRub(Math.abs(c))} убыток за 12 мес`;
    return `0 ₽ заработано`;
  })();
  const avgPlain = formatCompactRub(Math.abs(avg6));
  const avgSigned =
    avg6 > 0 ? `+${avgPlain}` : avg6 < 0 ? `−${avgPlain}` : avgPlain;
  const avgCls =
    avg6 > 0 ? 'capex2-grid2__val--ok' : avg6 < 0 ? 'capex2-grid2__val--bad' : '';

  return `
    <div class="analytics-capex-tab">
      <div class="white-card analytics-card-pad capex2-card">
        <div class="capex2-kicker">Накопительно</div>
        <div class="capex2-hint">тап по бару →</div>
        <div class="capex2-hero-amt">${formatCompactRub(capexTotal)}</div>
        <div class="capex2-hero-sub">за всё время</div>
        <div id="capex-chart-mount" class="capex2-chart-mount" data-capex-chart="${chartEnc}">
          <canvas id="capex-waterfall-canvas" width="400" height="220" aria-label="CAPEX по месяцам"></canvas>
        </div>
        <div class="capex2-leg">
          <span><i class="capex2-leg__sq capex2-leg__sq--solid" aria-hidden="true"></i>в этом месяце</span>
          <span><i class="capex2-leg__sq capex2-leg__sq--soft" aria-hidden="true"></i>накоплено</span>
        </div>
      </div>

      <div class="white-card analytics-card-pad capex2-card">
        <div class="capex2-kicker">Окупаемость</div>
        <div class="capex2-pay__pct" id="capex-payback-pct">${pctDisplay}%</div>
        <div class="capex2-pay__lbl">отбили</div>
        <div class="capex2-pay__barwrap" id="capex-payback-bar">
          <div class="capex2-pay__tick" style="left:${pctBar}%"></div>
          <div
            id="capex-payback-fill"
            class="capex2-pay__fill"
            data-pct="${pctBar.toFixed(2)}"
            data-pct-display="${pctDisplay}"
            style="width:0%"
          ></div>
        </div>
        <div class="capex2-pay__foot">
          <span>${paybackFootLeft}</span>
          <span>${fmtRub(capexTotal)} вложено</span>
        </div>
        <div class="opex2-divider"></div>
        <div class="capex2-grid2">
          <div>
            <div class="capex2-grid2__val ${avgCls}">${avgSigned}</div>
            <div class="capex2-grid2__lbl">Среднемесячная прибыль</div>
            <div class="capex2-grid2__sub">за последние 6 месяцев</div>
          </div>
          <div>
            <div class="capex2-grid2__val ${paybackKnown ? 'capex2-grid2__val--ok' : 'capex2-grid2__val--bad'}">${paybackLine}</div>
            <div class="capex2-grid2__lbl">Прогноз окупа</div>
            <div class="capex2-grid2__sub">при текущем темпе</div>
          </div>
        </div>
      </div>

      <div class="white-card analytics-card-pad capex2-card">
        <div class="capex2-kicker">Структура инвестиций</div>
        ${structureRows(grouped)}
      </div>

      <div class="analytics-seg" id="analytics-capex-seg">
        <button type="button" class="analytics-seg__btn${isAll ? ' analytics-seg__btn--active' : ''}" data-capex-mode="${CAPEX_MODE.ALL}">За всё время</button>
        <button type="button" class="analytics-seg__btn${!isAll ? ' analytics-seg__btn--active' : ''}" data-capex-mode="${CAPEX_MODE.PERIOD}">За период</button>
      </div>
      <p class="analytics-muted analytics-capex-hint">За период: ${fmtRub(dash.capexPeriod || 0)} · Всё время: ${fmtRub(dash.capexAll || 0)}</p>
    </div>`;
}
