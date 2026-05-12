/**
 * analytics/opex.js — вкладка «Расходы» (OPEX), мобильный макет.
 */

import { formatCompactRub } from '../../utils/format.js';
import { analyticsCtx as ctx } from './context.js';
import {
  fmtRub,
  getCategoryColor,
  monthInPrepositional,
  opClass,
  pillShortLabel,
  toOpDate,
} from './utils.js';

const OPEX_SMALL_THRESHOLD = 100;

/** Карта категория → сумма за период (py, pm). */
function categoryTotalsForMonth(ops, py, pm) {
  const map = new Map();
  (ops || []).forEach(op => {
    if (opClass(op) !== 'opex') return;
    const d = toOpDate(op);
    if (!d) return;
    if (d.getFullYear() !== py || d.getMonth() + 1 !== pm) return;
    const cat = String(op.category || 'Прочее').trim() || 'Прочее';
    map.set(cat, (map.get(cat) || 0) + (Number(op.amount) || 0));
  });
  return map;
}

/**
 * @returns {{ prevTotal: number, prevMap: Map<string, number>, prevYear: number, prevMonth: number } | null}
 */
function prevPeriodOpex(dash) {
  if (dash.allTime) return null;
  const prevDate = new Date(dash.year, dash.month - 2, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth() + 1;
  const prevMap = categoryTotalsForMonth(ctx.ops, py, pm);
  const prevTotal = [...prevMap.values()].reduce((a, b) => a + (Number(b) || 0), 0);
  return { prevTotal, prevMap, prevYear: py, prevMonth: pm };
}

function displayCategoryName(raw) {
  const s = String(raw || '').trim() || 'Прочее';
  return s.replace(/_/g, ' ');
}

function isMiscCategoryName(name) {
  const s = String(name || '').toLowerCase();
  return s.includes('проч') || s === 'прочее';
}

/** Категории < threshold ₽ схлопываем в «Прочее» (или добавляем к существующей «Прочее»). */
function buildDisplayRows(rows, prevMap, threshold) {
  const list = rows.map(r => ({
    rawName: String(r.name || '').trim() || 'Прочее',
    amount: Number(r.amount) || 0,
  }));
  const small = list.filter(r => r.amount > 0 && r.amount < threshold);
  const large = list.filter(r => r.amount >= threshold);
  const smallSum = small.reduce((s, r) => s + r.amount, 0);
  const smallPrev = small.reduce((s, r) => s + (prevMap?.get(r.rawName) ?? 0), 0);

  const toRow = (rawName, amount, prevExtra = 0) => ({
    rawName,
    amount,
    displayName: displayCategoryName(rawName),
    prevAmount: (prevMap?.get(rawName) ?? 0) + prevExtra,
  });

  if (smallSum <= 0) {
    return large.map(r => toRow(r.rawName, r.amount, 0)).sort((a, b) => b.amount - a.amount);
  }

  const out = large.map(r => ({ rawName: r.rawName, amount: r.amount }));
  const miscIdx = out.findIndex(r => isMiscCategoryName(r.rawName));
  if (miscIdx >= 0) {
    out[miscIdx].amount += smallSum;
  } else {
    out.push({ rawName: 'Прочее', amount: smallSum });
  }

  return out
    .map(r => {
      const extra = isMiscCategoryName(r.rawName) ? smallPrev : 0;
      return toRow(r.rawName, r.amount, extra);
    })
    .sort((a, b) => b.amount - a.amount);
}

/** Дельта OPEX: ниже расход = лучше → зелёный. При базе прошлого месяца < threshold ₽ — «новое», без % от шума. */
function opexRowDeltaPill(cur, prev, threshold = OPEX_SMALL_THRESHOLD) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p < threshold) {
    if (c <= 0 && p <= 0) {
      return `<span class="opex2-pill opex2-pill--na">—</span>`;
    }
    if (Math.abs(c - p) < 1e-6) {
      return `<span class="opex2-pill opex2-pill--na">0%</span>`;
    }
    return `<span class="opex2-pill opex2-pill--new">новое</span>`;
  }
  if (p <= 0 && c <= 0) {
    return `<span class="opex2-pill opex2-pill--na">—</span>`;
  }
  if (p <= 0 && c > 0) {
    return `<span class="opex2-pill opex2-pill--bad"><i class="ti ti-arrow-up-right" aria-hidden="true"></i>+100%</span>`;
  }
  const d = c - p;
  const pct = Math.round((Math.abs(d) / p) * 100);
  if (d === 0) {
    return `<span class="opex2-pill opex2-pill--na">0%</span>`;
  }
  if (d < 0) {
    return `<span class="opex2-pill opex2-pill--good"><i class="ti ti-arrow-down-right" aria-hidden="true"></i>−${pct}%</span>`;
  }
  return `<span class="opex2-pill opex2-pill--bad"><i class="ti ti-arrow-up-right" aria-hidden="true"></i>+${pct}%</span>`;
}

function summaryHeaderPill(curTotal, prevInfo) {
  if (!prevInfo || prevInfo.prevTotal <= 0) {
    return `<span class="opex2-pill opex2-pill--na">—</span>`;
  }
  const d = curTotal - prevInfo.prevTotal;
  const pct = Math.round((Math.abs(d) / prevInfo.prevTotal) * 100);
  if (d === 0) return `<span class="opex2-pill opex2-pill--na">0%</span>`;
  if (d < 0) {
    return `<span class="opex2-pill opex2-pill--good"><i class="ti ti-arrow-down-right" aria-hidden="true"></i>−${pct}%</span>`;
  }
  return `<span class="opex2-pill opex2-pill--bad"><i class="ti ti-arrow-up-right" aria-hidden="true"></i>+${pct}%</span>`;
}

function trailingFourOpex(dash) {
  const t = Array.isArray(dash.trailing12) ? dash.trailing12 : [];
  const slice = t.slice(-4);
  return slice.map(row => ({
    year: Number(row.year),
    month: Number(row.month),
    label: pillShortLabel(Number(row.year), Number(row.month)),
    opex: Number(row.opex) || 0,
  }));
}

function cardCategoriesHtml(rows, total, maxAmt) {
  const pm = maxAmt > 0 ? maxAmt : 1;
  return rows
    .map((r, i) => {
      const amt = Number(r.amount) || 0;
      const pctTotal = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0';
      const w = (amt / pm) * 100;
      const prev = Number(r.prevAmount) || 0;
      const col = getCategoryColor(r.rawName);
      const delay = i * 50;
      return `
      <div class="opex2-cat" style="--opex2-stagger:${delay}ms">
        <div class="opex2-cat__head">
          <span class="opex2-cat__sw" style="background:${col}"></span>
          <div class="opex2-cat__mid">
            <div class="opex2-cat__line1">
              <span class="opex2-cat__name">${r.displayName}</span>
              <span class="opex2-cat__pct">${pctTotal}%</span>
            </div>
          </div>
          <div class="opex2-cat__right">
            <span class="opex2-cat__amt">${fmtRub(amt)}</span>
            ${opexRowDeltaPill(amt, prev)}
          </div>
        </div>
        <div class="opex2-cat__track">
          <div class="opex2-cat__fill" style="--opex2-pct:${w.toFixed(2)}%;background:${col}"></div>
        </div>
      </div>`;
    })
    .join('');
}

function cardMonthsHtml(months, currentY, currentM) {
  const max = Math.max(1, ...months.map(m => m.opex));
  const hMax = 96;
  return `
    <div class="opex2-mo__hdr">
      <span class="opex2-kicker">По месяцам</span>
    </div>
    <div class="opex2-mo__chart" style="--opex2-h:${hMax}px">
      ${months
        .map((m, i) => {
          const isCur = !Number.isNaN(m.year) && m.year === currentY && m.month === currentM;
          const h = Math.round((m.opex / max) * hMax);
          const safeH = Math.max(m.opex > 0 ? 6 : 3, h);
          const delay = i * 120;
          const barCls = isCur ? 'opex2-mo__bar opex2-mo__bar--cur' : 'opex2-mo__bar';
          const fill = isCur ? 'var(--cat-salary)' : 'var(--color-background-secondary, #e8e8e6)';
          const topVal = m.opex > 0 ? formatCompactRub(m.opex) : '—';
          return `
        <div class="opex2-mo__col">
          <div class="opex2-mo__stack" style="--opex2-bar-h:${safeH}px;--opex2-bar-delay:${delay}ms">
            <div class="opex2-mo__val">${topVal}</div>
            <div class="${barCls}">
              <div class="opex2-mo__fill" style="height:${safeH}px;background:${fill}"></div>
            </div>
          </div>
          <div class="opex2-mo__lbl">${m.label}</div>
        </div>`;
        })
        .join('')}
    </div>`;
}

/**
 * Подсветка анимаций после появления вкладки (вызывается из analytics.js).
 * @param {HTMLElement} pageEl — .analytics-page[data-page="1"]
 */
export function revealOpexAnimations(pageEl) {
  const root = pageEl?.querySelector?.('.analytics-opex-tab');
  if (!root) return;
  requestAnimationFrame(() => {
    root.classList.add('analytics-opex-tab--inview');
  });
}

export function renderOpex(dash) {
  const opexRaw = [...(dash.opex || [])].filter(r => (Number(r.amount) || 0) > 0);
  const total = opexRaw.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const sortedRaw = [...opexRaw].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  const prevInfo = prevPeriodOpex(dash);
  const prevMap = prevInfo?.prevMap;
  const displayRows = buildDisplayRows(sortedRaw, prevMap, OPEX_SMALL_THRESHOLD);
  const maxAmt = displayRows.length ? Math.max(...displayRows.map(r => Number(r.amount) || 0)) : 1;

  const months = trailingFourOpex(dash);
  const monthsHtml =
    months.length > 0
      ? cardMonthsHtml(months, dash.year, dash.month)
      : `<div class="analytics-muted opex2-mo__empty">Нет данных trailing12</div>`;

  if (!displayRows.length) {
    return `
      <div class="analytics-opex-tab">
        <div class="white-card analytics-card-pad opex2-card">
          <div class="analytics-muted">Нет данных за период</div>
        </div>
      </div>`;
  }

  const subLine =
    prevInfo && prevInfo.prevTotal > 0
      ? `было ${fmtRub(prevInfo.prevTotal)} в ${monthInPrepositional(prevInfo.prevYear, prevInfo.prevMonth)}`
      : dash.allTime
        ? 'Режим «Всё время»'
        : 'Нет данных за прошлый период';

  return `
    <div class="analytics-opex-tab">
      <div class="white-card analytics-card-pad opex2-card opex2-card--main">
        <div class="opex2-kicker">Всего за период</div>
        <div class="opex2-total">${fmtRub(total)}</div>
        <div class="opex2-pill-row">${summaryHeaderPill(total, prevInfo)}</div>
        <div class="opex2-sub">${subLine}</div>
        <div class="opex2-divider"></div>
        ${cardCategoriesHtml(displayRows, total, maxAmt)}
      </div>
      <div class="white-card analytics-card-pad opex2-card opex2-card--months">
        ${monthsHtml}
      </div>
    </div>`;
}
