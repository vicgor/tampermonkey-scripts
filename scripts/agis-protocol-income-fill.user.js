// ==UserScript==
// @name         AGIS - вставка прихода из протокола
// @namespace    agis.protocol.income.fill
// @version      1.8.1
// @description  Клик по строке протокола сохраняет данные; автопереход на список приходов нужного займа; на странице создания прихода кнопка вставки заполняет форму.
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NS = 'agis-protocol-income-fill';
  const STORAGE_KEY = 'agis_protocol_income_payload';
  const DEBUG_KEY = 'debug_protocol_income_fill';
  const WAIT_TIMEOUT = 15000;

  let DEBUG = false;

  const observers = new Set();
  const timers = new Set();
  let routeToken = 0;
  let lastUrl = location.href;
  let urlChangeInstalled = false;

  function log(...args) {
    if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  function setManagedTimeout(cb, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      cb();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function debounce(fn, wait = 250) {
    let timer = null;

    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }

    debounced.cancel = () => {
      clearTimeout(timer);
      timer = null;
    };

    return debounced;
  }

  function cleanupRoute() {
    for (const observer of observers) observer.disconnect();
    observers.clear();

    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function onUrlChange(callback) {
    if (urlChangeInstalled) {
      warn('onUrlChange уже установлен — повторный вызов игнорируется.');
      return () => {};
    }
    urlChangeInstalled = true;

    const check = debounce(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      callback(location.href);
    }, 100);

    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (...args) {
      const result = origPush.apply(this, args);
      check();
      return result;
    };

    history.replaceState = function (...args) {
      const result = origReplace.apply(this, args);
      check();
      return result;
    };

    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    const interval = setInterval(check, 1000);

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', check);
      window.removeEventListener('hashchange', check);
      clearInterval(interval);
      check.cancel();
      urlChangeInstalled = false;
    };
  }

  async function storageGet(key, fallback = null) {
    try {
      const value = await GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (error) {
      warn('GM_getValue ошибка:', key, error);
      return fallback;
    }
  }

  async function storageSet(key, value) {
    try {
      await GM_setValue(key, value);
    } catch (error) {
      warn('GM_setValue ошибка:', key, error);
    }
  }

  async function storageDelete(key) {
    try {
      await GM_deleteValue(key);
    } catch (error) {
      warn('GM_deleteValue ошибка:', key, error);
    }
  }

  async function initDebugFlag() {
    DEBUG = !!(await storageGet(DEBUG_KEY, false));
  }

  function registerMenu() {
    GM_registerMenuCommand(
      `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
      async () => {
        DEBUG = !DEBUG;
        await storageSet(DEBUG_KEY, DEBUG);
        alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
      }
    );
  }

  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;
      let timeoutTimer = null;

      const query = () => {
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };

      const finish = (element) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        observers.delete(observer);

        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timers.delete(timeoutTimer);
        }

        resolve(element);
      };

      const fail = () => {
        if (done) return;
        done = true;
        observer?.disconnect();
        observers.delete(observer);
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout}мс`));
      };

      const existing = query();
      if (existing) return finish(existing);

      timeoutTimer = setManagedTimeout(fail, timeout);

      const startObserve = () => {
        if (done) return;

        const observeRoot = root === document ? (document.documentElement || document.body) : root;
        if (!observeRoot) {
          setManagedTimeout(startObserve, 50);
          return;
        }

        observer = new MutationObserver(() => {
          const element = query();
          if (element) finish(element);
        });

        observer.observe(observeRoot, { childList: true, subtree: true });
        observers.add(observer);

        const element = query();
        if (element) finish(element);
      };

      startObserve();
    });
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

  function showToast(text, { color = '#00a65a', duration = 3000 } = {}) {
    const toast = document.createElement('div');
    toast.textContent = text;

    Object.assign(toast.style, {
      position: 'fixed',
      top: '60px',
      right: '20px',
      zIndex: '99999',
      background: color,
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)',
      fontSize: '14px',
      maxWidth: '420px'
    });

    document.body.appendChild(toast);
    setManagedTimeout(() => toast.remove(), duration);
    return toast;
  }

  async function initListPage(token) {
    let table;

    try {
      table = await waitForElement('table.sonata-ba-list, table.table', { timeout: WAIT_TIMEOUT });
    } catch (error) {
      warn('Таблица не появилась:', error.message);
      return;
    }

    if (token !== routeToken) return;

    const colIndex = getHeaderMap(table);
    log('Колонки:', colIndex);

    if (!document.querySelector(`#${SCRIPT_NS}-list-style`)) {
      const style = document.createElement('style');
      style.id = `${SCRIPT_NS}-list-style`;
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

        showToast(
          `Сохранено: займ ${payload.loanId || '-'}, дата ${payload.incomeDate || '-'}, сумма ${payload.amount || '-'}, заказ ${payload.orderNumber || '-'}`,
          { duration: 2500 }
        );

        if (!loanId) {
          warn('Не удалось определить ID займа для перехода.');
          showToast('Не удалось определить ID займа для перехода.', { color: '#dd4b39', duration: 3500 });
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

    return waitForElement(selector, { timeout: 10000 });
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
    const btn = document.querySelector(`#${SCRIPT_NS}-fill-btn`);
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
    if (document.querySelector(`#${SCRIPT_NS}-fill-btn`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${SCRIPT_NS}-fill-btn`;
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

    showToast(
      [
        success ? 'Поля заполнены.' : 'Не удалось заполнить поля.',
        `Дата: ${dateOk ? 'OK' : 'нет'}`,
        `Номер заказа: ${orderOk ? 'OK' : 'нет'}`,
        `Сумма: ${amountOk ? 'OK' : 'нет'}`,
        `ID займа: ${loanIdFromUrl || 'из URL не определён'}`
      ].join(' '),
      { color: success ? '#00a65a' : '#dd4b39', duration: 5000 }
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

    if (token !== routeToken) return;

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
    const token = ++routeToken;
    cleanupRoute();

    try {
      await waitForElement('body');
    } catch (error) {
      warn('body:', error.message);
      return;
    }

    if (token !== routeToken) return;

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

  (async () => {
    await initDebugFlag();
    registerMenu();

    // bootstrap() вызывается без await намеренно — onUrlChange не должен блокироваться.
    // .catch() перехватывает необработанные rejection при SPA-навигации.
    const stopUrlWatcher = onUrlChange(() => {
      bootstrap().catch((error) => warn('bootstrap error:', error));
    });

    window.addEventListener('pagehide', () => {
      cleanupRoute();
      stopUrlWatcher();
    }, { once: true });

    bootstrap();
  })();
})();
