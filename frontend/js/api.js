/**
 * api.js — все обращения к Google Sheets API v4 и Apps Script webhook.
 *
 * Чтение:  GET  sheets.googleapis.com/v4/spreadsheets/{id}/values/{sheet}?key=…
 * Запись:  POST WEBHOOK_URL  (Apps Script doPost)
 */

import { SHEET_ID, API_KEY, WEBHOOK_URL, SECRET_TOKEN, CACHE_TTL_MS, SHEETS, USE_MOCK } from './config.js';
import * as CONFIG from './config.js';
import * as AuthModule from './auth.js';

if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.Auth = AuthModule;
}
import {
  CACHE_KEYS,
  clearAllCache,
  getWithSWR,
  invalidateCache as invalidateSwrCache,
} from './cache.js';
import { fmtDate } from './utils/format.js';
import {
  getMockFleetNormalized,
  getMockDriversNormalized,
  getMockOperationsNormalized,
  getMockRentalsNormalized,
  mutateMockRentalPromise,
  mutateMockRentalBonus,
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

// ═══════════════════════════════════════════════════════════════════════════
// REST API (новый бэкенд)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Обёртка над fetch для REST API с Bearer JWT.
 * @param {string} endpoint — путь относительно API_BASE, напр. `/fleet`
 * @param {RequestInit} [options]
 * @returns {Promise<object>}
 */
async function apiRequest(endpoint, options = {}) {
  const { body, headers: extraHeaders, ...rest } = options;
  const headers = { ...(extraHeaders || {}) };

  const token = window.Auth?.getToken?.();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${window.CONFIG.API_BASE}${endpoint}`, {
      ...rest,
      headers,
      body: payload,
    });
  } catch {
    _lastApiStatus = 'error';
    throw new Error('NO_CONNECTION');
  }

  if (res.status === 401) {
    _lastApiStatus = 'error';
    window.Auth?.clearToken?.();
    throw new Error('UNAUTHORIZED');
  }

  let json;
  try {
    json = await res.json();
  } catch {
    _lastApiStatus = 'error';
    throw new Error(`HTTP ${res.status}: ответ не является JSON`);
  }

  if (!res.ok || json?.status === 'error') {
    _lastApiStatus = 'error';
    throw new Error(json?.message ?? `HTTP ${res.status}`);
  }

  _lastApiStatus = 'ok';
  return json;
}

/** Парсит дату из REST API в local Date (без UTC-сдвига). */
const parseApiDate = (dateStr) => {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).split(' ')[0]; // remove time if present
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [year, month, day] = str.split('-');
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  // DD.MM.YYYY
  if (/^\d{2}\.\d{2}\.\d{4}/.test(str)) {
    const [day, month, year] = str.split('.');
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  return new Date(dateStr);
};

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
export async function getOperations(kassaId = null) {
  if (USE_MOCK) return getMockOperationsNormalized({ kassaId, month: null, year: null });
  let url = '/operations';
  if (kassaId) url += `?kassa_id=${kassaId}`;
  const data = await apiRequest(url);
  if (!data || !data.operations) return [];

  return data.operations.map(op => ({
    ...op,
    id: op.opId || op.id,
    date: parseApiDate(op.date || op.dateRaw),
    author: op.provel || op.author,
    amount: Number(op.amount) || 0,
    // UI compatibility aliases (old screen filters expect snake_case)
    kassa_id: op.kassaId || op.kassa_id,
    car_id: op.carId || op.car_id,
    driver_id: op.driverId || op.driver_id,
    class_itog: op.classItog || op.class_itog,
    class_override: op.classOverride || op.class_override,
  }));
}

/**
 * Кассы через REST GET /api/kassas.
 *
 * @returns {Promise<Array<{kassaId:string,name:string,balanceCurrent:number}>>}
 */
export async function getKassas() {
  const data = await apiRequest('/kassas');
  return data.kassas;
}

// ═══════════════════════════════════════════════════════════════════════════
// МАШИНЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Список машин через REST GET /api/fleet.
 *
 * @returns {Promise<Array<{carId,name,color,status,dateBuy,priceBuy,rateDay,note,mileage,toMileage}>>}
 */
export async function getFleet() {
  if (USE_MOCK) return getMockFleetNormalized();
  const data = await apiRequest('/fleet');
  return data.fleet;
}

// ═══════════════════════════════════════════════════════════════════════════
// ВОДИТЕЛИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Водители + активная аренда (currentCar) через REST GET /api/drivers.
 *
 * @returns {Promise<Array<{driverId,name,phone,license,status,deposit,note,carId,currentCar}>>}
 */
export async function getDrivers() {
  if (USE_MOCK) return getMockDriversNormalized();
  const data = await apiRequest('/drivers');
  return data.drivers;
}

// ═══════════════════════════════════════════════════════════════════════════
// АРЕНДА
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Колонки: A=rental_id, B=car_id, C=driver_id, D=дата_начала,
 *          E=дата_окончания, F=ставка_день, G=примечание,
 *          H=promised_until, I=promised_at,
 *          J=bonus_days, K=bonus_reason (опционально, в конце листа)
 *
 * Даты могут храниться как Excel-число или DD.MM.YYYY — парсим оба варианта.
 *
 * @returns {Promise<Array<{rentalId,carId,driverId,dateStart,dateEnd,rateDay,note,promisedUntil,promisedAt,bonusDays,bonusReason}>>}
 */
export async function getRentals(status = null) {
  if (USE_MOCK) return getMockRentalsNormalized();
  let url = '/rentals';
  if (status) url += `?status=${status}`;
  const data = await apiRequest(url);
  if (!data || !data.rentals) return [];

  return data.rentals.map(r => ({
    ...r,
    dateStart: parseApiDate(r.dateStart),
    dateEnd: parseApiDate(r.dateEnd),
    promisedUntil: r.promisedUntil ? parseApiDate(r.promisedUntil) : null,
  }));
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
export async function getDeposits(driverId = null) {
  let url = '/deposits';
  if (driverId) url += `?driver_id=${driverId}`;
  const data = await apiRequest(url);
  if (!data || !data.deposits) return [];

  return data.deposits.map(d => ({
    ...d,
    date: parseApiDate(d.date),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// ЗАПИСЬ — postAction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Отправляет action в Apps Script webhook и возвращает тело ответа.
 * После успешного ответа инвалидирует кэш затронутых листов.
 *
 * @param {string|{action:string}} action  — например ADD_OPERATION, GET_DASHBOARD, UPDATE_PERIOD
 * @param {object} data    — поля для action
 * @returns {Promise<object>}
 */
export async function postAction(action, data) {
  const webhookUrl = localStorage.getItem('matizi_webhook') || WEBHOOK_URL;
  const act = typeof action === 'object' && action ? action.action : action;
  const incomingData = typeof action === 'object' && action ? { ...(action || {}) } : data;
  if (typeof incomingData === 'object' && incomingData) delete incomingData.action;
  const payloadData =
    act === 'ADD_INCOME'
      ? { ...incomingData, client_op_date: fmtDate(new Date()) }
      : incomingData;
  const payload = JSON.stringify({ action: act, token: SECRET_TOKEN, ...payloadData });

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
  _invalidateByAction(act);

  return body;
}

export async function updateOperation(payload) {
  return postAction('UPDATE_OPERATION', payload);
}

/**
 * Изменение ставки аренды (₽/день) у машины. Пишет rateDay в лист «Машины»
 * и дописывает след в note. Текущая аренда не трогается.
 *
 * @param {object} payload
 * @param {string} payload.car_id
 * @param {number} payload.new_rate
 * @param {number} [payload.old_rate]
 * @param {string} [payload.reason]
 * @param {string} [payload.by]
 * @returns {Promise<object>}
 */
export async function updateCarRate(payload) {
  return postAction('UPDATE_CAR_RATE', payload);
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

/** Упущенная выручка за активный период дашборда (Apps Script GET_LOST_REVENUE). */
export async function fetchLostRevenue() {
  const body = await postAction('GET_LOST_REVENUE', {});
  return body?.lostRevenue ?? null;
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
        ? fmtDate(promisedUntil)
        : '',
  });
}

/**
 * Бонусные дни за простой — прибавляет к bonus_days последней строки аренды (лист «Аренда», J–K).
 * @param {string} carId
 * @param {number} bonusDays  положительное целое
 * @param {string} reason
 */
export async function saveBonusDays(carId, bonusDays, reason) {
  const cid = String(carId || '').trim();
  if (!cid) throw new Error('MISSING: car_id');
  const days = Number(bonusDays);
  if (!Number.isInteger(days) || days <= 0) throw new Error('INVALID_BONUS_DAYS');

  if (USE_MOCK) {
    mutateMockRentalBonus(cid, days, reason);
    invalidateSwrCache(CACHE_KEYS.RENTALS);
    return { status: 'ok' };
  }

  return postAction('SAVE_BONUS_DAYS', {
    car_id: cid,
    bonus_days: days,
    bonus_reason: String(reason || ''),
  });
}

// ─── Какие листы сбрасываем после каждого action ─────────────────────────────
const ACTION_INVALIDATES = {
  ADD_OPERATION:    [SHEETS.OPERATIONS],
  UPDATE_OPERATION: [SHEETS.OPERATIONS],
  UPDATE_CAR_MILEAGE:[SHEETS.CARS],
  UPDATE_CAR_STATUS:[SHEETS.CARS, SHEETS.DRIVERS],
  UPDATE_CAR_RATE:  [SHEETS.CARS],
  SAVE_DRIVER:      [SHEETS.DRIVERS, SHEETS.CARS],
  ADD_DEPOSIT:      [SHEETS.DEPOSITS, SHEETS.DRIVERS],
  ADD_RENTAL:       [SHEETS.RENTALS, SHEETS.CARS, SHEETS.DRIVERS],
  ADD_INCOME:       [SHEETS.OPERATIONS, SHEETS.RENTALS, SHEETS.CARS],
  SAVE_RENTAL_PROMISE: [SHEETS.RENTALS],
  SAVE_BONUS_DAYS: [SHEETS.RENTALS],
};

function _invalidateByAction(action) {
  const sheets = ACTION_INVALIDATES[action] ?? [];
  sheets.forEach(s => invalidateCache(s));
  if (action === 'UPDATE_PERIOD') {
    invalidateSwrCache(CACHE_KEYS.DASHBOARD);
  }
}
