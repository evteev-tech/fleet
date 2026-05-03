/**
 * stale-while-revalidate кэш в localStorage для экранов (Vanilla JS).
 */

import { SHEETS } from './config.js';

const PREFIX = 'fleet_cache_';

/** Логические ключи кэша */
export const CACHE_KEYS = {
  CARS: 'cars',
  DRIVERS: 'drivers',
  RENTALS: 'rentals',
  CASH_OPS: 'cashOps',
  KASSAS: 'kassas',
  DASHBOARD: 'dashboard',
};

/**
 * Какие SWR-ключи инвалидировать при сбросе кэша листа (имя как в таблице).
 * @type {Record<string, string[]>}
 */
export const SHEET_TO_CACHE_KEYS = {
  [SHEETS.CARS]: [CACHE_KEYS.CARS],
  [SHEETS.DRIVERS]: [CACHE_KEYS.DRIVERS],
  [SHEETS.RENTALS]: [CACHE_KEYS.RENTALS],
  [SHEETS.OPERATIONS]: [CACHE_KEYS.CASH_OPS, CACHE_KEYS.KASSAS, CACHE_KEYS.DASHBOARD],
  [SHEETS.DEPOSITS]: [CACHE_KEYS.DRIVERS],
};

function storageKey(key) {
  return PREFIX + key;
}

function readEntry(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(key, entry) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch (e) {
    console.warn('[cache] write failed', e);
  }
}

/**
 * @param {string} key — логический ключ (см. CACHE_KEYS)
 * @param {() => Promise<any>} fetchFn
 * @param {{ ttl?: number, onCached?: (data: any) => void, onFresh?: (data: any) => void }} [options]
 */
export function getWithSWR(key, fetchFn, options = {}) {
  const ttl = options.ttl ?? 300_000;
  const { onCached, onFresh } = options;

  const entry = readEntry(key);
  const now = Date.now();

  const needsRefetch =
    !entry ||
    entry.stale === true ||
    entry.ts == null ||
    now - entry.ts >= ttl;

  if (!needsRefetch) {
    if (entry.data !== undefined) {
      onCached?.(entry.data);
    }
    return;
  }

  if (entry && entry.data !== undefined) {
    onCached?.(entry.data);
  }

  void (async () => {
    let fresh;
    try {
      fresh = await fetchFn();
    } catch {
      return;
    }
    const prevJson = entry ? JSON.stringify(entry.data) : null;
    const nextJson = JSON.stringify(fresh);
    writeEntry(key, { data: fresh, ts: Date.now(), stale: false });
    if (prevJson !== nextJson) {
      onFresh?.(fresh);
    }
  })();
}

/**
 * Помечает запись как устаревшую (stale), данные не удаляются.
 * @param {string} key — логический ключ
 */
export function invalidateCache(key) {
  const raw = localStorage.getItem(storageKey(key));
  if (raw == null) return;
  try {
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') {
      localStorage.removeItem(storageKey(key));
      return;
    }
    writeEntry(key, { ...entry, stale: true, ts: 0 });
  } catch {
    localStorage.removeItem(storageKey(key));
  }
}

/** Удаляет все ключи с префиксом fleet_cache_ */
export function clearAllCache() {
  try {
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.startsWith(PREFIX)) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) {
    console.warn('[cache] clearAll failed', e);
  }
}
