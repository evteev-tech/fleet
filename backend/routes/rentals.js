import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

// DD.MM.YYYY для kassa_ops (исторический формат, не меняем)
function todayStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

function nowStr() {
  const d = new Date();
  return todayStr() + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

// ISO YYYY-MM-DD для rentals (нормализует DD.MM.YYYY и уже ISO)
function toIso(str) {
  if (!str) return null;
  const s = String(str).trim();
  // DD.MM.YYYY → YYYY-MM-DD
  const ddmm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}`;
  // уже ISO или другой формат — вернуть как есть
  return s;
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
    rows = db.prepare(`
      SELECT r.car_id, MAX(r.date_end) AS last_paid_date, r.rate_day, r.driver_id,
             r.promised_until, r.promised_at
      FROM rentals r
      WHERE r.car_id = ? AND r.status = 'active'
      GROUP BY r.car_id
    `).all(car_id);
  } else {
    rows = db.prepare(`
      SELECT r.car_id, MAX(r.date_end) AS last_paid_date, r.rate_day, r.driver_id,
             r.promised_until, r.promised_at
      FROM rentals r
      INNER JOIN cars c ON c.id = r.car_id
      WHERE c.status = 'в аренде' AND r.status = 'active'
      GROUP BY r.car_id
    `).all();
  }
  // Нормализуем last_paid_date в DD.MM.YYYY для фронта (driver-pay.js ждёт этот формат)
  const mapped = (rows || []).map(r => {
    let lpd = r.last_paid_date;
    if (lpd) {
      // ISO → DD.MM.YYYY
      const iso = lpd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) lpd = `${iso[3]}.${iso[2]}.${iso[1]}`;
    }
    return { ...r, last_paid_date: lpd };
  });
  return ok(res, { incomeForm: keysToCamel(mapped) });
});

router.get('/', (req, res) => {
  const { car_id, status } = req.query;
  let sql = `
    SELECT
      id AS rental_id, car_id, driver_id,
      date_start, date_end, rate_day, comment,
      promised_until, promised_at,
      bonus_days, bonus_reason, status
    FROM rentals WHERE 1=1`;
  const params = [];
  if (car_id) { sql += ' AND car_id = ?'; params.push(car_id); }
  if (status)  { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY rowid DESC';
  const rows = db.prepare(sql).all(...params);
  return ok(res, { rentals: keysToCamel(rows) });
});

router.post('/', (req, res) => {
  const { car_id, driver_id, date_start, date_end = '', rate_day, comment = '' } = req.body;
  if (!car_id || !driver_id || !date_start || rate_day === undefined)
    return fail(res, 'MISSING_FIELDS');
  const rental_id = getNextId('rentals', 'R');
  db.prepare(`INSERT INTO rentals (id,car_id,driver_id,date_start,date_end,rate_day,comment,status)
    VALUES (?,?,?,?,?,?,?,'active')`)
    .run(rental_id, car_id, driver_id, toIso(date_start), toIso(date_end) || null, Number(rate_day), comment);
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

router.patch('/by-car/:car_id/bonus', (req, res) => {
  const { car_id } = req.params;
  const { bonus_days, bonus_reason } = req.body || {};
  const days = Number(bonus_days);
  if (!Number.isInteger(days) || days <= 0) return fail(res, 'INVALID_BONUS_DAYS');
  const rental = db.prepare(`
    SELECT id, bonus_days FROM rentals
    WHERE car_id = ? AND status = 'active'
    ORDER BY rowid DESC LIMIT 1
  `).get(car_id);
  if (!rental) return fail(res, 'RENTAL_NOT_FOUND', 404);
  const newBonus = (Number(rental.bonus_days) || 0) + days;
  db.prepare('UPDATE rentals SET bonus_days = ?, bonus_reason = ? WHERE id = ?')
    .run(newBonus, String(bonus_reason || ''), rental.id);
  return ok(res, { id: rental.id, bonusDays: newBonus });
});

router.post('/income', (req, res) => {
  const { car_id, driver_id, amount, date_from, date_to, rate, kassa_id,
          comment = '', provel = 'Азамат', mileage } = req.body;
  if (!car_id || !driver_id || (!amount && amount !== 0) || !date_from || !date_to || !kassa_id)
    return fail(res, 'MISSING_FIELDS');

  const isoFrom = toIso(date_from);
  const isoTo   = toIso(date_to);

  const doTx = db.transaction(() => {
    // 1. Запись в кассу
    const op_id = getNextId('kassa_ops', 'CO');
    db.prepare(`INSERT INTO kassa_ops
      (id,date,kassa_id,direction,amount,type,category,car_id,driver_id,comment,author,class_calc,class_final)
      VALUES (?,?,?,'приход',?,'аренда','аренда',?,?,?,?,'revenue','revenue')`)
      .run(op_id, todayStr(), kassa_id, Number(amount), car_id, driver_id, comment, provel);

    // 2. Обновляем существующую активную аренду (TD-05: не плодим дубли)
    const existing = db.prepare(
      "SELECT id FROM rentals WHERE car_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT 1"
    ).get(car_id);

    let rental_id;
    if (existing) {
      // Продлеваем существующую аренду
      rental_id = existing.id;
      db.prepare(`UPDATE rentals SET date_end = ?, promised_until = NULL, promised_at = NULL WHERE id = ?`)
        .run(isoTo, rental_id);
    } else {
      // Активной аренды нет — создаём новую
      rental_id = getNextId('rentals', 'R');
      db.prepare(`INSERT INTO rentals (id,car_id,driver_id,date_start,date_end,rate_day,comment,status)
        VALUES (?,?,?,?,?,?,?,'active')`)
        .run(rental_id, car_id, driver_id, isoFrom, isoTo, Number(rate), comment);
    }

    // 3. Статус машины и пробег
    db.prepare("UPDATE cars SET status='в аренде' WHERE id=?").run(car_id);
    if (mileage && Number(mileage) > 0)
      db.prepare('UPDATE cars SET mileage=? WHERE id=?').run(Math.round(Number(mileage)), car_id);

    return { op_id, rental_id };
  });

  try { return ok(res, doTx()); }
  catch(e) { console.error('[ADD_INCOME]', e); return fail(res, e.message); }
});

export default router;
