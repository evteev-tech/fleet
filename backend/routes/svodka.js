import { Router } from 'express';
import db from '../db.js';
import { ok, fail, keysToCamel } from '../utils.js';

const router = Router();

// ─── Хелперы дат ──────────────────────────────────────────────────────────────
// kassa_ops хранит даты как DD.MM.YYYY, rentals — как ISO YYYY-MM-DD.
// Приводим всё к ISO-ключу дня YYYY-MM-DD для единого сопоставления.

/** Любая дата (DD.MM.YYYY, ISO, с временем) → 'YYYY-MM-DD' или null. */
function toIsoDay(str) {
  if (!str) return null;
  const s = String(str).trim().split(/[ T]/)[0]; // отбрасываем время
  const ddmm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

/** Категория расхода → короткий тег для ячейки. */
const EXPENSE_TAGS = {
  'ремонт': 'ремонт',
  'запчасти': 'запчасти',
  'ТО': 'ТО',
  'страховка': 'страховка',
  'связь_глонасс': 'глонасс',
  'ЗП': 'ЗП',
  'реклама': 'реклама',
  'доставка': 'доставка',
  'покупка_машины': 'покупка',
  'штраф_ГИБДД': 'штраф',
  'ДТП': 'ДТП',
  'прочее': 'прочее',
};
function expenseTag(category) {
  const c = String(category || '').trim();
  return EXPENSE_TAGS[c] || c || 'расход';
}

/**
 * GET /api/svodka?year=2026&month=4
 * Календарная матрица «дни × машины» за месяц.
 *
 * Логика (согласовано с заказчиком):
 *  - Поступление дня  = Σ kassa_ops where direction=приход AND category='аренда' AND car_id AND day.
 *  - Расход дня       = Σ kassa_ops where direction=расход AND car_id AND day; тег = категория
 *                       строки с максимальным amount; показывается независимо от статуса.
 *  - Статус дня       = из journal car_status_log: последняя запись со date_from <= day.
 *                       (аренда / простой / в ремонте). Расход НЕ влияет на статус.
 *  - Свод месяца      = Σ приходов(аренда) и Σ расходов; чистыми = разница.
 *  - Загрузка парка   = (машино-дней в аренде) / (машин × дней месяца) * 100.
 */
router.get('/', (req, res) => {
  try {
  const year = Number(req.query.year);
  const month = Number(req.query.month); // 1..12
  if (!year || !month || month < 1 || month > 12) return fail(res, 'INVALID_PERIOD');

  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const monthPrefixIso = `${year}-${mm}-`;            // 'YYYY-MM-'
  const todayIso = new Date().toISOString().slice(0, 10);

  // 1. Машины (фиксированный порядок по id, как в Excel)
  const cars = db.prepare('SELECT id, name, color, status FROM cars ORDER BY id').all();

  // 2. Операции кассы за месяц (включая расходы без car_id — для колонки «Парк»).
  //    В БД два формата дат: новые из приложения — DD.MM.YYYY, старые из импорта
  //    Excel — ISO YYYY-MM-DD. Фильтруем по обоим, нормализуем в JS через toIsoDay.
  const ddmmSuffix = `%.${mm}.${year}`;     // '%.05.2026'  → DD.MM.YYYY
  const isoPrefix  = `${monthPrefixIso}%`;  // '2026-05-%'   → YYYY-MM-DD
  const ops = db.prepare(
    `SELECT car_id, date, direction, amount, category
       FROM kassa_ops
      WHERE date LIKE ? OR date LIKE ?`
  ).all(ddmmSuffix, isoPrefix);

  // 3. Аренды (для дохода по дням и статуса «в аренде»). rate_day — дневная ставка.
  const rentals = db.prepare(
    `SELECT car_id, date_start, date_end, rate_day, status FROM rentals
      WHERE car_id IS NOT NULL AND car_id <> ''`
  ).all();

  // 4. Журнал статусов (вся история — статус на день = последняя запись <= дня).
  const statusLog = db.prepare(
    `SELECT car_id, status, date_from FROM car_status_log
      ORDER BY car_id, date_from, id`
  ).all();

  // ─── Индексация ───────────────────────────────────────────────────────────
  // Доход по дням: разносим rate_day по каждому дню оплаченного периода аренды,
  // попавшему в месяц. Сумма за период = rate_day × дни = фактически оплаченное.
  const incomeByCarDay = {}; // car -> { 'YYYY-MM-DD': ставка }
  for (const r of rentals) {
    const s = toIsoDay(r.date_start);
    if (!s) continue;
    const eRaw = r.date_end ? toIsoDay(r.date_end) : null;
    const end = eRaw || todayIso;            // активная без date_end — по сегодня
    const rate = Number(r.rate_day) || 0;
    if (rate <= 0) continue;
    // Перебираем дни периода, пересекающиеся с месяцем
    let cur = new Date(`${s}T00:00:00`);
    const endD = new Date(`${end}T00:00:00`);
    let guard = 0;
    while (cur <= endD && guard++ < 800) {
      const di = cur.toISOString().slice(0, 10);
      if (di.startsWith(monthPrefixIso)) {
        (incomeByCarDay[r.car_id] ||= {});
        // если периоды перекрылись — берём ставку (не суммируем дубли дня)
        incomeByCarDay[r.car_id][di] = rate;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Расходы по дням: сумма за день + тег крупнейшего (при равенстве — первый).
  // car_id пустой → общепарковый расход, копится в ключе PARK.
  const PARK = '__PARK__';
  const expenseByCarDay = {}; // car|PARK -> { day: { sum, maxAmt, tag } }
  for (const o of ops) {
    const day = toIsoDay(o.date);
    if (!day || !day.startsWith(monthPrefixIso)) continue;
    if (String(o.direction || '').toLowerCase() !== 'расход') continue;
    const amt = Number(o.amount) || 0;
    const key = (o.car_id && String(o.car_id).trim()) ? o.car_id : PARK;
    (expenseByCarDay[key] ||= {});
    const cell = (expenseByCarDay[key][day] ||= { sum: 0, maxAmt: -1, tag: '' });
    cell.sum += amt;
    if (amt > cell.maxAmt) { cell.maxAmt = amt; cell.tag = expenseTag(o.category); } // строго > → при равенстве остаётся первый
  }

  // Статус на конкретный день: последняя запись журнала со date_from <= day.
  const logByCar = {};
  for (const r of statusLog) (logByCar[r.car_id] ||= []).push(r);
  function statusOnDay(carId, dayIso) {
    const log = logByCar[carId];
    if (!log || !log.length) return null;
    let cur = null;
    for (const e of log) {
      if (e.date_from <= dayIso) cur = e.status;
      else break;
    }
    return cur;
  }

  // Резерв: день внутри [date_start, date_end] аренды (если журнала нет).
  const rentalsByCar = {};
  for (const r of rentals) (rentalsByCar[r.car_id] ||= []).push(r);
  function inRentalOnDay(carId, dayIso) {
    const list = rentalsByCar[carId];
    if (!list) return false;
    for (const r of list) {
      const s = toIsoDay(r.date_start);
      if (!s || s > dayIso) continue;
      const end = r.date_end ? toIsoDay(r.date_end) : todayIso;
      if (dayIso <= end) return true;
    }
    return false;
  }

  // ─── Сборка матрицы ─────────────────────────────────────────────────────────
  let sumIncome = 0;
  let sumExpense = 0;
  let rentDays = 0;

  const matrix = cars.map(car => {
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayIso = `${monthPrefixIso}${String(d).padStart(2, '0')}`;

      let status = statusOnDay(car.id, dayIso);
      if (!status) status = inRentalOnDay(car.id, dayIso) ? 'в аренде' : 'простой';

      const income = incomeByCarDay[car.id]?.[dayIso] || 0;
      const exp = expenseByCarDay[car.id]?.[dayIso] || null;

      sumIncome += income;
      if (exp) sumExpense += exp.sum;
      if (status === 'в аренде') rentDays++;

      days.push({
        day: d,
        status,
        income,
        expense: exp ? exp.sum : 0,
        expense_tag: exp ? exp.tag : '',
      });
    }
    return { car_id: car.id, nick: car.id, color: car.color, days };
  });

  // Виртуальная колонка «Парк»: только общепарковые расходы (без car_id).
  const parkDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayIso = `${monthPrefixIso}${String(d).padStart(2, '0')}`;
    const exp = expenseByCarDay[PARK]?.[dayIso] || null;
    if (exp) sumExpense += exp.sum;
    parkDays.push({
      day: d,
      status: 'парк',
      income: 0,
      expense: exp ? exp.sum : 0,
      expense_tag: exp ? exp.tag : '',
    });
  }
  matrix.push({ car_id: PARK, nick: 'Парк', color: '#9aa1a8', is_park: true, days: parkDays });

  const totalCarDays = cars.length * daysInMonth;
  const load = totalCarDays > 0 ? Math.round((rentDays / totalCarDays) * 100) : 0;

  return ok(res, {
    svodka: keysToCamel({
      year, month, days_in_month: daysInMonth,
      summary: {
        income: sumIncome,
        expense: sumExpense,
        net: sumIncome - sumExpense,
        load_pct: load,
        cars_count: cars.length,
        rent_days: rentDays,
      },
      matrix,
    }),
  });
  } catch (e) {
    console.error('[svodka]', e);
    return fail(res, 'SVODKA_ERROR', 500);
  }
});

export default router;
