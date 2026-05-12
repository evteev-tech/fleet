/**
 * utils/format.js — форматирование данных для UI
 */

/**
 * Форматирует число как рубли: "12 345 ₽"
 * @param {number|string} n
 * @returns {string}
 */
export function fmtRub(n) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0))} ₽`;
}

/**
 * Целое число с группировкой ru-RU без суффикса (например «1 234 ₽/день»).
 * @param {number|string} n
 * @returns {string}
 */
export function fmtRuInt(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
}

/**
 * Форматирует дату в DD.MM.YYYY
 * @param {Date} date
 * @returns {string}
 */
export function fmtDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * Парсит дату из DD.MM.YYYY или Excel serial number
 * @param {string|number} raw
 * @returns {Date|null}
 */
export function parseDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;

  // Если уже Date
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  // Excel serial number (5 цифр+)
  if (typeof raw === 'number' || /^\d{5,}(\.\d+)?$/.test(String(raw))) {
    const n = Number(raw);
    if (!isNaN(n)) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + n * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const str = String(raw).trim();
  if (!str) return null;

  // DD.MM.YYYY
  const dotParts = str.split('.');
  if (dotParts.length === 3) {
    const d = new Date(
      Number(dotParts[2]),
      Number(dotParts[1]) - 1,
      Number(dotParts[0]),
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const d = new Date(
      Number(slashMatch[3]),
      Number(slashMatch[2]) - 1,
      Number(slashMatch[1]),
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback — пробуем распарсить как есть
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Форматирует число сокращённо: 1500 → "1.5k"
 * @param {number} n
 * @returns {string}
 */
export function fmtShort(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toFixed(0);
}

/**
 * Краткий формат рублей для второстепенных подписей (например «312К ₽»).
 * @param {number|string} n
 * @returns {string}
 */
export function formatCompactRub(n) {
  const num = Math.round(Number(n) || 0);
  const abs = Math.abs(num);
  const sign = num < 0 ? '−' : '';
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    const s = v >= 10 ? v.toFixed(0) : v.toFixed(1).replace('.', ',');
    return `${sign}${s} млн ₽`;
  }
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}К ₽`;
  return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(abs)} ₽`;
}
