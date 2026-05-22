import { Router } from 'express';
import db from '../db.js';
import { ok, fail, getNextId, formatDate, calcClass } from '../utils.js';

const router = Router();

// GET /api/operations
router.get('/operations', (req, res) => {
  const { kassa_id, car_id, driver_id, limit = 200 } = req.query;

  let sql = 'SELECT * FROM kassa_ops WHERE 1=1';
  const params = [];

  if (kassa_id)  { sql += ' AND kassa_id = ?';  params.push(kassa_id); }
  if (car_id)    { sql += ' AND car_id = ?';     params.push(car_id); }
  if (driver_id) { sql += ' AND driver_id = ?';  params.push(driver_id); }

  sql += ' ORDER BY rowid DESC LIMIT ?';
  params.push(Number(limit));

  const rows = db.prepare(sql).all(...params);
  return ok(res, { operations: rows });
});

// POST /api/operations — ADD_OPERATION
router.post('/operations', (req, res) => {
  const {
    date, kassa_id, direction, amount,
    type = '', category = '',
    car_id = '', driver_id = '',
    comment = '', author = '',
    class_override = '',
  } = req.body || {};

  if (!date)      return fail(res, 'MISSING: date');
  if (!kassa_id)  return fail(res, 'MISSING: kassa_id');
  if (!direction) return fail(res, 'MISSING: direction');
  if (amount === undefined || amount === null || amount === '')
    return fail(res, 'MISSING: amount');

  const kassa = db.prepare('SELECT id FROM kassas WHERE id = ?').get(kassa_id);
  if (!kassa) return fail(res, 'KASSA_NOT_FOUND');

  const op_id = getNextId('kassa_ops', 'id', 'CO', 4);
  const classCalc = calcClass(type, direction);
  const classFinal = class_override || classCalc;

  db.prepare(
    `INSERT INTO kassa_ops
       (id, date, kassa_id, direction, amount, type, category,
        car_id, driver_id, comment, author, class_calc, class_final)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    op_id, date, kassa_id, direction, Number(amount),
    type, category || type,
    car_id, driver_id, comment, author,
    classCalc, classFinal
  );

  return ok(res, { op_id });
});

// PATCH /api/operations/:id — UPDATE_OPERATION
router.patch('/operations/:id', (req, res) => {
  const { id } = req.params;

  const op = db.prepare('SELECT id FROM kassa_ops WHERE id = ?').get(id);
  if (!op) return fail(res, 'OPERATION_NOT_FOUND', 404);

  const allowed = [
    'date', 'kassa_id', 'direction', 'amount', 'type', 'category',
    'car_id', 'driver_id', 'comment', 'author', 'class_override', 'class_final',
  ];

  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const col = key === 'class_override' ? 'class_final' : key;
      updates.push(`${col} = ?`);
      params.push(req.body[key]);
    }
  }

  if (updates.length === 0) return fail(res, 'NO_FIELDS_TO_UPDATE');

  params.push(id);
  db.prepare(`UPDATE kassa_ops SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return ok(res, { op_id: id });
});

// DELETE /api/operations/:id
router.delete('/operations/:id', (req, res) => {
  const { id } = req.params;

  const op = db.prepare('SELECT id FROM kassa_ops WHERE id = ?').get(id);
  if (!op) return fail(res, 'OPERATION_NOT_FOUND', 404);

  db.prepare('DELETE FROM kassa_ops WHERE id = ?').run(id);
  return ok(res, { deleted: id });
});

export default router;
