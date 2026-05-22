/**
 * car.js — полноэкранная карточка машины.
 *
 * Открывается: dispatchEvent('car:open', { carId }) + showScreen('screen-car')
 * Вызывается из fleet.js вместо _openCarSheet().
 */

import { getFleet, getDrivers, postAction, invalidateCache, updateCarRate } from '../api.js';
import { invalidateCache as invalidateLocalCache, CACHE_KEYS } from '../cache.js';
import { getCurrentUser } from '../auth.js';
import { showScreen } from '../router.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { ROLES, SHEETS, CAR_STATUSES } from '../config.js';
import { fmtRuInt } from '../utils/format.js';
import {
  listCarFiles,
  getCarFile,
  uploadCarFile,
  deleteCarFile,
  DOC_TAG_LABELS,
  PHOTO_TAG_LABELS,
  DOC_TAGS_WITH_VALIDITY,
  docValidityStatus,
  docValidityLabel,
} from '../api/car-files.js';

// ─── Состояние ────────────────────────────────────────────────────────────────
let _currentCarId  = null;
let _currentCarObj = null;
let _filesData     = null; // { files, actualDocs }

// ─── Инициализация ────────────────────────────────────────────────────────────

export function initCar() {
  document.addEventListener('car:open', e => {
    _currentCarId  = e.detail?.carId ?? null;
    _currentCarObj = e.detail?.car   ?? null;
    _filesData     = null;
  });

  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-car') renderCar(_currentCarId);
  });

  document.getElementById('car-back')?.addEventListener('click', () => {
    showScreen('screen-fleet');
  });
}

// ─── Главный рендер ───────────────────────────────────────────────────────────

export async function renderCar(carId) {
  const body    = document.getElementById('car-body');
  const titleEl = document.getElementById('car-header-title');
  if (!body) return;
  if (titleEl) titleEl.textContent = carId || 'Машина';

  const user     = getCurrentUser();
  const canWrite = user?.role === ROLES.MECHANIC || user?.role === ROLES.OPERATIONS;

  if (_currentCarObj && String(_currentCarObj.carId) === String(carId)) {
    if (titleEl) titleEl.textContent = _currentCarObj.carId;
    body.innerHTML = _carBodyHTML(_currentCarObj, null, canWrite);

    Promise.all([getDrivers(), listCarFiles(carId)]).then(([drivers, filesResult]) => {
      _filesData = filesResult;
      const cid    = String(_currentCarObj.carId ?? '').trim();
      const driver = drivers.find(d => String(d.currentCar ?? '').trim() === cid);
      if (driver && _currentCarObj.status === CAR_STATUSES.RENT) {
        const driverEl = body.querySelector('.car-driver');
        if (driverEl) {
          driverEl.outerHTML = `
            <div class="car-driver">
              <div class="car-driver__avatar">${_initials(driver.name)}</div>
              <div class="car-driver__info">
                <div class="car-driver__name">${_esc(driver.name)}</div>
                ${driver.phone ? `<a class="car-driver__phone" href="tel:${_esc(driver.phone)}">${_esc(driver.phone)}</a>` : ''}
              </div>
            </div>`;
        }
      }
      _renderActualDocs(filesResult.actualDocs);
      _renderDocsList(filesResult.files.filter(f => f.kind === 'docs'), carId, canWrite);
      _renderPhotosGrid(filesResult.files.filter(f => f.kind === 'photos'), carId, canWrite);
      _bindFileButtons(carId, canWrite);
    }).catch(() => {});

    _bindActionButtons(_currentCarObj, null, canWrite);
    return;
  }

  body.innerHTML = _skeletonHTML();

  let fleet;
  let drivers;
  try {
    [fleet, drivers] = await Promise.all([getFleet(), getDrivers()]);
  } catch {
    body.innerHTML = _errorHTML('Не удалось загрузить данные');
    return;
  }

  const car = fleet.find(c => String(c.carId) === String(carId));
  if (!car) {
    body.innerHTML = _errorHTML('Машина не найдена');
    return;
  }

  if (titleEl) titleEl.textContent = car.carId;

  const cid    = String(car.carId ?? '').trim();
  const driver = drivers.find(d => String(d.currentCar ?? '').trim() === cid);

  body.innerHTML = _carBodyHTML(car, driver, canWrite);

  _bindActionButtons(car, driver, canWrite);
  _loadAndRenderFiles(car.carId, canWrite);
}

function _formatToMileage(mileage, toMileage) {
  const m = Number(mileage) || 0;
  const t = Number(toMileage) || 0;
  if (!t) return '—';
  const diff = t - m;
  if (diff <= 0) return 'Просрочено';
  return fmtRuInt(diff) + ' км';
}

function _carBodyHTML(car, driver, canWrite) {
  const statusLabel = {
    [CAR_STATUSES.RENT]:   'в аренде',
    [CAR_STATUSES.REPAIR]: 'в ремонте',
    [CAR_STATUSES.IDLE]:   'простой',
  }[car.status] ?? car.status;

  const statusClass = {
    [CAR_STATUSES.RENT]:   'car-badge--rent',
    [CAR_STATUSES.REPAIR]: 'car-badge--repair',
    [CAR_STATUSES.IDLE]:   'car-badge--idle',
  }[car.status] ?? '';

  const mileageStr   = car.mileage ? `${fmtRuInt(car.mileage)} км` : '—';
  const toServiceStr = _formatToMileage(car.mileage, car.toMileage);

  const driverBlock = driver
    ? `<div class="car-driver">
        <div class="car-driver__avatar">${_initials(driver.name)}</div>
        <div class="car-driver__info">
          <div class="car-driver__name">${_esc(driver.name)}</div>
          ${driver.phone ? `<a class="car-driver__phone" href="tel:${_esc(driver.phone)}">${_esc(driver.phone)}</a>` : ''}
        </div>
      </div>`
    : `<div class="car-driver car-driver--empty">Водитель не назначен</div>`;

  const actionBtns = _actionButtonsHTML(car, canWrite);

  return `
    <div class="car-hero">
      <div class="car-hero__top">
        <div>
          <div class="car-hero__plate">${_esc(car.carId)}</div>
          <div class="car-hero__model">${_esc(car.name || '—')}</div>
        </div>
        <span class="car-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="car-hero__grid">
        <div class="car-hero__cell">
          <div class="car-hero__lbl">Пробег</div>
          <div class="car-hero__val">${mileageStr}</div>
        </div>
        <div class="car-hero__cell">
          <div class="car-hero__lbl">До ТО</div>
          <div class="car-hero__val">${toServiceStr}</div>
        </div>
      </div>
      ${car.status === CAR_STATUSES.RENT ? driverBlock : ''}
    </div>

    <div class="car-section">
      <div class="car-section__head">
        <span class="car-section__title">Стоимость аренды</span>
      </div>
      <div class="car-rate-row">
        <div>
          <div class="car-rate-val">${fmtRuInt(Math.max(0, Number(car.rateDay) || 0))} ₽<span class="car-rate-unit">/день</span></div>
          <div class="car-rate-sub">текущая ставка</div>
        </div>
        ${canWrite ? `<button class="car-rate-edit" id="car-rate-edit">Изменить</button>` : ''}
      </div>
    </div>

    <div id="car-actual-docs"></div>

    <div class="car-section">
      <div class="car-section__head">
        <span class="car-section__title">Документы</span>
        ${canWrite ? `<button class="car-section__add" id="car-docs-add" aria-label="Добавить документ">+</button>` : ''}
      </div>
      <div id="car-docs-list" class="car-docs-list">
        ${_miniSkeleton(3)}
      </div>
    </div>

    <div class="car-section">
      <div class="car-section__head">
        <span class="car-section__title">Фото</span>
        ${canWrite ? `<button class="car-section__add" id="car-photos-add" aria-label="Добавить фото">+</button>` : ''}
      </div>
      <div id="car-photos-grid" class="car-photos-grid">
        ${_photosSkeleton(4)}
      </div>
    </div>

    <div class="car-actions">
      ${actionBtns}
    </div>

    <input type="file" id="car-input-photo" accept="image/*" style="display:none">
    <input type="file" id="car-input-doc" accept=".pdf,image/*" style="display:none">
  `;
}

function _actionButtonsHTML(car, canWrite) {
  if (!canWrite) return '';
  const isRent   = car.status === CAR_STATUSES.RENT;
  const isRepair = car.status === CAR_STATUSES.REPAIR;
  const isIdle   = car.status === CAR_STATUSES.IDLE;

  const btns = [];
  if (isIdle || isRepair) {
    btns.push(`<button class="car-btn car-btn--primary" id="car-btn-rent">Выдать в аренду</button>`);
  }
  if (isRent) {
    btns.push(`<button class="car-btn car-btn--primary" id="car-btn-return">Принять из аренды</button>`);
  }
  if (!isRepair) {
    btns.push(`<button class="car-btn car-btn--outline" id="car-btn-repair">В ремонт</button>`);
  } else {
    btns.push(`<button class="car-btn car-btn--outline" id="car-btn-idle">Из ремонта → простой</button>`);
  }
  return btns.join('');
}

async function _loadAndRenderFiles(carId, canWrite) {
  try {
    _filesData = await listCarFiles(carId);
    _renderActualDocs(_filesData.actualDocs);
    _renderDocsList(_filesData.files.filter(f => f.kind === 'docs'), carId, canWrite);
    _renderPhotosGrid(_filesData.files.filter(f => f.kind === 'photos'), carId, canWrite);
  } catch {
    document.getElementById('car-docs-list')?.replaceChildren();
    document.getElementById('car-photos-grid')?.replaceChildren();
  }

  _bindFileButtons(carId, canWrite);
}

function _renderActualDocs(actualDocs) {
  const el = document.getElementById('car-actual-docs');
  if (!el) return;

  const entries = Object.entries(actualDocs);
  if (!entries.length) { el.innerHTML = ''; return; }

  const rows = entries.map(([tag, info]) => {
    const status = docValidityStatus(info.validUntil);
    const label  = docValidityLabel(info.validUntil);
    const tagLabel = DOC_TAG_LABELS[tag] ?? tag;
    const statusClass = status === 'expired' ? 'car-doc-status--expired'
                      : status === 'warning' ? 'car-doc-status--warning'
                      : 'car-doc-status--ok';
    return `
      <div class="car-actual-row" data-file-id="${_esc(info.fileId)}">
        <span class="car-actual-tag">${_esc(tagLabel)}</span>
        <span class="car-doc-status ${statusClass}">${_esc(label)}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="car-actual-docs">
      <div class="car-actual-docs__title">Актуальные документы</div>
      ${rows}
    </div>`;

  el.querySelectorAll('.car-actual-row[data-file-id]').forEach(row => {
    row.addEventListener('click', () => _openFile(row.dataset.fileId));
  });
}

function _renderDocsList(docs, carId, canWrite) {
  const el = document.getElementById('car-docs-list');
  if (!el) return;

  if (!docs.length) {
    el.innerHTML = `<div class="car-empty">Документов пока нет</div>`;
    return;
  }

  el.innerHTML = docs.map(f => {
    const tagLabel    = DOC_TAG_LABELS[f.tag] ?? f.tag;
    const dateStr     = f.createdAt ? _fmtTs(f.createdAt) : '';
    const validStatus = f.validUntil ? docValidityStatus(f.validUntil) : null;
    const validLabel  = f.validUntil ? docValidityLabel(f.validUntil) : '';
    const validClass  = validStatus === 'expired' ? 'car-doc-status--expired'
                      : validStatus === 'warning' ? 'car-doc-status--warning'
                      : validStatus === 'ok'      ? 'car-doc-status--ok' : '';
    const isPdf = f.mimeType === 'application/pdf';

    return `
      <div class="car-doc-row" data-file-id="${_esc(f.fileId)}" data-tag="${_esc(f.tag)}" data-kind="docs">
        <div class="car-doc-icon car-doc-icon--${isPdf ? 'pdf' : 'img'}">
          ${isPdf ? '📄' : '🖼'}
        </div>
        <div class="car-doc-info">
          <div class="car-doc-name">${_esc(tagLabel)}</div>
          <div class="car-doc-meta">
            ${validLabel ? `<span class="car-doc-status ${validClass}">${_esc(validLabel)}</span>` : ''}
            ${dateStr ? `<span class="car-doc-date">${dateStr}</span>` : ''}
          </div>
        </div>
        <div class="car-doc-arrow">›</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.car-doc-row').forEach(row => {
    row.addEventListener('click', () => _openFile(row.dataset.fileId));
    if (canWrite) {
      row.addEventListener('contextmenu', e => { e.preventDefault(); _openFileMenu(row, carId); });
      let timer;
      row.addEventListener('touchstart', () => { timer = setTimeout(() => _openFileMenu(row, carId), 600); });
      row.addEventListener('touchend',   () => clearTimeout(timer));
    }
  });
}

function _renderPhotosGrid(photos, carId, canWrite) {
  const el = document.getElementById('car-photos-grid');
  if (!el) return;

  if (!photos.length) {
    el.innerHTML = `<div class="car-empty car-empty--photos">Фото пока нет</div>`;
    return;
  }

  el.innerHTML = photos.map(f => `
    <div class="car-photo-thumb" data-file-id="${_esc(f.fileId)}" data-tag="${_esc(f.tag)}" data-kind="photos" data-view-url="${_esc(f.viewUrl || '')}">
      <div class="car-photo-thumb__inner car-photo-thumb__inner--loading">
        <span class="car-photo-thumb__tag">${_esc(PHOTO_TAG_LABELS[f.tag] ?? f.tag)}</span>
      </div>
    </div>`).join('');

  const thumbs = [...el.querySelectorAll('.car-photo-thumb')];
  thumbs.forEach((thumb, i) => {
    const fileId = thumb.dataset.fileId;
    const viewUrl = thumb.dataset.viewUrl || null;
    if (i < 8) _loadThumb(thumb, fileId, viewUrl);
    else {
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { _loadThumb(thumb, fileId, viewUrl); obs.disconnect(); }
      }, { rootMargin: '100px' });
      obs.observe(thumb);
    }

    thumb.addEventListener('click', () => _openFile(fileId, thumb.dataset.viewUrl || null));
    if (canWrite) {
      let timer;
      thumb.addEventListener('touchstart', () => { timer = setTimeout(() => _openFileMenu(thumb, carId), 600); });
      thumb.addEventListener('touchend',   () => clearTimeout(timer));
      thumb.addEventListener('contextmenu', e => { e.preventDefault(); _openFileMenu(thumb, carId); });
    }
  });
}

async function _loadThumb(thumbEl, fileId, viewUrl) {
  try {
    const { blobUrl } = await getCarFile(fileId, viewUrl || null);
    const inner = thumbEl.querySelector('.car-photo-thumb__inner');
    if (!inner) return;
    inner.classList.remove('car-photo-thumb__inner--loading');
    inner.style.backgroundImage    = `url("${blobUrl}")`;
    inner.style.backgroundSize     = 'cover';
    inner.style.backgroundPosition = 'center';
  } catch { /* тихая ошибка */ }
}

async function _openFile(fileId, viewUrl = null) {
  showBottomSheet(`<div style="text-align:center;padding:32px 0;color:var(--color-muted)">Загрузка…</div>`);
  try {
    const { name, mimeType, blobUrl } = await getCarFile(fileId, viewUrl);
    const isImage = mimeType.startsWith('image/');
    const isPdf   = mimeType === 'application/pdf';

    showBottomSheet(`
      <div class="car-file-viewer">
        <div class="car-file-viewer__name">${_esc(name)}</div>
        ${isImage ? `<img src="${blobUrl}" class="car-file-viewer__img" alt="${_esc(name)}">` : ''}
        ${isPdf ? `<a href="${blobUrl}" download="${_esc(name)}" class="car-btn car-btn--outline" style="margin-top:16px">Скачать PDF</a>` : ''}
        ${!isImage && !isPdf ? `<a href="${blobUrl}" download="${_esc(name)}" class="car-btn car-btn--outline" style="margin-top:16px">Скачать</a>` : ''}
      </div>
    `);
  } catch {
    showToast('Не удалось загрузить файл', 'error');
    hideBottomSheet();
  }
}

function _openFileMenu(el, carId) {
  const fileId = el.dataset.fileId;

  showBottomSheet(`
    <p class="bottomsheet-title">Файл</p>
    <button class="fleet-status-btn" id="car-file-delete" style="background:var(--color-red-bg);color:var(--color-red)">
      Удалить
    </button>
  `);

  setTimeout(() => {
    document.getElementById('car-file-delete')?.addEventListener('click', async () => {
      if (!confirm('Удалить файл?')) return;
      try {
        await deleteCarFile(fileId, carId);
        showToast('Файл удалён', 'success');
        hideBottomSheet();
        _loadAndRenderFiles(carId, true);
      } catch (e) {
        showToast(e.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка удаления', 'error');
      }
    });
  }, 0);
}

function _bindFileButtons(carId, canWrite) {
  if (!canWrite) return;

  document.getElementById('car-docs-add')?.addEventListener('click', () => {
    document.getElementById('car-input-doc')?.click();
  });

  document.getElementById('car-photos-add')?.addEventListener('click', () => {
    document.getElementById('car-input-photo')?.click();
  });

  document.getElementById('car-input-doc')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    _openUploadDocSheet(carId, file);
  });

  document.getElementById('car-input-photo')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    _openUploadPhotoSheet(carId, file);
  });
}

function _openUploadDocSheet(carId, file) {
  const tags = Object.entries(DOC_TAG_LABELS);
  const sizeStr = (file.size / 1024).toFixed(0) + ' КБ';
  const isPdf = file.type === 'application/pdf';

  showBottomSheet(`
    <p class="bottomsheet-title">Новый документ · ${_esc(carId)}</p>

    <div class="car-upload-preview">
      <div class="car-upload-preview__icon">${isPdf ? '📄' : '🖼'}</div>
      <div class="car-upload-preview__info">
        <div class="car-upload-preview__name">${_esc(file.name)}</div>
        <div class="car-upload-preview__size">${sizeStr}</div>
      </div>
    </div>

    <div class="car-upload-label">ТИП ДОКУМЕНТА</div>
    <div class="car-tag-chips" id="doc-tag-chips">
      ${tags.map(([tag, label], i) =>
        `<button class="car-tag-chip${i === 0 ? ' car-tag-chip--active' : ''}" data-tag="${tag}">${label}</button>`
      ).join('')}
    </div>

    <div id="doc-validity-block" style="display:none">
      <div class="car-upload-label" style="margin-top:12px">ДЕЙСТВУЕТ ДО</div>
      <input type="date" id="doc-valid-until" class="field-input" style="margin-bottom:4px">
      <div style="font-size:11px;color:var(--color-muted);margin-bottom:12px">
        Предыдущий полис автоматически уйдёт в архив
      </div>
    </div>

    <button class="fleet-bs-confirm" id="doc-upload-btn" style="margin-top:16px">Загрузить</button>
  `);

  setTimeout(() => {
    let selectedTag = tags[0][0];

    document.getElementById('doc-tag-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.car-tag-chip');
      if (!chip) return;
      document.querySelectorAll('.car-tag-chip').forEach(c => c.classList.remove('car-tag-chip--active'));
      chip.classList.add('car-tag-chip--active');
      selectedTag = chip.dataset.tag;
      const needsValidity = DOC_TAGS_WITH_VALIDITY.includes(selectedTag);
      const block = document.getElementById('doc-validity-block');
      if (block) block.style.display = needsValidity ? 'block' : 'none';
    });

    document.getElementById('doc-upload-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('doc-upload-btn');
      const validUntilEl = document.getElementById('doc-valid-until');
      const validUntil = validUntilEl?.value || '';

      if (DOC_TAGS_WITH_VALIDITY.includes(selectedTag) && !validUntil) {
        showToast('Укажите срок действия', 'error');
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Загружаю…'; }
      try {
        await uploadCarFile(carId, 'docs', file, selectedTag, { validUntil },
          p => { if (btn) btn.textContent = `Загружаю… ${Math.round(p * 100)}%`; });
        showToast('Документ загружен ✓', 'success');
        hideBottomSheet();
        _loadAndRenderFiles(carId, true);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Загрузить'; }
        showToast(e.message.includes('TOO_LARGE') ? 'Файл слишком большой (макс. 8 МБ)' :
                  e.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка загрузки', 'error');
      }
    });
  }, 0);
}

function _openUploadPhotoSheet(carId, file) {
  const tags = Object.entries(PHOTO_TAG_LABELS);
  showBottomSheet(`
    <p class="bottomsheet-title">Новое фото · ${_esc(carId)}</p>

    <div class="car-upload-label">КАТЕГОРИЯ</div>
    <div class="car-tag-chips" id="photo-tag-chips">
      ${tags.map(([tag, label], i) =>
        `<button class="car-tag-chip${i === 0 ? ' car-tag-chip--active' : ''}" data-tag="${tag}">${label}</button>`
      ).join('')}
    </div>

    <button class="fleet-bs-confirm" id="photo-upload-btn" style="margin-top:16px">Загрузить</button>
  `);

  setTimeout(() => {
    let selectedTag = tags[0][0];

    document.getElementById('photo-tag-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.car-tag-chip');
      if (!chip) return;
      document.querySelectorAll('.car-tag-chip').forEach(c => c.classList.remove('car-tag-chip--active'));
      chip.classList.add('car-tag-chip--active');
      selectedTag = chip.dataset.tag;
    });

    document.getElementById('photo-upload-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('photo-upload-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Загружаю…'; }
      try {
        await uploadCarFile(carId, 'photos', file, selectedTag, {},
          p => { if (btn) btn.textContent = `Загружаю… ${Math.round(p * 100)}%`; });
        showToast('Фото загружено ✓', 'success');
        hideBottomSheet();
        _loadAndRenderFiles(carId, true);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Загрузить'; }
        showToast(e.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка загрузки', 'error');
      }
    });
  }, 0);
}

function _bindActionButtons(car, driver, canWrite) {
  if (!canWrite) return;

  document.getElementById('car-btn-rent')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('car:action:rent', { detail: { car } }));
  });

  document.getElementById('car-btn-return')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('car:action:return', { detail: { car, driver } }));
  });

  document.getElementById('car-btn-repair')?.addEventListener('click', async () => {
    if (!confirm(`Перевести ${car.carId} в ремонт?`)) return;
    try {
      await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: CAR_STATUSES.REPAIR });
      invalidateCache(SHEETS.CARS);
      invalidateLocalCache(CACHE_KEYS.CARS);
      showToast('Переведено в ремонт ✓', 'success');
      showScreen('screen-fleet');
    } catch {
      showToast('Ошибка', 'error');
    }
  });

  document.getElementById('car-btn-idle')?.addEventListener('click', async () => {
    if (!confirm(`Перевести ${car.carId} из ремонта → простой?`)) return;
    try {
      await postAction('UPDATE_CAR_STATUS', { car_id: car.carId, new_status: CAR_STATUSES.IDLE });
      invalidateCache(SHEETS.CARS);
      invalidateLocalCache(CACHE_KEYS.CARS);
      showToast('Переведено в простой ✓', 'success');
      showScreen('screen-fleet');
    } catch {
      showToast('Ошибка', 'error');
    }
  });

  document.getElementById('car-rate-edit')?.addEventListener('click', () => {
    _openRateSheet(car);
  });
}

function _openRateSheet(car) {
  const cur = Math.max(0, Number(car.rateDay) || 0);
  const isRent = car.status === CAR_STATUSES.RENT;

  showBottomSheet(`
    <p class="bottomsheet-title">Новая стоимость аренды · ${_esc(car.carId)}</p>

    <div class="car-upload-label">СТАВКА, ₽ В ДЕНЬ</div>
    <div class="car-rate-input-wrap">
      <input
        type="number"
        inputmode="numeric"
        step="50"
        min="0"
        id="car-rate-input"
        class="field-input car-rate-input"
        value="${cur || ''}"
        placeholder="${cur || '0'}"
      />
      <span class="car-rate-input-unit">₽/день</span>
    </div>

    <div class="car-rate-delta" id="car-rate-delta"></div>

    ${isRent ? `
      <div class="car-rate-note">
        <span>ⓘ</span>
        <span>Машина в аренде. Текущая аренда останется на старой ставке — новая применится со следующей сдачи.</span>
      </div>` : ''}

    <div class="car-upload-label" style="margin-top:4px">ПРИЧИНА (НЕОБЯЗАТЕЛЬНО)</div>
    <input
      type="text"
      id="car-rate-reason"
      class="field-input"
      placeholder="Сезонный спрос, новый прайс…"
    />

    <button class="fleet-bs-confirm" id="car-rate-save" style="margin-top:16px">Сохранить</button>
  `);

  setTimeout(() => {
    const input = document.getElementById('car-rate-input');
    const deltaEl = document.getElementById('car-rate-delta');

    const recalc = () => {
      if (!deltaEl) return;
      const v = Math.max(0, parseInt(input.value, 10) || 0);
      if (!v || v === cur) {
        deltaEl.textContent = cur ? `Текущая ставка: ${fmtRuInt(cur)} ₽` : '';
        deltaEl.className = 'car-rate-delta';
        return;
      }
      const d = v - cur;
      const pct = cur > 0 ? Math.round((d / cur) * 100) : 0;
      const sign = d > 0 ? '+' : '−';
      const pctStr = cur > 0 ? ` (${sign}${Math.abs(pct)}%)` : '';
      deltaEl.textContent =
        `${fmtRuInt(cur)} → ${fmtRuInt(v)} ₽ · ${sign}${fmtRuInt(Math.abs(d))} ₽${pctStr}`;
      deltaEl.className = 'car-rate-delta ' + (d > 0 ? 'car-rate-delta--up' : 'car-rate-delta--down');
    };

    input?.addEventListener('input', recalc);
    recalc();

    document.getElementById('car-rate-save')?.addEventListener('click', () => {
      void _saveRate(car, cur);
    });
  }, 0);
}

async function _saveRate(car, oldRate) {
  const input = document.getElementById('car-rate-input');
  const reasonEl = document.getElementById('car-rate-reason');
  const btn = document.getElementById('car-rate-save');

  const v = Math.max(0, parseInt(input?.value, 10) || 0);
  if (!v) { showToast('Введите ставку', 'error'); return; }
  if (v === oldRate) { showToast('Ставка не изменилась', 'error'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }

  try {
    await updateCarRate({
      car_id:   car.carId,
      new_rate: v,
      old_rate: oldRate,
      reason:   reasonEl?.value?.trim() || '',
      by:       getCurrentUser()?.name || '',
    });

    invalidateCache(SHEETS.CARS);
    invalidateLocalCache(CACHE_KEYS.CARS);
    invalidateLocalCache(CACHE_KEYS.INCOME_FORM);

    if (_currentCarObj && String(_currentCarObj.carId) === String(car.carId)) {
      _currentCarObj.rateDay = v;
    }

    showToast(`Ставка обновлена · ${fmtRuInt(v)} ₽/день ✓`, 'success');
    hideBottomSheet();
    renderCar(car.carId);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    showToast(err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения', 'error');
  }
}

function _skeletonHTML() {
  return `<div class="car-skeleton">
    <div class="skel skel--hero"></div>
    <div class="skel skel--row"></div>
    <div class="skel skel--row"></div>
    <div class="skel skel--row"></div>
  </div>`;
}

function _miniSkeleton(n) {
  return Array.from({ length: n }, () => `<div class="skel skel--doc-row"></div>`).join('');
}

function _photosSkeleton(n) {
  return Array.from({ length: n }, () => `<div class="skel skel--photo-thumb"></div>`).join('');
}

function _errorHTML(msg) {
  return `<div class="car-error">${_esc(msg)}</div>`;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function _fmtTs(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
