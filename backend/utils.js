import db from './db.js';
export function getNextId(table, col, prefix, digits = 3) {
  const rows = db.prepare(`SELECT ${col} FROM ${table} WHERE ${col} LIKE ?`).all(`${prefix}%`);
  let max = 0;
  for (const row of rows) {
    const num = parseInt(String(row[col]).replace(prefix, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `${prefix}${String(max + 1).padStart(digits, '0')}`;
}
export function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
}
export function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
export function nowStr() {
  const d = new Date();
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function calcClass(type, direction) {
  const t = String(type || '').toLowerCase().trim();
  const dir = String(direction || '').toLowerCase().trim();
  if (t === 'аренда') return 'revenue';
  if (t.startsWith('депозит')) return 'deposit';
  if (t === 'перевод_входящий' || t === 'перевод_исходящий') return 'transfer';
  if (dir === 'расход') return 'opex';
  return 'revenue';
}

/** snake_case → camelCase (e.g. rate_day → rateDay). Keys without underscores pass through. */
export function toCamelCase(str) {
  return String(str).replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

/** Deeply converts object keys from snake_case to camelCase. Arrays, null, and Date pass through. */
export function keysToCamel(obj) {
  if (obj == null || obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, val]) => [toCamelCase(key), keysToCamel(val)]),
    );
  }
  return obj;
}

export function ok(res, data) { return res.json({ status: 'ok', ...data }); }
export function fail(res, message, code = 400) { return res.status(code).json({ status: 'error', error: true, message }); }

/**
 * Записывает смену статуса машины в журнал car_status_log.
 * Вызывать ВНУТРИ той же транзакции, что меняет cars.status, чтобы запись
 * была атомарной. Пишет, только если статус реально отличается от последнего
 * в журнале на ту же дату (защита от дублей при повторных вызовах).
 *
 * @param {string} carId
 * @param {string} status        — 'в аренде' | 'в ремонте' | 'простой'
 * @param {string} [author]
 * @param {string} [statusFrom]   — ISO YYYY-MM-DD; по умолчанию сегодня
 */
export function logCarStatus(carId, status, author = '', statusFrom = null) {
  if (!carId || !status) return;
  const from = statusFrom || new Date().toISOString().slice(0, 10);
  // Не плодим запись, если последний зафиксированный статус уже такой же
  const last = db.prepare(
    `SELECT status FROM car_status_log
     WHERE car_id = ? ORDER BY date_from DESC, id DESC LIMIT 1`
  ).get(carId);
  if (last && last.status === status) return;
  db.prepare(
    `INSERT INTO car_status_log (car_id, status, date_from, author)
     VALUES (?, ?, ?, ?)`
  ).run(carId, status, from, author);
}
