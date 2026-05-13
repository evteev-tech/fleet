// -----------------------------------------------------------------------------
// Forecast_log — логирование прогнозов прибыли и метрики точности (Фаза 1)
// -----------------------------------------------------------------------------

var FORECAST_LOG_HEADERS_ = [
  'log_id',
  'recorded_at',
  'target_year',
  'target_month',
  'horizon_m',
  'model',
  'predicted',
  'actual',
  'actual_recorded_at',
  'error_pct',
  'hit',
  'bias',
];

/**
 * Создаёт лист Forecast_log при отсутствии и пишет заголовки при необходимости.
 * @param {Spreadsheet} ss
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureForecastLogSheet_(ss) {
  var name = SHEET.FORECAST_LOG;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var h1 = sheet.getRange(1, 1, 1, FORECAST_LOG_HEADERS_.length).getValues()[0];
  var needHeaders = false;
  for (var c = 0; c < FORECAST_LOG_HEADERS_.length; c++) {
    if (String(h1[c] || '').trim() !== FORECAST_LOG_HEADERS_[c]) {
      needHeaders = true;
      break;
    }
  }
  if (needHeaders) {
    sheet.getRange(1, 1, 1, FORECAST_LOG_HEADERS_.length).setValues([FORECAST_LOG_HEADERS_]);
  }
  return sheet;
}

/**
 * Symmetric MAPE, %.
 * @param {number} predicted
 * @param {number} actual
 * @returns {number}
 */
function smape_(predicted, actual) {
  var absP = Math.abs(predicted);
  var absA = Math.abs(actual);
  var denom = (absP + absA) / 2;
  if (denom === 0) return 0;
  return Math.abs(predicted - actual) / denom * 100;
}

function signForecast_(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * @param {number} y
 * @param {number} m — 1..12
 * @param {number} delta — смещение в месяцах (может быть отрицательным)
 * @returns {{year:number, month:number}}
 */
function addCalendarMonths_(y, m, delta) {
  var idx = y * 12 + (m - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function monthKey_(y, m) {
  return y * 100 + m;
}

/**
 * Проверяет, есть ли уже строка в Forecast_log с указанной комбинацией ключей.
 * Ключ уникальности: (target_year, target_month, horizon_m, model).
 * Игнорирует recorded_at — нас интересует "был ли уже прогноз на этот месяц-горизонт-модель".
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} targetYear
 * @param {number} targetMonth
 * @param {number} horizonM
 * @param {string} model
 * @returns {boolean}
 */
function hasForecastEntry_(sheet, targetYear, targetMonth, horizonM, model) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  for (var i = 1; i < data.length; i++) {
    var ty = Number(data[i][2]);
    var tm = Number(data[i][3]);
    var hm = Number(data[i][4]);
    var md = String(data[i][5] || '');
    if (ty === targetYear && tm === targetMonth && hm === horizonM && md === model) {
      return true;
    }
  }
  return false;
}

/**
 * Trailing12 по логике computeOverviewExtras_, но «текущий» месяц — календарный месяц asOf;
 * в агрегаты попадают только операции из месяцев СТРОГО РАНЬШЕ месяца asOf (monthKey(op) >= monthKey(asOf) — отсекаем; март не входит при asOf = 01.03).
 *
 * @param {Spreadsheet} ss
 * @param {Date} asOf
 * @returns {Array<{year:number, month:number, revenue:number, opex:number, profit:number}>}
 */
function buildTrailing12ForForecastAsOf_(ss, asOf) {
  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!opsSheet) return [];

  var curY = asOf.getFullYear();
  var curM = asOf.getMonth() + 1;
  var asOfYM = monthKey_(curY, curM);

  var months = [];
  for (var i = 11; i >= 0; i--) {
    var d = new Date(curY, curM - 1 - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      revenue: 0,
      opex: 0,
      profit: 0,
    });
  }

  function keyOf(y, m) {
    return y * 100 + m;
  }
  var trailingKeys = {};
  for (var ti = 0; ti < months.length; ti++) {
    trailingKeys[keyOf(months[ti].year, months[ti].month)] = months[ti];
  }

  var values = opsSheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var dt = parseDate(row[1]);
    if (!dt) continue;

    var opY = dt.getFullYear();
    var opM = dt.getMonth() + 1;
    if (monthKey_(opY, opM) >= asOfYM) continue;

    var amt = cellNum_(row[4]);
    if (amt === null) continue;
    var klass = String(row[12] || '').trim().toLowerCase();
    if (klass === 'capex') continue;
    if (klass !== 'revenue' && klass !== 'opex') continue;

    var bucket = trailingKeys[keyOf(opY, opM)];
    if (bucket) {
      if (klass === 'revenue') bucket.revenue += amt;
      else bucket.opex += amt;
    }
  }

  for (var mi = 0; mi < months.length; mi++) {
    months[mi].profit = months[mi].revenue - months[mi].opex;
  }
  return months;
}

/**
 * Считает прогноз прибыли по двум моделям на 3 месяца вперёд.
 * Принимает массив завершённых месяцев `trailing` (как в trailing12),
 * берёт последние 3 для расчёта.
 *
 * @param {Array<{revenue:number, opex:number, profit:number}>} trailing — массив завершённых месяцев
 * @returns {{ simple: number[], trend: number[], baseAvgProfit: number, sampleSize: number }}
 */
function computeForecastModels_(trailing) {
  var n = trailing ? trailing.length : 0;
  if (!n) {
    return { simple: [0, 0, 0], trend: [0, 0, 0], baseAvgProfit: 0, sampleSize: 0 };
  }
  var take = Math.min(3, n);
  var slice = trailing.slice(n - take, n);
  var sum = 0;
  for (var i = 0; i < slice.length; i++) sum += Number(slice[i].profit) || 0;
  var avg = take > 0 ? sum / take : 0;

  var simple = [avg, avg, avg];
  var trend = [avg, avg * 1.05, avg * 1.1];
  return {
    simple: simple,
    trend: trend,
    baseAvgProfit: avg,
    sampleSize: take,
  };
}

/**
 * Записывает до 6 строк в Forecast_log (3 горизонта × 2 модели).
 * Перед добавлением проверяет hasForecastEntry_ (без дублей по target+horizon+model).
 *
 * @param {Spreadsheet} ss
 * @param {Date} asOf — дата фиксации (для бэкфилла — историческая, для триггера — new Date())
 * @returns {{ rows_added: number, predictions: Array, skipped: number }}
 */
function recordForecast_(ss, asOf) {
  var sheet = ensureForecastLogSheet_(ss);

  var months = buildTrailing12ForForecastAsOf_(ss, asOf);
  if (!months.length) {
    return { rows_added: 0, predictions: [], skipped: 0 };
  }
  var last3Completed = months.slice(-4, -1);
  var models = computeForecastModels_(last3Completed);

  var asY = asOf.getFullYear();
  var asM = asOf.getMonth() + 1;

  var rows = [];
  var predictions = [];
  var recordedAt = formatDate(asOf);
  var skipped = 0;

  function tryPush(horizon, modelName, predictedVal) {
    var tgt = addCalendarMonths_(asY, asM, horizon);
    if (hasForecastEntry_(sheet, tgt.year, tgt.month, horizon, modelName)) {
      skipped++;
      return;
    }
    rows.push([
      Utilities.getUuid(),
      recordedAt,
      tgt.year,
      tgt.month,
      horizon,
      modelName,
      predictedVal,
      '',
      '',
      '',
      '',
      '',
    ]);
    predictions.push({
      horizon_m: horizon,
      model: modelName,
      target_year: tgt.year,
      target_month: tgt.month,
      predicted: predictedVal,
    });
  }

  for (var h = 1; h <= 3; h++) {
    tryPush(h, 'simple', models.simple[h - 1]);
    tryPush(h, 'trend', models.trend[h - 1]);
  }

  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, startRow + rows.length - 1, FORECAST_LOG_HEADERS_.length).setValues(rows);
  }

  Logger.log('recordForecast skipped duplicates: ' + skipped);

  return {
    rows_added: rows.length,
    predictions: predictions,
    skipped: skipped,
  };
}

/**
 * Прогоняет recordForecast_ для каждого месяца за последние N месяцев назад.
 * Для каждого asOf использует только данные ДО этого месяца (как и обычный recordForecast_).
 * После записи прогнозов вызывает updateForecastActuals_ один раз.
 *
 * @param {Spreadsheet} ss
 * @param {Date=} now — текущая дата (по умолчанию new Date())
 * @param {number=} monthsBack — сколько месяцев назад прогонять (по умолчанию 12)
 * @returns {{ months_processed: number, rows_added_total: number, rows_skipped_total: number, actuals_filled: number }}
 */
function backfillForecastLog_(ss, now, monthsBack) {
  if (!now) now = new Date();
  if (!monthsBack) monthsBack = 12;

  var totalAdded = 0;
  var totalSkipped = 0;
  var monthsProcessed = 0;

  for (var k = monthsBack; k >= 1; k--) {
    var d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    var result = recordForecast_(ss, d);
    totalAdded += result.rows_added;
    totalSkipped += result.skipped || 0;
    monthsProcessed += 1;
    Logger.log(
      'backfill asOf=' +
        Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy') +
        ' added=' +
        result.rows_added +
        ' skipped=' +
        (result.skipped || 0)
    );
  }

  var actResult = updateForecastActuals_(ss, now);

  return {
    months_processed: monthsProcessed,
    rows_added_total: totalAdded,
    rows_skipped_total: totalSkipped,
    actuals_filled: actResult.updated_rows,
  };
}

/**
 * Ручной прогон бэкфилла из редактора Apps Script.
 */
function testBackfill() {
  var ss = SpreadsheetApp.openById(SS_ID);
  Logger.log('=== Backfill START ===');
  var result = backfillForecastLog_(ss, new Date(), 12);
  Logger.log('=== Backfill DONE ===');
  Logger.log('Months processed: ' + result.months_processed);
  Logger.log('Rows added total: ' + result.rows_added_total);
  Logger.log('Rows skipped total: ' + result.rows_skipped_total);
  Logger.log('Actuals filled: ' + result.actuals_filled);
}

/**
 * Суммирует profit (revenue − opex) за календарный месяц по «Касса_операции».
 * @param {Spreadsheet} ss
 * @param {number} year
 * @param {number} month — 1..12
 * @returns {number}
 */
function profitForCalendarMonth_(ss, year, month) {
  var opsSheet = ss.getSheetByName(SHEET.OPERATIONS);
  if (!opsSheet) return 0;
  var ym = monthKey_(year, month);
  var rev = 0;
  var opex = 0;
  var values = opsSheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var dt = parseDate(row[1]);
    if (!dt) continue;
    if (monthKey_(dt.getFullYear(), dt.getMonth() + 1) !== ym) continue;
    var amt = cellNum_(row[4]);
    if (amt === null) continue;
    var klass = String(row[12] || '').trim().toLowerCase();
    if (klass === 'capex') continue;
    if (klass === 'revenue') rev += amt;
    else if (klass === 'opex') opex += amt;
  }
  return rev - opex;
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Проходит по Forecast_log, для строк с пустым actual подставляет факт и метрики.
 *
 * @param {Spreadsheet} ss
 * @param {Date} asOf
 * @returns {{ updated_rows: number }}
 */
function updateForecastActuals_(ss, asOf) {
  var sheet = ss.getSheetByName(SHEET.FORECAST_LOG);
  if (!sheet) return { updated_rows: 0 };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { updated_rows: 0 };

  var asOf0 = startOfDay_(asOf).getTime();
  var numCols = FORECAST_LOG_HEADERS_.length;
  var range = sheet.getRange(2, 1, lastRow, numCols);
  var values = range.getValues();

  var updated = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var actualCell = row[7];
    if (actualCell !== '' && actualCell != null) continue;

    var ty = Number(row[2]);
    var tm = Number(row[3]);
    if (!ty || !tm || tm < 1 || tm > 12) continue;

    var firstAfter = new Date(ty, tm, 1);
    if (firstAfter.getTime() > asOf0) continue;

    var pred = Number(row[6]);
    if (isNaN(pred)) pred = 0;

    var act = profitForCalendarMonth_(ss, ty, tm);
    var errPct = smape_(pred, act);
    var hit = signForecast_(pred) === signForecast_(act) ? 1 : 0;
    var bias = pred - act;

    row[7] = act;
    row[8] = formatDate(asOf);
    row[9] = errPct;
    row[10] = hit;
    row[11] = bias;
    updated++;
  }

  if (updated > 0) {
    range.setValues(values);
  }
  return { updated_rows: updated };
}

/**
 * Точка входа для time-driven trigger (1-го числа каждого месяца).
 * Записывает прогнозы на 1, 2, 3 месяца вперёд + обновляет actuals для прошлых.
 * Идемпотентна — если уже запускалась в этом месяце, пропустит дубликаты.
 */
function monthlyForecastTrigger() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var now = new Date();
  var asOf = new Date(now.getFullYear(), now.getMonth(), 1);

  Logger.log(
    '=== monthlyForecastTrigger START — ' +
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') +
      ' ==='
  );

  var rec = recordForecast_(ss, asOf);
  Logger.log('records added: ' + rec.rows_added + ', skipped: ' + rec.skipped);

  var act = updateForecastActuals_(ss, now);
  Logger.log('actuals filled: ' + act.updated_rows);

  Logger.log('=== monthlyForecastTrigger END ===');
  return rec;
}

/**
 * Считает агрегированную точность модели по последним N завершённым месяцам (по target).
 * Учитывает ТОЛЬКО строки с заполненным actual И predicted !== 0.
 *
 * @param {Spreadsheet} ss
 * @param {number} windowMonths
 * @param {string} model — 'simple' или 'trend'
 * @returns {{ smape: ?number, hitRate: ?number, bias: ?number, sampleSize: number }}
 */
function computeForecastAccuracy_(ss, windowMonths, model) {
  var empty = { smape: null, hitRate: null, bias: null, sampleSize: 0 };
  var sheet = ss.getSheetByName(SHEET.FORECAST_LOG);
  if (!sheet) return empty;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return empty;

  var now = new Date();
  var nowYM = now.getFullYear() * 12 + now.getMonth();

  var totalSMAPE = 0;
  var totalHits = 0;
  var totalBias = 0;
  var n = 0;
  var modelNorm = String(model || '').trim();

  for (var i = 1; i < data.length; i++) {
    var ty = Number(data[i][2]);
    var tm = Number(data[i][3]);
    var md = String(data[i][5] || '').trim();
    var predicted = Number(data[i][6]);
    var actual = data[i][7];
    var err = data[i][9];
    var hit = data[i][10];
    var bias = data[i][11];

    if (md !== modelNorm) continue;
    if (actual === '' || actual === null) continue;
    if (!isFinite(predicted) || predicted === 0) continue;

    var errN = Number(err);
    var hitN = Number(hit);
    var biasN = Number(bias);
    if (!isFinite(errN) || !isFinite(hitN) || !isFinite(biasN)) continue;

    var targetYM = ty * 12 + (tm - 1);
    var monthsAgo = nowYM - targetYM;
    if (monthsAgo < 0 || monthsAgo > windowMonths) continue;

    totalSMAPE += errN;
    totalHits += hitN;
    totalBias += biasN;
    n += 1;
  }

  if (n === 0) return empty;

  return {
    smape: totalSMAPE / n,
    hitRate: (totalHits / n) * 100,
    bias: Math.round(totalBias / n),
    sampleSize: n,
  };
}

function testForecastAccuracyEndpoint() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var a3 = computeForecastAccuracy_(ss, 3, 'simple');
  var a6 = computeForecastAccuracy_(ss, 6, 'simple');
  Logger.log('window=3: ' + JSON.stringify(a3));
  Logger.log('window=6: ' + JSON.stringify(a6));
}

/**
 * Ручной прогон из редактора Apps Script.
 */
function testForecastLog() {
  var ss = SpreadsheetApp.openById(SS_ID);

  var sheet = ensureForecastLogSheet_(ss);
  Logger.log('Forecast_log sheet OK. Rows: ' + sheet.getLastRow());

  var asOf = new Date(2026, 4, 1);
  var result = recordForecast_(ss, asOf);
  Logger.log('recordForecast added: ' + result.rows_added + ' skipped: ' + result.skipped);
  Logger.log('predictions: ' + JSON.stringify(result.predictions));

  var actResult = updateForecastActuals_(ss, new Date());
  Logger.log('updated actuals: ' + actResult.updated_rows);
}
