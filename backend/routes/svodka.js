import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

// DD.MM.YYYY → YYYY-MM-DD
function ruToIso(s) {
  if (!s) return '';
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(s).slice(0, 10);
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isEmptyCarId(id) {
  return id == null || String(id).trim() === '';
}

/** @returns {Set<number>} дни месяца (1..N), когда машина в аренде */
function rentDaysForCar(carId, rentals, daysInMonth, monthPrefix, todayIso) {
  const days = new Set();
  for (const r of rentals) {
    if (r.car_id !== carId) continue;
    const start = String(r.date_start).slice(0, 10);
    const end = r.date_end ? String(r.date_end).slice(0, 10) : todayIso;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${monthPrefix}-${String(d).padStart(2, '0')}`;
      if (iso >= start && iso <= end) days.add(d);
    }
  }
  return days;
}

/** Последний статус из лога на день (date_from <= isoDay) */
function statusFromLog(carId, isoDay, logByCar) {
  const entries = logByCar.get(carId);
  if (!entries?.length) return null;
  let last = null;
  for (const e of entries) {
    if (e.date_from <= isoDay) last = e.status;
    else break;
  }
  return last;
}

function addExpenseBucket(bucket, amount, category) {
  bucket.sum += amount;
  if (amount > bucket.maxAmount) {
    bucket.maxAmount = amount;
    bucket.tag = category || '';
  }
}

router.get('/svodka', (req, res) => {
  try {
    const now = new Date();
    const year  = parseInt(req.query.year, 10)  || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    const monthPrefix = `${year}-${mm}`;
    const monthEndIso = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;
    const todayIso = isoToday();

    const cars = db.prepare(`SELECT id, name, color, status FROM cars ORDER BY id`).all();

    const rentals = db.prepare(`
      SELECT car_id, date_start, date_end FROM rentals
      WHERE date_start <= ? AND (date_end IS NULL OR date_end >= ?)
    `).all(monthEndIso, `${monthPrefix}-01`);

    const statusLog = db.prepare(`
      SELECT car_id, status, date_from FROM car_status_log
      WHERE date_from <= ? ORDER BY car_id, date_from, id
    `).all(monthEndIso);

    const logByCar = new Map();
    for (const row of statusLog) {
      const cid = row.car_id;
      if (!logByCar.has(cid)) logByCar.set(cid, []);
      logByCar.get(cid).push({ status: row.status, date_from: String(row.date_from).slice(0, 10) });
    }

    const ops = db.prepare(`
      SELECT date, direction, amount, category, car_id,
             COALESCE(class_final, class_override, class_calc) AS class_itog
      FROM kassa_ops
    `).all().filter(o => ruToIso(o.date).startsWith(monthPrefix));

    const incomeByCarDay = new Map();
    const expenseByCarDay = new Map();
    const parkByDay = new Map();

    let totalIncome = 0;
    let totalExpense = 0;

    for (const o of ops) {
      const iso = ruToIso(o.date);
      const amount = Number(o.amount) || 0;
      const dir = String(o.direction || '').toLowerCase();

      if (dir === 'приход' && String(o.class_itog || '').toLowerCase() === 'revenue') {
        totalIncome += amount;
        if (!isEmptyCarId(o.car_id)) {
          const key = o.car_id;
          if (!incomeByCarDay.has(key)) incomeByCarDay.set(key, new Map());
          const dayMap = incomeByCarDay.get(key);
          dayMap.set(iso, (dayMap.get(iso) || 0) + amount);
        }
      }

      if (dir === 'расход') {
        totalExpense += amount;
        const cat = o.category || '';
        if (isEmptyCarId(o.car_id)) {
          if (!parkByDay.has(iso)) parkByDay.set(iso, { sum: 0, maxAmount: 0, tag: '' });
          addExpenseBucket(parkByDay.get(iso), amount, cat);
        } else {
          const key = o.car_id;
          if (!expenseByCarDay.has(key)) expenseByCarDay.set(key, new Map());
          const dayMap = expenseByCarDay.get(key);
          if (!dayMap.has(iso)) dayMap.set(iso, { sum: 0, maxAmount: 0, tag: '' });
          addExpenseBucket(dayMap.get(iso), amount, cat);
        }
      }
    }

    let rentMachineDays = 0;

    const carRows = cars.map(car => {
      const carId = car.id;
      const rentDays = rentDaysForCar(carId, rentals, daysInMonth, monthPrefix, todayIso);
      let totalCarIncome = 0;
      let totalCarExpense = 0;

      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${monthPrefix}-${String(d).padStart(2, '0')}`;
        let status;
        if (rentDays.has(d)) {
          status = 'rent';
          rentMachineDays++;
        } else {
          const logStatus = statusFromLog(carId, iso, logByCar);
          status = logStatus === 'в ремонте' ? 'repair' : 'idle';
        }

        const income = incomeByCarDay.get(carId)?.get(iso) || 0;
        const expBucket = expenseByCarDay.get(carId)?.get(iso);
        const expense = expBucket?.sum || 0;
        const expenseTag = expBucket?.tag || '';

        totalCarIncome += income;
        totalCarExpense += expense;

        days.push({ day: d, status, income, expense, expenseTag });
      }

      return {
        carId,
        name: car.name,
        color: car.color,
        days,
        totalIncome: totalCarIncome,
        totalExpense: totalCarExpense,
      };
    });

    const park = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${monthPrefix}-${String(d).padStart(2, '0')}`;
      const bucket = parkByDay.get(iso);
      park.push({
        day: d,
        expense: bucket?.sum || 0,
        expenseTag: bucket?.tag || '',
      });
    }

    const loadPercent = cars.length > 0
      ? Math.round((rentMachineDays / (cars.length * daysInMonth)) * 1000) / 10
      : 0;

    const svodka = {
      year,
      month,
      daysInMonth,
      cars: carRows,
      park,
      totals: {
        income: totalIncome,
        expense: totalExpense,
        net: totalIncome - totalExpense,
        loadPercent,
      },
    };

    return ok(res, { svodka: keysToCamel(svodka) });
  } catch (e) {
    console.error('[SVODKA]', e);
    return fail(res, e.message);
  }
});

export default router;
