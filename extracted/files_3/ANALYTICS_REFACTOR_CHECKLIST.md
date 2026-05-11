# Чеклист разбиения analytics.js на модули

## Карта функций (строки → модуль)

### 📁 `analytics/utils.js` — общие утилиты
```
Строки 19-100:
- [ ] 19-22:   PAGE_LABELS, CAPEX_MODE (константы)
- [ ] 24-37:   OPEX_COLORS (цвета категорий)
- [ ] 42-46:   getOpexColor(category)
- [ ] 48-56:   _pillMonths()
- [ ] 58-62:   _pillShortLabel(year, month)
- [ ] 75-84:   _opClass(op) — тип операции
- [ ] 86-100:  _toOpDate(op) — парсинг даты
- [ ] 265-281: _deltaBlock(key, cur, prev) — блок ↑↓
- [ ] 672-676: _monthLabelShort(year, month)
- [ ] 678-682: _monthLabelFull(year, month)

Реэкспорты:
export { fmtRub, fmtDate, parseDate, fmtShort } from '../../utils/format.js';
```

### 📁 `analytics/overview.js` — вкладка "Обзор"
```
Строки 283-439:
- [ ] 283-299: _tilesHtml(summary) — 4 тайла
- [ ] 301-439: _overviewHtml(dash) — весь HTML обзора
  Включает: hero-блок, тайлы, парк машин (ovw-fleet)
```

### 📁 `analytics/opex.js` — вкладка "Расходы"
```
Строки 440-584:
- [ ] 440-443: _prevPeriodLabel(year, month)
- [ ] 445-520: _opexDynamicsHtml(dash, currentRows, currentTotal)
  Включает: сравнение с прошлым, Top-3, стрелки
- [ ] 522-584: _opexHtml(opex)
  Включает: все бары категорий OPEX
  
Использует: OPEX_COLORS из utils.js
```

### 📁 `analytics/pnl.js` — вкладка "По машинам" (P&L)
```
Строки 585-670:
- [ ] 585-589: _pnlShortK(n) — форматирование сокращённое
- [ ] 591-607: _pnlHeatBg(revenue, result) — цвет фона ячейки
- [ ] 609-636: _pnlHtml(pnl) — HTML heatmap
- [ ] 638-650: _pnlRowsWithTotals(pnl, generalOpex)
- [ ] 652-670: _utilHtml(utilization) — утилизация
```

### 📁 `analytics/capex.js` — вкладка "CAPEX"
```
Строки 684-842:
- [ ] 684-697: _capexBucketName(cat) — имя категории
- [ ] 699-718: _capexPageMonthly(ops, year, month) — расчёт за месяц
- [ ] 720-842: _capexPageHtml(dash, capexMode)
  Включает: донат, timeline, ROI, toggle месяц/всё время
  
Использует: CAPEX_MODE из utils.js
```

### 📁 `analytics/kassas.js` — вкладка "Кассы"
```
Строки 843-894:
- [ ] 843-894: _kassasRowsHtml(dash)
  Включает: 3 кассы с приход/расход/баланс
```

### 📁 `analytics/forecast.js` — вкладка "Прогноз"
```
Строки 920-1085:
- [ ] 920-927:  _parseDDMMYYYY(str) — парсинг даты DD.MM.YYYY
- [ ] 929-951:  _buildForecast(rentals) — расчёт прогноза
- [ ] 953-1037: _forecastHtml(rentals) — HTML всего прогноза
- [ ] 1039-1065: _forecastLoadingHtml() — скелетон
- [ ] 1067-1085: _animateForecast(container) — анимация появления
```

### 📁 `analytics/desktop.js` — Desktop layout
```
Строки 1345-1663:
- [ ] 1345:     _isDesktop()
- [ ] 1347-1370: _sparklineSvg(values, color, height)
- [ ] 1372-1377: _hbar(pct, color)
- [ ] 1379-1396: _miniDonut(slices, size)
- [ ] 1398-1407: _dtDelta(key, cur, prev)
- [ ] 1409-1424: _monthSeries(ops, key, year, month)
- [ ] 1426-1635: _desktopShellHTML(dash) — весь HTML десктопа
- [ ] 1637-1663: _desktopSkeletonHTML()
```

### 📁 `analytics.js` — главный оркестратор (остаётся)
```
Строки 1-18: импорты
- [ ] 1-17: import { ... } from '...'

Строки 64-263: _calcDash + _dashboardHasContent
- [ ] 64-73:  _dashboardHasContent(d)
- [ ] 102-263: _calcDash({ ops, cars, kassas, deposits, allTime, year, month })
  Большая функция расчёта всех метрик

Строки 896-1932: mobile shell + state + события
- [ ] 896-918:  _headerPillsHtml(dash)
- [ ] 1087-1132: _pagesHtml(dash, emptyMsg, capexMode) — сборка 6 вкладок
- [ ] 1134-1139: _dotsHtml()
- [ ] 1141-1157: _shellFromParts({ headerPills, carouselInner, bottomBar })
- [ ] 1159-1175: _skeletonShellHTML()
- [ ] 1177-1192: _errorShellHTML(noConn)
- [ ] 1194-1200: _successShellHTML(dash, emptyMsg, capexMode)
- [ ] 1202-1211: _updateCarouselChrome(root, idx)
- [ ] 1213-1279: _animatePage(root, idx)
- [ ] 1281-1307: _bindCarouselScroll(root)
- [ ] 1309-1313: _hydrateKassas(root, dash)
- [ ] 1315-1343: _afterShellMounted(root, dash)
- [ ] 1665-1669: _applyDashToState(dash)
- [ ] 1671-1858: _refreshViewOnly() — большая функция обновления UI
- [ ] 1860-1931: _onRootClick(e) — обработка кликов
- [ ] 1933-1946: initAnalytics() — точка входа

State variables (строки ~1665+):
- state.capexMode
- state.currentPage
- и т.д.
```

---

## Порядок работы

1. ✅ Создать папку `js/screens/analytics/`
2. ⬜ Создать `utils.js` (скопировать функции по чеклисту)
3. ⬜ Создать `overview.js`
4. ⬜ Создать `opex.js`
5. ⬜ Создать `pnl.js`
6. ⬜ Создать `capex.js`
7. ⬜ Создать `kassas.js`
8. ⬜ Создать `forecast.js`
9. ⬜ Создать `desktop.js`
10. ⬜ Обновить главный `analytics.js` (импорты + удалить перенесённые функции)
11. ⬜ Проверить все 6 вкладок работают

---

## Важно!

- Функции с `_` в начале — приватные, не экспортируются (кроме случаев когда нужны в других модулях)
- Функции без `_` — публичные, экспортируются
- Зависимости между модулями минимизировать
- Каждый модуль должен иметь чёткий интерфейс (экспорты)

---

Следующий шаг: создать шаблоны всех 8 файлов с правильными экспортами и импортами.
