/**
 * analytics/desktop.js — Command Center (≥1024px)
 */

import { analyticsCtx as ctx } from './context.js';
import { fmtRub, getOpexColor, monthLabelFull, opClass, pillMonths, pillShortLabel, toOpDate } from './utils.js';

export const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 1024;

function sparklineSvg(values, color, height) {
  height = height || 48;
  if (!values || !values.length) return '';
  const pts = values.filter(v => v !== null && v !== undefined);
  if (!pts.length) return '';
  const min = Math.min.apply(null, pts);
  const max = Math.max.apply(null, pts);
  const range = max - min || 1;
  const w = 200;
  const h = height;
  const pad = 4;
  const coords = pts.map(function (v, i) {
    const x = pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = coords.join(' ');
  const lx = coords[coords.length - 1].split(',')[0];
  const ly = coords[coords.length - 1].split(',')[1];
  const fx = coords[0].split(',')[0];
  return (
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block">` +
    `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<polygon points="${polyline} ${lx},${h} ${fx},${h}" fill="${color}" opacity="0.10"/>` +
    `<circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/>` +
    `</svg>`
  );
}

function hbar(pct, color) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    '<div style="height:6px;background:rgba(0,0,0,.07);border-radius:3px;overflow:hidden;margin-top:5px">' +
    `<div class="dt-hbar-fill" style="width:${p}%;background:${color};height:100%;border-radius:3px;transform:scaleX(0);transform-origin:left;animation:dt-hbar .7s cubic-bezier(.4,0,.2,1) forwards"></div>` +
    '</div>'
  );
}

function miniDonut(slices, size) {
  size = size || 56;
  const total = slices.reduce(function (s, x) {
    return s + (Number(x.amount) || 0);
  }, 0);
  if (!total)
    return (
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="7"/></svg>`
    );
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const rings = slices.map(function (sl) {
    const pct = (Number(sl.amount) || 0) / total;
    const dash = pct * circ;
    const seg =
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${sl.color}" stroke-width="7"` +
      ` stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"` +
      ` stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="butt"/>`;
    offset += dash;
    return seg;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">${rings.join('')}</svg>`;
}

function dtDelta(key, cur, prev) {
  if (prev === null || prev === undefined) return '';
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  const diff = c - p;
  if (Math.abs(diff) < 1) return '';
  const better = key === 'revenue' || key === 'profit' ? diff > 0 : diff < 0;
  const color = better ? 'var(--c-profit)' : 'var(--c-loss)';
  const sign = diff > 0 ? '+' : '−';
  return `<span style="font-size:12px;color:${color};font-weight:500">${sign}${fmtRub(Math.abs(diff))}</span>`;
}

function monthSeries(ops, key, year, month) {
  const result = [];
  for (let d = -4; d <= 0; d++) {
    const t = new Date(year, month - 1 + d, 1);
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    const sum = ops.reduce(function (acc, op) {
      if (opClass(op) !== key) return acc;
      const dt = toOpDate(op);
      if (!dt) return acc;
      if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return acc;
      return acc + (Number(op.amount) || 0);
    }, 0);
    result.push(sum);
  }
  return result;
}

export function renderDesktopShell(dash) {
  const byKey = function (k) {
    return (dash.summary && dash.summary.find(function (s) {
      return s.key === k;
    })) || {};
  };
  const revenue = Number(byKey('revenue').current) || 0;
  const opex = Number(byKey('opex').current) || 0;
  const profit = revenue - opex;
  const capexAll = Number(dash.capexAll) || 0;

  const pills = pillMonths();
  const pillsHtml = pills
    .map(function (p) {
      const active = !dash.allTime && dash.year === p.year && dash.month === p.month;
      return (
        `<button type="button" class="dt-pill${active ? ' dt-pill--on' : ''}" data-analytics-pill="1" data-year="${p.year}" data-month="${p.month}">` +
        `${pillShortLabel(p.year, p.month)}</button>`
      );
    })
    .join('');

  const revSeries = monthSeries(ctx.ops, 'revenue', dash.year, dash.month);

  const opexRows = (dash.opex || []).slice(0, 5);
  const opexTotal = opexRows.reduce(function (s, r) {
    return s + (Number(r.amount) || 0);
  }, 0) || 1;
  const opexBarsHtml = opexRows
    .map(function (r) {
      const pct = (Number(r.amount) / opexTotal) * 100;
      return (
        '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
        `<span style="font-size:13px;color:var(--dt-text)">${r.name}</span>` +
        `<span style="font-size:13px;font-weight:500;color:var(--dt-text)">${fmtRub(r.amount)}</span>` +
        `</div>${hbar(pct, getOpexColor(r.name))}</div>`
      );
    })
    .join('');

  const fleet = ctx.cars || [];
  const fRent = fleet.filter(function (c) {
    return String(c.status || '').trim() === 'в аренде';
  }).length;
  const fRepair = fleet.filter(function (c) {
    return String(c.status || '').trim() === 'в ремонте';
  }).length;
  const fIdle = fleet.length - fRent - fRepair;
  const fTotal = Math.max(1, fleet.length);
  const rentPct = Math.round((fRent / fTotal) * 100);

  const capexCatsAll = dash.capexByCategoryAll || [];
  const capexSlices = [
    {
      color: 'var(--c-bar-75)',
      amount: capexCatsAll
        .filter(function (r) {
          return r.name.toLowerCase().includes('запч');
        })
        .reduce(function (s, r) {
          return s + (Number(r.amount) || 0);
        }, 0),
    },
    {
      color: 'var(--c-bar-75)',
      amount: capexCatsAll
        .filter(function (r) {
          return r.name.toLowerCase().includes('ремонт');
        })
        .reduce(function (s, r) {
          return s + (Number(r.amount) || 0);
        }, 0),
    },
    {
      color: 'var(--c-bar-100)',
      amount: capexCatsAll
        .filter(function (r) {
          return r.name.toLowerCase().includes('покуп');
        })
        .reduce(function (s, r) {
          return s + (Number(r.amount) || 0);
        }, 0),
    },
  ];
  const capexKnown = capexSlices.reduce(function (s, x) {
    return s + x.amount;
  }, 0);
  capexSlices.push({ color: 'var(--c-bar-10)', amount: Math.max(0, capexAll - capexKnown) });
  const capexLabels = ['Запчасти', 'Ремонты', 'Покупки', 'Прочее'];

  const pnlRows = (dash.pnl || []).slice(0, 6);
  const pnlMax = Math.max(
    1,
    Math.max.apply(
      null,
      pnlRows.map(function (r) {
        return Math.abs(Number(r.profit) || 0);
      }),
    ),
  );
  const desktopPnlBarsHtml = pnlRows
    .map(function (r, i) {
      const p = Number(r.profit) || 0;
      const pct = (Math.abs(p) / pnlMax) * 100;
      const color = p > 0 ? 'var(--c-profit)' : p < 0 ? 'var(--c-loss)' : 'var(--c-muted)';
      return (
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        `<span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0;color:var(--dt-text)">${r.car}</span>` +
        '<div style="flex:1;height:18px;background:rgba(0,0,0,.05);border-radius:3px;overflow:hidden;position:relative">' +
        `<div class="dt-hbar-fill" style="position:absolute;top:0;left:0;height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:3px;opacity:.85;transform:scaleX(0);transform-origin:left;animation:dt-hbar .6s cubic-bezier(.4,0,.2,1) ${(0.05 * i).toFixed(2)}s forwards"></div>` +
        '</div>' +
        `<span style="font-size:12px;font-weight:500;width:72px;text-align:right;color:${color};flex-shrink:0">${p >= 0 ? '+' : ''}${fmtRub(Math.abs(p))}</span>` +
        '</div>'
      );
    })
    .join('');

  const kassaObjMap = new Map(
    (ctx.kassas || []).map(function (k) {
      return [String(k.kassaId || k.касса_id || '').trim(), Number(k.balanceCurrent || k.баланс_текущий) || 0];
    }),
  );
  const calcKassaBal = function (id) {
    if (kassaObjMap.has(id) && kassaObjMap.get(id) !== 0) return kassaObjMap.get(id);
    return (ctx.ops || []).reduce(function (acc, op) {
      if (String(op.kassaId || '').trim() !== id) return acc;
      const amt = Number(op.amount) || 0;
      return acc + (op.direction === 'приход' ? amt : -amt);
    }, 0);
  };
  const kassaDefs = [
    { id: 'K_AZAMAT', label: 'Азамат', color: 'var(--c-accent)' },
    { id: 'K_VLADIMIR', label: 'Владимир', color: 'var(--c-kassa-vladimir)' },
    { id: 'K_YULIA', label: 'Юлия', color: 'var(--c-kassa-yulia)' },
  ];
  const kassaRowsHtml = kassaDefs
    .map(function (k) {
      const bal = calcKassaBal(k.id);
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06)">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        `<span style="width:8px;height:8px;border-radius:50%;background:${k.color};flex-shrink:0"></span>` +
        `<span style="font-size:13px;color:var(--dt-text)">${k.label}</span>` +
        '</div>' +
        `<span style="font-size:14px;font-weight:600;color:${bal >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}">${bal < 0 ? '−' : ''}${fmtRub(Math.abs(bal))}</span>` +
        '</div>'
      );
    })
    .join('');

  const activeDeposits = (ctx.deposits || [])
    .filter(function (d) {
      return String(d.status || '')
        .toLowerCase()
        .includes('актив');
    })
    .reduce(function (s, d) {
      return s + (Number(d.amount) || 0);
    }, 0);

  return (
    '<style>' +
    ':root{--dt-text:var(--c-neutral);--dt-muted:var(--c-muted);--dt-card:var(--c-surface);--dt-bg:var(--c-bg-page);--dt-border:rgba(0,0,0,.08)}' +
    '@media(prefers-color-scheme:dark){:root{--dt-text:var(--c-bg-page);--dt-muted:var(--c-desktop-muted);--dt-card:var(--c-desktop-bg-1);--dt-bg:var(--c-neutral);--dt-border:rgba(255,255,255,.08)}}' +
    '@keyframes dt-hbar{to{transform:scaleX(1)}}' +
    '@keyframes dt-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@keyframes dt-kpi-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}' +
    '#analytics-root{height:100dvh!important;overflow:hidden!important;padding:0!important;display:flex;flex-direction:column}' +
    '.dt-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dt-bg)}' +
    '.dt-hdr{background:var(--c-dark);padding:16px 28px 0;flex-shrink:0}' +
    '.dt-hdr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '.dt-title{font-size:18px;font-weight:700;color:var(--c-on-dark);letter-spacing:-.02em}' +
    '.dt-pills{display:flex;gap:6px;align-items:center}' +
    '.dt-pill{font-size:12px;padding:5px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,.2);color:rgba(255,255,255,.55);background:transparent;cursor:pointer;transition:all .15s}' +
    '.dt-pill:hover{color:var(--c-on-dark);border-color:rgba(255,255,255,.4)}' +
    '.dt-pill--on{background:var(--c-accent);color:var(--c-dark)!important;border-color:var(--c-accent)!important;font-weight:600}' +
    '.dt-hero{display:flex;align-items:flex-end;gap:28px;padding:16px 0 20px;flex-wrap:wrap}' +
    '.dt-hero-main{flex:1;min-width:200px}' +
    '.dt-hero-lbl{font-size:11px;color:rgba(255,255,255,.4);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}' +
    '.dt-hero-num{font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1}' +
    '.dt-hero-sub{font-size:12px;color:rgba(255,255,255,.35);margin-top:5px}' +
    '.dt-kpis{display:flex;gap:10px;flex-wrap:wrap}' +
    '.dt-kpi{background:rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;min-width:110px;animation:dt-kpi-in .4s ease backwards}' +
    '.dt-kpi-lbl{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}' +
    '.dt-kpi-val{font-size:16px;font-weight:600;color:var(--c-on-dark)}' +
    '.dt-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px 24px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-content:start}' +
    '.dt-card{background:var(--dt-card);border-radius:14px;padding:18px 20px;border:0.5px solid var(--dt-border);animation:dt-fade-up .4s ease backwards}' +
    '.dt-card-title{font-size:11px;font-weight:600;color:var(--dt-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px}' +
    '.dt-big{font-size:28px;font-weight:700;color:var(--dt-text);letter-spacing:-.02em;line-height:1.1}' +
    '.dt-fleet-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}' +
    '.dt-fleet-tile{border-radius:8px;padding:10px 8px;text-align:center}' +
    '.dt-fleet-tile-n{font-size:22px;font-weight:700}' +
    '.dt-fleet-tile-l{font-size:9px;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;opacity:.75}' +
    '.dt-fleet-bar{height:6px;border-radius:3px;overflow:hidden;display:flex;margin-bottom:6px}' +
    '.dt-fleet-seg{height:100%;transition:width .6s}' +
    '.dt-fleet-pct{font-size:11px;color:var(--dt-muted)}' +
    '@media(max-width:1279px){.dt-body{grid-template-columns:1fr 1fr}}' +
    '</style>' +
    '<div class="dt-root" id="dt-root">' +
    '<div class="dt-hdr">' +
    '<div class="dt-hdr-top"><span class="dt-title">Аналитика</span>' +
    '<div class="dt-pills">' +
    pillsHtml +
    `<button type="button" class="dt-pill${dash.allTime ? ' dt-pill--on' : ''}" data-analytics-pill-all="1">Всё время</button>` +
    '</div></div>' +
    '<div class="dt-hero">' +
    '<div class="dt-hero-main">' +
    `<div class="dt-hero-lbl">Чистая прибыль · ${dash.allTime ? 'всё время' : monthLabelFull(dash.year, dash.month)}</div>` +
    `<div class="dt-hero-num" style="color:${profit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}">${profit >= 0 ? '+' : ''}${fmtRub(profit)}</div>` +
    `<div class="dt-hero-sub">Выручка ${fmtRub(revenue)} · Расходы ${fmtRub(opex)}</div>` +
    '</div>' +
    '<div class="dt-kpis">' +
    `<div class="dt-kpi" style="animation-delay:.05s"><div class="dt-kpi-lbl">Выручка</div><div class="dt-kpi-val" style="color:var(--c-profit)">${fmtRub(revenue)}</div>${dtDelta('revenue', revenue, byKey('revenue').previous)}</div>` +
    `<div class="dt-kpi" style="animation-delay:.1s"><div class="dt-kpi-lbl">Расходы</div><div class="dt-kpi-val" style="color:var(--c-loss)">${fmtRub(opex)}</div>${dtDelta('opex', opex, byKey('opex').previous)}</div>` +
    `<div class="dt-kpi" style="animation-delay:.15s"><div class="dt-kpi-lbl">CAPEX всего</div><div class="dt-kpi-val" style="color:var(--c-muted)">${fmtRub(capexAll)}</div></div>` +
    `<div class="dt-kpi" style="animation-delay:.2s"><div class="dt-kpi-lbl">Загрузка</div><div class="dt-kpi-val" style="color:var(--c-desktop-accent)">${rentPct}%</div></div>` +
    '</div></div></div>' +
    '<div class="dt-body" id="dt-body">' +
    '<div class="dt-card" style="animation-delay:.08s">' +
    '<div class="dt-card-title">Расходы по статьям</div>' +
    (opexBarsHtml || '<span style="color:var(--dt-muted);font-size:13px">Нет данных</span>') +
    '<div style="border-top:0.5px solid var(--dt-border);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:baseline">' +
    '<span style="font-size:11px;color:var(--dt-muted)">Итого OPEX</span>' +
    `<span style="font-size:15px;font-weight:700;color:var(--dt-text)">${fmtRub(opex)}</span>` +
    '</div></div>' +
    '<div class="dt-card" style="animation-delay:.12s">' +
    '<div class="dt-card-title">Выручка · 5 месяцев</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">' +
    `<span class="dt-big" style="color:var(--c-profit)">${fmtRub(revenue)}</span>` +
    dtDelta('revenue', revenue, byKey('revenue').previous) +
    '</div>' +
    `<div style="margin-top:10px">${sparklineSvg(revSeries, 'var(--c-profit)', 52)}</div>` +
    '</div>' +
    '<div class="dt-card" style="animation-delay:.16s">' +
    `<div class="dt-card-title">Парк · ${fTotal} машин</div>` +
    '<div class="dt-fleet-grid">' +
    `<div class="dt-fleet-tile" style="background:var(--c-rent-bg);color:var(--c-rent)"><div class="dt-fleet-tile-n">${fRent}</div><div class="dt-fleet-tile-l">Аренда</div></div>` +
    `<div class="dt-fleet-tile" style="background:var(--c-idle-bg);color:var(--c-idle)"><div class="dt-fleet-tile-n">${fIdle}</div><div class="dt-fleet-tile-l">Простой</div></div>` +
    `<div class="dt-fleet-tile" style="background:var(--c-repair-bg);color:var(--c-repair)"><div class="dt-fleet-tile-n">${fRepair}</div><div class="dt-fleet-tile-l">Ремонт</div></div>` +
    '</div>' +
    '<div class="dt-fleet-bar">' +
    `<div class="dt-fleet-seg" style="width:${((fRent / fTotal) * 100).toFixed(1)}%;background:var(--c-rent)"></div>` +
    `<div class="dt-fleet-seg" style="width:${((fIdle / fTotal) * 100).toFixed(1)}%;background:var(--c-idle)"></div>` +
    `<div class="dt-fleet-seg" style="width:${((fRepair / fTotal) * 100).toFixed(1)}%;background:var(--c-repair)"></div>` +
    '</div>' +
    `<div class="dt-fleet-pct">Загрузка ${rentPct}%</div>` +
    '</div>' +
    '<div class="dt-card" style="animation-delay:.20s">' +
    '<div class="dt-card-title">P&amp;L по машинам</div>' +
    (desktopPnlBarsHtml || '<span style="color:var(--dt-muted);font-size:13px">Нет данных</span>') +
    '</div>' +
    '<div class="dt-card" style="animation-delay:.24s">' +
    '<div class="dt-card-title">CAPEX</div>' +
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">' +
    miniDonut(capexSlices, 64) +
    `<div><div class="dt-big">${fmtRub(capexAll)}</div><div style="font-size:11px;color:var(--dt-muted);margin-top:3px">всё время</div></div>` +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:5px">' +
    capexSlices
      .map(function (s, i) {
        return (
          '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dt-muted)">' +
          `<span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0"></span>` +
          `<span style="flex:1">${capexLabels[i]}</span>` +
          `<span style="color:var(--dt-text);font-weight:500">${fmtRub(s.amount)}</span>` +
          '</div>'
        );
      })
      .join('') +
    '</div></div>' +
    '<div class="dt-card" style="animation-delay:.28s">' +
    '<div class="dt-card-title">Кассы</div>' +
    kassaRowsHtml +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;margin-top:6px">' +
    '<span style="font-size:12px;color:var(--dt-muted)">Активные залоги</span>' +
    `<span style="font-size:14px;font-weight:600;color:var(--c-neutral)">${fmtRub(activeDeposits)}</span>` +
    '</div></div>' +
    '</div></div>'
  );
}

export function renderDesktopSkeleton() {
  return (
    '<style>' +
    '.dt-root{display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--c-bg-page)}' +
    '.dt-hdr{background:var(--c-dark);padding:16px 28px 20px;flex-shrink:0}' +
    '.dt-body{flex:1;overflow-y:auto;padding:20px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-content:start}' +
    '.dt-card{background:var(--c-surface);border-radius:14px;padding:18px 20px;border:0.5px solid rgba(0,0,0,.08)}' +
    '@media(max-width:1279px){.dt-body{grid-template-columns:1fr 1fr}}' +
    '</style>' +
    '<div class="dt-root"><div class="dt-hdr"><div class="skeleton" style="height:16px;border-radius:6px;margin-bottom:8px;width:120px"></div><div class="skeleton" style="height:40px;border-radius:6px;width:200px"></div></div>' +
    '<div class="dt-body">' +
    [0, 0.06, 0.12, 0.18, 0.24, 0.28]
      .map(function (d) {
        return `<div class="dt-card" style="animation-delay:${d}s"><div class="skeleton" style="height:14px;border-radius:4px;margin-bottom:8px;width:80%"></div><div class="skeleton" style="height:28px;border-radius:4px;margin-bottom:8px"></div><div class="skeleton" style="height:80px;border-radius:4px"></div></div>`;
      })
      .join('') +
    '</div></div>'
  );
}
