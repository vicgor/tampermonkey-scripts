// ==UserScript==
// @name         AGIS - вставка прихода из операций по карте
// @namespace    agis.creditcardoperation.income.fill
// @version      1.1.1
// @description  Клик по входящей операции на странице «Операции по карте» займа сохраняет дату, сумму, номер операции и шлюз; переход на список приходов; на форме создания прихода кнопка вставки заполняет поля.
// @match        https://agis.volgazaim.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/*/income/list*
// @match        https://agis.volgazaim.ru/admin/agis2/core/*/income/create*
// @match        https://agis.creditsmile.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/*/income/list*
// @match        https://agis.creditsmile.ru/admin/agis2/core/*/income/create*
// @match        https://agis.moneymania.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/*/income/list*
// @match        https://agis.moneymania.ru/admin/agis2/core/*/income/create*
// @match        https://agis.berrycash.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/*/income/create*
// @match        https://agis.belkacredit.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/*/income/list*
// @match        https://agis.belkacredit.ru/admin/agis2/core/*/income/create*
// @match        https://agis.credit7.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.credit7.ru/admin/agis2/core/*/income/list*
// @match        https://agis.credit7.ru/admin/agis2/core/*/income/create*
// @match        https://agis.credit365.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.credit365.ru/admin/agis2/core/*/income/list*
// @match        https://agis.credit365.ru/admin/agis2/core/*/income/create*
// @match        https://agis.vashcash.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.vashcash.ru/admin/agis2/core/*/income/list*
// @match        https://agis.vashcash.ru/admin/agis2/core/*/income/create*
// @match        https://agis.ikracredit.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.ikracredit.ru/admin/agis2/core/*/income/list*
// @match        https://agis.ikracredit.ru/admin/agis2/core/*/income/create*
// @match        https://agis.zaimix.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.zaimix.ru/admin/agis2/core/*/income/list*
// @match        https://agis.zaimix.ru/admin/agis2/core/*/income/create*
// @match        https://agis.finrook.ru/admin/agis2/core/*/creditcardoperation/list*
// @match        https://agis.finrook.ru/admin/agis2/core/*/income/list*
// @match        https://agis.finrook.ru/admin/agis2/core/*/income/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-creditcardoperation-income-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-creditcardoperation-income-fill.user.js
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

  // Шлюз операции (CreditCardOperation.paymentSystem, см. PaymentProvidersEnum в backend) →
  // value опции select'а manualIncomeType (ManualIncomeType в backend). Матчим по value, а не
  // по тексту опции: текст — перевод и может отличаться между брендами. Объявлен до guard'а
  // ниже — resolveIncomeType экспортируется в тест и читает карту по замыканию (иначе TDZ).
  const INCOME_TYPE_BY_GATEWAY = {
    mapi: 'MI_Tinkoff',
    mapi_sbp: 'MI_Tinkoff',
    e2c: 'MI_Tinkoff',
    tinkoff: 'MI_Tinkoff',
    alfa_bank: 'MI_Alfa',
    tkb_bank: 'MI_tkb_bank',
    korona: 'MI_Korona',
    qiwi: 'MI_Qiwi',
    elecsnet: 'MI_Elecsnet',
    siab_bank: 'MI_Siab',
    your_payments: 'MI_YOUR_PAYMENTS',
    euro_alliance: 'MI_EuroAlliance',
  };

  // Входящие типы операций (CreditCardOperation::OPERATION_TYPES): только они могут стать
  // приходом. money_transfer — выдача, verification — привязка карты.
  const INCOMING_OPERATION_TYPES = new Set(['repayment', 'rebill_payment']);

  // Скопированная операция старше этого срока не вставляется: иначе на форме того же займа
  // через дни можно молча вставить давно забытую операцию.
  const PAYLOAD_TTL_MS = 30 * 60 * 1000;

  // normalizeText/cellText/ruMonthNumber — из ядра, назначаются в одной из двух веток ниже
  // (та же схема, что в agis-protocol-income-fill/agis-duplicate-income).
  let normalizeText;
  let cellText;
  let ruMonthNumber;

  // Тестовый экспорт для vitest (test/scripts/agis-creditcardoperation-income-fill*.test.js).
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    const core = require('../lib/agis-core.js');
    normalizeText = core.normalizeText;
    cellText = core.cellText;
    ruMonthNumber = core.ruMonthNumber;
    module.exports = {
      parseAmount,
      normalizeDate,
      resolveIncomeType,
      isIncomingOperation,
      isPayloadFresh,
      getHeaderMap,
      extractOperation,
    };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:cco-income] agis-core.js не загружен (@require не сработал)');
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
  cellText = window.__AGIS_CORE__.cellText;
  ruMonthNumber = window.__AGIS_CORE__.ruMonthNumber;

  const SCRIPT_NS = 'agis:cco-income';
  // Для DOM id/CSS-классов — без двоеточия, чтобы не ломать селекторы.
  const DOM_NS = 'agis-cco-income';
  const STORAGE_KEY = 'agis:cco-income:payload:v1';
  const DEBUG_KEY = 'agis:cco-income:debug';
  const WAIT_TIMEOUT = 15000;
  const FORM_WAIT_TIMEOUT = 10000;

  // debugCtl резолвится асинхронно — bootstrap() ждёт его (см. низ файла), иначе ранние
  // log() не печатаются (гонка, найденная в agis-duplicate-income).
  let debugCtl = { value: false };

  const routeTokenController = createRouteTokenController();

  function log(...args) {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  // "4 640,00 ₽" → "4640.00". \s в normalizeText покрывает и nbsp/narrow nbsp из форматтера.
  function parseAmount(value) {
    const text = normalizeText(value);
    const match = text.match(/-?\d+(?:[ .]\d{3})*(?:[.,]\d+)?/);
    if (!match) return '';
    return match[0].replace(/\s/g, '').replace(',', '.');
  }

  // "28 авг. 2026 г., 16:52:58" → "2026-08-28 16:52:58" (формат DateTimePickerType формы).
  function normalizeDate(value) {
    const text = normalizeText(value);
    const match = text.match(/(\d{1,2})\s+([a-zа-яё]+\.?)\s+(\d{4}).*?(\d{1,2}):(\d{2}):(\d{2})/i);
    if (!match) return '';
    const month = ruMonthNumber(match[2]);
    if (!month) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${match[3]}-${month}-${pad(match[1])} ${pad(match[4])}:${match[5]}:${match[6]}`;
  }

  function resolveIncomeType(gateway) {
    return INCOME_TYPE_BY_GATEWAY[normalizeText(gateway).toLowerCase()] ?? '';
  }

  function isIncomingOperation(operationType) {
    return INCOMING_OPERATION_TYPES.has(normalizeText(operationType).toLowerCase());
  }

  function isPayloadFresh(payload, now) {
    if (!payload || typeof payload !== 'object' || !Number.isFinite(payload.savedAt)) return false;
    const ageMs = now - payload.savedAt;
    return ageMs >= 0 && ageMs <= PAYLOAD_TTL_MS;
  }

  // Просроченный payload удаляется сразу, чтобы кнопка больше не появлялась.
  async function loadFreshPayload() {
    const payload = await storageGet(STORAGE_KEY, null);
    if (isPayloadFresh(payload, Date.now())) return payload;
    if (payload) {
      await storageDelete(STORAGE_KEY);
      log('Сохранённая операция просрочена — удалена:', payload);
    }
    return null;
  }

  // Точное сравнение заголовков: "Номер операции"/"Номер в банке" и "Сумма"/"Счет получателя"
  // не должны перепутаться, как было бы при includes().
  function getHeaderMap(table) {
    const result = {};
    table.querySelectorAll('thead th').forEach((th, index) => {
      const text = normalizeText(th.textContent).toLowerCase();
      if (text === 'сумма') result.amount = index;
      if (text === 'номер операции') result.orderReference = index;
      if (text === 'тип') result.operationType = index;
      if (text === 'статус') result.status = index;
      if (text === 'дата') result.processedAt = index;
      if (text === 'платежный шлюз') result.gateway = index;
    });
    return result;
  }

  // Отсутствующая колонка (индекс undefined) даёт пустую строку — cellText(undefined) === ''.
  function extractOperation(cells, colIndex) {
    return {
      operationType: cellText(cells[colIndex.operationType]),
      incomeDate: normalizeDate(cellText(cells[colIndex.processedAt])),
      amount: parseAmount(cellText(cells[colIndex.amount])),
      orderReference: cellText(cells[colIndex.orderReference]),
      gateway: cellText(cells[colIndex.gateway]),
      status: cellText(cells[colIndex.status]),
    };
  }

  function getLoanRouteFromUrl() {
    const match = location.pathname.match(/\/admin\/agis2\/core\/([a-z-]+)\/(\d+)\/(?:creditcardoperation|income)\//i);
    return match ? { type: match[1], loanId: match[2] } : null;
  }

  async function initOperationListPage(token) {
    let table;
    try {
      table = await waitForElement('table.sonata-ba-list, table.table', { timeout: WAIT_TIMEOUT });
    } catch (error) {
      warn('Таблица не появилась (table.sonata-ba-list, table.table):', error.message);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    const colIndex = getHeaderMap(table);
    log('Колонки:', colIndex);

    const missingColumns = ['amount', 'processedAt', 'operationType'].filter((key) => colIndex[key] === undefined);
    if (missingColumns.length) {
      warn('Не найдены колонки:', missingColumns);
      return;
    }

    if (!document.querySelector(`#${DOM_NS}-list-style`)) {
      const style = document.createElement('style');
      style.id = `${DOM_NS}-list-style`;
      style.textContent = [
        `tr.${DOM_NS}-row { cursor: copy; }`,
        `tr.${DOM_NS}-row:hover td { background: #fff7d6 !important; }`,
      ].join('\n');
      document.head.appendChild(style);
    }

    const rows = table.querySelectorAll('tbody tr');
    let boundCount = 0;

    rows.forEach((tr) => {
      if (tr.dataset.agisCcoIncomeBound === '1') return;
      const operation = extractOperation(tr.children, colIndex);
      if (!isIncomingOperation(operation.operationType)) return;

      tr.dataset.agisCcoIncomeBound = '1';
      tr.classList.add(`${DOM_NS}-row`);
      tr.title = 'Клик: сохранить данные операции и перейти к списку приходов';
      boundCount++;

      tr.addEventListener('click', async (event) => {
        if (event.target.closest('a, button, input, label, .btn')) return;
        event.preventDefault();

        const route = getLoanRouteFromUrl();
        const payload = { loanId: route?.loanId ?? '', ...operation, savedAt: Date.now() };
        log('Пайлоад:', payload);

        // COMPLETED-операция обычно уже превратилась в приход автоматически — ручной создаст дубль.
        if (
          payload.status.toUpperCase() === 'COMPLETED' &&
          !confirm(
            `Операция ${payload.orderReference} в статусе COMPLETED — приход по ней, скорее всего, уже создан.\n` +
              'Проверьте список приходов. Всё равно сохранить данные?',
          )
        ) {
          return;
        }

        await storageSet(STORAGE_KEY, payload);

        if (!route) {
          warn('Не удалось определить займ из URL:', location.pathname);
          showBanner('Не удалось определить ID займа для перехода.', { type: 'error', durationMs: 3500 });
          return;
        }

        location.href = `/admin/agis2/core/${route.type}/${route.loanId}/income/list`;
      });
    });

    log('Список операций готов, входящих строк:', boundCount, 'из', rows.length);
  }

  function setVal(selector, value) {
    if (!value) return false;
    const el = document.querySelector(selector);
    if (!el) {
      log('Поле не найдено:', selector);
      return false;
    }

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(el).trigger('change');

    log('Заполнено поле:', selector, '→', value);
    return true;
  }

  function selectIncomeType(gateway) {
    const select = document.querySelector('select[name$="[manualIncomeType]"]');
    const incomeType = resolveIncomeType(gateway);
    if (!select || !incomeType) {
      warn('Тип прихода не выбран — select или маппинг шлюза не найден:', gateway);
      return false;
    }
    if (!Array.from(select.options).some((o) => o.value === incomeType)) {
      warn('В select нет опции:', incomeType);
      return false;
    }
    select.value = incomeType;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // select2 в Sonata обновляет видимое значение только по jQuery-событию.
    if (window.jQuery) window.jQuery(select).trigger('change');
    return true;
  }

  function fillForm(data) {
    const route = getLoanRouteFromUrl();
    const loanMismatch = !!(route && data.loanId && route.loanId !== data.loanId);
    if (
      loanMismatch &&
      !confirm(`Данные скопированы с займа ${data.loanId}, а форма — займа ${route.loanId}. Всё равно вставить?`)
    ) {
      return false;
    }

    const dateOk = setVal('input[name$="[incomeDate]"]', data.incomeDate);
    const orderOk = setVal('input[name$="[bankPaymentId]"]', data.orderReference);
    const amountOk = setVal('input[name$="[income]"]', data.amount);
    const typeOk = selectIncomeType(data.gateway);

    // Payload удаляется только при success — при частичном заполнении можно повторить.
    // Несовпадение займа сюда не входит: пользователь уже подтвердил его выше.
    const success = dateOk && amountOk && orderOk;

    showBanner(
      [
        loanMismatch ? `ВНИМАНИЕ: данные скопированы с займа ${data.loanId}, а форма — займа ${route.loanId}.` : '',
        success && typeOk ? 'Поля заполнены — проверьте и нажмите «Предпросмотр».' : 'Заполнено не всё.',
        `Дата: ${dateOk ? 'OK' : 'нет'}`,
        `Номер заказа: ${orderOk ? 'OK' : 'нет'}`,
        `Тип: ${typeOk ? 'OK' : `выберите вручную (шлюз ${data.gateway || '-'})`}`,
        `Сумма: ${amountOk ? 'OK' : 'нет'}`,
      ]
        .filter(Boolean)
        .join(' '),
      { type: success && typeOk ? 'success' : 'error', durationMs: 7000 },
    );

    log('Заполнено:', { data, dateOk, orderOk, amountOk, typeOk, loanMismatch });
    return success;
  }

  function removeFillButton() {
    document.querySelector(`#${DOM_NS}-fill-btn`)?.remove();
  }

  function addFillButton(handler) {
    if (document.querySelector(`#${DOM_NS}-fill-btn`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${DOM_NS}-fill-btn`;
    btn.className = 'btn btn-success';
    btn.textContent = 'Вставить данные операции';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', handler);

    const previewBtn = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn')).find((el) =>
      normalizeText(el.textContent || el.value).includes('Предпросмотр'),
    );
    if (previewBtn) {
      previewBtn.insertAdjacentElement('afterend', btn);
      return;
    }

    const actions = document.querySelector('.sonata-ba-form-actions, .box-footer, form');
    if (actions) {
      actions.appendChild(btn);
      return;
    }

    Object.assign(btn.style, { position: 'fixed', top: '100px', right: '20px', zIndex: '99999' });
    document.body.appendChild(btn);
    warn('Кнопка вставлена как fixed fallback — не найден контейнер действий формы.');
  }

  async function initCreatePage(token) {
    const stored = await loadFreshPayload();
    if (!routeTokenController.isCurrent(token)) return;
    if (!stored) return;

    try {
      await waitForElement('input[name$="[incomeDate]"]', { timeout: FORM_WAIT_TIMEOUT });
    } catch (error) {
      warn('Форма не появилась (input[name$="[incomeDate]"]):', error.message);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    addFillButton(async () => {
      const data = await loadFreshPayload();
      if (!data) {
        removeFillButton();
        alert('Нет сохранённых данных (или они старше 30 минут) — скопируйте операцию заново.');
        return;
      }

      if (fillForm(data)) {
        await storageDelete(STORAGE_KEY);
        removeFillButton();
      }
    });
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
    if (/\/admin\/agis2\/core\/[a-z-]+\/\d+\/creditcardoperation\/list/i.test(path)) {
      await initOperationListPage(token);
      return;
    }
    if (/\/admin\/agis2\/core\/[a-z-]+\/\d+\/income\/create/i.test(path)) {
      await initCreatePage(token);
      return;
    }
    if (/\/admin\/agis2\/core\/[a-z-]+\/\d+\/income\/list/i.test(path)) {
      log('Список приходов — ожидание перехода на создание прихода.');
    }
  }

  // onUrlChange — синхронно, до любых await (см. agis-protocol-income-fill).
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
