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
  OPERATIONS: 'Касса_операции',
  CARS:       'Машины',
  DRIVERS:    'Водители',
  RENTALS:    'Аренда',
  DEPOSITS:   'Депозиты_операции',
  USERS:      'Пользователи',
  FAIL_LOG:   'Лог_ошибок',
  DASHBOARD:  'Дашборд',
};

// -----------------------------------------------------------------------------
// Утилиты ответа
// -----------------------------------------------------------------------------

/**
 * Отдаёт JSON-тело для веб-хука.
 * @param {object} payload
 */
function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Успешный ответ.
 * @param {object} data
 */
function ok(data) {
  return jsonOut({ status: 'ok', ...data });
}

/**
 * Ошибка без throw — doPost всегда возвращает JSON.
 * @param {string} message
 */
function err(message) {
  return jsonOut({ error: true, status: 'error', message: String(message || 'UNKNOWN_ERROR') });
}

/**
 * Запись строки в лист Лог_ошибок.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} action
 * @param {string} code
 * @param {string} reason
 */
function logFailure(ss, action, code, reason) {
  try {
    const sheet = ss.getSheetByName(SHEET.FAIL_LOG);
    if (!sheet) return;
    sheet.appendRow([formatDate(new Date()), '', action, code, reason]);
  } catch (_) {}
}

/**
 * Разбор POST: JSON в теле или в form поле data (URLSearchParams с ключом data).
 */
function parseRequestBody_(e) {
  if (!e) return {};
  if (e.parameter && e.parameter.data) {
    try {
      return JSON.parse(e.parameter.data);
    } catch (_) {}
  }
  if (!e.postData || !e.postData.contents) return {};
  var c = String(e.postData.contents).trim();
  if (c.charAt(0) === '{') {
    try {
      return JSON.parse(c);
    } catch (_) {}
  }
  var pairs = c.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var kv = pairs[i].split('=');
    if (kv.length < 2) continue;
    if (decodeURIComponent(kv[0]) === 'data') {
      try {
        return JSON.parse(decodeURIComponent(kv[1].replace(/\+/g, ' ')));
      } catch (_) {}
    }
  }
  return {};
}

function cellNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// -----------------------------------------------------------------------------
// Маршрутизация POST
// -----------------------------------------------------------------------------

function doPost(e) {
  try {
    const ss = SpreadsheetApp.openById(SS_ID);
    const body = parseRequestBody_(e);
    const action = body.action || 'ADD_OPERATION';

    // Отладка: список имён листов (локально)
    if (action === 'DEBUG_SHEETS') {
      const names = ss.getSheets().map(function (s) { return s.getName(); });
      return ContentService
        .createTextOutput(JSON.stringify({ sheets: names }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (action) {
      case 'ADD_OPERATION':     return handleAddOperation(ss, body);
      case 'UPDATE_CAR_STATUS': return handleUpdateCarStatus(ss, body);
      case 'SAVE_DRIVER':       return handleSaveDriver(ss, body);
      case 'ADD_DEPOSIT':       return handleAddDeposit(ss, body);
      case 'ADD_RENTAL':        return handleAddRental(ss, body);
      case 'GET_DASHBOARD':     return handleGetDashboard();
      case 'UPDATE_PERIOD':     return handleUpdatePeriod(ss, body);
      case 'GET_FLEET':         return handleGetFleet();
      case 'GET_DRIVERS':       return handleGetDrivers();
      default:
        logFailure(ss, action, 'UNKNOWN_ACTION', 'Action not implemented');
        return err('UNKNOWN_ACTION');
    }
  } catch (ex) {
    try {
      const ss = SpreadsheetApp.openById(SS_ID);
      logFailure(ss, 'doPost', 'EXCEPTION', String(ex && ex.message ? ex.message : ex));
    } catch (_) {}
    return err(ex && ex.message ? ex.message : ex);
  }
}

// -----------------------------------------------------------------------------
// ADD_OPERATION
// -----------------------------------------------------------------------------

/**
 * Поля: date, kassa_id, direction (приход/расход/перевод),
 *       amount, type, category, car_id, driver_id, comment, provel
 */
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

  // Класс для сводки (согласовано с add.js: type = категория)
  let klass_itog;
  const typeLower = String(type).toLowerCase();
  const dirStr = String(direction || '');
  if (typeLower.startsWith('аренда') || typeLower === 'аренда') {
    klass_itog = 'revenue';
  } else if (dirStr === 'перевод') {
    klass_itog = 'transfer';
  } else if (typeLower.startsWith('депозит')) {
    klass_itog = 'deposit';
  } else if (dirStr === 'расход') {
    klass_itog = 'opex';
  } else {
    klass_itog = 'revenue';
  }

  // Итог: class_override или авто-класс
  const finalClass = class_override || klass_itog;

  // A  B      C         D          E       F     G         H       I          J        K       L               M
  // id дата  kassa_id  направление сумма  тип   категория car_id  driver_id  комм.   провёл  class_override  class_final
  sheet.appendRow([
    op_id, date, kassa_id, direction, Number(amount),
    type, category, car_id, driver_id, comment, provel,
    class_override, finalClass,
  ]);

  return ok({ op_id });
}

// -----------------------------------------------------------------------------
// UPDATE_CAR_STATUS
// -----------------------------------------------------------------------------

/**
 * Поля: car_id, new_status
 * Ожидаемые статусы: 'в аренде' | 'в ремонте' | 'простой'
 */
function handleUpdateCarStatus(ss, body) {
  const { car_id, new_status } = body;
  if (!car_id)    return err('MISSING_FIELD: car_id');
  if (!new_status) return err('MISSING_FIELD: new_status');

  const sheet = ss.getSheetByName(SHEET.CARS);
  if (!sheet) {
    logFailure(ss, 'UPDATE_CAR_STATUS', 'SHEET_NOT_FOUND', SHEET.CARS);
    return err('SHEET_NOT_FOUND');
  }

  const data    = sheet.getDataRange().getValues();
  const rowIdx  = data.findIndex((row, i) => i > 0 && String(row[0]) === String(car_id));

  if (rowIdx === -1) {
    logFailure(ss, 'UPDATE_CAR_STATUS', 'CAR_NOT_FOUND', car_id);
    return err('CAR_NOT_FOUND');
  }

  // Колонка D (индекс 4) — статус
  sheet.getRange(rowIdx + 1, 4).setValue(new_status);

  return ok({ car_id, new_status });
}

// -----------------------------------------------------------------------------
// SAVE_DRIVER
// -----------------------------------------------------------------------------

/**
 * Поля: driver_id (пусто = создать), fio, phone,
 *       vu, car_id, status, comment
 */
function handleSaveDriver(ss, body) {
  const {
    driver_id = '', fio = '', phone = '',
    vu = '', car_id = '', status = 'активен', comment = '',
  } = body;

  const sheet = ss.getSheetByName(SHEET.DRIVERS);
  if (!sheet) {
    logFailure(ss, 'SAVE_DRIVER', 'SHEET_NOT_FOUND', SHEET.DRIVERS);
    return err('SHEET_NOT_FOUND');
  }

  // Новый водитель
  if (!driver_id) {
    const newId = getNextId(sheet, 'D');

    // A         B    C      D   E       F(депозит)  G
    // driver_id ФИО  телефон ВУ статус  0           комментарий
    sheet.appendRow([newId, fio, phone, vu, status, 0, comment]);

    // Привязка машины — статус авто
    if (car_id) {
      handleUpdateCarStatus(ss, { car_id, new_status: 'в аренде' });
    }

    return ok({ driver_id: newId });
  }

  // Обновление строки
  const data   = sheet.getDataRange().getValues();
  const rowIdx = data.findIndex((row, i) => i > 0 && String(row[0]) === String(driver_id));

  if (rowIdx === -1) {
    logFailure(ss, 'SAVE_DRIVER', 'DRIVER_NOT_FOUND', driver_id);
    return err('DRIVER_NOT_FOUND');
  }

  const sheetRow = rowIdx + 1;
  // Колонки B–E и G (F — депозит, не трогаем здесь)
  sheet.getRange(sheetRow, 2, 1, 4).setValues([[fio, phone, vu, status]]);
  sheet.getRange(sheetRow, 7).setValue(comment);

  return ok({ driver_id });
}

// -----------------------------------------------------------------------------
// ADD_DEPOSIT
// -----------------------------------------------------------------------------

/**
 * Поля: driver_id, car_id, amount, comment
 */
function handleAddDeposit(ss, body) {
  const { driver_id, car_id = '', amount, comment = '' } = body;

  if (!driver_id) return err('MISSING_FIELD: driver_id');
  if (amount === undefined || amount === null) return err('MISSING_FIELD: amount');

  const depSheet    = ss.getSheetByName(SHEET.DEPOSITS);
  const driverSheet = ss.getSheetByName(SHEET.DRIVERS);

  if (!depSheet)    return err('SHEET_NOT_FOUND: ' + SHEET.DEPOSITS);
  if (!driverSheet) return err('SHEET_NOT_FOUND: ' + SHEET.DRIVERS);

  const dep_op_id     = getNextId(depSheet, 'DP');
  const status_src    = Number(amount) > 0 ? 'приход' : 'расход';
  const today         = formatDate(new Date());

  // A          B      C          D       E       F                 G
  // dep_op_id  дата   driver_id  car_id  сумма   статус_исходный  комментарий
  depSheet.appendRow([dep_op_id, today, driver_id, car_id, Number(amount), status_src, comment]);

  // Обновить депозит_текущий у водителя (колонка F, индекс 5)
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

/**
 * Поля: car_id, driver_id, date_start (DD.MM.YYYY),
 *       date_end (DD.MM.YYYY), rate_day, comment
 */
function handleAddRental(ss, body) {
  const {
    car_id, driver_id, date_start, date_end,
    rate_day, comment = '',
  } = body;

  if (!car_id)     return err('MISSING_FIELD: car_id');
  if (!driver_id)  return err('MISSING_FIELD: driver_id');
  if (!date_start) return err('MISSING_FIELD: date_start');
  if (!date_end)   return err('MISSING_FIELD: date_end');
  if (!rate_day && rate_day !== 0) return err('MISSING_FIELD: rate_day');

  const sheet = ss.getSheetByName(SHEET.RENTALS);
  if (!sheet) {
    logFailure(ss, 'ADD_RENTAL', 'SHEET_NOT_FOUND', SHEET.RENTALS);
    return err('SHEET_NOT_FOUND');
  }

  const rental_id    = getNextId(sheet, 'R');
  const serialStart  = dateToExcelSerial(date_start);
  const serialEnd    = dateToExcelSerial(date_end);

  // A          B       C          D             E             F            G
  // rental_id  car_id  driver_id  дата_начала   дата_окончания ставка_день комментарий
  sheet.appendRow([rental_id, car_id, driver_id, serialStart, serialEnd, Number(rate_day), comment]);

  // Формат дат в колонках D и E
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 4).setNumberFormat('DD.MM.YYYY');
  sheet.getRange(newRow, 5).setNumberFormat('DD.MM.YYYY');

  // Машина в аренде
  handleUpdateCarStatus(ss, { car_id, new_status: 'в аренде' });

  return ok({ rental_id });
}

// -----------------------------------------------------------------------------
// Дашборд (лист «Дашборд») — GET_DASHBOARD, UPDATE_PERIOD
// -----------------------------------------------------------------------------

/**
 * Читает период из ячеек B2:B3 и блоки данных для экрана аналитики.
 * Opens SS_ID and sheet by name locally (no global SHEET.* for this path).
 */
function handleGetDashboard() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName('\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
  if (!sheet) {
    logFailure(ss, 'GET_DASHBOARD', 'SHEET_NOT_FOUND', '\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
    return err('SHEET_NOT_FOUND');
  }

  const year = Number(sheet.getRange('B2').getValue()) || new Date().getFullYear();
  const month = Number(sheet.getRange('B3').getValue()) || (new Date().getMonth() + 1);

  const summaryLabels = ['Выручка', 'OPEX', 'CAPEX', 'Прибыль'];
  const summaryKeys = ['revenue', 'opex', 'capex', 'profit'];
  const sumVals = sheet.getRange(10, 2, 13, 3).getValues();
  var summary = [];
  for (var si = 0; si < 4; si++) {
    summary.push({
      key: summaryKeys[si],
      label: summaryLabels[si],
      current: cellNum_(sumVals[si][0]),
      previous: cellNum_(sumVals[si][1]),
    });
  }

  var opexRaw = sheet.getRange(17, 1, 26, 3).getValues();
  var opex = [];
  for (var oi = 0; oi < opexRaw.length; oi++) {
    var name = String(opexRaw[oi][0] || '').trim();
    if (!name) continue;
    var amt = cellNum_(opexRaw[oi][1]);
    var shareRaw = opexRaw[oi][2];
    var share = cellNum_(shareRaw);
    if (share !== null && share > 1) share = share / 100;
    opex.push({
      name: name,
      amount: amt !== null ? amt : 0,
      share: share !== null ? share : null,
    });
  }

  var pnlRaw = sheet.getRange(30, 1, 44, 4).getValues();
  var pnl = [];
  for (var pi = 0; pi < pnlRaw.length; pi++) {
    var carName = String(pnlRaw[pi][0] || '').trim();
    if (!carName) continue;
    pnl.push({
      car: carName,
      revenue: cellNum_(pnlRaw[pi][1]) !== null ? cellNum_(pnlRaw[pi][1]) : 0,
      expense: cellNum_(pnlRaw[pi][2]) !== null ? cellNum_(pnlRaw[pi][2]) : 0,
      profit: cellNum_(pnlRaw[pi][3]) !== null ? cellNum_(pnlRaw[pi][3]) : 0,
    });
  }

  var utilRaw = sheet.getRange(47, 1, 70, 2).getValues();
  var utilization = [];
  for (var ui = 0; ui < utilRaw.length; ui++) {
    var carU = String(utilRaw[ui][0] || '').trim();
    if (!carU) continue;
    var pctRaw = cellNum_(utilRaw[ui][1]);
    var pct = pctRaw;
    if (pct !== null && pct >= 0 && pct <= 1) pct = pct * 100;
    utilization.push({ car: carU, pct: pct });
  }

  return ok({
    dashboard: {
      year: year,
      month: month,
      summary: summary,
      opex: opex,
      pnl: pnl,
      utilization: utilization,
    },
  });
}

/** Same payload as GET_DASHBOARD; use from Apps Script editor for smoke tests. */
function getDashboardData() {
  return handleGetDashboard();
}

/**
 * Записать год и месяц в B2:B3 на листе «Дашборд» (период для сводки).
 */
function handleUpdatePeriod(ss, body) {
  var year = Number(body.year);
  var month = Number(body.month);
  if (!year || month < 1 || month > 12) return err('INVALID_PERIOD');

  const dashSs = SpreadsheetApp.openById(SS_ID);
  var sheet = dashSs.getSheetByName('\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
  if (!sheet) {
    logFailure(dashSs, 'UPDATE_PERIOD', 'SHEET_NOT_FOUND', '\u0414\u0430\u0448\u0431\u043e\u0440\u0434');
    return err('SHEET_NOT_FOUND');
  }

  sheet.getRange('B2').setValue(year);
  sheet.getRange('B3').setValue(month);

  return ok({});
}

/**
 * Все машины с листа «Машины» (строка 1 — заголовки).
 * Колонки A–J: car_id, название, цвет, статус, дата_покупки, цена_покупки,
 * ставка_день, примечание, пробег ПО, ТО по пробегу.
 */
function handleGetFleet() {
  const ss = SpreadsheetApp.openById('1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg');
  const sheet = ss.getSheetByName('\u041c\u0430\u0448\u0438\u043d\u044b');
  if (!sheet) {
    logFailure(ss, 'GET_FLEET', 'SHEET_NOT_FOUND', '\u041c\u0430\u0448\u0438\u043d\u044b');
    return err('SHEET_NOT_FOUND');
  }
  var values = sheet.getDataRange().getValues();
  var fleet = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var carId = row[0];
    if (carId === '' || carId === null || carId === undefined) continue;
    fleet.push({
      carId: String(carId).trim(),
      name: row[1] != null ? String(row[1]) : '',
      color: row[2] != null ? String(row[2]) : '',
      status: row[3] != null ? String(row[3]).trim() : '',
      dateBuy: row[4],
      priceBuy: cellNum_(row[5]),
      rateDay: cellNum_(row[6]),
      note: row[7] != null ? String(row[7]) : '',
      mileage: cellNum_(row[8]),
      toMileage: cellNum_(row[9]),
    });
  }
  return ok({ fleet: fleet });
}

/**
 * GET_DRIVERS — листы «Водители» + «Аренда», активная аренда → currentCar (car_id).
 */
function parseCellDateForDrivers_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    var epoch = new Date(1899, 11, 30);
    return new Date(epoch.getTime() + v * 86400000);
  }
  var s = String(v).trim();
  var p = s.split('.');
  if (p.length === 3) {
    return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
  }
  return null;
}

function dayStartDrivers_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function handleGetDrivers() {
  var SS = '1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg';
  var ss = SpreadsheetApp.openById(SS);
  var dSheet = ss.getSheetByName('\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u0438');
  var rSheet = ss.getSheetByName('\u0410\u0440\u0435\u043d\u0434\u0430');
  if (!dSheet || !rSheet) {
    logFailure(ss, 'GET_DRIVERS', 'SHEET_NOT_FOUND', !dSheet ? '\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u0438' : '\u0410\u0440\u0435\u043d\u0434\u0430');
    return err('SHEET_NOT_FOUND');
  }
  var dVals = dSheet.getDataRange().getValues();
  var rVals = rSheet.getDataRange().getValues();
  var today = dayStartDrivers_(new Date());

  var rentalsByDriver = {};
  var ri;
  for (ri = 1; ri < rVals.length; ri++) {
    var rw = rVals[ri];
    var did = String(rw[2] || '').trim();
    if (!did) continue;
    if (!rentalsByDriver[did]) rentalsByDriver[did] = [];
    rentalsByDriver[did].push({
      carId: String(rw[1] || '').trim(),
      dateStart: parseCellDateForDrivers_(rw[3]),
      dateEndRaw: rw[4],
      dateEnd: parseCellDateForDrivers_(rw[4]),
    });
  }

  function currentCarForDriver_(driverId) {
    var list = rentalsByDriver[driverId] || [];
    var bestCar = null;
    var bestStartTs = -1;
    for (var j = 0; j < list.length; j++) {
      var r = list[j];
      var endEmpty = r.dateEndRaw === '' || r.dateEndRaw === null || r.dateEndRaw === undefined;
      var active = false;
      if (endEmpty) {
        active = true;
      } else if (r.dateEnd) {
        active = dayStartDrivers_(r.dateEnd).getTime() >= today.getTime();
      }
      if (!active) continue;
      var st = r.dateStart ? r.dateStart.getTime() : 0;
      if (st > bestStartTs) {
        bestStartTs = st;
        bestCar = r.carId ? String(r.carId) : null;
      }
    }
    return bestCar;
  }

  var out = [];
  for (var di = 1; di < dVals.length; di++) {
    var row = dVals[di];
    var driverId = String(row[0] || '').trim();
    if (!driverId) continue;
    var depNum = cellNum_(row[5]);
    out.push({
      driverId: driverId,
      name: row[1] != null ? String(row[1]) : '',
      phone: row[2] != null ? String(row[2]) : '',
      license: row[3] != null ? String(row[3]) : '',
      status: row[4] != null ? String(row[4]).trim() : '',
      deposit: depNum !== null && depNum !== undefined ? depNum : 0,
      note: row[6] != null ? String(row[6]) : '',
      currentCar: currentCarForDriver_(driverId),
    });
  }
  return ok({ drivers: out });
}

// -----------------------------------------------------------------------------
// Локальные тесты (запуск из редактора Apps Script)
// -----------------------------------------------------------------------------

function testAll() {
  const ss = SpreadsheetApp.openById(SS_ID);
  Logger.log('=== testAll START ===');

  // Тест ADD_OPERATION (тело без отправки)
  Logger.log('--- ADD_OPERATION ---');
  const fakePost = {
    postData: {
      contents: JSON.stringify({
        action:     'ADD_OPERATION',
        date:       formatDate(new Date()),
        kassa_id:   'K_AZAMAT',
        direction:  'приход',
        amount:     5000,
        type:       'аренда',
        category:   'аренда',
        car_id:     'TEST_CAR',
        driver_id:  'TEST_DRIVER',
        comment:    'смок testAll()',
        provel:     'system',
      })
    }
  };

  // Dry-run: следующий ID без записи в таблицу
  const sheet  = ss.getSheetByName(SHEET.OPERATIONS);
  const nextId = getNextId(sheet, 'CO');
  Logger.log('следующий op_id: ' + nextId);

  // Тест formatDate
  Logger.log('formatDate(new Date()): ' + formatDate(new Date()));

  // Тест dateToExcelSerial
  const serial = dateToExcelSerial('02.05.2026');
  Logger.log('dateToExcelSerial("02.05.2026"): ' + serial + ' (ожидаем ~45749)');

  // Тест getNextId по основным листам
  const sheets = [
    { name: SHEET.OPERATIONS, prefix: 'CO' },
    { name: SHEET.DRIVERS,    prefix: 'D'  },
    { name: SHEET.DEPOSITS,   prefix: 'DP' },
    { name: SHEET.RENTALS,    prefix: 'R'  },
  ];
  sheets.forEach(({ name, prefix }) => {
    const s = ss.getSheetByName(name);
    if (s) {
      Logger.log(`getNextId("${name}", "${prefix}"): ` + getNextId(s, prefix));
    } else {
      Logger.log(`пропуск: лист "${name}" не найден`);
    }
  });

  Logger.log('=== testAll END ===');
}


