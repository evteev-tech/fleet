import { Router } from 'express';
import db from '../db.js';
import { ok, fail, getNextId, formatDate, nowStr } from '../utils.js';

const router = Router();

// GET /api/rentals/income-form?car_id=X
router.get('/rentals/income-form', (req, res) => {
  const { car_id } = req.query;

  let rows;
  if (car_id) {
    rows = db.prepare(
      `SELECT r.car_id,
              MAX(r.date_end) AS last_paid_date,
              r.rate_day,
              r.driver_id,
              r.promised_until,
              r.promised_at
       FROM rentals r
       WHERE r.car_id = ? AND r.status = 'active'
       GROUP BY r.car_id`
    ).all(car_id);
  } else {
    rows = db.prepare(
      `SELECT r.car_id,
              MAX(r.date_end) AS last_paid_date,
              r.rate_day,
              r.driver_id,
              r.promised_until,
              r.promised_at
       FROM rentals r
       INNER JOIN cars c ON c.id = r.car_id
       WHERE c.status = 'в аренде' AND r.status = 'active'
       GROUP BY r.car_id`
    ).all();
  }

  const incomeForm = rows.map(r => ({
    carId:         r.car_id,
    lastPaidDate:  r.last_paid_date || '',
    rateDay:       r.rate_day || 0,
    driverId:      r.driver_id || '',
    promisedUntil: r.promised_until || '',
    promisedAt:    r.promised_at || '',
  }));

  return ok(res, { incomeForm });
});

// PATCH /api/rentals/by-car/:car_id/promise
router.patch('/rentals/by-car/:car_id/promise', (req, res) => {
  const { car_id } = req.params;
  const { promised_until } = req.body || {};

  const rental = db.prepare(
    `SELECT id FROM rentals
     WHERE car_id = ? AND status = 'active'
     ORDER BY rowid DESC LIMIT 1`
  ).get(car_id);

  if (!rental) return fail(res, 'RENTAL_NOT_FOUND', 404);

  const puVal = promised_until ? String(promised_until).trim() : null;
  const paVal = puVal ? nowStr() : null;

  db.prepare(
    'UPDATE rentals SET promised_until = ?, promised_at = ? WHERE id = ?'
  ).run(puVal, paVal, rental.id);

  return ok(res, { id: rental.id, promised_until: puVal, promised_at: paVal });
});

// PATCH /api/rentals/:id/promise — SAVE_RENTAL_PROMISE
router.patch('/rentals/:id/promise', (req, res) => {
  const { id } = req.params;
  const { promised_until } = req.body || {};

  const rental = db.prepare(
    "SELECT id FROM rentals WHERE id = ? AND status = 'active'"
  ).get(id);

  if (!rental) return fail(res, 'RENTAL_NOT_FOUND', 404);

  const puVal = promised_until ? String(promised_until).trim() : null;
  const paVal = puVal ? nowStr() : null;

  db.prepare(
    'UPDATE rentals SET promised_until = ?, promised_at = ? WHERE id = ?'
  ).run(puVal, paVal, id);

  return ok(res, { id, promised_until: puVal, promised_at: paVal });
});

// GET /api/rentals
router.get('/rentals', (req, res) => {
  const { car_id, status } = req.query;

  let sql = 'SELECT * FROM rentals WHERE 1=1';
  const params = [];

  if (car_id) { sql += ' AND car_id = ?'; params.push(car_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY rowid DESC';

  const rows = db.prepare(sql).all(...params);
  return ok(res, { rentals: rows });
});

// POST /api/rentals — ADD_RENTAL
router.post('/rentals', (req, res) => {
  const { car_id, driver_id, date_start, date_end = '', rate_day, comment = '' } = req.body || {};

  if (!car_id)     return fail(res, 'MISSING: car_id');
  if (!driver_id)  return fail(res, 'MISSING: driver_id');
  if (!date_start) return fail(res, 'MISSING: date_start');
  if (rate_day === undefined || rate_day === null)
    return fail(res, 'MISSING: rate_day');

  const rental_id = getNextId('rentals', 'id', 'R', 4);

  db.prepare(
    `INSERT INTO rentals
       (id, car_id, driver_id, date_start, date_end, rate_day, comment, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(rental_id, car_id, driver_id, date_start, date_end || null, Number(rate_day), comment);

  return ok(res, { rental_id });
});

// POST /api/rentals/income — ADD_INCOME
router.post('/rentals/income', (req, res) => {
  const {
    car_id, driver_id, amount,
    date_from, date_to,
    rate, kassa_id,
    comment = '',
    provel = 'Азамат',
    mileage,
  } = req.body || {};

  if (!car_id)    return fail(res, 'MISSING: car_id');
  if (!driver_id) return fail(res, 'MISSING: driver_id');
  if (amount === undefined || amount === null) return fail(res, 'MISSING: amount');
  if (!date_from) return fail(res, 'MISSING: date_from');
  if (!date_to)   return fail(res, 'MISSING: date_to');
  if (!kassa_id)  return fail(res, 'MISSING: kassa_id');

  const today = formatDate(new Date());
  const classCalc = 'revenue';

  const doTransaction = db.transaction(() => {
    const op_id = getNextId('kassa_ops', 'id', 'CO', 4);

    db.prepare(
      `INSERT INTO kassa_ops
         (id, date, kassa_id, direction, amount, type, category,
          car_id, driver_id, comment, author, class_calc, class_final)
       VALUES (?, ?, ?, 'приход', ?, 'аренда', 'аренда',
               ?, ?, ?, ?, ?, ?)`
    ).run(
      op_id, today, kassa_id, Number(amount),
      car_id, driver_id, comment, provel,
      classCalc, classCalc
    );

    const rental_id = getNextId('rentals', 'id', 'R', 4);
    db.prepare(
      `INSERT INTO rentals
         (id, car_id, driver_id, date_start, date_end, rate_day, comment, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(rental_id, car_id, driver_id, date_from, date_to, Number(rate), comment);

    db.prepare(
      `UPDATE rentals
       SET promised_until = NULL, promised_at = NULL
       WHERE car_id = ? AND status = 'active' AND id != ?`
    ).run(car_id, rental_id);

    if (mileage && Number(mileage) > 0) {
      db.prepare('UPDATE cars SET mileage = ? WHERE id = ?')
        .run(Math.round(Number(mileage)), car_id);
    }

    return { op_id, rental_id };
  });

  try {
    const result = doTransaction();
    return ok(res, result);
  } catch (err) {
    console.error('[ADD_INCOME] transaction failed:', err);
    return fail(res, err.message || 'TRANSACTION_FAILED', 500);
  }
});

export default router;
