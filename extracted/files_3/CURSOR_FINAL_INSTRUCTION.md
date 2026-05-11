# Финальная инструкция для Cursor — рефакторинг analytics.js

## Что делаем

Разбиваем `js/screens/analytics.js` (1946 строк) на 9 модулей по вкладкам.

## Файлы в Downloads

Папка `analytics_modules/` содержит 9 шаблонов с:
- ✅ Правильными импортами
- ✅ Структурой функций
- ⬜ Заглушками `// TODO: вставить код` — **вам нужно заполнить их**

---

## Пошаговая инструкция

### 1. Создать структуру

```bash
mkdir js/screens/analytics
```

### 2. Скопировать шаблоны

Скопировать все файлы из `Downloads/analytics_modules/` в `js/screens/analytics/`

**НО:** главный `analytics.js` пока не трогаем (заполним его последним).

---

### 3. Заполнить модули (копипаст по чеклисту)

Открываем текущий `js/screens/analytics.js` и **копируем** код функций в шаблоны.

#### 3.1. `analytics/utils.js`

Открыть `js/screens/analytics/utils.js`, найти все `// TODO:` и вставить:

| Строки из старого analytics.js | Куда вставить в utils.js |
|-------------------------------|--------------------------|
| **48-56** | `pillMonths()` |
| **58-62** | `pillShortLabel()` |
| **75-84** | `opClass()` |
| **86-100** | `toOpDate()` |
| **265-281** | `deltaBlock()` |
| **672-676** | `monthLabelShort()` |
| **678-682** | `monthLabelFull()` |

**Сохранить** `utils.js` ✓

---

#### 3.2. `analytics/overview.js`

| Строки | Куда |
|--------|------|
| **283-299** | `tilesHtml()` |
| **301-439** | `renderOverview()` |

**Важно:** в строке 301 функция называется `_overviewHtml` — переименовать в `renderOverview`.

**Сохранить** `overview.js` ✓

---

#### 3.3. `analytics/opex.js`

| Строки | Куда |
|--------|------|
| **440-443** | `prevPeriodLabel()` |
| **445-520** | `opexDynamicsHtml()` |
| **522-584** | `renderOpex()` |

**Переименовать:** `_opexHtml` → `renderOpex` (строка 522)

**Сохранить** `opex.js` ✓

---

#### 3.4. `analytics/pnl.js`

| Строки | Куда |
|--------|------|
| **585-589** | `pnlShortK()` |
| **591-607** | `pnlHeatBg()` |
| **609-636** | `pnlHtml()` |
| **638-650** | `pnlRowsWithTotals()` |
| **652-670** | `utilHtml()` |

Функция `renderPnL()` уже написана в шаблоне — не трогать.

**Сохранить** `pnl.js` ✓

---

#### 3.5. `analytics/capex.js`

| Строки | Куда |
|--------|------|
| **684-697** | `capexBucketName()` |
| **699-718** | `capexPageMonthly()` |
| **720-842** | `renderCapex()` |

**Переименовать:** `_capexPageHtml` → `renderCapex` (строка 720)

**Сохранить** `capex.js` ✓

---

#### 3.6. `analytics/kassas.js`

| Строки | Куда |
|--------|------|
| **843-894** | `renderKassas()` |

**Переименовать:** `_kassasRowsHtml` → `renderKassas` (строка 843)

**Важно:** в конце функции обернуть возвращаемый HTML:
```javascript
return `
  <div class="analytics-page" data-page="4">
    ${/* весь существующий HTML */}
  </div>
`;
```

**Сохранить** `kassas.js` ✓

---

#### 3.7. `analytics/forecast.js`

| Строки | Куда |
|--------|------|
| **920-927** | `parseDDMMYYYY()` |
| **929-951** | `buildForecast()` |
| **953-1037** | `forecastHtml()` |
| **1039-1065** | `forecastLoadingHtml()` |
| **1067-1085** | `animateForecast()` |

Функция `renderForecast()` уже написана в шаблоне.

**Сохранить** `forecast.js` ✓

---

#### 3.8. `analytics/desktop.js`

| Строки | Куда |
|--------|------|
| **1347-1370** | `sparklineSvg()` |
| **1372-1377** | `hbar()` |
| **1379-1396** | `miniDonut()` |
| **1398-1407** | `dtDelta()` |
| **1409-1424** | `monthSeries()` |
| **1426-1635** | `renderDesktopShell()` |
| **1637-1663** | `renderDesktopSkeleton()` |

**Переименовать:** 
- `_desktopShellHTML` → `renderDesktopShell` (строка 1426)
- `_desktopSkeletonHTML` → `renderDesktopSkeleton` (строка 1637)

**Сохранить** `desktop.js` ✓

---

### 4. Обновить главный `analytics.js`

Открыть `Downloads/analytics_modules/analytics.js` — это новый главный файл.

**Заполнить все `// TODO:`:**

| Строки из старого | Куда в новом analytics.js |
|-------------------|---------------------------|
| **64-73** | `dashboardHasContent()` |
| **102-263** | `calcDash()` — **большая функция!** |
| **896-918** | `headerPillsHtml()` |
| **1087-1132** | `pagesHtml()` — **см. важное ниже** |
| **1134-1139** | `dotsHtml()` |
| **1141-1157** | `shellFromParts()` |
| **1159-1175** | `skeletonShellHTML()` |
| **1177-1192** | `errorShellHTML()` |
| **1194-1200** | `successShellHTML()` |
| **1202-1211** | `updateCarouselChrome()` |
| **1213-1279** | `animatePage()` |
| **1281-1307** | `bindCarouselScroll()` |
| **1309-1313** | `hydrateKassas()` |
| **1315-1343** | `afterShellMounted()` |
| **1665-1669** | `applyDashToState()` |
| **1671-1858** | `refreshViewOnly()` — **большая функция!** |
| **1860-1931** | `onRootClick()` — **большая функция!** |
| **1933-1946** | `initAnalytics()` |

#### ⚠️ Важно для `pagesHtml()` (строки 1087-1132)

При копировании кода функции `_pagesHtml` **заменить** вызовы старых функций:

```javascript
// Было в старом файле:
pages[0] = _overviewHtml(dash);
pages[1] = _opexHtml(dash.opex);
pages[2] = _capexPageHtml(dash, capexMode);
pages[3] = _pnlHtml(...);
pages[4] = _kassasRowsHtml(dash);
pages[5] = _forecastHtml(...);

// Стало в новом:
pages[0] = renderOverview(dash);
pages[1] = renderOpex(dash.opex);
pages[2] = renderCapex(dash, capexMode);
pages[3] = renderPnL(dash);
pages[4] = renderKassas(dash);
pages[5] = renderForecast(state.rentals);
```

**Заменить** `js/screens/analytics.js` на заполненную новую версию ✓

---

### 5. Удалить старый бэкап (опционально)

Можно сохранить старый `analytics.js` как `analytics.OLD.js` для подстраховки, потом удалить.

---

## 6. Проверка

### В браузере:

1. Открыть приложение
2. Перейти в **Аналитику**
3. Проверить все 6 вкладок работают:
   - Обзор (hero-блок, тайлы, парк)
   - Расходы (динамика OPEX, бары)
   - CAPEX (донат, timeline, ROI, toggle)
   - По машинам (PnL heatmap, утилизация)
   - Кассы (3 ряда касс)
   - Прогноз (недели, анимация)
4. Проверить **desktop версию** (ширина >1024px)
5. Проверить **события**: клики по таблам, свайпы, анимации

### В консоли:

Не должно быть ошибок импортов или `undefined function`.

---

## Если что-то сломалось

1. **Откат:** вернуть старый `analytics.js` из бэкапа
2. **Удалить** папку `js/screens/analytics/`
3. **Проверить** в каком модуле ошибка через консоль браузера
4. **Исправить** импорты или переименования функций

---

## Итоговая структура

```
js/screens/
  analytics.js              ← 300-400 строк (оркестратор)
  analytics/
    utils.js               ← 120 строк
    overview.js            ← 160 строк
    opex.js                ← 170 строк
    pnl.js                 ← 120 строк
    capex.js               ← 160 строк
    kassas.js              ← 60 строк
    forecast.js            ← 140 строк
    desktop.js             ← 320 строк
```

**Было:** 1 файл 1946 строк  
**Стало:** 9 файлов по 60-400 строк

---

## Результат

✅ Легко найти код любой вкладки  
✅ Меньше конфликтов при работе  
✅ Проще тестировать отдельные части  
✅ Можно переиспользовать модули  

**Пункт 10 аудита выполнен!** 🎉
