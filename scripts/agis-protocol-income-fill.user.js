// ==UserScript==
// @name         AGIS - вставка прихода из протокола
// @namespace    agis.protocol.income.fill
// @version      2.1
// @description  Клик по строке протокола сохраняет данные; автопереход на список приходов нужного займа; на странице создания прихода кнопка вставки заполняет форму.
// @match        https://agis.volgazaim.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.moneymania.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.belkacredit.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.credit7.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-overdue/*/income/create*
// @match        https://agis.credit365.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-overdue/*/income/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.1.0/lib/agis-core.js#sha256=mrgmLBDYkBLsL/GI0rVsuHT8V8QjzhXSEneovVOIL4Y=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:protocol-income] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    debounce,
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

  const SCRIPT_NS = 'agis:protocol-income';
  // ID для DOM-элементов и CSS-классов (не содержит двоеточия, чтобы не ломать CSS-селекторы).
  const DOM_NS = 'agis-protocol-income';
  const STORAGE_KEY = 'agis:protocol-income:payload:v1';
  const DEBUG_KEY = 'agis:protocol-income:debug';
  const WAIT_TIMEOUT = 15000;
  const FORM_WAIT_TIMEOUT = 10000;

  // registerDebugToggle асинхронный — debugCtl.value равен false, пока не резолвится.
  // bootstrap() дожидается и миграции легаси-ключей, и регистрации debug-toggle перед
  // первым запуском (см. низ файла) — иначе log() внутри initListPage/initCreatePage мог
  // выполниться раньше, чем резолвится debugCtl, и debug-логи не появились бы вовсе
  // (см. agis-duplicate-income.user.js, где эта гонка реально проявилась).
  let debugCtl = { value: false };

  const routeTokenController = createRouteTokenController();

  function log(...args) {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  // Миграция storage-ключей с v1.x (плоские имена) на v2.x (namespace + версия).
  // Разовая операция: если новый ключ пуст, а старый есть — переносим и чистим старый.
  async function migrateLegacyStorage() {
    try {
      const legacyDebug = await storageGet('debug_protocol_income_fill', undefined);
      if (legacyDebug !== undefined && !(await storageGet(DEBUG_KEY, undefined))) {
        await storageSet(DEBUG_KEY, !!legacyDebug);
        await storageDelete('debug_protocol_income_fill');
        // Безусловный console.log, не log(): миграция выполняется до резолва
        // registerDebugToggle (debugCtl.value ещё false), так что гейтированный
        // лог здесь никогда бы не напечатался — событие одноразовое и редкое,
        // ценность диагностики важнее debug-гейта.
        console.log(`[${SCRIPT_NS}] Миграция storage: debug флаг перенесён`);
      }

      const legacyPayload = await storageGet('agis_protocol_income_payload', undefined);
      if (legacyPayload !== undefined && !(await storageGet(STORAGE_KEY, undefined))) {
        await storageSet(STORAGE_KEY, legacyPayload);
        await storageDelete('agis_protocol_income_payload');
        console.log(`[${SCRIPT_NS}] Миграция storage: payload перенесён`);
      }
    } catch (error) {
      warn('Миграция storage не удалась:', error);
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseAmount(value) {
    const text = normalizeText(value);
    const match = text.match(/-?\d+(?:[ .]\d{3})*(?:[.,]\d+)?/);
    if (!match) return '';
    return match[0].replace(/\s/g, '').replace(',', '.');
  }

  function getLoanIdFromUrl() {
    // Работает только на страницах income/list и income/create.
    const match = location.pathname.match(/\/(?:loan|loan-overdue)\/(\d+)\/income\/(?:list|create)\b/i);
    return match ? match[1] : '';
  }

  function cellText(td) {
    return td ? normalizeText(td.textContent) : '';
  }

  function getHeaderMap(table) {
    const result = {};
    const headers = table.querySelectorAll('thead th');

    headers.forEach((th, index) => {
      const text = normalizeText(th.textContent).toLowerCase();
      if (text.includes('id займ')) result.loanId = index;
      if (text.includes('дата прихода')) result.incomeDate = index;
      if (text.includes('сумма прихода')) result.amount = index;
      if (text.includes('номер заказа')) result.orderNumber = index;
    });

    return result;
  }

  function buildIncomeListUrl(loanId) {
    const currentTypeMatch = location.pathname.match(/\/admin\/agis2\/core\/(loan|loan-overdue)\//i);
    const type = currentTypeMatch ? currentTypeMatch[1] : 'loan-overdue';
    return `/admin/agis2/core/${type}/${loanId}/income/list`;
  }

  async function initListPage(token) {
    let table;

    try {
      table = await waitForElement('table.sonata-ba-list, table.table', { timeout: WAIT_TIMEOUT });
    } catch (error) {
      warn('Таблица не появилась:', error.message);
      return;
    }

    if (!routeTokenController.isCurrent(token)) return;

    const colIndex = getHeaderMap(table);
    log('Колонки:', colIndex);

    if (!document.querySelector(`#${DOM_NS}-list-style`)) {
      const style = document.createElement('style');
      style.id = `${DOM_NS}-list-style`;
      style.textContent = [
        'tr.bc-protocol-copy-row { cursor: copy; }',
        'tr.bc-protocol-copy-row:hover td { background: #fff7d6 !important; }'
      ].join('\n');
      document.head.appendChild(style);
    }

    const rows = table.querySelectorAll('tbody tr');

    rows.forEach((tr) => {
      if (tr.dataset.bcProtocolBound === '1') return;
      tr.dataset.bcProtocolBound = '1';

      tr.classList.add('bc-protocol-copy-row');
      tr.title = 'Клик: сохранить данные и перейти к списку приходов';

      tr.addEventListener('click', async (event) => {
        if (event.target.closest('a, button, input, label, .btn')) return;
        event.preventDefault();

        const cells = tr.children;
        const rawLoanId = colIndex.loanId !== undefined ? cellText(cells[colIndex.loanId]) : '';
        const loanIdFromCell = rawLoanId.replace(/\s/g, '');
        const loanIdFromUrl = getLoanIdFromUrl();
        const loanId = loanIdFromCell || loanIdFromUrl;

        const payload = {
          loanId,
          incomeDate: colIndex.incomeDate !== undefined ? cellText(cells[colIndex.incomeDate]) : '',
          amount: colIndex.amount !== undefined ? parseAmount(cellText(cells[colIndex.amount])) : '',
          orderNumber: colIndex.orderNumber !== undefined ? cellText(cells[colIndex.orderNumber]) : '-'
        };

        if (!payload.orderNumber) payload.orderNumber = '-';

        log('Пайлоад:', payload);
        await storageSet(STORAGE_KEY, payload);

        showBanner(
          `Сохранено: займ ${payload.loanId || '-'}, дата ${payload.incomeDate || '-'}, сумма ${payload.amount || '-'}, заказ ${payload.orderNumber || '-'}`,
          { type: 'success', durationMs: 2500 }
        );

        if (!loanId) {
          warn('Не удалось определить ID займа для перехода.');
          showBanner('Не удалось определить ID займа для перехода.', { type: 'error', durationMs: 3500 });
          return;
        }

        const targetUrl = buildIncomeListUrl(loanId);
        log('Переход на список приходов:', targetUrl);
        location.href = targetUrl;
      });
    });

    log('Список протокола готов, строк:', rows.length);
  }

  function setVal(selectors, value) {
    if (value === undefined || value === null) return false;
    const list = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of list) {
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

    log('Поле не найдено:', list);
    return false;
  }

  async function waitForIncomeForm() {
    const selector = [
      'input[aria-label="Дата платежа"]',
      'input[name$="[incomeDate]"]',
      'input[aria-label="Номер заказа*"]',
      'input[aria-label="Сумма платежа*"]',
      'textarea'
    ].join(', ');

    return waitForElement(selector, { timeout: FORM_WAIT_TIMEOUT });
  }

  function findNodeByText(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let node;

    while ((node = walker.nextNode())) {
      const content = normalizeText(node.textContent);
      if (content && content.includes(text)) return node;
    }

    return null;
  }

  function removeFillButton() {
    const btn = document.querySelector(`#${DOM_NS}-fill-btn`);
    if (btn) {
      const container = btn.parentElement;
      btn.remove();

      if (
        container &&
        (container.tagName === 'SPAN' || container.tagName === 'DIV') &&
        !container.textContent.trim() &&
        container.children.length === 0
      ) {
        container.remove();
      }
    }
  }

  function addFillButton(handler) {
    if (document.querySelector(`#${DOM_NS}-fill-btn`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${DOM_NS}-fill-btn`;
    btn.className = 'btn btn-success';
    btn.textContent = 'Вставить сохранённые данные';

    Object.assign(btn.style, {
      marginLeft: '8px',
      whiteSpace: 'nowrap'
    });

    btn.addEventListener('click', handler);

    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));

    const previewBtn = allButtons.find((el) => {
      const text = normalizeText(el.textContent || el.value || '');
      return text === 'Предпросмотр' || text.includes('Предпросмотр');
    });

    if (previewBtn && previewBtn.parentElement) {
      const wrapper = document.createElement('span');
      Object.assign(wrapper.style, {
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '8px'
      });
      wrapper.appendChild(btn);

      previewBtn.insertAdjacentElement('afterend', wrapper);
      log('Кнопка вставлена рядом с кнопкой "Предпросмотр".');
      return;
    }

    const previewTextNode = findNodeByText('Предпросмотр');
    if (previewTextNode && previewTextNode.parentElement) {
      warn('Кнопка вставлена через текстовый fallback "Предпросмотр" — селектор может быть ломким.');

      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, {
        display: 'inline-block',
        marginLeft: '8px'
      });
      wrapper.appendChild(btn);

      previewTextNode.insertAdjacentElement('afterend', wrapper);
      log('Кнопка вставлена рядом с текстом "Предпросмотр".');
      return;
    }

    const actions = document.querySelector('.sonata-ba-form-actions, .box-footer, form');
    if (actions) {
      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, {
        marginTop: '12px'
      });
      wrapper.appendChild(btn);
      actions.appendChild(wrapper);
      log('Кнопка вставлена в actions как fallback.');
      return;
    }

    Object.assign(btn.style, {
      position: 'fixed',
      top: '100px',
      right: '20px',
      zIndex: '99999'
    });
    document.body.appendChild(btn);
    warn('Кнопка вставлена как fixed fallback — стоит проверить более устойчивый контейнер.');
    log('Кнопка вставлена как fixed fallback.');
  }

  function fillForm(data) {
    const loanIdFromUrl = getLoanIdFromUrl();

    const dateOk = setVal(
      [
        'input[aria-label="Дата платежа"]',
        'input[name$="[incomeDate]"]'
      ],
      data.incomeDate
    );

    const orderOk = setVal(
      [
        'input[aria-label="Номер заказа*"]',
        'input[name$="[bankPaymentId]"]',
        'input[name*="[orderNumber]"]'
      ],
      data.orderNumber || '-'
    );

    const amountOk = setVal(
      [
        'input[aria-label="Сумма платежа*"]',
        'input[name$="[income]"]',
        'input[name*="[amount]"]'
      ],
      data.amount
    );

    // Считаем успехом только если заполнены оба критичных поля: дата и сумма.
    // Это защищает от удаления данных из storage при частичном заполнении формы.
    const success = dateOk && amountOk;

    showBanner(
      [
        success ? 'Поля заполнены.' : 'Не удалось заполнить поля.',
        `Дата: ${dateOk ? 'OK' : 'нет'}`,
        `Номер заказа: ${orderOk ? 'OK' : 'нет'}`,
        `Сумма: ${amountOk ? 'OK' : 'нет'}`,
        `ID займа: ${loanIdFromUrl || 'из URL не определён'}`
      ].join(' '),
      { type: success ? 'success' : 'error', durationMs: 5000 }
    );

    log('Заполнено:', { data, loanIdFromUrl, dateOk, orderOk, amountOk, success });
    return success;
  }

  async function updateFillButtonVisibility(handler) {
    const data = await storageGet(STORAGE_KEY, null);
    const hasData = !!(data && typeof data === 'object');

    if (hasData) {
      addFillButton(handler);
      return;
    }

    removeFillButton();
    log('Скрыта кнопка вставки: нет данных для вставки.');
  }

  async function initCreatePage(token) {
    try {
      await waitForIncomeForm();
    } catch (error) {
      warn('Форма не появилась:', error.message);
      return;
    }

    if (!routeTokenController.isCurrent(token)) return;

    const fillHandler = async () => {
      const data = await storageGet(STORAGE_KEY, null);

      if (!data || typeof data !== 'object') {
        removeFillButton();
        alert('Нет сохранённых данных.');
        return;
      }

      const success = fillForm(data);

      if (success) {
        await storageDelete(STORAGE_KEY);
        removeFillButton();
        log('Сохранённые данные удалены после успешной вставки.');
      }
    };

    await updateFillButtonVisibility(fillHandler);
  }

  function initIncomeListPage() {
    log('Страница списка приходов — ожидание действий пользователя.');
  }

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

    if (/\/supportprocess\/domain\/supportprocesstask\/\d+\/task-protocol\/list/.test(path)) {
      await initListPage(token);
      return;
    }

    if (/\/admin\/agis2\/core\/(?:loan|loan-overdue)\/\d+\/income\/create/.test(path)) {
      await initCreatePage(token);
      return;
    }

    if (/\/admin\/agis2\/core\/(?:loan|loan-overdue)\/\d+\/income\/list/.test(path)) {
      initIncomeListPage();
    }
  }

  // onUrlChange устанавливается синхронно, до любых await — SPA-watcher не должен
  // ждать миграцию storage/регистрацию debug-toggle (см. bootstrap-инициализацию ниже).
  const stopUrlWatcher = onUrlChange(() => {
    bootstrap().catch((error) => warn('bootstrap error:', error));
  });

  window.addEventListener('pagehide', () => {
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  (async () => {
    await migrateLegacyStorage();
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap();
  })();
})();
