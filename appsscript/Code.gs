/*
  ШАГ 1 — вставить этот код в Apps Script (Расширения → Apps Script)
  ШАГ 2 — в строке ALLOWED_ORIGIN вставить URL фронтенда
           (например https://username.github.io/matizi)
           До деплоя фронтенда поставить '*' — поменять после.
  ШАГ 3 — Развернуть → Новое развёртывание
           Тип: Веб-приложение
           Выполнять как: Я (владелец таблицы)
           Кто имеет доступ: Все (включая анонимных) — обязательно
  ШАГ 4 — Скопировать URL вида .../exec
  ШАГ 5 — Вставить URL в js/config.js как WEBHOOK_URL
  ШАГ 6 — Задеплоить фронтенд на GitHub Pages
  ШАГ 7 — Вернуться в Apps Script, заменить '*' на реальный URL,
           создать НОВОЕ развёртывание (не редактировать старое),
           обновить WEBHOOK_URL в config.js на новый URL

  ВАЖНО: каждое изменение кода требует НОВОГО развёртывания.
  Редактирование существующего не обновляет рабочий URL.
*/

const ALLOWED_ORIGIN = 'https://github.com/evteev-tech/fleet.git'; // заменить на реальный URL после деплоя фронтенда

const SS_ID = '1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg';

// ─── Названия листов ──────────────────────────────────────────────────────────
const SHEET = {
  OPERATIONS: 'Касса_операции',
  CARS:       'Машины',
  DRIVERS:    'Водители',
  RENTALS:    'Аренда',
  RENTALS:    'Аренда',
  DEPOSITS:   'Депозиты_операции',
  USERS:      'Пользователи',
  FAIL_LOG:   'Логи_отказов',
};

// ═════════════════════════════════════════════════════════════════════════════
// CORS
// ═════════════════════════════════════════════════════════════════════════════

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Генерирует следующий ID вида 'CO00269', 'D00015', 'DP00003', 'R00042'.
 * Смотрит на последнее значение в колонке A листа.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} prefix  — 'CO' | 'D' | 'DP' | 'R'
 * @returns {string}
 */
function getNextId(sheet, prefix) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return prefix + '00001';

  // Читаем всю колонку A начиная со 2-й строки
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  let max = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$');
  ids.forEach(id => {
    const m = String(id).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + String(max + 1).padStart(5, '0');
}

/**
 * Форматирует дату как DD.MM.YYYY.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Конвертирует DD.MM.YYYY в Excel-число (дней с 30.12.1899).
 * @param {string} ddmmyyyy
 * @returns {number}
 */
function dateToExcelSerial(ddmmyyyy) {
  const [dd, mm, yyyy] = ddmmyyyy.split('.').map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  const excelEpoch = new Date(1899, 11, 30);
  return Math.round((d - excelEpoch) / 86400000);
}

/**
 * Парсит DD.MM.YYYY → Date.
 * @param {string} ddmmyyyy
 * @returns {Date}
 */
function parseDate(ddmmyyyy) {
  const [dd, mm, yyyy] = ddmmyyyy.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/**
 * Ответ «успех» с CORS-заголовком.
 * @param {object} data
 */
function ok(data) {
  const payload = JSON.stringify({ status: 'ok', ...data });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({ 'Access-Control-Allow-Origin': ALLOWED_ORIGIN });
}

/**
 * Ответ «ошибка» с CORS-заголовком.
 * @param {string} message
 */
function err(message) {
  const payload = JSON.stringify({ status: 'error', message });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({ 'Access-Control-Allow-Origin': ALLOWED_ORIGIN });
}

/**
 * Пишет строку в лист «Логи_отказов».
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

// ═════════════════════════════════════════════════════════════════════════════
// ОСНОВНОЙ ОБРАБОТЧИК
// ═════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  const ss = SpreadsheetApp.openById(SS_ID);

  try {
    const raw    = (e.parameter && e.parameter.data) ? e.parameter.data : e.postData.contents;
    const body   = JSON.parse(raw);
    const action = body.action || 'ADD_OPERATION';

    switch (action) {
      case 'ADD_OPERATION':    return handleAddOperation(ss, body);
      case 'UPDATE_CAR_STATUS': return handleUpdateCarStatus(ss, body);
      case 'SAVE_DRIVER':      return handleSaveDriver(ss, body);
      case 'ADD_DEPOSIT':      return handleAddDeposit(ss, body);
      case 'ADD_RENTAL':       return handleAddRental(ss, body);
      default:
        logFailure(ss, action, 'UNKNOWN_ACTION', 'Action not implemented');
        return err('UNKNOWN_ACTION');
    }
  } catch (ex) {
    logFailure(ss, 'doPost', 'EXCEPTION', ex.message);
    return err(ex.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ADD_OPERATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Поля: date, kassa_id, direction (приход/расход),
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

  // Определяем класс_итог
  let klass_itog;
  const typeLower = type.toLowerCase();
  if (typeLower.startsWith('аренда') || typeLower === 'аренда') {
    klass_itog = 'revenue';
  } else if (typeLower.startsWith('перевод')) {
    klass_itog = 'transfer';
  } else if (typeLower.startsWith('депозит')) {
    klass_itog = 'deposit';
  } else if (direction === 'расход') {
    klass_itog = 'opex';
  } else {
    klass_itog = 'revenue';
  }

  // Если передан класс_override — он имеет приоритет
  const finalClass = class_override || klass_itog;

  // A  B      C         D          E       F     G         H       I          J        K       L               M
  // id дата   касса_id  направление сумма  тип   категория car_id  driver_id  комм.    провёл  класс_override  класс_итог
  sheet.appendRow([
    op_id, date, kassa_id, direction, Number(amount),
    type, category, car_id, driver_id, comment, provel,
    class_override, finalClass,
  ]);

  return ok({ op_id });
}

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE_CAR_STATUS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Поля: car_id, new_status
 * Допустимые статусы: 'в аренде' | 'в ремонте' | 'простой'
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

  // Колонка D (индекс 3) — статус
  sheet.getRange(rowIdx + 1, 4).setValue(new_status);

  return ok({ car_id, new_status });
}

// ═════════════════════════════════════════════════════════════════════════════
// SAVE_DRIVER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Поля: driver_id (пустой = создание), fio, phone,
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

  // ── Создание ──
  if (!driver_id) {
    const newId = getNextId(sheet, 'D');

    // A         B    C      D   E       F(депозит)  G
    // driver_id ФИО  телефон ВУ статус  0           примечание
    sheet.appendRow([newId, fio, phone, vu, status, 0, comment]);

    // Привязываем авто если передан car_id
    if (car_id) {
      handleUpdateCarStatus(ss, { car_id, new_status: 'в аренде' });
    }

    return ok({ driver_id: newId });
  }

  // ── Обновление ──
  const data   = sheet.getDataRange().getValues();
  const rowIdx = data.findIndex((row, i) => i > 0 && String(row[0]) === String(driver_id));

  if (rowIdx === -1) {
    logFailure(ss, 'SAVE_DRIVER', 'DRIVER_NOT_FOUND', driver_id);
    return err('DRIVER_NOT_FOUND');
  }

  const sheetRow = rowIdx + 1;
  // Обновляем B, C, D, E, G (депозит F не трогаем)
  sheet.getRange(sheetRow, 2, 1, 5).setValues([[fio, phone, vu, status, comment]]);

  return ok({ driver_id });
}

// ═════════════════════════════════════════════════════════════════════════════
// ADD_DEPOSIT
// ═════════════════════════════════════════════════════════════════════════════

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
  const status_src    = Number(amount) > 0 ? 'АКТИВЕН' : 'ВОЗВРАТ';
  const today         = formatDate(new Date());

  // A          B      C          D       E       F               G
  // dep_op_id  дата   driver_id  car_id  сумма   статус_исходный комментарий
  depSheet.appendRow([dep_op_id, today, driver_id, car_id, Number(amount), status_src, comment]);

  // Обновляем депозит_текущий у водителя (колонка F, индекс 5)
  const driverData = driverSheet.getDataRange().getValues();
  const dRowIdx    = driverData.findIndex((row, i) => i > 0 && String(row[0]) === String(driver_id));

  if (dRowIdx !== -1) {
    const currentDeposit = Number(driverData[dRowIdx][5]) || 0;
    driverSheet.getRange(dRowIdx + 1, 6).setValue(currentDeposit + Number(amount));
  }

  return ok({ dep_op_id });
}

// ═════════════════════════════════════════════════════════════════════════════
// ADD_RENTAL
// ═════════════════════════════════════════════════════════════════════════════

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

  // A          B       C          D            E          F          G
  // rental_id  car_id  driver_id  дата_начала  дата_конца ставка_день примечание
  sheet.appendRow([rental_id, car_id, driver_id, serialStart, serialEnd, Number(rate_day), comment]);

  // Форматируем колонки D и E как дату
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 4).setNumberFormat('DD.MM.YYYY');
  sheet.getRange(newRow, 5).setNumberFormat('DD.MM.YYYY');

  // Обновляем статус авто
  handleUpdateCarStatus(ss, { car_id, new_status: 'в аренде' });

  return ok({ rental_id });
}

// ═════════════════════════════════════════════════════════════════════════════
// ТЕСТОВАЯ ФУНКЦИЯ (запускать вручную из редактора Apps Script)
// ═════════════════════════════════════════════════════════════════════════════

function testAll() {
  const ss = SpreadsheetApp.openById(SS_ID);
  Logger.log('=== testAll START ===');

  // ── Тест ADD_OPERATION ──
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
        category:   'тест',
        car_id:     'TEST_CAR',
        driver_id:  'TEST_DRIVER',
        comment:    'Автотест testAll()',
        provel:     'system',
      })
    }
  };

  // Dry-run: только генерируем ID, не пишем в таблицу
  const sheet  = ss.getSheetByName(SHEET.OPERATIONS);
  const nextId = getNextId(sheet, 'CO');
  Logger.log('Следующий op_id: ' + nextId);

  // Тест formatDate
  Logger.log('formatDate(new Date()): ' + formatDate(new Date()));

  // Тест dateToExcelSerial
  const serial = dateToExcelSerial('02.05.2026');
  Logger.log('dateToExcelSerial("02.05.2026"): ' + serial + ' (ожидается ~45749)');

  // Тест getNextId для каждого листа
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
      Logger.log(`ВНИМАНИЕ: лист "${name}" не найден`);
    }
  });

  Logger.log('=== testAll END ===');
}
