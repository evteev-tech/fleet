import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

// ─── Хелперы дат ──────────────────────────────────────────────────────────────
// kassa_ops хранит даты как DD.MM.YYYY, rentals — как ISO YYYY-MM-DD.
// Приводим всё к ISO-ключу дня YYYY-MM-DD для единого сопоставления.

/** Любая дата (DD.MM.YYYY, ISO, с временем) → 'YYYY-MM-DD' или null. */
function toIsoDay(str) {
  if (!str) return null;
  const s = String(str).trim().split(/[ T]/)[0];
  const ddmm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

/** Категория расхода → короткий тег для ячейки. */
const EXPENSE_TAGS = {
  'ремонт': 'ремонт',
  'запчасти': 'запчасти',
  'ТО': 'ТО',
  'страховка': 'страховка',
  'связь_глонасс': 'глонасс',
  'ЗП': 'ЗП',
  'реклама': 'реклама',
  'доставка': 'доставка',
  'покупка_машины': 'покупка',
  'штраф_ГИБДД': 'штраф',
  'ДТП': 'ДТП',
  'прочее': 'прочее',
};
function expenseTag(category) {
  const c = String(category || '').trim();
  return EXPENSE_TAGS[c] || c || 'расход';
}

/**
 * GET /api/svodka?year=2026&month=4
 * Календарная матрица «дни × машины» за месяц.
 */
router.get('/svodka', (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month || month < 1 || month > 12) return fail(res, 'INVALID_PERIOD');

    const daysInMonth = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    const monthPrefixIso = `${year}-${mm}-`;
    const todayIso = new Date().toISOString().slice(0, 10);

    const cars = db.prepare('SELECT id, name, color, status FROM cars ORDER BY id').all();

    const ddmmSuffix = `%.${mm}.${year}`;
    const ops = db.prepare(
      `SELECT car_id, date, direction, amount, category
         FROM kassa_ops
        WHERE car_id IS NOT NULL AND car_id <> '' AND date LIKE ?`
    ).all(ddmmSuffix);

    const rentals = db.prepare(
      `SELECT car_id, date_start, date_end, status FROM rentals
        WHERE car_id IS NOT NULL AND car_id <> ''`
    ).all();

    const statusLog = db.prepare(
      `SELECT car_id, status, date_from FROM car_status_log
        ORDER BY car_id, date_from, id`
    ).all();

    const incomeByCarDay = {};
    const expenseByCarDay = {};

    for (const o of ops) {
      const day = toIsoDay(o.date);
      if (!day || !day.startsWith(monthPrefixIso)) continue;
      const car = o.car_id;
      const amt = Number(o.amount) || 0;
      const dir = String(o.direction || '').toLowerCase();
      const cat = String(o.category || '').toLowerCase();

      if (dir === 'приход' && cat === 'аренда') {
        (incomeByCarDay[car] ||= {});
        incomeByCarDay[car][day] = (incomeByCarDay[car][day] || 0) + amt;
      } else if (dir === 'расход') {
        (expenseByCarDay[car] ||= {});
        const cell = (expenseByCarDay[car][day] ||= { sum: 0, maxAmt: 0, tag: '' });
        cell.sum += amt;
        if (amt > cell.maxAmt) { cell.maxAmt = amt; cell.tag = expenseTag(o.category); }
      }
    }

    const logByCar = {};
    for (const r of statusLog) (logByCar[r.car_id] ||= []).push(r);
    function statusOnDay(carId, dayIso) {
      const log = logByCar[carId];
      if (!log?.length) return null;
      let cur = null;
      for (const e of log) {
        if (e.date_from <= dayIso) cur = e.status;
        else break;
      }
      return cur;
    }

    const rentalsByCar = {};
    for (const r of rentals) (rentalsByCar[r.car_id] ||= []).push(r);
    function inRentalOnDay(carId, dayIso) {
      const list = rentalsByCar[carId];
      if (!list) return false;
      for (const r of list) {
        const s = toIsoDay(r.date_start);
        if (!s || s > dayIso) continue;
        const e = r.date_end ? toIsoDay(r.date_end) : null;
        const end = e || todayIso;
        if (dayIso <= end) return true;
      }
      return false;
    }

    let sumIncome = 0;
    let sumExpense = 0;
    let rentDays = 0;

    const matrix = cars.map(car => {
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayIso = `${monthPrefixIso}${String(d).padStart(2, '0')}`;

        let status = statusOnDay(car.id, dayIso);
        if (!status) status = inRentalOnDay(car.id, dayIso) ? 'в аренде' : 'простой';

        const income = incomeByCarDay[car.id]?.[dayIso] || 0;
        const exp = expenseByCarDay[car.id]?.[dayIso] || null;

        sumIncome += income;
        if (exp) sumExpense += exp.sum;
        if (status === 'в аренде') rentDays++;

        days.push({
          day: d,
          status,
          income,
          expense: exp ? exp.sum : 0,
          expense_tag: exp ? exp.tag : '',
        });
      }
      return { car_id: car.id, name: car.name, color: car.color, status_now: car.status, days };
    });

    const totalCarDays = cars.length * daysInMonth;
    const load = totalCarDays > 0 ? Math.round((rentDays / totalCarDays) * 100) : 0;

    return ok(res, {
      svodka: keysToCamel({
        year, month, days_in_month: daysInMonth,
        summary: {
          income: sumIncome,
          expense: sumExpense,
          net: sumIncome - sumExpense,
          load_pct: load,
          cars_count: cars.length,
          rent_days: rentDays,
        },
        matrix,
      }),
    });
  } catch (e) {
    console.error('[SVODKA]', e);
    return fail(res, e.message);
  }
});

export default router;
