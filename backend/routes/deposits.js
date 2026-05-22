import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

function todayStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

function getNextDepId() {
  const row = db.prepare('SELECT id FROM deposits ORDER BY rowid DESC LIMIT 1').get();
  if (!row) return 'DP0001';
  const m = String(row.id).match(/(\d+)$/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return 'DP' + String(n).padStart(4, '0');
}

router.get('/', (req, res) => {
  const { driver_id, car_id } = req.query;
  let sql = `
    SELECT
      id AS dep_op_id,
      date,
      date AS date_raw,
      driver_id,
      car_id,
      amount,
      status,
      comment
    FROM deposits WHERE 1=1`;
  const params = [];
  if (driver_id) { sql += ' AND driver_id = ?'; params.push(driver_id); }
  if (car_id)    { sql += ' AND car_id = ?';    params.push(car_id); }
  sql += ' ORDER BY rowid DESC';
  const rows = db.prepare(sql).all(...params);
  return ok(res, { deposits: keysToCamel(rows) });
});

router.post('/', (req, res) => {
  const { driver_id, car_id = '', amount, comment = '', status } = req.body;
  if (!driver_id) return fail(res, 'MISSING: driver_id');
  if (amount === undefined || amount === null || amount === '') return fail(res, 'MISSING: amount');
  const driver = db.prepare('SELECT id, deposit_balance FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return fail(res, 'DRIVER_NOT_FOUND', 404);
  const dep_op_id = getNextDepId();
  const amt = Number(amount);
  const statusFinal = status || (amt > 0 ? '\u043f\u0440\u0438\u0445\u043e\u0434' : '\u0440\u0430\u0441\u0445\u043e\u0434');
  const doTx = db.transaction(() => {
    db.prepare('INSERT INTO deposits (id,date,driver_id,car_id,amount,status,comment) VALUES (?,?,?,?,?,?,?)')
      .run(dep_op_id, todayStr(), driver_id, car_id, amt, statusFinal, comment);
    db.prepare('UPDATE drivers SET deposit_balance = ? WHERE id = ?')
      .run((Number(driver.deposit_balance) || 0) + amt, driver_id);
    return { dep_op_id };
  });
  try { return ok(res, doTx()); }
  catch(e) { return fail(res, e.message); }
});

export default router;
