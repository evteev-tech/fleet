import { postAction, invalidateCache } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { KASSA_ID, KASSA_NAMES, ROLES, SHEETS } from '../config.js';
import { showScreen } from '../router.js';
import { showToast } from '../ui.js';
import { fmtDate, fmtRub, fmtRuInt } from '../utils/format.js';
import { invalidateCache as invalidateLocalCache, CACHE_KEYS } from '../cache.js';
import { renderAppHeader } from '../ui-components.js?v=7';

/** Механик (Азамат) переводит только между операционными кассами, без инвест-счетов. */
const MECHANIC_TRANSFER_TO = new Set([KASSA_ID.VLADIMIR, KASSA_ID.YULIA]);

/** Операционный директор (Владимир): переводы между кассами участников проекта. */
const OPERATIONS_TRANSFER_KASSAS = [KASSA_ID.YULIA, KASSA_ID.VLADIMIR, KASSA_ID.AZAMAT];

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

function _defaultFromKassaId(user) {
  if (user?.role === ROLES.OPERATIONS) return KASSA_ID.VLADIMIR;
  if (user?.role === ROLES.INVESTOR) return KASSA_ID.YULIA;
  return KASSA_ID.AZAMAT;
}

function _transferTargets(user, fromId) {
  if (user?.role === ROLES.OPERATIONS) {
    return OPERATIONS_TRANSFER_KASSAS.filter(id => id !== fromId).map(id => [id, KASSA_NAMES[id]]);
  }
  let targets = Object.entries(KASSA_NAMES).filter(([id]) => id !== fromId);
  if (user?.role === ROLES.MECHANIC) {
    targets = targets.filter(([id]) => MECHANIC_TRANSFER_TO.has(id));
  }
  return targets;
}

function _fromKassaBlockHtml(user, fromId) {
  if (user?.role === ROLES.OPERATIONS) {
    const options = OPERATIONS_TRANSFER_KASSAS.map(
      id =>
        `<option value="${_escapeAttr(id)}"${id === fromId ? ' selected' : ''}>${_escapeHtml(KASSA_NAMES[id])}</option>`,
    ).join('');
    return `
        <div class="transfer-from">
          <label class="transfer-from__label" for="transfer-from-select">Из кассы</label>
          <select class="transfer-from__select" id="transfer-from-select" aria-label="Касса-источник">${options}</select>
        </div>`;
  }
  const fromKassaName = KASSA_NAMES[fromId] || fromId;
  return `
        <div class="transfer-from">
          <div class="transfer-from__label">Из кассы</div>
          <div class="transfer-from__name">${_escapeHtml(fromKassaName)}</div>
        </div>`;
}

function _toListHtml(targets) {
  return targets
    .map(
      ([id, name]) =>
        `<button type="button" class="transfer-to-btn" data-kassa-id="${_escapeAttr(id)}">${_escapeHtml(name)}</button>`,
    )
    .join('');
}

function _refreshToList(root, user) {
  const list = root.querySelector('#transfer-to-list');
  if (!list) return;
  if (_state.toKassaId === _fromKassaId) _state.toKassaId = null;
  list.innerHTML = _toListHtml(_transferTargets(user, _fromKassaId));
  if (_state.toKassaId) {
    list.querySelectorAll('.transfer-to-btn').forEach(el => {
      el.classList.toggle('transfer-to-btn--active', el.dataset.kassaId === _state.toKassaId);
    });
  }
  _updateSubmit(root);
}

function _renderTransfer() {
  const root = document.getElementById('transfer-root');
  if (!root) return;

  const user = getCurrentUser();
  _fromKassaId = _defaultFromKassaId(user);

  Object.assign(_state, {
    amount: 0,
    numpadBuf: '',
    toKassaId: null,
    comment: '',
  });

  const targets = _transferTargets(user, _fromKassaId);

  root.innerHTML = `
    <div class="transfer-root">
      ${renderAppHeader({ title: 'Перевод', back: { id: 'transfer-back-btn' } })}

      <div class="transfer-scroll">
        ${_fromKassaBlockHtml(user, _fromKassaId)}

        <button type="button" class="transfer-sum-wrap" id="transfer-sum-btn" aria-label="Сумма">
          <span class="transfer-sum" id="transfer-sum-display">0 ₽</span>
        </button>

        <div class="transfer-to-label">В кассу</div>
        <div class="transfer-to-list" id="transfer-to-list">
          ${_toListHtml(targets)}
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

 root.querySelector('#transfer-back-btn')?.addEventListener('click', () => {
    const u = getCurrentUser();
    showScreen(u?.role === ROLES.INVESTOR ? 'screen-dashboard' : 'screen-home');
  });
  

  root.querySelector('#transfer-from-select')?.addEventListener('change', e => {
    _fromKassaId = e.target.value || _fromKassaId;
    _refreshToList(root, user);
  });

  root.querySelector('#transfer-to-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.transfer-to-btn');
    if (!btn) return;
    _state.toKassaId = btn.dataset.kassaId || null;
    root.querySelectorAll('.transfer-to-btn').forEach(el => {
      el.classList.toggle('transfer-to-btn--active', el === btn);
    });
    _updateSubmit(root);
  });

  root.querySelector('#transfer-comment')?.addEventListener('input', e => {
    _state.comment = e.target.value ?? '';
  });

  root.querySelector('#transfer-sum-btn')?.addEventListener('click', () => _openNumpad(root));
  root.querySelector('#transfer-submit')?.addEventListener('click', () => _submitTransfer(root));

  _updateSumDisplay(root);
  _updateSubmit(root);
}

function _updateSumDisplay(root) {
  const el = root.querySelector('#transfer-sum-display');
  if (!el) return;
  el.textContent = fmtRub(_state.amount);
}

function _updateSubmit(root) {
  const btn = root.querySelector('#transfer-submit');
  if (!btn) return;
  const ok = _state.amount > 0 && _state.toKassaId !== null;
  btn.disabled = !ok;
  btn.textContent = ok
    ? `Перевести ${fmtRuInt(Math.round(_state.amount))} ₽ → ${KASSA_NAMES[_state.toKassaId] || _state.toKassaId}`
    : 'Перевести';
}

function _syncNumpadDisplay(root) {
  const disp = root.querySelector('#transfer-numpad-display');
  if (!disp) return;
  const n = _state.numpadBuf || '0';
  disp.textContent = `${fmtRuInt(Number(n))} ₽`;
}

function _openNumpad(root) {
  _state.numpadBuf = _state.amount > 0 ? String(Math.round(_state.amount)) : '';

  const overlay = root.querySelector('#transfer-numpad-overlay');
  const pad = root.querySelector('#transfer-numpad');
  const keys = root.querySelector('#transfer-numpad-keys');
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
  const overlay = root.querySelector('#transfer-numpad-overlay');
  const pad = root.querySelector('#transfer-numpad');
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
  const btn = root.querySelector('#transfer-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
  }

  const amt = Math.round(_state.amount);
  const comment = _state.comment.trim();
  const today = fmtDate(new Date());
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

    showToast(`Перевод ${fmtRuInt(amt)} ₽ → ${KASSA_NAMES[_state.toKassaId]} ✓`, 'success', 2500);
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
  return _escapeHtml(s).replace(/'/g, '&#39;');
}
