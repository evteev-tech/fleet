import { postAction, invalidateCache } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { KASSA_ID, KASSA_NAMES, ROLES, SHEETS } from '../config.js';
import { showScreen } from '../router.js?v=7';
import { showToast } from '../ui.js';
import { formatDate } from '../utils/date.js';
import { invalidateCache as invalidateLocalCache, CACHE_KEYS } from '../cache.js';

/** Механик (Азамат) переводит только между операционными кассами, без инвест-счетов. */
const MECHANIC_TRANSFER_TO = new Set([KASSA_ID.VLADIMIR, KASSA_ID.YULIA]);

const _state = {
  amount: 0,
  numpadBuf: '',
  toKassaId: null,
  comment: '',
};

let _fromKassaId = null;

export function initTransfer() {
  document.addEventListener('screen:activated', e => {
    if (e.detail.screenId === 'screen-transfer') _renderTransfer();
  });
}

function _renderTransfer() {
  const root = document.getElementById('transfer-root');
  if (!root) return;

  const user = getCurrentUser();
  _fromKassaId =
    user?.role === ROLES.OPERATIONS
      ? KASSA_ID.VLADIMIR
      : user?.role === ROLES.INVESTOR
        ? KASSA_ID.YULIA
        : KASSA_ID.AZAMAT;

  Object.assign(_state, {
    amount: 0,
    numpadBuf: '',
    toKassaId: null,
    comment: '',
  });

  let targets = Object.entries(KASSA_NAMES).filter(([id]) => id !== _fromKassaId);
  if (user?.role === ROLES.MECHANIC) {
    targets = targets.filter(([id]) => MECHANIC_TRANSFER_TO.has(id));
  }
  const fromKassaName = KASSA_NAMES[_fromKassaId] || _fromKassaId;

  root.innerHTML = `
    <div class="transfer-root">
      <header class="transfer-header">
        <button type="button" class="btn-icon transfer-header__back" id="transfer-back" aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <h1 class="transfer-header__title">Перевод</h1>
        <div class="transfer-header__spacer"></div>
      </header>

      <div class="transfer-scroll">
        <div class="transfer-from">
          <div class="transfer-from__label">Из кассы</div>
          <div class="transfer-from__name">${_escapeHtml(fromKassaName)}</div>
        </div>

        <button type="button" class="transfer-sum-wrap" id="transfer-sum-btn" aria-label="Сумма">
          <span class="transfer-sum" id="transfer-sum-display">0 ₽</span>
        </button>

        <div class="transfer-to-label">В кассу</div>
        <div class="transfer-to-list" id="transfer-to-list">
          ${targets
            .map(
              ([id, name]) =>
                `<button type="button" class="transfer-to-btn" data-kassa-id="${_escapeAttr(id)}">${_escapeHtml(name)}</button>`,
            )
            .join('')}
        </div>

        <label class="transfer-comment-label">
          <input type="text" class="transfer-comment" id="transfer-comment" placeholder="Комментарий (необязательно)" maxlength="200" />
        </label>
      </div>

      <div class="transfer-bottom">
        <button type="button" class="btn-transfer-submit" id="transfer-submit" disabled>Перевести</button>
      </div>

      <div class="transfer-numpad-overlay hidden" id="transfer-numpad-overlay"></div>
      <div class="transfer-numpad hidden" id="transfer-numpad" aria-hidden="true">
        <div class="transfer-numpad__display" id="transfer-numpad-display">0 ₽</div>
        <div class="transfer-numpad__keys" id="transfer-numpad-keys"></div>
      </div>
    </div>
  `;

  root.querySelector('***REMOVED***transfer-back')?.addEventListener('click', () => showScreen('screen-home'));

  root.querySelector('***REMOVED***transfer-to-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.transfer-to-btn');
    if (!btn) return;
    _state.toKassaId = btn.dataset.kassaId || null;
    root.querySelectorAll('.transfer-to-btn').forEach(el => {
      el.classList.toggle('transfer-to-btn--active', el === btn);
    });
    _updateSubmit(root);
  });

  root.querySelector('***REMOVED***transfer-comment')?.addEventListener('input', e => {
    _state.comment = e.target.value ?? '';
  });

  root.querySelector('***REMOVED***transfer-sum-btn')?.addEventListener('click', () => _openNumpad(root));
  root.querySelector('***REMOVED***transfer-submit')?.addEventListener('click', () => _submitTransfer(root));

  _updateSumDisplay(root);
  _updateSubmit(root);
}

function _updateSumDisplay(root) {
  const el = root.querySelector('***REMOVED***transfer-sum-display');
  if (!el) return;
  el.textContent = `${Math.round(_state.amount).toLocaleString('ru-RU')} ₽`;
}

function _updateSubmit(root) {
  const btn = root.querySelector('***REMOVED***transfer-submit');
  if (!btn) return;
  const ok = _state.amount > 0 && _state.toKassaId !== null;
  btn.disabled = !ok;
  btn.textContent = ok
    ? `Перевести ${Math.round(_state.amount).toLocaleString('ru-RU')} ₽ → ${KASSA_NAMES[_state.toKassaId] || _state.toKassaId}`
    : 'Перевести';
}

function _syncNumpadDisplay(root) {
  const disp = root.querySelector('***REMOVED***transfer-numpad-display');
  if (!disp) return;
  const n = _state.numpadBuf || '0';
  disp.textContent = Number(n).toLocaleString('ru-RU') + ' ₽';
}

function _openNumpad(root) {
  _state.numpadBuf = _state.amount > 0 ? String(Math.round(_state.amount)) : '';

  const overlay = root.querySelector('***REMOVED***transfer-numpad-overlay');
  const pad = root.querySelector('***REMOVED***transfer-numpad');
  const keys = root.querySelector('***REMOVED***transfer-numpad-keys');
  if (!overlay || !pad || !keys) return;

  overlay.classList.remove('hidden');
  pad.classList.remove('hidden');

  const layout = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['C', '0', 'OK'],
  ];
  keys.innerHTML = layout
    .map(
      row =>
        `<div class="transfer-numpad__row">${row
          .map(k => `<button type="button" class="transfer-numpad__key" data-k="${k}">${k}</button>`)
          .join('')}</div>`,
    )
    .join('');

  keys.querySelectorAll('[data-k]').forEach(b => {
    b.addEventListener('click', () => _numpadKey(root, b.dataset.k));
  });

  _syncNumpadDisplay(root);
  pad.onclick = e => e.stopPropagation();
  overlay.onclick = () => _closeNumpad(root);
  requestAnimationFrame(() => pad.classList.add('transfer-numpad--visible'));
}

function _numpadKey(root, k) {
  if (k === 'C') {
    _state.numpadBuf = '';
    _syncNumpadDisplay(root);
    return;
  }
  if (k === 'OK') {
    const n = parseInt(_state.numpadBuf, 10);
    _state.amount = isNaN(n) ? 0 : n;
    _closeNumpad(root);
    _updateSumDisplay(root);
    _updateSubmit(root);
    return;
  }
  if (_state.numpadBuf.length < 9) {
    _state.numpadBuf += k;
    _syncNumpadDisplay(root);
  }
}

function _closeNumpad(root) {
  const overlay = root.querySelector('***REMOVED***transfer-numpad-overlay');
  const pad = root.querySelector('***REMOVED***transfer-numpad');
  if (!overlay || !pad) return;
  pad.classList.remove('transfer-numpad--visible');
  overlay.classList.add('hidden');
  setTimeout(() => pad.classList.add('hidden'), 280);
}

async function _submitTransfer(root) {
  if (!_fromKassaId || !_state.toKassaId || _state.amount <= 0) return;
  const u = getCurrentUser();
  if (u?.role === ROLES.MECHANIC && !MECHANIC_TRANSFER_TO.has(_state.toKassaId)) {
    showToast('Перевод на этот счёт недоступен', 'error');
    return;
  }
  const btn = root.querySelector('***REMOVED***transfer-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
  }

  const amt = Math.round(_state.amount);
  const comment = _state.comment.trim();
  const today = formatDate(new Date());
  const user = getCurrentUser();
  const provel = user?.name ?? '';

  try {
    await postAction('ADD_OPERATION', {
      date: today,
      kassa_id: _fromKassaId,
      direction: 'расход',
      amount: amt,
      type: 'перевод_исходящий',
      category: '',
      car_id: '',
      driver_id: '',
      comment,
      provel,
      class_override: 'opex',
    });

    await postAction('ADD_OPERATION', {
      date: today,
      kassa_id: _state.toKassaId,
      direction: 'приход',
      amount: amt,
      type: 'перевод_входящий',
      category: '',
      car_id: '',
      driver_id: '',
      comment,
      provel,
      class_override: 'opex',
    });

    invalidateCache(SHEETS.OPERATIONS);
    invalidateLocalCache(CACHE_KEYS.CASH_OPS);
    invalidateLocalCache(CACHE_KEYS.KASSAS);
    invalidateLocalCache(CACHE_KEYS.DASHBOARD);

    showToast(`Перевод ${amt.toLocaleString('ru-RU')} ₽ → ${KASSA_NAMES[_state.toKassaId]} ✓`, 'success', 2500);
    showScreen('screen-home');
  } catch (err) {
    if (btn) btn.disabled = false;
    _updateSubmit(root);
    showToast(err?.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка перевода', 'error');
  }
}

function _escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escapeAttr(s) {
  return _escapeHtml(s).replace(/'/g, '&***REMOVED***39;');
}
