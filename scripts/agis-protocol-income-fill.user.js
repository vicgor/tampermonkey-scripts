// ==UserScript==
// @name         AGIS - вставка прихода из протокола
// @namespace    agis.protocol.income.fill
// @version      1.5
// @description  Клик по строке протокола сохраняет данные; автопереход на список приходов нужного займа; на странице создания прихода кнопка вставки заполняет форму.
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NS = 'agis-protocol-income-fill';
  const STORAGE_KEY = 'agis_protocol_income_payload';
  const WAIT_TIMEOUT = 15000;
  let DEBUG = !!GM_getValue('debug_protocol_income_fill', false);

  GM_registerMenuCommand(
    `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
    () => {
      DEBUG = !DEBUG;
      GM_setValue('debug_protocol_income_fill', DEBUG);
      alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
    }
  );

  const log = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const observers = new Set();
  const timers = new Set();
  let routeToken = 0;
  let lastUrl = location.href;
  let urlChangeInstalled = false;

  function setManagedTimeout(cb, delay) {
    const t = setTimeout(() => { timers.delete(t); cb(); }, delay);
    timers.add(t);
    return t;
  }

  function debounce(fn, wait = 250) {
    let timer = null;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = null; };
    return debounced;
  }

  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function onUrlChange(callback) {
    if (urlChangeInstalled) {
      warn('onUrlChange уже установлен — повторный вызов игнорируется.');
      return () => { };
    }
    urlChangeInstalled = true;

    const check = debounce(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      callback(location.href);
    }, 100);

    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (...a) {
      const r = origPush.apply(this, a);
      check();
      return r;
    };
    history.replaceState = function (...a) {
      const r = origReplace.apply(this, a);
      check();
      return r;
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
      const v = await GM_getValue(key, fallback);
      return v === undefined ? fallback : v;
    } catch (e) {
      warn('GM_getValue ошибка:', key, e);
      return fallback;
    }
  }

  async function storageSet(key, value) {
    try { await GM_setValue(key, value); }
    catch (e) { warn('GM_setValue ошибка:', key, e); }
  }

  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false, observer = null;
      let timeoutTimer = null;

      const query = () => {
        try { return root.querySelector(selector); }
        catch { return null; }
      };

      const finish = (el) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        observers.delete(observer);
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timers.delete(timeoutTimer);
        }
        resolve(el);
      };

      const fail = () => {
        if (done) return;
        done = true;
        observer?.disconnect();
        observers.delete(observer);
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout}мс`));
      };

      const ex = query();
      if (ex) return finish(ex);

      timeoutTimer = setManagedTimeout(fail, timeout);

      const startObserve = () => {
        if (done) return;
        const r = root === document ? (document.documentElement || document.body) : root;
        if (!r) {
          setManagedTimeout(startObserve, 50);
          return;
        }
        observer = new MutationObserver(() => {
          const el = query();
          if (el) finish(el);
        });
        observer.observe(r, { childList: true, subtree: true });
        observers.add(observer);

        const el = query();
        if (el) finish(el);
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
    const m = location.pathname.match(/\/(?:loan|loan-overdue)\/(\d+)\/income\/(?:list|create)\b/i);
    return m ? m[1] : '';
  }

  function cellText(td) {
    return td ? normalizeText(td.textContent) : '';
  }

  function getHeaderMap(table) {
    const result = {};
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, i) => {
      const t = normalizeText(th.textContent).toLowerCase();
      if (t.includes('id займ')) result.loanId = i;
      if (t.includes('дата прихода')) result.incomeDate = i;
      if (t.includes('сумма прихода')) result.amount = i;
      if (t.includes('номер заказа')) result.orderNumber = i;
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
    } catch (e) {
      warn('Таблица не появилась:', e.message);
      return;
    }
    if (token !== routeToken) return;

    const colIndex = getHeaderMap(table);
    log('Колонки:', colIndex);

    const style = document.createElement('style');
    style.textContent = [
      'tr.bc-protocol-copy-row { cursor: copy; }',
      'tr.bc-protocol-copy-row:hover td { background: #fff7d6 !important; }'
    ].join('\n');
    document.head.appendChild(style);

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      tr.classList.add('bc-protocol-copy-row');
      tr.title = 'Клик: сохранить данные и перейти к списку приходов';

      tr.addEventListener('click', async (e) => {
        if (e.target.closest('a, button, input, label, .btn')) return;
        e.preventDefault();

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
        await storageSet(STORAGE_KEY, JSON.stringify(payload));

        const toast = document.createElement('div');
        toast.textContent = `Сохранено: займ ${payload.loanId || '-'}, дата ${payload.incomeDate || '-'}, сумма ${payload.amount || '-'}, заказ ${payload.orderNumber || '-'}`;
        Object.assign(toast.style, {
          position: 'fixed',
          top: '60px',
          right: '20px',
          zIndex: '99999',
          background: '#00a65a',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,.2)',
          fontSize: '14px',
          maxWidth: '420px'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);

        if (!loanId) {
          warn('Не удалось определить ID займа для перехода.');
          return;
        }

        const targetUrl = buildIncomeListUrl(loanId);
        log('Переход на список приходов:', targetUrl);
        location.href = targetUrl;
      });
    });

    log('Список протокола готов, строк:', rows.length);
  }

  function setVal(selectors, val) {
    if (val === undefined || val === null) return false;
    const list = Array.isArray(selectors) ? selectors : [selectors];

    for (const sel of list) {
      const el = document.querySelector(sel);
      if (!el) continue;

      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, val);
      else el.value = val;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger('change');

      log('Заполнено поле:', sel, '→', val);
      return true;
    }

    log('Поле не найдено:', list);
    return false;
  }

  async function waitForIncomeForm() {
    const selectors = [
      'input[aria-label="Дата платежа"]',
      'input[name$="[incomeDate]"]',
      'input[aria-label="Номер заказа*"]',
      'input[aria-label="Сумма платежа*"]',
      'textarea'
    ];

    const started = Date.now();

    while (Date.now() - started < 10000) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error('Форма прихода не появилась: не найден ни один ожидаемый input.');
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

    const previewBtn = allButtons.find(el => {
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
    log('Кнопка вставлена как fixed fallback.');
  }

  function fillForm(data) {
    const loanIdFromUrl = getLoanIdFromUrl();

    const dateOk = setVal([
      'input[aria-label="Дата платежа"]',
      'input[name$="[incomeDate]"]'
    ], data.incomeDate);

    const orderOk = setVal([
      'input[aria-label="Номер заказа*"]',
      'input[name$="[bankPaymentId]"]',
      'input[name*="[orderNumber]"]'
    ], data.orderNumber || '-');

    const amountOk = setVal([
      'input[aria-label="Сумма платежа*"]',
      'input[name$="[income]"]',
      'input[name*="[amount]"]'
    ], data.amount);

    const loanOk =
      setVal([
        'input[name$="[loan]"]',
        'input[name$="[loanId]"]',
        'input[type="hidden"][name*="loan"]'
      ], loanIdFromUrl);

    const banner = document.createElement('div');
    banner.textContent = [
      'Поля заполнены.',
      `Дата: ${dateOk ? 'OK' : 'нет'}`,
      `Номер заказа: ${orderOk ? 'OK' : 'нет'}`,
      `Сумма: ${amountOk ? 'OK' : 'нет'}`,
      `ID займа: ${loanOk ? 'OK' : 'из URL'}`
    ].join(' ');

    Object.assign(banner.style, {
      position: 'fixed',
      top: '60px',
      right: '20px',
      zIndex: '99999',
      background: '#00a65a',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)',
      fontSize: '14px',
      maxWidth: '420px'
    });
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);

    log('Заполнено:', { data, loanIdFromUrl, dateOk, orderOk, amountOk, loanOk });
  }

  async function initCreatePage(token) {
    try {
      await waitForIncomeForm();
    } catch (e) {
      warn('Форма не появилась:', e.message);
      return;
    }
    if (token !== routeToken) return;

    addFillButton(async () => {
      const raw = await storageGet(STORAGE_KEY, null);
      if (!raw) {
        alert('Нет сохранённых данных.');
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        warn('Неверный payload:', e);
        alert('Ошибка чтения сохранённых данных.');
        return;
      }

      fillForm(data);
    });
  }

  async function bootstrap() {
    const token = ++routeToken;
    cleanupRoute();

    try {
      await waitForElement('body');
    } catch (e) {
      warn('body:', e.message);
      return;
    }
    if (token !== routeToken) return;

    const path = location.pathname;

    if (/\/supportprocess\/domain\/supportprocesstask\/\d+\/task-protocol\/list/.test(path)) {
      await initListPage(token);
    }

    if (/\/admin\/agis2\/core\/(?:loan|loan-overdue)\/\d+\/income\/create/.test(path)) {
      await initCreatePage(token);
    }
  }

  const stopUrlWatcher = onUrlChange(() => bootstrap());

  window.addEventListener('pagehide', () => {
    cleanupRoute();
    stopUrlWatcher();
  }, { once: true });

  bootstrap();
})();