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
// status_from — ISO YYYY-MM-DD (день, с которого статус действует).
db.exec(`
  CREATE TABLE IF NOT EXISTS car_status_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id      TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    status_from TEXT    NOT NULL,
    author      TEXT    DEFAULT '',
    created_at  TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_csl_car_date ON car_status_log (car_id, status_from);
`);

// Одноразовый засев: если журнал пуст, записываем текущий статус каждой машины
// сегодняшней датой. Так актуальный «ремонт» виден в матрице сразу, а не после
// первой смены статуса. Прошлую историю восстановить нельзя — её в БД нет.
try {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM car_status_log').get();
  if (!seeded || seeded.n === 0) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const cars = db.prepare('SELECT id, status FROM cars').all();
    const ins = db.prepare(
      `INSERT INTO car_status_log (car_id, status, status_from, author)
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
