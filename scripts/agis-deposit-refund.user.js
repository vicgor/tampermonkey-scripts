// ==UserScript==
// @name         AGIS - возврат депозита
// @namespace    agis.deposit.refund
// @version      2.1.0
// @description  Находит «ДС на счету» на странице займа → кнопка «Вернуть депозит» → открывает форму транзакции и автозаполняет сумму, направление OUT и тип «Возврат депозита». Отправка формы — только вручную.
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*
// @match        https://agis.vashcash.ru/admin/agis2/core/loan/*
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan/*
// @match        https://agis.zaimix.ru/admin/agis2/core/loan/*
// @match        https://agis.finrook.ru/admin/agis2/core/loan/*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-deposit-refund.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-deposit-refund.user.js
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

  // Паттерны для скоринга полей формы транзакции. Объявлены до guard'а ниже, т.к.
  // findBestField/scoreFieldDescription экспортируются для тестов и читают их по замыканию
  // (та же схема, что GATEWAY_MAP в agis-duplicate-income.user.js).
  const AMOUNT_PATTERNS = [/amount/iu, /(^|\W)sum(\W|$)/iu, /сумм/iu];
  const DIRECTION_PATTERNS = [/direction/iu, /направлен/iu];
  const TYPE_PATTERNS = [/transaction.*type/iu, /type.*transaction/iu, /тип.*транзакц/iu, /тип операции/iu];

  // Срок жизни подготовленного возврата: старая сумма не должна подставиться в форму
  // через день. Объявлен до guard'а ниже — isPayloadUsable читает его по замыканию из тестов
  // (иначе при раннем return в Node-ветке вызов упал бы в TDZ).
  const PAYLOAD_TTL = 15 * 60 * 1000;

  // normalizeText приходит из ядра (window.__AGIS_CORE__), локальной копии больше нет —
  // let, значение назначается в одной из двух веток ниже.
  let normalizeText;

  // Тестовый экспорт для vitest (см. test/scripts/agis-deposit-refund.test.js) — до
  // window-guard'а, т.к. в Node window не определён. normalizeText берём напрямую из ядра,
  // чтобы не дублировать её логику. В Tampermonkey process/module не определены — ветка мёртвая.
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    normalizeText = require('../lib/agis-core.js').normalizeText;
    module.exports = {
      parseRoute,
      parseMoneyToKopecks,
      formatRubles,
      formatAmountForInput,
      normalizeComparable,
      extractDepositFromText,
      scoreFieldDescription,
      isPayloadUsable,
    };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:deposit-refund] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForCondition,
    cleanupRoute,
    cleanup,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
    storageGet,
    storageSet,
    storageDelete,
    showBanner,
    debounce,
  } = window.__AGIS_CORE__;
  normalizeText = window.__AGIS_CORE__.normalizeText;

  const SCRIPT_NS = 'agis:deposit-refund';
  const DOM_NS = 'agis-deposit-refund'; // без двоеточия — для id/CSS
  const PANEL_ID = `${DOM_NS}-panel`;
  // Ключ payload'а: namespace + версия схемы + id займа. Прежний плоский префикс
  // agisDepositRefund:<id> (v1.x) не миграется: payload живёт максимум PAYLOAD_TTL (15 мин)
  // и восстановим одним кликом, а GM_listValues для перебора старых ключей не заявлен в @grant.
  const STORAGE_PREFIX = `${SCRIPT_NS}:payload:v1`;
  const DEBUG_KEY = `${SCRIPT_NS}:debug`;
  const WAIT_TIMEOUT = 30000;

  // registerDebugToggle асинхронный — до резолва debugCtl.value всегда false, поэтому
  // его await'им перед первым bootstrap() (см. низ файла), иначе debug-логи на страницах,
  // где нужный DOM уже готов при старте, не появились бы вовсе.
  let debugCtl = { value: false };
  const log = (...a) => {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a);
  };
  // Хост в префиксе warn: скрипт работает на 11 брендах AGIS, а вручную проверен только
  // на moneymania — по логу должно быть сразу видно, на каком бренде разошлась разметка.
  const warn = (...a) => console.warn(`[${SCRIPT_NS}][${location.host}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // --- Чистые функции (экспортируются в тесты) ------------------------------

  // Ломкое место: путь страницы AGIS. Поддерживаются только две точки входа —
  // карточка займа (edit) и форма создания транзакции (loantransaction/create).
  function parseRoute(pathname) {
    const match = String(pathname || '').match(
      /^\/admin\/agis2\/core\/loan\/(\d+)\/(edit|loantransaction\/create)\/?$/,
    );
    if (!match) return null;
    return { loanId: match[1], page: match[2] === 'edit' ? 'edit' : 'create' };
  }

  function normalizeComparable(value) {
    return normalizeText(value).toLocaleLowerCase('ru-RU');
  }

  // Деньги считаем в копейках целыми числами — во float-рублях 1234.56 * 100 даёт 123455.99…
  function parseMoneyToKopecks(value) {
    const normalized = normalizeText(value).replace(/[₽рР]/g, '').replace(/\s/g, '').replace(',', '.');
    const match = normalized.match(/-?\d+(?:\.\d{1,2})?/);
    if (!match) return null;
    const amount = Number(match[0]);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100);
  }

  function formatRubles(kopecks) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(kopecks / 100);
  }

  function formatAmountForInput(kopecks) {
    return (kopecks / 100).toFixed(2);
  }

  // Ломкое место №2: сумма депозита берётся из текста страницы по метке «ДС на счету».
  // Запасной вариант при переименовании метки в AGIS — искать по соседней ячейке таблицы
  // реквизитов (getRowValue в agis-loan-info-navbar.user.js); пока метка стабильна.
  function extractDepositFromText(rawText) {
    const match = String(rawText || '').match(/ДС\s*на\s*счету\s*:?\s*(-?[\d\s\u00a0\u202f]+(?:[,.]\d{1,2})?)\s*₽/iu);
    if (!match) return null;
    const kopecks = parseMoneyToKopecks(match[1]);
    if (kopecks === null) return null;
    return { kopecks, sourceText: normalizeText(match[0]) };
  }

  function scoreFieldDescription(description, patterns) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(description)) score += 10;
    }
    return score;
  }

  function isPayloadUsable(payload, loanId, now = Date.now()) {
    if (!payload || payload.loanId !== loanId) return false;
    if (!Number.isFinite(payload.kopecks) || payload.kopecks <= 0) return false;
    if (!Number.isFinite(payload.createdAt)) return false;
    return now - payload.createdAt <= PAYLOAD_TTL;
  }

  // --- DOM-часть ------------------------------------------------------------

  function storageKey(loanId) {
    return `${STORAGE_PREFIX}:${loanId}`;
  }

  function findDeposit() {
    if (!document.body) return null;
    return extractDepositFromText(document.body.innerText || document.body.textContent || '');
  }

  function applyStyles(element, styles) {
    // setProperty(..., 'important') — админка AGIS (AdminLTE) агрессивно перекрывает
    // стили кнопок и position:fixed-панелей своими правилами.
    Object.entries(styles).forEach(([property, value]) => element.style.setProperty(property, value, 'important'));
  }

  // Панель пересоздаётся на каждый bootstrap: старый DOM-узел удаляется вместе с
  // навешенными на него слушателями, поэтому отдельного снятия listener'ов не нужно.
  function createPanel() {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    applyStyles(panel, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      'max-width': '380px',
      padding: '12px',
      border: '2px solid #337ab7',
      'border-radius': '6px',
      background: '#ffffff',
      color: '#222222',
      'font-family': 'Arial, sans-serif',
      'font-size': '14px',
      'box-shadow': '0 5px 22px rgba(0, 0, 0, 0.35)',
      'z-index': '2147483647',
      visibility: 'visible',
      opacity: '1',
    });
    document.body.appendChild(panel);
    return panel;
  }

  function renderRefundButton(route, deposit, token) {
    const panel = createPanel();

    const title = document.createElement('strong');
    title.textContent = 'Возврат депозита';
    applyStyles(title, { color: '#198754' });

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Вернуть депозит ${formatRubles(deposit.kopecks)}`;
    applyStyles(button, {
      display: 'block',
      padding: '9px 14px',
      border: '1px solid #204d74',
      'border-radius': '4px',
      background: '#337ab7',
      color: '#ffffff',
      cursor: 'pointer',
      'font-family': 'Arial, sans-serif',
      'font-size': '14px',
      'font-weight': '700',
    });

    panel.appendChild(title);
    panel.appendChild(button);

    if (deposit.kopecks <= 0) {
      button.disabled = true;
      button.textContent = 'Депозит отсутствует';
      return;
    }

    button.addEventListener('click', async () => {
      const confirmed = window.confirm(
        `Подготовить возврат депозита ${formatRubles(deposit.kopecks)} по займу #${route.loanId}?\n\n` +
          'Форма будет заполнена, но не отправлена автоматически.',
      );
      if (!confirmed || !routeTokenController.isCurrent(token)) return;

      button.disabled = true;
      showBanner('Открываю форму транзакции…', { type: 'info' });

      // storageSet (немедленная запись), не storageSetDebounced: сразу после неё
      // уходим на другую страницу, отложенная запись не успела бы выполниться.
      await storageSet(storageKey(route.loanId), {
        loanId: route.loanId,
        kopecks: deposit.kopecks,
        createdAt: Date.now(),
        sourceUrl: location.href,
      });

      const saved = await storageGet(storageKey(route.loanId), null);
      if (!isPayloadUsable(saved, route.loanId)) {
        button.disabled = false;
        showBanner('Не удалось сохранить сумму возврата. См. Console.', { type: 'error' });
        warn('Payload не сохранился или не прошёл валидацию:', saved);
        return;
      }

      location.assign(`/admin/agis2/core/loan/${route.loanId}/loantransaction/create`);
    });

    log('Кнопка добавлена:', route.loanId, deposit.sourceText, formatRubles(deposit.kopecks));
  }

  async function initEditPage(route, token) {
    try {
      const deposit = await waitForCondition(findDeposit, {
        timeout: WAIT_TIMEOUT,
        describe: '«ДС на счету» на карточке займа',
      });
      if (!routeTokenController.isCurrent(token)) return;
      renderRefundButton(route, deposit, token);
    } catch (error) {
      warn('Не удалось найти «ДС на счету»:', error);
    }
  }

  function getFieldDescription(field) {
    const parts = [field.name, field.id, field.placeholder, field.getAttribute('aria-label')];

    if (field.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        if (label) parts.push(label.textContent);
      } catch (error) {
        warn('Ошибка поиска label:', error);
      }
    }

    const group = field.closest('.form-group, .control-group, .field, tr, td');
    if (group) {
      const label = group.querySelector('label, th, .control-label, .field-label');
      if (label) parts.push(label.textContent);
    }

    return normalizeComparable(parts.filter(Boolean).join(' '));
  }

  // Скоринг вместо жёстких селекторов: разметка формы транзакции у брендов AGIS
  // различается, а подписи полей — нет. Возвращает null, если ни одно поле не совпало.
  function findBestField(selector, patterns) {
    let bestField = null;
    let bestScore = 0;
    for (const field of document.querySelectorAll(selector)) {
      const score = scoreFieldDescription(getFieldDescription(field), patterns);
      if (score > bestScore) {
        bestScore = score;
        bestField = field;
      }
    }
    return bestField;
  }

  const findAmountField = () =>
    findBestField('input:not([type]), input[type="text"], input[type="number"]', AMOUNT_PATTERNS);
  const findDirectionField = () => findBestField('select, input[type="radio"]', DIRECTION_PATTERNS);
  const findTransactionTypeField = () =>
    findBestField('select, input[type="radio"], input[type="text"]', TYPE_PATTERNS);

  function dispatchFieldEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Нативный сеттер value: React/Vue-контролируемые инпуты игнорируют прямое
  // присваивание field.value (см. ту же правку в agis-add-income-from-googlesheet).
  function setFieldValue(field, value) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(field, 'value');
    const protoDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    const setter = ownDescriptor?.set || protoDescriptor?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    dispatchFieldEvents(field);
  }

  function setChoice(field, desiredText) {
    const desired = normalizeComparable(desiredText);

    if (field instanceof HTMLSelectElement) {
      const option = Array.from(field.options).find((item) => {
        const optionText = normalizeComparable(item.textContent);
        const optionValue = normalizeComparable(item.value);
        return optionText === desired || optionValue === desired || optionText.includes(desired);
      });
      if (!option) return false;
      field.value = option.value;
      dispatchFieldEvents(field);
      return true;
    }

    if (field instanceof HTMLInputElement && field.type === 'radio') {
      const radios = field.name
        ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(field.name)}"]`))
        : [field];
      const target = radios.find((radio) => {
        const value = normalizeComparable(radio.value);
        const parentText = normalizeComparable(radio.parentElement ? radio.parentElement.textContent : '');
        return value === desired || parentText.includes(desired);
      });
      if (!target) return false;
      target.checked = true;
      dispatchFieldEvents(target);
      return true;
    }

    setFieldValue(field, desiredText);
    return true;
  }

  async function initCreatePage(route, token) {
    const key = storageKey(route.loanId);
    const payload = await storageGet(key, null);
    if (!routeTokenController.isCurrent(token)) return;

    if (!payload || payload.loanId !== route.loanId) {
      log('Для этого займа нет подготовленного возврата.');
      return;
    }

    if (!isPayloadUsable(payload, route.loanId)) {
      await storageDelete(key);
      warn('Сохранённые данные возврата устарели или некорректны — удалены.');
      return;
    }

    try {
      // Три поля ждём параллельно: форма рендерится целиком, но на медленном
      // соединении отдельные select'ы догружают options позже остальной разметки.
      const [amountField, directionField, typeField] = await Promise.all([
        waitForCondition(findAmountField, { timeout: WAIT_TIMEOUT, describe: 'поле суммы транзакции' }),
        waitForCondition(findDirectionField, { timeout: WAIT_TIMEOUT, describe: 'поле направления транзакции' }),
        waitForCondition(findTransactionTypeField, { timeout: WAIT_TIMEOUT, describe: 'поле типа транзакции' }),
      ]);
      if (!routeTokenController.isCurrent(token)) return;

      setFieldValue(amountField, formatAmountForInput(payload.kopecks));
      const directionSet = setChoice(directionField, 'OUT');
      const typeSet = setChoice(typeField, 'Возврат депозита');

      for (const field of [amountField, directionField, typeField]) {
        field.style.setProperty('outline', '3px solid #f0ad4e', 'important');
      }

      if (!directionSet || !typeSet) {
        showBanner('Заполнено частично: проверьте направление OUT и тип операции.', { type: 'error' });
        warn('Не все поля установлены:', { directionSet, typeSet, host: location.host });
        return;
      }

      showBanner(`Форма заполнена на ${formatRubles(payload.kopecks)}. Проверьте и отправьте вручную.`, {
        type: 'success',
      });

      // Payload одноразовый: удаляем только после успешного заполнения, иначе
      // перезагрузка страницы потеряла бы подготовленную сумму.
      await storageDelete(key);
    } catch (error) {
      showBanner('Не удалось найти поля формы транзакции. См. Console.', { type: 'error' });
      warn('Ошибка заполнения формы:', error);
    }
  }

  async function bootstrap() {
    cleanupRoute();
    const token = routeTokenController.next();
    const route = parseRoute(location.pathname);
    log('Запуск', { url: location.href, route });
    if (!route) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }
    if (route.page === 'edit') await initEditPage(route, token);
    else await initCreatePage(route, token);
  }

  const rebootstrap = debounce(() => {
    bootstrap().catch((error) => warn('Ошибка SPA-переинициализации:', error));
  }, 150);

  window.addEventListener('pagehide', () => cleanup(), { once: true });

  (async () => {
    debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    onUrlChange(() => rebootstrap());
    await bootstrap();
  })().catch((error) => warn('Ошибка запуска:', error));
})();
