/**
 * api.js — все обращения к Google Sheets API v4 и Apps Script webhook.
 *
 * Чтение:  GET  sheets.googleapis.com/v4/spreadsheets/{id}/values/{sheet}?key=…
 * Запись:  POST WEBHOOK_URL  (Apps Script doPost)
 */

import { SHEET_ID, API_KEY, WEBHOOK_URL, CACHE_TTL_MS, SHEETS } from './config.js';

// ═══════════════════════════════════════════════════════════════════════════
// КЭШ
// ═══════════════════════════════════════════════════════════════════════════

/** @type {Map<string, { data: string[][], ts: number }>} */
const _cache = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// СТАТУС ПОСЛЕДНЕГО ЗАПРОСА (для экрана настроек)
// ═══════════════════════════════════════════════════════════════════════════

/** @type {'ok'|'error'|null} */
let _lastApiStatus = null;

/**
 * Возвращает статус последнего обращения к Sheets API.
 * 'ok' — запрос прошёл, 'error' — была ошибка, null — ещё не было запросов.
 * @returns {'ok'|'error'|null}
 */
export function getApiStatus() {
  return _lastApiStatus;
}

/**
 * Удаляет запись листа из кэша.
 * Следующий вызов readSheet сделает свежий запрос к API.
 * @param {string} sheetName
 */
export function invalidateCache(sheetName) {
  _cache.delete(sheetName);
}

// ═══════════════════════════════════════════════════════════════════════════
// НИЗКОУРОВНЕВОЕ ЧТЕНИЕ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Читает все строки листа через Sheets API v4.
 * Первая строка (заголовки) пропускается.
 * Результат кэшируется на CACHE_TTL_MS мс.
 *
 * @param {string} sheetName
 * @returns {Promise<string[][]>}  массив строк без строки заголовков
 */
async function readSheet(sheetName) {
  const cached = _cache.get(sheetName);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/` +
    `${encodeURIComponent(sheetName)}?key=${API_KEY}` +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    _lastApiStatus = 'error';
    throw new Error('NO_CONNECTION');
  }

  if (!res.ok) {
    _lastApiStatus = 'error';
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }

  const json = await res.json();
  // values[0] — заголовки, пропускаем
  const rows = (json.values ?? []).slice(1);

  _lastApiStatus = 'ok';
  _cache.set(sheetName, { data: rows, ts: Date.now() });
  return rows;
}

// ─── Геттер ячейки ────────────────────────────────────────────────────────────
const cell = (row, idx, fallback = '') =>
  row[idx] !== undefined && row[idx] !== null
    ? String(row[idx]).trim()
    : fallback;

// ─── Парсинг даты: DD.MM.YYYY или Excel serial (UNFORMATTED_VALUE из Sheets) ─
function parseDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = typeof raw === 'number' ? raw : String(raw).trim();
  if (str === '') return null;
  if (!isNaN(str)) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + Number(str) * 86400000);
  }
  const parts = String(str).split('.');
  if (parts.length === 3) {
    return new Date(
      Number(parts[2]),
      Number(parts[1]) - 1,
      Number(parts[0]),
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОЛЬЗОВАТЕЛИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Возвращает список пользователей из листа «Пользователи».
 * Колонки: A=email, B=имя, C=роль, D=статус, E=примечание, F=pin
 * PIN приводится: String(Math.round(Number(rawPin)))
 *
 * @returns {Promise<Array<{email,name,role,status,note,pin}>>}
 */
export async function getUsers() {
  const rows = await readSheet(SHEETS.USERS);
  return rows
    .map(row => ({
      email:  cell(row, 0),
      name:   cell(row, 1),
      role:   cell(row, 2),
      status: cell(row, 3),
      note:   cell(row, 4),
      pin:    String(Math.round(Number(cell(row, 5)))) || '',
    }))
    .filter(u => u.email);
}

// ═══════════════════════════════════════════════════════════════════════════
// ОПЕРАЦИИ КАССЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=op_id, B=дата, C=касса_id, D=направление, E=сумма,
 *          F=тип, G=категория, H=car_id, I=driver_id,
 *          J=комментарий, K=провёл, L=класс_override, M=класс_итог
 *
 * @param {{ kassaId?: string|null, month?: number|null, year?: number|null }} opts
 * @returns {Promise<Array>}
 */
export async function getOperations({ kassaId = null, month = null, year = null } = {}) {
  const rows = await readSheet(SHEETS.OPERATIONS);

  return rows
    .map(row => ({
      opId:          cell(row, 0),
      date:          parseDate(cell(row, 1)),
      dateRaw:       cell(row, 1),
      kassaId:       cell(row, 2),
      direction:     cell(row, 3),
      amount:        parseFloat(cell(row, 4)) || 0,
      type:          cell(row, 5),
      category:      cell(row, 6),
      carId:         cell(row, 7),
      driverId:      cell(row, 8),
      comment:       cell(row, 9),
      provel:        cell(row, 10),
      classOverride: cell(row, 11),
      classItog:     cell(row, 12),
    }))
    .filter(op => op.opId)
    .filter(op => !kassaId || op.kassaId === kassaId)
    .filter(op => {
      if (!month || !year || !op.date) return true;
      return op.date.getMonth() + 1 === month && op.date.getFullYear() === year;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// МАШИНЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=car_id, B=название, C=цвет, D=статус,
 *          E=дата_покупки, F=цена_покупки, G=ставка_день,
 *          H=примечание, I=Текущий пробег, J=ТО на пробеге
 *
 * @returns {Promise<Array<{carId,name,color,status,rateDay,mileage,toMileage,note}>>}
 */
export async function getFleet() {
  const rows = await readSheet(SHEETS.CARS);
  return rows
    .map(row => ({
      carId:      cell(row, 0),
      name:       cell(row, 1),
      color:      cell(row, 2),
      status:     cell(row, 3),
      dateBuy:    parseDate(cell(row, 4)),
      priceBuy:   parseFloat(cell(row, 5)) || 0,
      rateDay:    parseFloat(cell(row, 6)) || 0,
      note:       cell(row, 7),
      mileage:    parseInt(cell(row, 8)) || 0,
      toMileage:  parseInt(cell(row, 9)) || 0,
    }))
    .filter(c => c.carId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ВОДИТЕЛИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=driver_id, B=ФИО, C=телефон, D=ВУ,
 *          E=статус, F=депозит_текущий, G=примечание
 *
 * @returns {Promise<Array<{driverId,fio,phone,vu,status,deposit,note}>>}
 */
export async function getDrivers() {
  const rows = await readSheet(SHEETS.DRIVERS);
  return rows
    .map(row => ({
      driverId: cell(row, 0),
      fio:      cell(row, 1),
      phone:    cell(row, 2),
      vu:       cell(row, 3),
      status:   cell(row, 4),
      deposit:  parseFloat(cell(row, 5)) || 0,
      note:     cell(row, 6),
    }))
    .filter(d => d.driverId);
}

// ═══════════════════════════════════════════════════════════════════════════
// АРЕНДА
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=rental_id, B=car_id, C=driver_id, D=дата_начала,
 *          E=дата_окончания, F=ставка_день, G=примечание
 *
 * Даты могут храниться как Excel-число или DD.MM.YYYY — парсим оба варианта.
 *
 * @returns {Promise<Array<{rentalId,carId,driverId,dateStart,dateEnd,rateDay,note}>>}
 */
export async function getRentals() {
  const rows = await readSheet(SHEETS.RENTALS);
  return rows
    .map(row => ({
      rentalId:  cell(row, 0),
      carId:     cell(row, 1),
      driverId:  cell(row, 2),
      dateStart: _parseFlexDate(cell(row, 3)),
      dateEnd:   _parseFlexDate(cell(row, 4)),
      rateDay:   parseFloat(cell(row, 5)) || 0,
      note:      cell(row, 6),
    }))
    .filter(r => r.rentalId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ДЕПОЗИТЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=dep_op_id, B=дата, C=driver_id, D=car_id,
 *          E=сумма, F=статус_исходный, G=комментарий
 *
 * @returns {Promise<Array<{depOpId,date,driverId,carId,amount,status,comment}>>}
 */
export async function getDeposits() {
  const rows = await readSheet(SHEETS.DEPOSITS);
  return rows
    .map(row => ({
      depOpId:  cell(row, 0),
      date:     parseDate(cell(row, 1)),
      dateRaw:  cell(row, 1),
      driverId: cell(row, 2),
      carId:    cell(row, 3),
      amount:   parseFloat(cell(row, 4)) || 0,
      status:   cell(row, 5),
      comment:  cell(row, 6),
    }))
    .filter(d => d.depOpId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ЗАПИСЬ — postAction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Отправляет action в Apps Script webhook и возвращает тело ответа.
 * После успешного ответа инвалидирует кэш затронутых листов.
 *
 * @param {string} action  — например ADD_OPERATION, GET_DASHBOARD, UPDATE_PERIOD
 * @param {object} data    — поля для action
 * @returns {Promise<object>}
 */
export async function postAction(action, data) {
  const webhookUrl = localStorage.getItem('matizi_webhook') || WEBHOOK_URL;
  const payload    = JSON.stringify({ action, ...data });

  // URLSearchParams → Content-Type: application/x-www-form-urlencoded
  // браузер не шлёт preflight, Apps Script читает через e.parameter.data
  const formData = new URLSearchParams();
  formData.append('data', payload);

  let res;
  try {
    res = await fetch(webhookUrl, { method: 'POST', body: formData });
  } catch {
    throw new Error('NO_CONNECTION');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: ответ не является JSON`);
  }

  if (body?.status === 'error' || body?.error === true) {
    throw new Error(body.message ?? 'UNKNOWN_ERROR');
  }

  // Инвалидируем кэш листов, которые могли измениться
  _invalidateByAction(action);

  return body;
}

/** Данные листа «Дашборд» для экрана «Аналитика» (Apps Script GET_DASHBOARD). */
export async function fetchDashboardAnalytics() {
  const body = await postAction('GET_DASHBOARD', {});
  return body.dashboard ?? null;
}

/** Записывает год и месяц в B2:B3 листа «Дашборд». */
export async function updateAnalyticsPeriod(year, month) {
  await postAction('UPDATE_PERIOD', { year, month });
}

// ─── Какие листы сбрасываем после каждого action ─────────────────────────────
const ACTION_INVALIDATES = {
  ADD_OPERATION:    [SHEETS.OPERATIONS],
  UPDATE_CAR_STATUS:[SHEETS.CARS],
  SAVE_DRIVER:      [SHEETS.DRIVERS, SHEETS.CARS],
  ADD_DEPOSIT:      [SHEETS.DEPOSITS, SHEETS.DRIVERS],
  ADD_RENTAL:       [SHEETS.RENTALS, SHEETS.CARS],
};

function _invalidateByAction(action) {
  const sheets = ACTION_INVALIDATES[action] ?? [];
  sheets.forEach(s => invalidateCache(s));
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Парсит дату, которая может быть:
 *   — строкой DD.MM.YYYY
 *   — Excel-числом (дней с 30.12.1899)
 * @param {string} raw
 * @returns {Date|null}
 */
function _parseFlexDate(raw) {
  if (!raw) return null;
  // DD.MM.YYYY
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw)) return parseDate(raw);
  // Excel serial number
  const num = Number(raw);
  if (!isNaN(num) && num > 1000) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + num * 86400000);
  }
  return null;
}


