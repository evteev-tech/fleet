import { Router } from 'express';
import db from '../db.js';
import { ok, fail, getNextId } from '../utils.js';

const router = Router();

// GET /api/drivers — список водителей с текущей машиной
router.get('/drivers', (req, res) => {
  const drivers = db.prepare(`
    SELECT
      d.id, d.name, d.phone, d.license, d.status, d.deposit_balance, d.note,
      r.car_id        AS currentCar,
      c.name          AS currentCarName,
      r.id            AS rentalId,
      r.rate_day      AS rateDay,
      r.promised_until AS promisedUntil
    FROM drivers d
    LEFT JOIN (
      SELECT * FROM rentals WHERE status = 'active'
      GROUP BY driver_id HAVING rowid = MAX(rowid)
    ) r ON r.driver_id = d.id
    LEFT JOIN cars c ON c.id = r.car_id
    ORDER BY d.name
  `).all();
  return ok(res, { drivers });
});

// POST /api/drivers — создать или обновить водителя
router.post('/drivers', (req, res) => {
  const { id, name, phone, passport, note } = req.body || {};
  if (!name) return fail(res, 'MISSING_FIELD: name');

  if (id) {
    const exists = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id);
    if (!exists) return fail(res, 'DRIVER_NOT_FOUND', 404);
    db.prepare(`
      UPDATE drivers SET name=?, phone=?, passport=?, note=? WHERE id=?
    `).run(name, phone || null, passport || null, note || null, id);
    return ok(res, { id });
  } else {
    const newId = getNextId('drivers', 'id', 'D');
    db.prepare(`
      INSERT INTO drivers (id, name, phone, passport, note) VALUES (?,?,?,?,?)
    `).run(newId, name, phone || null, passport || null, note || null);
    return ok(res, { id: newId });
  }
});

export default router;
