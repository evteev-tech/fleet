/**
 * Статичный набор данных для UI/демо (?mock=1).
 * Изменение «обещаний» в mock — см. mutateMockRentalPromise().
 */

import { KASSA_ID } from '../config.js';

/** @typedef {{ rentalId: string, carId: string, driverId: string, dateStart: Date, dateEnd: Date|null, rateDay: number, note: string, promisedUntil: Date|null, promisedAt: Date|null }} MockRental */

export function mutateMockRentalPromise(carId, promisedUntil, promisedAt) {
  const cid = String(carId || '').trim();
  if (!cid) return;
  const row = _MOCK_RENTALS.find(r => r.carId === cid);
  if (!row) return;
  row.promisedUntil = promisedUntil;
  row.promisedAt = promisedAt;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtComment(paidUntil) {
  const dd = String(paidUntil.getDate()).padStart(2, '0');
  const mm = String(paidUntil.getMonth() + 1).padStart(2, '0');
  const yy = paidUntil.getFullYear();
  return `аренда до ${dd}.${mm}.${yy}`;
}

function opDateDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Параметры карточек + парк (как в ТЗ) */
const _MOCK_TASKS = [
  { carId: 'А982', driverName: 'Марат', driverId: 'D982', amount: 5950, paidUntil: daysAgo(17) },
  {
    carId: 'А165',
    driverName: 'Сергей',
    driverId: 'D165',
    amount: 5950,
    paidUntil: daysAgo(10),
    promisedUntil: daysAgo(1),
    promisedAt: daysAgo(3),
  },
  {
    carId: 'Т086',
    driverName: 'Алексей',
    driverId: 'D086',
    amount: 5950,
    paidUntil: daysAgo(5),
    promisedUntil: daysFromNow(1),
    promisedAt: daysAgo(1),
  },
  { carId: 'Н723', driverName: 'Иван', driverId: 'D723', amount: 5950, paidUntil: today() },
  {
    carId: 'К268',
    driverName: 'Руслан',
    driverId: 'D268',
    amount: 5100,
    paidUntil: daysFromNow(1),
  },
  { carId: 'Н052', driverName: 'Дмитрий', driverId: 'D052', amount: 5950, paidUntil: daysFromNow(2) },
];

/** @type {MockRental[]} — по одному «активному» блоку аренды на машину из списка задач */
const _MOCK_RENTALS = _MOCK_TASKS.map((t, i) => ({
  rentalId: `R_MOCK_${String(i + 1).padStart(4, '0')}`,
  carId: String(t.carId).trim(),
  driverId: t.driverId,
  dateStart: daysAgo(30),
  dateEnd: t.paidUntil ? new Date(t.paidUntil) : null,
  rateDay: Math.round(Number(t.amount) / 7) || 0,
  note: '',
  promisedUntil: t.promisedUntil ? new Date(t.promisedUntil) : null,
  promisedAt: t.promisedAt ? new Date(t.promisedAt) : null,
}));

/** Дополнительные машины (парк 12 шт.: 5+3+4) */
function _mockFleetExtras() {
  const extras = [
    { carId: 'М001', name: '', color: '', status: 'простой', rateDay: 700 },
    { carId: 'М002', name: '', color: '', status: 'простой', rateDay: 700 },
    { carId: 'М003', name: '', color: '', status: 'простой', rateDay: 700 },
    { carId: 'Р001', name: '', color: '', status: 'в ремонте', rateDay: 700 },
    { carId: 'Р002', name: '', color: '', status: 'в ремонте', rateDay: 700 },
    { carId: 'Р003', name: '', color: '', status: 'в ремонте', rateDay: 700 },
    { carId: 'Р004', name: '', color: '', status: 'в ремонте', rateDay: 700 },
  ];
  return extras;
}

/** @returns {Promise<object[]>} */
export async function getMockRentalsNormalized() {
  return _MOCK_RENTALS.map(r => ({
    rentalId: r.rentalId,
    carId: r.carId,
    driverId: r.driverId,
    dateStart: r.dateStart ? new Date(r.dateStart) : null,
    dateEnd: r.dateEnd ? new Date(r.dateEnd) : null,
    rateDay: r.rateDay,
    note: r.note || '',
    promisedUntil: r.promisedUntil ? new Date(r.promisedUntil) : null,
    promisedAt: r.promisedAt ? new Date(r.promisedAt) : null,
  }));
}

export async function getMockFleetNormalized() {
  const rent = _MOCK_TASKS.map(t => ({
    carId: String(t.carId).trim(),
    name: '',
    color: '',
    status: 'в аренде',
    dateBuy: null,
    priceBuy: 0,
    rateDay: Math.round(Number(t.amount) / 7) || 0,
    note: '',
    mileage: 0,
    toMileage: 0,
  }));
  const rest = _mockFleetExtras().map(c => ({
    carId: c.carId,
    name: c.name || '',
    color: c.color || '',
    status: c.status || '',
    dateBuy: null,
    priceBuy: 0,
    rateDay: c.rateDay || 0,
    note: '',
    mileage: 0,
    toMileage: 0,
  }));
  return [...rent, ...rest];
}

export async function getMockDriversNormalized() {
  return _MOCK_TASKS.map(t => ({
    driverId: t.driverId,
    name: t.driverName,
    phone: '',
    license: '',
    status: 'активен',
    deposit: 0,
    note: '',
    currentCar: String(t.carId).trim(),
    carId: String(t.carId).trim(),
  }));
}

/** Баланс кассы Азамата ≈ 21746 ₽ и дельта сегодня 0 — одна суммирующая операция не сегодня.
 * Строки «аренда» с amount = 0: только чтобы подтянуть срок до … из комментария для карточек.
 */
export async function getMockOperationsNormalized(opts = {}) {
  const amount = 21746;
  const op = {
    opId: 'CO_MOCK_HOME',
    date: opDateDaysAgo(2),
    dateRaw: '',
    kassaId: KASSA_ID.AZAMAT,
    direction: 'приход',
    amount,
    type: 'прочее',
    category: '',
    carId: '',
    driverId: '',
    comment: 'mock-баланс',
    provel: 'mock',
    classOverride: '',
    classItog: 'revenue',
  };

  const rentOps = _MOCK_TASKS.map((t, i) => ({
    opId: `CO_MOCK_RENT_${i}`,
    date: opDateDaysAgo(1),
    dateRaw: '',
    kassaId: KASSA_ID.AZAMAT,
    direction: 'приход',
    amount: 0,
    type: 'аренда',
    category: '',
    carId: String(t.carId).trim(),
    driverId: t.driverId,
    comment: fmtComment(t.paidUntil),
    provel: 'mock',
    classOverride: '',
    classItog: 'revenue',
  }));

  const all = [op, ...rentOps];

  let out = all;
  if (opts?.kassaId) {
    out = out.filter(o => o.kassaId === opts.kassaId);
  }
  if (opts?.month && opts?.year) {
    out = out.filter(o => {
      if (!o.date) return true;
      return o.date.getMonth() + 1 === opts.month && o.date.getFullYear() === opts.year;
    });
  }
  return out;
}
