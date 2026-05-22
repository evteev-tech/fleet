import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

function getNextOpId() {
  const row = db.prepare('SELECT id FROM kassa_ops ORDER BY rowid DESC LIMIT 1').get();
  if (!row) return 'CO0001';
  const m = String(row.id).match(/(\d+)$/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return 'CO' + String(n).padStart(4, '0');
}

router.get('/', (req, res) => {
  const { kassa_id, car_id, driver_id, limit = 500 } = req.query;
  let sql = `
    SELECT
      id AS op_id,
      date,
      date AS date_raw,
      kassa_id,
      direction,
      amount,
      type,
      category,
      car_id,
      driver_id,
      comment,
      author AS provel,
      class_override,
      COALESCE(class_final, class_override, class_calc) AS class_itog
    FROM kassa_ops WHERE 1=1`;
  const params = [];
  if (kassa_id)  { sql += ' AND kassa_id = ?';  params.push(kassa_id); }
  if (car_id)    { sql += ' AND car_id = ?';     params.push(car_id); }
  if (driver_id) { sql += ' AND driver_id = ?';  params.push(driver_id); }
  sql += ' ORDER BY rowid DESC LIMIT ?';
  params.push(Number(limit));
  const rows = db.prepare(sql).all(...params);
  return ok(res, { operations: keysToCamel(rows) });
});

router.post('/', (req, res) => {
  const { date, kassa_id, direction, amount, type = '', category = '',
          car_id = '', driver_id = '', comment = '', author = '', class_override = '' } = req.body;
  if (!date)      return fail(res, 'MISSING: date');
  if (!kassa_id)  return fail(res, 'MISSING: kassa_id');
  if (!direction) return fail(res, 'MISSING: direction');
  if (amount === undefined || amount === null || amount === '') return fail(res, 'MISSING: amount');
  const op_id = getNextOpId();
  const t = String(type).toLowerCase().trim();
  const d = String(direction).toLowerCase().trim();
  let classCalc = 'revenue';
  if (t === 'аренда') classCalc = 'revenue';
  else if (t.startsWith('депозит')) classCalc = 'deposit';
  else if (t.includes('перевод')) classCalc = 'transfer';
  else if (d === 'расход') classCalc = 'opex';
  const classFinal = class_override || classCalc;
  db.prepare(`INSERT INTO kassa_ops
    (id,date,kassa_id,direction,amount,type,category,car_id,driver_id,comment,author,class_calc,class_final)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(op_id, date, kassa_id, direction, Number(amount), type, category || type,
         car_id, driver_id, comment, author, classCalc, classFinal);
  return ok(res, { op_id });
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const op = db.prepare('SELECT id FROM kassa_ops WHERE id = ?').get(id);
  if (!op) return fail(res, 'OPERATION_NOT_FOUND', 404);
  const allowed = ['date','kassa_id','direction','amount','type','category',
                   'car_id','driver_id','comment','author','class_final'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { updates.push(key + ' = ?'); params.push(req.body[key]); }
  }
  if (!updates.length) return fail(res, 'NO_FIELDS_TO_UPDATE');
  params.push(id);
  db.prepare('UPDATE kassa_ops SET ' + updates.join(', ') + ' WHERE id = ?').run(...params);
  return ok(res, { op_id: id });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const op = db.prepare('SELECT id FROM kassa_ops WHERE id = ?').get(id);
  if (!op) return fail(res, 'OPERATION_NOT_FOUND', 404);
  db.prepare('DELETE FROM kassa_ops WHERE id = ?').run(id);
  return ok(res, { deleted: id });
});

export default router;
