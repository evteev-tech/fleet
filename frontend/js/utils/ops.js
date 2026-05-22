/**
 * Утилиты для операций кассы (лист «Касса_операции»).
 * Фильтры UI — не трогают сырые данные в кеше / аналитике.
 */

import { KASSA_ID } from '../config.js';

export const INVEST_KASSA_IDS = [KASSA_ID.INVEST_YULIA, KASSA_ID.INVEST_VLAD];

/**
 * Автодокапитализация: переводы основная касса ↔ инвест-счёт (бухгалтерия).
 * Скрываем из журналов на фронте.
 */
export function isAutoCapitalizationOp(op) {
  const kassaId = String(op.kassa_id ?? op.kassaId ?? '').trim();
  if (INVEST_KASSA_IDS.includes(kassaId)) return true;

  const opId = String(op.op_id ?? op.opId ?? '').trim();
  if (opId.startsWith('CAP_')) return true;

  return false;
}

/** Операции для экранов «история / сводки по кассе» без автодокапитализации */
export function filterOpsForHistoryUI(ops) {
  if (!Array.isArray(ops)) return [];
  return ops.filter(o => !isAutoCapitalizationOp(o));
}
