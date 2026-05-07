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
      case 'UPDATE_PERIOD':     return handleUpdatePeriod(SS, body);
      case 'GET_FLEET':         return handleGetFleet(SS);
      case 'GET_DRIVERS':       return handleGetDrivers(SS);
      case 'GET_INCOME_FORM':   return handleGetIncomeForm(SS);
      case 'ADD_INCOME':        return handleAddIncome(SS, body);
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

  sheet.appendRow([
    op_id, date, kassa_id, direction, Number(amount),
    type, category, car_id, driver_id, comment, provel,
    class_override, finalClass,
  ]);

  return ok({ op_id });
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

  sheet.appendRow([rental_id, car_id, driver_id, serialStart, serialEnd, Number(rate_day), comment]);

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

function handleGetDashboard(ss) {
  const sheet = ss.getSheetByName('\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
  if (!sheet) {
    logFailure(ss, 'GET_DASHBOARD', 'SHEET_NOT_FOUND', '\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
    return err('SHEET_NOT_FOUND');
  }

  const year  = Number(sheet.getRange('B2').getValue()) || new Date().getFullYear();
  const month = Number(sheet.getRange('B3').getValue()) || (new Date().getMonth() + 1);
  // Маркер UI «Всё время» (E99); при необходимости подключите к формулам листа.
  var periodAllRaw = sheet.getRange('E99').getValue();
  var allTime = String(periodAllRaw || '').trim().toUpperCase() === 'ALL';

  const summaryLabels = ['\u0412\u044b\u0440\u0443\u0447\u043a\u0430', 'OPEX', 'CAPEX', '\u041f\u0440\u0438\u0431\u044b\u043b\u044c'];
  const summaryKeys   = ['revenue', 'opex', 'capex', 'profit'];
  const sumVals = sheet.getRange(10, 2, 13, 3).getValues();
  var summary = [];
  for (var si = 0; si < 4; si++) {
    summary.push({
      key:      summaryKeys[si],
      label:    summaryLabels[si],
      current:  cellNum_(sumVals[si][0]),
      previous: cellNum_(sumVals[si][1]),
    });
  }

  var opexRaw = sheet.getRange(17, 1, 26, 3).getValues();
  var opex = [];
  for (var oi = 0; oi < opexRaw.length; oi++) {
    var name = String(opexRaw[oi][0] || '').trim();
    if (!name) continue;
    var amt      = cellNum_(opexRaw[oi][1]);
    var shareRaw = opexRaw[oi][2];
    var share    = cellNum_(shareRaw);
    if (share !== null && share > 1) share = share / 100;
    opex.push({ name, amount: amt !== null ? amt : 0, share: share !== null ? share : null });
  }

  var pnlRaw = sheet.getRange(30, 1, 44, 4).getValues();
  var pnl = [];
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
  var utilization = [];
  for (var ui = 0; ui < utilRaw.length; ui++) {
    var carU   = String(utilRaw[ui][0] || '').trim();
    if (!carU) continue;
    var pctRaw = cellNum_(utilRaw[ui][1]);
    var pct    = pctRaw;
    if (pct !== null && pct >= 0 && pct <= 1) pct = pct * 100;
    utilization.push({ car: carU, pct });
  }

  return ok({ dashboard: { year, month, allTime: allTime, summary, opex, pnl, utilization } });
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

    var opOut = handleAddOperation(ss, {
      date:      formatDate(new Date()),
      kassa_id:  String(kassa_id),
      direction: '\u043f\u0440\u0438\u0445\u043e\u0434',
      amount:    Number(amount),
      type:      '\u0430\u0440\u0435\u043d\u0434\u0430',
      category:  '\u0430\u0440\u0435\u043d\u0434\u0430',
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