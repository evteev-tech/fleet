import { Router } from 'express';
import db from '../db.js';
import { ok, fail, getNextId, formatDate } from '../utils.js';

const router = Router();

// GET /api/deposits
router.get('/deposits', (req, res) => {
  const { driver_id, car_id } = req.query;

  let sql = 'SELECT * FROM deposits WHERE 1=1';
  const params = [];

  if (driver_id) { sql += ' AND driver_id = ?'; params.push(driver_id); }
  if (car_id)    { sql += ' AND car_id = ?';    params.push(car_id); }

  sql += ' ORDER BY rowid DESC';

  const rows = db.prepare(sql).all(...params);
  return ok(res, { deposits: rows });
});

// POST /api/deposits — ADD_DEPOSIT
router.post('/deposits', (req, res) => {
  const { driver_id, car_id = '', amount, comment = '', status } = req.body || {};

  if (!driver_id) return fail(res, 'MISSING: driver_id');
  if (amount === undefined || amount === null || amount === '')
    return fail(res, 'MISSING: amount');

  const driver = db.prepare('SELECT id, deposit_balance FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return fail(res, 'DRIVER_NOT_FOUND', 404);

  const dep_op_id = getNextId('deposits', 'id', 'DP', 4);
  const today = formatDate(new Date());
  const amt = Number(amount);
  const statusFinal = status || (amt > 0 ? 'приход' : 'расход');

  const doTransaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO deposits (id, date, driver_id, car_id, amount, status, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(dep_op_id, today, driver_id, car_id, amt, statusFinal, comment);

    const newBalance = (Number(driver.deposit_balance) || 0) + amt;
    db.prepare('UPDATE drivers SET deposit_balance = ? WHERE id = ?').run(newBalance, driver_id);

    return { dep_op_id, new_balance: newBalance };
  });

  try {
    const result = doTransaction();
    return ok(res, result);
  } catch (err) {
    console.error('[ADD_DEPOSIT] transaction failed:', err);
    return fail(res, err.message || 'TRANSACTION_FAILED', 500);
  }
});

export default router;
