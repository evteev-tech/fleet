// ─── Идентификаторы Google Таблицы ──────────────────────────────────────────
export const SHEET_ID = '1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg';
export const API_KEY     = 'REDACTED_OLD_APIKEY';
export const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyPKuvlWRG_mk_vfP-l0rENt1NdqQPP2Ayf8u0SigbGuinyLtBEZkoGETmw0891lZ9n/exec';

// ─── Кассы ───────────────────────────────────────────────────────────────────
export const KASSA_ID = {
  AZAMAT:   'K_AZAMAT',
  VLADIMIR: 'K_VLADIMIR',
  YULIA:    'K_YULIA',
};

// ─── Роли ────────────────────────────────────────────────────────────────────
export const ROLES = {
  MECHANIC:   'mechanic',
  OPERATIONS: 'operations',
  INVESTOR:   'investor',
};

// ─── Статусы авто ────────────────────────────────────────────────────────────
export const CAR_STATUSES = {
  RENT:   'в аренде',
  REPAIR: 'в ремонте',
  IDLE:   'простой',
};

// ─── Названия листов (единственный источник истины) ──────────────────────────
export const SHEETS = {
  USERS:      'Пользователи',
  OPERATIONS: 'Касса_операции',
  CARS:       'Машины',
  DRIVERS:    'Водители',
  RENTALS:    'Аренда',
  DEPOSITS:   'Депозиты_операции',
};

// ─── localStorage ────────────────────────────────────────────────────────────
export const LS_SESSION = 'matizi_session';

// ─── TTL кэша (мс) ──────────────────────────────────────────────────────────
export const CACHE_TTL_MS = 30_000;
