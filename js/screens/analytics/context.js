/**
 * Данные сессии аналитики (операции, парк, кассы, залоги) для модулей вкладок.
 * Главный analytics.js обновляет через setAnalyticsContext перед расчётом и рендером.
 */
export const analyticsCtx = {
  ops: [],
  cars: [],
  kassas: [],
  deposits: [],
  /** @type {Array<{rentalId:string,carId:string,driverId:string,dateStart:Date|null,dateEnd:Date|null,rateDay:number,note?:string}>} */
  rentals: [],
  /** @type {Array<{year:number,month:number,revenue?:number,opex?:number,profit?:number}>} */
  trailing12: [],
  /**
   * Точность прогноза из GET_DASHBOARD.forecastAccuracy (simple, окна 3/6 мес.).
   * @type {{ window3: { smape: number|null, hitRate: number|null, bias: number|null, sampleSize: number }, window6: same, model: string }}
   */
  forecastAccuracy: {
    window3: { smape: null, hitRate: null, bias: null, sampleSize: 0 },
    window6: { smape: null, hitRate: null, bias: null, sampleSize: 0 },
    model: 'simple',
  },
};

export function setAnalyticsContext(partial) {
  if (partial.ops !== undefined) analyticsCtx.ops = partial.ops;
  if (partial.cars !== undefined) analyticsCtx.cars = partial.cars;
  if (partial.kassas !== undefined) analyticsCtx.kassas = partial.kassas;
  if (partial.deposits !== undefined) analyticsCtx.deposits = partial.deposits;
  if (partial.rentals !== undefined) analyticsCtx.rentals = partial.rentals;
  if (partial.trailing12 !== undefined) analyticsCtx.trailing12 = partial.trailing12;
  if (partial.forecastAccuracy !== undefined) analyticsCtx.forecastAccuracy = partial.forecastAccuracy;
}
