import db from './db.js';

// ISO YYYY-MM-DD «сегодня» (локальная дата сервера)
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Пишет смену статуса машины в car_status_log.
 * Вызывать ВНУТРИ существующей транзакции (своей не открывает).
 * @param {string} carId
 * @param {'в аренде'|'в ремонте'|'простой'} status
 * @param {{ dateFrom?: string, author?: string }} [opts]
 */
export function logCarStatus(carId, status, opts = {}) {
  if (!carId || !status) return;
  const dateFrom = opts.dateFrom ? String(opts.dateFrom) : todayIso();
  const author = opts.author || '';
  db.prepare(
    `INSERT INTO car_status_log (car_id, status, date_from, author) VALUES (?, ?, ?, ?)`
  ).run(carId, status, dateFrom, author);
}
