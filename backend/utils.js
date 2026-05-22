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
export function ok(res, data) { return res.json({ status: 'ok', ...data }); }
export function fail(res, message, code = 400) { return res.status(code).json({ status: 'error', error: true, message }); }
