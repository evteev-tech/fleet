import { Router } from 'express';
import db from '../db.js';
import { ok, fail } from '../utils.js';
const router = Router();
router.get('/fleet', (req, res) => {
  const cars = db.prepare(`SELECT c.id, c.name, c.color, c.status, c.mileage, c.mileage_to, c.rate_day, c.date_bought, c.note, r.id AS rental_id, r.driver_id, d.name AS driver_name, d.phone AS driver_phone, r.promised_until AS paid_until, r.rate_day AS rental_amount, r.date_start FROM cars c LEFT JOIN rentals r ON r.car_id = c.id AND r.status = 'active' LEFT JOIN drivers d ON d.id = r.driver_id ORDER BY c.id`).all();
  return ok(res, { fleet: cars });
});
router.patch('/fleet/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ['в аренде', 'в ремонте', 'простой'];
  if (!status || !allowed.includes(status)) return fail(res, 'INVALID_STATUS');
  const car = db.prepare('SELECT id FROM cars WHERE id = ?').get(id);
  if (!car) return fail(res, 'CAR_NOT_FOUND', 404);
  db.prepare('UPDATE cars SET status = ? WHERE id = ?').run(status, id);
  return ok(res, { id, status });
});
router.patch('/fleet/:id/mileage', (req, res) => {
  const { id } = req.params;
  const { mileage } = req.body || {};
  if (mileage === undefined || isNaN(Number(mileage))) return fail(res, 'MISSING_FIELD: mileage');
  const car = db.prepare('SELECT id FROM cars WHERE id = ?').get(id);
  if (!car) return fail(res, 'CAR_NOT_FOUND', 404);
  db.prepare('UPDATE cars SET mileage = ? WHERE id = ?').run(Number(mileage), id);
  return ok(res, { id, mileage: Number(mileage) });
});
export default router;
