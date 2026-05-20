/*
 * files.gs — управление документами и фото машин на Google Drive.
 *
 * Архитектура:
 *   DRIVE_ROOT_ID/
 *     {car_id}/                      ← создаётся seedCarFolders()
 *       docs/                        ← СТС, ОСАГО, ПТС, договоры
 *       photos/                      ← все фото
 *
 * ID корневой папки каждой машины хранится в листе «Машины», колонка K (drive_folder_id).
 * Подпапки docs/ и photos/ ищутся по имени внутри неё (один DriveApp-вызов).
 *
 * Категория файла («osago», «sts», «front», «back», ...) хранится:
 *   — в имени файла:          {car_id}_{YYYYMMDD-HHmm}_{tag}_{shortId}.{ext}
 *   — в DriveApp.description: JSON {tag, valid_until?, rental_id?, uploaded_by, mileage?, note?}
 *
 * Кэш:
 *   CacheService с ключом 'files_{car_id}' на 60 секунд для LIST_CAR_FILES.
 *   Инвалидируется при UPLOAD/DELETE/RENAME.
 *
 * Подключение к doPost (в Code.gs, в основной switch):
 *   case 'LIST_CAR_FILES':     return handleListCarFiles(SS, body);
 *   case 'GET_CAR_FILE':       return handleGetCarFile(body);
 *   case 'UPLOAD_CAR_FILE':    return handleUploadCarFile(SS, body);
 *   case 'DELETE_CAR_FILE':    return handleDeleteCarFile(SS, body);
 *   case 'RENAME_CAR_FILE':    return handleRenameCarFileTag(SS, body);
 *   case 'SEED_CAR_FOLDERS':   return handleSeedCarFolders(SS);  // одноразовый вызов из UI
 */

// ─────────────────────────────────────────────────────────────────────────────
// КОНСТАНТЫ
// ─────────────────────────────────────────────────────────────────────────────

// ID корневой папки в Google Drive. Прописать вручную после создания папки.
var DRIVE_ROOT_ID = '1If1UevfERqrKhtp8Xn_mqtEf7vKBzzDN';

// Колонка drive_folder_id в листе «Машины» (1-based: A=1, ..., K=11).
var CARS_DRIVE_FOLDER_COL = 11;

// Подпапки внутри папки машины.
var SUBFOLDER_DOCS = 'docs';
var SUBFOLDER_PHOTOS = 'photos';

// Разрешённые tag'и. Используются для валидации входящих запросов.
var DOC_TAGS = ['osago', 'sts_front', 'sts_back', 'pts', 'contract', 'diagnostic', 'other'];
var PHOTO_TAGS = ['front', 'back', 'left', 'right', 'odometer', 'damage', 'interior', 'other'];

// Tag'и документов, для которых требуется срок действия.
var DOC_TAGS_WITH_VALIDITY = ['osago', 'diagnostic'];

// Лимит размера файла (после клиентского сжатия). 10 МБ.
var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// TTL кэша списка файлов.
var FILES_CACHE_TTL_SEC = 60;

// ─────────────────────────────────────────────────────────────────────────────
// ПРОВЕРКА ТОКЕНА И РОЛИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Проверяет, что body.token совпадает с SECRET_TOKEN из Script Properties.
 * Если в проекте уже есть глобальная проверка в doPost — эта функция дублирует,
 * но дешевле перепроверить, чем оставить хвост без защиты.
 * @returns {string|null} код ошибки или null
 */
function checkToken_(body) {
  var expected = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  if (!expected) return null; // если в Properties не задан — не блокируем (совместимость)
  if (!body || body.token !== expected) return 'INVALID_TOKEN';
  return null;
}

/**
 * Возвращает роль пользователя по email из листа «Пользователи».
 * @returns {string} 'mechanic' | 'operations' | 'investor' | ''
 */
function getUserRoleByEmail_(ss, email) {
  if (!email) return '';
  var sheet = ss.getSheetByName(SHEET.USERS);
  if (!sheet) return '';
  var data = sheet.getDataRange().getValues();
  var target = String(email).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toLowerCase() === target) {
      return String(data[i][2] || '').trim().toLowerCase();
    }
  }
  return '';
}

/**
 * Проверяет, что пользователь может писать (mechanic или operations).
 * @returns {string|null} код ошибки или null
 */
function checkWriteRole_(ss, email) {
  var role = getUserRoleByEmail_(ss, email);
  if (role === 'mechanic' || role === 'operations') return null;
  return 'FORBIDDEN';
}

// ─────────────────────────────────────────────────────────────────────────────
// УТИЛИТЫ DRIVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает (или создаёт) подпапку с заданным именем внутри родительской.
 * @returns {Folder}
 */
function getOrCreateSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/**
 * По car_id возвращает {root, docs, photos} — папки на Drive.
 * Сначала пробует взять root из колонки drive_folder_id листа «Машины»,
 * иначе ищет/создаёт подпапку с именем car_id в DRIVE_ROOT.
 * @returns {{root:Folder, docs:Folder, photos:Folder, rowIndex:number}|null}
 */
function getCarFolders_(ss, carId) {
  if (!carId) return null;
  var sheet = ss.getSheetByName(SHEET.CARS);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  var folderId = '';
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === String(carId).trim()) {
      folderId = String(data[i][CARS_DRIVE_FOLDER_COL - 1] || '').trim();
      rowIndex = i + 1; // 1-based для setValue
      break;
    }
  }
  if (rowIndex < 0) return null; // car_id не найден в листе

  var rootFolder;
  if (folderId) {
    try {
      rootFolder = DriveApp.getFolderById(folderId);
    } catch (e) {
      // ID есть, но папка удалена/недоступна — пересоздадим
      rootFolder = null;
    }
  }

  if (!rootFolder) {
    var driveRoot = DriveApp.getFolderById(DRIVE_ROOT_ID);
    var it = driveRoot.getFoldersByName(String(carId));
    rootFolder = it.hasNext() ? it.next() : driveRoot.createFolder(String(carId));
    // Записываем ID обратно в таблицу
    sheet.getRange(rowIndex, CARS_DRIVE_FOLDER_COL).setValue(rootFolder.getId());
  }

  return {
    root: rootFolder,
    docs: getOrCreateSubfolder_(rootFolder, SUBFOLDER_DOCS),
    photos: getOrCreateSubfolder_(rootFolder, SUBFOLDER_PHOTOS),
    rowIndex: rowIndex,
  };
}

/**
 * Парсит description файла как JSON. Если пусто/мусор — возвращает {}.
 */
function parseFileDescription_(file) {
  try {
    var raw = file.getDescription() || '';
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

/**
 * Сериализует и сохраняет description как JSON.
 */
function setFileDescription_(file, obj) {
  file.setDescription(JSON.stringify(obj || {}));
}

/**
 * Короткий уникальный суффикс (8 hex символов).
 */
function shortId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

/**
 * Расширение файла из mime или имени. Возвращает строку без точки.
 */
function extFromMime_(mimeType, fallbackName) {
  var map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  if (mimeType && map[mimeType]) return map[mimeType];
  if (fallbackName) {
    var dot = String(fallbackName).lastIndexOf('.');
    if (dot >= 0) return String(fallbackName).slice(dot + 1).toLowerCase();
  }
  return 'bin';
}

function buildFileName_(carId, kind, tag, mimeType, originalName, meta) {
  var d   = new Date();
  var ymd = d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  var hhmm = String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0');
  var ext = extFromMime_(mimeType, originalName);

  // Читаемые метки тегов (кириллица — в Drive человекочитаемо)
  var TAG_LABELS_DOC = {
    'osago':      'ОСАГО',
    'sts_front':  'СТС-лицевая',
    'sts_back':   'СТС-оборот',
    'pts':        'ПТС',
    'contract':   'договор',
    'diagnostic': 'диагностика',
    'other':      'документ',
  };
  var TAG_LABELS_PHOTO = {
    'front':    'перед',
    'back':     'зад',
    'left':     'левый-борт',
    'right':    'правый-борт',
    'odometer': 'одометр',
    'damage':   'повреждение',
    'interior': 'салон',
    'other':    'фото',
  };

  var tagLabel = kind === 'docs'
    ? (TAG_LABELS_DOC[tag]   || tag)
    : (TAG_LABELS_PHOTO[tag] || tag);

  var parts = [String(carId), tagLabel];

  if (kind === 'docs') {
    // Срок действия в имени для ОСАГО и диагностики
    if (meta && meta.valid_until) {
      parts.push('до-' + String(meta.valid_until)); // до-2027-08-14
    }
    parts.push(ymd);
  } else {
    // Фото: контекст аренды или пробег
    if (meta && meta.rental_id) {
      parts.push('аренда-' + String(meta.rental_id));
    }
    if (meta && meta.mileage && tag === 'odometer') {
      parts.push(String(meta.mileage) + 'км');
    }
    parts.push(ymd + '-' + hhmm);
  }

  return parts.join('_') + '.' + ext;
}

// ─────────────────────────────────────────────────────────────────────────────
// КЭШ СПИСКА ФАЙЛОВ
// ─────────────────────────────────────────────────────────────────────────────

function getFilesCacheKey_(carId) {
  return 'files_' + String(carId);
}

function invalidateFilesCache_(carId) {
  try {
    CacheService.getScriptCache().remove(getFilesCacheKey_(carId));
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST_CAR_FILES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает список файлов машины: docs + photos.
 * Body: { car_id }
 * Response: { status: 'ok', files: [...], actual_docs: {osago, sts, ...} }
 */
function handleListCarFiles(ss, body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  var carId = String(body.car_id || '').trim();
  if (!carId) return err('MISSING: car_id');

  // Кэш
  var cache = CacheService.getScriptCache();
  var cached = cache.get(getFilesCacheKey_(carId));
  if (cached) {
    try {
      return jsonOut(JSON.parse(cached));
    } catch (_) {}
  }

  var folders = getCarFolders_(ss, carId);
  if (!folders) return err('CAR_NOT_FOUND');

  var files = [];
  collectFolderFiles_(folders.docs, 'docs', files);
  collectFolderFiles_(folders.photos, 'photos', files);

  // Сортировка: свежие сверху
  files.sort(function (a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  // Считаем актуальные документы (для блока «Актуальные документы»)
  var actualDocs = computeActualDocs_(files);

  var payload = {
    status: 'ok',
    files: files,
    actual_docs: actualDocs,
  };

  try {
    cache.put(getFilesCacheKey_(carId), JSON.stringify(payload), FILES_CACHE_TTL_SEC);
  } catch (_) {}

  return jsonOut(payload);
}

function collectFolderFiles_(folder, kind, out) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var meta = parseFileDescription_(f);
    out.push({
      fileId:     f.getId(),
      name:       f.getName(),
      mimeType:   f.getMimeType(),
      kind:       kind,
      sizeBytes:  f.getSize(),
      createdAt:  f.getDateCreated().getTime(),
      tag:        meta.tag || extractTagFromName_(f.getName()),
      validUntil: meta.valid_until  || null,
      rentalId:   meta.rental_id    || null,
      uploadedBy: meta.uploaded_by  || null,
      mileage:    meta.mileage      || null,
      note:       meta.note         || '',
      viewUrl:    meta.view_url     || null,
    });
  }
}

/**
 * Извлекает tag из имени файла {car_id}_{ts}_{tag}_{short}.{ext} как fallback.
 */
function extractTagFromName_(name) {
  var parts = String(name).split('_');
  if (parts.length >= 4) return parts[2];
  return 'other';
}

/**
 * Вычисляет {osago: fileId, sts: fileId, ...} — последний валидный документ по каждому tag'у.
 * Для документов с valid_until — берётся последний загруженный с valid_until > сегодня.
 * Для бессрочных (sts, pts) — просто последний загруженный.
 */
function computeActualDocs_(files) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayMs = today.getTime();

  var byTag = {};
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.kind !== 'docs') continue;
    var tag = f.tag;
    if (DOC_TAGS_WITH_VALIDITY.indexOf(tag) >= 0) {
      // Только валидные
      if (!f.validUntil) continue;
      var until = new Date(f.validUntil).getTime();
      if (isNaN(until) || until < todayMs) continue;
    }
    // Файлы уже отсортированы по createdAt desc — первый встретившийся = последний
    if (!byTag[tag]) {
      byTag[tag] = {
        fileId: f.fileId,
        name: f.name,
        validUntil: f.validUntil,
        createdAt: f.createdAt,
      };
    }
  }
  return byTag;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET_CAR_FILE — проксирование содержимого файла
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает содержимое файла как base64 + метаданные.
 * Body: { file_id, thumbnail? }
 * Response: { status: 'ok', name, mimeType, base64 }
 *
 * Если thumbnail=true и это image — возвращает thumbnail (~200px).
 */
function handleGetCarFile(body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  var fileId = String(body.file_id || '').trim();
  if (!fileId) return err('MISSING: file_id');

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return err('FILE_NOT_FOUND');
  }

  var blob;
  var isThumb = !!body.thumbnail;
  var mime = file.getMimeType();

  if (isThumb && mime && mime.indexOf('image/') === 0) {
    // Для thumbnail используем UrlFetch к Drive thumbnailLink — DriveApp напрямую не отдаёт.
    // Простой fallback: возвращаем полный файл (клиент сам отресайзит).
    // Альтернатива (быстрее): использовать advanced Drive API с thumbnailLink, но требует
    // подключения сервиса. Для MVP оставляем полный файл — кэш на клиенте всё равно есть.
    blob = file.getBlob();
  } else {
    blob = file.getBlob();
  }

  var bytes = blob.getBytes();
  var base64 = Utilities.base64Encode(bytes);

  return ok({
    name: file.getName(),
    mimeType: mime,
    sizeBytes: bytes.length,
    base64: base64,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD_CAR_FILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Загружает новый файл в папку машины.
 * Body: {
 *   car_id, kind ('docs'|'photos'),
 *   filename (original, для расширения),
 *   mime_type, tag,
 *   data_base64,
 *   email (для проверки роли и записи uploaded_by),
 *   valid_until? (YYYY-MM-DD, для ОСАГО/диагностики),
 *   rental_id?, mileage?, note?
 * }
 * Response: { status: 'ok', file_id, name }
 */
function handleUploadCarFile(ss, body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  var roleErr = checkWriteRole_(ss, body.email);
  if (roleErr) return err(roleErr);

  var carId    = String(body.car_id   || '').trim();
  var kind     = String(body.kind     || '').trim();
  var tag      = String(body.tag      || 'other').trim().toLowerCase();
  var mimeType = String(body.mime_type || '').trim();
  var dataB64  = String(body.data_base64 || '');
  var filename = String(body.filename || '');

  if (!carId) return err('MISSING: car_id');
  if (kind !== 'docs' && kind !== 'photos') return err('INVALID: kind');
  if (!dataB64) return err('MISSING: data_base64');

  // Валидация тега
  var allowedTags = kind === 'docs' ? DOC_TAGS : PHOTO_TAGS;
  if (allowedTags.indexOf(tag) < 0) tag = 'other';

  // Декод и проверка размера
  var bytes;
  try {
    bytes = Utilities.base64Decode(dataB64);
  } catch (e) {
    return err('INVALID_BASE64');
  }
  if (bytes.length > MAX_FILE_SIZE_BYTES) return err('FILE_TOO_LARGE');

  // Папки
  var folders = getCarFolders_(ss, carId);
  if (!folders) return err('CAR_NOT_FOUND');
  var targetFolder = kind === 'docs' ? folders.docs : folders.photos;

  // Метаданные для имени файла
  var meta = {};
  if (body.valid_until) meta.valid_until = String(body.valid_until);
  if (body.rental_id)   meta.rental_id   = String(body.rental_id);
  if (body.mileage)     meta.mileage     = Number(body.mileage);
  if (body.note)        meta.note        = String(body.note);

  // Новое имя
  var newName = buildFileName_(carId, kind, tag, mimeType, filename, meta);

  // Создание файла
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', newName);
  var file = targetFolder.createFile(blob);

  // Description с метаданными (фото приватные — грузим через GET_CAR_FILE)
  var descMeta = {
    tag:         tag,
    uploaded_by: String(body.email || ''),
    uploaded_at: new Date().toISOString(),
  };
  if (meta.valid_until) descMeta.valid_until = meta.valid_until;
  if (meta.rental_id)   descMeta.rental_id   = meta.rental_id;
  if (meta.mileage)     descMeta.mileage      = meta.mileage;
  if (meta.note)        descMeta.note         = meta.note;
  setFileDescription_(file, descMeta);

  // Инвалидация кэша
  invalidateFilesCache_(carId);

  return ok({
    file_id:  file.getId(),
    name:     file.getName(),
    tag:      tag,
    kind:     kind,
    view_url: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE_CAR_FILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Мягко удаляет файл (перемещает в корзину).
 * Body: { file_id, email, car_id? }
 * Response: { status: 'ok' }
 */
function handleDeleteCarFile(ss, body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  var roleErr = checkWriteRole_(ss, body.email);
  if (roleErr) return err(roleErr);

  var fileId = String(body.file_id || '').trim();
  if (!fileId) return err('MISSING: file_id');

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return err('FILE_NOT_FOUND');
  }

  file.setTrashed(true);

  // Инвалидация кэша по car_id, если передан
  if (body.car_id) {
    invalidateFilesCache_(String(body.car_id));
  }

  return ok({ trashed: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// RENAME_CAR_FILE — смена tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Меняет tag в имени файла (на случай ошибки при загрузке).
 * Старое имя: {car_id}_{ts}_{oldTag}_{short}.{ext}
 * Новое:      {car_id}_{ts}_{newTag}_{short}.{ext}
 *
 * Body: { file_id, new_tag, kind, email, car_id? }
 * Response: { status: 'ok', new_name }
 */
function handleRenameCarFileTag(ss, body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  var roleErr = checkWriteRole_(ss, body.email);
  if (roleErr) return err(roleErr);

  var fileId = String(body.file_id || '').trim();
  var newTag = String(body.new_tag || '').trim().toLowerCase();
  var kind = String(body.kind || '').trim();

  if (!fileId) return err('MISSING: file_id');
  if (!newTag) return err('MISSING: new_tag');

  var allowedTags = kind === 'docs' ? DOC_TAGS : kind === 'photos' ? PHOTO_TAGS : DOC_TAGS.concat(PHOTO_TAGS);
  if (allowedTags.indexOf(newTag) < 0) return err('INVALID: new_tag');

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return err('FILE_NOT_FOUND');
  }

  // Парсим текущее имя {car_id}_{ts}_{tag}_{short}.{ext}
  var oldName = file.getName();
  var dot = oldName.lastIndexOf('.');
  var nameNoExt = dot >= 0 ? oldName.slice(0, dot) : oldName;
  var ext = dot >= 0 ? oldName.slice(dot + 1) : '';

  var parts = nameNoExt.split('_');
  if (parts.length < 4) return err('INVALID_FILE_NAME');

  parts[2] = newTag.replace(/[^a-z0-9]/gi, '') || 'other';
  var newName = parts.join('_') + (ext ? '.' + ext : '');
  file.setName(newName);

  // Обновляем description
  var meta = parseFileDescription_(file);
  meta.tag = newTag;
  if (body.valid_until !== undefined) {
    if (body.valid_until) meta.valid_until = String(body.valid_until);
    else delete meta.valid_until;
  }
  setFileDescription_(file, meta);

  if (body.car_id) invalidateFilesCache_(String(body.car_id));

  return ok({ new_name: newName, tag: newTag });
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED_CAR_FOLDERS — одноразовая инициализация структуры
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создаёт папку и docs/photos для каждой машины из листа «Машины».
 * Записывает ID корневой папки машины в колонку K.
 * Безопасно перезапускать — пропускает существующие.
 *
 * Body: { email } (только operations может запустить)
 * Response: { status: 'ok', created, existing, total }
 *
 * Также может вызываться напрямую из редактора Apps Script функцией seedCarFolders().
 */
function handleSeedCarFolders(ss, body) {
  var tokenErr = checkToken_(body);
  if (tokenErr) return err(tokenErr);

  // Только operations может запускать seed
  var role = getUserRoleByEmail_(ss, body && body.email);
  if (role !== 'operations') return err('FORBIDDEN');

  return doSeedCarFolders_(ss);
}

/**
 * Вызывать из редактора Apps Script вручную, без HTTP.
 * Используйте, если ещё не настроены роли в листе «Пользователи».
 */
function seedCarFolders() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var result = doSeedCarFolders_(ss);
  Logger.log(result.getContent());
}

function doSeedCarFolders_(ss) {
  if (!DRIVE_ROOT_ID || DRIVE_ROOT_ID.indexOf('PASTE') === 0) {
    return err('DRIVE_ROOT_ID not configured');
  }

  var driveRoot;
  try {
    driveRoot = DriveApp.getFolderById(DRIVE_ROOT_ID);
  } catch (e) {
    return err('DRIVE_ROOT_NOT_FOUND');
  }

  var sheet = ss.getSheetByName(SHEET.CARS);
  if (!sheet) return err('SHEET_NOT_FOUND');

  var data = sheet.getDataRange().getValues();
  var created = 0;
  var existing = 0;

  for (var i = 1; i < data.length; i++) {
    var carId = String(data[i][0] || '').trim();
    if (!carId) continue;

    var existingId = String(data[i][CARS_DRIVE_FOLDER_COL - 1] || '').trim();
    if (existingId) {
      // Проверяем, что папка реально существует
      try {
        DriveApp.getFolderById(existingId);
        // Подпапки тоже на месте?
        var root = DriveApp.getFolderById(existingId);
        getOrCreateSubfolder_(root, SUBFOLDER_DOCS);
        getOrCreateSubfolder_(root, SUBFOLDER_PHOTOS);
        existing++;
        continue;
      } catch (e) {
        // Не существует — пересоздадим ниже
      }
    }

    // Ищем существующую папку с именем car_id
    var it = driveRoot.getFoldersByName(carId);
    var rootFolder = it.hasNext() ? it.next() : driveRoot.createFolder(carId);
    getOrCreateSubfolder_(rootFolder, SUBFOLDER_DOCS);
    getOrCreateSubfolder_(rootFolder, SUBFOLDER_PHOTOS);

    sheet.getRange(i + 1, CARS_DRIVE_FOLDER_COL).setValue(rootFolder.getId());
    created++;
  }

  return ok({ created: created, existing: existing, total: created + existing });
}
function diagDriveAccess() {
  Logger.log('DRIVE_ROOT_ID = "' + DRIVE_ROOT_ID + '"');
  Logger.log('Длина ID = ' + DRIVE_ROOT_ID.length);
  Logger.log('Активный пользователь = ' + Session.getActiveUser().getEmail());
  Logger.log('Эффективный пользователь = ' + Session.getEffectiveUser().getEmail());
  
  try {
    var f = DriveApp.getFolderById(DRIVE_ROOT_ID);
    Logger.log('✓ Папка найдена: "' + f.getName() + '"');
    Logger.log('✓ Owner = ' + f.getOwner().getEmail());
  } catch (e) {
    Logger.log('✗ Ошибка: ' + e.message);
    
    // Проверим, есть ли вообще такая папка где-то у нас:
    try {
      var search = DriveApp.searchFolders('title = "Матизы — Парк"');
      while (search.hasNext()) {
        var found = search.next();
        Logger.log('  Нашёл папку с похожим именем: "' + found.getName() + '", ID = ' + found.getId());
      }
    } catch (e2) {
      Logger.log('  Поиск тоже не работает: ' + e2.message);
    }
  }
}