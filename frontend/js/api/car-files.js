/**
 * car-files.js — API-обёртки для документов и фото машин.
 *
 * Все функции используют postAction из api.js.
 * Сжатие изображений — через canvas до 1600px / JPEG 0.82.
 * Кэш файлов — in-memory Map, инвалидируется при любой записи.
 *
 * Экспорт:
 *   listCarFiles(carId)                                → { files, actualDocs }
 *   getCarFile(fileId)                                 → { name, mimeType, blobUrl }
 *   uploadCarFile(carId, kind, file, tag, meta)        → { fileId, name, viewUrl }
 *   deleteCarFile(fileId, carId)                       → ok
 *   renameCarFileTag(fileId, newTag, kind, carId)      → ok
 */

import { postAction } from '../api.js';
import { getCurrentUser } from '../auth.js';

// ─── In-memory кэш списков файлов ────────────────────────────────────────────
// Ключ: car_id, значение: { data, ts }. TTL 5 минут.
const _filesCache = new Map();
const FILES_CACHE_TTL = 300_000;

function _invalidateFilesCache(carId) {
  if (carId) _filesCache.delete(String(carId));
}

// ─── Читаемые label'ы для тегов ──────────────────────────────────────────────
export const DOC_TAG_LABELS = {
  osago:      'ОСАГО',
  sts_front:  'СТС (лицевая)',
  sts_back:   'СТС (оборот)',
  pts:        'ПТС',
  contract:   'Договор',
  diagnostic: 'Диагностика',
  other:      'Другое',
};

export const PHOTO_TAG_LABELS = {
  front:    'Перед',
  back:     'Зад',
  left:     'Левый борт',
  right:    'Правый борт',
  odometer: 'Одометр',
  damage:   'Повреждение',
  interior: 'Салон',
  other:    'Другое',
};

// Теги документов, для которых нужен срок действия
export const DOC_TAGS_WITH_VALIDITY = ['osago', 'diagnostic'];

// ─── LIST_CAR_FILES ───────────────────────────────────────────────────────────

/**
 * Возвращает список файлов машины + актуальные документы.
 * Кэш 60 сек in-memory.
 * @param {string} carId
 * @returns {Promise<{ files: object[], actualDocs: object }>}
 */
export async function listCarFiles(carId) {
  const cid = String(carId);
  const cached = _filesCache.get(cid);
  if (cached && Date.now() - cached.ts < FILES_CACHE_TTL) {
    return cached.data;
  }

  const res = await postAction('LIST_CAR_FILES', { car_id: cid });
  const data = { files: res.files ?? [], actualDocs: res.actual_docs ?? {} };
  _filesCache.set(cid, { data, ts: Date.now() });
  return data;
}

// ─── GET_CAR_FILE ─────────────────────────────────────────────────────────────

/**
 * Скачивает файл и возвращает blob URL (data:...) через GET_CAR_FILE.
 * @param {string} fileId
 * @param {string|null} [_viewUrl] — не используется (lh3 даёт 429)
 * @returns {Promise<{ name: string, mimeType: string, blobUrl: string, isCdn: boolean }>}
 */
const _blobCache = new Map(); // fileId → blobUrl

export async function getCarFile(fileId, viewUrl = null) {
  // viewUrl не используем — публичные lh3-ссылки упираются в 429.
  const cached = _blobCache.get(fileId);
  if (cached) return cached;

  const res = await postAction('GET_CAR_FILE', { file_id: fileId });
  const blobUrl = `data:${res.mimeType};base64,${res.base64}`;
  const result = { name: res.name, mimeType: res.mimeType, blobUrl, isCdn: false };
  _blobCache.set(fileId, result);
  return result;
}

// ─── UPLOAD_CAR_FILE ──────────────────────────────────────────────────────────

/**
 * Загружает файл на Drive.
 * Имя файла формируется на бэке (files.gs buildFileName_):
 *   docs:   А165_ОСАГО_до-2027-08-14_20260516.pdf
 *   photos: А165_перед_20260516-1430.jpg
 *
 * Для image/* — сжатие через canvas до 1600px / JPEG 0.82.
 * Для остальных — as-is, лимит 8 МБ.
 *
 * @param {string} carId
 * @param {'docs'|'photos'} kind
 * @param {File} file         — нативный File объект из <input>
 * @param {string} tag        — osago / sts / front / damage / ...
 * @param {object} [meta]     — { validUntil?, rentalId?, mileage?, note? }
 * @param {function} [onProgress]  — (0..1) для индикатора
 * @returns {Promise<{ fileId: string, name: string, viewUrl: null }>}
 */
export async function uploadCarFile(carId, kind, file, tag, meta = {}, onProgress) {
  const user = getCurrentUser();
  if (!user) throw new Error('NOT_LOGGED_IN');

  const MAX_BYTES = 8 * 1024 * 1024;

  onProgress?.(0.05);

  let dataBase64;
  let mimeType = file.type || 'application/octet-stream';

  if (file.type.startsWith('image/')) {
    // Сжимаем через canvas
    dataBase64 = await _compressImage(file, onProgress);
    mimeType = 'image/jpeg';
  } else {
    // Проверяем размер
    if (file.size > MAX_BYTES) {
      throw new Error(`FILE_TOO_LARGE: максимум 8 МБ, файл ${(file.size / 1024 / 1024).toFixed(1)} МБ`);
    }
    dataBase64 = await _fileToBase64(file);
    onProgress?.(0.5);
  }

  onProgress?.(0.8);

  const payload = {
    car_id:      String(carId),
    kind,
    tag,
    mime_type:   mimeType,
    filename:    file.name,
    data_base64: dataBase64,
    email:       user.email,
  };
  if (meta.validUntil) payload.valid_until = meta.validUntil;
  if (meta.rentalId)   payload.rental_id   = String(meta.rentalId);
  if (meta.mileage)    payload.mileage      = Number(meta.mileage);
  if (meta.note)       payload.note         = String(meta.note);

  const res = await postAction('UPLOAD_CAR_FILE', payload);
  onProgress?.(1);

  _invalidateFilesCache(carId);
  return { fileId: res.file_id, name: res.name, viewUrl: res.view_url ?? null };
}

// ─── DELETE_CAR_FILE ──────────────────────────────────────────────────────────

/**
 * Мягко удаляет файл (в корзину Drive).
 * @param {string} fileId
 * @param {string} carId   — для инвалидации кэша
 */
export async function deleteCarFile(fileId, carId) {
  const user = getCurrentUser();
  if (!user) throw new Error('NOT_LOGGED_IN');

  await postAction('DELETE_CAR_FILE', {
    file_id: fileId,
    car_id:  String(carId),
    email:   user.email,
  });

  _blobCache.delete(fileId);
  _invalidateFilesCache(carId);
}

// ─── RENAME_CAR_FILE ──────────────────────────────────────────────────────────

/**
 * Меняет тег файла.
 * @param {string} fileId
 * @param {string} newTag
 * @param {'docs'|'photos'} kind
 * @param {string} carId
 * @param {object} [meta]  — { validUntil? }
 */
export async function renameCarFileTag(fileId, newTag, kind, carId, meta = {}) {
  const user = getCurrentUser();
  if (!user) throw new Error('NOT_LOGGED_IN');

  const payload = {
    file_id: fileId,
    new_tag: newTag,
    kind,
    car_id:  String(carId),
    email:   user.email,
  };
  if (meta.validUntil !== undefined) payload.valid_until = meta.validUntil || '';

  await postAction('RENAME_CAR_FILE', payload);
  _blobCache.delete(fileId);
  _invalidateFilesCache(carId);
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────

/**
 * Сжимает изображение через canvas до 1600px по длинной стороне, JPEG 0.82.
 * @param {File} file
 * @param {function} [onProgress]
 * @returns {Promise<string>} base64 без data: prefix
 */
function _compressImage(file, onProgress) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      onProgress?.(0.3);

      const MAX_SIDE = 1600;
      let { width, height } = img;

      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width >= height) {
          height = Math.round((height * MAX_SIDE) / width);
          width = MAX_SIDE;
        } else {
          width = Math.round((width * MAX_SIDE) / height);
          height = MAX_SIDE;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      onProgress?.(0.6);

      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('CANVAS_FAILED')); return; }
        const reader = new FileReader();
        reader.onload = () => {
          // reader.result = "data:image/jpeg;base64,XXXX"
          const b64 = reader.result.split(',')[1];
          resolve(b64);
        };
        reader.onerror = () => reject(new Error('FILEREADER_FAILED'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.82);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('IMAGE_LOAD_FAILED'));
    };

    img.src = objectUrl;
  });
}

/**
 * Конвертирует любой File в base64 строку (без data: prefix).
 * @param {File} file
 * @returns {Promise<string>}
 */
function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('FILEREADER_FAILED'));
    reader.readAsDataURL(file);
  });
}

/**
 * Форматирует дату valid_until для показа пользователю.
 * Вход: 'YYYY-MM-DD', выход: 'DD.MM.YYYY'
 */
export function fmtValidUntil(raw) {
  if (!raw) return '';
  const [y, m, d] = String(raw).split('-');
  if (!y || !m || !d) return raw;
  return `${d}.${m}.${y}`;
}

/**
 * Возвращает статус срока действия документа.
 * @returns {'ok'|'warning'|'expired'|null}
 */
export function docValidityStatus(validUntil) {
  if (!validUntil) return null;
  const until = new Date(validUntil);
  if (isNaN(until.getTime())) return null;
  const now = Date.now();
  const diff = until.getTime() - now;
  const days = Math.ceil(diff / 86_400_000);
  if (days < 0)  return 'expired';
  if (days <= 30) return 'warning';
  return 'ok';
}

/**
 * Возвращает человекочитаемое описание срока.
 */
export function docValidityLabel(validUntil) {
  if (!validUntil) return 'бессрочно';
  const until = new Date(validUntil);
  if (isNaN(until.getTime())) return '';
  const diff = until.getTime() - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  if (days < 0)  return `истёк ${Math.abs(days)} дн. назад`;
  if (days === 0) return 'истекает сегодня';
  if (days <= 30) return `истекает через ${days} дн.`;
  return `до ${fmtValidUntil(validUntil)}`;
}
