// ─── Feature flags (URL → без пересборки) ────────────────────────────────────
export const USE_MOCK =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mock');

// ─── Идентификаторы Google Таблицы ──────────────────────────────────────────
export const SHEET_ID = '1z4raGK4oamjZNznow-OesTljRz649_wCFYIFOh3mufg';
export const API_KEY     = 'AIzaSyC5FiPFic6A-Ze6h7NlhvLfZki7xBc5qnU';
export const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwx0giFZQdcIilAW51UjdKQnbLSwA4_NF64SOUuPeTg-dHYl73gTFZkg-5xnuyhd93u/exec';

// Секретный токен для защиты от неавторизованных запросов
export const SECRET_TOKEN = '7e50ed04-5919-44f0-995f-7d2e2799fe4b';



// ─── Кассы ───────────────────────────────────────────────────────────────────
export const KASSA_ID = {
  AZAMAT:   'K_AZAMAT',
  VLADIMIR: 'K_VLADIMIR',
  YULIA:    'K_YULIA',
  INVEST_YULIA: 'K_INVEST_YULIA',
  INVEST_VLAD:  'K_INVEST_VLAD',
};

export const KASSA_NAMES = {
  K_AZAMAT:   'Касса Азамата',
  K_VLADIMIR: 'Касса Владимира',
  K_YULIA:    'Касса Юлии',
  K_INVEST_YULIA: 'Инвест. счёт Юлии',
  K_INVEST_VLAD:  'Инвест. счёт Владимира',
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
  KASSAS:     'Кассы',
  CARS:       'Машины',
  DRIVERS:    'Водители',
  RENTALS:    'Аренда',
  DEPOSITS:   'Депозиты_операции',
};

// ─── localStorage ────────────────────────────────────────────────────────────
export const LS_SESSION = 'matizi_session';

// ─── TTL кэша (мс) ──────────────────────────────────────────────────────────
export const CACHE_TTL_MS = 30_000;
