/**
 * register-sw.js — регистрация Service Worker
 * Подключать из app.js
 */

/**
 * Регистрирует Service Worker и показывает статус в консоли
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker не поддерживается браузером');
    return;
  }

  try {
    const swUrl = new URL('sw.js', window.location.href);
    const scopeUrl = new URL('./', window.location.href);
    const registration = await navigator.serviceWorker.register(swUrl.href, {
      scope: scopeUrl.href,
    });

    console.log('[SW] Service Worker зарегистрирован:', registration.scope);

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      console.log('[SW] Найдено обновление Service Worker');

      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW] Новая версия готова. Перезагрузите страницу для обновления.');
          showUpdateNotification();
        }
      });
    });
  } catch (error) {
    console.error('[SW] Ошибка регистрации Service Worker:', error);
  }
}

function showUpdateNotification() {
  console.log('[SW] Доступно обновление приложения');
}

/**
 * @returns {boolean} true если онлайн
 */
export function isOnline() {
  return navigator.onLine;
}

/**
 * Подписка на события online/offline
 */
export function monitorNetworkStatus() {
  window.addEventListener('online', () => {
    console.log('[Network] Соединение восстановлено');
    document.body.classList.remove('offline');
    document.body.classList.add('online');
  });

  window.addEventListener('offline', () => {
    console.log('[Network] Соединение потеряно');
    document.body.classList.remove('online');
    document.body.classList.add('offline');
  });

  if (isOnline()) {
    document.body.classList.add('online');
  } else {
    document.body.classList.add('offline');
  }
}
