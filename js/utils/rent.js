/**
 * Логика «оплачен до»: дата_платежа + floor(сумма / ставка_день).
 * Ставку брать из листа «Аренда» (поле ставка день — число или строка вида «850 ₽»).
 */

/**
 * @param {*} raw
 * @returns {number}
 */
export function parseRatePerDay(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return Math.max(0, raw);
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * @param {Date} paymentDate
 * @param {number} amount
 * @param {number} ratePerDay
 * @returns {Date}
 */
export function calcPaidUntil(paymentDate, amount, ratePerDay) {
  const src = paymentDate instanceof Date ? new Date(paymentDate) : new Date(paymentDate);
  if (Number.isNaN(src.getTime())) return src;
  src.setHours(0, 0, 0, 0);

  const rate = Number(ratePerDay);
  if (!rate || rate <= 0 || !Number.isFinite(rate)) {
    return new Date(src.getTime());
  }

  const amt = Math.round(Number(amount)) || 0;
  const days = Math.floor(amt / rate);
  const out = new Date(src.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Последняя строка аренды по машине: макс. дата окончания (E); при равенстве — больший суффикс rental_id.
 * @param {Array<{rentalId?: string, carId?: string, dateEnd?: Date|null}>} rows
 * @returns {Map<string, object>}
 */
export function latestRentalByCarMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const cid = String(r.carId || '').trim();
    if (!cid) continue;
    const prev = map.get(cid);
    const ts =
      r.dateEnd instanceof Date && !Number.isNaN(r.dateEnd.getTime())
        ? r.dateEnd.getTime()
        : -1;
    const prevTs =
      prev?.dateEnd instanceof Date && !Number.isNaN(prev.dateEnd.getTime())
        ? prev.dateEnd.getTime()
        : -2;
    const n = _rentalIdTailNum(r.rentalId);
    const prevN = _rentalIdTailNum(prev?.rentalId ?? '');
    if (!prev || ts > prevTs || (ts === prevTs && n > prevN)) {
      map.set(cid, r);
    }
  }
  return map;
}

function _rentalIdTailNum(id) {
  const m = String(id || '').match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
