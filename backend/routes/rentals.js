import { Router } from 'express';
import db from '../db.js';
import { ok, fail } from '../utils.js';

const router = Router();

function todayStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

function nowStr() {
  const d = new Date();
  return todayStr() + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function getNextId(table, prefix) {
  const row = db.prepare('SELECT id FROM ' + table + ' ORDER BY rowid DESC LIMIT 1').get();
  if (!row) return prefix + '0001';
  const m = String(row.id).match(/(\d+)$/);
  return prefix + String(m ? parseInt(m[1],10)+1 : 1).padStart(4,'0');
}

router.get('/income-form', (req, res) => {
  const { car_id } = req.query;
  let rows;
  if (car_id) {
    rows = db.prepare(`SELECT r.car_id, MAX(r.date_end) AS last_paid_date, r.rate_day, r.driver_id, r.promised_until, r.promised_at
      FROM rentals r WHERE r.car_id = ? AND r.status = 'active' GROUP BY r.car_id`).all(car_id);
  } else {
    rows = db.prepare(`SELECT r.car_id, MAX(r.date_end) AS last_paid_date, r.rate_day, r.driver_id, r.promised_until, r.promised_at
      FROM rentals r INNER JOIN cars c ON c.id = r.car_id
      WHERE c.status = 'в аренде' AND r.status = 'active' GROUP BY r.car_id`).all();
  }
  return ok(res, { incomeForm: rows.map(r => ({
    carId: r.car_id, lastPaidDate: r.last_paid_date || '',
    rateDay: r.rate_day || 0, driverId: r.driver_id || '',
    promisedUntil: r.promised_until || '', promisedAt: r.promised_at || '',
  }))});
});

router.get('/', (req, res) => {
  const { car_id, status } = req.query;
  let sql = 'SELECT * FROM rentals WHERE 1=1';
  const params = [];
  if (car_id) { sql += ' AND car_id = ?'; params.push(car_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY rowid DESC';
  return ok(res, { rentals: db.prepare(sql).all(...params) });
});

router.post('/', (req, res) => {
  const { car_id, driver_id, date_start, date_end = '', rate_day, comment = '' } = req.body;
  if (!car_id || !driver_id || !date_start || rate_day === undefined)
    return fail(res, 'MISSING_FIELDS');
  const rental_id = getNextId('rentals', 'R');
  db.prepare(`INSERT INTO rentals (id,car_id,driver_id,date_start,date_end,rate_day,comment,status)
    VALUES (?,?,?,?,?,?,?,'active')`)
    .run(rental_id, car_id, driver_id, date_start, date_end || null, Number(rate_day), comment);
  return ok(res, { rental_id });
});

router.patch('/by-car/:car_id/promise', (req, res) => {
  const { car_id } = req.params;
  const { promised_until } = req.body;
  const rental = db.prepare("SELECT id FROM rentals WHERE car_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT 1").get(car_id);
  if (!rental) return fail(res, 'RENTAL_NOT_FOUND', 404);
  const puVal = promised_until ? String(promised_until).trim() : null;
  db.prepare('UPDATE rentals SET promised_until = ?, promised_at = ? WHERE id = ?')
    .run(puVal, puVal ? nowStr() : null, rental.id);
  return ok(res, { id: rental.id, promised_until: puVal });
});

router.patch('/:id/promise', (req, res) => {
  const { id } = req.params;
  const { promised_until } = req.body;
  const rental = db.prepare("SELECT id FROM rentals WHERE id = ? AND status = 'active'").get(id);
  if (!rental) return fail(res, 'RENTAL_NOT_FOUND', 404);
  const puVal = promised_until ? String(promised_until).trim() : null;
  db.prepare('UPDATE rentals SET promised_until = ?, promised_at = ? WHERE id = ?')
    .run(puVal, puVal ? nowStr() : null, id);
  return ok(res, { id, promised_until: puVal });
});

router.post('/income', (req, res) => {
  const { car_id, driver_id, amount, date_from, date_to, rate, kassa_id,
          comment = '', provel = 'Азамат', mileage } = req.body;
  if (!car_id || !driver_id || (!amount && amount !== 0) || !date_from || !date_to || !kassa_id)
    return fail(res, 'MISSING_FIELDS');
  const doTx = db.transaction(() => {
    const op_id = getNextId('kassa_ops', 'CO');
    db.prepare(`INSERT INTO kassa_ops (id,date,kassa_id,direction,amount,type,category,car_id,driver_id,comment,author,class_calc,class_final)
      VALUES (?,?,?,'приход',?,'аренда','аренда',?,?,?,?,'revenue','revenue')`)
      .run(op_id, todayStr(), kassa_id, Number(amount), car_id, driver_id, comment, provel);
    const rental_id = getNextId('rentals', 'R');
    db.prepare(`INSERT INTO rentals (id,car_id,driver_id,date_start,date_end,rate_day,comment,status)
      VALUES (?,?,?,?,?,?,?,'active')`)
      .run(rental_id, car_id, driver_id, date_from, date_to, Number(rate), comment);
    db.prepare("UPDATE rentals SET promised_until=NULL, promised_at=NULL WHERE car_id=? AND status='active' AND id!=?")
      .run(car_id, rental_id);
    db.prepare("UPDATE cars SET status='в аренде' WHERE id=?").run(car_id);
    if (mileage && Number(mileage) > 0)
      db.prepare('UPDATE cars SET mileage=? WHERE id=?').run(Math.round(Number(mileage)), car_id);
    return { op_id, rental_id };
  });
  try { return ok(res, doTx()); }
  catch(e) { console.error('[ADD_INCOME]', e); return fail(res, e.message); }
});

export default router;
