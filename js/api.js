/**
 * api.js — все обращения к Google Sheets API v4 и Apps Script webhook.
 *
 * Чтение:  GET  sheets.googleapis.com/v4/spreadsheets/{id}/values/{sheet}?key=…
 * Запись:  POST WEBHOOK_URL  (Apps Script doPost)
 */

import { SHEET_ID, API_KEY, WEBHOOK_URL, CACHE_TTL_MS, SHEETS, USE_MOCK } from './config.js';
import {
  CACHE_KEYS,
  clearAllCache,
  getWithSWR,
  invalidateCache as invalidateSwrCache,
} from './cache.js';
import { parseSheetDate, parseSheetDateTime, formatDate } from './utils/date.js';
import {
  getMockFleetNormalized,
  getMockDriversNormalized,
  getMockOperationsNormalized,
  getMockRentalsNormalized,
  mutateMockRentalPromise,
} from './mock/data.js';

export { clearAllCache, getWithSWR, CACHE_KEYS } from './cache.js';

/** Лист таблицы → логические SWR-ключи (см. cache.js / CACHE_KEYS). */
const SHEET_TO_CACHE_KEYS = {
  [SHEETS.CARS]: [CACHE_KEYS.CARS, CACHE_KEYS.INCOME_FORM],
  [SHEETS.DRIVERS]: [CACHE_KEYS.DRIVERS],
  [SHEETS.RENTALS]: [CACHE_KEYS.RENTALS, CACHE_KEYS.INCOME_FORM],
  [SHEETS.OPERATIONS]: [CACHE_KEYS.CASH_OPS, CACHE_KEYS.KASSAS, CACHE_KEYS.DASHBOARD],
  [SHEETS.KASSAS]: [CACHE_KEYS.KASSAS],
  [SHEETS.DEPOSITS]: [CACHE_KEYS.DRIVERS, CACHE_KEYS.DEPOSITS],
};

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
 * Удаляет запись листа из in-memory кэша readSheet и помечает SWR-ключи как stale.
 * @param {string} sheetName — имя листа (SHEETS.*)
 */
export function invalidateCache(sheetName) {
  _cache.delete(sheetName);
  const keys = SHEET_TO_CACHE_KEYS[sheetName];
  if (keys) keys.forEach(k => invalidateSwrCache(k));
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

/** Балансы из листа «Кассы»: число, форматированная строка или (отриц.) в скобках */
export function parseAmount(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  let t = String(val).trim().replace(/\u00a0/g, ' ');
  t = t.replace(/[₽]/g, '');
  const compact = t.replace(/\s/g, '');
  const parenNeg = /^\(.*\)$/.test(compact);
  const core = compact.replace(/[()]/g, '').replace(/,/g, '.');
  const n = parseFloat(parenNeg ? `-${core}` : core);
  return Number.isFinite(n) ? n : 0;
}

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
  if (USE_MOCK) return getMockOperationsNormalized({ kassaId, month, year });
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

/**
 * Лист «Кассы».
 * Колонки: A=kassa_id, B=название, C=баланс_текущий
 *
 * @returns {Promise<Array<{kassaId:string,name:string,balanceCurrent:number}>>}
 */
export async function getKassas() {
  const rows = await readSheet(SHEETS.KASSAS);
  return rows
    .map(row => ({
      kassaId:        cell(row, 0),           // A — касса_id
      name:           cell(row, 1),           // B — название
      owner:          cell(row, 2),           // C — владелец
      type:           cell(row, 3),           // D — тип
      balanceCurrent: parseAmount(row[4]),    // E — баланс_текущий  ← было row[2]
      note:           cell(row, 5),           // F — примечание
    }))
    .filter(k => k.kassaId);
}

// ═══════════════════════════════════════════════════════════════════════════
// МАШИНЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Машины с листа «Машины» через Apps Script GET_FLEET.
 * Колонки: A=car_id … J=ТО на пробеге (см. Code.gs handleGetFleet).
 *
 * @returns {Promise<Array<{carId,name,color,status,dateBuy,priceBuy,rateDay,note,mileage,toMileage}>>}
 */
export async function getFleet() {
  if (USE_MOCK) return getMockFleetNormalized();
  try {
    const body = await postAction('GET_FLEET', {});
    const rows = body.fleet ?? [];
    return rows.map(_normalizeFleetRow).filter(c => c.carId);
  } catch (err) {
    console.warn('[api] GET_FLEET failed, using Sheets API fallback:', err?.message ?? err);
    const rows = await readSheet(SHEETS.CARS);
    return rows
      .map(row => _normalizeFleetRow({
        carId: row[0],
        name: row[1],
        color: row[2],
        status: row[3],
        dateBuy: row[4],
        priceBuy: row[5],
        rateDay: row[6],
        note: row[7],
        mileage: row[8],
        toMileage: row[9],
      }))
      .filter(c => c.carId);
  }
}

function _normalizeFleetRow(r) {
  return {
    carId:     String(r.carId ?? '').trim(),
    name:      String(r.name ?? ''),
    color:     String(r.color ?? ''),
    status:    String(r.status ?? '').trim(),
    dateBuy:   parseSheetDate(r.dateBuy),
    priceBuy:  Number(r.priceBuy) || 0,
    rateDay:   Number(r.rateDay) || 0,
    note:      String(r.note ?? ''),
    mileage:   Math.round(Number(r.mileage ?? 0)) || 0,
    toMileage: Math.round(Number(r.toMileage ?? 0)) || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ВОДИТЕЛИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Водители + активная аренда (currentCar) через GET_DRIVERS; fallback — лист «Водители».
 *
 * @returns {Promise<Array<{driverId,name,phone,license,status,deposit,note,carId,currentCar}>>}
 */
export async function getDrivers() {
  if (USE_MOCK) return getMockDriversNormalized();
  try {
    const body = await postAction('GET_DRIVERS', {});
    const rows = body.drivers ?? [];
    return rows.map(_normalizeDriverRow).filter(d => d.driverId);
  } catch (err) {
    console.warn('[api] GET_DRIVERS failed, Sheets fallback:', err?.message ?? err);
    const rows = await readSheet(SHEETS.DRIVERS);
    return rows
      .map(row => _normalizeDriverRow({
        driverId: cell(row, 0),
        name: cell(row, 1),
        phone: cell(row, 2),
        license: cell(row, 3),
        status: cell(row, 4),
        deposit: parseFloat(cell(row, 5)) || 0,
        note: cell(row, 6),
        currentCar: null,
      }))
      .filter(d => d.driverId);
  }
}

function _normalizeDriverRow(r) {
  const cur =
    r.currentCar != null && String(r.currentCar).trim() !== ''
      ? String(r.currentCar).trim()
      : '';
  return {
    driverId: String(r.driverId ?? '').trim(),
    name: String(r.name ?? r.fio ?? ''),
    phone: String(r.phone ?? ''),
    license: String(r.license ?? r.vu ?? ''),
    status: String(r.status ?? '').trim(),
    deposit: Number(r.deposit) || 0,
    note: String(r.note ?? ''),
    currentCar: cur || null,
    carId: cur,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// АРЕНДА
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=rental_id, B=car_id, C=driver_id, D=дата_начала,
 *          E=дата_окончания, F=ставка_день, G=примечание,
 *          H=promised_until, I=promised_at (опционально, в конце листа)
 *
 * Даты могут храниться как Excel-число или DD.MM.YYYY — парсим оба варианта.
 *
 * @returns {Promise<Array<{rentalId,carId,driverId,dateStart,dateEnd,rateDay,note,promisedUntil,promisedAt}>>}
 */
export async function getRentals() {
  if (USE_MOCK) return getMockRentalsNormalized();

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
      promisedUntil:
        _parseFlexDate(cell(row, 7)) ?? parseSheetDate(cell(row, 7)) ?? null,
      promisedAt:
        parseSheetDateTime(cell(row, 8)) ?? parseSheetDate(cell(row, 8)) ?? null,
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
  const payloadData =
    action === 'ADD_INCOME'
      ? { ...data, client_op_date: formatDate(new Date()) }
      : data;
  const payload = JSON.stringify({ action, ...payloadData });

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

export async function updateOperation(payload) {
  return postAction('UPDATE_OPERATION', payload);
}

/** Данные листа «Дашборд» для экрана «Аналитика» (Apps Script GET_DASHBOARD). */
export async function fetchDashboardAnalytics() {
  const body = await postAction('GET_DASHBOARD', {});
  const dash = body?.dashboard;
  if (!dash || typeof dash !== 'object') {
    console.warn('[api] GET_DASHBOARD: expected body.dashboard object, got:', body);
    return null;
  }
  return dash;
}

/**
 * Период аналитики: месяц (B2:B3) или «всё время» (маркер E99 на листе «Дашборд», см. Apps Script).
 * @param {number|null} year
 * @param {number|null} month
 * @param {{ allTime?: boolean }} [options]
 */
export async function updateAnalyticsPeriod(year, month, options = {}) {
  if (options.allTime) {
    await postAction('UPDATE_PERIOD', { allTime: true });
    return;
  }
  await postAction('UPDATE_PERIOD', { year, month });
}

/**
 * MAX(дата_окончания) по листу «Аренда» для машин «в аренде» (Apps Script GET_INCOME_FORM).
 * @returns {Promise<Array<{ carId: string, lastPaidDate: string }>>}
 */
export async function fetchIncomeForm() {
  const body = await postAction('GET_INCOME_FORM', {});
  const rows = body.incomeForm;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Приход аренды: касса + строка аренды (ADD_INCOME).
 * @param {object} payload
 */
export async function postAddIncome(payload) {
  return postAction('ADD_INCOME', payload);
}

/**
 * Запись «обещал заплатить» в последнюю строку аренды по car_id (лист «Аренда», колонки H–I).
 * @param {string} carId
 * @param {Date|null} promisedUntil  null — очистить поля
 */
export async function saveRentalPromise(carId, promisedUntil) {
  const cid = String(carId || '').trim();
  if (!cid) throw new Error('MISSING: car_id');

  if (USE_MOCK) {
    mutateMockRentalPromise(
      cid,
      promisedUntil == null ? null : promisedUntil,
      promisedUntil == null ? null : new Date(),
    );
    invalidateSwrCache(CACHE_KEYS.RENTALS);
    return { status: 'ok' };
  }

  return postAction('SAVE_RENTAL_PROMISE', {
    car_id: cid,
    promised_until:
      promisedUntil != null && promisedUntil instanceof Date && !Number.isNaN(promisedUntil.getTime())
        ? formatDate(promisedUntil)
        : '',
  });
}

// ─── Какие листы сбрасываем после каждого action ─────────────────────────────
const ACTION_INVALIDATES = {
  ADD_OPERATION:    [SHEETS.OPERATIONS],
  UPDATE_OPERATION: [SHEETS.OPERATIONS],
  UPDATE_CAR_MILEAGE:[SHEETS.CARS],
  UPDATE_CAR_STATUS:[SHEETS.CARS, SHEETS.DRIVERS],
  SAVE_DRIVER:      [SHEETS.DRIVERS, SHEETS.CARS],
  ADD_DEPOSIT:      [SHEETS.DEPOSITS, SHEETS.DRIVERS],
  ADD_RENTAL:       [SHEETS.RENTALS, SHEETS.CARS, SHEETS.DRIVERS],
  ADD_INCOME:       [SHEETS.OPERATIONS, SHEETS.RENTALS, SHEETS.CARS],
  SAVE_RENTAL_PROMISE: [SHEETS.RENTALS],
};

function _invalidateByAction(action) {
  const sheets = ACTION_INVALIDATES[action] ?? [];
  sheets.forEach(s => invalidateCache(s));
  if (action === 'UPDATE_PERIOD') {
    invalidateSwrCache(CACHE_KEYS.DASHBOARD);
  }
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


