import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'matizi.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log(`[db] Подключено: ${DB_PATH}`);

// ─── Миграция: журнал статусов машин (для отчёта «Сводка») ───────────────────
// Хранит историю смены статусов по дням. БД помнит только текущий cars.status;
// чтобы строить календарную матрицу по дням, нужен журнал изменений.
// date_from — ISO YYYY-MM-DD (день, с которого статус действует).
db.exec(`
  CREATE TABLE IF NOT EXISTS car_status_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id      TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    date_from   TEXT    NOT NULL,
    author      TEXT    DEFAULT '',
    created_at  TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_csl_car_date ON car_status_log (car_id, date_from);
`);

// Страховка: если таблица существовала с иной схемой (ранний деплой), CREATE IF
// NOT EXISTS её не трогает — поэтому до-создаём недостающие колонки вручную.
try {
  const cols = db.prepare(`PRAGMA table_info(car_status_log)`).all().map(c => c.name);
  if (cols.includes('status_from') && !cols.includes('date_from')) {
    db.exec(`ALTER TABLE car_status_log RENAME COLUMN status_from TO date_from`);
  } else if (!cols.includes('date_from')) {
    db.exec(`ALTER TABLE car_status_log ADD COLUMN date_from TEXT`);
    if (cols.includes('status_from')) {
      db.exec(`UPDATE car_status_log SET date_from = status_from WHERE date_from IS NULL OR date_from = ''`);
    }
  } else if (cols.includes('status_from')) {
    db.exec(`UPDATE car_status_log SET date_from = status_from WHERE date_from IS NULL OR date_from = ''`);
  }
  if (!cols.includes('author'))    db.exec(`ALTER TABLE car_status_log ADD COLUMN author TEXT DEFAULT ''`);
  if (!cols.includes('created_at')) db.exec(`ALTER TABLE car_status_log ADD COLUMN created_at TEXT`);
} catch (e) {
  console.error('[db] car_status_log: проверка колонок:', e.message);
}

// Одноразовый засев: если журнал пуст, записываем текущий статус каждой машины
// сегодняшней датой. Так актуальный «ремонт» виден в матрице сразу, а не после
// первой смены статуса. Прошлую историю восстановить нельзя — её в БД нет.
try {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM car_status_log').get();
  if (!seeded || seeded.n === 0) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const cars = db.prepare('SELECT id, status FROM cars').all();
    const ins = db.prepare(
      `INSERT INTO car_status_log (car_id, status, date_from, author)
       VALUES (?, ?, ?, 'seed')`
    );
    const seed = db.transaction(rows => {
      for (const c of rows) ins.run(c.id, c.status || 'простой', today);
    });
    seed(cars);
    console.log(`[db] car_status_log засеян: ${cars.length} машин (дата ${today})`);
  }
} catch (e) {
  console.error('[db] Ошибка засева car_status_log:', e.message);
}

export default db;
