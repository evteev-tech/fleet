import { Router } from 'express';
import db from '../db.js';
import { ok, fail } from '../utils.js';

const router = Router();

// GET /api/rentals/income-form?car_id=X
router.get('/rentals/income-form', (req, res) => {
  const { car_id } = req.query;
  if (!car_id) return fail(res, 'MISSING_PARAM: car_id');
  const row = db.prepare(`
    SELECT MAX(date_end) AS max_paid_until, driver_id, rate_day AS amount
    FROM rentals
    WHERE car_id = ? AND status = 'active'
    GROUP BY car_id
  `).get(car_id);
  return ok(res, { car_id, ...(row || { max_paid_until: null, driver_id: null, amount: 0 }) });
});

export default router;
