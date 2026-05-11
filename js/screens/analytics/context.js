/**
 * Данные сессии аналитики (операции, парк, кассы, залоги) для модулей вкладок.
 * Главный analytics.js обновляет через setAnalyticsContext перед расчётом и рендером.
 */
export const analyticsCtx = {
  ops: [],
  cars: [],
  kassas: [],
  deposits: [],
};

export function setAnalyticsContext(partial) {
  if (partial.ops !== undefined) analyticsCtx.ops = partial.ops;
  if (partial.cars !== undefined) analyticsCtx.cars = partial.cars;
  if (partial.kassas !== undefined) analyticsCtx.kassas = partial.kassas;
  if (partial.deposits !== undefined) analyticsCtx.deposits = partial.deposits;
}
