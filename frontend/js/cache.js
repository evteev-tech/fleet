/**
 * stale-while-revalidate кэш в localStorage (Vanilla JS, без зависимостей).
 */

const PREFIX = 'fleet_cache_';

export const CACHE_KEYS = {
  CARS:        'cars',
  DRIVERS:     'drivers',
  RENTALS:     'rentals',
  CASH_OPS:    'cashOps',
  KASSAS:      'kassas',
  DASHBOARD:   'dashboard',
  SVODKA:      'svodka',
  DEPOSITS:    'deposits',
  INCOME_FORM: 'incomeForm',
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
  } catch {
    /* private mode / quota */
  }
}

/**
 * @param {string} key
 * @param {() => Promise<any>} fetchFn
 * @param {{ onCached?: (data: any) => void, onFresh?: (data: any) => void, onFetchError?: (err: unknown, meta: { hadCache: boolean }) => void, ttl?: number }} [options]
 */
export function getWithSWR(key, fetchFn, options = {}) {
  const ttl = options.ttl ?? 300_000;
  const { onCached, onFresh, onFetchError } = options;

  const entry = readEntry(key);
  const hadCache = !!entry;

  if (entry) {
    try {
      onCached?.(entry.data);
    } catch {
      /* callback не должен ломать кэш */
    }
  }

  const isFresh =
    entry &&
    entry.stale !== true &&
    entry.ts != null &&
    entry.ts + ttl > Date.now();

  if (isFresh) {
    return;
  }

  void (async () => {
    let fresh;
    try {
      fresh = await fetchFn();
    } catch (err) {
      console.warn(`[SWR] ${key} fetch failed:`, err?.message ?? err);
      try {
        onFetchError?.(err, { hadCache });
      } catch {
        /* */
      }
      if (entry?.data) {
        console.log(`[SWR] ${key} stale data kept in localStorage after error`);
      }
      return;
    }

    const cachedData = entry?.data;
    const prevJson = JSON.stringify(cachedData);
    const nextJson = JSON.stringify(fresh);

    writeEntry(key, { data: fresh, ts: Date.now(), stale: false });

    if (prevJson !== nextJson) {
      try {
        onFresh?.(fresh);
      } catch {
        /* */
      }
    }
  })();
}

/**
 * Помечает запись как устаревшую (следующий getWithSWR сходит в сеть).
 * @param {string} key
 */
export function invalidateCache(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw == null) return;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') {
      try {
        localStorage.removeItem(storageKey(key));
      } catch {
        /* */
      }
      return;
    }
    writeEntry(key, { ...entry, stale: true });
  } catch {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      /* */
    }
  }
}

/** Удаляет все ключи localStorage с префиксом fleet_cache_ */
export function clearAllCache() {
  try {
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.startsWith(PREFIX)) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
}
