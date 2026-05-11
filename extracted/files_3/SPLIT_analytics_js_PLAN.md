# План разбиения analytics.js (пункт 10 аудита)

## Текущее состояние
- **Файл:** `js/screens/analytics.js`
- **Размер:** 1946 строк
- **Проблема:** 6 вкладок аналитики в одном файле, любая правка одной вкладки трогает весь файл

## Архитектура

### Главный оркестратор
**`js/screens/analytics.js`** (~300 строк)
- Импорты всех модулей
- `initAnalytics()` — точка входа
- Роутинг между вкладками (carousel logic)
- Общие утилиты (`_calcDash`, `_pillMonths`, `_toOpDate`)
- Desktop/mobile shell
- Event handlers

### Модули вкладок
Каждая вкладка — отдельный модуль в `js/screens/analytics/`

**1. `analytics/overview.js`** (~150 строк)
- `renderOverview(dash)` → HTML обзора
- Hero-блок (прибыль)
- 4 тайла (выручка, OPEX, CAPEX, парк)
- Парк машин (rent/idle/repair)

**2. `analytics/opex.js`** (~250 строк)
- `renderOpex(dash)` → HTML расходов
- OPEX dynamics (сравнение с прошлым)
- Top-3 категории
- Разбивка по категориям (бары)
- Цвета OPEX (`OPEX_COLORS`)

**3. `analytics/capex.js`** (~300 строк)
- `renderCapex(dash, mode)` → HTML капитальных расходов
- Переключатель месяц/всё время
- Донат по категориям
- Timeline по месяцам
- ROI карточка

**4. `analytics/pnl.js`** (~200 строк)
- `renderPnL(dash)` → HTML P&L по машинам
- Heatmap карточки машин
- Утилизация (маленькая секция)
- Расчёт маржи

**5. `analytics/kassas.js`** (~150 строк)
- `renderKassas(dash)` → HTML касс
- 3 кассы (приход/расход/баланс)
- Динамика по месяцам

**6. `analytics/forecast.js`** (~250 строк)
- `renderForecast(rentals)` → HTML прогноза
- Загрузка данных аренд (ленивая)
- Расчёт выручки по дням
- Недельные блоки
- Анимация появления

### Общие утилиты
**`analytics/utils.js`** (~100 строк)
- `fmtRub`, `fmtShort`, `parseDate` (реэкспорт из `../utils/format.js`)
- `_toOpDate` — парсинг даты операции
- `_opClass` — тип операции (revenue/opex/capex)
- `_deltaBlock` — блок роста/падения
- Константы (`PAGE_LABELS`, `CAPEX_MODE`)

### Desktop-specific
**`analytics/desktop.js`** (~300 строк)
- `renderDesktopShell(dash)` → полная версия для desktop
- Inline sparklines, mini-donut, bars
- Desktop-specific layout

---

## Структура файлов

```
js/screens/
  analytics.js              ← главный оркестратор (300 строк)
  analytics/
    overview.js             ← вкладка "Обзор" (150 строк)
    opex.js                 ← вкладка "Расходы" (250 строк)
    capex.js                ← вкладка "CAPEX" (300 строк)
    pnl.js                  ← вкладка "По машинам" (200 строк)
    kassas.js               ← вкладка "Кассы" (150 строк)
    forecast.js             ← вкладка "Прогноз" (250 строк)
    desktop.js              ← desktop layout (300 строк)
    utils.js                ← общие утилиты (100 строк)
```

**Итого:** ~2000 строк разнесены по 8 файлам

---

## Интерфейсы модулей

### overview.js
```javascript
export function renderOverview(dash) {
  // возвращает HTML string
  return `<div class="analytics-page">...</div>`;
}
```

### opex.js
```javascript
export const OPEX_COLORS = { ... };

export function renderOpex(dash) {
  return `<div class="analytics-page">...</div>`;
}
```

### capex.js
```javascript
export const CAPEX_MODE = { PERIOD: 'period', ALL: 'all' };

export function renderCapex(dash, mode = CAPEX_MODE.PERIOD) {
  return `<div class="analytics-page">...</div>`;
}
```

### pnl.js
```javascript
export function renderPnL(dash) {
  return `<div class="analytics-page">...</div>`;
}

export function renderUtilization(dash) {
  return `<div class="analytics-util">...</div>`;
}
```

### kassas.js
```javascript
export function renderKassas(dash) {
  return `<div class="analytics-page">...</div>`;
}
```

### forecast.js
```javascript
export async function renderForecast() {
  // загружает данные аренд
  const rentals = await loadRentals();
  return `<div class="analytics-page">...</div>`;
}
```

### desktop.js
```javascript
export function renderDesktopShell(dash) {
  return `<div class="analytics-desktop">...</div>`;
}
```

### utils.js
```javascript
export { fmtRub, fmtDate, parseDate } from '../../utils/format.js';
export const PAGE_LABELS = [...];
export const CAPEX_MODE = { ... };
export function toOpDate(op) { ... }
export function opClass(op) { ... }
```

---

## Главный файл analytics.js (после рефакторинга)

```javascript
import { renderOverview } from './analytics/overview.js';
import { renderOpex } from './analytics/opex.js';
import { renderCapex, CAPEX_MODE } from './analytics/capex.js';
import { renderPnL } from './analytics/pnl.js';
import { renderKassas } from './analytics/kassas.js';
import { renderForecast } from './analytics/forecast.js';
import { renderDesktopShell } from './analytics/desktop.js';
import { PAGE_LABELS, toOpDate, opClass } from './analytics/utils.js';

export function initAnalytics() {
  const root = document.getElementById('analytics-root');
  if (!root) return;
  
  // Загрузка данных
  const dash = await loadDashboard();
  
  // Рендер в зависимости от режима
  if (isDesktop()) {
    root.innerHTML = renderDesktopShell(dash);
  } else {
    root.innerHTML = renderMobileShell(dash);
  }
  
  // Биндинг событий
  bindCarousel(root);
}

function renderMobileShell(dash) {
  const pages = [
    renderOverview(dash),
    renderOpex(dash),
    renderCapex(dash, state.capexMode),
    renderPnL(dash),
    renderKassas(dash),
    renderForecast(),
  ];
  
  return `
    <div class="analytics-header">...</div>
    <div class="analytics-carousel">${pages.join('')}</div>
    <div class="analytics-dots">...</div>
  `;
}
```

---

## Преимущества

1. **Легко найти:** нужна вкладка Прогноз → открываем `forecast.js`
2. **Меньше конфликтов:** при работе над разными вкладками
3. **Проще тестировать:** каждый модуль можно тестировать отдельно
4. **Быстрее code review:** изменения локализованы
5. **Переиспользование:** `renderOpex` можно вызвать из других мест

## Недостатки

- Больше импортов
- Нужна дисциплина именования (не дублировать утилиты)

---

## Порядок работы

1. Создать папку `js/screens/analytics/`
2. Создать 8 файлов-модулей
3. Вынести код вкладок по модулям
4. Обновить главный `analytics.js` (импорты + оркестрация)
5. Проверить все 6 вкладок работают

**Создавать вручную или скриптом?**

Предлагаю **полуавтоматически**: скрипт разрежет на блоки по функциям, потом вручную соберём модули и почистим интерфейсы.
