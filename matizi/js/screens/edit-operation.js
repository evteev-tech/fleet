import { getFleet, updateOperation, invalidateCache } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { showBottomSheet, hideBottomSheet, showToast } from '../ui.js';
import { SHEETS, ROLES } from '../config.js';

const EXPENSE_CATS = [
  'ремонт', 'ТО', 'запчасти', 'страховка', 'связь_глонасс',
  'ЗП', 'реклама', 'доставка', 'покупка_машины', 'штраф_ГИБДД', 'ДТП', 'прочее',
];
const INCOME_CATS = ['аренда', 'депозит_приём'];

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _ddmmyyyyToISO(s) {
  if (!s) return '';
  const [d, m, y] = s.split('.');
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
}

function _isoToDDMMYYYY(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}.${m}.${y}` : '';
}

/**
 * Открывает bottomsheet редактирования операции.
 * @param {object} op     — объект операции из API
 * @param {Array}  fleet  — массив машин из getFleet()
 */
export async function openEditOperation(op, fleet) {
  const user = getCurrentUser();

  /* ── Проверка прав: только тот кто создал ── */
  const provel = String(op.provel ?? '').trim().toLowerCase();
  const userName = String(user?.name ?? '').trim().toLowerCase();
  if (provel && provel !== userName) {
    showToast('Редактировать может только автор операции', 'error');
    return;
  }

  /* ── Если fleet не передан — загружаем ── */
  let cars = fleet ?? [];
  if (!cars.length) {
    try { cars = await getFleet(); } catch { cars = []; }
  }

  const isExpense = op.direction === 'расход';
  const isIncome = op.direction === 'приход';
  const cats = isExpense ? EXPENSE_CATS : isIncome ? INCOME_CATS : [];
  const dateISO = _ddmmyyyyToISO(op.dateRaw) || '';

  showBottomSheet(`
    <p class="bottomsheet-title">Редактировать операцию</p>

    <div class="add-field">
      <label class="add-label">Сумма, ₽</label>
      <input id="edit-op-amount" class="field-input" type="number"
        inputmode="numeric" value="${_esc(String(op.amount ?? ''))}" />
      <span class="field-err hidden" id="err-edit-amount">Введите сумму</span>
    </div>

    <div class="add-field">
      <label class="add-label">Дата</label>
      <input id="edit-op-date" class="field-input" type="date"
        value="${_esc(dateISO)}" />
      <span class="field-err hidden" id="err-edit-date">Укажите дату</span>
    </div>

    ${cats.length ? `
    <div class="add-field">
      <label class="add-label">Категория</label>
      <select id="edit-op-cat" class="field-input">
        ${cats.map(c =>
          `<option value="${_esc(c)}" ${c === op.category ? 'selected' : ''}>${_esc(c)}</option>`,
        ).join('')}
      </select>
    </div>` : ''}

    <div class="add-field">
      <label class="add-label">Машина</label>
      <select id="edit-op-car" class="field-input">
        <option value="">— без машины —</option>
        ${cars.map(c =>
          `<option value="${_esc(c.carId)}" ${c.carId === op.carId ? 'selected' : ''}>${_esc(c.carId)}</option>`,
        ).join('')}
      </select>
    </div>

    <div class="add-field">
      <label class="add-label">Комментарий</label>
      <textarea id="edit-op-comment" class="field-input"
        rows="2" placeholder="Необязательно…">${_esc(op.comment ?? '')}</textarea>
    </div>

    <button class="btn-primary" id="edit-op-save" style="margin-top:8px">
      Сохранить изменения
    </button>
  `);

  setTimeout(() => {
    document.getElementById('edit-op-save')?.addEventListener('click', () => {
      _submit(op);
    });
  }, 0);
}

async function _submit(op) {
  const amountRaw = document.getElementById('edit-op-amount')?.value.trim();
  const dateISO = document.getElementById('edit-op-date')?.value;
  const cat = document.getElementById('edit-op-cat')?.value ?? op.category;
  const carId = document.getElementById('edit-op-car')?.value ?? '';
  const comment = document.getElementById('edit-op-comment')?.value.trim() ?? '';

  /* ── Валидация ── */
  let valid = true;
  const errAmt = document.getElementById('err-edit-amount');
  const errDate = document.getElementById('err-edit-date');

  const amount = parseFloat(amountRaw);
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    if (errAmt) { errAmt.textContent = 'Введите сумму'; errAmt.classList.remove('hidden'); }
    valid = false;
  } else {
    errAmt?.classList.add('hidden');
  }

  if (!dateISO) {
    if (errDate) { errDate.textContent = 'Укажите дату'; errDate.classList.remove('hidden'); }
    valid = false;
  } else {
    errDate?.classList.add('hidden');
  }

  if (!valid) return;

  const btn = document.getElementById('edit-op-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

  try {
    await updateOperation({
      op_id: op.opId,
      amount: amount,
      date: _isoToDDMMYYYY(dateISO),
      category: cat ?? '',
      car_id: carId,
      comment: comment,
    });

    invalidateCache(SHEETS.OPERATIONS);
    showToast('Операция обновлена ✓', 'success');
    hideBottomSheet();

    /* Перерендерить текущий экран */
    const activeScreen = document.querySelector('***REMOVED***app-content .screen--active')?.id;
    if (activeScreen === 'screen-history') {
      document.dispatchEvent(new CustomEvent('screen:activated',
        { detail: { screenId: 'screen-history' } }));
    } else if (activeScreen === 'screen-home') {
      document.dispatchEvent(new CustomEvent('screen:activated',
        { detail: { screenId: 'screen-home' } }));
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить изменения'; }
    showToast(
      err.message === 'NO_CONNECTION' ? 'Нет соединения' : 'Ошибка сохранения',
      'error',
    );
  }
}

