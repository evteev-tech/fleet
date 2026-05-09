/**
 * Статичный набор данных для UI/демо (?mock=1).
 * Изменение «обещаний» в mock — см. mutateMockRentalPromise().
 * Срок оплаты (paid_until) считается из даты последней операции аренды, суммы и ставки —
 * см. calcPaidUntil в utils/rent.js.
 */

import { KASSA_ID } from '../config.js';
import { calcPaidUntil } from '../utils/rent.js';

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

/**
 * @typedef {{
 *   carId: string, driverName: string, driverId: string,
 *   amount: number, rateDay: number, opDaysAgo: number, opAmount: number,
 *   promisedUntil?: Date, promisedAt?: Date
 * }} MockTaskSpec
 */

/** @type {MockTaskSpec[]} */
const _MOCK_TASK_SPECS = [
  { carId: 'А982', driverName: 'Марат', driverId: 'D982', amount: 5950, rateDay: 800, opDaysAgo: 30, opAmount: 13 * 800 },
  {
    carId: 'А165',
    driverName: 'Сергей',
    driverId: 'D165',
    amount: 5950,
    rateDay: 850,
    opDaysAgo: 25,
    opAmount: 15 * 850,
    promisedUntil: daysAgo(1),
    promisedAt: daysAgo(3),
  },
  {
    carId: 'Т086',
    driverName: 'Алексей',
    driverId: 'D086',
    amount: 5950,
    rateDay: 850,
    opDaysAgo: 20,
    opAmount: 15 * 850,
    promisedUntil: daysFromNow(1),
    promisedAt: daysAgo(1),
  },
  { carId: 'Н723', driverName: 'Иван', driverId: 'D723', amount: 5950, rateDay: 850, opDaysAgo: 1, opAmount: 850 },
  { carId: 'К268', driverName: 'Руслан', driverId: 'D268', amount: 729 * 7, rateDay: 729, opDaysAgo: 0, opAmount: 729 },
  { carId: 'Н052', driverName: 'Дмитрий', driverId: 'D052', amount: 5950, rateDay: 850, opDaysAgo: 0, opAmount: 2 * 850 },
];

const _MOCK_TASKS = _MOCK_TASK_SPECS.map(spec => {
  const opAt = opDateDaysAgo(spec.opDaysAgo);
  const paidUntil = calcPaidUntil(opAt, spec.opAmount, spec.rateDay);
  return {
    ...spec,
    paidUntil,
  };
});

/** @type {MockRental[]} — по одному «активному» блоку аренды на машину из списка задач */
const _MOCK_RENTALS = _MOCK_TASKS.map((t, i) => ({
  rentalId: `R_MOCK_${String(i + 1).padStart(4, '0')}`,
  carId: String(t.carId).trim(),
  driverId: t.driverId,
  dateStart: daysAgo(30),
  dateEnd: t.paidUntil ? new Date(t.paidUntil) : null,
  rateDay: t.rateDay,
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
    rateDay: t.rateDay,
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
 * Операции «аренда»: дата и сумма согласованы с calcPaidUntil и ставкой из _MOCK_TASKS.
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

  const rentOps = _MOCK_TASKS.map((t, i) => {
    const opAt = opDateDaysAgo(t.opDaysAgo);
    const paidUntil = calcPaidUntil(opAt, t.opAmount, t.rateDay);
    return {
      opId: `CO_MOCK_RENT_${i}`,
      date: new Date(opAt),
      dateRaw: '',
      kassaId: KASSA_ID.AZAMAT,
      direction: 'приход',
      amount: t.opAmount,
      type: 'аренда',
      category: '',
      carId: String(t.carId).trim(),
      driverId: t.driverId,
      comment: fmtComment(paidUntil),
      provel: 'mock',
      classOverride: '',
      classItog: 'revenue',
    };
  });

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
