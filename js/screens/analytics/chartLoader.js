/**
 * Ленивая загрузка Chart.js (только для вкладки CAPEX).
 */

let chartJsPromise = null;

export function loadChartJs() {
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Chart) {
      resolve(window.Chart);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (window.Chart) resolve(window.Chart);
      else reject(new Error('Chart.js loaded but window.Chart missing'));
    };
    s.onerror = () => reject(new Error('Chart.js script failed'));
    document.head.appendChild(s);
  });
  return chartJsPromise;
}
