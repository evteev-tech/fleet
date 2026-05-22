/**
 * sw.js — Service Worker для офлайн-работы и кеширования
 *
 * Статика: precache при install
 * Запросы: Network First, при ошибке — Cache (кроме Google API и CDN)
 */

const CACHE_NAME = 'matizi-v4';
const STATIC_CACHE_NAME = 'matizi-static-v4';

/** Пути от корня приложения (корректны и для GitHub Pages в подпапке). */
const STATIC_FILES = [
  './',
  './index.html',
  './css/main.css',
  './css/offline-indicator.css',
  './css/components.css',
  './css/colors.css',
  './css/screens.css',
  './css/screens/login.css',
  './css/screens/home.css',
  './css/screens/dashboard.css',
  './css/screens/analytics.css',
  './css/screens/history.css',
  './css/screens/fleet.css',
  './css/screens/drivers.css',
  './css/screens/income.css',
  './css/screens/transfer.css',
  './css/screens/add.css',
  './css/screens/settings.css',
  './css/screens/car.css',
  './css/analytics_theme.css',
  './css/expense.css',
  './css/desktop.css',
  './js/register-sw.js',
  './js/app.js',
  './js/router.js',
  './js/auth.js',
  './js/api.js',
  './js/cache.js',
  './js/config.js',
  './js/sidebar.js',
  './js/ui.js',
  './js/utils/date.js',
  './js/utils/format.js',
  './js/utils/rent.js',
  './js/lib/kassa-operations.js',
  './js/lib/kassa-money.js',
  './js/mock/data.js',
  './js/screens/home.js',
  './js/screens/dashboard.js',
  './js/screens/add.js',
  './js/screens/history.js',
  './js/screens/fleet.js',
  './js/screens/drivers.js',
  './js/screens/driver.js',
  './js/screens/car.js',
  './js/api/car-files.js',
  './js/screens/settings.js',
  './js/screens/analytics.js',
  './js/screens/analytics/context.js',
  './js/screens/analytics/utils.js',
  './js/screens/analytics/overview.js',
  './js/screens/analytics/parkLoad.js',
  './js/screens/analytics/opex.js',
  './js/screens/analytics/pnl.js',
  './js/screens/analytics/capex.js',
  './js/screens/analytics/kassas.js',
  './js/screens/analytics/forecast.js',
  './js/screens/analytics/capexCharts.js',
  './js/screens/analytics/chartLoader.js',
  './js/screens/analytics/desktop.js',
  './js/screens/income.js',
  './js/screens/expense.js',
  './js/screens/transfer.js',
  './js/screens/edit-operation.js',
  './favicon.svg',
];

function resolveUrl(path) {
  return new URL(path, self.location.href).href;
}

self.addEventListener('install', event => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(cache =>
      Promise.all(
        STATIC_FILES.map(path =>
          cache
            .add(resolveUrl(path))
            .catch(err => console.warn('[SW] precache skip:', path, err?.message || err)),
        ),
      ).then(() => self.skipWaiting()),
    ),
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches
      .keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const { request } = event;
  const url = new URL(request.url);

  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('script.google.com')
  ) {
    return;
  }

  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) {
            console.log('[SW] Serving from cache:', request.url);
            return cached;
          }

          if (request.mode === 'navigate') {
            return caches.match(resolveUrl('./index.html'));
          }

          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        }),
      ),
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(names => Promise.all(names.map(name => caches.delete(name)))).then(() => {
        console.log('[SW] All caches cleared');
      }),
    );
  }
});
