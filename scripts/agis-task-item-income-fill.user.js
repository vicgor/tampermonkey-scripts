// ==UserScript==
// @name         AGIS - вставка прихода из результатов команды
// @namespace    agis.task.item.income.fill
// @version      1.0.0
// @description  Клик по строке результатов сервисной команды (agis2:income:create) сохраняет платёж; переход на приходы займа; на форме создания кнопка заполняет дату, сумму, вид прихода и комментарий.
// @match        https://agis.volgazaim.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.moneymania.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.belkacredit.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.credit7.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.credit365.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.vashcash.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.vashcash.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.vashcash.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.vashcash.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.vashcash.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.ikracredit.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.zaimix.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.zaimix.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.zaimix.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.zaimix.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.zaimix.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.finrook.ru/admin/supportprocess/domain/supportprocesstask/*/supportprocesstaskitem/list*
// @match        https://agis.finrook.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.finrook.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.finrook.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.finrook.ru/admin/agis2/core/loan-overdue/*/income/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-task-item-income-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-task-item-income-fill.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.4.0/lib/agis-core.js#sha256=JqxyWNETCOHKc6WMlT3E/6odW4N9iDA7zsnIOVz6uys=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // Маппинг значения income-type из параметров команды → текст опции «Вид прихода».
  // Поиск регистронезависимый (см. resolveIncomeTypeOption). Объявлен до guard'а ниже,
  // т.к. экспортируемые для теста функции читают его по замыканию (иначе TDZ).
  const INCOME_TYPE_MAP = {
    цессия: 'Цессия',
    cession: 'Цессия',
    mi_cession: 'Цессия',
    'возврат продукта': 'Возврат продукта',
    mi_refund_product: 'Возврат продукта',
    иное: 'Иное',
  };

  // normalizeText приходит из ядра — let, значение назначается в одной из двух веток ниже.
  let normalizeText;

  // Тестовый экспорт для vitest (test/scripts/agis-task-item-income-fill.test.js) —
  // до window-guard'а, т.к. в Node window не определён.
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    normalizeText = require('../lib/agis-core.js').normalizeText;
    module.exports = { parseParamLines, parseAmount, toFormDateTime, resolveIncomeTypeOption };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:task-item-income] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    cleanupRoute,
    cleanup,
    storageGet,
    storageSet,
    storageDelete,
    waitForElement,
    onUrlChange,
    createRouteTokenController,
    showBanner,
    registerDebugToggle,
  } = window.__AGIS_CORE__;
  normalizeText = window.__AGIS_CORE__.normalizeText;

  const SCRIPT_NS = 'agis:task-item-income';
  // Префикс для id/классов DOM (без двоеточия — не ломает CSS-селекторы).
  const DOM_NS = 'agis-task-item-income';
  const STORAGE_KEY = 'agis:task-item-income:payload:v1';
  const DEBUG_KEY = 'agis:task-item-income:debug';
  const WAIT_TIMEOUT = 15000;
  const FORM_WAIT_TIMEOUT = 10000;

  // registerDebugToggle асинхронный — до резолва debugCtl.value === false;
  // bootstrap() стартует только после регистрации (см. низ файла).
  let debugCtl = { value: false };

  const routeTokenController = createRouteTokenController();

  function log(...args) {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  // --- Чистые функции (покрыты тестами) ---

  // ["amount: 7.88", "loan-id: 4174817", ...] → { amount: '7.88', 'loan-id': '4174817' }.
  // Делим по первому двоеточию: в значении comment двоеточие может встречаться.
  function parseParamLines(lines) {
    const result = {};
    for (const line of lines) {
      const text = normalizeText(line);
      const idx = text.indexOf(':');
      if (idx <= 0) continue;
      const key = text.slice(0, idx).trim().toLowerCase();
      const value = text.slice(idx + 1).trim();
      if (key) result[key] = value;
    }
    return result;
  }

  function parseAmount(value) {
    const text = normalizeText(value);
    const match = text.match(/-?\d+(?:[ .]\d{3})*(?:[.,]\d+)?/);
    if (!match) return '';
    return match[0].replace(/\s/g, '').replace(',', '.');
  }

  // Форма прихода ждёт «YYYY-MM-DD HH:MM:SS» (как в agis-add-income-from-googlesheet).
  // Дата из параметров — «DD.MM.YYYY», время берём текущее.
  function toFormDateTime(dateStr, now = new Date()) {
    const text = normalizeText(dateStr);
    if (!text) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?$/);
    if (m) {
      const t = m[4] ? (m[4].length === 5 ? `${m[4]}:00` : m[4]) : time;
      return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${t}`;
    }

    m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] || time}`;

    // Неизвестный формат — отдаём как есть, пусть пользователь увидит и поправит.
    return text;
  }

  // options: [{ value, text }]. Возвращает value подходящей опции или ''.
  function resolveIncomeTypeOption(options, rawType) {
    const raw = normalizeText(rawType).toLowerCase();
    if (!raw) return '';
    const target = (INCOME_TYPE_MAP[raw] || rawType).toLowerCase().trim();
    const norm = (o) => normalizeText(o.text).toLowerCase();
    const exact = options.find((o) => o.value && norm(o) === target);
    if (exact) return exact.value;
    const partial = options.find((o) => o.value && norm(o).includes(target));
    return partial ? partial.value : '';
  }

  // --- Страница результатов команды (supportprocesstaskitem/list) ---

  function findParamsColumnIndex(table) {
    const headers = Array.from(table.querySelectorAll('thead th'));
    return headers.findIndex((th) => normalizeText(th.textContent).toLowerCase().includes('параметры'));
  }

  function getParamsCell(tr, colIndex) {
    // Основной путь — по индексу колонки «Параметры»; запасной — по классу Sonata
    // для one_to_many-поля (менее надёжен, если таких колонок станет несколько).
    if (colIndex >= 0 && tr.children[colIndex]) return tr.children[colIndex];
    return tr.querySelector('td.sonata-ba-list-field-one_to_many');
  }

  function buildIncomeListUrl(loanId) {
    // Со страницы команды тип займа неизвестен — берём loan-overdue, как в
    // agis-protocol-income-fill (Sonata открывает приходы и для непросроченных).
    return `/admin/agis2/core/loan-overdue/${loanId}/income/list`;
  }

  async function initTaskItemListPage(token) {
    let table;
    try {
      table = await waitForElement('table.sonata-ba-list', { timeout: WAIT_TIMEOUT });
    } catch (error) {
      warn('Таблица не появилась (table.sonata-ba-list):', error.message);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    const colIndex = findParamsColumnIndex(table);
    log('Индекс колонки «Параметры»:', colIndex);

    if (!document.querySelector(`#${DOM_NS}-list-style`)) {
      const style = document.createElement('style');
      style.id = `${DOM_NS}-list-style`;
      style.textContent = [
        `tr.${DOM_NS}-row { cursor: copy; }`,
        `tr.${DOM_NS}-row:hover td { background: #fff7d6 !important; }`,
        `tr.${DOM_NS}-row.${DOM_NS}-picked td { background: #e6f4ea !important; }`,
      ].join('\n');
      document.head.appendChild(style);
    }

    const rows = table.querySelectorAll('tbody tr');
    let bound = 0;

    rows.forEach((tr) => {
      if (tr.dataset.agisTaskItemBound === '1') return;
      const cell = getParamsCell(tr, colIndex);
      if (!cell) return;

      const lines = Array.from(cell.querySelectorAll('li')).map((li) => li.textContent);
      const params = parseParamLines(lines);
      // Привязываемся только к строкам, похожим на команду добавления прихода.
      if (!params['loan-id'] || !params.amount) return;

      tr.dataset.agisTaskItemBound = '1';
      tr.classList.add(`${DOM_NS}-row`);
      tr.title = 'Клик: сохранить платёж и перейти к списку приходов займа';
      bound += 1;

      tr.addEventListener('click', async (event) => {
        // Кнопки строки (просмотр / resolved / повтор) не перехватываем.
        if (event.target.closest('a, button, input, label, .btn')) return;
        event.preventDefault();

        const itemId = tr.querySelector('td[objectId]')?.getAttribute('objectId') || '';
        const payload = {
          itemId,
          loanId: params['loan-id'].replace(/\s/g, ''),
          incomeDate: toFormDateTime(params['income-date']),
          amount: parseAmount(params.amount),
          incomeType: params['income-type'] || '',
          comment: params.comment || '',
          orderNumber: params['order-number'] || params['bank-payment-id'] || '-',
          savedAt: Date.now(),
        };

        log('Пайлоад:', payload);
        try {
          await storageSet(STORAGE_KEY, payload);
        } catch (error) {
          warn('Не удалось сохранить payload:', error);
          showBanner('Не удалось сохранить данные платежа.', { type: 'error', durationMs: 4000 });
          return;
        }

        tr.classList.add(`${DOM_NS}-picked`);
        showBanner(
          `Сохранено: займ ${payload.loanId}, ${payload.amount}, ${payload.incomeDate || '-'}, вид «${payload.incomeType || '-'}»`,
          { type: 'success', durationMs: 2500 },
        );

        const targetUrl = buildIncomeListUrl(payload.loanId);
        log('Переход:', targetUrl);
        location.href = targetUrl;
      });
    });

    log('Строк в таблице:', rows.length, 'привязано:', bound);
  }

  // --- Страница создания прихода ---

  // Ставит value через нативный setter + события (для Sonata/select2/jQuery-обработчиков).
  function setVal(selectors, value) {
    if (value === undefined || value === null || value === '') return false;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;

      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger('change');

      log('Заполнено поле:', selector, '→', value);
      return true;
    }
    log('Поле не найдено:', selectors);
    return false;
  }

  function setIncomeType(rawType) {
    // Тег в селекторе обязателен: обёртка Sonata <div id="..._manualIncomeType"> тоже матчится по id.
    const sel = document.querySelector('select[name$="[manualIncomeType]"], select[id$="_manualIncomeType"]');
    if (!sel) {
      warn('Select «Вид прихода» не найден (select[name$="[manualIncomeType]"])');
      return false;
    }
    const options = Array.from(sel.options).map((o) => ({ value: o.value, text: o.text }));
    const value = resolveIncomeTypeOption(options, rawType);
    if (!value) {
      warn('Опция «Вид прихода» не найдена для:', rawType, options);
      return false;
    }
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(sel).trigger('change');
    log('Вид прихода:', rawType, '→', value);
    return true;
  }

  function fillForm(data) {
    const dateOk = setVal(['input[name$="[incomeDate]"]', 'input[id$="_incomeDate"]'], data.incomeDate);
    const orderOk = setVal(['input[name$="[bankPaymentId]"]', 'input[id$="_bankPaymentId"]'], data.orderNumber || '-');
    const amountOk = setVal(['input[name$="[income]"]', 'input[id$="_income"]'], data.amount);
    const typeOk = setIncomeType(data.incomeType);
    const commentOk = setVal(['textarea[name$="[comment]"]', 'textarea[id$="_comment"]'], data.comment);

    // Успех — заполнены дата, сумма и вид прихода; иначе payload остаётся в storage.
    const success = dateOk && amountOk && typeOk;
    const mark = (ok) => (ok ? 'OK' : 'нет');

    showBanner(
      [
        success ? 'Поля заполнены — проверьте и нажмите «Предпросмотр».' : 'Заполнено не всё.',
        `Дата: ${mark(dateOk)}`,
        `Сумма: ${mark(amountOk)}`,
        `Вид прихода: ${mark(typeOk)}`,
        `Номер заказа: ${mark(orderOk)}`,
        `Комментарий: ${mark(commentOk)}`,
      ].join(' '),
      { type: success ? 'success' : 'error', durationMs: 6000 },
    );

    log('Заполнено:', { data, dateOk, amountOk, typeOk, orderOk, commentOk });
    return success;
  }

  function getLoanIdFromUrl() {
    const match = location.pathname.match(/\/(?:loan|loan-overdue)\/(\d+)\/income\/(?:list|create)\b/i);
    return match ? match[1] : '';
  }

  function removeFillButton() {
    document.querySelector(`#${DOM_NS}-fill-wrap`)?.remove();
  }

  function addFillButton(data, handler) {
    if (document.querySelector(`#${DOM_NS}-fill-btn`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${DOM_NS}-fill-btn`;
    btn.className = 'btn btn-success';
    btn.textContent = `Вставить платёж ${data.amount} (${data.incomeType || 'вид ?'})`;
    btn.addEventListener('click', handler);

    const wrap = document.createElement('span');
    wrap.id = `${DOM_NS}-fill-wrap`;
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', marginLeft: '8px' });
    wrap.appendChild(btn);

    // Рядом с «Предпросмотр»; запасные варианты — блок действий формы, затем fixed.
    const previewBtn = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn')).find((el) =>
      normalizeText(el.textContent || el.value || '').includes('Предпросмотр'),
    );
    if (previewBtn?.parentElement) {
      previewBtn.insertAdjacentElement('afterend', wrap);
      return;
    }

    const actions = document.querySelector('.sonata-ba-form-actions, .box-footer');
    if (actions) {
      actions.appendChild(wrap);
      return;
    }

    warn('Кнопка вставлена как fixed fallback — блок действий формы не найден.');
    Object.assign(wrap.style, { position: 'fixed', top: '100px', right: '20px', zIndex: '99999' });
    document.body.appendChild(wrap);
  }

  async function initCreatePage(token) {
    try {
      await waitForElement('input[name$="[incomeDate]"], input[name$="[income]"]', { timeout: FORM_WAIT_TIMEOUT });
    } catch (error) {
      warn('Форма прихода не появилась (input[name$="[incomeDate]"]):', error.message);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    const data = await storageGet(STORAGE_KEY, null);
    if (!routeTokenController.isCurrent(token)) return;
    if (!data || typeof data !== 'object') {
      removeFillButton();
      return;
    }

    const urlLoanId = getLoanIdFromUrl();
    if (urlLoanId && data.loanId && urlLoanId !== data.loanId) {
      // Защита от вставки платежа не в тот займ.
      showBanner(`Сохранён платёж для займа ${data.loanId}, а открыт займ ${urlLoanId} — кнопка не показана.`, {
        type: 'error',
        durationMs: 6000,
      });
      return;
    }

    addFillButton(data, async () => {
      const current = await storageGet(STORAGE_KEY, null);
      if (!current || typeof current !== 'object') {
        removeFillButton();
        showBanner('Нет сохранённых данных.', { type: 'error', durationMs: 3000 });
        return;
      }
      if (fillForm(current)) {
        await storageDelete(STORAGE_KEY);
        removeFillButton();
        log('Payload удалён после успешной вставки.');
      }
    });
  }

  // --- Точка входа ---
  async function bootstrap() {
    const token = routeTokenController.next();
    cleanupRoute();

    try {
      await waitForElement('body');
    } catch (error) {
      warn('body:', error.message);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    const path = location.pathname;

    if (/\/supportprocess\/domain\/supportprocesstask\/\d+\/supportprocesstaskitem\/list/.test(path)) {
      await initTaskItemListPage(token);
      return;
    }

    if (/\/admin\/agis2\/core\/(?:loan|loan-overdue)\/\d+\/income\/create/.test(path)) {
      await initCreatePage(token);
      return;
    }

    if (/\/admin\/agis2\/core\/(?:loan|loan-overdue)\/\d+\/income\/list/.test(path)) {
      log('Список приходов — нажмите «Добавить новый», кнопка вставки появится в форме.');
    }
  }

  // onUrlChange — синхронно, до любых await.
  const stopUrlWatcher = onUrlChange(() => {
    bootstrap().catch((error) => warn('bootstrap error:', error));
  });

  window.addEventListener(
    'pagehide',
    () => {
      cleanup();
      stopUrlWatcher();
    },
    { once: true },
  );

  (async () => {
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap().catch((error) => warn('bootstrap error:', error));
  })();
})();
