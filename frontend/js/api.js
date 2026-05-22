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

/** Форматирует дату из REST/SQLite в строку DD.MM.YYYY для parseRuDate на экранах. */
const formatToRuDate = (dateStr) => {
  if (!dateStr) return '';
  const str = String(dateStr).split(' ')[0]; // remove time if present
  // If it is YYYY-MM-DD from SQLite
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}.${m}.${y}`;
  }
  return str; // Return as-is if already DD.MM.YYYY
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
    date: formatToRuDate(op.date),
    dateRaw: formatToRuDate(op.dateRaw || op.date),
    author: op.provel || op.author,
    amount: Number(op.amount) || 0,
    // Compatibility aliases for old screen filters
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
    dateStart: formatToRuDate(r.dateStart),
    dateEnd: formatToRuDate(r.dateEnd),
    promisedUntil: r.promisedUntil ? formatToRuDate(r.promisedUntil) : null,
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
    date: formatToRuDate(d.date),
    dateRaw: formatToRuDate(d.dateRaw || d.date),
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
  const act = typeof action === 'object' && action ? action.action : action;
  const d   = typeof action === 'object' && action ? { ...action } : { ...(data || {}) };
  if (d.action) delete d.action;

  // ── Роутер: action → REST-эндпоинт ───────────────────────────────────────
  let method = 'POST';
  let endpoint;
  let body = d;

  switch (act) {
    // Операции кассы
    case 'ADD_OPERATION':
      endpoint = '/operations';
      body = { ...d, author: d.author || d.provel || '' };
      break;
    case 'UPDATE_OPERATION':
      endpoint = `/operations/${d.op_id || d.id}`;
      method = 'PATCH';
      break;
    case 'DELETE_OPERATION':
      endpoint = `/operations/${d.op_id || d.id}`;
      method = 'DELETE';
      body = null;
      break;

    // Аренда
    case 'ADD_RENTAL':
      endpoint = '/rentals';
      break;
    case 'SAVE_RENTAL_PROMISE':
      endpoint = `/rentals/by-car/${d.car_id}/promise`;
      method = 'PATCH';
      body = { promised_until: d.promised_until ?? '' };
      break;
    case 'SAVE_BONUS_DAYS':
      endpoint = `/rentals/by-car/${d.car_id}/bonus`;
      method = 'PATCH';
      body = { bonus_days: d.bonus_days, bonus_reason: d.bonus_reason ?? '' };
      break;

    // Парк — статус и пробег
    case 'UPDATE_CAR_STATUS': {
      const cid = d.car_id || d.carId;
      endpoint = `/fleet/${encodeURIComponent(cid)}/status`;
      method = 'PATCH';
      body = { status: d.new_status || d.status };
      break;
    }
    case 'UPDATE_CAR_MILEAGE': {
      const cid = d.car_id || d.carId;
      endpoint = `/fleet/${encodeURIComponent(cid)}/mileage`;
      method = 'PATCH';
      body = { mileage: d.mileage, mileage_to: d.next_to_mileage ?? d.mileage_to };
      break;
    }
    case 'UPDATE_CAR_RATE': {
      const cid = d.car_id || d.carId;
      endpoint = `/fleet/${encodeURIComponent(cid)}/rate`;
      method = 'PATCH';
      body = { rate_day: d.new_rate, note: d.reason ?? '' };
      break;
    }

    // Водители и депозиты
    case 'SAVE_DRIVER':
      endpoint = '/drivers';
      body = {
        id:       d.driver_id || d.id || '',
        name:     d.name || d.fio || '',
        phone:    d.phone || '',
        passport: d.passport || d.vu || d.license || '',
        note:     d.note || d.comment || '',
      };
      break;
    case 'ADD_DEPOSIT':
      endpoint = '/deposits';
      body = {
        driver_id: d.driver_id,
        car_id:    d.car_id || '',
        amount:    d.amount,
        comment:   d.comment || '',
        status:    d.status,
      };
      break;

    // Google Drive — файлы (нет на новом бэкенде, тихо возвращаем заглушку)
    case 'LIST_CAR_FILES':
      return { status: 'ok', files: [] };
    case 'GET_CAR_FILE':
    case 'UPLOAD_CAR_FILE':
    case 'DELETE_CAR_FILE':
    case 'RENAME_CAR_FILE':
      return { status: 'ok' };

    // Аналитика (считается на клиенте)
    case 'GET_DASHBOARD':
    case 'GET_LOST_REVENUE':
    case 'UPDATE_PERIOD':
    case 'GET_INCOME_FORM':
      return { status: 'ok' };

    default:
      console.warn('[postAction] неизвестный action, пропускаем:', act);
      return { status: 'ok' };
  }

  const result = await apiRequest(endpoint, method === 'GET'
    ? undefined
    : { method, ...(body !== null ? { body } : {}) }
  );

  // Инвалидируем SWR-кэш
  _invalidateByAction(act);

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// ЗАПИСЬ — REST API
// ═══════════════════════════════════════════════════════════════════════════

/** camelCase → snake_case для полей тела запроса. */
function _toSnakeBody(payload, fieldMap = {}) {
  const out = {};
  for (const [key, val] of Object.entries(payload || {})) {
    if (val === undefined) continue;
    const mapped = fieldMap[key] ?? key.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`);
    out[mapped] = val;
  }
  return out;
}

export async function updateOperation(payload) {
  const p = payload || {};
  const id = p.op_id ?? p.opId ?? p.id;
  if (!id) throw new Error('MISSING: op_id');

  const fieldMap = {
    carId: 'car_id',
    driverId: 'driver_id',
    classOverride: 'class_override',
    classItog: 'class_final',
    kassaId: 'kassa_id',
    provel: 'author',
  };
  const body = _toSnakeBody(p, fieldMap);
  delete body.op_id;
  delete body.opId;
  delete body.id;

  const result = await apiRequest(`/operations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
  invalidateSwrCache(CACHE_KEYS.CASH_OPS);
  invalidateSwrCache(CACHE_KEYS.KASSAS);
  invalidateSwrCache(CACHE_KEYS.DASHBOARD);
  return result;
}

/**
 * Изменение ставки аренды (₽/день) у машины.
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
  const p = payload || {};
  const carId = p.car_id ?? p.carId;
  if (!carId) throw new Error('MISSING: car_id');

  const result = await apiRequest(`/fleet/${encodeURIComponent(carId)}/rate`, {
    method: 'PATCH',
    body: {
      rate_day: p.new_rate ?? p.rateDay ?? p.rate_day,
      new_rate: p.new_rate ?? p.rateDay,
      reason: p.reason ?? '',
      by: p.by ?? '',
    },
  });
  invalidateSwrCache(CACHE_KEYS.CARS);
  invalidateSwrCache(CACHE_KEYS.INCOME_FORM);
  return result;
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
  const body = await apiRequest('/rentals/income-form');
  const rows = body?.incomeForm;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Приход аренды: касса + строка аренды (POST /api/rentals/income).
 * @param {object} payload
 */
export async function postAddIncome(payload) {
  const p = payload || {};
  const result = await apiRequest('/rentals/income', {
    method: 'POST',
    body: {
      car_id: p.car_id ?? p.carId,
      driver_id: p.driver_id ?? p.driverId,
      amount: p.amount,
      date_from: p.date_from ?? p.dateFrom,
      date_to: p.date_to ?? p.dateTo,
      rate: p.rate ?? p.rateDay,
      comment: p.comment ?? '',
      kassa_id: p.kassa_id ?? p.kassaId,
      provel: p.provel ?? p.author ?? '',
      mileage: p.mileage,
    },
  });
  invalidateSwrCache(CACHE_KEYS.CASH_OPS);
  invalidateSwrCache(CACHE_KEYS.RENTALS);
  invalidateSwrCache(CACHE_KEYS.CARS);
  invalidateSwrCache(CACHE_KEYS.KASSAS);
  invalidateSwrCache(CACHE_KEYS.INCOME_FORM);
  invalidateSwrCache(CACHE_KEYS.DASHBOARD);
  return result;
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

  return await apiRequest(`/rentals/by-car/${encodeURIComponent(cid)}/promise`, {
    method: 'PATCH',
    body: {
      promised_until:
        promisedUntil != null && promisedUntil instanceof Date && !Number.isNaN(promisedUntil.getTime())
          ? fmtDate(promisedUntil)
          : '',
    },
  }).then(result => {
    invalidateSwrCache(CACHE_KEYS.RENTALS);
    return result;
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

  return await apiRequest(`/rentals/by-car/${encodeURIComponent(cid)}/bonus`, {
    method: 'PATCH',
    body: {
      bonus_days: days,
      bonus_reason: String(reason || ''),
    },
  }).then(result => {
    invalidateSwrCache(CACHE_KEYS.RENTALS);
    return result;
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
