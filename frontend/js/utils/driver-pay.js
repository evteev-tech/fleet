/**
 * driver-pay.js — производные статусы оплаты водителей (клиент).
 */

import { CAR_STATUSES } from '../config.js';

export function isActiveStatus(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('актив') && !s.includes('архив') && !s.includes('отпуск');
}

export function isVacationStatus(raw) {
  return String(raw || '').toLowerCase().includes('отпуск');
}

export function isArchiveStatus(raw) {
  return String(raw || '').toLowerCase().includes('архив');
}

export function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseDdMmYyyy(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDdMm(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysDiff(from, to) {
  const a = from instanceof Date ? new Date(from) : new Date(from);
  const b = to instanceof Date ? new Date(to) : new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function _rentalIdTailNum(id) {
  const m = String(id || '').match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function _paidUntilFromRentalDateEnd(dateEnd) {
  if (!(dateEnd instanceof Date) || Number.isNaN(dateEnd.getTime())) return null;
  return new Date(dateEnd.getFullYear(), dateEnd.getMonth(), dateEnd.getDate());
}

/** paidUntil из fetchIncomeForm (lastPaidDate DD.MM.YYYY) или MAX dateEnd аренды. */
export function resolvePaidUntil(carId, incomeRows, rentalRows) {
  const cid = String(carId || '').trim();
  if (!cid) return null;

  const row = (incomeRows || []).find(r => String(r.carId || '').trim() === cid);
  if (row?.lastPaidDate) {
    const d = parseDdMmYyyy(row.lastPaidDate);
    if (d) return d;
  }

  const candidates = (rentalRows || []).filter(r => String(r.carId || '').trim() === cid);
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const nb = _rentalIdTailNum(b.rentalId);
    const na = _rentalIdTailNum(a.rentalId);
    if (nb !== na) return nb - na;
    const sa = a.dateStart instanceof Date ? a.dateStart.getTime() : 0;
    const sb = b.dateStart instanceof Date ? b.dateStart.getTime() : 0;
    return sb - sa;
  });

  const latest = candidates[0];
  let pt = _paidUntilFromRentalDateEnd(latest.dateEnd);
  if (!pt && latest.dateStart instanceof Date && !Number.isNaN(latest.dateStart.getTime())) {
    const ds = latest.dateStart;
    pt = new Date(ds.getFullYear(), ds.getMonth(), ds.getDate());
  }
  const bonus = Number(latest.bonusDays) || 0;
  if (pt && bonus > 0) {
    pt = new Date(pt.getTime() + bonus * 86400000);
  }
  return pt;
}

/** @returns {'overdue'|'today'|'ok'|null} */
export function computePayState(carId, paidUntil, fleet) {
  if (!carId) return null;
  const car = (fleet || []).find(c => String(c.carId) === String(carId));
  if (!car || car.status !== CAR_STATUSES.RENT) return null;
  if (!paidUntil) return null;

  const left = daysDiff(paidUntil, todayStart());
  if (left < 0) return 'overdue';
  if (left === 0) return 'today';
  return 'ok';
}

export function computeDepositTotal(deposits, driverId, fallback = 0) {
  const did = String(driverId || '').trim();
  if (!did) return Number(fallback) || 0;
  const sum = (deposits || [])
    .filter(d => String(d.driverId || '').trim() === did)
    .reduce((s, d) => s + (Number(d.amount) || 0), 0);
  return sum || Number(fallback) || 0;
}

export function payStateRank(state) {
  if (state === 'overdue') return 0;
  if (state === 'today') return 1;
  if (state === 'ok') return 2;
  return 3;
}

export function payStateBorderColor(state) {
  if (state === 'overdue') return '#ef4444';
  if (state === 'today') return '#f59e0b';
  if (state === 'ok') return '#22c55e';
  return '#d1d5db';
}

export function payStateTagLabel(state, daysLeft) {
  if (state === 'overdue') return `долг ${Math.abs(daysLeft)} дн`;
  if (state === 'today') return 'платить сегодня';
  if (state === 'ok') return `+${daysLeft} дн`;
  return '';
}

export function payStateTitle(state) {
  if (state === 'overdue') return 'Просрочка';
  if (state === 'today') return 'Платить сегодня';
  if (state === 'ok') return 'Оплачено';
  return '';
}

export function enrichDriver(driver, { fleet, incomeRows, deposits, rentals }) {
  const carId = driver.currentCar || driver.carId || null;
  const car = carId ? (fleet || []).find(c => String(c.carId) === String(carId)) : null;
  const paidUntil = carId ? resolvePaidUntil(carId, incomeRows, rentals) : null;
  const daysLeft = paidUntil ? daysDiff(paidUntil, todayStart()) : null;
  const payState = computePayState(carId, paidUntil, fleet);
  const deposit = computeDepositTotal(deposits, driver.driverId, driver.deposit);
  const rateDay = car ? Number(car.rateDay) || 0 : 0;

  const driverRentals = (rentals || [])
    .filter(r => String(r.driverId || '').trim() === String(driver.driverId))
    .sort((a, b) => {
      const nb = _rentalIdTailNum(b.rentalId);
      const na = _rentalIdTailNum(a.rentalId);
      return nb - na;
    });

  const activeRental = carId
    ? driverRentals.find(r => String(r.carId) === String(carId) && !r.dateEnd)
      ?? driverRentals.find(r => String(r.carId) === String(carId))
    : null;

  const lastRental = driverRentals[0] || null;

  return {
    ...driver,
    carId,
    car,
    paidUntil,
    daysLeft,
    payState,
    deposit,
    rateDay,
    activeRental,
    lastRental,
    onRent: !!(car && car.status === CAR_STATUSES.RENT),
  };
}

export function sortActiveDrivers(list) {
  return [...list].sort((a, b) => {
    const ra = payStateRank(a.payState);
    const rb = payStateRank(b.payState);
    if (ra !== rb) return ra - rb;
    if (a.payState === 'overdue' && b.payState === 'overdue') {
      return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    }
    if (a.payState === 'ok' && b.payState === 'ok') {
      return (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
    }
    return String(a.name || a.carId || '').localeCompare(String(b.name || b.carId || ''), 'ru');
  });
}

export function overdueBannerStats(activeDrivers) {
  const overdue = activeDrivers.filter(d => d.payState === 'overdue');
  const count = overdue.length;
  const sum = overdue.reduce((s, d) => {
    const days = Math.abs(d.daysLeft || 0);
    return s + days * (d.rateDay || 0);
  }, 0);
  return { count, sum };
}

export function driverDisplayName(driver) {
  const name = String(driver.name || '').trim();
  if (name) return { text: name, muted: false };
  const cid = driver.carId || driver.currentCar || driver.driverId || '?';
  return { text: `Водитель ${cid}`, muted: true };
}

export function buildPaymentContext(enriched) {
  return {
    carId: enriched.carId,
    driverId: enriched.driverId,
    driverName: enriched.name || '',
    amount: Math.round((enriched.rateDay || 0) * 7),
    rateDay: enriched.rateDay || 0,
  };
}
