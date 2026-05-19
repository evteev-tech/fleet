/*
  Шаг 1 — создай проект в Apps Script (расширение или script.google.com).
  Шаг 2 — в manifest ALLOWED_ORIGIN укажи URL деплоя
          (например https://username.github.io/matizi)
          или временно разреши '*' для отладки локально.
  Шаг 3 — разверни как веб-приложение:
          тип: анонимный / только организация
          выполнять от: я (ваша учётка)
  Шаг 4 — скопируй URL вида .../exec
  Шаг 5 — вставь URL в js/config.js как WEBHOOK_URL
  Шаг 6 — выгрузи статику на GitHub Pages
  Шаг 7 — в Apps Script убери '*' и задай точный URL,
          чтобы не было посторонних вызовов,
          обнови WEBHOOK_URL в config.js под новый URL

  Имена листов должны совпадать с таблицей и js/config.js (SHEETS).
  Лог ошибок пишется на лист FAIL_LOG, если он есть.
*/

const SS_ID = '1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg';

// Имена листов — как в js/config.js + служебные
const SHEET = {
  OPERATIONS: '\u041a\u0430\u0441\u0441\u0430_\u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0438',
  CARS:       '\u041c\u0430\u0448\u0438\u043d\u044b',
  DRIVERS:    '\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u0438',
  RENTALS:    '\u0410\u0440\u0435\u043d\u0434\u0430',
  DEPOSITS:   '\u0414\u0435\u043f\u043e\u0437\u0438\u0442\u044b_\u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0438',
  USERS:      '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438',
  FAIL_LOG:   '\u041b\u043e\u0433_\u043e\u0448\u0438\u0431\u043e\u043a',
  DASHBOARD:  '\u0414\u0430\u0448\u0431\u043e\u0440\u0434',
  FORECAST_LOG: 'Forecast_log',
};

// -----------------------------------------------------------------------------
// Утилиты ответа
// -----------------------------------------------------------------------------

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data) {
  return jsonOut({ status: 'ok', ...data });
}

function err(message) {
  return jsonOut({ error: true, status: 'error', message: String(message || 'UNKNOWN_ERROR') });
}

function logFailure(ss, action, code, reason) {
  try {
    const sheet = ss.getSheetByName(SHEET.FAIL_LOG);
    if (!sheet) return;
    sheet.appendRow([formatDate(new Date()), '', action, code, reason]);
  } catch (_) {}
}

// -----------------------------------------------------------------------------
// Утилиты дат
// -----------------------------------------------------------------------------

/**
 * Форматирует дату в строку DD.MM.YYYY для записи в таблицу.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date || !(date instanceof Date)) return '';
  var d = String(date.getDate()).padStart(2, '0');
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var y = date.getFullYear();
  return d + '.' + m + '.' + y;
}

/**
 * Дата и время для колонки promised_at (лист Аренда).
 * @param {Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date || !(date instanceof Date)) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}

/**
 * Конвертирует строку DD.MM.YYYY в Excel serial number.
 * @param {string} ddmmyyyy
 * @returns {number}
 */
function dateToExcelSerial(ddmmyyyy) {
  var parts = String(ddmmyyyy).split('.');
  if (parts.length !== 3) return 0;
  var jsDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return Math.round((jsDate.getTime() / 86400000) + 25569);
}

/**
 * Унифицированный разбор даты из ячейки (Date / число Excel / DD.MM.YYYY / ISO-строка).
 */
function parseDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    return new Date((val - 25569) * 86400 * 1000);
  }
  var str = String(val).trim();
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    var parts = str.split('.');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  var f = new Date(str);
  return isNaN(f.getTime()) ? null : f;
}

// -----------------------------------------------------------------------------
// Прочие утилиты
// -----------------------------------------------------------------------------

function parseRequestBody_(e) {
  if (!e) return {};
  if (e.parameter && e.parameter.data) {
    try { return JSON.parse(e.parameter.data); } catch (_) {}
  }
  if (!e.postData || !e.postData.contents) return {};
  var c = String(e.postData.contents).trim();
  if (c.charAt(0) === '{') {
    try { return JSON.parse(c); } catch (_) {}
  }
  var pairs = c.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var kv = pairs[i].split('=');
    if (kv.length < 2) continue;
    if (decodeURIComponent(kv[0]) === 'data') {
      try { return JSON.parse(decodeURIComponent(kv[1].replace(/\+/g, ' '))); } catch (_) {}
    }
  }
  return {};
}

function cellNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Сумма из ячейки/поля (число или строка с пробелами/запятой).
 * @param {*} val
 * @returns {number}
 */
function parseAmount(val) {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number' && !isNaN(val)) return val;
  var s = String(val).replace(/\s/g, '').replace(',', '.');
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Баланс кассы по листу «Касса_операции»: сумма приходов минус сумма расходов по колонке касса_id.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} kassaId
 * @returns {number}
 */
function getKassaBalance(ss, kassaId) {
  var sheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var kid = String(kassaId);
  var balance = 0;
  var prihod = '\u043f\u0440\u0438\u0445\u043e\u0434';
  var rashod = '\u0440\u0430\u0441\u0445\u043e\u0434';
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (String(row[2]) !== kid) continue;
    var dir = String(row[3] || '').trim();
    var amt = parseAmount(row[4]);
    if (dir === prihod) balance += amt;
    else if (dir === rashod) balance -= amt;
  }
  return balance;
}

/**
 * Следующий порядковый ID вида PREFIX + трёхзначный номер.
 * Смотрит колонку A, берёт максимальный числовой суффикс.
 */
function getNextId(sheet, prefix) {
  var data = sheet.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var cell = String(data[i][0] || '');
    if (cell.startsWith(prefix)) {
      var num = parseInt(cell.slice(prefix.length), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  var next = max + 1;
  return prefix + String(next).padStart(4, '0');
}

// -----------------------------------------------------------------------------
// Отладка
// -----------------------------------------------------------------------------

function handleDebugRental(ss) {
  const sheet = ss.getSheetByName('\u0410\u0440\u0435\u043d\u0434\u0430');
  if (!sheet) {
    logFailure(ss, 'DEBUG_RENTAL', 'SHEET_NOT_FOUND', '\u0410\u0440\u0435\u043d\u0434\u0430');
    return err('SHEET_NOT_FOUND');
  }
  const rows = sheet.getDataRange().getValues();
  const last10 = rows.slice(-10).map(function (row) {
    return {
      rental_id: row[0],
      car_id: row[1],
      driver_id: row[2],
      date_start_raw: row[3],
      date_end_raw: row[4],
      date_start_type: typeof row[3],
      date_end_type: typeof row[4],
      date_end_empty: row[4] === '' || row[4] === null || row[4] === undefined,
    };
  });
  return ContentService
    .createTextOutput(JSON.stringify({ rows: last10 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// Маршрутизация POST
// -----------------------------------------------------------------------------

function doPost(e) {
  let SS = null;
  try {
    SS = SpreadsheetApp.openById(SS_ID);
    const body = parseRequestBody_(e);
    const action = body.action || 'ADD_OPERATION';

    if (action === 'DEBUG_SHEETS') {
      const names = SS.getSheets().map(function (s) { return s.getName(); });
      return ContentService
        .createTextOutput(JSON.stringify({ sheets: names }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'DEBUG_RENTAL') return handleDebugRental(SS);
    if (action === 'DEBUG_DRIVERS') return handleDebugDrivers(SS);

    switch (action) {
      case 'ADD_OPERATION':     return handleAddOperation(SS, body);
      case 'UPDATE_CAR_MILEAGE': return handleUpdateCarMileage(SS, body);
      case 'UPDATE_CAR_STATUS': return handleUpdateCarStatus(SS, body);
      case 'SAVE_DRIVER':       return handleSaveDriver(SS, body);
      case 'ADD_DEPOSIT':       return handleAddDeposit(SS, body);
      case 'ADD_RENTAL':        return handleAddRental(SS, body);
      case 'GET_DASHBOARD':     return handleGetDashboard(SS);
      case 'GET_LOST_REVENUE':  return handleGetLostRevenue(SS, body);
      case 'UPDATE_PERIOD':     return handleUpdatePeriod(SS, body);
      case 'GET_FLEET':         return handleGetFleet(SS);
      case 'GET_DRIVERS':       return handleGetDrivers(SS);
      case 'GET_INCOME_FORM':   return handleGetIncomeForm(SS);
      case 'ADD_INCOME':            return handleAddIncome(SS, body);
      case 'SAVE_RENTAL_PROMISE':   return handleSaveRentalPromise(SS, body);
      case 'SAVE_BONUS_DAYS':       return handleSaveBonusDays(SS, body);
      default:
        logFailure(SS, action, 'UNKNOWN_ACTION', 'Action not implemented');
        return err('UNKNOWN_ACTION');
    }
  } catch (ex) {
    try {
      var ssLog = SS || SpreadsheetApp.openById(SS_ID);
      logFailure(ssLog, 'doPost', 'EXCEPTION', String(ex && ex.message ? ex.message : ex));
    } catch (_) {}
    return err(ex && ex.message ? ex.message : ex);
  }
}

// -----------------------------------------------------------------------------
// ADD_OPERATION
// -----------------------------------------------------------------------------

function handleAddOperation(ss, body) {
  const {
    date, kassa_id, direction, amount,
    type = '', category = '', car_id = '', driver_id = '',
    comment = '', provel = '', class_override = '',
  } = body;

  if (!date)      return err('MISSING_FIELD: date');
  if (!kassa_id)  return err('MISSING_FIELD: kassa_id');
  if (!direction) return err('MISSING_FIELD: direction');
  if (!amount && amount !== 0) return err('MISSING_FIELD: amount');

  const sheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!sheet) {
    logFailure(ss, 'ADD_OPERATION', 'SHEET_NOT_FOUND', SHEET.OPERATIONS);
    return err('SHEET_NOT_FOUND');
  }

  const op_id = getNextId(sheet, 'CO');

  let klass_itog;
  const typeLower = String(type).toLowerCase();
  const dirStr = String(direction || '');
  if (typeLower.startsWith('\u0430\u0440\u0435\u043d\u0434\u0430') || typeLower === '\u0430\u0440\u0435\u043d\u0434\u0430') {
    klass_itog = 'revenue';
  } else if (typeLower.startsWith('\u043f\u0435\u0440\u0435\u0432\u043e\u0434_')) {
    klass_itog = 'transfer';
  } else if (dirStr === '\u043f\u0435\u0440\u0435\u0432\u043e\u0434') {
    klass_itog = 'transfer';
  } else if (typeLower.startsWith('\u0434\u0435\u043f\u043e\u0437\u0438\u0442')) {
    klass_itog = 'deposit';
  } else if (dirStr === '\u0440\u0430\u0441\u0445\u043e\u0434') {
    klass_itog = 'opex';
  } else {
    klass_itog = 'revenue';
  }

  const finalClass = class_override || klass_itog;

  var rashod = '\u0440\u0430\u0441\u0445\u043e\u0434';
  var prihod = '\u043f\u0440\u0438\u0445\u043e\u0434';
  var kid = String(kassa_id);
  var amtNum = Number(amount);
  var korrekt = '\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u043a\u0430';
  var skipAutoCap =
    dirStr !== rashod ||
    (kid !== 'K_VLADIMIR' && kid !== 'K_YULIA') ||
    typeLower === korrekt ||
    typeLower.startsWith('\u043f\u0435\u0440\u0435\u0432\u043e\u0434_');

  var autoCapitalized = false;
  var capitalizedAmount = 0;
  var capitalizedFrom = null;

  if (!skipAutoCap && !isNaN(amtNum) && amtNum > 0) {
    var balance = getKassaBalance(ss, kid);
    if (balance < amtNum) {
      var deficit = amtNum - balance;
      var investKassaId = kid === 'K_VLADIMIR' ? 'K_INVEST_VLAD' : 'K_INVEST_YULIA';
      var transferId = 'CAP_' + new Date().getTime();
      var todayStr = formatDate(new Date());
      var sys = '\u0421\u0438\u0441\u0442\u0435\u043c\u0430';
      var typOut = '\u043f\u0435\u0440\u0435\u0432\u043e\u0434_\u0438\u0441\u0445\u043e\u0434\u044f\u0449\u0438\u0439';
      var typIn = '\u043f\u0435\u0440\u0435\u0432\u043e\u0434_\u0432\u0445\u043e\u0434\u044f\u0449\u0438\u0439';
      var cOut = '\u0410\u0432\u0442\u043e\u0434\u043e\u043a\u0430\u043f\u0438\u0442\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f \u2192 ' + kid;
      var cIn = '\u0410\u0432\u0442\u043e\u0434\u043e\u043a\u0430\u043f\u0438\u0442\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f \u2190 ' + investKassaId;

      sheet.appendRow([
        transferId + '_OUT', todayStr, investKassaId, rashod, deficit,
        typOut, '', '', '', cOut, sys,
        '', 'transfer',
      ]);
      sheet.appendRow([
        transferId + '_IN', todayStr, kid, prihod, deficit,
        typIn, '', '', '', cIn, sys,
        '', 'transfer',
      ]);

      autoCapitalized = true;
      capitalizedAmount = deficit;
      capitalizedFrom = investKassaId;
    }
  }

  sheet.appendRow([
    op_id, date, kassa_id, direction, Number(amount),
    type, category, car_id, driver_id, comment, provel,
    class_override, finalClass,
  ]);

  return ok({
    success: true,
    op_id: op_id,
    opId: op_id,
    autoCapitalized: autoCapitalized,
    capitalizedAmount: capitalizedAmount,
    capitalizedFrom: capitalizedFrom,
  });
}

// -----------------------------------------------------------------------------
// UPDATE_CAR_MILEAGE
// -----------------------------------------------------------------------------

function handleUpdateCarMileage(ss, body) {
  const { car_id, mileage, next_to_mileage } = body;
  if (!car_id) return err('MISSING_FIELD: car_id');
  if (mileage === undefined || mileage === null || mileage === '') return err('MISSING_FIELD: mileage');
  if (next_to_mileage === undefined || next_to_mileage === null || next_to_mileage === '') {
    return err('MISSING_FIELD: next_to_mileage');
  }

  const sheet = ss.getSheetByName(SHEET.CARS);
  if (!sheet) {
    logFailure(ss, 'UPDATE_CAR_MILEAGE', 'SHEET_NOT_FOUND', SHEET.CARS);
    return err('SHEET_NOT_FOUND');
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const carIdCol = headers.indexOf('car_id');
  const mileageCol = headers.indexOf('Текущий пробег');
  const nextToCol = headers.indexOf('ТО на пробеге');
  if (carIdCol === -1 || mileageCol === -1 || nextToCol === -1) {
    logFailure(ss, 'UPDATE_CAR_MILEAGE', 'COLUMN_NOT_FOUND', 'car_id|Текущий пробег|ТО на пробеге');
    return err('COLUMN_NOT_FOUND');
  }

  const carRow = data.findIndex((row, i) => i > 0 && String(row[carIdCol]) === String(car_id));
  if (carRow === -1) {
    logFailure(ss, 'UPDATE_CAR_MILEAGE', 'CAR_NOT_FOUND', String(car_id));
    return err('CAR_NOT_FOUND');
  }

  sheet.getRange(carRow + 1, mileageCol + 1).setValue(Number(mileage));
  sheet.getRange(carRow + 1, nextToCol + 1).setValue(Number(next_to_mileage));

  return ok({ car_id, mileage: Number(mileage), next_to_mileage: Number(next_to_mileage) });
}

// -----------------------------------------------------------------------------
// UPDATE_CAR_STATUS
// -----------------------------------------------------------------------------

function handleUpdateCarStatus(ss, body) {
  const { car_id, new_status } = body;
  if (!car_id)     return err('MISSING_FIELD: car_id');
  if (!new_status) return err('MISSING_FIELD: new_status');

  const sheet = ss.getSheetByName(SHEET.CARS);
  if (!sheet) {
    logFailure(ss, 'UPDATE_CAR_STATUS', 'SHEET_NOT_FOUND', SHEET.CARS);
    return err('SHEET_NOT_FOUND');
  }

  const data   = sheet.getDataRange().getValues();
  const rowIdx = data.findIndex((row, i) => i > 0 && String(row[0]) === String(car_id));

  if (rowIdx === -1) {
    logFailure(ss, 'UPDATE_CAR_STATUS', 'CAR_NOT_FOUND', car_id);
    return err('CAR_NOT_FOUND');
  }

  sheet.getRange(rowIdx + 1, 4).setValue(new_status);
  return ok({ car_id, new_status });
}

// -----------------------------------------------------------------------------
// SAVE_DRIVER
// -----------------------------------------------------------------------------

function handleSaveDriver(ss, body) {
  const {
    driver_id = '', fio = '', phone = '',
    vu = '', car_id = '', status = '\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439', comment = '',
  } = body;

  const sheet = ss.getSheetByName(SHEET.DRIVERS);
  if (!sheet) {
    logFailure(ss, 'SAVE_DRIVER', 'SHEET_NOT_FOUND', SHEET.DRIVERS);
    return err('SHEET_NOT_FOUND');
  }

  if (!driver_id) {
    const newId = getNextId(sheet, 'D');
    sheet.appendRow([newId, fio, phone, vu, status, 0, comment]);
    if (car_id) {
      handleUpdateCarStatus(ss, { car_id, new_status: '\u0432 \u0430\u0440\u0435\u043d\u0434\u0435' });
    }
    return ok({ driver_id: newId });
  }

  const data   = sheet.getDataRange().getValues();
  const rowIdx = data.findIndex((row, i) => i > 0 && String(row[0]) === String(driver_id));

  if (rowIdx === -1) {
    logFailure(ss, 'SAVE_DRIVER', 'DRIVER_NOT_FOUND', driver_id);
    return err('DRIVER_NOT_FOUND');
  }

  const sheetRow = rowIdx + 1;
  sheet.getRange(sheetRow, 2, 1, 4).setValues([[fio, phone, vu, status]]);
  sheet.getRange(sheetRow, 7).setValue(comment);
  return ok({ driver_id });
}

// -----------------------------------------------------------------------------
// ADD_DEPOSIT
// -----------------------------------------------------------------------------

function handleAddDeposit(ss, body) {
  const { driver_id, car_id = '', amount, comment = '' } = body;

  if (!driver_id) return err('MISSING_FIELD: driver_id');
  if (amount === undefined || amount === null) return err('MISSING_FIELD: amount');

  const depSheet    = ss.getSheetByName(SHEET.DEPOSITS);
  const driverSheet = ss.getSheetByName(SHEET.DRIVERS);

  if (!depSheet)    return err('SHEET_NOT_FOUND: ' + SHEET.DEPOSITS);
  if (!driverSheet) return err('SHEET_NOT_FOUND: ' + SHEET.DRIVERS);

  const dep_op_id  = getNextId(depSheet, 'DP');
  const status_src = Number(amount) > 0 ? '\u043f\u0440\u0438\u0445\u043e\u0434' : '\u0440\u0430\u0441\u0445\u043e\u0434';
  const today      = formatDate(new Date());

  depSheet.appendRow([dep_op_id, today, driver_id, car_id, Number(amount), status_src, comment]);

  const driverData = driverSheet.getDataRange().getValues();
  const dRowIdx    = driverData.findIndex((row, i) => i > 0 && String(row[0]) === String(driver_id));

  if (dRowIdx !== -1) {
    const currentDeposit = Number(driverData[dRowIdx][5]) || 0;
    driverSheet.getRange(dRowIdx + 1, 6).setValue(currentDeposit + Number(amount));
  }

  return ok({ dep_op_id });
}

// -----------------------------------------------------------------------------
// ADD_RENTAL
// -----------------------------------------------------------------------------

function handleAddRental(ss, body) {
  const {
    car_id, driver_id, date_start,
    date_end = '',
    rate_day, comment = '',
  } = body;

  if (!car_id)     return err('MISSING_FIELD: car_id');
  if (!driver_id)  return err('MISSING_FIELD: driver_id');
  if (!date_start) return err('MISSING_FIELD: date_start');
  if (!rate_day && rate_day !== 0) return err('MISSING_FIELD: rate_day');

  const sheet = ss.getSheetByName(SHEET.RENTALS);
  if (!sheet) {
    logFailure(ss, 'ADD_RENTAL', 'SHEET_NOT_FOUND', SHEET.RENTALS);
    return err('SHEET_NOT_FOUND');
  }

  const rental_id   = getNextId(sheet, 'R');
  const serialStart = dateToExcelSerial(date_start);
  const serialEnd     = date_end ? dateToExcelSerial(date_end) : '';

  sheet.appendRow([rental_id, car_id, driver_id, serialStart, serialEnd, Number(rate_day), comment, '', '', '', '']);

  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 4).setNumberFormat('DD.MM.YYYY');
  if (serialEnd) {
    sheet.getRange(newRow, 5).setNumberFormat('DD.MM.YYYY');
  }

  return ok({ rental_id });
}

// -----------------------------------------------------------------------------
// GET_DASHBOARD / UPDATE_PERIOD
// -----------------------------------------------------------------------------

/**
 * Обороты по кассам за период (лист «Касса_операции»).
 * B — дата, C — касса_id, D — направление, E — сумма, M — klass_itog.
 * Переводы (transfer) и CAPEX не входят в оборот — только operational деньги.
 *
 * @param {Spreadsheet} ss
 * @param {number} year
 * @param {number} month — 1..12
 * @param {boolean} allTime
 * @returns {Array<{kassaId:string, inflow:number, outflow:number}>}
 */
function computeKassaTurnover_(ss, year, month, allTime) {
  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!opsSheet) return [];

  var y = Number(year);
  var mo = Number(month);
  if (!allTime && (!y || !mo || mo < 1 || mo > 12)) return [];

  var data = opsSheet.getDataRange().getValues();
  var turnover = {};

  for (var i = 1; i < data.length; i++) {
    var dateRaw = data[i][1];
    var kassaId = String(data[i][2] || '').trim();
    var direction = String(data[i][3] || '').toLowerCase().trim();
    var amtRaw = cellNum_(data[i][4]);
    var amount = amtRaw === null ? 0 : Math.abs(Number(amtRaw));
    var klass = String(data[i][12] || '').toLowerCase().trim();

    if (!kassaId) continue;
    if (klass === 'transfer' || klass === 'capex') continue;

    if (!allTime) {
      var d = parseDate(dateRaw);
      if (!d) continue;
      if (d.getFullYear() !== y || d.getMonth() + 1 !== mo) continue;
    }

    if (!turnover[kassaId]) turnover[kassaId] = { kassaId: kassaId, inflow: 0, outflow: 0 };

    if (direction === '\u043f\u0440\u0438\u0445\u043e\u0434' || direction === 'income') {
      turnover[kassaId].inflow += amount;
    } else if (direction === '\u0440\u0430\u0441\u0445\u043e\u0434' || direction === 'outcome') {
      turnover[kassaId].outflow += amount;
    }
  }

  var result = [];
  for (var k in turnover) {
    if (Object.prototype.hasOwnProperty.call(turnover, k)) result.push(turnover[k]);
  }
  result.sort(function (a, b) {
    return b.inflow + b.outflow - (a.inflow + a.outflow);
  });
  return result;
}

/**
 * Возвращает по каждой машине массив прибыли по месяцам за последние 6 мес.
 * @param {Spreadsheet} ss
 * @param {Date} [now]
 * @returns {Object<string, Array<{year:number, month:number, profit:number}>>}
 */
function computePnlByCarMonthly_(ss, now) {
  if (!now) now = new Date();
  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!opsSheet) return {};

  var months = [];
  for (var k = 5; k >= 0; k--) {
    var d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  var byCar = {};
  var data = opsSheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var dateRaw = data[i][1];
    var carId = String(data[i][7] || '').trim();
    var amtRaw = cellNum_(data[i][4]);
    var amount = amtRaw === null ? 0 : Number(amtRaw);
    var klass = String(data[i][12] || '').toLowerCase().trim();

    if (!carId) continue;
    if (klass !== 'revenue' && klass !== 'opex') continue;

    var d = parseDate(dateRaw);
    if (!d) continue;

    var key = null;
    for (var m = 0; m < months.length; m++) {
      if (d.getFullYear() === months[m].year && d.getMonth() + 1 === months[m].month) {
        key = months[m].year + '-' + months[m].month;
        break;
      }
    }
    if (!key) continue;

    if (!byCar[carId]) byCar[carId] = {};
    if (!byCar[carId][key]) byCar[carId][key] = { revenue: 0, opex: 0 };

    if (klass === 'revenue') byCar[carId][key].revenue += Math.abs(amount);
    else byCar[carId][key].opex += Math.abs(amount);
  }

  var result = {};
  var carIds = Object.keys(byCar);
  for (var ci = 0; ci < carIds.length; ci++) {
    var cid = carIds[ci];
    var arr = [];
    for (var mj = 0; mj < months.length; mj++) {
      var mk = months[mj].year + '-' + months[mj].month;
      var entry = byCar[cid][mk] || { revenue: 0, opex: 0 };
      arr.push({
        year: months[mj].year,
        month: months[mj].month,
        profit: entry.revenue - entry.opex,
      });
    }
    result[cid] = arr;
  }
  return result;
}

/**
 * % дней в аренде = (дней аренды в периоде) / (всего дней в периоде) × 100
 * @param {Spreadsheet} ss
 * @param {number} year
 * @param {number} month
 * @param {boolean} allTime
 * @param {Date} [now]
 * @returns {Object<string, number>}
 */
function computeUtilizationByCar_(ss, year, month, allTime, now) {
  if (!now) now = new Date();
  if (allTime) return {};

  var rentSheet = ss.getSheetByName(SHEET.RENTALS);
  if (!rentSheet) return {};

  var y = Number(year);
  var mo = Number(month);
  if (!y || !mo || mo < 1 || mo > 12) return {};

  var periodStart = new Date(y, mo - 1, 1);
  periodStart.setHours(0, 0, 0, 0);
  var periodEnd = new Date(y, mo, 0);
  periodEnd.setHours(0, 0, 0, 0);

  if (y === now.getFullYear() && mo === now.getMonth() + 1) {
    periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodEnd.setHours(0, 0, 0, 0);
  }

  var periodDays = Math.round((periodEnd - periodStart) / (1000 * 60 * 60 * 24)) + 1;
  if (periodDays <= 0) return {};

  var daysByCar = {};
  var rdata = rentSheet.getDataRange().getValues();

  for (var ri = 1; ri < rdata.length; ri++) {
    var carId = String(rdata[ri][1] || '').trim();
    var dStart = parseDate(rdata[ri][3]);
    var dEnd = parseDate(rdata[ri][4]);

    if (!carId || !dStart) continue;
    dStart.setHours(0, 0, 0, 0);
    if (!dEnd) {
      dEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    dEnd.setHours(0, 0, 0, 0);

    var overlapStart = dStart > periodStart ? dStart : periodStart;
    var overlapEnd = dEnd < periodEnd ? dEnd : periodEnd;

    if (overlapEnd < overlapStart) continue;

    var overlapDays = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
    daysByCar[carId] = (daysByCar[carId] || 0) + overlapDays;
  }

  var result = {};
  var dids = Object.keys(daysByCar);
  for (var di = 0; di < dids.length; di++) {
    var id = dids[di];
    result[id] = Math.min(100, Math.round(daysByCar[id] / periodDays * 100));
  }
  return result;
}

// -----------------------------------------------------------------------------
// GET_LOST_REVENUE — упущенная выручка (ремонт / простой / бонусы)
// -----------------------------------------------------------------------------

function getDashboardPeriodBounds_(year, month, allTime, now) {
  if (!now) now = new Date();
  now = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (allTime) {
    var psAll = new Date(2020, 0, 1);
    psAll.setHours(0, 0, 0, 0);
    var pdAll = Math.round((now - psAll) / 86400000) + 1;
    return {
      periodStart: psAll,
      periodEnd: now,
      year: Number(year) || now.getFullYear(),
      month: Number(month) || (now.getMonth() + 1),
      allTime: true,
      periodDays: Math.max(1, pdAll),
    };
  }
  var y = Number(year);
  var mo = Number(month);
  if (!y || !mo || mo < 1 || mo > 12) {
    y = now.getFullYear();
    mo = now.getMonth() + 1;
  }
  var periodStart = new Date(y, mo - 1, 1);
  periodStart.setHours(0, 0, 0, 0);
  var periodEnd = new Date(y, mo, 0);
  periodEnd.setHours(0, 0, 0, 0);
  if (y === now.getFullYear() && mo === now.getMonth() + 1) {
    periodEnd = new Date(now);
  }
  var periodDays = Math.round((periodEnd - periodStart) / 86400000) + 1;
  return {
    periodStart: periodStart,
    periodEnd: periodEnd,
    year: y,
    month: mo,
    allTime: false,
    periodDays: Math.max(1, periodDays),
  };
}

function daysInclusive_(d0, d1) {
  if (!d0 || !d1) return 0;
  var a = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  var b = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

function overlapRangeDays_(lossStart, lossEnd, periodStart, periodEnd) {
  if (!lossStart) return 0;
  var s = new Date(lossStart);
  s.setHours(0, 0, 0, 0);
  var e = lossEnd ? new Date(lossEnd) : new Date(periodEnd);
  e.setHours(0, 0, 0, 0);
  var ps = new Date(periodStart);
  var pe = new Date(periodEnd);
  var start = s > ps ? s : ps;
  var end = e < pe ? e : pe;
  return daysInclusive_(start, end);
}

function normStatus_(raw) {
  return String(raw || '').toLowerCase().trim();
}

function isRepairCategory_(cat) {
  var c = normStatus_(cat);
  if (!c) return false;
  if (c === '\u0440\u0435\u043c\u043e\u043d\u0442' || c === '\u0442\u043e') return true;
  if (c.indexOf('\u0437\u0430\u043f\u0447\u0430\u0441\u0442') >= 0) return true;
  return false;
}

function isRentType_(typ) {
  return normStatus_(typ).indexOf('\u0430\u0440\u0435\u043d\u0434') >= 0;
}

function rentPaidDays_(amount, rateDay) {
  var rate = Number(rateDay) || 0;
  if (rate <= 0) return 0;
  return Math.max(0, Math.floor(Number(amount) / rate));
}

function buildCarsIndex_(ss) {
  var sheet = ss.getSheetByName(SHEET.CARS);
  var map = {};
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '').trim();
    if (!id) continue;
    map[id] = {
      carId: id,
      status: String(data[i][3] || '').trim(),
      rateDay: Number(data[i][6]) || 0,
      dateBuy: parseDate(data[i][4]),
    };
  }
  return map;
}

function readDashboardPeriod_(ss) {
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  var allTime = false;
  var sheet = ss.getSheetByName(SHEET.DASHBOARD);
  if (sheet) {
    year = Number(sheet.getRange('B2').getValue()) || year;
    month = Number(sheet.getRange('B3').getValue()) || month;
    var periodAllRaw = sheet.getRange('E99').getValue();
    allTime = String(periodAllRaw || '').trim().toUpperCase() === 'ALL';
  }
  return { year: year, month: month, allTime: allTime };
}

/**
 * @returns {object} lostRevenue payload (period, parkLoad, summary, byCarSorted)
 */
function computeLostRevenue_(ss, year, month, allTime, now) {
  var bounds = getDashboardPeriodBounds_(year, month, allTime, now);
  var periodStart = bounds.periodStart;
  var periodEnd = bounds.periodEnd;
  var carsMap = buildCarsIndex_(ss);
  var carIds = Object.keys(carsMap);

  var inactive = { '\u043f\u0440\u043e\u0434\u0430\u043d\u0430': true, '\u0441\u043f\u0438\u0441\u0430\u043d\u0430': true };
  var activeCount = 0;
  for (var ac = 0; ac < carIds.length; ac++) {
    var st0 = normStatus_(carsMap[carIds[ac]].status);
    if (!inactive[st0]) activeCount++;
  }

  var rentMachineDays = 0;
  var rentSheet = ss.getSheetByName(SHEET.RENTALS);
  if (rentSheet) {
    var rdata = rentSheet.getDataRange().getValues();
    for (var ri = 1; ri < rdata.length; ri++) {
      var rcar = String(rdata[ri][1] || '').trim();
      if (!rcar) continue;
      var dStart = parseDate(rdata[ri][3]);
      var dEnd = parseDate(rdata[ri][4]);
      if (!dStart) continue;
      rentMachineDays += overlapRangeDays_(dStart, dEnd || periodEnd, periodStart, periodEnd);
    }
  }

  var totalCarDays = activeCount * bounds.periodDays;
  var summary = {
    repair: { days: 0, rub: 0 },
    idle: { days: 0, rub: 0 },
    bonus: { days: 0, rub: 0 },
    total: { days: 0, rub: 0 },
  };
  var carBuckets = {};

  function ensureCar_(id) {
    if (!carBuckets[id]) {
      carBuckets[id] = {
        repair: { d: 0, r: 0 },
        idle: { d: 0, r: 0 },
        bonus: { d: 0, r: 0 },
      };
    }
    return carBuckets[id];
  }

  function addLoss_(id, kind, days, rub) {
    if (days <= 0 || rub <= 0) return;
    var b = ensureCar_(id);
    b[kind].d += days;
    b[kind].r += rub;
    summary[kind].days += days;
    summary[kind].rub += rub;
  }

  if (rentSheet) {
    var rBonus = rentSheet.getDataRange().getValues();
    for (var bi = 1; bi < rBonus.length; bi++) {
      var bcar = String(rBonus[bi][1] || '').trim();
      var endDt = parseDate(rBonus[bi][4]);
      var bonus = Number(rBonus[bi][9]) || 0;
      if (!bcar || bonus <= 0 || !endDt) continue;
      endDt.setHours(0, 0, 0, 0);
      if (endDt < periodStart || endDt > periodEnd) continue;
      var rateB = Number(carsMap[bcar] && carsMap[bcar].rateDay) || 0;
      if (rateB <= 0) {
        logFailure(ss, 'GET_LOST_REVENUE', 'NO_RATE', bcar);
        continue;
      }
      addLoss_(bcar, 'bonus', bonus, bonus * rateB);
    }
  }

  var lastRepairOp = {};
  var lastRentOp = {};
  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (opsSheet) {
    var odata = opsSheet.getDataRange().getValues();
    for (var oi = 1; oi < odata.length; oi++) {
      var ocar = String(odata[oi][7] || '').trim();
      if (!ocar) continue;
      var odt = parseDate(odata[oi][1]);
      if (!odt) continue;
      var cat = String(odata[oi][6] || '');
      var typ = String(odata[oi][5] || '');
      var amt = Number(odata[oi][4]) || 0;
      if (isRepairCategory_(cat)) {
        if (!lastRepairOp[ocar] || odt > lastRepairOp[ocar].date) {
          lastRepairOp[ocar] = { date: odt };
        }
      }
      if (isRentType_(typ)) {
        if (!lastRentOp[ocar] || odt > lastRentOp[ocar].date) {
          lastRentOp[ocar] = { date: odt, amount: amt };
        }
      }
    }
  }

  for (var ci = 0; ci < carIds.length; ci++) {
    var cid = carIds[ci];
    var car = carsMap[cid];
    var rate = Number(car.rateDay) || 0;
    var st = normStatus_(car.status);

    if (st.indexOf('\u0440\u0435\u043c\u043e\u043d\u0442') >= 0) {
      var rop = lastRepairOp[cid];
      if (!rop) {
        logFailure(ss, 'GET_LOST_REVENUE', 'NO_REPAIR_OPS', 'car_id=' + cid);
        continue;
      }
      if (rate <= 0) {
        logFailure(ss, 'GET_LOST_REVENUE', 'NO_RATE', cid);
        continue;
      }
      var rDays = overlapRangeDays_(rop.date, periodEnd, periodStart, periodEnd);
      addLoss_(cid, 'repair', rDays, rDays * rate);
    }

    if (st.indexOf('\u043f\u0440\u043e\u0441\u0442') >= 0 && st.indexOf('\u0440\u0435\u043c\u043e\u043d\u0442') < 0) {
      if (rate <= 0) continue;
      var idleStart = null;
      var lrent = lastRentOp[cid];
      if (lrent) {
        idleStart = new Date(lrent.date);
        idleStart.setHours(0, 0, 0, 0);
        idleStart.setDate(idleStart.getDate() + rentPaidDays_(lrent.amount, rate));
      } else if (car.dateBuy) {
        idleStart = new Date(car.dateBuy);
        idleStart.setHours(0, 0, 0, 0);
      }
      if (!idleStart) continue;
      var iDays = overlapRangeDays_(idleStart, periodEnd, periodStart, periodEnd);
      addLoss_(cid, 'idle', iDays, iDays * rate);
    }
  }

  summary.total.days = summary.repair.days + summary.idle.days + summary.bonus.days;
  summary.total.rub = summary.repair.rub + summary.idle.rub + summary.bonus.rub;

  var pri = { bonus: 3, repair: 2, idle: 1 };
  var byCarSorted = [];
  for (var bk in carBuckets) {
    if (!Object.prototype.hasOwnProperty.call(carBuckets, bk)) continue;
    var bucket = carBuckets[bk];
    var pick = null;
    var kinds = ['bonus', 'repair', 'idle'];
    for (var ki = 0; ki < kinds.length; ki++) {
      var kind = kinds[ki];
      if (bucket[kind].r <= 0) continue;
      if (!pick || pri[kind] > pri[pick]) pick = kind;
    }
    if (!pick) continue;
    byCarSorted.push({
      carId: bk,
      days: bucket[pick].d,
      rub: Math.round(bucket[pick].r),
      reason: pick,
    });
  }
  byCarSorted.sort(function (a, b) {
    return b.rub - a.rub;
  });

  return {
    period: { from: formatDate(periodStart), to: formatDate(periodEnd) },
    parkLoad: {
      totalCarDays: totalCarDays,
      rentDays: rentMachineDays,
      rentPct: totalCarDays > 0 ? Math.round((rentMachineDays / totalCarDays) * 1000) / 10 : 0,
    },
    summary: {
      repair: { days: summary.repair.days, rub: Math.round(summary.repair.rub) },
      idle: { days: summary.idle.days, rub: Math.round(summary.idle.rub) },
      bonus: { days: summary.bonus.days, rub: Math.round(summary.bonus.rub) },
      total: { days: summary.total.days, rub: Math.round(summary.total.rub) },
    },
    byCarSorted: byCarSorted,
  };
}

function handleGetLostRevenue(ss, body) {
  var p = readDashboardPeriod_(ss);
  var lost = computeLostRevenue_(ss, p.year, p.month, p.allTime, new Date());
  return ok({ lostRevenue: lost });
}

function handleGetDashboard(ss) {
  var sheet = ss.getSheetByName('\u0414\u0430\u0448\u0431\u043e\u0440\u0434');

  var nowD = new Date();
  var year, month, allTime, summary, opex, pnl, utilization;

  if (sheet) {
    year  = Number(sheet.getRange('B2').getValue()) || nowD.getFullYear();
    month = Number(sheet.getRange('B3').getValue()) || (nowD.getMonth() + 1);
    // Маркер UI «Всё время» (E99); при необходимости подключите к формулам листа.
    var periodAllRaw = sheet.getRange('E99').getValue();
    allTime = String(periodAllRaw || '').trim().toUpperCase() === 'ALL';

    var summaryLabels = ['\u0412\u044b\u0440\u0443\u0447\u043a\u0430', 'OPEX', 'CAPEX', '\u041f\u0440\u0438\u0431\u044b\u043b\u044c'];
    var summaryKeys   = ['revenue', 'opex', 'capex', 'profit'];
    var sumVals = sheet.getRange(10, 2, 13, 3).getValues();
    summary = [];
    for (var si = 0; si < 4; si++) {
      summary.push({
        key:      summaryKeys[si],
        label:    summaryLabels[si],
        current:  cellNum_(sumVals[si][0]),
        previous: cellNum_(sumVals[si][1]),
      });
    }

    var opexRaw = sheet.getRange(17, 1, 26, 3).getValues();
    opex = [];
    for (var oi = 0; oi < opexRaw.length; oi++) {
      var name = String(opexRaw[oi][0] || '').trim();
      if (!name) continue;
      var amt      = cellNum_(opexRaw[oi][1]);
      var shareRaw = opexRaw[oi][2];
      var share    = cellNum_(shareRaw);
      if (share !== null && share > 1) share = share / 100;
      opex.push({ name: name, amount: amt !== null ? amt : 0, share: share !== null ? share : null });
    }

    var pnlRaw = sheet.getRange(30, 1, 44, 4).getValues();
    pnl = [];
    for (var pi = 0; pi < pnlRaw.length; pi++) {
      var carName = String(pnlRaw[pi][0] || '').trim();
      if (!carName) continue;
      pnl.push({
        car:     carName,
        revenue: cellNum_(pnlRaw[pi][1]) || 0,
        expense: cellNum_(pnlRaw[pi][2]) || 0,
        profit:  cellNum_(pnlRaw[pi][3]) || 0,
      });
    }

    var utilRaw = sheet.getRange(47, 1, 70, 2).getValues();
    utilization = [];
    for (var ui = 0; ui < utilRaw.length; ui++) {
      var carU   = String(utilRaw[ui][0] || '').trim();
      if (!carU) continue;
      var pctRaw = cellNum_(utilRaw[ui][1]);
      var pct    = pctRaw;
      if (pct !== null && pct >= 0 && pct <= 1) pct = pct * 100;
      utilization.push({ car: carU, pct: pct });
    }
  } else {
    // Лист «Дашборд» отсутствует — не падаем, отдаём пустые структуры.
    // Overview-блок всё равно посчитается из «Касса_операции» (см. ниже).
    logFailure(ss, 'GET_DASHBOARD', 'SHEET_NOT_FOUND', '\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
    year    = nowD.getFullYear();
    month   = nowD.getMonth() + 1;
    allTime = false;
    summary = [
      { key: 'revenue', label: '\u0412\u044b\u0440\u0443\u0447\u043a\u0430',   current: null, previous: null },
      { key: 'opex',    label: 'OPEX',                                          current: null, previous: null },
      { key: 'capex',   label: 'CAPEX',                                         current: null, previous: null },
      { key: 'profit',  label: '\u041f\u0440\u0438\u0431\u044b\u043b\u044c',   current: null, previous: null },
    ];
    opex = [];
    pnl = [];
    utilization = [];
  }

  var extras = computeOverviewExtras_(ss);

  var accuracy3 = computeForecastAccuracy_(ss, 3, 'simple');
  var accuracy6 = computeForecastAccuracy_(ss, 6, 'simple');
  var kassaTurnover = computeKassaTurnover_(ss, year, month, allTime);
  var nowDash = new Date();
  var pnlByCarMonthly = computePnlByCarMonthly_(ss, nowDash);
  var utilizationByCar = allTime ? {} : computeUtilizationByCar_(ss, year, month, allTime, nowDash);
  var lostRevenue = computeLostRevenue_(ss, year, month, allTime, nowDash);
  if (!allTime && year && month) {
    var prevY = Number(year);
    var prevM = Number(month) - 1;
    if (prevM < 1) {
      prevM = 12;
      prevY -= 1;
    }
    var prevEnd = new Date(prevY, prevM, 0);
    var lostPrev = computeLostRevenue_(ss, prevY, prevM, false, prevEnd);
    lostRevenue.previous = { summary: { total: lostPrev.summary.total } };
  }

  return ok({
    dashboard: {
      year: year,
      month: month,
      allTime: allTime,
      summary: summary,
      opex: opex,
      pnl: pnl,
      utilization: utilization,
      pnlByCarMonthly: pnlByCarMonthly,
      utilizationByCar: utilizationByCar,
      lostRevenue: lostRevenue,
      trailing12:        extras.trailing12,
      cumulativeProfit:  extras.cumulativeProfit,
      capexTotal:        extras.capexTotal,
      paybackMonths:     extras.paybackMonths,
      forecastNextMonth: extras.forecastNextMonth,
      forecastAccuracy: {
        window3: accuracy3,
        window6: accuracy6,
        model: 'simple',
      },
      kassaTurnover: kassaTurnover,
    },
  });
}

/**
 * Считает доп. метрики для вкладки Overview по листу «Касса_операции»
 * за один проход. Колонки операций: B (idx 1) — дата, E (4) — сумма,
 * M (12) — klass_itog ('revenue' | 'opex' | 'capex' | 'transfer' | 'deposit').
 *
 * Возвращает:
 *   trailing12 — массив из 12 объектов {year, month, revenue, opex, profit},
 *     отсортирован от старого к новому; последний элемент — ТЕКУЩИЙ месяц
 *     (может быть неполным).
 *   cumulativeProfit — сумма profit по trailing12.
 *   capexTotal — сумма всех 'capex'-строк за всё время.
 *   paybackMonths — расчётный срок окупаемости в месяцах:
 *     • null  — avgProfit ≤ 0 (не окупается) либо нет данных за окно;
 *     • 0     — уже окупилось (накопленная за всё время прибыль ≥ capexTotal);
 *     • N > 0 — Math.ceil((capexTotal − cumulativeProfitTotalAllTime) / avgProfit).
 *     avgProfit — средняя месячная прибыль по последним 6 ЗАВЕРШЁННЫМ месяцам
 *     (текущий неполный месяц исключён). В знаменатель идут ТОЛЬКО месяцы
 *     с активностью (revenue > 0 || opex > 0); пустые месяцы не размывают среднее.
 *   forecastNextMonth — Math.round(avgRev3 − avgOpex3) по 3 последним
 *     ЗАВЕРШЁННЫМ месяцам (без текущего). Пустые месяцы аналогично исключаются.
 */
function computeOverviewExtras_(ss) {
  var empty = {
    trailing12: [],
    cumulativeProfit: 0,
    capexTotal: 0,
    paybackMonths: null,
    forecastNextMonth: 0,
  };

  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!opsSheet) return empty;

  var now  = new Date();
  var curY = now.getFullYear();
  var curM = now.getMonth() + 1;

  // Бакеты на 12 месяцев: старый → новый, текущий — последним.
  var months = [];
  for (var i = 11; i >= 0; i--) {
    var d = new Date(curY, curM - 1 - i, 1);
    months.push({
      year:    d.getFullYear(),
      month:   d.getMonth() + 1,
      revenue: 0,
      opex:    0,
      profit:  0,
    });
  }
  function keyOf(y, m) { return y * 100 + m; }
  var trailingKeys = {};
  for (var ti = 0; ti < months.length; ti++) {
    trailingKeys[keyOf(months[ti].year, months[ti].month)] = months[ti];
  }

  // Один проход по «Касса_операции».
  var capexTotal       = 0;
  var allTimeNetProfit = 0; // Σ revenue − Σ opex по ВСЕМ месяцам существования проекта.

  var values = opsSheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var dt  = parseDate(row[1]);
    if (!dt) continue;
    var amt = cellNum_(row[4]);
    if (amt === null) continue;
    var klass = String(row[12] || '').trim().toLowerCase();

    if (klass === 'capex') {
      capexTotal += amt;
      continue;
    }
    if (klass !== 'revenue' && klass !== 'opex') continue; // transfer / deposit / прочее — игнор.

    if (klass === 'revenue') allTimeNetProfit += amt;
    else                     allTimeNetProfit -= amt;

    var bucket = trailingKeys[keyOf(dt.getFullYear(), dt.getMonth() + 1)];
    if (bucket) {
      if (klass === 'revenue') bucket.revenue += amt;
      else                     bucket.opex    += amt;
    }
  }

  var cumulativeProfit = 0;
  for (var mi = 0; mi < months.length; mi++) {
    months[mi].profit = months[mi].revenue - months[mi].opex;
    cumulativeProfit += months[mi].profit;
  }

  // Завершённые месяцы: окно БЕЗ последнего (текущего неполного).
  // months имеет длину 12; срезы slice(-7,-1) и slice(-4,-1) дают 6 и 3 месяца соответственно.
  var last6Completed = months.slice(-7, -1);
  var last3Completed = months.slice(-4, -1);

  function hasActivity(m) { return m.revenue > 0 || m.opex > 0; }

  // avgProfit по месяцам С активностью.
  var active6 = last6Completed.filter(hasActivity);
  var avgProfit = 0;
  if (active6.length > 0) {
    var sumP = 0;
    for (var ai = 0; ai < active6.length; ai++) sumP += active6[ai].profit;
    avgProfit = sumP / active6.length;
  }

  // paybackMonths:
  //   avgProfit ≤ 0       → null (не окупается / нет данных)
  //   уже окупилось       → 0
  //   иначе               → ceil(остаток / avgProfit)
  var paybackMonths;
  if (avgProfit > 0) {
    var remaining = capexTotal - allTimeNetProfit;
    paybackMonths = remaining > 0 ? Math.ceil(remaining / avgProfit) : 0;
  } else {
    paybackMonths = null;
  }

  // forecastNextMonth: 3 последних ЗАВЕРШЁННЫХ, фильтр по активности.
  var active3 = last3Completed.filter(hasActivity);
  var avgRev = 0, avgOpex = 0;
  if (active3.length > 0) {
    var sumR = 0, sumO = 0;
    for (var fi = 0; fi < active3.length; fi++) {
      sumR += active3[fi].revenue;
      sumO += active3[fi].opex;
    }
    avgRev  = sumR / active3.length;
    avgOpex = sumO / active3.length;
  }
  var forecastNextMonth = Math.round(avgRev - avgOpex);

  return {
    trailing12: months,
    cumulativeProfit: cumulativeProfit,
    capexTotal: capexTotal,
    paybackMonths: paybackMonths,
    forecastNextMonth: forecastNextMonth,
  };
}

function getDashboardData() {
  return handleGetDashboard(SpreadsheetApp.openById(SS_ID));
}

function handleUpdatePeriod(ss, body) {
  var sheet = ss.getSheetByName('\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
  if (!sheet) {
    logFailure(ss, 'UPDATE_PERIOD', 'SHEET_NOT_FOUND', '\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
    return err('SHEET_NOT_FOUND');
  }

  if (body.allTime === true) {
    sheet.getRange('E99').setValue('ALL');
    return ok({});
  }

  var year  = Number(body.year);
  var month = Number(body.month);
  if (!year || month < 1 || month > 12) return err('INVALID_PERIOD');

  sheet.getRange('E99').clearContent();
  sheet.getRange('B2').setValue(year);
  sheet.getRange('B3').setValue(month);
  return ok({});
}

// -----------------------------------------------------------------------------
// GET_FLEET
// -----------------------------------------------------------------------------

function handleGetFleet(ss) {
  const sheet = ss.getSheetByName('\u041c\u0430\u0448\u0438\u043d\u044b');
  if (!sheet) {
    logFailure(ss, 'GET_FLEET', 'SHEET_NOT_FOUND', '\u041c\u0430\u0448\u0438\u043d\u044b');
    return err('SHEET_NOT_FOUND');
  }
  var values = sheet.getDataRange().getValues();
  var fleet = [];
  for (var i = 1; i < values.length; i++) {
    var row   = values[i];
    var carId = row[0];
    if (carId === '' || carId === null || carId === undefined) continue;
    fleet.push({
      carId:     String(carId).trim(),
      name:      row[1] != null ? String(row[1]) : '',
      color:     row[2] != null ? String(row[2]) : '',
      status:    row[3] != null ? String(row[3]).trim() : '',
      dateBuy:   row[4],
      priceBuy:  cellNum_(row[5]),
      rateDay:   cellNum_(row[6]),
      note:      row[7] != null ? String(row[7]) : '',
      mileage:   cellNum_(row[8]),
      toMileage: cellNum_(row[9]),
    });
  }
  return ok({ fleet });
}

// -----------------------------------------------------------------------------
// GET_DRIVERS
// -----------------------------------------------------------------------------

function _rentalNum(rentalId) {
  var m = String(rentalId).match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function handleGetDrivers(ss) {
  var dSheet = ss.getSheetByName(SHEET.DRIVERS);
  var rSheet = ss.getSheetByName(SHEET.RENTALS);
  var cSheet = ss.getSheetByName(SHEET.CARS);

  if (!dSheet || !rSheet || !cSheet) {
    logFailure(ss, 'GET_DRIVERS', 'SHEET_NOT_FOUND', 'DRIVERS/RENTALS/CARS');
    return err('SHEET_NOT_FOUND');
  }

  var statusRent = '\u0432 \u0430\u0440\u0435\u043d\u0434\u0435';

  var cVals = cSheet.getDataRange().getValues();
  var rentedCars = {};
  for (var ci = 1; ci < cVals.length; ci++) {
    var carStatus = String(cVals[ci][3] || '').trim();
    var carId = String(cVals[ci][0] || '').trim();
    if (carId && carStatus === statusRent) {
      rentedCars[carId] = true;
    }
  }

  var rVals = rSheet.getDataRange().getValues();
  var carToDriver = {};

  for (var ri = 1; ri < rVals.length; ri++) {
    var rw = rVals[ri];
    var rCarId = String(rw[1] || '').trim();
    var rDriverId = String(rw[2] || '').trim();

    if (!rentedCars[rCarId]) continue;
    if (!rDriverId) continue;

    var rDateStart = parseDate(rw[3]);
    var rTs = rDateStart ? rDateStart.getTime() : 0;

    if (!carToDriver[rCarId]
      || rTs > carToDriver[rCarId].ts
      || (rTs === carToDriver[rCarId].ts && _rentalNum(rw[0]) > carToDriver[rCarId].num)) {
      carToDriver[rCarId] = { driverId: rDriverId, ts: rTs, num: _rentalNum(rw[0]) };
    }
  }

  var driverToCar = {};
  for (var cid in carToDriver) {
    if (!carToDriver.hasOwnProperty(cid)) continue;
    var did = carToDriver[cid].driverId;
    driverToCar[did] = cid;
  }

  var dVals = dSheet.getDataRange().getValues();
  var out = [];

  for (var di = 1; di < dVals.length; di++) {
    var row = dVals[di];
    var driverId = String(row[0] || '').trim();
    if (!driverId) continue;

    var depNum = cellNum_(row[5]);
    out.push({
      driverId:   driverId,
      name:       row[1] != null ? String(row[1]) : '',
      phone:      row[2] != null ? String(row[2]) : '',
      license:    row[3] != null ? String(row[3]) : '',
      status:     row[4] != null ? String(row[4]).trim() : '',
      deposit:    depNum !== null ? depNum : 0,
      note:       row[6] != null ? String(row[6]) : '',
      currentCar: driverToCar[driverId] || null,
    });
  }

  return ok({ drivers: out });
}

function handleDebugDrivers(ss) {
  var dSheet = ss.getSheetByName('\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u0438');
  if (!dSheet) return err('SHEET_NOT_FOUND');
  var rows = dSheet.getDataRange().getValues();
  var result = rows.slice(1, 6).map(function(row) {
    return {
      driverId:     row[0],
      status_raw:   row[4],
      status_type:  typeof row[4],
      status_length: String(row[4]).length,
      status_charCodes: Array.from(String(row[4])).map(function(c) { return c.charCodeAt(0); }),
    };
  });
  return ContentService
    .createTextOutput(JSON.stringify({ rows: result }))
    .setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// GET_INCOME_FORM
// -----------------------------------------------------------------------------

function handleGetIncomeForm(ss) {
  var carsSheet = ss.getSheetByName(SHEET.CARS);
  var rentSheet = ss.getSheetByName(SHEET.RENTALS);
  if (!carsSheet || !rentSheet) {
    logFailure(ss, 'GET_INCOME_FORM', 'SHEET_NOT_FOUND', 'CARS/RENTALS');
    return err('SHEET_NOT_FOUND');
  }

  var statusRent = '\u0432 \u0430\u0440\u0435\u043d\u0434\u0435';
  var cVals      = carsSheet.getDataRange().getValues();
  var rentedIds  = {};

  for (var ci = 1; ci < cVals.length; ci++) {
    var st = String(cVals[ci][3] != null ? cVals[ci][3] : '').trim();
    if (st === statusRent) {
      var id = String(cVals[ci][0] != null ? cVals[ci][0] : '').trim();
      if (id) rentedIds[id] = true;
    }
  }

  var rVals  = rentSheet.getDataRange().getValues();
  var maxEnd = {};

  for (var rj = 1; rj < rVals.length; rj++) {
    var carId = String(rVals[rj][1] != null ? rVals[rj][1] : '').trim();
    if (!carId || !rentedIds[carId]) continue;
    var endRaw = rVals[rj][4];
    var endDt  = parseDate(endRaw);
    if (!endDt) continue;
    var bonus  = Number(rVals[rj][9]) || 0;
    if (bonus > 0) {
      endDt = new Date(endDt.getTime() + bonus * 86400000);
    }
    var ts = endDt.getTime();
    if (!maxEnd[carId] || ts > maxEnd[carId]) maxEnd[carId] = ts;
  }

  var out = [];
  for (var cid in rentedIds) {
    if (!rentedIds.hasOwnProperty(cid)) continue;
    var ms      = maxEnd[cid];
    var lastStr = '';
    if (ms) {
      lastStr = Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    }
    out.push({ carId: cid, lastPaidDate: lastStr });
  }
  return ok({ incomeForm: out });
}

// -----------------------------------------------------------------------------
// SAVE_RENTAL_PROMISE — лист «Аренда»: H = promised_until, I = promised_at
// -----------------------------------------------------------------------------

/**
 * Последняя строка аренды по машине: макс. дата_окончания (колонка E), затем больший суффикс rental_id.
 * @returns {{ sheet: GoogleAppsScript.Spreadsheet.Sheet|null, row: number }} row — 1-based или 0
 */
function findLastRentalRowNumberForCar_(ss, carId) {
  var sheet = ss.getSheetByName(SHEET.RENTALS);
  if (!sheet) return { sheet: null, row: 0 };
  var needle = String(carId || '').trim();
  var data = sheet.getDataRange().getValues();
  var bestRow = 0;
  var bestTs = -1;
  var bestNum = -1;
  for (var i = 1; i < data.length; i++) {
    var rCar = String(data[i][1] != null ? data[i][1] : '').trim();
    if (rCar !== needle) continue;
    var endDt = parseDate(data[i][4]);
    var ts = endDt ? endDt.getTime() : 0;
    var rn = _rentalNum(data[i][0]);
    if (ts > bestTs || (ts === bestTs && rn > bestNum)) {
      bestTs = ts;
      bestNum = rn;
      bestRow = i + 1;
    }
  }
  return { sheet: sheet, row: bestRow };
}

function clearRentalPromiseFieldsForCar_(ss, carId) {
  var f = findLastRentalRowNumberForCar_(ss, carId);
  if (!f.sheet || !f.row) return;
  f.sheet.getRange(f.row, 8, f.row, 9).clearContent();
}

function handleSaveRentalPromise(ss, body) {
  var car_id = String(body.car_id || '').trim();
  if (!car_id) return err('MISSING_FIELD: car_id');

  var rawPu = body.promised_until;
  var clear = rawPu === '' || rawPu === null || rawPu === undefined;

  var found = findLastRentalRowNumberForCar_(ss, car_id);
  if (!found.sheet || !found.row) {
    logFailure(ss, 'SAVE_RENTAL_PROMISE', 'ROW_NOT_FOUND', car_id);
    return err('RENTAL_ROW_NOT_FOUND');
  }

  if (clear) {
    found.sheet.getRange(found.row, 8, found.row, 9).clearContent();
    return ok({ cleared: true });
  }

  var pu = String(rawPu).trim();
  var parts = pu.split('.');
  if (parts.length !== 3) return err('BAD_DATE_FORMAT');

  var jsDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  if (isNaN(jsDate.getTime())) return err('BAD_DATE');

  found.sheet.getRange(found.row, 8).setValue(jsDate);
  found.sheet.getRange(found.row, 8).setNumberFormat('dd.MM.yyyy');

  found.sheet.getRange(found.row, 9).setValue(formatDateTime(new Date()));

  return ok({ updated: true, row: found.row });
}

// -----------------------------------------------------------------------------
// SAVE_BONUS_DAYS — лист «Аренда»: J = bonus_days, K = bonus_reason
// -----------------------------------------------------------------------------

function handleSaveBonusDays(ss, body) {
  var car_id = String(body.car_id || '').trim();
  if (!car_id) return err('MISSING_FIELD: car_id');

  var addDays = Number(body.bonus_days);
  if (!Number.isInteger(addDays) || addDays <= 0) return err('INVALID_BONUS_DAYS');

  var found = findLastRentalRowNumberForCar_(ss, car_id);
  if (!found.sheet || !found.row) {
    logFailure(ss, 'SAVE_BONUS_DAYS', 'RENTAL_ROW_NOT_FOUND', car_id);
    return err('RENTAL_ROW_NOT_FOUND');
  }

  var current = Number(found.sheet.getRange(found.row, 10).getValue()) || 0;
  var newTotal = current + addDays;
  found.sheet.getRange(found.row, 10).setValue(newTotal);
  found.sheet.getRange(found.row, 11).setValue(String(body.bonus_reason || ''));

  return ok({ bonus_days_total: newTotal });
}

// -----------------------------------------------------------------------------
// ADD_INCOME (атомарная запись: касса + аренда)
// -----------------------------------------------------------------------------

function deleteOperationRowByOpId_(ss, opId) {
  var sheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  for (var ri = 1; ri < data.length; ri++) {
    if (String(data[ri][0]) === String(opId)) {
      sheet.deleteRow(ri + 1);
      return true;
    }
  }
  return false;
}

function parseContentJson_(textOutput) {
  return JSON.parse(textOutput.getContent());
}

function handleAddIncome(ss, body) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (eLock) { return err('LOCK_TIMEOUT'); }

  try {
    var car_id    = body.car_id;
    var driver_id = body.driver_id;
    var amount    = body.amount;
    var date_from = body.date_from;
    var date_to   = body.date_to;
    var rate      = body.rate;
    var comment   = body.comment || '';
    var kassa_id  = body.kassa_id || 'K_AZAMAT';
    var provel    = body.provel   || '\u0410\u0437\u0430\u043c\u0430\u0442';

    if (!car_id)                                          return err('MISSING: car_id');
    if (!driver_id)                                       return err('MISSING: driver_id');
    if (amount === undefined || amount === null || amount === '') return err('MISSING: amount');
    if (!date_from)                                       return err('MISSING: date_from');
    if (!date_to)                                         return err('MISSING: date_to');

    clearRentalPromiseFieldsForCar_(ss, car_id);

    var opOut = handleAddOperation(ss, {
      date:      formatDate(new Date()),
      kassa_id:  String(kassa_id),
      direction: '\u043f\u0440\u0438\u0445\u043e\u0434',
      amount:    Number(amount),
      type:      '\u0430\u0440\u0435\u043d\u0434\u0430',
      category:  '',
      car_id,
      driver_id,
      comment,
      provel: String(provel),
    });

    var opData = parseContentJson_(opOut);
    if (opData.error === true || opData.status === 'error') {
      return err('OP_FAILED: ' + (opData.message || ''));
    }
    var op_id = opData.op_id;

    var rentalOut = handleAddRental(ss, {
      car_id,
      driver_id,
      date_start: date_from,
      date_end:   date_to,
      rate_day:   rate,
      comment,
    });

    var rentalData = parseContentJson_(rentalOut);
    if (rentalData.error === true || rentalData.status === 'error') {
      deleteOperationRowByOpId_(ss, op_id);
      return err('RENTAL_FAILED: ' + (rentalData.message || ''));
    }

    return ok({ op_id, rental_id: rentalData.rental_id });
  } finally {
    lock.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// Локальные тесты
// -----------------------------------------------------------------------------

function testAll() {
  const ss = SpreadsheetApp.openById(SS_ID);
  Logger.log('=== testAll START ===');

  const sheet  = ss.getSheetByName(SHEET.OPERATIONS);
  const nextId = getNextId(sheet, 'CO');
  Logger.log('\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 op_id: ' + nextId);
  Logger.log('formatDate(new Date()): ' + formatDate(new Date()));

  const serial = dateToExcelSerial('02.05.2026');
  Logger.log('dateToExcelSerial("02.05.2026"): ' + serial + ' (\u043e\u0436\u0438\u0434\u0430\u0435\u043c ~45749)');

  const sheets = [
    { name: SHEET.OPERATIONS, prefix: 'CO' },
    { name: SHEET.DRIVERS,    prefix: 'D'  },
    { name: SHEET.DEPOSITS,   prefix: 'DP' },
    { name: SHEET.RENTALS,    prefix: 'R'  },
  ];
  sheets.forEach(({ name, prefix }) => {
    const s = ss.getSheetByName(name);
    if (s) {
      Logger.log('getNextId("' + name + '", "' + prefix + '"): ' + getNextId(s, prefix));
    } else {
      Logger.log('\u043f\u0440\u043e\u043f\u0443\u0441\u043a: \u043b\u0438\u0441\u0442 "' + name + '" \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d');
    }
  });

  Logger.log('=== testAll END ===');
}

/**
 * Быстрая проверка ответа handleGetDashboard для вкладки Overview.
 * Запускать вручную из редактора Apps Script: Run → testOverviewDashboard.
 */
function testOverviewDashboard() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const out = handleGetDashboard(ss);
  const parsed = JSON.parse(out.getContent());
  const dash = parsed.dashboard || {};
  const t12 = dash.trailing12 || [];

  Logger.log('=== testOverviewDashboard START ===');
  Logger.log('status: ' + parsed.status);
  Logger.log('period: ' + dash.year + '-' + dash.month + ' (allTime=' + dash.allTime + ')');
  Logger.log('trailing12 length: ' + t12.length);
  Logger.log('trailing12 first: ' + JSON.stringify(t12[0]));
  Logger.log('trailing12 last:  ' + JSON.stringify(t12[t12.length - 1]));
  Logger.log('cumulativeProfit (за 12 мес): ' + dash.cumulativeProfit);
  Logger.log('capexTotal (за всё время): ' + dash.capexTotal);
  Logger.log('paybackMonths: ' + dash.paybackMonths
    + '  // null = не окупается, 0 = уже окупилось, N>0 = месяцев осталось');
  Logger.log('forecastNextMonth: ' + dash.forecastNextMonth);
  Logger.log('summary entries: ' + (dash.summary || []).length);
  Logger.log('opex entries: ' + (dash.opex || []).length);
  Logger.log('pnl entries: ' + (dash.pnl || []).length);
  Logger.log('=== testOverviewDashboard END ===');
}

function testKassaTurnover() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var t = computeKassaTurnover_(ss, 2026, 4, false);
  Logger.log('April: ' + JSON.stringify(t));
  var tAll = computeKassaTurnover_(ss, null, null, true);
  Logger.log('All time: ' + JSON.stringify(tAll));
  var yulia = null;
  for (var j = 0; j < tAll.length; j++) {
    if (String(tAll[j].kassaId || '').trim() === 'K_YULIA') {
      yulia = tAll[j];
      break;
    }
  }
  Logger.log('K_YULIA all-time (no transfer/capex): ' + (yulia ? JSON.stringify(yulia) : 'not in list'));
}

function testPnlExtras() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var byCar = computePnlByCarMonthly_(ss, new Date());
  Logger.log('pnlByCarMonthly cars: ' + Object.keys(byCar).length);
  var keys = Object.keys(byCar);
  var maxS = Math.min(3, keys.length);
  for (var si = 0; si < maxS; si++) {
    var carId = keys[si];
    Logger.log(carId + ': ' + JSON.stringify(byCar[carId]));
  }
  var util = computeUtilizationByCar_(ss, 2026, 4, false, new Date());
  Logger.log('utilizationByCar (April 2026): ' + JSON.stringify(util));
}
