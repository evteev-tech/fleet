import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel, formatDate } from '../utils.js';
const router = Router();
router.get('/fleet', (req, res) => {
  const cars = db.prepare(`
    SELECT
      c.id            AS car_id,
      c.name, c.color, c.status, c.mileage,
      c.mileage_to    AS to_mileage,
      c.rate_day,
      c.date_bought   AS date_buy,
      c.price_bought  AS price_buy,
      c.note,
      r.id            AS rental_id,
      r.driver_id,
      d.name          AS driver_name,
      d.phone         AS driver_phone,
      r.promised_until AS paid_until,
      r.rate_day      AS rental_amount,
      r.date_start
    FROM cars c
    LEFT JOIN (
      SELECT * FROM rentals WHERE status = 'active'
      GROUP BY car_id HAVING rowid = MAX(rowid)
    ) r ON r.car_id = c.id
    LEFT JOIN drivers d ON d.id = r.driver_id
    ORDER BY c.id
  `).all();
  return ok(res, { fleet: keysToCamel(cars) });
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
router.patch('/fleet/:id/rate', (req, res) => {
  const { id } = req.params;
  const { rate_day, new_rate, reason = '', by = '' } = req.body || {};
  const rate = rate_day ?? new_rate;
  if (rate === undefined || isNaN(Number(rate))) return fail(res, 'MISSING_FIELD: rate_day');
  const car = db.prepare('SELECT id, rate_day, note FROM cars WHERE id = ?').get(id);
  if (!car) return fail(res, 'CAR_NOT_FOUND', 404);
  const oldRate = car.rate_day;
  let note = car.note || '';
  if (reason || by) {
    const suffix = `[${formatDate(new Date())}] ставка ${oldRate}→${rate}${reason ? ': ' + reason : ''}${by ? ' (' + by + ')' : ''}`;
    note = note ? `${note}\n${suffix}` : suffix;
  }
  db.prepare('UPDATE cars SET rate_day = ?, note = ? WHERE id = ?').run(Number(rate), note, id);
  return ok(res, { id, rateDay: Number(rate) });
});
export default router;
