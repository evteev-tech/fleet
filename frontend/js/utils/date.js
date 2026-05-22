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

  // UNFORMATTED_VALUE иногда приходит как строка-число (Excel serial).
  if (/^\d{5,}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + n * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const parts = s.split('.');
  if (parts.length === 3) {
    const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Иногда встречается DD/MM/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const d = new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Apps Script иногда сериализует даты как строку вида:
  // "Sat May 09 2026 00:00:00 GMT+0300 (Moscow Standard Time)".
  // Пытаемся распарсить через Date() как fallback.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;

  return null;
}

/**
 * Дата+время из ячейки (DD.MM.YYYY HH:mm или то, что понимает parseSheetDate).
 * @param {*} raw
 * @returns {Date|null}
 */
export function parseSheetDateTime(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4]),
      Number(m[5]),
    );
    return isNaN(d.getTime()) ? null : d;
  }
  return parseSheetDate(raw);
}

/** Обратная совместимость: DD.MM.YYYY и парсинг дат — см. `utils/format.js`. */
export { fmtDate as formatDate, parseDate } from './format.js';
