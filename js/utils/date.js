/**
 * Date → строка DD.MM.YYYY (отправка в webhook / согласование с Apps Script).
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return d + '.' + m + '.' + y;
}

/**
 * Даты из Google Sheets: DD.MM.YYYY, Excel-serial, ISO-строка после JSON.
 * @param {*} raw
 * @returns {Date|null}
 */
export function parseSheetDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  if (typeof raw === 'number' && !isNaN(raw)) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + raw * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const parts = s.split('.');
  if (parts.length === 3) {
    const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}
