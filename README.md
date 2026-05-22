# keyautotrans

Серверная версия приложения для управления автопарком (аренда автомобилей).

## Стек
- Backend: Node.js 22 + Express (ES modules), SQLite (better-sqlite3)
- Frontend: Vanilla JS (PWA)
- Сервер: nginx + PM2, Ubuntu 24.04
- Домен: https://keyautotrans.ru

## Структура
- `backend/` — API-сервер (Express)
- `frontend/` — статический фронтенд (PWA)
- `scripts/` — деплой

## Деплой
См. `scripts/deploy.sh`
