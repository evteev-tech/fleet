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

// Миграция: история статусов машин (для экрана «Сводка»).
// Идемпотентно — CREATE TABLE IF NOT EXISTS. Заполняется при каждой смене статуса.
db.exec(`
  CREATE TABLE IF NOT EXISTS car_status_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id     TEXT NOT NULL,
    status     TEXT NOT NULL,
    date_from  TEXT NOT NULL,
    author     TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_csl_car_date ON car_status_log (car_id, date_from);
`);

export default db;
